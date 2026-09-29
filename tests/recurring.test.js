const test = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("../server/app");
const { closeDatabase, getDb } = require("../server/database/db");
const { calculateNextInvoiceDate, getBillingPeriod, processDueRecurringInvoices } = require("../server/services/recurringService");
const config = require("../server/config");

async function withServer(fn) {
  closeDatabase();
  const server = createApp({ databaseUrl: ":memory:" });
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const jar = new Map();

  async function api(path, options = {}) {
    const headers = {
      Cookie: [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; "),
      ...(options.headers || {})
    };
    let bodyPayload;
    if (options.body != null) {
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

async function register(api, email = "owner@example.com") {
  const res = await api("/api/auth/register", {
    method: "POST",
    body: { name: "Business Owner", email, password: "password123", confirmPassword: "password123", businessName: "Apex Digital" }
  });
  assert.equal(res.response.status, 200);
  return res.data.user;
}

async function createCustomer(api, name = "Retainer Client") {
  const res = await api("/api/customers", {
    method: "POST",
    body: { name, email: "client@example.com", billingAddress: "123 Main Rd" }
  });
  return res.data.customer;
}

test("calculateNextInvoiceDate calculates weekly, monthly, and yearly intervals accurately", () => {
  // Weekly
  assert.equal(calculateNextInvoiceDate("2026-03-01", "weekly"), "2026-03-08");
  assert.equal(calculateNextInvoiceDate("2026-03-25", "weekly"), "2026-04-01");

  // Monthly normal
  assert.equal(calculateNextInvoiceDate("2026-03-15", "monthly"), "2026-04-15");
  // Monthly year rollover
  assert.equal(calculateNextInvoiceDate("2026-12-10", "monthly"), "2027-01-10");
  // Monthly month-end clamping (Jan 31 -> Feb 28 non-leap)
  assert.equal(calculateNextInvoiceDate("2026-01-31", "monthly"), "2026-02-28");
  // Monthly month-end clamping (Mar 31 -> Apr 30)
  assert.equal(calculateNextInvoiceDate("2026-03-31", "monthly"), "2026-04-30");

  // Yearly normal
  assert.equal(calculateNextInvoiceDate("2026-06-15", "yearly"), "2027-06-15");
  // Yearly leap day handling (2024-02-29 -> 2025-02-28)
  assert.equal(calculateNextInvoiceDate("2024-02-29", "yearly"), "2025-02-28");
});

test("recurring invoices: create, view detail with empty generations, and update schedule", () => withServer(async (api) => {
  await register(api);
  const customer = await createCustomer(api);

  // 1. Create recurring schedule
  const createRes = await api("/api/recurring-invoices", {
    method: "POST",
    body: {
      title: "Monthly SEO Retainer",
      customerId: customer.id,
      frequency: "monthly",
      startDate: "2026-01-01",
      nextInvoiceDate: "2026-02-01",
      endDate: "2026-12-31",
      items: [
        { description: "SEO Optimization", quantity: 1, unitPrice: 5000, taxRate: 15 }
      ]
    }
  });

  assert.equal(createRes.response.status, 200);
  const scheduleId = createRes.data.recurringInvoice.id;
  assert.equal(createRes.data.recurringInvoice.status, "active");

  // 2. GET detail endpoint
  const detailRes = await api(`/api/recurring-invoices/${scheduleId}`);
  assert.equal(detailRes.response.status, 200);
  assert.equal(detailRes.data.recurringInvoice.title, "Monthly SEO Retainer");
  assert.equal(detailRes.data.recurringInvoice.customer_name, "Retainer Client");
  assert.deepEqual(detailRes.data.recurringInvoice.generations, []);

  // 3. Edit schedule (e.g. title, end_date)
  const editRes = await api(`/api/recurring-invoices/${scheduleId}`, {
    method: "PUT",
    body: {
      title: "Monthly Premium SEO Retainer",
      endDate: "2027-01-01"
    }
  });
  assert.equal(editRes.response.status, 200);

  const updatedDetail = await api(`/api/recurring-invoices/${scheduleId}`);
  assert.equal(updatedDetail.data.recurringInvoice.title, "Monthly Premium SEO Retainer");
  assert.equal(updatedDetail.data.recurringInvoice.end_date, "2027-01-01");
}));

test("processDueRecurringInvoices creates invoices, advances schedule, and is strictly idempotent", () => withServer(async (api) => {
  await register(api);
  const customer = await createCustomer(api);
  const db = getDb();

  // Create active schedule due in the past
  const createRes = await api("/api/recurring-invoices", {
    method: "POST",
    body: {
      title: "Hosting & Maintenance",
      customerId: customer.id,
      frequency: "monthly",
      startDate: "2026-01-01",
      nextInvoiceDate: "2026-01-01", // Due!
      items: [
        { description: "Cloud Hosting", quantity: 1, unitPrice: 1500, taxRate: 15 }
      ]
    }
  });
  const scheduleId = createRes.data.recurringInvoice.id;

  // Initial invoice count
  const initialInvoices = await api("/api/invoices");
  assert.equal(initialInvoices.data.invoices.length, 0);

  // Process due invoices
  const run1 = await processDueRecurringInvoices(db);
  assert.equal(run1.processed, 1);
  assert.equal(run1.skipped, 0);
  assert.equal(run1.errors.length, 0);

  // Verify an invoice was created with correct data and token
  const afterRun1 = await api("/api/invoices");
  assert.equal(afterRun1.data.invoices.length, 1);
  const generatedInvoice = afterRun1.data.invoices[0];
  assert.equal(generatedInvoice.total_cents, 172500); // 1500 + 15% VAT = 1725.00 => 172500 cents
  assert.ok(generatedInvoice.public_token);
  assert.ok(generatedInvoice.invoice_number);

  // Verify schedule advanced its next_invoice_date
  const scheduleDetail = await api(`/api/recurring-invoices/${scheduleId}`);
  assert.equal(scheduleDetail.data.recurringInvoice.next_invoice_date, "2026-02-01");
  assert.equal(scheduleDetail.data.recurringInvoice.generations.length, 1);
  assert.equal(scheduleDetail.data.recurringInvoice.generations[0].invoice_id, generatedInvoice.id);

  // Idempotency: Running processDueRecurringInvoices again immediately should not create duplicate
  // Even if we manually set next_invoice_date back to 2026-01-01
  db.prepare("UPDATE recurring_invoices SET next_invoice_date='2026-01-01' WHERE id=?").run(scheduleId);

  const run2 = await processDueRecurringInvoices(db);
  assert.equal(run2.processed, 0);
  assert.equal(run2.skipped, 1); // Skipped because 2026-01-01 period was already recorded in recurring_invoice_generations!

  const afterRun2 = await api("/api/invoices");
  assert.equal(afterRun2.data.invoices.length, 1); // Still exactly 1 invoice!
}));

test("processDueRecurringInvoices marks schedule completed when next_invoice_date exceeds end_date", () => withServer(async (api) => {
  await register(api);
  const customer = await createCustomer(api);
  const db = getDb();

  const createRes = await api("/api/recurring-invoices", {
    method: "POST",
    body: {
      title: "One-Term Contract",
      customerId: customer.id,
      frequency: "monthly",
      startDate: "2026-01-01",
      nextInvoiceDate: "2026-01-01",
      endDate: "2026-01-15", // next calculation (2026-02-01) will exceed this!
      items: [{ description: "Consulting", quantity: 1, unitPrice: 2000 }]
    }
  });
  const scheduleId = createRes.data.recurringInvoice.id;

  const result = await processDueRecurringInvoices(db);
  assert.equal(result.processed, 1);

  const scheduleDetail = await api(`/api/recurring-invoices/${scheduleId}`);
  assert.equal(scheduleDetail.data.recurringInvoice.status, "completed");
}));

test("paused and cancelled recurring schedules are ignored during processing", () => withServer(async (api) => {
  await register(api);
  const customer = await createCustomer(api);
  const db = getDb();

  // Create paused schedule
  const pausedRes = await api("/api/recurring-invoices", {
    method: "POST",
    body: {
      title: "Paused Retainer",
      customerId: customer.id,
      frequency: "weekly",
      startDate: "2026-01-01",
      nextInvoiceDate: "2026-01-01",
      items: [{ description: "Dev work", quantity: 1, unitPrice: 1000 }]
    }
  });
  await api(`/api/recurring-invoices/${pausedRes.data.recurringInvoice.id}`, {
    method: "PUT",
    body: { status: "paused" }
  });

  // Create cancelled schedule
  const cancelledRes = await api("/api/recurring-invoices", {
    method: "POST",
    body: {
      title: "Cancelled Retainer",
      customerId: customer.id,
      frequency: "weekly",
      startDate: "2026-01-01",
      nextInvoiceDate: "2026-01-01",
      items: [{ description: "Dev work", quantity: 1, unitPrice: 1000 }]
    }
  });
  await api(`/api/recurring-invoices/${cancelledRes.data.recurringInvoice.id}`, {
    method: "DELETE"
  });

  const result = await processDueRecurringInvoices(db);
  assert.equal(result.processed, 0);

  const invoices = await api("/api/invoices");
  assert.equal(invoices.data.invoices.length, 0);
}));

test("internal recurring process endpoint is protected and requires correct X-Internal-Key", () => withServer(async (api) => {
  // 1. Missing key => 401
  const unauthRes = await api("/api/internal/recurring/process", {
    method: "POST"
  });
  assert.equal(unauthRes.response.status, 401);

  // 2. Wrong key => 401
  const wrongKeyRes = await api("/api/internal/recurring/process", {
    method: "POST",
    headers: { "X-Internal-Key": "wrong-secret-token" }
  });
  assert.equal(wrongKeyRes.response.status, 401);

  // 3. Valid key => 200 with result payload
  const validRes = await api("/api/internal/recurring/process", {
    method: "POST",
    headers: { "X-Internal-Key": config.internalKey }
  });
  assert.equal(validRes.response.status, 200);
  assert.equal(validRes.data.success, true);
  assert.equal(typeof validRes.data.processed, "number");
}));
