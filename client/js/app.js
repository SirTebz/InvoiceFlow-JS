const state = {
  user: null,
  route: getInitialRoute(),
  publicToken: getInitialPublicToken(),
  customers: [],
  invoices: [],
  business: null,
  editingInvoice: null,
  customerSearch: "",
  invoiceSearch: "",
  invoiceStatus: "",
  modal: null // { type: 'customer' | 'send' | 'paid' | 'cancel' | 'devEmails', data: ... }
};

const app = document.querySelector("#app");
const toast = document.querySelector("#toast");

function getInitialRoute() {
  const path = location.pathname;
  if (path.startsWith("/invoice/")) return "public-invoice";
  const hash = location.hash.replace("#", "");
  if (hash.startsWith("public-invoice-")) return "public-invoice";
  return hash || "landing";
}

function getInitialPublicToken() {
  const path = location.pathname;
  if (path.startsWith("/invoice/")) return path.replace("/invoice/", "").split("/")[0];
  const hash = location.hash.replace("#", "");
  if (hash.startsWith("public-invoice-")) return hash.replace("public-invoice-", "");
  return "";
}

function money(cents, currency = "ZAR") {
  const amount = (Number(cents) || 0) / 100;
  const curr = String(currency || state.business?.currency || "ZAR").toUpperCase();
  try {
    const localeMap = { ZAR: "en-ZA", USD: "en-US", EUR: "de-DE", GBP: "en-GB" };
    return new Intl.NumberFormat(localeMap[curr] || "en-ZA", {
      style: "currency",
      currency: curr,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  } catch (_e) {
    return `${curr} ${amount.toFixed(2)}`;
  }
}

const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    credentials: "same-origin",
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: { message: "Network error." } }));
    throw error;
  }
  const type = response.headers.get("content-type") || "";
  return type.includes("application/json") ? response.json() : response.blob();
}

function showToast(message) {
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 3400);
}

function navigate(route, token = "") {
  state.route = route;
  state.publicToken = token;
  if (route === "public-invoice" && token) {
    location.hash = `public-invoice-${token}`;
  } else {
    location.hash = route;
  }
  state.modal = null;
  render();
}

window.addEventListener("hashchange", () => {
  state.route = getInitialRoute();
  state.publicToken = getInitialPublicToken();
  state.modal = null;
  render();
});

function shell(content) {
  if (state.route === "public-invoice") return content;
  if (!state.user) return `${publicNav()}${content}${renderModal()}`;
  
  const tabs = [
    ["dashboard", "Dashboard"],
    ["invoices", "Invoices"],
    ["customers", "Customers"],
    ["recurring", "Recurring"],
    ["settings", "Settings"]
  ];
  return `
    <header class="topbar">
      <div class="brand" data-nav="dashboard"><span class="mark">IF</span> InvoiceFlow</div>
      <nav class="nav">
        ${tabs.map(([id, label]) => `<button class="${state.route === id || (id === "invoices" && state.route.startsWith("invoice")) ? "active" : ""}" data-nav="${id}">${label}</button>`).join("")}
      </nav>
      <div class="userbar">
        <button class="btn secondary small" id="btnDevEmails" title="Inspect recent development mock emails">📧 Dev Emails</button>
        <span>${escapeHtml(state.user.name)}</span>
        <button class="btn secondary small" id="logoutBtn">Log out</button>
      </div>
    </header>
    <main class="container">${content}</main>
    ${renderModal()}`;
}

function publicNav() {
  return `
    <header class="topbar">
      <div class="brand" data-nav="landing"><span class="mark">IF</span> InvoiceFlow</div>
      <nav class="nav">
        <button data-nav="landing">Home</button>
        <button data-nav="login">Log in</button>
        <button class="btn primary" data-nav="register">Register</button>
      </nav>
    </header>`;
}

function landing() {
  return `
    <main class="container">
      <section class="hero">
        <div>
          <h1>Simple, Professional Invoicing for Modern Freelancers</h1>
          <p>Create elegant invoices in seconds, send secure public links to clients, download vector PDFs, track payments and invoice views effortlessly.</p>
          <div class="actions">
            <button class="btn primary" data-nav="register">Get Started Free</button>
            <button class="btn secondary" data-nav="login">Sign In</button>
          </div>
        </div>
        <div class="hero-visual">
          <div class="invoice-paper">
            <div class="paper-head">
              <div><strong>Studio North</strong><br><span class="muted" style="font-size:12px">Web & Brand Design</span></div>
              <strong style="color:var(--primary)">INV-0042</strong>
            </div>
            <div class="paper-lines">
              <div class="paper-line"><span class="skeleton"></span><span class="skeleton"></span><span class="skeleton"></span></div>
              <div class="paper-line"><span class="skeleton"></span><span class="skeleton"></span><span class="skeleton"></span></div>
              <div class="paper-line"><span class="skeleton"></span><span class="skeleton"></span><span class="skeleton"></span></div>
            </div>
            <div class="totals" style="margin-top:60px">
              <div><span>Subtotal</span><strong>R 12,000.00</strong></div>
              <div><span>VAT (15%)</span><strong>R 1,800.00</strong></div>
              <div class="grand"><span>Total Due</span><strong>R 13,800.00</strong></div>
            </div>
          </div>
        </div>
      </section>
      <section class="grid two" style="margin-top:20px">
        <div class="card">
          <h2>Free Plan</h2>
          <strong style="font-size:24px">R0 / month</strong>
          <p class="muted" style="margin-top:8px">Clean document editor, customer directory, secure public client links, vector PDF exports, live preview, and payment tracking.</p>
        </div>
        <div class="card">
          <h2>Pro Plan</h2>
          <strong style="font-size:24px">Subscription</strong>
          <p class="muted" style="margin-top:8px">Custom branding, multiple invoice templates, email delivery tracking, view tracking, and recurring retainers.</p>
        </div>
      </section>
    </main>`;
}

function authView(mode) {
  const isRegister = mode === "register";
  return shell(`
    <section class="auth-panel card" style="max-width:440px; margin:48px auto;">
      <h1 style="font-size:24px; margin-bottom:8px">${isRegister ? "Create your account" : "Welcome back"}</h1>
      <p class="muted" style="margin-bottom:20px">${isRegister ? "Sign up to start creating and delivering professional invoices." : "Enter your credentials to access your dashboard."}</p>
      <form class="form" id="${mode}Form">
        ${isRegister ? field("name", "Full Name", "text", "", "e.g. Alex Morgan") : ""}
        ${field("email", "Email Address", "email", "", "name@business.com")}
        ${passwordField("password", "Password")}
        ${isRegister ? passwordField("confirmPassword", "Confirm Password") : ""}
        <button class="btn primary" style="width:100%; margin-top:8px">${isRegister ? "Create Account" : "Sign In"}</button>
        <button type="button" class="link-button" style="width:100%; text-align:center" data-nav="${isRegister ? "login" : "register"}">
          ${isRegister ? "Already have an account? Sign in" : "Need an account? Sign up"}
        </button>
      </form>
    </section>`);
}

function field(name, label, type = "text", value = "", placeholder = "") {
  return `
    <div class="field">
      <label for="${name}">${label}</label>
      <input id="${name}" name="${name}" type="${type}" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}">
      <span class="error" data-error="${name}"></span>
    </div>`;
}

function passwordField(name, label) {
  return `
    <div class="field">
      <label for="${name}">${label}</label>
      <div class="password-wrap">
        <input id="${name}" name="${name}" type="password">
        <button type="button" class="btn secondary small" data-toggle-password="${name}" aria-label="Show ${label.toLowerCase()}">Show</button>
      </div>
      <span class="error" data-error="${name}"></span>
    </div>`;
}

function textArea(name, label, value = "", placeholder = "") {
  return `
    <div class="field">
      <label for="${name}">${label}</label>
      <textarea id="${name}" name="${name}" placeholder="${escapeHtml(placeholder)}">${escapeHtml(value)}</textarea>
      <span class="error" data-error="${name}"></span>
    </div>`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]));
}

async function loadCustomers(options = {}) {
  const useSearch = options.useSearch !== false;
  const query = useSearch && state.customerSearch ? `?search=${encodeURIComponent(state.customerSearch)}` : "";
  state.customers = (await api(`/customers${query}`)).customers;
}

