const net = require("net");
const tls = require("tls");
const config = require("../config");
const { formatMoney } = require("../utils/money");

const recentMockEmails = [];

function escapeHtml(str) {
  return String(str || "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]));
}

function generateEmailContent({ invoice, customer = {}, business = {}, publicUrl }) {
  const currency = invoice.currency || "ZAR";
  const amountStr = formatMoney(invoice.total_cents, currency);
  const bizName = business.business_name || "Your Business";
  const custName = customer.name || "Valued Customer";
  const subject = `Invoice ${invoice.invoice_number} from ${bizName}`;

  const textBody = `Hello ${custName},

Your invoice ${invoice.invoice_number} from ${bizName} is ready for review.

----------------------------------------
Invoice Number: ${invoice.invoice_number}
Amount Due:     ${amountStr}
Due Date:       ${invoice.due_date}
----------------------------------------

You can view, print, or download your official invoice using this secure link:
${publicUrl}

${business.payment_details ? `Payment Instructions:\n${business.payment_details}\n` : ""}
Thank you for your business!

Sincerely,
${bizName}
${business.email || ""} ${business.phone || ""}
`;

  const htmlBody = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(subject)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px; color: #1e293b; }
  .card { max-width: 580px; margin: 0 auto; background: #ffffff; border-radius: 10px; border: 1px solid #e2e8f0; padding: 36px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
  .brand { font-size: 20px; font-weight: 800; color: #0f172a; margin-bottom: 24px; border-bottom: 2px solid ${business.accent_color || "#2563eb"}; padding-bottom: 12px; }
  .box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin: 24px 0; }
  .row { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 14px; }
  .row.total { border-top: 1px solid #cbd5e1; padding-top: 10px; margin-top: 10px; font-size: 18px; font-weight: 800; color: ${business.accent_color || "#2563eb"}; }
  .btn { display: inline-block; background: ${business.accent_color || "#2563eb"}; color: #ffffff !important; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: 700; font-size: 15px; text-align: center; margin: 18px 0; }
  .instructions { background: #eff6ff; border-left: 4px solid #2563eb; padding: 12px 16px; font-size: 13px; margin: 20px 0; white-space: pre-line; color: #1e3a8a; }
  .footer { font-size: 12px; color: #64748b; margin-top: 32px; border-top: 1px solid #e2e8f0; padding-top: 16px; text-align: center; }
</style>
</head>
<body>
  <div class="card">
    <div class="brand">${escapeHtml(bizName)}</div>
    <h2 style="font-size:18px; margin:0 0 12px;">Invoice ${escapeHtml(invoice.invoice_number)}</h2>
    <p style="font-size:14px; line-height:1.5; margin:0 0 16px;">Hello <strong>${escapeHtml(custName)}</strong>,</p>
    <p style="font-size:14px; line-height:1.5; margin:0;">Here is your invoice for services rendered. Please review the details below.</p>
    
    <div class="box">
      <div class="row"><span>Invoice Number:</span><strong>${escapeHtml(invoice.invoice_number)}</strong></div>
      <div class="row"><span>Issue Date:</span><span>${escapeHtml(invoice.issue_date)}</span></div>
      <div class="row"><span>Due Date:</span><span>${escapeHtml(invoice.due_date)}</span></div>
      <div class="row total"><span>Amount Due:</span><span>${escapeHtml(amountStr)}</span></div>
    </div>

    <div style="text-align:center;">
      <a href="${escapeHtml(publicUrl)}" class="btn" target="_blank">View & Download Invoice</a>
    </div>

    ${business.payment_details ? `<div class="instructions"><strong>Payment Instructions:</strong>\n${escapeHtml(business.payment_details)}</div>` : ""}

    <p style="font-size:13px; color:#475569; margin-top:20px;">Or access your invoice directly at:<br><a href="${escapeHtml(publicUrl)}" style="color:#2563eb; word-break:break-all;">${escapeHtml(publicUrl)}</a></p>

    <div class="footer">
      Sent with <strong>InvoiceFlow</strong> on behalf of ${escapeHtml(bizName)}.<br>
      ${escapeHtml(business.email || "")} ${escapeHtml(business.phone ? `• ${business.phone}` : "")}
    </div>
  </div>
</body>
</html>`;

  return { subject, textBody, htmlBody };
}

async function sendInvoiceEmail({ to, invoice, customer, business, publicUrl, pdfBuffer, db, userId }) {
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    throw new Error("Invalid recipient email address.");
  }

  const { subject, textBody, htmlBody } = generateEmailContent({ invoice, customer, business, publicUrl });
  const providerName = config.email.provider;

  let deliveryResult = { success: false, provider: providerName, message: "" };

  if (providerName === "smtp") {
    deliveryResult = await sendViaSmtp({ to, from: config.email.from, subject, textBody, htmlBody, pdfBuffer, invoiceNumber: invoice.invoice_number });
  } else {
    // Default: Mock email provider
    deliveryResult = sendViaMock({ to, from: config.email.from, subject, textBody, htmlBody, invoice, publicUrl });
  }

  // Record delivery attempt in database
  if (db && userId) {
    try {
      db.prepare(`
        INSERT INTO email_logs (user_id, invoice_id, recipient_email, provider, status, subject, body_text, body_html, public_url, error_message, sent_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).run(
        userId,
        invoice.id,
        to,
        providerName,
        deliveryResult.success ? "sent" : "failed",
        subject,
        textBody,
        htmlBody,
        publicUrl,
        deliveryResult.error || ""
      );

      if (deliveryResult.success) {
        db.prepare(`
          UPDATE invoices
          SET delivery_status='sent', last_delivered_at=CURRENT_TIMESTAMP, sent_at=COALESCE(sent_at, CURRENT_TIMESTAMP), updated_at=CURRENT_TIMESTAMP
          WHERE id=? AND user_id=?
        `).run(invoice.id, userId);
      } else {
        db.prepare(`
          UPDATE invoices
          SET delivery_status='failed', last_delivered_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
          WHERE id=? AND user_id=?
        `).run(invoice.id, userId);
      }
    } catch (dbErr) {
      console.error("Failed to log email delivery in database:", dbErr);
    }
  }

  if (!deliveryResult.success) {
    throw new Error(deliveryResult.error || "Email delivery failed.");
  }

  return deliveryResult;
}

function sendViaMock({ to, from, subject, textBody, htmlBody, invoice, publicUrl }) {
  const logEntry = {
    id: Date.now(),
    to,
    from,
    subject,
    textBody,
    htmlBody,
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoice_number,
    publicUrl,
    sentAt: new Date().toISOString()
  };

  recentMockEmails.unshift(logEntry);
  if (recentMockEmails.length > 50) recentMockEmails.pop();

  return {
    success: true,
    provider: "mock",
    delivered: false,
    message: `Development mode: Invoice ${invoice.invoice_number} email recorded for ${to}.`,
    publicUrl,
    emailId: logEntry.id
  };
}

function sendViaSmtp({ to, from, subject, textBody, htmlBody, pdfBuffer, invoiceNumber }) {
  return new Promise((resolve) => {
    const { host, port, user, pass, secure } = config.email.smtp;
    if (!host) {
      return resolve({ success: false, provider: "smtp", error: "SMTP_HOST is not configured." });
    }

    const socket = secure ? tls.connect(port, host) : net.connect(port, host);
    let step = 0;
    let buffer = "";

    const timeout = setTimeout(() => {
      socket.destroy();
      resolve({ success: false, provider: "smtp", error: "SMTP connection timed out." });
    }, 15000);

    socket.on("error", (err) => {
      clearTimeout(timeout);
      resolve({ success: false, provider: "smtp", error: `SMTP error: ${err.message}` });
    });

    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\r\n");
      const lastLine = lines[lines.length - 2] || "";

      if (/^220/.test(lastLine) && step === 0) {
        step++;
        socket.write(`EHLO localhost\r\n`);
      } else if (/^250/.test(lastLine) && step === 1) {
        if (user && pass) {
          step++;
          socket.write(`AUTH LOGIN\r\n`);
        } else {
          step = 4;
          socket.write(`MAIL FROM:<${from.replace(/.*<([^>]+)>.*/, "$1")}>\r\n`);
        }
      } else if (/^334/.test(lastLine) && step === 2) {
        step++;
        socket.write(`${Buffer.from(user).toString("base64")}\r\n`);
      } else if (/^334/.test(lastLine) && step === 3) {
        step++;
        socket.write(`${Buffer.from(pass).toString("base64")}\r\n`);
      } else if (/^235/.test(lastLine) && step === 4) {
        step++;
        socket.write(`MAIL FROM:<${from.replace(/.*<([^>]+)>.*/, "$1")}>\r\n`);
      } else if (/^250/.test(lastLine) && (step === 4 || step === 5)) {
        step = 6;
        socket.write(`RCPT TO:<${to}>\r\n`);
      } else if (/^250/.test(lastLine) && step === 6) {
        step++;
        socket.write(`DATA\r\n`);
      } else if (/^354/.test(lastLine) && step === 7) {
        step++;
        const boundary = `----=_Part_${Date.now()}`;
        const mailContent = [
          `From: ${from}`,
          `To: ${to}`,
          `Subject: ${subject}`,
          `MIME-Version: 1.0`,
          `Content-Type: multipart/alternative; boundary="${boundary}"`,
          ``,
          `--${boundary}`,
          `Content-Type: text/plain; charset=utf-8`,
          `Content-Transfer-Encoding: 7bit`,
          ``,
          textBody,
          ``,
          `--${boundary}`,
          `Content-Type: text/html; charset=utf-8`,
          `Content-Transfer-Encoding: 7bit`,
          ``,
          htmlBody,
          ``,
          `--${boundary}--`,
          `.`
        ].join("\r\n");

        socket.write(`${mailContent}\r\n`);
      } else if (/^250/.test(lastLine) && step === 8) {
        step++;
        socket.write(`QUIT\r\n`);
        clearTimeout(timeout);
        socket.end();
        resolve({ success: true, provider: "smtp", message: `Invoice email successfully sent via SMTP to ${to}.` });
      } else if (/^[45]\d\d/.test(lastLine)) {
        clearTimeout(timeout);
        socket.destroy();
        resolve({ success: false, provider: "smtp", error: `SMTP server rejected command: ${lastLine}` });
      }
    });
  });
}

function getRecentMockEmails() {
  return recentMockEmails;
}

module.exports = {
  sendInvoiceEmail,
  generateEmailContent,
  getRecentMockEmails
};
