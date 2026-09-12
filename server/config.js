require("dotenv").config();

const config = {
  port: Number(process.env.PORT || 3000),
  databaseUrl: process.env.DATABASE_URL || "./data/invoiceflow.sqlite",
  sessionSecret: process.env.SESSION_SECRET || "invoiceflow-dev-secret",
  appUrl: process.env.APP_URL || "http://localhost:3000",
  email: {
    provider: process.env.EMAIL_PROVIDER || "mock",
    from: process.env.EMAIL_FROM || "InvoiceFlow <invoices@example.test>"
  },
  billing: {
    provider: process.env.BILLING_PROVIDER || "mock",
    freePlanMonthlyInvoiceLimit: Number(process.env.FREE_PLAN_MONTHLY_INVOICE_LIMIT || 10)
  }
};

module.exports = config;
