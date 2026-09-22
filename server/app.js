const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const config = require("./config");
const { getDb, openDatabase } = require("./database/db");
const { calculateInvoiceTotals, toCents, fromCents, basisPointsToPercent } = require("./utils/money");
const { generateInvoicePdf } = require("./services/pdfService");
const { sendInvoiceEmail, getRecentMockEmails } = require("./services/emailService");
const { ensureSubscription, getPlanConfig } = require("./services/billingService");

const COOKIE_NAME = "invoiceflow_session";

function createApp(options = {}) {
  if (options.databaseUrl) openDatabase(options.databaseUrl);
  return http.createServer(handleRequest);
}

async function handleRequest(req, res) {
  try {
    setSecurityHeaders(res);
    req.user = getUserFromRequest(req);
    const url = new URL(req.url, "http://localhost");
    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
    return serveStatic(req, res, url);
  } catch (error) {
    console.error(error);
    json(res, 500, { error: { message: "Something went wrong. Please try again." } });
  }
}

function setSecurityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
}

async function handleApi(req, res, url) {
  const body = await readJson(req);
  const method = req.method;
  const parts = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const db = getDb();

  // Public Unauthenticated Routes
  if (parts[0] === "public" && parts[1] === "invoices") {
    return publicInvoiceRoute(req, res, db, parts);
  }

  // Development Emails Route
  if (parts[0] === "dev" && parts[1] === "emails" && method === "GET") {
    return json(res, 200, { emails: getRecentMockEmails() });
  }

  // Auth Routes
  if (method === "POST" && parts.join("/") === "auth/register") return register(req, res, body, db);
  if (method === "POST" && parts.join("/") === "auth/login") return login(req, res, body, db);
  if (method === "POST" && parts.join("/") === "auth/logout") return logout(req, res, db);
  if (method === "GET" && parts.join("/") === "auth/me") return json(res, 200, { user: req.user });

  if (!req.user) return json(res, 401, { error: { message: "Please log in to continue." } });

  // Protected Business Owner Routes
  if (method === "GET" && parts[0] === "business") return getBusiness(res, db, req.user.id);
  if (method === "PUT" && parts[0] === "business") return updateBusiness(res, db, req.user.id, body);
  if (parts[0] === "customers") return customersRoute(req, res, db, parts, body, url);
  if (parts[0] === "invoices") return invoicesRoute(req, res, db, parts, body, url);
  if (parts[0] === "dashboard" && method === "GET") return dashboard(res, db, req.user.id);
  if (parts[0] === "recurring-invoices") return recurringRoute(req, res, db, parts, body);
  if (parts[0] === "subscription" && method === "GET") {
    const subscription = ensureSubscription(req.user.id, db);
    return json(res, 200, { subscription, plan: getPlanConfig(subscription.plan) });
  }
  return json(res, 404, { error: { message: "Not found." } });
}

