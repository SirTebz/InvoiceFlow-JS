# InvoiceFlow

InvoiceFlow is a lightweight, zero-dependency invoicing application for freelancers, contractors, entrepreneurs, and small businesses. It helps users create professional invoices, send secure public links to clients, track views and email deliveries, and record payments effortlessly.

## Key Features

- **Authentication & Security**: PBKDF2 password hashing, secure cookie sessions, and cross-user data isolation.
- **Business Branding & Templates**: Custom business details, logo upload with live preview, accent colour picker, and 3 distinct invoice templates (*Clean*, *Professional*, *Minimal*).
- **Customer Directory**: Customer CRUD, search, and inline quick-creation directly inside the invoice editor without losing form state.
- **Document-Style Invoice Editor**: Live recalculation of subtotals, tax rates %, discounts, and grand totals; due date helper presets (*Due on receipt*, *Net 7*, *Net 14*, *Net 30*); draft vs. sent-ready save modes.
- **Vector PDF Generator**: Built-in vector PDF generator with support for custom branding, accent colours, Clean/Professional/Minimal styles, and automatic multi-page pagination with repeated table headers.
- **Client Public Portal**: Secure unauthenticated public URLs (`/invoice/<public_token>`) where clients can view invoices, check offline bank payment instructions, copy links, print, or download official PDFs.
- **Delivery & Activity Tracking**: Track whether an invoice is *Not Sent*, *Sent*, or *Failed*, along with client view tracking (`first_viewed_at`, `last_viewed_at`, `view_count`).
- **Email Delivery Service**: Modular email abstraction supporting development mock email inspection (`/api/dev/emails`) and production SMTP delivery.
- **Payments & Dashboard**: Record partial or full payments, track outstanding vs paid metrics, and manage recurring retainer schedules.

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

Executes 21 automated tests covering authentication, customers, financial calculations, multi-page vector PDF generation, public client access, view tracking, delivery logging, and security isolation.
