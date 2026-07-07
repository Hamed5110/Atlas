"use client";

import { readSheet } from "read-excel-file/browser";
import writeXlsxFile from "write-excel-file/browser";
import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import {
  Activity,
  AlertTriangle,
  Bell,
  Bot,
  Building2,
  CalendarClock,
  CheckCircle,
  CheckCircle2,
  ClipboardCheck,
  CreditCard,
  Database,
  Download,
  FileDown,
  Eye,
  HelpCircle,
  Info,
  LayoutDashboard,
  ListPlus,
  LogOut,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Palette,
  Pencil,
  Plane,
  Plus,
  Printer,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Sun,
  Trash2,
  TrendingUp,
  Upload,
  Users,
  WalletCards,
  X
} from "lucide-react";
import {
  Allocation,
  AllocationAttachment,
  AllocationEligibilityReview,
  AirfarePolicyRate,
  atlasApiBase,
  atlasFetch,
  atlasHealth,
  atlasLogin,
  atlasMutation,
  AtlasSession,
  AtlasUser,
  calculateExcelTotal,
  calculateRemainingDays,
  closingBalanceDays,
  Company,
  Employee,
  Loan,
  LoanSummary,
  YearSummary
} from "../lib/atlas-api";
import { calculateAirfare } from "../lib/airfare-engine";

type ViewKey = "Overview" | "Employees" | "Opening Balance" | "Airfare" | "Employee Self-Service" | "Loans" | "Year End" | "Reports" | "Companies" | "Preferences" | "AI Insights" | "Security" | "Support";
type ReportDrillType = "employee" | "allocation" | "loan" | "company";

type ReportRow = Record<string, unknown> & {
  __recordType?: ReportDrillType;
  __recordId?: number;
  __rowKind?: "detail" | "subtotal" | "grand-total";
};
type AirfarePolicyDeleteResult = {
  message: string;
  action?: string;
  policyRate: AirfarePolicyRate | null;
  alreadyRemoved?: boolean;
  alreadyHistorical?: boolean;
};
type EmployeeSelfServiceSummary = {
  setupRequired: boolean;
  canSelectEmployee?: boolean;
  message?: string;
  employee: null | {
    EmployeeID: number;
    EmployeeCode: string;
    FullName: string;
    Department?: string;
    Designation?: string;
    PortalRole?: string;
  };
  entitlement: null | {
    AirfareEntitlementAmount: number;
    PayableBHD: number;
    MaximumPayoutCap: number;
    VerificationNote?: string;
  };
  openRequests: number;
};
type EmployeeAllowanceRequest = {
  RequestID: number;
  RequestNo: string;
  EmployeeID: number;
  EmployeeCode?: string;
  FullName?: string;
  TravelFromDate?: string;
  TravelToDate?: string;
  Origin?: string;
  Destination: string;
  TripType: string;
  CabinClass: string;
  EstimatedCostBHD: number;
  EntitlementAtRequestBHD?: number;
  PayableAtRequestBHD?: number;
  OverageToLoanBHD?: number;
  ApprovalStatus: string;
  LinkedAllocationID?: number;
  CreatedAt?: string;
};
type DisplayedReport = {
  title: string;
  columns: string[];
  rows: ReportRow[];
  totalColumns?: string[];
  groupBy?: string;
};
type EmployeeImportRow = ReturnType<typeof mapEmployeeExcelRow> & {
  importKey: string;
  importBatchRowId?: number;
  sourceRow: number;
  selected: boolean;
  validationStatus: "Ready" | "Review";
  validationNotes: string[];
  sqlSeverity?: "READY" | "WARNING" | "ERROR";
  sqlAction?: string;
  sqlMessage?: string;
};
type ImportPreview = {
  importBatchId?: number;
  fileName: string;
  headers: string[];
  normalizedHeaders: string[];
  employees: EmployeeImportRow[];
  summary?: {
    totalRows: number;
    readyRows: number;
    warningRows: number;
    errorRows: number;
    selectedRows: number;
  };
};
type OpeningBalancePreview = {
  importBatchId?: number;
  fileName: string;
  rows: Array<{
    importBatchRowId?: number;
    sourceRow?: number;
    employeeCode: string;
    employeeName?: string;
    year: number;
    openingDays: number;
    openingBhd: number;
    maximumPayout: number;
    selected?: boolean;
    severity?: "READY" | "WARNING" | "ERROR";
    action?: string;
    message?: string;
  }>;
  summary?: {
    totalRows: number;
    readyRows: number;
    warningRows: number;
    errorRows: number;
    selectedRows: number;
  };
};
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
  RiskID?: number;
  Area: string;
  Severity: "CRITICAL" | "WARNING" | "INFO" | string;
  Title: string;
  Detail?: string;
  Recommendation: string;
  TargetView?: ViewKey;
  TargetRecordType?: string;
  TargetRecordID?: number | string | null;
};
type IntelligenceControlCenter = {
  summary: IntelligenceSummary;
  risks: IntelligenceItem[];
  recommendations: IntelligenceItem[];
};
type BackupFileInfo = {
  fileName: string;
  backupFile: string;
  databaseName: string;
  sizeBytes: number;
  createdAt: string;
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
  CheckID?: number;
  Area: string;
  CheckCode: string;
  Severity: "CRITICAL" | "WARNING" | "INFO" | string;
  Status: "PASS" | "WARN" | "FAIL" | string;
  Title: string;
  Detail: string;
  EvidenceCount?: number;
  TargetView?: ViewKey;
  TargetRecordType?: string;
  TargetRecordID?: number | string | null;
};
type SystemVerification = {
  summary: VerificationSummary;
  checks: VerificationCheck[];
};
type DiagnosticState = "IDLE" | "UP" | "DEGRADED" | "DOWN";
type DiagnosticCheck = {
  key: string;
  name: string;
  type: string;
  success: boolean;
  latencyMs: number;
  thresholdMs?: number;
  status: DiagnosticState;
  detail?: string;
  services?: Array<{
    name: string;
    url?: string;
    status: DiagnosticState;
    latencyMs?: number;
    httpStatus?: number;
    error?: string;
  }>;
};
type SystemDiagnostics = {
  status: DiagnosticState;
  checkedAt: string;
  latencyMs: number;
  checks: DiagnosticCheck[];
};
type SystemIntegrityPlan = {
  title: string;
  status: string;
  targetView?: ViewKey;
  checks: number;
  evidenceCount: number;
  codes: string[];
};
type SystemIntegrityAction = {
  priority: "High" | "Medium" | string;
  source: string;
  title: string;
  detail: string;
  targetView?: ViewKey | null;
  targetRecordType?: string | null;
  targetRecordID?: number | string | null;
};
type NotificationItem = {
  title: string;
  detail: string;
  tone: "warning" | "info" | "success";
  actionLabel?: string;
  targetView?: ViewKey;
};
type SystemIntegrityModel = {
  modelName: string;
  mode: string;
  rulesLocked: boolean;
  formulaPolicy: string;
  generatedAt: string;
  currentYear: number;
  integrityStatus: string;
  integrityScore: number;
  controlSignals: {
    intelligenceStatus?: string;
    verificationStatus?: string;
    diagnosticsStatus?: DiagnosticState;
    failedChecks?: number;
    warningChecks?: number;
    riskItems?: number;
    diagnosticIssues?: number;
  };
  automationPlan: SystemIntegrityPlan[];
  actionQueue: SystemIntegrityAction[];
};
type AirfarePayableReportRow = {
  EmployeeID: number;
  EmployeeCode: string;
  FullName: string;
  Department?: string;
  Section?: string;
  Designation?: string;
  JoinDate?: string;
  Status?: string;
  ReportYear: number;
  AsOfDate: string;
  AnnualEntitlementDays: number;
  AnnualEntitlementBHD: number;
  PerDayRate: number;
  MaximumPayoutCap?: number;
  OpeningBalanceDays: number;
  OpeningBalanceBHD: number;
  CurrentYearEarnedDays: number;
  CurrentYearEarnedBHD: number;
  TicketAmountCurrentYear: number;
  CompanyPaidCurrentYear: number;
  EmployeePaidCurrentYear: number;
  LoanAmountCurrentYear: number;
  PaidDaysCurrentYear: number;
  BalanceDays: number;
  PayableBHD: number;
  AirfareEntitlementAmount: number;
  CurrentYearRemainingBHD: number;
  VerificationNote?: string;
};
type YearEndPreview = {
  closedYear: number;
  nextYear: number;
  closingDate: string;
  employeeCount: number;
  balancesCarried: number;
  totalOpeningBalance: number;
  totalClosingDays?: number;
  pendingLoanCount?: number;
  pendingLoanAmount?: number;
  totals?: { TotalAllocations?: number; LoansCreated?: number; TotalLoansCreated?: number; EmergencyTickets?: number; TotalEmergencyTickets?: number; PendingLoans?: number; PendingLoanAmount?: number };
  employees?: Array<{
    EmployeeID: number;
    EmployeeCode: string;
    FullName: string;
    OpeningDays: number;
    OpeningBHD: number;
    CurrentYearEarnedDays?: number;
    CurrentYearEarnedBHD?: number;
    PaidDays?: number;
    PaidAmount?: number;
    ClosingDays: number;
    ClosingBHD: number;
    PendingLoanCount?: number;
    PendingLoanAmount?: number;
    PendingMonthlyEMI?: number;
    CloseStatus?: string;
    MaximumPayout: number;
  }>;
  yearEndId?: number;
};
type LoanEmiPreview = {
  paymentDate: string;
  selected: number | "all-active";
  processed: number;
  totalDeducted: number;
  rows: Array<{
    LoanID: number;
    EmployeeCode: string;
    FullName: string;
    RemainingBalance: number;
    EMI: number;
    NextDeduction: number;
    BalanceAfter: number;
  }>;
};
type LoanEmiReturnPreview = {
  selected: number;
  reversible: number;
  totalReturned: number;
  rows: Array<{
    LoanID: number;
    EmployeeCode: string;
    FullName: string;
    Status: string;
    RemainingBalance: number;
    TotalPaid: number;
    MonthsPaid: number;
    HistoryID?: number;
    PaymentDate?: string;
    AmountToReturn?: number;
    BalanceAfterReturn?: number;
    TotalPaidAfterReturn?: number;
    ReturnStatus: string;
  }>;
};

const nav: { label: ViewKey; icon: React.ElementType }[] = [
  { label: "Overview", icon: LayoutDashboard },
  { label: "Employees", icon: Users },
  { label: "Opening Balance", icon: ListPlus },
  { label: "Airfare", icon: Plane },
  { label: "Employee Self-Service", icon: ClipboardCheck },
  { label: "Loans", icon: WalletCards },
  { label: "Year End", icon: CalendarClock },
  { label: "Reports", icon: FileDown },
  { label: "Companies", icon: Building2 },
  { label: "Preferences", icon: Settings },
  { label: "AI Insights", icon: Bot },
  { label: "Security", icon: ShieldCheck },
  { label: "Support", icon: HelpCircle }
];

const money = new Intl.NumberFormat("en-BH", { style: "currency", currency: "BHD", maximumFractionDigits: 2 });
const today = new Date().toISOString().slice(0, 10);
const SESSION_STORAGE_KEY = "atlas.session";
const UI_PREFERENCES_STORAGE_KEY = "atlas.ui.preferences";
const QUICK_ADD_OPTIONS_STORAGE_KEY = "atlas.employee.reference.values";
const SESSION_TIMEOUT_MS = 35 * 60 * 1000;
const AIRFARE_STANDARD_YEAR_DAYS = 360;
const AIRFARE_ENTITLEMENT_CYCLE_DAYS = 720;
const AIRFARE_MAX_DAYS = 60;
const AIRFARE_DEFAULT_PAYOUT = 150;
const ESS_ONLY_VIEW: ViewKey = "Employee Self-Service";
const paymentModeLabels: Record<string, string> = {
  entitlement: "Airfare entitlement amount",
  company: "Paid by company",
  company_full: "Full paid by company",
  employee: "Paid by self employee",
  employee_full: "Paid by self employee full",
  loan: "Loan for excess"
};
function formatPaymentModeLabel(mode: unknown) {
  const key = String(mode || "").trim();
  if (!key) return "-";
  return paymentModeLabels[key] || key.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function toEmployeeLifecycleStatus(value: string | null | undefined) {
  const raw = String(value || "Active").trim();
  const normalized = raw.toLowerCase().replace(/[\s-]/g, "");
  if (normalized === "inactive") return raw.includes("-") ? "In-active" : "Inactive";
  if (normalized === "probation") return "Probation";
  if (normalized === "resign") return "Resign";
  if (normalized === "resigned") return "Resigned";
  if (normalized === "separated") return "Separated";
  return "Active";
}

function isAirfareEligibleEmployeeStatus(value: string | null | undefined) {
  return toEmployeeLifecycleStatus(value) === "Active";
}

function buildAllocationSettlementRows(allocation: Allocation) {
  const rows = [
    { label: "Ticket amount", value: allocation.TicketCost || 0, show: true },
    { label: "Entitlement used", value: allocation.Entitlement || 0, show: Number(allocation.Entitlement || 0) > 0 },
    { label: "Company paid", value: allocation.CompanyPaid || 0, show: Number(allocation.CompanyPaid || 0) > 0 },
    { label: "Employee paid", value: allocation.EmployeePaid || 0, show: Number(allocation.EmployeePaid || 0) > 0 },
    { label: "Loan amount", value: allocation.LoanAmount || 0, show: Number(allocation.LoanAmount || 0) > 0 },
    { label: "Open balance", value: allocation.ExcessAmount || 0, show: Number(allocation.ExcessAmount || 0) > 0 }
  ];
  return rows.filter((row) => row.show);
}

function formatBackupSize(sizeBytes: number) {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return "0 KB";
  if (sizeBytes >= 1024 * 1024) return `${(sizeBytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.ceil(sizeBytes / 1024)} KB`;
}

function normalizeWhatsAppNumber(value: string) {
  return String(value || "").replace(/[^\d]/g, "");
}

function buildWhatsAppUrl(number: string, message: string) {
  const cleanNumber = normalizeWhatsAppNumber(number);
  if (!cleanNumber) return "";
  return `https://wa.me/${cleanNumber}?text=${encodeURIComponent(message)}`;
}

function formatWhatsAppDisplayNumber(value: string) {
  const cleanNumber = normalizeWhatsAppNumber(value);
  return cleanNumber ? `+${cleanNumber}` : "-";
}

function getInitials(name: string) {
  const initials = String(name || "AT")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  return initials || "AT";
}

const reportOptions = [
  { value: "allocations", label: "Airfare Allocation" },
  { value: "loans", label: "Loans" },
  { value: "employees", label: "Employee Master" },
  { value: "airfare", label: "Airfare Payable" },
  { value: "airfare_summary", label: "Airfare Payable Summary" },
  { value: "airfare_exceptions", label: "Airfare Payable Exceptions" },
  { value: "airfare_policy", label: "Airfare Policy Rules" },
  { value: "companies", label: "Companies" },
  { value: "dashboard", label: "Dashboard" }
];

const defaultWorkOptions = {
  company: ["AKNAN", "ARKAN GLASS W.L.L", "ATLAS ALUMINUM", "ENAL TRADING", "HASAN ABDULLA EST.", "NEPTON"],
  department: [
    "Administration Department",
    "Aknan Furniture",
    "Aknan Kitchen",
    "Atlas Aluminum",
    "Design Department",
    "Enal Trading",
    "Finance Department",
    "Hr Department",
    "IT Department",
    "Marketing Department",
    "Procurement Department",
    "Production Department",
    "Project Management",
    "Sales Department"
  ],
  branch: ["ATLAS ALUMINUM", "AKNAN", "ARKAN GLASS W.L.L", "ENAL TRADING", "Hamalah", "Salmabad", "Tubli"],
  section: ["AKNAN-FURNITURE", "AKNAN-KITCHEN", "ARKAN-FACTORY", "ATLAS-FACTORY", "ATLAS-FACTORY-ASKER", "ATLAS-INSTALLATION", "COATING", "MAIN OFFICE", "SHOWROOM", "WAREHOUSE"],
  location: ["Hamalah", "Salmabad", "Tubli"],
  designation: [
    "Administrative Coordinator",
    "Assembler",
    "Assembly Leader",
    "CNC Operator",
    "Carpenter",
    "Coating Machinist",
    "Customer Support Executive",
    "Cutter Man",
    "Design Associate",
    "Design Professional",
    "Driver",
    "Fabricator",
    "Field Installer",
    "General Manager",
    "HR Associate",
    "HR Manager",
    "Helper",
    "IT Associate",
    "Laborer",
    "Office assistant",
    "Production Manager",
    "Sales Executive",
    "Supervisor"
  ],
  group: ["Enal Pay Group", "Enal Sales Group", "Hasan Abdulla Est. Pay", "Nepton Pay Group", "Nepton Workers Group", "New Pay Group", "New Sales Paygroup", "New Worker Paygroup"],
  status: ["Active", "In-active", "Inactive", "Probation", "Resign", "Resigned", "Separated"]
};

type QuickAddOptionKey = keyof typeof defaultWorkOptions | "jobBand" | "nationality" | "reportingTo";
type QuickAddOptions = Record<QuickAddOptionKey, string[]>;
type EmployeeFormReferenceField = "company" | "department" | "branch" | "section" | "location" | "designation" | "group" | "payrollStatus" | "jobBand" | "nationality" | "reportingTo";

const quickAddOptionKeys: QuickAddOptionKey[] = ["company", "department", "branch", "section", "location", "designation", "group", "status", "jobBand", "nationality", "reportingTo"];

function emptyQuickAddOptions(): QuickAddOptions {
  return {
    company: [],
    department: [],
    branch: [],
    section: [],
    location: [],
    designation: [],
    group: [],
    status: [],
    jobBand: [],
    nationality: [],
    reportingTo: []
  };
}

const emptyEmployeeForm = () => ({
  code: "",
  name: "",
  bankCode: "",
  jobBand: "",
  joinDate: today,
  cpr: "",
  passport: "",
  department: "",
  branch: "",
  company: "",
  section: "",
  location: "",
  designation: "",
  group: "",
  reportingTo: "",
  nationality: "",
  bahrainiNational: "No",
  payrollStatus: "Permanent",
  accountNumber: "",
  passportExpiryDate: "",
  email: "",
  whatsappNumber: "",
  basicSalary: "",
  hra: "",
  specialDutyAllowance: "",
  carAllowance: "",
  petrolAllowance: "",
  phoneAllowance: "",
  grossSalary: "",
  gosiDeduction: "",
  averageSalary: "",
  religion: "",
  serialNo: "",
  lastWorkingDate: "",
  openingDays: "",
  openingBhd: "",
  paidDays: "0",
  maximumPayout: "150",
  totalWorkingDays: "360"
});

const emptyAllocationForm = () => ({
  employeeId: "",
  date: today,
  year: new Date().getFullYear().toString(),
  ticketCost: "0",
  paymentMode: "entitlement",
  decision: "process",
  overrideReason: "",
  managerApproval: "",
  emergency: false,
  loanTenure: "6",
  leaveStart: "",
  leaveEnd: "",
  route: "",
  ticketNo: "",
  supplier: "",
  invoiceNo: "",
  remarks: ""
});

export default function DashboardPage() {
  const [activeView, setActiveView] = useState<ViewKey>("Overview");
  const [session, setSession] = useState<AtlasSession | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeMasterAll, setEmployeeMasterAll] = useState<Employee[]>([]);
  const [employeeMasterStatusScope, setEmployeeMasterStatusScope] = useState<"active" | "inactive" | "all">("active");
  const [loans, setLoans] = useState<Loan[]>([]);
  const [loanSummary, setLoanSummary] = useState<LoanSummary | null>(null);
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [airfarePolicyRates, setAirfarePolicyRates] = useState<AirfarePolicyRate[]>([]);
  const [selfServiceSummary, setSelfServiceSummary] = useState<EmployeeSelfServiceSummary | null>(null);
  const [selfServiceRequests, setSelfServiceRequests] = useState<EmployeeAllowanceRequest[]>([]);
  const [selfServiceAlerts, setSelfServiceAlerts] = useState<EmployeeAllowanceRequest[]>([]);
  const [selfServiceEmployeeId, setSelfServiceEmployeeId] = useState("");
  const [allocationAttachments, setAllocationAttachments] = useState<Record<number, AllocationAttachment[]>>({});
  const [users, setUsers] = useState<AtlasUser[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [summary, setSummary] = useState<YearSummary | null>(null);
  const [intelligence, setIntelligence] = useState<IntelligenceControlCenter | null>(null);
  const [verification, setVerification] = useState<SystemVerification | null>(null);
  const [systemIntegrity, setSystemIntegrity] = useState<SystemIntegrityModel | null>(null);
  const [diagnostics, setDiagnostics] = useState<SystemDiagnostics | null>(null);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false);
  const [airfarePayableReport, setAirfarePayableReport] = useState<AirfarePayableReportRow[]>([]);
  const [status, setStatus] = useState("Checking API");
  const [showSyncStatus, setShowSyncStatus] = useState(true);
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [rightPanelsCollapsed, setRightPanelsCollapsed] = useState(false);
  const [reportChecksCollapsed, setReportChecksCollapsed] = useState(false);
  const [employeeFormOpen, setEmployeeFormOpen] = useState(false);
  const [recentAllocationsOpen, setRecentAllocationsOpen] = useState(false);
  const [employeeMasterSearch, setEmployeeMasterSearch] = useState("");
  const [allocationEmployeeSearch, setAllocationEmployeeSearch] = useState("");
  const [allocationEmployeeType, setAllocationEmployeeType] = useState("");
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<Set<number>>(new Set());
  const [themeMode, setThemeMode] = useState<"light" | "dark">("light");
  const [themeAccent, setThemeAccent] = useState<"blue" | "emerald" | "slate">("blue");
  const [uiDensity, setUiDensity] = useState<"comfortable" | "standard" | "compact">("standard");
  const [showNotifications, setShowNotifications] = useState(false);
  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [loginLogoUrl, setLoginLogoUrl] = useState("");
  const [companyLogoUrl, setCompanyLogoUrl] = useState("");
  const [editingEmployeeId, setEditingEmployeeId] = useState<number | null>(null);
  const [editingAllocationId, setEditingAllocationId] = useState<number | null>(null);
  const [editingLoanId, setEditingLoanId] = useState<number | null>(null);
  const [editingUserId, setEditingUserId] = useState<number | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [openingPreview, setOpeningPreview] = useState<OpeningBalancePreview | null>(null);
  const employeeImportRef = useRef<HTMLInputElement | null>(null);
  const openingImportRef = useRef<HTMLInputElement | null>(null);
  const [loginForm, setLoginForm] = useState({ company: "ATLAS", username: "", password: "", remember: true });
  const [busy, setBusy] = useState(false);
  const [calcInput, setCalcInput] = useState({
    openingDays: 28.4167,
    currentWorkingDays: 360,
    paidDays: 33.417,
    maximumPayout: 150
  });
  const [employeeForm, setEmployeeForm] = useState(emptyEmployeeForm);
  const [quickAddOptions, setQuickAddOptions] = useState<QuickAddOptions>(emptyQuickAddOptions);
  const [whatsappForm, setWhatsappForm] = useState({
    employeeId: "",
    recipientType: "employee" as "employee" | "manager" | "custom",
    managerNumber: "",
    customNumber: "",
    subject: "Airfare / loan process update",
    reference: "",
    body: "",
    footer: "Regards, ATLAS HCM"
  });
  const [openingForm, setOpeningForm] = useState({
    employeeId: "",
    year: new Date().getFullYear().toString(),
    openingDays: "",
    openingBhd: "",
    maximumPayout: "150"
  });
  const [resetEmail, setResetEmail] = useState("");
  const [allocationForm, setAllocationForm] = useState(emptyAllocationForm);
  const [allocationWhatsAppForm, setAllocationWhatsAppForm] = useState({
    managerNumber: "",
    subject: "Airfare Allocation Approval",
    note: "Please review and approve this airfare allocation.",
    footer: "Regards, ATLAS HCM"
  });
  const [policyForm, setPolicyForm] = useState({
    ruleType: "global" as "global" | "company" | "employee" | "department" | "payGroup",
    effectiveFrom: "2026-06-18",
    maxPayoutAmount: "150",
    companyId: "",
    employeeId: "",
    department: "",
    payGroup: ""
  });
  const [policyTab, setPolicyTab] = useState<"new" | "history" | "logic">("new");
  const [policyEmployeeSearch, setPolicyEmployeeSearch] = useState("");
  const [policyEmployeesLoading, setPolicyEmployeesLoading] = useState(false);
  const [selectedPolicyRateIds, setSelectedPolicyRateIds] = useState<Set<number>>(new Set());
  const [allocationFile, setAllocationFile] = useState<File | null>(null);
  const [allocationEligibilityReview, setAllocationEligibilityReview] = useState<AllocationEligibilityReview | null>(null);
  const [selfServiceForm, setSelfServiceForm] = useState({
    travelFromDate: today,
    travelToDate: "",
    origin: "Bahrain",
    destination: "",
    tripType: "RoundTrip",
    cabinClass: "Economy",
    estimatedCostBHD: "",
    preferredAirline: "",
    purpose: ""
  });
  const [loanForm, setLoanForm] = useState({
    employeeId: "",
    amount: "0",
    tenure: "6",
    date: today,
    note: ""
  });
  const [selectedLoanIds, setSelectedLoanIds] = useState<number[]>([]);
  const [monthlyEmiRunPreview, setMonthlyEmiRunPreview] = useState<LoanEmiPreview | null>(null);
  const [monthlyEmiReturnPreview, setMonthlyEmiReturnPreview] = useState<LoanEmiReturnPreview | null>(null);
  const [loanOpsForm, setLoanOpsForm] = useState({
    deferMonths: "1",
    newEmi: "",
    newTenureMonths: "",
    actionDate: today,
    note: ""
  });
  const [loanStatusFilter, setLoanStatusFilter] = useState("");
  const [userForm, setUserForm] = useState({
    username: "",
    password: "",
    email: "",
    fullName: "",
    role: "viewer",
    employeeId: "",
    department: "",
    branch: "",
    isActive: true
  });
  const [editingCompanyId, setEditingCompanyId] = useState<number | null>(null);
  const [companyLogoFile, setCompanyLogoFile] = useState<File | null>(null);
  const [companyForm, setCompanyForm] = useState({
    companyCode: "",
    companyName: "",
    databaseName: "",
    address: "",
    phone: "",
    email: "",
    trn: "",
    contactPerson: "",
    isActive: true
  });
  const [backupForm, setBackupForm] = useState({
    databaseName: "",
    restoreFile: ""
  });
  const [backupFiles, setBackupFiles] = useState<BackupFileInfo[]>([]);
  const [reportForm, setReportForm] = useState({
    type: "allocations",
    from: `${new Date().getFullYear()}-01-01`,
    to: today
  });
  const [reportDensity, setReportDensity] = useState<"comfortable" | "standard" | "compact">("standard");
  const [reportFitMode, setReportFitMode] = useState<"wide" | "fit">("wide");
  const [yearEndForm, setYearEndForm] = useState({
    year: String(new Date().getFullYear()),
    closingDate: `${new Date().getFullYear()}-12-31`,
    employeeId: "",
    remarks: ""
  });
  const [yearEndPreview, setYearEndPreview] = useState<YearEndPreview | null>(null);

  const calcResult = calculateAirfare(calcInput);
  const selectedEmployee = employees.find((item) => item.EmployeeID === Number(allocationForm.employeeId));
  const canSelectSelfServiceEmployee = Boolean(selfServiceSummary?.canSelectEmployee || ["admin", "manager", "hr"].includes(session?.user.role || ""));
  const selfServiceEmployees = employees.length ? employees : employeeMasterAll.filter((employee) => isAirfareEligibleEmployeeStatus(employee.Status));
  const activeSelfServiceEmployeeId = selfServiceEmployeeId || (selfServiceSummary?.employee?.EmployeeID ? String(selfServiceSummary.employee.EmployeeID) : "");
  const userFormEmployeeOptions = employeeMasterAll.filter((employee) => isAirfareEligibleEmployeeStatus(employee.Status));
  const selectedUserFormEmployee = userFormEmployeeOptions.find((employee) => employee.EmployeeID === Number(userForm.employeeId));
  const isEmployeePortalSession = session?.user.role === "employee";
  const visibleNav = isEmployeePortalSession ? nav.filter((item) => item.label === ESS_ONLY_VIEW) : nav;
  const selectedPolicyDate = allocationForm.date ? new Date(`${allocationForm.date}T00:00:00`) : new Date();
  const currentAirfarePolicyRates = airfarePolicyRates.filter((rate) => rate.IsActive && !rate.EffectiveTo);
  const selectedEffectivePolicyRate = [...airfarePolicyRates]
    .filter((rate) => {
      if (!rate.IsActive) return false;
      const from = new Date(`${String(rate.EffectiveFrom).slice(0, 10)}T00:00:00`);
      const to = rate.EffectiveTo ? new Date(`${String(rate.EffectiveTo).slice(0, 10)}T23:59:59`) : null;
      if (Number.isNaN(from.getTime()) || from > selectedPolicyDate) return false;
      if (to && !Number.isNaN(to.getTime()) && to < selectedPolicyDate) return false;
      if (rate.EmployeeID && Number(rate.EmployeeID) !== Number(selectedEmployee?.EmployeeID || 0)) return false;
      if (rate.CompanyID && Number(rate.CompanyID) !== Number(selectedCompanyId || 0)) return false;
      if (rate.Department && String(rate.Department).toLowerCase() !== String(selectedEmployee?.Department || "").toLowerCase()) return false;
      if (rate.EmpGroup && String(rate.EmpGroup).toLowerCase() !== String(selectedEmployee?.EmpGroup || "").toLowerCase()) return false;
      return true;
    })
    .sort((left, right) => {
      const getRatePriority = (rate: AirfarePolicyRate) => (
        rate.EmployeeID && !rate.CompanyID && !rate.Department && !rate.EmpGroup ? 50
          : rate.EmployeeID ? 45
            : rate.EmpGroup ? 40
              : rate.Department ? 30
                : rate.CompanyID ? 20
                  : 10
      );
      const leftPriority = getRatePriority(left);
      const rightPriority = getRatePriority(right);
      if (rightPriority !== leftPriority) return rightPriority - leftPriority;
      return new Date(String(right.EffectiveFrom)).getTime() - new Date(String(left.EffectiveFrom)).getTime();
    })[0];
  const selectedMaximumPayout = selectedEffectivePolicyRate?.MaxPayoutAmount || allocationEligibilityReview?.MaximumPayout || selectedEmployee?.MaximumPayout || AIRFARE_DEFAULT_PAYOUT;
  const selectedCompanyMaxPayout = selectedMaximumPayout;
  const selectedAllocationYear = Number(allocationForm.year) || new Date().getFullYear();
  const selectedOpeningDays = selectedEmployee?.OpeningDays ?? 0;
  const selectedOpeningAmount = roundMoney(selectedEmployee?.OpeningBHD ?? ((selectedMaximumPayout / 60) * Math.max(0, selectedOpeningDays)));
  const selectedEmployeeAllocations = allocations.filter((allocation) => {
    if (!selectedEmployee) return false;
    if (allocation.EmployeeID !== selectedEmployee.EmployeeID) return false;
    if (Number(allocation.AllocYear) !== Number(selectedAllocationYear)) return false;
    return !(editingAllocationId && allocation.AllocationID === editingAllocationId);
  });
  const sortedEmployeeAllocations = [...selectedEmployeeAllocations].sort((a, b) => {
    const left = new Date(String(a.AllocationDate || "")).getTime();
    const right = new Date(String(b.AllocationDate || "")).getTime();
    return left - right;
  });
  const firstAllocationThisYear = sortedEmployeeAllocations[0];
  const currentYearAllocationCount = sortedEmployeeAllocations.length;
  const localCurrentYearSpending = roundMoney(sortedEmployeeAllocations.reduce((sum, allocation) => (
    String(allocation.PaymentMode || "").toLowerCase() === "employee_full"
      ? sum
      : sum + (Number(allocation.Entitlement) || 0)
  ), 0));
  const requiresAllocationReview = currentYearAllocationCount >= 1;
  const requiresLoanManagerApproval = allocationForm.paymentMode === "loan";
  const requiresManagerApproval = requiresAllocationReview || requiresLoanManagerApproval;
  const hasManagerApproval = Boolean((allocationForm.managerApproval || "").trim());
  const hasReviewInput = Boolean((allocationForm.overrideReason || "").trim() || hasManagerApproval);
  const firstAllocationRoute = firstAllocationThisYear ? extractRemarkValue(firstAllocationThisYear.Remarks, "Route") : "";
  const firstAllocationTicketNo = firstAllocationThisYear ? extractRemarkValue(firstAllocationThisYear.Remarks, "Ticket") : "";
  const firstAllocationDate = firstAllocationThisYear ? formatExportDate(firstAllocationThisYear.AllocationDate) : "";
  const firstAllocationAmount = roundMoney(firstAllocationThisYear?.TicketCost || 0);
  const previousAllocationForEarning = findPreviousAllocationForEarning(sortedEmployeeAllocations, allocationForm.date);
  const selectedCurrentWorkingDays = workingDaysFromYearStart(
    allocationForm.date,
    selectedEmployee?.JoinDate,
    previousAllocationForEarning?.AllocationDate
  );
  const selectedPerDayRate = selectedMaximumPayout / 60;
  const selectedCurrentAirfare = calculateAirfare({
    openingDays: 0,
    currentWorkingDays: selectedCurrentWorkingDays,
    paidDays: 0,
    maximumPayout: selectedMaximumPayout
  });
  const selectedCurrentAmount = roundMoney(selectedCurrentAirfare.payableBhd);
  const selectedCurrentDays = selectedCurrentAirfare.currentAirfareDays;
  const selectedPaidDays = toNumber(
    selectedEmployeeAllocations.reduce((sum, allocation) => {
      const perDayRate = Math.max(0.0000001, selectedPerDayRate);
      return sum + ((Number(allocation.Entitlement) || 0) / perDayRate);
    }, 0),
    0
  );
  const selectedPaidAmount = roundMoney(selectedPaidDays * selectedPerDayRate);
  const selectedClosingDays = Math.max(0, roundTo(selectedOpeningDays + selectedCurrentDays - selectedPaidDays, 4));
  const selectedRawEntitlement = selectedCurrentAmount;
  const localTotalEntitlement = roundMoney(Math.min(selectedMaximumPayout, Math.max(0, selectedOpeningAmount + selectedCurrentAmount)));
  const localSelectedEntitlement = roundMoney(Math.max(0, localTotalEntitlement - selectedPaidAmount));
  const currentYearSpending = roundMoney(allocationEligibilityReview?.CurrentYearSpending ?? localCurrentYearSpending);
  const currentYearRemaining = roundMoney(allocationEligibilityReview?.CurrentYearRemaining ?? ((selectedMaximumPayout || 150) - currentYearSpending));
  const totalAvailableFunds = roundMoney(allocationEligibilityReview?.TotalAvailableFunds ?? ((selectedOpeningAmount || 0) + currentYearRemaining));
  const reviewOpeningAmount = roundMoney(allocationEligibilityReview?.OpeningBalanceAmount ?? selectedOpeningAmount);
  const reviewCurrentYearAmount = roundMoney(allocationEligibilityReview?.CurrentYearEarnedAmount ?? selectedCurrentAmount);
  const reviewCurrentYearDays = roundTo(allocationEligibilityReview?.CurrentYearEarnedDays ?? selectedCurrentDays, 4);
  const reviewPaidAmount = roundMoney(allocationEligibilityReview?.AlreadyPaidAmount ?? selectedPaidAmount);
  const reviewPaidDays = roundTo(allocationEligibilityReview?.AlreadyPaidDays ?? selectedPaidDays, 4);
  const reviewClosingDays = roundTo(allocationEligibilityReview?.EligibleBalanceDays ?? selectedClosingDays, 4);
  const reviewEntitlementBasis = roundMoney(allocationEligibilityReview?.CurrentYearEntitlementBasis ?? selectedRawEntitlement);
  const selectedEntitlement = roundMoney(Math.min(selectedMaximumPayout, allocationEligibilityReview?.AirfareEntitlementAmount ?? localSelectedEntitlement));
  const ticketCost = toNumber(allocationForm.ticketCost);
  const hasTicketAmount = ticketCost > 0;
  const entitlementFullyCoversTicket = hasTicketAmount && selectedEntitlement >= ticketCost;
  const entitlementCovered = Math.min(ticketCost, selectedEntitlement);
  const companyEntitlementBase = Math.min(entitlementCovered, selectedCompanyMaxPayout);
  const companyCoverableBalance = roundMoney(Math.max(0, ticketCost - companyEntitlementBase));
  const hasTicketExcess = hasTicketAmount && companyCoverableBalance > 0;
  const cappedCompanyExtraCapacity = roundMoney(Math.max(0, selectedCompanyMaxPayout - companyEntitlementBase));
  const companyBalancePayInfo = roundMoney(Math.min(companyCoverableBalance, cappedCompanyExtraCapacity));
  const companyBalancePayAmount = allocationForm.paymentMode === "company" ? companyBalancePayInfo : 0;
  const fullCompanyPayAmount = allocationForm.paymentMode === "company_full" ? roundMoney(Math.max(0, ticketCost - entitlementCovered)) : 0;
  const fullSelfPayAmount = allocationForm.paymentMode === "employee_full" ? roundMoney(ticketCost) : 0;
  const entitlementAppliedAmount = allocationForm.paymentMode === "employee_full" ? 0 : entitlementCovered;
  const companyPaid = allocationForm.paymentMode === "employee_full" ? 0 : allocationForm.paymentMode === "company_full" ? roundMoney(ticketCost) : roundMoney(companyEntitlementBase + companyBalancePayAmount);
  const displayedCompanySettlementAmount = allocationForm.paymentMode === "company_full" ? fullCompanyPayAmount : companyBalancePayAmount;
  const excessBalance = roundMoney(Math.max(0, ticketCost - companyPaid));
  const excessAmount = allocationForm.paymentMode === "company" || allocationForm.paymentMode === "company_full" || allocationForm.paymentMode === "employee_full" ? 0 : excessBalance;
  const selfPaidAmount = allocationForm.paymentMode === "employee_full" ? ticketCost : allocationForm.paymentMode === "employee" ? excessBalance : 0;
  const loanExcessAmount = allocationForm.paymentMode === "loan" ? excessBalance : 0;
  const suggestedLoan = allocationForm.paymentMode === "loan" ? excessBalance : 0;
  const suggestedEmi = suggestedLoan > 0 ? suggestedLoan / Math.max(1, Number(allocationForm.loanTenure) || 1) : 0;
  const displayedEntitlementOptionAmount = selectedEntitlement;
  const displayedSelfPaidOptionAmount = allocationForm.paymentMode === "employee" ? selfPaidAmount : 0;
  const displayedFullSelfPaidOptionAmount = allocationForm.paymentMode === "employee_full" ? fullSelfPayAmount : 0;
  const displayedLoanOptionAmount = allocationForm.paymentMode === "loan" ? loanExcessAmount : 0;
  const settlementActionDisabled = !selectedEmployee || !hasTicketAmount;
  const fullSelfPayDisabled = !selectedEmployee || !hasTicketAmount;
  const smartSettlementRecommendation = !selectedEmployee
    ? { title: "Select employee", detail: "ATLAS will recommend the correct settlement after employee, date, and ticket amount are entered." }
    : !hasTicketAmount
      ? { title: "Enter ticket amount", detail: "Ticket amount is required before ATLAS can recommend entitlement, self-pay, company exception, or loan." }
      : entitlementFullyCoversTicket
        ? {
          title: "Recommended: airfare entitlement amount is available",
          detail: `Entitlement covers the full ticket. You can still choose full company pay, employee self-pay, full employee self-pay, or loan when approved.`
        }
        : {
          title: "Excess settlement required",
          detail: `Entitlement applies ${money.format(entitlementCovered)}. Balance ${money.format(companyCoverableBalance)} must be handled by full company exception, self employee, or loan.`
        };
  const selectedEmployeeLoans = selectedEmployee
    ? loans.filter((loan) => loan.EmployeeID === selectedEmployee.EmployeeID && String(loan.Status || "").toLowerCase() === "active")
    : [];
  const selectedTicketLoans = editingAllocationId
    ? selectedEmployeeLoans.filter((loan) => Number(loan.AllocationID) === editingAllocationId)
    : [];
  const selectedSeparateLoans = selectedEmployeeLoans.filter((loan) => !loan.AllocationID || Number(loan.AllocationID) !== editingAllocationId);
  const selectedLoanOutstanding = selectedEmployeeLoans.reduce((sum, loan) => sum + (loan.RemainingBalance || 0), 0);
  const allocationRuleStatus = !selectedEmployee
    ? { tone: "info", title: "Select employee", detail: "Choose an employee to review balance, existing loans, and allocation rules." }
    : allocationForm.decision === "reject"
      ? { tone: "warning", title: "Allocation marked rejected", detail: "This ticket will not be processed until decision is changed to Process." }
    : ticketCost <= 0
      ? { tone: "info", title: "Enter ticket amount", detail: "Ticket amount is required before process or reject decision." }
      : requiresManagerApproval
        ? {
          tone: hasManagerApproval ? "info" : "warning",
          title: hasManagerApproval
            ? (requiresLoanManagerApproval ? "Loan manager approval captured" : "Duplicate-ticket manager approval captured")
            : (requiresLoanManagerApproval ? "Loan manager approval required" : "Duplicate-ticket manager approval required"),
          detail: hasManagerApproval
            ? "Manager approval is captured. Verify the reference before processing."
            : requiresLoanManagerApproval
              ? "Loan creation requires manager approval before processing."
              : "Second ticket in this year requires manager approval before processing."
        }
        : selectedTicketLoans.length > 0
          ? { tone: "warning", title: "Existing loan for this ticket", detail: "This allocation already has a linked ticket loan. Updating will refresh that linked loan." }
            : selectedSeparateLoans.length > 0 && excessBalance > 0 && allocationForm.paymentMode === "loan"
              ? { tone: "warning", title: "Previous separate loan exists", detail: "Employee has active previous loan. Confirm this ticket needs a new separate loan before saving." }
              : ticketCost > selectedEntitlement && allocationForm.paymentMode === "entitlement"
                ? { tone: "warning", title: "Ticket exceeds eligibility", detail: "Choose company paid, self employee paid, or loan for the excess amount." }
                : allocationForm.paymentMode === "company_full"
                  ? { tone: "info", title: "Full company payment selected", detail: "Company will pay the full ticket amount as an approved exception. Entitlement remains visible for audit." }
                : allocationForm.paymentMode === "employee_full"
                  ? { tone: "info", title: "Full self payment selected", detail: "Employee pays the full ticket from personal funds. Airfare entitlement is not consumed and can carry forward." }
                : excessBalance > 0 && allocationForm.paymentMode === "company"
                  ? { tone: "warning", title: "Company payout capped", detail: "Company is capped at maximum payout. Use self-pay or loan for remaining excess." }
                  : { tone: "success", title: "Ready to process", detail: "Rules checked: balance, ticket cost, and employee loan status are ready for this decision." };
  const automationGuardrailChecks = [
    {
      title: "SQL calculation authority",
      detail: "Eligibility, paid days, duplicate-ticket checks, and loan validation are calculated by the backend/SQL layer. The screen only displays and guides the decision.",
      tone: "success"
    },
    {
      title: "Recommended settlement",
      detail: !selectedEmployee
        ? "Select an employee to receive the recommended settlement action."
        : !hasTicketAmount
          ? "Enter ticket amount so ATLAS can compare ticket cost with available entitlement."
          : allocationForm.paymentMode === "employee_full"
            ? "Full self employee paid is selected. No entitlement days or amount will be consumed."
            : entitlementFullyCoversTicket
              ? "Entitlement is enough for this ticket. Use entitlement unless there is a special company or employee-paid reason."
              : `Balance after entitlement is ${money.format(companyCoverableBalance)}. Select self employee paid, company exception, or loan with approval.`,
      tone: !selectedEmployee || !hasTicketAmount ? "info" : entitlementFullyCoversTicket ? "success" : "warning"
    },
    {
      title: "Approval intelligence",
      detail: requiresManagerApproval
        ? hasManagerApproval
          ? "Manager approval/reference is captured for this second ticket or loan workflow."
          : "Manager approval/reference is required before saving this second ticket or loan workflow."
        : "No duplicate-ticket or loan approval block is active for this entry.",
      tone: requiresManagerApproval && !hasManagerApproval ? "warning" : "success"
    },
    {
      title: "Loan risk check",
      detail: selectedSeparateLoans.length > 0
        ? `Employee has ${selectedSeparateLoans.length} active previous separate loan(s), outstanding ${money.format(selectedLoanOutstanding)}. Confirm before creating another loan.`
        : selectedTicketLoans.length > 0
          ? "A loan already exists for this ticket. Update will keep the linked loan visible."
          : "No active previous separate loan risk detected for this employee.",
      tone: selectedSeparateLoans.length > 0 ? "warning" : "success"
    },
    {
      title: "Document readiness",
      detail: allocationFile
        ? `Attachment selected: ${allocationFile.name}. It will be stored with the allocation for audit.`
        : "Attach ticket PDF/image when available so finance can verify ticket amount and route later.",
      tone: allocationFile ? "success" : "info"
    }
  ];
  const loanAmount = toNumber(loanForm.amount);
  const loanTenure = Math.max(1, toNumber(loanForm.tenure, 1));
  const loanEmiPreview = Math.round((loanAmount / loanTenure) * 100) / 100;
  const selectedLoanEmployee = employees.find((item) => item.EmployeeID === Number(loanForm.employeeId));
  const yearEndPendingLoans = Number(yearEndPreview?.pendingLoanCount ?? yearEndPreview?.totals?.PendingLoans ?? 0);
  const yearEndPendingLoanAmount = Number(yearEndPreview?.pendingLoanAmount ?? yearEndPreview?.totals?.PendingLoanAmount ?? 0);
  const yearEndNegativeBalances = (yearEndPreview?.employees || []).filter((row) => Number(row.ClosingDays || 0) < 0 || Number(row.ClosingBHD || 0) < 0).length;
  const yearEndReadinessChecks = [
    {
      title: "Preview calculated from SQL",
      detail: yearEndPreview ? `${yearEndPreview.balancesCarried} employee balance row(s) reviewed.` : "Run preview to calculate closing days and amount before close.",
      status: yearEndPreview ? "Ready" : "Required",
      tone: yearEndPreview ? "success" : "warning"
    },
    {
      title: "Pending loan visibility",
      detail: yearEndPreview ? `${yearEndPendingLoans} pending loan(s), amount ${money.format(yearEndPendingLoanAmount)}.` : "Pending loan count appears after preview.",
      status: yearEndPendingLoans > 0 ? "Review" : yearEndPreview ? "Clear" : "Required",
      tone: yearEndPendingLoans > 0 ? "warning" : yearEndPreview ? "success" : "warning"
    },
    {
      title: "Negative balance check",
      detail: yearEndPreview ? `${yearEndNegativeBalances} employee(s) have negative closing balance.` : "Negative balances are checked from preview rows.",
      status: yearEndNegativeBalances > 0 ? "Review" : yearEndPreview ? "Clear" : "Required",
      tone: yearEndNegativeBalances > 0 ? "warning" : yearEndPreview ? "success" : "warning"
    },
    {
      title: "Carry-forward snapshot",
      detail: "Closing days and amount are copied into next-year opening balance with audit history.",
      status: yearEndPreview ? "Protected" : "Pending",
      tone: yearEndPreview ? "success" : "info"
    }
  ];

  useEffect(() => {
    atlasHealth()
      .then(() => setStatus("API online: sign in for live SQL"))
      .catch(() => setStatus("Preview mode: API not reachable"));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(UI_PREFERENCES_STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as {
        themeMode?: "light" | "dark";
        themeAccent?: "blue" | "emerald" | "slate";
        uiDensity?: "comfortable" | "standard" | "compact";
        sidebarCollapsed?: boolean;
        rightPanelsCollapsed?: boolean;
        showSyncStatus?: boolean;
      };
      if (saved.themeMode === "light" || saved.themeMode === "dark") setThemeMode(saved.themeMode);
      if (saved.themeAccent === "blue" || saved.themeAccent === "emerald" || saved.themeAccent === "slate") setThemeAccent(saved.themeAccent);
      if (saved.uiDensity === "comfortable" || saved.uiDensity === "standard" || saved.uiDensity === "compact") setUiDensity(saved.uiDensity);
      if (typeof saved.sidebarCollapsed === "boolean") setSidebarCollapsed(saved.sidebarCollapsed);
      if (typeof saved.rightPanelsCollapsed === "boolean") setRightPanelsCollapsed(saved.rightPanelsCollapsed);
      if (typeof saved.showSyncStatus === "boolean") setShowSyncStatus(saved.showSyncStatus);
    } catch {
      window.localStorage.removeItem(UI_PREFERENCES_STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(QUICK_ADD_OPTIONS_STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as Partial<QuickAddOptions>;
      const next = emptyQuickAddOptions();
      quickAddOptionKeys.forEach((key) => {
        next[key] = uniqueOptions(Array.isArray(saved[key]) ? saved[key] : []);
      });
      setQuickAddOptions(next);
    } catch {
      window.localStorage.removeItem(QUICK_ADD_OPTIONS_STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(QUICK_ADD_OPTIONS_STORAGE_KEY, JSON.stringify(quickAddOptions));
  }, [quickAddOptions]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(UI_PREFERENCES_STORAGE_KEY, JSON.stringify({
      themeMode,
      themeAccent,
      uiDensity,
      sidebarCollapsed,
      rightPanelsCollapsed,
      showSyncStatus
    }));
  }, [themeMode, themeAccent, uiDensity, sidebarCollapsed, rightPanelsCollapsed, showSyncStatus]);

  useEffect(() => {
    const saved = restoreSavedSession();
    if (!saved) return;
    setSession(saved.session);
    if (saved.session.user.role === "employee") setActiveView(ESS_ONLY_VIEW);
    setSelectedCompanyId(saved.companyId || "");
    setStatus("Restoring saved session");
    saveSession(saved.session, saved.companyId || "");
    loadLiveData(saved.session)
      .then(() => setMessage(`Signed in as ${saved.session.user.fullName}`))
      .catch((error) => {
        const message = error instanceof Error ? error.message : "";
        if (/401|403|token|expired|invalid/i.test(message)) {
          clearSavedSession();
          setSession(null);
          setMessage("Saved session expired. Please sign in again.");
          return;
        }
        setMessage("Session restored. Live data refresh failed, please use Refresh.");
      });
  }, []);

  useEffect(() => {
    if (!session) return;
    saveSession(session, selectedCompanyId);
  }, [session, selectedCompanyId]);

  useEffect(() => {
    if (activeView !== "Preferences" || !session || employeeMasterAll.length > 0 || policyEmployeesLoading) return;
    void reloadPolicyEmployees(session);
  }, [activeView, session, employeeMasterAll.length, policyEmployeesLoading]);

  useEffect(() => {
    if (!session) return;
    let timer = window.setTimeout(() => {
      handleLogout("Session expired after 35 minutes. Please sign in again.");
    }, SESSION_TIMEOUT_MS);
    const resetTimer = () => {
      saveSession(session, selectedCompanyId);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        handleLogout("Session expired after 35 minutes. Please sign in again.");
      }, SESSION_TIMEOUT_MS);
    };
    const events = ["click", "keydown", "mousemove", "scroll", "touchstart"];
    events.forEach((eventName) => window.addEventListener(eventName, resetTimer, { passive: true }));
    return () => {
      window.clearTimeout(timer);
      events.forEach((eventName) => window.removeEventListener(eventName, resetTimer));
    };
  }, [session, selectedCompanyId]);

  useEffect(() => {
    if (!session || !selectedCompanyId) {
      setCompanyLogoUrl("");
      return;
    }
    setCompanyLogoUrl("");
    let revokeUrl = "";
    let cancelled = false;
    fetch(`${atlasApiBase()}/companies/${selectedCompanyId}/logo`, {
      headers: {
        Authorization: `Bearer ${session.token}`,
        "X-Session-Id": session.sessionId
      }
    })
      .then((res) => res.ok ? res.blob() : null)
      .then((blob) => {
        if (!blob || cancelled) return;
        revokeUrl = URL.createObjectURL(blob);
        setCompanyLogoUrl(revokeUrl);
      })
      .catch(() => setCompanyLogoUrl(""));
    return () => {
      cancelled = true;
      if (revokeUrl) URL.revokeObjectURL(revokeUrl);
    };
  }, [selectedCompanyId, session]);

  useEffect(() => {
    if (session) return;
    const companyCode = loginForm.company.trim();
    if (!companyCode) {
      setLoginLogoUrl("");
      return;
    }

    let revokeUrl = "";
    let cancelled = false;
    setLoginLogoUrl("");
    fetch(`${atlasApiBase()}/public/companies/${encodeURIComponent(companyCode)}/logo`)
      .then((res) => res.ok ? res.blob() : null)
      .then((blob) => {
        if (!blob || cancelled) return;
        revokeUrl = URL.createObjectURL(blob);
        setLoginLogoUrl(revokeUrl);
      })
      .catch(() => setLoginLogoUrl(""));

    return () => {
      cancelled = true;
      if (revokeUrl) URL.revokeObjectURL(revokeUrl);
    };
  }, [loginForm.company, session]);

  useEffect(() => {
    if (!session || !selectedEmployee || !allocationForm.date) {
      setAllocationEligibilityReview(null);
      return;
    }

    let cancelled = false;
    const params = new URLSearchParams({
      employeeId: String(selectedEmployee.EmployeeID),
      date: allocationForm.date,
      year: String(selectedAllocationYear)
    });
    if (selectedCompanyId) params.set("companyId", selectedCompanyId);
    if (editingAllocationId) params.set("excludeAllocationId", String(editingAllocationId));

    setAllocationEligibilityReview(null);
    atlasFetch<AllocationEligibilityReview>(
      `/allocations/eligibility-review?${params.toString()}`,
      session.token,
      session.sessionId
    )
      .then((review) => {
        if (!cancelled) setAllocationEligibilityReview(review);
      })
      .catch(() => {
        if (!cancelled) setAllocationEligibilityReview(null);
      });

    return () => {
      cancelled = true;
    };
  }, [session, selectedEmployee?.EmployeeID, allocationForm.date, selectedAllocationYear, editingAllocationId, allocations.length, selectedCompanyId]);

  function selfServiceEmployeeQuery(employeeId = activeSelfServiceEmployeeId) {
    return canSelectSelfServiceEmployee && employeeId ? `?employeeId=${encodeURIComponent(employeeId)}` : "";
  }

  async function loadLiveData(activeSession = session) {
    if (!activeSession) return;
    if (activeSession.user.role === "employee") {
      const [selfServiceSummaryData, selfServiceRequestData] = await Promise.all([
        atlasFetch<EmployeeSelfServiceSummary>("/employee-self-service/summary", activeSession.token, activeSession.sessionId),
        atlasFetch<EmployeeAllowanceRequest[]>("/employee-self-service/requests", activeSession.token, activeSession.sessionId)
      ]);
      setSelfServiceSummary(selfServiceSummaryData);
      setSelfServiceRequests(selfServiceRequestData);
      setSelfServiceEmployeeId(selfServiceSummaryData.employee?.EmployeeID ? String(selfServiceSummaryData.employee.EmployeeID) : "");
      setEmployees([]);
      setEmployeeMasterAll([]);
      setLoans([]);
      setAllocations([]);
      setAirfarePolicyRates([]);
      setCompanies([]);
      setBackupFiles([]);
      setActiveView(ESS_ONLY_VIEW);
      setStatus("Employee Self-Service ready");
      return;
    }
    const reportYear = new Date().getFullYear();
    const canReviewSelfService = ["admin", "manager", "hr"].includes(activeSession.user.role);
    const [employeeData, employeeMasterData, loanData, loanSummaryData, allocationData, summaryData, companyData, backupFileData, policyData, selfServiceSummaryData, selfServiceRequestData, selfServiceAlertData, intelligenceData, verificationData, integrityData, airfarePayableData] = await Promise.all([
      atlasFetch<Employee[]>("/employees?scope=active", activeSession.token, activeSession.sessionId),
      atlasFetch<Employee[]>("/employees?scope=all", activeSession.token, activeSession.sessionId),
      atlasFetch<Loan[]>("/loans/register", activeSession.token, activeSession.sessionId),
      atlasFetch<LoanSummary>("/loans/summary", activeSession.token, activeSession.sessionId),
      atlasFetch<Allocation[]>(`/allocations?year=${reportYear}`, activeSession.token, activeSession.sessionId),
      atlasFetch<YearSummary>(`/reports/year-summary/${reportYear}`, activeSession.token, activeSession.sessionId),
      activeSession.user.role === "admin" ? atlasFetch<Company[]>("/companies", activeSession.token, activeSession.sessionId) : Promise.resolve([]),
      activeSession.user.role === "admin" ? atlasFetch<BackupFileInfo[]>("/admin/backups", activeSession.token, activeSession.sessionId) : Promise.resolve([]),
      ["admin", "manager", "hr"].includes(activeSession.user.role) ? atlasFetch<AirfarePolicyRate[]>("/airfare-policy-rates", activeSession.token, activeSession.sessionId) : Promise.resolve([]),
      atlasFetch<EmployeeSelfServiceSummary>(`/employee-self-service/summary${selfServiceEmployeeQuery()}`, activeSession.token, activeSession.sessionId),
      atlasFetch<EmployeeAllowanceRequest[]>(`/employee-self-service/requests${selfServiceEmployeeQuery()}`, activeSession.token, activeSession.sessionId),
      canReviewSelfService ? atlasFetch<EmployeeAllowanceRequest[]>("/employee-self-service/requests?alerts=pending", activeSession.token, activeSession.sessionId) : Promise.resolve([]),
      atlasFetch<IntelligenceControlCenter>("/intelligence/control-center", activeSession.token, activeSession.sessionId),
      atlasFetch<SystemVerification>("/intelligence/verification", activeSession.token, activeSession.sessionId),
      atlasFetch<SystemIntegrityModel>(`/intelligence/system-integrity?year=${reportYear}`, activeSession.token, activeSession.sessionId),
      atlasFetch<AirfarePayableReportRow[]>(`/reports/airfare-payable?year=${reportYear}&asOfDate=${today}`, activeSession.token, activeSession.sessionId)
    ]);
    setEmployees(employeeData);
    setEmployeeMasterAll(employeeMasterData);
    setLoans(loanData);
    setLoanSummary(loanSummaryData);
    setAllocations(allocationData);
    setAirfarePolicyRates(policyData);
    setSelfServiceSummary(selfServiceSummaryData);
    setSelfServiceRequests(selfServiceRequestData);
    setSelfServiceAlerts(selfServiceAlertData);
    setSelfServiceEmployeeId((current) => current || (selfServiceSummaryData.employee?.EmployeeID ? String(selfServiceSummaryData.employee.EmployeeID) : ""));
    setCompanies(companyData);
    setBackupFiles(backupFileData);
    setIntelligence(intelligenceData);
    setVerification(verificationData);
    setSystemIntegrity(integrityData);
    setAirfarePayableReport(airfarePayableData);
    setSelectedCompanyId((current) => current || (companyData[0]?.CompanyID ? String(companyData[0].CompanyID) : ""));
    setBackupForm((current) => ({ ...current, databaseName: current.databaseName || companyData[0]?.DatabaseName || "" }));
    setSummary(summaryData);
    const currentEmployeeIds = new Set(employeeData.map((employee) => employee.EmployeeID));
    setSelectedEmployeeIds((current) => {
      const next = new Set<number>();
      current.forEach((id) => {
        if (currentEmployeeIds.has(id)) next.add(id);
      });
      return next;
    });
    setStatus("Live SQL data synced");
    if (allocationData.length) {
      const ids = [...new Set(allocationData.map((allocation) => allocation.AllocationID))]
        .filter((id) => Number.isFinite(Number(id)))
        .slice(0, 1000)
        .map((id) => String(id));
      const attachments = await atlasFetch<AllocationAttachment[]>(
        `/allocations/attachments${ids.length ? `?ids=${encodeURIComponent(ids.join(","))}` : ""}`,
        activeSession.token,
        activeSession.sessionId
      );
      const grouped = attachments.reduce((acc, attachment) => {
        const list = acc[attachment.AllocationID] || [];
        acc[attachment.AllocationID] = [...list, attachment];
        return acc;
      }, {} as Record<number, AllocationAttachment[]>);
      setAllocationAttachments(grouped);
    } else {
      setAllocationAttachments({});
    }

    if (activeSession.user.role === "admin") {
      const userData = await atlasFetch<AtlasUser[]>("/users", activeSession.token, activeSession.sessionId);
      setUsers(userData);
    }
  }

  async function reloadPolicyEmployees(activeSession = session) {
    if (!activeSession) return;
    try {
      setPolicyEmployeesLoading(true);
      const employeeMasterData = await atlasFetch<Employee[]>("/employees?scope=all", activeSession.token, activeSession.sessionId);
      setEmployeeMasterAll(employeeMasterData);
    } finally {
      setPolicyEmployeesLoading(false);
    }
  }

  async function reloadSelfService(activeSession = session, employeeId = activeSelfServiceEmployeeId) {
    if (!activeSession) return;
    const canReviewSelfService = ["admin", "manager", "hr"].includes(activeSession.user.role);
    const [summaryData, requestData, alertData] = await Promise.all([
      atlasFetch<EmployeeSelfServiceSummary>(`/employee-self-service/summary${selfServiceEmployeeQuery(employeeId)}`, activeSession.token, activeSession.sessionId),
      atlasFetch<EmployeeAllowanceRequest[]>(`/employee-self-service/requests${selfServiceEmployeeQuery(employeeId)}`, activeSession.token, activeSession.sessionId),
      canReviewSelfService ? atlasFetch<EmployeeAllowanceRequest[]>("/employee-self-service/requests?alerts=pending", activeSession.token, activeSession.sessionId) : Promise.resolve([])
    ]);
    setSelfServiceSummary(summaryData);
    setSelfServiceRequests(requestData);
    setSelfServiceAlerts(alertData);
    setSelfServiceEmployeeId(employeeId || (summaryData.employee?.EmployeeID ? String(summaryData.employee.EmployeeID) : ""));
  }

  async function changeSelfServiceEmployee(employeeId: string) {
    setSelfServiceEmployeeId(employeeId);
    if (session) await reloadSelfService(session, employeeId);
  }

  async function submitSelfServiceRequest(event: React.FormEvent) {
    event.preventDefault();
    if (!session) return;
    setBusy(true);
    try {
      await atlasMutation<EmployeeAllowanceRequest>("/employee-self-service/requests", session.token, session.sessionId, "POST", {
        ...selfServiceForm,
        employeeId: activeSelfServiceEmployeeId ? Number(activeSelfServiceEmployeeId) : undefined,
        travelToDate: selfServiceForm.travelToDate || null,
        estimatedCostBHD: Number(selfServiceForm.estimatedCostBHD || 0)
      });
      setSelfServiceForm((current) => ({
        ...current,
        destination: "",
        estimatedCostBHD: "",
        preferredAirline: "",
        purpose: ""
      }));
      await reloadSelfService(session, activeSelfServiceEmployeeId);
      setMessage(session.user.role === "employee" ? "Request submitted to admin/HR for review." : "Employee airfare request submitted for review.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Employee airfare request failed.");
    } finally {
      setBusy(false);
    }
  }

  async function transitionSelfServiceRequest(requestId: number, toStatus: string) {
    if (!session) return;
    setBusy(true);
    try {
      const updated = await atlasMutation<EmployeeAllowanceRequest>(`/employee-self-service/requests/${requestId}/transition`, session.token, session.sessionId, "POST", { toStatus });
      await reloadSelfService(session, activeSelfServiceEmployeeId);
      const allocationNote = updated.LinkedAllocationID ? ` Allocation #${updated.LinkedAllocationID} is linked.` : "";
      setMessage(`Request ${toStatus.toLowerCase()}.${allocationNote}`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Request update failed.");
    } finally {
      setBusy(false);
    }
  }

  async function openSelfServiceAllocation(allocationId: number | undefined) {
    if (!session || !allocationId) return;
    setBusy(true);
    try {
      let allocation = allocations.find((item) => Number(item.AllocationID) === Number(allocationId));
      if (!allocation) {
        allocation = await atlasFetch<Allocation>(`/allocations/${allocationId}`, session.token, session.sessionId);
      }
      if (!allocations.some((item) => Number(item.AllocationID) === Number(allocation.AllocationID))) {
        setAllocations((current) => [allocation!, ...current]);
      }
      handleEditAllocation(allocation);
      setMessage(`Opened airfare allocation #${allocation.AllocationID}.`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Unable to open linked airfare allocation.");
    } finally {
      setBusy(false);
    }
  }

  async function handleLogin(event?: { preventDefault?: () => void }) {
    event?.preventDefault?.();
    setBusy(true);
    setMessage("");
    try {
      const loggedIn = await atlasLogin(loginForm.username.trim(), loginForm.password);
      setSession(loggedIn);
      if (loggedIn.user.role === "employee") setActiveView(ESS_ONLY_VIEW);
      saveSession(loggedIn, selectedCompanyId);
      await loadLiveData(loggedIn);
      setMessage(`Signed in as ${loggedIn.user.fullName}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout(doneMessage = "Signed out successfully.") {
    const currentSession = session;
    clearSavedSession();
    setSession(null);
    setEmployees([]);
    setEmployeeMasterAll([]);
    setLoans([]);
    setLoanSummary(null);
    setAllocations([]);
    setAirfarePolicyRates([]);
    setAllocationAttachments({});
    setUsers([]);
    setSummary(null);
    setCompanyLogoUrl("");
    setSelectedEmployeeIds(new Set());
    setEmployeeMasterSearch("");
    setAllocationEmployeeSearch("");
    setAllocationEmployeeType("");
    setStatus("API online: sign in for live SQL");
    setMessage(doneMessage);
    if (!currentSession) return;
    try {
      await atlasMutation("/auth/logout", currentSession.token, currentSession.sessionId, "POST");
    } catch {
      // Local logout is enough if the server session is already gone.
    }
  }

  async function refreshAirfarePayableReport(activeSession = session) {
    if (!activeSession) return airfarePayableReport;
    const reportYear = Number((reportForm.to || today).slice(0, 4)) || new Date().getFullYear();
    const asOfDate = reportForm.to || today;
    const rows = await atlasFetch<AirfarePayableReportRow[]>(
      `/reports/airfare-payable?year=${reportYear}&asOfDate=${asOfDate}`,
      activeSession.token,
      activeSession.sessionId
    );
    setAirfarePayableReport(rows);
    return rows;
  }

  async function handleRefreshLiveData() {
    if (!session) {
      setMessage("Please sign in before refreshing live data.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      await loadLiveData(session);
      if (["airfare", "airfare_summary", "airfare_exceptions"].includes(reportForm.type)) await refreshAirfarePayableReport(session);
      setMessage("System confirmation: live SQL data refreshed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Live SQL data refresh failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRunDiagnostics() {
    if (!session) {
      setMessage("Please sign in before running diagnostics.");
      return;
    }
    setDiagnosticsLoading(true);
    setMessage("");
    try {
      const result = await atlasFetch<SystemDiagnostics>("/diagnostics/system", session.token, session.sessionId);
      setDiagnostics(result);
      setMessage(`Diagnostics completed: ${result.status}.`);
    } catch (error) {
      setDiagnostics({
        status: "DOWN",
        checkedAt: new Date().toISOString(),
        latencyMs: 0,
        checks: [{
          key: "diagnostics-api",
          name: "Diagnostics API",
          type: "application",
          success: false,
          latencyMs: 0,
          status: "DOWN",
          detail: error instanceof Error ? error.message : "Diagnostics request failed."
        }]
      });
      setMessage(error instanceof Error ? error.message : "Diagnostics failed.");
    } finally {
      setDiagnosticsLoading(false);
    }
  }

  useEffect(() => {
    if (!session || !["airfare", "airfare_summary", "airfare_exceptions"].includes(reportForm.type)) return;
    void refreshAirfarePayableReport(session).catch(() => {
      setMessage("Unable to refresh Airfare Payable report from SQL.");
    });
  }, [session, reportForm.type, reportForm.to]);

  async function handleForgotPassword() {
    const usernameOrEmail = resetEmail || loginForm.username;
    if (!usernameOrEmail) return setMessage("Enter your username or email first.");
    setBusy(true);
    setMessage("");
    try {
      await atlasMutation("/auth/forgot-password", "", "", "POST", { usernameOrEmail });
      setMessage("Password reset request recorded. Check email after mail setup is connected.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Password reset request failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateEmployee() {
    if (!session) return setMessage("Please sign in before saving.");
    if (!employeeForm.code.trim() || !employeeForm.name.trim()) return setMessage("Employee code and name are required.");

    setBusy(true);
    setMessage("");
    try {
      const maximumPayout = toNumber(employeeForm.maximumPayout, AIRFARE_DEFAULT_PAYOUT);
      const totalWorkingDays = toNumber(employeeForm.totalWorkingDays, 360);
      const paidDays = toNumber(employeeForm.paidDays);
      const calculated = calculateAirfare({
        openingDays: 0,
        currentWorkingDays: totalWorkingDays,
        paidDays,
        maximumPayout
      });
      const monthDays = totalWorkingDays / 12;
      const payload = {
        code: employeeForm.code.trim(),
        name: employeeForm.name.trim(),
        bankCode: employeeForm.bankCode,
        jobBand: employeeForm.jobBand,
        joinDate: employeeForm.joinDate,
        cpr: employeeForm.cpr,
        passport: employeeForm.passport,
        nationality: employeeForm.nationality,
        branch: employeeForm.branch,
        department: employeeForm.department,
        company: employeeForm.company,
        section: employeeForm.section,
        location: employeeForm.location,
        designation: employeeForm.designation,
        group: employeeForm.group,
        reportingTo: employeeForm.reportingTo,
        bhStatus: employeeForm.bahrainiNational === "Yes" ? "BH" : "NON-BH",
        payrollStatus: employeeForm.payrollStatus,
        status: toEmployeeLifecycleStatus(employeeForm.payrollStatus),
        accountNumber: employeeForm.accountNumber,
        passportExpiryDate: employeeForm.passportExpiryDate || null,
        email: employeeForm.email,
        whatsappNumber: employeeForm.whatsappNumber,
        basicSalary: toNullableNumber(employeeForm.basicSalary),
        hra: toNullableNumber(employeeForm.hra),
        specialDutyAllowance: toNullableNumber(employeeForm.specialDutyAllowance),
        carAllowance: toNullableNumber(employeeForm.carAllowance),
        petrolAllowance: toNullableNumber(employeeForm.petrolAllowance),
        phoneAllowance: toNullableNumber(employeeForm.phoneAllowance),
        grossSalary: toNullableNumber(employeeForm.grossSalary),
        gosiDeduction: toNullableNumber(employeeForm.gosiDeduction),
        averageSalary: toNullableNumber(employeeForm.averageSalary),
        religion: employeeForm.religion,
        serialNo: toNullableNumber(employeeForm.serialNo),
        lastWorkingDate: employeeForm.lastWorkingDate || null,
        airfarePaidDays: paidDays,
        currentAirfare2024: calculated.currentAirfareDays,
        maximumPayout,
        jan: monthDays,
        feb: monthDays,
        mar: monthDays,
        apr: monthDays,
        may: monthDays,
        jun: monthDays,
        jul: monthDays,
        aug: monthDays,
        sep: monthDays,
        oct: monthDays,
        nov: monthDays,
        dec: monthDays
      };

      const wasEditing = Boolean(editingEmployeeId);
      if (!wasEditing) {
        Object.assign(payload, {
          openingDays: 0,
          openingBhd: 0,
          remainingBalance2024: 0,
          totalAirfare2024: 0
        });
      }
      if (editingEmployeeId) {
        await atlasMutation(`/employees/${editingEmployeeId}`, session.token, session.sessionId, "PUT", payload);
      } else {
        await atlasMutation<Employee>("/employees", session.token, session.sessionId, "POST", payload);
      }
      resetEmployeeForm();
      await loadLiveData();
      setMessage(wasEditing ? "Employee master updated." : "Employee master saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Employee save failed");
    } finally {
      setBusy(false);
    }
  }

  function resetEmployeeForm() {
    setEditingEmployeeId(null);
    setEmployeeForm(emptyEmployeeForm());
    setEmployeeFormOpen(false);
  }

  function handleEditEmployee(employee: Employee) {
    setEditingEmployeeId(employee.EmployeeID);
    setEmployeeFormOpen(true);
    setEmployeeForm({
      code: employee.EmployeeCode || "",
      name: employee.FullName || "",
      bankCode: employee.BankCode || "",
      jobBand: employee.JobBand || "",
      joinDate: employee.JoinDate ? String(employee.JoinDate).slice(0, 10) : today,
      cpr: employee.CPR || "",
      passport: employee.Passport || "",
      department: employee.Department || "",
      branch: employee.Branch || "",
      company: employee.Company || "",
      section: employee.Section || "",
      location: employee.Location || "",
      designation: employee.Designation || "",
      group: employee.EmpGroup || "",
      reportingTo: employee.ReportingTo || "",
      nationality: employee.Nationality || "",
      bahrainiNational: String(employee.BHStatus || "").toUpperCase() === "BH" ? "Yes" : "No",
      payrollStatus: employee.Status || employee.PayrollStatus || "Active",
      accountNumber: employee.AccountNumber || "",
      passportExpiryDate: employee.PassportExpiryDate ? String(employee.PassportExpiryDate).slice(0, 10) : "",
      email: employee.Email || "",
      whatsappNumber: employee.WhatsAppNumber || "",
      basicSalary: String(employee.BasicSalary ?? ""),
      hra: String(employee.HRA ?? ""),
      specialDutyAllowance: String(employee.SpecialDutyAllowance ?? ""),
      carAllowance: String(employee.CarAllowance ?? ""),
      petrolAllowance: String(employee.PetrolAllowance ?? ""),
      phoneAllowance: String(employee.PhoneAllowance ?? ""),
      grossSalary: String(employee.GrossSalary ?? ""),
      gosiDeduction: String(employee.GOSIDeduction ?? ""),
      averageSalary: String(employee.AverageSalary ?? ""),
      religion: employee.Religion || "",
      serialNo: String(employee.SerialNo ?? ""),
      lastWorkingDate: employee.LastWorkingDate ? String(employee.LastWorkingDate).slice(0, 10) : "",
      openingDays: "",
      openingBhd: "",
      paidDays: String(employee.AirfarePaidDays ?? 0),
      maximumPayout: String(employee.MaximumPayout ?? 150),
      totalWorkingDays: String(employee.TotalWorkingDays ?? 0)
    });
    setMessage(`Editing ${employee.EmployeeCode} - master details loaded. Opening balances are maintained in the Opening Balance screen.`);
  }

  async function handleSaveAirfarePolicyRate() {
    if (!session) return setMessage("Please sign in first.");
    const amount = toNumber(policyForm.maxPayoutAmount);
    if (!policyForm.effectiveFrom) return setMessage("Effective date is required.");
    if (amount <= 0) return setMessage("Airfare amount must be more than zero.");
    if (policyForm.ruleType === "company" && !policyForm.companyId) return setMessage("Select company for company max payout rule.");
    if (policyForm.ruleType === "employee" && !policyForm.employeeId) return setMessage("Select employee for employee exception rule.");
    if (policyForm.ruleType === "department" && !policyForm.department) return setMessage("Select department for department matrix rule.");
    if (policyForm.ruleType === "payGroup" && !policyForm.payGroup) return setMessage("Select pay group for pay group matrix rule.");
    setBusy(true);
    setMessage("");
    try {
      const saved = await atlasMutation<AirfarePolicyRate>("/airfare-policy-rates", session.token, session.sessionId, "POST", {
        ruleType: policyForm.ruleType,
        effectiveFrom: policyForm.effectiveFrom,
        maxPayoutAmount: amount,
        companyId: policyForm.ruleType === "company" && policyForm.companyId ? Number(policyForm.companyId) : null,
        employeeId: policyForm.ruleType === "employee" && policyForm.employeeId ? Number(policyForm.employeeId) : null,
        department: policyForm.ruleType === "department" ? policyForm.department : null,
        payGroup: policyForm.ruleType === "payGroup" ? policyForm.payGroup : null
      });
      await loadLiveData();
      const scopeLabel = saved.EmployeeID
        ? `employee ${saved.EmployeeCode || saved.EmployeeID}`
        : saved.EmpGroup ? `pay group ${saved.EmpGroup}`
        : saved.Department ? `department ${saved.Department}`
        : saved.CompanyID ? `company ${saved.CompanyName || saved.CompanyID}` : "global default";
      setMessage(`Airfare policy saved for ${scopeLabel}: ${money.format(saved.MaxPayoutAmount || amount)} from ${formatExportDate(saved.EffectiveFrom || policyForm.effectiveFrom)}. Old allocations keep their saved policy.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save airfare policy.");
    } finally {
      setBusy(false);
    }
  }

  function getPolicyScopeLabel(rate: AirfarePolicyRate) {
    return rate.EmployeeID
      ? `employee ${rate.EmployeeCode || rate.EmployeeID}`
      : rate.EmpGroup ? `pay group ${rate.EmpGroup}`
      : rate.Department ? `department ${rate.Department}`
      : rate.CompanyID ? `company ${rate.CompanyName || rate.CompanyID}` : "global default";
  }

  function isCurrentAirfarePolicyRate(rate: AirfarePolicyRate) {
    return Boolean(rate.IsActive && !rate.EffectiveTo);
  }

  function handleEditAirfarePolicyRate(rate: AirfarePolicyRate) {
    const ruleType = rate.EmployeeID ? "employee" : rate.EmpGroup ? "payGroup" : rate.Department ? "department" : rate.CompanyID ? "company" : "global";
    setPolicyForm({
      ruleType,
      effectiveFrom: String(rate.EffectiveFrom || today).slice(0, 10),
      maxPayoutAmount: String(Number(rate.MaxPayoutAmount || AIRFARE_DEFAULT_PAYOUT)),
      companyId: rate.CompanyID ? String(rate.CompanyID) : "",
      employeeId: rate.EmployeeID ? String(rate.EmployeeID) : "",
      department: rate.Department || "",
      payGroup: rate.EmpGroup || ""
    });
    if (rate.EmployeeID) setPolicyEmployeeSearch(`${rate.EmployeeCode || rate.EmployeeID} ${rate.FullName || ""}`.trim());
    setPolicyTab("new");
    setMessage(`Draft loaded from ${getPolicyScopeLabel(rate)} policy #${rate.PolicyRateID}. Saving creates a new audited value; old allocations remain unchanged.`);
  }

  function togglePolicyRateSelection(policyRateId: number, checked: boolean) {
    setSelectedPolicyRateIds((current) => {
      const next = new Set(current);
      if (checked) next.add(policyRateId);
      else next.delete(policyRateId);
      return next;
    });
  }

  async function deleteAirfarePolicyRate(policyRateId: number) {
    const token = session?.token || "";
    const sessionId = session?.sessionId || "";
    try {
      return await atlasMutation<AirfarePolicyDeleteResult>(`/airfare-policy-rates/${policyRateId}`, token, sessionId, "DELETE");
    } catch (deleteError) {
      const message = deleteError instanceof Error ? deleteError.message : "";
      if (/405|403|404|failed|method|not allowed|forbidden/i.test(message)) {
        try {
          return await atlasMutation<AirfarePolicyDeleteResult>(`/airfare-policy-rates/${policyRateId}/delete`, token, sessionId, "POST");
        } catch (fallbackError) {
          const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : "";
          if (/404|failed|not found/i.test(fallbackMessage)) {
            return await atlasMutation<AirfarePolicyDeleteResult>(`/airfare-policy-rates/${policyRateId}`, token, sessionId, "POST");
          }
          throw fallbackError;
        }
      }
      throw deleteError;
    }
  }

  function formatAirfarePolicyDeleteMessage(scopeLabel: string, policyRateId: number, result: AirfarePolicyDeleteResult) {
    const policy = result.policyRate;
    if (policy?.HardDeleted || policy?.Purged || result.action === "hard_delete") {
      return `${scopeLabel} airfare policy #${policyRateId} purged from preferences.`;
    }
    return `${scopeLabel} airfare policy #${policyRateId} purge completed.`;
  }

  async function handleDeleteAirfarePolicyRate(rate: AirfarePolicyRate) {
    if (!session) return setMessage("Please sign in first.");
    if (!["admin", "manager"].includes(session.user.role)) return setMessage("Only admin or manager can delete preference policy rules.");
    const scopeLabel = getPolicyScopeLabel(rate);
    const confirmed = window.confirm(`Delete ${scopeLabel} airfare policy #${rate.PolicyRateID} from preferences?`);
    if (!confirmed) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await deleteAirfarePolicyRate(rate.PolicyRateID);
      setSelectedPolicyRateIds((current) => {
        const next = new Set(current);
        next.delete(rate.PolicyRateID);
        return next;
      });
      await loadLiveData();
      setMessage(formatAirfarePolicyDeleteMessage(scopeLabel, rate.PolicyRateID, result));
    } catch (error) {
      setMessage(`Airfare policy delete failed: ${error instanceof Error ? error.message : "Unable to delete airfare policy."}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleBulkDeleteAirfarePolicyRates() {
    if (!session) return setMessage("Please sign in first.");
    if (!["admin", "manager"].includes(session.user.role)) return setMessage("Only admin or manager can delete preference policy rules.");
    const selectedRates = airfarePolicyRates.filter((rate) => selectedPolicyRateIds.has(rate.PolicyRateID) && isCurrentAirfarePolicyRate(rate));
    if (!selectedRates.length) return setMessage("Select at least one current preference rule to delete.");
    const confirmed = window.confirm(`Delete ${selectedRates.length} selected current airfare policy rule(s)? Historical allocations will stay unchanged.`);
    if (!confirmed) return;
    setBusy(true);
    setMessage("");
    try {
      const results: string[] = [];
      for (const rate of selectedRates) {
        const result = await deleteAirfarePolicyRate(rate.PolicyRateID);
        results.push(formatAirfarePolicyDeleteMessage(getPolicyScopeLabel(rate), rate.PolicyRateID, result));
      }
      setSelectedPolicyRateIds(new Set());
      await loadLiveData();
      setMessage(results.length === 1 ? results[0] : `Processed ${results.length} selected preference rule(s). Protected history stayed locked.`);
    } catch (error) {
      setMessage(`Selected airfare policy delete failed: ${error instanceof Error ? error.message : "Unable to delete selected airfare policies."}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateAllocation() {
    if (!session) return setMessage("Please sign in before saving.");
    if (!selectedEmployee) return setMessage("Select an employee first.");
    if (ticketCost <= 0) return setMessage("Ticket cost must be more than zero.");
    if (requiresManagerApproval && !hasManagerApproval) {
      return setMessage(requiresLoanManagerApproval
        ? "Loan ticket needs manager approval before processing."
        : "Second ticket in this year needs manager approval before processing.");
    }
    if (allocationForm.decision === "reject") {
      setMessage("Allocation rejected. No ticket, loan, or payment entry was created.");
      return;
    }
      if (excessBalance > 0 && allocationForm.paymentMode === "entitlement") {
        setMessage("Ticket exceeds eligibility. Choose Paid by company, Paid by self employee, or Loan before processing.");
        return;
      }
    if (selectedSeparateLoans.length > 0 && allocationForm.paymentMode === "loan") {
      setMessage(`Previous separate loan exists: ${selectedSeparateLoans.length} active loan(s), outstanding ${money.format(selectedLoanOutstanding)}. Manager approval is required for this new ticket loan.`);
    }

    setBusy(true);
    setMessage("");
    try {
      let finalPaymentMode = allocationForm.paymentMode;
      let finalLoanAmount = suggestedLoan;
      let finalEmi = suggestedEmi;
      let finalEmployeePaid = allocationForm.paymentMode === "employee_full" ? ticketCost : allocationForm.paymentMode === "employee" ? excessBalance : 0;
      let finalCompanyPaid = companyPaid;
      let finalCompanyExtra = allocationForm.paymentMode === "company_full"
        ? Math.max(0, ticketCost - entitlementCovered)
        : allocationForm.paymentMode === "company" ? companyBalancePayAmount : 0;
      let finalExcess = allocationForm.paymentMode === "company_full"
        ? 0
        : allocationForm.paymentMode === "employee_full" ? 0
        : allocationForm.paymentMode === "company" ? Math.max(0, excessBalance - companyBalancePayAmount) : excessBalance;

      if (excessBalance > 0 && allocationForm.paymentMode === "entitlement") {
        const createLoan = window.confirm(
          `Ticket exceeds eligible amount by ${money.format(excessBalance)}. Do you want to create a loan for this balance amount?`
        );
        finalPaymentMode = createLoan ? "loan" : "employee";
        finalLoanAmount = createLoan ? excessBalance : 0;
        finalEmi = createLoan ? excessBalance / Math.max(1, Number(allocationForm.loanTenure) || 1) : 0;
        finalEmployeePaid = createLoan ? 0 : excessBalance;
        finalCompanyPaid = entitlementCovered;
        finalExcess = excessBalance;
      }

      const payload = {
        employeeId: selectedEmployee.EmployeeID,
        date: allocationForm.date,
        year: Number(allocationForm.year),
        overrideReason: allocationForm.overrideReason,
        managerApproval: allocationForm.managerApproval,
        ticketCost,
        entitlement: selectedEntitlement,
        companyPaid: finalCompanyPaid,
        excess: finalExcess,
        entitlementApplied: entitlementAppliedAmount,
        balanceAmount: excessBalance,
        companyBalancePayAmount,
        paymentMode: finalPaymentMode,
        loanAmount: finalLoanAmount,
        employeePaid: finalEmployeePaid,
        companyExtra: finalCompanyExtra,
        emi: finalEmi,
        tenure: Number(allocationForm.loanTenure) || 0,
        companyId: selectedCompanyId ? Number(selectedCompanyId) : null,
        companyName: activeCompany?.CompanyName || "ATLAS",
        companyCode: activeCompany?.CompanyCode || "Airfare HCM",
        companyAddress: activeCompany?.Address || "",
        companyPhone: activeCompany?.Phone || "",
        companyEmail: activeCompany?.Email || "",
        companyTrn: activeCompany?.TRN || "",
        companyLogoUrl,
        leaveStart: allocationForm.leaveStart || null,
        leaveEnd: allocationForm.leaveEnd || null,
        remarks: [
          allocationForm.emergency ? "Emergency ticket" : "",
          allocationForm.route ? `Route: ${allocationForm.route}` : "",
          allocationForm.ticketNo ? `Ticket: ${allocationForm.ticketNo}` : "",
          allocationForm.supplier ? `Supplier: ${allocationForm.supplier}` : "",
          allocationForm.invoiceNo ? `Invoice: ${allocationForm.invoiceNo}` : "",
          allocationForm.remarks
        ].filter(Boolean).join(" | ")
      };
      const allocation = await atlasMutation<Allocation>(
        editingAllocationId ? `/allocations/${editingAllocationId}` : "/allocations",
        session.token,
        session.sessionId,
        editingAllocationId ? "PUT" : "POST",
        payload
      );
      if (allocationFile) {
        await uploadAllocationAttachment(allocation.AllocationID, allocationFile);
      }
      await loadLiveData();
      setMessage(editingAllocationId
        ? `System confirmation: airfare allocation #${allocation.AllocationID} updated.`
        : finalPaymentMode === "loan" ? `System confirmation: airfare allocation #${allocation.AllocationID} saved and excess loan created.` : `System confirmation: airfare allocation #${allocation.AllocationID} saved.`);
      resetAllocationForm();
      printAllocationLetter(selectedEmployee, allocation, payload);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Allocation save failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteAllocation(allocation: Allocation) {
    if (!session) return setMessage("Please sign in before deleting.");
    const ok = window.confirm(`Delete airfare allocation ${allocation.AllocationID} and its loan/attachment links?`);
    if (!ok) return;
    setBusy(true);
    setMessage("");
    try {
      await atlasMutation(`/allocations/${allocation.AllocationID}`, session.token, session.sessionId, "DELETE");
      await loadLiveData();
      resetAllocationForm();
      setMessage(`System confirmation: airfare allocation #${allocation.AllocationID} deleted.`);
    } catch (error) {
      setMessage(formatDeleteError("Allocation delete failed", allocation.AllocationID, error));
    } finally {
      setBusy(false);
    }
  }

  function handleEditAllocation(allocation: Allocation) {
    setEditingAllocationId(allocation.AllocationID);
    setAllocationForm({
      employeeId: String(allocation.EmployeeID),
      date: formatExportDate(allocation.AllocationDate) || today,
      year: String(allocation.AllocYear || new Date().getFullYear()),
      ticketCost: String(allocation.TicketCost ?? 0),
      paymentMode: allocation.PaymentMode || "entitlement",
      decision: "process",
      emergency: String(allocation.Remarks || "").toLowerCase().includes("emergency ticket"),
      loanTenure: String(allocation.Tenure || 6),
      leaveStart: formatExportDate(allocation.LeaveStart),
      leaveEnd: formatExportDate(allocation.LeaveEnd),
      route: extractRemarkValue(allocation.Remarks, "Route"),
      ticketNo: extractRemarkValue(allocation.Remarks, "Ticket"),
      supplier: extractRemarkValue(allocation.Remarks, "Supplier"),
      invoiceNo: extractRemarkValue(allocation.Remarks, "Invoice"),
      remarks: stripSystemRemarks(allocation.Remarks),
      overrideReason: "",
      managerApproval: ""
    });
    setAllocationFile(null);
    setActiveView("Airfare");
    setMessage(`Editing allocation #${allocation.AllocationID}. Update the form and save.`);
  }

  function cancelAllocationEdit() {
    resetAllocationForm();
    setMessage("Allocation edit cancelled.");
  }

  function resetAllocationForm() {
    setEditingAllocationId(null);
    setAllocationFile(null);
    setAllocationEligibilityReview(null);
    setAllocationForm(emptyAllocationForm());
  }

  async function uploadAllocationAttachment(allocationId: number, file: File) {
    if (!session) return;
    const allowed = ["application/pdf", "image/png", "image/jpeg", "image/webp"];
    if (!allowed.includes(file.type)) throw new Error("Only PDF, PNG, JPG, or WEBP attachment is allowed.");
    if (file.size > 5 * 1024 * 1024) throw new Error("Attachment must be 5 MB or smaller.");
    const dataBase64 = await fileToDataUrl(file);
    await atlasMutation<AllocationAttachment>(
      `/allocations/${allocationId}/attachments`,
      session.token,
      session.sessionId,
      "POST",
      { fileName: file.name, mimeType: file.type, dataBase64 }
    );
  }

  async function viewAllocationAttachment(attachment: AllocationAttachment) {
    if (!session) return setMessage("Please sign in to view attachment.");
    try {
      const res = await fetch(`${atlasApiBase()}/allocation-attachments/${attachment.AttachmentID}/view`, {
        headers: {
          Authorization: `Bearer ${session.token}`,
          "X-Session-Id": session.sessionId
        }
      });
      if (!res.ok) throw new Error("Attachment view failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Attachment view failed");
    }
  }

  function toggleSelectedLoan(loanId: number) {
    setSelectedLoanIds((current) => current.includes(loanId) ? current.filter((id) => id !== loanId) : [...current, loanId]);
    setMonthlyEmiRunPreview(null);
    setMonthlyEmiReturnPreview(null);
  }

  function selectedLoanRows() {
    return loans.filter((loan) => selectedLoanIds.includes(Number(loan.LoanID)));
  }

  async function handleLoanAction(path: string, doneMessage: string, body?: Record<string, unknown>) {
    if (!session) return setMessage("Please sign in before loan action.");
    setBusy(true);
    setMessage("");
    try {
      await atlasMutation(path, session.token, session.sessionId, "POST", body);
      await loadLiveData();
      setMessage(doneMessage);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Loan action failed");
    } finally {
      setBusy(false);
    }
  }

  function getEmiRunLoanIds() {
    const selected = selectedLoanIds.length ? selectedLoanIds : filteredLoans.filter((loan) => loan.Status === "active").map((loan) => Number(loan.LoanID));
    return [...new Set(selected.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))];
  }

  async function handlePreviewSelectedEmis() {
    if (!session) return setMessage("Please sign in before previewing EMI.");
    const selected = getEmiRunLoanIds();
    if (selected.length === 0) return setMessage("No active loans selected for EMI run.");
    setBusy(true);
    setMessage("");
    try {
      const preview = await atlasMutation<LoanEmiPreview>(
        "/loans/run-emis/preview",
        session.token,
        session.sessionId,
        "POST",
        { loanIds: selected, paymentDate: loanOpsForm.actionDate }
      );
      setMonthlyEmiRunPreview(preview);
      setMonthlyEmiReturnPreview(null);
      setMessage(`EMI preview ready for ${preview.processed} loan(s). Review and process from the preview panel.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "EMI preview failed");
      setMonthlyEmiRunPreview(null);
    } finally {
      setBusy(false);
    }
  }

  async function handleRunSelectedEmis() {
    if (!session) return setMessage("Please sign in before running EMI.");
    const selected = getEmiRunLoanIds();
    if (selected.length === 0) return setMessage("No active loans selected for EMI run.");
    if (!monthlyEmiRunPreview) {
      await handlePreviewSelectedEmis();
      return;
    }
    if (monthlyEmiRunPreview.processed === 0) return setMessage("Preview has no loans to process.");
    setBusy(true);
    setMessage("");
    try {
      const processed = monthlyEmiRunPreview.processed;
      await atlasMutation("/loans/run-emis", session.token, session.sessionId, "POST", {
          loanIds: selected,
          paymentDate: loanOpsForm.actionDate,
          confirm: "RUN_EMI"
        });
      await loadLiveData();
      setMonthlyEmiRunPreview(null);
      setMonthlyEmiReturnPreview(null);
      setSelectedLoanIds([]);
      setMessage(`System confirmation: monthly EMI processed for ${processed} loan(s).`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "EMI processing failed");
    } finally {
      setBusy(false);
    }
  }

  async function handlePreviewReturnSelectedEmis() {
    if (!session) return setMessage("Please sign in before previewing EMI return.");
    if (selectedLoanIds.length === 0) return setMessage("Select processed loan rows before previewing EMI return.");
    setBusy(true);
    setMessage("");
    try {
      const preview = await atlasMutation<LoanEmiReturnPreview>(
        "/loans/reverse-emis/preview",
        session.token,
        session.sessionId,
        "POST",
        { loanIds: selectedLoanIds }
      );
      setMonthlyEmiReturnPreview(preview);
      setMonthlyEmiRunPreview(null);
      setMessage(`EMI return preview ready: ${preview.reversible} of ${preview.selected} selected loan(s) can be returned.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "EMI return preview failed");
      setMonthlyEmiReturnPreview(null);
    } finally {
      setBusy(false);
    }
  }

  async function handleReturnSelectedEmis() {
    if (!session) return setMessage("Please sign in before returning EMI.");
    if (!monthlyEmiReturnPreview) {
      await handlePreviewReturnSelectedEmis();
      return;
    }
    if (monthlyEmiReturnPreview.reversible === 0) return setMessage("No selected loan has a latest EMI available for return.");
    setBusy(true);
    setMessage("");
    try {
      const result = await atlasMutation<{ processed: number; totalReturned: number }>(
        "/loans/reverse-emis",
        session.token,
        session.sessionId,
        "POST",
        {
          loanIds: selectedLoanIds,
          reversalDate: loanOpsForm.actionDate,
          note: loanOpsForm.note || "Wrong monthly EMI returned",
          confirm: "REVERSE_EMI"
        }
      );
      await loadLiveData();
      setMonthlyEmiReturnPreview(null);
      setMonthlyEmiRunPreview(null);
      setSelectedLoanIds([]);
      setMessage(`System confirmation: returned EMI for ${result.processed} loan(s), total ${money.format(result.totalReturned || 0)}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "EMI return failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeferLoan(loan: Loan) {
    const deferMonths = Math.max(1, Number(loanOpsForm.deferMonths) || 1);
    const ok = window.confirm(`Defer EMI for ${loan.FullName} by ${deferMonths} month(s)? EMI will not run while the loan is deferred.`);
    if (!ok) return;
    await handleLoanAction(`/loans/${loan.LoanID}/defer`, `System confirmation: loan #${loan.LoanID} deferred for ${deferMonths} month(s).`, {
      deferMonths,
      deferStart: loanOpsForm.actionDate,
      note: loanOpsForm.note || "EMI holiday / moratorium",
      confirm: "DEFER"
    });
  }

  async function handleRestructureLoan(loan: Loan) {
    const newEmi = Number(loanOpsForm.newEmi) > 0 ? Number(loanOpsForm.newEmi) : null;
    const newTenureMonths = Number(loanOpsForm.newTenureMonths) > 0 ? Number(loanOpsForm.newTenureMonths) : null;
    if (!newEmi && !newTenureMonths) return setMessage("Enter new EMI amount or new remaining months first.");
    const detail = newEmi ? `new EMI ${money.format(newEmi)}` : `new remaining tenure ${newTenureMonths} month(s)`;
    const ok = window.confirm(`Restructure loan for ${loan.FullName} with ${detail}? This will update future EMI only.`);
    if (!ok) return;
    await handleLoanAction(`/loans/${loan.LoanID}/restructure`, `System confirmation: loan #${loan.LoanID} restructured.`, {
      newEmi,
      newTenureMonths,
      effectiveDate: loanOpsForm.actionDate,
      note: loanOpsForm.note || "Loan EMI restructuring",
      confirm: "RESTRUCTURE"
    });
    setLoanOpsForm((current) => ({ ...current, newEmi: "", newTenureMonths: "", note: "" }));
  }

  async function handleSettleAllLoans() {
    const activeCount = loans.filter((loan) => loan.Status === "active").length;
    const ok = window.confirm(`Settle all ${activeCount} active loan(s)? This is a high-impact closure action.`);
    if (!ok) return;
    await handleLoanAction("/loans/settle-all", "System confirmation: all active loans settled.");
  }

  async function handleCreateLoan() {
    if (!session) return setMessage("Please sign in before creating a loan.");
    if (!selectedLoanEmployee) return setMessage("Select an employee first.");
    if (loanAmount <= 0) return setMessage("Loan amount must be more than zero.");
    if (loanTenure <= 0) return setMessage("Tenure must be more than zero.");

    setBusy(true);
    setMessage("");
    try {
      await atlasMutation<Loan>(editingLoanId ? `/loans/${editingLoanId}` : "/loans", session.token, session.sessionId, editingLoanId ? "PUT" : "POST", {
        employeeId: selectedLoanEmployee.EmployeeID,
        amount: loanAmount,
        tenure: loanTenure,
        date: loanForm.date,
        note: loanForm.note
      });
      const wasEditing = Boolean(editingLoanId);
      setEditingLoanId(null);
      setLoanForm({ employeeId: "", amount: "0", tenure: "6", date: today, note: "" });
      await loadLiveData();
      setMessage(wasEditing ? "Employee loan updated with repayment schedule." : "Employee loan created with repayment schedule.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Loan create failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleSettleLoan(loan: Loan) {
    if (!session) return setMessage("Please sign in before settling.");
    const ok = window.confirm(`Early settle / close loan for ${loan.FullName}?\nOutstanding payoff: ${money.format(loan.RemainingBalance || 0)}\n\nClick OK only after manager approval.`);
    if (!ok) return;
    setBusy(true);
    setMessage("");
    try {
      await atlasMutation(`/loans/${loan.LoanID}/settle`, session.token, session.sessionId, "POST", {
        settlementDate: loanOpsForm.actionDate,
        note: loanOpsForm.note || "Early payoff / closure",
        confirm: "SETTLE"
      });
      await loadLiveData();
      setMessage("System confirmation: loan settled and history updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Loan settlement failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteLoan(loan: Loan) {
    if (!session) return setMessage("Please sign in before deleting.");
    const ok = window.confirm(`Delete loan for ${loan.FullName}? This removes its loan history also.`);
    if (!ok) return;
    setBusy(true);
    setMessage("");
    try {
      await atlasMutation(`/loans/${loan.LoanID}`, session.token, session.sessionId, "DELETE");
      await loadLiveData();
      setEditingLoanId(null);
      setLoanForm({ employeeId: "", amount: "0", tenure: "6", date: today, note: "" });
      setMessage(`Loan #${loan.LoanID} and repayment history deleted.`);
    } catch (error) {
      setMessage(formatDeleteError("Loan delete failed", loan.LoanID, error));
    } finally {
      setBusy(false);
    }
  }

  function handleEditLoan(loan: Loan) {
    setEditingLoanId(loan.LoanID);
    setLoanForm({
      employeeId: String(loan.EmployeeID),
      amount: String(loan.OriginalAmount || loan.RemainingBalance || 0),
      tenure: String(loan.Tenure || 6),
      date: formatExportDate(loan.CreatedDate) || today,
      note: `Edit loan #${loan.LoanID}`
    });
    setActiveView("Loans");
    setMessage(`Editing loan #${loan.LoanID}. Update values and save.`);
  }

  function cancelLoanEdit() {
    setEditingLoanId(null);
    setLoanForm({ employeeId: "", amount: "0", tenure: "6", date: today, note: "" });
    setMessage("Loan edit cancelled.");
  }

  async function handleExportLoans() {
    const visibleLoans = filteredLoans.map((loan) => ({
      "Loan No": loan.LoanID,
      "Employee Code": loan.EmployeeCode,
      "Employee Name": loan.FullName,
      Department: loan.Department || "",
      Branch: loan.Branch || "",
      "Original Amount": loan.OriginalAmount,
      "Remaining Balance": loan.RemainingBalance,
      EMI: loan.EMI,
      Tenure: loan.Tenure,
      "Months Paid": loan.MonthsPaid,
      "Months Left": loan.MonthsLeft ?? Math.ceil((loan.RemainingBalance || 0) / Math.max(loan.EMI || 1, 1)),
      "Paid %": loan.PaidPercent ?? 0,
      Status: loan.Status,
      "Created Date": formatExportDate(loan.CreatedDate),
      "Estimated Close Date": formatExportDate(loan.EstimatedCloseDate)
    }));
    await exportRowsToExcel("ATLAS_Loan_Register.xlsx", Object.keys(visibleLoans[0] || { "Loan No": "" }), visibleLoans);
    setMessage(`Loan register exported with ${visibleLoans.length} row(s).`);
  }

  async function handleDeleteEmployee(employee: Employee) {
    if (!session) return setMessage("Please sign in before deleting.");
    const employeeCode = String(employee.EmployeeCode || employee.EmployeeID);
    const typed = window.prompt([
      `Delete employee ${employee.FullName}?`,
      `Employee code: ${employeeCode}`,
      "Type the employee code to confirm deletion."
    ].join("\n"));
    if (typed !== employeeCode) {
      return setMessage("Employee delete cancelled. The employee code did not match.");
    }
    setBusy(true);
    setMessage("");
    try {
      await atlasMutation(`/employees/${employee.EmployeeID}`, session.token, session.sessionId, "DELETE");
      await loadLiveData();
      if (editingEmployeeId === employee.EmployeeID) resetEmployeeForm();
      setSelectedEmployeeIds((current) => {
        const next = new Set(current);
        next.delete(employee.EmployeeID);
        return next;
      });
      setMessage(`Employee ${employeeCode} - ${employee.FullName} deleted.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("EMPLOYEE_DELETE_BLOCKED")) {
        const detail = parseEmployeeDeleteBlock(message);
        const linkedText = [
          `${detail.loans} loan(s)`,
          `${detail.allocations} airfare allocation(s)`,
          `${detail.emergencyTickets} emergency ticket(s)`,
          `${detail.openingBalances} opening balance row(s)`
        ].join(", ");
        const forceOk = window.confirm([
          `Employee ${employeeCode} has linked records: ${linkedText}.`,
          "Full delete will remove the employee and those linked operational records.",
          "Audit log entries and historical system logs remain protected.",
          "Continue with full employee delete?"
        ].join("\n"));
        if (!forceOk) {
          setMessage(`Employee ${employeeCode} was not deleted. Linked records are still safe.`);
          return;
        }
        try {
          await atlasMutation(`/employees/${employee.EmployeeID}?force=true`, session.token, session.sessionId, "DELETE");
          await loadLiveData();
          if (editingEmployeeId === employee.EmployeeID) resetEmployeeForm();
          setSelectedEmployeeIds((current) => {
            const next = new Set(current);
            next.delete(employee.EmployeeID);
            return next;
          });
          setMessage(`Employee ${employeeCode} - ${employee.FullName} fully deleted with linked operational records.`);
        } catch (forceError) {
          setMessage(formatDeleteError("Full employee delete failed", employee.EmployeeID, forceError));
        }
      } else {
        setMessage(formatDeleteError("Employee delete failed", employee.EmployeeID, error));
      }
    } finally {
      setBusy(false);
    }
  }

  function parseEmployeeDeleteBlock(message: string) {
    const jsonStart = message.indexOf("{");
    if (jsonStart >= 0) {
      try {
        const payload = JSON.parse(message.slice(jsonStart));
        const details = payload.details || {};
        return {
          loans: Number(details.loans) || 0,
          allocations: Number(details.allocations) || 0,
          emergencyTickets: Number(details.emergencyTickets) || 0,
          openingBalances: Number(details.openingBalances) || 0
        };
      } catch {}
    }
    return { loans: 0, allocations: 0, emergencyTickets: 0, openingBalances: 0 };
  }

  function formatDeleteError(action: string, id: number, error: unknown) {
    return `${action}: ${error instanceof Error ? error.message : `Unable to delete record #${id}. Please try again.`}`;
  }

  function handleToggleEmployeeSelection(employeeId: number, checked: boolean) {
    setSelectedEmployeeIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(employeeId);
      } else {
        next.delete(employeeId);
      }
      return next;
    });
  }

  function handleSelectAllEmployeeRows(employeeIds: number[], checked: boolean) {
    setSelectedEmployeeIds((current) => {
      const next = new Set(current);
      if (checked) {
        employeeIds.forEach((employeeId) => next.add(employeeId));
      } else {
        employeeIds.forEach((employeeId) => next.delete(employeeId));
      }
      return next;
    });
  }

  async function handleBulkDeleteEmployees(employeeIds: number[]) {
    if (!session) return setMessage("Please sign in before deleting.");
    if (!employeeIds.length) return setMessage("Please select at least one employee to delete.");
    const ok = window.confirm(`Delete ${employeeIds.length} selected employee(s)?`);
    if (!ok) return;

    setBusy(true);
    setMessage("");

    const uniqueIds = [...new Set(employeeIds)].filter((id) => Number.isFinite(id) && id > 0);

    try {
      const response = await atlasMutation<{
        deletedCount: number;
        deleted: Array<{ employeeId: number; employeeCode?: string; fullName?: string }>;
        blocked: Array<{ employeeId: number; employeeCode?: string; fullName?: string; loans?: number; allocations?: number; emergencyTickets?: number; openingBalances?: number; }>;
        notFound: number[];
      }>(`/employees/bulk-delete`, session.token, session.sessionId, "POST", { employeeIds: uniqueIds });

      const deletedSet = new Set(response.deleted.map((entry) => entry.employeeId));
      const notFoundSet = new Set(response.notFound || []);
      setSelectedEmployeeIds((current) => {
        const next = new Set(current);
        for (const id of [...current]) {
          if (deletedSet.has(id) || notFoundSet.has(id)) {
            next.delete(id);
          }
        }
        return next;
      });

      if (response.blocked?.length) {
        console.log(
          "[ATLAS] bulk delete blocked",
          response.blocked.map((entry) => ({
            employeeId: entry.employeeId,
            employeeCode: entry.employeeCode,
            fullName: entry.fullName,
            loans: entry.loans || 0,
            allocations: entry.allocations || 0,
            emergencyTickets: entry.emergencyTickets || 0,
            openingBalances: entry.openingBalances || 0
          }))
        );
      }

      await loadLiveData();

      const deleted = response.deletedCount || 0;
      const blocked = response.blocked?.length || 0;
      const notFound = response.notFound?.length || 0;
      if (deleted === 0 && blocked === 0 && notFound === 0) {
        setMessage("No employees were selected for deletion.");
      } else {
        const parts: string[] = [];
        if (deleted) parts.push(`${deleted} deleted`);
        if (blocked) parts.push(`${blocked} blocked (linked data)`);
        if (notFound) parts.push(`${notFound} not found`);
        setMessage(`Bulk delete finished: ${parts.join(", ")}.`);
      }
    } catch {
      setMessage("Bulk delete failed unexpectedly.");
    } finally {
      setBusy(false);
    }
  }

  async function handleImportEmployees(event: React.ChangeEvent<HTMLInputElement>) {
    if (!session) {
      event.target.value = "";
      return setMessage("Please sign in before importing Excel.");
    }
    const file = event.target.files?.[0];
    if (!file) return;

    setBusy(true);
    setMessage("");
    try {
      const rows = (await readSheet(file) as unknown) as unknown[][];
      const headerIndex = findEmployeeHeaderRow(rows);
      if (headerIndex < 0) throw new Error("Excel header row not found. Please use the Employee Information export format.");

      const originalHeaders = rows[headerIndex].map((cell) => cellText(cell));
      const headers = rows[headerIndex].map((cell) => normalizeHeader(cell));
      const parsedRows = rows.slice(headerIndex + 1).map((row, index) => {
        const mapped = mapEmployeeExcelRow(headers, row);
        const sourceRow = headerIndex + index + 2;
        const hasAnyEmployeeValue = Object.values(mapped).some((value) => value !== "" && value !== null && value !== undefined && value !== 0);
        const validationNotes: string[] = [];
        if (!mapped.code) validationNotes.push("Employee code missing");
        if (!mapped.name) validationNotes.push("Employee name missing");
        return {
          ...mapped,
          sourceRow,
          importKey: `${sourceRow}-${mapped.code || mapped.name || index}`,
          selected: Boolean(mapped.code && mapped.name),
          validationStatus: (mapped.code && mapped.name ? "Ready" : "Review") as EmployeeImportRow["validationStatus"],
          validationNotes,
          hasAnyEmployeeValue
        };
      });
      const employeesToImport = parsedRows.filter((employee) => employee.hasAnyEmployeeValue).map(({ hasAnyEmployeeValue, ...employee }) => employee);

      if (!employeesToImport.length) {
        const nonBlankCount = parsedRows.filter((item) =>
          [item.code, item.name, item.department, item.joinDate, item.email, item.accountNumber, item.basicSalary].some(Boolean)
        ).length;
        const sample = parsedRows
          .slice(0, 3)
          .map((item) => `row ${item.sourceRow}: code="${item.code}" name="${item.name}"`)
          .join("; ");
        throw new Error(
          `No employee rows found in the Excel file. Headers detected: [${headers.filter(Boolean).slice(0, 8).join(", ")}]. ` +
          `Parsed ${parsedRows.length} data rows (${nonBlankCount} partially mapped). Sample: ${sample || "none"}`
        );
      }

      const previewResult = await atlasMutation<{
        batch: {
          ImportBatchID: number;
          TotalRows: number;
          ReadyRows: number;
          WarningRows: number;
          ErrorRows: number;
          SelectedRows: number;
        };
        rows: Array<{
          importBatchRowId: number;
          sourceRow: number;
          code: string;
          name: string;
          department: string;
          designation: string;
          company: string;
          status: string;
          action: string;
          severity: "READY" | "WARNING" | "ERROR";
          message: string;
          selected: boolean;
        }>;
      }>("/employees/import-preview", session.token, session.sessionId, "POST", {
        fileName: file.name,
        headers: originalHeaders,
        employees: employeesToImport
      });

      const sqlRowsBySource = new Map(previewResult.rows.map((row) => [row.sourceRow, row]));
      const intelligentRows = employeesToImport.map((employee) => {
        const sqlRow = sqlRowsBySource.get(employee.sourceRow);
        const notes = [...employee.validationNotes];
        if (sqlRow?.message && sqlRow.message !== "Ready for import.") notes.push(sqlRow.message);
        return {
          ...employee,
          importBatchRowId: sqlRow?.importBatchRowId,
          selected: Boolean(sqlRow?.selected && employee.validationStatus === "Ready"),
          validationStatus: sqlRow?.severity === "ERROR" ? ("Review" as const) : employee.validationStatus,
          validationNotes: notes,
          sqlSeverity: sqlRow?.severity,
          sqlAction: sqlRow?.action,
          sqlMessage: sqlRow?.message
        };
      });

      setImportPreview({
        importBatchId: Number(previewResult.batch.ImportBatchID),
        fileName: file.name,
        headers: originalHeaders,
        normalizedHeaders: headers,
        employees: intelligentRows,
        summary: {
          totalRows: Number(previewResult.batch.TotalRows || intelligentRows.length),
          readyRows: Number(previewResult.batch.ReadyRows || 0),
          warningRows: Number(previewResult.batch.WarningRows || 0),
          errorRows: Number(previewResult.batch.ErrorRows || 0),
          selectedRows: Number(previewResult.batch.SelectedRows || 0)
        }
      });
      const selectedCount = intelligentRows.filter((employee) => employee.selected).length;
      const reviewCount = intelligentRows.filter((employee) => employee.validationStatus === "Review").length;
      setMessage(`SQL preview ready: batch #${previewResult.batch.ImportBatchID}, ${intelligentRows.length} row(s), ${selectedCount} selected${reviewCount ? `, ${reviewCount} need review` : ""}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Excel import failed");
    } finally {
      event.target.value = "";
      setBusy(false);
    }
  }

  async function confirmImportEmployees() {
    if (!session) return setMessage("Please sign in before importing Excel.");
    if (!importPreview?.employees.length) return setMessage("No employee preview is ready for import.");
    const selectedEmployees = importPreview.employees.filter((employee) => employee.selected && employee.code && employee.name && employee.importBatchRowId);
    if (!selectedEmployees.length) return setMessage("Select at least one valid employee row before importing.");
    if (!importPreview.importBatchId) return setMessage("SQL import preview batch is missing. Please select the Excel file again.");

    setBusy(true);
    setMessage("");
    try {
      const result = await atlasMutation<{ inserted: number; updated: number; reviewedRows?: number; errors: Array<{ row: unknown; code?: string; error: string }> }>(
        "/employees/import-confirm",
        session.token,
        session.sessionId,
        "POST",
        {
          importBatchId: importPreview.importBatchId,
          rowIds: selectedEmployees.map((employee) => employee.importBatchRowId)
        }
      );
      await loadLiveData();
      const errorText = result.errors.length ? ` ${result.errors.length} row(s) need review.` : "";
      setImportPreview(null);
      setMessage(`Excel import complete: ${result.inserted} new, ${result.updated} updated from ${selectedEmployees.length} selected row(s).${errorText}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Excel import failed");
    } finally {
      setBusy(false);
    }
  }

  function toggleImportEmployeeRow(importKey: string, checked: boolean) {
    setImportPreview((current) => current ? {
      ...current,
      employees: current.employees.map((employee) => employee.importKey === importKey ? { ...employee, selected: checked } : employee)
    } : current);
  }

  function toggleAllImportEmployeeRows(checked: boolean) {
    setImportPreview((current) => current ? {
      ...current,
      employees: current.employees.map((employee) => ({
        ...employee,
        selected: checked && employee.validationStatus === "Ready"
      }))
    } : current);
  }

  function removeImportEmployeeRow(importKey: string) {
    setImportPreview((current) => current ? {
      ...current,
      employees: current.employees.filter((employee) => employee.importKey !== importKey)
    } : current);
  }

  async function handleSaveOpeningBalance() {
    if (!session) return setMessage("Please sign in before saving.");
    const employee = employees.find((item) => item.EmployeeID === Number(openingForm.employeeId));
    if (!employee) return setMessage("Select employee first.");
    if (openingForm.openingDays.trim() === "" || openingForm.openingBhd.trim() === "") {
      return setMessage("Enter opening days and opening amount before saving.");
    }
    const maximumPayout = toNumber(openingForm.maximumPayout, employee.MaximumPayout || AIRFARE_DEFAULT_PAYOUT);
    const openingDays = Math.min(AIRFARE_MAX_DAYS, toNumber(openingForm.openingDays));
    const openingBhd = toNumber(openingForm.openingBhd, roundMoney((maximumPayout / 60) * openingDays));

    setBusy(true);
    setMessage("");
    try {
      await atlasMutation("/opening-balances", session.token, session.sessionId, "POST", {
        employeeId: employee.EmployeeID,
        year: Number(openingForm.year),
        openingDays,
        openingBhd,
        maximumPayout
      });
      await loadLiveData();
      setOpeningForm({ ...openingForm, employeeId: "", openingDays: "", openingBhd: "", maximumPayout: "150" });
      setMessage("Opening balance saved and employee airfare balance updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Opening balance save failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleImportOpeningBalances(event: React.ChangeEvent<HTMLInputElement>) {
    if (!session) {
      event.target.value = "";
      return setMessage("Please sign in before importing opening balances.");
    }
    const file = event.target.files?.[0];
    if (!file) return;

    setBusy(true);
    setMessage("");
    try {
      const rows = (await readSheet(file) as unknown) as unknown[][];
      const headerIndex = rows.findIndex((row) => {
        const keys = row.map((cell) => normalizeHeader(cell));
        return keys.some((key) => ["employeeno", "employeno", "employeecode", "empno", "codegeneral"].includes(key));
      });
      if (headerIndex < 0) throw new Error("Opening balance header row not found.");
      const headers = rows[headerIndex].map((cell) => normalizeHeader(cell));
      const originalHeaders = rows[headerIndex].map((cell) => cellText(cell));
      const parsedBalances = rows.slice(headerIndex + 1).map((row, index) => ({
        ...mapOpeningBalanceExcelRow(headers, row, Number(openingForm.year)),
        sourceRow: headerIndex + index + 2
      }));
      const blankSkipped = parsedBalances.filter((row) => !row.employeeCode && !row.employeeName && !row.openingDays && !row.importedOpeningBhd).length;
      const balances = parsedBalances
        .filter((row) => row.employeeCode || row.openingDays || row.importedOpeningBhd)
        .map((row) => ({
          ...row,
          openingBhd: roundMoney((Number(row.maximumPayout || AIRFARE_DEFAULT_PAYOUT) / AIRFARE_MAX_DAYS) * Math.min(AIRFARE_MAX_DAYS, Number(row.openingDays || 0)))
        }));
      if (!balances.length) throw new Error("No opening balance rows found.");
      const previewResult = await atlasMutation<{
        batch: {
          ImportBatchID: number;
          TotalRows: number;
          ReadyRows: number;
          WarningRows: number;
          ErrorRows: number;
          SelectedRows: number;
        };
        rows: Array<{
          importBatchRowId: number;
          sourceRow: number;
          employeeCode: string;
          employeeName?: string;
          year: number;
          openingDays: number;
          openingBhd: number;
          maximumPayout: number;
          severity: "READY" | "WARNING" | "ERROR";
          action: string;
          message: string;
          selected: boolean;
        }>;
      }>("/opening-balances/import-preview", session.token, session.sessionId, "POST", {
        fileName: file.name,
        headers: originalHeaders,
        rows: balances
      });
      setOpeningPreview({
        importBatchId: Number(previewResult.batch.ImportBatchID),
        fileName: file.name,
        rows: previewResult.rows.map((row) => ({
          importBatchRowId: row.importBatchRowId,
          sourceRow: row.sourceRow,
          employeeCode: row.employeeCode,
          employeeName: row.employeeName,
          year: Number(row.year),
          openingDays: Number(row.openingDays || 0),
          openingBhd: Number(row.openingBhd || 0),
          maximumPayout: Number(row.maximumPayout || 150),
          selected: Boolean(row.selected),
          severity: row.severity,
          action: row.action,
          message: row.message
        })),
        summary: {
          totalRows: Number(previewResult.batch.TotalRows || previewResult.rows.length),
          readyRows: Number(previewResult.batch.ReadyRows || 0),
          warningRows: Number(previewResult.batch.WarningRows || 0),
          errorRows: Number(previewResult.batch.ErrorRows || 0),
          selectedRows: Number(previewResult.batch.SelectedRows || 0)
        }
      });
      setMessage(`Opening balance SQL preview ready: batch #${previewResult.batch.ImportBatchID}, ${previewResult.rows.length} row(s). Amount calculated from opening days.${blankSkipped ? ` ${blankSkipped} blank row(s) skipped.` : ""}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Opening balance Excel import failed");
    } finally {
      event.target.value = "";
      setBusy(false);
    }
  }

  async function confirmImportOpeningBalances() {
    if (!session) return setMessage("Please sign in before importing.");
    if (!openingPreview?.rows.length) return setMessage("No opening balance preview is ready.");
    if (!openingPreview.importBatchId) return setMessage("SQL opening balance preview batch is missing. Please select Excel again.");
    const selectedRows = openingPreview.rows.filter((row) => row.selected && row.importBatchRowId && row.severity !== "ERROR");
    if (!selectedRows.length) return setMessage("Select at least one valid opening balance row before importing.");
    setBusy(true);
    setMessage("");
    try {
      const result = await atlasMutation<{ updated: number; selectedRows: number; errors: Array<{ row: unknown; code?: string; error: string }> }>(
        "/opening-balances/import-confirm",
        session.token,
        session.sessionId,
        "POST",
        {
          importBatchId: openingPreview.importBatchId,
          rowIds: selectedRows.map((row) => row.importBatchRowId)
        }
      );
      await loadLiveData();
      setOpeningPreview(null);
      const errorText = result.errors.length ? ` ${result.errors.length} row(s) need review.` : "";
      setMessage(`Opening balance import complete: ${result.updated} updated from ${selectedRows.length} selected row(s).${errorText}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Opening balance import failed");
    } finally {
      setBusy(false);
    }
  }

  function toggleOpeningPreviewRow(importBatchRowId: number | undefined, checked: boolean) {
    if (!importBatchRowId) return;
    setOpeningPreview((current) => current ? {
      ...current,
      rows: current.rows.map((row) => row.importBatchRowId === importBatchRowId ? { ...row, selected: checked } : row)
    } : current);
  }

  function toggleAllOpeningPreviewRows(checked: boolean) {
    setOpeningPreview((current) => current ? {
      ...current,
      rows: current.rows.map((row) => ({ ...row, selected: checked && row.severity !== "ERROR" }))
    } : current);
  }

  function removeOpeningPreviewRow(importBatchRowId: number | undefined) {
    if (!importBatchRowId) return;
    setOpeningPreview((current) => current ? {
      ...current,
      rows: current.rows.filter((row) => row.importBatchRowId !== importBatchRowId)
    } : current);
  }

  async function handleExportEmployeeMaster() {
    const rows = employees.map(employeeToExportRow);
    await exportRowsToExcel("ATLAS_Employee_Master.xlsx", employeeExportColumns, rows);
    setMessage(`Employee Master exported with ${rows.length} row(s).`);
  }

  async function handleExportSqlEmployeeReport() {
    if (!session) return setMessage("Please sign in before exporting SQL report.");
    setBusy(true);
    setMessage("");
    try {
      const reportRows = await atlasFetch<Employee[]>("/reports/employee-master", session.token, session.sessionId);
      await exportRowsToExcel("ATLAS_SQL_Employee_Master_Report.xlsx", employeeExportColumns, reportRows.map(employeeToExportRow));
      setMessage(`SQL Employee Master report exported with ${reportRows.length} row(s).`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "SQL report export failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleExportAirfareReport() {
    const resolveAirfareEntitlementAmount = (row: AirfarePayableReportRow) => Number(Math.max(0, Number(row.AirfareEntitlementAmount ?? 0)).toFixed(2));
    const resolveAirfarePayableAmount = (row: AirfarePayableReportRow) => Number(Math.max(0, Number(row.PayableBHD ?? (Number(row.BalanceDays || 0) * Number(row.PerDayRate || 2.5)))).toFixed(2));
    const sourceRows = session ? await refreshAirfarePayableReport(session) : airfarePayableReport;
    const rows = sourceRows.map((row) => ({
      "Employee Code": row.EmployeeCode,
      "Employee Name": row.FullName,
      Department: row.Department || "",
      Designation: row.Designation || "",
      Year: row.ReportYear,
      "Annual Days": Number(row.AnnualEntitlementDays || 30).toFixed(2),
      "Annual Amount": Number(row.AnnualEntitlementBHD || 75).toFixed(2),
      "Opening Days": row.OpeningBalanceDays || 0,
      "Opening Amount": row.OpeningBalanceBHD || 0,
      "Current Earned Days": row.CurrentYearEarnedDays || 0,
      "Current Earned Amount": row.CurrentYearEarnedBHD || 0,
      "Company Paid Amount": row.CompanyPaidCurrentYear || 0,
      "Balance Days": row.BalanceDays || 0,
      "Airfare Entitlement Amount": resolveAirfareEntitlementAmount(row),
      "Payable Amount": resolveAirfarePayableAmount(row),
      Status: row.VerificationNote || ""
    }));
    await exportRowsToExcel("ATLAS_Airfare_Payable_Report.xlsx", Object.keys(rows[0] || { "Employee Code": "" }), rows);
    setMessage(`Airfare report exported with ${rows.length} row(s).`);
  }

  async function handleExportOpeningBalances() {
    const year = Number(openingForm.year) || new Date().getFullYear();
    const rows = employees.map((employee) => ({
      "Employee Code": employee.EmployeeCode,
      "Employee Name": employee.FullName,
      Department: employee.Department || "",
      Branch: employee.Branch || "",
      "Opening Year": year,
      "Opening Days": closingBalanceDays(employee),
      "Opening Amount": calculateExcelTotal(employee),
      "Maximum Payout": employee.MaximumPayout ?? 150,
      Status: employee.Status || ""
    }));
    await exportRowsToExcel("ATLAS_Opening_Balance_Register.xlsx", Object.keys(rows[0] || { "Employee Code": "" }), rows);
    setMessage(`Opening balance register exported with ${rows.length} row(s).`);
  }

  async function handleExportAllocations() {
    const rows = allocations.map((allocation) => ({
      "Allocation No": allocation.AllocationID,
      "Employee Code": allocation.EmployeeCode,
      "Employee Name": allocation.FullName,
      Date: formatReportDate(allocation.AllocationDate),
      Year: allocation.AllocYear,
      "Ticket Cost": allocation.TicketCost || 0,
      Entitlement: allocation.Entitlement || 0,
      "Company Paid": allocation.CompanyPaid || 0,
      Excess: allocation.ExcessAmount || 0,
      "Payment Mode": formatPaymentModeLabel(allocation.PaymentMode),
      "Loan Amount": allocation.LoanAmount || 0,
      "Employee Paid": allocation.EmployeePaid || 0,
      Remarks: allocation.Remarks || ""
    }));
    await exportRowsToExcel("ATLAS_Airfare_Allocation_Register.xlsx", Object.keys(rows[0] || { "Allocation No": "" }), rows);
    setMessage(`Allocation register exported with ${rows.length} row(s).`);
  }

  async function handleExportDashboardSummary() {
    const rows = [
      { Metric: "Employees", Value: employees.length },
      { Metric: "Airfare Payable Amount", Value: metrics.totalAirfare },
      { Metric: "Opening Balance Amount", Value: metrics.opening },
      { Metric: "Active Loans", Value: loanSummary?.ActiveLoans ?? loans.filter((loan) => loan.Status === "active").length },
      { Metric: "Loan Outstanding Amount", Value: loanSummary?.TotalOutstanding ?? metrics.loanBalance },
      { Metric: "Company Paid Amount", Value: metrics.companyPaidTotal },
      { Metric: "Allocations This Year", Value: summary?.allocations.TotalAllocations ?? allocations.length }
    ];
    await exportRowsToExcel("ATLAS_Dashboard_Summary.xlsx", ["Metric", "Value"], rows);
    setMessage("Dashboard summary exported.");
  }

  function printDashboardSummary() {
    const rows = [
      { Metric: "Employees", Value: employees.length },
      { Metric: "Airfare Payable Amount", Value: metrics.totalAirfare.toFixed(2) },
      { Metric: "Opening Balance Amount", Value: metrics.opening.toFixed(2) },
      { Metric: "Active Loans", Value: loanSummary?.ActiveLoans ?? loans.filter((loan) => loan.Status === "active").length },
      { Metric: "Loan Outstanding Amount", Value: Number(loanSummary?.TotalOutstanding ?? metrics.loanBalance).toFixed(2) },
      { Metric: "Company Paid Amount", Value: metrics.companyPaidTotal.toFixed(2) }
    ];
    printPremiumReport("Dashboard Summary", rows, ["Metric", "Value"], activeCompany, companyLogoUrl);
  }

  function printEmployeeMasterReport() {
    const rows = filteredEmployees.map((employee) => ({
      Code: employee.EmployeeCode,
      Name: employee.FullName,
      Department: employee.Department || "-",
      Status: employee.Status || "-",
      "Airfare Amount": calculateExcelTotal(employee).toFixed(2)
    }));
    printPremiumReport("Employee Master", rows, ["Code", "Name", "Department", "Status", "Airfare Amount"], activeCompany, companyLogoUrl);
  }

  function printAirfarePayableReport() {
    const resolveAirfareEntitlementAmount = (row: AirfarePayableReportRow) => Number(Math.max(0, Number(row.AirfareEntitlementAmount ?? 0)).toFixed(2));
    const resolveAirfarePayableAmount = (row: AirfarePayableReportRow) => Number(Math.max(0, Number(row.PayableBHD ?? (Number(row.BalanceDays || 0) * Number(row.PerDayRate || 2.5)))).toFixed(2));
    const rows = airfarePayableReport.map((row) => ({
      Code: row.EmployeeCode,
      Name: row.FullName,
      Department: row.Department || "-",
      "Annual Days": Number(row.AnnualEntitlementDays || 30).toFixed(2),
      "Annual Amount": Number(row.AnnualEntitlementBHD || 75).toFixed(2),
      "Current Earned Days": Number(row.CurrentYearEarnedDays || 0).toFixed(2),
      "Current Earned Amount": Number(row.CurrentYearEarnedBHD || 0).toFixed(2),
      "Company Paid Amount": Number(row.CompanyPaidCurrentYear || 0).toFixed(2),
      "Airfare Entitlement Amount": resolveAirfareEntitlementAmount(row).toFixed(2),
      "Payable Amount": resolveAirfarePayableAmount(row).toFixed(2)
    }));
    printPremiumReport("Airfare Payable", rows, ["Code", "Name", "Department", "Annual Days", "Annual Amount", "Current Earned Days", "Current Earned Amount", "Company Paid Amount", "Airfare Entitlement Amount", "Payable Amount"], activeCompany, companyLogoUrl);
  }

  function printAllocationRegister() {
    const rows = filteredAllocations.map((allocation) => ({
      No: allocation.AllocationID,
      Employee: `${allocation.EmployeeCode} - ${allocation.FullName}`,
      Date: formatReportDate(allocation.AllocationDate),
      "Ticket Amount": Number(allocation.TicketCost || 0).toFixed(2),
      "Company Paid Amount": Number(allocation.CompanyPaid || 0).toFixed(2),
      Mode: formatPaymentModeLabel(allocation.PaymentMode)
    }));
    printPremiumReport("Airfare Allocation Register", rows, ["No", "Employee", "Date", "Ticket Amount", "Company Paid Amount", "Mode"], activeCompany, companyLogoUrl);
  }

  function printLoanRegister() {
    const rows = filteredLoans.map((loan) => ({
      No: loan.LoanID,
      Employee: `${loan.EmployeeCode} - ${loan.FullName}`,
      "Outstanding Amount": Number(loan.RemainingBalance || 0).toFixed(2),
      EMI: Number(loan.EMI || 0).toFixed(2),
      Progress: `${loan.MonthsPaid || 0}/${loan.Tenure || 0}`,
      Status: loan.Status || "-"
    }));
    printPremiumReport("Loan Register", rows, ["No", "Employee", "Outstanding Amount", "EMI", "Progress", "Status"], activeCompany, companyLogoUrl);
  }

  function inReportDateRange(value?: string) {
    if (!value) return true;
    const dateValue = formatExportDate(value);
    if (reportForm.from && dateValue < reportForm.from) return false;
    if (reportForm.to && dateValue > reportForm.to) return false;
    return true;
  }

  function parseReportNumber(value: unknown) {
    if (typeof value === "number") return value;
    const parsed = Number(String(value ?? "").replace(/[^0-9.-]+/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function formatReportTotal(column: string, value: number) {
    const lower = column.toLowerCase();
    if (lower.includes("amount") || lower.includes("paid") || lower.includes("original") || lower.includes("outstanding") || lower.includes("emi") || lower.includes("ticket") || lower.includes("eligibility")) return value.toFixed(2);
    if (lower.includes("days")) return value.toFixed(2);
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }

  function buildReportTotalRows(report: DisplayedReport) {
    const totalColumns = report.totalColumns || [];
    if (!totalColumns.length || !report.rows.length) return [] as ReportRow[];
    const rows: ReportRow[] = [];
    const labelColumn = report.columns[0];
    const grouped = report.groupBy
      ? report.rows.reduce((acc, row) => {
          const key = String(row[report.groupBy || ""] || "Unassigned");
          acc[key] = [...(acc[key] || []), row];
          return acc;
        }, {} as Record<string, ReportRow[]>)
      : {};

    if (report.groupBy) {
      Object.entries(grouped).forEach(([group, groupRows]) => {
        if (!groupRows.length) return;
        rows.push({
          __rowKind: "subtotal",
          [labelColumn]: `Subtotal - ${group}`,
          ...Object.fromEntries(totalColumns.map((column) => [
            column,
            formatReportTotal(column, groupRows.reduce((sum, row) => sum + parseReportNumber(row[column]), 0))
          ]))
        });
      });
    }

    rows.push({
      __rowKind: "grand-total",
      [labelColumn]: "Grand Total",
      ...Object.fromEntries(totalColumns.map((column) => [
        column,
        formatReportTotal(column, report.rows.reduce((sum, row) => sum + parseReportNumber(row[column]), 0))
      ]))
    });

    return rows;
  }

  function getDisplayedReport(): DisplayedReport {
    if (reportForm.type === "dashboard") {
      return {
        title: "Dashboard Summary",
        columns: ["Metric", "Value"],
        rows: [
          { Metric: "Employees", Value: employees.length },
          { Metric: "Airfare Payable Amount", Value: metrics.totalAirfare.toFixed(2) },
          { Metric: "Opening Balance Amount", Value: metrics.opening.toFixed(2) },
          { Metric: "Active Loans", Value: loanSummary?.ActiveLoans ?? loans.filter((loan) => loan.Status === "active").length },
          { Metric: "Loan Outstanding Amount", Value: Number(loanSummary?.TotalOutstanding ?? metrics.loanBalance).toFixed(2) },
          { Metric: "Company Paid Amount", Value: metrics.companyPaidTotal.toFixed(2) }
        ]
      };
    }

    if (reportForm.type === "employees") {
      return {
        title: "Employee Master",
        columns: ["Code", "Name", "Join Date", "Department", "Status", "Airfare Amount", "Count"],
        totalColumns: ["Airfare Amount", "Count"],
        groupBy: "Department",
        rows: filteredEmployees.filter((employee) => inReportDateRange(employee.JoinDate)).map((employee) => ({
          Code: employee.EmployeeCode,
          Name: employee.FullName,
          "Join Date": formatExportDate(employee.JoinDate),
          Department: employee.Department || "-",
          Status: employee.Status || "-",
          "Airfare Amount": calculateExcelTotal(employee).toFixed(2),
          Count: 1,
          __recordType: "employee",
          __recordId: employee.EmployeeID
        }))
      };
    }

    if (reportForm.type === "airfare") {
      return {
        title: "Airfare Payable",
        columns: ["Code", "Name", "Department", "Year", "Annual Days", "Annual Amount", "Opening Days", "Opening Amount", "Current Earned Days", "Current Earned Amount", "Company Paid Amount", "Balance Days", "Airfare Entitlement Amount", "Payable Amount", "Status", "Count"],
        totalColumns: ["Annual Days", "Annual Amount", "Opening Days", "Opening Amount", "Current Earned Days", "Current Earned Amount", "Company Paid Amount", "Balance Days", "Airfare Entitlement Amount", "Payable Amount", "Count"],
        groupBy: "Department",
        rows: airfarePayableReport.map((row) => ({
          Code: row.EmployeeCode,
          Name: row.FullName,
          Department: row.Department || "-",
          Year: row.ReportYear,
          "Annual Days": Number(row.AnnualEntitlementDays || 30).toFixed(2),
          "Annual Amount": Number(row.AnnualEntitlementBHD || 75).toFixed(2),
          "Opening Days": Number(row.OpeningBalanceDays || 0).toFixed(2),
          "Opening Amount": Number(row.OpeningBalanceBHD || 0).toFixed(2),
          "Current Earned Days": Number(row.CurrentYearEarnedDays || 0).toFixed(2),
          "Current Earned Amount": Number(row.CurrentYearEarnedBHD || 0).toFixed(2),
          "Company Paid Amount": Number(row.CompanyPaidCurrentYear || 0).toFixed(2),
          "Balance Days": Number(row.BalanceDays || 0).toFixed(2),
          "Airfare Entitlement Amount": Number(row.AirfareEntitlementAmount ?? row.PayableBHD ?? 0).toFixed(2),
          "Payable Amount": Number(row.PayableBHD ?? (Number(row.BalanceDays || 0) * Number(row.PerDayRate || 2.5))).toFixed(2),
          Status: row.VerificationNote || "-",
          Count: 1,
          __recordType: "employee",
          __recordId: row.EmployeeID
        }))
      };
    }

    if (reportForm.type === "airfare_summary") {
      return {
        title: "Airfare Payable Summary",
        columns: ["Code", "Name", "Department", "Airfare Entitlement Amount", "Payable Amount", "Status"],
        totalColumns: ["Airfare Entitlement Amount", "Payable Amount"],
        rows: airfarePayableReport.map((row) => {
          const entitlementAmount = Number((row.AirfareEntitlementAmount ?? 0).toFixed(2));
          const payableAmount = Number((row.PayableBHD ?? (Number(row.BalanceDays || 0) * Number(row.PerDayRate || 2.5))).toFixed(2));
          return {
            Code: row.EmployeeCode,
            Name: row.FullName,
            Department: row.Department || "-",
            "Airfare Entitlement Amount": entitlementAmount.toFixed(2),
            "Payable Amount": payableAmount.toFixed(2),
            Status: row.VerificationNote || "-",
            Count: 1,
            __recordType: "employee",
            __recordId: row.EmployeeID
          };
        })
      };
    }


    if (reportForm.type === "airfare_exceptions") {
      return {
        title: "Airfare Payable Exceptions",
        columns: ["Code", "Name", "Department", "Airfare Entitlement Amount", "Payable Amount", "Status", "Review Note", "Count"],
        totalColumns: ["Airfare Entitlement Amount", "Payable Amount", "Count"],
        groupBy: "Status",
        rows: airfarePayableReport
          .filter((row) => {
            const note = String(row.VerificationNote || "").trim().toLowerCase();
            return !!note && note !== "-" && note !== "ok";
          })
          .map((row) => {
            const entitlementAmount = Number((row.AirfareEntitlementAmount ?? 0).toFixed(2));
            const payableAmount = Number((row.PayableBHD ?? (Number(row.BalanceDays || 0) * Number(row.PerDayRate || 2.5))).toFixed(2));
            return {
              Code: row.EmployeeCode,
              Name: row.FullName,
              Department: row.Department || "-",
              "Airfare Entitlement Amount": entitlementAmount.toFixed(2),
              "Payable Amount": payableAmount.toFixed(2),
              Status: row.Status || "-",
              "Review Note": row.VerificationNote || "-",
              Count: 1,
              __recordType: "employee",
              __recordId: row.EmployeeID
            };
          })
      };
    }

    if (reportForm.type === "airfare_policy") {
      const getPolicyRuleType = (rate: AirfarePolicyRate) => (
        rate.EmployeeID ? "Employee exception profile"
          : rate.EmpGroup ? "Pay group matrix"
            : rate.Department ? "Department matrix"
              : rate.CompanyID ? "Company default"
                : "Global default"
      );
      const getPolicyScope = (rate: AirfarePolicyRate) => (
        rate.EmployeeID ? `${rate.EmployeeCode || rate.EmployeeID} - ${rate.FullName || ""}`.trim()
          : rate.EmpGroup ? String(rate.EmpGroup)
            : rate.Department ? String(rate.Department)
              : rate.CompanyID ? rate.CompanyName || `Company ${rate.CompanyID}`
                : "All companies and employees"
      );
      const getPolicyPriority = (rate: AirfarePolicyRate) => (
        rate.EmployeeID && !rate.CompanyID && !rate.Department && !rate.EmpGroup ? 50
          : rate.EmployeeID ? 45
            : rate.EmpGroup ? 40
              : rate.Department ? 30
                : rate.CompanyID ? 20
                  : 10
      );
      const policyRows = airfarePolicyRates
        .filter((rate) => inReportDateRange(rate.EffectiveFrom))
        .map((rate) => ({
          Section: "Detail",
          "Rule Type": getPolicyRuleType(rate),
          Scope: getPolicyScope(rate),
          "Effective From": formatExportDate(rate.EffectiveFrom),
          "Effective To": rate.EffectiveTo ? formatExportDate(rate.EffectiveTo) : "Current",
          Amount: Number(rate.MaxPayoutAmount || 0).toFixed(2),
          "Cycle Days": Number(rate.CycleDays || 60).toFixed(0),
          "Per Day": Number(rate.PerDayRate || ((rate.MaxPayoutAmount || 150) / (rate.CycleDays || 60))).toFixed(2),
          Status: rate.IsActive ? "Active" : "Inactive",
          Priority: getPolicyPriority(rate),
          Count: 1
        }));
      const summaryRuleTypes = ["Global default", "Company default", "Employee exception profile", "Department matrix", "Pay group matrix"];
      const summaryRows = summaryRuleTypes.map((ruleType) => {
        const matching = policyRows.filter((row) => row["Rule Type"] === ruleType);
        const activeCount = matching.filter((row) => row.Status === "Active").length;
        const currentAmounts = matching
          .filter((row) => row.Status === "Active" && row["Effective To"] === "Current")
          .map((row) => Number(row.Amount || 0))
          .filter((amount) => Number.isFinite(amount));
        return {
          Section: "Summary",
          "Rule Type": ruleType,
          Scope: `${matching.length} rule(s), ${activeCount} active`,
          "Effective From": "-",
          "Effective To": "-",
          Amount: currentAmounts.length ? Math.max(...currentAmounts).toFixed(2) : "0.00",
          "Cycle Days": "-",
          "Per Day": "-",
          Status: activeCount > 0 ? "Configured" : "Not configured",
          Priority: ruleType === "Employee exception profile" ? 50 : ruleType === "Pay group matrix" ? 40 : ruleType === "Department matrix" ? 30 : ruleType === "Company default" ? 20 : 10,
          Count: matching.length
        };
      });
      return {
        title: "Airfare Policy Rules",
        columns: ["Section", "Rule Type", "Scope", "Effective From", "Effective To", "Amount", "Cycle Days", "Per Day", "Status", "Priority", "Count"],
        groupBy: "Section",
        rows: [...summaryRows, ...policyRows]
      };
    }

    if (reportForm.type === "loans") {
      return {
        title: "Loan Register",
        columns: ["No", "Date", "Employee", "Original", "Outstanding", "EMI", "Progress", "Status", "Count"],
        totalColumns: ["Original", "Outstanding", "EMI", "Count"],
        groupBy: "Status",
        rows: filteredLoans.filter((loan) => inReportDateRange(loan.CreatedDate)).map((loan) => ({
          No: loan.LoanID,
          Date: formatExportDate(loan.CreatedDate),
          Employee: `${loan.EmployeeCode} - ${loan.FullName}`,
          Original: Number(loan.OriginalAmount || 0).toFixed(2),
          Outstanding: Number(loan.RemainingBalance || 0).toFixed(2),
          EMI: Number(loan.EMI || 0).toFixed(2),
          Progress: `${loan.MonthsPaid || 0}/${loan.Tenure || 0}`,
          Status: loan.Status || "-",
          Count: 1,
          __recordType: "loan",
          __recordId: loan.LoanID
        }))
      };
    }

    if (reportForm.type === "companies") {
      return {
        title: "Company Register",
        columns: ["Code", "Company", "Database", "Contact", "Created", "Status", "Count"],
        totalColumns: ["Count"],
        groupBy: "Status",
        rows: filteredCompanies.filter((company) => inReportDateRange(company.CreatedAt)).map((company) => ({
          Code: company.CompanyCode,
          Company: company.CompanyName,
          Database: company.DatabaseName || "-",
          Contact: company.ContactPerson || company.Email || company.Phone || "-",
          Created: formatExportDate(company.CreatedAt),
          Status: company.IsActive ? "Active" : "Inactive",
          Count: 1,
          __recordType: "company",
          __recordId: company.CompanyID
        }))
      };
    }

    return {
        title: "Airfare Allocation Register",
        columns: ["No", "Date", "Employee", "Ticket Amount", "Eligibility Amount", "Company Paid Amount", "Loan / Self Paid Amount", "Paid By", "Count"],
        totalColumns: ["Ticket Amount", "Eligibility Amount", "Company Paid Amount", "Loan / Self Paid Amount", "Count"],
        groupBy: "Paid By",
        rows: filteredAllocations.filter((allocation) => inReportDateRange(allocation.AllocationDate)).map((allocation) => ({
          No: allocation.AllocationID,
          Date: formatReportDate(allocation.AllocationDate),
          Employee: `${allocation.EmployeeCode} - ${allocation.FullName}`,
          "Ticket Amount": Number(allocation.TicketCost || 0).toFixed(2),
          "Eligibility Amount": Number(allocation.Entitlement || 0).toFixed(2),
          "Company Paid Amount": Number(allocation.CompanyPaid || 0).toFixed(2),
          "Loan / Self Paid Amount": Number((allocation.LoanAmount || 0) + (allocation.EmployeePaid || 0) || allocation.ExcessAmount || 0).toFixed(2),
          "Paid By": formatPaymentModeLabel(allocation.PaymentMode),
          Count: 1,
          __recordType: "allocation",
          __recordId: allocation.AllocationID
        }))
      };
    }

  async function exportDisplayedReport() {
    const report = getDisplayedReport();
    const rows = [...report.rows, ...buildReportTotalRows(report)];
    await exportRowsToExcel(`ATLAS_${report.title.replace(/[^A-Za-z0-9]+/g, "_")}.xlsx`, report.columns, rows);
    setMessage(`${report.title} exported with ${report.rows.length} row(s).`);
  }

  function printDisplayedReport() {
    const report = getDisplayedReport();
    printPremiumReport(`${report.title} (${reportForm.from || "Start"} to ${reportForm.to || "Today"})`, [...report.rows, ...buildReportTotalRows(report)], report.columns, activeCompany, companyLogoUrl);
  }

  function getReportRecordTypeLabel(type?: ReportDrillType) {
    if (type === "employee") return "Employee";
    if (type === "allocation") return "Airfare";
    if (type === "loan") return "Loan";
    if (type === "company") return "Company";
    return "Record";
  }
  function isReportRowDrillable(row: ReportRow) {
    return row.__recordType === "employee" || row.__recordType === "allocation" || row.__recordType === "loan" || row.__recordType === "company";
  }

  async function handleReportDrillDown(row: ReportRow) {
    if (!row || !row.__recordType || row.__recordId == null) return;
    if (!session) return setMessage("Please sign in before opening this record.");

    const recordId = Number(row.__recordId);
    if (!Number.isFinite(recordId)) return setMessage("Unable to open selected record from this report row.");

    if (row.__recordType === "employee") {
      let employee = employees.find((item) => Number(item.EmployeeID) === recordId);
      if (!employee) {
        try {
          employee = await atlasFetch<Employee>(`/employees/${recordId}`, session.token, session.sessionId);
        } catch {
          // fallback: the record may be filtered from cache
        }
      }
      if (!employee) return setMessage("Employee record is no longer available.");
      handleEditEmployee(employee);
      setMessage(`Opened employee ${employee.EmployeeCode} for review from report.`);
      return;
    }

    if (row.__recordType === "allocation") {
      let allocation = allocations.find((item) => Number(item.AllocationID) === recordId);
      if (!allocation) {
        try {
          allocation = await atlasFetch<Allocation>(`/allocations/${recordId}`, session.token, session.sessionId);
        } catch {
          // fallback: allocation might not be in cached year dataset
        }
      }
      if (!allocation) return setMessage("Allocation record is no longer available.");
      if (!allocations.some((item) => Number(item.AllocationID) === Number(allocation.AllocationID))) {
        setAllocations((current) => [allocation, ...current]);
      }
      handleEditAllocation(allocation);
      setMessage(`Opened allocation #${allocation.AllocationID} from report.`);
      return;
    }

    if (row.__recordType === "loan") {
      let loan = loans.find((item) => Number(item.LoanID) === recordId);
      if (!loan) {
        try {
          loan = await atlasFetch<Loan>(`/loans/${recordId}`, session.token, session.sessionId);
        } catch {
          // fallback: loan might be filtered out from current list view
          try {
            const register = await atlasFetch<Loan[]>("/loans/register", session.token, session.sessionId);
            setLoans(register);
            loan = register.find((item) => Number(item.LoanID) === recordId);
          } catch {
            // fallback: preserve existing data if fetch fails
          }
        }
      }
      if (!loan) return setMessage("Loan record is no longer available.");
      if (!loans.some((item) => Number(item.LoanID) === Number(loan.LoanID))) {
        setLoans((current) => [...current, loan]);
      }
      handleEditLoan(loan);
      setMessage(`Opened loan #${loan.LoanID} from report.`);
      return;
    }

    if (row.__recordType === "company") {
      let company = companies.find((item) => item.CompanyID === recordId);
      if (!company) {
        try {
          const companyList = await atlasFetch<Company[]>("/companies", session.token, session.sessionId);
          setCompanies(companyList);
          company = companyList.find((item) => item.CompanyID === recordId);
        } catch {
          // fallback: preserve existing data if fetch fails
        }
      }
      if (!company) return setMessage("Company record is no longer available.");
      if (!companies.some((item) => item.CompanyID === company.CompanyID)) {
        setCompanies((current) => [...current, company]);
      }
      editCompany(company);
      setMessage(`Opened company ${company.CompanyName} from report.`);
    }
  }

  function printCurrentScreen() {
    let title = `${activeView} Snapshot`;
    let columns = ["Metric", "Value"];
    let rows: Array<Record<string, unknown>> = [
      { Metric: "Screen", Value: activeView },
      { Metric: "Company", Value: activeCompany?.CompanyName || "ATLAS" },
      { Metric: "Generated", Value: new Date().toLocaleString() }
    ];

    if (activeView === "Overview") {
      title = "Executive Command Center";
      rows = [
        { Metric: "Employees", Value: employees.length },
        { Metric: "Airfare Payable", Value: metrics.totalAirfare.toFixed(2) },
        { Metric: "Opening Balance", Value: metrics.opening.toFixed(2) },
        { Metric: "Loan Exposure", Value: metrics.loanBalance.toFixed(2) },
        { Metric: "Company Paid", Value: metrics.companyPaidTotal.toFixed(2) },
        { Metric: "AI Review", Value: `${employees.filter((item) => calculateRemainingDays(item) < 0).length} employee(s) need balance review` }
      ];
    } else if (activeView === "Employees") {
      title = "Employee Master";
      columns = ["Code", "Name", "Department", "Status", "Airfare Amount"];
      rows = filteredEmployees.map((employee) => ({
        Code: employee.EmployeeCode,
        Name: employee.FullName,
        Department: employee.Department || "-",
        Status: employee.Status || "-",
        "Airfare Amount": calculateExcelTotal(employee).toFixed(2)
      }));
    } else if (activeView === "Opening Balance") {
      title = "Opening Balance Register";
      columns = ["Code", "Name", "Opening Days", "Opening Amount", "Max Payout"];
      rows = filteredEmployees.map((employee) => ({
        Code: employee.EmployeeCode,
        Name: employee.FullName,
        "Opening Days": closingBalanceDays(employee).toFixed(2),
        "Opening Amount": calculateExcelTotal(employee).toFixed(2),
        "Max Payout": Number(employee.MaximumPayout ?? 150).toFixed(2)
      }));
    } else if (activeView === "Airfare") {
      title = "Airfare Allocation Register";
      columns = ["No", "Employee", "Date", "Ticket Cost", "Company Paid", "Mode"];
      rows = filteredAllocations.map((allocation) => ({
        No: allocation.AllocationID,
        Employee: `${allocation.EmployeeCode} - ${allocation.FullName}`,
        Date: formatReportDate(allocation.AllocationDate),
        "Ticket Cost": money.format(allocation.TicketCost || 0),
        "Company Paid": money.format(allocation.CompanyPaid || 0),
        Mode: formatPaymentModeLabel(allocation.PaymentMode)
      }));
    } else if (activeView === "Loans") {
      title = "Loan Register";
      columns = ["No", "Employee", "Outstanding", "EMI", "Progress", "Status"];
      rows = filteredLoans.map((loan) => ({
        No: loan.LoanID,
        Employee: `${loan.EmployeeCode} - ${loan.FullName}`,
        Outstanding: money.format(loan.RemainingBalance || 0),
        EMI: money.format(loan.EMI || 0),
        Progress: `${loan.MonthsPaid || 0}/${loan.Tenure || 0}`,
        Status: loan.Status || "-"
      }));
    } else if (activeView === "Year End") {
      title = "Year End Closing Preview";
      columns = ["Metric", "Value"];
      rows = yearEndPreview ? [
        { Metric: "Closing Year", Value: yearEndPreview.closedYear },
        { Metric: "Next Opening Year", Value: yearEndPreview.nextYear },
        { Metric: "Closing Date", Value: yearEndPreview.closingDate },
        { Metric: "Employees Carried", Value: yearEndPreview.balancesCarried },
        { Metric: "Closing Days", Value: Number(yearEndPreview.totalClosingDays || 0).toFixed(2) },
        { Metric: "Closing Amount", Value: money.format(yearEndPreview.totalOpeningBalance || 0) },
        { Metric: "Pending Loans", Value: yearEndPreview.pendingLoanCount ?? yearEndPreview.totals?.PendingLoans ?? 0 },
        { Metric: "Pending Loan Amount", Value: money.format(yearEndPreview.pendingLoanAmount ?? yearEndPreview.totals?.PendingLoanAmount ?? 0) },
        { Metric: "Allocations", Value: yearEndPreview.totals?.TotalAllocations ?? 0 },
        { Metric: "Loans Created", Value: yearEndPreview.totals?.LoansCreated ?? yearEndPreview.totals?.TotalLoansCreated ?? 0 },
        { Metric: "Emergency Tickets", Value: yearEndPreview.totals?.EmergencyTickets ?? yearEndPreview.totals?.TotalEmergencyTickets ?? 0 }
      ] : [
        { Metric: "Status", Value: "Run preview before printing year end." }
      ];
    } else if (activeView === "Reports") {
      title = "Reports Control Sheet";
      columns = ["Report", "Purpose"];
      rows = [
        { Report: "Dashboard Summary", Purpose: "Executive totals and KPI review" },
        { Report: "Employee Master", Purpose: "Employee register and payable balance" },
        { Report: "Airfare Payable", Purpose: "Opening balance and entitlement control" },
        { Report: "Allocation Register", Purpose: "Ticket approval and payment reconciliation" },
        { Report: "Loan Register", Purpose: "Employee loan exposure and EMI progress" }
      ];
    } else if (activeView === "Companies") {
      title = "Company Database Register";
      columns = ["Code", "Company", "Database", "Contact", "Status"];
      rows = filteredCompanies.map((company) => ({
        Code: company.CompanyCode,
        Company: company.CompanyName,
        Database: company.DatabaseName || "-",
        Contact: company.ContactPerson || company.Email || company.Phone || "-",
        Status: company.IsActive ? "Active" : "Inactive"
      }));
    } else if (activeView === "Preferences") {
      title = "Preferences and Custom Values";
      columns = ["Effective From", "Effective To", "Amount", "Cycle", "Per Day"];
      rows = airfarePolicyRates.map((rate) => ({
        "Effective From": formatExportDate(rate.EffectiveFrom),
        "Effective To": rate.EffectiveTo ? formatExportDate(rate.EffectiveTo) : "Current",
        Amount: money.format(rate.MaxPayoutAmount || 0),
        Cycle: `${Number(rate.CycleDays || 60).toFixed(0)} days`,
        "Per Day": money.format(rate.PerDayRate || ((rate.MaxPayoutAmount || 150) / (rate.CycleDays || 60)))
      }));
    } else if (activeView === "AI Insights") {
      title = "AI Validation Insights";
      columns = ["Insight", "Action"];
      rows = notificationItems.map((item) => ({
        Insight: item.title,
        Action: item.detail
      }));
    } else if (activeView === "Security") {
      title = "Users and Rights Register";
      columns = ["Username", "Full Name", "Role", "Department", "Status"];
      rows = filteredUsers.map((user) => ({
        Username: user.Username,
        "Full Name": user.FullName || "-",
        Role: user.Role || "-",
        Department: user.Department || "-",
        Status: user.IsActive ? "Active" : "Inactive"
      }));
    } else if (activeView === "Support") {
      title = "ATLAS Help and Validation Guide";
      columns = ["Area", "Instruction"];
      rows = [
        { Area: "Company", Instruction: "Create company, upload logo, and select it from the sidebar." },
        { Area: "Employees", Instruction: "Add or import employee master, then verify mapping preview." },
        { Area: "Opening Balance", Instruction: "Enter opening days and amount before allocations." },
        { Area: "Airfare Allocation", Instruction: "Select employee, ticket cost, payment option, attachment, save and print." },
        { Area: "Loans", Instruction: "Create manual loans or convert airfare excess into EMI." },
        { Area: "Testing", Instruction: "Formula, import, loan, attachment, company, backup, reports, and layout tests are available." }
      ];
    }

    printPremiumReport(title, rows, columns, activeCompany, companyLogoUrl);
  }

  async function handleYearEndPreview() {
    if (!session) return setMessage("Please sign in as admin before year-end preview.");
    if (session.user.role !== "admin") return setMessage("Year-end closing is available for administrators only.");
    const year = Number(yearEndForm.year);
    if (!year) return setMessage("Enter a valid year to close.");
    setBusy(true);
    setMessage("");
    try {
      const params = new URLSearchParams();
      if (yearEndForm.closingDate) params.set("closingDate", yearEndForm.closingDate);
      if (yearEndForm.employeeId) params.set("employeeId", yearEndForm.employeeId);
      const suffix = params.toString() ? `?${params.toString()}` : "";
      const preview = await atlasFetch<YearEndPreview>(`/year-end/preview/${year}${suffix}`, session.token, session.sessionId);
      setYearEndPreview(preview);
      setMessage(`Year-end preview ready for ${preview.closedYear}. ${preview.balancesCarried} opening balance record(s) will move to ${preview.nextYear}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Year-end preview failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleYearEndClose() {
    if (!session) return setMessage("Please sign in as admin before year-end closing.");
    if (session.user.role !== "admin") return setMessage("Year-end closing is available for administrators only.");
    const year = Number(yearEndForm.year);
    if (!yearEndPreview || yearEndPreview.closedYear !== year) return setMessage("Run preview before closing year.");
    const ok = window.confirm(`Close ${year} and create opening balances for ${year + 1}?`);
    if (!ok) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await atlasMutation<YearEndPreview>("/year-end/close", session.token, session.sessionId, "POST", {
        year,
        closingDate: yearEndForm.closingDate,
        employeeId: yearEndForm.employeeId ? Number(yearEndForm.employeeId) : null,
        remarks: yearEndForm.remarks,
        dryRun: false
      });
      setYearEndPreview(result);
      await loadLiveData();
      setMessage(`Year ${result.closedYear} closed. Opening balances created for ${result.nextYear}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Year-end close failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveCompany() {
    if (!session) return setMessage("Please sign in as admin first.");
    if (session.user.role !== "admin") return setMessage("Company setup is available for administrators only.");
    if (!companyForm.companyCode || !companyForm.companyName) return setMessage("Company code and name are required.");

    setBusy(true);
    setMessage("");
    try {
      const wasEditing = Boolean(editingCompanyId);
      const logoPayload = companyLogoFile ? await fileToBase64(companyLogoFile) : null;
      const payload = {
        ...companyForm,
        logoMimeType: companyLogoFile?.type || null,
        logoDataBase64: logoPayload
      };
      await atlasMutation(
        editingCompanyId ? `/companies/${editingCompanyId}` : "/companies",
        session.token,
        session.sessionId,
        editingCompanyId ? "PUT" : "POST",
        payload
      );
      await loadLiveData();
      setEditingCompanyId(null);
      setCompanyLogoFile(null);
      setCompanyForm({ companyCode: "", companyName: "", databaseName: "", address: "", phone: "", email: "", trn: "", contactPerson: "", isActive: true });
      setMessage(wasEditing
        ? `System confirmation: company ${payload.companyName} updated and database ${payload.databaseName || payload.companyCode} verified.`
        : `System confirmation: company ${payload.companyName} created and database ${payload.databaseName || payload.companyCode} prepared.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Company save failed");
    } finally {
      setBusy(false);
    }
  }

  function editCompany(company: Company) {
    setEditingCompanyId(company.CompanyID);
    setCompanyForm({
      companyCode: company.CompanyCode || "",
      companyName: company.CompanyName || "",
      databaseName: company.DatabaseName || "",
      address: company.Address || "",
      phone: company.Phone || "",
      email: company.Email || "",
      trn: company.TRN || "",
      contactPerson: company.ContactPerson || "",
      isActive: company.IsActive
    });
    setActiveView("Companies");
  }

  async function handleDeleteEmptyCompanies() {
    if (!session) return setMessage("Please sign in as admin first.");
    if (session.user.role !== "admin") return setMessage("Only administrators can delete empty companies.");
    const ok = window.confirm("Delete all empty company records? ATLAS and the selected company are protected. SQL databases and backups will not be dropped.");
    if (!ok) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await atlasMutation<{ deleted: number; companies: Company[] }>("/companies/empty", session.token, session.sessionId, "DELETE", {
        keepCompanyId: selectedCompanyId ? Number(selectedCompanyId) : null
      });
      await loadLiveData();
      setMessage(result.deleted
        ? `System confirmation: ${result.deleted} empty compan${result.deleted === 1 ? "y" : "ies"} deleted.`
        : "No empty company records found for deletion.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Delete empty companies failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteCompany(company: Company) {
    if (!session) return setMessage("Please sign in as admin first.");
    if (session.user.role !== "admin") return setMessage("Only administrators can delete companies.");
    if (String(company.CompanyCode || "").toUpperCase() === "ATLAS") return setMessage("Main ATLAS company cannot be deleted.");
    const ok = window.confirm([
      "Confirm company deletion",
      "",
      `Company: ${company.CompanyName}`,
      `Database: ${company.DatabaseName}`,
      "",
      "This will delete the company record and remove its company database.",
      "The main ATLAS database and future company creation process will remain available.",
      "",
      "Continue?"
    ].join("\n"));
    if (!ok) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await atlasMutation<{ deleted: boolean; databaseName: string; databaseDropped: boolean }>(
        `/companies/${company.CompanyID}`,
        session.token,
        session.sessionId,
        "DELETE",
        { confirm: "DELETE_COMPANY_AND_DATABASE" }
      );
      if (String(company.CompanyID) === selectedCompanyId) setSelectedCompanyId("");
      await loadLiveData();
      setMessage(`System confirmation: company deleted and database ${result.databaseName} ${result.databaseDropped ? "dropped" : "was not found"}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Delete company failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleBackupDatabase() {
    if (!session) return setMessage("Please sign in as admin first.");
    if (!backupForm.databaseName) return setMessage("Select a database for backup.");
    setBusy(true);
    setMessage("");
    try {
      const result = await atlasMutation<{ databaseName: string; backupFile: string }>("/admin/backup", session.token, session.sessionId, "POST", {
        databaseName: backupForm.databaseName
      });
      setBackupForm((current) => ({ ...current, restoreFile: result.backupFile }));
      const refreshedBackups = await atlasFetch<BackupFileInfo[]>("/admin/backups", session.token, session.sessionId);
      setBackupFiles(refreshedBackups);
      setMessage(`Backup created: ${result.backupFile}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Backup failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleRestoreDatabase() {
    if (!session) return setMessage("Please sign in as admin first.");
    if (!backupForm.databaseName || !backupForm.restoreFile) return setMessage("Select database and backup file before restore.");
    const ok = window.confirm(`Restore ${backupForm.databaseName} from this backup? This will replace that database.`);
    if (!ok) return;
    setBusy(true);
    setMessage("");
    try {
      await atlasMutation("/admin/restore", session.token, session.sessionId, "POST", {
        databaseName: backupForm.databaseName,
        backupFile: backupForm.restoreFile,
        confirm: "RESTORE"
      });
      setMessage("Database restored successfully.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Restore failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateUser() {
    if (!session) return setMessage("Please sign in as admin first.");
    setBusy(true);
    setMessage("");
    try {
      const userPayload = editingUserId ? {
        password: userForm.password,
        email: userForm.email,
        fullName: userForm.fullName,
        role: userForm.role,
        employeeId: userForm.employeeId ? Number(userForm.employeeId) : null,
        department: userForm.department,
        branch: userForm.branch,
        isActive: userForm.isActive
      } : {
        username: userForm.username,
        password: userForm.password,
        email: userForm.email,
        fullName: userForm.fullName,
        role: userForm.role,
        employeeId: userForm.employeeId ? Number(userForm.employeeId) : null,
        department: userForm.department,
        branch: userForm.branch,
        isActive: userForm.isActive
      };
      await atlasMutation(editingUserId ? `/users/${editingUserId}` : "/users", session.token, session.sessionId, editingUserId ? "PUT" : "POST", userPayload);
      const wasEditing = Boolean(editingUserId);
      setEditingUserId(null);
      setUserForm({ username: "", password: "", email: "", fullName: "", role: "viewer", employeeId: "", department: "", branch: "", isActive: true });
      await loadLiveData();
      setMessage(wasEditing ? "User and rights updated." : "User created. Rights are controlled by role.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "User create failed");
    } finally {
      setBusy(false);
    }
  }

  function employeeUserFields(employee: Employee) {
    return {
      username: employee.EmployeeCode || "",
      email: employee.Email || "",
      fullName: employee.FullName || "",
      department: employee.Department || "",
      branch: employee.Branch || ""
    };
  }

  function handleUserRoleChange(role: string) {
    if (role === "employee") {
      const employee = selectedUserFormEmployee || userFormEmployeeOptions[0];
      setUserForm((current) => ({
        ...current,
        role,
        employeeId: employee?.EmployeeID ? String(employee.EmployeeID) : current.employeeId,
        ...(employee ? employeeUserFields(employee) : {})
      }));
      return;
    }
    setUserForm((current) => ({ ...current, role, employeeId: "" }));
  }

  function handleUserEmployeeChange(employeeId: string) {
    const employee = userFormEmployeeOptions.find((item) => String(item.EmployeeID) === employeeId);
    setUserForm((current) => ({
      ...current,
      employeeId,
      ...(employee ? employeeUserFields(employee) : {})
    }));
  }

  function handleEditUser(user: AtlasUser) {
    setEditingUserId(user.UserID);
    setUserForm({
      username: user.Username,
      password: "",
      email: user.Email || "",
      fullName: user.FullName || "",
      role: user.Role || "viewer",
      employeeId: user.EmployeeID ? String(user.EmployeeID) : "",
      department: user.Department || "",
      branch: user.Branch || "",
      isActive: user.IsActive
    });
    setActiveView("Security");
    setMessage(`Editing user ${user.Username}. Leave password blank to keep current password.`);
  }

  function cancelUserEdit() {
    setEditingUserId(null);
    setUserForm({ username: "", password: "", email: "", fullName: "", role: "viewer", employeeId: "", department: "", branch: "", isActive: true });
    setMessage("User edit cancelled.");
  }

  function handleCompanySwitch(value: string) {
    const company = companies.find((item) => String(item.CompanyID) === value) || companies[0];
    const nextCompanyId = company?.CompanyID ? String(company.CompanyID) : "";
    setSelectedCompanyId(nextCompanyId);
    setBackupForm((current) => ({ ...current, databaseName: company?.DatabaseName || current.databaseName }));
    setMessage(company ? `Company workspace changed to ${company.CompanyName}.` : "Company workspace unavailable.");
  }

  function handleSearchSubmit() {
    const term = query.trim().toLowerCase();
    if (!term) {
      setMessage("Type employee, loan, company, allocation, or user text to search.");
      return;
    }
    if (filteredEmployees.length) {
      setActiveView("Employees");
      setMessage(`Search found ${filteredEmployees.length} employee record(s).`);
      return;
    }
    if (filteredAllocations.length) {
      setActiveView("Airfare");
      setMessage(`Search found ${filteredAllocations.length} airfare allocation(s).`);
      return;
    }
    if (filteredLoans.length) {
      setActiveView("Loans");
      setMessage(`Search found ${filteredLoans.length} loan record(s).`);
      return;
    }
    if (filteredCompanies.length) {
      setActiveView("Companies");
      setMessage(`Search found ${filteredCompanies.length} compan${filteredCompanies.length === 1 ? "y" : "ies"}.`);
      return;
    }
    if (/(preference|setting|custom|policy|rate|airfare amount|max payout)/i.test(term)) {
      setActiveView("Preferences");
      setMessage("Opened Preferences and custom values.");
      return;
    }
    if (filteredUsers.length) {
      setActiveView("Security");
      setMessage(`Search found ${filteredUsers.length} user record(s).`);
      return;
    }
    setMessage(`No result found for "${query.trim()}".`);
  }

  const metrics = useMemo(() => {
    const reportRows = airfarePayableReport.length ? airfarePayableReport : [];
    const totalAirfare = reportRows.reduce((sum, row) => sum + Number(row.AirfareEntitlementAmount || 0), 0);
    const payableAmount = reportRows.reduce((sum, row) => sum + Number(row.PayableBHD || 0), 0);
    const opening = reportRows.reduce((sum, row) => sum + Number(row.OpeningBalanceBHD || 0), 0);
    const currentYearEarned = reportRows.reduce((sum, row) => sum + Number(row.CurrentYearEarnedBHD || 0), 0);
    const entitlementAmount = reportRows.reduce((sum, row) => sum + Number(row.AirfareEntitlementAmount || 0), 0);
    const employeeCount = reportRows.length || employees.length;
    const loanBalance = Number(loanSummary?.TotalOutstanding ?? loans
      .filter((loan) => String(loan.Status || "").toLowerCase() !== "settled")
      .reduce((sum, loan) => sum + (loan.RemainingBalance || 0), 0));
    const companyPaidTotal = allocations.reduce((sum, item) => sum + (item.CompanyPaid || 0), 0);
    return { totalAirfare, payableAmount, opening, currentYearEarned, entitlementAmount, employeeCount, loanBalance, companyPaidTotal };
  }, [airfarePayableReport, allocations, employees.length, loanSummary?.TotalOutstanding, loans]);

  const diagnosticCards: DiagnosticCheck[] = diagnostics?.checks || [
    { key: "database", name: "MSSQL database", type: "database", success: false, latencyMs: 0, thresholdMs: 300, status: "IDLE", detail: "Run diagnostics to test SQL response." },
    { key: "frontend-build", name: "Frontend build", type: "application", success: false, latencyMs: 0, thresholdMs: 300, status: "IDLE", detail: "Run diagnostics to verify the published UI package." },
    { key: "external-apis", name: "External APIs", type: "integration", success: false, latencyMs: 0, thresholdMs: 800, status: "IDLE", detail: "Optional vendor checks run only when configured." }
  ];
  const diagnosticStatusLabel = diagnosticsLoading ? "CHECKING" : diagnostics?.status || "IDLE";
  const diagnosticIcon = (status: DiagnosticState) => {
    if (status === "UP") return <CheckCircle size={18} />;
    if (status === "DEGRADED") return <AlertTriangle size={18} />;
    if (status === "DOWN") return <AlertTriangle size={18} />;
    return <Activity size={18} />;
  };

  const searchText = query.trim().toLowerCase();
  const filteredEmployees = employees.filter((employee) => {
    const text = `${employee.EmployeeCode} ${employee.FullName} ${employee.Department || ""}`.toLowerCase();
    return text.includes(searchText);
  });
  const employeeMasterSearchText = employeeMasterSearch.trim().toLowerCase();
  const allocationEmployeeSearchText = allocationEmployeeSearch.trim().toLowerCase();
  const allocationSearchTokens = allocationEmployeeSearchText
    ? allocationEmployeeSearchText.split(/\s+/).filter((token) => token.length > 0)
    : [];
  const matchesAllocationEmployee = (employee: Employee, tokens: string[]) => {
    if (!tokens.length) return true;

    const serialText = String(employee.SerialNo ?? "").toLowerCase();
    const searchableBuckets = [
      String(employee.EmployeeCode ?? "").toLowerCase(),
      String(employee.FullName ?? "").toLowerCase(),
      String(employee.Department || "").toLowerCase(),
      String(employee.Status || "").toLowerCase(),
      String(employee.PayrollStatus || "").toLowerCase(),
      serialText
    ];

    return tokens.every((token) => {
      const isNumberToken = /^\d+$/.test(token);
      const serialMatch = isNumberToken && Boolean(serialText && (serialText === token || serialText.startsWith(token)));
      return serialMatch || searchableBuckets.some((value) => value.startsWith(token) || value.includes(token));
    });
  };
  const employeeMasterSourceRows = employeeMasterAll.length ? employeeMasterAll : employees;
  const policyEmployeeOptions = employeeMasterSourceRows;
  const policyEmployeeSearchText = policyEmployeeSearch.trim().toLowerCase();
  const selectedPolicyEmployee = policyEmployeeOptions.find((employee) => Number(employee.EmployeeID) === Number(policyForm.employeeId));
  const filteredPolicyEmployees = policyEmployeeOptions
    .filter((employee) => {
      if (!policyEmployeeSearchText) return true;
      return [
        employee.EmployeeCode,
        employee.FullName,
        employee.Department,
        employee.EmpGroup,
        employee.Status
      ].some((value) => String(value || "").toLowerCase().includes(policyEmployeeSearchText));
    })
    .slice(0, 12);
  const employeeMasterEmployees = employeeMasterSourceRows.filter((employee) => {
    const eligible = isAirfareEligibleEmployeeStatus(employee.Status);
    if (employeeMasterStatusScope === "active" && !eligible) return false;
    if (employeeMasterStatusScope === "inactive" && eligible) return false;
    if (!employeeMasterSearchText) return true;
    const text = `${employee.EmployeeCode} ${employee.FullName} ${employee.Department || ""} ${employee.Status || ""} ${employee.PayrollStatus || ""}`.toLowerCase();
    return text.includes(employeeMasterSearchText);
  });
  const filteredAllocationEmployees = employees.filter((employee) => {
    const employeeType = employee.PayrollStatus || employee.Status || "";
    const hasTypeFilter = !allocationEmployeeType || employeeType.toLowerCase() === allocationEmployeeType.toLowerCase();
    if (!hasTypeFilter) return false;
    return matchesAllocationEmployee(employee, allocationSearchTokens);
  });
  const isAllocationEmployeeSelectionValid = allocationForm.employeeId
    ? filteredAllocationEmployees.some((employee) => String(employee.EmployeeID) === allocationForm.employeeId)
    : true;
  useEffect(() => {
    if (allocationForm.employeeId && !isAllocationEmployeeSelectionValid) {
      setAllocationForm((current) => ({ ...current, employeeId: "", overrideReason: "", managerApproval: "" }));
    }
  }, [isAllocationEmployeeSelectionValid]);

  const filteredLoans = loans.filter((loan) => {
    const matchesStatus = !loanStatusFilter || loan.Status === loanStatusFilter;
    const text = `${loan.EmployeeCode} ${loan.FullName} ${loan.Department || ""} ${loan.Status || ""}`.toLowerCase();
    return matchesStatus && text.includes(searchText);
  });
  const filteredAllocations = allocations.filter((allocation) => {
    if (!searchText) return true;
    const text = `${allocation.EmployeeCode} ${allocation.FullName} ${allocation.PaymentMode || ""} ${allocation.Remarks || ""}`.toLowerCase();
    return text.includes(searchText);
  });
  const filteredCompanies = companies.filter((company) => {
    if (!searchText) return true;
    const text = `${company.CompanyCode} ${company.CompanyName} ${company.DatabaseName} ${company.ContactPerson || ""}`.toLowerCase();
    return text.includes(searchText);
  });
  const filteredUsers = users.filter((user) => {
    if (!searchText) return true;
    const text = `${user.Username} ${user.FullName} ${user.Email} ${user.Role} ${user.Department || ""}`.toLowerCase();
    return text.includes(searchText);
  });
  const activeCompany = companies.find((company) => String(company.CompanyID) === selectedCompanyId) || companies[0];
  const whatsappEmployeeOptions = employeeMasterSourceRows;
  const selectedWhatsAppEmployee = whatsappEmployeeOptions.find((employee) => Number(employee.EmployeeID) === Number(whatsappForm.employeeId));
  const whatsappRecipientNumber = whatsappForm.recipientType === "employee"
    ? selectedWhatsAppEmployee?.WhatsAppNumber || ""
    : whatsappForm.recipientType === "manager" ? whatsappForm.managerNumber : whatsappForm.customNumber;
  const whatsappRecipientLabel = whatsappForm.recipientType === "employee"
    ? `${selectedWhatsAppEmployee?.EmployeeCode || ""} ${selectedWhatsAppEmployee?.FullName || "Employee"}`.trim()
    : whatsappForm.recipientType === "manager" ? "Manager" : "Custom contact";
  const whatsappMessageText = [
    `*${activeCompany?.CompanyName || "ATLAS"}*`,
    `*${whatsappForm.subject || "Airfare / loan process update"}*`,
    "",
    selectedWhatsAppEmployee ? `Employee: ${selectedWhatsAppEmployee.EmployeeCode} - ${selectedWhatsAppEmployee.FullName}` : "",
    selectedWhatsAppEmployee?.Department ? `Department: ${selectedWhatsAppEmployee.Department}` : "",
    selectedWhatsAppEmployee?.ReportingTo ? `Reporting To: ${selectedWhatsAppEmployee.ReportingTo}` : "",
    whatsappForm.reference ? `Reference: ${whatsappForm.reference}` : "",
    "",
    whatsappForm.body || "Please review the attached/printed ATLAS process details.",
    "",
    whatsappForm.footer || "Regards, ATLAS HCM"
  ].filter((line, index, lines) => line || (lines[index - 1] && lines[index + 1])).join("\n");
  const whatsappReady = Boolean(normalizeWhatsAppNumber(whatsappRecipientNumber) && whatsappMessageText.trim());
  const allocationWhatsAppMessageText = [
    `*${activeCompany?.CompanyName || "ATLAS"}*`,
    `*${allocationWhatsAppForm.subject || "Airfare Allocation Approval"}*`,
    "",
    selectedEmployee ? `Employee: ${selectedEmployee.EmployeeCode} - ${selectedEmployee.FullName}` : "Employee: Not selected",
    selectedEmployee?.Department ? `Department: ${selectedEmployee.Department}` : "",
    selectedEmployee?.ReportingTo ? `Reporting To: ${selectedEmployee.ReportingTo}` : "",
    `Allocation date: ${formatReportDate(allocationForm.date)}`,
    `Allocation year: ${allocationForm.year || "-"}`,
    allocationForm.ticketNo ? `Ticket / PNR: ${allocationForm.ticketNo}` : "",
    allocationForm.route ? `Route: ${allocationForm.route}` : "",
    allocationForm.supplier ? `Supplier: ${allocationForm.supplier}` : "",
    "",
    `Ticket amount: ${money.format(ticketCost)}`,
    `Eligibility amount: ${money.format(selectedEntitlement)}`,
    `Company pays: ${money.format(displayedCompanySettlementAmount)}`,
    `Paid by self employee: ${money.format(selfPaidAmount)}`,
    `Loan amount: ${money.format(loanExcessAmount)}`,
    `Payment mode: ${formatPaymentModeLabel(allocationForm.paymentMode)}`,
    allocationForm.managerApproval ? `Approval reference: ${allocationForm.managerApproval}` : "",
    "",
    allocationWhatsAppForm.note || "Please review and approve this airfare allocation.",
    "",
    allocationWhatsAppForm.footer || "Regards, ATLAS HCM"
  ].filter((line, index, lines) => line || (lines[index - 1] && lines[index + 1])).join("\n");
  const allocationWhatsAppReady = Boolean(selectedEmployee && normalizeWhatsAppNumber(allocationWhatsAppForm.managerNumber) && allocationWhatsAppMessageText.trim());
  const employeeMasterRows = employeeMasterEmployees;
  const allocationEmployeeRows = filteredAllocationEmployees;
  const masterEmployeeIds = employeeMasterRows.map((employee) => employee.EmployeeID);
  const allEmployeesSelected = masterEmployeeIds.length > 0 && masterEmployeeIds.every((id) => selectedEmployeeIds.has(id));
  const selectedMasterEmployeesCount = masterEmployeeIds.filter((id) => selectedEmployeeIds.has(id)).length;
  const notificationItems: NotificationItem[] = [
    ...selfServiceAlerts.slice(0, 6).map((request) => ({
      title: `${request.EmployeeCode || ""} self-service request`.trim(),
      detail: `${request.FullName || "Employee"} requested ${money.format(Number(request.EstimatedCostBHD || 0))} for ${request.Destination || "travel"} (${request.ApprovalStatus}).`,
      tone: "warning" as const,
      actionLabel: "Open request",
      targetView: "Employee Self-Service" as ViewKey
    })),
    ...employees.filter((employee) => calculateRemainingDays(employee) < 0).slice(0, 4).map((employee) => ({
      title: `${employee.EmployeeCode} balance review`,
      detail: `${employee.FullName} has negative remaining days.`,
      tone: "warning" as const
    })),
    ...allocations.filter((allocation) => (allocation.ExcessAmount || 0) > 0).slice(0, 4).map((allocation) => ({
      title: `${allocation.EmployeeCode} excess airfare`,
      detail: `${money.format(allocation.ExcessAmount || 0)} requires employee payment or loan follow-up.`,
      tone: "warning" as const
    })),
    ...(companies.length && companies.some((company) => !company.LogoSize) ? [{
      title: "Company logo missing",
      detail: "Upload logos from Companies so printouts and the shell show company identity.",
      tone: "info" as const
    }] : []),
    {
      title: "System verification",
      detail: "Formula, import, loan, attachment, company, opening balance, and layout tests are available from the test suite.",
      tone: "success" as const
    }
  ];
  const notificationCount = notificationItems.filter((item) => item.tone !== "success").length || notificationItems.length;

  function openWhatsAppMessage() {
    if (!whatsappReady) {
      setMessage("Select a WhatsApp recipient and enter a valid WhatsApp number before opening WhatsApp.");
      return;
    }
    window.open(buildWhatsAppUrl(whatsappRecipientNumber, whatsappMessageText), "_blank", "noopener,noreferrer");
    setMessage(`WhatsApp message prepared for ${whatsappRecipientLabel}. Press Send in WhatsApp to complete.`);
  }

  function printWhatsAppMessage() {
    const printWindow = window.open("", "_blank", "width=860,height=960");
    if (!printWindow) return setMessage("Popup blocked. Allow popups to print the WhatsApp message format.");
    const companyName = activeCompany?.CompanyName || "ATLAS";
    const rows = [
      ["Recipient", whatsappRecipientLabel],
      ["WhatsApp", formatWhatsAppDisplayNumber(whatsappRecipientNumber)],
      ["Subject", whatsappForm.subject || "-"],
      ["Reference", whatsappForm.reference || "-"],
      ["Employee", selectedWhatsAppEmployee ? `${selectedWhatsAppEmployee.EmployeeCode} - ${selectedWhatsAppEmployee.FullName}` : "-"],
      ["Department", selectedWhatsAppEmployee?.Department || "-"],
      ["Reporting To", selectedWhatsAppEmployee?.ReportingTo || "-"]
    ];
    printWindow.document.write(`
      <!doctype html>
      <html>
      <head>
        <title>WhatsApp Message - ${escapeHtml(companyName)}</title>
        <style>
          @page { size: A4; margin: 16mm; }
          body { font-family: Arial, sans-serif; color: #111827; margin: 0; }
          .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0f766e; padding-bottom: 14px; margin-bottom: 18px; }
          .brand strong { display: block; font-size: 22px; }
          .brand span, .meta { color: #475569; font-size: 12px; line-height: 1.5; }
          h1 { font-size: 20px; margin: 0 0 14px; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 18px; }
          td { border: 1px solid #dbe3ef; padding: 9px 10px; vertical-align: top; }
          td:first-child { width: 150px; background: #f8fafc; font-weight: 700; color: #334155; }
          .message { min-height: 260px; white-space: pre-wrap; border: 1px solid #dbe3ef; padding: 16px; line-height: 1.55; }
          .foot { margin-top: 20px; color: #64748b; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="head">
          <div class="brand"><strong>${escapeHtml(companyName)}</strong><span>ATLAS HCM WhatsApp Message</span></div>
          <div class="meta">Prepared: ${escapeHtml(new Date().toLocaleString())}<br/>Manual WhatsApp send</div>
        </div>
        <h1>${escapeHtml(whatsappForm.subject || "WhatsApp Message")}</h1>
        <table>${rows.map(([label, value]) => `<tr><td>${escapeHtml(label)}</td><td>${escapeHtml(value)}</td></tr>`).join("")}</table>
        <div class="message">${escapeHtml(whatsappMessageText)}</div>
        <div class="foot">This page is prepared by ATLAS. Normal WhatsApp requires the sender to press Send manually.</div>
        <script>window.print();</script>
      </body>
      </html>
    `);
    printWindow.document.close();
    setMessage("WhatsApp print format opened.");
  }

  function openAllocationManagerWhatsApp() {
    if (!selectedEmployee) {
      setMessage("Select employee before sending airfare allocation WhatsApp to manager.");
      return;
    }
    if (!normalizeWhatsAppNumber(allocationWhatsAppForm.managerNumber)) {
      setMessage("Type manager WhatsApp number before opening WhatsApp.");
      return;
    }
    window.open(buildWhatsAppUrl(allocationWhatsAppForm.managerNumber, allocationWhatsAppMessageText), "_blank", "noopener,noreferrer");
    setMessage("Airfare allocation WhatsApp prepared for manager. Press Send in WhatsApp to complete.");
  }

  function printAllocationManagerWhatsApp() {
    if (!selectedEmployee) {
      setMessage("Select employee before printing manager WhatsApp format.");
      return;
    }
    const printWindow = window.open("", "_blank", "width=860,height=960");
    if (!printWindow) return setMessage("Popup blocked. Allow popups to print the manager WhatsApp format.");
    const companyName = activeCompany?.CompanyName || "ATLAS";
    const logoMarkup = companyLogoUrl
      ? `<img class="logo" src="${escapeHtml(companyLogoUrl)}" alt="${escapeHtml(companyName)} logo" />`
      : `<div class="logo-mark">ATLAS</div>`;
    const rows = [
      ["Manager WhatsApp", formatWhatsAppDisplayNumber(allocationWhatsAppForm.managerNumber)],
      ["Employee", `${selectedEmployee.EmployeeCode} - ${selectedEmployee.FullName}`],
      ["Department", selectedEmployee.Department || "-"],
      ["Reporting To", selectedEmployee.ReportingTo || "-"],
      ["Allocation Date", formatReportDate(allocationForm.date)],
      ["Allocation Year", allocationForm.year || "-"],
      ["Ticket / PNR", allocationForm.ticketNo || "-"],
      ["Route", allocationForm.route || "-"],
      ["Supplier", allocationForm.supplier || "-"],
      ["Ticket Amount", money.format(ticketCost)],
      ["Eligibility Amount", money.format(selectedEntitlement)],
      ["Company Pays", money.format(displayedCompanySettlementAmount)],
      ["Self Paid", money.format(selfPaidAmount)],
      ["Loan Amount", money.format(loanExcessAmount)],
      ["Payment Mode", formatPaymentModeLabel(allocationForm.paymentMode)]
    ];
    printWindow.document.write(`
      <!doctype html>
      <html>
      <head>
        <title>Airfare Manager WhatsApp - ${escapeHtml(companyName)}</title>
        <style>
          @page { size: A4; margin: 14mm; }
          * { box-sizing: border-box; }
          body { font-family: Arial, Helvetica, sans-serif; color: #111827; margin: 0; background: #f1f5f9; }
          .sheet { min-height: 269mm; background: #fff; padding: 0; }
          .head { display: grid; grid-template-columns: 1fr 92px; gap: 18px; align-items: center; border-bottom: 3px solid #2563eb; padding: 0 0 14px; margin-bottom: 16px; }
          .brand strong { display: block; font-size: 25px; letter-spacing: .2px; }
          .brand span, .meta { color: #475569; font-size: 12px; line-height: 1.5; }
          .logo { width: 86px; height: 86px; object-fit: contain; justify-self: end; }
          .logo-mark { width: 86px; height: 86px; display: grid; place-items: center; justify-self: end; color: #fff; background: #2563eb; border-radius: 16px; font-weight: 800; }
          .title-row { display: flex; justify-content: space-between; gap: 14px; align-items: flex-start; margin-bottom: 14px; }
          h1 { font-size: 22px; margin: 0; color: #0f172a; }
          .doc-pill { border: 1px solid #bfdbfe; color: #1d4ed8; background: #eff6ff; border-radius: 999px; padding: 7px 12px; font-weight: 700; font-size: 12px; white-space: nowrap; }
          .amounts { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 0 0 14px; }
          .amounts div { border: 1px solid #dbe3ef; border-radius: 10px; padding: 11px; background: #f8fafc; }
          .amounts small { display: block; color: #64748b; font-size: 11px; text-transform: uppercase; font-weight: 700; }
          .amounts strong { display: block; margin-top: 5px; font-size: 15px; color: #0f172a; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 18px; }
          td { border: 1px solid #dbe3ef; padding: 8px 10px; vertical-align: top; font-size: 12px; }
          td:first-child { width: 170px; background: #f8fafc; font-weight: 700; color: #334155; }
          .message { min-height: 190px; white-space: pre-wrap; border: 1px solid #dbe3ef; border-radius: 10px; padding: 16px; line-height: 1.55; font-size: 12px; }
          .signatures { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-top: 18px; }
          .signatures div { border-top: 1px solid #94a3b8; padding-top: 8px; color: #475569; font-size: 12px; min-height: 38px; }
          .foot { margin-top: 20px; color: #64748b; font-size: 12px; }
          @media print { body { background: #fff; } }
        </style>
      </head>
      <body>
        <div class="sheet">
        <div class="head">
          <div class="brand">
            <strong>${escapeHtml(companyName)}</strong>
            <span>${escapeHtml(activeCompany?.Address || "ATLAS HCM")}</span><br/>
            <span>${escapeHtml(activeCompany?.Phone || "")}${activeCompany?.Email ? ` | ${escapeHtml(activeCompany.Email)}` : ""}</span>
          </div>
          ${logoMarkup}
        </div>
        <div class="title-row">
          <div>
            <h1>${escapeHtml(allocationWhatsAppForm.subject || "Airfare Allocation Approval")}</h1>
            <div class="meta">Prepared: ${escapeHtml(new Date().toLocaleString())} | Manual WhatsApp attachment</div>
          </div>
          <div class="doc-pill">A4 APPROVAL FORMAT</div>
        </div>
        <div class="amounts">
          <div><small>Ticket amount</small><strong>${escapeHtml(money.format(ticketCost))}</strong></div>
          <div><small>Eligibility</small><strong>${escapeHtml(money.format(selectedEntitlement))}</strong></div>
          <div><small>Company pays</small><strong>${escapeHtml(money.format(displayedCompanySettlementAmount))}</strong></div>
          <div><small>Loan amount</small><strong>${escapeHtml(money.format(loanExcessAmount))}</strong></div>
        </div>
        <table>${rows.map(([label, value]) => `<tr><td>${escapeHtml(label)}</td><td>${escapeHtml(value)}</td></tr>`).join("")}</table>
        <div class="message">${escapeHtml(allocationWhatsAppMessageText)}</div>
        <div class="signatures">
          <div>Prepared by</div>
          <div>Manager approval</div>
          <div>Accounts / HR confirmation</div>
        </div>
        <div class="foot">This page is prepared by ATLAS. Normal WhatsApp requires the sender to press Send manually.</div>
        </div>
        <script>window.print();</script>
      </body>
      </html>
    `);
    printWindow.document.close();
    setMessage("A4 manager approval PDF format opened. Use Print / Save as PDF, then attach in WhatsApp.");
  }

  async function downloadAllocationManagerWhatsAppImage() {
    if (!selectedEmployee) {
      setMessage("Select employee before creating the A4 manager image.");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = 2480;
    canvas.height = 3508;
    const ctx = canvas.getContext("2d");
    if (!ctx) return setMessage("Image export is not available in this browser.");
    const companyName = activeCompany?.CompanyName || "ATLAS";
    const margin = 150;
    const pageRight = canvas.width - margin;
    let y = 150;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(0, 0, canvas.width, 360);
    ctx.fillStyle = "#2563eb";
    ctx.fillRect(margin, 330, canvas.width - margin * 2, 10);

    const logo = await loadCanvasImage(companyLogoUrl);
    if (logo) {
      ctx.drawImage(logo, pageRight - 220, y, 210, 210);
    } else {
      ctx.fillStyle = "#2563eb";
      ctx.fillRect(pageRight - 220, y, 210, 210);
      ctx.fillStyle = "#ffffff";
      ctx.font = "700 46px Arial";
      ctx.textAlign = "center";
      ctx.fillText("ATLAS", pageRight - 115, y + 124);
      ctx.textAlign = "left";
    }

    ctx.fillStyle = "#0f172a";
    ctx.font = "700 62px Arial";
    ctx.fillText(companyName, margin, y + 62);
    ctx.fillStyle = "#475569";
    ctx.font = "30px Arial";
    const companyLine = [activeCompany?.Address, activeCompany?.Phone, activeCompany?.Email].filter(Boolean).join(" | ") || "ATLAS HCM";
    drawWrappedCanvasText(ctx, companyLine, margin, y + 118, 1540, 36, 2);
    ctx.font = "28px Arial";
    ctx.fillText(`Prepared: ${new Date().toLocaleString()}`, margin, y + 210);

    y = 430;
    ctx.fillStyle = "#0f172a";
    ctx.font = "700 58px Arial";
    ctx.fillText(allocationWhatsAppForm.subject || "Airfare Allocation Approval", margin, y);
    ctx.fillStyle = "#eff6ff";
    ctx.fillRect(pageRight - 520, y - 54, 520, 78);
    ctx.fillStyle = "#1d4ed8";
    ctx.font = "700 28px Arial";
    ctx.textAlign = "center";
    ctx.fillText("A4 WHATSAPP ATTACHMENT", pageRight - 260, y - 8);
    ctx.textAlign = "left";

    y += 90;
    const amountCards = [
      ["Ticket amount", money.format(ticketCost)],
      ["Eligibility", money.format(selectedEntitlement)],
      ["Company pays", money.format(displayedCompanySettlementAmount)],
      ["Loan amount", money.format(loanExcessAmount)]
    ];
    const cardGap = 24;
    const cardWidth = (canvas.width - margin * 2 - cardGap * 3) / 4;
    amountCards.forEach(([label, value], index) => {
      const x = margin + index * (cardWidth + cardGap);
      ctx.fillStyle = "#f8fafc";
      ctx.fillRect(x, y, cardWidth, 150);
      ctx.strokeStyle = "#dbe3ef";
      ctx.strokeRect(x, y, cardWidth, 150);
      ctx.fillStyle = "#64748b";
      ctx.font = "700 25px Arial";
      ctx.fillText(label.toUpperCase(), x + 26, y + 48);
      ctx.fillStyle = "#0f172a";
      ctx.font = "700 36px Arial";
      ctx.fillText(value, x + 26, y + 105);
    });

    y += 210;
    const rows = [
      ["Manager WhatsApp", formatWhatsAppDisplayNumber(allocationWhatsAppForm.managerNumber)],
      ["Employee", `${selectedEmployee.EmployeeCode} - ${selectedEmployee.FullName}`],
      ["Department", selectedEmployee.Department || "-"],
      ["Reporting To", selectedEmployee.ReportingTo || "-"],
      ["Allocation Date", formatReportDate(allocationForm.date)],
      ["Allocation Year", allocationForm.year || "-"],
      ["Ticket / PNR", allocationForm.ticketNo || "-"],
      ["Route", allocationForm.route || "-"],
      ["Supplier", allocationForm.supplier || "-"],
      ["Payment Mode", formatPaymentModeLabel(allocationForm.paymentMode)]
    ];
    const labelWidth = 430;
    const rowHeight = 82;
    ctx.font = "28px Arial";
    rows.forEach(([label, value], index) => {
      const rowY = y + index * rowHeight;
      ctx.fillStyle = index % 2 ? "#ffffff" : "#f8fafc";
      ctx.fillRect(margin, rowY, canvas.width - margin * 2, rowHeight);
      ctx.strokeStyle = "#dbe3ef";
      ctx.strokeRect(margin, rowY, canvas.width - margin * 2, rowHeight);
      ctx.fillStyle = "#334155";
      ctx.font = "700 27px Arial";
      ctx.fillText(label, margin + 28, rowY + 50);
      ctx.fillStyle = "#0f172a";
      ctx.font = "30px Arial";
      drawWrappedCanvasText(ctx, value, margin + labelWidth, rowY + 50, canvas.width - margin * 2 - labelWidth - 24, 34, 1);
    });

    y += rows.length * rowHeight + 70;
    ctx.fillStyle = "#0f172a";
    ctx.font = "700 34px Arial";
    ctx.fillText("Message Preview", margin, y);
    y += 35;
    ctx.strokeStyle = "#dbe3ef";
    ctx.strokeRect(margin, y, canvas.width - margin * 2, 760);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(margin + 2, y + 2, canvas.width - margin * 2 - 4, 756);
    ctx.fillStyle = "#111827";
    ctx.font = "30px Arial";
    drawWrappedCanvasText(ctx, allocationWhatsAppMessageText.replace(/\*/g, ""), margin + 42, y + 62, canvas.width - margin * 2 - 84, 42, 17);

    y += 850;
    const signatureWidth = (canvas.width - margin * 2 - 80) / 3;
    ["Prepared by", "Manager approval", "Accounts / HR confirmation"].forEach((label, index) => {
      const x = margin + index * (signatureWidth + 40);
      ctx.strokeStyle = "#94a3b8";
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + signatureWidth, y);
      ctx.stroke();
      ctx.fillStyle = "#475569";
      ctx.font = "28px Arial";
      ctx.fillText(label, x, y + 48);
    });

    ctx.fillStyle = "#64748b";
    ctx.font = "25px Arial";
    ctx.fillText("Prepared by ATLAS. Attach this A4 image in WhatsApp after opening the manager chat.", margin, canvas.height - 120);
    const link = document.createElement("a");
    link.download = `ATLAS-Airfare-Manager-WhatsApp-${selectedEmployee.EmployeeCode || "employee"}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
    setMessage("A4 manager approval image downloaded. Attach the image in WhatsApp after opening the manager chat.");
  }

  const employeeTypeOptions = useMemo(() => (
    uniqueOptions([...defaultWorkOptions.status, ...employees.map((item) => item.PayrollStatus || item.Status)])
  ), [employees]);

  const workOptions = useMemo(() => {
    const incoming = importPreview?.employees || [];
    return {
      company: uniqueOptions([...defaultWorkOptions.company, ...quickAddOptions.company, ...employees.map((item) => item.Company), ...incoming.map((item) => item.company)]),
      department: uniqueOptions([...defaultWorkOptions.department, ...quickAddOptions.department, ...employees.map((item) => item.Department), ...incoming.map((item) => item.department)]),
      branch: uniqueOptions([...defaultWorkOptions.branch, ...quickAddOptions.branch, ...employees.map((item) => item.Branch), ...incoming.map((item) => item.branch)]),
      section: uniqueOptions([...defaultWorkOptions.section, ...quickAddOptions.section, ...employees.map((item) => item.Section), ...incoming.map((item) => item.section)]),
      location: uniqueOptions([...defaultWorkOptions.location, ...quickAddOptions.location, ...employees.map((item) => item.Location), ...incoming.map((item) => item.location)]),
      designation: uniqueOptions([...defaultWorkOptions.designation, ...quickAddOptions.designation, ...employees.map((item) => item.Designation), ...incoming.map((item) => item.designation)]),
      group: uniqueOptions([...defaultWorkOptions.group, ...quickAddOptions.group, ...employees.map((item) => item.EmpGroup), ...incoming.map((item) => item.group)]),
      reportingTo: uniqueOptions([...quickAddOptions.reportingTo, ...employees.map((item) => item.FullName), ...employees.map((item) => item.ReportingTo), ...incoming.map((item) => item.reportingTo)]),
      status: uniqueOptions([...defaultWorkOptions.status, ...quickAddOptions.status, ...employees.map((item) => item.PayrollStatus || item.Status), ...incoming.map((item) => item.payrollStatus)]),
      jobBand: uniqueOptions([...quickAddOptions.jobBand, ...employees.map((item) => item.JobBand), ...incoming.map((item) => item.jobBand)]),
      nationality: uniqueOptions([...quickAddOptions.nationality, ...employees.map((item) => item.Nationality), ...incoming.map((item) => item.nationality)])
    };
  }, [employees, importPreview, quickAddOptions]);

  function handleQuickAddOption(key: QuickAddOptionKey, label: string, selectValue: (value: string) => void) {
    const nextValue = window.prompt(`Add ${label}`);
    const normalized = nextValue?.trim();
    if (!normalized) return;
    setQuickAddOptions((current) => ({
      ...current,
      [key]: uniqueOptions([...(current[key] || []), normalized])
    }));
    selectValue(normalized);
    setMessage(`${label} added: ${normalized}`);
  }

  function updateEmployeeReferenceField(field: EmployeeFormReferenceField, value: string) {
    setEmployeeForm((current) => ({ ...current, [field]: value }));
  }

  function handleEditQuickAddOption(key: QuickAddOptionKey, field: EmployeeFormReferenceField, label: string, currentValue: string) {
    const existing = currentValue.trim();
    if (!existing) {
      setMessage(`Select ${label} before editing.`);
      return;
    }
    const nextValue = window.prompt(`Edit ${label}`, existing);
    const normalized = nextValue?.trim();
    if (!normalized || normalized === existing) return;
    setQuickAddOptions((current) => ({
      ...current,
      [key]: uniqueOptions([...(current[key] || []).filter((option) => option.toLowerCase() !== existing.toLowerCase()), normalized])
    }));
    updateEmployeeReferenceField(field, normalized);
    setMessage(`${label} updated: ${normalized}`);
  }

  function handleDeleteQuickAddOption(key: QuickAddOptionKey, field: EmployeeFormReferenceField, label: string, currentValue: string) {
    const existing = currentValue.trim();
    if (!existing) {
      setMessage(`Select ${label} before deleting.`);
      return;
    }
    const existsInCustomValues = (quickAddOptions[key] || []).some((option) => option.toLowerCase() === existing.toLowerCase());
    setQuickAddOptions((current) => ({
      ...current,
      [key]: (current[key] || []).filter((option) => option.toLowerCase() !== existing.toLowerCase())
    }));
    updateEmployeeReferenceField(field, "");
    setMessage(existsInCustomValues ? `${label} removed: ${existing}` : `${label} cleared from this employee form. Master/default values stay protected.`);
  }

  const displayedReport = getDisplayedReport();
  const displayedReportTotalRows = buildReportTotalRows(displayedReport);

  const trendData = airfarePayableReport.length
    ? airfarePayableReport.map((row) => ({
      name: row.EmployeeCode,
      opening: Number(Number(row.OpeningBalanceBHD || 0).toFixed(2)),
      payable: Number(Number(row.PayableBHD || 0).toFixed(2)),
      remaining: Number(Number(row.BalanceDays || 0).toFixed(2))
    }))
    : employees.map((employee) => ({
      name: employee.EmployeeCode,
      opening: Number((employee.OpeningBHD || 0).toFixed(2)),
      payable: calculateExcelTotal(employee),
      remaining: closingBalanceDays(employee)
    }));

  const pieData = [
    { name: "Payable", value: Math.max(metrics.totalAirfare, 0.01), color: "#38bdf8" },
    { name: "Opening", value: Math.max(metrics.opening, 0.01), color: "#a78bfa" },
    { name: "Loans", value: Math.max(metrics.loanBalance, 0.01), color: "#fb7185" }
  ];

  if (!session) {
    return (
      <main className="auth-shell">
        <section className="auth-split glass-panel">
          <div className="auth-brand-panel">
            <div className="brand-mark auth-brand">
              <div className="brand-orb auth-logo-orb">
                {loginLogoUrl ? <img src={loginLogoUrl} alt={`${loginForm.company} logo`} /> : <Plane size={24} />}
              </div>
              <div>
                <strong>ATLAS</strong>
                <span>Airfare HCM</span>
              </div>
            </div>
            <div>
              <p className="eyebrow">Enterprise airfare workspace</p>
              <h1>Welcome back to smarter employee travel control.</h1>
              <p>Manage airfare eligibility, loans, approvals, reports, and company databases from one secure workspace.</p>
            </div>
            <div className="auth-illustration" aria-hidden="true">
              <div className="route-card route-card-main">
                <Plane size={28} />
                <strong>Airfare approval</strong>
                <span>Eligibility checked before payment</span>
              </div>
              <div className="route-node node-a">HR</div>
              <div className="route-line" />
              <div className="route-node node-b">SQL</div>
              <div className="route-card route-card-small">
                <strong>Loan rules</strong>
                <span>Process or reject with control</span>
              </div>
            </div>
          </div>
          <div className="auth-form-panel">
            <div className="auth-form-head">
              <p className="eyebrow">Secure sign in</p>
              <h2>Sign in</h2>
              <p>Select company, then enter your login credentials.</p>
            </div>
            {message && <div className="toast-line auth-message">{message}</div>}
            <form className="auth-form" onSubmit={handleLogin}>
              <label className="floating-field">
                <select value={loginForm.company} onChange={(e) => setLoginForm({ ...loginForm, company: e.target.value })} aria-label="Company Selection">
                  <option value="ATLAS">ATLAS</option>
                </select>
                <span>Company Selection</span>
              </label>
              <label className="floating-field">
                <input value={loginForm.username} onChange={(e) => {
                  setLoginForm({ ...loginForm, username: e.target.value });
                  setResetEmail(e.target.value);
                }} />
                <span>Email or login</span>
              </label>
              <label className="floating-field">
                <input type="password" value={loginForm.password} onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })} />
                <span>Password</span>
              </label>
              <div className="auth-options">
                <label><input type="checkbox" checked={loginForm.remember} onChange={(e) => setLoginForm({ ...loginForm, remember: e.target.checked })} /> Remember me</label>
                <button type="button" onClick={handleForgotPassword}>Forgot Password?</button>
              </div>
              <button className="shine-button auth-submit" type="submit" disabled={busy}>{busy ? "Signing in..." : "Sign In"}</button>
              <div className="auth-divider"><span>or continue with</span></div>
              <div className="social-row">
                <button className="social-button" type="button" onClick={() => setMessage("Google sign-in can be connected after OAuth setup.")}>Google</button>
                <button className="social-button" type="button" onClick={() => setMessage("Microsoft sign-in can be connected after OAuth setup.")}>Microsoft</button>
              </div>
            </form>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className={`shell ${themeMode === "dark" ? "theme-dark" : ""} accent-${themeAccent} density-${uiDensity} ${sidebarCollapsed ? "sidebar-collapsed" : ""} ${rightPanelsCollapsed ? "right-panels-collapsed" : ""}`}>
      <aside className="sidebar glass-panel">
        <button
          className="sidebar-toggle"
          type="button"
          onClick={() => setSidebarCollapsed((current) => !current)}
          title={sidebarCollapsed ? "Expand menu" : "Collapse menu"}
          aria-label={sidebarCollapsed ? "Expand menu" : "Collapse menu"}
        >
          {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
        <div className="brand-mark">
          <div className="brand-orb">
            {companyLogoUrl ? <img src={companyLogoUrl} alt={`${activeCompany?.CompanyName || "ATLAS"} logo`} /> : <Plane size={22} />}
          </div>
          <div className="sidebar-text">
            <strong>{activeCompany?.CompanyName || "ATLAS"}</strong>
            <span>{activeCompany?.CompanyCode || "Airfare HCM"}</span>
          </div>
        </div>
        {!isEmployeePortalSession ? (
          <label className="company-switcher">
            <span>Company</span>
            <select value={selectedCompanyId} onChange={(event) => handleCompanySwitch(event.target.value)}>
              {companies.map((company) => <option key={company.CompanyID} value={company.CompanyID}>{company.CompanyName}</option>)}
            </select>
          </label>
        ) : null}
        <nav>
          {visibleNav.map((item) => {
            const Icon = item.icon;
            return (
              <button
                className={activeView === item.label ? "nav-item active" : "nav-item"}
                key={item.label}
                type="button"
                onClick={() => {
                  setActiveView(item.label);
                  window.scrollTo({ top: 0, left: 0, behavior: "smooth" });
                }}
              >
                <Icon size={18} />
                <span className="nav-label">{item.label}</span>
              </button>
            );
          })}
        </nav>
        {!isEmployeePortalSession ? <div className="sidebar-card">
          <Sparkles size={18} />
          <strong className="sidebar-text">Excel formula locked</strong>
          <span className="sidebar-text">Max payout / 60 x remaining days</span>
        </div> : null}
      </aside>

      <section className="workspace">
        <header className="topbar glass-panel">
          <div className="topbar-title">
            <div className="topbar-logo">
              {companyLogoUrl ? <img src={companyLogoUrl} alt={`${activeCompany?.CompanyName || "ATLAS"} logo`} /> : <Plane size={20} />}
            </div>
            <div>
            {showSyncStatus && (
              <div className="status-chip" role="status" aria-live="polite">
                <span>{status}</span>
                <button type="button" onClick={() => setShowSyncStatus(false)} aria-label="Hide live SQL sync status">
                  <X size={14} />
                </button>
              </div>
            )}
            <h1>{activeView === "Overview" ? "Airfare Command Center" : activeView}</h1>
            </div>
          </div>
          <div className="top-actions">
            {!isEmployeePortalSession ? <label className="search-box">
              <Search size={18} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && handleSearchSubmit()}
                placeholder="Search employees, loans, companies"
              />
            </label> : null}
            {!isEmployeePortalSession ? <button className="icon-button" onClick={handleSearchSubmit} title="Run search"><Search size={18} /></button> : null}
            {!isEmployeePortalSession ? <button className="icon-button" onClick={printCurrentScreen} title="Print current screen"><Printer size={18} /></button> : null}
            <button className="icon-button" disabled={busy} onClick={handleRefreshLiveData} title="Refresh live data"><RefreshCw size={18} /></button>
            {!isEmployeePortalSession ? <button
              className={activeView === "Employee Self-Service" ? "icon-button active" : "icon-button"}
              onClick={() => setActiveView("Employee Self-Service")}
              title="Open Employee Self-Service"
              aria-label="Open Employee Self-Service"
            >
              <ClipboardCheck size={18} />
            </button> : null}
            <button
              className={rightPanelsCollapsed ? "icon-button active" : "icon-button"}
              onClick={() => setRightPanelsCollapsed((current) => !current)}
              title={rightPanelsCollapsed ? "Show right panels" : "Hide right panels"}
              aria-label={rightPanelsCollapsed ? "Show right panels" : "Hide right panels"}
              aria-pressed={rightPanelsCollapsed}
            >
              {rightPanelsCollapsed ? <PanelRightOpen size={18} /> : <PanelRightClose size={18} />}
            </button>
            <button className="icon-button" onClick={() => setShowNotifications((current) => !current)} title="Validation notifications"><Bell size={18} /><span>{notificationCount}</span></button>
            <button className="icon-button" onClick={() => {
              setThemeMode((current) => current === "light" ? "dark" : "light");
              setMessage(themeMode === "light" ? "Dark mode enabled." : "Normal mode enabled.");
            }} title={themeMode === "light" ? "Switch to dark mode" : "Switch to normal mode"}>
              {themeMode === "light" ? <Moon size={18} /> : <Sun size={18} />}
            </button>
            <button className="profile-chip" type="button" title={`${session.user.fullName || session.user.username} profile`}>
              <span className="profile-avatar">{getInitials(session.user.fullName || session.user.username)}</span>
              <span className="profile-meta">
                <strong>{session.user.fullName || session.user.username}</strong>
                <small>{session.user.role}</small>
              </span>
            </button>
            <button className="logout-button top-logout" onClick={() => handleLogout()}><LogOut size={18} /> Logout</button>
          </div>
        </header>

        {showNotifications && (
          <section className="glass-panel notifications-panel">
              <div className="card-title"><Bell size={18} /> System verification notifications</div>
            <div className="stack-list">
              {notificationItems.map((item, index) => (
                <div className={`notice notice-${item.tone}`} key={`${item.title}-${index}`}>
                  <span />
                  <div>
                    <strong>{item.title}</strong>
                    <p>{item.detail}</p>
                    {"targetView" in item && item.targetView ? (
                      <button className="mini-soft" type="button" onClick={() => {
                        const targetView = item.targetView;
                        if (targetView) {
                          setActiveView(targetView);
                        }
                        setShowNotifications(false);
                      }}>{item.actionLabel || "Open"}</button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {message && (
          <div className="toast-line app-toast" role="status">
            <CheckCircle2 size={18} />
            <span>{message}</span>
            <button className="toast-close" onClick={() => setMessage("")} title="Close notification"><X size={16} /></button>
          </div>
        )}

        {activeView === "Overview" && (
          <>
            <section className="overview-command">
              <motion.div className="overview-summary glass-panel" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
                <div>
                  <p className="eyebrow">Airfare command center</p>
                  <h2>Summary first. Details when needed.</h2>
                  <p>Track payable balance, monthly growth, active loans, and review alerts from one clean workspace.</p>
                </div>
                <div className="summary-focus-row">
                  <span>
                    <small>Airfare payable</small>
                    <strong>{money.format(metrics.totalAirfare)}</strong>
                  </span>
                  <span>
                    <small>Current year earned</small>
                    <strong>{money.format(metrics.currentYearEarned)}</strong>
                  </span>
                  <span>
                    <small>Report employees</small>
                    <strong>{metrics.employeeCount}</strong>
                  </span>
                </div>
              </motion.div>
              <motion.div className="overview-ai glass-panel" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}>
                <div className="card-title"><Bot size={18} /> Smart review</div>
                <h3>{metrics.currentYearEarned > 0 ? "Airfare payable report synced" : "Opening balance under control"}</h3>
                <p>Dashboard values now use entitlement totals from the same SQL rows as the Airfare Payable report.</p>
                <button className="shine-button" onClick={() => setActiveView("AI Insights")}>Open insights</button>
              </motion.div>
            </section>
            <MetricGrid metrics={metrics} />
            <details className="analytics-disclosure glass-panel">
              <summary>
                <span>
                  <strong>Advanced analytics</strong>
                  <small>Open detailed charts only when reviewing trends.</small>
                </span>
                <TrendingUp size={18} />
              </summary>
              <Analytics trendData={trendData} pieData={pieData} />
            </details>
            <CalculationLab calcInput={calcInput} setCalcInput={setCalcInput} calcResult={calcResult} />
          </>
        )}

        {activeView === "Employees" && (
          <section className="employee-workspace">
            <div className="glass-panel table-card">
              <div className="card-title"><Users size={18} /> Employee Master</div>
              <input ref={employeeImportRef} type="file" accept=".xlsx,.xls" hidden onChange={handleImportEmployees} />
              <div className="button-row compact">
                <button className="soft-button" disabled={busy || !session} onClick={() => employeeImportRef.current?.click()}><Upload size={16} /> Import Excel</button>
                <button className="soft-button" disabled={busy} onClick={handleExportEmployeeMaster}><Download size={16} /> Export Master</button>
                <button className="soft-button" disabled={busy || !session} onClick={handleExportSqlEmployeeReport}><Download size={16} /> SQL Report</button>
                <button className="soft-button" disabled={busy} onClick={handleExportAirfareReport}><Download size={16} /> Airfare Report</button>
                <button className="shine-button" disabled={busy} onClick={() => {
                  resetEmployeeForm();
                  setEmployeeFormOpen(true);
                }}><Plus size={16} /> Add Employee Master</button>
              </div>
              <div className="button-row compact">
                <Field label="Search employee">
                  <input
                    type="text"
                    placeholder="Search by code, name, department or status"
                    value={employeeMasterSearch}
                    onChange={(event) => setEmployeeMasterSearch(event.target.value)}
                  />
                </Field>
                <Field label="Employee status">
                  <select value={employeeMasterStatusScope} onChange={(event) => setEmployeeMasterStatusScope(event.target.value as "active" | "inactive" | "all")}>
                    <option value="active">Active employees</option>
                    <option value="inactive">Inactive / separated / probation</option>
                    <option value="all">All employees</option>
                  </select>
                </Field>
                <button
                  className="soft-button"
                  disabled={busy || !selectedMasterEmployeesCount}
                  onClick={() => handleBulkDeleteEmployees(masterEmployeeIds.filter((id) => selectedEmployeeIds.has(id)))}
                >
                  <Trash2 size={16} /> Delete selected ({selectedMasterEmployeesCount})
                </button>
              </div>
              <div className="whatsapp-panel">
                <div className="whatsapp-panel-head">
                  <div>
                    <strong>WhatsApp message</strong>
                    <span>Normal WhatsApp opens with the message filled. Press Send in WhatsApp manually.</span>
                  </div>
                  <span className="pill">{whatsappReady ? "Ready" : "Needs number"}</span>
                </div>
                <div className="whatsapp-grid">
                  <Field label="Employee">
                    <select value={whatsappForm.employeeId} onChange={(event) => setWhatsappForm({ ...whatsappForm, employeeId: event.target.value })}>
                      <option value="">Select employee</option>
                      {whatsappEmployeeOptions.map((employee) => (
                        <option key={employee.EmployeeID} value={employee.EmployeeID}>{employee.EmployeeCode} - {employee.FullName}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Send to">
                    <select value={whatsappForm.recipientType} onChange={(event) => setWhatsappForm({ ...whatsappForm, recipientType: event.target.value as "employee" | "manager" | "custom" })}>
                      <option value="employee">Employee WhatsApp from master</option>
                      <option value="manager">Manager WhatsApp typed</option>
                      <option value="custom">Other WhatsApp typed</option>
                    </select>
                  </Field>
                  {whatsappForm.recipientType === "employee" && (
                    <Field label="Employee WhatsApp">
                      <input readOnly value={selectedWhatsAppEmployee?.WhatsAppNumber || ""} placeholder="Add number in Employee Master" />
                    </Field>
                  )}
                  {whatsappForm.recipientType === "manager" && (
                    <Field label="Manager WhatsApp">
                      <input placeholder="973XXXXXXXX" value={whatsappForm.managerNumber} onChange={(event) => setWhatsappForm({ ...whatsappForm, managerNumber: event.target.value })} />
                    </Field>
                  )}
                  {whatsappForm.recipientType === "custom" && (
                    <Field label="WhatsApp number">
                      <input placeholder="973XXXXXXXX" value={whatsappForm.customNumber} onChange={(event) => setWhatsappForm({ ...whatsappForm, customNumber: event.target.value })} />
                    </Field>
                  )}
                  <Field label="Subject">
                    <input value={whatsappForm.subject} onChange={(event) => setWhatsappForm({ ...whatsappForm, subject: event.target.value })} />
                  </Field>
                  <Field label="Reference">
                    <input placeholder="Ticket, loan, report, or approval reference" value={whatsappForm.reference} onChange={(event) => setWhatsappForm({ ...whatsappForm, reference: event.target.value })} />
                  </Field>
                  <Field label="Footer">
                    <input value={whatsappForm.footer} onChange={(event) => setWhatsappForm({ ...whatsappForm, footer: event.target.value })} />
                  </Field>
                </div>
                <Field label="Message">
                  <textarea rows={4} placeholder="Type the WhatsApp message" value={whatsappForm.body} onChange={(event) => setWhatsappForm({ ...whatsappForm, body: event.target.value })} />
                </Field>
                <div className="whatsapp-preview">
                  <strong>Preview</strong>
                  <pre>{whatsappMessageText}</pre>
                </div>
                <div className="button-row compact">
                  <button className="soft-button" disabled={busy} onClick={printWhatsAppMessage}><Printer size={16} /> Print format</button>
                  <button className="shine-button" disabled={busy || !whatsappReady} onClick={openWhatsAppMessage}>Open WhatsApp</button>
                </div>
              </div>
              {importPreview && (
                <ImportPreviewPanel
                  preview={importPreview}
                  onCancel={() => setImportPreview(null)}
                  onConfirm={confirmImportEmployees}
                  onToggleRow={toggleImportEmployeeRow}
                  onToggleAll={toggleAllImportEmployeeRows}
                  onRemoveRow={removeImportEmployeeRow}
                  busy={busy}
                />
              )}
              <EmployeeTable
                employees={employeeMasterRows}
                onEdit={handleEditEmployee}
                onDelete={handleDeleteEmployee}
                selectedIds={selectedEmployeeIds}
                onToggleSelect={handleToggleEmployeeSelection}
                onSelectAll={handleSelectAllEmployeeRows}
                allSelected={allEmployeesSelected}
                onDeleteSelected={() => handleBulkDeleteEmployees(masterEmployeeIds.filter((id) => selectedEmployeeIds.has(id)))}
                employeeCount={masterEmployeeIds.length}
              />
            </div>
            {employeeFormOpen && (
            <div className="employee-form-overlay">
            <div className="glass-panel form-card employee-form-panel">
              <div className="card-title">
                <span><Plus size={18} /> {editingEmployeeId ? "Edit Employee Master" : "Add Employee Master"}</span>
                <button className="mini-soft" disabled={busy} onClick={resetEmployeeForm}><X size={16} /> Close</button>
              </div>
              <div className="form-section-label">Identity</div>
              <div className="form-grid two">
                <Field label="Employee code"><input placeholder="Employee code" disabled={Boolean(editingEmployeeId)} value={employeeForm.code} onChange={(e) => setEmployeeForm({ ...employeeForm, code: e.target.value })} /></Field>
                <Field label="Full name"><input placeholder="Full name" value={employeeForm.name} onChange={(e) => setEmployeeForm({ ...employeeForm, name: e.target.value })} /></Field>
                <Field label="Bank code"><input placeholder="Bank code" value={employeeForm.bankCode} onChange={(e) => setEmployeeForm({ ...employeeForm, bankCode: e.target.value })} /></Field>
                <SelectField placeholder="Job band" value={employeeForm.jobBand} options={workOptions.jobBand} onChange={(value) => setEmployeeForm({ ...employeeForm, jobBand: value })} onAddOption={() => handleQuickAddOption("jobBand", "Job band", (value) => setEmployeeForm((current) => ({ ...current, jobBand: value })))} onEditOption={() => handleEditQuickAddOption("jobBand", "jobBand", "Job band", employeeForm.jobBand)} onDeleteOption={() => handleDeleteQuickAddOption("jobBand", "jobBand", "Job band", employeeForm.jobBand)} />
                <Field label="Join date"><input type="date" value={employeeForm.joinDate} onChange={(e) => setEmployeeForm({ ...employeeForm, joinDate: e.target.value })} /></Field>
                <Field label="CPR / Bahrain ID"><input placeholder="CPR / Bahrain ID" value={employeeForm.cpr} onChange={(e) => setEmployeeForm({ ...employeeForm, cpr: e.target.value })} /></Field>
                <Field label="Passport number"><input placeholder="Passport number" value={employeeForm.passport} onChange={(e) => setEmployeeForm({ ...employeeForm, passport: e.target.value })} /></Field>
                <SelectField placeholder="Nationality" value={employeeForm.nationality} options={workOptions.nationality} onChange={(value) => setEmployeeForm({ ...employeeForm, nationality: value })} onAddOption={() => handleQuickAddOption("nationality", "Nationality", (value) => setEmployeeForm((current) => ({ ...current, nationality: value })))} onEditOption={() => handleEditQuickAddOption("nationality", "nationality", "Nationality", employeeForm.nationality)} onDeleteOption={() => handleDeleteQuickAddOption("nationality", "nationality", "Nationality", employeeForm.nationality)} />
                <Field label="Bahraini national"><select value={employeeForm.bahrainiNational} onChange={(e) => setEmployeeForm({ ...employeeForm, bahrainiNational: e.target.value })}>
                  <option value="No">Non Bahraini</option>
                  <option value="Yes">Bahraini</option>
                </select></Field>
                <Field label="Passport expiry date"><input placeholder="Passport expiry date" type="date" value={employeeForm.passportExpiryDate} onChange={(e) => setEmployeeForm({ ...employeeForm, passportExpiryDate: e.target.value })} /></Field>
              </div>
              <div className="form-section-label">Work</div>
              <div className="form-grid two">
                <SelectField placeholder="Company" value={employeeForm.company} options={workOptions.company} onChange={(value) => setEmployeeForm({ ...employeeForm, company: value })} onAddOption={() => handleQuickAddOption("company", "Company", (value) => setEmployeeForm((current) => ({ ...current, company: value })))} onEditOption={() => handleEditQuickAddOption("company", "company", "Company", employeeForm.company)} onDeleteOption={() => handleDeleteQuickAddOption("company", "company", "Company", employeeForm.company)} />
                <SelectField placeholder="Department" value={employeeForm.department} options={workOptions.department} onChange={(value) => setEmployeeForm({ ...employeeForm, department: value })} onAddOption={() => handleQuickAddOption("department", "Department", (value) => setEmployeeForm((current) => ({ ...current, department: value })))} onEditOption={() => handleEditQuickAddOption("department", "department", "Department", employeeForm.department)} onDeleteOption={() => handleDeleteQuickAddOption("department", "department", "Department", employeeForm.department)} />
                <SelectField placeholder="Branch" value={employeeForm.branch} options={workOptions.branch} onChange={(value) => setEmployeeForm({ ...employeeForm, branch: value })} onAddOption={() => handleQuickAddOption("branch", "Branch", (value) => setEmployeeForm((current) => ({ ...current, branch: value })))} onEditOption={() => handleEditQuickAddOption("branch", "branch", "Branch", employeeForm.branch)} onDeleteOption={() => handleDeleteQuickAddOption("branch", "branch", "Branch", employeeForm.branch)} />
                <SelectField placeholder="Section" value={employeeForm.section} options={workOptions.section} onChange={(value) => setEmployeeForm({ ...employeeForm, section: value })} onAddOption={() => handleQuickAddOption("section", "Section", (value) => setEmployeeForm((current) => ({ ...current, section: value })))} onEditOption={() => handleEditQuickAddOption("section", "section", "Section", employeeForm.section)} onDeleteOption={() => handleDeleteQuickAddOption("section", "section", "Section", employeeForm.section)} />
                <SelectField placeholder="Location" value={employeeForm.location} options={workOptions.location} onChange={(value) => setEmployeeForm({ ...employeeForm, location: value })} onAddOption={() => handleQuickAddOption("location", "Location", (value) => setEmployeeForm((current) => ({ ...current, location: value })))} onEditOption={() => handleEditQuickAddOption("location", "location", "Location", employeeForm.location)} onDeleteOption={() => handleDeleteQuickAddOption("location", "location", "Location", employeeForm.location)} />
                <SelectField placeholder="Designation" value={employeeForm.designation} options={workOptions.designation} onChange={(value) => setEmployeeForm({ ...employeeForm, designation: value })} onAddOption={() => handleQuickAddOption("designation", "Designation", (value) => setEmployeeForm((current) => ({ ...current, designation: value })))} onEditOption={() => handleEditQuickAddOption("designation", "designation", "Designation", employeeForm.designation)} onDeleteOption={() => handleDeleteQuickAddOption("designation", "designation", "Designation", employeeForm.designation)} />
                <SelectField placeholder="Pay group" value={employeeForm.group} options={workOptions.group} onChange={(value) => setEmployeeForm({ ...employeeForm, group: value })} onAddOption={() => handleQuickAddOption("group", "Pay group", (value) => setEmployeeForm((current) => ({ ...current, group: value })))} onEditOption={() => handleEditQuickAddOption("group", "group", "Pay group", employeeForm.group)} onDeleteOption={() => handleDeleteQuickAddOption("group", "group", "Pay group", employeeForm.group)} />
                <SelectField placeholder="Reporting to" value={employeeForm.reportingTo} options={workOptions.reportingTo} onChange={(value) => setEmployeeForm({ ...employeeForm, reportingTo: value })} onAddOption={() => handleQuickAddOption("reportingTo", "Reporting to", (value) => setEmployeeForm((current) => ({ ...current, reportingTo: value })))} onEditOption={() => handleEditQuickAddOption("reportingTo", "reportingTo", "Reporting to", employeeForm.reportingTo)} onDeleteOption={() => handleDeleteQuickAddOption("reportingTo", "reportingTo", "Reporting to", employeeForm.reportingTo)} />
                <SelectField placeholder="Employee status" value={employeeForm.payrollStatus} options={workOptions.status} onChange={(value) => setEmployeeForm({ ...employeeForm, payrollStatus: value })} onAddOption={() => handleQuickAddOption("status", "Employee status", (value) => setEmployeeForm((current) => ({ ...current, payrollStatus: value })))} onEditOption={() => handleEditQuickAddOption("status", "payrollStatus", "Employee status", employeeForm.payrollStatus)} onDeleteOption={() => handleDeleteQuickAddOption("status", "payrollStatus", "Employee status", employeeForm.payrollStatus)} />
                <Field label="Last working date"><input type="date" value={employeeForm.lastWorkingDate} onChange={(e) => setEmployeeForm({ ...employeeForm, lastWorkingDate: e.target.value })} /></Field>
                <Field label="Email"><input placeholder="Email" value={employeeForm.email} onChange={(e) => setEmployeeForm({ ...employeeForm, email: e.target.value })} /></Field>
                <Field label="WhatsApp number"><input placeholder="973XXXXXXXX" value={employeeForm.whatsappNumber} onChange={(e) => setEmployeeForm({ ...employeeForm, whatsappNumber: e.target.value })} /></Field>
              </div>
              <div className="form-section-label">Salary and airfare</div>
              <div className="form-grid two">
                <Field label="Paid days"><input type="number" step="0.001" placeholder="0" value={employeeForm.paidDays} onChange={(e) => setEmployeeForm({ ...employeeForm, paidDays: e.target.value })} /></Field>
                <Field label="Maximum payout"><input type="number" step="0.01" min="0" max="150" placeholder="150" value={employeeForm.maximumPayout} onChange={(e) => setEmployeeForm({ ...employeeForm, maximumPayout: e.target.value })} /></Field>
                <Field label="Current year working days"><input type="number" step="0.01" placeholder="360" value={employeeForm.totalWorkingDays} onChange={(e) => setEmployeeForm({ ...employeeForm, totalWorkingDays: e.target.value })} /></Field>
                <Field label="Basic salary"><input type="number" step="0.01" placeholder="Basic salary" value={employeeForm.basicSalary} onChange={(e) => setEmployeeForm({ ...employeeForm, basicSalary: e.target.value })} /></Field>
                <Field label="HRA"><input type="number" step="0.01" placeholder="HRA" value={employeeForm.hra} onChange={(e) => setEmployeeForm({ ...employeeForm, hra: e.target.value })} /></Field>
                <Field label="Special duty allowance"><input type="number" step="0.01" placeholder="Special duty allowance" value={employeeForm.specialDutyAllowance} onChange={(e) => setEmployeeForm({ ...employeeForm, specialDutyAllowance: e.target.value })} /></Field>
                <Field label="Car allowance"><input type="number" step="0.01" placeholder="Car allowance" value={employeeForm.carAllowance} onChange={(e) => setEmployeeForm({ ...employeeForm, carAllowance: e.target.value })} /></Field>
                <Field label="Petrol allowance"><input type="number" step="0.01" placeholder="Petrol allowance" value={employeeForm.petrolAllowance} onChange={(e) => setEmployeeForm({ ...employeeForm, petrolAllowance: e.target.value })} /></Field>
                <Field label="Phone allowance"><input type="number" step="0.01" placeholder="Phone allowance" value={employeeForm.phoneAllowance} onChange={(e) => setEmployeeForm({ ...employeeForm, phoneAllowance: e.target.value })} /></Field>
                <Field label="Gross salary"><input type="number" step="0.01" placeholder="Gross salary" value={employeeForm.grossSalary} onChange={(e) => setEmployeeForm({ ...employeeForm, grossSalary: e.target.value })} /></Field>
                <Field label="GOSI deduction"><input type="number" step="0.01" placeholder="GOSI deduction" value={employeeForm.gosiDeduction} onChange={(e) => setEmployeeForm({ ...employeeForm, gosiDeduction: e.target.value })} /></Field>
                <Field label="Average salary"><input type="number" step="0.01" placeholder="Average salary" value={employeeForm.averageSalary} onChange={(e) => setEmployeeForm({ ...employeeForm, averageSalary: e.target.value })} /></Field>
                <Field label="Account number"><input placeholder="Account number" value={employeeForm.accountNumber} onChange={(e) => setEmployeeForm({ ...employeeForm, accountNumber: e.target.value })} /></Field>
                <Field label="Religion"><input placeholder="Religion" value={employeeForm.religion} onChange={(e) => setEmployeeForm({ ...employeeForm, religion: e.target.value })} /></Field>
                <Field label="Serial no"><input type="number" step="1" placeholder="Serial no" value={employeeForm.serialNo} onChange={(e) => setEmployeeForm({ ...employeeForm, serialNo: e.target.value })} /></Field>
              </div>
              <div className="standard-note">
                <div>
                  <strong>Opening balance is controlled separately.</strong>
                  <span>Use the Opening Balance screen for opening days, opening amount, and Excel import.</span>
                </div>
                <button className="mini-soft" onClick={() => setActiveView("Opening Balance")}>Open balance screen</button>
              </div>
              <div className="button-row">
                <button className="shine-button" disabled={busy} onClick={handleCreateEmployee}>{editingEmployeeId ? "Update employee" : "Save employee"}</button>
                {editingEmployeeId && <button className="soft-button" disabled={busy} onClick={resetEmployeeForm}>Cancel edit</button>}
                {!editingEmployeeId && <button className="soft-button" disabled={busy} onClick={resetEmployeeForm}>Close form</button>}
              </div>
            </div>
            </div>
            )}
          </section>
        )}

        {activeView === "Opening Balance" && (
          <section className="preferences-page">
            <div className="glass-panel table-card">
              <div className="card-title"><ListPlus size={18} /> Opening balance register</div>
              <input ref={openingImportRef} type="file" accept=".xlsx,.xls" hidden onChange={handleImportOpeningBalances} />
              <div className="button-row compact">
                <button className="soft-button" disabled={busy || !session} onClick={() => openingImportRef.current?.click()}><Upload size={16} /> Import Excel</button>
                <button className="soft-button" disabled={busy} onClick={handleExportOpeningBalances}><Download size={16} /> Export Opening Balances</button>
              </div>
              {openingPreview && (
                <div className="import-preview">
                  <div className="import-preview-head">
                    <div>
                      <strong>Opening balance import review</strong>
                      <span>{openingPreview.fileName} / SQL batch #{openingPreview.importBatchId || "-"} / {openingPreview.rows.filter((row) => row.selected).length} selected</span>
                    </div>
                    <div className="button-row compact">
                      <button className="soft-button" disabled={busy} onClick={() => setOpeningPreview(null)}>Cancel</button>
                      <button className="shine-button" disabled={busy || !openingPreview.rows.some((row) => row.selected)} onClick={confirmImportOpeningBalances}>Import selected balances</button>
                    </div>
                  </div>
                  <div className="import-alert">SQL validates employee code, duplicate employee/year rows, amount formula, and whether the balance will insert or update before saving.</div>
                  {openingPreview.summary && (
                    <div className="import-summary-strip">
                      <span><small>Total rows</small><strong>{openingPreview.summary.totalRows}</strong></span>
                      <span><small>Ready</small><strong>{openingPreview.summary.readyRows}</strong></span>
                      <span><small>Warnings</small><strong>{openingPreview.summary.warningRows}</strong></span>
                      <span><small>Errors</small><strong>{openingPreview.summary.errorRows}</strong></span>
                      <span><small>Selected</small><strong>{openingPreview.rows.filter((row) => row.selected).length}</strong></span>
                    </div>
                  )}
                  <div className="preview-grid">
                    <div className="preview-row opening-review-row preview-head-row">
                      <span><input type="checkbox" checked={openingPreview.rows.filter((row) => row.severity !== "ERROR").every((row) => row.selected)} onChange={(event) => toggleAllOpeningPreviewRows(event.target.checked)} /></span>
                      <span>Excel row</span><span>Employee</span><span>Year</span><span>Days</span><span>Amount</span><span>Action</span><span>Review</span><span>Remove</span>
                    </div>
                    {openingPreview.rows.map((row) => (
                      <div className={`preview-row opening-review-row ${row.severity === "ERROR" ? "needs-review" : ""}`} key={row.importBatchRowId || `${row.employeeCode}-${row.sourceRow}`}>
                        <span><input type="checkbox" checked={Boolean(row.selected)} disabled={row.severity === "ERROR"} onChange={(event) => toggleOpeningPreviewRow(row.importBatchRowId, event.target.checked)} /></span>
                        <span>{row.sourceRow || "-"}</span>
                        <span>{row.employeeCode}</span>
                        <span>{row.year}</span>
                        <span>{row.openingDays.toFixed(2)}</span>
                        <span>{money.format(row.openingBhd)}</span>
                        <span>{row.action || "CHECK"}</span>
                        <span className={row.severity === "ERROR" ? "pill danger" : row.severity === "WARNING" ? "pill warning" : "pill success"}>{row.severity || "READY"}: {row.message || "Ready"}</span>
                        <span><button className="mini-danger" disabled={busy} onClick={() => removeOpeningPreviewRow(row.importBatchRowId)}><Trash2 size={14} /></button></span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="premium-table">
                <div className="table-row employee-head table-head"><span>Employee</span><span>Opening Days</span><span>Opening Amount</span><span>Status</span><span>Action</span></div>
                {filteredEmployees.map((employee) => (
                  <div className="table-row employee-head" key={employee.EmployeeID}>
                    <span><strong>{employee.FullName}</strong><small>{employee.EmployeeCode} / {employee.Department || "-"}</small></span>
                    <span>{closingBalanceDays(employee).toFixed(2)}</span>
                    <span>{money.format(calculateExcelTotal(employee))}</span>
                    <span className="pill">{employee.Status}</span>
                    <span className="row-actions">
                      <button className="mini-soft" onClick={() => setOpeningForm({
                        employeeId: String(employee.EmployeeID),
                        year: openingForm.year,
                        openingDays: String(closingBalanceDays(employee)),
                        openingBhd: String(calculateExcelTotal(employee)),
                        maximumPayout: String(employee.MaximumPayout || 150)
                      })}>Edit</button>
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="glass-panel form-card preferences-policy-card">
              <div className="card-title"><Plus size={18} /> Add opening balance</div>
              <div className="form-grid one">
                <Field label="Employee">
                  <select value={openingForm.employeeId} onChange={(event) => {
                    const employee = employees.find((item) => item.EmployeeID === Number(event.target.value));
                    setOpeningForm({
                      ...openingForm,
                      employeeId: event.target.value,
                      openingDays: "",
                      openingBhd: "",
                      maximumPayout: employee ? String(employee.MaximumPayout || 150) : "150"
                    });
                  }}>
                    <option value="">Select employee</option>
                    {(employeeMasterAll.length ? employeeMasterAll : employees).map((employee) => <option key={employee.EmployeeID} value={employee.EmployeeID}>{employee.EmployeeCode} - {employee.FullName}{isAirfareEligibleEmployeeStatus(employee.Status) ? "" : " (inactive)"}</option>)}
                  </select>
                </Field>
                <Field label="Opening year"><input type="number" value={openingForm.year} onChange={(event) => setOpeningForm({ ...openingForm, year: event.target.value })} /></Field>
                <Field label="Opening days"><input type="number" step="0.01" value={openingForm.openingDays} onChange={(event) => {
                  const days = event.target.value;
                  const amount = days.trim() === "" ? "" : roundMoney((toNumber(openingForm.maximumPayout, AIRFARE_DEFAULT_PAYOUT) / AIRFARE_MAX_DAYS) * Math.min(AIRFARE_MAX_DAYS, toNumber(days))).toFixed(2);
                  setOpeningForm({ ...openingForm, openingDays: days, openingBhd: amount });
                }} /></Field>
                <Field label="Opening amount BHD"><input type="number" step="0.01" value={openingForm.openingBhd} onChange={(event) => setOpeningForm({ ...openingForm, openingBhd: event.target.value })} /></Field>
                <Field label="Maximum payout"><input type="number" step="0.01" min="0" max="150" value={openingForm.maximumPayout} onChange={(event) => {
                  const maximumPayout = event.target.value;
                  const amount = openingForm.openingDays.trim() === "" ? "" : roundMoney((toNumber(maximumPayout, AIRFARE_DEFAULT_PAYOUT) / AIRFARE_MAX_DAYS) * Math.min(AIRFARE_MAX_DAYS, toNumber(openingForm.openingDays))).toFixed(2);
                  setOpeningForm({ ...openingForm, maximumPayout, openingBhd: amount });
                }} /></Field>
              </div>
              <div className="calc-result">
                <span><small>Formula</small><strong>Max / 60 x days</strong></span>
                <span><small>Amount</small><strong>{money.format(toNumber(openingForm.openingBhd))}</strong></span>
                <span><small>Per day</small><strong>{money.format(toNumber(openingForm.maximumPayout, AIRFARE_DEFAULT_PAYOUT) / AIRFARE_MAX_DAYS)}</strong></span>
              </div>
              <div className="button-row">
                <button className="shine-button" disabled={busy} onClick={handleSaveOpeningBalance}>Save opening balance</button>
              </div>
              <p className="muted">Opening balance is the approved carry-forward balance used by Airfare Allocation.</p>
            </div>
          </section>
        )}

        {activeView === "Airfare" && (
          <section className={`calc-grid airfare-layout ${recentAllocationsOpen ? "recent-open" : "recent-closed"}`}>
            <div className="glass-panel form-card">
              <div className="card-title">
                <span><Plane size={18} /> Airfare allocation</span>
                <button className="mini-soft" type="button" onClick={() => setRecentAllocationsOpen((current) => !current)}>
                  <Eye size={16} /> {recentAllocationsOpen ? "Hide recent" : "Show recent"}
                </button>
              </div>
              <div className="form-grid two">
                <Field label="Document No."><input value={editingAllocationId ? `AF-${editingAllocationId}` : "New after save"} readOnly /></Field>
                <Field label="Employee type">
                  <select value={allocationEmployeeType} onChange={(event) => {
                    setAllocationEmployeeType(event.target.value);
                    setAllocationForm((current) => ({ ...current, employeeId: "", overrideReason: "", managerApproval: "" }));
                  }}>
                    <option value="">All types</option>
                    {employeeTypeOptions.map((type) => <option key={type} value={type}>{type}</option>)}
                  </select>
                </Field>
                <Field label="Search employee">
                  <input
                    placeholder="Type / index / code / name"
                    value={allocationEmployeeSearch}
                    onChange={(event) => {
                      setAllocationEmployeeSearch(event.target.value);
                      setAllocationForm((current) => ({ ...current, employeeId: "", overrideReason: "", managerApproval: "" }));
                    }}
                  />
                </Field>
                <Field label="Employee">
                  <select value={allocationForm.employeeId} onChange={(e) => setAllocationForm({ ...allocationForm, employeeId: e.target.value, overrideReason: "", managerApproval: "" })}>
                    <option value="">Select employee</option>
                    {allocationEmployeeRows.map((employee) => (
                      <option key={employee.EmployeeID} value={employee.EmployeeID}>
                        {employee.SerialNo ? `[${employee.SerialNo}] ` : ""}{employee.EmployeeCode} - {employee.FullName}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Allocation date"><input type="date" value={allocationForm.date} onChange={(event) => {
                  const selectedDate = event.target.value;
                  const selectedYear = selectedDate ? new Date(selectedDate).getFullYear().toString() : allocationForm.year;
                  setAllocationForm({ ...allocationForm, date: selectedDate, year: selectedYear });
                }} /></Field>
                <Field label="Allocation year"><input type="number" placeholder="Year" value={allocationForm.year} onChange={(e) => setAllocationForm({ ...allocationForm, year: e.target.value })} /></Field>
                <Field label="Ticket Amount"><input type="number" step="0.01" placeholder="Ticket amount" value={allocationForm.ticketCost} onChange={(e) => setAllocationForm({ ...allocationForm, ticketCost: e.target.value })} /></Field>
                <Field label="Selected Payment Option">
                  <select value={allocationForm.paymentMode} onChange={(e) => setAllocationForm({ ...allocationForm, paymentMode: e.target.value })}>
                    <option value="entitlement">Use airfare entitlement amount</option>
                    {allocationForm.paymentMode === "company" && <option value="company">{paymentModeLabels.company} - historical</option>}
                    <option value="company_full">{paymentModeLabels.company_full}</option>
                    <option value="employee">{paymentModeLabels.employee}</option>
                    <option value="employee_full">{paymentModeLabels.employee_full}</option>
                    <option value="loan">{paymentModeLabels.loan}</option>
                  </select>
                </Field>
                <Field label="Process decision">
                  <select value={allocationForm.decision} onChange={(e) => setAllocationForm({ ...allocationForm, decision: e.target.value })}>
                    <option value="process">Process ticket</option>
                    <option value="reject">Reject / hold ticket</option>
                  </select>
                </Field>
                <Field label="Loan tenure months"><input type="number" placeholder="Loan tenure" value={allocationForm.loanTenure} onChange={(e) => setAllocationForm({ ...allocationForm, loanTenure: e.target.value })} /></Field>
                <label className="switch-row"><input type="checkbox" checked={allocationForm.emergency} onChange={(e) => setAllocationForm({ ...allocationForm, emergency: e.target.checked })} /> Emergency ticket</label>
                <input placeholder="Remarks" value={allocationForm.remarks} onChange={(e) => setAllocationForm({ ...allocationForm, remarks: e.target.value })} />
                <Field label="Leave start"><input type="date" value={allocationForm.leaveStart} onChange={(e) => setAllocationForm({ ...allocationForm, leaveStart: e.target.value })} /></Field>
                <Field label="Leave end"><input type="date" value={allocationForm.leaveEnd} onChange={(e) => setAllocationForm({ ...allocationForm, leaveEnd: e.target.value })} /></Field>
                <Field label="Route / destination"><input placeholder="BAH - destination - BAH" value={allocationForm.route} onChange={(e) => setAllocationForm({ ...allocationForm, route: e.target.value })} /></Field>
                <Field label="Ticket number"><input placeholder="Ticket / PNR" value={allocationForm.ticketNo} onChange={(e) => setAllocationForm({ ...allocationForm, ticketNo: e.target.value })} /></Field>
                <Field label="Supplier"><input placeholder="Travel agent / airline" value={allocationForm.supplier} onChange={(e) => setAllocationForm({ ...allocationForm, supplier: e.target.value })} /></Field>
                <Field label="Invoice number"><input placeholder="Invoice / receipt no" value={allocationForm.invoiceNo} onChange={(e) => setAllocationForm({ ...allocationForm, invoiceNo: e.target.value })} /></Field>
                <Field label="Ticket / receipt attachment">
                  <input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" onChange={(event) => setAllocationFile(event.target.files?.[0] || null)} />
                </Field>
              </div>
              <div className="form-section-label">Amount breakdown - review values and choose settlement action</div>
              <div className={`smart-settlement ${entitlementFullyCoversTicket ? "smart-ok" : hasTicketExcess ? "smart-warning" : "smart-info"}`}>
                <strong>{smartSettlementRecommendation.title}</strong>
                <span>{smartSettlementRecommendation.detail}</span>
              </div>
              <div className="payment-options">
                <button type="button" className={`payment-card ${allocationForm.paymentMode === "entitlement" ? "active" : ""}`} disabled={settlementActionDisabled} onClick={() => setAllocationForm({ ...allocationForm, paymentMode: "entitlement" })}>
                  <small>Airfare entitlement amount</small>
                  <strong>{money.format(displayedEntitlementOptionAmount)}</strong>
                  <span>Use employee entitlement balance</span>
                </button>
                <button type="button" className={`payment-card ${allocationForm.paymentMode === "company_full" ? "active" : ""}`} disabled={settlementActionDisabled} onClick={() => setAllocationForm({ ...allocationForm, paymentMode: "company_full" })}>
                  <small>Full paid by company</small>
                  <strong>{money.format(fullCompanyPayAmount)}</strong>
                  <span>Approved exception: company pays ticket balance after entitlement</span>
                </button>
                <button type="button" className={`payment-card ${allocationForm.paymentMode === "employee" ? "active" : ""}`} disabled={settlementActionDisabled} onClick={() => setAllocationForm({ ...allocationForm, paymentMode: "employee" })}>
                  <small>Paid by self employee</small>
                  <strong>{money.format(displayedSelfPaidOptionAmount)}</strong>
                  <span>Employee pays excess</span>
                </button>
                <button type="button" className={`payment-card ${allocationForm.paymentMode === "employee_full" ? "active" : ""}`} disabled={fullSelfPayDisabled} onClick={() => setAllocationForm({ ...allocationForm, paymentMode: "employee_full" })}>
                  <small>Paid by self employee full</small>
                  <strong>{money.format(displayedFullSelfPaidOptionAmount)}</strong>
                  <span>Employee pays full ticket; entitlement remains for carry-forward</span>
                </button>
                <button type="button" className={`payment-card ${allocationForm.paymentMode === "loan" ? "active" : ""}`} disabled={settlementActionDisabled} onClick={() => setAllocationForm({ ...allocationForm, paymentMode: "loan" })}>
                  <small>Loan amount</small>
                  <strong>{money.format(displayedLoanOptionAmount)}</strong>
                  <span>Create loan for excess</span>
                </button>
              </div>
              {requiresManagerApproval && (
                <div className="eligibility-panel">
                  <div className="card-title"><ShieldCheck size={18} /> {requiresLoanManagerApproval ? "Loan manager approval" : "Duplicate-ticket review"}</div>
                  <div className="eligibility-grid">
                    <span><small>Previous ticket date</small><strong>{firstAllocationDate || "N/A"}</strong></span>
                    <span><small>Previous ticket route</small><strong>{firstAllocationRoute || "N/A"}</strong></span>
                    <span><small>Previous ticket no</small><strong>{firstAllocationTicketNo || "N/A"}</strong></span>
                    <span><small>Previous ticket amount</small><strong>{money.format(firstAllocationAmount)}</strong></span>
                    <span><small>Current year remaining</small><strong>{money.format(currentYearRemaining)}</strong></span>
                    <span><small>Total available funds</small><strong>{money.format(totalAvailableFunds)}</strong></span>
                  </div>
                  <div className="form-grid two">
                    <Field label="Override reason">
                      <textarea
                        rows={2}
                        value={allocationForm.overrideReason}
                        placeholder={requiresLoanManagerApproval ? "Enter loan reason or previous-loan note" : "Enter reason for duplicate-ticket processing"}
                        onChange={(event) => setAllocationForm({ ...allocationForm, overrideReason: event.target.value })}
                      />
                    </Field>
                    <Field label="Manager approval / reference">
                      <textarea
                        rows={2}
                        value={allocationForm.managerApproval}
                        placeholder="Enter manager approval note or reference code"
                        onChange={(event) => setAllocationForm({ ...allocationForm, managerApproval: event.target.value })}
                      />
                    </Field>
                  </div>
                  <p className="muted">Manager approval is mandatory for second tickets and all loan tickets. Override reason is optional supporting detail.</p>
                </div>
              )}
              <div className={`allocation-rule-card rule-${allocationRuleStatus.tone}`}>
                <div>
                  <strong>{allocationRuleStatus.title}</strong>
                  <p>{allocationRuleStatus.detail}</p>
                </div>
                <div className="rule-facts">
                  <span><small>Eligibility</small><strong>{money.format(selectedEntitlement)}</strong></span>
                  <span><small>Ticket excess</small><strong>{money.format(excessBalance)}</strong></span>
                  <span><small>Active loans</small><strong>{selectedEmployeeLoans.length}</strong></span>
                  <span><small>Outstanding</small><strong>{money.format(selectedLoanOutstanding)}</strong></span>
                </div>
                {selectedSeparateLoans.length > 0 && (
                  <p className="muted">Previous separate loan exists. Loan mode will create a new ticket-specific loan only after manager approval.</p>
                )}
                {selectedTicketLoans.length > 0 && (
                  <p className="muted">Existing loan for this specific ticket found. Updating allocation will refresh that linked ticket loan.</p>
                )}
              </div>
              <div className="automation-guardrail-card">
                <div className="card-title"><Bot size={18} /> AI automation guardrail</div>
                <p className="muted">Assistive checks only. These do not change airfare max payout rules or Airfare Payable report logic.</p>
                <div className="guardrail-grid">
                  {automationGuardrailChecks.map((check) => (
                    <div className={`guardrail-item guardrail-${check.tone}`} key={check.title}>
                      <span>{check.tone === "success" ? "Pass" : check.tone === "warning" ? "Review" : "Info"}</span>
                      <strong>{check.title}</strong>
                      <p>{check.detail}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="eligibility-panel">
                <div className="card-title"><ShieldCheck size={18} /> Employee airfare eligibility review</div>
                <div className="eligibility-grid">
                  <span><small>Employee</small><strong>{selectedEmployee ? `${selectedEmployee.EmployeeCode} - ${selectedEmployee.FullName}` : "Select employee"}</strong></span>
                  <span><small>Opening balance amount</small><strong>{money.format(selectedEmployee ? reviewOpeningAmount : 0)}</strong></span>
                  <span><small>Already paid amount</small><strong>{money.format(selectedEmployee ? reviewPaidAmount : 0)}</strong></span>
                  <span><small>Eligible balance days</small><strong>{selectedEmployee ? reviewClosingDays.toFixed(2) : "0.00"}</strong></span>
                  <span><small>Airfare entitlement amount</small><strong>{money.format(selectedEntitlement)}</strong></span>
                  <span><small>Current year entitlement basis</small><strong>{money.format(reviewEntitlementBasis)}</strong></span>
                  <span><small>Current year earned days</small><strong>{selectedEmployee ? Number(reviewCurrentYearDays || 0).toFixed(2) : "0.00"}</strong></span>
                  <span><small>Already paid days</small><strong>{selectedEmployee ? Number(reviewPaidDays || 0).toFixed(2) : "0.00"}</strong></span>
                  <span><small>Max payout / 60</small><strong>{money.format((selectedMaximumPayout || 150) / 60)} per day</strong></span>
                  <span><small>Max payout cap</small><strong>{money.format(selectedMaximumPayout)}</strong></span>
                  <span><small>Ticket cost</small><strong>{money.format(ticketCost)}</strong></span>
                  <span><small>Entitlement applied</small><strong>{money.format(entitlementAppliedAmount)}</strong></span>
                  <span><small>Balance amount company pay</small><strong>{money.format(companyBalancePayAmount)}</strong></span>
                  <span><small>Paid by self employee</small><strong>{money.format(selfPaidAmount)}</strong></span>
                  <span><small>Loan amount</small><strong>{money.format(loanExcessAmount)}</strong></span>
                </div>
            <p className="muted">Rule source: MSSQL calculates opening balance + current earned since last ticket or join date - already paid amount.</p>
              </div>
              <div className="calc-result amount-summary">
                <span><small>Airfare entitlement amount</small><strong>{money.format(selectedEntitlement)}</strong></span>
                <span><small>Company pays</small><strong>{money.format(displayedCompanySettlementAmount)}</strong></span>
                <span><small>Paid by self employee</small><strong>{money.format(selfPaidAmount)}</strong></span>
                <span><small>Loan amount</small><strong>{money.format(loanExcessAmount)}</strong></span>
              </div>
              {ticketCost > 0 && selectedEntitlement >= ticketCost && (
                <div className="toast-line inline-success">Suggestion: entitlement covers this ticket. No self payment or loan is required.</div>
              )}
              {excessBalance > 0 && allocationForm.paymentMode === "entitlement" && (
                <div className="toast-line inline-alert">On save, ATLAS will ask whether this excess should become a loan.</div>
              )}
              {allocationFile && <p className="muted">Attachment ready: {allocationFile.name} ({Math.ceil(allocationFile.size / 1024)} KB)</p>}
              {editingAllocationId && <p className="muted">Editing allocation #{editingAllocationId}. Updating will refresh the linked excess loan if payment mode is loan.</p>}
              <div className="allocation-whatsapp-card">
                <div className="whatsapp-panel-head">
                  <div>
                    <strong>Manager WhatsApp for airfare allocation</strong>
                    <span>Type manager WhatsApp number, create the A4 PDF/image approval format, then attach it in normal WhatsApp.</span>
                  </div>
                  <span className={`pill ${allocationWhatsAppReady ? "ok" : ""}`}>{allocationWhatsAppReady ? "Ready" : "Needs manager number"}</span>
                </div>
                <div className="whatsapp-grid allocation-whatsapp-grid">
                  <Field label="Manager WhatsApp">
                    <input
                      placeholder="973XXXXXXXX"
                      value={allocationWhatsAppForm.managerNumber}
                      onChange={(event) => setAllocationWhatsAppForm({ ...allocationWhatsAppForm, managerNumber: event.target.value })}
                    />
                  </Field>
                  <Field label="Subject">
                    <input
                      value={allocationWhatsAppForm.subject}
                      onChange={(event) => setAllocationWhatsAppForm({ ...allocationWhatsAppForm, subject: event.target.value })}
                    />
                  </Field>
                  <Field label="Approval note">
                    <input
                      placeholder="Short manager note"
                      value={allocationWhatsAppForm.note}
                      onChange={(event) => setAllocationWhatsAppForm({ ...allocationWhatsAppForm, note: event.target.value })}
                    />
                  </Field>
                </div>
                <div className="whatsapp-preview">
                  <label>Manager message preview</label>
                  <pre>{allocationWhatsAppMessageText}</pre>
                </div>
                <div className="button-row compact">
                  <button className="soft-button" type="button" disabled={!selectedEmployee} onClick={printAllocationManagerWhatsApp}><Printer size={16} /> PDF / print A4</button>
                  <button className="soft-button" type="button" disabled={!selectedEmployee} onClick={downloadAllocationManagerWhatsAppImage}><Download size={16} /> Download A4 image</button>
                  <button className="shine-button" type="button" disabled={!allocationWhatsAppReady} onClick={openAllocationManagerWhatsApp}>Open manager WhatsApp</button>
                </div>
              </div>
              <div className="button-row">
                <button className="shine-button" disabled={busy} onClick={handleCreateAllocation}>{editingAllocationId ? "Update, upload and print" : "Save, upload and print"}</button>
                {editingAllocationId && <button className="soft-button" disabled={busy} onClick={cancelAllocationEdit}>Cancel edit</button>}
                <button className="soft-button" disabled={!selectedEmployee} onClick={() => selectedEmployee && printAllocationLetter(selectedEmployee, null, {
                  ticketCost,
                  entitlement: selectedEntitlement,
                  companyPaid,
                  entitlementApplied: entitlementAppliedAmount,
                  balanceAmount: excessBalance,
                  companyBalancePayAmount,
                  excess: excessAmount,
                  paymentMode: allocationForm.paymentMode,
                  loanAmount: loanExcessAmount,
                  employeePaid: selfPaidAmount,
                  emi: suggestedEmi,
                  tenure: Number(allocationForm.loanTenure) || 0,
                  date: allocationForm.date,
                  year: Number(allocationForm.year),
                  companyName: activeCompany?.CompanyName || "ATLAS",
                  companyCode: activeCompany?.CompanyCode || "Airfare HCM",
                  companyAddress: activeCompany?.Address || "",
                  companyPhone: activeCompany?.Phone || "",
                  companyEmail: activeCompany?.Email || "",
                  companyTrn: activeCompany?.TRN || "",
                  companyLogoUrl,
                  remarks: allocationForm.remarks
                })}><Printer size={16} /> Preview print</button>
              </div>
            </div>
            {recentAllocationsOpen && (
            <div className="glass-panel table-card recent-allocations-panel">
              <div className="card-title">
                <span>Recent allocations</span>
                <button className="mini-soft" type="button" onClick={() => setRecentAllocationsOpen(false)}><X size={16} /> Close</button>
              </div>
              <div className="stack-list">
                {filteredAllocations.length === 0 && <p className="muted">No allocations found for this year/search.</p>}
                {filteredAllocations.map((allocation) => (
                  <div className="notice recent-allocation-card" key={allocation.AllocationID}>
                    <span />
                    <div>
                      <div className="recent-allocation-head">
                        <strong>{allocation.EmployeeCode} - {allocation.FullName}</strong>
                        <small>{formatPaymentModeLabel(allocation.PaymentMode)}</small>
                      </div>
                      <div className="document-chip-row">
                        <span>Document No.</span>
                        <strong>AF-{allocation.AllocationID}</strong>
                        <span>Date</span>
                        <strong>{formatExportDate(allocation.AllocationDate)}</strong>
                      </div>
                      <div className="recent-allocation-breakdown">
                        {buildAllocationSettlementRows(allocation).map((row) => (
                          <span key={`${allocation.AllocationID}-${row.label}`}>
                            <small>{row.label}</small>
                            <strong>{money.format(row.value)}</strong>
                          </span>
                        ))}
                      </div>
                      <div className="attachment-row">
                        {(allocationAttachments[allocation.AllocationID] || []).length === 0 && <small>No attachment</small>}
                        {(allocationAttachments[allocation.AllocationID] || []).map((attachment) => (
                          <button className="mini-soft" key={attachment.AttachmentID} onClick={() => viewAllocationAttachment(attachment)}>View {attachment.MimeType.includes("pdf") ? "PDF" : "Image"}</button>
                        ))}
                        <button className="mini-soft" disabled={busy} onClick={() => handleEditAllocation(allocation)}>Edit</button>
                        <button className="mini-danger" disabled={busy} onClick={() => handleDeleteAllocation(allocation)}><Trash2 size={14} /> Delete</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            )}
          </section>
        )}

        {activeView === "Employee Self-Service" && (
          <section className="self-service-grid">
            <div className="glass-panel self-service-summary-panel">
              <div className="card-title"><ClipboardCheck size={18} /> Employee Self-Service</div>
              {canSelectSelfServiceEmployee && !selfServiceSummary?.setupRequired ? (
                <div className="self-service-employee-picker">
                  <label>
                    Request for employee
                    <select value={activeSelfServiceEmployeeId} onChange={(event) => changeSelfServiceEmployee(event.target.value)}>
                      {selfServiceEmployees.map((employee) => (
                        <option key={employee.EmployeeID} value={employee.EmployeeID}>
                          {employee.EmployeeCode} - {employee.FullName}
                        </option>
                      ))}
                    </select>
                  </label>
                  <small>Admin, manager, and HR users can prepare or review requests for selected employees.</small>
                </div>
              ) : null}
              {selfServiceSummary?.setupRequired ? (
                <div className="notice notice-warning">
                  <span />
                  <div>
                    <strong>Employee mapping required</strong>
                    <p>{selfServiceSummary.message || "Ask admin to map this login to an employee profile."}</p>
                  </div>
                </div>
              ) : (
                <div className="summary-focus-row compact">
                  <span><small>Employee</small><strong>{selfServiceSummary?.employee?.FullName || session.user.fullName || session.user.username}</strong></span>
                  <span><small>Entitlement</small><strong>{money.format(Number(selfServiceSummary?.entitlement?.AirfareEntitlementAmount || 0))}</strong></span>
                  <span><small>Payable</small><strong>{money.format(Number(selfServiceSummary?.entitlement?.PayableBHD || 0))}</strong></span>
                  <span><small>Open requests</small><strong>{selfServiceSummary?.openRequests ?? selfServiceRequests.length}</strong></span>
                </div>
              )}
            </div>

            <div className="glass-panel table-card">
              <div className="card-title"><Plane size={18} /> My Airfare Requests</div>
              <div className="responsive-table">
                <table>
                  <thead>
                    <tr>
                      <th>Request</th>
                      <th>Travel</th>
                      <th>Destination</th>
                      <th>Cost</th>
                      <th>Payable</th>
                      <th>Loan overflow</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selfServiceRequests.map((request) => (
                      <tr key={request.RequestID}>
                        <td>{request.RequestNo}</td>
                        <td>{String(request.TravelFromDate || "").slice(0, 10)}</td>
                        <td>{request.Destination}</td>
                        <td>{money.format(Number(request.EstimatedCostBHD || 0))}</td>
                        <td>{money.format(Number(request.PayableAtRequestBHD || 0))}</td>
                        <td>{money.format(Number(request.OverageToLoanBHD || 0))}</td>
                        <td><span className="status-pill">{request.ApprovalStatus}</span></td>
                        <td>
                          <div className="button-row compact request-actions">
                            {request.LinkedAllocationID ? (
                              <button className="mini-soft" type="button" disabled={busy} onClick={() => openSelfServiceAllocation(request.LinkedAllocationID)}>Open allocation</button>
                            ) : null}
                            {request.ApprovalStatus === "Draft" ? (
                              <button className="mini-soft" type="button" disabled={busy} onClick={() => transitionSelfServiceRequest(request.RequestID, "Submitted")}>Submit</button>
                            ) : null}
                            {request.ApprovalStatus === "Submitted" && ["admin", "manager", "hr"].includes(session.user.role) ? (
                              <button className="mini-soft" type="button" disabled={busy} onClick={() => transitionSelfServiceRequest(request.RequestID, "ManagerApproved")}>Approve</button>
                            ) : null}
                            {["Submitted", "ManagerApproved", "HRApproved"].includes(request.ApprovalStatus) && ["admin", "manager", "hr"].includes(session.user.role) ? (
                              <button className="mini-danger" type="button" disabled={busy} onClick={() => transitionSelfServiceRequest(request.RequestID, "Rejected")}>Reject</button>
                            ) : null}
                            {!["Cancelled", "Issued", "Rejected", "ManagerApproved", "HRApproved", "FinanceApproved"].includes(request.ApprovalStatus) ? (
                              <button className="mini-soft" type="button" disabled={busy} onClick={() => transitionSelfServiceRequest(request.RequestID, "Cancelled")}>Cancel</button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {selfServiceRequests.length === 0 && (
                      <tr><td colSpan={8}>No self-service airfare requests found.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="glass-panel form-card">
              <div className="card-title"><ClipboardCheck size={18} /> New Ticket Request</div>
              {selfServiceSummary?.setupRequired ? (
                <p className="muted">Request entry is available after this login is mapped to an employee profile.</p>
              ) : (
                <>
                  <form className="form-grid" onSubmit={submitSelfServiceRequest}>
                    <label>Travel date <input type="date" value={selfServiceForm.travelFromDate} onChange={(event) => setSelfServiceForm({ ...selfServiceForm, travelFromDate: event.target.value })} required /></label>
                    {canSelectSelfServiceEmployee ? (
                      <label>Employee
                        <select value={activeSelfServiceEmployeeId} onChange={(event) => changeSelfServiceEmployee(event.target.value)} required>
                          {selfServiceEmployees.map((employee) => (
                            <option key={employee.EmployeeID} value={employee.EmployeeID}>
                              {employee.EmployeeCode} - {employee.FullName}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                    <label>Return date <input type="date" value={selfServiceForm.travelToDate} onChange={(event) => setSelfServiceForm({ ...selfServiceForm, travelToDate: event.target.value })} /></label>
                    <label>From <input value={selfServiceForm.origin} onChange={(event) => setSelfServiceForm({ ...selfServiceForm, origin: event.target.value })} /></label>
                    <label>Destination <input value={selfServiceForm.destination} onChange={(event) => setSelfServiceForm({ ...selfServiceForm, destination: event.target.value })} required /></label>
                    <label>Trip type
                      <select value={selfServiceForm.tripType} onChange={(event) => setSelfServiceForm({ ...selfServiceForm, tripType: event.target.value })}>
                        <option value="RoundTrip">Round trip</option>
                        <option value="OneWay">One way</option>
                        <option value="MultiCity">Multi city</option>
                      </select>
                    </label>
                    <label>Class
                      <select value={selfServiceForm.cabinClass} onChange={(event) => setSelfServiceForm({ ...selfServiceForm, cabinClass: event.target.value })}>
                        <option value="Economy">Economy</option>
                        <option value="PremiumEconomy">Premium economy</option>
                        <option value="Business">Business</option>
                        <option value="First">First</option>
                      </select>
                    </label>
                    <label>Estimated cost BHD <input type="number" min="0" step="0.01" value={selfServiceForm.estimatedCostBHD} onChange={(event) => setSelfServiceForm({ ...selfServiceForm, estimatedCostBHD: event.target.value })} required /></label>
                    <label>Preferred airline <input value={selfServiceForm.preferredAirline} onChange={(event) => setSelfServiceForm({ ...selfServiceForm, preferredAirline: event.target.value })} /></label>
                    <label className="span-2">Purpose <textarea value={selfServiceForm.purpose} onChange={(event) => setSelfServiceForm({ ...selfServiceForm, purpose: event.target.value })} /></label>
                    <button className="shine-button" type="submit" disabled={busy}>Submit request</button>
                    <button className="secondary-button" type="button" disabled={busy} onClick={() => reloadSelfService()}>Refresh</button>
                  </form>
                </>
              )}
            </div>
          </section>
        )}

        {activeView === "Loans" && (
          <>
            <section className="loan-metrics">
              <Metric title="Active Loans" value={String(loanSummary?.ActiveLoans ?? loans.filter((loan) => loan.Status === "active").length)} icon={<WalletCards />} tone="blue" />
              <Metric title="Outstanding" value={money.format(loanSummary?.TotalOutstanding ?? 0)} icon={<CreditCard />} tone="rose" />
              <Metric title="Monthly EMI" value={money.format(loanSummary?.MonthlyDeduction ?? 0)} icon={<CalendarClock />} tone="cyan" />
              <Metric title="Recovered" value={money.format(loanSummary?.TotalRecovered ?? 0)} icon={<TrendingUp />} tone="violet" />
            </section>
            <section className="table-grid">
              <div className="glass-panel table-card">
                <div className="card-title"><WalletCards size={18} /> Loan Register</div>
                <div className="button-row compact">
                  <select className="compact-select" value={loanStatusFilter} onChange={(event) => {
                    setLoanStatusFilter(event.target.value);
                    setMonthlyEmiRunPreview(null);
                    setMonthlyEmiReturnPreview(null);
                  }}>
                    <option value="">All loans</option>
                    <option value="active">Active</option>
                    <option value="deferred">Deferred</option>
                    <option value="settled">Settled</option>
                  </select>
                  <button className="soft-button" disabled={busy} onClick={handleExportLoans}><Download size={16} /> Export Loans</button>
                  <button className="soft-button" disabled={busy} onClick={handlePreviewSelectedEmis}><Eye size={16} /> Run selected EMI preview</button>
                  <button className="shine-button" disabled={busy || !monthlyEmiRunPreview || monthlyEmiRunPreview.processed === 0} onClick={handleRunSelectedEmis}>Process preview</button>
                  <button className="soft-button" disabled={busy || selectedLoanIds.length === 0} onClick={handlePreviewReturnSelectedEmis}>Preview return EMI</button>
                  <button className="danger-button" disabled={busy || !monthlyEmiReturnPreview || monthlyEmiReturnPreview.reversible === 0} onClick={handleReturnSelectedEmis}>Process return</button>
                  <button className="soft-button" disabled={busy} onClick={() => {
                    const activeIds = filteredLoans.filter((loan) => loan.Status === "active").map((loan) => Number(loan.LoanID));
                    setMonthlyEmiRunPreview(null);
                    setMonthlyEmiReturnPreview(null);
                    setSelectedLoanIds(selectedLoanIds.length === activeIds.length ? [] : activeIds);
                  }}>{selectedLoanIds.length ? "Clear selection" : "Select active"}</button>
                </div>
                <div className="loan-action-panel">
                  <div className="loan-action-copy">
                    <strong>Loan action controls</strong>
                    <p>Use selected EMI run for controlled monthly deductions. Defer, settle, and restructure write loan history and require confirmation.</p>
                  </div>
                  <div className="loan-action-fields">
                    <Field label="Action date">
                      <input type="date" value={loanOpsForm.actionDate} onChange={(event) => {
                        setLoanOpsForm({ ...loanOpsForm, actionDate: event.target.value });
                        setMonthlyEmiRunPreview(null);
                        setMonthlyEmiReturnPreview(null);
                      }} />
                    </Field>
                    <Field label="Deferment months">
                      <input type="number" min="1" max="24" placeholder="1" value={loanOpsForm.deferMonths} onChange={(event) => setLoanOpsForm({ ...loanOpsForm, deferMonths: event.target.value })} />
                    </Field>
                    <Field label="New monthly EMI">
                      <input type="number" step="0.01" placeholder="Optional" value={loanOpsForm.newEmi} onChange={(event) => setLoanOpsForm({ ...loanOpsForm, newEmi: event.target.value })} />
                    </Field>
                    <Field label="New remaining months">
                      <input type="number" min="1" max="240" placeholder="Optional" value={loanOpsForm.newTenureMonths} onChange={(event) => setLoanOpsForm({ ...loanOpsForm, newTenureMonths: event.target.value })} />
                    </Field>
                    <Field label="Manager approval / note">
                      <input placeholder="Approval note / reference" value={loanOpsForm.note} onChange={(event) => setLoanOpsForm({ ...loanOpsForm, note: event.target.value })} />
                    </Field>
                  </div>
                </div>
                {monthlyEmiRunPreview && (
                  <div className="emi-preview-panel" role="region" aria-label="Monthly EMI preview">
                    <div className="emi-preview-head">
                      <div>
                        <strong>Monthly EMI preview</strong>
                        <span>{monthlyEmiRunPreview.processed} loan(s) selected for {formatExportDate(String(monthlyEmiRunPreview.paymentDate || loanOpsForm.actionDate))}</span>
                      </div>
                      <button className="mini-soft" disabled={busy} onClick={() => setMonthlyEmiRunPreview(null)}>Clear preview</button>
                    </div>
                    <div className="emi-preview-summary">
                      <span><small>Total deduction</small><strong>{money.format(monthlyEmiRunPreview.totalDeducted || 0)}</strong></span>
                      <span><small>Selected loans</small><strong>{monthlyEmiRunPreview.processed}</strong></span>
                      <span><small>Payment date</small><strong>{formatExportDate(String(monthlyEmiRunPreview.paymentDate || loanOpsForm.actionDate))}</strong></span>
                    </div>
                    <div className="preview-grid emi-preview-grid">
                      <div className="preview-row emi-preview-row emi-preview-row-head"><span>Employee</span><span>Outstanding</span><span>EMI deduction</span><span>After payment</span></div>
                      {monthlyEmiRunPreview.rows.length === 0 && <p className="muted">No active loan is ready for this EMI run.</p>}
                      {monthlyEmiRunPreview.rows.map((row) => (
                        <div className="preview-row emi-preview-row" key={row.LoanID}>
                          <span><strong>{row.FullName}</strong><small>{row.EmployeeCode} / Loan #{row.LoanID}</small></span>
                          <span><strong>{money.format(row.RemainingBalance || 0)}</strong></span>
                          <span><strong>{money.format(row.NextDeduction || row.EMI || 0)}</strong><small>Regular EMI {money.format(row.EMI || 0)}</small></span>
                          <span><strong>{money.format(row.BalanceAfter || 0)}</strong></span>
                        </div>
                      ))}
                    </div>
                    <div className="button-row compact">
                      <button className="shine-button" disabled={busy || monthlyEmiRunPreview.processed === 0} onClick={handleRunSelectedEmis}>Process selected loan EMI</button>
                    </div>
                  </div>
                )}
                {monthlyEmiReturnPreview && (
                  <div className="emi-preview-panel emi-return-panel" role="region" aria-label="Monthly EMI return preview">
                    <div className="emi-preview-head">
                      <div>
                        <strong>Return EMI preview</strong>
                        <span>{monthlyEmiReturnPreview.reversible} of {monthlyEmiReturnPreview.selected} selected loan(s) can be returned on {formatExportDate(loanOpsForm.actionDate)}</span>
                      </div>
                      <button className="mini-soft" disabled={busy} onClick={() => setMonthlyEmiReturnPreview(null)}>Clear preview</button>
                    </div>
                    <div className="emi-preview-summary">
                      <span><small>Total return</small><strong>{money.format(monthlyEmiReturnPreview.totalReturned || 0)}</strong></span>
                      <span><small>Ready</small><strong>{monthlyEmiReturnPreview.reversible}</strong></span>
                      <span><small>Selected</small><strong>{monthlyEmiReturnPreview.selected}</strong></span>
                    </div>
                    <div className="preview-grid emi-preview-grid">
                      <div className="preview-row emi-preview-row emi-preview-row-head"><span>Employee</span><span>Last EMI</span><span>Return amount</span><span>After return</span></div>
                      {monthlyEmiReturnPreview.rows.map((row) => (
                        <div className={`preview-row emi-preview-row ${row.ReturnStatus === "Ready" ? "" : "emi-return-blocked"}`} key={`return-${row.LoanID}`}>
                          <span><strong>{row.FullName}</strong><small>{row.EmployeeCode} / Loan #{row.LoanID}</small></span>
                          <span><strong>{row.PaymentDate ? formatExportDate(row.PaymentDate) : "-"}</strong><small>{row.ReturnStatus}</small></span>
                          <span><strong>{money.format(row.AmountToReturn || 0)}</strong><small>History #{row.HistoryID || "-"}</small></span>
                          <span><strong>{money.format(row.BalanceAfterReturn || row.RemainingBalance || 0)}</strong><small>Total paid after {money.format(row.TotalPaidAfterReturn || 0)}</small></span>
                        </div>
                      ))}
                    </div>
                    <div className="button-row compact">
                      <button className="danger-button" disabled={busy || monthlyEmiReturnPreview.reversible === 0} onClick={handleReturnSelectedEmis}>Process selected EMI return</button>
                    </div>
                  </div>
                )}
                <div className="premium-table">
                  <div className="table-row loan-head"><span>Employee</span><span>Loan</span><span>Progress</span><span>EMI</span><span>Action</span></div>
                  {filteredLoans.length === 0 && <p className="muted">No loans found for this filter.</p>}
                  {filteredLoans.map((loan) => (
                    <div className="table-row loan-head" key={loan.LoanID}>
                      <span>
                        <label className="checkbox-line">
                          <input type="checkbox" checked={selectedLoanIds.includes(Number(loan.LoanID))} disabled={loan.Status !== "active"} onChange={() => toggleSelectedLoan(Number(loan.LoanID))} />
                          <strong>{loan.FullName}</strong>
                        </label>
                        <small>{loan.EmployeeCode} / {loan.Department || "-"}</small>
                      </span>
                      <span><strong>{money.format(loan.RemainingBalance || 0)}</strong><small>Original {money.format(loan.OriginalAmount || 0)}</small></span>
                      <span><strong>{loan.MonthsPaid || 0}/{loan.Tenure || 0} months</strong><small>{Number(loan.PaidPercent || 0).toFixed(0)}% paid / {loan.MonthsLeft ?? 0} left</small></span>
                      <span><strong>{money.format(loan.EMI || 0)}</strong><small>{loan.Status}{loan.Status === "deferred" && loan.DeferMonths ? ` / ${loan.DeferMonths} mo.` : ""}</small></span>
                      <span className="row-actions">
                        <button className="mini-soft" disabled={loan.Status === "settled" || busy} onClick={() => handleEditLoan(loan)}>Edit</button>
                        <button className="mini-soft" disabled={loan.Status === "settled" || busy} onClick={() => handleRestructureLoan(loan)}>Restructure</button>
                        <button className="mini-soft" disabled={loan.Status !== "active" || busy} onClick={() => handleDeferLoan(loan)}>Defer</button>
                        <button className="mini-soft" disabled={loan.Status === "settled" || busy} onClick={() => handleSettleLoan(loan)}>Settle</button>
                        <button className="mini-danger" disabled={busy} onClick={() => handleDeleteLoan(loan)}><Trash2 size={14} /></button>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="glass-panel form-card">
                <div className="card-title"><Plus size={18} /> {editingLoanId ? "Edit Employee Loan" : "Create Employee Loan"}</div>
                <div className="form-grid one">
                  <select value={loanForm.employeeId} onChange={(event) => setLoanForm({ ...loanForm, employeeId: event.target.value })}>
                    <option value="">Select employee</option>
                    {employees.map((employee) => <option key={employee.EmployeeID} value={employee.EmployeeID}>{employee.EmployeeCode} - {employee.FullName}</option>)}
                  </select>
                  <input type="number" step="0.01" placeholder="Loan amount" value={loanForm.amount} onChange={(event) => setLoanForm({ ...loanForm, amount: event.target.value })} />
                  <input type="number" min="1" max="240" step="1" placeholder="EMI months" value={loanForm.tenure} onChange={(event) => setLoanForm({ ...loanForm, tenure: event.target.value })} />
                  <input type="date" value={loanForm.date} onChange={(event) => setLoanForm({ ...loanForm, date: event.target.value })} />
                  <input placeholder="Reason / note" value={loanForm.note} onChange={(event) => setLoanForm({ ...loanForm, note: event.target.value })} />
                </div>
                <div className="calc-result loan-preview">
                  <span><small>Employee</small><strong>{selectedLoanEmployee?.EmployeeCode || "-"}</strong></span>
                  <span><small>Monthly EMI</small><strong>{money.format(loanEmiPreview || 0)}</strong></span>
                  <span><small>Close In</small><strong>{loanTenure} mo.</strong></span>
                </div>
                <div className="button-row">
                  <button className="shine-button" disabled={busy} onClick={handleCreateLoan}>{editingLoanId ? "Update loan" : "Create loan"}</button>
                  {editingLoanId && <button className="soft-button" disabled={busy} onClick={cancelLoanEdit}>Cancel edit</button>}
                  <button className="danger-button" disabled={busy} onClick={handleSettleAllLoans}>Settle all</button>
                </div>
                <p className="muted">Airfare excess loans are still created automatically from Airfare Allocation. Use this form for manual employee loans or opening loan entries.</p>
              </div>
            </section>
          </>
        )}

        {activeView === "Year End" && (
          <section className="table-grid">
            <div className="glass-panel table-card">
              <div className="card-title"><CalendarClock size={18} /> Year End Process</div>
              <div className="metric-strip">
                <span><small>Close year</small><strong>{yearEndForm.year}</strong></span>
                <span><small>New opening year</small><strong>{Number(yearEndForm.year || new Date().getFullYear()) + 1}</strong></span>
                <span><small>Employees to carry</small><strong>{yearEndPreview?.balancesCarried ?? "-"}</strong></span>
                <span><small>Closing days</small><strong>{yearEndPreview ? Number(yearEndPreview.totalClosingDays || 0).toFixed(2) : "-"}</strong></span>
                <span><small>Closing amount</small><strong>{money.format(yearEndPreview?.totalOpeningBalance ?? 0)}</strong></span>
                <span><small>Pending loans</small><strong>{yearEndPreview ? `${yearEndPreview.pendingLoanCount || 0} / ${money.format(yearEndPreview.pendingLoanAmount || 0)}` : "-"}</strong></span>
              </div>
              <div className="premium-table">
                <div className="table-row employee-head"><span>Control</span><span>Value</span><span>Status</span><span>Action</span></div>
                <div className="table-row employee-head">
                  <span><strong>Preview close</strong><small>Calculate balances before writing data.</small></span>
                  <span>{yearEndForm.year} to {Number(yearEndForm.year || new Date().getFullYear()) + 1}</span>
                  <span className="pill">{yearEndPreview ? "Preview Ready" : "Not Previewed"}</span>
                  <span className="row-actions"><button className="mini-soft" disabled={busy || session?.user.role !== "admin"} onClick={handleYearEndPreview}>Run preview</button></span>
                </div>
                <div className="table-row employee-head">
                  <span><strong>Final close</strong><small>Create next year opening balances and audit history.</small></span>
                  <span>{yearEndPreview ? `${yearEndPreview.balancesCarried} employee(s)` : "Preview required"}</span>
                  <span className="pill">{yearEndPreview?.yearEndId ? "Closed" : "Pending"}</span>
                  <span className="row-actions"><button className="danger-button" disabled={busy || session?.user.role !== "admin" || !yearEndPreview} onClick={handleYearEndClose}>Close year</button></span>
                </div>
              </div>
              <div className="readiness-panel">
                <div className="card-title"><ShieldCheck size={18} /> Year End readiness gate</div>
                <div className="readiness-grid">
                  {yearEndReadinessChecks.map((check) => (
                    <div className={`notice notice-${check.tone}`} key={check.title}>
                      <span />
                      <div>
                        <strong>{check.title}</strong>
                        <p>{check.detail}</p>
                        <small>{check.status}</small>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              {yearEndPreview && (
                <div className="preview-grid">
                  <div className="preview-row year-end-head"><span>Employee</span><span>Opening</span><span>Earned</span><span>Paid/Used</span><span>Closing</span><span>Pending loans</span><span>Status</span></div>
                  {(yearEndPreview.employees || []).slice(0, 12).map((row) => (
                    <div className="preview-row year-end-head" key={row.EmployeeID}>
                      <span>{row.EmployeeCode} - {row.FullName}</span>
                      <span><strong>{Number(row.OpeningDays || 0).toFixed(2)} days</strong><small>{money.format(row.OpeningBHD || 0)}</small></span>
                      <span><strong>{Number(row.CurrentYearEarnedDays || 0).toFixed(2)} days</strong><small>{money.format(row.CurrentYearEarnedBHD || 0)}</small></span>
                      <span><strong>{Number(row.PaidDays || 0).toFixed(2)} days</strong><small>{money.format(row.PaidAmount || 0)}</small></span>
                      <span><strong>{Number(row.ClosingDays || 0).toFixed(2)} days</strong><small>{money.format(row.ClosingBHD || 0)}</small></span>
                      <span><strong>{row.PendingLoanCount || 0}</strong><small>{money.format(row.PendingLoanAmount || 0)} / EMI {money.format(row.PendingMonthlyEMI || 0)}</small></span>
                      <span className={row.PendingLoanCount ? "pill danger-pill" : "pill"}>{row.CloseStatus || "Ready for close"}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="glass-panel form-card">
              <div className="card-title"><ShieldCheck size={18} /> Closing setup</div>
              <div className="form-grid one">
                <Field label="Year to close"><input type="number" value={yearEndForm.year} onChange={(event) => {
                  const year = event.target.value;
                  setYearEndForm({ ...yearEndForm, year, closingDate: year ? `${year}-12-31` : yearEndForm.closingDate });
                  setYearEndPreview(null);
                }} /></Field>
                <Field label="Closing date"><input type="date" value={yearEndForm.closingDate} onChange={(event) => {
                  setYearEndForm({ ...yearEndForm, closingDate: event.target.value });
                  setYearEndPreview(null);
                }} /></Field>
                <Field label="Employee scope">
                  <select value={yearEndForm.employeeId} onChange={(event) => {
                    setYearEndForm({ ...yearEndForm, employeeId: event.target.value });
                    setYearEndPreview(null);
                  }}>
                    <option value="">All employees</option>
                    {employees.map((employee) => <option key={employee.EmployeeID} value={employee.EmployeeID}>{employee.EmployeeCode} - {employee.FullName}</option>)}
                  </select>
                </Field>
                <Field label="Remarks"><input placeholder="Closing remarks" value={yearEndForm.remarks} onChange={(event) => setYearEndForm({ ...yearEndForm, remarks: event.target.value })} /></Field>
              </div>
              <div className="button-row">
                <button className="shine-button" disabled={busy || session?.user.role !== "admin"} onClick={handleYearEndPreview}>Preview year end</button>
                <button className="soft-button" disabled={!yearEndPreview} onClick={printCurrentScreen}><Printer size={16} /> Print preview</button>
              </div>
              <p className="muted">Year End carries closing balance into next year as opening balance. Always preview first, then close after checking employee balances.</p>
            </div>
          </section>
        )}

        {activeView === "Reports" && (
          <section className={`reports-workspace ${reportChecksCollapsed ? "checks-collapsed" : ""}`}>
            <div className="glass-panel table-card">
              <div className="card-title"><FileDown size={18} /> Report viewer</div>
              <div className="report-tabs">
                {reportOptions.map((report) => (
                  <button
                    className={reportForm.type === report.value ? "report-tab active" : "report-tab"}
                    key={report.value}
                    onClick={() => setReportForm({ ...reportForm, type: report.value })}
                  >
                    {report.label}
                  </button>
                ))}
              </div>
              <div className="report-controls">
                <Field label="Report">
                  <select value={reportForm.type} onChange={(event) => setReportForm({ ...reportForm, type: event.target.value })}>
                    {reportOptions.map((report) => <option value={report.value} key={report.value}>{report.label}</option>)}
                  </select>
                </Field>
                <Field label="From date">
                  <input type="date" value={reportForm.from} onChange={(event) => setReportForm({ ...reportForm, from: event.target.value })} />
                </Field>
                <Field label="To date">
                  <input type="date" value={reportForm.to} onChange={(event) => setReportForm({ ...reportForm, to: event.target.value })} />
                </Field>
                <Field label="Screen density">
                  <select value={reportDensity} onChange={(event) => setReportDensity(event.target.value as "comfortable" | "standard" | "compact")}>
                    <option value="comfortable">Comfortable</option>
                    <option value="standard">Standard</option>
                    <option value="compact">Compact</option>
                  </select>
                </Field>
                <Field label="Table width">
                  <select value={reportFitMode} onChange={(event) => setReportFitMode(event.target.value as "wide" | "fit")}>
                    <option value="wide">Wide scroll</option>
                    <option value="fit">Fit screen</option>
                  </select>
                </Field>
                <div className="button-row report-actions">
                  <button className="soft-button" disabled={busy || displayedReport.rows.length === 0} onClick={exportDisplayedReport}><Download size={16} /> Download Excel</button>
                  <button className="soft-button" disabled={busy || displayedReport.rows.length === 0} onClick={printDisplayedReport}><Printer size={16} /> PDF / Print</button>
                </div>
              </div>
              <div className="report-preview-head">
                <div>
                  <strong>{displayedReport.title}</strong>
                  <span>{reportForm.from || "Start"} to {reportForm.to || "Today"} • {displayedReport.rows.length} row(s)</span>
                </div>
              </div>
              <div className={`report-view-table report-density-${reportDensity} report-fit-${reportFitMode}`}>
                <table>
                  <thead>
                    <tr>
                      {displayedReport.columns.map((column) => <th key={column}>{column}</th>)}
                      {displayedReport.rows.some(isReportRowDrillable) && <th>Action</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {displayedReport.rows.length === 0 && (
                      <tr><td colSpan={displayedReport.columns.length + (displayedReport.rows.some(isReportRowDrillable) ? 1 : 0)}>No report rows found for this selection.</td></tr>
                    )}
                    {displayedReport.rows.map((row, index) => (
                      <tr
                        key={`${displayedReport.title}-${index}`}
                        className={isReportRowDrillable(row) ? "report-drill-row" : ""}
                        onClick={() => isReportRowDrillable(row) && void handleReportDrillDown(row)}
                        title={isReportRowDrillable(row) ? `Open ${getReportRecordTypeLabel(row.__recordType)} record ${String(row.__recordId)}` : ""}
                      >
                        {displayedReport.columns.map((column) => <td key={column}>{String(row[column] ?? "")}</td>)}
                        {displayedReport.rows.some(isReportRowDrillable) && (
                          <td>
                            {isReportRowDrillable(row) ? (
                              <button
                                className="mini-soft"
                                type="button"
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  void handleReportDrillDown(row);
                                }}
                              >
                                <Eye size={14} /> View
                              </button>
                            ) : <span className="muted">-</span>}
                          </td>
                        )}
                      </tr>
                    ))}
                    {displayedReportTotalRows.map((row, index) => (
                      <tr
                        key={`${displayedReport.title}-total-${index}`}
                        className={row.__rowKind === "grand-total" ? "report-grand-total-row" : "report-subtotal-row"}
                      >
                        {displayedReport.columns.map((column) => <td key={column}>{String(row[column] ?? "")}</td>)}
                        {displayedReport.rows.some(isReportRowDrillable) && <td><span className="muted">-</span></td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className={`glass-panel hcm-card report-check-panel ${reportChecksCollapsed ? "collapsed" : ""}`}>
              <div className="card-title">
                <span><Bot size={18} /> Report checks</span>
                <button
                  className="mini-soft"
                  type="button"
                  onClick={() => setReportChecksCollapsed((current) => !current)}
                >
                  {reportChecksCollapsed ? "Show" : "Hide"}
                </button>
              </div>
              {!reportChecksCollapsed && (
                <>
                  <h3>{displayedReport.rows.length} row(s) displayed</h3>
                  <p>Select report and date range first. The screen, Excel, and print output include matching subtotals and grand totals from the same visible report rows.</p>
                  <div className="calc-result">
                    <span><small>Subtotals</small><strong>{displayedReportTotalRows.filter((row) => row.__rowKind === "subtotal").length}</strong></span>
                    <span><small>Grand total</small><strong>{displayedReportTotalRows.some((row) => row.__rowKind === "grand-total") ? "Ready" : "N/A"}</strong></span>
                  </div>
                  <div className="button-row">
                    <button className="soft-button" disabled={busy || !session} onClick={handleExportSqlEmployeeReport}><Database size={16} /> SQL Employee Report</button>
                  </div>
                </>
              )}
            </div>
          </section>
        )}

        {activeView === "Companies" && (
          <section className="table-grid">
            <div className="glass-panel table-card">
              <div className="card-title"><Building2 size={18} /> Companies and databases</div>
              <div className="premium-table">
                <div className="table-row loan-head"><span>Company</span><span>Database</span><span>Contact</span><span>Status</span><span>Action</span></div>
                {filteredCompanies.length === 0 && <p className="muted">No companies found.</p>}
                {filteredCompanies.map((company) => (
                  <div className="table-row loan-head" key={company.CompanyID}>
                    <span><strong>{company.CompanyName}</strong><small>{company.CompanyCode}{String(company.CompanyID) === selectedCompanyId ? " / selected" : ""}</small></span>
                    <span><strong>{company.DatabaseName}</strong><small>{company.LogoSize ? `${Math.ceil(company.LogoSize / 1024)} KB logo` : "No logo"}</small></span>
                    <span><strong>{company.ContactPerson || "-"}</strong><small>{company.Email || company.Phone || "-"}</small></span>
                    <span><strong>{company.IsActive ? "Active" : "Inactive"}</strong><small>{company.TRN || "-"}</small></span>
                    <span className="row-actions">
                      <button className="mini-soft" onClick={() => handleCompanySwitch(String(company.CompanyID))}>Select</button>
                      <button className="mini-soft" onClick={() => editCompany(company)}>Edit</button>
                      <button
                        className="mini-danger"
                        disabled={busy || String(company.CompanyCode || "").toUpperCase() === "ATLAS"}
                        onClick={() => handleDeleteCompany(company)}
                      >
                        <Trash2 size={14} /> Delete
                      </button>
                    </span>
                  </div>
                ))}
              </div>
              <div className="standard-note company-cleanup-note">
                <div>
                  <strong>Empty company cleanup</strong>
                  <span>Deletes company records with no employee usage and no company-specific policy values. Databases and backups are not dropped.</span>
                </div>
                <button className="danger-button" disabled={busy || session?.user.role !== "admin"} onClick={handleDeleteEmptyCompanies}>
                  <Trash2 size={16} /> Delete empty companies
                </button>
              </div>
              <div className="backup-panel">
                <div className="card-title"><Database size={18} /> Backup and restore</div>
                <div className="form-grid two">
                  <select value={backupForm.databaseName} onChange={(event) => setBackupForm({ ...backupForm, databaseName: event.target.value })}>
                    <option value="">Select database</option>
                    <option value="Atlasairfare010">Main ATLAS database</option>
                    {companies.map((company) => <option key={company.CompanyID} value={company.DatabaseName}>{company.DatabaseName}</option>)}
                  </select>
                  <select value={backupForm.restoreFile} onChange={(event) => setBackupForm({ ...backupForm, restoreFile: event.target.value })}>
                    <option value="">Select backup file for restore</option>
                    {backupFiles
                      .filter((file) => !backupForm.databaseName || file.databaseName === backupForm.databaseName)
                      .map((file) => (
                        <option key={file.backupFile} value={file.backupFile}>
                          {file.fileName} / {formatBackupSize(file.sizeBytes)}
                        </option>
                      ))}
                  </select>
                </div>
                <div className="backup-hint">
                  <span>{backupFiles.length} backup file(s) available in C:\Airfare_Allowance\backups.</span>
                  {backupForm.restoreFile && <span>Selected restore file: {backupForm.restoreFile}</span>}
                </div>
                <div className="button-row">
                  <button className="shine-button" disabled={busy} onClick={handleBackupDatabase}>Create backup</button>
                  <button className="danger-button" disabled={busy} onClick={handleRestoreDatabase}>Restore selected database</button>
                </div>
              </div>
            </div>
            <div className="glass-panel form-card">
              <div className="card-title"><Plus size={18} /> {editingCompanyId ? "Update company" : "Create company"}</div>
              <div className="form-grid two">
                <Field label="Company code"><input placeholder="ATLAS" value={companyForm.companyCode} onChange={(event) => {
                  const code = event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
                  setCompanyForm({ ...companyForm, companyCode: code, databaseName: companyForm.databaseName || (code ? `ATLAS_${code}` : "") });
                }} /></Field>
                <Field label="Company name"><input placeholder="Company name" value={companyForm.companyName} onChange={(event) => setCompanyForm({ ...companyForm, companyName: event.target.value })} /></Field>
                <Field label="Database name"><input placeholder="ATLAS_COMPANY" value={companyForm.databaseName} onChange={(event) => setCompanyForm({ ...companyForm, databaseName: event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_") })} /></Field>
                <Field label="Contact person"><input placeholder="Contact person" value={companyForm.contactPerson} onChange={(event) => setCompanyForm({ ...companyForm, contactPerson: event.target.value })} /></Field>
                <Field label="Phone"><input placeholder="Phone" value={companyForm.phone} onChange={(event) => setCompanyForm({ ...companyForm, phone: event.target.value })} /></Field>
                <Field label="Email"><input placeholder="Email" value={companyForm.email} onChange={(event) => setCompanyForm({ ...companyForm, email: event.target.value })} /></Field>
                <Field label="TRN / CR"><input placeholder="TRN / CR" value={companyForm.trn} onChange={(event) => setCompanyForm({ ...companyForm, trn: event.target.value })} /></Field>
                <Field label="Logo"><input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={(event) => setCompanyLogoFile(event.target.files?.[0] || null)} /></Field>
              </div>
              <Field label="Address"><input placeholder="Address" value={companyForm.address} onChange={(event) => setCompanyForm({ ...companyForm, address: event.target.value })} /></Field>
              <label className="switch-row"><input type="checkbox" checked={companyForm.isActive} onChange={(event) => setCompanyForm({ ...companyForm, isActive: event.target.checked })} /> Active company</label>
              {companyLogoFile && <p className="muted">Logo ready: {companyLogoFile.name}</p>}
              <div className="button-row">
                <button className="shine-button" disabled={busy} onClick={handleSaveCompany}>Save company and database</button>
                {editingCompanyId && <button className="soft-button" disabled={busy} onClick={() => {
                  setEditingCompanyId(null);
                  setCompanyLogoFile(null);
                  setCompanyForm({ companyCode: "", companyName: "", databaseName: "", address: "", phone: "", email: "", trn: "", contactPerson: "", isActive: true });
                }}>Cancel edit</button>}
              </div>
            </div>
          </section>
        )}

        {activeView === "Preferences" && (
          <section className="preferences-page">
            <div className="glass-panel table-card">
              <div className="card-title"><Settings size={18} /> Preferences and custom values</div>
              <div className="standard-note">
                <div>
                  <strong>Date-effective values are used only for new or edited transactions.</strong>
                  <span>Historical allocations keep their saved policy snapshot. Current entitlement is capped at 60 days and BHD 150.</span>
                </div>
                <button className="mini-soft" onClick={() => setActiveView("Airfare")}>Open Airfare</button>
              </div>
              <div className="metric-grid">
                <Metric title="Current Policies" value={String(currentAirfarePolicyRates.length)} icon={<Database />} tone="blue" />
                <Metric title="Latest Current Amount" value={money.format(currentAirfarePolicyRates[0]?.MaxPayoutAmount || 150)} icon={<WalletCards />} tone="cyan" />
                <Metric title="Latest Per Day Rate" value={money.format(currentAirfarePolicyRates[0]?.PerDayRate || ((currentAirfarePolicyRates[0]?.MaxPayoutAmount || 150) / 60))} icon={<CalendarClock />} tone="violet" />
                <Metric title="History Safe" value="Locked" icon={<ShieldCheck />} tone="rose" />
              </div>
              <div className="appearance-panel">
                <div className="card-title"><Palette size={18} /> Appearance and workspace</div>
                <p className="muted">These preferences are saved on this browser, so refresh and restart keep the same workspace style.</p>
                <div className="form-grid two">
                  <Field label="Theme accent">
                    <select value={themeAccent} onChange={(event) => setThemeAccent(event.target.value as "blue" | "emerald" | "slate")}>
                      <option value="blue">Blue professional</option>
                      <option value="emerald">Emerald calm</option>
                      <option value="slate">Slate focused</option>
                    </select>
                  </Field>
                  <Field label="Application density">
                    <select value={uiDensity} onChange={(event) => setUiDensity(event.target.value as "comfortable" | "standard" | "compact")}>
                      <option value="comfortable">Comfortable</option>
                      <option value="standard">Standard</option>
                      <option value="compact">Compact</option>
                    </select>
                  </Field>
                </div>
                <div className="button-row">
                  <button className="soft-button" onClick={() => setSidebarCollapsed((current) => !current)}>{sidebarCollapsed ? "Expand left menu" : "Collapse left menu"}</button>
                  <button className="soft-button" onClick={() => setRightPanelsCollapsed((current) => !current)}>{rightPanelsCollapsed ? "Show right panels" : "Hide right panels"}</button>
                  <button className="soft-button" onClick={() => {
                    setThemeMode("light");
                    setThemeAccent("blue");
                    setUiDensity("standard");
                    setSidebarCollapsed(false);
                    setRightPanelsCollapsed(false);
                    setShowSyncStatus(true);
                    setMessage("Workspace appearance reset to standard.");
                  }}>Reset workspace</button>
                </div>
              </div>
              <div className="premium-table">
                <div className="table-row loan-head policy-rate-row"><span>Scope</span><span>Effective period</span><span>Amount</span><span>Cycle</span><span>Per day</span><span>Status</span><span>Action</span></div>
                {airfarePolicyRates.length === 0 && <p className="muted">No custom airfare policy found. System will use BHD 150.00 default.</p>}
                {airfarePolicyRates.map((rate) => (
                  <div className="table-row loan-head policy-rate-row" key={rate.PolicyRateID}>
                    <span>
                      <strong>{rate.EmployeeID ? "Employee exception" : rate.EmpGroup ? "Pay group matrix" : rate.Department ? "Department matrix" : rate.CompanyID ? "Company default" : "Global default"}</strong>
                      <small>{rate.EmployeeID ? `${rate.EmployeeCode || rate.EmployeeID} - ${rate.FullName || ""}` : rate.EmpGroup ? rate.EmpGroup : rate.Department ? rate.Department : rate.CompanyID ? rate.CompanyName || `Company ${rate.CompanyID}` : "All companies and employees"}</small>
                    </span>
                    <span><strong>{formatExportDate(rate.EffectiveFrom)}</strong><small>to {rate.EffectiveTo ? formatExportDate(rate.EffectiveTo) : "Current"}</small></span>
                    <span><strong>{money.format(rate.MaxPayoutAmount)}</strong><small>Stored as policy #{rate.PolicyRateID}</small></span>
                    <span><strong>{Number(rate.CycleDays || 60).toFixed(0)} days</strong><small>{Number(rate.WorkingDaysPerMonth || 30).toFixed(0)} working days / month</small></span>
                    <span><strong>{money.format(rate.PerDayRate || ((rate.MaxPayoutAmount || 150) / (rate.CycleDays || 60)))}</strong><small>Amount / cycle days</small></span>
                    <span><strong>{rate.IsActive && !rate.EffectiveTo ? "Current" : rate.IsActive ? "Historical" : "Replaced"}</strong><small>{rate.EmployeeID ? "Highest priority" : rate.EmpGroup ? "Pay group rule" : rate.Department ? "Department rule" : rate.CompanyID ? "Company override" : "Default"}</small></span>
                    <span className="row-actions">
                      <button className="mini-danger" type="button" disabled={busy || !session || !["admin", "manager"].includes(session.user.role)} onClick={() => handleDeleteAirfarePolicyRate(rate)} title="Delete preference rule"><Trash2 size={14} /></button>
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="glass-panel form-card preferences-policy-card">
              <div className="card-title"><Database size={18} /> Airfare allocation amount</div>
              <p className="muted">Configure maximum payout rules in one clear workspace. Use employee exception only when one employee needs a different payout from the global, company, department, or pay group rule.</p>
              <div className="policy-tabs" role="tablist" aria-label="Airfare preference workspace">
                <button type="button" className={policyTab === "new" ? "active" : ""} onClick={() => setPolicyTab("new")}>New Rule</button>
                <button type="button" className={policyTab === "history" ? "active" : ""} onClick={() => setPolicyTab("history")}>History</button>
                <button type="button" className={policyTab === "logic" ? "active" : ""} onClick={() => setPolicyTab("logic")}>Logic</button>
              </div>
              {policyTab === "new" && (
                <>
              <div className="policy-rule-label">Rule type</div>
              <div className="policy-rule-picker" role="radiogroup" aria-label="Airfare max payout rule type">
                {[
                  { value: "global" as const, title: "Global", note: "Default for all employees" },
                  { value: "company" as const, title: "Company", note: "One company default" },
                  { value: "employee" as const, title: "Employee exception profile", note: "Special max payout" },
                  { value: "department" as const, title: "Department matrix", note: "Based on department" },
                  { value: "payGroup" as const, title: "Pay group matrix", note: "Based on employee group" }
                ].map((rule) => (
                  <button
                    key={rule.value}
                    type="button"
                    className={`policy-rule-option ${policyForm.ruleType === rule.value ? "active" : ""}`}
                    aria-pressed={policyForm.ruleType === rule.value}
                    onClick={() => setPolicyForm({ ...policyForm, ruleType: rule.value, companyId: "", employeeId: "", department: "", payGroup: "" })}
                  >
                    <strong>{rule.title}</strong>
                    <span>{rule.note}</span>
                  </button>
                ))}
              </div>
              <div className="form-grid one">
                {policyForm.ruleType === "company" && (
                  <Field label="Company scope">
                    <select value={policyForm.companyId} onChange={(event) => setPolicyForm({ ...policyForm, companyId: event.target.value })}>
                      <option value="">Select company</option>
                      {companies.map((company) => <option key={company.CompanyID} value={company.CompanyID}>{company.CompanyName}</option>)}
                    </select>
                  </Field>
                )}
                {policyForm.ruleType === "employee" && (
                  <div className="policy-employee-picker">
                    <Field label="Employee search">
                      <input
                        placeholder="Type employee code, name, department, group"
                        value={policyEmployeeSearch}
                        onChange={(event) => setPolicyEmployeeSearch(event.target.value)}
                      />
                    </Field>
                    {selectedPolicyEmployee && (
                      <div className="selected-policy-employee">
                        <strong>{selectedPolicyEmployee.EmployeeCode} - {selectedPolicyEmployee.FullName}</strong>
                        <span>{selectedPolicyEmployee.Department || "-"} / {selectedPolicyEmployee.EmpGroup || "-"} / {selectedPolicyEmployee.Status || "-"}</span>
                      </div>
                    )}
                    <div className="policy-employee-list">
                      {filteredPolicyEmployees.length === 0 && (
                        <div className="empty-state-inline">
                          <p className="muted">
                            {policyEmployeesLoading
                              ? "Loading employees from SQL..."
                              : selectedPolicyEmployee
                                ? "Selected employee is confirmed above. Clear search to show the employee list again."
                                : "No employee found. Try code, name, department, or reload employees."}
                          </p>
                          {selectedPolicyEmployee && (
                            <button className="mini-soft" type="button" onClick={() => setPolicyEmployeeSearch("")}>
                              <X size={14} /> Clear search
                            </button>
                          )}
                          <button className="mini-soft" type="button" disabled={policyEmployeesLoading || !session} onClick={() => void reloadPolicyEmployees()}>
                            <RefreshCw size={14} /> Reload employees
                          </button>
                        </div>
                      )}
                      {filteredPolicyEmployees.map((employee) => (
                        <button
                          type="button"
                          key={employee.EmployeeID}
                          className={Number(policyForm.employeeId) === Number(employee.EmployeeID) ? "active" : ""}
                          onClick={() => {
                            setPolicyForm({ ...policyForm, employeeId: String(employee.EmployeeID) });
                            setPolicyEmployeeSearch(`${employee.EmployeeCode} - ${employee.FullName}`);
                          }}
                        >
                          <strong>{employee.EmployeeCode} - {employee.FullName}</strong>
                          <span>{employee.Department || "-"} / {employee.EmpGroup || "-"}{isAirfareEligibleEmployeeStatus(employee.Status) ? "" : " / inactive"}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {policyForm.ruleType === "department" && (
                  <Field label="Department matrix">
                    <select value={policyForm.department} onChange={(event) => setPolicyForm({ ...policyForm, department: event.target.value })}>
                      <option value="">Select department</option>
                      {workOptions.department.map((department) => <option key={department} value={department}>{department}</option>)}
                    </select>
                  </Field>
                )}
                {policyForm.ruleType === "payGroup" && (
                  <Field label="Pay group matrix">
                    <select value={policyForm.payGroup} onChange={(event) => setPolicyForm({ ...policyForm, payGroup: event.target.value })}>
                      <option value="">Select pay group</option>
                      {workOptions.group.map((group) => <option key={group} value={group}>{group}</option>)}
                    </select>
                  </Field>
                )}
                <Field label="Effective from">
                  <input type="date" value={policyForm.effectiveFrom} onChange={(event) => setPolicyForm({ ...policyForm, effectiveFrom: event.target.value })} />
                </Field>
                <Field label="New airfare amount">
                  <input type="number" step="0.01" min="0" max="150" placeholder="150.00" value={policyForm.maxPayoutAmount} onChange={(event) => setPolicyForm({ ...policyForm, maxPayoutAmount: event.target.value })} />
                </Field>
              </div>
              <div className="calc-result">
                <span><small>Rule</small><strong>{policyForm.ruleType === "payGroup" ? "Pay group" : policyForm.ruleType === "department" ? "Department" : policyForm.ruleType === "employee" ? "Employee" : policyForm.ruleType === "company" ? "Company" : "Global"}</strong></span>
                <span><small>New amount</small><strong>{money.format(toNumber(policyForm.maxPayoutAmount))}</strong></span>
                <span><small>Per day</small><strong>{money.format(toNumber(policyForm.maxPayoutAmount, AIRFARE_DEFAULT_PAYOUT) / AIRFARE_MAX_DAYS)}</strong></span>
              </div>
              <div className="button-row">
                <button className="shine-button" disabled={busy || !session || !["admin", "manager"].includes(session.user.role)} onClick={handleSaveAirfarePolicyRate}>Save preference value</button>
              </div>
                </>
              )}
              {policyTab === "history" && (
                <div className="premium-table policy-history-panel">
                  <div className="button-row compact">
                    <button className="mini-danger" type="button" disabled={busy || selectedPolicyRateIds.size === 0} onClick={handleBulkDeleteAirfarePolicyRates}>
                      <Trash2 size={14} /> Delete selected ({selectedPolicyRateIds.size})
                    </button>
                    <button className="mini-soft" type="button" disabled={busy || airfarePolicyRates.every((rate) => !isCurrentAirfarePolicyRate(rate))} onClick={() => setSelectedPolicyRateIds(new Set(airfarePolicyRates.filter((rate) => isCurrentAirfarePolicyRate(rate)).map((rate) => rate.PolicyRateID)))}>
                      Select current
                    </button>
                    <button className="mini-soft" type="button" disabled={busy || selectedPolicyRateIds.size === 0} onClick={() => setSelectedPolicyRateIds(new Set())}>
                      Clear selection
                    </button>
                  </div>
                  <div className="table-row loan-head policy-rate-row"><span>Select</span><span>Scope</span><span>Effective period</span><span>Amount</span><span>Cycle</span><span>Per day</span><span>Status</span><span>Action</span></div>
                  {airfarePolicyRates.length === 0 && <p className="muted">No custom airfare policy found. System will use BHD 150.00 default.</p>}
                  {airfarePolicyRates.map((rate) => (
                    <div className="table-row loan-head policy-rate-row" key={`history-${rate.PolicyRateID}`}>
                      <span><input type="checkbox" checked={selectedPolicyRateIds.has(rate.PolicyRateID)} disabled={!isCurrentAirfarePolicyRate(rate) || busy} onChange={(event) => togglePolicyRateSelection(rate.PolicyRateID, event.target.checked)} /></span>
                      <span>
                        <strong>{rate.EmployeeID ? "Employee exception" : rate.EmpGroup ? "Pay group matrix" : rate.Department ? "Department matrix" : rate.CompanyID ? "Company default" : "Global default"}</strong>
                        <small>{rate.EmployeeID ? `${rate.EmployeeCode || rate.EmployeeID} - ${rate.FullName || ""}` : rate.EmpGroup ? rate.EmpGroup : rate.Department ? rate.Department : rate.CompanyID ? rate.CompanyName || `Company ${rate.CompanyID}` : "All companies and employees"}</small>
                      </span>
                      <span><strong>{formatExportDate(rate.EffectiveFrom)}</strong><small>to {rate.EffectiveTo ? formatExportDate(rate.EffectiveTo) : "Current"}</small></span>
                      <span><strong>{money.format(rate.MaxPayoutAmount)}</strong><small>Policy #{rate.PolicyRateID}</small></span>
                      <span><strong>{Number(rate.CycleDays || 60).toFixed(0)} days</strong><small>{Number(rate.WorkingDaysPerMonth || 30).toFixed(0)} working days / month</small></span>
                      <span><strong>{money.format(rate.PerDayRate || ((rate.MaxPayoutAmount || 150) / (rate.CycleDays || 60)))}</strong><small>Amount / cycle days</small></span>
                      <span><strong>{rate.IsActive && !rate.EffectiveTo ? "Current" : rate.IsActive ? "Historical" : "Replaced"}</strong><small>{rate.EmployeeID ? "Highest priority" : rate.EmpGroup ? "Pay group rule" : rate.Department ? "Department rule" : rate.CompanyID ? "Company override" : "Default"}</small></span>
                      <span className="row-actions">
                        <button className="mini-soft" type="button" disabled={busy || !session || !["admin", "manager"].includes(session.user.role)} onClick={() => handleEditAirfarePolicyRate(rate)} title="Edit as draft"><Pencil size={14} /></button>
                        {isCurrentAirfarePolicyRate(rate) ? (
                          <button className="mini-danger" type="button" disabled={busy || !session || !["admin", "manager"].includes(session.user.role)} onClick={() => handleDeleteAirfarePolicyRate(rate)} title="Delete current preference rule"><Trash2 size={14} /></button>
                        ) : (
                          <span className="muted">History locked</span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {policyTab === "logic" && (
              <div className="stack-list">
                <div className="notice">
                  <span />
                  <div>
                    <strong>Algorithm</strong>
                    <p>On allocation date, SQL selects the newest active policy in this order: employee exception, pay group matrix, department matrix, company default, then global default.</p>
                  </div>
                </div>
                <div className="notice">
                  <span />
                  <div>
                    <strong>Historical protection</strong>
                    <p>When an allocation is saved, the policy amount, cycle days, and per-day rate are copied into the allocation row. Reports use that snapshot for old records.</p>
                  </div>
                </div>
              </div>
              )}
            </div>
          </section>
        )}

        {activeView === "AI Insights" && (
          <section className="intelligence-layout">
            <div className="glass-panel ai-card intelligence-hero">
              <div className="card-title"><Bot size={18} /> Intelligence Control Center</div>
              <h3>{intelligence?.summary.OverallStatus || "Live SQL rules loading"}</h3>
              <p>SQL reviews airfare, loans, imports, company setup, backup status, and year-end readiness. Every item shows a reason and recommended action.</p>
              <div className="intelligence-score">
                <strong>{Number(intelligence?.summary.IntelligenceScore ?? 100)}</strong>
                <span>Verification score</span>
              </div>
              <div className="hero-stats">
                <span><strong>{Number(intelligence?.summary.CriticalCount ?? 0)}</strong> critical</span>
                <span><strong>{Number(intelligence?.summary.WarningCount ?? 0)}</strong> warnings</span>
                <span><strong>{Number(intelligence?.summary.OpenImportBatches ?? 0)}</strong> open imports</span>
              </div>
            </div>
            <div className="glass-panel hcm-card">
              <div className="card-title"><ShieldCheck size={18} /> Automatic verification model</div>
              <ul>
                <li>{systemIntegrity?.modelName || "Business rules run from MSSQL, not from visual-only frontend checks."}</li>
                <li>Critical and warning risks are explainable with target screen links.</li>
                <li>Imports, allocations, loans, company setup, backup, and year-end are reviewed together.</li>
                <li>{systemIntegrity?.formulaPolicy || "Use Refresh after corrections to recalculate live risk status."}</li>
              </ul>
              <div className="standard-note">
                <div>
                  <strong>{systemIntegrity?.integrityStatus || "Waiting for integrity model"}</strong>
                  <span>{systemIntegrity?.mode || "read-only observer"} / rules locked: {systemIntegrity?.rulesLocked ? "yes" : "pending"}</span>
                </div>
                <span className="risk-badge info">{Number(systemIntegrity?.integrityScore ?? verification?.summary.VerificationScore ?? 100)} score</span>
              </div>
              <div className="metric-grid compact">
                <Metric title="Failed" value={String(Number(systemIntegrity?.controlSignals.failedChecks ?? verification?.summary.FailedChecks ?? 0))} icon={<X />} tone="rose" />
                <Metric title="Warnings" value={String(Number(systemIntegrity?.controlSignals.warningChecks ?? verification?.summary.WarningChecks ?? 0))} icon={<Bell />} tone="violet" />
                <Metric title="Diagnostics" value={String(systemIntegrity?.controlSignals.diagnosticsStatus || diagnosticStatusLabel)} icon={<Activity />} tone="cyan" />
                <Metric title="Actions" value={String(systemIntegrity?.actionQueue.length ?? 0)} icon={<ListPlus />} tone="blue" />
              </div>
              <button className="soft-button" disabled={busy || !session} onClick={() => void loadLiveData()}><RefreshCw size={16} /> Refresh intelligence</button>
            </div>
            <div className="glass-panel table-card intelligence-wide">
              <div className="card-title"><Sparkles size={18} /> Intelligence Control Center plan</div>
              <div className="intelligence-table">
                {(systemIntegrity?.automationPlan || []).length === 0 && <p className="muted">Automatic verification model is waiting for live SQL evidence.</p>}
                {(systemIntegrity?.automationPlan || []).map((plan) => (
                  <div className="intelligence-row" key={plan.title}>
                    <span className={`risk-badge ${plan.status === "Action required" ? "critical" : plan.status === "Review recommended" ? "warning" : "info"}`}>{plan.status}</span>
                    <span><strong>{plan.title}</strong><small>{plan.checks} check(s), {plan.evidenceCount} evidence item(s)</small></span>
                    <span>{plan.codes.join(", ")}</span>
                    <button className="mini-soft" onClick={() => plan.targetView && setActiveView(plan.targetView)}>Open</button>
                  </div>
                ))}
              </div>
            </div>
            <div className="glass-panel table-card intelligence-wide diagnostics-panel">
              <div className="diagnostics-header">
                <div>
                  <div className="card-title"><Activity size={18} /> AI System Integrity</div>
                  <p className="muted">Read-only diagnostics check SQL, published UI availability, and optional external integrations. Airfare calculation rules are not touched.</p>
                </div>
                <button className="shine-button" disabled={!session || diagnosticsLoading} onClick={handleRunDiagnostics}>
                  <Activity size={16} /> {diagnosticsLoading ? "Running..." : "Run Diagnostics"}
                </button>
              </div>
              <div className={`diagnostics-status ${String(diagnosticStatusLabel).toLowerCase()}`}>
                <span>{diagnosticIcon(diagnostics?.status || "IDLE")}</span>
                <strong>{diagnosticStatusLabel}</strong>
                <small>{diagnostics?.checkedAt ? `Checked ${formatExportDate(diagnostics.checkedAt)}` : "Diagnostics not run yet"}</small>
              </div>
              <div className="diagnostics-grid">
                {diagnosticCards.map((check) => (
                  <div className={`diagnostic-card ${diagnosticsLoading ? "loading" : String(check.status).toLowerCase()}`} key={check.key}>
                    {diagnosticsLoading ? (
                      <>
                        <span className="skeleton-line short" />
                        <span className="skeleton-line" />
                        <span className="skeleton-line tiny" />
                      </>
                    ) : (
                      <>
                        <div className="diagnostic-card-title">
                          <span>{diagnosticIcon(check.status)}</span>
                          <strong>{check.name}</strong>
                        </div>
                        <p>{check.detail || "No detail returned."}</p>
                        <div className="diagnostic-meta">
                          <span>{check.status}</span>
                          <span>{Number(check.latencyMs || 0)} ms</span>
                          {check.thresholdMs ? <span>Limit {check.thresholdMs} ms</span> : null}
                        </div>
                        {check.services?.length ? (
                          <div className="diagnostic-services">
                            {check.services.slice(0, 4).map((service) => (
                              <span key={`${check.key}-${service.name}`}>{service.name}: {service.status}</span>
                            ))}
                          </div>
                        ) : null}
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <div className="glass-panel table-card intelligence-wide">
              <div className="card-title"><ShieldCheck size={18} /> Phase 2 system verification</div>
              <div className="standard-note">
                <div>
                  <strong>{verification?.summary.VerificationStatus || "Waiting for SQL verification"}</strong>
                  <span>Server-side checks validate calculation consistency, import gates, duplicate ticket approval, loans, year-end, backup, security, and report drilldown links.</span>
                </div>
                <button className="mini-soft" disabled={busy || !session} onClick={() => void loadLiveData()}><RefreshCw size={14} /> Recheck</button>
              </div>
              <div className="metric-grid">
                <Metric title="Verification Score" value={String(Number(verification?.summary.VerificationScore ?? 100))} icon={<ShieldCheck />} tone="blue" />
                <Metric title="Passed" value={String(Number(verification?.summary.PassedChecks ?? 0))} icon={<CheckCircle2 />} tone="cyan" />
                <Metric title="Warnings" value={String(Number(verification?.summary.WarningChecks ?? 0))} icon={<Bell />} tone="violet" />
                <Metric title="Failed" value={String(Number(verification?.summary.FailedChecks ?? 0))} icon={<X />} tone="rose" />
              </div>
              <div className="intelligence-table">
                {(verification?.checks || []).length === 0 && <p className="muted">No Phase 2 verification checks returned yet.</p>}
                {(verification?.checks || []).map((check) => (
                  <div className="intelligence-row" key={`${check.CheckCode}-${check.CheckID || check.Title}`}>
                    <span className={`risk-badge ${check.Status === "FAIL" ? "critical" : check.Status === "WARN" ? "warning" : "info"}`}>{check.Status}</span>
                    <span><strong>{check.Title}</strong><small>{check.Area} / {check.CheckCode}</small></span>
                    <span>{check.Detail}</span>
                    <button className="mini-soft" onClick={() => {
                      if (check.TargetRecordID && (check.TargetRecordType === "employee" || check.TargetRecordType === "allocation" || check.TargetRecordType === "loan" || check.TargetRecordType === "company")) {
                        void handleReportDrillDown({
                          __recordType: check.TargetRecordType,
                          __recordId: Number(check.TargetRecordID)
                        });
                        return;
                      }
                      if (check.TargetView) setActiveView(check.TargetView);
                    }}>Open</button>
                  </div>
                ))}
              </div>
            </div>
            <div className="glass-panel table-card intelligence-wide">
              <div className="card-title"><Bell size={18} /> Live risks and controls</div>
              <div className="intelligence-table">
                {(intelligence?.risks || []).length === 0 && <p className="muted">No SQL risk items found. The current control status is healthy.</p>}
                {(intelligence?.risks || []).map((risk) => (
                  <div className="intelligence-row" key={`${risk.Area}-${risk.RiskID || risk.Title}`}>
                    <span className={`risk-badge ${String(risk.Severity).toLowerCase()}`}>{risk.Severity}</span>
                    <span><strong>{risk.Title}</strong><small>{risk.Area} / {risk.Detail || "SQL verified item"}</small></span>
                    <span>{risk.Recommendation}</span>
                    <button className="mini-soft" onClick={() => risk.TargetView && setActiveView(risk.TargetView)}>Open</button>
                  </div>
                ))}
              </div>
            </div>
            <div className="glass-panel hcm-card">
              <div className="card-title"><Sparkles size={18} /> Recommended actions</div>
              <div className="recommendation-list">
                {(intelligence?.recommendations || []).length === 0 && <p className="muted">No urgent recommendations. Continue normal processing.</p>}
                {(intelligence?.recommendations || []).map((item, index) => (
                  <button className="recommendation-item" key={`${item.Title}-${index}`} onClick={() => item.TargetView && setActiveView(item.TargetView)}>
                    <span className={`risk-badge ${String(item.Severity).toLowerCase()}`}>{item.Severity}</span>
                    <strong>{item.Title}</strong>
                    <small>{item.Recommendation}</small>
                  </button>
                ))}
              </div>
            </div>
          </section>
        )}

        {activeView === "Security" && (
          <section className="table-grid">
            <div className="glass-panel table-card">
              <div className="card-title"><ShieldCheck size={18} /> Users and rights</div>
              <div className="premium-table">
                <div className="table-row user-head"><span>User</span><span>Role</span><span>Department</span><span>Status</span><span>Action</span></div>
                {filteredUsers.map((user) => (
                  <div className="table-row user-head" key={user.UserID}>
                    <span><strong>{user.FullName}</strong><small>{user.Email}</small></span>
                    <span>{user.Role}</span>
                    <span>{user.Department || "-"}</span>
                    <span className="pill">{user.IsActive ? "Active" : "Inactive"}</span>
                    <span className="row-actions"><button className="mini-soft" disabled={session?.user.role !== "admin"} onClick={() => handleEditUser(user)}>Edit</button></span>
                  </div>
                ))}
                {session?.user.role !== "admin" && <p className="muted">Sign in as admin to view and create users.</p>}
              </div>
            </div>
            <div className="glass-panel form-card">
              <div className="card-title"><Plus size={18} /> {editingUserId ? "Edit user rights" : "Add user"}</div>
              <div className="form-grid one">
                <input placeholder="Username" disabled={Boolean(editingUserId) || userForm.role === "employee"} value={userForm.username} onChange={(e) => setUserForm({ ...userForm, username: e.target.value })} />
                <input placeholder={editingUserId ? "New password (optional)" : "Temporary password"} type="password" value={userForm.password} onChange={(e) => setUserForm({ ...userForm, password: e.target.value })} />
                <input placeholder="Email (optional)" disabled={userForm.role === "employee"} value={userForm.email} onChange={(e) => setUserForm({ ...userForm, email: e.target.value })} />
                <input placeholder="Full name" disabled={userForm.role === "employee"} value={userForm.fullName} onChange={(e) => setUserForm({ ...userForm, fullName: e.target.value })} />
                <select value={userForm.role} onChange={(e) => handleUserRoleChange(e.target.value)}>
                  <option value="admin">Admin</option>
                  <option value="manager">Manager</option>
                  <option value="hr">HR</option>
                  <option value="employee">Employee Self-Service</option>
                  <option value="user">User</option>
                  <option value="viewer">Viewer</option>
                </select>
                {userForm.role === "employee" ? (
                  <select value={userForm.employeeId} onChange={(event) => handleUserEmployeeChange(event.target.value)} required>
                    <option value="">Select employee from master</option>
                    {userFormEmployeeOptions.map((employee) => (
                      <option key={employee.EmployeeID} value={employee.EmployeeID}>
                        {employee.EmployeeCode} - {employee.FullName}
                      </option>
                    ))}
                  </select>
                ) : null}
                <input placeholder="Department" disabled={userForm.role === "employee"} value={userForm.department} onChange={(e) => setUserForm({ ...userForm, department: e.target.value })} />
                <input placeholder="Branch" disabled={userForm.role === "employee"} value={userForm.branch} onChange={(e) => setUserForm({ ...userForm, branch: e.target.value })} />
                <label className="switch-row"><input type="checkbox" checked={userForm.isActive} onChange={(event) => setUserForm({ ...userForm, isActive: event.target.checked })} /> Active user</label>
                <button className="shine-button" disabled={busy || session?.user.role !== "admin"} onClick={handleCreateUser}>{editingUserId ? "Update user rights" : "Create user"}</button>
                {editingUserId && <button className="soft-button" disabled={busy} onClick={cancelUserEdit}>Cancel edit</button>}
              </div>
            </div>
          </section>
        )}

        {activeView === "Support" && (
          <section className="support-grid">
            <div className="glass-panel hcm-card support-guide-panel">
              <div className="card-title"><HelpCircle size={18} /> How to use ATLAS</div>
              <div className="support-guide-main">
                <div>
                  <h3>Help and Validation Guide</h3>
                  <p>Open the Word support document for daily processing, validation evidence, LAN access, reports, loans, company processing, and year-end checks.</p>
                </div>
                <div className="support-guide-actions">
                  <a className="shine-button" href="/help/ATLAS_Airfare_HCM_Support_Guide_2026-06-28.docx" target="_blank" rel="noreferrer">
                    <FileDown size={16} /> Open Word guide
                  </a>
                  <button className="soft-button" onClick={printCurrentScreen}><Printer size={16} /> Print help screen</button>
                </div>
              </div>
              <div className="support-preview-strip">
                <a className="support-preview" href="/help/atlas-system-integrity-ai-insights-20260628.png" target="_blank" rel="noreferrer">
                  <img src="/help/atlas-system-integrity-ai-insights-20260628.png" alt="AI Insights system integrity screen preview" />
                  <span><Eye size={15} /> AI system integrity preview</span>
                </a>
                <a className="support-preview" href="/help/atlas-live-ui-companies-20260628.png" target="_blank" rel="noreferrer">
                  <img src="/help/atlas-live-ui-companies-20260628.png" alt="Companies process screen preview" />
                  <span><Eye size={15} /> Company process preview</span>
                </a>
              </div>
            </div>
            <div className="glass-panel hcm-card support-process-panel">
              <div className="card-title"><CheckCircle2 size={18} /> Core workflow</div>
              <div className="help-steps">
                <span><strong>1. Company</strong><small>Create company, upload logo, then select it from the sidebar company switcher.</small></span>
                <span><strong>2. Employees</strong><small>Add or import employee master, then review dropdown mapping before import.</small></span>
                <span><strong>3. Opening Balance</strong><small>Enter opening days and amount manually or import from Excel before allocations.</small></span>
                <span><strong>4. Airfare Allocation</strong><small>Select employee, ticket cost, payment option, attachment, then save and print.</small></span>
                <span><strong>5. Loans</strong><small>Create manual loans or let airfare excess create a loan from allocation.</small></span>
                <span><strong>6. Reports</strong><small>Export employee, opening balance, allocation, loan, and dashboard reports to Excel.</small></span>
              </div>
            </div>
            <div className="glass-panel hcm-card support-validation-panel">
              <div className="card-title"><CheckCircle2 size={18} /> Testing and validation</div>
              <ul>
                <li>Formula test validates Max payout / 60 x eligible days.</li>
                <li>Import test validates employee Excel preview and mapping.</li>
                <li>Dropdown test validates master-data selection fields.</li>
                <li>Loan test validates loan dashboard and loan actions source.</li>
                <li>Attachment test validates PDF/image upload flow source.</li>
                <li>Company, backup, reports, and responsive layout tests validate admin workflows.</li>
              </ul>
              <div className="button-row">
                <button className="soft-button" onClick={() => setShowNotifications(true)}><Bell size={16} /> Open validation alerts</button>
                <button className="soft-button" onClick={() => setActiveView("AI Insights")}><Bot size={16} /> Open AI insights</button>
              </div>
            </div>
            <div className="glass-panel hcm-card support-research-panel">
              <div className="card-title"><Info size={18} /> UI alignment notes</div>
              <p>Support content uses a consistent grid, shared spacing rhythm, fixed media ratios, and wrapped action rows so labels, screenshots, and buttons stay aligned across desktop and mobile.</p>
              <p>Open-source-style verification includes Next.js build checks, Node source tests, Excel import validation tests, responsive layout source tests, live API checks, and browser screenshot proof.</p>
            </div>
          </section>
        )}
      </section>
    </main>
  );
}

function CalculationLab({ calcInput, setCalcInput, calcResult }: {
  calcInput: { openingDays: number; currentWorkingDays: number; paidDays: number; maximumPayout: number };
  setCalcInput: (value: { openingDays: number; currentWorkingDays: number; paidDays: number; maximumPayout: number }) => void;
  calcResult: { currentAirfareDays: number; remainingDays: number; payableBhd: number };
}) {
  return (
    <section className="calc-grid">
      <div className="glass-panel calc-card">
        <div className="card-title"><Sparkles size={18} /> Airfare Calculation Lab</div>
        <div className="formula-strip">
          <span>Remaining Days = Opening Days + Current Airfare Days - Paid Days</span>
          <span>Total = Max Payout / 60 x Remaining Days</span>
        </div>
        <div className="calc-fields">
          <label>Opening Days<input type="number" step="0.0001" value={calcInput.openingDays} onChange={(e) => setCalcInput({ ...calcInput, openingDays: Number(e.target.value) })} /></label>
          <label>Working Days<input type="number" step="0.01" value={calcInput.currentWorkingDays} onChange={(e) => setCalcInput({ ...calcInput, currentWorkingDays: Number(e.target.value) })} /></label>
          <label>Paid Days<input type="number" step="0.001" value={calcInput.paidDays} onChange={(e) => setCalcInput({ ...calcInput, paidDays: Number(e.target.value) })} /></label>
          <label>Max Payout<input type="number" step="0.01" min="0" max="150" value={calcInput.maximumPayout} onChange={(e) => setCalcInput({ ...calcInput, maximumPayout: Number(e.target.value) })} /></label>
        </div>
        <div className="calc-result">
          <span><small>Current Airfare Days</small><strong>{calcResult.currentAirfareDays.toFixed(4)}</strong></span>
          <span><small>Remaining Days</small><strong>{calcResult.remainingDays.toFixed(4)}</strong></span>
          <span><small>Total Payable</small><strong>{money.format(calcResult.payableBhd)}</strong></span>
        </div>
      </div>
      <div className="glass-panel hcm-card">
        <div className="card-title"><ShieldCheck size={18} /> Formula control</div>
        <ul>
          <li>Every 60 airfare days equals the maximum payout.</li>
          <li>Every 30 working days earns 2.5 airfare days.</li>
          <li>150 BHD / 60 days makes the Excel result 62.50 BHD.</li>
        </ul>
      </div>
    </section>
  );
}

function MetricGrid({ metrics }: { metrics: { totalAirfare: number; opening: number; currentYearEarned: number; entitlementAmount: number; employeeCount: number; loanBalance: number } }) {
  return (
    <section className="metric-grid">
      <Metric title="Report Employees" value={metrics.employeeCount.toString()} icon={<Users />} tone="blue" />
      <Metric title="Opening Balance" value={money.format(metrics.opening)} icon={<CalendarClock />} tone="violet" />
      <Metric title="Airfare Payable" value={money.format(metrics.totalAirfare)} icon={<TrendingUp />} tone="cyan" />
      <Metric title="Loan Exposure" value={money.format(metrics.loanBalance)} icon={<CreditCard />} tone="rose" />
    </section>
  );
}

function Analytics({ trendData, pieData }: { trendData: Array<{ name: string; opening: number; payable: number; remaining: number }>; pieData: Array<{ name: string; value: number; color: string }> }) {
  return (
    <section className="chart-grid">
      <div className="glass-panel chart-card wide">
        <div className="card-title">Airfare movement</div>
        <ResponsiveContainer width="100%" height={320}>
          <AreaChart data={trendData}>
            <defs>
              <linearGradient id="payable" x1="0" x2="0" y1="0" y2="1">
                <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.55} />
                <stop offset="95%" stopColor="#38bdf8" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="rgba(148,163,184,.12)" vertical={false} />
            <XAxis dataKey="name" stroke="#94a3b8" />
            <YAxis stroke="#94a3b8" />
            <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(148,163,184,.25)", borderRadius: 16 }} />
            <Area type="monotone" dataKey="payable" stroke="#38bdf8" fill="url(#payable)" strokeWidth={3} />
            <Area type="monotone" dataKey="opening" stroke="#a78bfa" fill="transparent" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="glass-panel chart-card">
        <div className="card-title">Exposure mix</div>
        <ResponsiveContainer width="100%" height={320}>
          <PieChart>
            <Pie data={pieData} innerRadius={72} outerRadius={112} dataKey="value" paddingAngle={4}>
              {pieData.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
            </Pie>
            <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(148,163,184,.25)", borderRadius: 16 }} />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function EmployeeTable({
  employees,
  onEdit,
  onDelete,
  selectedIds,
  onToggleSelect,
  onSelectAll,
  allSelected,
  onDeleteSelected,
  employeeCount
}: {
  employees: Employee[];
  onEdit: (employee: Employee) => void;
  onDelete: (employee: Employee) => void;
  selectedIds: Set<number>;
  onToggleSelect: (employeeId: number, checked: boolean) => void;
  onSelectAll: (employeeIds: number[], checked: boolean) => void;
  allSelected: boolean;
  onDeleteSelected: () => void;
  employeeCount: number;
}) {
  const isAllSelected = allSelected && employeeCount > 0;
  const visibleSelectedCount = employees.filter((employee) => selectedIds.has(employee.EmployeeID)).length;

  return (
    <div className="premium-table">
      <div className="table-row employee-head selectable-row">
        <span className="checkbox-col">
          <input
            aria-label="Select all employees on this page"
            type="checkbox"
            checked={isAllSelected}
            onChange={(event) => onSelectAll(employees.map((item) => item.EmployeeID), event.target.checked)}
            disabled={employeeCount === 0}
          />
        </span>
        <span>Employee</span>
        <span>Opening Days</span>
        <span>Opening Amount</span>
        <span>Status</span>
        <span className="row-actions">
          {visibleSelectedCount > 0 ? `Delete selected (${visibleSelectedCount})` : "Action"}
          {visibleSelectedCount > 0 && (
            <button className="mini-danger" onClick={onDeleteSelected} type="button">
              <Trash2 size={14} />
            </button>
          )}
        </span>
      </div>
      {employees.map((employee) => (
        <div className="table-row employee-head selectable-row" key={employee.EmployeeID}>
          <span className="checkbox-col">
            <input
              aria-label={`Select ${employee.FullName}`}
              type="checkbox"
              checked={selectedIds.has(employee.EmployeeID)}
              onChange={(event) => onToggleSelect(employee.EmployeeID, event.target.checked)}
            />
          </span>
          <span><strong>{employee.FullName}</strong><small>{employee.EmployeeCode} / {employee.Department || "-"}</small></span>
          <span>{closingBalanceDays(employee).toFixed(2)}</span>
          <span>{money.format(calculateExcelTotal(employee))}</span>
          <span className="pill">{employee.Status}</span>
          <span className="row-actions">
            <button className="mini-soft" onClick={() => onEdit(employee)}>Edit</button>
            <button className="mini-danger" onClick={() => onDelete(employee)}><Trash2 size={14} /></button>
          </span>
        </div>
      ))}
    </div>
  );
}

function SelectField({ placeholder, value, options, onChange, onAddOption, onEditOption, onDeleteOption }: {
  placeholder: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  onAddOption?: () => void;
  onEditOption?: () => void;
  onDeleteOption?: () => void;
}) {
  return (
    <Field label={placeholder} onDoubleClick={onAddOption}>
      <div className="select-manage-control">
        <select value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">{placeholder}</option>
          {options.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
        <div className="select-manage-actions" aria-label={`${placeholder} actions`}>
          {onAddOption && <button className="mini-soft" type="button" title={`Add ${placeholder}`} onClick={onAddOption}><Plus size={13} /> Add</button>}
          {onEditOption && <button className="mini-soft" type="button" title={`Edit selected ${placeholder}`} disabled={!value} onClick={onEditOption}>Edit</button>}
          {onDeleteOption && <button className="mini-danger" type="button" title={`Delete selected ${placeholder}`} disabled={!value} onClick={onDeleteOption}><Trash2 size={13} /></button>}
        </div>
      </div>
    </Field>
  );
}

function Field({ label, children, onDoubleClick }: { label: string; children: React.ReactNode; onDoubleClick?: () => void }) {
  return (
    <label className="field-shell" onDoubleClick={onDoubleClick}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function ImportPreviewPanel({ preview, onCancel, onConfirm, onToggleRow, onToggleAll, onRemoveRow, busy }: {
  preview: ImportPreview;
  onCancel: () => void;
  onConfirm: () => void;
  onToggleRow: (importKey: string, checked: boolean) => void;
  onToggleAll: (checked: boolean) => void;
  onRemoveRow: (importKey: string) => void;
  busy: boolean;
}) {
  const selectedRows = preview.employees.filter((employee) => employee.selected);
  const readyRows = preview.employees.filter((employee) => employee.validationStatus === "Ready");
  const allReadySelected = readyRows.length > 0 && readyRows.every((employee) => employee.selected);
  return (
    <div className="import-preview">
      <div className="import-preview-head">
        <div>
          <strong>Employee import review and confirmation</strong>
          <span>{preview.fileName} / SQL batch #{preview.importBatchId || "-"} / {preview.employees.length} row(s) found / {selectedRows.length} selected</span>
        </div>
        <div className="button-row compact">
          <button className="soft-button" disabled={busy} onClick={onCancel}>Cancel</button>
          <button className="shine-button" disabled={busy || !selectedRows.length} onClick={onConfirm}>{busy ? "Importing..." : `Import ${selectedRows.length} selected`}</button>
        </div>
      </div>
      <div className="import-alert">
        Review the Excel list before saving. Uncheck or remove employees you do not want to import. SQL validates duplicates, missing code/name, and then inserts or updates selected rows.
      </div>
      {preview.summary && (
        <div className="import-summary-strip">
          <span><small>Total rows</small><strong>{preview.summary.totalRows}</strong></span>
          <span><small>Ready</small><strong>{preview.summary.readyRows}</strong></span>
          <span><small>Warnings</small><strong>{preview.summary.warningRows}</strong></span>
          <span><small>Errors</small><strong>{preview.summary.errorRows}</strong></span>
          <span><small>Selected</small><strong>{selectedRows.length}</strong></span>
        </div>
      )}
      <div className="mapping-grid">
        {importMappingFields.map((field) => (
          <span key={field.label}>
            <small>{field.label}</small>
            <strong>{mappedHeaderLabel(preview, field.keys)}</strong>
          </span>
        ))}
      </div>
      <div className="preview-table">
        <div className="preview-row preview-head-row import-review-row">
          <span>
            <input
              type="checkbox"
              aria-label="Select all ready employee import rows"
              checked={allReadySelected}
              onChange={(event) => onToggleAll(event.target.checked)}
            />
          </span>
          <span>Excel row</span><span>Code</span><span>Name</span><span>Department</span><span>Designation</span><span>SQL action</span><span>Review</span><span>Remove</span>
        </div>
        {preview.employees.map((employee) => (
          <div className={`preview-row import-review-row ${employee.validationStatus === "Review" ? "needs-review" : ""}`} key={employee.importKey}>
            <span>
              <input
                type="checkbox"
                aria-label={`Select Excel row ${employee.sourceRow}`}
                checked={employee.selected}
                disabled={employee.validationStatus !== "Ready"}
                onChange={(event) => onToggleRow(employee.importKey, event.target.checked)}
              />
            </span>
            <span>{employee.sourceRow}</span>
            <span>{employee.code}</span>
            <span>{employee.name}</span>
            <span>{employee.department || "-"}</span>
            <span>{employee.designation || "-"}</span>
            <span>{employee.sqlAction || "CHECK"}</span>
            <span className={employee.sqlSeverity === "ERROR" ? "pill danger" : employee.sqlSeverity === "WARNING" ? "pill warning" : "pill success"}>
              {employee.sqlSeverity || employee.validationStatus}: {employee.sqlMessage && employee.sqlMessage !== "Ready for import." ? employee.sqlMessage : employee.validationNotes.join(", ") || "Ready"}
            </span>
            <span>
              <button className="mini-danger" disabled={busy} onClick={() => onRemoveRow(employee.importKey)}><Trash2 size={14} /></button>
            </span>
          </div>
        ))}
      </div>
      {!preview.employees.length && <p className="muted">All preview rows were removed. Select Excel again to rebuild the list.</p>}
    </div>
  );
}

function Metric({ title, value, icon, tone }: { title: string; value: string; icon: React.ReactNode; tone: string }) {
  return (
    <motion.div className={`metric glass-panel ${tone}`} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <div className="metric-icon">{icon}</div>
      <span>{title}</span>
      <strong>{value}</strong>
    </motion.div>
  );
}

function toNumber(value: string | number | undefined, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundTo(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function workingDaysFromYearStart(dateValue: string, joinDateValue?: string, previousAllocationDateValue?: string) {
  const date = dateValue ? new Date(`${dateValue}T00:00:00`) : new Date();
  if (Number.isNaN(date.getTime())) return 0;
  const yearStart = new Date(date.getFullYear(), 0, 1);
  const joinDate = joinDateValue ? new Date(`${String(joinDateValue).slice(0, 10)}T00:00:00`) : null;
  const previousDate = previousAllocationDateValue ? new Date(`${String(previousAllocationDateValue).slice(0, 10)}T00:00:00`) : null;
  const resetDate = previousDate && !Number.isNaN(previousDate.getTime()) ? addDays(previousDate, 1) : null;
  const startDate = [yearStart, joinDate, resetDate]
    .filter((item): item is Date => Boolean(item && !Number.isNaN(item.getTime())))
    .reduce((latest, item) => item > latest ? item : latest, yearStart);
  if (startDate > date) return 0;
  const endSerial = date.getMonth() * 30 + date.getDate();
  const startSerial = startDate.getMonth() * 30 + startDate.getDate();
  return Math.max(0, Math.min(360, endSerial - startSerial + 1));
}

function addDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function findPreviousAllocationForEarning(allocations: Allocation[], dateValue: string) {
  const selectedDate = dateValue ? new Date(`${dateValue}T23:59:59`) : new Date();
  if (Number.isNaN(selectedDate.getTime())) return null;
  return [...allocations]
    .filter((allocation) => {
      const allocationDate = new Date(`${String(allocation.AllocationDate || "").slice(0, 10)}T00:00:00`);
      return !Number.isNaN(allocationDate.getTime())
        && allocationDate <= selectedDate
        && String(allocation.PaymentMode || "").toLowerCase() !== "employee_full"
        && Number(allocation.Entitlement || 0) > 0;
    })
    .sort((a, b) => {
      const left = new Date(String(a.AllocationDate || "")).getTime();
      const right = new Date(String(b.AllocationDate || "")).getTime();
      if (right !== left) return right - left;
      return (Number(b.AllocationID) || 0) - (Number(a.AllocationID) || 0);
    })[0] || null;
}

function saveSession(session: AtlasSession, companyId = "") {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({
    session,
    companyId,
    expiresAt: Date.now() + SESSION_TIMEOUT_MS
  }));
}

function restoreSavedSession(): { session: AtlasSession; companyId: string } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as { session?: AtlasSession; companyId?: string; expiresAt?: number };
    if (!saved.session || !saved.expiresAt || saved.expiresAt <= Date.now()) {
      clearSavedSession();
      return null;
    }
    return { session: saved.session, companyId: saved.companyId || "" };
  } catch {
    clearSavedSession();
    return null;
  }
}

function clearSavedSession() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(SESSION_STORAGE_KEY);
}

function extractRemarkValue(remarks: string | undefined, label: string) {
  const prefix = `${label}:`;
  return String(remarks || "")
    .split("|")
    .map((part) => part.trim())
    .find((part) => part.toLowerCase().startsWith(prefix.toLowerCase()))
    ?.slice(prefix.length)
    .trim() || "";
}

function stripSystemRemarks(remarks: string | undefined) {
  return String(remarks || "")
    .split("|")
    .map((part) => part.trim())
    .filter((part) => part && !/^Emergency ticket$/i.test(part) && !/^(Route|Ticket|Supplier|Invoice):/i.test(part))
    .join(" | ");
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("File read failed"));
    reader.readAsDataURL(file);
  });
}

async function fileToBase64(file: File) {
  const dataUrl = await fileToDataUrl(file);
  return dataUrl.split(",")[1] || "";
}

function uniqueOptions(values: Array<string | number | null | undefined>) {
  return Array.from(new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function toNullableNumber(value: string | number | undefined) {
  if (value === "" || value === undefined || value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeHeader(value: unknown) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findCell(headers: string[], row: unknown[], names: string[]) {
  const wanted = names.map(normalizeHeader);
  let index = headers.findIndex((header) => wanted.some((name) => header === name));
  if (index < 0) {
    index = headers.findIndex((header) => wanted.some((name) => header.includes(name)));
  }
  return index >= 0 ? row[index] : "";
}

function findHeaderIndex(headers: string[], names: string[]) {
  const wanted = names.map(normalizeHeader);
  const exactIndex = headers.findIndex((header) => wanted.some((name) => header === name));
  if (exactIndex >= 0) return exactIndex;
  return headers.findIndex((header) => wanted.some((name) => header.includes(name)));
}

function findEmployeeHeaderRow(rows: unknown[][]) {
  const preferredCodeHeaders = [
    "code",
    "codegeneral",
    "employeeid",
    "employeeid",
    "employeeno",
    "employeeno",
    "employeecode",
    "empno",
    "empid",
    "payrollno",
    "payrollnumber",
    "staffid"
  ];
  const preferredNameHeaders = [
    "name",
    "namegeneralemployee",
    "fullname",
    "employee name",
    "nameemployee",
    "staffname",
    "personname"
  ];
  const supportingHeaders = [
    "department",
    "departmentgeneral",
    "join",
    "joining",
    "status",
    "empstatus",
    "date",
    "designation",
    "job",
    "email",
    "branch",
    "location"
  ];

  for (let i = 0; i < rows.length; i++) {
    const normalized = rows[i].map((cell) => normalizeHeader(cell));
    if (normalized.every((value) => !value)) continue;
    const hasCodeLike = normalized.some((header) => preferredCodeHeaders.some((name) => header === name || header.includes(name)));
    const hasNameLike = normalized.some((header) => preferredNameHeaders.some((name) => header === name || header.includes(name)));
    const hasSupporting = normalized.some((header) => supportingHeaders.some((name) => header === name || header.includes(name)));
    if (hasCodeLike && hasNameLike && hasSupporting) return i;
  }

  for (let i = 0; i < rows.length; i++) {
    const normalized = rows[i].map((cell) => normalizeHeader(cell));
    if (normalized.every((value) => !value)) continue;
    const hasCodeLike = normalized.some((header) => preferredCodeHeaders.some((name) => header.includes(name)));
    const hasNameLike = normalized.some((header) => preferredNameHeaders.some((name) => header.includes(name)));
    if (hasCodeLike && hasNameLike) return i;
  }

  return -1;
}

function mappedHeaderLabel(preview: ImportPreview, names: string[]) {
  const index = findHeaderIndex(preview.normalizedHeaders, names);
  return index >= 0 ? preview.headers[index] || "Mapped" : "Not mapped";
}

function cellText(value: unknown) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value ?? "").trim();
}

function cellDate(value: unknown) {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = cellText(value);
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? text : parsed.toISOString().slice(0, 10);
}

function cellNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function mapEmployeeExcelRow(headers: string[], row: unknown[]) {
  const maximumPayout = cellNumber(findCell(headers, row, ["maximum payout", "max payout"])) ?? AIRFARE_DEFAULT_PAYOUT;
  const close2024Days = cellNumber(findCell(headers, row, ["close 2024 days", "airfare balance 2024", "opening days"])) ?? 0;
  const currentAirfareDays = cellNumber(findCell(headers, row, ["current airfare 2025", "current airfare"])) ?? 0;
  const paidDays = cellNumber(findCell(headers, row, ["airfare paid days 2025", "airfare paid days", "paid days"])) ?? 0;
  const importedClosingDays = cellNumber(findCell(headers, row, ["remaining balance 2025", "balance 2025", "closing balance days"]));
  const openingDays = Math.min(AIRFARE_MAX_DAYS, importedClosingDays ?? roundMoney(close2024Days + currentAirfareDays - paidDays));
  const importedTotalAirfare = cellNumber(findCell(headers, row, ["total airfare 2025", "closing balance bhd", "total airfare"]));
  const payrollStatus = cellText(findCell(headers, row, ["employeestatusgeneral", "employee status"])) || "Active";
  return {
    bankCode: cellText(findCell(headers, row, ["bankcodegeneral", "bankcode", "bank code"])),
    code: cellText(findCell(headers, row, [
      "codegeneral",
      "code",
      "employee code",
      "emp no",
      "employeeid",
      "employee id",
      "empid",
      "emp id",
      "payroll no",
      "payroll number",
      "payrollno",
      "id"
    ])),
    jobBand: cellText(findCell(headers, row, ["jobbandgeneral", "jobband", "job band"])),
    name: cellText(findCell(headers, row, [
      "namegeneralemployee",
      "full name",
      "employee name",
      "name",
      "fullname",
      "personname",
      "employee"
    ])),
    joinDate: cellDate(findCell(headers, row, ["dateofjoininggeneral", "date of joining", "join date"])),
    cpr: cellText(findCell(headers, row, ["nationalidentifierbahrainidgeneral", "cpr", "bahrain id"])),
    passport: cellText(findCell(headers, row, ["passportnumberpersonalinformation", "passport number"])),
    nationality: cellText(findCell(headers, row, ["nationalitypersonalinformation", "nationality"])),
    bhStatus: cellText(findCell(headers, row, ["bahraininationalgeneral", "bahraini national", "bahraini", "national status"])).toLowerCase().startsWith("y")
      ? "BH"
      : "NON-BH",
    company: cellText(findCell(headers, row, ["companygeneral", "company"])),
    department: cellText(findCell(headers, row, ["departmentgeneral", "department"])),
    section: cellText(findCell(headers, row, ["section"])),
    location: cellText(findCell(headers, row, ["locationgeneral", "location"])),
    designation: cellText(findCell(headers, row, ["designationgeneral", "designation"])),
    group: cellText(findCell(headers, row, ["paygroupgeneral", "pay group", "paygroup", "group"])),
    reportingTo: cellText(findCell(headers, row, ["reportingtogeneral", "reporting to"])),
    basicSalary: cellNumber(findCell(headers, row, ["basicact", "basic salary", "basic"])),
    hra: cellNumber(findCell(headers, row, ["hraact", "hra", "housing"])),
    specialDutyAllowance: cellNumber(findCell(headers, row, ["specialdutyallowanceact", "special duty allowance"])),
    carAllowance: cellNumber(findCell(headers, row, ["carallowanceact", "car allowance"])),
    petrolAllowance: cellNumber(findCell(headers, row, ["petrolallowanceact", "petrol allowance"])),
    phoneAllowance: cellNumber(findCell(headers, row, ["phoneallowanceact", "phone allowance"])),
    grossSalary: cellNumber(findCell(headers, row, ["grosssalary", "gross salary"])),
    gosiDeduction: cellNumber(findCell(headers, row, ["gosideductionact", "gosi deduction"])),
    religion: cellText(findCell(headers, row, ["religiongeneral", "religion"])),
    lastWorkingDate: cellDate(findCell(headers, row, ["lastworkingdategeneral", "last working date"])),
    payrollStatus,
    status: toEmployeeLifecycleStatus(payrollStatus),
    averageSalary: cellNumber(findCell(headers, row, ["averagesalary", "average salary"])),
    serialNo: cellNumber(findCell(headers, row, ["serialno", "serial no"])),
    accountNumber: cellText(findCell(headers, row, ["accountnumbergeneral", "account number"])),
    passportExpiryDate: cellDate(findCell(headers, row, ["passportexpirydatepersonalinformation", "passport expiry date"])),
    email: cellText(findCell(headers, row, ["emailcontactdetails", "email"])),
    branch: cellText(findCell(headers, row, ["branch"])) || cellText(findCell(headers, row, ["locationgeneral", "location"])),
    openingDays,
    openingBhd: importedTotalAirfare ?? roundMoney((maximumPayout / 60) * openingDays),
    airfarePaidDays: paidDays,
    maximumPayout,
    jan: 30,
    feb: 30,
    mar: 30,
    apr: 30,
    may: 30,
    jun: 30,
    jul: 30,
    aug: 30,
    sep: 30,
    oct: 30,
    nov: 30,
    dec: 30
  };
}

function mapOpeningBalanceExcelRow(headers: string[], row: unknown[], defaultYear: number) {
  const employeeCode = cellText(findCell(headers, row, ["employeeno", "employeno", "employee code", "emp no", "codegeneral"]));
  const maximumPayout = cellNumber(findCell(headers, row, ["maximum payout", "max payout"])) ?? AIRFARE_DEFAULT_PAYOUT;
  const openingDays = Math.min(
    AIRFARE_MAX_DAYS,
    cellNumber(findCell(headers, row, ["opening days", "opening balance days", "close 2024 days", "closing balance days", "remaining balance 2025"])) ?? 0
  );
  const importedOpeningBhd =
    cellNumber(findCell(headers, row, ["opening amount", "opening bhd", "opening balance bhd", "total airfare 2025", "closing balance bhd"]));
  return {
    employeeCode,
    employeeName: cellText(findCell(headers, row, ["name", "namegeneralemployee", "full name", "employee name"])),
    year: cellNumber(findCell(headers, row, ["year", "balance year", "opening year"])) ?? defaultYear,
    openingDays,
    importedOpeningBhd,
    openingBhd: roundMoney((maximumPayout / 60) * openingDays),
    maximumPayout
  };
}

const importMappingFields = [
  { label: "Employee Code", keys: ["codegeneral", "code", "employee code", "emp no", "employeeid", "employee id", "emp id", "payroll no"] },
  { label: "Full Name", keys: ["namegeneralemployee", "full name", "employee name", "name", "fullname", "personname"] },
  { label: "Join Date", keys: ["dateofjoininggeneral", "date of joining", "join date"] },
  { label: "Department", keys: ["departmentgeneral", "department"] },
  { label: "Branch", keys: ["branch", "locationgeneral", "location"] },
  { label: "Nationality", keys: ["nationalitypersonalinformation", "nationality"] },
  { label: "Designation", keys: ["designationgeneral", "designation"] },
  { label: "Pay Group", keys: ["paygroupgeneral", "pay group", "paygroup"] },
  { label: "Status", keys: ["employeestatusgeneral", "employee status"] },
  { label: "Email", keys: ["emailcontactdetails", "email"] }
];

const employeeExportColumns = [
  "BankCode[General]",
  "Code(General)",
  "Job Band(General)",
  "Name(General) Employee",
  "Date of Joining(General)",
  "National Identifier (Bahrain ID)(General)",
  "Passport Number(Personal Information)",
  "Nationality(Personal Information)",
  "Bahraini National[General]",
  "Company[General]",
  "Department(General)",
  "Section",
  "Location[General]",
  "Designation (General)",
  "Pay Group(General)",
  "Reporting To(General)",
  "Basic_Act",
  "HRA_Act",
  "Special Duty Allowance_Act",
  "Car Allowance_Act",
  "Petrol Allowance_Act",
  "Phone Allowance_Act",
  "Gross Salary ",
  "GOSI Deduction_Act",
  "Religion[General]",
  "Last Working Date[General]",
  "Employee Status[General]",
  "Average Salary",
  "Serial No",
  "Account Number[General]",
  "Passport Expiry Date[Personal Information]",
  "EMail[Contact Details]",
  "Opening Days",
  "Opening Amount"
];

function employeeToExportRow(employee: Employee) {
  return {
    "BankCode[General]": employee.BankCode || "",
    "Code(General)": employee.EmployeeCode,
    "Job Band(General)": employee.JobBand || "",
    "Name(General) Employee": employee.FullName,
    "Date of Joining(General)": formatExportDate(employee.JoinDate),
    "National Identifier (Bahrain ID)(General)": employee.CPR || "",
    "Passport Number(Personal Information)": employee.Passport || "",
    "Nationality(Personal Information)": employee.Nationality || "",
    "Bahraini National[General]": employee.CPR ? "Yes" : "No",
    "Company[General]": employee.Company || "",
    "Department(General)": employee.Department || "",
    Section: employee.Section || "",
    "Location[General]": employee.Location || "",
    "Designation (General)": employee.Designation || "",
    "Pay Group(General)": employee.EmpGroup || "",
    "Reporting To(General)": employee.ReportingTo || "",
    Basic_Act: employee.BasicSalary ?? "",
    HRA_Act: employee.HRA ?? "",
    "Special Duty Allowance_Act": employee.SpecialDutyAllowance ?? "",
    "Car Allowance_Act": employee.CarAllowance ?? "",
    "Petrol Allowance_Act": employee.PetrolAllowance ?? "",
    "Phone Allowance_Act": employee.PhoneAllowance ?? "",
    "Gross Salary ": employee.GrossSalary ?? "",
    "GOSI Deduction_Act": employee.GOSIDeduction ?? "",
    "Religion[General]": employee.Religion || "",
    "Last Working Date[General]": formatExportDate(employee.LastWorkingDate),
    "Employee Status[General]": employee.PayrollStatus || employee.Status || "",
    "Average Salary": employee.AverageSalary ?? "",
    "Serial No": employee.SerialNo ?? "",
    "Account Number[General]": employee.AccountNumber || "",
    "Passport Expiry Date[Personal Information]": formatExportDate(employee.PassportExpiryDate),
    "EMail[Contact Details]": employee.Email || "",
    "Opening Days": closingBalanceDays(employee),
    "Opening Amount": calculateExcelTotal(employee)
  };
}

function formatExportDate(value: unknown) {
  return value ? String(value).slice(0, 10) : "";
}

function formatReportDate(value: unknown) {
  const isoDate = formatExportDate(value);
  if (!isoDate) return "";
  const [year, month, day] = isoDate.split("-");
  return year && month && day ? `${day}/${month}/${year}` : isoDate;
}

async function exportRowsToExcel(fileName: string, columns: string[], rows: Array<Record<string, unknown>>) {
  const header = columns.map((column) => ({ value: column, fontWeight: "bold", backgroundColor: "#EFF6FF" }));
  const body = rows.map((row) => columns.map((column) => ({ value: row[column] ?? "" })));
  const file = writeXlsxFile([header, ...body] as never);
  await file.toFile(fileName);
}

function printPremiumReport(title: string, rows: Array<Record<string, unknown>>, columns: string[], company?: Company, logoUrl = "") {
  const popup = window.open("", "_blank", "width=1100,height=900");
  if (!popup) return;
  const companyName = company?.CompanyName || "ATLAS";
  const companyCode = company?.CompanyCode || "Airfare HCM";
  const bodyRows = rows.length ? rows : [{ [columns[0] || "Status"]: "No rows available" }];
  const safeColumns = rows.length ? columns : [columns[0] || "Status"];
  popup.document.write(`
    <html>
      <head>
        <title>${escapeHtml(title)}</title>
        <style>
          @page { size: A4 landscape; margin: 12mm; }
          * { box-sizing: border-box; }
          body { margin: 0; color: #0f172a; font-family: "Segoe UI", Arial, sans-serif; background: #f8fafc; }
          .sheet { min-height: 100vh; padding: 28px; background: #ffffff; border: 1px solid #e2e8f0; }
          .head { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 22px; align-items: center; padding-bottom: 20px; border-bottom: 4px solid #155eef; }
          .brand { display: flex; align-items: center; gap: 14px; }
          .logo { width: 56px; height: 56px; display: grid; place-items: center; border-radius: 12px; color: #fff; font-weight: 900; background: linear-gradient(135deg, #155eef, #0891b2); overflow: hidden; }
          .logo img { width: 100%; height: 100%; object-fit: contain; background: #fff; padding: 5px; }
          h1 { margin: 0; font-size: 28px; }
          p { margin: 4px 0 0; color: #64748b; }
          .meta { padding: 12px 14px; border-radius: 10px; background: #eff6ff; border: 1px solid #bfdbfe; text-align: right; }
          .meta strong { display: block; }
          .summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin: 20px 0; }
          .summary span { padding: 14px; border-radius: 10px; background: #f8fbff; border: 1px solid #e2e8f0; }
          .summary small { display: block; color: #64748b; font-size: 11px; font-weight: 800; text-transform: uppercase; }
          .summary b { display: block; margin-top: 5px; font-size: 20px; }
          table { width: 100%; border-collapse: separate; border-spacing: 0; overflow: hidden; border: 1px solid #e2e8f0; border-radius: 12px; }
          th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid #e2e8f0; font-size: 12px; vertical-align: top; }
          th { color: #334155; background: #eef4ff; font-size: 11px; font-weight: 900; text-transform: uppercase; letter-spacing: .06em; }
          tr:nth-child(even) td { background: #f8fafc; }
          tr:last-child td { border-bottom: 0; }
          .footer { margin-top: 18px; color: #94a3b8; font-size: 11px; }
          @media print { body { background: #fff; } .sheet { border: 0; padding: 0; } }
        </style>
      </head>
      <body>
        <div class="sheet">
          <div class="head">
            <div class="brand">
              <div class="logo">${logoUrl ? `<img src="${logoUrl}" alt="${escapeHtml(companyName)} logo" />` : escapeHtml(companyName.slice(0, 2).toUpperCase())}</div>
              <div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(companyName)} / ${escapeHtml(companyCode)}</p></div>
            </div>
            <div class="meta"><strong>${escapeHtml(new Date().toLocaleDateString())}</strong><p>${bodyRows.length} row(s)</p></div>
          </div>
          <div class="summary">
            <span><small>Report</small><b>${escapeHtml(title)}</b></span>
            <span><small>Rows</small><b>${bodyRows.length}</b></span>
            <span><small>Company</small><b>${escapeHtml(companyCode)}</b></span>
            <span><small>Generated</small><b>${escapeHtml(new Date().toLocaleTimeString())}</b></span>
          </div>
          <table>
            <thead><tr>${safeColumns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}</tr></thead>
            <tbody>
              ${bodyRows.map((row) => `<tr>${safeColumns.map((column) => `<td>${escapeHtml(row[column] ?? "")}</td>`).join("")}</tr>`).join("")}
            </tbody>
          </table>
          <div class="footer">Generated by ATLAS Airfare HCM for review, approval, and payroll reconciliation.</div>
        </div>
        <script>window.print();</script>
      </body>
    </html>
  `);
  popup.document.close();
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function loadCanvasImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

function drawWrappedCanvasText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number
) {
  const words = String(text || "-").split(/\s+/);
  let line = "";
  let lineCount = 0;
  for (const word of words) {
    const testLine = line ? `${line} ${word}` : word;
    if (ctx.measureText(testLine).width > maxWidth && line) {
      lineCount += 1;
      if (lineCount >= maxLines) {
        ctx.fillText(`${line.slice(0, Math.max(0, line.length - 3))}...`, x, y);
        return;
      }
      ctx.fillText(line, x, y);
      line = word;
      y += lineHeight;
    } else {
      line = testLine;
    }
  }
  if (line && lineCount < maxLines) ctx.fillText(line, x, y);
}

function printAllocationLetter(employee: Employee, allocation: Allocation | null, payload: Record<string, unknown>) {
  const popup = window.open("", "_blank", "width=900,height=1100");
  if (!popup) return;
  const companyName = String(payload.companyName || "ATLAS");
  const companyCode = String(payload.companyCode || "Airfare HCM");
  const logoUrl = String(payload.companyLogoUrl || "");
  const rawPaymentMode = String(payload.paymentMode || "-");
  const paymentMode = paymentModeLabels[rawPaymentMode] || rawPaymentMode.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
  const documentNo = allocation?.AllocationID || "Preview";
  const documentDate = String(payload.date || today);
  const allocationYear = String(payload.year || "-");
  const ticketCost = Number(payload.ticketCost) || 0;
  const entitlement = Number(payload.entitlement) || 0;
  const entitlementApplied = Number(payload.entitlementApplied ?? payload.companyPaid ?? 0) || 0;
  const balanceAmount = Number(payload.balanceAmount ?? payload.excess ?? 0) || 0;
  const companyPayable = Number(payload.companyPaid) || 0;
  const companyBalance = Number(payload.companyBalancePayAmount) || Math.max(0, companyPayable - entitlementApplied);
  const employeePaid = Number(payload.employeePaid) || 0;
  const loanAmount = Number(payload.loanAmount) || 0;
  const tenure = Number(payload.tenure) || 0;
  const emi = Number(payload.emi) || 0;
  const currentAmount = Math.max(0, entitlement - (Number(employee.OpeningBHD) || 0));
  const policyResult = entitlement >= ticketCost && ticketCost > 0
    ? "Entitlement is sufficient. Company can close the ticket without self-pay or loan."
    : balanceAmount > 0
      ? "Balance is outside current entitlement. Finance may mark it as company-paid, employee self-pay, or convert it to loan EMI."
      : "Ready for payroll reconciliation.";
  const decisionLabel = rawPaymentMode === "loan"
    ? "Loan conversion"
    : rawPaymentMode === "employee"
      ? "Employee self payment"
      : rawPaymentMode === "employee_full"
        ? "Full employee self payment"
      : rawPaymentMode === "company_full"
        ? "Full company payment"
      : rawPaymentMode === "company"
        ? "Company balance payment"
        : "Use entitlement";
  const logoMarkup = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(companyName)} logo" />`
    : escapeHtml(companyName.slice(0, 2).toUpperCase());
  const printableRemarks = String(payload.remarks || "")
    .split("|")
    .map((part) => part.trim())
    .filter((part) => part && !/^ticket:/i.test(part) && !/^invoice:/i.test(part))
    .join(" | ");
  const remarkValue = (label: string) => {
    const match = String(payload.remarks || "").split("|").map((part) => part.trim()).find((part) => part.toLowerCase().startsWith(`${label.toLowerCase()}:`));
    return match ? match.split(":").slice(1).join(":").trim() : "";
  };
  const route = remarkValue("Route") || "-";
  const supplier = remarkValue("Supplier") || "-";
  const footerParts = [
    String(payload.companyAddress || "").trim(),
    String(payload.companyTrn || "").trim() ? `CR: ${String(payload.companyTrn).trim()}` : "",
    String(payload.companyPhone || "").trim() ? `Tel: ${String(payload.companyPhone).trim()}` : "",
    String(payload.companyEmail || "").trim() ? `Email: ${String(payload.companyEmail).trim()}` : ""
  ].filter(Boolean);
  popup.document.write(`
    <html>
      <head>
        <title>Airfare Allocation ${escapeHtml(employee.EmployeeCode)}</title>
        <style>
          @page { size: A4; margin: 11mm 12mm; }
          * { box-sizing: border-box; }
          body {
            margin: 0;
            color: #111827;
            font-family: Arial, "Segoe UI", sans-serif;
            background: #ffffff;
          }
          .sheet {
            position: relative;
            min-height: 275mm;
            padding: 18mm 12mm 12mm;
            overflow: hidden;
            background: #ffffff;
          }
          .sheet:before {
            content: "${escapeHtml(companyCode)}";
            position: absolute;
            inset: 0;
            display: grid;
            place-items: center;
            color: rgba(15, 23, 42, .035);
            font-size: 74px;
            font-weight: 900;
            letter-spacing: 10px;
            transform: rotate(-34deg);
            pointer-events: none;
          }
          .content { position: relative; z-index: 1; }
          .header {
            display: grid;
            grid-template-columns: 210px minmax(0, 1fr) 210px;
            align-items: start;
            gap: 18px;
            min-height: 126px;
          }
          .company-block {
            display: grid;
            justify-items: center;
            gap: 8px;
            text-align: center;
          }
          .logo {
            width: 88px;
            height: 88px;
            display: grid;
            place-items: center;
            color: #0f766e;
            border: 1px solid #d1d5db;
            background: #ffffff;
            font-size: 24px;
            font-weight: 900;
            overflow: hidden;
          }
          .logo img {
            width: 100%;
            height: 100%;
            object-fit: contain;
          }
          .company-name {
            color: #0f172a;
            font-size: 19px;
            font-weight: 900;
            line-height: 1.15;
          }
          .company-code {
            color: #334155;
            font-size: 13px;
            font-weight: 800;
          }
          .title-block {
            padding-top: 42px;
            text-align: center;
          }
          .title-block h1 {
            margin: 0;
            color: #000000;
            font-family: Georgia, "Times New Roman", serif;
            font-size: 25px;
            line-height: 1.05;
          }
          .title-block h2 {
            margin: 7px 0 0;
            color: #111827;
            font-family: Georgia, "Times New Roman", serif;
            font-size: 17px;
            line-height: 1.1;
          }
          .doc-status {
            justify-self: end;
            min-width: 170px;
            margin-top: 42px;
            padding: 8px 10px;
            border: 1px solid #d1d5db;
            color: #111827;
            font-size: 12px;
            font-weight: 800;
            text-align: center;
            background: rgba(255,255,255,.86);
          }
          .details {
            display: grid;
            grid-template-columns: minmax(0, 1.35fr) minmax(0, .95fr);
            gap: 34px;
            margin-top: 20px;
          }
          .field-list {
            display: grid;
            gap: 13px;
          }
          .field {
            display: grid;
            grid-template-columns: 142px 12px minmax(0, 1fr);
            gap: 8px;
            align-items: baseline;
            min-height: 20px;
            font-size: 14px;
          }
          .field b {
            font-weight: 900;
          }
          .field span {
            overflow-wrap: anywhere;
          }
          .spacer { height: 24px; }
          .summary-table {
            width: 86%;
            margin: 74px auto 0;
            border-collapse: collapse;
            table-layout: fixed;
            font-size: 12px;
          }
          .summary-table th {
            padding: 7px 5px;
            border: 2px solid #111827;
            color: #111827;
            background: #d9d9d9;
            font-weight: 900;
            text-align: left;
          }
          .summary-table td {
            padding: 7px 5px;
            border: 2px solid #111827;
            background: #ffffff;
            text-align: right;
          }
          .summary-table td:first-child {
            text-align: left;
          }
          .remarks-block {
            margin: 48px 0 0 34px;
            font-size: 13px;
            font-weight: 900;
          }
          .generated-note {
            margin-top: 110px;
            text-align: center;
            font-family: Georgia, "Times New Roman", serif;
            font-size: 14px;
            font-weight: 900;
          }
          .prepared {
            margin: 14px 0 0 40px;
            display: grid;
            gap: 10px;
            width: 180px;
            text-align: center;
            font-size: 12px;
          }
          .prepared span:first-child {
            text-align: left;
          }
          .footer {
            position: absolute;
            left: 12mm;
            right: 12mm;
            bottom: 10mm;
            z-index: 1;
            color: #111827;
            font-size: 12px;
            text-align: center;
            line-height: 1.45;
          }
          @media print {
            body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
            .sheet { padding-top: 8mm; min-height: auto; }
          }
        </style>
      </head>
      <body>
        <div class="sheet">
          <div class="content">
            <div class="header">
              <div class="company-block">
                <div class="logo">${logoMarkup}</div>
                <div>
                  <div class="company-name">${escapeHtml(companyName)}</div>
                  <div class="company-code">${escapeHtml(companyCode)}</div>
                </div>
              </div>
              <div class="title-block">
                <h1>Airfare Allocation</h1>
                <h2>${escapeHtml(paymentMode)}</h2>
              </div>
              <div class="doc-status">Status : ${allocation ? "PROCESSED" : "PREVIEW"}</div>
            </div>

            <div class="details">
              <div class="field-list">
                <div class="field"><b>Document Number</b><b>:</b><span>${escapeHtml(documentNo)}</span></div>
                <div class="field"><b>Employee ID No.</b><b>:</b><span>${escapeHtml(employee.EmployeeCode)}</span></div>
                <div class="field"><b>Employee</b><b>:</b><span>${escapeHtml(employee.FullName)}</span></div>
                <div class="field"><b>Date of Joining</b><b>:</b><span>${escapeHtml(formatReportDate(employee.JoinDate))}</span></div>
                <div class="field"><b>CPR No.</b><b>:</b><span>${escapeHtml(employee.CPR || "-")}</span></div>
                <div class="field"><b>Nationality</b><b>:</b><span>${escapeHtml(employee.Nationality || "-")}</span></div>
                <div class="field"><b>Designation</b><b>:</b><span>${escapeHtml(employee.Designation || "-")}</span></div>
                <div class="field"><b>Department</b><b>:</b><span>${escapeHtml(employee.Department || "-")}</span></div>
                <div class="field"><b>Location</b><b>:</b><span>${escapeHtml(employee.Location || employee.Branch || "-")}</span></div>
                <div class="field"><b>Reporting To</b><b>:</b><span>${escapeHtml(employee.ReportingTo || "-")}</span></div>
                <div class="field"><b>Route</b><b>:</b><span>${escapeHtml(route)}</span></div>
                <div class="field"><b>Supplier</b><b>:</b><span>${escapeHtml(supplier)}</span></div>
              </div>
              <div class="field-list">
                <div class="field"><b>Date</b><b>:</b><span>${escapeHtml(formatReportDate(documentDate))}</span></div>
                <div class="field"><b>Year</b><b>:</b><span>${escapeHtml(allocationYear)}</span></div>
                <div class="field"><b>Payment Type</b><b>:</b><span>${escapeHtml(paymentMode)}</span></div>
                <div class="field"><b>Ticket Amount</b><b>:</b><span>${money.format(ticketCost)}</span></div>
                <div class="field"><b>Eligibility Amount</b><b>:</b><span>${money.format(entitlement)}</span></div>
                <div class="field"><b>Company Paid</b><b>:</b><span>${money.format(companyPayable)}</span></div>
                <div class="field"><b>Employee Paid</b><b>:</b><span>${money.format(employeePaid)}</span></div>
                <div class="field"><b>Loan Amount</b><b>:</b><span>${money.format(loanAmount)}</span></div>
                <div class="field"><b>EMI / Tenure</b><b>:</b><span>${loanAmount > 0 ? `${money.format(emi)} / ${tenure} month(s)` : "-"}</span></div>
                <div class="field"><b>Status</b><b>:</b><span>${allocation ? "PROCESSED" : "PREVIEW"}</span></div>
              </div>
            </div>

            <table class="summary-table">
              <thead>
                <tr>
                  <th>Particulars</th>
                  <th>Ticket Amount</th>
                  <th>Eligibility</th>
                  <th>Company Paid</th>
                  <th>Employee Paid</th>
                  <th>Loan</th>
                  <th>Balance</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Airfare Allocation</td>
                  <td>${ticketCost.toFixed(2)}</td>
                  <td>${entitlement.toFixed(2)}</td>
                  <td>${companyPayable.toFixed(2)}</td>
                  <td>${employeePaid.toFixed(2)}</td>
                  <td>${loanAmount.toFixed(2)}</td>
                  <td>${balanceAmount.toFixed(2)}</td>
                </tr>
                <tr>
                  <td>Company Balance Pay</td>
                  <td>0.00</td>
                  <td>0.00</td>
                  <td>${companyBalance.toFixed(2)}</td>
                  <td>0.00</td>
                  <td>0.00</td>
                  <td>${Math.max(0, balanceAmount - companyBalance - employeePaid - loanAmount).toFixed(2)}</td>
                </tr>
              </tbody>
            </table>

            <div class="remarks-block">Approvals Remark:- ${escapeHtml(printableRemarks || "-")}</div>
            <div class="generated-note">*** This is computer-generated document. No signature is required, ***</div>
            <div class="prepared">
              <span>Prepared by</span>
              <span>${escapeHtml(payload.preparedBy || "System")}</span>
            </div>
          </div>
          <div class="footer">${escapeHtml(footerParts.join(" | ") || `${companyName} | ${companyCode}`)}</div>
        </div>
        <script>window.print();</script>
      </body>
    </html>
  `);
  popup.document.close();
  return;
  /*
  popup.document.write(`
    <html>
      <head>
        <title>Airfare Allocation ${employee.EmployeeCode}</title>
        <style>
          @page { size: A4; margin: 12mm; }
          * { box-sizing: border-box; }
          body {
            margin: 0;
            color: #0f172a;
            font-family: "Segoe UI", Arial, sans-serif;
            background: #eef4ff;
          }
          .sheet {
            min-height: 100vh;
            padding: 26px;
            background:
              radial-gradient(circle at top right, rgba(21,94,239,.14), transparent 250px),
              linear-gradient(180deg, #ffffff 0%, #f8fbff 100%);
            border: 1px solid #e2e8f0;
            border-radius: 18px;
          }
          .executive-head {
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto;
            gap: 22px;
            align-items: stretch;
            padding: 22px;
            border-radius: 18px;
            color: #ffffff;
            background: linear-gradient(135deg, #07142f 0%, #0f3c88 56%, #0891b2 100%);
            box-shadow: 0 20px 55px rgba(15, 23, 42, .18);
          }
          .brand {
            display: flex;
            align-items: flex-start;
            gap: 16px;
          }
          .logo {
            width: 68px;
            height: 68px;
            display: grid;
            place-items: center;
            flex: 0 0 auto;
            border-radius: 18px;
            color: #ffffff;
            font-size: 24px;
            font-weight: 900;
            background: rgba(255, 255, 255, .16);
            border: 1px solid rgba(255, 255, 255, .34);
            overflow: hidden;
          }
          .logo img {
            width: 100%;
            height: 100%;
            object-fit: contain;
            background: #ffffff;
            padding: 7px;
          }
          .eyebrow, .section-title, .label {
            font-size: 10px;
            font-weight: 900;
            letter-spacing: .12em;
            text-transform: uppercase;
          }
          .eyebrow { color: #bae6fd; margin-bottom: 10px; }
          h1 {
            margin: 0;
            color: #ffffff;
            font-size: 31px;
            line-height: 1.05;
            letter-spacing: 0;
          }
          .subtitle {
            margin: 8px 0 0;
            color: #dbeafe;
            font-size: 13px;
          }
          .decision-pill {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            margin-top: 16px;
            padding: 9px 12px;
            border-radius: 999px;
            color: #ecfeff;
            background: rgba(8, 145, 178, .3);
            border: 1px solid rgba(186, 230, 253, .4);
            font-size: 12px;
            font-weight: 800;
          }
          .docbox {
            min-width: 190px;
            padding: 16px;
            border-radius: 16px;
            background: rgba(255,255,255,.12);
            border: 1px solid rgba(255,255,255,.28);
            backdrop-filter: blur(8px);
          }
          .docbox span, .label {
            display: block;
            color: #bfdbfe;
          }
          .docbox strong {
            display: block;
            margin: 5px 0 13px;
            color: #ffffff;
            font-size: 16px;
          }
          .body-grid {
            display: grid;
            grid-template-columns: 1fr;
            gap: 14px;
            margin-top: 18px;
          }
          .panel {
            padding: 16px;
            border-radius: 16px;
            background: rgba(255,255,255,.86);
            border: 1px solid #dbe5f5;
            box-shadow: 0 14px 40px rgba(15, 23, 42, .08);
          }
          .section-title {
            margin: 0 0 12px;
            color: #334155;
          }
          .info-grid {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 12px;
          }
          .info-card, .amount-card {
            min-height: 82px;
            padding: 15px;
            border: 1px solid #e2e8f0;
            border-radius: 12px;
            background: #ffffff;
          }
          .info-card small, .amount-card small {
            display: block;
            color: #64748b;
            font-size: 10px;
            font-weight: 900;
            letter-spacing: .07em;
            text-transform: uppercase;
            margin-bottom: 8px;
          }
          .info-card strong {
            display: block;
            color: #0f172a;
            font-size: 14px;
            line-height: 1.35;
            overflow-wrap: anywhere;
          }
          .amount-grid {
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 12px;
          }
          .amount-card {
            min-height: 102px;
            background: #f8fbff;
          }
          .amount-card.highlight {
            background: linear-gradient(135deg, #eff6ff, #ecfeff);
            border-color: #bfdbfe;
          }
          .amount-card strong {
            display: block;
            color: #0f172a;
            font-size: 24px;
            line-height: 1.2;
            overflow-wrap: anywhere;
          }
          .amount-card em {
            display: block;
            margin-top: 8px;
            color: #64748b;
            font-size: 11px;
            font-style: normal;
            line-height: 1.35;
          }
          .summary {
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto;
            gap: 18px;
            align-items: center;
            margin-top: 18px;
            padding: 18px;
            border-radius: 12px;
            color: #ffffff;
            background: linear-gradient(135deg, #155eef, #0891b2);
          }
          .summary span {
            display: block;
            color: rgba(255,255,255,.78);
            font-size: 12px;
            font-weight: 800;
            letter-spacing: .08em;
            text-transform: uppercase;
          }
          .summary strong {
            display: block;
            margin-top: 4px;
            font-size: 26px;
          }
          .matrix {
            width: 100%;
            border-collapse: separate;
            border-spacing: 0 8px;
            margin-top: 6px;
          }
          .matrix th {
            color: #64748b;
            font-size: 10px;
            font-weight: 900;
            letter-spacing: .09em;
            text-align: left;
            text-transform: uppercase;
          }
          .matrix td {
            padding: 11px 12px;
            color: #0f172a;
            font-size: 12px;
            font-weight: 700;
            background: #f8fbff;
            border-top: 1px solid #e2e8f0;
            border-bottom: 1px solid #e2e8f0;
          }
          .matrix td:first-child { border-left: 1px solid #e2e8f0; border-radius: 10px 0 0 10px; }
          .matrix td:last-child { border-right: 1px solid #e2e8f0; border-radius: 0 10px 10px 0; }
          .intelligence {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 10px;
          }
          .insight {
            padding: 13px;
            border-radius: 12px;
            background: #f8fbff;
            border: 1px solid #e2e8f0;
          }
          .insight strong {
            display: block;
            margin-top: 5px;
            font-size: 13px;
            line-height: 1.45;
          }
          .chips {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            grid-column: 1 / -1;
            margin-top: 2px;
          }
          .chip {
            padding: 7px 9px;
            border-radius: 999px;
            color: #075985;
            background: #e0f2fe;
            font-size: 10px;
            font-weight: 800;
          }
          .workflow {
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 10px;
            margin-top: 12px;
          }
          .step {
            display: grid;
            grid-template-columns: 22px minmax(0, 1fr);
            gap: 10px;
            align-items: start;
            color: #334155;
            font-size: 11px;
            padding: 10px;
            border: 1px solid #e2e8f0;
            border-radius: 12px;
            background: #f8fbff;
          }
          .dot {
            width: 22px;
            height: 22px;
            display: grid;
            place-items: center;
            border-radius: 999px;
            color: #ffffff;
            background: #155eef;
            font-size: 11px;
            font-weight: 900;
          }
          .remarks {
            margin-top: 14px;
            padding: 15px;
            border-radius: 12px;
            color: #475569;
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            font-size: 12px;
          }
          .sign {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 64px;
            margin-top: 44px;
          }
          .line {
            border-top: 1px solid #0f172a;
            padding-top: 12px;
            color: #334155;
            font-size: 13px;
          }
          .footer {
            display: flex;
            justify-content: space-between;
            gap: 14px;
            margin-top: 26px;
            padding-top: 14px;
            border-top: 1px solid #e2e8f0;
            color: #94a3b8;
            font-size: 11px;
          }
          @media print {
            body { background: #ffffff; }
            .sheet { border: 0; border-radius: 0; padding: 0; box-shadow: none; }
            .panel, .executive-head { box-shadow: none; }
            .panel { break-inside: avoid; }
          }
        </style>
      </head>
      <body>
        <div class="sheet">
          <div class="executive-head">
            <div class="brand">
              <div class="logo">${logoMarkup}</div>
              <div>
                <div class="eyebrow">Enterprise approval packet</div>
                <h1>Airfare Allocation Approval</h1>
                <p class="subtitle">${escapeHtml(companyName)} / ${escapeHtml(companyCode)} &bull; Finance controlled employee benefit document</p>
                <div class="decision-pill">AI eligibility check: ${escapeHtml(decisionLabel)}</div>
              </div>
            </div>
            <div class="docbox">
              <span>Document No.</span>
              <strong>${escapeHtml(documentNo)}</strong>
              <span>Document Date</span>
              <strong>${escapeHtml(documentDate)}</strong>
              <span>Year</span>
              <strong>${escapeHtml(allocationYear)}</strong>
            </div>
          </div>

          <div class="body-grid">
            <div>
              <div class="panel">
                <div class="section-title">Airfare approval details</div>
                <div class="info-grid">
                  <div class="info-card"><small>Employee name</small><strong>${escapeHtml(employee.EmployeeCode)} - ${escapeHtml(employee.FullName)}</strong></div>
                  <div class="info-card"><small>Department</small><strong>${escapeHtml(employee.Department || "-")}</strong></div>
                  <div class="info-card"><small>Paid by / Mode</small><strong>${escapeHtml(paymentMode)}</strong></div>
                </div>
              </div>

              <div class="panel" style="margin-top:18px;">
                <div class="section-title">Amount calculation</div>
                <div class="amount-grid">
                  <div class="amount-card"><small>Ticket amount</small><strong>${money.format(ticketCost)}</strong><em>Total airfare ticket cost.</em></div>
                  <div class="amount-card highlight"><small>Eligibility amount</small><strong>${money.format(entitlement)}</strong><em>Opening balance + current year earned - paid.</em></div>
                  <div class="amount-card"><small>Company paid</small><strong>${money.format(companyPayable)}</strong><em>Amount approved to pay by company.</em></div>
                  <div class="amount-card"><small>Loan / self paid</small><strong>${money.format(loanAmount || employeePaid || balanceAmount)}</strong><em>${loanAmount > 0 ? "Converted to employee loan." : employeePaid > 0 ? "Paid by employee." : balanceAmount > 0 ? "Balance awaiting decision." : "No excess balance."}</em></div>
                </div>

                <div class="summary">
                  <div>
                    <span>Final company payable</span>
                    <strong>${money.format(companyPayable)}</strong>
                  </div>
                  <div>${escapeHtml(paymentMode)}</div>
                </div>
              </div>

              <div class="panel" style="margin-top:18px;">
                <div class="section-title">Payment decision</div>
                <table class="matrix">
                  <thead>
                    <tr><th>Field</th><th>Amount</th><th>Intelligence note</th></tr>
                  </thead>
                  <tbody>
                    <tr><td>Ticket amount - eligibility amount</td><td>${money.format(balanceAmount)}</td><td>${escapeHtml(policyResult)}</td></tr>
                    <tr><td>Loan amount</td><td>${money.format(loanAmount)}</td><td>${tenure ? `${tenure} month EMI at ${money.format(emi)}` : "Loan not selected."}</td></tr>
                    <tr><td>Paid by employee</td><td>${money.format(employeePaid)}</td><td>Use when employee pays the excess directly.</td></tr>
                    <tr><td>Additional company paid</td><td>${money.format(companyBalance)}</td><td>Use only when company approves excess above eligibility.</td></tr>
                  </tbody>
                </table>
                ${printableRemarks ? `<div class="remarks"><strong>Remarks:</strong> ${escapeHtml(printableRemarks)}</div>` : ""}
              </div>
            </div>

            <div>
              <div class="panel intelligence">
                <div class="section-title" style="grid-column:1/-1;">Intelligence thinking</div>
          <div class="insight"><span class="label">Eligibility formula</span><strong>Eligibility amount = opening balance + current year earned - paid airfare, capped at maximum payout.</strong></div>
                <div class="insight"><span class="label">Difference</span><strong>Ticket amount ${money.format(ticketCost)} - eligibility ${money.format(entitlement)} = ${money.format(balanceAmount)}.</strong></div>
                <div class="insight"><span class="label">Recommendation</span><strong>${escapeHtml(policyResult)}</strong></div>
                <div class="chips">
                  <span class="chip">SQL validated</span>
                  <span class="chip">Audit trail ready</span>
                  <span class="chip">Formula controlled</span>
                  <span class="chip">Payroll review</span>
                </div>
              </div>

              <div class="panel" style="margin-top:18px;">
                <div class="section-title">Approval Workflow</div>
                <div class="workflow">
                  <div class="step"><span class="dot">1</span><div><strong>Prepared</strong><br />HR records employee ticket and attachment.</div></div>
                  <div class="step"><span class="dot">2</span><div><strong>Eligibility Review</strong><br />ATLAS confirms available entitlement and balance.</div></div>
                  <div class="step"><span class="dot">3</span><div><strong>Finance Decision</strong><br />Company pay, self-pay, or loan EMI is selected.</div></div>
                  <div class="step"><span class="dot">4</span><div><strong>Approval</strong><br />Document is ready for payroll reconciliation.</div></div>
                </div>
              </div>
            </div>
          </div>

          <div class="sign">
            <div class="line">Prepared by</div>
            <div class="line">Approved by</div>
          </div>

          <div class="footer">
            <span>Generated by ATLAS Airfare HCM. System document for internal approval and payroll reconciliation.</span>
            <span>${escapeHtml(new Date().toLocaleString())}</span>
          </div>
        </div>
        <script>window.print();</script>
      </body>
    </html>
  `);
  popup.document.close();
  */
}

