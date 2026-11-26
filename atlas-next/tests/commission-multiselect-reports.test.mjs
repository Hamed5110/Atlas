import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const page = () => readFileSync(join(root, "app/(app)/reports/page.tsx"), "utf8");
const component = () => readFileSync(join(root, "components/ui/multi-select.tsx"), "utf8");

const esc = (token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

test("MultiSelect component: checkbox listbox, search, select-all/clear, removable chips", () => {
  const src = component();
  for (const token of [
    'role="listbox"',
    'aria-multiselectable="true"',
    'role="option"',
    "aria-selected",
    "Select all",
    "Clear",
    "-select-all",
    "-clear",
    "-chips",
    "-chip-",
    "-chip-remove-",
    "aria-label={`Remove ${o.label}`}",
    "data-multiselect",
  ]) {
    assert.match(src, new RegExp(esc(token)), token);
  }
});

test("commission filter cards use multi-select dropdowns for employee/department/pay group/status", () => {
  const src = page();
  // Plain commission card (details/summary)
  for (const token of [
    'data-testid="comm-employees"',
    'data-testid="comm-departments"',
    'data-testid="comm-pay-groups"',
    'data-testid="comm-status"',
  ]) {
    assert.match(src, new RegExp(esc(token)), token);
  }
  // Commission BI card
  for (const token of [
    'data-testid="bi-employee"',
    'data-testid="bi-department"',
    'data-testid="bi-pay-group"',
    'data-testid="bi-status"',
  ]) {
    assert.match(src, new RegExp(esc(token)), token);
  }
  // All eight are MultiSelect instances.
  const uses = src.split("<MultiSelect").length - 1;
  assert.ok(uses >= 8, `expected >= 8 <MultiSelect> usages, got ${uses}`);
});

test("multi-value params serialize as comma lists (OR within a dimension)", () => {
  const src = page();
  for (const token of [
    'params.set("statuses", commStatuses.join(","))',
    'params.set("employee_ids", commEmployeeIds.join(","))',
    'params.set("departments", commDepartments.join(","))',
    'params.set("pay_groups", commPayGroups.join(","))',
    'params.set("employee_ids", biEmployeeIds.join(","))',
    'params.set("departments", biDepartments.join(","))',
    'params.set("statuses", biStatuses.join(","))',
    'params.set("pay_groups", biPayGroups.join(","))',
  ]) {
    assert.match(src, new RegExp(esc(token)), token);
  }
});

test("filter echo chips list every selected value per dimension", () => {
  const src = page();
  for (const token of [
    "`Status: ${commStatuses.join(", ")}`",
    "`Status: ${biStatuses.join(", ")}`",
    "`Dept: ${commDepartments.join(", ")}`",
    "`Dept: ${biDepartments.join(", ")}`",
    "`Pay group: ${commPayGroups.join(", ")}`",
    "`Pay group: ${biPayGroups.join(", ")}`",
    "Employees: ${codes.join",
    'data-testid="report-filter-echo"',
  ]) {
    assert.match(src, new RegExp(esc(token)), token);
  }
});

test("KPI band, month period picker, group-by chips, and sortable grid are preserved", () => {
  const src = page();
  for (const token of [
    'data-testid="report-kpi-cards"',
    "commissionKpi",
    'idPrefix="comm"',
    'idPrefix="bi"',
    "presets={MONTH_PRESETS}",
    "bi-group-by-chip-${g.id}",
    "toggleSort",
    "aria-sort",
    'data-testid="report-totals-row"',
  ]) {
    assert.match(src, new RegExp(esc(token)), token);
  }
});
