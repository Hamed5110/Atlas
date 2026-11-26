/**
 * Ticket money desk — FE port of the backend settle rules so every surface
 * (Allocation register, CSV export, print sheet, Settlement KPIs) shows the
 * same numbers as `_ticket_cost_pay_breakdown` (application/reporting.py).
 *
 * Backend lineage (keep in sync):
 *   - `_allocation_ticket_fare`        → allocationTicketFare
 *   - `_settlement_option_from_handling` → settlementOptionFromHandling
 *   - `ticket_drawn_amount`            → drawnAmount
 *   - `settle_excess_ticket` + option overrides → ticketPayBreakdown / settlementKpis
 *
 * Invariants (mirrored exactly):
 *   Net amount = Airfare balance deduction + Company pays.
 *   COMPANY_PAID / SELF_PAID_FULL draw 0 from the pot.
 *   Make loan: employee cash 0, loan = fare − pot.
 *   ENTITLEMENT_AMOUNT: company pays the top-up (fare − pot).
 */

export type SettlementOption =
  | "SELF_PAID"
  | "SELF_PAID_FULL"
  | "COMPANY_PAID"
  | "CONVERT_TO_LOAN"
  | "ENTITLEMENT_AMOUNT";

/** Stored ticket row fields the money desk reads (all API shapes tolerated). */
export interface TicketMoneyRow {
  ticket_cost?: string | number | null;
  entitlement?: string | number | null;
  excess_cost?: string | number | null;
  excess_amount?: string | number | null;
  excess_handling?: string | null;
  employee_payable?: string | number | null;
  company_paid?: string | number | null;
  company_payout?: string | number | null;
}

export interface TicketPayBreakdown {
  /** Allocation fare (legacy ENTITLEMENT_AMOUNT rows reconstructed). */
  ticketAmount: number;
  /** Total available funds — reconstructed pot for draw-0 options. */
  availableFund: number;
  /** Airfare balance deduction (drawn from the pot). */
  deduction: number;
  companyPays: number;
  /** Employee cash at the counter (loan principal is not cash). */
  employeePays: number;
  /** Recovery loan principal (Make loan = fare − pot; else 0). */
  loanAmount: number;
  /** Net amount = deduction + companyPays (Settlement desk). */
  netAmount: number;
  /** Settlement "Loan"/excess KPI (fare − pot for Make loan; else 0). */
  excess: number;
  option: SettlementOption;
}

const num = (value: string | number | null | undefined): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/** Round to BHD fils (3dp) like the backend `_bhd3` quantize. */
const bhd3 = (value: number): number => Math.round((value + Number.EPSILON) * 1000) / 1000;

/** Map stored excess_handling to the Settlement option; unknown/empty → Self paid. */
export function settlementOptionFromHandling(handling: string | null | undefined): SettlementOption {
  const key = String(handling || "").trim().toUpperCase();
  if (key === "LOAN" || key === "CONVERT_TO_LOAN") return "CONVERT_TO_LOAN";
  if (key === "COMPANY_PAID") return "COMPANY_PAID";
  if (key === "SELF_PAID_FULL") return "SELF_PAID_FULL";
  if (key === "ENTITLEMENT_AMOUNT") return "ENTITLEMENT_AMOUNT";
  return "SELF_PAID";
}

export function isLoanOption(option: SettlementOption): boolean {
  return option === "CONVERT_TO_LOAN";
}

/** Stored excess marker: excess_cost with excess_amount fallback (backend order). */
function storedExcess(ticket: TicketMoneyRow): number {
  return bhd3(ticket.excess_cost != null ? num(ticket.excess_cost) : num(ticket.excess_amount));
}

/**
 * Allocation fare — recover legacy ENTITLEMENT_AMOUNT issues that capped
 * ticket_cost to the pot while keeping the request gap in excess_cost.
 */
