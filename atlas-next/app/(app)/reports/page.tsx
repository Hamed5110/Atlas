"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  ExternalLink,
  Award,
  BadgeAlert,
  BadgeDollarSign,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Layers,
  Printer,
  PieChart,
  Search,
  TrendingUp,
  Activity,
  BarChart3,
  Building2,
  CalendarClock,
  CalendarDays,
  Clock,
  Download,
  FileText,
  Filter,
  LineChart,
  ListOrdered,
  LogOut,
  Plane,
  Receipt,
  RefreshCw,
  Route,
  Scale,
  Sparkles,
  Timer,
  UserX,
  Users,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import {
  RANGE_PREFERENCE_PREFIX,
  RANGE_PRESETS,
  effectiveRange,
  fiscalYearLabel,
  inclusiveDays,
  localIsoDate,
  parseRange,
  rangeFromPreset,
  serializeRange,
  withTo,
  type RangeState,
} from "@/lib/report-period";
import {
  ATTENDANCE_PRESETS,
  MONTH_PRESETS,
  DateRangeFilter,
  STATEMENT_PRESETS,
  TRANSACTION_PRESETS,
} from "@/components/reports/date-range-filter";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { AttendanceCalendar, visibleCalendarRows, type AttendanceCalendarData } from "@/components/reports/attendance-calendar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { MultiSelect } from "@/components/ui/multi-select";
import { EmptyState, PageHeader } from "@/components/ui/primitives";
import { TableSkeleton } from "@/components/ui/skeleton";
import { Table, TableCaption, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { api, download, errorMessage } from "@/lib/api";
import { hasRole, useAuth } from "@/lib/auth";
import { pickPrimaryCompanyId } from "@/lib/company";
import {
  buildView,
  DEFAULT_VIEW,
  columnLabel,
  groupableColumns,
  isDateColumn,
  isEmphasisColumn,
  isIdentifierColumn,
  parseView,
  type ReportView,
  serializeView,
  stickyIdentityCount,
  summableColumns,
  VIEW_LAYOUTS,
  VIEW_PREFERENCE_PREFIX,
  viewQuery,
} from "@/lib/report-view";
import {
  fmtDate,
  fmtDateTime,
  fmtGridCell,
  fmtMonth,
  fmtReportCell,
  num,
  ticketWorkflowStatusLabel,
} from "@/lib/format";
import { useT } from "@/lib/i18n";
import {
  LEAVE_STATUS_LABEL,
  type LeaveStatusKey,
  formatLeaveStatusLabel,
  leaveStatusVariant,
  normalizeLeaveStatus,
  ticketWorkflowVariant,
} from "@/lib/leave-status";
import { appPath } from "@/lib/paths";
import {
  loadReportDensity,
  reportExportFilename,
  saveReportDensity,
  type ReportDensity,
} from "@/lib/report-toolbar";
import type { Employee, Lookup } from "@/lib/types";
import { cn } from "@/lib/utils";

const REPORTS = [
  {
    name: "airfare-amount-balance",
    label: "Airfare Amount Balance",
    icon: Wallet,
    blurb: "Opening days · accrued/balance days · funds as-of To date (excl. Bahraini by default)",
  },
  { name: "employee-master", label: "Employee Master", icon: Users, blurb: "All profiles with rates and status" },
  {
    // API key ticket-register (leave desk) — display name swapped with Travel Summary 2026-11-24
    name: "ticket-register",
    label: "Travel Summary",
    icon: Route,
    // cache-bust 2026-11-24h: rename Ticket Register ↔ Travel Summary (labels only)
    // cache-bust 2026-11-25o: Application status column/filter label
    blurb: "Application status · One-way purpose · filters-20261125-0940",
  },
  {
    // API key travel-summary — New Ticket (Pending): waiting-for-approval + upcoming travel only
    name: "travel-summary",
    label: "New Ticket (Pending)",
    icon: Plane,
    // cache-bust 2026-11-25o: Application status column/filter label
    blurb: "Application status · Sub section · Company",
  },
  {
    name: "ticket-cost",
    label: "Ticket Cost",
    icon: Receipt,
    // cache-bust 2026-11-26: Airfare balance deduction column; no Emp. Department
    blurb: "Loan · cash · Company pays · Airfare balance deduction · Net = deduction + company pays",
  },
  {
    name: "ticket-standard",
    label: "Ticket Standard",
    icon: FileText,
    // cache-bust 2026-11-23x: full Airfare Allocation desk on one row
    blurb: "Full Allocation detail — ticket, leave, entitlement, settlement, approval",
  },
  { name: "loan-outstanding", label: "Loan Outstanding", icon: Wallet, blurb: "Balances by employee and loan" },
  { name: "loan-statement", label: "Loan Statement", icon: ListOrdered, blurb: "Instalments and payments" },
  {
    name: "commission-details",
    label: "Commission Details",
    icon: BadgeDollarSign,
    blurb: "Monthly commission vouchers",
  },
  {
    name: "commission-summary",
    label: "Commission Summary",
    icon: BarChart3,
    blurb: "Per-employee commission totals by period",
  },
  {
    name: "commission-bi",
    label: "Commission BI",
    icon: LineChart,
    blurb: "Grouped commission analysis — employee / month / department / voucher / pay group",
  },
  { name: "liability-projections", label: "Liability Projections", icon: LineChart, blurb: "Future recovery schedule" },
  {
    name: "hcm-attendance",
    label: "HCM Attendance",
    icon: ListOrdered,
    blurb: "Date-wise IN/OUT, late, status, reporting manager and department",
  },
  {
    name: "tt-muster-roll",
    label: "Muster Roll",
    icon: CalendarDays,
    blurb: "Month grid, one mark per day: P, L, HD, MP, A, WO, H (Zoho / greytHR style)",
  },
  {
    name: "tt-latecomers",
    label: "Latecomers",
    icon: Clock,
    blurb: "Late arrivals beyond the late rule, with repeat latecomers",
  },
  {
    name: "tt-early-out",
    label: "Early Departures",
    icon: LogOut,
    blurb: "Left before shift end, with time lost (BioTime early leave)",
  },
  {
    name: "tt-absences",
    label: "Absenteeism",
    icon: UserX,
    blurb: "Absent on a working day (weekly off, holiday and no-shift days excluded)",
  },
  {
    name: "tt-missing-punch",
    label: "Missing Punch",
    icon: AlertTriangle,
    blurb: "IN or OUT punch missing; today's open shifts are not counted",
  },
  {
    name: "tt-overtime",
    label: "Overtime",
    icon: Timer,
    blurb: "Overtime per day, including work on weekly offs and holidays",
  },
  {
    name: "tt-employee-summary",
    label: "Employee TT Summary",
    icon: CalendarClock,
    blurb: "Per employee: attendance %, payable days, paid off, LOP and Bradford",
  },
  {
    name: "tt-department-summary",
    label: "Department TT Summary",
    icon: Building2,
    blurb: "Department attendance % and punctuality % for the selected period",
  },
  {
    name: "tt-absence-pattern",
    label: "Absence Pattern",
    icon: Activity,
    blurb: "Employees ranked by Bradford Factor (spells² × days) with review bands",
  },
  {
    name: "travel-spend-trend",
    label: "Travel Spend Trend",
    icon: TrendingUp,
    // cache-bust 2026-11-25p: insights catalog = Travel Spend Trend only
    blurb: "Monthly fares, average ticket, change and trend",
  },
  {
    name: "document-expiry",
    label: "Passport & Visa Expiry",
    icon: BadgeAlert,
    blurb: "Expired and expiring documents in 30 / 60 / 90-day bands",
  },
  {
    name: "headcount-summary",
    label: "Headcount & Diversity",
    icon: PieChart,
    blurb: "Headcount, gender, nationalities, tenure and age by department",
  },
  {
    name: "service-milestones",
    label: "Service Milestones",
    icon: Award,
    blurb: "Upcoming work anniversaries and probation reviews",
  },
] as const;

const REPORT_CATEGORIES = [
  {
    id: "travel-registers",
    label: "Travel registers",
    // Display order: Ticket Register (travel-summary key) then Travel Summary (ticket-register key).
    reports: ["ticket-standard", "travel-summary", "ticket-register", "ticket-cost"],
  },
  {
    id: "insights",
    label: "Analytics & insights",
    reports: ["travel-spend-trend"],
  },
  {
    id: "airfare",
    label: "Airfare & entitlement",
    reports: ["airfare-amount-balance"],
  },
  {
    id: "workforce",
    label: "Workforce & compliance",
    reports: ["employee-master", "headcount-summary", "document-expiry", "service-milestones"],
  },
  {
    id: "finance",
    label: "Loans, commission & finance",
    reports: [
      "loan-outstanding",
      "loan-statement",
      "liability-projections",
      "commission-details",
      "commission-summary",
      "commission-bi",
    ],
  },
  {
    id: "time",
    label: "Time tracking",
    reports: [
      "hcm-attendance",
      "tt-muster-roll",
      "tt-employee-summary",
      "tt-department-summary",
      "tt-latecomers",
      "tt-early-out",
      "tt-absences",
      "tt-missing-punch",
      "tt-overtime",
      "tt-absence-pattern",
    ],
  },
] as const;

const PAGE_SIZE = 100;

interface ReportInsight {
  label: string;
  value: string | number;
  tone?: "neutral" | "success" | "warning" | "danger";
}

const INSIGHT_TONE: Record<string, string> = {
  success: "border-[var(--color-success)]/40 text-[var(--color-success)]",
  warning: "border-[var(--color-warning)]/50 text-[var(--color-warning)]",
  danger: "border-[var(--color-destructive)]/50 text-[var(--color-destructive)]",
  neutral: "border-[var(--color-border)] text-[var(--color-foreground)]",
};

type ReportName = (typeof REPORTS)[number]["name"];

/** Allocation family on the Reports screen (Amount Balance uses From/To + Bahraini filters). */
function isAirfareAllocationReport(name: string | null | undefined): boolean {
  return name === "airfare-amount-balance";
}

const TT_REPORTS = new Set<ReportName>([
  "hcm-attendance",
  "tt-latecomers",
  "tt-absences",
  "tt-missing-punch",
  "tt-employee-summary",
  "tt-department-summary",
  "tt-muster-roll",
  "tt-early-out",
  "tt-overtime",
  "tt-absence-pattern",
]);

/** Date-wise time reports that also offer the calendar layout for weekly / monthly periods. */
const CALENDAR_REPORTS = new Set<ReportName>([
  "hcm-attendance",
  "tt-latecomers",
  "tt-early-out",
  "tt-absences",
  "tt-missing-punch",
  "tt-overtime",
]);

const COMMISSION_REPORTS = new Set<ReportName>(["commission-details", "commission-summary"]);

const COMMISSION_BI_REPORTS = new Set<ReportName>(["commission-bi"]);

const COMMISSION_BI_GROUPS = [
  { id: "employee", label: "By employee" },
  { id: "month", label: "By month" },
  { id: "department", label: "By department" },
  { id: "voucher", label: "By voucher" },
  { id: "pay_group", label: "By pay group" },
] as const;

const COMMISSION_STATUSES = ["draft", "approved", "paid"] as const;

const TICKET_STATUSES = ["draft", "submitted", "approved", "rejected", "paid"] as const;
/** New Ticket desk — Waiting for approval / payment + rejected. */
const PENDING_TICKET_STATUSES = ["submitted", "approved", "rejected"] as const;
const LOAN_STATUSES = ["active", "deferred", "settled"] as const;
const PROJECTION_STATUSES = ["active", "deferred"] as const;

/**
 * Declarative per-report filter schema — mirrors the BE REPORT_FILTERS map
 * (GET /v1/reports/filters/{name}). The standard filter card renders exactly
 * the controls listed for the selected report; commission / TT / payable
 * reports keep their dedicated cards below.
 */
type StdFilterKey =
  | "year"
  | "dateRange"
  | "employees"
  | "departments"
  | "empDepartments"
  | "subSections"
  | "companies"
  | "payGroups"
  | "statuses"
  | "leaveStatuses"
  | "oneWayPurposes"
  | "designation"
  | "empStatus"
  | "asOf"
  | "dateTo";

/** Dashboard Leave Tracker statuses — filter values are keys (on_leave, …). */
const LEAVE_STATUS_FILTER_OPTIONS = (
  Object.keys(LEAVE_STATUS_LABEL) as LeaveStatusKey[]
).map((key) => ({ value: key, label: LEAVE_STATUS_LABEL[key] }));

/** Travel Summary one-way purpose (Allocation FINAL / RETURN_LATER / RETURN_BACK). */
const ONE_WAY_PURPOSE_FILTER_OPTIONS = [
  { value: "cancellation", label: "Cancellation" },
  { value: "return_booked_later", label: "Return booked later" },
  { value: "return_back_ticket", label: "Return back ticket" },
] as const;

const STANDARD_REPORT_FILTERS: Partial<Record<ReportName, StdFilterKey[]>> = {
  "travel-spend-trend": ["employees", "departments", "empDepartments", "statuses", "dateRange"],
  "document-expiry": ["employees", "departments", "empDepartments", "payGroups", "dateTo"],
  "headcount-summary": ["departments", "empDepartments", "payGroups"],
  "service-milestones": ["departments", "empDepartments", "payGroups", "dateRange"],
  "employee-master": ["departments", "empDepartments", "payGroups", "designation", "empStatus"],
  // Travel reports: same filter bar as Travel Summary (no Emp. Department).
  // ticket-register keeps oneWayPurposes for the leave-end purpose column.
  "ticket-register": [
    "employees",
    "departments",
    "subSections",
    "companies",
    "statuses",
    "leaveStatuses",
    "oneWayPurposes",
    "dateRange",
  ],
  "travel-summary": [
    "employees",
    "departments",
    "subSections",
    "companies",
    "statuses",
    "leaveStatuses",
    "dateRange",
  ],
  "ticket-cost": [
    "employees",
    "departments",
    "subSections",
    "companies",
    "statuses",
    "leaveStatuses",
    "dateRange",
  ],
  "ticket-standard": [
    "employees",
    "departments",
    "subSections",
    "companies",
    "statuses",
    "leaveStatuses",
    "dateRange",
  ],
  "loan-outstanding": ["employees", "departments", "empDepartments", "payGroups", "statuses"],
  "loan-statement": ["employees", "departments", "empDepartments", "statuses"],
  "liability-projections": ["employees", "departments", "empDepartments", "statuses"],
};

const STANDARD_STATUS_OPTIONS: Partial<Record<ReportName, readonly string[]>> = {
  "ticket-register": TICKET_STATUSES,
  "travel-summary": PENDING_TICKET_STATUSES,
  "ticket-cost": TICKET_STATUSES,
  "ticket-standard": TICKET_STATUSES,
  "loan-outstanding": LOAN_STATUSES,
  "loan-statement": LOAN_STATUSES,
  "liability-projections": PROJECTION_STATUSES,
  "travel-spend-trend": TICKET_STATUSES,
};

/** API period ids the attendance endpoints understand; anything else is sent as dates. */
const ATTENDANCE_API_PERIODS = new Set([
  "today",
  "yesterday",
  "this_week",
  "last_week",
  "this_month",
  "last_month",
  "this_quarter",
  "last_quarter",
  "this_year",
  "ytd",
  "last_year",
]);

/** Opening range for a report the first time it is opened (before a remembered range exists). */
function defaultRange(name: ReportName | null): RangeState {
  // SAP statement style: Period From → To; To is the entitlement key date (as-of).
  if (isAirfareAllocationReport(name)) return rangeFromPreset("ytd");
  if (name && TT_REPORTS.has(name)) return rangeFromPreset("today");
  if (
    name === "ticket-register" ||
    name === "travel-summary" ||
    name === "ticket-cost" ||
    name === "ticket-standard"
  ) {
    return rangeFromPreset("this_year");
  }
  return rangeFromPreset("all");
}

const HCM_ATTENDANCE_COLUMNS = [
  "Name",
  "Code",
  "Date",
  "Day",
  "Shift",
  "TimeIn",
  "TimeOut",
  "Late",
  "Status",
  "Reporting To",
  "Department",
  "Nationality",
] as const;

function punchHhmm(value: unknown): string {
  const s = String(value ?? "");
  if (s.includes("T") && s.length >= 16) return s.slice(11, 16);
  return s;
}

/** Prefer live TT endpoints so Reports works even if /reports/.../hcm-attendance is not on the running API yet. */
async function fetchHcmAttendanceReport(
  companyId: string,
  dateFrom: string,
  dateTo: string
): Promise<ReportDetail> {
  const data = await api<{ count: number; rows: Array<Record<string, unknown>> }>(
    `/time-tracking/days?company_id=${encodeURIComponent(companyId)}&date_from=${dateFrom}&date_to=${dateTo}&limit=2000`
  );
  const rows = (data.rows ?? []).map((r) => [
    r.employee_name ?? "",
    r.employee_code ?? "",
    r.work_date ?? "",
    r.day ?? "",
    r.shift_code ?? "",
    punchHhmm(r.time_in || r.first_in),
    punchHhmm(r.time_out || r.last_out),
    r.late_clock ?? r.late_minutes ?? "",
    r.status ?? "",
    r.reporting_to ?? "",
    r.department ?? "",
    r.nationality ?? "",
  ]);
  return {
    report: "hcm-attendance",
    columns: [...HCM_ATTENDANCE_COLUMNS],
    rows,
    count: data.count ?? rows.length,
    generated_at: new Date().toISOString(),
  };
}

interface ReportKpi {
  total_amount?: number | string;
  entries?: number;
  employees?: number;
  vouchers?: number;
}

interface ReportDetail {
  report: string;
  columns: string[];
  rows: unknown[][];
  count: number;
  generated_at: string;
  filters?: Record<string, unknown>;
  kpi?: ReportKpi | null;
}

/** Expected MSSQL ticket-register columns from /reports/detail/ticket-register. */
const TICKET_REGISTER_LEAVE_COLUMNS = [
  "Sub Section",
  "Emp Code",
  "Employee Name",
  "Trip type",
  "Travel date",
  "Leave end date",
  "Duration",
  "Leave status",
  "Return / cancel on",
  "Application status",
] as const;

/** Plain numeric cell (int/decimal) — months "2026-06", codes, and voucher nos stay text. */
const NUMERIC_CELL = /^-?\d+(\.\d+)?$/;
/** Amount-share columns draw a meter; every other number stays plain. */
function shareCell(column: string, value: number): ReactNode {
  if (!/%$/.test(column.trim())) return num(value);
  const width = Math.max(0, Math.min(100, value));
  return (
    <span className="inline-flex items-center justify-end gap-2">
      <span className="h-1.5 w-10 overflow-hidden rounded-full bg-[var(--color-muted)]" aria-hidden="true">
        <span className="block h-full rounded-full bg-[var(--color-primary)]" style={{ width: `${width}%` }} />
      </span>
      {num(value)}%
    </span>
  );
}

function isNumericCell(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "string") return false;
  const s = value.trim();
  return s !== "" && NUMERIC_CELL.test(s);
}

