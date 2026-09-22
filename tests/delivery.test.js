const test = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("../server/app");
const { closeDatabase } = require("../server/database/db");

async function withServer(fn) {
  closeDatabase();
  const server = createApp({ databaseUrl: ":memory:" });
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const jar = new Map();

  async function api(path, options = {}) {
    const response = await fetch(`${base}${path}`, {
      method: options.method || "GET",
      headers: {
        "Content-Type": "application/json",
        Cookie: [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; "),
        ...(options.headers || {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) {
      const [name, value] = setCookie.split(";")[0].split("=");
      if (value) jar.set(name, value);
      else jar.delete(name);
    }
    const data = await response.json().catch(() => null);
    return { response, data };
  }
  api.base = base;
  api.cookieHeader = () => [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");

  try {
    await fn(api);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    closeDatabase();
  }
}

async function register(api, email = "owner@example.com") {
  const result = await api("/api/auth/register", {
    method: "POST",
    body: { name: "Owner", email, password: "password123", confirmPassword: "password123" }
  });
  assert.equal(result.response.status, 200);
  return result.data.user;
}

async function createCustomer(api, name = "Acme Corp") {
  const result = await api("/api/customers", {
    method: "POST",
    body: { name, email: "client@acme.test", phone: "+2711000000", billingAddress: "100 Long St" }
  });
  assert.equal(result.response.status, 200);
  return result.data.customer;
}

async function createInvoice(api, customerId) {
  const result = await api("/api/invoices", {
    method: "POST",
    body: {
      customerId,
      issueDate: "2026-09-01",
      dueDate: "2026-10-01",
      discount: 200,
      notes: "Thanks!",
      paymentTerms: "Net 30",
      items: [
        { description: "Logo Design", quantity: 1, unitPrice: 4000, taxRate: 15 },
        { description: "Brand Guidelines", quantity: 1, unitPrice: 2000, taxRate: 15 }
      ]
    }
  });
  assert.equal(result.response.status, 200);
  return result.data.invoice;
}

test("public invoice token generation and unauthenticated public view", () => withServer(async (api) => {
  await register(api);
  const customer = await createCustomer(api);
  const invoice = await createInvoice(api, customer.id);

  // Retrieve public link
  const linkRes = await api(`/api/invoices/${invoice.id}/public-link`);
  assert.equal(linkRes.response.status, 200);
  assert.ok(linkRes.data.publicToken);
  assert.ok(linkRes.data.publicUrl.includes(linkRes.data.publicToken));

  const token = linkRes.data.publicToken;

  // Unauthenticated fetch of public invoice
  const unauthRes = await fetch(`${api.base}/api/public/invoices/${token}`);
  assert.equal(unauthRes.status, 200);
  const pubData = await unauthRes.json();
  
  assert.equal(pubData.invoice.invoice_number, invoice.invoice_number);
  assert.equal(pubData.customer.name, "Acme Corp");
  assert.equal(pubData.invoice.items.length, 2);
  assert.equal(pubData.invoice.total_cents, invoice.total_cents);
  assert.ok(pubData.business.business_name);
  
  // Verify sensitive user data is NOT leaked
  assert.equal(pubData.user, undefined);
  assert.equal(pubData.invoice.user_id, undefined);
}));

test("public invoice view increments view count and records timestamps", () => withServer(async (api) => {
  await register(api);
  const customer = await createCustomer(api);
  const invoice = await createInvoice(api, customer.id);
  const linkRes = await api(`/api/invoices/${invoice.id}/public-link`);
  const token = linkRes.data.publicToken;

  // Access public link twice
  await fetch(`${api.base}/api/public/invoices/${token}`);
  await fetch(`${api.base}/api/public/invoices/${token}`);

  // Check internal invoice detail
  const internalRes = await api(`/api/invoices/${invoice.id}`);
  assert.equal(internalRes.response.status, 200);
  assert.equal(internalRes.data.invoice.view_count, 2);
  assert.ok(internalRes.data.invoice.first_viewed_at);
  assert.ok(internalRes.data.invoice.last_viewed_at);
}));

test("invalid, random, or short tokens return 404", () => withServer(async (api) => {
  const bad1 = await fetch(`${api.base}/api/public/invoices/invalid`);
  assert.equal(bad1.status, 404);

  const bad2 = await fetch(`${api.base}/api/public/invoices/randomtoken1234567890abcdef`);
  assert.equal(bad2.status, 404);
}));

test("public PDF download works without session", () => withServer(async (api) => {
  await register(api);
  const customer = await createCustomer(api);
  const invoice = await createInvoice(api, customer.id);
  const linkRes = await api(`/api/invoices/${invoice.id}/public-link`);
  const token = linkRes.data.publicToken;

  const pdfRes = await fetch(`${api.base}/api/public/invoices/${token}/pdf`);
  assert.equal(pdfRes.status, 200);
  assert.equal(pdfRes.headers.get("content-type"), "application/pdf");
  const buf = await pdfRes.arrayBuffer();
  assert.ok(buf.byteLength > 200);
}));

test("send invoice email updates delivery status and logs delivery", () => withServer(async (api) => {
  await register(api);
  const customer = await createCustomer(api);
  const invoice = await createInvoice(api, customer.id);

  // Send invoice
  const sendRes = await api(`/api/invoices/${invoice.id}/send`, {
    method: "POST",
    body: { email: "billing@acme.test" }
  });
  assert.equal(sendRes.response.status, 200);
  assert.equal(sendRes.data.invoice.status, "sent");
  assert.equal(sendRes.data.invoice.delivery_status, "sent");

  // Check delivery history
  const historyRes = await api(`/api/invoices/${invoice.id}/deliveries`);
  assert.equal(historyRes.response.status, 200);
  assert.equal(historyRes.data.deliveries.length, 1);
  assert.equal(historyRes.data.deliveries[0].recipient_email, "billing@acme.test");
  assert.equal(historyRes.data.deliveries[0].status, "sent");

  // Check dev emails inspection
  const devRes = await api("/api/dev/emails");
  assert.equal(devRes.response.status, 200);
  assert.ok(devRes.data.emails.length >= 1);
  assert.equal(devRes.data.emails[0].to, "billing@acme.test");
  assert.ok(devRes.data.emails[0].htmlBody.includes("Invoice"));
  assert.ok(devRes.data.emails[0].textBody.includes("Invoice"));
}));
