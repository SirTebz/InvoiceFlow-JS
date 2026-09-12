# InvoiceFlow Architecture

InvoiceFlow is a small Express application with a vanilla JavaScript single-page frontend. The backend owns authentication, authorization, financial calculations, PDF generation, mock email sending, subscription state, and SQLite persistence.

## Main Parts

- `client/` contains the browser UI, styles, and single-page app logic.
- `server/routes/api.js` exposes the REST API.
- `server/database/db.js` owns the reproducible SQLite schema.
- `server/utils/money.js` handles cents-based invoice calculations.
- `server/services/pdfService.js` creates invoice PDFs locally.
- `server/services/emailService.js` isolates email provider behavior and defaults to safe mock mode.
- `server/services/billingService.js` centralizes plan configuration.

## Data Rules

All user-owned resources include `user_id`, and routes query through the authenticated user. Customers are soft deleted so historical invoices are not destroyed. Invoice totals are recalculated server-side from line items and stored as cents.

## Development Modes

Email and billing default to `mock`. Mock email prepares a PDF-backed email response but does not deliver real messages. Production providers can be added behind the existing service modules.
