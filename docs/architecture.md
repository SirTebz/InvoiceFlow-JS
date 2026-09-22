# InvoiceFlow Architecture

InvoiceFlow is a lightweight, zero-dependency Node.js HTTP application with a vanilla JavaScript single-page frontend. The backend owns authentication, cross-user authorization, financial calculations in integer minor units (cents), vector PDF generation, email delivery abstractions, public client links, view tracking, and SQLite persistence.

## Main Architecture Layers

- `client/`
  - `client/index.html`: Shell page with responsive viewport and toast notifications.
  - `client/css/styles.css`: Modern design system tokens, Clean/Professional/Minimal template themes, modal dialogs, and `@media print` layout.
  - `client/js/app.js`: SPA client routing, live document-style invoice editor, inline customer creation, public customer portal, and delivery inspector.
- `server/app.js`: HTTP request router, session cookie authentication, REST APIs, public client endpoints, and static file serving.
- `server/database/db.js`: SQLite schema migrations via Node.js built-in `node:sqlite`.
- `server/utils/money.js`: Exact integer minor unit (cents) arithmetic, currency formatting (ZAR, USD, EUR, GBP), and safe discount clamping.
- `server/services/pdfService.js`: High-quality vector PDF generator supporting custom branding, accent colours, Clean/Professional/Minimal templates, and multi-page pagination.
- `server/services/emailService.js`: Email delivery abstraction supporting local mock inspection and production SMTP configuration.
- `server/services/billingService.js`: Plan limits and subscription architecture.

## Delivery & Client Access Model (Phase 4)

1. **Public Token Security**:
   - Invoices generate a cryptographically random 32-byte base64url `public_token`.
   - Public URLs follow `/invoice/<public_token>` and call unauthenticated API `/api/public/invoices/<public_token>`.
   - The public endpoint returns strictly sanitized data (business branding, customer name/address, line items, breakdown, status, payment instructions) with **zero exposure** of user IDs, password hashes, or other accounts.
   - Nonexistent or random tokens return a secure 404.

2. **Email Delivery Abstraction**:
   - `MockEmailProvider`: For development (`EMAIL_PROVIDER=mock`). Captures generated HTML and plain-text emails in memory and `email_logs`, inspectable via the **Dev Emails** UI button.
   - `SmtpEmailProvider`: For production (`EMAIL_PROVIDER=smtp`). Uses standard configurable SMTP environment variables (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SECURE`, `EMAIL_FROM`) with graceful error handling.
   - Failed email sends log the error and do NOT falsely mark invoices as sent.

3. **Client View Tracking**:
   - Accessing a public invoice automatically records `first_viewed_at`, `last_viewed_at`, and increments `view_count`.
   - Business owners see real-time view activity on their internal invoice detail page.

4. **Payment Instructions**:
   - Business owners configure bank name, account holder, account number, branch code, and payment reference instructions in Settings.
   - These instructions are rendered consistently in the public portal, internal preview, and vector PDF.

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
