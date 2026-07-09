"use client";

import {
  Activity,
  AlertTriangle,
  Bot,
  CalendarClock,
  CheckCircle2,
  CreditCard,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
  Users,
  WalletCards
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Allocation, AtlasSession, atlasFetch, Loan, LoanSummary, YearSummary } from "../../lib/atlas-api";
import { restoreSavedSession, SavedSession } from "./v2-session";
import styles from "./v2-shell.module.css";

type IntelligenceSummary = {
  AsOfDate?: string;
  CurrentYear?: number;
  IntelligenceScore?: number;
  CriticalCount?: number;
  WarningCount?: number;
  InfoCount?: number;
  EmployeeCount?: number;
  CurrentYearAllocations?: number;
  ActiveLoans?: number;
  OpenImportBatches?: number;
  OverallStatus?: string;
};

type IntelligenceItem = {
  Area: string;
  Severity: "CRITICAL" | "WARNING" | "INFO" | string;
  Title: string;
  Detail?: string;
  Recommendation: string;
};

type IntelligenceControlCenter = {
  summary: IntelligenceSummary;
  risks: IntelligenceItem[];
  recommendations: IntelligenceItem[];
};

type VerificationSummary = {
  AsOfDate?: string;
  CurrentYear?: number;
  TotalChecks?: number;
  PassedChecks?: number;
  WarningChecks?: number;
  FailedChecks?: number;
  VerificationScore?: number;
  VerificationStatus?: string;
};

type VerificationCheck = {
  Area: string;
  CheckCode: string;
  Severity: "CRITICAL" | "WARNING" | "INFO" | string;
  Status: "PASS" | "WARN" | "FAIL" | string;
  Title: string;
  Detail: string;
};

type SystemVerification = {
  summary: VerificationSummary;
  checks: VerificationCheck[];
};

type AirfarePayableReportRow = {
  EmployeeID: number;
  EmployeeCode: string;
  FullName: string;
  Department?: string;
  ReportYear: number;
  OpeningBalanceBHD: number;
  CurrentYearEarnedBHD: number;
  BalanceDays: number;
  PayableBHD: number;
  AirfareEntitlementAmount: number;
};

type OverviewPayload = {
  loans: Loan[];
  loanSummary: LoanSummary | null;
  allocations: Allocation[];
  summary: YearSummary | null;
  intelligence: IntelligenceControlCenter | null;
  verification: SystemVerification | null;
  airfarePayableReport: AirfarePayableReportRow[];
};


