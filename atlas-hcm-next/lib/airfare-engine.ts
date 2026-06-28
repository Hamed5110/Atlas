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
export const DEFAULT_MAXIMUM_PAYOUT = 150;
export const WORKING_DAYS_PER_AIRFARE_DAY = 30;

export function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function currentAirfareDaysFromWorkingDays(workingDays: number) {
  return round((workingDays / WORKING_DAYS_PER_AIRFARE_DAY) * 2.5, 4);
}

export function calculateAirfare(input: AirfareInputs): AirfareResult {
  const currentAirfareDays = currentAirfareDaysFromWorkingDays(input.currentWorkingDays);
  const remainingDays = round(input.openingDays + currentAirfareDays - input.paidDays, 4);
  const maximumPayout = Math.max(0, input.maximumPayout || DEFAULT_MAXIMUM_PAYOUT);
  const calculatedPayable = round((maximumPayout / AIRFARE_CYCLE_DAYS) * Math.max(0, remainingDays), 2);
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
