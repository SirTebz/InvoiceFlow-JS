const config = require("../config");

function getPlanConfig(plan = "free") {
  if (plan === "pro") {
    return { plan: "pro", invoiceLimit: null, recurringInvoices: true, emailSending: true, pdfDownloads: true };
  }
  return {
    plan: "free",
    invoiceLimit: config.billing.freePlanMonthlyInvoiceLimit,
    recurringInvoices: true,
    emailSending: true,
    pdfDownloads: true
  };
}

function ensureSubscription(userId, db) {
  const existing = db.prepare("SELECT * FROM subscriptions WHERE user_id = ?").get(userId);
  if (existing) return existing;
  db.prepare("INSERT INTO subscriptions (user_id, plan, provider, status) VALUES (?, 'free', ?, 'active')").run(userId, config.billing.provider);
  return db.prepare("SELECT * FROM subscriptions WHERE user_id = ?").get(userId);
}

module.exports = { getPlanConfig, ensureSubscription };