function publicInvoiceRoute(req, res, db, parts) {
  const token = String(parts[2] || "").trim();
  const action = parts[3];

  if (!token || token.length < 16) {
    return json(res, 404, { error: { message: "Invoice not found or link is invalid." } });
  }

  const invoice = db.prepare(`
    SELECT invoices.*, customers.name AS customer_name, customers.email AS customer_email,
           customers.billing_address AS customer_billing_address, customers.phone AS customer_phone
    FROM invoices
    LEFT JOIN customers ON customers.id = invoices.customer_id
    WHERE invoices.public_token = ?
  `).get(token);

  if (!invoice) {
    return json(res, 404, { error: { message: "Invoice not found or link has expired." } });
  }

  invoice.status = invoiceStatus(invoice);
  invoice.items = db.prepare("SELECT * FROM invoice_items WHERE invoice_id=? ORDER BY position, id").all(invoice.id);
  invoice.payments = db.prepare("SELECT payment_date, amount_cents, reference FROM payments WHERE invoice_id=? ORDER BY payment_date DESC, id DESC").all(invoice.id);

  const business = db.prepare("SELECT * FROM business_profiles WHERE user_id=?").get(invoice.user_id);

  // Download PDF via public token
  if (req.method === "GET" && action === "pdf") {
    return generateInvoicePdf({ invoice, items: invoice.items, customer: invoice, business }).then((buffer) => {
      res.writeHead(200, {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${invoice.invoice_number}.pdf"`,
        "Content-Length": buffer.length
      });
      res.end(buffer);
    });
  }

  // Get Public Invoice JSON & Increment View Tracking
  if (req.method === "GET" && !action) {
    // Record view asynchronously
    try {
      db.prepare(`
        UPDATE invoices
        SET view_count = view_count + 1,
            first_viewed_at = COALESCE(first_viewed_at, CURRENT_TIMESTAMP),
            last_viewed_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(invoice.id);
    } catch (_vErr) {
      // Ignore view tracking error
    }

    // Return strictly sanitized data for customer view
    return json(res, 200, {
      invoice: {
        invoice_number: invoice.invoice_number,
        issue_date: invoice.issue_date,
        due_date: invoice.due_date,
        status: invoice.status,
        currency: invoice.currency,
        subtotal_cents: invoice.subtotal_cents,
        tax_cents: invoice.tax_cents,
        discount_cents: invoice.discount_cents,
        total_cents: invoice.total_cents,
        notes: invoice.notes,
        payment_terms: invoice.payment_terms,
        items: invoice.items.map((it) => ({
          description: it.description,
          quantity: it.quantity,
          unit_price_cents: it.unit_price_cents,
          tax_rate: it.tax_rate,
          line_total_cents: it.line_total_cents
        })),
        payments: invoice.payments
      },
      customer: {
        name: invoice.customer_name || "Valued Customer",
        email: invoice.customer_email || "",
        billing_address: invoice.customer_billing_address || "",
        phone: invoice.customer_phone || ""
      },
      business: {
        business_name: business.business_name || "InvoiceFlow Business",
        email: business.email || "",
        phone: business.phone || "",
        address: business.address || "",
        website: business.website || "",
        tax_number: business.tax_number || "",
        payment_details: business.payment_details || "",
        invoice_template: business.invoice_template || "clean",
        accent_color: business.accent_color || "#2563eb",
        logo_data_url: business.logo_data_url || ""
      }
    });
  }

  return json(res, 404, { error: { message: "Not found." } });
}

async function register(req, res, body, db) {
  const fields = {};
  if (!String(body.name || "").trim()) fields.name = "Name is required.";
  if (!emailValid(body.email)) fields.email = "Enter a valid email address.";
  if (String(body.password || "").length < 8) fields.password = "Use at least 8 characters.";
  if (body.password !== body.confirmPassword) fields.confirmPassword = "Passwords must match.";
  if (Object.keys(fields).length) return bad(res, "Please check the highlighted fields.", fields);
  try {
    const passwordHash = await hashPassword(body.password);
    const result = db.prepare("INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)").run(body.name.trim(), body.email.trim().toLowerCase(), passwordHash);
    db.prepare("INSERT INTO business_profiles (user_id, email, business_name) VALUES (?, ?, ?)").run(result.lastInsertRowid, body.email.trim().toLowerCase(), `${body.name.trim()}'s Studio`);
    ensureSubscription(result.lastInsertRowid, db);
    createSession(res, result.lastInsertRowid, db);
    return json(res, 200, { user: { id: result.lastInsertRowid, name: body.name.trim(), email: body.email.trim().toLowerCase() } });
  } catch (error) {
    if (String(error.message).includes("UNIQUE")) return bad(res, "An account already exists for that email.", { email: "Email is already registered." });
    throw error;
  }
}

async function login(_req, res, body, db) {
  const user = db.prepare("SELECT * FROM users WHERE email = ? COLLATE NOCASE").get(body.email || "");
  if (!user || !(await verifyPassword(body.password || "", user.password_hash))) return json(res, 401, { error: { message: "Email or password is incorrect." } });
  createSession(res, user.id, db);
  return json(res, 200, { user: { id: user.id, name: user.name, email: user.email } });
}

function logout(req, res, db) {
  const token = readCookie(req, COOKIE_NAME);
  if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
  return json(res, 200, { success: true });
}

function getBusiness(res, db, userId) {
  const profile = db.prepare("SELECT * FROM business_profiles WHERE user_id = ?").get(userId);
  return json(res, 200, { profile: { ...profile, default_tax_rate: basisPointsToPercent(profile.default_tax_rate) } });
}

function updateBusiness(res, db, userId, body) {
  const logo = String(body.logoDataUrl || "");
  if (logo && !logo.startsWith("data:image/") && logo.length > 2_000_000) {
    return bad(res, "Logo must be a valid image data URL under 2MB.", { logo: "Invalid image format" });
  }

  const values = [
    body.businessName || "",
    logo,
    body.email || "",
    body.phone || "",
    body.address || "",
    body.website || "",
    body.taxNumber || "",
    String(body.currency || "ZAR").toUpperCase(),
    Math.max(0, Math.round(Number(body.defaultTaxRate || 0) * 100)),
    body.paymentDetails || "",
    body.invoicePrefix || "INV-",
    Math.max(1, Number(body.nextInvoiceNumber || 1)),
    /^#[0-9a-f]{6}$/i.test(body.accentColor || "") ? body.accentColor : "#2563eb",
    ["clean", "professional", "minimal"].includes(body.invoiceTemplate) ? body.invoiceTemplate : "clean",
    userId
  ];
  db.prepare(`UPDATE business_profiles SET business_name=?, logo_data_url=?, email=?, phone=?, address=?, website=?, tax_number=?, currency=?, default_tax_rate=?, payment_details=?, invoice_prefix=?, next_invoice_number=?, accent_color=?, invoice_template=?, updated_at=CURRENT_TIMESTAMP WHERE user_id=?`).run(...values);
  return getBusiness(res, db, userId);
}

function customersRoute(req, res, db, parts, body, url) {
  const id = Number(parts[1]);
  if (req.method === "GET" && !id) {
    const search = `%${String(url.searchParams.get("search") || "").trim()}%`;
    return json(res, 200, { customers: db.prepare("SELECT * FROM customers WHERE user_id=? AND deleted_at IS NULL AND (name LIKE ? OR email LIKE ?) ORDER BY name").all(req.user.id, search, search) });
  }
  if (req.method === "POST" && !id) {
    if (!String(body.name || "").trim()) return bad(res, "Customer name is required.", { name: "Name is required." });
    const result = db.prepare("INSERT INTO customers (user_id, name, email, phone, billing_address, notes) VALUES (?, ?, ?, ?, ?, ?)").run(req.user.id, body.name.trim(), body.email || "", body.phone || "", body.billingAddress || "", body.notes || "");
    return json(res, 200, { customer: db.prepare("SELECT * FROM customers WHERE id=?").get(result.lastInsertRowid) });
  }
  const existing = db.prepare("SELECT * FROM customers WHERE id=? AND user_id=? AND deleted_at IS NULL").get(id, req.user.id);
  if (!existing) return json(res, 404, { error: { message: "Customer not found." } });
  if (req.method === "PUT") {
    if (!String(body.name || "").trim()) return bad(res, "Customer name is required.", { name: "Name is required." });
    db.prepare("UPDATE customers SET name=?, email=?, phone=?, billing_address=?, notes=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?").run(body.name.trim(), body.email || "", body.phone || "", body.billingAddress || "", body.notes || "", id, req.user.id);
    return json(res, 200, { customer: db.prepare("SELECT * FROM customers WHERE id=?").get(id) });
  }
  if (req.method === "DELETE") {
    db.prepare("UPDATE customers SET deleted_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?").run(id, req.user.id);
    return json(res, 200, { success: true });
  }
  return json(res, 404, { error: { message: "Not found." } });
}

async function invoicesRoute(req, res, db, parts, body, url) {
  const id = Number(parts[1]);
  const action = parts[2];

  if (req.method === "GET" && parts[1] === "next-number") return json(res, 200, { invoiceNumber: nextInvoiceNumber(db, req.user.id) });
  if (req.method === "GET" && !id) {
    const search = `%${String(url.searchParams.get("search") || "").trim()}%`;
    let invoices = db.prepare(`SELECT invoices.*, customers.name AS customer_name FROM invoices LEFT JOIN customers ON customers.id=invoices.customer_id WHERE invoices.user_id=? AND (invoices.invoice_number LIKE ? OR customers.name LIKE ?) ORDER BY invoices.created_at DESC`).all(req.user.id, search, search).map((row) => ({ ...row, status: invoiceStatus(row) }));
    const status = url.searchParams.get("status");
    if (status) invoices = invoices.filter((invoice) => invoice.status === status);
    return json(res, 200, { invoices });
  }
  if (req.method === "POST" && !id) return saveInvoice(res, db, req.user.id, body);

  const invoice = getInvoice(db, req.user.id, id);
  if (!invoice) return json(res, 404, { error: { message: "Invoice not found." } });

  if (req.method === "GET" && !action) return json(res, 200, { invoice });
  if (req.method === "PUT" && !action) return saveInvoice(res, db, req.user.id, body, invoice);

  if (req.method === "DELETE" || (req.method === "POST" && action === "cancel")) {
    if (invoice.status === "paid") return bad(res, "Paid invoices cannot be cancelled.");
    db.prepare("UPDATE invoices SET status='cancelled', cancelled_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?").run(id, req.user.id);
    return json(res, 200, { success: true, invoice: getInvoice(db, req.user.id, id) });
  }

  if (req.method === "GET" && action === "pdf") return invoicePdf(req, res, db, invoice);
  if (req.method === "GET" && action === "deliveries") {
    const deliveries = db.prepare("SELECT * FROM email_logs WHERE invoice_id=? AND user_id=? ORDER BY sent_at DESC").all(invoice.id, req.user.id);
    return json(res, 200, { deliveries });
  }
  if (req.method === "GET" && action === "public-link") {
    const token = ensurePublicToken(db, invoice);
    const publicUrl = `${config.appUrl}/invoice/${token}`;
    return json(res, 200, { publicToken: token, publicUrl });
  }
  if (req.method === "POST" && action === "send") return sendInvoice(req, res, db, invoice, body);
  if (req.method === "POST" && action === "mark-paid") return markPaid(req, res, db, invoice, body);
  if (req.method === "POST" && action === "duplicate") return duplicateInvoice(req, res, db, invoice);

  return json(res, 404, { error: { message: "Not found." } });
}

function ensurePublicToken(db, invoice) {
  if (invoice.public_token) return invoice.public_token;
  const token = crypto.randomBytes(24).toString("base64url");
  db.prepare("UPDATE invoices SET public_token=? WHERE id=?").run(token, invoice.id);
  invoice.public_token = token;
  return token;
}

function saveInvoice(res, db, userId, body, existing) {
  const validation = validateInvoice(body, db, userId);
  if (validation.fields) return bad(res, "We couldn't save the invoice. Please check the highlighted fields and try again.", validation.fields);
  if (existing && ["paid", "cancelled"].includes(existing.status)) return bad(res, "Paid or cancelled invoices cannot be edited.");
  
  const invoiceNumber = existing?.invoice_number || body.invoiceNumber || nextInvoiceNumber(db, userId);
  const status = body.status === "sent" ? "sent" : "draft";
  const publicToken = existing?.public_token || crypto.randomBytes(24).toString("base64url");

  if (existing) {
    db.prepare("UPDATE invoices SET customer_id=?, issue_date=?, due_date=?, status=?, discount_cents=?, subtotal_cents=?, tax_cents=?, total_cents=?, notes=?, payment_terms=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?").run(
      body.customerId || null,
      body.issueDate,
      body.dueDate,
      status,
      validation.totals.discountCents,
      validation.totals.subtotalCents,
      validation.totals.taxCents,
      validation.totals.totalCents,
      body.notes || "",
      body.paymentTerms || "",
      existing.id,
      userId
    );
    db.prepare("DELETE FROM invoice_items WHERE invoice_id=?").run(existing.id);
  } else {
    const isNext = invoiceNumber === nextInvoiceNumber(db, userId);
    const result = db.prepare("INSERT INTO invoices (user_id, customer_id, invoice_number, issue_date, due_date, status, currency, discount_cents, subtotal_cents, tax_cents, total_cents, notes, payment_terms, public_token) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      userId,
      body.customerId || null,
      invoiceNumber,
      body.issueDate,
      body.dueDate,
      status,
      validation.business.currency || "ZAR",
      validation.totals.discountCents,
      validation.totals.subtotalCents,
      validation.totals.taxCents,
      validation.totals.totalCents,
      body.notes || "",
      body.paymentTerms || "",
      publicToken
    );
    existing = { id: result.lastInsertRowid };
    if (isNext) db.prepare("UPDATE business_profiles SET next_invoice_number=next_invoice_number+1 WHERE user_id=?").run(userId);
  }

  validation.totals.items.forEach((item) => {
    db.prepare("INSERT INTO invoice_items (invoice_id, description, quantity, unit_price_cents, tax_rate, line_subtotal_cents, line_tax_cents, line_total_cents, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      existing.id,
      item.description,
      item.quantity,
      item.unitPriceCents,
      item.taxRate,
      item.lineSubtotalCents,
      item.lineTaxCents,
      item.lineTotalCents,
      item.position
    );
  });

  return json(res, 200, { invoice: getInvoice(db, userId, existing.id) });
}

async function invoicePdf(req, res, db, invoice) {
  const business = db.prepare("SELECT * FROM business_profiles WHERE user_id=?").get(req.user.id);
  const customer = db.prepare("SELECT * FROM customers WHERE id=? AND user_id=?").get(invoice.customer_id, req.user.id);
  const buffer = await generateInvoicePdf({ invoice, items: invoice.items, customer, business });
  res.writeHead(200, {
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="${invoice.invoice_number}.pdf"`,
    "Content-Length": buffer.length
  });
  res.end(buffer);
}

async function sendInvoice(req, res, db, invoice, body) {
  if (invoice.status === "cancelled") return bad(res, "Cancelled invoices cannot be sent.");
  
  const to = body.email || invoice.customer_email;
  if (!emailValid(to)) return bad(res, "Enter a valid recipient email address.", { email: "Valid email required." });

  const business = db.prepare("SELECT * FROM business_profiles WHERE user_id=?").get(req.user.id);
  const customer = db.prepare("SELECT * FROM customers WHERE id=? AND user_id=?").get(invoice.customer_id, req.user.id);
  const publicToken = ensurePublicToken(db, invoice);
  const publicUrl = `${config.appUrl}/invoice/${publicToken}`;
  const pdfBuffer = await generateInvoicePdf({ invoice, items: invoice.items, customer, business });

  try {
    const delivery = await sendInvoiceEmail({
      to,
      invoice,
      customer: customer || { name: invoice.customer_name },
      business,
      publicUrl,
      pdfBuffer,
      db,
      userId: req.user.id
    });

    if (invoice.status === "draft") {
      db.prepare("UPDATE invoices SET status='sent', sent_at=COALESCE(sent_at, CURRENT_TIMESTAMP), updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?").run(invoice.id, req.user.id);
    }

    return json(res, 200, {
      delivery,
      email: delivery,
      publicUrl,
      invoice: getInvoice(db, req.user.id, invoice.id)
    });
  } catch (err) {
    return bad(res, `Failed to send email: ${err.message}`);
  }
}

function markPaid(req, res, db, invoice, body) {
  if (invoice.status === "cancelled") return bad(res, "Cancelled invoices cannot be marked as paid.");
  const amountCents = toCents(body.amount || fromCents(invoice.total_cents));
  if (amountCents <= 0 || amountCents > invoice.total_cents) return bad(res, "Payment amount must be positive and no more than the invoice total.", { amount: "Invalid amount." });
  
  db.prepare("INSERT INTO payments (user_id, invoice_id, payment_date, amount_cents, reference) VALUES (?, ?, ?, ?, ?)").run(
    req.user.id,
    invoice.id,
    body.paymentDate || new Date().toISOString().slice(0, 10),
    amountCents,
    body.reference || ""
  );
  db.prepare("UPDATE invoices SET status='paid', updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?").run(invoice.id, req.user.id);
  return json(res, 200, { invoice: getInvoice(db, req.user.id, invoice.id) });
}

function duplicateInvoice(req, res, db, invoice) {
  return saveInvoice(res, db, req.user.id, {
    customerId: invoice.customer_id,
    issueDate: new Date().toISOString().slice(0, 10),
    dueDate: invoice.due_date,
    status: "draft",
    discount: fromCents(invoice.discount_cents),
    notes: invoice.notes,
    paymentTerms: invoice.payment_terms,
    items: invoice.items.map((item) => ({
      description: item.description,
      quantity: item.quantity,
      unitPrice: fromCents(item.unit_price_cents),
      taxRate: basisPointsToPercent(item.tax_rate)
    }))
  });
}

function dashboard(res, db, userId) {
  const invoices = db.prepare("SELECT * FROM invoices WHERE user_id=? ORDER BY created_at DESC").all(userId).map((row) => ({ ...row, status: invoiceStatus(row) }));
  const month = new Date().toISOString().slice(0, 7);
  const paidThisMonth = db.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS total FROM payments WHERE user_id=? AND substr(payment_date,1,7)=?").get(userId, month).total;
  return json(res, 200, {
    metrics: {
      outstanding: invoices.filter((i) => ["sent", "overdue"].includes(i.status)).reduce((sum, i) => sum + i.total_cents, 0),
      paidThisMonth,
      overdue: invoices.filter((i) => i.status === "overdue").length,
      drafts: invoices.filter((i) => i.status === "draft").length
    },
    recentInvoices: invoices.slice(0, 5)
  });
}

function recurringRoute(req, res, db, parts, body) {
  const id = Number(parts[1]);
  if (req.method === "GET" && !id) {
    const rows = db.prepare("SELECT recurring_invoices.*, customers.name AS customer_name FROM recurring_invoices LEFT JOIN customers ON customers.id=recurring_invoices.customer_id WHERE recurring_invoices.user_id=? ORDER BY next_invoice_date").all(req.user.id);
    return json(res, 200, { recurringInvoices: rows.map((row) => ({ ...row, payload: JSON.parse(row.payload_json) })) });
  }
  if (req.method === "POST" && !id) {
    if (!["weekly", "monthly", "quarterly", "yearly"].includes(body.frequency)) return bad(res, "Choose a supported frequency.", { frequency: "Invalid frequency." });
    const customer = db.prepare("SELECT * FROM customers WHERE id=? AND user_id=? AND deleted_at IS NULL").get(body.customerId, req.user.id);
    if (!customer) return bad(res, "Select one of your saved customers.", { customerId: "Invalid customer." });
    const result = db.prepare("INSERT INTO recurring_invoices (user_id, customer_id, title, frequency, start_date, next_invoice_date, end_date, status, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)").run(req.user.id, body.customerId, body.title || `${customer.name} recurring invoice`, body.frequency, body.startDate, body.nextInvoiceDate || body.startDate, body.endDate || null, JSON.stringify(body));
    return json(res, 200, { recurringInvoice: db.prepare("SELECT * FROM recurring_invoices WHERE id=?").get(result.lastInsertRowid) });
  }
  if (req.method === "PUT") {
    if (!["active", "paused", "cancelled"].includes(body.status)) return bad(res, "Invalid recurring invoice status.", { status: "Invalid status." });
    const result = db.prepare("UPDATE recurring_invoices SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?").run(body.status, id, req.user.id);
    return result.changes ? json(res, 200, { success: true }) : json(res, 404, { error: { message: "Recurring invoice not found." } });
  }
  if (req.method === "DELETE") {
    const result = db.prepare("UPDATE recurring_invoices SET status='cancelled', updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?").run(id, req.user.id);
    return result.changes ? json(res, 200, { success: true }) : json(res, 404, { error: { message: "Recurring invoice not found." } });
  }
  return json(res, 404, { error: { message: "Not found." } });
}

function validateInvoice(body, db, userId) {
  const fields = {};
  if (!body.issueDate) fields.issueDate = "Issue date is required.";
  if (!body.dueDate) fields.dueDate = "Due date is required.";
  if (body.issueDate && body.dueDate && new Date(body.dueDate) < new Date(body.issueDate)) fields.dueDate = "Due date must be on or after issue date.";
  if (body.customerId && !db.prepare("SELECT id FROM customers WHERE id=? AND user_id=? AND deleted_at IS NULL").get(body.customerId, userId)) fields.customerId = "Select one of your saved customers.";
  
  const business = db.prepare("SELECT * FROM business_profiles WHERE user_id=?").get(userId);
  const rawItems = Array.isArray(body.items) ? body.items : [];
  if (!rawItems.length) fields.items = "Add at least one line item.";
  
  rawItems.forEach((item, index) => {
    if (!String(item.description || "").trim()) fields[`items.${index}.description`] = "Description is required.";
    if (Number(item.quantity) <= 0 || isNaN(Number(item.quantity))) fields[`items.${index}.quantity`] = "Quantity must be positive.";
    if (Number(item.unitPrice) < 0 || isNaN(Number(item.unitPrice))) fields[`items.${index}.unitPrice`] = "Price cannot be negative.";
  });

  if (Number(body.discount || 0) < 0) {
    fields.discount = "Discount cannot be negative.";
  }

  if (Object.keys(fields).length) return { fields };
  
  const items = rawItems.map((item) => ({
    ...item,
    taxRate: item.taxRate === "" || item.taxRate == null ? basisPointsToPercent(business.default_tax_rate) : item.taxRate
  }));

  return { business, totals: calculateInvoiceTotals(items, toCents(body.discount || 0)) };
}

function getInvoice(db, userId, id) {
  const invoice = db.prepare("SELECT invoices.*, customers.name AS customer_name, customers.email AS customer_email, customers.billing_address AS customer_billing_address, customers.phone AS customer_phone FROM invoices LEFT JOIN customers ON customers.id=invoices.customer_id WHERE invoices.id=? AND invoices.user_id=?").get(id, userId);
  if (!invoice) return null;
  invoice.status = invoiceStatus(invoice);
  invoice.items = db.prepare("SELECT * FROM invoice_items WHERE invoice_id=? ORDER BY position, id").all(id);
  invoice.payments = db.prepare("SELECT * FROM payments WHERE invoice_id=? ORDER BY payment_date DESC, id DESC").all(id);
  invoice.deliveries = db.prepare("SELECT * FROM email_logs WHERE invoice_id=? ORDER BY sent_at DESC").all(id);
  return invoice;
}

function nextInvoiceNumber(db, userId) {
  const profile = db.prepare("SELECT invoice_prefix,next_invoice_number FROM business_profiles WHERE user_id=?").get(userId);
  return `${profile.invoice_prefix || "INV-"}${String(profile.next_invoice_number || 1).padStart(4, "0")}`;
}

function invoiceStatus(invoice) {
  if (["paid", "draft", "cancelled"].includes(invoice.status)) return invoice.status;
  return new Date(invoice.due_date) < new Date(new Date().toISOString().slice(0, 10)) ? "overdue" : invoice.status;
}

function serveStatic(_req, res, url) {
  const clientRoot = path.join(__dirname, "..", "client");
  const safePath = path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, "");
  
  // Direct client routes like /invoice/:token or /login should serve index.html
  let filePath = path.join(clientRoot, safePath === "/" ? "index.html" : safePath);
  if (!filePath.startsWith(clientRoot) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory() || safePath.startsWith("invoice/")) {
    filePath = path.join(clientRoot, "index.html");
  }
  
  const ext = path.extname(filePath);
  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg"
  };
  res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    if (!["POST", "PUT", "PATCH"].includes(req.method)) return resolve({});
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 5_000_000) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function bad(res, message, fields = {}) {
  return json(res, 400, { error: { message, fields } });
}

function emailValid(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ""));
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function readCookie(req, name) {
  const match = String(req.headers.cookie || "").split(";").map((v) => v.trim()).find((v) => v.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : "";
}

function createSession(res, userId, db) {
  const token = crypto.randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + 14 * 86400000).toISOString();
  db.prepare("INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (?, ?, ?)").run(userId, hashToken(token), expires);
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${14 * 86400}`);
}

function getUserFromRequest(req) {
  const token = readCookie(req, COOKIE_NAME);
  if (!token) return null;
  const row = getDb().prepare("SELECT users.id, users.name, users.email FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.token_hash=? AND sessions.expires_at > datetime('now')").get(hashToken(token));
  return row || null;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(String(password), salt, 210000, 32, "sha256", (error, derived) => {
      if (error) reject(error);
      else resolve(`pbkdf2$${salt}$${derived.toString("hex")}`);
    });
  });
}

function verifyPassword(password, stored) {
  const [, salt, hash] = String(stored).split("$");
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(String(password), salt, 210000, 32, "sha256", (error, derived) => {
      if (error) reject(error);
      else resolve(crypto.timingSafeEqual(Buffer.from(hash, "hex"), derived));
    });
  });
}

module.exports = { createApp };
