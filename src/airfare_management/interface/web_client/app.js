"use strict";

const API_ROOT = "/v1";
const TOKEN_KEY = "airfare_access_token";
const REFRESH_KEY = "airfare_refresh_token";
const state = {
  token: "",
  refreshToken: "",
  user: null,
  activeModule: "dashboard",
};

const modules = [
  { id: "dashboard", label: "Dashboard", icon: "▦" },
  { id: "employees", label: "Employees", icon: "♙" },
  { id: "balances", label: "Opening Balances", icon: "◫" },
  { id: "allocation", label: "Airfare Allocation", icon: "▣" },
  { id: "tickets", label: "Tickets", icon: "⌁" },
  { id: "loans", label: "Loans", icon: "◎" },
  { id: "preferences", label: "Preferences", icon: "⚙" },
  { id: "backup", label: "Backup & Restore", icon: "⇪" },
  { id: "reports", label: "Reports", icon: "▤" },
  { id: "ess", label: "Employee Self Service", icon: "◉" },
  { id: "administration", label: "Administration", icon: "⚒" },
];

const tableModules = {
  employees: {
    title: "Employees",
    subtitle: "Employee master records and travel eligibility details.",
    endpoint: "/employees",
    createEndpoint: "/employees",
    templateName: "employees",
    importPreviewEndpoint: "/employees/import/preview",
    importCommitEndpoint: "/employees/import/commit",
    importKind: "employee",
    fields: [
      ["code", "Code", "text"], ["full_name", "Full name", "text"],
      ["company_id", "Company", "company"], ["join_date", "Join date", "date"],
      ["department", "Department", "lookup:departments"],
      ["branch", "Branch / Repair center", "lookup:repair_centers"],
      ["pay_group", "Pay group", "lookup:pay_groups"],
      ["designation", "Designation", "lookup:designations"],
      ["sub_section", "Sub section", "lookup:sub_sections"],
      ["nationality", "Nationality", "lookup:nationalities"],
      ["reporting_officer_id", "Reporting officer", "employee_optional"],
      ["email", "Email", "email"],
      ["custom_airfare_rate", "Custom airfare rate", "number"],
      ["max_entitlement_cap_rate", "Maximum entitlement", "number"],
    ],
    updateFields: ["full_name", "join_date", "department", "branch", "pay_group",
      "designation", "sub_section", "nationality", "reporting_officer_id", "email",
      "custom_airfare_rate", "max_entitlement_cap_rate", "active"],
    columns: [
      ["code", "Code"],
      ["full_name", "Employee"],
      ["department", "Department"],
      ["branch", "Branch"],
      ["join_date", "Join date"],
      ["email", "Email"],
      ["active", "Status"],
    ],
  },
  balances: {
    title: "Opening Balances",
    subtitle: "Imported entitlement balances and payout limits.",
    endpoint: "/opening-balances",
    createEndpoint: "/opening-balances",
    templateName: "opening-balances",
    importPreviewEndpoint: "/opening-balances/import/preview",
    importCommitEndpoint: "/opening-balances/import/commit",
    importKind: "opening-balance",
    fields: [
      ["employee_id", "Employee", "employee"], ["balance_year", "Year", "number"],
      ["opening_days", "Opening days", "number"], ["paid_days", "Paid days", "number"],
      ["opening_amount", "Opening amount", "number"],
      ["maximum_payout", "Maximum payout", "number"],
    ],
    updateFields: ["opening_days", "paid_days", "opening_amount", "maximum_payout"],
    columns: [
      ["employee_label", "Employee"],
      ["balance_year", "Year"],
      ["opening_days", "Opening days"],
      ["paid_days", "Paid days"],
      ["opening_amount", "Opening amount"],
      ["maximum_payout", "Maximum payout"],
    ],
  },
  tickets: {
    title: "Tickets",
    subtitle: "Air ticket requests, costs, entitlement and workflow status.",
    endpoint: "/tickets",
    createEndpoint: "/tickets",
    templateName: "tickets",
    fields: [
      ["employee_id", "Employee", "employee"], ["travel_date", "Travel date", "date"],
      ["origin_code", "Origin", "text"], ["destination_code", "Destination", "text"],
      ["ticket_cost", "Ticket cost", "number"], ["entitlement", "Entitlement", "number"],
      ["company_paid", "Company paid", "number"],
      ["excess_handling", "Excess handling", "select",
        ["SELF_PAID", "COMPANY_PAID", "CONVERT_TO_LOAN"]],
    ],
    workflow: true,
    columns: [
      ["ticket_code", "Ticket"],
      ["travel_date", "Travel date"],
      ["employee_label", "Employee"],
      ["route", "Route"],
      ["ticket_cost", "Ticket cost"],
      ["entitlement", "Entitlement"],
      ["excess_amount", "Excess"],
      ["status", "Status"],
    ],
  },
  loans: {
    title: "Loans",
    subtitle: "Employee airfare recoveries and outstanding balances.",
    endpoint: "/loans",
    createEndpoint: "/loans",
    templateName: "loans",
    fields: [
      ["employee_id", "Employee", "employee"], ["principal", "Principal", "number"],
      ["annual_rate", "Annual rate", "number"], ["installments", "Installments", "number"],
      ["first_due_date", "First due date", "date"],
    ],
    schedule: true,
    columns: [
      ["loan_code", "Loan"],
      ["employee_label", "Employee"],
      ["principal", "Principal"],
      ["annual_rate", "Rate %"],
      ["installments", "Installments"],
      ["monthly_installment", "Monthly"],
      ["outstanding", "Outstanding"],
      ["status", "Status"],
    ],
    emiRunner: true,
  },
};

const REPORT_TEMPLATE_NAMES = {
  "entitlement-balance-summary": "report-entitlement-balance-summary",
  "booking-register": "report-booking-register",
  "loan-recovery-ledger": "report-loan-recovery-ledger",
  "liability-projections": "report-liability-projections",
  "employee-master": "report-employee-master",
  "opening-balances": "report-opening-balances",
  entitlements: "report-entitlements",
  "ticket-register": "report-ticket-register",
  "loan-outstanding": "report-loan-outstanding",
  "loan-statement": "report-loan-statement",
  "excess-recovery": "report-excess-recovery",
};

const THEME_KEY = "airfare_theme";

const DASHBOARD_TEMPLATES = [
  ["employees", "Employee Master"],
  ["opening-balances", "Opening Balances"],
  ["tickets", "Tickets"],
  ["loans", "Loans"],
  ["ess-requests", "ESS Requests"],
  ["lookups", "Lookups"],
  ["entitlement-rates", "Entitlement Rates"],
  ["entitlement-preview", "Entitlement Preview"],
  ["allocation-preview", "Allocation Engine"],
  ["report-employee-master", "Report: Employee Master"],
  ["report-opening-balances", "Report: Opening Balances"],
  ["report-entitlements", "Report: Entitlements"],
  ["report-ticket-register", "Report: Ticket Register"],
  ["report-loan-outstanding", "Report: Loan Outstanding"],
  ["report-loan-statement", "Report: Loan Statement"],
  ["report-excess-recovery", "Report: Excess Recovery"],
];

function templateButton(templateName, label = "Excel template") {
  return el("button", {
    className: "secondary",
    type: "button",
    text: label,
    on: {
      click: async () => {
        try {
          await downloadTemplateFile(templateName);
        } catch (error) {
          showError(document.querySelector("#content"), error.message);
        }
      },
    },
  });
}

async function downloadTemplateFile(templateName) {
  await downloadReportFile(`/templates/${templateName}.xlsx`, `${templateName}-template.xlsx`);
}

function el(tag, options = {}, ...children) {
  const node = document.createElement(tag);
  Object.entries(options).forEach(([key, value]) => {
    if (key === "className") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "on") {
      Object.entries(value).forEach(([event, handler]) => node.addEventListener(event, handler));
    } else if (key === "dataset") {
      Object.assign(node.dataset, value);
    } else if (typeof value === "boolean") {
      // HTML treats attribute presence as true; disabled="false" would still disable.
      if (key in node) node[key] = value;
      if (value) node.setAttribute(key, "");
      else node.removeAttribute(key);
    } else if (value !== undefined && value !== null) {
      node.setAttribute(key, String(value));
    }
  });
  children.flat().filter(Boolean).forEach((child) => {
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  });
  return node;
}

