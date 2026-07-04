import assert from "node:assert/strict";

const { calculateAirfare, currentAirfareDaysFromWorkingDays } = await import("../lib/airfare-engine.ts");

function closingBalanceDays(employee) {
  if (typeof employee.ClosingBalanceDays === "number" && Number.isFinite(employee.ClosingBalanceDays)) return employee.ClosingBalanceDays;
  if (typeof employee.RemainingBalance === "number" && Number.isFinite(employee.RemainingBalance)) return employee.RemainingBalance;
  return employee.OpeningDays || 0;
}

function calculateExcelTotal(employee) {
  return Math.round((Math.min(150, employee.MaximumPayout || 150) / 60) * Math.min(60, Math.max(0, closingBalanceDays(employee))) * 100) / 100;
}

const excelCase = calculateAirfare({
  openingDays: 28.41666666666667,
  currentWorkingDays: 360,
  paidDays: 33.417,
  maximumPayout: 150
});

assert.equal(currentAirfareDaysFromWorkingDays(360), 30);
assert.equal(excelCase.currentAirfareDays, 30);
assert.equal(excelCase.remainingDays, 24.9997);
assert.equal(excelCase.payableBhd, 62.5);

const fullyPaid = calculateAirfare({
  openingDays: 0,
  currentWorkingDays: 360,
  paidDays: 60,
  maximumPayout: 150
});
assert.equal(fullyPaid.payableBhd, 0);

const halfCycle = calculateAirfare({
  openingDays: 0,
  currentWorkingDays: 360,
  paidDays: 0,
  maximumPayout: 150
});
assert.equal(halfCycle.remainingDays, 30);
assert.equal(halfCycle.payableBhd, 75);

const june18Case = calculateAirfare({
  openingDays: 0,
  currentWorkingDays: 168,
  paidDays: 0,
  maximumPayout: 150
});
assert.equal(june18Case.currentAirfareDays, 14);
assert.equal(june18Case.payableBhd, 35);

const cappedCycleCase = calculateAirfare({
  openingDays: 90,
  currentWorkingDays: 168,
  paidDays: 0,
  maximumPayout: 150
});
assert.equal(cappedCycleCase.remainingDays, 60);
assert.equal(cappedCycleCase.payableBhd, 150);

const cappedPayoutCase = calculateAirfare({
  openingDays: 60,
  currentWorkingDays: 360,
  paidDays: 0,
  maximumPayout: 500
});
assert.equal(cappedPayoutCase.currentAirfareDays, 30);
assert.equal(cappedPayoutCase.remainingDays, 60);
assert.equal(cappedPayoutCase.payableBhd, 150);

const partialOneWayCase = calculateAirfare({
  openingDays: 12,
  currentWorkingDays: 120,
  paidDays: 10,
  maximumPayout: 150
});
assert.equal(partialOneWayCase.currentAirfareDays, 10);
assert.equal(partialOneWayCase.remainingDays, 12);
assert.equal(partialOneWayCase.payableBhd, 30);

const employeeFromExcelBalance = {
  ClosingBalanceDays: 25,
  RemainingBalance: 55,
  OpeningDays: 25,
  MaximumPayout: 150
};
assert.equal(closingBalanceDays(employeeFromExcelBalance), 25);
assert.equal(calculateExcelTotal(employeeFromExcelBalance), 62.5);

const importedWorkbookCase = {
  ClosingBalanceDays: 24.99966666666667,
  MaximumPayout: 150
};
assert.equal(calculateExcelTotal(importedWorkbookCase), 62.5);

console.log("Airfare formula tests passed");
