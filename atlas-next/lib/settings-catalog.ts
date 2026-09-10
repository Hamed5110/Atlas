export type SettingFieldType = "toggle" | "select" | "number" | "text" | "textarea" | "image";

export interface SettingField {
  key: string;
  label: string;
  description: string;
  type: SettingFieldType;
  options?: Array<{ value: string; label: string }>;
  default: string;
  placeholder?: string;
  visibleWhen?: { key: string; in: string[] };
}

export interface SettingGroup {
  id: string;
  title: string;
  description: string;
  fields: SettingField[];
}

export const SETTINGS_CATALOG: SettingGroup[] = [
  {
    id: "accrual",
    title: "Accrual Policy",
    description: "When and how much airfare balance employees earn.",
    fields: [
      {
        key: "accrual_frequency",
        label: "Accrual frequency",
        description:
          "Daily: pro-rated every day. Monthly: 1/12th of the rate lands on each completed month. Immediate: full rate granted on day one of the cycle.",
        type: "select",
        options: [
          { value: "daily", label: "Daily (pro-rata)" },
          { value: "monthly", label: "Monthly (1/12 per month)" },
          { value: "immediate", label: "Immediate (full rate up front)" },
        ],
        default: "daily",
      },
      {
        key: "accrual_cap_multiple",
        label: "Accrual cap (× rate)",
        description:
          "Stops accrual when the unused balance reaches this multiple of the annual rate. 0 or empty = capped at 1× rate (legacy).",
        type: "number",
        default: "",
        placeholder: "e.g. 2 for 2× rate",
      },
    ],
  },
  {
    id: "vesting",
    title: "Entitlement Vesting",
    description: "The all-or-nothing and first-year eligibility rules.",
    fields: [
      {
        key: "vesting_type",
        label: "Vesting type",
        description:
          "Pro-rata accrues from day one. Cliff grants nothing until the cliff period completes. Graded steps the rate by tenure.",
        type: "select",
        options: [
          { value: "prorata", label: "Pro-rata" },
          { value: "cliff", label: "Cliff" },
          { value: "graded", label: "Graded" },
        ],
        default: "prorata",
      },
      {
        key: "vesting_cliff_days",
        label: "Cliff period (days)",
        description: "Service days required before any accrual vests. Only used with Cliff or Graded vesting.",
        type: "number",
        default: "360",
        visibleWhen: { key: "vesting_type", in: ["cliff", "graded"] },
      },
      {
        key: "probation_days",
        label: "First-year eligibility (probation days)",
        description:
          "0 = eligible from day one. Otherwise the entitlement cycle only starts counting after probation ends.",
        type: "number",
        default: "0",
      },
    ],
  },
  {
    id: "carryforward",
    title: "Carry-Forward & Expiry",
    description: "What happens to unused balances at the end of a cycle.",
    fields: [
      {
        key: "carry_forward_limit_type",
        label: "Carry-forward limit",
        description: "Unlimited rolls everything. Fixed caps at an amount. Percentage rolls a share of the unused balance.",
        type: "select",
        options: [
          { value: "unlimited", label: "Unlimited" },
          { value: "fixed", label: "Fixed amount" },
          { value: "percent", label: "Percentage of balance" },
        ],
        default: "unlimited",
      },
      {
        key: "carry_forward_limit_value",
        label: "Limit value",
        description: "Amount for Fixed, or percent (0–100) for Percentage.",
        type: "number",
        default: "0",
        visibleWhen: { key: "carry_forward_limit_type", in: ["fixed", "percent"] },
      },
      {
        key: "carry_forward_expiry_months",
        label: "Carry-forward expiry (months)",
        description: "Carried balance is forfeited after this many months. Empty = never expires.",
        type: "number",
        default: "",
        placeholder: "e.g. 12",
      },
      {
        key: "carry_forward_grace_days",
        label: "Grace period (days)",
        description: "Extra days after expiry during which the balance can still be used.",
        type: "number",
        default: "0",
      },
    ],
  },
  {
    id: "booking",
    title: "Booking & Claims",
    description: "How employees consume their balance.",
    fields: [
      {
        key: "advance_booking_allowed",
        label: "Advance booking",
        description: "Allow booking against future accruals — the excess becomes an automatic loan.",
        type: "toggle",
        default: "true",
      },
      {
        key: "negative_balance_allowed",
        label: "Negative balance",
        description: "Allow requests that exceed the available balance (Scenario 4 loan). Off = hard rejection.",
        type: "toggle",
        default: "true",
      },
      {
        key: "partial_claim_allowed",
        label: "Partial claims",
        description: "Allow claiming less than the ticket price with the remainder paid personally.",
        type: "toggle",
        default: "true",
      },
      {
        key: "dependent_coverage",
        label: "Dependent coverage",
        description: "Deduct additional rates from the same balance when dependents travel.",
        type: "select",
        options: [
          { value: "self", label: "Self only" },
          { value: "self_plus_one", label: "Self + 1 dependent" },
          { value: "family", label: "Family" },
        ],
        default: "self",
      },
    ],
  },
  {
    id: "cycle",
    title: "Cycle Reset & Rates",
    description: "The perpetual no-year-end engine and rate handling.",
    fields: [
      {
        key: "cycle_reset_basis",
        label: "Cycle reset basis",
        description:
          "Calendar (ATLAS airfare): 1 Jan cycle; tickets in the year reset accrual. Joining date uses hire anniversary (tickets before anniversary are ignored). No year-end wipe either way.",
        type: "select",
        options: [
          { value: "calendar", label: "Global calendar (Jan 1) — ATLAS airfare" },
          { value: "joining_date", label: "Joining date (rolling)" },
        ],
        default: "calendar",
      },
      {
        key: "rate_change_handling",
        label: "Mid-cycle rate change",
        description:
          "Prorate splits old/new rate by days. Restart zeroes the cycle at the change. Ignore applies the new rate next cycle.",
        type: "select",
        options: [
          { value: "prorate", label: "Prorate" },
          { value: "restart", label: "Restart cycle" },
          { value: "ignore", label: "Ignore until next cycle" },
        ],
        default: "prorate",
      },
      {
        key: "rounding_rule",
        label: "Rounding rule",
        description: "How prorated amounts are rounded.",
        type: "select",
        options: [
          { value: "nearest", label: "Nearest (half up)" },
          { value: "up", label: "Round up" },
          { value: "down", label: "Round down" },
        ],
        default: "nearest",
      },
      {
        key: "airfare_rate",
        label: "Default annual rate",
        description: "Global fallback airfare rate when no scoped rate exists.",
        type: "number",
        default: "150",
      },
      {
        key: "airfare_rate_days",
        label: "Rate cycle days",
        description: "Cycle denominator for the daily rate (legacy: 60).",
        type: "number",
        default: "60",
      },
      {
        key: "max_entitlement_cap_rate",
        label: "Entitlement cap",
        description: "Maximum payable entitlement per cycle.",
        type: "number",
        default: "150",
      },
    ],
  },
  {
    id: "recovery",
    title: "Recovery & Loans",
    description: "Strict rules for excess-recovery loans.",
    fields: [
      {
        key: "loan_recovery_method",
        label: "Recovery method",
        description:
          "Auto-deduct: future entitlements clear the loan first. Manual: HR adjusts manually. Salary: deducted via payroll.",
        type: "select",
        options: [
          { value: "manual", label: "Manual repayment" },
          { value: "auto_deduct", label: "Auto-deduct from entitlement" },
          { value: "salary", label: "Salary deduction" },
        ],
        default: "manual",
      },
      {
        key: "loan_recovery_priority",
        label: "Recovery priority",
        description:
          "Before accrual: loan is deducted before showing the new balance. After accrual: full balance shows but claims are blocked until the loan clears.",
        type: "select",
        options: [
          { value: "before_accrual", label: "Before accrual" },
          { value: "after_accrual", label: "After accrual" },
        ],
        default: "before_accrual",
      },
      {
        key: "loan_interest_rate",
        label: "Loan interest rate (% annual)",
        description: "Above 0%, outstanding loans grow daily until fully recovered.",
        type: "number",
        default: "0",
      },
    ],
  },
  {
    id: "audit",
    title: "Audit & Compliance",
    description: "Fraud prevention and financial-audit controls.",
    fields: [
      {
        key: "transaction_lock_days",
        label: "Transaction lock period (days)",
        description: "Entries older than this cannot be modified or deleted. 0 = no lock.",
        type: "number",
        default: "0",
      },
      {
        key: "recredit_on_cancel",
        label: "Auto re-credit on cancellation",
        description: "Cancelled tickets automatically return the balance to the employee. Off = manual approval required.",
        type: "toggle",
        default: "true",
      },
      {
        key: "currency_conversion",
        label: "Currency conversion",
        description: "Static uses the fixed rate below for international tickets.",
        type: "select",
        options: [
          { value: "static", label: "Static rate" },
          { value: "daily", label: "Daily exchange rate" },
        ],
        default: "static",
      },
      {
        key: "static_conversion_rate",
        label: "Static conversion rate",
        description: "Used when conversion is Static (foreign amount × rate = local).",
        type: "number",
        default: "1",
        visibleWhen: { key: "currency_conversion", in: ["static"] },
      },
    ],
  },
];

export const SETTINGS_DEFAULTS: Record<string, string> = Object.fromEntries(
  SETTINGS_CATALOG.flatMap((g) => g.fields.map((f) => [f.key, f.default]))
);

