import assert from "node:assert/strict";
import { calculateAirfare, currentAirfareDaysFromWorkingDays } from "../src/airfare/engine.js";

const days = currentAirfareDaysFromWorkingDays(360);
assert.equal(days, 30);

const result = calculateAirfare({
  openingDays: 10,
  currentWorkingDays: 360,
  paidDays: 5,
  maximumPayout: 150
});

assert.ok(result.payableBhd > 0);
assert.ok(result.remainingDays > 0);
console.log("shared airfare engine tests passed");
