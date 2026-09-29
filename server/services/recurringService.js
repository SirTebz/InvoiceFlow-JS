/**
 * recurringService.js
 * Phase 7 — Recurring Invoice Generation
 *
 * All public functions are idempotent and safe to call multiple times.
 * Invoice creation is committed before email is attempted; email failure
 * does NOT roll back an already-created invoice.
 */

const crypto = require("crypto");
const { calculateInvoiceTotals, toCents, basisPointsToPercent } = require("../utils/money");
const { sendInvoiceEmail } = require("./emailService");
const config = require("../config");

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

/**
 * Returns today's date as a YYYY-MM-DD string in local server time.
 */
function todayString() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

/**
 * Returns a YYYY-MM-DD string clamped to the last day of the given month/year.
 * @param {number} year
 * @param {number} month  1-based (1=Jan … 12=Dec)
 * @param {number} day
 */
function clampDay(year, month, day) {
  const maxDay = new Date(year, month, 0).getDate(); // day=0 of next month = last day of this month
  const actual = Math.min(day, maxDay);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(actual).padStart(2, "0")}`;
}

/**
 * Calculate the next invoice date after `currentDateStr` for the given frequency.
 * Handles month-end clamping and leap-year awareness.
 *
 * @param {string} currentDateStr  YYYY-MM-DD
 * @param {"weekly"|"monthly"|"yearly"} frequency
 * @returns {string} YYYY-MM-DD
 */
function calculateNextInvoiceDate(currentDateStr, frequency) {
  if (!currentDateStr || typeof currentDateStr !== "string") {
    throw new Error("currentDateStr must be a YYYY-MM-DD string");
  }
  const [year, month, day] = currentDateStr.split("-").map(Number);

  switch (frequency) {
    case "weekly": {
      const d = new Date(Date.UTC(year, month - 1, day));
      d.setUTCDate(d.getUTCDate() + 7);
      return d.toISOString().slice(0, 10);
    }
    case "monthly": {
      let nextMonth = month + 1;
      let nextYear = year;
      if (nextMonth > 12) { nextMonth = 1; nextYear++; }
      return clampDay(nextYear, nextMonth, day);
    }
    case "yearly": {
      return clampDay(year + 1, month, day);
    }
    default:
      throw new Error(`Unsupported frequency: ${frequency}`);
  }
}

/**
 * Returns the billing_period key for a given schedule's next_invoice_date.
 * Used as the idempotency key in recurring_invoice_generations.
 * Simply returns the date string itself.
 *
 * @param {string} dateStr YYYY-MM-DD
 * @returns {string}
 */
function getBillingPeriod(dateStr) {
  return dateStr;
}

// ---------------------------------------------------------------------------
// Invoice creation from recurring schedule
// ---------------------------------------------------------------------------

/**
 * Internal helper: creates one invoice from a recurring schedule's payload_json.
 * Does NOT update next_invoice_date or insert into recurring_invoice_generations.
 * The caller is responsible for those steps inside a transaction guard.
 *
 * Returns the new invoice row.
 */
function createRecurringInvoice(db, schedule) {
  const payload = JSON.parse(schedule.payload_json);

  // Resolve business profile for currency and invoice numbering
  const business = db.prepare("SELECT * FROM business_profiles WHERE user_id=?").get(schedule.user_id);
  if (!business) throw new Error(`No business profile for user ${schedule.user_id}`);

  // Build items with tax fallback
  const rawItems = Array.isArray(payload.items) ? payload.items : [];
  if (!rawItems.length) throw new Error("Recurring schedule has no line items");

  const items = rawItems.map((item) => ({
    ...item,
    taxRate: (item.taxRate === "" || item.taxRate == null)
      ? basisPointsToPercent(business.default_tax_rate)
      : item.taxRate
  }));

  const totals = calculateInvoiceTotals(items, toCents(payload.discount || 0));

  // Assign invoice number
  const profile = db.prepare("SELECT invoice_prefix, next_invoice_number FROM business_profiles WHERE user_id=?").get(schedule.user_id);
  const invoiceNumber = `${profile.invoice_prefix || "INV-"}${String(profile.next_invoice_number || 1).padStart(4, "0")}`;

  const issueDate = todayString();
  const dueDays = payload.dueDays != null ? Number(payload.dueDays) : 30;
  const due = new Date(Date.UTC(...issueDate.split("-").map((n, i) => i === 1 ? Number(n) - 1 : Number(n))));
  due.setUTCDate(due.getUTCDate() + dueDays);
  const dueDate = due.toISOString().slice(0, 10);

  const publicToken = crypto.randomBytes(24).toString("base64url");

  const result = db.prepare(
    `INSERT INTO invoices
       (user_id, customer_id, invoice_number, issue_date, due_date, status, currency,
        discount_cents, subtotal_cents, tax_cents, total_cents, notes, payment_terms, public_token)
     VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    schedule.user_id,
    schedule.customer_id || null,
    invoiceNumber,
    issueDate,
    dueDate,
    business.currency || "ZAR",
    totals.discountCents,
    totals.subtotalCents,
    totals.taxCents,
    totals.totalCents,
    String(payload.notes || "").slice(0, 2000),
    String(payload.paymentTerms || "").slice(0, 2000),
    publicToken
  );

  const invoiceId = result.lastInsertRowid;

  // Insert line items
  totals.items.forEach((item) => {
    db.prepare(
      `INSERT INTO invoice_items
         (invoice_id, description, quantity, unit_price_cents, tax_rate,
          line_subtotal_cents, line_tax_cents, line_total_cents, position)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      invoiceId,
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

  // Advance invoice counter
  db.prepare("UPDATE business_profiles SET next_invoice_number=next_invoice_number+1 WHERE user_id=?").run(schedule.user_id);

  return db.prepare("SELECT * FROM invoices WHERE id=?").get(invoiceId);
}

// ---------------------------------------------------------------------------
// Main processing function
// ---------------------------------------------------------------------------

/**
 * Process all due recurring invoices.
 * Safe to call multiple times — idempotency is enforced via the
 * UNIQUE constraint on recurring_invoice_generations(recurring_invoice_id, billing_period).
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @returns {{ processed: number, skipped: number, errors: Array<{id: number, error: string}> }}
 */
async function processDueRecurringInvoices(db) {
  const today = todayString();

  // Only active schedules whose next_invoice_date is today or in the past
  const due = db.prepare(
    `SELECT * FROM recurring_invoices
     WHERE status='active' AND next_invoice_date <= ?`
  ).all(today);

  let processed = 0;
  let skipped = 0;
  const errors = [];

  for (const schedule of due) {
    const billingPeriod = getBillingPeriod(schedule.next_invoice_date);

    // Idempotency check: has this period already been generated?
    const existing = db.prepare(
      "SELECT id FROM recurring_invoice_generations WHERE recurring_invoice_id=? AND billing_period=?"
    ).get(schedule.id, billingPeriod);

    if (existing) {
      skipped++;
      continue;
    }

    let invoice;
    try {
      // Create the invoice
      invoice = createRecurringInvoice(db, schedule);

      // Record the generation (idempotency log)
      db.prepare(
        `INSERT INTO recurring_invoice_generations
           (recurring_invoice_id, invoice_id, billing_period)
         VALUES (?, ?, ?)`
      ).run(schedule.id, invoice.id, billingPeriod);

      // Advance the schedule's next_invoice_date
      const nextDate = calculateNextInvoiceDate(schedule.next_invoice_date, schedule.frequency);

      // Check whether the schedule is now complete
      let newStatus = "active";
      if (schedule.end_date && nextDate > schedule.end_date) {
        newStatus = "completed";
      }

      db.prepare(
        "UPDATE recurring_invoices SET next_invoice_date=?, status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?"
      ).run(nextDate, newStatus, schedule.id);

      processed++;
    } catch (err) {
      errors.push({ id: schedule.id, error: err.message });
      continue;
    }

    // Attempt email — failure does NOT roll back the invoice
    try {
      const customer = schedule.customer_id
        ? db.prepare("SELECT * FROM customers WHERE id=?").get(schedule.customer_id)
        : null;
      const business = db.prepare("SELECT * FROM business_profiles WHERE user_id=?").get(schedule.user_id);
      const recipientEmail = customer?.email || "";

      if (recipientEmail) {
        const publicUrl = `${config.appUrl}/invoice/${invoice.public_token}`;
        await sendInvoiceEmail({
          to: recipientEmail,
          invoice,
          customer: customer || { name: schedule.title },
          business,
          publicUrl,
          pdfBuffer: null // PDF generation is skipped for automated recurring emails to keep things lightweight
        });
      }
    } catch (emailErr) {
      // Email failure is non-fatal — invoice already committed
      console.warn(`[RecurringService] Email failed for invoice ${invoice.id} (schedule ${schedule.id}):`, emailErr.message);
    }
  }

  return { processed, skipped, errors };
}

module.exports = {
  calculateNextInvoiceDate,
  getBillingPeriod,
  processDueRecurringInvoices,
  todayString
};
