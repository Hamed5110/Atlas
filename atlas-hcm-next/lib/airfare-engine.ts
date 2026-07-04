export type AirfareInputs = {
  openingDays: number;
  currentWorkingDays: number;
  paidDays: number;
  maximumPayout: number;
};

export type AirfareResult = {
  currentAirfareDays: number;
  remainingDays: number;
  payableBhd: number;
};

export const AIRFARE_CYCLE_DAYS = 60;
export const AIRFARE_ENTITLEMENT_CYCLE_DAYS = 720;
export const DEFAULT_MAXIMUM_PAYOUT = 150;
export const STANDARD_YEAR_DAYS = 360;
export const WORKING_DAYS_PER_AIRFARE_DAY = 30;

export function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function currentAirfareDaysFromWorkingDays(workingDays: number) {
  const cappedWorkingDays = Math.max(0, Math.min(STANDARD_YEAR_DAYS, Number(workingDays) || 0));
  return round((cappedWorkingDays / WORKING_DAYS_PER_AIRFARE_DAY) * 2.5, 4);
}

export function calculateAirfare(input: AirfareInputs): AirfareResult {
  const currentAirfareDays = currentAirfareDaysFromWorkingDays(input.currentWorkingDays);
  const remainingDays = round(Math.min(AIRFARE_CYCLE_DAYS, Math.max(0, input.openingDays + currentAirfareDays - input.paidDays)), 4);
  const maximumPayout = Math.min(DEFAULT_MAXIMUM_PAYOUT, Math.max(0, input.maximumPayout || DEFAULT_MAXIMUM_PAYOUT));
  const calculatedPayable = round((maximumPayout / AIRFARE_CYCLE_DAYS) * remainingDays, 2);
  const payableBhd = Math.min(maximumPayout, calculatedPayable);
  return { currentAirfareDays, remainingDays, payableBhd };
}

export function explainAirfare(input: AirfareInputs) {
  const result = calculateAirfare(input);
  return {
    ...result,
    formula: "Total Airfare = min(Maximum Payout, Maximum Payout / 60 * Remaining Days)",
    remainingDaysFormula: "Opening Days + Current Airfare Days - Paid Days"
  };
}