function installStyles() {
  const style = el("style");
  style.textContent = `
    :root { color-scheme: light; --navy:#16324f; --blue:#2463a6; --blue2:#e9f2fb;
      --slate:#526579; --line:#dce5ee; --paper:#fff; --bg:#f3f6f9; --danger:#b42318;
      --success:#197149; font-family: Inter, "Segoe UI", Arial, sans-serif; }
    * { box-sizing:border-box; }
    body { margin:0; background:var(--bg); color:#172b3d; min-height:100vh; }
    button,input,select { font:inherit; }
    button { cursor:pointer; }
    .login-page { min-height:100vh; display:grid; grid-template-columns:minmax(300px, 46%) 1fr; }
    .login-brand { background:linear-gradient(145deg,#102b46,#1f5688); color:white; padding:9vw 7vw;
      display:flex; flex-direction:column; justify-content:center; position:relative; overflow:hidden; }
    .login-brand::after { content:""; position:absolute; width:420px; height:420px; border:70px solid
      rgba(255,255,255,.06); border-radius:50%; right:-190px; bottom:-190px; }
    .brand-mark { width:56px; height:56px; background:#fff; color:var(--blue); border-radius:14px;
      display:grid; place-items:center; font-size:28px; font-weight:800; margin-bottom:24px; }
    .login-brand h1 { font-size:clamp(32px,4vw,56px); line-height:1.05; margin:0 0 18px; max-width:600px; }
    .login-brand p { color:#d8e8f6; font-size:18px; line-height:1.6; max-width:560px; }
    .login-panel { display:flex; align-items:center; justify-content:center; padding:40px; }
    .login-card { width:min(420px,100%); }
    .eyebrow { color:var(--blue); font-size:12px; letter-spacing:.13em; font-weight:800; text-transform:uppercase; }
    h2 { color:var(--navy); font-size:30px; margin:9px 0 8px; }
    .muted { color:var(--slate); margin:0; line-height:1.5; }
    .field { display:flex; flex-direction:column; gap:7px; margin-top:20px; }
    .field label { font-weight:650; color:#31475b; font-size:14px; }
    .field input,.field select { border:1px solid #c8d5e1; background:white; border-radius:8px; padding:12px;
      outline:none; width:100%; }
    .field input:focus,.field select:focus { border-color:var(--blue); box-shadow:0 0 0 3px #d9eaf9; }
    .primary { border:0; background:var(--blue); color:white; border-radius:8px; padding:12px 18px;
      font-weight:700; box-shadow:0 2px 5px rgba(18,73,124,.18); }
    .primary:hover { background:#1c548d; }
    .login-card .primary { width:100%; margin-top:24px; }
    .error { color:var(--danger); background:#fff0ee; border:1px solid #ffd0ca; border-radius:8px;
      padding:10px 12px; margin-top:16px; font-size:14px; }
    .shell { min-height:100vh; display:grid; grid-template-columns:250px 1fr; }
    .sidebar { background:#142f49; color:#dceaf5; padding:22px 15px; display:flex; flex-direction:column;
      position:sticky; top:0; height:100vh; }
    .side-brand { display:flex; gap:12px; align-items:center; padding:0 9px 24px; border-bottom:1px solid #2d4a64; }
    .side-brand .brand-mark { width:38px; height:38px; margin:0; font-size:18px; border-radius:9px; }
    .side-brand strong { color:#fff; display:block; }
    .side-brand small { color:#9eb5c8; }
    nav { display:flex; flex-direction:column; gap:5px; padding-top:21px; }
    .nav-button { border:0; background:transparent; color:#c4d5e3; border-radius:8px; padding:11px 12px;
      text-align:left; display:flex; gap:12px; align-items:center; }
    .nav-button:hover,.nav-button.active { color:white; background:#234c70; }
    .nav-icon { font-size:17px; width:19px; text-align:center; }
    .sidebar-footer { margin-top:auto; border-top:1px solid #2d4a64; padding:17px 8px 0; }
    .user-name { color:white; font-weight:650; }
    .user-role { color:#9eb5c8; font-size:12px; margin-top:3px; }
    .logout { background:transparent; border:0; color:#c4d5e3; padding:12px 0 0; }
    .main { min-width:0; }
    .topbar { height:72px; background:white; border-bottom:1px solid var(--line); display:flex;
      align-items:center; justify-content:space-between; padding:0 30px; position:sticky; top:0; z-index:5; }
    .topbar-title { font-weight:750; color:var(--navy); }
    .live { display:flex; align-items:center; gap:8px; color:var(--slate); font-size:13px; }
    .dot { width:8px; height:8px; border-radius:50%; background:#2aaa6d; box-shadow:0 0 0 3px #ddf5e9; }
    .content { padding:30px; max-width:1500px; margin:0 auto; }
    .page-head { display:flex; justify-content:space-between; gap:20px; align-items:flex-end; margin-bottom:24px; }
    .page-head h1 { color:var(--navy); font-size:28px; margin:4px 0 5px; }
    .secondary { border:1px solid #bfd0df; background:white; color:#24445f; border-radius:8px;
      padding:10px 15px; font-weight:650; }
    .secondary:hover { background:#f5f9fc; }
    .danger-button { border:1px solid #f2b8b5; background:#fff; color:var(--danger);
      border-radius:7px; padding:6px 9px; }
    .actions { display:flex; gap:7px; }
    dialog { border:0; border-radius:12px; padding:0; width:min(680px,calc(100vw - 30px));
      box-shadow:0 20px 70px rgba(10,35,55,.3); }
    dialog::backdrop { background:rgba(10,31,50,.55); }
    .dialog-head { padding:20px 24px; border-bottom:1px solid var(--line); }
    .dialog-body { padding:4px 24px 24px; }
    .dialog-actions { display:flex; justify-content:flex-end; gap:10px; margin-top:22px; }
    .cards { display:grid; grid-template-columns:repeat(4,minmax(160px,1fr)); gap:17px; }
    .card { background:var(--paper); border:1px solid var(--line); border-radius:11px; padding:20px;
      box-shadow:0 2px 8px rgba(27,55,80,.04); }
    .metric-label { color:var(--slate); font-size:13px; font-weight:650; }
    .metric-value { color:var(--navy); font-size:30px; font-weight:800; margin-top:10px; }
    .metric-note { color:#738497; font-size:12px; margin-top:7px; }
    .panel { background:white; border:1px solid var(--line); border-radius:11px;
      box-shadow:0 2px 8px rgba(27,55,80,.04); overflow:hidden; }
    .panel-header { padding:18px 20px; border-bottom:1px solid var(--line); display:flex;
      align-items:center; justify-content:space-between; gap:15px; }
    .panel-title { color:var(--navy); font-weight:750; }
    .quick-grid { margin-top:18px; display:grid; grid-template-columns:2fr 1fr; gap:18px; }
    .module-list { display:grid; grid-template-columns:repeat(2,1fr); gap:10px; padding:18px; }
    .module-link { border:1px solid var(--line); background:#f9fbfd; border-radius:8px; padding:14px;
      text-align:left; color:#2a455c; font-weight:650; }
    .module-link:hover { border-color:#9fc0dc; background:var(--blue2); }
    .system-list { list-style:none; margin:0; padding:16px 20px; }
    .system-list li { padding:9px 0; border-bottom:1px solid #edf1f5; display:flex;
      justify-content:space-between; color:var(--slate); font-size:13px; }
    .table-toolbar { display:flex; gap:10px; }
    .search { border:1px solid #c8d5e1; border-radius:8px; padding:9px 11px; min-width:240px; }
    .table-wrap { overflow:auto; }
    table { width:100%; border-collapse:collapse; white-space:nowrap; }
    th { background:#f5f8fb; color:#4d6072; font-size:12px; text-transform:uppercase; letter-spacing:.04em;
      text-align:left; padding:12px 16px; border-bottom:1px solid var(--line); }
    th.sortable { cursor:pointer; user-select:none; }
    th.sortable:focus-visible { outline:3px solid #9bc8ec; outline-offset:-3px; }
    td { padding:13px 16px; border-bottom:1px solid #e8eef3; color:#30475b; font-size:14px; }
    tr:hover td { background:#f8fbfe; }
    .pill { display:inline-flex; border-radius:999px; padding:4px 9px; font-size:12px; font-weight:700;
      background:#edf3f8; color:#405b72; text-transform:capitalize; }
    .pill.active,.pill.approved,.pill.paid,.pill.settled { color:var(--success); background:#e5f6ee; }
    .pill.rejected,.pill.overdue { color:var(--danger); background:#ffebe8; }
    .empty { padding:45px; text-align:center; color:var(--slate); }
    .pager { padding:13px 18px; display:flex; justify-content:space-between; align-items:center;
      border-top:1px solid var(--line); color:var(--slate); font-size:13px; }
    .pager-buttons { display:flex; gap:8px; }
    button:disabled { cursor:not-allowed; opacity:.5; }
    .success { color:var(--success); background:#e8f7ef; border:1px solid #bfe8d2;
      border-radius:8px; padding:10px 12px; margin-top:16px; font-size:14px; }
    .form-panel { padding:24px; }
    .form-grid { display:grid; grid-template-columns:repeat(2,minmax(180px,1fr)); gap:0 20px; max-width:800px; }
    .form-actions { margin-top:22px; display:flex; gap:10px; align-items:center; }
    .results { display:grid; grid-template-columns:repeat(3,1fr); gap:14px; margin-top:25px; }
    .result { background:#edf5fc; border:1px solid #d2e4f3; border-radius:9px; padding:18px; }
    .result strong { display:block; color:var(--navy); font-size:25px; margin-top:7px; }
    pre { background:#122d46; color:#dceaf5; border-radius:9px; padding:20px; overflow:auto; line-height:1.5; }
    .report-card { display:flex; justify-content:space-between; align-items:center; gap:20px; }
    .import-preview { max-height:420px; overflow:auto; margin-top:12px; border:1px solid var(--line);
      border-radius:8px; }
    .import-preview table { min-width:100%; }
    .severity-ready { color:var(--success); font-weight:650; }
    .severity-error { color:var(--danger); font-weight:650; }
    .danger-zone { border:1px solid #f2b8b5; background:#fff7f6; border-radius:11px; padding:18px 20px; }
    .pref-help { color:var(--slate); font-size:14px; line-height:1.55; max-width:820px; }
    .policy-table { padding:0 0 8px; }
    dialog.report-dialog { width:min(1100px,calc(100vw - 30px)); }
    .report-icon { width:48px; height:48px; display:grid; place-items:center; background:#e9f2fb;
      color:var(--blue); border-radius:9px; font-size:22px; flex:0 0 auto; }
    .loading { height:3px; background:linear-gradient(90deg,transparent,var(--blue),transparent);
      background-size:200% 100%; animation:load 1s infinite; position:fixed; top:0; left:250px; right:0; z-index:20; }
    body.dark { --paper:#172735; --bg:#0e1b26; --line:#2e4354; color:#e8f0f6; }
    body.dark .topbar,body.dark .panel,body.dark .card,body.dark input,body.dark select,
    body.dark dialog { background:#172735; color:#e8f0f6; }
    body.dark h1,body.dark h2,body.dark .panel-title,body.dark .metric-value { color:#eef7ff; }
    @keyframes load { to { background-position:-200% 0; } }
    .excess-panel { display:none; margin-top:18px; border:1px solid #f0c36d; background:#fff8e8;
      border-radius:10px; padding:16px 18px; }
    .excess-panel.visible { display:block; }
    .excess-options { display:flex; flex-direction:column; gap:8px; margin-top:10px; }
    .excess-options label { display:flex; gap:10px; align-items:flex-start; font-weight:650; color:#5c4310; }
    .excess-options input { width:auto; margin-top:3px; }
    .master-hidden { display:none !important; }
    .results.always-on { min-height:120px; }
    .allocation-results { margin-top:25px; }
    .result-group { margin-top:8px; }
    .result-group + .result-group { margin-top:22px; padding-top:18px; border-top:1px solid var(--line); }
    .result-group-title { color:var(--navy); font-weight:750; font-size:15px; letter-spacing:.02em;
      text-transform:uppercase; margin:0 0 12px; }
    .emi-panel { padding:18px 20px; border-bottom:1px solid var(--line); display:flex;
      flex-wrap:wrap; gap:12px; align-items:flex-end; }
    .emi-panel .field { margin-top:0; min-width:260px; flex:1; }
    .emi-schedule { margin:0 20px 20px; }
    .warning { color:#8a5a00; background:#fff8e8; border:1px solid #f0c36d;
      border-radius:8px; padding:10px 12px; margin-top:16px; font-size:14px; }
    .topbar-actions { display:flex; align-items:center; gap:12px; }
    .kanban { display:grid; grid-template-columns:repeat(4,minmax(180px,1fr)); gap:14px; margin-bottom:22px; }
    .board-column { background:#f8fbfe; border:1px solid var(--line); border-radius:10px; min-height:220px;
      display:flex; flex-direction:column; }
    .board-column-head { padding:12px 14px; border-bottom:1px solid var(--line); font-weight:750; color:var(--navy);
      display:flex; justify-content:space-between; align-items:center; font-size:13px; text-transform:capitalize; }
    .board-column-body { padding:10px; display:flex; flex-direction:column; gap:8px; flex:1; }
    .kanban-card { background:white; border:1px solid var(--line); border-radius:8px; padding:10px 12px;
      box-shadow:0 1px 4px rgba(20,50,80,.05); cursor:pointer; }
    .kanban-card:hover { border-color:#9fc0dc; }
    .kanban-card strong { display:block; color:var(--navy); font-size:13px; }
    .kanban-card small { color:var(--slate); font-size:12px; }
    .loan-detail { margin-top:18px; }
    .detail-panel { background:white; border:1px solid var(--line); border-radius:11px; padding:20px;
      box-shadow:0 2px 8px rgba(27,55,80,.04); }
    .detail-panel-head { display:flex; justify-content:space-between; align-items:flex-start; gap:16px;
      margin-bottom:16px; }
    .loan-chart { width:100%; height:180px; margin:12px 0 18px; }
    .loan-row { cursor:pointer; }
    .loan-row.selected td { background:#e9f2fb !important; }
    .ess-form { margin-bottom:22px; }
    .ess-form-grid { display:grid; grid-template-columns:repeat(3,minmax(160px,1fr)); gap:0 18px; }
    .view-toggle { display:flex; gap:8px; }
    @media (max-width:900px) {
      .login-page { grid-template-columns:1fr; }.login-brand { display:none; }
      .shell { grid-template-columns:76px 1fr; }.sidebar { padding:18px 9px; }
      .side-brand { padding:0 9px 18px; }.side-brand div:last-child,.nav-label,.sidebar-footer { display:none; }
      .nav-button { justify-content:center; }.topbar { padding:0 18px; }.content { padding:20px; }
      .cards { grid-template-columns:repeat(2,1fr); }.quick-grid { grid-template-columns:1fr; }
      .loading { left:76px; }
    }
    @media (max-width:570px) {
      .shell { display:block; }.sidebar { position:static; width:100%; height:auto; }
      .side-brand,.sidebar-footer { display:none; } nav { flex-direction:row; overflow:auto; padding:0; }
      .nav-label { display:none; }.nav-button { flex:0 0 42px; }.topbar { position:static; }
      .cards,.results,.form-grid { grid-template-columns:1fr; }.page-head { align-items:flex-start; flex-direction:column; }
      .panel-header { align-items:stretch; flex-direction:column; }.table-toolbar { flex-wrap:wrap; }
      .search { min-width:100%; }.loading { left:0; }
    }`;
  document.head.append(style);
  applyTheme(localStorage.getItem(THEME_KEY) || "light");
}

function applyTheme(mode) {
  document.body.classList.toggle("dark", mode === "dark");
  localStorage.setItem(THEME_KEY, mode);
  const toggle = document.querySelector("#theme-toggle");
  if (toggle) toggle.textContent = mode === "dark" ? "Light mode" : "Dark mode";
}

function toggleTheme() {
  applyTheme(document.body.classList.contains("dark") ? "light" : "dark");
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (state.token) headers.set("Authorization", `Bearer ${state.token}`);
  if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const response = await fetch(`${API_ROOT}${path}`, { ...options, headers });
  if (response.status === 401 && state.refreshToken && !options._retried) {
    const renewed = await renewSession();
    if (renewed) return api(path, { ...options, _retried: true });
  }
  if (response.status === 401 && state.token && !options._skipAuthLogout) {
    logout(false);
    throw new Error("Your session expired. Please sign in again.");
  }
  if (!response.ok) {
    let detail = `Request failed (${response.status})`;
    try {
      const problem = await response.json();
      if (Array.isArray(problem.detail)) {
        detail = problem.detail.map((item) => item.msg || JSON.stringify(item)).join("; ");
      } else {
        detail = problem.detail || problem.title || detail;
      }
    } catch (_error) {
      // Keep the status-based message for non-JSON responses.
    }
    throw new Error(detail);
  }
  if (response.status === 204) return null;
  return response.json();
}

function hasAnyRole(...names) {
  const roles = (state.user?.roles || []).map((role) => String(role).toLowerCase());
  return names.some((name) => roles.includes(String(name).toLowerCase()));
}

function employeeOptionLabel(employee) {
  const base = `${employee.code} — ${employee.full_name}`;
  return employee.username ? `${base} (${employee.username})` : base;
}

function debounce(fn, delayMs) {
  let timer = null;
  return (...args) => {
    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), delayMs);
  };
}

async function renewSession() {
  const response = await fetch(`${API_ROOT}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: state.refreshToken }),
  });
  if (!response.ok) return false;
  const tokens = await response.json();
  state.token = tokens.access_token;
  state.refreshToken = tokens.refresh_token;
  sessionStorage.setItem(TOKEN_KEY, state.token);
  sessionStorage.setItem(REFRESH_KEY, state.refreshToken);
  return true;
}

function setLoading(active) {
  document.querySelector(".loading")?.remove();
  if (active) document.body.append(el("div", { className: "loading", role: "progressbar" }));
}

function showError(parent, message) {
  parent.querySelectorAll(".error, .success").forEach((node) => node.remove());
  parent.append(el("div", { className: "error", role: "alert", text: message }));
}

function showSuccess(parent, message) {
  parent.querySelectorAll(".error, .success").forEach((node) => node.remove());
  parent.append(el("div", { className: "success", role: "status", text: message }));
}

function openConfirmDialog({ title, message, confirmText = "Confirm", extra } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
      if (dialog.open) dialog.close();
    };
    const dialog = el("dialog", {},
      el("div", { className: "dialog-head" },
        el("h2", { text: title }),
        el("p", { className: "muted", text: message })),
      el("div", { className: "dialog-body" }, extra || "",
        el("div", { className: "dialog-actions" },
          el("button", { className: "secondary", type: "button", text: "Cancel",
            on: { click: () => finish(false) } }),
          el("button", { className: "primary", type: "button", text: confirmText,
            on: { click: () => finish(true) } }))));
    document.body.append(dialog);
    dialog.addEventListener("close", () => {
      if (!settled) {
        settled = true;
        resolve(false);
      }
      dialog.remove();
    });
    dialog.showModal();
  });
}

async function logout(revoke = true) {
  if (revoke && state.refreshToken) {
    await fetch(`${API_ROOT}/auth/logout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: state.refreshToken }),
    }).catch(() => undefined);
  }
  state.token = "";
  state.refreshToken = "";
  state.user = null;
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(REFRESH_KEY);
  renderLogin();
}

