export type Employee = {
  EmployeeID: number;
  EmployeeCode: string;
  FullName: string;
  WhatsAppNumber?: string;
  JoinDate?: string;
  BankCode?: string;
  JobBand?: string;
  Department?: string;
  Branch?: string;
  Company?: string;
  Nationality?: string;
  CPR?: string;
  Passport?: string;
  BHStatus?: string;
  Section?: string;
  Location?: string;
  Designation?: string;
  EmpGroup?: string;
  ReportingTo?: string;
  BasicSalary?: number;
  HRA?: number;
  SpecialDutyAllowance?: number;
  CarAllowance?: number;
  PetrolAllowance?: number;
  PhoneAllowance?: number;
  GrossSalary?: number;
  GOSIDeduction?: number;
  Religion?: string;
  LastWorkingDate?: string;
  PayrollStatus?: string;
  AverageSalary?: number;
  SerialNo?: number;
  AccountNumber?: string;
  PassportExpiryDate?: string;
  Email?: string;
  Status: string;
  OpeningDays?: number;
  OpeningBHD?: number;
  ClosingBalanceDays?: number;
  ClosingBalanceBHD?: number;
  CurrentAirfareRate?: number;
  AirfarePaidDays?: number;
  RemainingBalance?: number;
  MaximumPayout?: number;
  TotalAirfare?: number;
  TotalWorkingDays?: number;
};

export type Loan = {
  LoanID: number;
  EmployeeID: number;
  AllocationID?: number;
  EmployeeCode: string;
  FullName: string;
  Department?: string;
  Branch?: string;
  OriginalAmount: number;
  RemainingBalance: number;
  EMI: number;
  Tenure: number;
  MonthsPaid: number;
  MonthsLeft?: number;
  TotalPaid: number;
  PaidPercent?: number;
  Status: string;
  DeferMonths?: number;
  DeferStart?: string;
  CreatedDate?: string;
  SettledDate?: string;
  EstimatedCloseDate?: string;
};

export type LoanSummary = {
  TotalLoans: number;
  ActiveLoans: number;
  SettledLoans: number;
  DeferredLoans: number;
  TotalOriginal: number;
  TotalOutstanding: number;
  MonthlyDeduction: number;
  TotalRecovered: number;
};

export type Allocation = {
  AllocationID: number;
  EmployeeID: number;
  EmployeeCode: string;
  FullName: string;
  AllocationDate?: string;
  TicketCost: number;
  Entitlement?: number;
  CompanyPaid: number;
  ExcessAmount: number;
  AllocYear: number;
  PaymentMode: string;
  LoanAmount?: number;
  EmployeePaid?: number;
  CompanyExtra?: number;
  PolicyRateID?: number;
  PolicyEffectiveFrom?: string;
  PolicyMaxPayoutAmount?: number;
  PolicyCycleDays?: number;
  PolicyPerDayRate?: number;
  EMI?: number;
  Tenure?: number;
  LeaveStart?: string;
  LeaveEnd?: string;
  Remarks?: string;
  SelfServiceRequestID?: number;
  SelfServiceRequestNo?: string;
  SelfServiceApprovalStatus?: string;
  SelfServiceOrigin?: string;
  SelfServiceDestination?: string;
};

export type AllocationAttachment = {
  AttachmentID: number;
  AllocationID: number;
  FileName: string;
  MimeType: string;
  FileSize: number;
  CreatedAt?: string;
};

export type AllocationEligibilityReview = {
  EmployeeID: number;
  AllocYear: number;
  AllocationDate?: string;
  PreviousAllocationDate?: string;
  OpeningBalanceAmount: number;
  OpeningBalanceDays: number;
  CurrentYearEarnedDays: number;
  CurrentYearEarnedAmount: number;
  AlreadyPaidDays: number;
  AlreadyPaidAmount: number;
  CurrentYearRemaining: number;
  TotalAvailableFunds: number;
  EligibleBalanceDays: number;
  AirfareEntitlementAmount: number;
  CurrentYearEntitlementBasis: number;
  PerDayRate: number;
  MaximumPayout: number;
  PolicyRateID?: number;
  PolicyEffectiveFrom?: string;
  PolicyEffectiveTo?: string;
  PolicyCycleDays?: number;
  PolicyPerDayRate?: number;
  CurrentYearSpending: number;
};

