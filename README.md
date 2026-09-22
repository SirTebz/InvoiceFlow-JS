# InvoiceFlow

InvoiceFlow is a lightweight invoicing MVP for freelancers, contractors, entrepreneurs, and small businesses. It helps a user create invoices, send or download them, track status, and record payment without becoming a full accounting system.

## Features

- Register, log in, log out, and maintain secure cookie sessions.
- Configure a business profile, invoice numbering, branding color, tax rate, and payment details.
- Create, edit, search, and soft-delete customers.
- Create invoices with dynamic line items, tax, discount, notes, and payment terms.
- Server-side invoice calculations using cents.
- Invoice list, preview, statuses, PDF download, mock email send flow, and mark-as-paid payment tracking.
- Basic recurring invoice templates with pause, resume, and cancel behavior.
- Subscription architecture with free/pro plan configuration and mock billing mode.

## Stack

- Frontend: HTML, CSS, vanilla JavaScript.
- Backend: Node.js built-in HTTP server.
- Database: SQLite through Node's built-in `node:sqlite` module.
- PDF: Local lightweight PDF generator.
- Auth: PBKDF2 password hashing plus SQLite-backed session cookies.

## Setup

```bash
copy .env.example .env
npm run dev
```

There are currently no external npm dependencies. If PowerShell blocks `npm`, use `npm.cmd`.

Open `http://localhost:3000`.

## Environment

See `.env.example` for available settings.

- `DATABASE_URL` defaults to `./data/invoiceflow.sqlite`.
- `EMAIL_PROVIDER=mock` prevents real email delivery in local development.
- `BILLING_PROVIDER=mock` keeps subscription behavior local and explicit.
- `SESSION_SECRET` should be changed before any hosted deployment.

## Tests

```bash
npm test
```

The tests cover authentication, customer CRUD, invoice calculations, payment status updates, ownership isolation, PDF/mock email, search/filtering, and recurring invoice status changes.

## Production Notes

Before production use, configure a strong session secret, add a real email provider behind `server/services/emailService.js`, review hosting cookie settings, add backup/restore for SQLite or migrate to PostgreSQL, and connect a real billing provider behind `server/services/billingService.js`.
