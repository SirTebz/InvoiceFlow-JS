const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { DatabaseSync } = require("node:sqlite");
const config = require("../config");

let db;

function resolveDatabasePath(databaseUrl = config.databaseUrl) {
  if (databaseUrl === ":memory:") return databaseUrl;
  return path.resolve(process.cwd(), databaseUrl.replace(/^sqlite:/, ""));
}

function openDatabase(databaseUrl) {
  const filename = resolveDatabasePath(databaseUrl);
  if (filename !== ":memory:") fs.mkdirSync(path.dirname(filename), { recursive: true });
  db = new DatabaseSync(filename);
  db.exec("PRAGMA foreign_keys = ON");
  migrate();
  return db;
}

function getDb() {
  if (!db) return openDatabase();
  return db;
}

function addColumnIfNotExists(database, tableName, columnName, columnDef) {
  try {
    const columns = database.prepare(`PRAGMA table_info(${tableName})`).all();
    const exists = columns.some((col) => col.name === columnName);
    if (!exists) {
      database.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDef}`);
    }
  } catch (_e) {
    // Ignore migration error if already exists
  }
}

function migrate() {
  // Step 1: Create all core tables if they do not exist
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS business_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      business_name TEXT DEFAULT '',
      logo_data_url TEXT DEFAULT '',
      email TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      address TEXT DEFAULT '',
      website TEXT DEFAULT '',
      tax_number TEXT DEFAULT '',
      currency TEXT NOT NULL DEFAULT 'ZAR',
      default_tax_rate INTEGER NOT NULL DEFAULT 1500,
      payment_details TEXT DEFAULT '',
      invoice_prefix TEXT NOT NULL DEFAULT 'INV-',
      next_invoice_number INTEGER NOT NULL DEFAULT 1,
      accent_color TEXT NOT NULL DEFAULT '#2563eb',
      invoice_template TEXT NOT NULL DEFAULT 'clean',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      email TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      billing_address TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      deleted_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
      invoice_number TEXT NOT NULL,
      issue_date TEXT NOT NULL,
      due_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      currency TEXT NOT NULL DEFAULT 'ZAR',
      discount_cents INTEGER NOT NULL DEFAULT 0,
      subtotal_cents INTEGER NOT NULL DEFAULT 0,
      tax_cents INTEGER NOT NULL DEFAULT 0,
      total_cents INTEGER NOT NULL DEFAULT 0,
      notes TEXT DEFAULT '',
      payment_terms TEXT DEFAULT '',
      sent_at TEXT,
      cancelled_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, invoice_number)
    );

    CREATE TABLE IF NOT EXISTS invoice_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      description TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      unit_price_cents INTEGER NOT NULL,
      tax_rate INTEGER NOT NULL DEFAULT 0,
      line_subtotal_cents INTEGER NOT NULL,
      line_tax_cents INTEGER NOT NULL,
      line_total_cents INTEGER NOT NULL,
      position INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      payment_date TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      reference TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS email_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      recipient_email TEXT NOT NULL,
      provider TEXT NOT NULL,
      status TEXT NOT NULL,
      subject TEXT NOT NULL,
      body_text TEXT,
      body_html TEXT,
      public_url TEXT,
      error_message TEXT,
      sent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS recurring_invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      frequency TEXT NOT NULL,
      start_date TEXT NOT NULL,
      next_invoice_date TEXT NOT NULL,
      end_date TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      plan TEXT NOT NULL DEFAULT 'free',
      provider TEXT NOT NULL DEFAULT 'mock',
      status TEXT NOT NULL DEFAULT 'active',
      current_period_end TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Step 2: Ensure any columns added in later phases are added before indexes
  addColumnIfNotExists(db, "invoices", "public_token", "TEXT");
  addColumnIfNotExists(db, "invoices", "first_viewed_at", "TEXT");
  addColumnIfNotExists(db, "invoices", "last_viewed_at", "TEXT");
  addColumnIfNotExists(db, "invoices", "view_count", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfNotExists(db, "invoices", "delivery_status", "TEXT NOT NULL DEFAULT 'not_sent'");
  addColumnIfNotExists(db, "invoices", "last_delivered_at", "TEXT");

  // Step 3: Backfill any existing invoices that are missing a public_token
  try {
    const withoutToken = db.prepare("SELECT id FROM invoices WHERE public_token IS NULL OR public_token = ''").all();
    for (const row of withoutToken) {
      const token = crypto.randomBytes(24).toString("base64url");
      db.prepare("UPDATE invoices SET public_token=? WHERE id=?").run(token, row.id);
    }
  } catch (_err) {
    // Ignore
  }

  // Step 4: Create indexes safely after all columns exist
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_customers_user ON customers(user_id);
    CREATE INDEX IF NOT EXISTS idx_invoices_user ON invoices(user_id);
    CREATE INDEX IF NOT EXISTS idx_invoices_token ON invoices(public_token);
    CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
    CREATE INDEX IF NOT EXISTS idx_email_logs_invoice ON email_logs(invoice_id);
  `);
}

function closeDatabase() {
  if (db) db.close();
  db = null;
}

module.exports = { getDb, openDatabase, closeDatabase };
