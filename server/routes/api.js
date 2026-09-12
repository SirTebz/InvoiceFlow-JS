const express = require("express");
const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");
const { getDb } = require("../database/db");
const { createSession, destroySession, requireAuth } = require("../middleware/auth");
const { calculateInvoiceTotals, toCents, fromCents, basisPointsToPercent } = require("../utils/money");
const { generateInvoicePdf } = require("../services/pdfService");
const { sendInvoiceEmail } = require("../services/emailService");
const { ensureSubscription, getPlanConfig } = require("../services/billingService");

const router = express.Router();
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });

function ok(res, data = {}) {
  return res.json(data);
}

function badRequest(res, message, fields = {}) {
  return res.status(400).json({ error: { message, fields } });
}

function emailValid(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ""));
}

function userPayload(user) {
  return { id: user.id, name: user.name, email: user.email };
}

function parseBodyItems(body, fallbackTaxRate = 0) {
  const items = Array.isArray(body.items) ? body.items : [];
  return items.map((item) => ({
    description: String(item.description || "").trim(),
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    taxRate: item.taxRate === "" || item.taxRate == null ? basisPointsToPercent(fallbackTaxRate) : item.taxRate
  }));
}

function validateInvoiceBody(body, db, userId, existingInvoiceId) {
  const fields = {};
  if (!body.issueDate) fields.issueDate = "Issue date is required.";
  if (!body.dueDate) fields.dueDate = "Due date is required.";
  if (body.issueDate && body.dueDate && new Date(body.dueDate) < new Date(body.issueDate)) fields.dueDate = "Due date must be after issue date.";
  const customerId = Number(body.customerId || 0);
  let customer = null;
  if (customerId) {
    customer = db.prepare("SELECT * FROM customers WHERE id = ? AND user_id = ? AND deleted_at IS NULL").get(customerId, userId);
    if (!customer) fields.customerId = "Select one of your saved customers.";
  }
  const business = db.prepare("SELECT * FROM business_profiles WHERE user_id = ?").get(userId);
  const items = parseBodyItems(body, business.default_tax_rate);
  if (!items.length) fields.items = "Add at least one line item.";
  items.forEach((item, index) => {
    if (!item.description) fields[`items.${index}.description`] = "Description is required.";
    if (Number(item.quantity) <= 0) fields[`items.${index}.quantity`] = "Quantity must be positive.";
    if (Number(item.unitPrice) < 0) fields[`items.${index}.unitPrice`] = "Price cannot be negative.";
  });
  if (Object.keys(fields).length) return { fields };
  const discountCents = toCents(body.discount || 0);
  const totals = calculateInvoiceTotals(items, discountCents);
  return { customer, business, totals, existingInvoiceId };
}

function invoiceStatus(invoice) {
  if (invoice.status === "paid" || invoice.status === "draft" || invoice.status === "cancelled") return invoice.status;
  if (new Date(invoice.due_date) < new Date(new Date().toISOString().slice(0, 10))) return "overdue";
  return invoice.status;
}

function getInvoice(db, userId, id) {
  const invoice = db.prepare(`
    SELECT invoices.*, customers.name AS customer_name, customers.email AS customer_email, customers.billing_address AS customer_billing_address
    FROM invoices
    LEFT JOIN customers ON customers.id = invoices.customer_id
    WHERE invoices.id = ? AND invoices.user_id = ?
  `).get(id, userId);
  if (!invoice) return null;
  invoice.status = invoiceStatus(invoice);
  invoice.items = db.prepare("SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY position, id").all(id);
  invoice.payments = db.prepare("SELECT * FROM payments WHERE invoice_id = ? ORDER BY payment_date DESC, id DESC").all(id);
  return invoice;
}

function nextInvoiceNumber(db, userId) {
  const profile = db.prepare("SELECT invoice_prefix, next_invoice_number FROM business_profiles WHERE user_id = ?").get(userId);
  const padded = String(profile.next_invoice_number).padStart(4, "0");
  return `${profile.invoice_prefix}${padded}`;
}

