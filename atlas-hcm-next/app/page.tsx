"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowDownToLine,
  Bell,
  CheckCircle2,
  CircleDollarSign,
  Database,
  Gauge,
  LayoutDashboard,
  ListChecks,
  Lock,
  LogOut,
  Plane,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Users,
  WalletCards
} from "lucide-react";
import {
  Allocation,
  AirfareEntitlementReconciliationResult,
  AtlasSession,
  AtlasVersionInfo,
  Employee,
  LoanSummary,
  atlasFetch,
  atlasHealth,
  atlasLogin,
  atlasVersion,
  calculateExcelTotal,
  closingBalanceDays
} from "../lib/atlas-api";

type ModuleKey =
  | "command"
  | "employees"
  | "seeds"
  | "airfare"
  | "loans"
  | "reconciliation"
  | "preferences";

type LoadState = "idle" | "loading" | "ready" | "error";

type OpeningBalanceSeed = {
  EmployeeID?: number;
  EmployeeCode?: string;
  FullName?: string;
  OpeningYear?: number;
  Year?: number;
  OpeningDays?: number;
  OpeningBHD?: number;
  OpeningAmount?: number;
  Status?: string;
};

type AirfarePolicy = {
  PolicyRateID?: number;
  MaxPayoutAmount?: number;
  PerDayRate?: number;
  CycleDays?: number;
  EffectiveFrom?: string;
  PolicyStatus?: string;
  IsActive?: boolean;
};

type SystemHealth = {
  status?: string;
  database?: { connected?: boolean; name?: string; schemaVersion?: string };
  features?: Record<string, boolean>;
};

type AppData = {
  employees: Employee[];
  seeds: OpeningBalanceSeed[];
  allocations: Allocation[];
  loans?: LoanSummary;
  policies: AirfarePolicy[];
  reconciliation?: AirfareEntitlementReconciliationResult;
};

const SESSION_KEY = "atlas.fresh3356.session";
const CURRENCY = new Intl.NumberFormat("en-BH", { style: "currency", currency: "BHD", maximumFractionDigits: 2 });

const modules: Array<{ key: ModuleKey; label: string; hint: string; icon: React.ElementType }> = [
  { key: "command", label: "Command Center", hint: "Live status", icon: LayoutDashboard },
  { key: "employees", label: "Employees", hint: "Eligibility + balances", icon: Users },
  { key: "seeds", label: "Entitlement Seeds", hint: "Legacy opening evidence", icon: ArrowDownToLine },
  { key: "airfare", label: "Airfare Activity", hint: "Allocations + policy", icon: Plane },
  { key: "loans", label: "Loans", hint: "Recovery monitor", icon: WalletCards },
  { key: "reconciliation", label: "Reconciliation", hint: "Admin diagnostics", icon: ListChecks },
  { key: "preferences", label: "Preferences", hint: "Workspace controls", icon: Settings }
];

function formatMoney(value: unknown) {
  return CURRENCY.format(Number(value || 0));
}

function formatNumber(value: unknown, digits = 0) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(Number(value || 0));
}

