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
      headers: { "Content-Type": "application/json", Cookie: [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; "), ...(options.headers || {}) },
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
  try { await fn(api); } finally { await new Promise((resolve) => server.close(resolve)); closeDatabase(); }
}

async function register(api, email = "owner@example.com") {
  const result = await api("/api/auth/register", { method: "POST", body: { name: "Owner", email, password: "password123", confirmPassword: "password123" } });
  assert.equal(result.response.status, 200);
  return result.data.user;
}

async function createCustomer(api, name = "Acme Ltd") {
  const result = await api("/api/customers", { method: "POST", body: { name, email: "billing@acme.test", phone: "0123456789", billingAddress: "12 Market Street" } });
  assert.equal(result.response.status, 200);
  return result.data.customer;
}

async function createInvoice(api, customerId) {
  const result = await api("/api/invoices", { method: "POST", body: { customerId, issueDate: "2026-09-01", dueDate: "2026-10-01", discount: 500, notes: "Thank you", paymentTerms: "Payment due within 30 days.", items: [{ description: "Website Development", quantity: 1, unitPrice: 8000, taxRate: 15 }, { description: "Hosting", quantity: 2, unitPrice: 500, taxRate: 15 }] } });
  assert.equal(result.response.status, 200);
  return result.data.invoice;
}

test("register, login, logout, and invalid login behave correctly", () => withServer(async (api) => {
  await register(api);
  assert.equal((await api("/api/auth/logout", { method: "POST", body: {} })).response.status, 200);
  assert.equal((await api("/api/auth/login", { method: "POST", body: { email: "owner@example.com", password: "wrong-password" } })).response.status, 401);
  const login = await api("/api/auth/login", { method: "POST", body: { email: "owner@example.com", password: "password123" } });
  assert.equal(login.response.status, 200);
  assert.equal(login.data.user.email, "owner@example.com");
}));

test("customers can be created, updated, listed, and soft deleted", () => withServer(async (api) => {
  await register(api);
  const customer = await createCustomer(api);
  assert.equal(customer.name, "Acme Ltd");
  assert.equal((await api(`/api/customers/${customer.id}`, { method: "PUT", body: { name: "Acme Studio", email: "team@acme.test" } })).response.status, 200);
  const list = await api("/api/customers");
  assert.equal(list.data.customers[0].name, "Acme Studio");
  assert.equal((await api(`/api/customers/${customer.id}`, { method: "DELETE" })).response.status, 200);
  assert.equal((await api("/api/customers")).data.customers.length, 0);
}));

test("invoice totals are recalculated server-side and payment marks invoice paid", () => withServer(async (api) => {
  await register(api);
  const customer = await createCustomer(api);
  const invoice = await createInvoice(api, customer.id);
  assert.equal(invoice.subtotal_cents, 900000);
  assert.equal(invoice.tax_cents, 135000);
  assert.equal(invoice.discount_cents, 50000);
  assert.equal(invoice.total_cents, 985000);
  const paid = await api(`/api/invoices/${invoice.id}/mark-paid`, { method: "POST", body: { reference: "EFT" } });
  assert.equal(paid.response.status, 200);
  assert.equal(paid.data.invoice.status, "paid");
  assert.equal(paid.data.invoice.payments.length, 1);
}));

test("users cannot access another user's invoices", () => withServer(async (api) => {
  await register(api, "owner@example.com");
  const customer = await createCustomer(api);
  const invoice = await createInvoice(api, customer.id);
  await api("/api/auth/logout", { method: "POST", body: {} });
  await register(api, "other@example.com");
  assert.equal((await api(`/api/invoices/${invoice.id}`)).response.status, 404);
  assert.equal((await api(`/api/invoices/${invoice.id}/mark-paid`, { method: "POST", body: {} })).response.status, 404);
}));

test("recurring invoices support creation and pause", () => withServer(async (api) => {
  await register(api);
  const customer = await createCustomer(api);
  const created = await api("/api/recurring-invoices", { method: "POST", body: { title: "Monthly retainer", customerId: customer.id, frequency: "monthly", startDate: "2026-09-01", nextInvoiceDate: "2026-10-01" } });
  assert.equal(created.response.status, 200);
  assert.equal((await api(`/api/recurring-invoices/${created.data.recurringInvoice.id}`, { method: "PUT", body: { status: "paused" } })).response.status, 200);
  const list = await api("/api/recurring-invoices");
  assert.equal(list.data.recurringInvoices[0].status, "paused");
}));

test("pdf download and mock email send work for saved invoices", () => withServer(async (api) => {
  await register(api);
  const customer = await createCustomer(api);
  const invoice = await createInvoice(api, customer.id);
  const pdf = await fetch(`${api.base}/api/invoices/${invoice.id}/pdf`, { headers: { Cookie: api.cookieHeader() } });
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get("content-type"), "application/pdf");
  assert.ok((await pdf.arrayBuffer()).byteLength > 200);
  const sent = await api(`/api/invoices/${invoice.id}/send`, { method: "POST", body: { email: "billing@acme.test" } });
  assert.equal(sent.response.status, 200);
  assert.equal(sent.data.email.provider, "mock");
  assert.equal(sent.data.email.delivered, false);
}));

test("customer search and invoice status filtering return scoped results", () => withServer(async (api) => {
  await register(api);
  const acme = await createCustomer(api, "Acme Ltd");
  const beta = await api("/api/customers", { method: "POST", body: { name: "Beta Studio", email: "billing@beta.test", phone: "0123456789", billingAddress: "44 Beta Road" } });
  assert.equal(beta.response.status, 200);
  const invoice = await createInvoice(api, acme.id);
  await api(`/api/invoices/${invoice.id}/send`, { method: "POST", body: { email: "billing@acme.test" } });

  const customers = await api("/api/customers?search=Acme");
  assert.equal(customers.response.status, 200);
  assert.equal(customers.data.customers.length, 1);
  assert.equal(customers.data.customers[0].name, "Acme Ltd");

  const sentInvoices = await api("/api/invoices?status=sent&search=INV");
  assert.equal(sentInvoices.response.status, 200);
  assert.equal(sentInvoices.data.invoices.length, 1);
  assert.equal(sentInvoices.data.invoices[0].status, "sent");
}));