/** SAP Go-mode filter bar footer: Apply + Clear + dirty hint. */
function FilterBarActions({
  dirty,
  onApply,
  onClear,
  applyTestId = "filter-apply",
  clearTestId = "filter-clear",
}: {
  dirty: boolean;
  onApply: () => void;
  onClear: () => void;
  applyTestId?: string;
  clearTestId?: string;
}) {
  return (
    <div className="basis-full flex flex-wrap items-center justify-end gap-2 border-t border-[var(--color-border)] pt-3 mt-1">
      {dirty ? (
        <p className="me-auto text-xs font-medium text-[var(--color-warning)]" data-testid="filter-dirty-hint">
          Filters changed — Apply to refresh the report
        </p>
      ) : (
        <p className="me-auto inline-flex items-center gap-1.5 text-xs text-[var(--color-muted-foreground)]">
          <Filter size={12} aria-hidden="true" /> Filter bar
        </p>
      )}
      <Button type="button" variant="outline" className="h-9" data-testid={clearTestId} onClick={onClear}>
        Clear
      </Button>
      <Button type="button" className="h-9" data-testid={applyTestId} onClick={onApply} disabled={!dirty}>
        Apply
      </Button>
    </div>
  );
}

interface ReportTemplate {
  id: string;
  code: string;
  title: string;
  dataset: string;
  definition: {
    title?: string;
    dataset?: string;
    bands?: { detail?: { columns?: string[] } };
    group_by?: string[];
    sort_by?: string | null;
  };
  is_system: boolean;
  version: number;
}

interface CrystalStatus {
  configured: boolean;
  note: string;
  bip_url?: string | null;
}

const REPORT_HREF = (name: ReportName) => `/reports/?report=${name}`;

/** Retired report tiles — bookmarks land on Airfare Amount Balance. */
const LEGACY_REPORT_REDIRECT: Record<string, ReportName> = {
  "opening-balances": "airfare-amount-balance",
  entitlements: "airfare-amount-balance",
  "entitlement-balance-summary": "airfare-amount-balance",
  "airfare-payable-summary": "airfare-amount-balance",
  "airfare-payable": "airfare-amount-balance",
  "airfare-payable-exceptions": "airfare-amount-balance",
  "excess-recovery": "airfare-amount-balance",
};

