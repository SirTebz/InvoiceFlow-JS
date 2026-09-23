/**
 * PaymentService — provider-agnostic payment abstraction
 *
 * Architecture:
 *   PaymentService
 *     └── PaymentProvider
 *           └── PayFastProvider  (server/services/providers/payfastProvider.js)
 *
 * Future providers would be added as additional providers here.
 * The rest of the application only calls PaymentService methods.
 */

"use strict";

const crypto = require("crypto");
const config = require("../config");
const payfast = require("./providers/payfastProvider");

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function generateMPaymentId() {
  return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");
}

// ---------------------------------------------------------------------------
// Payment initiation
// ---------------------------------------------------------------------------

/**
 * Initiate a payment for an invoice.
 *
 * 1. Validates the invoice is payable.
 * 2. Validates the business has PayFast credentials configured.
 * 3. Creates a pending payment_request row.
 * 4. Builds the PayFast form fields + action URL.
 *
 * @param {object} opts
 * @param {object} opts.invoice   - Full invoice row (must include public_token, total_cents, currency, status)
 * @param {object} opts.business  - Business profile row (must include payfast_merchant_id etc.)
 * @param {object} opts.customer  - Customer row (optional, for email pre-fill)
 * @param {object} opts.db        - Database instance
 * @returns {{ m_payment_id: string, fields: object, actionUrl: string }}
 * @throws {Error} if invoice is not payable or credentials missing
 */
function initiatePayment({ invoice, business, customer, db }) {
  // Validate invoice is payable
  const payableStatuses = ["sent", "overdue"];
  if (!payableStatuses.includes(invoice.status)) {
    const err = new Error(`Invoice cannot be paid in status: ${invoice.status}`);
    err.code = "NOT_PAYABLE";
    throw err;
  }

  // Validate business has PayFast credentials
  if (!business.payfast_merchant_id || !business.payfast_merchant_key) {
    const err = new Error("PayFast payment credentials are not configured for this business.");
    err.code = "NO_PAYFAST_CREDENTIALS";
    throw err;
  }

  // Validate currency — PayFast Standard Checkout only supports ZAR
  if (invoice.currency && invoice.currency !== "ZAR") {
    const err = new Error(`PayFast only supports ZAR. Invoice currency is ${invoice.currency}.`);
    err.code = "UNSUPPORTED_CURRENCY";
    throw err;
  }

  const mPaymentId = generateMPaymentId();
  const appUrl = config.appUrl.replace(/\/$/, "");
  const token = invoice.public_token;

  const returnUrl = `${appUrl}/invoice/${token}?payment=success`;
  const cancelUrl = `${appUrl}/invoice/${token}?payment=cancelled`;
  const notifyUrl = `${appUrl}/api/payments/notify`;

  // Create pending payment_request row
  db.prepare(`
    INSERT INTO payment_requests (user_id, invoice_id, m_payment_id, provider, expected_amount_cents, currency, status)
    VALUES (?, ?, ?, 'payfast', ?, ?, 'pending')
  `).run(business.user_id, invoice.id, mPaymentId, invoice.total_cents, invoice.currency || "ZAR");

  // Build PayFast form fields
  const { fields, actionUrl } = payfast.buildPaymentRequest({
    invoice,
    business,
    customer,
    mPaymentId,
    returnUrl,
    cancelUrl,
    notifyUrl,
    checkoutUrl: config.payfast.checkoutUrl
  });

  return { m_payment_id: mPaymentId, fields, actionUrl };
}

// ---------------------------------------------------------------------------
// ITN notification handling
// ---------------------------------------------------------------------------

/**
 * Handle an inbound ITN POST from PayFast.
 *
 * Security steps (per PayFast documentation):
 *  1. Parse URL-encoded body.
 *  2. Lookup payment_request by m_payment_id.
 *  3. Lookup invoice via payment_request.invoice_id.
 *  4. Load business credentials (merchant_id, passphrase).
 *  5. Verify signature.
 *  6. Verify merchant_id.
 *  7. Verify amount_gross matches expected.
 *  8. Verify invoice currency is ZAR.
 *  9. Check idempotency (pf_payment_id already recorded).
 * 10. Map payment status.
 * 11. Record payment / update invoice if COMPLETE.
 *
 * @param {string} rawBody  - Raw URL-encoded POST body string
 * @param {object} db       - Database instance
 * @returns {{ accepted: boolean, reason: string }}
 */
