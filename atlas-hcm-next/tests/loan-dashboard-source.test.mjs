import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

for (const expected of [
  "Loan Register",
  "Create Employee Loan",
  "Run selected EMI",
  "Loan action controls",
  "loan-action-fields",
  "Action date",
  "Deferment months",
  "New monthly EMI",
  "New remaining months",
  "Manager approval / note",
  "handleRunSelectedEmis",
  "handleDeferLoan",
  "handleRestructureLoan",
  "/loans/run-emis/preview",
  "/defer",
  "/restructure",
  "confirm: \"RUN_EMI\"",
  "confirm: \"DEFER\"",
  "confirm: \"RESTRUCTURE\"",
  "Export Loans",
  "Monthly EMI",
  "handleCreateLoan",
  "handleSettleLoan",
  "/loans/summary",
  "/loans/register"
]) {
  assert.ok(source.includes(expected), `Expected loan dashboard marker: ${expected}`);
}

console.log("Loan dashboard source test passed");
