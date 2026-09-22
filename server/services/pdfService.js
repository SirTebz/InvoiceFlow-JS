const { formatMoney, basisPointsToPercent } = require("../utils/money");

function pdfMoney(cents, currency) {
  return formatMoney(cents, currency).replace(/[\u00a0\u202f]/g, " ");
}

function pdfEscape(text) {
  return String(text || "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, " ");
}

function hexToRgb(hex = "#2563eb") {
  const clean = hex.replace("#", "");
  const num = parseInt(clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean, 16);
  if (Number.isNaN(num)) return [0.15, 0.39, 0.92];
  const r = ((num >> 16) & 255) / 255;
  const g = ((num >> 8) & 255) / 255;
  const b = (num & 255) / 255;
  return [Number(r.toFixed(3)), Number(g.toFixed(3)), Number(b.toFixed(3))];
}

async function generateInvoicePdf({ invoice, items = [], customer = {}, business = {} }) {
  const template = business.invoice_template || "clean";
  const [ar, ag, ab] = hexToRgb(business.accent_color || "#2563eb");
  const currency = invoice.currency || "ZAR";

  const PAGE_WIDTH = 595;
  const PAGE_HEIGHT = 842;
  const MARGIN_LEFT = 45;
  const MARGIN_RIGHT = 45;
  const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;

  // Smart pagination
  const itemPages = [];
  if (items.length <= 9) {
    itemPages.push(items);
  } else {
    itemPages.push(items.slice(0, 12));
    let remaining = items.slice(12);
    while (remaining.length > 0) {
      if (remaining.length <= 14) {
        itemPages.push(remaining);
        break;
      } else {
        itemPages.push(remaining.slice(0, 20));
        remaining = remaining.slice(20);
      }
    }
  }

  const totalPages = itemPages.length;
  const pageStreams = [];

  for (let pageIdx = 0; pageIdx < totalPages; pageIdx++) {
    const isFirstPage = pageIdx === 0;
    const isLastPage = pageIdx === totalPages - 1;
    const pageItems = itemPages[pageIdx];

    const commands = [];

    // Helper draw functions
    const text = (str, x, y, size = 10, font = "/F1", color = [0.1, 0.1, 0.1]) => {
      commands.push(
        "BT",
        `${font} ${size} Tf`,
        `${color[0]} ${color[1]} ${color[2]} rg`,
        `1 0 0 1 ${x} ${y} Tm`,
        `(${pdfEscape(str)}) Tj`,
        "ET"
      );
    };

    const rightText = (str, rightX, y, size = 10, font = "/F1", color = [0.1, 0.1, 0.1]) => {
      const strLen = String(str).length;
      const estWidth = strLen * (size * 0.52);
      const startX = Math.max(MARGIN_LEFT, rightX - estWidth);
      text(str, startX, y, size, font, color);
    };

    const rect = (x, y, w, h, fillColor, strokeColor, lineWidth = 1) => {
      if (fillColor) {
        commands.push(`${fillColor[0]} ${fillColor[1]} ${fillColor[2]} rg`, `${x} ${y} ${w} ${h} re`, "f");
      }
      if (strokeColor) {
        commands.push(`${strokeColor[0]} ${strokeColor[1]} ${strokeColor[2]} RG`, `${lineWidth} w`, `${x} ${y} ${w} ${h} re`, "S");
      }
    };

    const line = (x1, y1, x2, y2, color = [0.85, 0.85, 0.85], width = 1) => {
      commands.push(`${color[0]} ${color[1]} ${color[2]} RG`, `${width} w`, `${x1} ${y1} m`, `${x2} ${y2} l`, "S");
    };

    let curY = 790;

    // Header rendering (First page vs Sub-pages)
    if (isFirstPage) {
      // Top accent bar
      if (template === "professional") {
        rect(MARGIN_LEFT, curY + 12, CONTENT_WIDTH, 6, [ar, ag, ab]);
      } else if (template === "clean") {
        rect(MARGIN_LEFT, curY + 14, 50, 4, [ar, ag, ab]);
      }

      // Business Branding / Header
      const bizName = (business.business_name || "InvoiceFlow Business").slice(0, 36);
      text(bizName, MARGIN_LEFT, curY - 5, 18, "/F2", [0.08, 0.1, 0.15]);
      
      let bizY = curY - 22;
      const bizDetails = [
        business.address ? business.address.slice(0, 45) : null,
        [business.email, business.phone].filter(Boolean).join(" • ").slice(0, 45),
        business.website ? `Website: ${business.website.slice(0, 35)}` : null,
        business.tax_number ? `Tax/VAT: ${business.tax_number.slice(0, 25)}` : null
      ].filter(Boolean);

      bizDetails.forEach((lineText) => {
        text(lineText, MARGIN_LEFT, bizY, 9, "/F1", [0.4, 0.45, 0.5]);
        bizY -= 13;
      });

      // Invoice Title & Metadata (Top Right)
      const invTitle = "INVOICE";
      rightText(invTitle, PAGE_WIDTH - MARGIN_RIGHT, curY - 5, 20, "/F2", [ar, ag, ab]);
      rightText(invoice.invoice_number || "INV-0001", PAGE_WIDTH - MARGIN_RIGHT, curY - 24, 12, "/F2", [0.1, 0.1, 0.1]);

      let metaY = curY - 42;
      rightText(`Issue Date: ${invoice.issue_date || ""}`, PAGE_WIDTH - MARGIN_RIGHT, metaY, 9, "/F1", [0.35, 0.4, 0.45]);
      metaY -= 13;
      rightText(`Due Date: ${invoice.due_date || ""}`, PAGE_WIDTH - MARGIN_RIGHT, metaY, 9, "/F1", [0.35, 0.4, 0.45]);
      metaY -= 13;
      const statusLabel = `Status: ${(invoice.status || "draft").toUpperCase()}`;
      rightText(statusLabel, PAGE_WIDTH - MARGIN_RIGHT, metaY, 9, "/F2", invoice.status === "paid" ? [0.05, 0.55, 0.25] : [ar, ag, ab]);

      // Divider line
      curY = 675;
      line(MARGIN_LEFT, curY, PAGE_WIDTH - MARGIN_RIGHT, curY, [0.88, 0.9, 0.93], 1);

      // Bill To & Payment Info Header
      curY -= 20;
      text("BILL TO", MARGIN_LEFT, curY, 9, "/F2", [ar, ag, ab]);
      
      let custY = curY - 14;
      const custName = (customer.name || "Valued Customer").slice(0, 40);
      text(custName, MARGIN_LEFT, custY, 11, "/F2", [0.1, 0.1, 0.1]);
      custY -= 14;
      if (customer.billing_address) {
        text(customer.billing_address.slice(0, 48), MARGIN_LEFT, custY, 9, "/F1", [0.35, 0.4, 0.45]);
        custY -= 13;
      }
      if (customer.email) {
        text(customer.email.slice(0, 48), MARGIN_LEFT, custY, 9, "/F1", [0.35, 0.4, 0.45]);
        custY -= 13;
      }
      if (customer.phone) {
        text(customer.phone.slice(0, 30), MARGIN_LEFT, custY, 9, "/F1", [0.35, 0.4, 0.45]);
        custY -= 13;
      }

      curY = Math.min(custY - 10, 595);
    } else {
      // Sub-page compact header
      text(`${(business.business_name || "Invoice").slice(0, 30)} — ${invoice.invoice_number}`, MARGIN_LEFT, curY, 10, "/F2", [0.3, 0.3, 0.3]);
      rightText(`Page ${pageIdx + 1} of ${totalPages}`, PAGE_WIDTH - MARGIN_RIGHT, curY, 9, "/F1", [0.5, 0.5, 0.5]);
      curY -= 10;
      line(MARGIN_LEFT, curY, PAGE_WIDTH - MARGIN_RIGHT, curY, [0.88, 0.9, 0.93], 1);
      curY -= 25;
    }

    // Line Items Table Header
    const colDescX = MARGIN_LEFT + 8;
    const colQtyX = MARGIN_LEFT + 260;
    const colRateX = MARGIN_LEFT + 320;
    const colTaxX = MARGIN_LEFT + 395;
    const colTotalX = PAGE_WIDTH - MARGIN_RIGHT - 8;

    if (template === "professional") {
      rect(MARGIN_LEFT, curY - 6, CONTENT_WIDTH, 22, [0.94, 0.96, 0.98], [0.85, 0.88, 0.92], 1);
    } else {
      rect(MARGIN_LEFT, curY - 6, CONTENT_WIDTH, 22, [0.97, 0.98, 0.99]);
      line(MARGIN_LEFT, curY - 6, PAGE_WIDTH - MARGIN_RIGHT, curY - 6, [0.85, 0.88, 0.92], 1);
    }

    text("DESCRIPTION", colDescX, curY, 8, "/F2", [0.3, 0.35, 0.4]);
    text("QTY", colQtyX, curY, 8, "/F2", [0.3, 0.35, 0.4]);
    text("RATE", colRateX, curY, 8, "/F2", [0.3, 0.35, 0.4]);
    text("TAX", colTaxX, curY, 8, "/F2", [0.3, 0.35, 0.4]);
    rightText("AMOUNT", colTotalX, curY, 8, "/F2", [0.3, 0.35, 0.4]);

    curY -= 24;

    // Line Items Rows
    pageItems.forEach((item, itemIdx) => {
      const isAlt = itemIdx % 2 === 1 && template === "professional";
      if (isAlt) {
        rect(MARGIN_LEFT, curY - 5, CONTENT_WIDTH, 20, [0.98, 0.98, 0.99]);
      }

      const rawDesc = String(item.description || "Item");
      const desc = rawDesc.length > 44 ? `${rawDesc.slice(0, 41)}...` : rawDesc;
      text(desc, colDescX, curY, 9, "/F1", [0.15, 0.15, 0.15]);
      text(String(item.quantity || 1), colQtyX, curY, 9, "/F1", [0.2, 0.2, 0.2]);
      text(pdfMoney(item.unit_price_cents, currency), colRateX, curY, 9, "/F1", [0.2, 0.2, 0.2]);
      text(`${basisPointsToPercent(item.tax_rate)}%`, colTaxX, curY, 9, "/F1", [0.35, 0.35, 0.35]);
      rightText(pdfMoney(item.line_total_cents, currency), colTotalX, curY, 9, "/F2", [0.1, 0.1, 0.1]);

      curY -= 18;
      line(MARGIN_LEFT, curY + 11, PAGE_WIDTH - MARGIN_RIGHT, curY + 11, [0.93, 0.94, 0.96], 0.5);
    });

    // Totals & Footer on Last Page
    if (isLastPage) {
      curY -= 15;
      const totalsBoxWidth = 220;
      const totalsLeftX = PAGE_WIDTH - MARGIN_RIGHT - totalsBoxWidth;

      // Summary lines
      const drawTotalRow = (label, valStr, isGrand = false) => {
        text(label, totalsLeftX, curY, isGrand ? 11 : 9, isGrand ? "/F2" : "/F1", isGrand ? [0.08, 0.1, 0.15] : [0.4, 0.45, 0.5]);
        rightText(valStr, PAGE_WIDTH - MARGIN_RIGHT - 8, curY, isGrand ? 12 : 9, isGrand ? "/F2" : "/F1", isGrand ? [ar, ag, ab] : [0.1, 0.1, 0.1]);
        curY -= isGrand ? 22 : 16;
      };

      drawTotalRow("Subtotal", pdfMoney(invoice.subtotal_cents, currency));
      drawTotalRow("Tax Total", pdfMoney(invoice.tax_cents, currency));
      if (invoice.discount_cents > 0) {
        drawTotalRow("Discount", `-${pdfMoney(invoice.discount_cents, currency)}`);
      }
      
      line(totalsLeftX, curY + 10, PAGE_WIDTH - MARGIN_RIGHT, curY + 10, [0.8, 0.84, 0.9], 1.5);
      curY -= 4;
      drawTotalRow("Total Due", pdfMoney(invoice.total_cents, currency), true);

      // Payment & Notes Block
      let notesY = 160;
      if (business.payment_details) {
        text("PAYMENT INSTRUCTIONS", MARGIN_LEFT, notesY, 8, "/F2", [ar, ag, ab]);
        notesY -= 13;
        const payLines = business.payment_details.split("\n").slice(0, 3);
        payLines.forEach((pLine) => {
          text(pLine.trim().slice(0, 50), MARGIN_LEFT, notesY, 8, "/F1", [0.35, 0.4, 0.45]);
          notesY -= 11;
        });
      }

      if (invoice.notes || invoice.payment_terms) {
        notesY -= 6;
        text("TERMS & NOTES", MARGIN_LEFT, notesY, 8, "/F2", [0.3, 0.35, 0.4]);
        notesY -= 13;
        const noteText = [invoice.payment_terms, invoice.notes].filter(Boolean).join(" — ");
        text(noteText.slice(0, 95), MARGIN_LEFT, notesY, 8, "/F1", [0.4, 0.45, 0.5]);
      }
    }

    // Page Footer
    line(MARGIN_LEFT, 50, PAGE_WIDTH - MARGIN_RIGHT, 50, [0.9, 0.92, 0.94], 0.5);
    text("Generated by InvoiceFlow", MARGIN_LEFT, 38, 8, "/F1", [0.55, 0.6, 0.65]);
    rightText(`Page ${pageIdx + 1} of ${totalPages}`, PAGE_WIDTH - MARGIN_RIGHT, 38, 8, "/F1", [0.55, 0.6, 0.65]);

    pageStreams.push(commands.join("\n"));
  }

  return buildMultiPagePdf(pageStreams);
}

function buildMultiPagePdf(pageStreams) {
  const objects = [];
  const pageObjIds = [];

  const fontF1Id = 3;
  const fontF2Id = 4;

  let currentObjId = 5;
  for (let i = 0; i < pageStreams.length; i++) {
    const pageId = currentObjId++;
    const contentId = currentObjId++;
    pageObjIds.push(pageId);
  }

  objects.push({
    id: 1,
    body: "<< /Type /Catalog /Pages 2 0 R >>"
  });

  objects.push({
    id: 2,
    body: `<< /Type /Pages /Kids [${pageObjIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageStreams.length} >>`
  });

  objects.push({
    id: 3,
    body: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"
  });

  objects.push({
    id: 4,
    body: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"
  });

  for (let i = 0; i < pageStreams.length; i++) {
    const pageId = pageObjIds[i];
    const contentId = pageId + 1;
    const stream = pageStreams[i];
    const streamBuf = Buffer.from(stream, "utf8");

    objects.push({
      id: pageId,
      body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontF1Id} 0 R /F2 ${fontF2Id} 0 R >> >> /Contents ${contentId} 0 R >>`
    });

    objects.push({
      id: contentId,
      body: `<< /Length ${streamBuf.length} >>\nstream\n${stream}\nendstream`
    });
  }

  // Serialize PDF
  let pdf = "%PDF-1.4\n";
  const offsets = [0];

  objects.sort((a, b) => a.id - b.id);

  objects.forEach((obj) => {
    offsets[obj.id] = Buffer.byteLength(pdf, "utf8");
    pdf += `${obj.id} 0 obj\n${obj.body}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;

  for (let i = 1; i <= objects.length; i++) {
    const offset = offsets[i] || 0;
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }

  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf, "utf8");
}

module.exports = { generateInvoicePdf };
