const fs = require("fs");
const path = require("path");

const envPath = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}

const config = {
  port: Number(process.env.PORT || 3000),
  databaseUrl: process.env.DATABASE_URL || "./data/invoiceflow.sqlite",
  sessionSecret: process.env.SESSION_SECRET || "invoiceflow-dev-secret",
  appUrl: process.env.APP_URL || "http://localhost:3000",
  email: {
    provider: process.env.EMAIL_PROVIDER || "mock",
    from: process.env.EMAIL_FROM || "InvoiceFlow <invoices@example.test>",
    smtp: {
      host: process.env.SMTP_HOST || "localhost",
      port: Number(process.env.SMTP_PORT || 587),
      user: process.env.SMTP_USER || "",
      pass: process.env.SMTP_PASSWORD || "",
      secure: process.env.SMTP_SECURE === "true"
    }
  },
  billing: {
    provider: process.env.BILLING_PROVIDER || "mock",
    freePlanMonthlyInvoiceLimit: Number(process.env.FREE_PLAN_MONTHLY_INVOICE_LIMIT || 10)
  },
  payfast: {
    sandbox: process.env.PAYFAST_SANDBOX !== "false", // default to sandbox in dev
    checkoutUrl: process.env.PAYFAST_SANDBOX !== "false"
      ? "https://sandbox.payfast.co.za/eng/process"
      : "https://www.payfast.co.za/eng/process",
    validateUrl: process.env.PAYFAST_SANDBOX !== "false"
      ? "https://sandbox.payfast.co.za/eng/query/validate"
      : "https://www.payfast.co.za/eng/query/validate"
  }
};

module.exports = config;