router.post("/auth/register", authLimiter, async (req, res) => {
  const { name, email, password, confirmPassword } = req.body;
  const fields = {};
  if (!String(name || "").trim()) fields.name = "Name is required.";
  if (!emailValid(email)) fields.email = "Enter a valid email address.";
  if (String(password || "").length < 8) fields.password = "Use at least 8 characters.";
  if (password !== confirmPassword) fields.confirmPassword = "Passwords must match.";
  if (Object.keys(fields).length) return badRequest(res, "Please check the highlighted fields.", fields);

  const db = getDb();
  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const result = db.prepare("INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)").run(name.trim(), email.trim().toLowerCase(), passwordHash);
    db.prepare("INSERT INTO business_profiles (user_id, email) VALUES (?, ?)").run(result.lastInsertRowid, email.trim().toLowerCase());
    ensureSubscription(result.lastInsertRowid, db);
    createSession(res, result.lastInsertRowid);
    return ok(res, { user: { id: result.lastInsertRowid, name: name.trim(), email: email.trim().toLowerCase() } });
  } catch (error) {
    if (String(error.message).includes("UNIQUE")) return badRequest(res, "An account already exists for that email.", { email: "Email is already registered." });
    throw error;
  }
});

router.post("/auth/login", authLimiter, async (req, res) => {
  const { email, password } = req.body;
  const db = getDb();
  const user = db.prepare("SELECT * FROM users WHERE email = ? COLLATE NOCASE").get(email || "");
  if (!user || !(await bcrypt.compare(String(password || ""), user.password_hash))) {
    return res.status(401).json({ error: { message: "Email or password is incorrect." } });
  }
  createSession(res, user.id);
  return ok(res, { user: userPayload(user) });
});

router.post("/auth/logout", (req, res) => {
  destroySession(req, res);
  return ok(res, { success: true });
});

router.get("/auth/me", (req, res) => ok(res, { user: req.user ? userPayload(req.user) : null }));

router.use(requireAuth);

router.get("/business", (req, res) => {
  const profile = getDb().prepare("SELECT * FROM business_profiles WHERE user_id = ?").get(req.user.id);
  ok(res, { profile: { ...profile, default_tax_rate: basisPointsToPercent(profile.default_tax_rate) } });
});

router.put("/business", (req, res) => {
  const db = getDb();
  const fields = {
    business_name: String(req.body.businessName || "").trim(),
    logo_data_url: String(req.body.logoDataUrl || ""),
    email: String(req.body.email || "").trim(),
    phone: String(req.body.phone || "").trim(),
    address: String(req.body.address || "").trim(),
    website: String(req.body.website || "").trim(),
    tax_number: String(req.body.taxNumber || "").trim(),
    currency: String(req.body.currency || "ZAR").trim().toUpperCase(),
    default_tax_rate: Math.max(0, Math.round(Number(req.body.defaultTaxRate || 0) * 100)),
    payment_details: String(req.body.paymentDetails || "").trim(),
    invoice_prefix: String(req.body.invoicePrefix || "INV-").trim() || "INV-",
    next_invoice_number: Math.max(1, Number(req.body.nextInvoiceNumber || 1)),
    accent_color: /^#[0-9a-f]{6}$/i.test(req.body.accentColor || "") ? req.body.accentColor : "#2563eb",
    invoice_template: ["clean", "professional", "minimal"].includes(req.body.invoiceTemplate) ? req.body.invoiceTemplate : "clean"
  };
  db.prepare(`
    UPDATE business_profiles SET business_name=?, logo_data_url=?, email=?, phone=?, address=?, website=?, tax_number=?,
    currency=?, default_tax_rate=?, payment_details=?, invoice_prefix=?, next_invoice_number=?, accent_color=?, invoice_template=?, updated_at=CURRENT_TIMESTAMP
    WHERE user_id=?
  `).run(fields.business_name, fields.logo_data_url, fields.email, fields.phone, fields.address, fields.website, fields.tax_number, fields.currency, fields.default_tax_rate, fields.payment_details, fields.invoice_prefix, fields.next_invoice_number, fields.accent_color, fields.invoice_template, req.user.id);
  ok(res, { profile: fields });
});

router.get("/customers", (req, res) => {
  const search = `%${String(req.query.search || "").trim()}%`;
  const rows = getDb().prepare("SELECT * FROM customers WHERE user_id = ? AND deleted_at IS NULL AND (name LIKE ? OR email LIKE ?) ORDER BY name").all(req.user.id, search, search);
  ok(res, { customers: rows });
});

router.post("/customers", (req, res) => {
  const name = String(req.body.name || "").trim();
  if (!name) return badRequest(res, "Customer name is required.", { name: "Name is required." });
  const result = getDb().prepare("INSERT INTO customers (user_id, name, email, phone, billing_address, notes) VALUES (?, ?, ?, ?, ?, ?)")
    .run(req.user.id, name, req.body.email || "", req.body.phone || "", req.body.billingAddress || "", req.body.notes || "");
  ok(res, { customer: getDb().prepare("SELECT * FROM customers WHERE id = ?").get(result.lastInsertRowid) });
});

