import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

for (const expected of [
  "Ticket / receipt attachment",
  "Employee airfare eligibility review",
  "Eligible balance days",
  "Airfare entitlement amount",
  "Opening balance amount",
  "Save, upload and print",
  "viewAllocationAttachment",
  "/allocation-attachments/",
  "application/pdf,image/png,image/jpeg,image/webp"
]) {
  assert.ok(source.includes(expected), `Expected airfare attachment marker: ${expected}`);
}

const eligibilityReview = source.slice(
  source.indexOf("Employee airfare eligibility review"),
  source.indexOf("Rule source: MSSQL calculates")
);

for (const hidden of [
  "Current year earned amount",
  "Current year remaining",
  "Total available funds"
]) {
  assert.ok(!eligibilityReview.includes(hidden), `Eligibility review should hide marked tile: ${hidden}`);
}

console.log("Airfare attachments source test passed");