function firstRows<T>(rows: T[], count = 8) {
  return rows.slice(0, count);
}

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export default function FreshAtlasApp() {
  const [session, setSession] = useState<AtlasSession | null>(null);
  const [version, setVersion] = useState<AtlasVersionInfo | null>(null);
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [active, setActive] = useState<ModuleKey>("command");
  const [status, setStatus] = useState<LoadState>("idle");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [fiscalCycle, setFiscalCycle] = useState(new Date().getFullYear());
  const [loginForm, setLoginForm] = useState({ username: "admin", password: "" });
  const [data, setData] = useState<AppData>({
    employees: [],
    seeds: [],
    allocations: [],
    policies: []
  });

  useEffect(() => {
    const saved = window.localStorage.getItem(SESSION_KEY);
    if (saved) {
      try {
        setSession(JSON.parse(saved));
      } catch {
        window.localStorage.removeItem(SESSION_KEY);
      }
    }

    void refreshPublicStatus();
  }, []);

  useEffect(() => {
    if (session) {
      void refreshWorkspace(session);
    }
  }, [session, fiscalCycle]);

  const metrics = useMemo(() => {
    const activeEmployees = data.employees.filter((employee) => String(employee.Status || "").toLowerCase() === "active");
    const entitlementDays = data.employees.reduce((sum, employee) => sum + closingBalanceDays(employee), 0);
    const entitlementBhd = data.employees.reduce((sum, employee) => sum + calculateExcelTotal(employee), 0);
    const allocationSpend = data.allocations.reduce((sum, allocation) => sum + Number(allocation.CompanyPaid || allocation.TicketCost || 0), 0);
    const latestPolicy = data.policies.find((policy) => policy.IsActive !== false) || data.policies[0];

    return {
      activeEmployees: activeEmployees.length,
      totalEmployees: data.employees.length,
      entitlementDays,
      entitlementBhd,
      allocationSpend,
      seedRows: data.seeds.length,
      activeLoans: Number(data.loans?.ActiveLoans || 0),
      outstandingLoans: Number(data.loans?.TotalOutstanding || 0),
      policyAmount: Number(latestPolicy?.MaxPayoutAmount || 150),
      perDayRate: Number(latestPolicy?.PerDayRate || 0),
      reconciliationIssues: Number(data.reconciliation?.summary?.investigate || 0)
    };
  }, [data]);

  const filteredEmployees = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return data.employees;
    return data.employees.filter((employee) =>
      `${employee.EmployeeCode} ${employee.FullName} ${employee.Department || ""} ${employee.Branch || ""}`.toLowerCase().includes(query)
    );
  }, [data.employees, search]);

  async function refreshPublicStatus() {
    try {
      const [versionResult, healthResult] = await Promise.allSettled([atlasVersion(), atlasHealth()]);
      if (versionResult.status === "fulfilled") setVersion(versionResult.value);
      if (healthResult.status === "fulfilled") setHealth(healthResult.value as SystemHealth);
    } catch {
      // Public status is advisory; login and workspace loading show actionable errors.
    }
  }

  async function handleLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("loading");
    setMessage("Signing in to the fresh 3356 workspace…");
    try {
      const nextSession = await atlasLogin(loginForm.username.trim(), loginForm.password);
      window.localStorage.setItem(SESSION_KEY, JSON.stringify(nextSession));
      setSession(nextSession);
      setMessage(`Signed in as ${nextSession.user.fullName || nextSession.user.username}.`);
      setStatus("ready");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Login failed.");
    }
  }

  async function refreshWorkspace(activeSession = session) {
    if (!activeSession) return;
    setStatus("loading");
    setMessage("Refreshing live SQL-backed entitlement workspace…");

    const token = activeSession.token;
    const sessionId = activeSession.sessionId;
    const calls = await Promise.allSettled([
      atlasVersion(),
      atlasHealth(),
      atlasFetch<Employee[]>("/employees", token, sessionId),
      atlasFetch<OpeningBalanceSeed[]>(`/opening-balances?year=${fiscalCycle}`, token, sessionId),
      atlasFetch<Allocation[]>(`/allocations?year=${fiscalCycle}`, token, sessionId),
      atlasFetch<LoanSummary>("/loans/summary", token, sessionId),
      atlasFetch<AirfarePolicy[]>("/airfare-policy-rates", token, sessionId),
      atlasFetch<AirfareEntitlementReconciliationResult>(
        `/airfare/entitlement/reconciliation?year=${fiscalCycle}&tolerance=0.01`,
        token,
        sessionId
      )
    ]);

    const rejected = calls.find((call) => call.status === "rejected") as PromiseRejectedResult | undefined;
    if (rejected) {
      setStatus("error");
      setMessage(rejected.reason instanceof Error ? rejected.reason.message : "Workspace refresh failed.");
      return;
    }

    const [
      nextVersion,
      nextHealth,
      employees,
      seeds,
      allocations,
      loans,
      policies,
      reconciliation
    ] = calls.map((call) => (call as PromiseFulfilledResult<unknown>).value);

    setVersion(nextVersion as AtlasVersionInfo);
    setHealth(nextHealth as SystemHealth);
    setData({
      employees: Array.isArray(employees) ? employees as Employee[] : [],
      seeds: Array.isArray(seeds) ? seeds as OpeningBalanceSeed[] : [],
      allocations: Array.isArray(allocations) ? allocations as Allocation[] : [],
      loans: loans as LoanSummary,
      policies: Array.isArray(policies) ? policies as AirfarePolicy[] : [],
      reconciliation: reconciliation as AirfareEntitlementReconciliationResult
    });
    setStatus("ready");
    setMessage("Fresh 3356 workspace is live.");
  }

  function logout() {
    window.localStorage.removeItem(SESSION_KEY);
    setSession(null);
    setData({ employees: [], seeds: [], allocations: [], policies: [] });
    setMessage("Signed out.");
  }

  return (
    <main className="atlas-root">
      <aside className="atlas-sidebar" aria-label="ATLAS navigation">
        <div className="brand-card">
          <div className="brand-mark"><Plane size={24} /></div>
          <div>
            <p>ATLAS HCM</p>
            <h1>Airfare Entitlement</h1>
            <span>Fresh build · port 3356</span>
          </div>
        </div>

        <section className="context-card">
          <span className="eyebrow">Fiscal cycle</span>
          <div className="cycle-control">
            <button type="button" onClick={() => setFiscalCycle((year) => year - 1)} aria-label="Previous fiscal cycle">−</button>
            <strong>{fiscalCycle}</strong>
            <button type="button" onClick={() => setFiscalCycle((year) => year + 1)} aria-label="Next fiscal cycle">+</button>
          </div>
        </section>

        <nav className="module-list">
          {modules.map((item, index) => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                className={cx("module-button", active === item.key && "active")}
                type="button"
                onClick={() => setActive(item.key)}
              >
                <Icon size={19} />
                <span>
                  <strong>{item.label}</strong>
                  <small>{item.hint}</small>
                </span>
                <kbd>⌘{index + 1}</kbd>
              </button>
            );
          })}
        </nav>

        <section className="sidebar-footer">
          <ShieldCheck size={20} />
          <div>
            <strong>Continuous model</strong>
            <span>Rules + history compute entitlement on demand. No annual reset screen.</span>
          </div>
        </section>
      </aside>

      <section className="atlas-shell">
        <header className="topbar">
          <div>
            <span className="eyebrow">Live SQL command workspace</span>
            <h2>{modules.find((item) => item.key === active)?.label || "Command Center"}</h2>
          </div>

          <label className="search-box">
            <Search size={18} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search employees, teams, balances" />
          </label>

          <div className="topbar-actions">
            <StatusPill label={`v${version?.version || "checking"}`} tone="blue" />
            <StatusPill label={health?.database?.connected ? "SQL live" : "SQL pending"} tone={health?.database?.connected ? "green" : "amber"} />
            {session ? (
              <button className="ghost-button" type="button" onClick={logout}><LogOut size={17} /> Logout</button>
            ) : null}
          </div>
        </header>

        {message ? (
          <div className={cx("system-banner", status === "error" && "danger")}>
            {status === "error" ? <Lock size={18} /> : <CheckCircle2 size={18} />}
            <span>{message}</span>
          </div>
        ) : null}

        {!session ? (
          <LoginPanel
            form={loginForm}
            setForm={setLoginForm}
            onSubmit={handleLogin}
            status={status}
            version={version}
            health={health}
          />
        ) : (
          <div className="workspace-grid">
            <section className="primary-panel">
              {active === "command" && <CommandCenter metrics={metrics} version={version} health={health} onRefresh={() => refreshWorkspace()} />}
              {active === "employees" && <EmployeesPanel rows={filteredEmployees} />}
              {active === "seeds" && <SeedsPanel rows={data.seeds} fiscalCycle={fiscalCycle} />}
              {active === "airfare" && <AirfarePanel allocations={data.allocations} policies={data.policies} />}
              {active === "loans" && <LoansPanel summary={data.loans} />}
              {active === "reconciliation" && <ReconciliationPanel reconciliation={data.reconciliation} fiscalCycle={fiscalCycle} />}
              {active === "preferences" && <PreferencesPanel />}
            </section>

            <aside className="insight-rail">
              <InsightCard icon={Gauge} title="Entitlement formula" value={`${formatNumber(metrics.entitlementDays, 2)} days`} detail={`${formatMoney(metrics.entitlementBhd)} live balance`} />
              <InsightCard icon={CircleDollarSign} title="Policy rate" value={formatMoney(metrics.policyAmount)} detail={`${formatMoney(metrics.perDayRate)} per day`} />
              <InsightCard icon={Activity} title="Reconciliation" value={`${metrics.reconciliationIssues} review`} detail="Continuous vs legacy evidence" />
              <InsightCard icon={Database} title="Database" value={health?.database?.name || "Atlasairfare010"} detail={health?.database?.schemaVersion || "schema pending"} />
            </aside>
          </div>
        )}
      </section>
    </main>
  );
}

