const config = require("../config");

async function sendInvoiceEmail({ to, invoice, pdfBuffer }) {
  if (config.email.provider !== "mock") {
    throw new Error("No production email provider is configured. Set EMAIL_PROVIDER=mock for local development.");
  }
  return {
    provider: "mock",
    delivered: false,
    message: `Development mode: invoice ${invoice.invoice_number} email prepared for ${to}.`,
    attachmentBytes: pdfBuffer.length
  };
}

module.exports = { sendInvoiceEmail };