export type AirfarePolicyRate = {
  PolicyRateID: number;
  CompanyID?: number;
  CompanyName?: string;
  EmployeeID?: number;
  EmployeeCode?: string;
  FullName?: string;
  Department?: string;
  EmpGroup?: string;
  EffectiveFrom: string;
  EffectiveTo?: string;
  MaxPayoutAmount: number;
  CycleDays: number;
  WorkingDaysPerMonth: number;
  AirfareDaysPerMonth: number;
  PerDayRate: number;
  IsActive: boolean;
  CreatedAt?: string;
  IsDeleted?: boolean;
  PolicyStatus?: string;
  DeletedAt?: string;
  DeletedBy?: number;
  DeleteReason?: string;
  ArchivedAt?: string;
  DependencySnapshotJson?: string;
  DeleteStatus?: string;
  AlreadyRemoved?: boolean;
  AlreadyHistorical?: boolean;
  Deactivated?: boolean;
  HardDeleted?: boolean;
  Purged?: boolean;
  IsSystem?: boolean;
  CanDelete?: boolean;
  ActiveReferenceCount?: number;
  AllocationUsageCount?: number;
  RecentAllocationUsageCount?: number;
  AllocationLinksCleared?: number;
  ArchiveRowsDeleted?: number;
  AuditUsageCount?: number;
  AuditRowsDeleted?: number;
  DynamicRowsCleared?: number;
  DynamicRowsDeleted?: number;
  TravelExpenseUsageCount?: number;
  EmployeeAllowanceUsageCount?: number;
  HistoryUsageCount?: number;
};

export type Company = {
  CompanyID: number;
  CompanyCode: string;
  CompanyName: string;
  DatabaseName: string;
  LogoMimeType?: string;
  LogoSize?: number;
  Address?: string;
  Phone?: string;
  Email?: string;
  TRN?: string;
  ContactPerson?: string;
  IsActive: boolean;
  CreatedAt?: string;
  UpdatedAt?: string;
};

export type AtlasUser = {
  UserID: number;
  EmployeeID?: number;
  Username: string;
  Email: string;
  FullName: string;
  Role: "admin" | "manager" | "hr" | "employee" | "user" | "viewer";
  Department?: string;
  Branch?: string;
  IsActive: boolean;
  LastLogin?: string;
};

export type EmergencyTicket = {
  TicketID: number;
  EmployeeID: number;
  EmployeeCode: string;
  FullName: string;
  TicketType: string;
  Priority: string;
  TicketDate: string;
  Destination?: string;
  EstimatedCost: number;
  Reason: string;
  Status: string;
};

export type YearSummary = {
  year: number;
  allocations: { TotalAllocations: number; TotalTickets: number; CompanyPaid: number };
  loans: { TotalLoans: number; TotalLoanAmount: number };
  emergencyTickets: { TotalEmergency: number };
};

export type AtlasSession = {
  token: string;
  sessionId: string;
  user: {
    userId: number;
    username: string;
    fullName: string;
    role: string;
    email: string;
    department?: string;
    branch?: string;
  };
};

const CONFIGURED_API_BASE = process.env.NEXT_PUBLIC_ATLAS_API || "";

export function atlasApiBase() {
  if (typeof window !== "undefined") {
    const configured = CONFIGURED_API_BASE.trim();

    if (!configured) {
      return "/api";
    }

    return configured;
  }
  return CONFIGURED_API_BASE || "http://localhost:3355/api";
}

function atlasUrl(path: string) {
  return `${atlasApiBase()}${path}`;
}

