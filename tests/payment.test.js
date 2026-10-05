const test = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("../server/app");
const { closeDatabase, getDb } = require("../server/database/db");
const payfast = require("../server/services/providers/payfastProvider");
const { initiatePayment, handleNotification } = require("../server/services/paymentService");

async function withServer(fn) {
  closeDatabase();
  const server = createApp({ databaseUrl: ":memory:" });
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const jar = new Map();

  async function api(path, options = {}) {
    const isForm = options.form != null;
    const headers = {
      Cookie: [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; "),
      ...(options.headers || {})
    };
    let bodyPayload;
    if (isForm) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      bodyPayload = typeof options.form === "string"
        ? options.form
        : Object.entries(options.form).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
    } else if (options.body != null) {
      headers["Content-Type"] = "application/json";
      bodyPayload = JSON.stringify(options.body);
    }

    const response = await fetch(`${base}${path}`, {
      method: options.method || "GET",
      headers,
      body: bodyPayload
    });

    const setCookie = response.headers.get("set-cookie");
    if (setCookie) {
      const [name, value] = setCookie.split(";")[0].split("=");
      if (value) jar.set(name, value);
      else jar.delete(name);
    }

    const contentType = response.headers.get("content-type") || "";
    let data = null;
    let text = null;
    if (contentType.includes("application/json")) {
      data = await response.json().catch(() => null);
    } else {
      text = await response.text().catch(() => "");
    }
    return { response, data, text };
  }

  api.base = base;
  try {
    await fn(api);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    closeDatabase();
  }
}

function futureDate(daysFromNow = 0) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

async function setupMerchant(api) {
  // 1. Register
  await api("/api/auth/register", {
    method: "POST",
    body: { name: "Merchant", email: "merchant@test.co.za", password: "password123", confirmPassword: "password123" }
  });

  // 2. Configure Business with PayFast credentials
  const bizRes = await api("/api/business", {
    method: "PUT",
    body: {
      businessName: "Acme Design Co",
      currency: "ZAR",
      payfastMerchantId: "10000100",
      payfastMerchantKey: "46f0cd694581a",
      payfastPassphrase: "mysecretpassphrase"
    }
  });
  assert.equal(bizRes.response.status, 200);
  assert.equal(bizRes.data.profile.has_payfast, true);
  assert.equal(bizRes.data.profile.has_payfast_passphrase, true);
  // Passphrase must NEVER be returned to client
  assert.equal(bizRes.data.profile.payfast_passphrase, undefined);

  // 3. Create Customer
  const custRes = await api("/api/customers", {
    method: "POST",
    body: { name: "Client Corp", email: "billing@client.test", phone: "0821234567" }
  });
  const customerId = custRes.data.customer.id;

  // 4. Create Invoice (total = R2,500.00 -> 250000 cents)
  const invRes = await api("/api/invoices", {
    method: "POST",
    body: {
      customerId,
      issueDate: futureDate(0),
      dueDate: futureDate(30),
      status: "sent",
      items: [{ description: "Design Consulting", quantity: 1, unitPrice: 2500, taxRate: 0 }]
    }
  });
  assert.equal(invRes.response.status, 200);
  return { invoice: invRes.data.invoice, customerId };
}


// ---------------------------------------------------------------------------
// Unit tests for payfastProvider isolation
// ---------------------------------------------------------------------------

test("payfastProvider: generates and verifies MD5 signature with passphrase", () => {
  const params = {
    merchant_id: "10000100",
    merchant_key: "46f0cd694581a",
    amount: "100.00",
    item_name: "Test Item"
  };
  const passphrase = "sandboxpassphrase";
  const sig = payfast.generateSignature(params, passphrase);
  assert.ok(sig);
  assert.equal(typeof sig, "string");
  assert.equal(sig.length, 32);

  // Verify signature matching
  assert.equal(payfast.verifySignature({ ...params, signature: sig }, passphrase), true);

  // Fails with wrong passphrase or tampered amount
  assert.equal(payfast.verifySignature({ ...params, signature: sig }, "wrongpass"), false);
  assert.equal(payfast.verifySignature({ ...params, amount: "200.00", signature: sig }, passphrase), false);
});