function LoginPanel({
  form,
  setForm,
  onSubmit,
  status,
  version,
  health
}: {
  form: { username: string; password: string };
  setForm: (next: { username: string; password: string }) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  status: LoadState;
  version: AtlasVersionInfo | null;
  health: SystemHealth | null;
}) {
  return (
    <section className="login-grid">
      <div className="hero-panel">
        <span className="eyebrow">Fresh ATLAS rebuild</span>
        <h2>Clean entitlement workspace on port 3356.</h2>
        <p>
          This UI starts from the continuous airfare concept: policy rules, historical seed evidence,
          allocations, loans, and reconciliation all visible from one clean command surface.
        </p>
        <div className="hero-proof">
          <StatusPill label={`Runtime ${version?.version || "pending"}`} tone="blue" />
          <StatusPill label={health?.database?.connected ? "Database connected" : "Database pending"} tone={health?.database?.connected ? "green" : "amber"} />
          <StatusPill label="No annual reset screen" tone="slate" />
        </div>
      </div>

      <form className="login-card" onSubmit={onSubmit}>
        <span className="eyebrow">Administrator sign in</span>
        <h3>Open workspace</h3>
        <label>
          Username
          <input value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} autoComplete="username" />
        </label>
        <label>
          Password
          <input value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} type="password" autoComplete="current-password" />
        </label>
        <button className="primary-button" type="submit" disabled={status === "loading"}>
          {status === "loading" ? <RefreshCw className="spin" size={18} /> : <ShieldCheck size={18} />}
          Sign in
        </button>
      </form>
    </section>
  );
}