router.put("/customers/:id", (req, res) => {
  const db = getDb();
  const existing = db.prepare("SELECT * FROM customers WHERE id = ? AND user_id = ? AND deleted_at IS NULL").get(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ error: { message: "Customer not found." } });
  const name = String(req.body.name || "").trim();
  if (!name) return badRequest(res, "Customer name is required.", { name: "Name is required." });
  db.prepare("UPDATE customers SET name=?, email=?, phone=?, billing_address=?, notes=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?")
    .run(name, req.body.email || "", req.body.phone || "", req.body.billingAddress || "", req.body.notes || "", req.params.id, req.user.id);
  ok(res, { customer: db.prepare("SELECT * FROM customers WHERE id = ?").get(req.params.id) });
});

router.delete("/customers/:id", (req, res) => {
  const db = getDb();
  const result = db.prepare("UPDATE customers SET deleted_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?").run(req.params.id, req.user.id);
  if (!result.changes) return res.status(404).json({ error: { message: "Customer not found." } });
  ok(res, { success: true });
});

router.get("/invoices/next-number", (req, res) => ok(res, { invoiceNumber: nextInvoiceNumber(getDb(), req.user.id) }));

router.get("/invoices", (req, res) => {
  const db = getDb();
  const search = `%${String(req.query.search || "").trim()}%`;
  const status = String(req.query.status || "");
  let rows = db.prepare(`
    SELECT invoices.*, customers.name AS customer_name
    FROM invoices LEFT JOIN customers ON customers.id = invoices.customer_id
    WHERE invoices.user_id = ? AND (invoices.invoice_number LIKE ? OR customers.name LIKE ?)
    ORDER BY invoices.created_at DESC
  `).all(req.user.id, search, search).map((row) => ({ ...row, status: invoiceStatus(row) }));
  if (status) rows = rows.filter((row) => row.status === status);
  ok(res, { invoices: rows });
});

router.post("/invoices", (req, res) => {
  const db = getDb();
  const validation = validateInvoiceBody(req.body, db, req.user.id);
  if (validation.fields) return badRequest(res, "We couldn't save the invoice. Please check the highlighted fields and try again.", validation.fields);
  const invoiceNumber = req.body.invoiceNumber || nextInvoiceNumber(db, req.user.id);
  const result = db.prepare(`
    INSERT INTO invoices (user_id, customer_id, invoice_number, issue_date, due_date, status, currency, discount_cents, subtotal_cents, tax_cents, total_cents, notes, payment_terms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(req.user.id, req.body.customerId || null, invoiceNumber, req.body.issueDate, req.body.dueDate, req.body.status === "sent" ? "sent" : "draft", validation.business.currency, validation.totals.discountCents, validation.totals.subtotalCents, validation.totals.taxCents, validation.totals.totalCents, req.body.notes || "", req.body.paymentTerms || "");
  validation.totals.items.forEach((item) => db.prepare(`
    INSERT INTO invoice_items (invoice_id, description, quantity, unit_price_cents, tax_rate, line_subtotal_cents, line_tax_cents, line_total_cents, position)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(result.lastInsertRowid, item.description, item.quantity, item.unitPriceCents, item.taxRate, item.lineSubtotalCents, item.lineTaxCents, item.lineTotalCents, item.position));
  db.prepare("UPDATE business_profiles SET next_invoice_number = next_invoice_number + 1 WHERE user_id = ? AND ? = ?").run(req.user.id, invoiceNumber, nextInvoiceNumber(db, req.user.id));
  ok(res, { invoice: getInvoice(db, req.user.id, result.lastInsertRowid) });
});

router.get("/invoices/:id", (req, res) => {
  const invoice = getInvoice(getDb(), req.user.id, req.params.id);
  if (!invoice) return res.status(404).json({ error: { message: "Invoice not found." } });
  ok(res, { invoice });
});

