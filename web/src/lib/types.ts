export interface Session {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
}

export interface Me {
  id: string;
  username: string;
  full_name: string;
  email?: string | null;
  roles: string[];
  employee_id?: string | null;
}

export interface Company {
  id: string;
  code: string;
  name: string;
  currency: string;
  active: boolean;
}

export interface Employee {
  id: string;
  code: string;
  full_name: string;
  company_id: string;
  join_date: string;
  department: string;
  branch: string;
  pay_group: string;
  repair_center?: string;
  designation?: string;
  nationality?: string;
  sub_section?: string;
  email?: string | null;
  custom_airfare_rate?: string | null;
  max_entitlement_cap_rate?: string | null;
  active: boolean;
  version: number;
}

export interface Ticket {
  id: string;
  employee_id: string;
  employee_code?: string;
  employee_name?: string;
  travel_date: string;
  origin_code: string;
  destination_code: string;
  ticket_cost: string;
  entitlement: string;
  company_paid: string;
  excess_handling: string;
  status: string;
  notes: string;
  ticket_number?: number | null;
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
}

export interface LoanInstallment {
  number: number;
  due_date: string;
  opening_balance: string;
  principal: string;
  interest: string;
  payment: string;
  closing_balance: string;
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
  travel_date: string;
  origin_code: string;
  destination_code: string;
  status: string;
  notes: string;
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
  full_name: string;
  email?: string | null;
  roles: string[];
  employee_id?: string | null;
  is_active: boolean;
  must_change_password?: boolean;
  last_login_at?: string | null;
  failed_login_count?: number;
  locked_until?: string | null;
  version: number;
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
  messages: string[];
  [key: string]: unknown;
}

export interface ReportData {
  columns?: string[];
  rows?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}
