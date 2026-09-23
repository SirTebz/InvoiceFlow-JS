/**
 * PayFast Payment Provider
 *
 * Implements PayFast Standard Checkout integration:
 *   https://developers.payfast.co.za/docs
 *
 * All PayFast-specific logic is isolated here.
 * The rest of InvoiceFlow only interacts via paymentService.js.
 *
 * Signature algorithm: MD5 of alphabetically sorted, URL-encoded
 * key=value pairs (excluding 'signature'), with passphrase appended.
 *
 * No external npm dependencies — uses node:crypto for MD5.
 */

"use strict";

const crypto = require("crypto");

// ---------------------------------------------------------------------------
// Signature helpers
// ---------------------------------------------------------------------------

/**
 * URL-encode a value the same way PHP's urlencode() does:
 * spaces become '+', special chars become %XX (uppercase).
 */
function pfEncode(value) {
  return encodeURIComponent(String(value))
    .replace(/%20/g, "+")       // spaces → +
    .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * Build the signature string from a params object.
 * Steps per PayFast docs:
 *  1. Sort keys alphabetically.
 *  2. Exclude 'signature' key.
 *  3. URL-encode each value.
 *  4. Join as key=value&key=value...
 *  5. Append &passphrase=<encoded> if passphrase is non-empty.
 */
function buildSignatureString(params, passphrase) {
  const keys = Object.keys(params)
    .filter((k) => k !== "signature" && params[k] !== "" && params[k] != null)
    .sort();

  const parts = keys.map((k) => `${k}=${pfEncode(params[k])}`);
  let str = parts.join("&");

  if (passphrase) {
    str += `&passphrase=${pfEncode(passphrase)}`;
  }
  return str;
}

/**
 * Generate an MD5 signature for the given params + passphrase.
 * @returns {string} lowercase hex MD5 hash
 */
function generateSignature(params, passphrase) {
  const str = buildSignatureString(params, passphrase);
  return crypto.createHash("md5").update(str).digest("hex");
}

/**
 * Verify an inbound signature (from a browser form redirect or ITN POST).
 * @returns {boolean}
 */
function verifySignature(params, passphrase) {
  const expected = generateSignature(params, passphrase);
  const received = String(params.signature || "").toLowerCase();
  // Use timingSafeEqual where lengths match; otherwise just compare
  if (expected.length !== received.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(received, "hex"));
  } catch (_e) {
    return expected === received;
  }
}

// ---------------------------------------------------------------------------
// Form field builder
// ---------------------------------------------------------------------------

/**
 * Build the PayFast Standard Checkout form fields.
 *
 * @param {object} opts
 * @param {object} opts.invoice      - Invoice row with total_cents, currency, invoice_number, public_token
 * @param {object} opts.business     - Business profile with payfast_merchant_id, payfast_merchant_key, payfast_passphrase
 * @param {object} opts.customer     - Customer row (optional, for email pre-fill)
 * @param {string} opts.mPaymentId   - Our internal UUID reference (m_payment_id)
 * @param {string} opts.returnUrl    - Where to send the customer on success
 * @param {string} opts.cancelUrl    - Where to send the customer on cancel
 * @param {string} opts.notifyUrl    - Our ITN endpoint URL
 * @returns {{ fields: object, actionUrl: string }}
 */
function buildPaymentRequest({ invoice, business, customer, mPaymentId, returnUrl, cancelUrl, notifyUrl, checkoutUrl }) {
  // Convert minor units (cents) to decimal string e.g. 125050 → "1250.50"
  const amount = (invoice.total_cents / 100).toFixed(2);

  const params = {
    merchant_id: business.payfast_merchant_id,
    merchant_key: business.payfast_merchant_key,
    return_url: returnUrl,
    cancel_url: cancelUrl,
    notify_url: notifyUrl,
    m_payment_id: mPaymentId,
    amount,
    item_name: `Invoice ${invoice.invoice_number}`,
    item_description: `Payment for Invoice ${invoice.invoice_number}`,
    custom_str1: invoice.public_token,
    // Customer info (optional pre-fill)
    ...(customer?.email ? { email_address: customer.email } : {}),
    ...(customer?.name ? { name_first: customer.name.split(" ")[0] || customer.name } : {})
  };

  // Remove empty/null fields before signing
  const cleanParams = {};
  for (const [k, v] of Object.entries(params)) {
    if (v !== "" && v != null) cleanParams[k] = v;
  }

  const signature = generateSignature(cleanParams, business.payfast_passphrase || "");
  cleanParams.signature = signature;

  return {
    fields: cleanParams,
    actionUrl: checkoutUrl
  };
}