test("payfastProvider: buildPaymentRequest formats minor units and includes all required fields", () => {
  const invoice = {
    total_cents: 250000,
    currency: "ZAR",
    invoice_number: "INV-0001",
    public_token: "tok_test_12345678"
  };
  const business = {
    payfast_merchant_id: "10000100",
    payfast_merchant_key: "46f0cd694581a",
    payfast_passphrase: "secret"
  };
  const req = payfast.buildPaymentRequest({
    invoice,
    business,
    customer: { email: "cust@test.com", name: "Alice Smith" },
    mPaymentId: "ref-uuid-001",
    returnUrl: "http://localhost:3000/return",
    cancelUrl: "http://localhost:3000/cancel",
    notifyUrl: "http://localhost:3000/notify",
    checkoutUrl: "https://sandbox.payfast.co.za/eng/process"
  });

  assert.equal(req.actionUrl, "https://sandbox.payfast.co.za/eng/process");
  assert.equal(req.fields.merchant_id, "10000100");
  assert.equal(req.fields.merchant_key, "46f0cd694581a");
  assert.equal(req.fields.amount, "2500.00");
  assert.equal(req.fields.m_payment_id, "ref-uuid-001");
  assert.equal(req.fields.custom_str1, "tok_test_12345678");
  assert.ok(req.fields.signature);
});

// ---------------------------------------------------------------------------
// Integration tests for payment flow
// ---------------------------------------------------------------------------

test("payments: public invoice initiate payment returns PayFast checkout parameters", () => withServer(async (api) => {
  const { invoice } = await setupMerchant(api);

  // 1. Fetch public invoice
  const pubRes = await api(`/api/public/invoices/${invoice.public_token}`);
  assert.equal(pubRes.response.status, 200);
  assert.equal(pubRes.data.business.has_online_payment, true);

  // 2. Initiate payment via public token
  const payRes = await api(`/api/public/invoices/${invoice.public_token}/pay`, { method: "POST" });
  assert.equal(payRes.response.status, 200);
  assert.ok(payRes.data.actionUrl.includes("payfast.co.za"));
  assert.equal(payRes.data.fields.amount, "2500.00");
  assert.equal(payRes.data.fields.merchant_id, "10000100");
  assert.ok(payRes.data.m_payment_id);
  assert.ok(payRes.data.fields.signature);
}));

test("payments: cannot initiate payment on draft or cancelled invoice", () => withServer(async (api) => {
  await setupMerchant(api);

  // Create a draft invoice
  const draftRes = await api("/api/invoices", {
    method: "POST",
    body: {
      customerId: 1,
      issueDate: futureDate(0),
      dueDate: futureDate(30),
      status: "draft",
      items: [{ description: "Draft Item", quantity: 1, unitPrice: 100, taxRate: 0 }]
    }
  });
  const draftToken = draftRes.data.invoice.public_token;

  const payDraft = await api(`/api/public/invoices/${draftToken}/pay`, { method: "POST" });
  assert.equal(payDraft.response.status, 400);

  // Cancel an invoice and test
  const cancelRes = await api(`/api/invoices/${draftRes.data.invoice.id}/cancel`, { method: "POST" });
  assert.equal(cancelRes.response.status, 200);
  const payCancelled = await api(`/api/public/invoices/${draftToken}/pay`, { method: "POST" });
  assert.equal(payCancelled.response.status, 400);
}));

