import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { MAX_LOAN_MONTHS, emiAmountFor, planForEmi, planForMonths, planForValue } from "../lib/loan-terms.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

test("months mode: even split, rounding settled on the last instalment", () => {
  assert.deepEqual(planForMonths(300, 12), { basis: "tenure", months: 12, emi: 25, last: 25 });
  assert.deepEqual(planForMonths(100, 3), { basis: "tenure", months: 3, emi: 33.33, last: 33.34 });
  assert.deepEqual(planForMonths(435.21, 9), { basis: "tenure", months: 9, emi: 48.36, last: 48.33 });
  assert.equal(planForMonths(0, 12), null);
  assert.equal(planForMonths(300, 0), null);
  assert.equal(planForMonths(300, 1.5), null);
});

test("EMI mode: every instalment is the EMI typed, the last one is the remainder", () => {
  assert.deepEqual(planForEmi(435.21, 50), {
    ok: true,
    plan: { basis: "emi", months: 9, emi: 50, last: 35.21 },
  });
  assert.deepEqual(planForEmi(300, 25), { ok: true, plan: { basis: "emi", months: 12, emi: 25, last: 25 } });
  assert.deepEqual(planForEmi(310, 25), { ok: true, plan: { basis: "emi", months: 13, emi: 25, last: 10 } });
  assert.deepEqual(planForEmi(0.3, 0.1), { ok: true, plan: { basis: "emi", months: 3, emi: 0.1, last: 0.1 } });
});

test("EMI mode: an EMI at or above the excess is one instalment of the excess", () => {
  assert.deepEqual(planForEmi(298.75, 298.75), {
    ok: true,
    plan: { basis: "emi", months: 1, emi: 298.75, last: 298.75 },
  });
  assert.deepEqual(planForEmi(298.75, 500), {
    ok: true,
    plan: { basis: "emi", months: 1, emi: 298.75, last: 298.75 },
  });
});

test("EMI mode: refuses blank, zero, negative and too-small EMIs", () => {
  assert.deepEqual(planForEmi(300, 0), { ok: false, reason: "invalid" });
  assert.deepEqual(planForEmi(300, -5), { ok: false, reason: "invalid" });
  assert.deepEqual(planForEmi(300, Number.NaN), { ok: false, reason: "invalid" });
  assert.deepEqual(planForEmi(0, 10), { ok: false, reason: "invalid" });
  assert.deepEqual(planForEmi(300, 0.001), { ok: false, reason: "invalid" });
  assert.deepEqual(planForEmi(1000, 1), { ok: false, reason: "too_small" });
  assert.equal(planForEmi(600, 1).plan.months, MAX_LOAN_MONTHS);
});

test("form value helpers send emi_amount only in EMI mode", () => {
  assert.equal(emiAmountFor({ months: "12", emi: null }), undefined);
  assert.equal(emiAmountFor({ months: "9", emi: "" }), undefined);
  assert.equal(emiAmountFor({ months: "9", emi: "50" }), 50);
  assert.equal(planForValue(435.21, { months: "9", emi: "50" }).last, 35.21);
  assert.equal(planForValue(435.21, { months: "9", emi: null }).emi, 48.36);
});

test("allocation uses the shared loan terms input on all three loan screens and sends emi_amount", () => {
  const page = read("app/(app)/allocation/page.tsx");
  assert.equal(page.match(/<LoanTermsInput\b/g)?.length, 3);
  assert.doesNotMatch(page, /label="Loan tenure \(months\)"/);
  assert.equal(page.match(/emi_amount:/g)?.length >= 3, true);
});

test("loans screen create and restructure accept months or a fixed EMI", () => {
  const page = read("app/(app)/loans/page.tsx");
  assert.equal(page.match(/<LoanTermsInput\b/g)?.length, 2);
  assert.match(page, /emi_amount: createEmi/);
  assert.match(page, /emi_amount: editEmi/);
  assert.match(page, /loanTerms\.lastInstallment/);
});
