# InvoiceFlow Architecture

InvoiceFlow is a lightweight, zero-dependency Node.js HTTP application with a vanilla JavaScript single-page frontend. The backend owns authentication, cross-user authorization, financial calculations in integer minor units (cents), vector PDF generation, email delivery abstractions, PayFast online payments, public client links, view tracking, and SQLite persistence.

## Main Architecture Layers

- `client/`
  - `client/index.html`: Shell page with responsive viewport and toast notifications.
  - `client/css/styles.css`: Modern design system tokens, Clean/Professional/Minimal template themes, payment result banners, receipt cards, modal dialogs, and `@media print` layout.
  - `client/js/app.js`: SPA client routing, live document-style invoice editor, inline customer creation, public customer portal with PayFast redirect, and delivery inspector.
- `server/app.js`: HTTP request router, session cookie authentication, REST APIs, public client endpoints, PayFast ITN webhook, dev simulation endpoints, and static file serving.
- `server/database/db.js`: SQLite schema migrations via Node.js built-in `node:sqlite`.
- `server/utils/money.js`: Exact integer minor unit (cents) arithmetic, currency formatting (ZAR, USD, EUR, GBP), and safe discount clamping.
- `server/services/pdfService.js`: High-quality vector PDF generator supporting custom branding, accent colours, Clean/Professional/Minimal templates, and multi-page pagination.
- `server/services/emailService.js`: Email delivery abstraction supporting local mock inspection and production SMTP configuration.
- `server/services/paymentService.js`: Provider-agnostic payment abstraction handling payment requests and ITN webhook lifecycle.
- `server/services/providers/payfastProvider.js`: PayFast Standard Checkout implementation (MD5 signature generation & verification, form builder, and ITN verification).
- `server/services/recurringService.js`: Recurring billing engine: calendar interval math (weekly, monthly, yearly), idempotency enforcement via unique generation periods, invoice generation from templates, schedule advancement, and automated notification dispatch.
- `server/services/billingService.js`: Plan limits and subscription architecture.

## Online Payments & Verification Architecture (Phase 6)

### 1. Payment Abstraction & Lifecycle

```
PaymentService
    └── PaymentProvider
          └── PayFastProvider (server/services/providers/payfastProvider.js)
```

**Flow:**
1. **Customer opens public invoice:** `/invoice/<public_token>`
2. **Customer clicks "Pay Online":** Frontend calls `POST /api/public/invoices/<public_token>/pay`.
3. **Server validates & creates request:** Server verifies invoice is payable (`sent` or `overdue`), calculates authoritative amount from `invoice.total_cents`, generates a unique `m_payment_id` UUID, and creates a `payment_requests` record with status `pending`.
4. **PayFast form generation:** Server signs the payload using the business's PayFast passphrase and returns `{ actionUrl, fields }`.
5. **Customer redirected:** Browser dynamically submits the signed form to PayFast's hosted checkout.
6. **Customer completes payment:** PayFast processes payment and posts a server-to-server **Instant Transaction Notification (ITN)** to `POST /api/payments/notify`.
7. **Server-side ITN Verification:**
   - Verify PayFast MD5 signature against the business's stored passphrase.
   - Verify `merchant_id` matches the business profile.
   - Verify `amount_gross` matches expected `payment_requests.expected_amount_cents`.
   - Verify currency is ZAR.
   - Check idempotency: ensure `provider_payment_id` hasn't already been recorded.
8. **Record Payment & State Transition:**
   - If verified and `COMPLETE`: insert record into `payments` table with `provider='payfast'`, `provider_payment_id`, `provider_ref`, and `payment_method`.
   - Update `payment_requests.status = 'completed'`.
   - `UPDATE invoices SET status='paid'`.
   - Return HTTP `200 OK` to PayFast.
9. **Customer Return:** The customer returns to `/invoice/<public_token>?payment=success`. The page displays an official verified receipt once the ITN is processed, or a pending banner if processing.

> [!IMPORTANT]
> **Core Principle:** The browser return URL is **never** treated as proof of payment. Only a cryptographically verified server-to-server ITN can transition an invoice to `paid`.

### 2. Idempotency & Duplicate Protection

- The `payments` table includes a partial unique index on `provider_payment_id` (`WHERE provider_payment_id IS NOT NULL`).
- Duplicate notifications for the same PayFast transaction ID are acknowledged with HTTP `200 OK` without creating duplicate payments or corrupting invoice status.

### 3. Secret & Credential Handling

- PayFast Merchant ID, Merchant Key, and Passphrase are stored per-business in SQLite.
- `GET /api/business` returns `has_payfast` and `has_payfast_passphrase` flags, but **never leaks the raw passphrase** to the browser.

---

## Recurring Invoices & Automated Billing Architecture (Phase 7)

### 1. Architectural Model & Responsibilities

Recurring invoicing in InvoiceFlow represents **scheduled generation of standard payable invoices**, not automated debit pulls or credit card charging. Each generated invoice is a standard InvoiceFlow invoice with a public token, PDF generation capability, and full PayFast payment portal functionality.

```
Cron / Worker / Server Startup
           │
           ▼
POST /api/internal/recurring/process (Requires X-Internal-Key)
           │
           ▼
recurringService.processDueRecurringInvoices(db)
     ├── 1. Query active schedules where next_invoice_date <= today
     ├── 2. Check recurring_invoice_generations for existing billing_period (Idempotency)
     ├── 3. Create invoice with server-side totals, next invoice number & public token
     ├── 4. Record generation in recurring_invoice_generations
     ├── 5. Advance next_invoice_date (weekly, monthly, yearly with leap year / month-end clamping)
     ├── 6. Check end_date condition (transition to 'completed' if reached)
     └── 7. Dispatch client email (isolated try/catch; email error never rolls back invoice)
```

### 2. Idempotency & Database Integrity

Idempotency is guaranteed at the SQLite database constraint level:
- Table `recurring_invoice_generations`: `UNIQUE(recurring_invoice_id, billing_period)`.
- If the background worker or endpoint is triggered multiple times on the same date, SQLite constraint prevents duplicate invoice creation.

### 3. Calendar Math Rules

- **Weekly**: `current_date + 7 days`.
- **Monthly**: Clamped to month end (e.g., `2026-01-31` → `2026-02-28` in non-leap years, `2026-03-31` → `2026-04-30`).
- **Yearly**: Leap-year aware (`2024-02-29` → `2025-02-28`).

---

## Environment Variables

| Variable | Description | Default |
| :--- | :--- | :--- |
| `PORT` | HTTP server port | `3000` |
| `DATABASE_URL` | SQLite database file path | `./data/invoiceflow.sqlite` |
| `APP_URL` | Base public URL for client links | `http://localhost:3000` |
| `EMAIL_PROVIDER` | `mock` (development) or `smtp` (production) | `mock` |
| `EMAIL_FROM` | Outgoing sender email address | `InvoiceFlow <invoices@example.test>` |
| `SMTP_HOST` | Production SMTP hostname | `localhost` |
| `SMTP_PORT` | Production SMTP port | `587` |
| `SMTP_USER` | SMTP username / API key | `""` |
| `SMTP_PASSWORD` | SMTP password / secret | `""` |
| `SMTP_SECURE` | Enable TLS wrapper (`true` / `false`) | `false` |
| `PAYFAST_SANDBOX` | `true` for PayFast Sandbox (`https://sandbox.payfast.co.za`), `false` for live | `true` |
| `INTERNAL_KEY` | Secret key for internal cron/processing endpoints (`X-Internal-Key`) | `dev-internal-key` |
