function toCents(value) {
  if (typeof value === "number") return Math.round(value * 100);
  const normalized = String(value || "0").replace(/[^\d.-]/g, "");
  if (!normalized || Number.isNaN(Number(normalized))) return 0;
  return Math.round(Number(normalized) * 100);
}

function fromCents(cents) {
  return Number((Number(cents || 0) / 100).toFixed(2));
}

function formatMoney(cents, currency = "ZAR") {
  return new Intl.NumberFormat("en-ZA", { style: "currency", currency }).format((cents || 0) / 100);
}

function percentToBasisPoints(value) {
  return Math.round(Number(value || 0) * 100);
}

function basisPointsToPercent(value) {
  return Number((Number(value || 0) / 100).toFixed(2));
}

function calculateInvoiceTotals(items, discountCents = 0) {
  let subtotalCents = 0;
  let taxCents = 0;
  const normalizedItems = items.map((item, index) => {
    const quantity = Math.max(1, Math.round(Number(item.quantity || 1)));
    const unitPriceCents = Math.max(0, toCents(item.unitPrice ?? item.unit_price ?? item.unit_price_cents / 100));
    const taxRate = Math.max(0, Math.round(Number(item.taxRateBasisPoints ?? item.tax_rate ?? percentToBasisPoints(item.taxRate || 0))));
    const lineSubtotalCents = quantity * unitPriceCents;
    const lineTaxCents = Math.round(lineSubtotalCents * taxRate / 10000);
    const lineTotalCents = lineSubtotalCents + lineTaxCents;
    subtotalCents += lineSubtotalCents;
    taxCents += lineTaxCents;
    return {
      description: String(item.description || "").trim(),
      quantity,
      unitPriceCents,
      taxRate,
      lineSubtotalCents,
      lineTaxCents,
      lineTotalCents,
      position: index
    };
  });
  const safeDiscountCents = Math.min(Math.max(0, discountCents), subtotalCents + taxCents);
  return {
    items: normalizedItems,
    subtotalCents,
    taxCents,
    discountCents: safeDiscountCents,
    totalCents: subtotalCents + taxCents - safeDiscountCents
  };
}

module.exports = { toCents, fromCents, formatMoney, percentToBasisPoints, basisPointsToPercent, calculateInvoiceTotals };