test("payments: valid PayFast ITN records payment, marks invoice paid, and is idempotent", () => withServer(async (api) => {
  const { invoice } = await setupMerchant(api);

  // 1. Initiate payment to get m_payment_id
  const payRes = await api(`/api/public/invoices/${invoice.public_token}/pay`, { method: "POST" });
  const mPaymentId = payRes.data.m_payment_id;

  // 2. Prepare ITN payload matching PayFast format
  const itnData = {
    m_payment_id: mPaymentId,
    pf_payment_id: "PF-TEST-TXN-12345",
    payment_status: "COMPLETE",
    item_name: `Invoice ${invoice.invoice_number}`,
    item_description: `Payment for Invoice ${invoice.invoice_number}`,
    amount_gross: "2500.00",
    amount_fee: "-57.50",
    amount_net: "2442.50",
    custom_str1: invoice.public_token,
    merchant_id: "10000100"
  };
  itnData.signature = payfast.generateSignature(itnData, "mysecretpassphrase");

  // 3. Post ITN to webhook endpoint
  const notifyRes = await api("/api/payments/notify", { method: "POST", form: itnData });
  assert.equal(notifyRes.response.status, 200);
  assert.equal(notifyRes.text, "OK");

  // 4. Verify public invoice is now Paid
  const pubRes = await api(`/api/public/invoices/${invoice.public_token}`);
  assert.equal(pubRes.data.invoice.status, "paid");
  assert.equal(pubRes.data.invoice.payments.length, 1);
  assert.equal(pubRes.data.invoice.payments[0].amount_cents, 250000);

  // 5. Verify payment-status endpoint
  const statusRes = await api(`/api/public/invoices/${invoice.public_token}/payment-status`);
  assert.equal(statusRes.data.paid, true);
  assert.equal(statusRes.data.status, "paid");

  // 6. Test Idempotency: Post duplicate ITN with same pf_payment_id
  const duplicateRes = await api("/api/payments/notify", { method: "POST", form: itnData });
  assert.equal(duplicateRes.response.status, 200);

  // Verify no second payment record was inserted
  const invoiceDetail = await api(`/api/invoices/${invoice.id}`);
  assert.equal(invoiceDetail.data.invoice.payments.length, 1);
  assert.equal(invoiceDetail.data.invoice.payments[0].provider_payment_id, "PF-TEST-TXN-12345");
  assert.equal(invoiceDetail.data.invoice.payments[0].provider, "payfast");
}));

test("payments: ITN rejects invalid signature or tampered amount", () => withServer(async (api) => {
  const { invoice } = await setupMerchant(api);

  const payRes = await api(`/api/public/invoices/${invoice.public_token}/pay`, { method: "POST" });
  const mPaymentId = payRes.data.m_payment_id;

  // Case A: Bad signature
  const badSigItn = {
    m_payment_id: mPaymentId,
    pf_payment_id: "PF-TAMPER-1",
    payment_status: "COMPLETE",
    amount_gross: "2500.00",
    merchant_id: "10000100",
    signature: "00000000000000000000000000000000"
  };
  const badSigRes = await api("/api/payments/notify", { method: "POST", form: badSigItn });
  assert.equal(badSigRes.response.status, 400);

  // Invoice remains unpaid
  const check1 = await api(`/api/public/invoices/${invoice.public_token}`);
  assert.equal(check1.data.invoice.status, "sent");

  // Case B: Tampered amount (R100 instead of R2,500)
  const wrongAmountItn = {
    m_payment_id: mPaymentId,
    pf_payment_id: "PF-TAMPER-2",
    payment_status: "COMPLETE",
    amount_gross: "100.00",
    merchant_id: "10000100"
  };
  wrongAmountItn.signature = payfast.generateSignature(wrongAmountItn, "mysecretpassphrase");

  const wrongAmountRes = await api("/api/payments/notify", { method: "POST", form: wrongAmountItn });
  assert.equal(wrongAmountRes.response.status, 400);

  // Invoice still remains unpaid
  const check2 = await api(`/api/public/invoices/${invoice.public_token}`);
  assert.equal(check2.data.invoice.status, "sent");
}));

test("payments: ITN rejects wrong merchant_id or unknown m_payment_id", () => withServer(async (api) => {
  const { invoice } = await setupMerchant(api);

  const payRes = await api(`/api/public/invoices/${invoice.public_token}/pay`, { method: "POST" });
  const mPaymentId = payRes.data.m_payment_id;

  // Wrong merchant_id
  const wrongMerchantItn = {
    m_payment_id: mPaymentId,
    pf_payment_id: "PF-TAMPER-3",
    payment_status: "COMPLETE",
    amount_gross: "2500.00",
    merchant_id: "99999999"
  };
  wrongMerchantItn.signature = payfast.generateSignature(wrongMerchantItn, "mysecretpassphrase");
  const res1 = await api("/api/payments/notify", { method: "POST", form: wrongMerchantItn });
  assert.equal(res1.response.status, 400);

  // Unknown m_payment_id
  const unknownRefItn = {
    m_payment_id: "fake-uuid-000000000000",
    pf_payment_id: "PF-TAMPER-4",
    payment_status: "COMPLETE",
    amount_gross: "2500.00",
    merchant_id: "10000100"
  };
  unknownRefItn.signature = payfast.generateSignature(unknownRefItn, "mysecretpassphrase");
  const res2 = await api("/api/payments/notify", { method: "POST", form: unknownRefItn });
  assert.equal(res2.response.status, 400);
}));

