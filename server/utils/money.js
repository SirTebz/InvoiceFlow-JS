function toCents(value) {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") {
    if (Number.isNaN(value) || !Number.isFinite(value)) return 0;
    return Math.round(value * 100);
  }
  const normalized = String(value).replace(/[^\d.-]/g, "");
  if (!normalized || Number.isNaN(Number(normalized))) return 0;
  return Math.round(Number(normalized) * 100);
}

function fromCents(cents) {
  return Number((Number(cents || 0) / 100).toFixed(2));
}

function formatMoney(cents, currency = "ZAR") {
  const amount = (Number(cents) || 0) / 100;
  const curr = String(currency || "ZAR").toUpperCase();
  try {
    const localeMap = {
      ZAR: "en-ZA",
      USD: "en-US",
      EUR: "de-DE",
      GBP: "en-GB"
    };
    const locale = localeMap[curr] || "en-ZA";
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: curr,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  } catch (_err) {
    return `${curr} ${amount.toFixed(2)}`;
  }
}

function percentToBasisPoints(value) {
  return Math.max(0, Math.round(Number(value || 0) * 100));
}

function basisPointsToPercent(value) {
  return Number((Number(value || 0) / 100).toFixed(2));
}

function calculateInvoiceTotals(items = [], discountCents = 0) {
  let subtotalCents = 0;
  let taxCents = 0;

  const normalizedItems = (Array.isArray(items) ? items : []).map((item, index) => {
    const quantity = Math.max(1, Math.round(Number(item.quantity || 1)));
    const unitPriceCents = Math.max(0, toCents(item.unitPrice ?? item.unit_price ?? item.unit_price_cents / 100));
    const taxRate = Math.max(0, Math.round(Number(item.taxRateBasisPoints ?? item.tax_rate ?? percentToBasisPoints(item.taxRate || 0))));
    
    const lineSubtotalCents = quantity * unitPriceCents;
    const lineTaxCents = Math.round((lineSubtotalCents * taxRate) / 10000);
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

  const rawDiscount = Math.max(0, Math.round(Number(discountCents || 0)));
  const safeDiscountCents = Math.min(rawDiscount, subtotalCents + taxCents);
  const totalCents = Math.max(0, subtotalCents + taxCents - safeDiscountCents);

  return {
    items: normalizedItems,
    subtotalCents,
    taxCents,
    discountCents: safeDiscountCents,
    totalCents
  };
}

module.exports = {
  toCents,
  fromCents,
  formatMoney,
  percentToBasisPoints,
  basisPointsToPercent,
  calculateInvoiceTotals
};
