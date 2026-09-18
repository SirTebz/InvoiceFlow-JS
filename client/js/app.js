const state = {
  user: null,
  route: location.hash.replace("#", "") || "landing",
  customers: [],
  invoices: [],
  business: null,
  editingInvoice: null,
  customerSearch: "",
  invoiceSearch: "",
  invoiceStatus: ""
};

const app = document.querySelector("#app");
const toast = document.querySelector("#toast");
const money = (cents, currency = "ZAR") => new Intl.NumberFormat("en-ZA", { style: "currency", currency }).format((cents || 0) / 100);
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
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 3200);
}

function navigate(route) {
  state.route = route;
  location.hash = route;
  render();
}

window.addEventListener("hashchange", () => {
  state.route = location.hash.replace("#", "") || "landing";
  render();
});

function shell(content) {
  if (!state.user) return `${publicNav()}${content}`;
  const tabs = [["dashboard", "Dashboard"], ["invoices", "Invoices"], ["customers", "Customers"], ["recurring", "Recurring"], ["settings", "Settings"]];
  return `
    <header class="topbar">
      <div class="brand"><span class="mark">IF</span> InvoiceFlow</div>
      <nav class="nav">${tabs.map(([id, label]) => `<button class="${state.route === id ? "active" : ""}" data-nav="${id}">${label}</button>`).join("")}</nav>
      <div class="userbar"><span>${state.user.name}</span><button class="btn secondary small" id="logoutBtn">Log out</button></div>
    </header>
    <main class="container">${content}</main>`;
}

function publicNav() {
  return `<header class="topbar"><div class="brand"><span class="mark">IF</span> InvoiceFlow</div><nav class="nav"><button data-nav="landing">Home</button><button data-nav="login">Log in</button><button class="btn primary" data-nav="register">Register</button></nav></header>`;
}

function landing() {
  return `<main class="container">
    <section class="hero">
      <div>
        <h1>InvoiceFlow</h1>
        <p>Simple invoicing for small businesses and freelancers. Create professional invoices, send them to customers, track payment status, and keep momentum without complicated accounting software.</p>
        <div class="actions"><button class="btn primary" data-nav="register">Create your account</button><button class="btn secondary" data-nav="login">Log in</button></div>
      </div>
      <div class="hero-visual">
        <div class="invoice-paper">
          <div class="paper-head"><strong>Studio North</strong><strong>INV-0008</strong></div>
          <div class="paper-lines">
            <div class="paper-line"><span class="skeleton"></span><span class="skeleton"></span><span class="skeleton"></span></div>
            <div class="paper-line"><span class="skeleton"></span><span class="skeleton"></span><span class="skeleton"></span></div>
            <div class="paper-line"><span class="skeleton"></span><span class="skeleton"></span><span class="skeleton"></span></div>
          </div>
          <div class="totals" style="margin-top:80px"><div><span>Subtotal</span><strong>R10,000</strong></div><div><span>Tax</span><strong>R1,500</strong></div><div class="grand"><span>Total</span><strong>R11,500</strong></div></div>
        </div>
      </div>
    </section>
    <section class="grid two">
      <div class="card"><h2>Free</h2><strong>R0/month</strong><p class="muted">Basic invoicing, customer management, PDF downloads, and safe development email mode.</p></div>
      <div class="card"><h2>Pro</h2><strong>Monthly subscription</strong><p class="muted">Prepared architecture for unlimited invoices, recurring invoices, branding, email sending, and payment tracking.</p></div>
    </section>
  </main>`;
}

function authView(mode) {
  const isRegister = mode === "register";
  return shell(`<section class="auth-panel card"><h1>${isRegister ? "Create account" : "Welcome back"}</h1>
    <form class="form" id="${mode}Form">
      ${isRegister ? field("name", "Name") : ""}
      ${field("email", "Email", "email")}
      ${passwordField("password", "Password")}
      ${isRegister ? passwordField("confirmPassword", "Confirm password") : ""}
      <button class="btn primary">${isRegister ? "Register" : "Log in"}</button>
      <button type="button" class="link-button" data-nav="${isRegister ? "login" : "register"}">${isRegister ? "Already have an account?" : "Need an account?"}</button>
    </form></section>`);
}

