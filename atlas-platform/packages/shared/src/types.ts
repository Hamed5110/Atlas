export type UserRole = "admin" | "manager" | "hr" | "employee" | "user" | "viewer";

export type AtlasUser = {
  userId: number;
  username: string;
  fullName: string;
  role: UserRole;
  email: string;
  department?: string;
  branch?: string;
};

export type AtlasSession = {
  token: string;
  sessionId: string;
  user: AtlasUser;
};

export type Employee = {
  EmployeeID: number;
  EmployeeCode: string;
  FullName: string;
  Department?: string;
  Branch?: string;
  Status: string;
  OpeningDays?: number;
  OpeningBHD?: number;
  ClosingBalanceDays?: number;
  ClosingBalanceBHD?: number;
  MaximumPayout?: number;
  TotalAirfare?: number;
  AirfarePaidDays?: number;
  RemainingBalance?: number;
  JoinDate?: string;
  Email?: string;
};

export type OpeningBalance = {
  EmployeeID: number;
  EmployeeCode?: string;
  FullName?: string;
  BalanceYear: number;
  OpeningDays: number;
  OpeningBHD: number;
  MaximumPayout?: number;
  Department?: string;
  Branch?: string;
};

export type Allocation = {
  AllocationID: number;
  EmployeeID: number;
  EmployeeCode: string;
  FullName: string;
  AllocationDate?: string;
  TicketCost: number;
  CompanyPaid: number;
  Entitlement?: number;
  ExcessAmount?: number;
  AllocYear: number;
  PaymentMode: string;
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

export type AirfarePolicy = {
  PolicyRateID: number;
  MaxPayoutAmount: number;
  PerDayRate: number;
  CycleDays: number;
  EffectiveFrom: string;
  IsActive: boolean;
  PolicyStatus?: string;
};

export type HealthResponse = {
  status: string;
  database: string;
  version: string;
  productCode: string;
};

export * from "./airfare/engine.js";
