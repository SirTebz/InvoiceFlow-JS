const test = require("node:test");
const assert = require("node:assert/strict");
const { toCents, fromCents, formatMoney, calculateInvoiceTotals, percentToBasisPoints, basisPointsToPercent } = require("../server/utils/money");

test("toCents and fromCents handle currency precision accurately", () => {
  assert.equal(toCents(100), 10000);
  assert.equal(toCents("100.50"), 10050);
  assert.equal(toCents(99.99), 9999);
  assert.equal(toCents("R 5,000.00"), 500000);
  assert.equal(toCents(0), 0);
  assert.equal(toCents(null), 0);

  assert.equal(fromCents(10050), 100.50);
  assert.equal(fromCents(9999), 99.99);
  assert.equal(fromCents(0), 0);
});

test("formatMoney formats ZAR and other currencies properly", () => {
  const formattedZar = formatMoney(500000, "ZAR");
  assert.ok(formattedZar.includes("5") && formattedZar.includes("000"));
  
  const formattedUsd = formatMoney(125050, "USD");
  assert.ok(formattedUsd.includes("1,250.50") || formattedUsd.includes("$"));
});

test("basisPoints conversion functions", () => {
  assert.equal(percentToBasisPoints(15), 1500);
  assert.equal(percentToBasisPoints("15.5"), 1550);
  assert.equal(basisPointsToPercent(1500), 15);
  assert.equal(basisPointsToPercent(1550), 15.5);
});

test("calculateInvoiceTotals - Phase 2 section 9 benchmark calculation", () => {
  // Website Development: Qty 1, Unit Price R5,000, Tax 15%
  // Hosting: Qty 2, Unit Price R500, Tax 15%
  // Discount: R300
  const items = [
    { description: "Website Development", quantity: 1, unitPrice: 5000, taxRate: 15 },
    { description: "Hosting", quantity: 2, unitPrice: 500, taxRate: 15 }
  ];
  const discountCents = 30000; // R300

  const totals = calculateInvoiceTotals(items, discountCents);
  
  // Subtotal = R6,000 (600,000 cents)
  assert.equal(totals.subtotalCents, 600000);
  // Tax = R900 (90,000 cents)
  assert.equal(totals.taxCents, 90000);
  // Discount = R300 (30,000 cents)
  assert.equal(totals.discountCents, 30000);
  // Total = Subtotal + Tax - Discount = R6,600 (660,000 cents)
  assert.equal(totals.totalCents, 660000);
});

test("calculateInvoiceTotals - edge cases: 0 tax, large discount, decimals", () => {
  // 1 item with 0% tax
  const single = calculateInvoiceTotals([{ description: "Consulting", quantity: 2, unitPrice: 100.25, taxRate: 0 }], 0);
  assert.equal(single.subtotalCents, 20050);
  assert.equal(single.taxCents, 0);
  assert.equal(totalsCentsSafe(single), 20050);

  // Discount exceeding subtotal + tax is clamped safely
  const overDiscount = calculateInvoiceTotals([{ description: "Work", quantity: 1, unitPrice: 100, taxRate: 0 }], 50000);
  assert.equal(overDiscount.subtotalCents, 10000);
  assert.equal(overDiscount.discountCents, 10000);
  assert.equal(overDiscount.totalCents, 0);
});

function totalsCentsSafe(res) {
  return res.totalCents;
}