function field(name, label, type = "text", value = "") {
  return `<div class="field"><label for="${name}">${label}</label><input id="${name}" name="${name}" type="${type}" value="${escapeHtml(value)}"><span class="error" data-error="${name}"></span></div>`;
}

function passwordField(name, label) {
  return `<div class="field"><label for="${name}">${label}</label><div class="password-wrap"><input id="${name}" name="${name}" type="password"><button type="button" class="btn secondary small" data-toggle-password="${name}" aria-label="Show ${label.toLowerCase()}">Show</button></div><span class="error" data-error="${name}"></span></div>`;
}

function textArea(name, label, value = "") {
  return `<div class="field"><label for="${name}">${label}</label><textarea id="${name}" name="${name}">${escapeHtml(value)}</textarea><span class="error" data-error="${name}"></span></div>`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]));
}

async function loadCustomers() {
  const query = state.customerSearch ? `?search=${encodeURIComponent(state.customerSearch)}` : "";
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
  const data = await api("/dashboard");
  const rows = data.recentInvoices.map(invoiceRow).join("") || `<tr><td colspan="6" class="empty">No invoices yet.</td></tr>`;
  return shell(`<div class="section-title"><div><h1>Dashboard</h1><p class="muted">Track the invoices that need attention.</p></div><button class="btn primary" data-nav="invoice-new">Create invoice</button></div>
    <section class="grid four">
      ${metric("Outstanding", money(data.metrics.outstanding))}
      ${metric("Paid this month", money(data.metrics.paidThisMonth))}
      ${metric("Overdue", data.metrics.overdue)}
      ${metric("Drafts", data.metrics.drafts)}
    </section>
    <h2 style="margin-top:26px">Recent invoices</h2>${invoiceTable(rows)}`);
}

function metric(label, value) {
  return `<div class="card metric"><span class="muted">${label}</span><strong>${value}</strong></div>`;
}

async function customersView() {
  await loadCustomers();
  const rows = state.customers.map((c) => `<tr><td><strong>${escapeHtml(c.name)}</strong><br><span class="muted">${escapeHtml(c.email)}</span></td><td>${escapeHtml(c.phone)}</td><td>${escapeHtml(c.billing_address)}</td><td class="actions"><button class="btn secondary small" data-edit-customer="${c.id}">Edit</button><button class="btn danger small" data-delete-customer="${c.id}">Delete</button></td></tr>`).join("") || `<tr><td colspan="4" class="empty">You don't have any customers yet. <button class="btn primary small" data-new-customer>Add your first customer</button></td></tr>`;
  return shell(`<div class="section-title"><div><h1>Customers</h1><p class="muted">Manage the people and businesses you invoice.</p></div><button class="btn primary" data-new-customer>Add customer</button></div>
    <div id="customerFormSlot"></div>
    <div class="toolbar"><input id="customerSearch" type="search" placeholder="Search customers" value="${escapeHtml(state.customerSearch)}"><button class="btn secondary" id="clearCustomerSearch">Clear</button></div>
    <div class="table-wrap"><table><thead><tr><th>Name</th><th>Phone</th><th>Billing address</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table></div>`);
}

function customerForm(customer = {}) {
  return `<section class="card" style="margin-bottom:16px"><form class="form" id="customerForm" data-id="${customer.id || ""}">
    <div class="grid two">${field("name", "Name / Company", "text", customer.name)}${field("email", "Email", "email", customer.email)}</div>
    <div class="grid two">${field("phone", "Phone", "text", customer.phone)}${textArea("billingAddress", "Billing address", customer.billing_address)}</div>
    ${textArea("notes", "Notes", customer.notes)}
    <div class="actions"><button class="btn primary">Save customer</button><button type="button" class="btn secondary" data-cancel-form>Cancel</button></div>
  </form></section>`;
}