export function allocationTicketFare(ticket: TicketMoneyRow): number {
  const cost = bhd3(num(ticket.ticket_cost));
  const drawn = bhd3(num(ticket.entitlement));
  const excess = storedExcess(ticket);
  if (
    settlementOptionFromHandling(ticket.excess_handling) === "ENTITLEMENT_AMOUNT" &&
    excess > 0 &&
    cost <= drawn
  ) {
    return bhd3(cost + excess);
  }
  return cost;
}

/**
 * Total available funds at issue. COMPANY_PAID / SELF_PAID_FULL draw 0, so the
 * stored entitlement is 0 — recover the pot from fare − stored excess marker.
 */
export function ticketAvailableFund(ticket: TicketMoneyRow): number {
  const fare = allocationTicketFare(ticket);
  const option = settlementOptionFromHandling(ticket.excess_handling);
  if (option === "SELF_PAID_FULL" || option === "COMPANY_PAID") {
    const excess = storedExcess(ticket);
    return fare > excess ? bhd3(fare - excess) : 0;
  }
  return bhd3(num(ticket.entitlement));
}

/** Entitlement a ticket consumes from the pot (backend `ticket_drawn_amount`). */
export function drawnAmount(
  ticketAmount: number,
  availableFund: number,
  option: SettlementOption
): number {
  if (option === "SELF_PAID_FULL" || option === "COMPANY_PAID") return 0;
  return bhd3(Math.max(0, Math.min(ticketAmount, availableFund)));
}

/**
 * Settlement money for explicit amounts — the live Allocation desk
 * (`settle_excess_ticket` for the 5 payment options).
 */
const VALID_OPTIONS: ReadonlySet<string> = new Set([
  "SELF_PAID",
  "SELF_PAID_FULL",
  "COMPANY_PAID",
  "CONVERT_TO_LOAN",
  "ENTITLEMENT_AMOUNT",
]);

export function settlementKpis(
  ticketAmount: number,
  availableFund: number,
  option: SettlementOption | ""
): Omit<TicketPayBreakdown, "ticketAmount" | "availableFund" | "option"> & {
  option: SettlementOption;
} {
  const fare = bhd3(Math.max(0, ticketAmount));
  const pot = bhd3(Math.max(0, availableFund));
  // Unknown / unset option behaves like the backend default: Self paid.
  const opt: SettlementOption = VALID_OPTIONS.has(option) ? (option as SettlementOption) : "SELF_PAID";
  const gap = bhd3(Math.max(0, fare - pot));

  let companyPays = 0;
  let employeePays = 0;
  let loanAmount = 0;
  let excess = 0;
  switch (opt) {
    case "SELF_PAID_FULL":
      employeePays = fare;
      break;
    case "SELF_PAID":
      employeePays = gap;
      break;
    case "CONVERT_TO_LOAN":
      excess = gap;
      loanAmount = gap;
      break;
    case "COMPANY_PAID":
      companyPays = fare;
      break;
    case "ENTITLEMENT_AMOUNT":
      companyPays = gap; // top-up beyond the pot
      break;
  }
  const deduction = drawnAmount(fare, pot, opt);
  return {
    deduction,
    companyPays,
    employeePays,
    loanAmount,
    netAmount: bhd3(deduction + companyPays),
    excess,
    option: opt,
  };
}

/**
 * Full money desk for a stored ticket row — identical to the backend
 * `_ticket_cost_pay_breakdown` used by the Ticket Cost reports.
 */
export function ticketPayBreakdown(ticket: TicketMoneyRow): TicketPayBreakdown {
  const ticketAmount = allocationTicketFare(ticket);
  const availableFund = ticketAvailableFund(ticket);
  const option = settlementOptionFromHandling(ticket.excess_handling);
  // The backend's stored-fields fallback (ValidationError path) is always
  // overwritten by the per-option overrides, so one table covers every row.
  const kpis = settlementKpis(ticketAmount, availableFund, option);
  return { ticketAmount, availableFund, ...kpis, option };
}
