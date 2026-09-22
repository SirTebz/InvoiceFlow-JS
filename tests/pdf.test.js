const test = require("node:test");
const assert = require("node:assert/strict");
const { generateInvoicePdf } = require("../server/services/pdfService");

test("generateInvoicePdf generates valid single page PDF buffer with template & branding", async () => {
  const invoice = {
    invoice_number: "INV-0001",
    issue_date: "2026-09-20",
    due_date: "2026-10-20",
    currency: "ZAR",
    subtotal_cents: 600000,
    tax_cents: 90000,
    discount_cents: 30000,
    total_cents: 660000,
    status: "sent",
    notes: "Thanks for your business",
    payment_terms: "Due in 30 days"
  };

  const items = [
    { description: "Website Design", quantity: 1, unit_price_cents: 500000, tax_rate: 1500, line_total_cents: 575000 },
    { description: "Hosting Setup", quantity: 2, unit_price_cents: 50000, tax_rate: 1500, line_total_cents: 115000 }
  ];

  const customer = {
    name: "Acme Digital",
    email: "billing@acme.test",
    billing_address: "123 Innovation Way, Cape Town"
  };

  const business = {
    business_name: "Teboho Studio",
    email: "teboho@studio.test",
    phone: "+27 11 123 4567",
    address: "45 Long Street, Cape Town",
    tax_number: "VAT987654",
    payment_details: "Bank: First National\nAcc: 1234567890",
    invoice_template: "clean",
    accent_color: "#2563eb"
  };

  const pdfBuf = await generateInvoicePdf({ invoice, items, customer, business });
  assert.ok(Buffer.isBuffer(pdfBuf));
  assert.ok(pdfBuf.length > 500);

  const pdfText = pdfBuf.toString("utf8");
  assert.ok(pdfText.startsWith("%PDF-1.4"));
  assert.ok(pdfText.includes("%%EOF"));
  assert.ok(pdfText.includes("/Type /Catalog"));
  assert.ok(pdfText.includes("INV-0001"));
  assert.ok(pdfText.includes("Teboho Studio"));
});

test("generateInvoicePdf handles multi-page pagination for invoices with many line items", async () => {
  const invoice = {
    invoice_number: "INV-9999",
    issue_date: "2026-09-20",
    due_date: "2026-10-20",
    currency: "ZAR",
    subtotal_cents: 2500000,
    tax_cents: 375000,
    discount_cents: 0,
    total_cents: 2875000,
    status: "draft"
  };

  // 25 line items (forces page 1 + page 2)
  const items = Array.from({ length: 25 }, (_, i) => ({
    description: `Service Item #${i + 1} Detailed Description`,
    quantity: 1,
    unit_price_cents: 100000,
    tax_rate: 1500,
    line_total_cents: 115000
  }));

  const customer = { name: "Mega Corp", email: "procurement@mega.test" };
  const business = { business_name: "Teboho Studio", invoice_template: "professional", accent_color: "#059669" };

  const pdfBuf = await generateInvoicePdf({ invoice, items, customer, business });
  assert.ok(Buffer.isBuffer(pdfBuf));
  const pdfText = pdfBuf.toString("utf8");

  // Verify multiple pages in page tree
  assert.ok(pdfText.includes("/Count 2"));
  assert.ok(pdfText.includes("Page 1 of 2") || pdfText.includes("Page 2 of 2"));
});
