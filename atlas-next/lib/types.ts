export interface Session {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
}

export interface Me {
  id: string;
  username: string;
  roles: string[];
  /** Modules removed by the user's custom roles (enforced by the API). */
  deny?: string[];
  /** Screens of the denied modules; the sidebar hides them. */
  hidden_screens?: string[];
  display_name?: string;
  full_name?: string;
  email?: string | null;
  employee_id?: string | null;
}

export interface Company {
  id: string;
  code: string;
  name: string;
  arabic_name?: string | null;
  currency: string;
  cr_no?: string | null;
  address?: string | null;
  po_box?: string | null;
  phone?: string | null;
  email?: string | null;
  active: boolean;
  has_logo?: boolean;
  logo_url?: string | null;
}

export interface Employee {
  id: string;
  code: string;
  full_name: string;
  company_id: string;
  join_date: string;
  department: string;
  emp_department: string;
  branch: string;
  pay_group: string;
  repair_center?: string;
  designation?: string;
  nationality?: string;
  passport_no?: string;
  arabic_name?: string;
  cpr_no?: string;
  date_of_birth?: string | null;
  gender?: string;
  passport_expiry?: string | null;
  visa_no?: string;
  visa_expiry?: string | null;
  airline_sector?: string;
  travel_class?: string;
  last_airticket_date?: string | null;
  sub_section?: string;
  reporting_officer_id?: string | null;
  whatsapp_mobile?: string | null;
  email?: string | null;
  custom_airfare_rate?: string | null;
  max_entitlement_cap_rate?: string | null;
  grade?: string;
  contract_type?: string;
  origin_country?: string;
  employment_status?: string;
  monthly_salary?: string | null;
  probation_end_date?: string | null;
  active: boolean;
  version: number;
}

export interface Ticket {
  id: string;
  employee_id: string;
  employee_code?: string;
  employee_name?: string;
  arabic_name?: string | null;
  nationality?: string | null;
  department?: string | null;
  designation?: string | null;
  pay_group?: string | null;
  /** Org sub-section from employee master (ticket list may omit until API restart). */
  sub_section?: string | null;
  join_date?: string | null;
  reporting_officer?: string | null;
  as_of_date?: string | null;
  employee_payable?: string | number | null;
  company_payout?: string | number | null;
  opening_balance_amount?: string | number | null;
  current_year_earned_amount?: string | number | null;
  current_year_amount?: string | number | null;
  already_paid_amount?: string | number | null;
  travel_date: string;
  origin_code: string;
  destination_code: string;
  ticket_cost: string;
  entitlement: string;
  company_paid: string;
  excess_handling: string;
  status: string;
  notes: string;
  leave_start_date?: string | null;
  leave_end_date?: string | null;
  ticket_number?: number | null;
  ticket_code?: string | null;
  loan_id?: string | null;
  loan_number?: number | null;
  loan_code?: string | null;
  loan_status?: string | null;
  loan_version?: number | null;
  loan_outstanding?: string | number | null;
  loan_repayment_basis?: "emi" | "tenure" | null;
  loan_emi?: string | number | null;
  tenure_months?: number | null;
  excess_cost?: string | number | null;
  /** ISO timestamp — used for approval-queue aging (Waiting N days). */
  created_at?: string | null;
  version: number;
}

export interface Loan {
  id: string;
  employee_id: string;
  employee_code?: string;
  employee_name?: string;
  source_ticket_id?: string | null;
  principal: string;
  annual_rate: string;
  installments: number;
  monthly_installment: string;
  outstanding: string;
  status: string;
  deferred_until?: string | null;
  first_due_date: string;
  loan_number?: number | null;
  version: number;
  paid_amount?: string | number;
  last_paid_on?: string | null;
  payment_entries?: number;
  /** "emi": fixed instalment, last one is the remainder; "tenure": spread over the months. */
  repayment_basis?: "emi" | "tenure";
  remaining_installments?: number;
  next_due_date?: string | null;
  last_installment?: string | number | null;
  end_date?: string | null;
}

export type LoanInstallmentStatus = "paid" | "partial" | "overdue" | "due";

export interface LoanInstallment {
  number: number;
  due_date: string;
  opening_balance: string;
  principal: string;
  interest: string;
  payment: string;
  closing_balance: string;
  paid?: string | number;
  balance_due?: string | number;
  status?: LoanInstallmentStatus;
}