function moneyFormat(amount: number) {
  return new Intl.NumberFormat("en-BH", {
    style: "currency",
    currency: "BHD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number(amount || 0));
}

function countTone(value: number) {
  if (value > 0) return "warning";
  return "success";
}

export default function V2OverviewModule() {
  const [savedSession, setSavedSession] = useState<SavedSession | null>(null);
  const [payload, setPayload] = useState<OverviewPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastCheckedAt, setLastCheckedAt] = useState("");

  const fiscalYear = new Date().getFullYear();
  const asOfDate = new Date().toISOString().slice(0, 10);

  const loadOverview = useCallback(async () => {
    const restored = restoreSavedSession();
    setSavedSession(restored);
    if (!restored) {
      setLoading(false);
      setPayload(null);
      setError("");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const [loanSummary, loans, allocations, summary, intelligence, verification, airfarePayableReport] = await Promise.all([
        atlasFetch<LoanSummary>("/loans/summary", restored.session.token, restored.session.sessionId),
        atlasFetch<Loan[]>("/loans/register", restored.session.token, restored.session.sessionId),
        atlasFetch<Allocation[]>(`/allocations?year=${fiscalYear}`, restored.session.token, restored.session.sessionId),
        atlasFetch<YearSummary>(`/reports/year-summary/${fiscalYear}`, restored.session.token, restored.session.sessionId),
        atlasFetch<IntelligenceControlCenter>("/intelligence/control-center", restored.session.token, restored.session.sessionId),
        atlasFetch<SystemVerification>("/intelligence/verification", restored.session.token, restored.session.sessionId),
        atlasFetch<AirfarePayableReportRow[]>(
          `/reports/airfare-payable?year=${fiscalYear}&asOfDate=${asOfDate}`,
          restored.session.token,
          restored.session.sessionId
        )
      ]);

      setPayload({
        loanSummary,
        loans,
        allocations,
        summary,
        intelligence,
        verification,
        airfarePayableReport
      });
      setLastCheckedAt(new Date().toLocaleString("en-BH"));
    } catch (loadError) {
      setPayload(null);
      setError(loadError instanceof Error ? loadError.message : "Overview data could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [asOfDate, fiscalYear]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  const metrics = useMemo(() => {
    const reportRows = payload?.airfarePayableReport || [];
    const loans = payload?.loans || [];
    const allocations = payload?.allocations || [];
    const loanSummary = payload?.loanSummary || null;

    const totalAirfare = reportRows.reduce((sum, row) => sum + Number(row.AirfareEntitlementAmount || 0), 0);
    const payableAmount = reportRows.reduce((sum, row) => sum + Number(row.PayableBHD || 0), 0);
    const opening = reportRows.reduce((sum, row) => sum + Number(row.OpeningBalanceBHD || 0), 0);
    const currentYearEarned = reportRows.reduce((sum, row) => sum + Number(row.CurrentYearEarnedBHD || 0), 0);
    const employeeCount = reportRows.length;
    const loanBalance = Number(
      loanSummary?.TotalOutstanding ??
        loans
          .filter((loan) => String(loan.Status || "").toLowerCase() !== "settled")
          .reduce((sum, loan) => sum + Number(loan.RemainingBalance || 0), 0)
    );
    const companyPaidTotal = allocations.reduce((sum, item) => sum + Number(item.CompanyPaid || 0), 0);

    return {
      totalAirfare,
      payableAmount,
      opening,
      currentYearEarned,
      employeeCount,
      loanBalance,
      companyPaidTotal
    };
  }, [payload]);

  const trendData = useMemo(() => {
    const reportRows = payload?.airfarePayableReport || [];
    return [...reportRows]
      .sort((left, right) => Number(right.PayableBHD || 0) - Number(left.PayableBHD || 0))
      .slice(0, 8)
      .map((row) => ({
        name: row.EmployeeCode,
        payable: Number(Number(row.PayableBHD || 0).toFixed(2)),
        opening: Number(Number(row.OpeningBalanceBHD || 0).toFixed(2))
      }));
  }, [payload]);

  const pieData = useMemo(
    () => [
      { name: "Payable", value: Math.max(metrics.payableAmount, 0.01), color: "#0b63f6" },
      { name: "Opening", value: Math.max(metrics.opening, 0.01), color: "#8b5cf6" },
      { name: "Loans", value: Math.max(metrics.loanBalance, 0.01), color: "#ef4444" }
    ],
    [metrics.loanBalance, metrics.opening, metrics.payableAmount]
  );

  const topExposureRows = useMemo(() => {
    return [...(payload?.airfarePayableReport || [])]
      .sort((left, right) => Number(right.PayableBHD || 0) - Number(left.PayableBHD || 0))
      .slice(0, 5);
  }, [payload]);

  const verificationChecks = useMemo(() => {
    return (payload?.verification?.checks || []).slice(0, 4);
  }, [payload]);

  const intelligenceItems = useMemo(() => {
    const risks = payload?.intelligence?.risks || [];
    const recommendations = payload?.intelligence?.recommendations || [];
    return [...risks.slice(0, 2), ...recommendations.slice(0, 2)];
  }, [payload]);

  if (!savedSession) {
    return (
      <section className={styles.moduleStack}>
        <section className={styles.overviewHero}>
          <div className={styles.overviewHeroCopy}>
            <p>Overview migration</p>
            <h1>Sign in on ATLAS to load live dashboard data.</h1>
            <span>
              The first migrated module is wired for the same backend contracts. Once a valid session is present, the V2 overview reads live values from the API without changing the legacy workflow.
            </span>
          </div>
          <div className={styles.moduleStateCard}>
            <strong>Session required</strong>
            <span>Save a normal ATLAS session first, then reopen this route.</span>
          </div>
        </section>
      </section>
    );
  }

  return (
    <section className={styles.moduleStack}>
      <section className={styles.overviewHero}>
        <div className={styles.overviewHeroCopy}>
          <p>Overview migration</p>
          <h1>Command metrics, clean decisions.</h1>
          <span>
            The first V2 business module now reads the same live dashboard inputs as the legacy overview, using the active API session and the current fiscal year.
          </span>
        </div>
        <div className={styles.moduleStateCard}>
          <strong>Live sync</strong>
          <span>{loading ? "Refreshing live dashboard data..." : `Fiscal year ${fiscalYear} loaded.`}</span>
          <small>{lastCheckedAt ? `Last checked ${lastCheckedAt}` : "Waiting for first sync."}</small>
        </div>
      </section>

      <section className={styles.moduleToolbar}>
        <div className={styles.moduleToolbarMeta}>
          <span className={styles.heroPill}>FY {fiscalYear}</span>
          <span className={styles.toolbarMetaText}>Signed in as {savedSession.session.user.fullName || savedSession.session.user.username}</span>
        </div>
        <button
          type="button"
          className={styles.moduleActionButton}
          onClick={() => void loadOverview()}
          aria-label="Refresh overview data"
          data-testid="overview-refresh"
        >
          <RefreshCw size={16} />
          <span>{loading ? "Refreshing" : "Refresh data"}</span>
        </button>
      </section>

      {error ? (
        <section className={styles.errorPanel} role="alert">
          <AlertTriangle size={18} />
          <div>
            <strong>Overview sync failed</strong>
            <span>{error}</span>
          </div>
        </section>
      ) : null}

      <section className={styles.overviewMetricGrid}>
        <article className={styles.overviewMetricCard} data-testid="metric-payable">
          <small>Airfare payable</small>
          <strong>{moneyFormat(metrics.payableAmount)}</strong>
          <span>Legacy overview formula, same SQL-backed report rows.</span>
          <WalletCards size={18} />
        </article>
        <article className={styles.overviewMetricCard} data-testid="metric-current-earned">
          <small>Current year earned</small>
          <strong>{moneyFormat(metrics.currentYearEarned)}</strong>
          <span>Current-year accrual from the live payable report contract.</span>
          <TrendingUp size={18} />
        </article>
        <article className={styles.overviewMetricCard} data-testid="metric-employees">
          <small>Report employees</small>
          <strong>{metrics.employeeCount}</strong>
          <span>Employees currently represented in the report scope.</span>
          <Users size={18} />
        </article>
        <article className={styles.overviewMetricCard} data-testid="metric-loans">
          <small>Loan exposure</small>
          <strong>{moneyFormat(metrics.loanBalance)}</strong>
          <span>Outstanding exposure carried from the same loan summary logic.</span>
          <CreditCard size={18} />
        </article>
      </section>

      <section className={styles.moduleColumns}>
        <article className={styles.panel}>
          <div className={styles.panelTitle}>
            <Activity size={18} />
            <span>Payable movement</span>
          </div>
          <div className={styles.chartWrap}>
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={trendData}>
                <defs>
                  <linearGradient id="v2PayableFill" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="5%" stopColor="#0b63f6" stopOpacity={0.42} />
                    <stop offset="95%" stopColor="#0b63f6" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(148, 163, 184, 0.18)" vertical={false} />
                <XAxis dataKey="name" stroke="currentColor" tickLine={false} axisLine={false} />
                <YAxis stroke="currentColor" tickLine={false} axisLine={false} />
                <Tooltip />
                <Area type="monotone" dataKey="payable" stroke="#0b63f6" fill="url(#v2PayableFill)" strokeWidth={3} />
                <Area type="monotone" dataKey="opening" stroke="#8b5cf6" fill="transparent" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </article>

        <article className={styles.panel}>
          <div className={styles.panelTitle}>
            <ShieldCheck size={18} />
            <span>Verification watch</span>
          </div>
          <div className={styles.statusSummaryRow}>
            <div className={styles.statusPill} data-tone={countTone(Number(payload?.verification?.summary?.FailedChecks || 0))}>
              <strong>{payload?.verification?.summary?.VerificationStatus || "Ready"}</strong>
              <small>Verification status</small>
            </div>
            <div className={styles.statusPill}>
              <strong>{payload?.verification?.summary?.VerificationScore || 0}%</strong>
              <small>Verification score</small>
            </div>
          </div>
          <div className={styles.signalList}>
            {verificationChecks.map((check) => (
              <div key={`${check.CheckCode}-${check.Title}`} className={styles.signalRow}>
                <div>
                  <strong>{check.Title}</strong>
                  <small>{check.Detail}</small>
                </div>
                <span className={styles.signalBadge} data-status={String(check.Status || "").toLowerCase()}>
                  {check.Status}
                </span>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className={styles.moduleColumns}>
        <article className={styles.panel}>
          <div className={styles.panelTitle}>
            <Bot size={18} />
            <span>Smart review</span>
          </div>
          <div className={styles.signalList}>
            {intelligenceItems.length ? intelligenceItems.map((item, index) => (
              <div key={`${item.Title}-${index}`} className={styles.signalRow}>
                <div>
                  <strong>{item.Title}</strong>
                  <small>{item.Detail || item.Recommendation}</small>
                </div>
                <span className={styles.signalBadge} data-status={String(item.Severity || "").toLowerCase()}>
                  {item.Severity}
                </span>
              </div>
            )) : (
              <div className={styles.signalRow}>
                <div>
                  <strong>No active intelligence warnings</strong>
                  <small>The current control center did not return immediate review items.</small>
                </div>
                <span className={styles.signalBadge} data-status="pass">PASS</span>
              </div>
            )}
          </div>
        </article>

        <article className={styles.panel}>
          <div className={styles.panelTitle}>
            <CalendarClock size={18} />
            <span>Exposure mix</span>
          </div>
          <div className={styles.chartWrap}>
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie data={pieData} innerRadius={64} outerRadius={96} dataKey="value" paddingAngle={3}>
                  {pieData.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </article>
      </section>

      <article className={styles.panel}>
        <div className={styles.panelTitle}>
          <CheckCircle2 size={18} />
          <span>Top payable balances</span>
        </div>
        <div className={styles.exposureTable} role="table" aria-label="Top payable balances">
          <div className={styles.exposureTableHeader} role="row">
            <span>Employee</span>
            <span>Opening</span>
            <span>Payable</span>
            <span>Balance days</span>
          </div>
          {topExposureRows.map((row) => (
            <div key={`${row.EmployeeID}-${row.ReportYear}`} className={styles.exposureTableRow} role="row">
              <span>
                <strong>{row.FullName}</strong>
                <small>{row.EmployeeCode}{row.Department ? ` / ${row.Department}` : ""}</small>
              </span>
              <span>{moneyFormat(row.OpeningBalanceBHD)}</span>
              <span>{moneyFormat(row.PayableBHD)}</span>
              <span>{Number(row.BalanceDays || 0).toFixed(2)}</span>
            </div>
          ))}
        </div>
      </article>
    </section>
  );
}