function ReportsPage() {
  const t = useT();
  const queryClient = useQueryClient();
  // Each report is its own screen (ERP convention): /reports/?report=<name>, deep-linkable and new-tab friendly.
  const searchParams = useSearchParams();
  const router = useRouter();
  const requestedReport = searchParams.get("report");
  useEffect(() => {
    if (!requestedReport) return;
    const dest = LEGACY_REPORT_REDIRECT[requestedReport];
    if (dest) router.replace(REPORT_HREF(dest));
  }, [requestedReport, router]);
  const selected: ReportName | null = REPORTS.some((r) => r.name === requestedReport)
    ? (requestedReport as ReportName)
    : null;
  const selectedMeta = selected ? REPORTS.find((r) => r.name === selected) : undefined;
  const selectedCategory = selected
    ? REPORT_CATEGORIES.find((c) => (c.reports as readonly string[]).includes(selected))
    : undefined;
  const [designerDataset, setDesignerDataset] = useState<ReportName>("employee-master");
  const [designerTitle, setDesignerTitle] = useState("Custom report");
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null);
  const todayIso = localIsoDate(new Date());
  // One period per report screen (payable statement, attendance, dated registers).
  const [range, setRange] = useState<RangeState>(() => defaultRange(selected));
  // The report waits until its remembered range is applied, so it loads once, not twice.
  const [rangeReadyFor, setRangeReadyFor] = useState<ReportName | null | undefined>(undefined);
  const appliedRange = useMemo(() => effectiveRange(range), [range]);
  const payableRange = useMemo(
    () => (isAirfareAllocationReport(selected) ? appliedRange : effectiveRange(rangeFromPreset("ytd"))),
    [selected, appliedRange],
  );
  const attDateFrom = appliedRange.from || appliedRange.to || todayIso;
  const attDateTo = appliedRange.to || attDateFrom;
  const [attDepartment, setAttDepartment] = useState("");
  const [attEmpDepartment, setAttEmpDepartment] = useState<string[]>([]);
  // Commission vouchers are keyed by month, so their reports read the period as whole months.
  const commMonthFrom = appliedRange.from.slice(0, 7);
  const commMonthTo = appliedRange.to.slice(0, 7);
  const commMonth = commMonthFrom && commMonthFrom === commMonthTo ? commMonthFrom : "";
  // Multi-select filter sets (BI semantics: OR within a dimension, AND across).
  const [commStatuses, setCommStatuses] = useState<string[]>([]);
  const [commEmployeeIds, setCommEmployeeIds] = useState<string[]>([]);
  const [commDepartments, setCommDepartments] = useState<string[]>([]);
  const [commEmpDepartments, setCommEmpDepartments] = useState<string[]>([]);
  const [commPayGroups, setCommPayGroups] = useState<string[]>([]);
  const [sort, setSort] = useState<{ col: number; dir: "asc" | "desc" } | null>(null);
  const [viewDraft, setViewDraft] = useState<ReportView | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [printing, setPrinting] = useState(false);
  /** Optional Allocation-card mirror when a payable statement row is clicked. */
  const [allocationHeroKey, setAllocationHeroKey] = useState<string | null>(null);
  const me = useAuth((s) => s.me);
  // Matches backend ReportRoles (admin / hr / finance / auditor + aliases).
  const canExportReports = hasRole(
    me,
    "admin",
    "system_admin",
    "hr",
    "hr_manager",
    "finance",
    "finance_manager",
    "auditor"
  );
  const [biGroupBy, setBiGroupBy] = useState<string>("employee");
  const [biEmployeeIds, setBiEmployeeIds] = useState<string[]>([]);
  const [biDepartments, setBiDepartments] = useState<string[]>([]);
  const [biEmpDepartments, setBiEmpDepartments] = useState<string[]>([]);
  const [biDesignation, setBiDesignation] = useState("");
  const [biStatuses, setBiStatuses] = useState<string[]>([]);
  const [biAmountMin, setBiAmountMin] = useState("");
  const [biAmountMax, setBiAmountMax] = useState("");
  const [biVoucherNo, setBiVoucherNo] = useState("");
  const [biCurrency, setBiCurrency] = useState("");
  const [biPayGroups, setBiPayGroups] = useState<string[]>([]);
  // Standard per-report filters (schema-driven card for non-commission reports).
  const [stdEmployeeIds, setStdEmployeeIds] = useState<string[]>([]);
  const [stdDepartments, setStdDepartments] = useState<string[]>([]);
  const [stdEmpDepartments, setStdEmpDepartments] = useState<string[]>([]);
  const [stdSubSections, setStdSubSections] = useState<string[]>([]);
  const [stdCompanyIds, setStdCompanyIds] = useState<string[]>([]);
  const [stdPayGroups, setStdPayGroups] = useState<string[]>([]);
  const [stdStatuses, setStdStatuses] = useState<string[]>([]);
  const [stdLeaveStatuses, setStdLeaveStatuses] = useState<string[]>([]);
  const [stdOneWayPurposes, setStdOneWayPurposes] = useState<string[]>([]);
  const [stdDateTo, setStdDateTo] = useState("");
  const [stdYear, setStdYear] = useState("");
  const [stdDesignation, setStdDesignation] = useState("");
  const [stdEmpStatus, setStdEmpStatus] = useState("");
  const [stdAsOf, setStdAsOf] = useState("");
  const [payableDepartments, setPayableDepartments] = useState<string[]>([]);
  const [payableEmpDepartments, setPayableEmpDepartments] = useState<string[]>([]);
  const [payableSubSections, setPayableSubSections] = useState<string[]>([]);
  // Amount-balance defaults to excluding Bahraini (dashboard KPI parity); URL ?bahraini= wins.
  const [payableBahrainiMode, setPayableBahrainiMode] = useState<"all" | "only" | "exclude">(() => {
    const fromUrl = searchParams.get("bahraini");
    if (fromUrl === "only" || fromUrl === "exclude" || fromUrl === "all") return fromUrl;
    if (requestedReport === "airfare-amount-balance") return "exclude";
    return "all";
  });
  useEffect(() => {
    const fromUrl = searchParams.get("bahraini");
    if (fromUrl === "only" || fromUrl === "exclude" || fromUrl === "all") {
      setPayableBahrainiMode(fromUrl);
      return;
    }
    if (selected === "airfare-amount-balance") setPayableBahrainiMode("exclude");
    else if (selected && selected.startsWith("airfare-")) setPayableBahrainiMode("all");
  }, [selected, searchParams]);
  /** SAP Go mode: query/export use applied suffix until Apply commits the draft bar. */
  const [appliedQuerySuffix, setAppliedQuerySuffix] = useState("");
  const [filtersCommittedFor, setFiltersCommittedFor] = useState<ReportName | null>(null);
  const [exporting, setExporting] = useState<"xlsx" | "pdf" | null>(null);
  const [density, setDensity] = useState<ReportDensity>(() => loadReportDensity());
  const [catalogQuery, setCatalogQuery] = useState("");
  const [rowQuery, setRowQuery] = useState("");
  const [page, setPage] = useState(0);

  const allocationPeriodFrom = payableRange.from || `${new Date().getFullYear()}-01-01`;
  const allocationAsOf = payableRange.to || todayIso;
  const draftPayableFilters = useMemo(() => {
    // SAP From/To: date_from = period start (echo); date_to = key date for Calculate entitlement.
    const params = new URLSearchParams();
    params.set("date_from", allocationPeriodFrom);
    params.set("date_to", allocationAsOf);
    if (payableDepartments.length) params.set("departments", payableDepartments.join(","));
    if (payableEmpDepartments.length) params.set("emp_departments", payableEmpDepartments.join(","));
    if (payableSubSections.length) params.set("sub_sections", payableSubSections.join(","));
    if (payableBahrainiMode === "only") params.set("bahraini", "only");
    if (payableBahrainiMode === "exclude") params.set("bahraini", "exclude");
    const q = params.toString();
    return q ? `?${q}` : "";
  }, [
    allocationPeriodFrom,
    allocationAsOf,
    payableDepartments,
    payableEmpDepartments,
    payableSubSections,
    payableBahrainiMode,
  ]);
  const setAllocationKeyDate = (iso: string) => {
    setRange(withTo({ ...range, preset: "custom" }, iso));
  };

  const draftAttendanceFilters = useMemo(() => {
    const params = new URLSearchParams();
    if (ATTENDANCE_API_PERIODS.has(range.preset)) params.set("period", range.preset);
    params.set("date_from", attDateFrom);
    params.set("date_to", attDateTo);
    if (attDepartment.trim()) params.set("department", attDepartment.trim());
    if (attEmpDepartment.length) params.set("emp_departments", attEmpDepartment.join(","));
    const q = params.toString();
    return q ? `?${q}` : "";
  }, [range.preset, attDateFrom, attDateTo, attDepartment, attEmpDepartment]);

  const draftCommissionFilters = useMemo(() => {
    const params = new URLSearchParams();
    if (commMonth) params.set("month", commMonth);
    if (commMonthFrom) params.set("month_from", commMonthFrom);
    if (commMonthTo) params.set("month_to", commMonthTo);
    if (commStatuses.length) params.set("statuses", commStatuses.join(","));
    if (commEmployeeIds.length) params.set("employee_ids", commEmployeeIds.join(","));
    if (commDepartments.length) params.set("departments", commDepartments.join(","));
    if (commEmpDepartments.length) params.set("emp_departments", commEmpDepartments.join(","));
    if (commPayGroups.length) params.set("pay_groups", commPayGroups.join(","));
    const q = params.toString();
    return q ? `?${q}` : "";
  }, [commMonth, commMonthFrom, commMonthTo, commStatuses, commEmployeeIds, commDepartments, commEmpDepartments, commPayGroups]);

  const draftCommissionBiFilters = useMemo(() => {
    const params = new URLSearchParams();
    params.set("group_by", biGroupBy);
    if (commMonth) params.set("month", commMonth);
    if (commMonthFrom) params.set("month_from", commMonthFrom);
    if (commMonthTo) params.set("month_to", commMonthTo);
    if (biEmployeeIds.length) params.set("employee_ids", biEmployeeIds.join(","));
    if (biDepartments.length) params.set("departments", biDepartments.join(","));
    if (biEmpDepartments.length) params.set("emp_departments", biEmpDepartments.join(","));
    if (biDesignation.trim()) params.set("designation", biDesignation.trim());
    if (biStatuses.length) params.set("statuses", biStatuses.join(","));
    if (biAmountMin && Number(biAmountMin) >= 0) params.set("amount_min", biAmountMin);
    if (biAmountMax && Number(biAmountMax) >= 0) params.set("amount_max", biAmountMax);
    if (biVoucherNo.trim()) params.set("voucher_no", biVoucherNo.trim());
    if (biCurrency.trim()) params.set("currency", biCurrency.trim().toUpperCase().slice(0, 3));
    if (biPayGroups.length) params.set("pay_groups", biPayGroups.join(","));
    const q = params.toString();
    return q ? `?${q}` : "";
  }, [
    biGroupBy,
    commMonth,
    commMonthFrom,
    commMonthTo,
    biEmployeeIds,
    biDepartments,
    biEmpDepartments,
    biDesignation,
    biStatuses,
    biAmountMin,
    biAmountMax,
    biVoucherNo,
    biCurrency,
    biPayGroups,
  ]);

  const needsPayableFilters =
    isAirfareAllocationReport(selected) || isAirfareAllocationReport(designerDataset);
  const needsAttendanceFilters = selected != null && TT_REPORTS.has(selected);
  const needsCommissionFilters = selected != null && COMMISSION_REPORTS.has(selected);
  const needsCommissionBiFilters = selected != null && COMMISSION_BI_REPORTS.has(selected);
  const stdSchema = selected != null ? (STANDARD_REPORT_FILTERS[selected] ?? []) : [];
  const needsStandardFilters = stdSchema.length > 0;

  // Standard filter query string — only the declared dimensions are serialized.
  const draftStandardFilters = useMemo(() => {
    const params = new URLSearchParams();
    if (stdSchema.includes("year") && stdYear) params.set("year", stdYear);
    if (stdSchema.includes("dateRange")) {
      if (appliedRange.from) params.set("date_from", appliedRange.from);
      if (appliedRange.to) params.set("date_to", appliedRange.to);
    }
    if (stdSchema.includes("employees") && stdEmployeeIds.length)
      params.set("employee_ids", stdEmployeeIds.join(","));
    if (stdSchema.includes("departments") && stdDepartments.length)
      params.set("departments", stdDepartments.join(","));
    if (stdSchema.includes("empDepartments") && stdEmpDepartments.length)
      params.set("emp_departments", stdEmpDepartments.join(","));
    if (stdSchema.includes("subSections") && stdSubSections.length)
      params.set("sub_sections", stdSubSections.join(","));
    if (stdSchema.includes("companies") && stdCompanyIds.length)
      params.set("company_ids", stdCompanyIds.join(","));
    if (stdSchema.includes("payGroups") && stdPayGroups.length)
      params.set("pay_groups", stdPayGroups.join(","));
    if (stdSchema.includes("statuses") && stdStatuses.length)
      params.set("statuses", stdStatuses.join(","));
    if (stdSchema.includes("leaveStatuses") && stdLeaveStatuses.length)
      params.set("leave_statuses", stdLeaveStatuses.join(","));
    if (stdSchema.includes("oneWayPurposes") && stdOneWayPurposes.length)
      params.set("one_way_purposes", stdOneWayPurposes.join(","));
    if (stdSchema.includes("designation") && stdDesignation.trim())
      params.set("designation", stdDesignation.trim());
    if (stdSchema.includes("empStatus") && stdEmpStatus) params.set("status", stdEmpStatus);
    if (stdSchema.includes("asOf") && stdAsOf) params.set("as_of_date", stdAsOf);
    if (stdSchema.includes("dateTo") && stdDateTo) params.set("date_to", stdDateTo);
    const q = params.toString();
    return q ? `?${q}` : "";
  }, [
    stdSchema,
    stdAsOf,
    stdYear,
    appliedRange,
    stdDateTo,
    stdEmployeeIds,
    stdDepartments,
    stdEmpDepartments,
    stdSubSections,
    stdCompanyIds,
    stdPayGroups,
    stdStatuses,
    stdLeaveStatuses,
    stdOneWayPurposes,
    stdDesignation,
    stdEmpStatus,
  ]);

  const stdStatusOptions = useMemo(() => {
    const domain = (selected != null && STANDARD_STATUS_OPTIONS[selected]) || [];
    const ticketDomain =
      selected === "ticket-register" ||
      selected === "travel-summary" ||
      selected === "ticket-cost" ||
      selected === "ticket-standard";
    return domain.map((s) => ({
      value: s,
      label: ticketDomain ? ticketWorkflowStatusLabel(s) : s[0].toUpperCase() + s.slice(1),
    }));
  }, [selected]);

  const companies = useQuery({
    queryKey: ["companies"],
    queryFn: () =>
      api<Array<{ id: string; code?: string; active?: boolean; name?: string }>>("/companies"),
  });
  const activeCompanyId = pickPrimaryCompanyId(companies.data);

  const biEmployees = useQuery({
    queryKey: ["employees", "all"],
    queryFn: () => api<Employee[]>("/employees?limit=500"),
    enabled:
      needsCommissionBiFilters ||
      needsCommissionFilters ||
      needsPayableFilters ||
      stdSchema.some(
        (k) =>
          k === "employees" ||
          k === "departments" ||
          k === "empDepartments" ||
          k === "subSections" ||
          k === "payGroups"
      ),
  });

  const employeeOptions = useMemo(
    () =>
      (biEmployees.data ?? []).map((e) => ({
        value: e.id,
        label: e.full_name || e.code,
        hint: e.code,
      })),
    [biEmployees.data]
  );

  const departmentOptions = useMemo(() => {
    const set = new Set<string>();
    for (const e of biEmployees.data ?? []) {
      if (e.department?.trim()) set.add(e.department.trim());
    }
    return [...set].sort((a, b) => a.localeCompare(b)).map((d) => ({ value: d, label: d }));
  }, [biEmployees.data]);

  const empDeptLookupsQuery = useQuery({
    queryKey: ["lookups", "emp_departments"],
    queryFn: () => api<Lookup[]>("/lookups/emp_departments"),
  });

  // Emp. Department = transfer-unit master (Lookups → emp_departments); a separate
  // dimension from the classic Department above — never merged. Options = active
  // lookup names first, then orphan values still on employees (same as Employees page).
  const empDepartmentOptions = useMemo(() => {
    const lookups = empDeptLookupsQuery.data ?? [];
    const names = lookups.filter((l) => l.active).map((l) => l.name);
    const known = new Set(lookups.flatMap((l) => [l.code, l.name]));
    const orphans = new Set<string>();
    for (const e of biEmployees.data ?? []) {
      const raw = e.emp_department?.trim();
      if (!raw) continue;
      const display = lookups.find((l) => l.code === raw)?.name ?? raw;
      if (display && !known.has(display)) orphans.add(display);
    }
    return [...new Set([...names, ...orphans])]
      .sort((a, b) => a.localeCompare(b))
      .map((d) => ({ value: d, label: d }));
  }, [biEmployees.data, empDeptLookupsQuery.data]);

  const subSectionOptions = useMemo(() => {
    const set = new Set<string>();
    for (const e of biEmployees.data ?? []) {
      if (e.sub_section?.trim()) set.add(e.sub_section.trim());
    }
    return [...set].sort((a, b) => a.localeCompare(b)).map((s) => ({ value: s, label: s }));
  }, [biEmployees.data]);

  const payGroupValues = useMemo(() => {
    const set = new Set<string>();
    for (const e of biEmployees.data ?? []) {
      if (e.pay_group?.trim()) set.add(e.pay_group.trim());
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [biEmployees.data]);

  const payGroupOptions = useMemo(
    () => payGroupValues.map((pg) => ({ value: pg, label: pg })),
    [payGroupValues]
  );

  const companyOptions = useMemo(
    () =>
      (companies.data ?? []).map((c) => ({
        value: c.id,
        label: c.name || c.code || c.id,
        hint: c.code,
      })),
    [companies.data]
  );

  const statusOptions = useMemo(
    () => COMMISSION_STATUSES.map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) })),
    []
  );

  const draftQuerySuffix = useMemo(() => {
    if (!selected) return "";
    if (isAirfareAllocationReport(selected)) return draftPayableFilters;
    if (COMMISSION_BI_REPORTS.has(selected)) return draftCommissionBiFilters;
    if (COMMISSION_REPORTS.has(selected)) return draftCommissionFilters;
    if (TT_REPORTS.has(selected)) {
      const params = new URLSearchParams(draftAttendanceFilters.replace(/^\?/, ""));
      if (activeCompanyId) params.set("company_id", activeCompanyId);
      const q = params.toString();
      return q ? `?${q}` : "";
    }
    if (STANDARD_REPORT_FILTERS[selected]?.length) return draftStandardFilters;
    return "";
  }, [
    selected,
    draftPayableFilters,
    draftCommissionBiFilters,
    draftCommissionFilters,
    draftAttendanceFilters,
    activeCompanyId,
    draftStandardFilters,
  ]);

  const filtersDirty =
    Boolean(selected) && draftQuerySuffix !== appliedQuerySuffix;

  const applyFilters = useCallback(
    (overrideSuffix?: string) => {
      if (!selected) return;
      setAppliedQuerySuffix(overrideSuffix ?? draftQuerySuffix);
      setFiltersCommittedFor(selected);
      setPage(0);
    },
    [selected, draftQuerySuffix]
  );

  const clearPayableFilters = useCallback(() => {
    setPayableDepartments([]);
    setPayableEmpDepartments([]);
    setPayableSubSections([]);
    const bahrainiDefault = selected === "airfare-amount-balance" ? "exclude" : "all";
    setPayableBahrainiMode(bahrainiDefault);
    const preset = rangeFromPreset("ytd");
    setRange(preset);
    const next = effectiveRange(preset);
    const params = new URLSearchParams();
    params.set("date_from", next.from);
    params.set("date_to", next.to);
    if (bahrainiDefault === "exclude") params.set("bahraini", "exclude");
    applyFilters(`?${params.toString()}`);
  }, [applyFilters, selected]);

  // First open / report switch: commit draft once (SAP initial load). Later tweaks need Apply.
  // TT: wait for company_id; if already committed, only patch company_id (never wipe dirty draft).
  const ttCompanyGate = selected && TT_REPORTS.has(selected) ? activeCompanyId : "";
  useEffect(() => {
    if (!selected || rangeReadyFor !== selected) return;
    if (TT_REPORTS.has(selected) && !activeCompanyId) return;
    if (filtersCommittedFor === selected) {
      if (TT_REPORTS.has(selected) && activeCompanyId) {
        setAppliedQuerySuffix((prev) => {
          const params = new URLSearchParams(prev.replace(/^\?/, ""));
          if (params.get("company_id") === activeCompanyId) return prev;
          params.set("company_id", activeCompanyId);
          const q = params.toString();
          return q ? `?${q}` : prev;
        });
      }
      return;
    }
    setAppliedQuerySuffix(draftQuerySuffix);
    setFiltersCommittedFor(selected);
    // draftQuerySuffix intentionally omitted — live mode would refetch on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, rangeReadyFor, ttCompanyGate, filtersCommittedFor]);

  const selectedQuerySuffix = appliedQuerySuffix;

  const detail = useQuery({
    queryKey: ["report-detail", selected, appliedQuerySuffix, activeCompanyId, filtersCommittedFor],
    queryFn: async () => {
      if (!selected) throw new Error("No report selected");
      if (TT_REPORTS.has(selected)) {
        if (!activeCompanyId) {
          throw new Error("Select or activate a company before loading Time Tracking reports.");
        }
        try {
          return await api<ReportDetail>(`/reports/detail/${selected}${selectedQuerySuffix}`);
        } catch (err) {
          // Fallback for older APIs that only have TT days for date-wise register
          if (selected === "hcm-attendance") {
            const params = new URLSearchParams(selectedQuerySuffix.replace(/^\?/, ""));
            return fetchHcmAttendanceReport(
              activeCompanyId,
              params.get("date_from") || attDateFrom,
              params.get("date_to") || attDateTo
            );
          }
          throw err;
        }
      }
      // Travel registers (ticket-standard, ticket-register, travel-summary, ticket-cost)
      // all read live MSSQL via /reports/detail — no client-side ticket mash-up.
      return api<ReportDetail>(`/reports/detail/${selected}${selectedQuerySuffix}`);
    },
    enabled:
      Boolean(selected) &&
      filtersCommittedFor === selected &&
      (selected == null || !TT_REPORTS.has(selected) || Boolean(activeCompanyId)) &&
      rangeReadyFor === selected,
  });

  // Numeric columns right-align (financial-report convention); detected from data.
  const numericColumns = useMemo(() => {
    const data = detail.data;
    if (!data) return new Set<number>();
    const stats = data.columns.map(() => ({ seen: 0, numeric: 0 }));
    for (const row of data.rows.slice(0, 50)) {
      row.forEach((cell, j) => {
        if (j >= stats.length || cell === null || cell === undefined || cell === "") return;
        stats[j].seen += 1;
        // "0010" is an employee code, not the number 10.
        if (isNumericCell(cell) && !(typeof cell === "string" && /^0\d/.test(cell.trim()))) stats[j].numeric += 1;
      });
    }
    return new Set(
      stats.flatMap((s, j) =>
        s.seen > 0 && s.numeric === s.seen && !isIdentifierColumn(data.columns[j] ?? "") ? [j] : []
      )
    );
  }, [detail.data]);

  // Client-side column sorting (Odoo pivot convention: click a header to sort asc/desc).
  // Switching reports also resets the standard filter set (per-report schema).
  useEffect(() => {
    setSort(null);
    setStdEmployeeIds([]);
    setStdDepartments([]);
    setStdSubSections([]);
    setStdCompanyIds([]);
    setStdPayGroups([]);
    setStdStatuses([]);
    setStdLeaveStatuses([]);
    setStdOneWayPurposes([]);
    setStdDateTo("");
    setStdYear("");
    setStdDesignation("");
    setStdEmpStatus("");
    setStdAsOf("");
    setRowQuery("");
    setPage(0);
    setViewDraft(null);
    setCollapsed(new Set());
  }, [selected]);
  useEffect(() => {
    const previous = document.title;
    document.title = selectedMeta ? `${selectedMeta.label} · Reports · ATLAS` : "Reports · ATLAS";
    return () => {
      document.title = previous;
    };
  }, [selectedMeta]);
  const toggleSort = (col: number) => {
    setSort((prev) =>
      prev?.col === col ? (prev.dir === "asc" ? { col, dir: "desc" } : null) : { col, dir: "asc" }
    );
  };
  const sortedRows = useMemo(() => {
    const rows = detail.data?.rows ?? [];
    if (!sort) return rows;
    const { col, dir } = sort;
    const factor = dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = a[col];
      const bv = b[col];
      const cmp =
        isNumericCell(av) && isNumericCell(bv)
          ? Number(av) - Number(bv)
          : String(av ?? "").localeCompare(String(bv ?? ""), undefined, {
              numeric: true,
              sensitivity: "base",
            });
      return cmp * factor;
    });
  }, [detail.data, sort]);

  const insights = (detail.data as { insights?: ReportInsight[] } | undefined)?.insights ?? [];

  const catalog = useMemo(() => {
    const needle = catalogQuery.trim().toLowerCase();
    return REPORT_CATEGORIES.map((category) => ({
      ...category,
      items: REPORTS.filter(
        (r) =>
          (category.reports as readonly string[]).includes(r.name) &&
          (!needle || `${r.label} ${r.blurb}`.toLowerCase().includes(needle))
      ),
    })).filter((category) => category.items.length > 0);
  }, [catalogQuery]);

  // KPI header band (SAP ALP / Power BI): served by the API for commission reports.
  const commissionKpi =
    selected != null && (COMMISSION_REPORTS.has(selected) || COMMISSION_BI_REPORTS.has(selected))
      ? (detail.data?.kpi ?? null)
      : null;

  // Focus-style report views: the user's saved layout per report lives in MSSQL preferences.
  const prefs = useQuery({
    queryKey: ["preferences", "effective", "theme"],
    queryFn: () => api<Record<string, unknown>>("/preferences/effective"),
    staleTime: 5 * 60_000,
  });
  const savedRaw = selected ? prefs.data?.[`${VIEW_PREFERENCE_PREFIX}${selected}`] : undefined;
  const savedView = useMemo(() => parseView(savedRaw), [savedRaw]);
  // Weekly / monthly time reports open as a calendar (Zoho / greytHR / Horilla convention).
  const calendarData = (detail.data as { calendar?: AttendanceCalendarData | null } | undefined)?.calendar ?? null;
  const baseView: ReportView =
    calendarData && (!savedView || savedView.layout === "standard")
      ? { ...(savedView ?? DEFAULT_VIEW), layout: "calendar" }
      : (savedView ?? DEFAULT_VIEW);
  const view = viewDraft ?? baseView;
  // Share and Ranked rebuild the columns, so a header index is not a raw-row index.
  const filteredRows = useMemo(() => {
    const sortFits =
      view.layout !== "summary" && view.layout !== "share" && view.layout !== "ranked" && view.layout !== "calendar";
    const base = sortFits ? sortedRows : (detail.data?.rows ?? []);
    const needle = rowQuery.trim().toLowerCase();
    if (!needle) return base;
    return base.filter((row) => row.some((cell) => String(cell ?? "").toLowerCase().includes(needle)));
  }, [view.layout, sortedRows, detail.data, rowQuery]);
  const viewDirty = viewDraft != null && serializeView(viewDraft) !== serializeView(baseView);
  const saveView = useMutation({
    mutationFn: (next: ReportView) =>
      api("/preferences/me", {
        method: "PUT",
        body: { preference_key: `${VIEW_PREFERENCE_PREFIX}${selected}`, value: serializeView(next) },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["preferences"] });
      setViewDraft(null);
      toast.success("Layout saved", "This report opens with this layout next time.");
    },
    onError: (err) => toast.error("Could not save layout", errorMessage(err)),
  });

  // Last-used period per report, remembered in MSSQL (report.range.<name>). Relative
  // presets are stored by name, so "This month" re-resolves to the current month.
  const savedRangeRaw = selected ? prefs.data?.[`${RANGE_PREFERENCE_PREFIX}${selected}`] : undefined;
  const prefsSettled = prefs.isFetched || prefs.isError;
  useEffect(() => {
    if (!prefsSettled || rangeReadyFor === selected) return;
    setRange(parseRange(savedRangeRaw) ?? defaultRange(selected));
    setRangeReadyFor(selected);
  }, [prefsSettled, selected, savedRangeRaw, rangeReadyFor]);
  useEffect(() => {
    if (!selected || rangeReadyFor !== selected) return;
    const key = `${RANGE_PREFERENCE_PREFIX}${selected}`;
    const value = serializeRange(range);
    const stored = typeof savedRangeRaw === "string" ? savedRangeRaw : serializeRange(defaultRange(selected));
    if (value === stored) return;
    const timer = window.setTimeout(() => {
      api("/preferences/me", { method: "PUT", body: { preference_key: key, value } })
        .then(() =>
          queryClient.setQueryData<Record<string, unknown>>(["preferences", "effective", "theme"], (old) => ({
            ...(old ?? {}),
            [key]: value,
          })),
        )
        .catch(() => undefined);
    }, 800);
    return () => window.clearTimeout(timer);
  }, [selected, rangeReadyFor, range, savedRangeRaw, queryClient]);

  const reportColumns = useMemo(() => detail.data?.columns ?? [], [detail.data]);
  const sumColumns = useMemo(() => summableColumns(reportColumns, numericColumns), [reportColumns, numericColumns]);
  const groupColumns = useMemo(
    () => groupableColumns(reportColumns, detail.data?.rows ?? [], numericColumns),
    [reportColumns, detail.data, numericColumns]
  );
  const isAllocationReport = Boolean(isAirfareAllocationReport(selected));
  useEffect(() => {
    setAllocationHeroKey(null);
  }, [selected, detail.data?.generated_at]);
  const activeView = useMemo<ReportView>(() => {
    const group = groupColumns.includes(view.group) ? view.group : (groupColumns[0] ?? -1);
    const needsGroup = view.layout === "grouped" || view.layout === "summary" || view.layout === "share";
    if (view.layout === "calendar") {
      return { ...view, group: Math.max(group, 0), layout: calendarData ? "calendar" : "standard" };
    }
    if (view.layout === "ranked") {
      return { ...view, group: Math.max(group, 0), layout: sumColumns.length ? "ranked" : "standard" };
    }
    return { ...view, group: Math.max(group, 0), layout: needsGroup && group < 0 ? "standard" : view.layout };
  }, [view, groupColumns, calendarData, sumColumns]);
  const showCalendar = activeView.layout === "calendar" && calendarData != null;
  const tableView = useMemo<ReportView>(
    () => (activeView.layout === "calendar" ? { ...activeView, layout: "standard" } : activeView),
    [activeView]
  );
  // headcount-summary already closes with an "All departments" row.
  const viewModel = useMemo(
    () => buildView(reportColumns, filteredRows, tableView, sumColumns, selected !== "headcount-summary"),
    [reportColumns, filteredRows, tableView, sumColumns, selected]
  );
  const viewColumns = viewModel.columns;
  const viewNumeric = viewModel.numeric ?? numericColumns;
  const stickyCols = stickyIdentityCount(viewColumns) as 0 | 1 | 2;
  const useZebra = viewColumns.length >= 6;
  const totalsRow = viewModel.rows.find((r) => r.kind === "total")?.cells ?? null;
  const bodyRows = viewModel.rows.filter((r) => r.kind !== "total");
  const paged = activeView.layout === "standard" || activeView.layout === "ranked";
  const grouping = activeView.layout === "grouped" || activeView.layout === "summary" || activeView.layout === "share";
  const canSortHeader = activeView.layout === "standard" || activeView.layout === "grouped";
  const shownCalendar = calendarData ? visibleCalendarRows(calendarData.rows, rowQuery) : [];
  const viewPageCount = Math.max(1, Math.ceil(bodyRows.length / PAGE_SIZE));
  const viewPage = Math.min(page, viewPageCount - 1);
  const visibleRows =
    paged && !printing ? bodyRows.slice(viewPage * PAGE_SIZE, (viewPage + 1) * PAGE_SIZE) : bodyRows;
  const allocationHero = useMemo(() => {
    if (!isAllocationReport || !allocationHeroKey) return null;
    const row = bodyRows.find((r) => r.key === allocationHeroKey && r.kind === "data");
    if (!row) return null;
    const cell = (label: string) => {
      const i = viewColumns.indexOf(label);
      return i >= 0 ? row.cells[i] : undefined;
    };
    const entitlement =
      cell("Total Available Funds") ?? cell("Entitlement") ?? cell("Closing Balance");
    if (entitlement == null || entitlement === "") return null;
    return {
      name: String(cell("Employee Name") ?? cell("Employee Code") ?? ""),
      entitlement,
      heroLabel: cell("Total Available Funds") != null ? "Available funds" : "Airfare entitlement",
      perDay: cell("Per Day Rate"),
      balanceDays: cell("Balance Days"),
      maxPayout: cell("Max Payout"),
      openingDays: cell("Opening Days"),
      openingAmount: cell("Opening Amount"),
      accruedDays: cell("Accrued Days"),
      accruedAmount: cell("Accrued Amount"),
      paidDays: cell("Already Paid Days"),
      paidAmount: cell("Already Paid Amount"),
      closing: cell("Closing Balance"),
      availableFunds: cell("Total Available Funds"),
      status: cell("Status"),
    };
  }, [isAllocationReport, allocationHeroKey, bodyRows, viewColumns]);
  const startCollapsed = filteredRows.length > 300;
  const isCollapsed = (g: string) => !printing && startCollapsed !== collapsed.has(g);
  const toggleGroup = (g: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });
  const updateView = (patch: Partial<ReportView>) => {
    setViewDraft({ ...activeView, ...patch });
    setCollapsed(new Set());
    if (patch.layout) setSort(null);
    setPage(0);
  };
  const exportSuffix = `${selectedQuerySuffix}${selectedQuerySuffix ? "&" : "?"}${viewQuery(activeView)}`;
  const activeCompanyName = companies.data?.find((c) => c.id === activeCompanyId)?.name ?? "";
  const exportStamp = isAirfareAllocationReport(selected)
    ? allocationAsOf
    : appliedRange.to || appliedRange.from || todayIso;
  // Print renders every row of the current layout (no paging, groups expanded), then restores.
  useEffect(() => {
    if (!printing) return;
    const timer = window.setTimeout(() => {
      document.body.classList.add("print-report");
      window.print();
      document.body.classList.remove("print-report");
      setPrinting(false);
    }, 50);
    return () => window.clearTimeout(timer);
  }, [printing]);
  const printReport = () => setPrinting(true);

  const runExport = useCallback(
    async (format: "xlsx" | "pdf") => {
      if (!selected) return;
      if (!canExportReports) {
        toast.error("Export not allowed", "Your role cannot export report Excel/PDF.");
        return;
      }
      if (filtersDirty) {
        toast.error("Apply filters first", "Click Apply on the filter bar so Excel/PDF match the grid.");
        return;
      }
      const label = REPORTS.find((r) => r.name === selected)?.label ?? selected;
      const filename = reportExportFilename(label, format, exportStamp);
      setExporting(format);
      toast.info(format === "xlsx" ? "Preparing Excel…" : "Preparing PDF…", label);
      try {
        if (TT_REPORTS.has(selected)) {
          if (!activeCompanyId) {
            toast.error("Company required", "Activate a company first.");
            return;
          }
          try {
            await download(`/reports/export/${selected}.${format}${exportSuffix}`, filename);
          } catch (err) {
            if (selected === "hcm-attendance") {
              const applied = new URLSearchParams(appliedQuerySuffix.replace(/^\?/, ""));
              const from = applied.get("date_from") || attDateFrom;
              const to = applied.get("date_to") || attDateTo;
              const period = applied.get("period");
              const department = applied.get("department");
              const qs = new URLSearchParams({
                company_id: activeCompanyId,
                date_from: from,
                date_to: to,
              });
              if (period) qs.set("period", period);
              if (department) qs.set("department", department);
              await download(`/time-tracking/report.${format}?${qs.toString()}`, filename);
            } else {
              throw err;
            }
          }
        } else {
          await download(`/reports/export/${selected}.${format}${exportSuffix}`, filename);
        }
        toast.success(format === "xlsx" ? "Excel ready" : "PDF ready", label);
      } catch (err) {
        toast.error(format === "xlsx" ? "Excel export failed" : "PDF export failed", errorMessage(err));
      } finally {
        setExporting(null);
      }
    },
    [
      selected,
      canExportReports,
      filtersDirty,
      exportStamp,
      activeCompanyId,
      exportSuffix,
      appliedQuerySuffix,
      attDateFrom,
      attDateTo,
    ]
  );

  const toggleDensity = () => {
    setDensity((prev) => {
      const next = prev === "compact" ? "comfortable" : "compact";
      saveReportDensity(next);
      return next;
    });
  };

  // Echo draft filters as chips (Power BI slicer style); dismiss clears + Apply.
  const filterChips = useMemo(() => {
    if (!selected) return [] as { key: string; label: string; onClear?: () => void }[];
    const chips: { key: string; label: string; onClear?: () => void }[] = [];
    const periodLabel = RANGE_PRESETS.find((p) => p.id === range.preset)?.label ?? "Custom range";
    const periodChip = () => {
      if (!appliedRange.from && !appliedRange.to) return;
      const span = `${appliedRange.from ? fmtDate(appliedRange.from) : "…"} → ${appliedRange.to ? fmtDate(appliedRange.to) : "…"}`;
      chips.push({ key: "period", label: range.preset === "custom" ? span : `${periodLabel}: ${span}` });
    };
    if (isAirfareAllocationReport(selected)) {
      const payableQs = (
        depts: string[],
        empDepts: string[],
        subs: string[],
        mode: typeof payableBahrainiMode
      ) => {
        const params = new URLSearchParams();
        params.set("date_from", allocationPeriodFrom);
        params.set("date_to", allocationAsOf);
        if (depts.length) params.set("departments", depts.join(","));
        if (empDepts.length) params.set("emp_departments", empDepts.join(","));
        if (subs.length) params.set("sub_sections", subs.join(","));
        if (mode === "only") params.set("bahraini", "only");
        if (mode === "exclude") params.set("bahraini", "exclude");
        return `?${params.toString()}`;
      };
      chips.push({
        key: "period",
        label: `${fmtDate(allocationPeriodFrom)} → ${fmtDate(allocationAsOf)} (key date)`,
      });
      chips.push({ key: "parity", label: "Matches Allocation Calculate entitlement" });
      if (payableDepartments.length)
        chips.push({
          key: "pdep",
          label: `Dept: ${payableDepartments.join(", ")}`,
          onClear: () => {
            setPayableDepartments([]);
            applyFilters(payableQs([], payableEmpDepartments, payableSubSections, payableBahrainiMode));
          },
        });
      if (payableEmpDepartments.length)
        chips.push({
          key: "pedept",
          label: `Emp. dept: ${payableEmpDepartments.join(", ")}`,
          onClear: () => {
            setPayableEmpDepartments([]);
            applyFilters(payableQs(payableDepartments, [], payableSubSections, payableBahrainiMode));
          },
        });
      if (payableSubSections.length)
        chips.push({
          key: "psub",
          label: `Sub section: ${payableSubSections.join(", ")}`,
          onClear: () => {
            setPayableSubSections([]);
            applyFilters(payableQs(payableDepartments, payableEmpDepartments, [], payableBahrainiMode));
          },
        });
      if (payableBahrainiMode === "only" || payableBahrainiMode === "exclude")
        chips.push({
          key: "pbh",
          label: payableBahrainiMode === "only" ? "Bahraini only" : "Excluding Bahraini",
          onClear: () => {
            setPayableBahrainiMode("all");
            applyFilters(payableQs(payableDepartments, payableEmpDepartments, payableSubSections, "all"));
          },
        });
    }
    if (COMMISSION_REPORTS.has(selected) || COMMISSION_BI_REPORTS.has(selected)) {
      if (commMonth) {
        chips.push({ key: "mq", label: `Month: ${fmtMonth(commMonth)}` });
      } else if (commMonthFrom || commMonthTo) {
        const span = `${commMonthFrom ? fmtMonth(commMonthFrom) : "…"} → ${commMonthTo ? fmtMonth(commMonthTo) : "…"}`;
        chips.push({ key: "mr", label: range.preset === "custom" ? span : `${periodLabel}: ${span}` });
      }
    }
    // Multi-select echo: one chip per dimension listing every chosen value.
    const employeeChipLabel = (ids: string[]) => {
      const codes = ids.map((id) => biEmployees.data?.find((e) => e.id === id)?.code ?? id);
      return `Employees: ${codes.join(", ")}`;
    };
    // Standard schema-driven reports: echo every active dimension.
    if (STANDARD_REPORT_FILTERS[selected]?.length) {
      if (stdYear) chips.push({ key: "syr", label: `Year ${stdYear}` });
      if (STANDARD_REPORT_FILTERS[selected]?.includes("dateRange")) periodChip();
      if (STANDARD_REPORT_FILTERS[selected]?.includes("dateTo") && stdDateTo)
        chips.push({ key: "sdt", label: `Expiring by ${fmtDate(stdDateTo)}` });
      if (stdEmployeeIds.length) chips.push({ key: "semp", label: employeeChipLabel(stdEmployeeIds) });
      if (stdDepartments.length) chips.push({ key: "sdep", label: `Dept: ${stdDepartments.join(", ")}` });
      if (stdEmpDepartments.length)
        chips.push({ key: "sedept", label: `Emp. dept: ${stdEmpDepartments.join(", ")}` });
      if (stdSubSections.length)
        chips.push({ key: "ssub", label: `Sub section: ${stdSubSections.join(", ")}` });
      if (stdCompanyIds.length) {
        const labels = stdCompanyIds.map(
          (id) => companies.data?.find((c) => c.id === id)?.name || id
        );
        chips.push({ key: "sco", label: `Company: ${labels.join(", ")}` });
      }
      if (stdPayGroups.length) chips.push({ key: "spg", label: `Pay group: ${stdPayGroups.join(", ")}` });
      if (stdStatuses.length) {
        const statusChipLabel =
          selected === "ticket-register" || selected === "travel-summary"
            ? "Application status"
            : "Status";
        chips.push({
          key: "sst",
          label: `${statusChipLabel}: ${stdStatuses
            .map((s) =>
              selected === "ticket-register" || selected === "travel-summary"
                ? ticketWorkflowStatusLabel(s)
                : s
            )
            .join(", ")}`,
        });
      }
      if (stdLeaveStatuses.length) {
        const labels = stdLeaveStatuses.map(
          (k) => LEAVE_STATUS_LABEL[k as LeaveStatusKey] ?? formatLeaveStatusLabel(k)
        );
        chips.push({ key: "sls", label: `Leave status: ${labels.join(", ")}` });
      }
      if (stdOneWayPurposes.length) {
        const labels = stdOneWayPurposes.map(
          (k) =>
            ONE_WAY_PURPOSE_FILTER_OPTIONS.find((o) => o.value === k)?.label ?? k
        );
        chips.push({ key: "sow", label: `One-way purpose: ${labels.join(", ")}` });
      }
      if (stdDesignation.trim()) chips.push({ key: "sdes", label: `Designation ${stdDesignation.trim()}` });
      if (stdEmpStatus) chips.push({ key: "ses", label: `Status: ${stdEmpStatus}` });
      if (stdAsOf) chips.push({ key: "sao", label: `As of ${fmtDate(stdAsOf)}` });
    }
    if (COMMISSION_REPORTS.has(selected)) {
      if (commStatuses.length) chips.push({ key: "st", label: `Status: ${commStatuses.join(", ")}` });
      if (commEmployeeIds.length) chips.push({ key: "emp", label: employeeChipLabel(commEmployeeIds) });
      if (commDepartments.length) chips.push({ key: "dep", label: `Dept: ${commDepartments.join(", ")}` });
      if (commEmpDepartments.length)
        chips.push({ key: "edept", label: `Emp. dept: ${commEmpDepartments.join(", ")}` });
      if (commPayGroups.length) chips.push({ key: "pg", label: `Pay group: ${commPayGroups.join(", ")}` });
    }
    if (COMMISSION_BI_REPORTS.has(selected)) {
      const groupLabel = COMMISSION_BI_GROUPS.find((g) => g.id === biGroupBy)?.label ?? biGroupBy;
      chips.push({ key: "gb", label: `Group: ${groupLabel}` });
      if (biEmployeeIds.length) chips.push({ key: "emp", label: employeeChipLabel(biEmployeeIds) });
      if (biDepartments.length) chips.push({ key: "dep", label: `Dept: ${biDepartments.join(", ")}` });
      if (biEmpDepartments.length)
        chips.push({ key: "edept", label: `Emp. dept: ${biEmpDepartments.join(", ")}` });
      if (biDesignation.trim()) chips.push({ key: "des", label: `Designation ${biDesignation.trim()}` });
      if (biPayGroups.length) chips.push({ key: "pg", label: `Pay group: ${biPayGroups.join(", ")}` });
      if (biStatuses.length) chips.push({ key: "bst", label: `Status: ${biStatuses.join(", ")}` });
      if (biAmountMin) chips.push({ key: "amin", label: `Min ${biAmountMin}` });
      if (biAmountMax) chips.push({ key: "amax", label: `Max ${biAmountMax}` });
      if (biVoucherNo.trim()) chips.push({ key: "vn", label: `Voucher ${biVoucherNo.trim()}` });
      if (biCurrency.trim()) chips.push({ key: "cur", label: biCurrency.trim().toUpperCase() });
    }
    if (TT_REPORTS.has(selected)) {
      periodChip();
      if (attDepartment.trim()) chips.push({ key: "adep", label: `Dept ${attDepartment.trim()}` });
      if (attEmpDepartment.length)
        chips.push({ key: "aedept", label: `Emp. dept ${attEmpDepartment.join(", ")}` });
    }
    return chips;
  }, [
    selected,
    range.preset,
    appliedRange,
    commMonth,
    commMonthFrom,
    commMonthTo,
    commStatuses,
    commEmployeeIds,
    commDepartments,
    commEmpDepartments,
    commPayGroups,
    biGroupBy,
    biEmployeeIds,
    biEmployees.data,
    biDepartments,
    biEmpDepartments,
    biDesignation,
    biPayGroups,
    biStatuses,
    biAmountMin,
    biAmountMax,
    biVoucherNo,
    biCurrency,
    attDepartment,
    attEmpDepartment,
    payableDepartments,
    payableEmpDepartments,
    payableSubSections,
    payableBahrainiMode,
    allocationPeriodFrom,
    allocationAsOf,
    applyFilters,
    stdYear,
    stdDateTo,
    stdEmployeeIds,
    stdDepartments,
    stdEmpDepartments,
    stdSubSections,
    stdCompanyIds,
    companies.data,
    stdPayGroups,
    stdStatuses,
    stdLeaveStatuses,
    stdOneWayPurposes,
    stdDesignation,
    stdEmpStatus,
    stdAsOf,
  ]);

  const templates = useQuery({
    queryKey: ["report-templates"],
    queryFn: () => api<ReportTemplate[]>("/report-templates"),
  });

  const crystal = useQuery({
    queryKey: ["crystal-status"],
    queryFn: () => api<CrystalStatus>("/crystal/status"),
  });

  const catalogPreview = useQuery({
    queryKey: ["report-detail", designerDataset, "designer"],
    // Skip auto-fetch for allocation datasets — full collect is N+1; use main report rows for columns.
    enabled: !isAirfareAllocationReport(designerDataset),
    queryFn: () => api<ReportDetail>(`/reports/detail/${designerDataset}`),
  });

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("atlas.reportSpec");
      if (!raw) return;
      const spec = JSON.parse(raw) as { dataset?: string; title?: string; columns?: string[] };
      if (spec.dataset && REPORTS.some((r) => r.name === spec.dataset)) {
        setDesignerDataset(spec.dataset as ReportName);
        setDesignerTitle(spec.title || "Agent draft");
        if (spec.columns?.length) setSelectedColumns(spec.columns);
      }
      sessionStorage.removeItem("atlas.reportSpec");
      toast.info("Loaded agent report draft", "Refine columns then save or export.");
    } catch {
      /* ignore */
    }
  }, []);

  const designerSource =
    catalogPreview.data ??
    (isAirfareAllocationReport(designerDataset) && selected === designerDataset
      ? detail.data
      : undefined);

  useEffect(() => {
    if (!designerSource?.columns?.length) return;
    if (!selectedColumns.length) {
      setSelectedColumns(designerSource.columns);
    }
  }, [designerSource, selectedColumns.length]);

  const availableColumns = designerSource?.columns ?? [];

  const previewRows = useMemo(() => {
    if (!designerSource) return [];
    const indexes = selectedColumns
      .map((c) => availableColumns.indexOf(c))
      .filter((i) => i >= 0);
    return designerSource.rows.slice(0, 25).map((row) => indexes.map((i) => row[i]));
  }, [designerSource, selectedColumns, availableColumns]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const definition = {
        title: designerTitle,
        dataset: designerDataset,
        bands: {
          header: { title: designerTitle, show_date: true },
          detail: { columns: selectedColumns },
          footer: { show_count: true },
        },
        parameters: {},
        filters: {},
        group_by: [],
        sort_by: selectedColumns[0] ?? null,
      };
      if (activeTemplateId) {
        const current = templates.data?.find((t) => t.id === activeTemplateId);
        return api(`/report-templates/${activeTemplateId}`, {
          method: "PUT",
          headers: { "If-Match": String(current?.version ?? 1) },
          body: { title: designerTitle, definition },
        });
      }
      const code = `custom_${designerDataset.replace(/-/g, "_")}_${Date.now().toString(36)}`;
      return api("/report-templates", {
        method: "POST",
        body: { code, title: designerTitle, dataset: designerDataset, definition },
      });
    },
    onSuccess: () => {
      toast.success("Template saved");
      setActiveTemplateId(null);
      queryClient.invalidateQueries({ queryKey: ["report-templates"] });
    },
    onError: (err) => toast.error("Save failed", errorMessage(err)),
  });

  const toggleColumn = (column: string) => {
    setSelectedColumns((prev) =>
      prev.includes(column) ? prev.filter((c) => c !== column) : [...prev, column]
    );
  };

  const loadTemplate = (tpl: ReportTemplate) => {
    setActiveTemplateId(tpl.id);
    setDesignerTitle(tpl.title);
    setDesignerDataset(tpl.dataset as ReportName);
    const cols = tpl.definition?.bands?.detail?.columns;
    if (cols?.length) setSelectedColumns(cols);
  };

  return (
    <div className="animate-[fade-in_0.3s_ease-out]" data-testid="reports-page">
      {selected && selectedMeta ? (
        <div data-testid="report-screen">
          <nav
            aria-label="Breadcrumb"
            data-testid="report-breadcrumb"
            className="no-print mb-3 flex flex-wrap items-center gap-1.5 text-sm text-[var(--color-muted-foreground)]"
          >
            <Link href="/reports/" className="font-medium text-[var(--color-primary)] hover:underline" data-testid="report-breadcrumb-home">
              {t("page.reports.title")}
            </Link>
            <ChevronRight size={14} aria-hidden="true" />
            <span>{selectedCategory?.label ?? "Reports"}</span>
            <ChevronRight size={14} aria-hidden="true" />
            <span aria-current="page" className="font-semibold text-[var(--color-foreground)]">
              {selectedMeta.label}
            </span>
          </nav>
          <div className="mb-4 flex flex-wrap items-start justify-between gap-4" data-testid="report-screen-header">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[var(--radius-md)] gradient-hero text-white">
                <selectedMeta.icon size={22} aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <h1 className="text-2xl font-bold tracking-tight text-[var(--color-foreground)]">{selectedMeta.label}</h1>
                <p className="mt-0.5 text-sm text-[var(--color-muted-foreground)]">{selectedMeta.blurb}</p>
              </div>
            </div>
            <div className="no-print flex flex-wrap items-center gap-2">
              <Select
                value={selected}
                onChange={(e) => router.push(REPORT_HREF(e.target.value as ReportName))}
                aria-label="Switch report"
                data-testid="report-switcher"
                className="h-10 w-auto min-w-[14rem]"
              >
                {REPORT_CATEGORIES.map((c) => (
                  <optgroup key={c.id} label={c.label}>
                    {REPORTS.filter((r) => (c.reports as readonly string[]).includes(r.name)).map((r) => (
                      <option key={r.name} value={r.name}>
                        {r.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Select>
              <a
                href={REPORT_HREF(selected)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-10 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-sm font-medium hover:bg-[var(--color-muted)]"
                data-testid="report-open-new-tab"
                title="Open this report in a new browser tab"
              >
                <ExternalLink size={14} aria-hidden="true" /> New tab
              </a>
              <Button variant="outline" className="h-10" onClick={() => router.push("/reports/")} data-testid="report-back">
                <ArrowLeft size={14} aria-hidden="true" /> All reports
              </Button>
            </div>
          </div>
        </div>
      ) : (
      <>
      <PageHeader
        title={t("page.reports.title")}
        subtitle={t("page.reports.subtitle")}
      />

      <Link
        href={appPath("/finance")}
        data-testid="reports-link-finance-ledger"
        className="mb-4 flex items-start gap-3 rounded-[var(--radius-lg)] border-2 border-[var(--color-primary)] bg-[var(--color-primary-muted)] p-4 text-left transition-all hover:shadow-[var(--shadow-pop)]"
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-sm)] gradient-hero text-white">
          <Scale size={18} />
        </div>
        <div>
          <p className="text-sm font-bold text-[var(--color-primary)]">Finance Ledger (GL)</p>
          <p className="mt-0.5 text-xs text-[var(--color-muted-foreground)]">
            Chart of accounts, trial balance, and journal entries for ticket issue and loans — open the
            dedicated Finance Ledger page (not a catalog tile).
          </p>
        </div>
      </Link>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-sm">
          <Search
            size={15}
            className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-[var(--color-muted-foreground)]"
            aria-hidden="true"
          />
          <Input
            value={catalogQuery}
            onChange={(e) => setCatalogQuery(e.target.value)}
            placeholder={`Search ${REPORTS.length} reports…`}
            aria-label="Search reports"
            data-testid="reports-search"
            className="ps-9"
          />
        </div>
      </div>

      <div className="space-y-5" data-testid="reports-catalog">
        {catalog.length === 0 ? (
          <p className="text-sm text-[var(--color-muted-foreground)]">No report matches “{catalogQuery}”.</p>
        ) : null}
        {catalog.map((category) => (
          <section key={category.id} data-testid={`reports-category-${category.id}`}>
            <h2 className="mb-2 text-xs font-bold uppercase tracking-[0.12em] text-[var(--color-muted-foreground)]">
              {category.label}
              {category.id === "insights" || category.id === "travel-registers" ? (
                <Badge variant="secondary" className="ms-2 normal-case tracking-normal">
                  New
                </Badge>
              ) : null}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {category.items.map(({ name, label, icon: Icon, blurb }) => (
          <div key={name} className="group relative">
            <Link
              href={REPORT_HREF(name)}
              data-testid={`report-tile-${name}`}
              className="flex h-full items-start gap-3 rounded-[var(--radius-lg)] border-2 border-[var(--color-border)] bg-white p-4 pe-10 text-left shadow-[var(--shadow-card)] transition-all hover:border-[var(--color-primary)] hover:shadow-[var(--shadow-pop)]"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-primary-muted)] text-[var(--color-primary)] transition-colors group-hover:bg-[var(--color-primary)] group-hover:text-white">
                <Icon size={18} />
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <p className="text-base font-bold leading-snug break-words text-[var(--color-foreground)]">
                  {label}
                  {(name === "ticket-standard" || name === "travel-summary" || name === "ticket-cost") && (
                    <Badge variant="secondary" className="ms-2 align-middle text-[10px] normal-case tracking-normal">
                      New
                    </Badge>
                  )}
                </p>
                <p className="text-sm leading-snug break-words text-[var(--color-muted-foreground)]">
                  {blurb}
                </p>
              </div>
            </Link>
            <a
              href={REPORT_HREF(name)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Open ${label} in a new tab`}
              title="Open in a new tab"
              data-testid={`report-tile-newtab-${name}`}
              className="absolute end-2 top-2 rounded-[var(--radius-sm)] p-1.5 text-[var(--color-muted-foreground)] opacity-60 transition-opacity hover:bg-[var(--color-muted)] hover:text-[var(--color-primary)] hover:opacity-100 focus-visible:opacity-100"
            >
              <ExternalLink size={14} aria-hidden="true" />
            </a>
          </div>
        ))}
            </div>
          </section>
        ))}
      </div>
      </>
      )}

      {needsPayableFilters ? (
        <Card className="mt-4 overflow-hidden" data-testid="payable-filters">
          <div className="gradient-hero px-4 py-3 text-white" data-testid="allocation-report-banner">
            <p className="text-xs font-bold uppercase tracking-[0.14em] opacity-80">Filter bar · Airfare Amount Balance</p>
            <p className="mt-0.5 text-sm font-semibold">
              Period From → To · Key date {fmtDate(allocationAsOf)} = Calculate entitlement
            </p>
            <p className="mt-1 text-xs opacity-85" data-testid="payable-period-hint">
              Opening · Accrued · Already paid · Balance · Closing · Entitlement — balances are computed on the To date
            </p>
          </div>
          <CardContent className="flex flex-wrap items-end gap-4 py-4">
            <DateRangeFilter
              idPrefix="payable"
              value={range}
              onChange={setRange}
              presets={STATEMENT_PRESETS}
              fmt={fmtDate}
              note={
                <span data-testid="payable-key-date-note">
                  To is the key date (as-of) for entitlement — same engine as Allocation → Calculate entitlement
                </span>
              }
            />
            <div className="flex flex-wrap gap-2 pb-0.5" role="group" aria-label="Key date shortcuts">
              {(
                [
                  ["today", "Today", localIsoDate(new Date())],
                  [
                    "month_end",
                    "Month end",
                    localIsoDate(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0)),
                  ],
                  ["year_end", "Year end", `${new Date().getFullYear()}-12-31`],
                ] as const
              ).map(([id, label, iso]) => (
                <Button
                  key={id}
                  type="button"
                  variant={allocationAsOf === iso ? "default" : "outline"}
                  size="sm"
                  className="h-10"
                  data-testid={`payable-asof-${id}`}
                  title={`Set To (key date) to ${label}`}
                  onClick={() => setAllocationKeyDate(iso)}
                >
                  {label}
                </Button>
              ))}
            </div>
            <div className="basis-full h-px bg-[var(--color-border)]" aria-hidden="true" />
            <Field label="Department" className="min-w-[12rem]">
              <MultiSelect
                options={departmentOptions}
                values={payableDepartments}
                data-testid="payable-departments"
                placeholder="All departments"
                onChange={setPayableDepartments}
              />
            </Field>
            <Field label="Emp. Department" className="min-w-[12rem]">
              <MultiSelect
                options={empDepartmentOptions}
                values={payableEmpDepartments}
                data-testid="payable-emp-departments"
                placeholder="All emp. departments"
                onChange={setPayableEmpDepartments}
              />
            </Field>
            <Field label="Sub section" className="min-w-[12rem]">
              <MultiSelect
                options={subSectionOptions}
                values={payableSubSections}
                data-testid="payable-sub-sections"
                placeholder="All sub sections"
                onChange={setPayableSubSections}
              />
            </Field>
            <Field label="Nationality" className="min-w-[12rem]" htmlFor="payable-bahraini">
              <Select
                id="payable-bahraini"
                data-testid="payable-bahraini"
                value={payableBahrainiMode}
                onChange={(e) =>
                  setPayableBahrainiMode(e.target.value as "all" | "only" | "exclude")
                }
                className="h-10"
              >
                <option value="all">All nationalities</option>
                <option value="only">Bahraini only</option>
                <option value="exclude">Excluding Bahraini</option>
              </Select>
            </Field>
            <p className="basis-full text-xs text-[var(--color-muted-foreground)]" data-testid="payable-asof-echo">
              <strong>From</strong> sets the statement period start · <strong>To</strong> is the snapshot key date.
              Apply runs the report; Excel/PDF use the same period and filters.
            </p>
            <FilterBarActions
              dirty={filtersDirty}
              onApply={() => applyFilters()}
              onClear={clearPayableFilters}
              applyTestId="payable-filter-apply"
              clearTestId="payable-filter-clear"
            />
          </CardContent>
        </Card>
      ) : null}

      {needsAttendanceFilters ? (
        <Card className="mt-4" data-testid="attendance-filters">
          <CardContent className="flex flex-wrap items-start gap-4 py-4">
            <DateRangeFilter idPrefix="att" value={range} onChange={setRange} presets={ATTENDANCE_PRESETS} fmt={fmtDate} />
            <Field label="Department" htmlFor="att-dept">
              <Input
                id="att-dept"
                data-testid="att-department"
                value={attDepartment}
                placeholder="All"
                onChange={(e) => setAttDepartment(e.target.value)}
              />
            </Field>
            <Field label="Emp. Department" className="min-w-[12rem]">
              <MultiSelect
                options={empDepartmentOptions}
                values={attEmpDepartment}
                data-testid="att-emp-department"
                placeholder="All emp. departments"
                onChange={setAttEmpDepartment}
              />
            </Field>
            <p className="self-end text-xs text-[var(--color-muted-foreground)] pb-2 max-w-md">
              Summaries add up late minutes, absences and hours for each person; the date-wise register shows
              one row per person per day.
            </p>
            <FilterBarActions
              dirty={filtersDirty}
              onApply={() => applyFilters()}
              onClear={() => {
                setAttDepartment("");
                setAttEmpDepartment([]);
                const preset = rangeFromPreset("today");
                setRange(preset);
                const next = effectiveRange(preset);
                const params = new URLSearchParams();
                params.set("period", "today");
                params.set("date_from", next.from);
                params.set("date_to", next.to);
                if (activeCompanyId) params.set("company_id", activeCompanyId);
                applyFilters(`?${params.toString()}`);
              }}
              applyTestId="att-filter-apply"
              clearTestId="att-filter-clear"
            />
          </CardContent>
        </Card>
      ) : null}

      {needsCommissionFilters ? (
        <Card className="mt-4" data-testid="commission-filters">
          <CardContent className="flex flex-wrap items-start gap-4 py-4">
            <DateRangeFilter
              idPrefix="comm"
              value={range}
              onChange={setRange}
              presets={MONTH_PRESETS}
              granularity="month"
              fmtMonth={fmtMonth}
            />
            <Field label="Employee" className="min-w-[14rem]">
              <MultiSelect
                options={employeeOptions}
                values={commEmployeeIds}
                data-testid="comm-employees"
                placeholder="All employees"
                onChange={setCommEmployeeIds}
              />
            </Field>
            <Field label="Department" className="min-w-[12rem]">
              <MultiSelect
                options={departmentOptions}
                values={commDepartments}
                data-testid="comm-departments"
                placeholder="All departments"
                onChange={setCommDepartments}
              />
            </Field>
            <Field label="Emp. Department" className="min-w-[12rem]">
              <MultiSelect
                options={empDepartmentOptions}
                values={commEmpDepartments}
                data-testid="comm-emp-departments"
                placeholder="All emp. departments"
                onChange={setCommEmpDepartments}
              />
            </Field>
            <Field label="Pay group" className="min-w-[10rem]">
              <MultiSelect
                options={payGroupOptions}
                values={commPayGroups}
                data-testid="comm-pay-groups"
                placeholder="All pay groups"
                onChange={setCommPayGroups}
              />
            </Field>
            <Field label="Status" className="min-w-[10rem]">
              <MultiSelect
                options={statusOptions}
                values={commStatuses}
                data-testid="comm-status"
                placeholder="All statuses"
                searchable={false}
                onChange={setCommStatuses}
              />
            </Field>
            <p className="self-end text-xs text-[var(--color-muted-foreground)] pb-2 max-w-md">
              Tip: pick a period, or set From and To months. Picking two departments shows both;
              picking a department and a status shows only rows that match both. Excel and PDF use the same filters.
            </p>
            <FilterBarActions
              dirty={filtersDirty}
              onApply={() => applyFilters()}
              onClear={() => {
                setCommStatuses([]);
                setCommEmployeeIds([]);
                setCommDepartments([]);
                setCommEmpDepartments([]);
                setCommPayGroups([]);
                const preset = rangeFromPreset("this_month");
                setRange(preset);
                const next = effectiveRange(preset);
                const mf = next.from.slice(0, 7);
                const mt = next.to.slice(0, 7);
                const params = new URLSearchParams();
                if (mf && mf === mt) params.set("month", mf);
                else {
                  if (mf) params.set("month_from", mf);
                  if (mt) params.set("month_to", mt);
                }
                applyFilters(params.toString() ? `?${params.toString()}` : "");
              }}
              applyTestId="comm-filter-apply"
              clearTestId="comm-filter-clear"
            />
          </CardContent>
        </Card>
      ) : null}

      {needsCommissionBiFilters ? (
        <Card className="mt-4" data-testid="commission-bi-filters">
          <CardContent className="flex flex-wrap items-start gap-4 py-4">
            <Field label="Group by" htmlFor="bi-group-by">
              <div
                id="bi-group-by"
                data-testid="bi-group-by"
                role="group"
                aria-label="Group by"
                className="flex flex-wrap gap-1.5"
              >
                {COMMISSION_BI_GROUPS.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    data-testid={`bi-group-by-chip-${g.id}`}
                    aria-pressed={biGroupBy === g.id}
                    onClick={() => setBiGroupBy(g.id)}
                    className={cn(
                      "h-10 rounded-full border px-3 text-sm font-medium transition-colors cursor-pointer",
                      biGroupBy === g.id
                        ? "border-[var(--color-primary)] bg-[var(--color-primary-muted)] text-[var(--color-primary)]"
                        : "border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:border-[var(--color-input-hover)]"
                    )}
                  >
                    {g.label.replace(/^By /, "")}
                  </button>
                ))}
              </div>
            </Field>
            <DateRangeFilter
              idPrefix="bi"
              value={range}
              onChange={setRange}
              presets={MONTH_PRESETS}
              granularity="month"
              fmtMonth={fmtMonth}
            />
            <Field label="Employee" className="min-w-[14rem]">
              <MultiSelect
                options={employeeOptions}
                values={biEmployeeIds}
                data-testid="bi-employee"
                placeholder="All employees"
                onChange={setBiEmployeeIds}
              />
            </Field>
            <Field label="Department" className="min-w-[12rem]">
              <MultiSelect
                options={departmentOptions}
                values={biDepartments}
                data-testid="bi-department"
                placeholder="All departments"
                onChange={setBiDepartments}
              />
            </Field>
            <Field label="Emp. Department" className="min-w-[12rem]">
              <MultiSelect
                options={empDepartmentOptions}
                values={biEmpDepartments}
                data-testid="bi-emp-departments"
                placeholder="All emp. departments"
                onChange={setBiEmpDepartments}
              />
            </Field>
            <Field label="Designation" htmlFor="bi-designation">
              <Input
                id="bi-designation"
                data-testid="bi-designation"
                value={biDesignation}
                placeholder="All"
                onChange={(e) => setBiDesignation(e.target.value)}
              />
            </Field>
            <Field label="Pay group" className="min-w-[10rem]">
              <MultiSelect
                options={payGroupOptions}
                values={biPayGroups}
                data-testid="bi-pay-group"
                placeholder="All pay groups"
                onChange={setBiPayGroups}
              />
            </Field>
            <Field label="Status" className="min-w-[10rem]">
              <MultiSelect
                options={statusOptions}
                values={biStatuses}
                data-testid="bi-status"
                placeholder="All statuses"
                searchable={false}
                onChange={setBiStatuses}
              />
            </Field>
            <Field label="Amount min" htmlFor="bi-amount-min">
              <Input
                id="bi-amount-min"
                data-testid="bi-amount-min"
                type="number"
                min="0"
                step="0.001"
                value={biAmountMin}
                onChange={(e) => setBiAmountMin(e.target.value)}
                className="w-28"
              />
            </Field>
            <Field label="Amount max" htmlFor="bi-amount-max">
              <Input
                id="bi-amount-max"
                data-testid="bi-amount-max"
                type="number"
                min="0"
                step="0.001"
                value={biAmountMax}
                onChange={(e) => setBiAmountMax(e.target.value)}
                className="w-28"
              />
            </Field>
            <Field label="Voucher no" htmlFor="bi-voucher-no">
              <Input
                id="bi-voucher-no"
                data-testid="bi-voucher-no"
                value={biVoucherNo}
                placeholder="CM-000001"
                onChange={(e) => setBiVoucherNo(e.target.value)}
                className="w-32"
              />
            </Field>
            <Field label="Currency" htmlFor="bi-currency">
              <Input
                id="bi-currency"
                data-testid="bi-currency"
                value={biCurrency}
                maxLength={3}
                placeholder="BHD"
                onChange={(e) => setBiCurrency(e.target.value.toUpperCase().slice(0, 3))}
                className="w-24"
              />
            </Field>
            <p className="self-end text-xs text-[var(--color-muted-foreground)] pb-2 max-w-md">
              Commission BI aggregates voucher entries with SQL GROUP BY on the selected dimension; the
              quick month pins the range and Excel/PDF exports inherit every filter above.
            </p>
            <FilterBarActions
              dirty={filtersDirty}
              onApply={() => applyFilters()}
              onClear={() => {
                setBiGroupBy("employee");
                setBiEmployeeIds([]);
                setBiDepartments([]);
                setBiEmpDepartments([]);
                setBiDesignation("");
                setBiStatuses([]);
                setBiAmountMin("");
                setBiAmountMax("");
                setBiVoucherNo("");
                setBiCurrency("");
                setBiPayGroups([]);
                const preset = rangeFromPreset("this_month");
                setRange(preset);
                const next = effectiveRange(preset);
                const mf = next.from.slice(0, 7);
                const mt = next.to.slice(0, 7);
                const params = new URLSearchParams();
                params.set("group_by", "employee");
                if (mf && mf === mt) params.set("month", mf);
                else {
                  if (mf) params.set("month_from", mf);
                  if (mt) params.set("month_to", mt);
                }
                applyFilters(`?${params.toString()}`);
              }}
              applyTestId="bi-filter-apply"
              clearTestId="bi-filter-clear"
            />
          </CardContent>
        </Card>
      ) : null}

      {needsStandardFilters ? (
        <Card className="mt-4" data-testid="standard-filters">
          <CardContent className="flex flex-wrap items-start gap-4 py-4">
            {stdSchema.includes("year") ? (
              <Field label="Fiscal year" htmlFor="std-year">
                <Select
                  id="std-year"
                  data-testid="std-year"
                  value={stdYear}
                  title="Opening balances are kept per fiscal year — pick the year to carry forward or review"
                  onChange={(e) => setStdYear(e.target.value)}
                  className="min-w-[9rem]"
                >
                  <option value="">All years</option>
                  {Array.from({ length: 8 }, (_, i) => new Date().getFullYear() + 1 - i).map((y) => (
                    <option key={y} value={String(y)}>
                      {fiscalYearLabel(y)}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
            {stdSchema.includes("dateRange") ? (
              <DateRangeFilter idPrefix="std" value={range} onChange={setRange} presets={TRANSACTION_PRESETS} fmt={fmtDate} />
            ) : null}
            {stdSchema.includes("asOf") ? (
              <>
                <Field label="As of date" htmlFor="std-as-of">
                  <Input
                    id="std-as-of"
                    data-testid="std-as-of"
                    type="date"
                    value={stdAsOf}
                    title="Balances and overdue days are worked out on this date. Leave empty for today."
                    onChange={(e) => setStdAsOf(e.target.value)}
                  />
                </Field>
                <p
                  className="order-last basis-full text-xs font-medium text-[var(--color-foreground)]"
                  data-testid="std-as-of-summary"
                >
                  {`Selected: position as on ${fmtDate(stdAsOf || todayIso)}${stdAsOf ? "" : " (today, default)"}`}
                </p>
              </>
            ) : null}
            {stdSchema.includes("dateTo") ? (
              <>
                <Field label="Expiring by" htmlFor="std-date-to-only">
                  <Input
                    id="std-date-to-only"
                    data-testid="std-date-to-only"
                    type="date"
                    value={stdDateTo}
                    min={todayIso}
                    title="Show documents that expire on or before this date. Leave empty for the next 90 days."
                    onChange={(e) => setStdDateTo(e.target.value)}
                  />
                </Field>
                <p
                  className="order-last basis-full text-xs font-medium text-[var(--color-foreground)]"
                  data-testid="std-expiry-summary"
                >
                  {stdDateTo
                    ? `Selected: already expired, plus expiring up to ${fmtDate(stdDateTo)} (next ${
                        inclusiveDays(todayIso, stdDateTo) ?? 0
                      } days)`
                    : "Selected: already expired, plus expiring in the next 90 days (default)"}
                </p>
              </>
            ) : null}
            {stdSchema.includes("employees") ? (
              <Field label="Employee" className="min-w-[14rem]">
                <MultiSelect
                  options={employeeOptions}
                  values={stdEmployeeIds}
                  data-testid="std-employees"
                  placeholder="All employees"
                  onChange={setStdEmployeeIds}
                />
              </Field>
            ) : null}
            {stdSchema.includes("departments") ? (
              <Field label="Department" className="min-w-[12rem]">
                <MultiSelect
                  options={departmentOptions}
                  values={stdDepartments}
                  data-testid="std-departments"
                  placeholder="All departments"
                  onChange={setStdDepartments}
                />
              </Field>
            ) : null}
            {stdSchema.includes("empDepartments") ? (
              <Field label="Emp. Department" className="min-w-[12rem]">
                <MultiSelect
                  options={empDepartmentOptions}
                  values={stdEmpDepartments}
                  data-testid="std-emp-departments"
                  placeholder="All emp. departments"
                  onChange={setStdEmpDepartments}
                />
              </Field>
            ) : null}
            {stdSchema.includes("subSections") ? (
              <Field label="Sub section" className="min-w-[12rem]">
                <MultiSelect
                  options={subSectionOptions}
                  values={stdSubSections}
                  data-testid="std-sub-sections"
                  placeholder="All sub sections"
                  onChange={setStdSubSections}
                />
              </Field>
            ) : null}
            {stdSchema.includes("companies") ? (
              <Field label="Company" className="min-w-[12rem]">
                <MultiSelect
                  options={companyOptions}
                  values={stdCompanyIds}
                  data-testid="std-companies"
                  placeholder="All companies"
                  onChange={setStdCompanyIds}
                />
              </Field>
            ) : null}
            {stdSchema.includes("payGroups") ? (
              <Field label="Pay group" className="min-w-[10rem]">
                <MultiSelect
                  options={payGroupOptions}
                  values={stdPayGroups}
                  data-testid="std-pay-groups"
                  placeholder="All pay groups"
                  onChange={setStdPayGroups}
                />
              </Field>
            ) : null}
            {stdSchema.includes("statuses") ? (
              <Field
                label={
                  selected === "ticket-register" || selected === "travel-summary"
                    ? "Application status"
                    : "Status"
                }
                className="min-w-[12rem]"
              >
                <MultiSelect
                  options={stdStatusOptions}
                  values={stdStatuses}
                  data-testid="std-statuses"
                  placeholder={
                    selected === "ticket-register" || selected === "travel-summary"
                      ? "All application statuses"
                      : "All statuses"
                  }
                  searchable={false}
                  onChange={setStdStatuses}
                />
              </Field>
            ) : null}
            {stdSchema.includes("leaveStatuses") ? (
              <Field label="Leave status" className="min-w-[12rem]">
                <MultiSelect
                  options={LEAVE_STATUS_FILTER_OPTIONS}
                  values={stdLeaveStatuses}
                  data-testid="std-leave-statuses"
                  placeholder="All leave statuses"
                  searchable={false}
                  onChange={setStdLeaveStatuses}
                />
              </Field>
            ) : null}
            {stdSchema.includes("oneWayPurposes") ? (
              <Field label="One-way purpose" className="min-w-[14rem]">
                <MultiSelect
                  options={[...ONE_WAY_PURPOSE_FILTER_OPTIONS]}
                  values={stdOneWayPurposes}
                  data-testid="std-one-way-purposes"
                  placeholder="All one-way purposes"
                  searchable={false}
                  onChange={setStdOneWayPurposes}
                />
              </Field>
            ) : null}
            {stdSchema.includes("designation") ? (
              <Field label="Designation" htmlFor="std-designation">
                <Input
                  id="std-designation"
                  data-testid="std-designation"
                  value={stdDesignation}
                  placeholder="All"
                  onChange={(e) => setStdDesignation(e.target.value)}
                />
              </Field>
            ) : null}
            {stdSchema.includes("empStatus") ? (
              <Field label="Status" htmlFor="std-emp-status">
                <Select
                  id="std-emp-status"
                  data-testid="std-emp-status"
                  value={stdEmpStatus}
                  onChange={(e) => setStdEmpStatus(e.target.value)}
                >
                  <option value="">All</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </Select>
              </Field>
            ) : null}
            <p className="self-end text-xs text-[var(--color-muted-foreground)] pb-2 max-w-md">
              Tip: picking two departments shows both; picking a department and a status shows only rows
              that match both. Excel and PDF use the same filters.
            </p>
            <FilterBarActions
              dirty={filtersDirty}
              onApply={() => applyFilters()}
              onClear={() => {
                setStdEmployeeIds([]);
                setStdDepartments([]);
                setStdEmpDepartments([]);
                setStdSubSections([]);
                setStdCompanyIds([]);
                setStdPayGroups([]);
                setStdStatuses([]);
                setStdLeaveStatuses([]);
                setStdOneWayPurposes([]);
                setStdDateTo("");
                setStdYear("");
                setStdDesignation("");
                setStdEmpStatus("");
                setStdAsOf("");
                const params = new URLSearchParams();
                if (stdSchema.includes("dateRange")) {
                  const preset = rangeFromPreset("ytd");
                  setRange(preset);
                  const next = effectiveRange(preset);
                  if (next.from) params.set("date_from", next.from);
                  if (next.to) params.set("date_to", next.to);
                }
                applyFilters(params.toString() ? `?${params.toString()}` : "");
              }}
              applyTestId="std-filter-apply"
              clearTestId="std-filter-clear"
            />
          </CardContent>
        </Card>
      ) : null}

      {selected ? (
        <Card className="mt-4" data-print-root data-testid="report-viewer">
          <CardHeader>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div data-testid="report-document-header">
                {activeCompanyName ? (
                  <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--color-primary)]">
                    {activeCompanyName}
                  </p>
                ) : null}
                <CardTitle>{REPORTS.find((r) => r.name === selected)?.label}</CardTitle>
                <CardDescription data-testid="report-row-count">
                  {detail.isPending
                    ? "Loading…"
                    : detail.isError
                      ? errorMessage(detail.error)
                      : detail.data
                        ? `${num(detail.data.count)} rows · ${VIEW_LAYOUTS.find((l) => l.id === activeView.layout)?.label} layout${
                            grouping ? ` by ${reportColumns[activeView.group] ?? ""}` : ""
                          } · Generated ${fmtDateTime(detail.data.generated_at)}${
                            me ? ` by ${me.display_name || me.full_name || me.username}` : ""
                          }`
                        : "—"}
                </CardDescription>
                {filterChips.length > 0 && !detail.isPending && !filtersDirty ? (
                  <div className="flex flex-wrap gap-1.5 pt-2" data-testid="report-filter-echo">
                    {filterChips.map((chip) => (
                      <Badge
                        key={chip.key}
                        variant="secondary"
                        className={cn(chip.onClear && "cursor-pointer gap-1 pe-1")}
                        onClick={chip.onClear}
                        title={chip.onClear ? "Clear this filter" : undefined}
                        data-testid={`filter-chip-${chip.key}`}
                      >
                        {chip.label}
                        {chip.onClear ? (
                          <span className="ms-1 rounded px-1 text-[10px] opacity-70" aria-hidden="true">
                            ×
                          </span>
                        ) : null}
                      </Badge>
                    ))}
                  </div>
                ) : null}
                {filtersDirty ? (
                  <p className="pt-2 text-xs font-medium text-[var(--color-warning)]" data-testid="viewer-filter-dirty">
                    Filter bar has unapplied changes — Apply to refresh rows and exports
                  </p>
                ) : null}
              </div>
              <div className="no-print flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  className="h-10"
                  data-testid="report-export-xlsx"
                  disabled={!canExportReports || Boolean(exporting) || !detail.data}
                  title={canExportReports ? undefined : "Export requires admin, HR, finance, or auditor"}
                  onClick={() => void runExport("xlsx")}
                >
                  <Download size={14} /> {exporting === "xlsx" ? "Excel…" : "Excel"}
                </Button>
                <Button
                  variant="outline"
                  className="h-10"
                  data-testid="report-export-pdf"
                  disabled={!canExportReports || Boolean(exporting) || !detail.data}
                  title={canExportReports ? undefined : "Export requires admin, HR, finance, or auditor"}
                  onClick={() => void runExport("pdf")}
                >
                  <Download size={14} /> {exporting === "pdf" ? "PDF…" : "PDF"}
                </Button>
                <Button
                  variant="outline"
                  className="h-10"
                  data-testid="report-print"
                  disabled={!detail.data}
                  onClick={printReport}
                >
                  <Printer size={14} /> Print
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {detail.isPending ? (
              <TableSkeleton columns={6} rows={8} label={t("state.loading")} />
            ) : detail.isError || !detail.data ? (
              <EmptyState
                icon={<FileText size={22} />}
                title="This report could not be loaded"
                message={
                  detail.isError
                    ? `${errorMessage(detail.error)} — check the dates and filters above, then try again.`
                    : "Pick the period and filters above to run the report."
                }
                action={
                  detail.isError ? (
                    <Button variant="outline" onClick={() => detail.refetch()} data-testid="report-retry">
                      Try again
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <>
                {insights.length > 0 ? (
                  <div
                    className="grid gap-3 p-4 pb-2 sm:grid-cols-2 xl:grid-cols-4"
                    data-testid="report-insights"
                  >
                    {insights.map((card) => (
                      <div
                        key={card.label}
                        className={cn(
                          "rounded-[var(--radius-md)] border bg-[var(--color-background)] px-4 py-3",
                          INSIGHT_TONE[card.tone ?? "neutral"]
                        )}
                      >
                        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
                          {card.label}
                        </p>
                        <p className="mt-0.5 text-lg font-bold tabular-nums">{fmtGridCell(card.value)}</p>
                      </div>
                    ))}
                  </div>
                ) : null}
                <div
                  className="no-print flex flex-wrap items-center gap-3 border-y border-[var(--color-border)] bg-[var(--color-card)] px-4 py-2.5 shadow-[inset_0_1px_0_0_var(--color-border)]"
                  data-testid="report-view-toolbar"
                >
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
                    <Layers size={14} aria-hidden="true" /> Layout
                  </span>
                  <div className="inline-flex max-w-full flex-wrap rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-background)] p-0.5" role="group" aria-label="Report layout">
                    {VIEW_LAYOUTS.filter((l) => l.id !== "calendar" || (selected != null && CALENDAR_REPORTS.has(selected))).map((l) => {
                      const disabled =
                        l.id === "calendar"
                          ? calendarData == null
                          : l.id === "ranked"
                            ? sumColumns.length === 0
                            : l.id !== "standard" && groupColumns.length === 0;
                      const why =
                        l.id === "calendar"
                          ? "Pick a week, a month or a range of 2 to 62 days to see the calendar"
                          : l.id === "ranked"
                            ? "This report has no amount column to rank"
                            : "This report has no column to group by";
                      return (
                        <button
                          key={l.id}
                          type="button"
                          title={disabled ? why : l.hint}
                          disabled={disabled}
                          aria-pressed={activeView.layout === l.id}
                          data-testid={`view-layout-${l.id}`}
                          onClick={() => updateView({ layout: l.id })}
                          className={cn(
                            "min-h-11 rounded-[calc(var(--radius-md)-2px)] px-3 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 lg:min-h-9",
                            activeView.layout === l.id
                              ? "bg-[var(--color-primary)] text-[var(--color-primary-foreground)]"
                              : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
                          )}
                        >
                          {l.label}
                        </button>
                      );
                    })}
                  </div>
                  {grouping ? (
                    <label className="inline-flex items-center gap-2 text-sm">
                      <span className="text-[var(--color-muted-foreground)]">Group by</span>
                      <Select
                        value={String(activeView.group)}
                        onChange={(e) => updateView({ group: Number(e.target.value) })}
                        data-testid="view-group-by"
                        aria-label="Group by column"
                        className="h-9 w-auto min-w-[10rem]"
                      >
                        {groupColumns.map((ci) => (
                          <option key={ci} value={ci}>
                            {reportColumns[ci]}
                          </option>
                        ))}
                      </Select>
                    </label>
                  ) : null}
                  <label
                    className={cn(
                      "inline-flex items-center gap-2 text-sm",
                      sumColumns.length === 0 && "opacity-40"
                    )}
                    title={sumColumns.length === 0 ? "No amount columns in this report" : "Hide rows whose amounts are all zero"}
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[var(--color-primary)]"
                      checked={activeView.hideZero}
                      disabled={sumColumns.length === 0}
                      onChange={(e) => updateView({ hideZero: e.target.checked })}
                      data-testid="view-hide-zero"
                    />
                    Hide zero rows
                  </label>
                  <Button
                    variant="outline"
                    className="h-9"
                    data-testid="view-save"
                    disabled={!viewDirty || saveView.isPending}
                    onClick={() => saveView.mutate(activeView)}
                    title="Open this report with this layout next time"
                  >
                    {saveView.isPending ? "Saving…" : viewDirty ? "Save layout" : "Layout saved"}
                  </Button>
                  <div className="ms-auto flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-9"
                      data-testid="report-density"
                      aria-pressed={density === "compact"}
                      title={density === "compact" ? "Switch to comfortable rows" : "Switch to compact rows"}
                      onClick={toggleDensity}
                    >
                      {density === "compact" ? "Compact" : "Comfortable"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-9"
                      data-testid="report-toolbar-refresh"
                      disabled={detail.isFetching}
                      onClick={() => {
                        if (filtersDirty) {
                          toast.error("Apply filters first", "Click Apply so Refresh matches the filter bar.");
                          return;
                        }
                        void detail.refetch();
                      }}
                      title="Refresh report data"
                    >
                      <RefreshCw size={14} className={cn(detail.isFetching && "animate-spin")} /> Refresh
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-9"
                      data-testid="report-toolbar-xlsx"
                      disabled={!canExportReports || Boolean(exporting) || !detail.data}
                      title={canExportReports ? undefined : "Export requires admin, HR, finance, or auditor"}
                      onClick={() => void runExport("xlsx")}
                    >
                      <Download size={14} /> Excel
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-9"
                      data-testid="report-toolbar-pdf"
                      disabled={!canExportReports || Boolean(exporting) || !detail.data}
                      title={canExportReports ? undefined : "Export requires admin, HR, finance, or auditor"}
                      onClick={() => void runExport("pdf")}
                    >
                      <FileText size={14} /> PDF
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-9"
                      data-testid="report-toolbar-print"
                      disabled={!detail.data}
                      onClick={printReport}
                    >
                      <Printer size={14} /> Print
                    </Button>
                  </div>
                </div>
                <div className="no-print flex flex-wrap items-center justify-between gap-3 px-4 py-2">
                  <Input
                    value={rowQuery}
                    onChange={(e) => {
                      setRowQuery(e.target.value);
                      setPage(0);
                    }}
                    placeholder="Search in results…"
                    aria-label="Search in results"
                    data-testid="report-row-search"
                    className="max-w-xs"
                  />
                  <div className="flex items-center gap-2 text-xs text-[var(--color-muted-foreground)]" data-testid="report-pager">
                    <span>
                      {showCalendar
                        ? `${num(shownCalendar.length)} employees · ${num(calendarData.days.length)} days`
                        : !paged
                        ? `${num(bodyRows.filter((r) => r.kind === "group").length || bodyRows.length)} ${activeView.layout === "grouped" ? "groups" : "lines"} · ${num(filteredRows.length)} rows`
                        : bodyRows.length === 0
                          ? "0 rows"
                          : `${num(viewPage * PAGE_SIZE + 1)}–${num(Math.min((viewPage + 1) * PAGE_SIZE, bodyRows.length))} of ${num(bodyRows.length)}`}
                    </span>
                    {showCalendar ? null : (
                      <>
                        <Button
                          variant="outline"
                          size="icon"
                          aria-label="Previous page"
                          disabled={!paged || viewPage === 0}
                          onClick={() => setPage(viewPage - 1)}
                        >
                          <ChevronLeft size={15} aria-hidden="true" />
                        </Button>
                        <Button
                          variant="outline"
                          size="icon"
                          aria-label="Next page"
                          disabled={!paged || viewPage >= viewPageCount - 1}
                          onClick={() => setPage(viewPage + 1)}
                        >
                          <ChevronRight size={15} aria-hidden="true" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
                {commissionKpi ? (
                  <div
                    className="grid gap-3 p-4 pb-2 sm:grid-cols-2 xl:grid-cols-4"
                    data-testid="report-kpi-cards"
                  >
                    {[
                      {
                        id: "total",
                        label: "Total amount",
                        value: num(Number(commissionKpi.total_amount ?? 0)),
                        icon: BadgeDollarSign,
                      },
                      {
                        id: "employees",
                        label: "Employees",
                        value: num(commissionKpi.employees ?? 0),
                        icon: Users,
                      },
                      {
                        id: "entries",
                        label: "Entries",
                        value: num(commissionKpi.entries ?? 0),
                        icon: ListOrdered,
                      },
                      {
                        id: "vouchers",
                        label: "Vouchers",
                        value: num(commissionKpi.vouchers ?? 0),
                        icon: FileText,
                      },
                    ].map(({ id, label, value, icon: Icon }) => (
                      <div
                        key={id}
                        data-testid={`report-kpi-${id}`}
                        className="flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-background)] px-4 py-3"
                      >
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-primary-muted)] text-[var(--color-primary)]">
                          <Icon size={16} />
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
                            {label}
                          </p>
                          <p className="text-lg font-bold tabular-nums text-[var(--color-foreground)]">
                            {value}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
                {allocationHero ? (
                  <div
                    className="gradient-hero relative mx-4 mt-4 overflow-hidden rounded-[var(--radius-lg)] p-5 text-white shadow-md"
                    data-testid="allocation-row-hero"
                  >
                    <Plane className="absolute -right-4 -top-4 h-28 w-28 opacity-10" strokeWidth={1} aria-hidden="true" />
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-bold uppercase tracking-[0.14em] opacity-80">
                          {allocationHero.heroLabel}
                        </p>
                        <p className="mt-0.5 text-sm opacity-90">{allocationHero.name}</p>
                        <p className="mt-1 text-3xl font-extrabold tracking-tight tabular-nums" data-testid="allocation-hero-amount">
                          {fmtGridCell(allocationHero.entitlement)}
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="no-print border-white/40 bg-white/10 text-white hover:bg-white/20"
                        onClick={() => setAllocationHeroKey(null)}
                        data-testid="allocation-hero-clear"
                      >
                        Clear
                      </Button>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {(
                        [
                          ["Per-day rate", allocationHero.perDay],
                          ["Opening days", allocationHero.openingDays],
                          ["Opening amount", allocationHero.openingAmount],
                          ["Accrued days", allocationHero.accruedDays],
                          ["Accrued amount", allocationHero.accruedAmount],
                          ["Paid days", allocationHero.paidDays],
                          ["Paid amount", allocationHero.paidAmount],
                          ["Balance days", allocationHero.balanceDays],
                          ["Max payout", allocationHero.maxPayout],
                          ["Closing", allocationHero.closing],
                          ["Available funds", allocationHero.availableFunds],
                        ] as const
                      )
                        .filter(([label, v]) => {
                          if (v == null || v === "") return false;
                          // Avoid duplicating the hero headline on amount-balance.
                          if (label === "Available funds" && allocationHero.heroLabel === "Available funds") {
                            return false;
                          }
                          return true;
                        })
                        .map(([label, value]) => (
                          <div key={label} className="rounded-[var(--radius-sm)] bg-white/15 px-3 py-1.5 backdrop-blur-sm">
                            <span className="mr-2 text-[11px] font-medium uppercase tracking-wide opacity-75">{label}</span>
                            <span className="text-sm font-bold tabular-nums">{fmtGridCell(value)}</span>
                          </div>
                        ))}
                    </div>
                  </div>
                ) : null}
                {showCalendar ? (
                  <AttendanceCalendar data={calendarData} query={rowQuery} printing={printing} />
                ) : (
                <Table
                  stickyFirst={stickyCols === 0}
                  stickyCols={stickyCols || 1}
                  zebra={useZebra}
                  density={density}
                  sheetScroll
                  data-testid="report-data-table"
                  aria-label={REPORTS.find((r) => r.name === selected)?.label ?? "Report"}
                >
                  <TableCaption>
                    {REPORTS.find((r) => r.name === selected)?.label ?? "Report"} data grid
                  </TableCaption>
                  <THead>
                    <TR>
                      {viewColumns.map((c, ci) => (
                        <TH
                          key={`${ci}:${c}`}
                          data-testid={`report-th-${ci}`}
                          className={cn(
                            viewNumeric.has(ci) ? "desk-num text-right" : "text-left",
                            isEmphasisColumn(c) && "text-[var(--color-foreground)]",
                            canSortHeader && "cursor-pointer hover:text-[var(--color-foreground)]"
                          )}
                          onClick={canSortHeader ? () => toggleSort(ci) : undefined}
                          aria-sort={
                            canSortHeader && sort?.col === ci ? (sort.dir === "asc" ? "ascending" : "descending") : "none"
                          }
                          title={canSortHeader ? "Click to sort" : undefined}
                        >
                          <span
                            className={cn(
                              "inline-flex w-full items-center gap-1",
                              viewNumeric.has(ci) ? "justify-end" : "justify-start"
                            )}
                          >
                            {columnLabel(c)}
                            {canSortHeader && sort?.col === ci ? (
                              <span aria-hidden="true">{sort.dir === "asc" ? "↑" : "↓"}</span>
                            ) : null}
                          </span>
                        </TH>
                      ))}
                    </TR>
                  </THead>
                  <TBody>
                    {visibleRows.length === 0 ? (
                      <TR>
                        <TD colSpan={Math.max(1, viewColumns.length)} className="py-10 text-center" data-testid="report-empty">
                          <p className="text-sm font-semibold text-[var(--color-foreground)]">Nothing to show for these filters</p>
                          <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
                            {rowQuery.trim()
                              ? `No rows contain "${rowQuery.trim()}". Clear the search box to see every row.`
                              : isAirfareAllocationReport(selected)
                                ? `No amount-balance rows for ${fmtDate(allocationPeriodFrom)} → ${fmtDate(allocationAsOf)}. Clear department / sub section / Bahraini filters, or try YTD.`
                                : appliedRange.from || appliedRange.to
                                  ? `No records between ${appliedRange.from ? fmtDate(appliedRange.from) : "the start"} and ${
                                      appliedRange.to ? fmtDate(appliedRange.to) : "today"
                                    }. Try a wider period or clear some filters.`
                                  : "No records match the filters. Try clearing some filters."}
                          </p>
                          {!rowQuery.trim() && isAirfareAllocationReport(selected) ? (
                            <Button
                              variant="outline"
                              className="mt-3"
                              data-testid="report-empty-widen"
                              onClick={() => {
                                clearPayableFilters();
                              }}
                            >
                              Clear filters · YTD
                            </Button>
                          ) : !rowQuery.trim() && (appliedRange.from || appliedRange.to) && selected && !TT_REPORTS.has(selected) ? (
                            <Button
                              variant="outline"
                              className="mt-3"
                              data-testid="report-empty-widen"
                              onClick={() => {
                                setStdEmployeeIds([]);
                                setStdDepartments([]);
                                setStdSubSections([]);
                                setStdCompanyIds([]);
                                setStdPayGroups([]);
                                setStdStatuses([]);
                                setStdLeaveStatuses([]);
                                setStdOneWayPurposes([]);
                                setStdDateTo("");
                                setStdYear("");
                                setStdDesignation("");
                                setStdEmpStatus("");
                                setStdAsOf("");
                                setCommStatuses([]);
                                setCommEmployeeIds([]);
                                setCommDepartments([]);
                                setCommPayGroups([]);
                                setBiGroupBy("employee");
                                setBiEmployeeIds([]);
                                setBiDepartments([]);
                                setBiDesignation("");
                                setBiStatuses([]);
                                setBiAmountMin("");
                                setBiAmountMax("");
                                setBiVoucherNo("");
                                setBiCurrency("");
                                setBiPayGroups([]);
                                setRange(rangeFromPreset("all"));
                                const widen =
                                  selected && COMMISSION_BI_REPORTS.has(selected)
                                    ? "?group_by=employee"
                                    : "";
                                applyFilters(widen);
                              }}
                            >
                              Show all dates
                            </Button>
                          ) : null}
                        </TD>
                      </TR>
                    ) : null}
                    {visibleRows.map((row) => {
                      if (row.kind === "group") {
                        const closed = isCollapsed(row.group ?? "");
                        return (
                          <TR key={row.key} className="bg-[var(--color-primary-muted)]" data-testid="report-group-row">
                            <TD colSpan={viewColumns.length} className="py-2 font-semibold text-[var(--color-foreground)]">
                              <button
                                type="button"
                                className="inline-flex items-center gap-1.5"
                                aria-expanded={!closed}
                                onClick={() => toggleGroup(row.group ?? "")}
                              >
                                <ChevronDown
                                  size={14}
                                  aria-hidden="true"
                                  className={cn("no-print transition-transform", closed && "-rotate-90")}
                                />
                                {reportColumns[activeView.group]}: {row.group}
                                <span className="font-normal text-[var(--color-muted-foreground)]">
                                  ({num(row.count)})
                                </span>
                              </button>
                            </TD>
                          </TR>
                        );
                      }
                      if (row.kind === "data" && row.group && isCollapsed(row.group)) return null;
                      const computed =
                        row.kind === "subtotal" || activeView.layout === "summary" || activeView.layout === "share";
                      const canPickHero = isAllocationReport && row.kind === "data";
                      const heroSelected = canPickHero && allocationHeroKey === row.key;
                      const leaveStatusIdx = viewColumns.findIndex((c) =>
                        /^leave status$/i.test(c.trim())
                      );
                      const returnedOnIdx = viewColumns.findIndex((c) =>
                        /^(returned on|back\s*\/\s*cancelled on|return\s*\/\s*cancel on)$/i.test(
                          c.trim()
                        )
                      );
                      const leaveReturned =
                        (selected === "ticket-register" || selected === "travel-summary") &&
                        row.kind === "data" &&
                        ((leaveStatusIdx >= 0 &&
                          String(row.cells[leaveStatusIdx] ?? "")
                            .trim()
                            .toLowerCase() === "returned") ||
                          (returnedOnIdx >= 0 &&
                            String(row.cells[returnedOnIdx] ?? "").trim() !== "" &&
                            leaveStatusIdx >= 0 &&
                            String(row.cells[leaveStatusIdx] ?? "")
                              .trim()
                              .toLowerCase() === "returned"));
                      return (
                        <TR
                          key={row.key}
                          data-testid={row.kind === "subtotal" ? "report-subtotal-row" : undefined}
                          className={cn(
                            row.kind === "subtotal"
                              ? "border-t border-[var(--color-primary)]/40 bg-[var(--color-background)] font-semibold"
                              : undefined,
                            leaveReturned &&
                              "bg-[var(--color-success-muted)] text-[var(--color-success)]",
                            canPickHero && "cursor-pointer hover:bg-[var(--color-primary-muted)]/50",
                            heroSelected && "bg-[var(--color-primary-muted)]"
                          )}
                          onClick={
                            canPickHero
                              ? () => setAllocationHeroKey((prev) => (prev === row.key ? null : row.key))
                              : undefined
                          }
                          aria-selected={heroSelected || undefined}
                        >
                          {viewColumns.map((colName, j) => {
                            const cell = row.cells[j];
                            const numeric = viewNumeric.has(j);
                            const leaveEndDateCol =
                              (selected === "ticket-register" ||
                                selected === "travel-summary") &&
                              /^leave end date$/i.test(colName.trim());
                            const leaveEndRaw = leaveEndDateCol
                              ? String(cell ?? "").trim()
                              : "";
                            const leaveEndIsPurpose =
                              leaveEndDateCol &&
                              /^(cancellation|return booked later|return back ticket)$/i.test(
                                leaveEndRaw
                              );
                            const leaveEndIsDate =
                              leaveEndDateCol && /^\d{4}-\d{2}-\d{2}/.test(leaveEndRaw);
                            const leaveStatusCol =
                              (selected === "ticket-register" ||
                                selected === "travel-summary") &&
                              /^leave status$/i.test(colName.trim());
                            const leaveKey = leaveStatusCol ? normalizeLeaveStatus(cell) : "";
                            const ticketStatusCol =
                              (selected === "ticket-register" ||
                                selected === "travel-summary") &&
                              /^(status|application status)$/i.test(colName.trim());
                            const ticketStatusVal = ticketStatusCol
                              ? String(cell ?? "").trim()
                              : "";
                            const oneWayStatusCol = false;
                            const oneWayVal = String(cell ?? "").trim().toLowerCase();
                            return (
                              <TD
                                key={j}
                                className={cn(
                                  numeric && "desk-num tracking-tight",
                                  isEmphasisColumn(colName) && numeric && "font-semibold text-[var(--color-foreground)]",
                                  /name/i.test(colName) && "min-w-[11rem] font-medium",
                                  isDateColumn(colName) && !leaveEndIsPurpose && "whitespace-nowrap",
                                  leaveEndIsDate &&
                                    !leaveReturned &&
                                    "font-semibold text-[var(--color-destructive)]",
                                  COMMISSION_BI_REPORTS.has(selected as ReportName) && j === 0
                                    ? "font-semibold text-[var(--color-foreground)]"
                                    : activeView.layout === "summary" && j === 0
                                      ? "font-semibold text-[var(--color-foreground)]"
                                      : ""
                                )}
                              >
                                {leaveEndIsPurpose ? (
                                  <Badge
                                    variant={
                                      /^cancellation$/i.test(leaveEndRaw)
                                        ? "destructive"
                                        : /^return back ticket$/i.test(leaveEndRaw)
                                          ? "secondary"
                                          : "info"
                                    }
                                    data-testid="ticket-register-one-way-purpose"
                                    data-status-pill=""
                                  >
                                    {leaveEndRaw}
                                  </Badge>
                                ) : oneWayStatusCol && oneWayVal ? (
                                  <Badge
                                    variant={oneWayVal === "cancellation" ? "destructive" : "info"}
                                    data-testid="travel-summary-one-way-status"
                                    data-status-pill=""
                                  >
                                    {String(cell)}
                                  </Badge>
                                ) : leaveStatusCol ? (
                                  leaveKey ? (
                                    <Badge
                                      variant={leaveStatusVariant(cell)}
                                      data-status-pill=""
                                      data-testid={
                                        selected === "travel-summary"
                                          ? "travel-summary-leave-status"
                                          : "ticket-register-leave-status"
                                      }
                                    >
                                      {formatLeaveStatusLabel(cell)}
                                    </Badge>
                                  ) : (
                                    formatLeaveStatusLabel(cell)
                                  )
                                ) : ticketStatusCol && ticketStatusVal ? (
                                  <Badge
                                    variant={ticketWorkflowVariant(ticketStatusVal)}
                                    data-status-pill=""
                                    data-testid={
                                      selected === "travel-summary"
                                        ? "travel-summary-status"
                                        : "ticket-register-status"
                                    }
                                  >
                                    {ticketWorkflowStatusLabel(ticketStatusVal)}
                                  </Badge>
                                ) : typeof cell === "number" && /%$/.test(colName.trim()) ? (
                                  shareCell(colName, cell)
                                ) : computed ? (
                                  cell == null ? "" : fmtReportCell(colName, cell)
                                ) : (
                                  fmtReportCell(colName, cell)
                                )}
                              </TD>
                            );
                          })}
                        </TR>
                      );
                    })}
                  </TBody>
                  {totalsRow ? (
                    <tfoot data-testid="report-totals-row">
                      <tr className="border-t-2 border-[var(--color-primary)] bg-[var(--color-primary-muted)] font-bold">
                        {viewColumns.map((colName, j) => {
                          const sum = totalsRow[j];
                          return (
                            <TD
                              key={j}
                              className={cn(
                                viewNumeric.has(j) && "desk-num tracking-tight",
                                isEmphasisColumn(colName) && "font-semibold"
                              )}
                            >
                              {j === 0
                                ? "Total"
                                : sum == null
                                  ? ""
                                  : /%$/.test(colName.trim())
                                    ? shareCell(colName, Number(sum))
                                    : fmtReportCell(colName, sum)}
                            </TD>
                          );
                        })}
                      </tr>
                    </tfoot>
                  ) : null}
                </Table>
                )}
              </>
            )}
          </CardContent>
        </Card>
      ) : null}

      {selected ? null : (
      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles size={18} /> Report designer
          </CardTitle>
          <CardDescription data-testid="report-designer">
            <strong>Native banded designer</strong> (header / detail / footer columns) — pick a dataset,
            toggle columns, preview, save a template, then export PDF/Excel. This is the working designer on
            :3389.
            {crystal.data?.configured ? (
              <span className="block mt-1 text-[var(--color-success)]">
                Optional SAP Crystal BIP bridge is also configured ({crystal.data.bip_url || "BIP"}).
              </span>
            ) : (
              <span className="block mt-1">
                SAP Crystal Reports BIP is <em>not required</em>
                {crystal.data?.note ? ` — ${crystal.data.note}` : " (support ends Dec 2026)"}. Use native
                Export below.
              </span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Title">
              <Input value={designerTitle} onChange={(e) => setDesignerTitle(e.target.value)} />
            </Field>
            <Field label="Dataset">
              <Select
                value={designerDataset}
                onChange={(e) => {
                  setDesignerDataset(e.target.value as ReportName);
                  setSelectedColumns([]);
                  setActiveTemplateId(null);
                }}
              >
                {REPORTS.map((r) => (
                  <option key={r.name} value={r.name}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Saved templates">
              <Select
                value={activeTemplateId ?? ""}
                onChange={(e) => {
                  const tpl = templates.data?.find((t) => t.id === e.target.value);
                  if (tpl) loadTemplate(tpl);
                  else setActiveTemplateId(null);
                }}
              >
                <option value="">— New / catalog —</option>
                {(templates.data ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                    {t.is_system ? " (system)" : ""}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
              Detail band columns
            </p>
            <div className="flex flex-wrap gap-2">
              {availableColumns.map((column) => {
                const on = selectedColumns.includes(column);
                return (
                  <button
                    key={column}
                    type="button"
                    onClick={() => toggleColumn(column)}
                    className={cn(
                      "rounded-md border px-2.5 py-1 text-xs font-medium",
                      on
                        ? "border-[var(--color-primary)] bg-[var(--color-primary-muted)] text-[var(--color-primary)]"
                        : "border-[var(--color-border)] text-[var(--color-muted-foreground)]"
                    )}
                  >
                    {column}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="gradient"
              disabled={saveMutation.isPending || !selectedColumns.length}
              onClick={() => saveMutation.mutate()}
            >
              {saveMutation.isPending ? t("state.saving") : activeTemplateId ? "Update template" : "Save template"}
            </Button>
            <Button
              variant="outline"
              disabled={!canExportReports}
              title={canExportReports ? undefined : "Export requires admin, HR, finance, or auditor"}
              onClick={() =>
                download(`/reports/export/${designerDataset}.xlsx`, `${designerDataset}.xlsx`)
              }
            >
              <Download size={14} /> Export Excel
            </Button>
            <Button
              variant="outline"
              disabled={!canExportReports}
              title={canExportReports ? undefined : "Export requires admin, HR, finance, or auditor"}
              onClick={() =>
                download(`/reports/export/${designerDataset}.pdf`, `${designerDataset}.pdf`)
              }
            >
              <Download size={14} /> Export PDF
            </Button>
            {activeTemplateId ? (
              <>
                <Button
                  variant="outline"
                  onClick={() =>
                    download(`/report-templates/${activeTemplateId}/run?format=xlsx`, `${designerTitle}.xlsx`)
                  }
                >
                  <Download size={14} /> Run saved Excel
                </Button>
                <Button
                  variant="outline"
                  onClick={() =>
                    download(`/report-templates/${activeTemplateId}/run?format=pdf`, `${designerTitle}.pdf`)
                  }
                >
                  <Download size={14} /> Run saved PDF
                </Button>
              </>
            ) : null}
            {crystal.data?.configured ? (
              <Badge variant="success">Crystal BIP ready</Badge>
            ) : (
              <Badge variant="secondary">Native designer (BIP optional)</Badge>
            )}
          </div>

          <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--color-border)]">
            {catalogPreview.isPending ? (
              <TableSkeleton columns={5} rows={5} label={t("state.loading")} />
            ) : (
              <Table stickyFirst>
                <THead>
                  <TR>
                    {selectedColumns.map((c) => (
                      <TH key={c}>{c}</TH>
                    ))}
                  </TR>
                </THead>
                <TBody>
                  {previewRows.map((row, i) => (
                    <TR key={i}>
                      {row.map((cell, j) => (
                        <TD key={j}>{fmtGridCell(cell)}</TD>
                      ))}
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </div>
        </CardContent>
      </Card>
      )}
    </div>
  );
}

export default function ReportsRoute() {
  return (
    <Suspense fallback={<TableSkeleton columns={4} rows={6} label="Loading reports…" />}>
      <ReportsPage />
    </Suspense>
  );
}