export interface LoanPayment {
  id: string;
  amount: string | number;
  paid_on: string;
  reference?: string | null;
  version?: number;
  created_at?: string | null;
  reversed?: boolean;
  reversed_at?: string | null;
  history?: LoanPaymentEvent[];
}

export interface LoanPaymentEvent {
  action: "edited" | "reversed";
  at: string;
  by: string;
  reason: string;
  amount?: { old: string; new: string } | string | null;
  paid_on?: { old: string; new: string } | string | null;
  reference?: { old: string; new: string } | string | null;
}

export interface Commission {
  id: string;
  company_id: string;
  employee_id: string;
  employee_code?: string | null;
  employee_name?: string | null;
  employee_label?: string | null;
  department?: string | null;
  period_month: string;
  amount: string | number;
  currency: string;
  commission_type: string;
  note: string;
  status: string;
  paid_on?: string | null;
  created_at?: string | null;
  created_by?: string | null;
  version: number;
}

export interface CommissionMeta {
  company_id: string;
  months: string[];
  statuses: string[];
  departments: string[];
  commission_types: string[];
  currencies: string[];
}

export interface CommissionVoucherLine {
  id: string;
  voucher_id?: string | null;
  line_no?: number;
  employee_id: string;
  employee_code?: string | null;
  employee_name?: string | null;
  designation?: string | null;
  department?: string | null;
  amount: string | number;
  currency: string;
  commission_type?: string;
  remarks?: string | null;
  period_month?: string;
  status?: string;
  version: number;
}

export interface CommissionVoucher {
  id: string;
  company_id: string;
  voucher_no: string;
  voucher_number?: number | null;
  voucher_date?: string | null;
  period_month: string;
  status: string;
  note?: string | null;
  paid_on?: string | null;
  currency: string;
  line_count: number;
  total: string | number;
  lines: CommissionVoucherLine[];
  created_at?: string | null;
  created_by?: string | null;
  version: number;
}

export interface CommissionVoucherCreateResult extends CommissionVoucher {
  created?: boolean;
  duplicate_warning?: boolean;
  duplicates?: Array<{ employee_id?: string; employee_name?: string | null; reason?: string }>;
  message?: string;
}

export interface OpeningBalance {
  id: string;
  employee_id: string;
  employee_code?: string;
  employee_name?: string;
  balance_year: number;
  opening_days: string;
  paid_days: string;
  opening_amount: string;
  maximum_payout: string;
  version: number;
}

export interface EssRequest {
  id: string;
  employee_id: string;
  employee_code?: string;
  employee_name?: string;
  request_type: string;
  trip_type?: "ROUND_TRIP" | "ONE_WAY";
  travel_date: string;
  return_date?: string | null;
  leave_start_date?: string | null;
  leave_end_date?: string | null;
  leave_days?: number | null;
  origin_code: string;
  destination_code: string;
  status: string;
  notes: string;
  ticket_id?: string | null;
  ticket_code?: string | null;
  ticket_status?: string | null;
  created_at?: string | null;
  employee_whatsapp_on_file?: boolean;
  whatsapp?: import("./ess-process").EssWhatsAppResult;
  version: number;
}

export interface EntitlementRate {
  id: string;
  scope_type: string;
  scope_id: string;
  amount: string;
  effective_from: string;
  effective_to?: string | null;
  cap_amount?: string | null;
  version: number;
}

export interface Lookup {
  id: string;
  lookup_type: string;
  code: string;
  name: string;
  active: boolean;
  version: number;
}

export interface Preference {
  id: string;
  scope_type: string;
  scope_id: string;
  preference_key: string;
  value?: string | null;
  is_locked: boolean;
  version: number;
}

export interface UserRow {
  id: string;
  username: string;
  display_name: string;
  /** @deprecated API returns display_name; kept for transitional reads */
  full_name?: string;
  email?: string | null;
  roles: string[];
  employee_id?: string | null;
  active: boolean;
  /** @deprecated API returns active */
  is_active?: boolean;
  must_change_password?: boolean;
  last_login_at?: string | null;
  failed_login_count?: number;
  locked_until?: string | null;
  version?: number;
}

export interface BackupInfo {
  file_name: string;
  kind: string;
  size_bytes: number;
  sha256?: string;
  created_at: string;
}