async function loadInvoices() {
  const params = new URLSearchParams();
  if (state.invoiceSearch) params.set("search", state.invoiceSearch);
  if (state.invoiceStatus) params.set("status", state.invoiceStatus);
  const query = params.toString() ? `?${params}` : "";
  state.invoices = (await api(`/invoices${query}`)).invoices;
}

async function dashboard() {
  const [data, bizData] = await Promise.all([api("/dashboard"), api("/business")]);
  state.business = bizData.profile;
  const curr = state.business?.currency || "ZAR";

  const rows = data.recentInvoices.map(invoiceRow).join("") || `<tr><td colspan="7" class="empty">No invoices created yet.</td></tr>`;
  return shell(`
    <div class="section-title">
      <div>
        <h1>Dashboard</h1>
        <p class="muted">Overview of your business cashflow and recent activity.</p>
      </div>
      <button class="btn primary" data-nav="invoice-new">+ Create Invoice</button>
    </div>
    <section class="grid four">
      ${metric("Outstanding", money(data.metrics.outstanding, curr))}
      ${metric("Paid this month", money(data.metrics.paidThisMonth, curr))}
      ${metric("Overdue", data.metrics.overdue)}
      ${metric("Drafts", data.metrics.drafts)}
    </section>
    <div class="section-title" style="margin-top:36px; margin-bottom:16px">
      <h2>Recent Invoices</h2>
      <button class="btn secondary small" data-nav="invoices">View All</button>
    </div>
    ${invoiceTable(rows)}`);
}

function metric(label, value) {
  return `<div class="card metric"><span class="muted">${label}</span><strong>${value}</strong></div>`;
}

async function customersView() {
  await loadCustomers({ useSearch: true });
  const rows = state.customers.map((c) => `
    <tr>
      <td><strong>${escapeHtml(c.name)}</strong><br><span class="muted">${escapeHtml(c.email || "No email")}</span></td>
      <td>${escapeHtml(c.phone || "—")}</td>
      <td>${escapeHtml(c.billing_address || "—")}</td>
      <td class="actions">
        <button class="btn secondary small" data-edit-customer="${c.id}">Edit</button>
        <button class="btn danger small" data-delete-customer="${c.id}">Delete</button>
      </td>
    </tr>`).join("") || `
    <tr>
      <td colspan="4">
        <div class="empty-state">
          <div class="icon">👥</div>
          <h3>No customers found</h3>
          <p>${state.customerSearch ? "Try adjusting your search term." : "Add your first customer to quickly select them when creating invoices."}</p>
          <button class="btn primary small" data-open-customer-modal>+ Add Customer</button>
        </div>
      </td>
    </tr>`;

  return shell(`
    <div class="section-title">
      <div>
        <h1>Customers</h1>
        <p class="muted">Manage customer contact details and billing addresses.</p>
      </div>
      <button class="btn primary" data-open-customer-modal>+ Add Customer</button>
    </div>
    <div class="toolbar">
      <input id="customerSearch" type="search" placeholder="Search customers by name or email..." value="${escapeHtml(state.customerSearch)}">
      ${state.customerSearch ? `<button class="btn secondary" id="clearCustomerSearch">Clear</button>` : ""}
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Customer / Email</th><th>Phone</th><th>Billing Address</th><th>Actions</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`);
}

async function invoicesView() {
  await Promise.all([loadInvoices(), api("/business").then((d) => state.business = d.profile)]);
  const statuses = ["", "draft", "sent", "paid", "overdue", "cancelled"];
  const statusLabels = { "": "All Invoices", draft: "Draft", sent: "Sent", paid: "Paid", overdue: "Overdue", cancelled: "Cancelled" };

  const rows = state.invoices.map(invoiceRow).join("") || `
    <tr>
      <td colspan="7">
        <div class="empty-state">
          <div class="icon">📄</div>
          <h3>${state.invoiceSearch || state.invoiceStatus ? "No matching invoices found" : "You haven't created any invoices yet"}</h3>
          <p>${state.invoiceSearch || state.invoiceStatus ? "Try changing your filter criteria or search keyword." : "Create and send your first professional invoice today."}</p>
          <button class="btn primary small" data-nav="invoice-new">+ Create your first invoice</button>
        </div>
      </td>
    </tr>`;

  return shell(`
    <div class="section-title">
      <div>
        <h1>Invoices</h1>
        <p class="muted">Track, manage, duplicate, and download your invoices.</p>
      </div>
      <button class="btn primary" data-nav="invoice-new">+ Create Invoice</button>
    </div>
    <div class="toolbar">
      <div class="filter-tabs">
        ${statuses.map((st) => `<button class="filter-tab ${state.invoiceStatus === st ? "active" : ""}" data-filter-status="${st}">${statusLabels[st]}</button>`).join("")}
      </div>
      <div style="display:flex; gap:8px;">
        <input id="invoiceSearch" type="search" placeholder="Search by number or customer..." value="${escapeHtml(state.invoiceSearch)}">
        ${state.invoiceSearch ? `<button class="btn secondary" id="clearInvoiceFilters">Clear</button>` : ""}
      </div>
    </div>
    ${invoiceTable(rows)}`);
}