export async function atlasLogin(username: string, password: string): Promise<AtlasSession> {
  const res = await fetch(atlasUrl("/auth/login"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  if (!res.ok) throw new Error(await readApiError(res, "Login failed"));
  return res.json();
}

export async function atlasFetch<T>(path: string, token: string, sessionId: string): Promise<T> {
  const res = await fetch(atlasUrl(path), {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Session-Id": sessionId
    },
    cache: "no-store"
  });
  if (!res.ok) throw new Error(await readApiError(res, `${path} failed`));
  return res.json();
}

export async function atlasMutation<T>(
  path: string,
  token: string,
  sessionId: string,
  method: "POST" | "PUT" | "DELETE",
  body?: unknown
): Promise<T> {
  const res = await fetch(atlasUrl(path), {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Session-Id": sessionId
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) throw new Error(await readApiError(res, `${path} failed`));
  return res.json();
}

export async function atlasHealth() {
  const res = await fetch(atlasUrl("/health"), { cache: "no-store" });
  if (!res.ok) throw new Error(await readApiError(res, "API health check failed"));
  return res.json();
}

async function readApiError(res: Response, fallback: string) {
  const statusPrefix = res.status ? `HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""}` : "";
  try {
    const data = await res.json();
    if (data && typeof data === "object") {
      if (data.code === "EMPLOYEE_DELETE_BLOCKED") {
        const details = data.details || {};
        const parts = [];
        if (Number(details.loans || 0) > 0) parts.push(`${details.loans} loans`);
        if (Number(details.allocations || 0) > 0) parts.push(`${details.allocations} allocations`);
        if (Number(details.emergencyTickets || 0) > 0) parts.push(`${details.emergencyTickets} emergency tickets`);
        if (Number(details.openingBalances || 0) > 0) parts.push(`${details.openingBalances} opening balance records`);
        const linkedSummary = parts.length ? ` Linked records: ${parts.join(", ")}.` : "";
        return `${data.error || "Employee cannot be deleted."}${linkedSummary}`;
      }
      if (data.code === "ALLOCATION_SECOND_TICKET_REVIEW") {
        const firstAllocation = data.firstAllocation || {};
        const firstDate = String(firstAllocation.AllocationDate || "N/A").slice(0, 10);
        const firstCost = Number(firstAllocation.TicketCost || 0);
        const remaining = Number(data.currentYearRemaining || 0);
        return `${data.error || "Allocation review required."} First ticket ${firstDate}, ${moneyFormat(firstCost)}. Current year remaining ${moneyFormat(remaining)}.`;
      }
      const message = data.error || data.message || fallback;
      return statusPrefix ? `${message} (${statusPrefix})` : message;
    }
    const primitiveMessage = String(data || fallback);
    return statusPrefix ? `${primitiveMessage} (${statusPrefix})` : primitiveMessage;
  } catch {
    try {
      const text = await res.text();
      const cleanText = text.replace(/\s+/g, " ").trim().slice(0, 240);
      if (cleanText) return statusPrefix ? `${fallback}: ${cleanText} (${statusPrefix})` : `${fallback}: ${cleanText}`;
    } catch {
      // Fall through to the status-aware fallback.
    }
    return statusPrefix ? `${fallback} (${statusPrefix})` : fallback;
  }
}

function moneyFormat(amount: number) {
  return new Intl.NumberFormat("en-BH", { style: "currency", currency: "BHD", maximumFractionDigits: 2 }).format(Number(amount) || 0);
}

export function calculateRemainingDays(employee: Employee) {
  if (typeof employee.ClosingBalanceDays === "number" && Number.isFinite(employee.ClosingBalanceDays)) {
    return employee.ClosingBalanceDays;
  }
  if (typeof employee.RemainingBalance === "number" && Number.isFinite(employee.RemainingBalance)) {
    return employee.RemainingBalance;
  }
  if (typeof employee.OpeningDays === "number" && Number.isFinite(employee.OpeningDays)) {
    return employee.OpeningDays;
  }
  return 0;
}

export function closingBalanceDays(employee: Employee) {
  if (typeof employee.ClosingBalanceDays === "number" && Number.isFinite(employee.ClosingBalanceDays)) {
    return employee.ClosingBalanceDays;
  }
  if (typeof employee.RemainingBalance === "number" && Number.isFinite(employee.RemainingBalance)) {
    return employee.RemainingBalance;
  }
  if (typeof employee.OpeningDays === "number" && Number.isFinite(employee.OpeningDays)) {
    return employee.OpeningDays;
  }
  return calculateRemainingDays(employee);
}

export function calculateExcelTotal(employee: Employee) {
  if (typeof employee.ClosingBalanceBHD === "number" && Number.isFinite(employee.ClosingBalanceBHD)) {
    return Math.round(employee.ClosingBalanceBHD * 100) / 100;
  }
  return 0;
}