function CommandCenter({ metrics, version, health, onRefresh }: {
  metrics: ReturnType<typeof FreshAtlasApp extends () => infer R ? never : never> | {
    activeEmployees: number;
    totalEmployees: number;
    entitlementDays: number;
    entitlementBhd: number;
    allocationSpend: number;
    seedRows: number;
    activeLoans: number;
    outstandingLoans: number;
    policyAmount: number;
    reconciliationIssues: number;
  };
  version: AtlasVersionInfo | null;
  health: SystemHealth | null;
  onRefresh: () => void;
}) {
  return (
    <>
      <section className="command-hero">
        <div>
          <span className="eyebrow">Entitlement command center</span>
          <h2>Continuous airfare, clean decisions.</h2>
          <p>Formula outputs stay tied to SQL policy and transaction history. Legacy opening data is treated as seed evidence, not an annual close workflow.</p>
        </div>
        <button className="primary-button" type="button" onClick={onRefresh}><RefreshCw size={18} /> Refresh live data</button>
      </section>

      <section className="metric-grid">
        <Metric label="Active employees" value={formatNumber(metrics.activeEmployees)} detail={`${formatNumber(metrics.totalEmployees)} total`} />
        <Metric label="Entitlement balance" value={formatMoney(metrics.entitlementBhd)} detail={`${formatNumber(metrics.entitlementDays, 2)} days`} strong />
        <Metric label="Allocation spend" value={formatMoney(metrics.allocationSpend)} detail="Current cycle activity" />
        <Metric label="Open loan exposure" value={formatMoney(metrics.outstandingLoans)} detail={`${metrics.activeLoans} active loan(s)`} />
      </section>

      <section className="section-card">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Runtime identity</span>
            <h3>3356 build proof</h3>
          </div>
          <StatusPill label={health?.database?.connected ? "SQL verified" : "SQL not ready"} tone={health?.database?.connected ? "green" : "amber"} />
        </div>
        <div className="proof-grid">
          <Proof label="Version" value={version?.version || "pending"} />
          <Proof label="Commit" value={version?.gitCommit || "pending"} />
          <Proof label="Port" value={String(version?.runtime?.port || 3356)} />
          <Proof label="Schema" value={version?.databaseSchemaVersion || health?.database?.schemaVersion || "pending"} />
        </div>
      </section>
    </>
  );
}