function renderLogin(message = "") {
  document.body.replaceChildren();
  const username = el("input", {
    id: "username", name: "username", autocomplete: "username", required: "required", value: "admin",
  });
  const password = el("input", {
    id: "password", name: "password", type: "password", autocomplete: "current-password",
    required: "required", placeholder: "Enter your password",
  });
  const form = el("form", { className: "login-card", novalidate: "novalidate" },
    el("div", { className: "eyebrow", text: "Secure workspace" }),
    el("h2", { text: "Welcome back" }),
    el("p", { className: "muted", text: "Sign in to manage employee airfare benefits." }),
    el("div", { className: "field" }, el("label", { for: "username", text: "Username" }), username),
    el("div", { className: "field" }, el("label", { for: "password", text: "Password" }), password),
    el("button", { className: "primary", type: "submit", text: "Sign in" }),
  );
  if (message) showError(form, message);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    form.querySelector(".error")?.remove();
    if (!username.value.trim() || !password.value) {
      showError(form, "Username and password are required.");
      return;
    }
    form.querySelector("button").disabled = true;
    try {
      const response = await fetch(`${API_ROOT}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.value.trim(), password: password.value }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail = Array.isArray(payload.detail)
          ? payload.detail.map((item) => item.msg || JSON.stringify(item)).join("; ")
          : payload.detail || payload.title || "Invalid username or password.";
        throw new Error(String(detail));
      }
      state.token = payload.access_token;
      state.refreshToken = payload.refresh_token;
      sessionStorage.setItem(TOKEN_KEY, state.token);
      sessionStorage.setItem(REFRESH_KEY, state.refreshToken);
      state.user = await api("/auth/me");
      renderShell();
    } catch (error) {
      showError(form, error.message);
      form.querySelector("button").disabled = false;
    }
  });
  document.body.append(el("main", { className: "login-page" },
    el("section", { className: "login-brand" },
      el("div", { className: "brand-mark", text: "AA" }),
      el("h1", { text: "Atlas Aluminum — airfare benefits, managed with clarity." }),
      el("p", { text: "Secure HCM workspace for GCC employee entitlements, tickets, balances and recoveries." }),
    ),
    el("section", { className: "login-panel" }, form),
  ));
  password.focus();
}

function renderShell() {
  document.body.replaceChildren();
  const nav = el("nav", { "aria-label": "Main navigation" });
  modules.forEach((item) => {
    nav.append(el("button", {
      className: `nav-button${item.id === state.activeModule ? " active" : ""}`,
      type: "button",
      dataset: { module: item.id },
      on: { click: () => navigate(item.id) },
    }, el("span", { className: "nav-icon", text: item.icon }),
    el("span", { className: "nav-label", text: item.label })));
  });
  const sidebar = el("aside", { className: "sidebar" },
    el("div", { className: "side-brand" },
      el("div", { className: "brand-mark", text: "AA" }),
      el("div", {}, el("strong", { text: "Atlas Aluminum" }), el("small", { text: "HCM Airfare" })),
    ),
    nav,
    el("div", { className: "sidebar-footer" },
      el("div", { className: "user-name", text: state.user?.username || "User" }),
      el("div", { className: "user-role", text: (state.user?.roles || []).join(" · ") }),
      el("button", { className: "logout", type: "button", text: "Sign out", on: { click: logout } }),
    ),
  );
  const content = el("div", { className: "content", id: "content" });
  const main = el("main", { className: "main" },
    el("header", { className: "topbar" },
      el("div", { className: "topbar-title", id: "topbar-title", text: "Dashboard" }),
      el("div", { className: "topbar-actions" },
        el("button", {
          id: "theme-toggle",
          className: "secondary",
          type: "button",
          text: document.body.classList.contains("dark") ? "Light mode" : "Dark mode",
          on: { click: toggleTheme },
        }),
        el("div", { className: "live" }, el("span", { className: "dot" }), "API connected"),
      ),
    ),
    content,
  );
  document.body.append(el("div", { className: "shell" }, sidebar, main));
  navigate(state.activeModule);
}

function pageHeader(title, subtitle, action) {
  return el("div", { className: "page-head" },
    el("div", {}, el("div", { className: "eyebrow", text: "Airfare management" }),
      el("h1", { text: title }), el("p", { className: "muted", text: subtitle })),
    action,
  );
}

async function navigate(moduleId) {
  state.activeModule = moduleId === "entitlement" ? "allocation" : moduleId;
  document.querySelectorAll(".nav-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.module === state.activeModule);
  });
  const module = modules.find((item) => item.id === state.activeModule);
  document.querySelector("#topbar-title").textContent = module?.label || "";
  const content = document.querySelector("#content");
  content.replaceChildren();
  setLoading(true);
  try {
    if (moduleId === "dashboard") await renderDashboard(content);
    else if (tableModules[moduleId]) await renderTableModule(content, tableModules[moduleId]);
    else if (moduleId === "entitlement" || moduleId === "allocation") await renderAllocation(content);
    else if (moduleId === "preferences") await renderPreferences(content);
    else if (moduleId === "backup") await renderBackupRestore(content);
    else if (moduleId === "reports") renderReports(content);
    else if (moduleId === "ess") await renderEss(content);
    else if (moduleId === "administration") await renderAdministration(content);
  } catch (error) {
    content.append(pageHeader(module?.label || "Module", "Unable to load this module."));
    showError(content, error.message);
  } finally {
    setLoading(false);
  }
}

async function renderDashboard(content) {
  const data = await api("/dashboard");
  const refresh = el("button", {
    className: "secondary", type: "button", text: "Refresh dashboard",
    on: { click: () => navigate("dashboard") },
  });
  content.append(pageHeader("Dashboard", "Current operational overview across airfare modules.", refresh));
  const values = [
    ["Employees", data.employees, "Active master records"],
    ["Open tickets", data.open_tickets, "Draft or submitted"],
    ["Active loans", data.active_loans, "Recovery in progress"],
    ["Loan outstanding", formatMoney(data.outstanding_loans), "Total principal remaining"],
  ];
  content.append(el("section", { className: "cards" }, values.map(([label, value, note]) =>
    el("article", { className: "card" }, el("div", { className: "metric-label", text: label }),
      el("div", { className: "metric-value", text: value }), el("div", { className: "metric-note", text: note })))));
  const links = el("div", { className: "module-list" });
  modules.filter((item) => !["dashboard", "reports"].includes(item.id)).forEach((item) => {
    links.append(el("button", {
      className: "module-link", type: "button", text: `${item.icon}  ${item.label}`,
      on: { click: () => navigate(item.id) },
    }));
  });
  content.append(el("section", { className: "quick-grid" },
    el("div", { className: "panel" }, el("div", { className: "panel-header" },
      el("div", { className: "panel-title", text: "Quick access" })), links),
    el("div", { className: "panel" }, el("div", { className: "panel-header" },
      el("div", { className: "panel-title", text: "System status" })),
    el("ul", { className: "system-list" },
      el("li", {}, "API", el("span", { className: "pill active", text: "Online" })),
      el("li", {}, "Identity", el("span", { text: state.user?.username || "" })),
      el("li", {}, "Roles", el("span", { text: String(state.user?.roles?.length || 0) })),
      el("li", {}, "Service port", el("span", { text: "3389" })))),
  ));
  const templateGrid = el("div", { className: "module-list" });
  DASHBOARD_TEMPLATES.forEach(([templateName, label]) => {
    templateGrid.append(templateButton(templateName, label));
  });
  content.append(el("section", { className: "panel", style: "margin-top:18px" },
    el("div", { className: "panel-header" },
      el("div", {},
        el("div", { className: "panel-title", text: "Excel templates" }),
        el("p", { className: "muted", text: "Download import and report workbooks for every screen." }))),
    el("div", { className: "form-panel" }, templateGrid)));
}

function displayValue(key, value, row) {
  if (key === "route") return `${row.origin_code || "—"} → ${row.destination_code || "—"}`;
  if (key === "employee_label" || key === "employee_id") {
    return row.employee_label || row.employee_code || value || "—";
  }
  if (key === "active") return value ? "Active" : "Inactive";
  if (value === null || value === undefined || value === "") return "—";
  if (["ticket_cost", "entitlement", "excess_amount", "principal", "monthly_installment",
    "outstanding", "opening_amount", "maximum_payout"].includes(key)) return formatMoney(value);
  if (["daily_rate", "airfare_rate", "custom_airfare_rate", "annual_rate"].includes(key)) {
    return formatDecimal(value, 4);
  }
  return String(value);
}

function buildTicketKanban(records) {
  const columns = ["draft", "submitted", "approved", "paid"];
  return el("section", { className: "kanban ticket-board", "aria-label": "Ticket workflow board" },
    ...columns.map((status) => {
      const items = records.filter((record) => record.status === status);
      return el("div", { className: "board-column" },
        el("div", { className: "board-column-head" },
          el("span", { text: status.replace("_", " ") }),
          el("span", { className: "pill", text: String(items.length) })),
        el("div", { className: "board-column-body" },
          ...(items.length
            ? items.map((record) => el("article", {
              className: "kanban-card",
              on: {
                click: () => openRecordDialog(tableModules.tickets, record),
              },
            },
            el("strong", { text: record.ticket_code || record.id.slice(0, 8) }),
            el("small", { text: record.employee_label || "Employee" }),
            el("small", { text: `${displayValue("route", null, record)} · ${formatMoney(record.ticket_cost)}` }),
            ))
            : [el("div", { className: "muted", text: "No tickets", style: "padding:8px 4px;font-size:12px;" })]),
        ));
    }));
}

function loanChartSvg(schedule) {
  const width = 640;
  const height = 160;
  const padding = 28;
  const payments = schedule.map((part) => Number(part.payment));
  const maxValue = Math.max(...payments, 1);
  const barWidth = Math.max(12, (width - padding * 2) / Math.max(schedule.length, 1) - 6);
  const bars = schedule.map((part, index) => {
    const barHeight = (Number(part.payment) / maxValue) * (height - padding * 2);
    const x = padding + index * (barWidth + 6);
    const y = height - padding - barHeight;
    return `<rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="4" fill="#2463a6" opacity="0.85"></rect>`;
  }).join("");
  return `<svg class="loan-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Loan payment chart"><rect x="0" y="0" width="${width}" height="${height}" fill="transparent"></rect>${bars}</svg>`;
}

function showEmptyLoanDetailPanel(host) {
  host.replaceChildren(el("section", { className: "detail-panel loan-detail" },
    el("div", { className: "detail-panel-head" },
      el("div", {},
        el("div", { className: "panel-title", text: "Loan analytics" }),
        el("p", { className: "muted", text: "Create a loan from Airfare Allocation to view amortization charts here." }))),
    (() => {
      const chartHost = el("div");
      chartHost.innerHTML = loanChartSvg([
        { payment: 0 }, { payment: 0 }, { payment: 0 }, { payment: 0 },
      ]);
      return chartHost;
    })(),
  ));
}

async function showLoanDetailPanel(record, host) {
  host.replaceChildren(el("div", { className: "muted", text: "Loading loan detail…" }));
  try {
    const schedule = await api(`/loans/${record.id}/schedule`);
    host.replaceChildren(el("section", { className: "detail-panel loan-detail" },
      el("div", { className: "detail-panel-head" },
        el("div", {},
          el("div", { className: "panel-title", text: `Loan ${record.loan_code || record.id.slice(0, 8)}` }),
          el("p", { className: "muted", text: `${record.employee_label || "Employee"} · ${formatMoney(record.outstanding)} outstanding` })),
        el("div", { className: "actions" },
          el("button", {
            className: "secondary", type: "button", text: "Full schedule",
            on: { click: () => showLoanSchedule(record) },
          }))),
      (() => {
        const chartHost = el("div");
        chartHost.innerHTML = loanChartSvg(schedule);
        return chartHost;
      })(),
      el("div", { className: "table-wrap" }, scheduleTable(schedule.slice(0, 6))),
    ));
  } catch (error) {
    host.replaceChildren(el("div", { className: "error", text: error.message }));
  }
}

async function renderTableModule(content, config) {
  const records = await api(`${config.endpoint}?limit=500`);
  const refresh = el("button", {
    className: "secondary", type: "button", text: "Refresh",
    on: { click: () => navigate(state.activeModule) },
  });
  const create = el("button", {
    className: "primary", type: "button", text: `New ${config.title.replace(/s$/, "")}`,
    on: { click: () => openCreateDialog(config) },
  });
  const headerActions = [refresh, create];
  if (config.templateName) {
    headerActions.unshift(templateButton(config.templateName));
  }
  if (config.importPreviewEndpoint) {
    headerActions.unshift(el("button", {
      className: "secondary",
      type: "button",
      text: "Import Excel",
      on: { click: () => openImportDialog(config) },
    }));
  }
  content.append(pageHeader(config.title, config.subtitle,
    el("div", { className: "actions" }, ...headerActions)));
  const body = el("tbody");
  const pageSize = 25;
  let page = 0;
  let sortKey = config.columns[0][0];
  let sortDirection = "ascending";
  let filter = "";
  const headers = config.columns.map(([key, label]) => el("th", {
    className: "sortable", text: `${label} ↕`, tabindex: "0", "aria-sort": "none",
    on: {
      click: () => changeSort(key),
      keydown: (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          changeSort(key);
        }
      },
    },
  }));
  const tableClass = ["data-table"];
  if (state.activeModule === "employees") tableClass.push("employee-table");
  if (config.workflow) tableClass.push("ticket-table");
  if (config.schedule) tableClass.push("loan-table");
  const table = el("table", { className: tableClass.join(" ") },
    el("thead", {}, el("tr", {},
      ...headers,
      el("th", { text: "Actions" }))),
    body,
  );
  const countLabel = el("div", { className: "panel-title" });
  const pageLabel = el("span");
  const loanDetailHost = el("div", { className: "loan-detail", id: "loan-detail-host" });
  let selectedLoanId = null;
  const previous = el("button", {
    className: "secondary", type: "button", text: "Previous",
    on: { click: () => { page -= 1; paint(); } },
  });
  const next = el("button", {
    className: "secondary", type: "button", text: "Next",
    on: { click: () => { page += 1; paint(); } },
  });

  function changeSort(key) {
    if (sortKey === key) sortDirection = sortDirection === "ascending" ? "descending" : "ascending";
    else {
      sortKey = key;
      sortDirection = "ascending";
    }
    page = 0;
    paint();
  }

  function paint() {
    body.replaceChildren();
    const matched = records.filter((record) =>
      JSON.stringify(record).toLowerCase().includes(filter.toLowerCase()));
    const sorted = [...matched].sort((left, right) => {
      const a = left[sortKey] ?? "";
      const b = right[sortKey] ?? "";
      const result = String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
      return sortDirection === "ascending" ? result : -result;
    });
    const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
    page = Math.min(page, pages - 1);
    const visible = sorted.slice(page * pageSize, (page + 1) * pageSize);
    visible.forEach((record) => {
      const cells = config.columns.map(([key]) => {
        const value = displayValue(key, record[key], record);
        if (key === "status" || key === "active") {
          return el("td", {}, el("span", {
            className: `pill ${String(value).toLowerCase()}`, text: value,
          }));
        }
        return el("td", { text: value, title: value });
      });
      const remove = el("button", {
        className: "danger-button", type: "button", text: "Delete",
        on: { click: () => deleteRecord(config, record) },
      });
      const rowActions = [];
      if (config.updateFields) rowActions.push(el("button", {
        className: "secondary", type: "button", text: "Edit",
        on: { click: () => openRecordDialog(config, record) },
      }));
      if (config.workflow) {
        const transitions = {
          draft: "submitted", submitted: "approved", approved: "paid", rejected: "draft",
        };
        const nextStatus = transitions[record.status];
        if (nextStatus) rowActions.push(el("button", {
          className: "secondary", type: "button", text: `Mark ${nextStatus}`,
          on: { click: () => changeTicketStatus(record, nextStatus) },
        }));
      }
      if (config.schedule) rowActions.push(el("button", {
        className: "secondary", type: "button", text: "Schedule",
        on: { click: () => showLoanSchedule(record) },
      }));
      rowActions.push(remove);
      const rowOptions = {};
      if (config.schedule) {
        rowOptions.className = `loan-row${selectedLoanId === record.id ? " selected" : ""}`;
        rowOptions.on = {
          click: (event) => {
            if (event.target.closest("button")) return;
            selectedLoanId = record.id;
            paint();
            showLoanDetailPanel(record, loanDetailHost);
          },
        };
      }
      body.append(el("tr", rowOptions, ...cells,
        el("td", {}, el("div", { className: "actions" }, ...rowActions))));
    });
    if (!visible.length) body.append(el("tr", {}, el("td", {
      className: "empty", colspan: String(config.columns.length + 1), text: "No matching records found.",
    })));
    countLabel.textContent = `${matched.length} matching records`;
    pageLabel.textContent = `Page ${page + 1} of ${pages}`;
    previous.disabled = page === 0;
    next.disabled = page >= pages - 1;
    headers.forEach((header, index) => {
      const key = config.columns[index][0];
      header.setAttribute("aria-sort", key === sortKey ? sortDirection : "none");
      header.textContent = `${config.columns[index][1]}${key === sortKey
        ? (sortDirection === "ascending" ? " ↑" : " ↓") : " ↕"}`;
    });
  }
  const search = el("input", {
    className: "search", type: "search", placeholder: `Search ${config.title.toLowerCase()}`,
    "aria-label": `Search ${config.title}`, on: { input: () => {
      filter = search.value;
      page = 0;
      paint();
    } },
  });
  const panel = el("section", { className: "panel" },
    el("div", { className: "panel-header" },
      countLabel,
      el("div", { className: "table-toolbar" }, search)),
    el("div", { className: "table-wrap" }, table),
    el("div", { className: "pager" }, pageLabel,
      el("div", { className: "pager-buttons" }, previous, next)),
  );
  if (config.emiRunner) {
    content.append(await renderLoanEmiRunner(records));
  }
  if (config.workflow) {
    content.append(buildTicketKanban(records));
  }
  content.append(panel);
  if (config.schedule) {
    content.append(loanDetailHost);
    if (records.length) {
      selectedLoanId = records[0].id;
      showLoanDetailPanel(records[0], loanDetailHost);
    } else {
      showEmptyLoanDetailPanel(loanDetailHost);
    }
  }
  paint();
}

function scheduleTable(schedule) {
  return el("table", {},
    el("thead", {}, el("tr", {},
      ...["#", "Due date", "Opening", "Principal", "Interest", "Payment", "Closing"].map(
        (label) => el("th", { text: label }),
      ))),
    el("tbody", {}, ...schedule.map((part) => el("tr", {},
      el("td", { text: String(part.number) }),
      el("td", { text: part.due_date }),
      el("td", { text: formatMoney(part.opening_balance) }),
      el("td", { text: formatMoney(part.principal) }),
      el("td", { text: formatMoney(part.interest) }),
      el("td", { text: formatMoney(part.payment) }),
      el("td", { text: formatMoney(part.closing_balance) })))));
}

async function renderLoanEmiRunner(existingLoans) {
  const employees = await api("/employees?limit=500");
  const employeeSelect = el("select", { id: "loan-emi-employee" },
    el("option", { value: "", text: "Select employee" }),
    ...employees.map((employee) => el("option", {
      value: employee.id, text: employeeOptionLabel(employee),
    })));
  const scheduleHost = el("div", { className: "emi-schedule" });
  const runButton = el("button", {
    className: "primary", type: "button", text: "Run EMI",
    on: {
      click: async () => {
        const employeeId = employeeSelect.value;
        if (!employeeId) {
          scheduleHost.replaceChildren(el("div", { className: "error", text: "Select an employee first." }));
          return;
        }
        try {
          const data = await api("/loans/run-emi", {
            method: "POST",
            body: JSON.stringify({ employee_id: employeeId }),
          });
          if (!data.loans.length) {
            scheduleHost.replaceChildren(el("div", {
              className: "warning",
              text: data.message || "No active loan exists for this employee.",
            }));
            return;
          }
          const blocks = data.loans.map((loan) => el("div", {},
            el("p", {
              className: "muted",
              text: `Loan ${loan.loan_code || loan.loan_id} · ${formatMoney(loan.principal)} principal · ${loan.installments} installments · ${loan.status}`,
            }),
            el("div", { className: "table-wrap import-preview" }, scheduleTable(loan.schedule)),
          ));
          scheduleHost.replaceChildren(...blocks);
        } catch (error) {
          scheduleHost.replaceChildren(el("div", { className: "error", text: error.message }));
        }
      },
    },
  });
  const hint = existingLoans.length
    ? "Select an employee and generate the reducing-balance installment schedule for their active loan(s)."
    : "No loans are on file yet. A loan is created from Airfare Allocation when ticket amount exceeds entitlement and you choose Make loan.";
  return el("section", { className: "panel" },
    el("div", { className: "panel-header" },
      el("div", {},
        el("div", { className: "panel-title", text: "Run EMI by employee" }),
        el("p", { className: "muted", text: hint }))),
    el("div", { className: "emi-panel" },
      el("div", { className: "field" },
        el("label", { for: "loan-emi-employee", text: "Employee" }), employeeSelect),
      runButton),
    scheduleHost);
}

async function openRecordDialog(config, record = null) {
  const controls = {};
  const grid = el("div", { className: "form-grid" });
  const companies = config.fields.some((field) => field[2] === "company") ? await api("/companies") : [];
  const employees = config.fields.some((field) =>
    field[2] === "employee" || field[2] === "employee_optional")
    ? await api("/employees?limit=500") : [];
  const lookupLists = {
    departments: await api("/lookups/departments").catch(() => []),
    pay_groups: await api("/lookups/pay_groups").catch(() => []),
    repair_centers: await api("/lookups/repair_centers").catch(() => []),
    designations: await api("/lookups/designations").catch(() => []),
    nationalities: await api("/lookups/nationalities").catch(() => []),
    sub_sections: await api("/lookups/sub_sections").catch(() => []),
  };
  config.fields.filter(([name]) => !record || config.updateFields.includes(name))
    .forEach(([name, label, type, choices]) => {
    let control;
    if (type === "select") {
      control = el("select", { name, required: "required" });
      choices.forEach((choice) => control.append(el("option", { value: choice, text: choice })));
    } else if (type === "employee" || type === "employee_optional") {
      control = el("select", {
        name,
        required: type === "employee" ? "required" : undefined,
      },
        el("option", { value: "", text: "Select employee" }),
        ...employees.map((employee) => el("option", {
          value: employee.id, text: employeeOptionLabel(employee),
        })));
    } else if (type === "company") {
      control = el("select", { name, required: "required" },
        ...companies.map((company) => el("option", {
          value: company.id, text: `${company.code} — ${company.name}`,
        })));
    } else if (String(type).startsWith("lookup:")) {
      const lookupType = String(type).slice("lookup:".length);
      const source = lookupLists[lookupType] || [];
      control = el("select", { name },
        el("option", { value: "", text: `Select ${label.toLowerCase()}` }),
        ...source.map((item) => el("option", {
          value: item.code, text: `${item.code} — ${item.name}`,
        })));
    } else if (name === "department" || name === "pay_group" || name === "branch") {
      const source = name === "department"
        ? lookupLists.departments
        : name === "pay_group"
          ? lookupLists.pay_groups
          : lookupLists.repair_centers;
      control = el("select", { name },
        el("option", { value: "", text: `Select ${label.toLowerCase()}` }),
        ...source.map((item) => el("option", {
          value: item.code, text: `${item.code} — ${item.name}`,
        })));
    } else if (type === "checkbox") {
      control = el("input", { name, type: "checkbox" });
    } else {
      control = el("input", {
        name, type,
        required: ["email", "pay_group", "custom_airfare_rate",
          "max_entitlement_cap_rate", "notes"].includes(name) ? undefined : "required",
        step: type === "number" ? "any" : undefined,
      });
    }
    control.id = `record-${name}`;
    if (record) {
      if (type === "checkbox") control.checked = Boolean(record[name]);
      else control.value = record[name] ?? "";
    }
    controls[name] = control;
    grid.append(el("div", { className: "field" },
      el("label", { for: control.id, text: label }), control));
  });
  if (record && config.updateFields.includes("active")) {
    const active = el("input", { id: "record-active", name: "active", type: "checkbox" });
    active.checked = Boolean(record.active);
    controls.active = active;
    grid.append(el("div", { className: "field" },
      el("label", { for: active.id, text: "Active" }), active));
  }
  const dialog = el("dialog");
  const form = el("form", { className: "dialog-body" }, grid,
    el("div", { className: "dialog-actions" },
      el("button", { className: "secondary", type: "button", text: "Cancel",
        on: { click: () => dialog.close() } }),
      el("button", { className: "primary", type: "submit", text: "Save" })));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = {};
    Object.entries(controls).forEach(([name, control]) => {
      if (control.type === "checkbox") payload[name] = control.checked;
      else if (control.value !== "") payload[name] =
        ["balance_year", "installments"].includes(name) ? Number(control.value) : control.value;
    });
    try {
      const options = { method: record ? "PUT" : "POST", body: JSON.stringify(payload) };
      if (record) options.headers = { "If-Match": String(record.version) };
      await api(record ? `${config.endpoint}/${record.id}` : config.createEndpoint, options);
      dialog.close();
      await navigate(state.activeModule);
    } catch (error) {
      showError(form, error.message);
    }
  });
  dialog.append(el("div", { className: "dialog-head" },
    el("div", { className: "panel-title",
      text: `${record ? "Edit" : "Create"} ${config.title.replace(/s$/, "")}` })), form);
  document.body.append(dialog);
  dialog.addEventListener("close", () => dialog.remove());
  dialog.showModal();
}

function openCreateDialog(config) {
  openRecordDialog(config).catch((error) => showError(document.querySelector("#content"), error.message));
}

async function changeTicketStatus(record, status) {
  try {
    await api(`/tickets/${record.id}/status`, {
      method: "PATCH",
      headers: { "If-Match": String(record.version) },
      body: JSON.stringify({ status }),
    });
    await navigate("tickets");
  } catch (error) {
    showError(document.querySelector("#content"), error.message);
  }
}

async function showLoanSchedule(record) {
  try {
    const schedule = await api(`/loans/${record.id}/schedule`);
    const dialog = el("dialog");
    const body = el("tbody", {}, ...schedule.map((part) => el("tr", {},
      el("td", { text: String(part.number) }),
      el("td", { text: part.due_date }),
      el("td", { text: formatMoney(part.opening_balance) }),
      el("td", { text: formatMoney(part.principal) }),
      el("td", { text: formatMoney(part.interest) }),
      el("td", { text: formatMoney(part.payment) }),
      el("td", { text: formatMoney(part.closing_balance) }))));
    dialog.append(el("div", { className: "dialog-head" },
      el("div", { className: "panel-title", text: "Amortization schedule" })),
    el("div", { className: "dialog-body table-wrap" },
      el("table", {}, el("thead", {}, el("tr", {},
        ...["#", "Due date", "Opening", "Principal", "Interest", "Payment", "Closing"].map(
          (label) => el("th", { text: label }),
        ))),
      body),
      el("div", { className: "dialog-actions" },
        el("button", { className: "primary", type: "button", text: "Close",
          on: { click: () => dialog.close() } }))));
    document.body.append(dialog);
    dialog.addEventListener("close", () => dialog.remove());
    dialog.showModal();
  } catch (error) {
    showError(document.querySelector("#content"), error.message);
  }
}

async function deleteRecord(config, record) {
  if (!window.confirm(`Delete ${record.code || record.id}?`)) return;
  try {
    await api(`${config.endpoint}/${record.id}`, {
      method: "DELETE", headers: { "If-Match": String(record.version) },
    });
    await navigate(state.activeModule);
  } catch (error) {
    showError(document.querySelector("#content"), error.message);
  }
}

async function uploadImportPreview(endpoint, file) {
  const body = new FormData();
  body.append("file", file);
  const response = await fetch(`${API_ROOT}${endpoint}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${state.token}` },
    body,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.detail || payload.title || `Import preview failed (${response.status})`);
  }
  return payload;
}

function importRowFields(config, row) {
  if (config.importKind === "opening-balance") {
    return {
      row: row.row,
      employee_code: row.employee_code,
      employee_id: row.employee_id,
      balance_year: row.balance_year,
      opening_days: row.opening_days,
      paid_days: row.paid_days || "0",
      opening_amount: row.opening_amount,
      maximum_payout: row.maximum_payout,
      selected: Boolean(row.selected),
    };
  }
  return {
    row: row.row,
    code: row.code,
    full_name: row.full_name,
    company_id: row.company_id,
    join_date: row.join_date,
    department: row.department || "",
    branch: row.branch || "",
    pay_group: row.pay_group || "",
    email: row.email || null,
    selected: Boolean(row.selected),
  };
}

async function openImportDialog(config) {
  const fileInput = el("input", { type: "file", accept: ".xlsx,.xls" });
  const summary = el("p", { className: "muted", text: "Choose an Excel file to verify rows before import." });
  const previewHost = el("div");
  let previewData = null;
  const importButton = el("button", {
    className: "primary",
    type: "button",
    text: "Import selected rows",
    disabled: "disabled",
    on: {
      click: async () => {
        if (!previewData) return;
        try {
          const rows = previewData.rows
            .filter((row) => row.selected)
            .map((row) => importRowFields(config, row));
          if (!rows.length) throw new Error("Select at least one valid row to import.");
          await api(config.importCommitEndpoint, {
            method: "POST",
            body: JSON.stringify({ rows }),
          });
          dialog.close();
          await navigate(state.activeModule);
        } catch (error) {
          showError(dialog.querySelector(".dialog-body"), error.message);
        }
      },
    },
  });
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    try {
      previewHost.replaceChildren(el("p", { className: "muted", text: "Verifying workbook..." }));
      previewData = await uploadImportPreview(config.importPreviewEndpoint, file);
      importButton.disabled = previewData.summary.selected ? undefined : "disabled";
      summary.textContent = `${previewData.summary.ready} ready · ${previewData.summary.errors} errors · ${previewData.summary.selected} selected`;
      const head = config.importKind === "opening-balance"
        ? ["", "Row", "Employee", "Year", "Days", "Amount", "Status", "Message"]
        : ["", "Row", "Code", "Name", "Join date", "Status", "Message"];
      const table = el("table", {},
        el("thead", {}, el("tr", {}, ...head.map((label) => el("th", { text: label })))),
        el("tbody"));
      previewData.rows.forEach((row) => {
        const checkbox = el("input", {
          type: "checkbox",
          checked: row.selected ? "checked" : undefined,
          disabled: row.severity === "ERROR" ? "disabled" : undefined,
        });
        checkbox.addEventListener("change", () => {
          row.selected = checkbox.checked;
          previewData.summary.selected = previewData.rows.filter((item) => item.selected).length;
          summary.textContent = `${previewData.summary.ready} ready · ${previewData.summary.errors} errors · ${previewData.summary.selected} selected`;
          importButton.disabled = previewData.summary.selected ? undefined : "disabled";
        });
        const severityCell = (value) => el("td", {}, el("span", {
          className: value === "READY" ? "severity-ready" : "severity-error",
          text: value,
        }));
        const rowCells = config.importKind === "opening-balance"
          ? [
            el("td", {}, checkbox),
            el("td", { text: String(row.row) }),
            el("td", { text: row.employee_code || "—" }),
            el("td", { text: String(row.balance_year ?? "—") }),
            el("td", { text: String(row.opening_days ?? "—") }),
            el("td", { text: String(row.opening_amount ?? "—") }),
            severityCell(row.severity),
            el("td", { text: row.message || "—" }),
          ]
          : [
            el("td", {}, checkbox),
            el("td", { text: String(row.row) }),
            el("td", { text: row.code || "—" }),
            el("td", { text: row.full_name || "—" }),
            el("td", { text: row.join_date || "—" }),
            severityCell(row.severity),
            el("td", { text: row.message || "—" }),
          ];
        table.querySelector("tbody").append(el("tr", {}, ...rowCells));
      });
      previewHost.replaceChildren(el("div", { className: "import-preview" }, table));
    } catch (error) {
      previewHost.replaceChildren(el("div", { className: "error", text: error.message }));
      importButton.disabled = "disabled";
    }
  });
  const dialog = el("dialog", {},
    el("div", { className: "dialog-head" },
      el("h2", { text: `Import ${config.title}` }),
      el("p", { className: "muted", text: "Verify rows, adjust selection, then import." })),
    el("div", { className: "dialog-body" },
      el("div", { className: "field" }, el("label", { text: "Excel workbook" }), fileInput),
      el("div", { className: "form-actions", style: "margin-top:12px" },
        config.templateName ? templateButton(config.templateName, "Download template") : el("span")),
      summary,
      previewHost,
      el("div", { className: "dialog-actions" },
        el("button", { className: "secondary", type: "button", text: "Close",
          on: { click: () => dialog.close() } }),
        importButton)));
  document.body.append(dialog);
  dialog.addEventListener("close", () => dialog.remove());
  dialog.showModal();
}

async function downloadReportFile(path, filename) {
  const response = await fetch(`${API_ROOT}${path}`, {
    headers: { Authorization: `Bearer ${state.token}` },
  });
  if (!response.ok) throw new Error(`Report download failed (${response.status})`);
  const link = el("a", {
    href: URL.createObjectURL(await response.blob()),
    download: filename,
  });
  document.body.append(link);
  link.click();
  URL.revokeObjectURL(link.href);
  link.remove();
}

async function openReportDialog(reportId, label) {
  const data = await api(`/reports/detail/${reportId}`);
  const table = el("table", {},
    el("thead", {}, el("tr", {}, ...data.columns.map((column) => el("th", { text: column })))),
    el("tbody"));
  data.rows.forEach((row) => {
    table.querySelector("tbody").append(el("tr", {},
      ...row.map((value) => el("td", { text: value ?? "—" }))));
  });
  const dialog = el("dialog", { className: "report-dialog" },
    el("div", { className: "dialog-head" },
      el("h2", { text: label }),
      el("p", { className: "muted", text: `${data.count} records · ${new Date(data.generated_at).toLocaleString()}` })),
    el("div", { className: "dialog-body" },
      el("div", { className: "table-wrap import-preview" }, table),
      el("div", { className: "dialog-actions" },
        el("button", {
          className: "secondary", type: "button", text: "Excel",
          on: { click: () => downloadReportFile(`/reports/export/${reportId}.xlsx`, `${reportId}.xlsx`) },
        }),
        el("button", {
          className: "secondary", type: "button", text: "PDF",
          on: { click: () => downloadReportFile(`/reports/export/${reportId}.pdf`, `${reportId}.pdf`) },
        }),
        el("button", { className: "primary", type: "button", text: "Close",
          on: { click: () => dialog.close() } }))));
  document.body.append(dialog);
  dialog.addEventListener("close", () => dialog.remove());
  dialog.showModal();
}

async function renderAllocation(content) {
  content.append(pageHeader(
    "Airfare Allocation",
    "Select an employee to review entitlement and issue a ticket. ATLAS 30/360 engine: MaxPayout / 60.",
    el("div", { className: "actions" },
      templateButton("entitlement-preview"),
      templateButton("allocation-preview")),
  ));
  const today = new Date().toISOString().slice(0, 10);
  const masterFields = new Set([
    "date_of_joining", "last_ticket_date", "opening_balance_days", "opening_balance_amount",
    "employee_custom_rate", "pay_group_rate", "global_company_preference_rate",
    "global_company_preference_days", "max_entitlement_cap_rate",
  ]);
  const fields = [
    ["employee_id", "Employee", "employee", ""],
    ["as_of_date", "As of date", "date", today],
    ["requested_ticket_amount", "Ticket amount", "number", ""],
    ["origin_code", "Origin (issue)", "text", "ORG"],
    ["destination_code", "Destination (issue)", "text", "DST"],
    ["tenure_months", "Loan tenure months", "number", "6"],
    ["date_of_joining", "Date of joining", "date", "2024-01-01"],
    ["last_ticket_date", "Last ticket date", "date", ""],
    ["opening_balance_days", "Opening balance days", "number", "0"],
    ["opening_balance_amount", "Opening balance amount", "number", "0"],
    ["employee_custom_rate", "Employee custom rate", "number", ""],
    ["pay_group_rate", "Pay group rate", "number", ""],
    ["global_company_preference_rate", "Global max payout (policy)", "number", "150"],
    ["global_company_preference_days", "ATLAS cycle days (60)", "number", "60"],
    ["max_entitlement_cap_rate", "Max entitlement cap", "number", ""],
  ];
  const controls = {};
  const fieldNodes = {};
  const grid = el("div", { className: "form-grid" });
  const employees = await api("/employees?limit=500");
  fields.forEach(([name, label, type, initial]) => {
    let control;
    if (type === "employee") {
      control = el("select", { id: `alloc-${name}`, name },
        el("option", { value: "", text: "Select employee" }),
        ...employees.map((employee) => el("option", {
          value: employee.id, text: employeeOptionLabel(employee),
        })));
    } else {
      control = el("input", {
        id: `alloc-${name}`, name, type, value: initial,
        step: type === "number" ? (name === "tenure_months" ? "1" : "any") : undefined,
        min: type === "number" && name === "tenure_months" ? "1" : undefined,
        max: type === "number" && name === "tenure_months" ? "60" : undefined,
      });
    }
    controls[name] = control;
    const node = el("div", { className: "field" },
      el("label", { for: `alloc-${name}`, text: label }), control);
    fieldNodes[name] = node;
    grid.append(node);
  });
  const results = el("div", { className: "allocation-results always-on" },
    el("div", { className: "empty", text: "Select an employee to load ATLAS entitlement from MSSQL." }));
  const tenureField = fieldNodes.tenure_months;
  tenureField.classList.add("master-hidden");
  const excessRadios = {
    SELF_PAID: el("input", { type: "radio", name: "excess_option", value: "SELF_PAID" }),
    COMPANY_PAID: el("input", { type: "radio", name: "excess_option", value: "COMPANY_PAID" }),
    LOAN: el("input", { type: "radio", name: "excess_option", value: "LOAN" }),
  };
  const excessAmount = el("strong", { text: "—" });
  const excessPanel = el("div", { className: "excess-panel", id: "alloc-excess-panel" },
    el("div", { className: "panel-title", text: "Ticket exceeds entitlement" }),
    el("p", { className: "muted" }, "Excess amount: ", excessAmount,
      ". Choose how the balance is settled before issuing."),
    el("div", { className: "excess-options" },
      el("label", {}, excessRadios.SELF_PAID, " Self paid by employee (SELF_PAID)"),
      el("label", {}, excessRadios.COMPANY_PAID, " Fully company paid (COMPANY_PAID)"),
      el("label", {}, excessRadios.LOAN, " Make loan (LOAN / CONVERT_TO_LOAN)")),
  );
  let promptedExcess = false;
  let latestPreview = null;

  function optionalValue(name) {
    const value = String(controls[name].value || "").trim();
    return value === "" ? null : value;
  }

  function selectedExcess() {
    const checked = excessPanel.querySelector("input[name=excess_option]:checked");
    return checked ? checked.value : null;
  }

  function employeeSelected() {
    return Boolean(optionalValue("employee_id"));
  }

  function toggleMasterFields() {
    masterFields.forEach((name) => fieldNodes[name].classList.add("master-hidden"));
  }

  function readEmiMonths() {
    const months = Number(controls.tenure_months.value || "6");
    if (!Number.isInteger(months) || months < 1 || months > 60) return null;
    return months;
  }

  function previewPayload() {
    const payload = {
      as_of_date: controls.as_of_date.value,
    };
    const ticket = optionalValue("requested_ticket_amount");
    if (ticket !== null) payload.requested_ticket_amount = ticket;
    const excess = selectedExcess();
    if (excess) {
      payload.excess_option = excess;
      if (excess === "LOAN") payload.tenure_months = readEmiMonths() || 6;
    }
    const employeeId = optionalValue("employee_id");
    if (employeeId) {
      payload.employee_id = employeeId;
      return payload;
    }
    payload.date_of_joining = controls.date_of_joining.value;
    payload.opening_balance_days = optionalValue("opening_balance_days") || "0";
    payload.opening_balance_amount = optionalValue("opening_balance_amount") || "0";
    [
      "last_ticket_date", "employee_custom_rate", "pay_group_rate",
      "global_company_preference_rate", "global_company_preference_days", "max_entitlement_cap_rate",
    ].forEach((name) => {
      const value = optionalValue(name);
      if (value !== null) payload[name] = value;
    });
    return payload;
  }

  async function promptEmiMonths() {
    const input = el("input", {
      id: "alloc-emi-months", type: "number", min: "1", max: "60", step: "1",
      value: String(readEmiMonths() || 6),
    });
    const confirmed = await openConfirmDialog({
      title: "Loan EMI months",
      message: "Enter how many months the excess should be recovered over. Preview will not create a loan.",
      confirmText: "Continue",
      extra: el("div", { className: "field" },
        el("label", { for: "alloc-emi-months", text: "EMI months (1–60)" }), input),
    });
    if (!confirmed) return null;
    const months = Number(input.value);
    if (!Number.isInteger(months) || months < 1 || months > 60) {
      showError(form, "EMI months must be a whole number between 1 and 60.");
      return null;
    }
    controls.tenure_months.value = String(months);
    return months;
  }

  async function chooseLoanOption() {
    excessRadios.LOAN.checked = true;
    tenureField.classList.remove("master-hidden");
    const months = await promptEmiMonths();
    if (months == null) {
      excessRadios.LOAN.checked = false;
      tenureField.classList.add("master-hidden");
      return;
    }
    await autoPreview();
  }

  async function confirmLoanIssue(data, months) {
    const details = el("div", {},
      el("p", { text: `Excess amount: ${formatMoney(data.excess_cost)}` }),
      el("p", { text: `EMI months: ${months}` }),
      el("p", { text: `Estimated EMI: ${data.emi == null ? "—" : formatMoney(data.emi)}` }));
    return openConfirmDialog({
      title: "Confirm airfare loan",
      message: "A loan will be created only after you confirm. Cancel to leave the allocation unsaved.",
      confirmText: "Confirm loan",
      extra: details,
    });
  }

  function promptExcessChoice(amount) {
    if (promptedExcess) return;
    promptedExcess = true;
    const dialog = el("dialog", {},
      el("div", { className: "dialog-head" },
        el("h2", { text: "Ticket exceeds entitlement" }),
        el("p", { className: "muted",
          text: `Excess is ${formatMoney(amount)}. Choose how the company should settle the balance.` })),
      el("div", { className: "dialog-body" },
        el("div", { className: "dialog-actions" },
          el("button", { className: "secondary", type: "button", text: "Self paid by employee",
            on: { click: () => { excessRadios.SELF_PAID.checked = true; dialog.close(); autoPreview(); } } }),
          el("button", { className: "secondary", type: "button", text: "Fully company paid",
            on: { click: () => { excessRadios.COMPANY_PAID.checked = true; dialog.close(); autoPreview(); } } }),
          el("button", { className: "primary", type: "button", text: "Make loan",
            on: { click: () => { dialog.close(); chooseLoanOption(); } } }))));
    document.body.append(dialog);
    dialog.addEventListener("close", () => dialog.remove());
    dialog.showModal();
  }

  function showAllocation(data) {
    latestPreview = data;
    const excess = Number(data.excess_cost || 0);
    const hasExcess = excess > 0;
    excessPanel.classList.toggle("visible", hasExcess);
    tenureField.classList.toggle("master-hidden", selectedExcess() !== "LOAN");
    excessAmount.textContent = formatMoney(data.excess_cost);
    if (hasExcess && data.excess_requires_choice) promptExcessChoice(data.excess_cost);
    if (!hasExcess) {
      promptedExcess = false;
      Object.values(excessRadios).forEach((radio) => { radio.checked = false; });
      tenureField.classList.add("master-hidden");
    }
    function firstValue(...values) {
      return values.find((value) => value != null && value !== "");
    }
    function resultCard(label, value) {
      return el("div", { className: "result" },
        el("span", { className: "metric-label", text: label }),
        el("strong", { text: value == null || value === "" ? "—" : String(value) }));
    }
    function resultGroup(title, rows) {
      return el("div", { className: "result-group" },
        el("div", { className: "result-group-title", text: title }),
        el("div", { className: "results always-on" },
          ...rows.map(([label, value]) => resultCard(label, value))));
    }
    const entitlementRows = [
      ["Opening balance amount", formatMoney(firstValue(data.opening_balance_amount, data.OpeningBalanceAmount))],
      ["Opening balance days", formatDecimal(firstValue(data.opening_balance_days, data.OpeningBalanceDays), 4)],
      ["Current-year earned days", formatDecimal(
        firstValue(data.current_year_earned_days, data.CurrentYearEarnedDays, data.accrued_days), 4)],
      ["Current-year earned amount", formatMoney(
        firstValue(data.current_year_earned_amount, data.CurrentYearEarnedAmount, data.current_year_amount))],
    ];
    const alreadyPaidDays = firstValue(data.already_paid_days, data.AlreadyPaidDays);
    const alreadyPaidAmount = firstValue(data.already_paid_amount, data.AlreadyPaidAmount);
    if (alreadyPaidDays != null) {
      entitlementRows.push(["Already paid days", formatDecimal(alreadyPaidDays, 4)]);
    }
    if (alreadyPaidAmount != null) {
      entitlementRows.push(["Already paid amount", formatMoney(alreadyPaidAmount)]);
    }
    entitlementRows.push(
      ["Current-year remaining", formatMoney(
        firstValue(data.current_year_remaining, data.CurrentYearRemaining))],
    );
    const totalFunds = firstValue(data.total_available_funds, data.TotalAvailableFunds);
    if (totalFunds != null) {
      entitlementRows.push(["Total available funds", formatMoney(totalFunds)]);
    }
    entitlementRows.push(
      ["Eligible balance days", formatDecimal(firstValue(
        data.eligible_balance_days, data.EligibleBalanceDays, data.days_left,
        data.remaining_days, data.total_entitlement_days), 4)],
      ["Airfare entitlement amount", formatMoney(firstValue(
        data.airfare_entitlement_amount, data.AirfareEntitlementAmount, data.final_entitlement_amount))],
      ["Per-day rate", formatDecimal(firstValue(data.per_day_rate, data.PerDayRate, data.daily_rate), 4)],
      ["Maximum payout", formatMoney(firstValue(
        data.maximum_payout, data.MaximumPayout, data.max_payout, data.airfare_rate))],
      ["Previous allocation / last ticket", firstValue(
        data.previous_allocation_date, data.PreviousAllocationDate, data.last_ticket_date)],
      ["Join date", firstValue(data.join_date, data.date_of_joining)],
      ["Rate source", data.rate_source],
    );
    const settlementRows = [
      ["Ticket amount", data.requested_ticket_amount == null ? "—" : formatMoney(data.requested_ticket_amount)],
      ["Excess", formatMoney(data.excess_cost)],
      ["Company payout", data.company_payout == null ? "—" : formatMoney(data.company_payout)],
      ["Employee payable", data.employee_payable == null ? "—" : formatMoney(data.employee_payable)],
      ["EMI", data.emi == null ? "—" : formatMoney(data.emi)],
      ["Ticket", data.ticket_code || "—"],
      ["Loan", data.loan_code || "—"],
    ];
    results.replaceChildren(
      resultGroup("Entitlement review", entitlementRows),
      resultGroup("Ticket settlement", settlementRows),
    );
  }

  async function autoPreview() {
    form.querySelector(".error")?.remove();
    if (!employeeSelected() && !optionalValue("date_of_joining")) return;
    try {
      showAllocation(await api("/allocations/preview", {
        method: "POST", body: JSON.stringify(previewPayload()),
      }));
    } catch (error) {
      showError(form, error.message);
    }
  }
  const debouncedAutoPreview = debounce(autoPreview, 300);

  const previewButton = el("button", {
    className: "secondary", type: "button", text: "Preview",
    on: { click: autoPreview },
  });
  const issueButton = el("button", {
    className: "primary", type: "button", text: "Issue ticket",
    on: {
      click: async () => {
        form.querySelector(".error")?.remove();
        const employeeId = optionalValue("employee_id");
        if (!employeeId) {
          showError(form, "Select an employee to issue a ticket.");
          return;
        }
        const ticket = optionalValue("requested_ticket_amount");
        if (ticket === null) {
          showError(form, "Enter a ticket amount before issuing.");
          return;
        }
        const excess = Number(latestPreview?.excess_cost || 0);
        const excessOption = selectedExcess();
        if (excess > 0 && !excessOption) {
          promptExcessChoice(latestPreview.excess_cost);
          showError(form, "Ticket exceeds entitlement. Choose Self paid, Fully company paid, or Make loan.");
          return;
        }
        const payload = {
          employee_id: employeeId,
          as_of_date: controls.as_of_date.value,
          requested_ticket_amount: ticket,
          origin_code: optionalValue("origin_code") || "ORG",
          destination_code: optionalValue("destination_code") || "DST",
        };
        if (excessOption) payload.excess_option = excessOption;
        if (excessOption === "LOAN") {
          const months = readEmiMonths();
          if (months == null) {
            tenureField.classList.remove("master-hidden");
            const chosen = await promptEmiMonths();
            if (chosen == null) return;
            payload.tenure_months = chosen;
          } else {
            payload.tenure_months = months;
          }
          try {
            latestPreview = await api("/allocations/preview", {
              method: "POST", body: JSON.stringify(previewPayload()),
            });
            showAllocation(latestPreview);
          } catch (error) {
            showError(form, error.message);
            return;
          }
          const confirmed = await confirmLoanIssue(latestPreview, payload.tenure_months);
          if (!confirmed) return;
        }
        try {
          const issued = await api("/allocations/issue", {
            method: "POST", body: JSON.stringify(payload),
          });
          showAllocation(issued);
          form.querySelectorAll(".error").forEach((node) => node.remove());
          showSuccess(notice, issued.message || [
            "Allocation saved.",
            issued.ticket_code ? `Ticket ${issued.ticket_code} created.` : "",
            issued.loan_code ? `Loan ${issued.loan_code} created.` : "",
            issued.excess_option ? `Excess option: ${issued.excess_option}.` : "",
          ].filter(Boolean).join(" "));
        } catch (error) {
          showError(form, error.message);
        }
      },
    },
  });
  const notice = el("div", { className: "alloc-notice" });
  const form = el("form", { className: "form-panel" }, grid, excessPanel,
    el("div", { className: "form-actions" }, previewButton, issueButton,
      el("span", { className: "muted",
        text: "Employee select auto-loads entitlement. Enter ticket amount to settle excess and issue." })),
    notice,
    results,
  );
  form.addEventListener("submit", (event) => event.preventDefault());
  controls.employee_id.addEventListener("change", () => {
    promptedExcess = false;
    notice.replaceChildren();
    Object.values(excessRadios).forEach((radio) => { radio.checked = false; });
    toggleMasterFields();
    autoPreview();
  });
  controls.as_of_date.addEventListener("change", debouncedAutoPreview);
  controls.requested_ticket_amount.addEventListener("input", debouncedAutoPreview);
  Object.values(excessRadios).forEach((radio) => {
    radio.addEventListener("change", () => {
      if (selectedExcess() === "LOAN") {
        chooseLoanOption();
        return;
      }
      tenureField.classList.add("master-hidden");
      debouncedAutoPreview();
    });
  });
  controls.tenure_months.addEventListener("input", debouncedAutoPreview);
  toggleMasterFields();
  content.append(el("section", { className: "panel" }, form));
}

async function renderPreferences(content) {
  const [data, rates, employees, companies, payGroups] = await Promise.all([
    api("/preferences/effective"),
    api("/entitlement-rates"),
    api("/employees?limit=500"),
    api("/companies"),
    api("/lookups/pay_groups").catch(() => []),
  ]);
  const refresh = el("button", {
    className: "secondary", type: "button", text: "Refresh",
    on: { click: () => navigate("preferences") },
  });
  content.append(pageHeader(
    "Preferences",
    "Company defaults, dated airfare amounts, and workspace settings. Allocation uses these rates on the ticket date.",
    el("div", { className: "actions" }, refresh, templateButton("entitlement-rates", "Rate template")),
  ));
  content.append(el("section", { className: "panel form-panel" },
    el("div", { className: "panel-title", text: "What this screen is for" }),
    el("p", { className: "pref-help", text:
      "Preference cascade: Global → Company → Branch/Department → Pay Group → User. "
      + "User personal preferences win unless an earlier layer locked the key. "
      + "Airfare MaxPayout for Allocation: Employee dated rate → Pay group → Company → Global. "
      + "Daily rate = amount ÷ 60 (ATLAS)." })));

  const theme = el("select", {},
    el("option", { value: "light", text: "Light" }),
    el("option", { value: "dark", text: "Dark" }));
  theme.value = data.theme || "light";
  theme.addEventListener("change", async () => {
    await api("/preferences", {
      method: "PUT",
      body: JSON.stringify({
        scope_type: "user", scope_id: state.user.id, preference_key: "theme", value: theme.value,
      }),
    });
    document.body.classList.toggle("dark", theme.value === "dark");
  });
  content.append(el("section", { className: "panel form-panel" },
    el("div", { className: "field" }, el("label", { text: "Color theme" }), theme)));

  const globalAmount = el("input", {
    type: "number", step: "any", min: "0",
    value: data.global_company_preference_rate || data.airfare_rate || "150",
  });
  const globalDays = el("input", {
    type: "number", step: "any", min: "1",
    value: data.global_company_preference_days || data.airfare_rate_days || "60",
  });
  const saveGlobal = el("button", {
    className: "primary",
    type: "button",
    text: "Save company default",
    on: {
      click: async () => {
        try {
          const amount = String(globalAmount.value || "150");
          const days = String(globalDays.value || "60");
          await api("/preferences", {
            method: "PUT",
            body: JSON.stringify({
              scope_type: "global", scope_id: "",
              preference_key: "global_company_preference_rate", value: amount,
            }),
          });
          await api("/preferences", {
            method: "PUT",
            body: JSON.stringify({
              scope_type: "global", scope_id: "",
              preference_key: "airfare_rate", value: amount,
            }),
          });
          await api("/preferences", {
            method: "PUT",
            body: JSON.stringify({
              scope_type: "global", scope_id: "",
              preference_key: "global_company_preference_days", value: days,
            }),
          });
          await api("/preferences", {
            method: "PUT",
            body: JSON.stringify({
              scope_type: "global", scope_id: "",
              preference_key: "airfare_rate_days", value: days,
            }),
          });
          await api("/entitlement-rates", {
            method: "POST",
            body: JSON.stringify({
              scope_type: "global",
              scope_id: "",
              amount,
              effective_from: new Date().toISOString().slice(0, 10),
              cap_amount: amount,
            }),
          });
          await navigate("preferences");
        } catch (error) {
          showError(content, error.message);
        }
      },
    },
  });
  content.append(el("section", { className: "panel form-panel" },
    el("div", { className: "panel-title", text: "Company default airfare amount" }),
    el("p", { className: "muted", text: "Used when no employee, pay-group, or company dated policy applies. Cycle days stay 60 unless you have a documented ATLAS change." }),
    el("div", { className: "field" }, el("label", { text: "Airfare amount (BHD)" }), globalAmount),
    el("div", { className: "field" }, el("label", { text: "Cycle days" }), globalDays),
    el("div", { className: "form-actions" }, saveGlobal)));

  const today = new Date().toISOString().slice(0, 10);
  const scopeType = el("select", { id: "policy-scope-type" },
    el("option", { value: "company", text: "Company" }),
    el("option", { value: "pay_group", text: "Pay group" }),
    el("option", { value: "employee", text: "Employee" }),
    el("option", { value: "global", text: "Global fallback" }));
  const scopeTarget = el("select", { id: "policy-scope-id" });
  const policyAmount = el("input", { type: "number", step: "any", min: "0.01", value: "150" });
  const effectiveFrom = el("input", { type: "date", value: today });
  const effectiveTo = el("input", { type: "date", value: "" });

  function fillScopeTarget() {
    const kind = scopeType.value;
    scopeTarget.replaceChildren();
    scopeTarget.disabled = kind === "global";
    if (kind === "global") {
      scopeTarget.append(el("option", { value: "", text: "(all companies)" }));
      return;
    }
    if (kind === "company") {
      companies.forEach((company) => {
        scopeTarget.append(el("option", {
          value: company.id, text: `${company.code} — ${company.name}`,
        }));
      });
    } else if (kind === "pay_group") {
      (payGroups || []).forEach((group) => {
        scopeTarget.append(el("option", { value: group.code, text: `${group.code} — ${group.name}` }));
      });
    } else {
      employees.forEach((employee) => {
        scopeTarget.append(el("option", { value: employee.id, text: employeeOptionLabel(employee) }));
      });
    }
  }
  scopeType.addEventListener("change", fillScopeTarget);
  fillScopeTarget();

  const savePolicy = el("button", {
    className: "primary", type: "button", text: "Save airfare amount",
    on: {
      click: async () => {
        try {
          const payload = {
            scope_type: scopeType.value,
            scope_id: scopeType.value === "global" ? "" : scopeTarget.value,
            amount: String(policyAmount.value || ""),
            effective_from: effectiveFrom.value,
            cap_amount: String(policyAmount.value || ""),
          };
          if (effectiveTo.value) payload.effective_to = effectiveTo.value;
          if (payload.scope_type !== "global" && !payload.scope_id) {
            showError(content, "Select a company, pay group, or employee.");
            return;
          }
          await api("/entitlement-rates", { method: "POST", body: JSON.stringify(payload) });
          await navigate("preferences");
        } catch (error) {
          showError(content, error.message);
        }
      },
    },
  });
  content.append(el("section", { className: "panel form-panel" },
    el("div", { className: "panel-title", text: "Airfare amount policies" }),
    el("p", { className: "muted", text: "Saving a new row closes the previous open-ended rate for the same company, group, or employee (ATLAS effective dating)." }),
    el("div", { className: "form-grid" },
      el("div", { className: "field" }, el("label", { text: "Applies to" }), scopeType),
      el("div", { className: "field" }, el("label", { text: "Company / group / employee" }), scopeTarget),
      el("div", { className: "field" }, el("label", { text: "Airfare amount" }), policyAmount),
      el("div", { className: "field" }, el("label", { text: "Effective from" }), effectiveFrom),
      el("div", { className: "field" }, el("label", { text: "Effective to (optional)" }), effectiveTo)),
    el("div", { className: "form-actions" }, savePolicy)));

  const rateTable = el("div", { className: "table-wrap policy-table" });
  if (!rates.length) {
    rateTable.append(el("div", { className: "empty", text: "No dated airfare amounts yet. Add a company, group, or employee policy above." }));
  } else {
    const body = el("tbody");
    const employeeById = Object.fromEntries(employees.map((item) => [item.id, item]));
    const companyById = Object.fromEntries(companies.map((item) => [item.id, item]));
    rates.forEach((record) => {
      let target = record.scope_id || "—";
      if (record.scope_type === "employee" && employeeById[record.scope_id]) {
        target = employeeOptionLabel(employeeById[record.scope_id]);
      } else if (record.scope_type === "company" && companyById[record.scope_id]) {
        const company = companyById[record.scope_id];
        target = `${company.code} — ${company.name}`;
      } else if (record.scope_type === "global") {
        target = "All companies";
      }
      body.append(el("tr", {},
        el("td", { text: record.scope_type.replace("_", " ") }),
        el("td", { text: target }),
        el("td", { text: formatMoney(record.amount) }),
        el("td", { text: record.effective_from }),
        el("td", { text: record.effective_to || "Open" }),
        el("td", {}, el("button", {
          className: "danger-button", type: "button", text: "Delete",
          on: {
            click: async () => {
              if (!window.confirm("Delete this airfare amount policy?")) return;
              try {
                await api(`/entitlement-rates/${record.id}`, {
                  method: "DELETE",
                  headers: { "If-Match": String(record.version) },
                });
                await navigate("preferences");
              } catch (error) {
                showError(content, error.message);
              }
            },
          },
        }))));
    });
    rateTable.append(el("table", {},
      el("thead", {}, el("tr", {},
        el("th", { text: "Level" }), el("th", { text: "Applies to" }),
        el("th", { text: "Amount" }), el("th", { text: "From" }),
        el("th", { text: "To" }), el("th", { text: "" }))),
      body));
  }
  content.append(el("section", { className: "panel" },
    el("div", { className: "panel-header" },
      el("div", { className: "panel-title", text: "Effective-dated airfare amounts" })),
    rateTable));

  if (hasAnyRole("admin", "SYSTEM_ADMIN")) {
    const eraseConfirm = el("input", {
      type: "text",
      placeholder: "Type ERASE_ALL_DATA",
      autocomplete: "off",
    });
    const eraseNotice = el("div");
    const eraseButton = el("button", {
      className: "danger-button",
      type: "button",
      text: "Erase all operational data",
      on: {
        click: async () => {
          eraseNotice.replaceChildren();
          if (eraseConfirm.value.trim() !== "ERASE_ALL_DATA") {
            showError(eraseNotice, "Type ERASE_ALL_DATA exactly to confirm.");
            return;
          }
          if (!window.confirm("This permanently deletes employees, balances, tickets, loans, and airfare policies. Users and companies are kept. Continue?")) {
            return;
          }
          try {
            const result = await api("/admin/erase-data", {
              method: "POST",
              body: JSON.stringify({ confirm: "ERASE_ALL_DATA" }),
            });
            eraseConfirm.value = "";
            const tables = Object.entries(result.cleared || {})
              .map(([name, count]) => `${name}: ${count}`)
              .join(", ");
            showSuccess(eraseNotice, `Operational data erased. ${tables}`);
            await navigate("preferences");
          } catch (error) {
            showError(eraseNotice, error.message);
          }
        },
      },
    });
    content.append(el("section", { className: "panel form-panel danger-zone" },
      el("div", { className: "panel-title", text: "Erase all data" }),
      el("p", { className: "muted", text: "Permanently remove employees, opening balances, tickets, loans, airfare policies, attachments, and ESS requests. Login users, companies, and lookups stay. Type ERASE_ALL_DATA then confirm." }),
      el("div", { className: "field" }, el("label", { text: "Confirmation" }), eraseConfirm),
      eraseNotice,
      el("div", { className: "form-actions" }, eraseButton)));
  }
  document.body.classList.toggle("dark", data.theme === "dark");
}

async function renderBackupRestore(content) {
  if (!hasAnyRole("admin", "SYSTEM_ADMIN")) {
    content.append(pageHeader("Backup & Restore", "Admin access required."));
    content.append(el("section", { className: "panel form-panel" },
      el("div", { className: "empty", text: "Only administrators can create or restore backups." })));
    return;
  }
  const catalog = await api("/admin/backups");
  const notice = el("div");
  const refresh = el("button", {
    className: "secondary", type: "button", text: "Refresh",
    on: { click: () => navigate("backup") },
  });
  content.append(pageHeader(
    "Backup & Restore",
    "Logical JSON backups work on every engine. Native .bak uses open-source sqlcmd against MSSQL (same pattern as DBManager / ATLAS).",
    refresh,
  ));
  content.append(el("section", { className: "panel form-panel" },
    el("div", { className: "panel-title", text: "Why this screen exists" }),
    el("p", { className: "pref-help", text:
      "The original enterprise build required backup/restore. HCM previously only had start-backup.ps1. This screen catalogs files under the backup folder, computes SHA-256 checksums, and supports restore with an explicit confirmation." }),
    el("p", { className: "muted", text:
      `Folder: ${catalog.backup_root} · Retention: ${catalog.retention_days} days · Native MSSQL: ${catalog.native_mssql_available ? (catalog.native_credentials_ready ? "ready" : "needs SQL login in DATABASE_URL") : "not configured"}` })));

  const createLogical = el("button", {
    className: "primary", type: "button", text: "Create logical backup",
    on: {
      click: async () => {
        try {
          const created = await api("/admin/backups", {
            method: "POST", body: JSON.stringify({ kind: "logical" }),
          });
          showSuccess(notice, `Logical backup saved: ${created.file_name} (${created.sha256.slice(0, 12)}…)`);
          await navigate("backup");
        } catch (error) {
          showError(notice, error.message);
        }
      },
    },
  });
  const createNative = el("button", {
    className: "secondary", type: "button", text: "Create MSSQL .bak",
    disabled: !(catalog.native_mssql_available && catalog.native_credentials_ready),
    title: catalog.native_credentials_ready
      ? "Create a native SQL Server .bak using the API database login"
      : (catalog.native_credential_hint || "Configure SQL login in AIRFARE_DATABASE_URL first"),
    on: {
      click: async () => {
        try {
          const created = await api("/admin/backups", {
            method: "POST", body: JSON.stringify({ kind: "mssql" }),
          });
          showSuccess(notice, `Native backup saved: ${created.file_name}`);
          await navigate("backup");
        } catch (error) {
          showError(notice, error.message);
        }
      },
    },
  });
  content.append(el("section", { className: "panel form-panel" },
    el("div", { className: "panel-title", text: "Create backup" }),
    el("p", { className: "muted", text: "Logical = portable JSON (works always). MSSQL .bak = native BACKUP DATABASE using the same login as AIRFARE_DATABASE_URL (or AIRFARE_DB_USER / AIRFARE_DB_PASSWORD)." }),
    el("div", { className: "form-actions" }, createLogical, createNative),
    (!catalog.native_credentials_ready && catalog.native_mssql_available)
      ? el("p", { className: "muted", text: catalog.native_credential_hint || "MSSQL .bak is disabled until SQL login is available in DATABASE_URL." })
      : null,
    notice));

  const restoreSelect = el("select", {},
    el("option", { value: "", text: "Select backup file" }),
    ...(catalog.backups || []).map((item) => el("option", {
      value: item.file_name,
      text: `${item.file_name} · ${item.kind} · ${Math.ceil(item.size_bytes / 1024)} KB`,
    })));
  const restoreConfirm = el("input", {
    type: "text", placeholder: "Type RESTORE_CONFIRM", autocomplete: "off",
  });
  const restoreNotice = el("div");
  const restoreButton = el("button", {
    className: "danger-button", type: "button", text: "Restore selected backup",
    on: {
      click: async () => {
        restoreNotice.replaceChildren();
        if (!restoreSelect.value) {
          showError(restoreNotice, "Select a backup file first.");
          return;
        }
        if (restoreConfirm.value.trim() !== "RESTORE_CONFIRM") {
          showError(restoreNotice, "Type RESTORE_CONFIRM exactly to continue.");
          return;
        }
        if (!window.confirm(`Replace operational data from ${restoreSelect.value}?`)) return;
        try {
          const result = await api("/admin/backups/restore", {
            method: "POST",
            body: JSON.stringify({
              file_name: restoreSelect.value,
              confirm: "RESTORE_CONFIRM",
            }),
          });
          showSuccess(restoreNotice, `Restore complete (${result.kind}).`);
          restoreConfirm.value = "";
        } catch (error) {
          showError(restoreNotice, error.message);
        }
      },
    },
  });
  content.append(el("section", { className: "panel form-panel danger-zone" },
    el("div", { className: "panel-title", text: "Restore" }),
    el("p", { className: "muted", text: "Logical restore clears operational rows then reloads the JSON. Native .bak uses RESTORE DATABASE WITH REPLACE via the same SQL login as the API." }),
    el("div", { className: "field" }, el("label", { text: "Backup file" }), restoreSelect),
    el("div", { className: "field" }, el("label", { text: "Confirmation" }), restoreConfirm),
    restoreNotice,
    el("div", { className: "form-actions" }, restoreButton)));

  const tableWrap = el("div", { className: "table-wrap policy-table" });
  if (!(catalog.backups || []).length) {
    tableWrap.append(el("div", { className: "empty", text: "No backups yet. Create a logical backup above." }));
  } else {
    const body = el("tbody");
    catalog.backups.forEach((item) => {
      body.append(el("tr", {},
        el("td", { text: item.file_name }),
        el("td", { text: item.kind }),
        el("td", { text: `${Math.ceil(item.size_bytes / 1024)} KB` }),
        el("td", { text: item.created_at }),
        el("td", { text: `${item.sha256.slice(0, 16)}…` }),
        el("td", {}, el("button", {
          className: "danger-button", type: "button", text: "Delete",
          on: {
            click: async () => {
              if (!window.confirm(`Delete backup ${item.file_name}?`)) return;
              try {
                await api(`/admin/backups/${encodeURIComponent(item.file_name)}`, {
                  method: "DELETE",
                });
                await navigate("backup");
              } catch (error) {
                showError(content, error.message);
              }
            },
          },
        }))));
    });
    tableWrap.append(el("table", {},
      el("thead", {}, el("tr", {},
        el("th", { text: "File" }), el("th", { text: "Kind" }),
        el("th", { text: "Size" }), el("th", { text: "Created" }),
        el("th", { text: "SHA-256" }), el("th", { text: "" }))),
      body));
  }
  content.append(el("section", { className: "panel" },
    el("div", { className: "panel-header" },
      el("div", { className: "panel-title", text: `Backup catalog (${catalog.count || 0})` })),
    tableWrap));
}

function renderReports(content) {
  content.append(pageHeader("Reports", "Open operational reports, review rows, and export PDF or Excel."));
  const reports = [
    ["entitlement-balance-summary", "Entitlement Balance Summary"],
    ["booking-register", "Booking Register"],
    ["loan-recovery-ledger", "Loan Recovery Ledger"],
    ["liability-projections", "Liability Projections"],
    ["employee-master", "Employee Master"],
    ["opening-balances", "Opening Balances"],
    ["entitlements", "Entitlement Rates"],
    ["ticket-register", "Ticket Register"],
    ["loan-outstanding", "Loan Outstanding"],
    ["loan-statement", "Loan Statement"],
    ["excess-recovery", "Excess Recovery"],
  ];
  reports.forEach(([id, label]) => {
    const result = el("span", { className: "muted", text: "Not run" });
    const open = el("button", {
      className: "primary", type: "button", text: "Open",
      on: {
        click: async () => {
          try {
            const data = await api(`/reports/detail/${id}`);
            result.textContent = `${data.count} records · ${new Date(data.generated_at).toLocaleString()}`;
            await openReportDialog(id, label);
          } catch (error) { showError(content, error.message); }
        },
      },
    });
    const pdf = el("button", {
      className: "secondary", type: "button", text: "PDF",
      on: {
        click: async () => {
          try {
            await downloadReportFile(`/reports/export/${id}.pdf`, `${id}.pdf`);
          } catch (error) { showError(content, error.message); }
        },
      },
    });
    const excel = el("button", {
      className: "secondary", type: "button", text: "Excel",
      on: {
        click: async () => {
          try {
            await downloadReportFile(`/reports/export/${id}.xlsx`, `${id}.xlsx`);
          } catch (error) { showError(content, error.message); }
        },
      },
    });
    const template = templateButton(REPORT_TEMPLATE_NAMES[id], "Template");
    content.append(el("section", { className: "panel form-panel report-card" },
      el("div", { className: "report-icon", text: "▤" }),
      el("div", { style: "flex:1" }, el("div", { className: "panel-title", text: label }), result),
      el("div", { className: "actions" }, open, template, pdf, excel)));
  });
}

async function renderEss(content) {
  const [records, employees] = await Promise.all([
    api("/ess/requests"),
    api("/employees?limit=500"),
  ]);
  const employeeSelect = el("select", { id: "ess-employee", name: "employee_id", required: "required" },
    el("option", { value: "", text: "Select employee" }),
    ...employees.map((employee) => el("option", {
      value: employee.id, text: employeeOptionLabel(employee),
    })));
  const requestType = el("select", { id: "ess-type", name: "request_type", required: "required" },
    el("option", { value: "airfare", text: "airfare" }),
    el("option", { value: "ticket", text: "ticket" }),
    el("option", { value: "loan", text: "loan" }));
  const travelDate = el("input", { id: "ess-travel-date", name: "travel_date", type: "date", required: "required" });
  const origin = el("input", { id: "ess-origin", name: "origin_code", type: "text", required: "required", placeholder: "BAH" });
  const destination = el("input", { id: "ess-destination", name: "destination_code", type: "text", required: "required", placeholder: "DEL" });
  const notes = el("textarea", { id: "ess-notes", name: "notes", rows: "3", placeholder: "Optional notes" });
  const essForm = el("form", { className: "ess-form panel form-panel" },
    el("div", { className: "panel-header" },
      el("div", {},
        el("div", { className: "panel-title", text: "Submit ESS request" }),
        el("p", { className: "muted", text: "Quick airfare self-service form for employees and HR." }))),
    el("div", { className: "ess-form-grid" },
      el("div", { className: "field" }, el("label", { for: "ess-employee", text: "Employee" }), employeeSelect),
      el("div", { className: "field" }, el("label", { for: "ess-type", text: "Request type" }), requestType),
      el("div", { className: "field" }, el("label", { for: "ess-travel-date", text: "Travel date" }), travelDate),
      el("div", { className: "field" }, el("label", { for: "ess-origin", text: "Origin" }), origin),
      el("div", { className: "field" }, el("label", { for: "ess-destination", text: "Destination" }), destination),
      el("div", { className: "field", style: "grid-column:1/-1" }, el("label", { for: "ess-notes", text: "Notes" }), notes)),
    el("div", { className: "form-actions" },
      el("button", { className: "primary", type: "submit", text: "Submit request" })));
  essForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("/ess/requests", {
        method: "POST",
        body: JSON.stringify({
          employee_id: employeeSelect.value,
          request_type: requestType.value,
          travel_date: travelDate.value,
          origin_code: origin.value.trim(),
          destination_code: destination.value.trim(),
          notes: notes.value.trim(),
        }),
      });
      await navigate("ess");
    } catch (error) {
      showError(content, error.message);
    }
  });
  const create = el("button", {
    className: "primary", type: "button", text: "New request",
    on: {
      click: () => openCreateDialog({
        title: "ESS Requests",
        createEndpoint: "/ess/requests",
        fields: [
          ["employee_id", "Employee", "employee"],
          ["request_type", "Request type", "select", ["airfare", "ticket", "loan"]],
          ["travel_date", "Travel date", "date"],
          ["origin_code", "Origin", "text"],
          ["destination_code", "Destination", "text"],
          ["notes", "Notes", "text"],
        ],
      }),
    },
  });
  content.append(pageHeader(
    "Employee Self Service",
    "Submit airfare requests and follow approval status.",
    el("div", { className: "actions" }, templateButton("ess-requests"), create),
  ));
  content.append(essForm);
  const list = el("section", { className: "panel form-panel" });
  records.forEach((record) => {
    list.append(el("div", { className: "report-card" },
      el("div", {},
        el("div", { className: "panel-title",
          text: `${record.origin_code} → ${record.destination_code}` }),
        el("p", { className: "muted", text: `${record.travel_date} · ${record.request_type}` })),
      el("div", { className: "actions" },
        el("span", { className: `pill ${record.status}`, text: record.status }),
        el("button", {
          className: "danger-button", type: "button", text: "Delete",
          on: {
            click: async () => {
              if (!window.confirm("Delete this ESS request?")) return;
              try {
                await api(`/ess/requests/${record.id}`, {
                  method: "DELETE",
                  headers: { "If-Match": String(record.version) },
                });
                await navigate("ess");
              } catch (error) {
                showError(content, error.message);
              }
            },
          },
        }))));
  });
  if (!records.length) list.append(el("div", { className: "empty", text: "No requests submitted." }));
  content.append(list);
}

async function renderAdministration(content) {
  const lookupTypes = await api("/lookup-types");
  const entitlementRates = await api("/entitlement-rates");
  content.append(pageHeader(
    "Administration",
    "Maintain MSSQL-backed organizational lookups.",
    el("div", { className: "actions" },
      templateButton("lookups", "Lookup template"),
      templateButton("entitlement-rates", "Rate template")),
  ));
  const panel = el("section", { className: "panel form-panel" });
  if (!lookupTypes.length) {
    panel.append(el("div", {
      className: "empty",
      text: "No lookup types found in MSSQL. Add rows through API/bootstrap first.",
    }));
    content.append(panel);
    return;
  }
  for (const type of lookupTypes) {
    const records = await api(`/lookups/${type}`);
    const add = el("button", {
      className: "primary",
      type: "button",
      text: "Add",
      on: {
        click: () => openCreateDialog({
          title: type,
          createEndpoint: `/lookups/${type}`,
          fields: [["code", "Code", "text"], ["name", "Name", "text"]],
        }),
      },
    });
    const list = el("div", { className: "form-panel" });
    records.forEach((record) => {
      list.append(el("div", { className: "report-card" },
        el("div", {}, el("div", { className: "panel-title", text: `${record.code} — ${record.name}` }),
          el("p", { className: "muted", text: record.active ? "Active" : "Inactive" })),
        el("button", {
          className: "danger-button",
          type: "button",
          text: "Delete",
          on: {
            click: async () => {
              if (!window.confirm(`Delete lookup ${record.code}?`)) return;
              try {
                await api(`/lookups/${type}/${record.id}`, {
                  method: "DELETE",
                  headers: { "If-Match": String(record.version) },
                });
                await navigate("administration");
              } catch (error) {
                showError(content, error.message);
              }
            },
          },
        })));
    });
    if (!records.length) {
      list.append(el("div", { className: "empty", text: "No values configured." }));
    }
    panel.append(el("div", { className: "report-card" },
      el("div", {}, el("div", { className: "panel-title", text: type.replaceAll("_", " ") }),
        el("p", { className: "muted", text: `${records.length} active values` })),
      add));
    panel.append(list);
  }
  const rateList = el("div", { className: "form-panel" });
  entitlementRates.forEach((record) => {
    rateList.append(el("div", { className: "report-card" },
      el("div", {}, el("div", { className: "panel-title",
        text: `${record.scope_type} · ${record.amount}` }),
      el("p", { className: "muted", text: `${record.effective_from}${record.effective_to ? ` → ${record.effective_to}` : ""}` })),
      el("button", {
        className: "danger-button",
        type: "button",
        text: "Delete",
        on: {
          click: async () => {
            if (!window.confirm("Delete this entitlement rate?")) return;
            try {
              await api(`/entitlement-rates/${record.id}`, {
                method: "DELETE",
                headers: { "If-Match": String(record.version) },
              });
              await navigate("administration");
            } catch (error) {
              showError(content, error.message);
            }
          },
        },
      })));
  });
  if (!entitlementRates.length) {
    rateList.append(el("div", { className: "empty", text: "No entitlement rates configured." }));
  }
  panel.append(el("div", { className: "report-card" },
    el("div", {}, el("div", { className: "panel-title", text: "Entitlement rates" }),
      el("p", { className: "muted", text: `${entitlementRates.length} active rates` }))));
  panel.append(rateList);
  content.append(panel);
}

function formatMoney(value) {
  const number = Number(value || 0);
  return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(number);
}

function formatDecimal(value, maxDigits = 4) {
  if (value === null || value === undefined || value === "") return "—";
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxDigits,
  }).format(number);
}

async function start() {
  state.token = sessionStorage.getItem(TOKEN_KEY) || "";
  state.refreshToken = sessionStorage.getItem(REFRESH_KEY) || "";
  installStyles();
  if (!state.token) {
    renderLogin();
    return;
  }
  try {
    state.user = await api("/auth/me");
    renderShell();
  } catch (error) {
    renderLogin(error.message);
  }
}

start();