async function invoicesView() {
  await loadInvoices();
  const rows = state.invoices.map(invoiceRow).join("") || `<tr><td colspan="7" class="empty">No invoices yet. <button class="btn primary small" data-nav="invoice-new">Create your first invoice</button></td></tr>`;
  return shell(`<div class="section-title"><div><h1>Invoices</h1><p class="muted">Create, send, download, and track invoices.</p></div><button class="btn primary" data-nav="invoice-new">Create invoice</button></div>
    <div class="toolbar">
      <input id="invoiceSearch" type="search" placeholder="Search invoices or customers" value="${escapeHtml(state.invoiceSearch)}">
      <select id="invoiceStatus"><option value="">All statuses</option>${["draft", "sent", "paid", "overdue", "cancelled"].map((status) => `<option value="${status}" ${state.invoiceStatus === status ? "selected" : ""}>${status[0].toUpperCase() + status.slice(1)}</option>`).join("")}</select>
      <button class="btn secondary" id="clearInvoiceFilters">Clear</button>
    </div>
    ${invoiceTable(rows)}`);
}

function invoiceTable(rows) {
  return `<div class="table-wrap"><table><thead><tr><th>Invoice</th><th>Customer</th><th>Date</th><th>Due</th><th>Amount</th><th>Status</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function invoiceRow(i) {
  return `<tr><td><strong>${escapeHtml(i.invoice_number)}</strong></td><td>${escapeHtml(i.customer_name || "No customer")}</td><td>${i.issue_date}</td><td>${i.due_date}</td><td>${money(i.total_cents, i.currency)}</td><td><span class="badge ${i.status}">${i.status}</span></td><td class="actions"><button class="btn secondary small" data-view-invoice="${i.id}">View</button><button class="btn secondary small" data-edit-invoice="${i.id}">Edit</button><button class="btn secondary small" data-pdf="${i.id}">PDF</button><button class="btn secondary small" data-send="${i.id}">Send</button><button class="btn secondary small" data-paid="${i.id}">Paid</button></td></tr>`;
}

async function invoiceEditor(id) {
  await Promise.all([loadCustomers(), api("/business").then((d) => state.business = d.profile)]);
  let invoice = null;
  if (id) invoice = (await api(`/invoices/${id}`)).invoice;
  const next = id ? invoice.invoice_number : (await api("/invoices/next-number")).invoiceNumber;
  const items = invoice?.items?.length ? invoice.items.map((item) => ({ description: item.description, quantity: item.quantity, unitPrice: item.unit_price_cents / 100, taxRate: item.tax_rate / 100 })) : [{ description: "", quantity: 1, unitPrice: 0, taxRate: state.business.default_tax_rate }];
  return shell(`<div class="section-title"><div><h1>${id ? "Edit Invoice" : "Create Invoice"}</h1><p class="muted">Build a clean invoice with live totals.</p></div><div class="actions"><button class="btn secondary" data-nav="invoices">Cancel</button></div></div>
    <form class="form" id="invoiceForm" data-id="${id || ""}">
      <section class="card grid two">
        ${field("invoiceNumber", "Invoice number", "text", next)}
        <div class="field"><label for="customerId">Customer</label><select id="customerId" name="customerId"><option value="">Select customer</option>${state.customers.map((c) => `<option value="${c.id}" ${Number(invoice?.customer_id) === c.id ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}</select><span class="error" data-error="customerId"></span></div>
        ${field("issueDate", "Issue date", "date", invoice?.issue_date || today())}
        ${field("dueDate", "Due date", "date", invoice?.due_date || plusDays(30))}
      </section>
      <section class="card"><h2>Line items</h2><div id="items">${items.map(itemForm).join("")}</div><button type="button" class="btn secondary" id="addItem">+ Add line item</button></section>
      <section class="card grid two">${field("discount", "Discount", "number", invoice ? invoice.discount_cents / 100 : 0)}${textArea("paymentTerms", "Payment terms", invoice?.payment_terms || "Payment due within 30 days.")}${textArea("notes", "Notes", invoice?.notes || "Thank you for your business.")}<div class="totals" id="totals"></div></section>
      <div class="actions"><button class="btn secondary" name="intent" value="draft">Save draft</button><button class="btn primary" name="intent" value="sent">Save & send-ready</button></div>
    </form>`);
}

function itemForm(item = {}) {
  return `<div class="item-row" data-item>
    <input class="wide" name="description" placeholder="Description" value="${escapeHtml(item.description)}">
    <input name="quantity" type="number" min="1" step="1" value="${item.quantity || 1}">
    <input name="unitPrice" type="number" min="0" step="0.01" value="${item.unitPrice || 0}">
    <input name="taxRate" type="number" min="0" step="0.01" value="${item.taxRate ?? 15}">
    <strong data-line-total>R0.00</strong>
    <button type="button" class="btn danger small" data-remove-item>x</button>
  </div>`;
}

function calculateClientInvoice() {
  const rows = [...document.querySelectorAll("[data-item]")];
  let subtotal = 0, tax = 0;
  rows.forEach((row) => {
    const qty = Number(row.querySelector("[name=quantity]").value || 0);
    const price = Number(row.querySelector("[name=unitPrice]").value || 0);
    const rate = Number(row.querySelector("[name=taxRate]").value || 0);
    const lineSubtotal = qty * price;
    const lineTax = lineSubtotal * rate / 100;
    row.querySelector("[data-line-total]").textContent = money(Math.round((lineSubtotal + lineTax) * 100));
    subtotal += lineSubtotal;
    tax += lineTax;
  });
  const discount = Number(document.querySelector("[name=discount]")?.value || 0);
  document.querySelector("#totals").innerHTML = `<div><span>Subtotal</span><strong>${money(Math.round(subtotal * 100))}</strong></div><div><span>Tax</span><strong>${money(Math.round(tax * 100))}</strong></div><div><span>Discount</span><strong>-${money(Math.round(discount * 100))}</strong></div><div class="grand"><span>Total</span><strong>${money(Math.round((subtotal + tax - discount) * 100))}</strong></div>`;
}

async function invoiceDetail(id) {
  const [invoiceData, businessData] = await Promise.all([api(`/invoices/${id}`), api("/business")]);
  const invoice = invoiceData.invoice;
  state.business = businessData.profile;
  const customer = { name: invoice.customer_name, email: invoice.customer_email, billing_address: invoice.customer_billing_address };
  const items = invoice.items.map((item) => `<tr><td>${escapeHtml(item.description)}</td><td>${item.quantity}</td><td>${money(item.unit_price_cents, invoice.currency)}</td><td>${money(item.line_total_cents, invoice.currency)}</td></tr>`).join("");
  return shell(`<div class="section-title"><h1>${escapeHtml(invoice.invoice_number)}</h1><div class="actions"><button class="btn secondary" data-nav="invoices">Back</button><button class="btn secondary" data-pdf="${invoice.id}">Download PDF</button><button class="btn primary" data-send="${invoice.id}">Send</button></div></div>
    <section class="preview">
      <div class="preview-header"><div><h2>${escapeHtml(state.business?.business_name || "Your Business")}</h2><p class="muted">${escapeHtml(state.business?.email || "")}</p></div><div><h2>INVOICE</h2><strong>${escapeHtml(invoice.invoice_number)}</strong><p>Issue: ${invoice.issue_date}<br>Due: ${invoice.due_date}</p></div></div>
      <div class="grid two"><div><strong>Bill to</strong><p>${escapeHtml(customer.name || "")}<br>${escapeHtml(customer.billing_address || "")}<br>${escapeHtml(customer.email || "")}</p></div><div><span class="badge ${invoice.status}">${invoice.status}</span></div></div>
      <div class="table-wrap"><table><thead><tr><th>Description</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead><tbody>${items}</tbody></table></div>
      <div class="totals" style="margin-top:18px"><div><span>Subtotal</span><strong>${money(invoice.subtotal_cents, invoice.currency)}</strong></div><div><span>Tax</span><strong>${money(invoice.tax_cents, invoice.currency)}</strong></div><div><span>Discount</span><strong>-${money(invoice.discount_cents, invoice.currency)}</strong></div><div class="grand"><span>Total</span><strong>${money(invoice.total_cents, invoice.currency)}</strong></div></div>
      <p><strong>Payment terms</strong><br>${escapeHtml(invoice.payment_terms || "")}</p><p><strong>Notes</strong><br>${escapeHtml(invoice.notes || "")}</p>
    </section>`);
}

async function settingsView() {
  state.business = (await api("/business")).profile;
  const b = state.business;
  return shell(`<div class="section-title"><div><h1>Settings</h1><p class="muted">Business details and invoice defaults.</p></div></div>
    <form class="form card" id="businessForm">
      <div class="grid two">${field("businessName", "Business name", "text", b.business_name)}${field("email", "Business email", "email", b.email)}</div>
      <div class="grid two">${field("phone", "Phone", "text", b.phone)}${field("website", "Website", "text", b.website)}</div>
      ${textArea("address", "Address", b.address)}
      <div class="grid two">${field("taxNumber", "Tax/VAT number", "text", b.tax_number)}${field("currency", "Currency", "text", b.currency)}</div>
      <div class="grid two">${field("defaultTaxRate", "Default tax rate %", "number", b.default_tax_rate)}${field("accentColor", "Accent colour", "color", b.accent_color)}</div>
      <div class="grid two">${field("invoicePrefix", "Invoice prefix", "text", b.invoice_prefix)}${field("nextInvoiceNumber", "Next invoice number", "number", b.next_invoice_number)}</div>
      <div class="field"><label for="invoiceTemplate">Invoice template</label><select id="invoiceTemplate" name="invoiceTemplate"><option value="clean">Clean</option><option value="professional">Professional</option><option value="minimal">Minimal</option></select></div>
      ${textArea("paymentDetails", "Payment details", b.payment_details)}
      <button class="btn primary">Save settings</button>
    </form>`);
}

async function recurringView() {
  await loadCustomers();
  const rows = (await api("/recurring-invoices")).recurringInvoices.map((r) => `<tr><td><strong>${escapeHtml(r.title)}</strong></td><td>${escapeHtml(r.customer_name || "")}</td><td>${r.frequency}</td><td>${r.next_invoice_date}</td><td><span class="badge ${r.status}">${r.status}</span></td><td class="actions"><button class="btn secondary small" data-rec-status="${r.id}" data-status="${r.status === "active" ? "paused" : "active"}">${r.status === "active" ? "Pause" : "Resume"}</button><button class="btn danger small" data-delete-rec="${r.id}">Cancel</button></td></tr>`).join("") || `<tr><td colspan="6" class="empty">No recurring invoices yet.</td></tr>`;
  return shell(`<div class="section-title"><div><h1>Recurring</h1><p class="muted">Create repeatable invoice templates for later automation.</p></div></div>
    <section class="card"><form class="form" id="recurringForm">
      <div class="grid two">${field("title", "Title")}<div class="field"><label>Customer</label><select name="customerId"><option value="">Select customer</option>${state.customers.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("")}</select></div></div>
      <div class="grid two"><div class="field"><label>Frequency</label><select name="frequency"><option value="weekly">Weekly</option><option value="monthly" selected>Monthly</option><option value="quarterly">Quarterly</option><option value="yearly">Yearly</option></select></div>${field("startDate", "Start date", "date", today())}${field("nextInvoiceDate", "Next invoice date", "date", today())}${field("endDate", "End date", "date")}</div>
      <button class="btn primary">Create recurring invoice</button>
    </form></section><h2 style="margin-top:24px">Templates</h2><div class="table-wrap"><table><thead><tr><th>Title</th><th>Customer</th><th>Frequency</th><th>Next invoice</th><th>Status</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table></div>`);
}

async function render() {
  try {
    if (!state.user && !["landing", "login", "register"].includes(state.route)) state.route = "login";
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
    app.innerHTML = shell(`<section class="card"><h1>Something went wrong</h1><p class="muted">${escapeHtml(error.error?.message || "Please try again.")}</p></section>`);
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
  showToast(error.error?.message || "Please check the form.");
}

function bindEvents() {
  document.querySelectorAll("[data-nav]").forEach((el) => el.addEventListener("click", () => navigate(el.dataset.nav)));
  document.querySelector("#logoutBtn")?.addEventListener("click", async () => { await api("/auth/logout", { method: "POST" }); state.user = null; navigate("landing"); });
  document.querySelector("#registerForm")?.addEventListener("submit", submitAuth("register"));
  document.querySelector("#loginForm")?.addEventListener("submit", submitAuth("login"));
  document.querySelectorAll("[data-toggle-password]").forEach((btn) => btn.addEventListener("click", () => {
    const input = document.querySelector(`#${CSS.escape(btn.dataset.togglePassword)}`);
    const showing = input.type === "text";
    input.type = showing ? "password" : "text";
    btn.textContent = showing ? "Show" : "Hide";
    btn.setAttribute("aria-label", `${showing ? "Show" : "Hide"} ${input.name}`);
  }));
  document.querySelector("[data-new-customer]")?.addEventListener("click", () => { document.querySelector("#customerFormSlot").innerHTML = customerForm(); bindEvents(); });
  document.querySelector("#customerSearch")?.addEventListener("input", debounce((event) => { state.customerSearch = event.target.value; render(); }, 250));
  document.querySelector("#clearCustomerSearch")?.addEventListener("click", () => { state.customerSearch = ""; render(); });
  document.querySelectorAll("[data-edit-customer]").forEach((btn) => btn.addEventListener("click", () => { const c = state.customers.find((x) => x.id === Number(btn.dataset.editCustomer)); document.querySelector("#customerFormSlot").innerHTML = customerForm(c); bindEvents(); }));
  document.querySelector("#customerForm")?.addEventListener("submit", submitCustomer);
  document.querySelector("[data-cancel-form]")?.addEventListener("click", () => { document.querySelector("#customerFormSlot").innerHTML = ""; });
  document.querySelectorAll("[data-delete-customer]").forEach((btn) => btn.addEventListener("click", async () => { if (confirm("Delete this customer? Historical invoices will be preserved.")) { await api(`/customers/${btn.dataset.deleteCustomer}`, { method: "DELETE" }); showToast("Customer deleted."); render(); } }));
  document.querySelector("#businessForm")?.addEventListener("submit", submitBusiness);
  document.querySelector("#invoiceSearch")?.addEventListener("input", debounce((event) => { state.invoiceSearch = event.target.value; render(); }, 250));
  document.querySelector("#invoiceStatus")?.addEventListener("change", (event) => { state.invoiceStatus = event.target.value; render(); });
  document.querySelector("#clearInvoiceFilters")?.addEventListener("click", () => { state.invoiceSearch = ""; state.invoiceStatus = ""; render(); });
  document.querySelector("#invoiceForm")?.addEventListener("submit", submitInvoice);
  document.querySelector("#invoiceForm")?.addEventListener("input", calculateClientInvoice);
  document.querySelector("#addItem")?.addEventListener("click", () => { document.querySelector("#items").insertAdjacentHTML("beforeend", itemForm({ taxRate: state.business?.default_tax_rate || 15 })); bindEvents(); calculateClientInvoice(); });
  document.querySelectorAll("[data-remove-item]").forEach((btn) => btn.addEventListener("click", () => { btn.closest("[data-item]").remove(); calculateClientInvoice(); }));
  document.querySelectorAll("[data-view-invoice]").forEach((btn) => btn.addEventListener("click", () => navigate(`invoice-${btn.dataset.viewInvoice}`)));
  document.querySelectorAll("[data-edit-invoice]").forEach((btn) => btn.addEventListener("click", () => navigate(`invoice-edit-${btn.dataset.editInvoice}`)));
  document.querySelectorAll("[data-pdf]").forEach((btn) => btn.addEventListener("click", () => { location.href = `/api/invoices/${btn.dataset.pdf}/pdf`; }));
  document.querySelectorAll("[data-send]").forEach((btn) => btn.addEventListener("click", async () => { const email = prompt("Recipient email"); if (email) { const result = await api(`/invoices/${btn.dataset.send}/send`, { method: "POST", body: { email } }); showToast(result.email.message || "Invoice send flow completed."); render(); } }));
  document.querySelectorAll("[data-paid]").forEach((btn) => btn.addEventListener("click", async () => { await api(`/invoices/${btn.dataset.paid}/mark-paid`, { method: "POST", body: {} }); showToast("Invoice marked as paid."); render(); }));
  document.querySelector("#recurringForm")?.addEventListener("submit", submitRecurring);
  document.querySelectorAll("[data-rec-status]").forEach((btn) => btn.addEventListener("click", async () => { await api(`/recurring-invoices/${btn.dataset.recStatus}`, { method: "PUT", body: { status: btn.dataset.status } }); showToast("Recurring invoice updated."); render(); }));
  document.querySelectorAll("[data-delete-rec]").forEach((btn) => btn.addEventListener("click", async () => { await api(`/recurring-invoices/${btn.dataset.deleteRec}`, { method: "DELETE" }); showToast("Recurring invoice cancelled."); render(); }));
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
      navigate("dashboard");
    } catch (error) { showErrors(error); }
  };
}