test("payments: unconfigured business or non-ZAR invoice rejects payment initiation", () => withServer(async (api) => {
  // Register merchant WITHOUT PayFast credentials
  await api("/api/auth/register", {
    method: "POST",
    body: { name: "NoPayFast", email: "nopayfast@test.co.za", password: "password123", confirmPassword: "password123" }
  });

  const cust = (await api("/api/customers", { method: "POST", body: { name: "Customer X" } })).data.customer;
  const inv = (await api("/api/invoices", {
    method: "POST",
    body: { customerId: cust.id, issueDate: futureDate(0), dueDate: futureDate(30), status: "sent", items: [{ description: "Work", quantity: 1, unitPrice: 500, taxRate: 0 }] }
  })).data.invoice;

  // Initiation fails because merchant has no PayFast credentials
  const payRes = await api(`/api/public/invoices/${inv.public_token}/pay`, { method: "POST" });
  assert.equal(payRes.response.status, 400);
  assert.match(payRes.data.error?.message || "", /not configured/i);
}));

test("payments: ITN on cancelled invoice safely rejects and does not mark paid", () => withServer(async (api) => {
  const { invoice } = await setupMerchant(api);

  // Initiate payment while sent
  const payRes = await api(`/api/public/invoices/${invoice.public_token}/pay`, { method: "POST" });
  const mPaymentId = payRes.data.m_payment_id;

  // Merchant cancels invoice
  await api(`/api/invoices/${invoice.id}/cancel`, { method: "POST" });

  // ITN arrives later for cancelled invoice
  const itnData = {
    m_payment_id: mPaymentId,
    pf_payment_id: "PF-CANCEL-1",
    payment_status: "COMPLETE",
    amount_gross: "2500.00",
    merchant_id: "10000100"
  };
  itnData.signature = payfast.generateSignature(itnData, "mysecretpassphrase");

  const itnRes = await api("/api/payments/notify", { method: "POST", form: itnData });
  assert.equal(itnRes.response.status, 400);

  // Invoice must remain cancelled
  const check = await api(`/api/public/invoices/${invoice.public_token}`);
  assert.equal(check.data.invoice.status, "cancelled");
}));

test("payments: GET /api/invoices/:id/payments lists payments and requests", () => withServer(async (api) => {
  const { invoice } = await setupMerchant(api);

  const payRes = await api(`/api/public/invoices/${invoice.public_token}/pay`, { method: "POST" });
  const mPaymentId = payRes.data.m_payment_id;

  const itnData = {
    m_payment_id: mPaymentId,
    pf_payment_id: "PF-LIST-1",
    payment_status: "COMPLETE",
    amount_gross: "2500.00",
    merchant_id: "10000100"
  };
  itnData.signature = payfast.generateSignature(itnData, "mysecretpassphrase");
  await api("/api/payments/notify", { method: "POST", form: itnData });

  const listRes = await api(`/api/invoices/${invoice.id}/payments`);
  assert.equal(listRes.response.status, 200);
  assert.equal(listRes.data.payments.length, 1);
  assert.equal(listRes.data.payments[0].provider, "payfast");
  assert.equal(listRes.data.payments[0].amount_cents, 250000);
  assert.equal(listRes.data.paymentRequests.length, 1);
  assert.equal(listRes.data.paymentRequests[0].status, "completed");
}));

test("payments: dev simulation endpoint processes sandbox payment cleanly", () => withServer(async (api) => {
  const { invoice } = await setupMerchant(api);

  const payRes = await api(`/api/public/invoices/${invoice.public_token}/pay`, { method: "POST" });
  const mPaymentId = payRes.data.m_payment_id;

  const itnData = {
    m_payment_id: mPaymentId,
    pf_payment_id: "PF-SIM-999",
    payment_status: "COMPLETE",
    amount_gross: "2500.00",
    merchant_id: "10000100",
    custom_str1: invoice.public_token
  };
  itnData.signature = payfast.generateSignature(itnData, "mysecretpassphrase");

  // Call simulation endpoint with JSON payload
  const simRes = await api("/api/dev/simulate-itn", { method: "POST", body: itnData });
  assert.equal(simRes.response.status, 200);
  assert.equal(simRes.data.success, true);

  // Check invoice is marked paid
  const check = await api(`/api/public/invoices/${invoice.public_token}`);
  assert.equal(check.data.invoice.status, "paid");
}));
