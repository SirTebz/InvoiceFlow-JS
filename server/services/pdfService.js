const PDFDocument = require("pdfkit");
const { formatMoney, basisPointsToPercent } = require("../utils/money");

function generateInvoicePdf({ invoice, items, customer, business }) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: "A4", margin: 48 });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    const accent = business.accent_color || "#2563eb";
    doc.fillColor(accent).rect(48, 48, 499, 6).fill();
    doc.fillColor("#111827").fontSize(22).text(business.business_name || "Your Business", 48, 72);
    doc.fontSize(9).fillColor("#4b5563").text([business.address, business.email, business.phone, business.website].filter(Boolean).join(" | "), 48, 102, { width: 280 });

    doc.fillColor("#111827").fontSize(28).text("INVOICE", 390, 72, { align: "right" });
    doc.fontSize(11).fillColor("#374151").text(invoice.invoice_number, 390, 108, { align: "right" });
    doc.text(`Issue: ${invoice.issue_date}`, 390, 126, { align: "right" });
    doc.text(`Due: ${invoice.due_date}`, 390, 144, { align: "right" });

    doc.fontSize(10).fillColor("#6b7280").text("BILL TO", 48, 178);
    doc.fontSize(13).fillColor("#111827").text(customer?.name || "Customer", 48, 196);
    doc.fontSize(10).fillColor("#4b5563").text([customer?.billing_address, customer?.email, customer?.phone].filter(Boolean).join("\n"), 48, 216, { width: 230 });

    const tableTop = 290;
    doc.fillColor("#f3f4f6").rect(48, tableTop, 499, 28).fill();
    doc.fillColor("#111827").fontSize(9).text("Description", 58, tableTop + 9);
    doc.text("Qty", 300, tableTop + 9);
    doc.text("Price", 345, tableTop + 9);
    doc.text("Tax", 420, tableTop + 9);
    doc.text("Total", 490, tableTop + 9, { align: "right" });

    let y = tableTop + 42;
    items.forEach((item) => {
      doc.fillColor("#111827").fontSize(10).text(item.description, 58, y, { width: 220 });
      doc.text(String(item.quantity), 300, y);
      doc.text(formatMoney(item.unit_price_cents, invoice.currency), 345, y);
      doc.text(`${basisPointsToPercent(item.tax_rate)}%`, 420, y);
      doc.text(formatMoney(item.line_total_cents, invoice.currency), 462, y, { width: 85, align: "right" });
      y += 30;
    });

    y += 12;
    const totalX = 345;
    doc.moveTo(totalX, y).lineTo(547, y).strokeColor("#e5e7eb").stroke();
    y += 14;
    [
      ["Subtotal", invoice.subtotal_cents],
      ["Tax", invoice.tax_cents],
      ["Discount", -invoice.discount_cents]
    ].forEach(([label, cents]) => {
      doc.fillColor("#374151").fontSize(10).text(label, totalX, y);
      doc.text(formatMoney(cents, invoice.currency), 462, y, { width: 85, align: "right" });
      y += 20;
    });
    doc.fillColor(accent).fontSize(14).text("Total", totalX, y + 4);
    doc.text(formatMoney(invoice.total_cents, invoice.currency), 435, y + 4, { width: 112, align: "right" });

    const bottom = Math.max(y + 70, 610);
    doc.fillColor("#111827").fontSize(10).text("Payment information", 48, bottom);
    doc.fillColor("#4b5563").fontSize(9).text(business.payment_details || "Payment details will appear here.", 48, bottom + 18, { width: 230 });
    doc.fillColor("#111827").fontSize(10).text("Notes", 310, bottom);
    doc.fillColor("#4b5563").fontSize(9).text(invoice.notes || invoice.payment_terms || "Thank you for your business.", 310, bottom + 18, { width: 237 });
    doc.end();
  });
}

module.exports = { generateInvoicePdf };