async function submitCustomer(event) {
  event.preventDefault();
  const id = event.target.dataset.id;
  try {
    await api(id ? `/customers/${id}` : "/customers", { method: id ? "PUT" : "POST", body: formData(event.target) });
    showToast("Customer saved.");
    render();
  } catch (error) { showErrors(error); }
}

async function submitBusiness(event) {
  event.preventDefault();
  await api("/business", { method: "PUT", body: formData(event.target) });
  showToast("Business settings saved.");
  render();
}

async function submitInvoice(event) {
  event.preventDefault();
  const submitter = event.submitter;
  const body = formData(event.target);
  body.status = submitter?.value === "sent" ? "sent" : "draft";
  body.items = [...document.querySelectorAll("[data-item]")].map((row) => ({
    description: row.querySelector("[name=description]").value,
    quantity: row.querySelector("[name=quantity]").value,
    unitPrice: row.querySelector("[name=unitPrice]").value,
    taxRate: row.querySelector("[name=taxRate]").value
  }));
  const id = event.target.dataset.id;
  try {
    const result = await api(id ? `/invoices/${id}` : "/invoices", { method: id ? "PUT" : "POST", body });
    showToast("Invoice saved successfully.");
    navigate(`invoice-${result.invoice.id}`);
  } catch (error) { showErrors(error); }
}

async function submitRecurring(event) {
  event.preventDefault();
  try {
    await api("/recurring-invoices", { method: "POST", body: formData(event.target) });
    showToast("Recurring invoice created.");
    render();
  } catch (error) { showErrors(error); }
}

async function boot() {
  const session = await api("/auth/me");
  state.user = session.user;
  if (state.user && ["landing", "login", "register"].includes(state.route)) state.route = "dashboard";
  render();
}

boot();