export interface AuditEvent {
  id: number;
  occurred_at: string;
  actor_id?: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  changes: Record<string, unknown>;
}

export interface Dashboard {
  employees: number;
  open_tickets: number;
  active_loans: number;
  outstanding_loans: string;
  [key: string]: unknown;
}

export interface NamedCount {
  name: string;
  count: number;
}

export interface InsightTravel {
  id: string;
  ticket_code: string | null;
  travel_date: string;
  days: number;
  destination: string;
  status: string;
  employee: string;
  employee_code: string;
}

export interface InsightExpiry {
  employee_id: string;
  employee: string;
  employee_code: string;
  document: "passport" | "visa";
  expires_on: string;
  days: number;
}

export interface InsightAttendanceDay {
  date: string;
  present: number;
  late: number;
  half_day: number;
  absent: number;
  missing_punch: number;
}

/** Sections the signed-in user may not open are absent, not empty. */
export interface DashboardInsights {
  as_of: string;
  airfare?: {
    spend_ytd: string;
    amount_balance: string;
    monthly: { month: string; tickets: number; cost: string; company_paid: string }[];
    by_status: { status: string; count: number; amount: string }[];
    top_destinations: { code: string; count: number; amount: string }[];
    upcoming_count: number;
    upcoming: InsightTravel[];
  };
  people?: {
    active: number;
    inactive: number;
    new_joiners: number;
    by_department: NamedCount[];
    by_nationality: NamedCount[];
    documents: { expired: number; due: number; window_days: number; items: InsightExpiry[] };
  };
  attendance?: {
    days: InsightAttendanceDay[];
    latest: InsightAttendanceDay & { rate: number | null };
    late_minutes_7d: number;
    overtime_minutes_7d: number;
  };
  loans?: {
    open: number;
    principal: string;
    outstanding: string;
    recovered: string;
    monthly_recovery: { month: string; amount: string }[];
    open_loans: {
      id: string;
      loan_code: string | null;
      employee: string;
      employee_code: string;
      outstanding: string;
      status: string;
    }[];
  };
  ess?: { by_status: { status: string; count: number }[]; total: number };
}

export interface AllocationPreviewResult {
  employee_id: string;
  entitlement: string;
  ticket_cost: string;
  company_paid: string;
  excess: string;
  options: Array<{
    option: string;
    label: string;
    company_paid: string;
    employee_paid: string;
    loan_principal?: string;
    monthly_installment?: string;
    installments?: number;
    description?: string;
  }>;
  remaining_balance_days?: string;
  remaining_balance_amount?: string;
  [key: string]: unknown;
}

export interface DiagnosticFinding {
  check_code: string;
  severity: "info" | "warning" | "critical" | string;
  summary: string;
  suggestion: string;
  auto_fixable: boolean;
  affected: number;
  details: Record<string, unknown>;
  confidence: number;
  learned_success_rate: number | null;
}

export interface DiagnoseResult {
  status?: string;
  findings: DiagnosticFinding[];
  [key: string]: unknown;
}

export interface LearningStats {
  total_events?: number;
  by_outcome?: Record<string, number>;
  recent?: Array<{
    id: string;
    event_type: string;
    check_code: string;
    severity: string;
    summary: string;
    outcome: string;
    confidence: number;
    created_at: string;
  }>;
  [key: string]: unknown;
}

export interface LlmStatus {
  provider_preference: string;
  active_provider: string | null;
  free_path: string;
  recommended?: Record<string, string>;
  ollama: {
    enabled: boolean;
    online: boolean;
    base_url: string;
    model: string;
    cost: string;
  };
  openai_compat?: {
    enabled?: boolean;
    online?: boolean;
    base_url?: string;
    model?: string;
    examples?: Record<string, string>;
    anythingllm_note?: string;
    cost?: string;
  };
  deepseek: {
    configured: boolean;
    base_url: string;
    model: string;
    cost: string;
    note?: string;
  };
  metrics_to_track?: string[];
}

export interface ForecastPoint {
  month: number;
  amount: number | string;
  low?: number | string;
  high?: number | string;
}

export interface BudgetForecast {
  months: number;
  forecast: ForecastPoint[];
  method?: string;
  [key: string]: unknown;
}

export interface ImportPreviewRow {
  row: number;
  severity: string;
  message?: string;
  messages?: string[];
  [key: string]: unknown;
}

export interface ReportData {
  columns?: string[];
  rows?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}