function EmployeesPanel({ rows }: { rows: Employee[] }) {
  return (
    <section className="section-card fill">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Employee entitlement register</span>
          <h3>{rows.length} employee records</h3>
        </div>
        <StatusPill label="Formula-backed" tone="green" />
      </div>
      <div className="table-card">
        <div className="table-row table-head">
          <span>Employee</span>
          <span>Department</span>
          <span>Days</span>
          <span>Balance</span>
          <span>Status</span>
        </div>
        {firstRows(rows, 14).map((employee) => (
          <div className="table-row" key={employee.EmployeeID}>
            <span><strong>{employee.FullName}</strong><small>{employee.EmployeeCode}</small></span>
            <span>{employee.Department || employee.Branch || "—"}</span>
            <span>{formatNumber(closingBalanceDays(employee), 2)}</span>
            <span>{formatMoney(calculateExcelTotal(employee))}</span>
            <span><StatusPill label={employee.Status || "Unknown"} tone={String(employee.Status).toLowerCase() === "active" ? "green" : "slate"} /></span>
          </div>
        ))}
      </div>
    </section>
  );
}

function SeedsPanel({ rows, fiscalCycle }: { rows: OpeningBalanceSeed[]; fiscalCycle: number }) {
  const totalDays = rows.reduce((sum, row) => sum + Number(row.OpeningDays || 0), 0);
  const totalAmount = rows.reduce((sum, row) => sum + Number(row.OpeningBHD || row.OpeningAmount || 0), 0);
  return (
    <section className="section-card fill">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Entitlement seed evidence</span>
          <h3>{fiscalCycle} seed register</h3>
        </div>
        <StatusPill label={`${rows.length} rows`} tone="blue" />
      </div>
      <section className="metric-grid compact">
        <Metric label="Seed days" value={formatNumber(totalDays, 2)} detail="Opening evidence only" />
        <Metric label="Seed amount" value={formatMoney(totalAmount)} detail="Used by continuous balance" />
      </section>
      <div className="table-card">
        {firstRows(rows, 12).map((row, index) => (
          <div className="table-row four" key={`${row.EmployeeID || row.EmployeeCode || index}-${index}`}>
            <span><strong>{row.FullName || "Employee"}</strong><small>{row.EmployeeCode || row.EmployeeID || "—"}</small></span>
            <span>{row.OpeningYear || row.Year || fiscalCycle}</span>
            <span>{formatNumber(row.OpeningDays, 2)} days</span>
            <span>{formatMoney(row.OpeningBHD || row.OpeningAmount)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function AirfarePanel({ allocations, policies }: { allocations: Allocation[]; policies: AirfarePolicy[] }) {
  return (
    <section className="section-card fill">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Airfare activity</span>
          <h3>Allocations and policy rules</h3>
        </div>
        <StatusPill label={`${policies.length} policy rule(s)`} tone="blue" />
      </div>
      <section className="split-grid">
        <div className="mini-panel">
          <h4>Latest allocations</h4>
          {firstRows(allocations, 7).map((allocation) => (
            <div className="activity-row" key={allocation.AllocationID}>
              <span><strong>{allocation.FullName}</strong><small>{allocation.AllocYear} · {allocation.PaymentMode}</small></span>
              <b>{formatMoney(allocation.CompanyPaid || allocation.TicketCost)}</b>
            </div>
          ))}
        </div>
        <div className="mini-panel">
          <h4>Policy rules</h4>
          {firstRows(policies, 7).map((policy, index) => (
            <div className="activity-row" key={policy.PolicyRateID || index}>
              <span><strong>{formatMoney(policy.MaxPayoutAmount)}</strong><small>{policy.CycleDays || 720} cycle days · from {String(policy.EffectiveFrom || "current").slice(0, 10)}</small></span>
              <StatusPill label={policy.IsActive === false ? "Inactive" : "Active"} tone={policy.IsActive === false ? "slate" : "green"} />
            </div>
          ))}
        </div>
      </section>
    </section>
  );
}

function LoansPanel({ summary }: { summary?: LoanSummary }) {
  return (
    <section className="section-card fill">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Loan recovery monitor</span>
          <h3>Deduction health</h3>
        </div>
        <StatusPill label={`${summary?.ActiveLoans || 0} active`} tone="amber" />
      </div>
      <section className="metric-grid">
        <Metric label="Original issued" value={formatMoney(summary?.TotalOriginal)} detail={`${summary?.TotalLoans || 0} total loan(s)`} />
        <Metric label="Outstanding" value={formatMoney(summary?.TotalOutstanding)} detail="Remaining balance" strong />
        <Metric label="Monthly deduction" value={formatMoney(summary?.MonthlyDeduction)} detail="Expected payroll recovery" />
        <Metric label="Recovered" value={formatMoney(summary?.TotalRecovered)} detail={`${summary?.SettledLoans || 0} settled`} />
      </section>
    </section>
  );
}

function ReconciliationPanel({ reconciliation, fiscalCycle }: { reconciliation?: AirfareEntitlementReconciliationResult; fiscalCycle: number }) {
  const rows = reconciliation?.rows || [];
  return (
    <section className="section-card fill">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Migration debug / reconciliation</span>
          <h3>Continuous model validation · {fiscalCycle}</h3>
        </div>
        <StatusPill label="Not used for payroll" tone="amber" />
      </div>
      <section className="metric-grid compact">
        <Metric label="Checked" value={formatNumber(reconciliation?.summary?.checked)} detail="Employees sampled" />
        <Metric label="OK" value={formatNumber(reconciliation?.summary?.ok)} detail="Matched tolerance" />
        <Metric label="Investigate" value={formatNumber(reconciliation?.summary?.investigate)} detail="Needs admin review" strong />
      </section>
      <div className="table-card">
        <div className="table-row table-head">
          <span>Employee</span>
          <span>Legacy</span>
          <span>Continuous</span>
          <span>Difference</span>
          <span>Status</span>
        </div>
        {firstRows(rows, 12).map((row, index) => (
          <div className="table-row" key={`${row.employeeId || index}-${index}`}>
            <span><strong>{row.fullName || row.employeeCode || "Employee"}</strong><small>{row.employeeCode || "—"}</small></span>
            <span>{formatMoney(row.legacyAirfareBalance)}</span>
            <span>{formatMoney(row.continuousAirfareBalance)}</span>
            <span>{formatMoney(row.difference)}</span>
            <span><StatusPill label={row.status || "review"} tone={String(row.status || "").toLowerCase().includes("ok") ? "green" : "amber"} /></span>
          </div>
        ))}
      </div>
    </section>
  );
}

function PreferencesPanel() {
  return (
    <section className="section-card fill">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Workspace preferences</span>
          <h3>Clean controls, low request pressure</h3>
        </div>
        <StatusPill label="Local-first" tone="green" />
      </div>
      <section className="preference-grid">
        <Preference icon={SlidersHorizontal} title="Density" value="Comfortable" detail="Readable payroll tables with fixed row rhythm." />
        <Preference icon={Sparkles} title="Theme" value="System blue" detail="Accessible contrast and restrained accents." />
        <Preference icon={Bell} title="Notifications" value="Critical only" detail="No burst refreshes; manual refresh is explicit." />
        <Preference icon={Lock} title="Safety" value="Admin gated" detail="Reconciliation writes remain disabled by feature flag." />
      </section>
    </section>
  );
}

function Metric({ label, value, detail, strong }: { label: string; value: string; detail: string; strong?: boolean }) {
  return (
    <article className={cx("metric-card", strong && "strong")}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function Proof({ label, value }: { label: string; value: string }) {
  return (
    <div className="proof-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function InsightCard({ icon: Icon, title, value, detail }: { icon: React.ElementType; title: string; value: string; detail: string }) {
  return (
    <article className="insight-card">
      <Icon size={20} />
      <span>{title}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function Preference({ icon: Icon, title, value, detail }: { icon: React.ElementType; title: string; value: string; detail: string }) {
  return (
    <article className="preference-card">
      <Icon size={22} />
      <div>
        <strong>{title}</strong>
        <span>{value}</span>
        <p>{detail}</p>
      </div>
    </article>
  );
}

function StatusPill({ label, tone }: { label: string; tone: "blue" | "green" | "amber" | "slate" }) {
  return <span className={cx("status-pill", tone)}>{label}</span>;
}