router.put("/invoices/:id", (req, res) => {
  const db = getDb();
  const existing = getInvoice(db, req.user.id, req.params.id);
  if (!existing) return res.status(404).json({ error: { message: "Invoice not found." } });
  if (existing.status === "paid" || existing.status === "cancelled") return badRequest(res, "Paid or cancelled invoices cannot be edited.");
  const validation = validateInvoiceBody(req.body, db, req.user.id, req.params.id);
  if (validation.fields) return badRequest(res, "We couldn't save the invoice. Please check the highlighted fields and try again.", validation.fields);
  db.prepare(`
    UPDATE invoices SET customer_id=?, issue_date=?, due_date=?, status=?, discount_cents=?, subtotal_cents=?, tax_cents=?, total_cents=?, notes=?, payment_terms=?, updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND user_id=?
  `).run(req.body.customerId || null, req.body.issueDate, req.body.dueDate, req.body.status === "sent" ? "sent" : "draft", validation.totals.discountCents, validation.totals.subtotalCents, validation.totals.taxCents, validation.totals.totalCents, req.body.notes || "", req.body.paymentTerms || "", req.params.id, req.user.id);
  db.prepare("DELETE FROM invoice_items WHERE invoice_id = ?").run(req.params.id);
  validation.totals.items.forEach((item) => db.prepare(`
    INSERT INTO invoice_items (invoice_id, description, quantity, unit_price_cents, tax_rate, line_subtotal_cents, line_tax_cents, line_total_cents, position)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(req.params.id, item.description, item.quantity, item.unitPriceCents, item.taxRate, item.lineSubtotalCents, item.lineTaxCents, item.lineTotalCents, item.position));
  ok(res, { invoice: getInvoice(db, req.user.id, req.params.id) });
});

router.delete("/invoices/:id", (req, res) => {
  const result = getDb().prepare("UPDATE invoices SET status='cancelled', cancelled_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=? AND status != 'paid'").run(req.params.id, req.user.id);
  if (!result.changes) return res.status(404).json({ error: { message: "Invoice not found or cannot be cancelled." } });
  ok(res, { success: true });
});

router.post("/invoices/:id/duplicate", (req, res) => {
  const db = getDb();
  const source = getInvoice(db, req.user.id, req.params.id);
  if (!source) return res.status(404).json({ error: { message: "Invoice not found." } });
  req.body = { ...source, customerId: source.customer_id, issueDate: new Date().toISOString().slice(0, 10), dueDate: source.due_date, status: "draft", discount: fromCents(source.discount_cents), items: source.items.map((item) => ({ description: item.description, quantity: item.quantity, unitPrice: fromCents(item.unit_price_cents), taxRate: basisPointsToPercent(item.tax_rate) })) };
  return router.handle(req, res);
});

router.get("/invoices/:id/pdf", async (req, res) => {
  const db = getDb();
  const invoice = getInvoice(db, req.user.id, req.params.id);
  if (!invoice) return res.status(404).json({ error: { message: "Invoice not found." } });
  const business = db.prepare("SELECT * FROM business_profiles WHERE user_id = ?").get(req.user.id);
  const customer = db.prepare("SELECT * FROM customers WHERE id = ? AND user_id = ?").get(invoice.customer_id, req.user.id);
  const buffer = await generateInvoicePdf({ invoice, items: invoice.items, customer, business });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${invoice.invoice_number}.pdf"`);
  res.send(buffer);
});

router.post("/invoices/:id/send", async (req, res) => {
  const db = getDb();
  const invoice = getInvoice(db, req.user.id, req.params.id);
  if (!invoice) return res.status(404).json({ error: { message: "Invoice not found." } });
  const to = req.body.email || invoice.customer_email;
  if (!emailValid(to)) return badRequest(res, "Enter a valid recipient email.", { email: "Valid email required." });
  const business = db.prepare("SELECT * FROM business_profiles WHERE user_id = ?").get(req.user.id);
  const customer = db.prepare("SELECT * FROM customers WHERE id = ? AND user_id = ?").get(invoice.customer_id, req.user.id);
  const pdfBuffer = await generateInvoicePdf({ invoice, items: invoice.items, customer, business });
  const result = await sendInvoiceEmail({ to, invoice, pdfBuffer });
  db.prepare("UPDATE invoices SET status='sent', sent_at=COALESCE(sent_at, CURRENT_TIMESTAMP), updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=? AND status='draft'").run(req.params.id, req.user.id);
  ok(res, { email: result, invoice: getInvoice(db, req.user.id, req.params.id) });
});

router.post("/invoices/:id/mark-paid", (req, res) => {
  const db = getDb();
  const invoice = getInvoice(db, req.user.id, req.params.id);
  if (!invoice) return res.status(404).json({ error: { message: "Invoice not found." } });
  if (invoice.status === "cancelled") return badRequest(res, "Cancelled invoices cannot be paid.");
  const amountCents = toCents(req.body.amount || fromCents(invoice.total_cents));
  if (amountCents <= 0 || amountCents > invoice.total_cents) return badRequest(res, "Payment amount must be positive and no more than the invoice total.", { amount: "Invalid amount." });
  db.prepare("INSERT INTO payments (user_id, invoice_id, payment_date, amount_cents, reference) VALUES (?, ?, ?, ?, ?)")
    .run(req.user.id, req.params.id, req.body.paymentDate || new Date().toISOString().slice(0, 10), amountCents, req.body.reference || "");
  db.prepare("UPDATE invoices SET status='paid', updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?").run(req.params.id, req.user.id);
  ok(res, { invoice: getInvoice(db, req.user.id, req.params.id) });
});

router.get("/dashboard", (req, res) => {
  const db = getDb();
  const invoices = db.prepare("SELECT * FROM invoices WHERE user_id = ?").all(req.user.id).map((row) => ({ ...row, status: invoiceStatus(row) }));
  const month = new Date().toISOString().slice(0, 7);
  const paidThisMonth = db.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS total FROM payments WHERE user_id = ? AND substr(payment_date, 1, 7) = ?").get(req.user.id, month).total;
  ok(res, {
    metrics: {
      outstanding: invoices.filter((i) => ["sent", "overdue"].includes(i.status)).reduce((sum, i) => sum + i.total_cents, 0),
      paidThisMonth,
      overdue: invoices.filter((i) => i.status === "overdue").length,
      drafts: invoices.filter((i) => i.status === "draft").length
    },
    recentInvoices: invoices.slice(0, 5)
  });
});

router.get("/recurring-invoices", (req, res) => {
  const rows = getDb().prepare(`
    SELECT recurring_invoices.*, customers.name AS customer_name
    FROM recurring_invoices LEFT JOIN customers ON customers.id = recurring_invoices.customer_id
    WHERE recurring_invoices.user_id = ? ORDER BY next_invoice_date
  `).all(req.user.id);
  ok(res, { recurringInvoices: rows.map((row) => ({ ...row, payload: JSON.parse(row.payload_json) })) });
});

router.post("/recurring-invoices", (req, res) => {
  const db = getDb();
  const frequency = String(req.body.frequency || "monthly");
  if (!["weekly", "monthly", "quarterly", "yearly"].includes(frequency)) return badRequest(res, "Choose a supported frequency.", { frequency: "Invalid frequency." });
  if (!req.body.customerId) return badRequest(res, "Customer is required.", { customerId: "Select a customer." });
  const customer = db.prepare("SELECT * FROM customers WHERE id=? AND user_id=? AND deleted_at IS NULL").get(req.body.customerId, req.user.id);
  if (!customer) return badRequest(res, "Select one of your saved customers.", { customerId: "Invalid customer." });
  const result = db.prepare(`
    INSERT INTO recurring_invoices (user_id, customer_id, title, frequency, start_date, next_invoice_date, end_date, status, payload_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)
  `).run(req.user.id, req.body.customerId, req.body.title || `${customer.name} recurring invoice`, frequency, req.body.startDate, req.body.nextInvoiceDate || req.body.startDate, req.body.endDate || null, JSON.stringify(req.body));
  ok(res, { recurringInvoice: db.prepare("SELECT * FROM recurring_invoices WHERE id = ?").get(result.lastInsertRowid) });
});

router.put("/recurring-invoices/:id", (req, res) => {
  const status = String(req.body.status || "active");
  if (!["active", "paused", "cancelled"].includes(status)) return badRequest(res, "Invalid recurring invoice status.", { status: "Invalid status." });
  const result = getDb().prepare("UPDATE recurring_invoices SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?").run(status, req.params.id, req.user.id);
  if (!result.changes) return res.status(404).json({ error: { message: "Recurring invoice not found." } });
  ok(res, { success: true });
});

router.delete("/recurring-invoices/:id", (req, res) => {
  const result = getDb().prepare("UPDATE recurring_invoices SET status='cancelled', updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?").run(req.params.id, req.user.id);
  if (!result.changes) return res.status(404).json({ error: { message: "Recurring invoice not found." } });
  ok(res, { success: true });
});

router.get("/subscription", (req, res) => {
  const subscription = ensureSubscription(req.user.id, getDb());
  ok(res, { subscription, plan: getPlanConfig(subscription.plan) });
});

module.exports = router;
