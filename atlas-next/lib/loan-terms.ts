/**
 * Excess-recovery loan terms: HR enters either the number of months or a fixed monthly EMI.
 *
 * Months mode spreads the loan evenly (the last instalment absorbs rounding). EMI mode keeps
 * every instalment at exactly the EMI typed and the last one is whatever remains, the way
 * Zoho Payroll and greytHR "instalment amount" loans work. Amounts use the API's 2-decimal
 * money precision and are worked in whole cents to avoid float drift.
 */

export type LoanTermsMode = "months" | "emi";

export const MAX_LOAN_MONTHS = 600;

/** What the parent form keeps: months always, plus the EMI text while in EMI mode. */
export interface LoanTermsValue {
  months: string;
  /** `null` = months mode; otherwise the EMI the user typed. */
  emi: string | null;
}

export interface LoanPlan {
  basis: "tenure" | "emi";
  months: number;
  /** Regular monthly instalment. */
  emi: number;
  /** Final instalment; differs from `emi` when the amount does not divide evenly. */
  last: number;
}

/** Half-up to cents like the API; the nudge stops 1.005 * 100 = 100.4999… rounding down. */
const toCents = (value: number) => Math.round(value * 100 + 1e-6);
const fromCents = (cents: number) => cents / 100;

/** Interest-free tenure plan: EMI = excess ÷ months, rounding settled on the last instalment. */
export function planForMonths(excess: number, months: number): LoanPlan | null {
  if (!(excess > 0) || !Number.isInteger(months) || months < 1 || months > MAX_LOAN_MONTHS) return null;
  const total = toCents(excess);
  const emi = Math.round(total / months);
  const last = Math.max(0, total - emi * (months - 1));
  return { basis: "tenure", months, emi: fromCents(emi), last: fromCents(last) };
}

export type PlanForEmi =
  | { ok: true; plan: LoanPlan }
  | { ok: false; reason: "invalid" | "too_small" };

/**
 * Fixed-EMI plan: months = excess ÷ EMI rounded up; every instalment is the EMI and the last
 * one is the remainder. An EMI at or above the excess recovers it in one instalment.
 */
export function planForEmi(excess: number, emi: number): PlanForEmi {
  if (!(excess > 0) || !Number.isFinite(emi)) return { ok: false, reason: "invalid" };
  const total = toCents(excess);
  const step = toCents(emi);
  if (!(step > 0)) return { ok: false, reason: "invalid" };
  if (step >= total) {
    return { ok: true, plan: { basis: "emi", months: 1, emi: fromCents(total), last: fromCents(total) } };
  }
  const months = Math.ceil(total / step);
  if (months > MAX_LOAN_MONTHS) return { ok: false, reason: "too_small" };
  const last = total - step * (months - 1);
  return { ok: true, plan: { basis: "emi", months, emi: fromCents(step), last: fromCents(last) } };
}

/** Plan for the current form value, or `null` when it is incomplete or invalid. */
export function planForValue(excess: number, value: LoanTermsValue): LoanPlan | null {
  if (value.emi != null) {
    const result = planForEmi(excess, Number(value.emi));
    return result.ok ? result.plan : null;
  }
  return planForMonths(excess, Number(value.months));
}

/** `emi_amount` to send to the API: a number in EMI mode, otherwise `undefined`. */
export function emiAmountFor(value: LoanTermsValue): number | undefined {
  if (value.emi == null || !value.emi.trim()) return undefined;
  const emi = Number(value.emi);
  return Number.isFinite(emi) && emi > 0 ? emi : undefined;
}
