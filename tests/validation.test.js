const test = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("../server/app");
const { closeDatabase } = require("../server/database/db");
const { generateInvoicePdf } = require("../server/services/pdfService");

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
        Cookie: [...jar.entries()].map(([n, v]) => `${n}=${v}`).join("; "),
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
  try { await fn(api); } finally {
    await new Promise((resolve) => server.close(resolve));
    closeDatabase();
  }
}

/** Extract error text from any shape the server might return */
function errText(data) {
  if (!data) return "";
  if (typeof data.error === "string") return data.error;
  if (data.error && typeof data.error === "object") {
    const f = data.error.fields;
    if (f) return Object.values(f).join(" ");
    return data.error.message || "";
  }
  if (typeof data.fields === "object") return Object.values(data.fields).join(" ");
  if (typeof data.message === "string") return data.message;
  return "";
}

test("validation: rejects invalid registration, customer, and invoice payloads", () => withServer(async (api) => {
  // Passwords mismatch
  const mismatch = await api("/api/auth/register", {
    method: "POST",
    body: { name: "Test User", email: "user@example.com", password: "password123", confirmPassword: "password456" }
  });
  assert.equal(mismatch.response.status, 400, "mismatched passwords should be rejected");

  // Valid registration
  const reg = await api("/api/auth/register", {
    method: "POST",
    body: { name: "Valid User", email: "valid@example.com", password: "password123", confirmPassword: "password123" }
  });
  assert.equal(reg.response.status, 200, "valid registration should succeed");

  // Customer missing name
  const badCust = await api("/api/customers", {
    method: "POST",
    body: { name: "   ", email: "cust@example.com" }
  });
  assert.equal(badCust.response.status, 400, "blank customer name should be rejected");

  // Valid customer
  const custRes = await api("/api/customers", {
    method: "POST",
    body: { name: "Good Customer", email: "cust@example.com" }
  });
  assert.equal(custRes.response.status, 200, "valid customer should be created");
  const customerId = custRes.data.customer.id;

  // Invoice with no items
  const noItems = await api("/api/invoices", {
    method: "POST",
    body: { customerId, issueDate: "2026-09-01", dueDate: "2026-09-15", items: [] }
  });
  assert.equal(noItems.response.status, 400, "invoice with no items should be rejected");

  // Invoice with negative quantity
  const negItem = await api("/api/invoices", {
    method: "POST",
    body: {
      customerId,
      issueDate: "2026-09-01",
      dueDate: "2026-09-15",
      items: [{ description: "Item", quantity: -5, unitPrice: 100, taxRate: 15 }]
    }
  });
  assert.equal(negItem.response.status, 400, "negative quantity should be rejected");

  // Invoice with >100 items should be rejected
  const excessiveItems = Array.from({ length: 105 }, (_, i) => ({
    description: `Item ${i + 1}`,
    quantity: 1,
    unitPrice: 10,
    taxRate: 15
  }));
  const excessRes = await api("/api/invoices", {
    method: "POST",
    body: { customerId, issueDate: "2026-09-01", dueDate: "2026-09-15", items: excessiveItems }
  });
  assert.equal(excessRes.response.status, 400, "105-item invoice should be rejected");
  assert.match(errText(excessRes.data), /100 line items/i);

  // Invoice with exactly 50 items should succeed
  const fiftyItems = Array.from({ length: 50 }, (_, i) => ({
    description: `Service Tier ${i + 1}`,
    quantity: 1,
    unitPrice: 100,
    taxRate: 15
  }));
  const validFifty = await api("/api/invoices", {
    method: "POST",
    body: { customerId, issueDate: "2026-09-01", dueDate: "2026-09-15", discount: 50, notes: "Batch services", items: fiftyItems }
  });
  assert.equal(validFifty.response.status, 200, "50-item invoice should succeed");
  const inv = validFifty.data.invoice;
  assert.equal(inv.items.length, 50, "returned invoice should have 50 items");

  // PDF generation for 50-item invoice should produce a valid multi-page PDF
  const pdfBuf = await generateInvoicePdf({
    invoice: {
      invoice_number: inv.invoice_number,
      issue_date: inv.issue_date,
      due_date: inv.due_date,
      currency: "ZAR",
      subtotal_cents: inv.subtotal_cents,
      tax_cents: inv.tax_cents,
      discount_cents: inv.discount_cents,
      total_cents: inv.total_cents,
      status: inv.status,
      notes: inv.notes
    },
    items: inv.items.map((it) => ({
      description: it.description,
      quantity: it.quantity,
      unit_price_cents: it.unit_price_cents,
      tax_rate: it.tax_rate,
      line_total_cents: it.line_total_cents
    })),
    customer: { name: "Good Customer", email: "cust@example.com" },
    business: { business_name: "Test Business", invoice_template: "clean", accent_color: "#2563eb" }
  });
  assert.ok(Buffer.isBuffer(pdfBuf), "PDF output should be a Buffer");
  assert.ok(pdfBuf.length > 1000, "PDF buffer should be non-trivially sized");
  const pdfText = pdfBuf.toString("utf8");
  assert.ok(pdfText.startsWith("%PDF-"), "PDF should start with %PDF- header");
  assert.ok(pdfText.includes("%%EOF"), "PDF should end with %%EOF");
}));

test("security: /api/dev/emails returns list when mock email provider is active", () => withServer(async (api) => {
  const result = await api("/api/dev/emails");
  // In test mode the app uses the mock provider, so this should return 200
  assert.equal(result.response.status, 200);
  assert.ok(Array.isArray(result.data.emails));
}));