function invoiceTable(rows) {
  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Invoice</th><th>Customer</th><th>Issue Date</th><th>Due Date</th><th>Total</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function invoiceRow(i) {
  const isPaidOrCancelled = ["paid", "cancelled"].includes(i.status);
  return `
    <tr>
      <td><strong>${escapeHtml(i.invoice_number)}</strong></td>
      <td>${escapeHtml(i.customer_name || "No Customer")}</td>
      <td>${i.issue_date}</td>
      <td>${i.due_date}</td>
      <td><strong>${money(i.total_cents, i.currency)}</strong></td>
      <td><span class="badge ${i.status}">${i.status}</span></td>
      <td class="actions">
        <button class="btn secondary small" data-view-invoice="${i.id}">View</button>
        ${!isPaidOrCancelled ? `<button class="btn secondary small" data-edit-invoice="${i.id}">Edit</button>` : ""}
        <button class="btn secondary small" data-pdf="${i.id}" title="Download PDF">PDF</button>
        ${i.status === "draft" ? `<button class="btn secondary small" data-open-send="${i.id}">Send</button>` : ""}
        ${!["paid", "cancelled"].includes(i.status) ? `<button class="btn secondary small" data-open-paid="${i.id}">Pay</button>` : ""}
      </td>
    </tr>`;
}

async function invoiceEditor(id) {
  const [bizData] = await Promise.all([
    api("/business").then((d) => state.business = d.profile),
    loadCustomers({ useSearch: false })
  ]);

  let invoice = null;
  if (id) {
    const invData = await api(`/invoices/${id}`);
    invoice = invData.invoice;
  }

  const nextNumber = id ? invoice.invoice_number : (await api("/invoices/next-number")).invoiceNumber;
  const items = invoice?.items?.length
    ? invoice.items.map((item) => ({
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unit_price_cents / 100,
        taxRate: item.tax_rate / 100
      }))
    : [{ description: "", quantity: 1, unitPrice: 0, taxRate: state.business.default_tax_rate }];

  const selectedCustomer = invoice?.customer_id ? state.customers.find((c) => c.id === Number(invoice.customer_id)) : null;

  return shell(`
    <div class="section-title">
      <div>
        <button class="btn secondary small" style="margin-bottom:8px" data-nav="invoices">← Back to Invoices</button>
        <h1>${id ? `Edit Invoice (${invoice.invoice_number})` : "New Invoice"}</h1>
        <p class="muted">Fill in your invoice details. Totals recalculate automatically.</p>
      </div>
      <div class="actions">
        ${id ? `<button type="button" class="btn secondary" data-view-invoice="${id}">Preview</button>` : ""}
        <button type="button" class="btn secondary" form="invoiceForm" name="intent" value="draft" id="btnSaveDraft">Save Draft</button>
        <button type="submit" class="btn primary" form="invoiceForm" name="intent" value="sent" id="btnSaveSent">Save & Send-ready</button>
      </div>
    </div>
    
    <form class="form" id="invoiceForm" data-id="${id || ""}">
      <div class="grid two">
        <!-- Customer Box -->
        <section class="card">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
            <h2 style="font-size:16px; margin:0">Bill To Customer</h2>
            <button type="button" class="btn secondary small" id="btnInlineNewCustomer">+ New Customer</button>
          </div>
          <div class="field">
            <select id="customerId" name="customerId">
              <option value="">Select a saved customer...</option>
              ${state.customers.map((c) => `<option value="${c.id}" ${Number(invoice?.customer_id) === c.id ? "selected" : ""}>${escapeHtml(c.name)} ${c.email ? `(${escapeHtml(c.email)})` : ""}</option>`).join("")}
            </select>
            <span class="error" data-error="customerId"></span>
          </div>
          <div id="customerInfoPreview" class="customer-info-card" style="${selectedCustomer ? "" : "display:none;"}">
            <strong>${escapeHtml(selectedCustomer?.name || "")}</strong>
            <span>${escapeHtml(selectedCustomer?.email || "")}</span>
            <span>${escapeHtml(selectedCustomer?.billing_address || "")}</span>
          </div>
        </section>

        <!-- Invoice Details Box -->
        <section class="card">
          <h2 style="font-size:16px; margin-bottom:12px">Invoice Details</h2>
          <div class="grid two">
            ${field("invoiceNumber", "Invoice Number", "text", nextNumber)}
            <div class="field">
              <label for="issueDate">Issue Date</label>
              <input id="issueDate" name="issueDate" type="date" value="${invoice?.issue_date || today()}">
              <span class="error" data-error="issueDate"></span>
            </div>
          </div>
          <div class="field" style="margin-top:8px">
            <label for="dueDate">Due Date</label>
            <input id="dueDate" name="dueDate" type="date" value="${invoice?.due_date || plusDays(30)}">
            <div class="date-presets">
              <button type="button" data-preset-due="0">Due on receipt</button>
              <button type="button" data-preset-due="7">Net 7</button>
              <button type="button" data-preset-due="14">Net 14</button>
              <button type="button" data-preset-due="30">Net 30</button>
            </div>
            <span class="error" data-error="dueDate"></span>
          </div>
        </section>
      </div>

      <!-- Line Items Section -->
      <section class="card">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
          <h2 style="font-size:16px; margin:0">Line Items</h2>
          <span class="muted" style="font-size:12px">Default Tax Rate: ${state.business?.default_tax_rate || 15}%</span>
        </div>
        <div class="items-table-header">
          <span>Description</span>
          <span>Qty</span>
          <span>Unit Price (${state.business?.currency || "ZAR"})</span>
          <span>Tax %</span>
          <span style="text-align:right">Line Total</span>
          <span></span>
        </div>
        <div id="itemsContainer">
          ${items.map(itemForm).join("")}
        </div>
        <button type="button" class="btn secondary small" id="addItem" style="margin-top:12px">+ Add Line Item</button>
        <span class="error" data-error="items" style="display:block; margin-top:8px"></span>
      </section>

      <!-- Totals & Notes Section -->
      <div class="grid two">
        <section class="card">
          <h2 style="font-size:16px; margin-bottom:12px">Notes & Payment Terms</h2>
          ${textArea("paymentTerms", "Payment Terms", invoice?.payment_terms || state.business?.payment_details || "Payment due within 30 days of invoice date.", "e.g. Bank transfer info")}
          <div style="margin-top:12px">
            ${textArea("notes", "Customer Notes", invoice?.notes || "Thank you for your business!", "Additional notes or instructions")}
          </div>
        </section>

        <section class="card" style="display:flex; flex-direction:column; justify-content:space-between;">
          <div>
            <h2 style="font-size:16px; margin-bottom:12px">Summary</h2>
            <div class="field" style="margin-bottom:16px">
              <label for="discount">Discount (${state.business?.currency || "ZAR"})</label>
              <input id="discount" name="discount" type="number" min="0" step="0.01" value="${invoice ? invoice.discount_cents / 100 : 0}" placeholder="0.00">
              <span class="error" data-error="discount"></span>
            </div>
            <div class="totals" id="totals"></div>
          </div>
          <div class="actions" style="margin-top:24px; justify-content:flex-end;">
            <button type="button" class="btn secondary" data-nav="invoices">Cancel</button>
            <button type="submit" class="btn primary">Save Invoice</button>
          </div>
        </section>
      </div>
    </form>`);
}

function itemForm(item = {}) {
  return `
    <div class="item-row" data-item>
      <input class="wide" name="description" placeholder="Item or service description" value="${escapeHtml(item.description)}">
      <input name="quantity" type="number" min="1" step="1" value="${item.quantity || 1}" placeholder="1">
      <input name="unitPrice" type="number" min="0" step="0.01" value="${item.unitPrice ?? 0}" placeholder="0.00">
      <input name="taxRate" type="number" min="0" step="0.01" value="${item.taxRate ?? (state.business?.default_tax_rate || 15)}" placeholder="15">
      <strong data-line-total>R 0.00</strong>
      <button type="button" class="btn danger small" data-remove-item title="Remove line item">✕</button>
    </div>`;
}

function calculateClientInvoice() {
  const rows = [...document.querySelectorAll("[data-item]")];
  const curr = state.business?.currency || "ZAR";
  let subtotalCents = 0;
  let taxCents = 0;

  rows.forEach((row) => {
    const qty = Math.max(1, Math.round(Number(row.querySelector("[name=quantity]")?.value || 1)));
    const priceVal = Number(row.querySelector("[name=unitPrice]")?.value || 0);
    const unitPriceCents = Math.max(0, Math.round(priceVal * 100));
    const rateVal = Number(row.querySelector("[name=taxRate]")?.value || 0);
    const taxRateBps = Math.max(0, Math.round(rateVal * 100));

    const lineSubtotalCents = qty * unitPriceCents;
    const lineTaxCents = Math.round((lineSubtotalCents * taxRateBps) / 10000);
    const lineTotalCents = lineSubtotalCents + lineTaxCents;

    row.querySelector("[data-line-total]").textContent = money(lineTotalCents, curr);
    subtotalCents += lineSubtotalCents;
    taxCents += lineTaxCents;
  });

  const discountVal = Number(document.querySelector("[name=discount]")?.value || 0);
  const discountCents = Math.max(0, Math.round(discountVal * 100));
  const safeDiscountCents = Math.min(discountCents, subtotalCents + taxCents);
  const totalCents = Math.max(0, subtotalCents + taxCents - safeDiscountCents);

  const totalsContainer = document.querySelector("#totals");
  if (totalsContainer) {
    totalsContainer.innerHTML = `
      <div><span>Subtotal</span><strong>${money(subtotalCents, curr)}</strong></div>
      <div><span>Tax</span><strong>${money(taxCents, curr)}</strong></div>
      ${safeDiscountCents > 0 ? `<div><span>Discount</span><strong>-${money(safeDiscountCents, curr)}</strong></div>` : ""}
      <div class="grand"><span>Total Due</span><strong>${money(totalCents, curr)}</strong></div>`;
  }
}

async function invoiceDetail(id) {
  const [invoiceData, businessData, linkData] = await Promise.all([
    api(`/invoices/${id}`),
    api("/business"),
    api(`/invoices/${id}/public-link`)
  ]);

  const invoice = invoiceData.invoice;
  state.business = businessData.profile;
  const template = state.business.invoice_template || "clean";
  const accent = state.business.accent_color || "#2563eb";
  const curr = invoice.currency || "ZAR";
  const publicUrl = linkData.publicUrl;

  const customer = {
    name: invoice.customer_name || "Valued Customer",
    email: invoice.customer_email || "",
    billing_address: invoice.customer_billing_address || "",
    phone: invoice.customer_phone || ""
  };

  const items = invoice.items.map((item) => `
    <tr>
      <td><strong>${escapeHtml(item.description)}</strong></td>
      <td>${item.quantity}</td>
      <td>${money(item.unit_price_cents, curr)}</td>
      <td>${item.tax_rate / 100}%</td>
      <td style="text-align:right"><strong>${money(item.line_total_cents, curr)}</strong></td>
    </tr>`).join("");

  const isPaid = invoice.status === "paid";
  const isCancelled = invoice.status === "cancelled";

  return shell(`
    <div class="section-title">
      <div>
        <button class="btn secondary small" style="margin-bottom:8px" data-nav="invoices">← Back to Invoices</button>
        <h1>${escapeHtml(invoice.invoice_number)}</h1>
        <p class="muted">Created on ${invoice.issue_date} • Due on ${invoice.due_date}</p>
      </div>
      <div class="actions">
        ${!isPaid && !isCancelled ? `<button class="btn secondary" data-edit-invoice="${invoice.id}">Edit</button>` : ""}
        <button class="btn secondary" data-duplicate-invoice="${invoice.id}">Duplicate</button>
        <button class="btn secondary" data-pdf="${invoice.id}">Download PDF</button>
        ${!isPaid && !isCancelled ? `<button class="btn secondary" data-open-send="${invoice.id}">${invoice.status === "sent" ? "Send Again" : "Send Email"}</button>` : ""}
        ${!isPaid && !isCancelled ? `<button class="btn primary" data-open-paid="${invoice.id}">Mark as Paid</button>` : ""}
        ${!isPaid && !isCancelled ? `<button class="btn danger" data-open-cancel="${invoice.id}">Cancel Invoice</button>` : ""}
      </div>
    </div>

    <!-- Delivery & Client Access Section -->
    <section class="delivery-panel">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="font-size:18px">🚀</span>
          <strong>Delivery & Client Access</strong>
        </div>
        <div class="actions">
          <button class="btn secondary small" data-copy-link="${publicUrl}">📋 Copy Public Link</button>
          <a href="/invoice/${invoice.public_token}" target="_blank" class="btn secondary small">↗ View Client Page</a>
        </div>
      </div>
      <div class="delivery-meta-grid">
        <div class="delivery-meta-item">
          <span>Delivery Status</span>
          <strong>${invoice.delivery_status === "sent" ? "✅ Sent via Email" : (invoice.delivery_status === "failed" ? "❌ Failed Send Attempt" : "⏳ Not Sent Yet")}</strong>
        </div>
        <div class="delivery-meta-item">
          <span>Last Sent</span>
          <strong>${invoice.last_delivered_at ? new Date(invoice.last_delivered_at).toLocaleString() : "Never"}</strong>
        </div>
        <div class="delivery-meta-item">
          <span>Client Views</span>
          <strong>${invoice.view_count > 0 ? `👁️ Viewed ${invoice.view_count} time${invoice.view_count === 1 ? "" : "s"}` : "👁️ Not viewed yet"}</strong>
        </div>
        <div class="delivery-meta-item">
          <span>Last Viewed</span>
          <strong>${invoice.last_viewed_at ? new Date(invoice.last_viewed_at).toLocaleString() : "—"}</strong>
        </div>
      </div>
    </section>

    <div class="preview-wrapper">
      <section class="preview template-${template}" style="--accent:${accent}">
        <div class="preview-header">
          <div>
            ${state.business?.logo_data_url ? `<img src="${state.business.logo_data_url}" alt="Logo" class="preview-logo">` : `<div class="preview-logo-placeholder">${escapeHtml((state.business?.business_name || "IF").slice(0, 2).toUpperCase())}</div>`}
            <h2 style="margin:4px 0 0; font-size:20px">${escapeHtml(state.business?.business_name || "Your Business")}</h2>
            <div class="muted" style="font-size:13px; margin-top:4px">
              ${[state.business?.address, state.business?.email, state.business?.phone, state.business?.website].filter(Boolean).map(escapeHtml).join("<br>")}
              ${state.business?.tax_number ? `<br>Tax/VAT: ${escapeHtml(state.business.tax_number)}` : ""}
            </div>
          </div>
          <div style="text-align:right">
            <div class="preview-title">INVOICE</div>
            <strong style="font-size:16px">${escapeHtml(invoice.invoice_number)}</strong>
            <div style="margin-top:8px; font-size:13px">
              <div><strong>Issue Date:</strong> ${invoice.issue_date}</div>
              <div><strong>Due Date:</strong> ${invoice.due_date}</div>
              <div style="margin-top:6px"><span class="badge ${invoice.status}">${invoice.status}</span></div>
            </div>
          </div>
        </div>

        <div class="grid two" style="margin-bottom:28px">
          <div class="bill-box">
            <span class="muted" style="font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:0.04em;">Bill To:</span>
            <div style="font-size:16px; font-weight:700; margin-top:4px">${escapeHtml(customer.name)}</div>
            <div class="muted" style="font-size:13px; margin-top:4px">
              ${[customer.billing_address, customer.email, customer.phone].filter(Boolean).map(escapeHtml).join("<br>")}
            </div>
          </div>
        </div>

        <div class="table-wrap" style="box-shadow:none; border-color:#e2e8f0;">
          <table>
            <thead>
              <tr><th>Description</th><th>Qty</th><th>Rate</th><th>Tax</th><th style="text-align:right">Amount</th></tr>
            </thead>
            <tbody>${items}</tbody>
          </table>
        </div>

        <div class="totals" style="margin-top:24px;">
          <div><span>Subtotal</span><strong>${money(invoice.subtotal_cents, curr)}</strong></div>
          <div><span>Tax</span><strong>${money(invoice.tax_cents, curr)}</strong></div>
          ${invoice.discount_cents > 0 ? `<div><span>Discount</span><strong>-${money(invoice.discount_cents, curr)}</strong></div>` : ""}
          <div class="grand" style="border-top-color:var(--accent, #2563eb)"><span>Total Due</span><strong style="color:var(--accent, #2563eb)">${money(invoice.total_cents, curr)}</strong></div>
        </div>

        ${invoice.payments?.length ? `
          <div style="margin-top:28px; background:#ecfdf5; border:1px solid #a7f3d0; border-radius:6px; padding:12px 16px;">
            <strong style="color:#065f46">Payment Recorded</strong>
            <div style="font-size:13px; color:#047857; margin-top:4px">
              ${invoice.payments.map((p) => `${money(p.amount_cents, curr)} on ${p.payment_date} ${p.reference ? `(${escapeHtml(p.reference)})` : ""}`).join("<br>")}
            </div>
          </div>` : ""}

        <div class="grid two" style="margin-top:36px; border-top:1px solid #e2e8f0; padding-top:20px; font-size:13px;">
          <div>
            <strong>Payment Instructions</strong>
            <p class="muted" style="margin:4px 0 0; white-space:pre-line;">${escapeHtml(state.business?.payment_details || "Payment details not configured.")}</p>
          </div>
          <div>
            <strong>Terms & Notes</strong>
            <p class="muted" style="margin:4px 0 0;">${escapeHtml([invoice.payment_terms, invoice.notes].filter(Boolean).join(" • ") || "Thank you for your business.")}</p>
          </div>
        </div>
      </section>
    </div>`);
}

async function publicInvoiceView(token) {
  try {
    const data = await api(`/public/invoices/${token}`);
    const { invoice, customer, business } = data;
    const template = business.invoice_template || "clean";
    const accent = business.accent_color || "#2563eb";
    const curr = invoice.currency || "ZAR";

    const items = invoice.items.map((item) => `
      <tr>
        <td><strong>${escapeHtml(item.description)}</strong></td>
        <td>${item.quantity}</td>
        <td>${money(item.unit_price_cents, curr)}</td>
        <td>${item.tax_rate / 100}%</td>
        <td style="text-align:right"><strong>${money(item.line_total_cents, curr)}</strong></td>
      </tr>`).join("");

    return `
      <div class="public-view-container">
        <header class="public-topbar">
          <div class="public-brand"><span class="mark">IF</span> InvoiceFlow Client Portal</div>
          <div class="actions">
            <button class="btn secondary small" id="btnPrintPublic">🖨️ Print</button>
            <a href="/api/public/invoices/${token}/pdf" target="_blank" class="btn primary small">📥 Download PDF</a>
          </div>
        </header>

        <section class="preview template-${template}" style="--accent:${accent}; margin:0 auto;">
          <div class="preview-header">
            <div>
              ${business.logo_data_url ? `<img src="${business.logo_data_url}" alt="Logo" class="preview-logo">` : `<div class="preview-logo-placeholder">${escapeHtml((business.business_name || "IF").slice(0, 2).toUpperCase())}</div>`}
              <h2 style="margin:4px 0 0; font-size:20px">${escapeHtml(business.business_name || "InvoiceFlow Business")}</h2>
              <div class="muted" style="font-size:13px; margin-top:4px">
                ${[business.address, business.email, business.phone, business.website].filter(Boolean).map(escapeHtml).join("<br>")}
                ${business.tax_number ? `<br>Tax/VAT: ${escapeHtml(business.tax_number)}` : ""}
              </div>
            </div>
            <div style="text-align:right">
              <div class="preview-title">INVOICE</div>
              <strong style="font-size:16px">${escapeHtml(invoice.invoice_number)}</strong>
              <div style="margin-top:8px; font-size:13px">
                <div><strong>Issue Date:</strong> ${invoice.issue_date}</div>
                <div><strong>Due Date:</strong> ${invoice.due_date}</div>
                <div style="margin-top:6px"><span class="badge ${invoice.status}">${invoice.status}</span></div>
              </div>
            </div>
          </div>

          <div class="grid two" style="margin-bottom:28px">
            <div class="bill-box">
              <span class="muted" style="font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:0.04em;">Bill To:</span>
              <div style="font-size:16px; font-weight:700; margin-top:4px">${escapeHtml(customer.name)}</div>
              <div class="muted" style="font-size:13px; margin-top:4px">
                ${[customer.billing_address, customer.email, customer.phone].filter(Boolean).map(escapeHtml).join("<br>")}
              </div>
            </div>
          </div>

          <div class="table-wrap" style="box-shadow:none; border-color:#e2e8f0;">
            <table>
              <thead>
                <tr><th>Description</th><th>Qty</th><th>Rate</th><th>Tax</th><th style="text-align:right">Amount</th></tr>
              </thead>
              <tbody>${items}</tbody>
            </table>
          </div>

          <div class="totals" style="margin-top:24px;">
            <div><span>Subtotal</span><strong>${money(invoice.subtotal_cents, curr)}</strong></div>
            <div><span>Tax</span><strong>${money(invoice.tax_cents, curr)}</strong></div>
            ${invoice.discount_cents > 0 ? `<div><span>Discount</span><strong>-${money(invoice.discount_cents, curr)}</strong></div>` : ""}
            <div class="grand" style="border-top-color:var(--accent, #2563eb)"><span>Total Due</span><strong style="color:var(--accent, #2563eb)">${money(invoice.total_cents, curr)}</strong></div>
          </div>

          ${invoice.payments?.length ? `
            <div style="margin-top:28px; background:#ecfdf5; border:1px solid #a7f3d0; border-radius:6px; padding:12px 16px;">
              <strong style="color:#065f46">Payment Recorded</strong>
              <div style="font-size:13px; color:#047857; margin-top:4px">
                ${invoice.payments.map((p) => `${money(p.amount_cents, curr)} on ${p.payment_date} ${p.reference ? `(${escapeHtml(p.reference)})` : ""}`).join("<br>")}
              </div>
            </div>` : ""}

          <div class="grid two" style="margin-top:36px; border-top:1px solid #e2e8f0; padding-top:20px; font-size:13px;">
            <div>
              <strong>Payment Instructions</strong>
              <p class="muted" style="margin:4px 0 0; white-space:pre-line;">${escapeHtml(business.payment_details || "Please contact business owner for payment instructions.")}</p>
            </div>
            <div>
              <strong>Terms & Notes</strong>
              <p class="muted" style="margin:4px 0 0;">${escapeHtml([invoice.payment_terms, invoice.notes].filter(Boolean).join(" • ") || "Thank you for your business.")}</p>
            </div>
          </div>
        </section>
      </div>`;
  } catch (err) {
    return `
      <div class="public-view-container">
        <div class="card" style="max-width:480px; margin:60px auto; text-align:center;">
          <h1 style="font-size:22px; color:var(--danger)">Invoice Not Found</h1>
          <p class="muted">${escapeHtml(err.error?.message || "The invoice link you followed may be invalid or has expired.")}</p>
          <a href="/" class="btn primary" style="margin-top:12px">Visit InvoiceFlow</a>
        </div>
      </div>`;
  }
}

async function settingsView() {
  state.business = (await api("/business")).profile;
  const b = state.business;
  return shell(`
    <div class="section-title">
      <div>
        <h1>Business Settings & Branding</h1>
        <p class="muted">Customize your company profile, invoice design templates, and payment instructions.</p>
      </div>
    </div>
    
    <form class="form card" id="businessForm">
      <h2 style="font-size:16px; margin-bottom:4px">Company Profile</h2>
      <div class="grid two">
        ${field("businessName", "Business Name", "text", b.business_name, "e.g. Acme Design Studio")}
        ${field("email", "Business Email", "email", b.email, "billing@studio.com")}
      </div>
      <div class="grid two">
        ${field("phone", "Phone Number", "text", b.phone, "+27 11 000 0000")}
        ${field("website", "Website", "text", b.website, "https://studio.com")}
      </div>
      ${textArea("address", "Physical / Postal Address", b.address, "Street, City, Postal Code")}
      <div class="grid two">
        ${field("taxNumber", "Tax / VAT Registration Number", "text", b.tax_number, "VAT4800123")}
        <div class="field">
          <label for="currency">Default Currency</label>
          <select id="currency" name="currency">
            <option value="ZAR" ${b.currency === "ZAR" ? "selected" : ""}>ZAR (R South African Rand)</option>
            <option value="USD" ${b.currency === "USD" ? "selected" : ""}>USD ($ US Dollar)</option>
            <option value="EUR" ${b.currency === "EUR" ? "selected" : ""}>EUR (€ Euro)</option>
            <option value="GBP" ${b.currency === "GBP" ? "selected" : ""}>GBP (£ British Pound)</option>
          </select>
        </div>
      </div>

      <h2 style="font-size:16px; margin-top:16px; margin-bottom:4px">Branding & Template</h2>
      <div class="field">
        <label>Business Logo</label>
        <div class="logo-upload-wrap">
          <div class="logo-preview-box" id="logoPreviewBox">
            ${b.logo_data_url ? `<img src="${b.logo_data_url}" alt="Logo">` : `<span class="muted" style="font-size:11px">No Logo</span>`}
          </div>
          <div>
            <input type="file" id="logoFileInput" accept="image/png,image/jpeg,image/webp,image/svg+xml" style="font-size:13px">
            <input type="hidden" id="logoDataUrl" name="logoDataUrl" value="${escapeHtml(b.logo_data_url || "")}">
            ${b.logo_data_url ? `<button type="button" class="btn secondary small" id="btnClearLogo" style="margin-top:6px">Remove Logo</button>` : ""}
          </div>
        </div>
      </div>

      <div class="grid two">
        <div class="field">
          <label for="invoiceTemplate">Invoice Template</label>
          <select id="invoiceTemplate" name="invoiceTemplate">
            <option value="clean" ${b.invoice_template === "clean" ? "selected" : ""}>Clean (Modern & Airy)</option>
            <option value="professional" ${b.invoice_template === "professional" ? "selected" : ""}>Professional (Corporate & Structured)</option>
            <option value="minimal" ${b.invoice_template === "minimal" ? "selected" : ""}>Minimal (Monochrome & Direct)</option>
          </select>
        </div>
        <div class="field">
          <label for="accentColor">Brand Accent Colour</label>
          <div style="display:flex; gap:8px; align-items:center;">
            <input id="accentColor" name="accentColor" type="color" value="${b.accent_color || "#2563eb"}" style="width:50px; height:40px; padding:2px;">
            <input type="text" id="accentColorHex" value="${b.accent_color || "#2563eb"}" style="width:120px;">
          </div>
        </div>
      </div>

      <h2 style="font-size:16px; margin-top:16px; margin-bottom:4px">Invoice Numbering & Defaults</h2>
      <div class="grid three">
        ${field("invoicePrefix", "Invoice Prefix", "text", b.invoice_prefix, "INV-")}
        ${field("nextInvoiceNumber", "Next Invoice Sequence", "number", b.next_invoice_number)}
        ${field("defaultTaxRate", "Default Tax Rate (%)", "number", b.default_tax_rate, "15")}
      </div>
      
      <h2 style="font-size:16px; margin-top:16px; margin-bottom:4px">Payment Instructions (Shown to Customers)</h2>
      ${textArea("paymentDetails", "Payment / Banking Details", b.payment_details, "Bank: First National Bank\nAccount Holder: Acme Studio\nAccount Number: 6280000000\nBranch Code: 250655\nReference: Use Invoice #")}
      
      <div class="actions" style="margin-top:12px">
        <button class="btn primary">Save All Settings</button>
      </div>
    </form>`);
}

async function recurringView() {
  await loadCustomers({ useSearch: false });
  const rows = (await api("/recurring-invoices")).recurringInvoices.map((r) => `
    <tr>
      <td><strong>${escapeHtml(r.title)}</strong></td>
      <td>${escapeHtml(r.customer_name || "No customer")}</td>
      <td><span style="text-transform:capitalize">${r.frequency}</span></td>
      <td>${r.next_invoice_date}</td>
      <td><span class="badge ${r.status}">${r.status}</span></td>
      <td class="actions">
        <button class="btn secondary small" data-rec-status="${r.id}" data-status="${r.status === "active" ? "paused" : "active"}">${r.status === "active" ? "Pause" : "Resume"}</button>
        <button class="btn danger small" data-delete-rec="${r.id}">Cancel</button>
      </td>
    </tr>`).join("") || `<tr><td colspan="6" class="empty">No recurring invoices created yet.</td></tr>`;

  return shell(`
    <div class="section-title">
      <div>
        <h1>Recurring Invoices</h1>
        <p class="muted">Set up recurring invoice schedules for regular retainer clients.</p>
      </div>
    </div>
    <section class="card">
      <h2 style="font-size:16px; margin-bottom:12px">Create Recurring Schedule</h2>
      <form class="form" id="recurringForm">
        <div class="grid two">
          ${field("title", "Schedule Title", "text", "", "e.g. Monthly SEO Retainer")}
          <div class="field">
            <label for="customerId">Customer</label>
            <select id="customerId" name="customerId" required>
              <option value="">Select customer...</option>
              ${state.customers.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("")}
            </select>
          </div>
        </div>
        <div class="grid three">
          <div class="field">
            <label for="frequency">Billing Frequency</label>
            <select id="frequency" name="frequency">
              <option value="weekly">Weekly</option>
              <option value="monthly" selected>Monthly</option>
              <option value="quarterly">Quarterly</option>
              <option value="yearly">Yearly</option>
            </select>
          </div>
          ${field("startDate", "Start Date", "date", today())}
          ${field("nextInvoiceDate", "First Invoice Date", "date", today())}
        </div>
        <div class="actions" style="margin-top:8px">
          <button class="btn primary">Save Recurring Template</button>
        </div>
      </form>
    </section>
    <div class="section-title" style="margin-top:36px; margin-bottom:16px">
      <h2>Active Recurring Schedules</h2>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Title</th><th>Customer</th><th>Frequency</th><th>Next Invoice</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`);
}

function renderModal() {
  if (!state.modal) return "";
  const { type, data } = state.modal;

  if (type === "customer") {
    const isEdit = Boolean(data?.id);
    return `
      <div class="modal-backdrop" id="modalBackdrop">
        <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
          <div class="modal-header">
            <h2 id="modalTitle">${isEdit ? "Edit Customer" : "Add New Customer"}</h2>
            <button class="modal-close" data-close-modal aria-label="Close">✕</button>
          </div>
          <form class="form" id="modalCustomerForm" data-id="${data?.id || ""}">
            <div class="grid two">
              ${field("name", "Customer Name *", "text", data?.name, "e.g. Acme Corp")}
              ${field("email", "Email Address", "email", data?.email, "billing@acme.com")}
            </div>
            <div class="grid two">
              ${field("phone", "Phone Number", "text", data?.phone, "+27 ...")}
              ${field("billingAddress", "Billing Address", "text", data?.billing_address, "City, Street")}
            </div>
            ${textArea("notes", "Internal Notes", data?.notes, "Client notes...")}
            <div class="actions" style="justify-content:flex-end; margin-top:8px">
              <button type="button" class="btn secondary" data-close-modal>Cancel</button>
              <button type="submit" class="btn primary">${isEdit ? "Save Changes" : "Create Customer"}</button>
            </div>
          </form>
        </div>
      </div>`;
  }

  if (type === "send") {
    return `
      <div class="modal-backdrop" id="modalBackdrop">
        <div class="modal" role="dialog" aria-modal="true">
          <div class="modal-header">
            <h2>Send Invoice by Email</h2>
            <button class="modal-close" data-close-modal aria-label="Close">✕</button>
          </div>
          <form class="form" id="modalSendForm" data-id="${data.id}">
            <p class="muted" style="margin:0">Deliver invoice <strong>${escapeHtml(data.invoice_number)}</strong> with an attached vector PDF and secure customer link.</p>
            ${field("email", "Recipient Email Address *", "email", data.customer_email || "", "client@company.com")}
            <div class="actions" style="justify-content:flex-end; margin-top:12px">
              <button type="button" class="btn secondary" data-close-modal>Cancel</button>
              <button type="submit" class="btn primary">Send Invoice</button>
            </div>
          </form>
        </div>
      </div>`;
  }

  if (type === "paid") {
    const defaultAmount = (data.total_cents / 100).toFixed(2);
    return `
      <div class="modal-backdrop" id="modalBackdrop">
        <div class="modal" role="dialog" aria-modal="true">
          <div class="modal-header">
            <h2>Record Payment</h2>
            <button class="modal-close" data-close-modal aria-label="Close">✕</button>
          </div>
          <form class="form" id="modalPaidForm" data-id="${data.id}">
            <p class="muted" style="margin:0">Record a payment for invoice <strong>${escapeHtml(data.invoice_number)}</strong> (Total: ${money(data.total_cents, data.currency)}).</p>
            <div class="grid two">
              ${field("amount", "Payment Amount", "number", defaultAmount)}
              ${field("paymentDate", "Payment Date", "date", today())}
            </div>
            ${field("reference", "Payment Reference / Note", "text", "", "e.g. EFT / Direct Deposit")}
            <div class="actions" style="justify-content:flex-end; margin-top:12px">
              <button type="button" class="btn secondary" data-close-modal>Cancel</button>
              <button type="submit" class="btn primary">Mark as Paid</button>
            </div>
          </form>
        </div>
      </div>`;
  }

  if (type === "cancel") {
    return `
      <div class="modal-backdrop" id="modalBackdrop">
        <div class="modal" role="dialog" aria-modal="true">
          <div class="modal-header">
            <h2>Cancel Invoice ${escapeHtml(data.invoice_number)}?</h2>
            <button class="modal-close" data-close-modal aria-label="Close">✕</button>
          </div>
          <div style="display:grid; gap:16px;">
            <p style="margin:0">Are you sure you want to cancel this invoice? It will no longer be active or payable, but will remain in historical records.</p>
            <div class="actions" style="justify-content:flex-end;">
              <button type="button" class="btn secondary" data-close-modal>Keep Invoice</button>
              <button type="button" class="btn danger" id="btnConfirmCancelInvoice" data-id="${data.id}">Yes, Cancel Invoice</button>
            </div>
          </div>
        </div>
      </div>`;
  }

  if (type === "devEmails") {
    const emails = data.emails || [];
    return `
      <div class="modal-backdrop" id="modalBackdrop">
        <div class="modal large" role="dialog" aria-modal="true">
          <div class="modal-header">
            <h2>Development Email Inspector</h2>
            <button class="modal-close" data-close-modal aria-label="Close">✕</button>
          </div>
          <p class="muted" style="margin-top:0">All emails sent in local development mode (EMAIL_PROVIDER=mock) are captured here for inspection.</p>
          <div style="display:grid; gap:16px; margin-top:12px;">
            ${emails.length ? emails.map((em) => `
              <div class="card" style="background:#f8fafc; font-size:13px;">
                <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
                  <strong>${escapeHtml(em.subject)}</strong>
                  <span class="muted">${new Date(em.sentAt).toLocaleTimeString()}</span>
                </div>
                <div class="muted">To: ${escapeHtml(em.to)} • From: ${escapeHtml(em.from)}</div>
                <div style="margin:10px 0; background:white; border:1px solid #e2e8f0; padding:10px; border-radius:6px; font-family:monospace; white-space:pre-wrap; font-size:12px; max-height:160px; overflow-y:auto;">${escapeHtml(em.textBody)}</div>
                <div class="actions" style="margin-top:8px">
                  <a href="${escapeHtml(em.publicUrl)}" target="_blank" class="btn secondary small">↗ Open Public Invoice Link</a>
                </div>
              </div>`).join("") : `<p class="empty">No mock emails sent yet.</p>`}
          </div>
        </div>
      </div>`;
  }

  return "";
}

async function render() {
  try {
    if (state.route === "public-invoice") {
      app.innerHTML = await publicInvoiceView(state.publicToken);
      bindPublicEvents();
      return;
    }

    if (!state.user && !["landing", "login", "register"].includes(state.route)) {
      state.route = "login";
    }
    if (state.route === "landing") app.innerHTML = landing();
    else if (state.route === "login" || state.route === "register") app.innerHTML = authView(state.route);
    else if (state.route === "dashboard") app.innerHTML = await dashboard();
    else if (state.route === "customers") app.innerHTML = await customersView();
    else if (state.route === "invoices") app.innerHTML = await invoicesView();
    else if (state.route === "invoice-new") app.innerHTML = await invoiceEditor();
    else if (state.route.startsWith("invoice-edit-")) app.innerHTML = await invoiceEditor(state.route.replace("invoice-edit-", ""));
    else if (state.route.startsWith("invoice-")) app.innerHTML = await invoiceDetail(state.route.replace("invoice-", ""));
    else if (state.route === "settings") app.innerHTML = await settingsView();
    else if (state.route === "recurring") app.innerHTML = await recurringView();
    
    bindEvents();
    if (document.querySelector("#invoiceForm")) calculateClientInvoice();
  } catch (error) {
    app.innerHTML = shell(`
      <section class="card" style="max-width:500px; margin:40px auto; text-align:center;">
        <h1 style="font-size:20px; color:var(--danger)">Something went wrong</h1>
        <p class="muted">${escapeHtml(error.error?.message || "An unexpected error occurred. Please try again.")}</p>
        <button class="btn primary" data-nav="dashboard" style="margin-top:12px">Return to Dashboard</button>
      </section>`);
  }
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function showErrors(error) {
  document.querySelectorAll("[data-error]").forEach((el) => el.textContent = "");
  const fields = error.error?.fields || {};
  Object.entries(fields).forEach(([key, message]) => {
    const el = document.querySelector(`[data-error="${CSS.escape(key)}"]`);
    if (el) el.textContent = message;
  });
  showToast(error.error?.message || "Please check the highlighted fields.");
}

function bindPublicEvents() {
  document.querySelector("#btnPrintPublic")?.addEventListener("click", () => window.print());
}

function bindEvents() {
  // Navigation
  document.querySelectorAll("[data-nav]").forEach((el) => el.addEventListener("click", () => navigate(el.dataset.nav)));
  
  // Auth
  document.querySelector("#logoutBtn")?.addEventListener("click", async () => {
    await api("/auth/logout", { method: "POST" });
    state.user = null;
    navigate("landing");
  });
  document.querySelector("#registerForm")?.addEventListener("submit", submitAuth("register"));
  document.querySelector("#loginForm")?.addEventListener("submit", submitAuth("login"));
  
  // Password toggle
  document.querySelectorAll("[data-toggle-password]").forEach((btn) => btn.addEventListener("click", () => {
    const input = document.querySelector(`#${CSS.escape(btn.dataset.togglePassword)}`);
    const showing = input.type === "text";
    input.type = showing ? "password" : "text";
    btn.textContent = showing ? "Show" : "Hide";
    btn.setAttribute("aria-label", `${showing ? "Show" : "Hide"} ${input.name}`);
  }));

  // Modals close
  document.querySelectorAll("[data-close-modal]").forEach((btn) => btn.addEventListener("click", () => {
    state.modal = null;
    render();
  }));

  // Dev emails modal
  document.querySelector("#btnDevEmails")?.addEventListener("click", async () => {
    const res = await api("/dev/emails");
    state.modal = { type: "devEmails", data: res };
    render();
  });

  // Copy link action
  document.querySelectorAll("[data-copy-link]").forEach((btn) => btn.addEventListener("click", () => {
    navigator.clipboard.writeText(btn.dataset.copyLink);
    showToast("📋 Public invoice link copied to clipboard!");
  }));

  // Customer Management
  document.querySelector("[data-open-customer-modal]")?.addEventListener("click", () => {
    state.modal = { type: "customer", data: {} };
    render();
  });
  document.querySelectorAll("[data-edit-customer]").forEach((btn) => btn.addEventListener("click", () => {
    const c = state.customers.find((x) => x.id === Number(btn.dataset.editCustomer));
    state.modal = { type: "customer", data: c || {} };
    render();
  }));
  document.querySelector("#modalCustomerForm")?.addEventListener("submit", submitModalCustomer);
  document.querySelector("#customerSearch")?.addEventListener("input", debounce((event) => {
    state.customerSearch = event.target.value;
    render();
  }, 250));
  document.querySelector("#clearCustomerSearch")?.addEventListener("click", () => {
    state.customerSearch = "";
    render();
  });
  document.querySelectorAll("[data-delete-customer]").forEach((btn) => btn.addEventListener("click", async () => {
    if (confirm("Delete this customer? Historical invoices will be preserved.")) {
      await api(`/customers/${btn.dataset.deleteCustomer}`, { method: "DELETE" });
      showToast("Customer deleted.");
      render();
    }
  }));

  // Invoices list filters
  document.querySelectorAll("[data-filter-status]").forEach((btn) => btn.addEventListener("click", () => {
    state.invoiceStatus = btn.dataset.filterStatus;
    render();
  }));
  document.querySelector("#invoiceSearch")?.addEventListener("input", debounce((event) => {
    state.invoiceSearch = event.target.value;
    render();
  }, 250));
  document.querySelector("#clearInvoiceFilters")?.addEventListener("click", () => {
    state.invoiceSearch = "";
    state.invoiceStatus = "";
    render();
  });

  // Invoice Navigation / Actions
  document.querySelectorAll("[data-view-invoice]").forEach((btn) => btn.addEventListener("click", () => navigate(`invoice-${btn.dataset.viewInvoice}`)));
  document.querySelectorAll("[data-edit-invoice]").forEach((btn) => btn.addEventListener("click", () => navigate(`invoice-edit-${btn.dataset.editInvoice}`)));
  document.querySelectorAll("[data-pdf]").forEach((btn) => btn.addEventListener("click", () => {
    window.open(`/api/invoices/${btn.dataset.pdf}/pdf`, "_blank");
  }));
  document.querySelectorAll("[data-duplicate-invoice]").forEach((btn) => btn.addEventListener("click", async () => {
    try {
      const result = await api(`/invoices/${btn.dataset.duplicateInvoice}/duplicate`, { method: "POST" });
      showToast("Invoice duplicated as draft.");
      navigate(`invoice-edit-${result.invoice.id}`);
    } catch (e) {
      showToast(e.error?.message || "Failed to duplicate invoice.");
    }
  }));
  document.querySelectorAll("[data-open-send]").forEach((btn) => btn.addEventListener("click", async () => {
    const inv = (await api(`/invoices/${btn.dataset.openSend}`)).invoice;
    state.modal = { type: "send", data: inv };
    render();
  }));
  document.querySelector("#modalSendForm")?.addEventListener("submit", submitModalSend);

  document.querySelectorAll("[data-open-paid]").forEach((btn) => btn.addEventListener("click", async () => {
    const inv = (await api(`/invoices/${btn.dataset.openPaid}`)).invoice;
    state.modal = { type: "paid", data: inv };
    render();
  }));
  document.querySelector("#modalPaidForm")?.addEventListener("submit", submitModalPaid);

  document.querySelectorAll("[data-open-cancel]").forEach((btn) => btn.addEventListener("click", async () => {
    const inv = (await api(`/invoices/${btn.dataset.openCancel}`)).invoice;
    state.modal = { type: "cancel", data: inv };
    render();
  }));
  document.querySelector("#btnConfirmCancelInvoice")?.addEventListener("click", async (e) => {
    try {
      await api(`/invoices/${e.target.dataset.id}/cancel`, { method: "POST" });
      showToast("Invoice cancelled.");
      state.modal = null;
      render();
    } catch (err) {
      showToast(err.error?.message || "Could not cancel invoice.");
    }
  });

  // Invoice Editor Form
  const invoiceForm = document.querySelector("#invoiceForm");
  if (invoiceForm) {
    invoiceForm.addEventListener("submit", submitInvoice);
    invoiceForm.addEventListener("input", calculateClientInvoice);
    
    document.querySelector("#btnSaveDraft")?.addEventListener("click", (e) => {
      e.target.form.dataset.intent = "draft";
      invoiceForm.requestSubmit();
    });
    document.querySelector("#btnSaveSent")?.addEventListener("click", (e) => {
      e.target.form.dataset.intent = "sent";
    });

    document.querySelector("#customerId")?.addEventListener("change", (e) => {
      const cid = Number(e.target.value);
      const cust = state.customers.find((c) => c.id === cid);
      const preview = document.querySelector("#customerInfoPreview");
      if (preview) {
        if (cust) {
          preview.style.display = "grid";
          preview.innerHTML = `<strong>${escapeHtml(cust.name)}</strong><span>${escapeHtml(cust.email || "")}</span><span>${escapeHtml(cust.billing_address || "")}</span>`;
        } else {
          preview.style.display = "none";
        }
      }
    });

    document.querySelector("#btnInlineNewCustomer")?.addEventListener("click", () => {
      state.modal = { type: "customer", data: {} };
      render();
    });

    document.querySelectorAll("[data-preset-due]").forEach((btn) => btn.addEventListener("click", () => {
      const days = Number(btn.dataset.presetDue);
      const issueInput = document.querySelector("#issueDate");
      const issueDate = issueInput?.value ? new Date(issueInput.value) : new Date();
      const due = new Date(issueDate.getTime() + days * 86400000).toISOString().slice(0, 10);
      const dueInput = document.querySelector("#dueDate");
      if (dueInput) dueInput.value = due;
    }));

    document.querySelector("#addItem")?.addEventListener("click", () => {
      document.querySelector("#itemsContainer").insertAdjacentHTML("beforeend", itemForm({ taxRate: state.business?.default_tax_rate || 15 }));
      bindEvents();
      calculateClientInvoice();
    });

    document.querySelectorAll("[data-remove-item]").forEach((btn) => btn.addEventListener("click", () => {
      const rows = document.querySelectorAll("[data-item]");
      if (rows.length > 1) {
        btn.closest("[data-item]").remove();
        calculateClientInvoice();
      } else {
        showToast("Invoice must have at least one line item.");
      }
    }));
  }

  // Settings Form
  const businessForm = document.querySelector("#businessForm");
  if (businessForm) {
    businessForm.addEventListener("submit", submitBusiness);
    
    // Logo Upload
    const logoInput = document.querySelector("#logoFileInput");
    logoInput?.addEventListener("change", (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      if (file.size > 1_500_000) {
        showToast("Image size must be under 1.5MB.");
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target.result;
        document.querySelector("#logoDataUrl").value = dataUrl;
        document.querySelector("#logoPreviewBox").innerHTML = `<img src="${dataUrl}" alt="Logo">`;
      };
      reader.readAsDataURL(file);
    });

    document.querySelector("#btnClearLogo")?.addEventListener("click", () => {
      document.querySelector("#logoDataUrl").value = "";
      document.querySelector("#logoPreviewBox").innerHTML = `<span class="muted" style="font-size:11px">No Logo</span>`;
    });

    // Accent Color Sync
    const colorPicker = document.querySelector("#accentColor");
    const colorHex = document.querySelector("#accentColorHex");
    colorPicker?.addEventListener("input", (e) => { if (colorHex) colorHex.value = e.target.value; });
    colorHex?.addEventListener("input", (e) => { if (colorPicker && /^#[0-9a-f]{6}$/i.test(e.target.value)) colorPicker.value = e.target.value; });
  }

  // Recurring Form
  document.querySelector("#recurringForm")?.addEventListener("submit", submitRecurring);
  document.querySelectorAll("[data-rec-status]").forEach((btn) => btn.addEventListener("click", async () => {
    await api(`/recurring-invoices/${btn.dataset.recStatus}`, { method: "PUT", body: { status: btn.dataset.status } });
    showToast("Recurring schedule updated.");
    render();
  }));
  document.querySelectorAll("[data-delete-rec]").forEach((btn) => btn.addEventListener("click", async () => {
    if (confirm("Cancel this recurring invoice schedule?")) {
      await api(`/recurring-invoices/${btn.dataset.deleteRec}`, { method: "DELETE" });
      showToast("Recurring schedule cancelled.");
      render();
    }
  }));
}

function debounce(callback, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => callback(...args), delay);
  };
}

function submitAuth(mode) {
  return async (event) => {
    event.preventDefault();
    try {
      const data = await api(`/auth/${mode}`, { method: "POST", body: formData(event.target) });
      state.user = data.user;
      showToast(mode === "register" ? "Account created successfully." : "Signed in successfully.");
      navigate("dashboard");
    } catch (error) {
      showErrors(error);
    }
  };
}

async function submitModalCustomer(event) {
  event.preventDefault();
  const id = event.target.dataset.id;
  try {
    const res = await api(id ? `/customers/${id}` : "/customers", { method: id ? "PUT" : "POST", body: formData(event.target) });
    showToast(id ? "Customer updated." : "Customer created.");
    await loadCustomers({ useSearch: false });
    state.modal = null;
    
    // If we're inside the invoice editor, auto-select the newly created customer!
    const customerSelect = document.querySelector("#customerId");
    if (customerSelect && res.customer) {
      customerSelect.innerHTML = `<option value="">Select a saved customer...</option>${state.customers.map((c) => `<option value="${c.id}" ${c.id === res.customer.id ? "selected" : ""}>${escapeHtml(c.name)} ${c.email ? `(${escapeHtml(c.email)})` : ""}</option>`).join("")}`;
      const preview = document.querySelector("#customerInfoPreview");
      if (preview) {
        preview.style.display = "grid";
        preview.innerHTML = `<strong>${escapeHtml(res.customer.name)}</strong><span>${escapeHtml(res.customer.email || "")}</span><span>${escapeHtml(res.customer.billing_address || "")}</span>`;
      }
      return;
    }
    render();
  } catch (error) {
    showErrors(error);
  }
}

async function submitModalSend(event) {
  event.preventDefault();
  const id = event.target.dataset.id;
  const body = formData(event.target);
  try {
    const res = await api(`/invoices/${id}/send`, { method: "POST", body });
    showToast(res.delivery?.message || "Invoice sent successfully via email.");
    state.modal = null;
    render();
  } catch (error) {
    showErrors(error);
  }
}

async function submitModalPaid(event) {
  event.preventDefault();
  const id = event.target.dataset.id;
  const body = formData(event.target);
  try {
    await api(`/invoices/${id}/mark-paid`, { method: "POST", body });
    showToast("Payment recorded. Invoice marked as paid.");
    state.modal = null;
    render();
  } catch (error) {
    showErrors(error);
  }
}

async function submitBusiness(event) {
  event.preventDefault();
  try {
    const data = await api("/business", { method: "PUT", body: formData(event.target) });
    state.business = data.profile;
    showToast("Settings and branding saved successfully.");
    render();
  } catch (error) {
    showErrors(error);
  }
}

async function submitInvoice(event) {
  event.preventDefault();
  const submitter = event.submitter;
  const form = event.target;
  const body = formData(form);
  
  const intent = submitter?.value || form.dataset.intent || "draft";
  body.status = intent === "sent" ? "sent" : "draft";

  body.items = [...document.querySelectorAll("[data-item]")].map((row) => ({
    description: row.querySelector("[name=description]").value,
    quantity: row.querySelector("[name=quantity]").value,
    unitPrice: row.querySelector("[name=unitPrice]").value,
    taxRate: row.querySelector("[name=taxRate]").value
  }));

  const id = form.dataset.id;
  try {
    const result = await api(id ? `/invoices/${id}` : "/invoices", { method: id ? "PUT" : "POST", body });
    showToast("Invoice saved successfully.");
    navigate(`invoice-${result.invoice.id}`);
  } catch (error) {
    showErrors(error);
  }
}

async function submitRecurring(event) {
  event.preventDefault();
  try {
    await api("/recurring-invoices", { method: "POST", body: formData(event.target) });
    showToast("Recurring invoice schedule created.");
    render();
  } catch (error) {
    showErrors(error);
  }
}

async function boot() {
  try {
    const session = await api("/auth/me");
    state.user = session.user;
    if (state.user) {
      const biz = await api("/business");
      state.business = biz.profile;
      if (["landing", "login", "register"].includes(state.route)) {
        state.route = "dashboard";
      }
    }
  } catch (_e) {
    state.user = null;
  }
  render();
}

boot();
