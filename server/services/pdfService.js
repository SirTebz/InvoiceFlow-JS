const { formatMoney, basisPointsToPercent } = require("../utils/money");

async function generateInvoicePdf({ invoice, items, customer, business }) {
  const lines = [
    `${business.business_name || "Your Business"}`,
    [business.address, business.email, business.phone, business.website].filter(Boolean).join(" | "),
    "",
    `INVOICE ${invoice.invoice_number}`,
    `Issue: ${invoice.issue_date}    Due: ${invoice.due_date}`,
    "",
    "BILL TO",
    customer?.name || "Customer",
    customer?.billing_address || "",
    customer?.email || "",
    "",
    "Description                         Qty     Price       Tax     Total",
    ...items.map((item) => `${item.description.slice(0, 32).padEnd(36)} ${String(item.quantity).padStart(3)} ${formatMoney(item.unit_price_cents, invoice.currency).padStart(11)} ${`${basisPointsToPercent(item.tax_rate)}%`.padStart(7)} ${formatMoney(item.line_total_cents, invoice.currency).padStart(11)}`),
    "",
    `Subtotal: ${formatMoney(invoice.subtotal_cents, invoice.currency)}`,
    `Tax: ${formatMoney(invoice.tax_cents, invoice.currency)}`,
    `Discount: -${formatMoney(invoice.discount_cents, invoice.currency)}`,
    `TOTAL: ${formatMoney(invoice.total_cents, invoice.currency)}`,
    "",
    "Payment information",
    business.payment_details || "Payment details will appear here.",
    "",
    "Notes",
    invoice.notes || invoice.payment_terms || "Thank you for your business."
  ];
  return createSimplePdf(lines);
}

function pdfEscape(text) {
  return String(text).replace(/[\\()]/g, "\\$&").replace(/[^\x20-\x7E]/g, "?");
}

function createSimplePdf(lines) {
  const content = ["BT", "/F1 11 Tf", "50 790 Td"];
  lines.forEach((line, index) => {
    if (index) content.push("0 -17 Td");
    content.push(`(${pdfEscape(line)}) Tj`);
  });
  content.push("ET");
  const stream = content.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => { body += `${String(offset).padStart(10, "0")} 00000 n \n`; });
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(body, "utf8");
}

module.exports = { generateInvoicePdf };