function handleNotification(rawBody, db) {
  let body;
  try {
    body = payfast.parseFormBody(rawBody);
  } catch (_e) {
    return { accepted: false, reason: "invalid_body" };
  }

  const mPaymentId = String(body.m_payment_id || "").trim();
  const pfPaymentId = String(body.pf_payment_id || "").trim();
  const customStr1 = String(body.custom_str1 || "").trim(); // invoice public_token

  if (!mPaymentId) {
    return { accepted: false, reason: "missing_m_payment_id" };
  }

  // 2. Lookup payment_request
  const paymentRequest = db.prepare("SELECT * FROM payment_requests WHERE m_payment_id = ?").get(mPaymentId);
  if (!paymentRequest) {
    return { accepted: false, reason: "unknown_m_payment_id" };
  }

  // 3. Lookup invoice
  const invoice = db.prepare("SELECT * FROM invoices WHERE id = ?").get(paymentRequest.invoice_id);
  if (!invoice) {
    return { accepted: false, reason: "invoice_not_found" };
  }

  // Cross-reference: custom_str1 should match invoice's public_token
  if (customStr1 && invoice.public_token && customStr1 !== invoice.public_token) {
    return { accepted: false, reason: "token_mismatch" };
  }

  // 4. Load business credentials
  const business = db.prepare("SELECT * FROM business_profiles WHERE user_id = ?").get(invoice.user_id);
  if (!business) {
    return { accepted: false, reason: "business_not_found" };
  }

  // 5–7. Verify signature, merchant_id, amount
  const verification = payfast.verifyItn(body, {
    expectedAmountCents: paymentRequest.expected_amount_cents,
    merchantId: business.payfast_merchant_id,
    passphrase: business.payfast_passphrase || ""
  });

  if (!verification.valid) {
    console.log(`[PaymentService] ITN rejected: ${verification.reason} for m_payment_id=${mPaymentId}`);
    return { accepted: false, reason: verification.reason };
  }

  // 8. Verify invoice currency is ZAR (PayFast standard checkout only supports ZAR)
  if (invoice.currency && invoice.currency !== "ZAR") {
    return { accepted: false, reason: `currency_mismatch:${invoice.currency}` };
  }

  // 9. Idempotency check — has this pf_payment_id already been recorded?
  if (pfPaymentId) {
    const existing = db.prepare("SELECT id FROM payments WHERE provider_payment_id = ?").get(pfPaymentId);
    if (existing) {
      console.log(`[PaymentService] ITN duplicate: pf_payment_id=${pfPaymentId} already recorded`);
      // Update payment_request status to match if needed
      db.prepare("UPDATE payment_requests SET status=?, updated_at=CURRENT_TIMESTAMP WHERE m_payment_id=?")
        .run(verification.paymentStatus, mPaymentId);
      return { accepted: true, reason: "duplicate_already_recorded" };
    }
  }

  // 10. Check if invoice is already paid (guard against double-paid state corruption)
  const currentStatus = invoiceStatus(invoice);
  if (currentStatus === "paid" && verification.paymentStatus === "completed") {
    console.log(`[PaymentService] ITN for already-paid invoice ${invoice.id}`);
    db.prepare("UPDATE payment_requests SET status=?, updated_at=CURRENT_TIMESTAMP WHERE m_payment_id=?")
      .run("completed", mPaymentId);
    return { accepted: true, reason: "invoice_already_paid" };
  }

  // Check if invoice is cancelled
  if (currentStatus === "cancelled") {
    console.log(`[PaymentService] ITN for cancelled invoice ${invoice.id} — not processing payment`);
    db.prepare("UPDATE payment_requests SET status='failed', updated_at=CURRENT_TIMESTAMP WHERE m_payment_id=?")
      .run(mPaymentId);
    return { accepted: false, reason: "invoice_cancelled" };
  }

  // 11. Update payment_request status
  db.prepare("UPDATE payment_requests SET status=?, updated_at=CURRENT_TIMESTAMP WHERE m_payment_id=?")
    .run(verification.paymentStatus, mPaymentId);

  // 12. If COMPLETE → record payment + mark invoice paid
  if (verification.paymentStatus === "completed") {
    const amountGrossCents = Math.round(parseFloat(body.amount_gross || "0") * 100);
    const paymentMethod = String(body.payment_method || "").toLowerCase() || null;

    // Safe log of ITN (exclude signature and passphrase)
    const safeLog = Object.fromEntries(
      Object.entries(body).filter(([k]) => !["signature", "passphrase"].includes(k))
    );

    db.prepare(`
      INSERT INTO payments
        (user_id, invoice_id, payment_date, amount_cents, reference,
         provider, provider_payment_id, provider_ref,
         payment_status, payment_method, amount_gross_cents, completed_at, raw_response)
      VALUES (?, ?, date('now'), ?, ?, 'payfast', ?, ?, 'completed', ?, ?, datetime('now'), ?)
    `).run(
      invoice.user_id,
      invoice.id,
      paymentRequest.expected_amount_cents,
      mPaymentId,
      pfPaymentId,
      mPaymentId,
      paymentMethod,
      amountGrossCents,
      JSON.stringify(safeLog)
    );

    db.prepare("UPDATE invoices SET status='paid', updated_at=CURRENT_TIMESTAMP WHERE id=?").run(invoice.id);
    console.log(`[PaymentService] Payment completed: invoice=${invoice.id}, pf_payment_id=${pfPaymentId}`);
  }

  return { accepted: true, reason: verification.paymentStatus };
}

// ---------------------------------------------------------------------------
// Minimal local invoiceStatus helper (mirrors app.js)
// ---------------------------------------------------------------------------
function invoiceStatus(invoice) {
  if (["paid", "draft", "cancelled"].includes(invoice.status)) return invoice.status;
  return new Date(invoice.due_date) < new Date(new Date().toISOString().slice(0, 10)) ? "overdue" : invoice.status;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = { initiatePayment, handleNotification };