// ---------------------------------------------------------------------------
// ITN (Instant Transaction Notification) verification
// ---------------------------------------------------------------------------

/**
 * Internal payment status values mapped from PayFast payment_status.
 */
const STATUS_MAP = {
  COMPLETE: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled"
};

/**
 * Verify all aspects of an inbound PayFast ITN POST.
 *
 * @param {object} body               - Parsed URL-encoded POST body (plain object)
 * @param {object} opts
 * @param {number} opts.expectedAmountCents - Amount in minor units we expect
 * @param {string} opts.merchantId    - Our configured PayFast merchant_id
 * @param {string} opts.passphrase    - Our PayFast passphrase
 * @returns {{ valid: boolean, reason: string|null, paymentStatus: string|null, pfPaymentId: string|null }}
 */
function verifyItn(body, { expectedAmountCents, merchantId, passphrase }) {
  // 1. Verify signature
  if (!verifySignature(body, passphrase)) {
    return { valid: false, reason: "signature_mismatch", paymentStatus: null, pfPaymentId: null };
  }

  // 2. Verify merchant_id matches our config
  if (String(body.merchant_id || "") !== String(merchantId)) {
    return { valid: false, reason: "merchant_id_mismatch", paymentStatus: null, pfPaymentId: null };
  }

  // 3. Verify amount_gross matches expected (within 1 cent tolerance for floating point)
  const receivedAmountCents = Math.round(parseFloat(body.amount_gross || "0") * 100);
  if (Math.abs(receivedAmountCents - expectedAmountCents) > 1) {
    return {
      valid: false,
      reason: `amount_mismatch:expected=${expectedAmountCents},received=${receivedAmountCents}`,
      paymentStatus: null,
      pfPaymentId: null
    };
  }

  // 4. Verify currency (PayFast standard checkout is ZAR-only)
  // PayFast doesn't include a currency field in standard ITN — it's always ZAR.
  // We verify on our side by checking the invoice currency.

  // 5. Check payment_status is a recognised value
  const pfStatus = String(body.payment_status || "").toUpperCase();
  const paymentStatus = STATUS_MAP[pfStatus];
  if (!paymentStatus) {
    return {
      valid: false,
      reason: `unknown_payment_status:${pfStatus}`,
      paymentStatus: null,
      pfPaymentId: null
    };
  }

  return {
    valid: true,
    reason: null,
    paymentStatus,
    pfPaymentId: String(body.pf_payment_id || "")
  };
}

// ---------------------------------------------------------------------------
// URL-encoded body parser (for ITN POST requests)
// ---------------------------------------------------------------------------

/**
 * Parse application/x-www-form-urlencoded body string into a plain object.
 * Does NOT use querystring module — pure string parsing.
 */
function parseFormBody(raw) {
  const result = {};
  for (const pair of String(raw).split("&")) {
    const eqIdx = pair.indexOf("=");
    if (eqIdx === -1) continue;
    const key = decodeURIComponent(pair.slice(0, eqIdx).replace(/\+/g, " "));
    const val = decodeURIComponent(pair.slice(eqIdx + 1).replace(/\+/g, " "));
    result[key] = val;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  generateSignature,
  verifySignature,
  buildPaymentRequest,
  verifyItn,
  parseFormBody,
  STATUS_MAP
};
