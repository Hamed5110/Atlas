import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const page = () => readFileSync(join(root, "app/(app)/reports/page.tsx"), "utf8");

const esc = (token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

test("declarative STANDARD_REPORT_FILTERS schema covers every non-commission catalog report", () => {
  const src = page();
  assert.match(src, /STANDARD_REPORT_FILTERS:\s*Partial<Record<ReportName, StdFilterKey\[\]>>/);
  // Every employee-dimension / date-driven report outside the dedicated
  // commission / TT / payable cards declares a filter set.
  for (const report of [
    '"employee-master"',
    '"ticket-register"',
    '"loan-outstanding"',
    '"loan-statement"',
    '"liability-projections"',
  ]) {
    assert.match(src, new RegExp(`${esc(report)}:\\s*\\[`), report);
  }
  // Status option domains per report family.
  assert.match(src, /TICKET_STATUSES = \["draft", "submitted", "approved", "rejected", "paid"\]/);
  assert.match(src, /LOAN_STATUSES = \["active", "deferred", "settled"\]/);
  assert.match(src, /STANDARD_STATUS_OPTIONS/);
});

test("standard filter card renders schema-driven controls with stable testids", () => {
  const src = page();
  for (const token of [
    'data-testid="standard-filters"',
    'data-testid="std-employees"',
    'data-testid="std-departments"',
    'data-testid="std-emp-departments"',
    'data-testid="std-pay-groups"',
    'data-testid="std-statuses"',
    'data-testid="std-year"',
    'idPrefix="std"',
    'data-testid="std-designation"',
    'data-testid="std-emp-status"',
  ]) {
    assert.match(src, new RegExp(esc(token)), token);
  }
  // Controls are gated on the selected report's declared schema.
  const gates = src.split("stdSchema.includes(").length - 1;
  assert.ok(gates >= 8, `expected >= 8 stdSchema.includes gates, got ${gates}`);
});

test("standard filters serialize as the shared API params (OR within, AND across)", () => {
  const src = page();
  for (const token of [
    'params.set("employee_ids", stdEmployeeIds.join(","))',
    'params.set("departments", stdDepartments.join(","))',
    'params.set("emp_departments", stdEmpDepartments.join(","))',
    'params.set("pay_groups", stdPayGroups.join(","))',
    'params.set("statuses", stdStatuses.join(","))',
    'params.set("date_from", appliedRange.from)',
    'params.set("date_to", appliedRange.to)',
    'params.set("date_to", stdDateTo)',
    'params.set("year", stdYear)',
    'params.set("designation", stdDesignation.trim())',
    'params.set("status", stdEmpStatus)',
  ]) {
    assert.match(src, new RegExp(esc(token)), token);
  }
  // The standard suffix feeds the shared report query pipeline (draft → applied).
  assert.match(src, /STANDARD_REPORT_FILTERS\[selected\]\?\.length\) return draftStandardFilters/);
});

test("payable reports gain department multi-select; echo chips cover standard reports", () => {
  const src = page();
  assert.match(src, /data-testid="payable-departments"/);
  assert.match(src, /data-testid="payable-emp-departments"/);
  assert.match(src, /params\.set\("departments", payableDepartments\.join\(","\)\)/);
  assert.match(src, /params\.set\("emp_departments", payableEmpDepartments\.join\(","\)\)/);
  // Echo chips for the standard dimensions.
  for (const token of [
    "`Dept: ${stdDepartments.join(\", \")}`",
    "`Emp. dept: ${stdEmpDepartments.join(\", \")}`",
    "`Pay group: ${stdPayGroups.join(\", \")}`",
    "`Emp. dept: ${payableEmpDepartments.join(\", \")}`",
    "`Dept: ${payableDepartments.join(\", \")}`",
  ]) {
    assert.match(src, new RegExp(esc(token)), token);
  }
  // Application-status chip resolves labels per report family (ticket desks localize).
  assert.match(src, /`\$\{statusChipLabel\}: \$\{stdStatuses/);
});

test("switching reports resets the standard filter set", () => {
  const src = page();
  assert.match(src, /setStdEmployeeIds\(\[\]\)/);
  assert.match(src, /setStdDepartments\(\[\]\)/);
  assert.match(src, /setStdEmpDepartments\(\[\]\)/);
  assert.match(src, /setStdPayGroups\(\[\]\)/);
  assert.match(src, /setStdStatuses\(\[\]\)/);
  assert.match(src, /setStdDateTo\(""\)/);
  assert.match(src, /setStdYear\(""\)/);
  assert.match(src, /setStdDesignation\(""\)/);
  assert.match(src, /setStdEmpStatus\(""\)/);
});
