# InvoiceFlow

InvoiceFlow is a lightweight, zero-dependency invoicing application for freelancers, contractors, entrepreneurs, and small businesses. It helps users create professional invoices, send secure public links to clients, accept online payments via PayFast, track views and email deliveries, and record payments effortlessly.

## Key Features

- **Authentication & Security**: PBKDF2 password hashing, secure cookie sessions, and cross-user data isolation.
- **Business Branding & Templates**: Custom business details, logo upload with live preview, accent colour picker, and 3 distinct invoice templates (*Clean*, *Professional*, *Minimal*).
- **Customer Directory**: Customer CRUD, search, and inline quick-creation directly inside the invoice editor without losing form state.
- **Document-Style Invoice Editor**: Live recalculation of subtotals, tax rates %, discounts, and grand totals; due date helper presets (*Due on receipt*, *Net 7*, *Net 14*, *Net 30*); draft vs. sent-ready save modes.
- **Vector PDF Generator**: Built-in vector PDF generator with support for custom branding, accent colours, Clean/Professional/Minimal styles, and automatic multi-page pagination with repeated table headers.
- **Client Public Portal & Online Payments**: Secure unauthenticated public URLs (`/invoice/<public_token>`) where clients can view invoices, pay directly via **PayFast** (Credit Card / Debit Card / Instant EFT), check offline banking instructions, copy links, print, or download official PDFs.
- **Payment Verification & Security**: Provider-agnostic payment abstraction with full Instant Transaction Notification (ITN) webhook processing, MD5 signature verification, server-side amount & currency matching, and database-level idempotency protection.
- **Delivery & Activity Tracking**: Track whether an invoice is *Not Sent*, *Sent*, or *Failed*, along with client view tracking (`first_viewed_at`, `last_viewed_at`, `view_count`).
- **Recurring Invoices & Automated Billing**: Set up weekly, monthly, and yearly recurring schedules for retainer clients. Features idempotent automated invoice generation, leap-year and month-end date calculation, schedule advancement, automated notification emails, protected internal execution endpoint (`POST /api/internal/recurring/process`), and schedule generation history.
- **Email Delivery Service**: Modular email abstraction supporting development mock email inspection (`/api/dev/emails`) and production SMTP delivery.
- **Payments & Dashboard**: Verified payments update outstanding vs paid metrics, record transaction IDs, and reflect in invoice payment history.

## Stack

- **Frontend**: HTML, CSS, vanilla JavaScript (SPA, responsive at 390px, 768px, 1440px, `@media print` layout).
- **Backend**: Node.js built-in HTTP server (`http`, `crypto`, `net`, `tls`). Zero external npm dependencies.
- **Database**: SQLite through Node.js built-in `node:sqlite` module.

## Getting Started

```bash
copy .env.example .env
npm run dev
```

Open `http://localhost:3000` in your browser.

## Running Tests

```bash
npm test
```

Executes 40 automated tests covering authentication, customers, financial calculations, multi-page vector PDF generation, public client access, PayFast online payments, ITN signature and amount verification, idempotency, recurring billing engine, leap year & month-end date transitions, schedule lifecycle, view tracking, delivery logging, server-side validation bounds, and security isolation.
