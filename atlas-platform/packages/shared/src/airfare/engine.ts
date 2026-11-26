export const AIRFARE_CYCLE_DAYS = 60;
export const AIRFARE_STANDARD_YEAR_DAYS = 360;
export const AIRFARE_WORKING_DAYS_PER_AIRFARE_DAY = 30;
export const DEFAULT_AIRFARE_POLICY_AMOUNT = 150;

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

export function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function currentAirfareDaysFromWorkingDays(workingDays: number) {
  const capped = Math.max(0, Math.min(AIRFARE_STANDARD_YEAR_DAYS, Number(workingDays) || 0));
  return round((capped / AIRFARE_WORKING_DAYS_PER_AIRFARE_DAY) * 2.5, 4);
}

export function calculateAirfare(input: AirfareInputs): AirfareResult {
  const currentAirfareDays = currentAirfareDaysFromWorkingDays(input.currentWorkingDays);
  const remainingDays = round(
    Math.min(AIRFARE_CYCLE_DAYS, Math.max(0, input.openingDays + currentAirfareDays - input.paidDays)),
    4
  );
  const maximumPayout = Math.max(0, input.maximumPayout || DEFAULT_AIRFARE_POLICY_AMOUNT);
  const calculatedPayable = round((maximumPayout / AIRFARE_CYCLE_DAYS) * remainingDays, 2);
  return { currentAirfareDays, remainingDays, payableBhd: Math.min(maximumPayout, calculatedPayable) };
}

export function calculateAllocationWorkingDays(
  targetDate: Date,
  allocYear: number,
  joinDate?: Date | null,
  previousAllocationDate?: Date | null
) {
  if (Number.isNaN(targetDate.getTime())) return 0;
  const year = allocYear || targetDate.getFullYear();
  if (targetDate.getFullYear() !== year) {
    return targetDate.getFullYear() < year ? 0 : AIRFARE_STANDARD_YEAR_DAYS;
  }
  const yearStart = new Date(year, 0, 1);
  const resetDate = previousAllocationDate && !Number.isNaN(previousAllocationDate.getTime())
    ? new Date(previousAllocationDate.getFullYear(), previousAllocationDate.getMonth(), previousAllocationDate.getDate() + 1)
    : null;
  const startDate = [yearStart, joinDate, resetDate]
    .filter((item): item is Date => Boolean(item && !Number.isNaN(item.getTime())))
    .reduce((latest, item) => (item > latest ? item : latest), yearStart);
  if (startDate > targetDate) return 0;
  const endSerial = targetDate.getMonth() * 30 + targetDate.getDate();
  const startSerial = startDate.getMonth() * 30 + startDate.getDate();
  return Math.max(0, Math.min(AIRFARE_STANDARD_YEAR_DAYS, endSerial - startSerial + 1));
}
