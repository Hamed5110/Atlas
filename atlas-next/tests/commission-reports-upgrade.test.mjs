import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const page = () => readFileSync(join(root, "app/(app)/reports/page.tsx"), "utf8");

const esc = (token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

test("commission reports pick whole months with the shared period picker", () => {
  const src = page();
  for (const token of [
    'idPrefix="comm"',
    'idPrefix="bi"',
    "presets={MONTH_PRESETS}",
    'granularity="month"',
    "const commMonthFrom = appliedRange.from.slice(0, 7)",
    "const commMonthTo = appliedRange.to.slice(0, 7)",
    'params.set("month", commMonth)',
  ]) {
    assert.match(src, new RegExp(esc(token)), token);
  }
  // A single-month period echoes as "Month: MMMM YYYY".
  assert.match(src, /Month: \$\{fmtMonth\(commMonth\)\}/, "single month echo chip");
  assert.doesNotMatch(src, /applyCommMonth|comm-month-quick|bi-month-quick/);
});

test("commission results render a KPI card row (total/employees/entries/vouchers)", () => {
  const src = page();
  for (const token of [
    'data-testid="report-kpi-cards"',
    "report-kpi-${id}",
    "commissionKpi",
    "Total amount",
    "Employees",
    "Entries",
    "Vouchers",
    "kpi?: ReportKpi | null",
  ]) {
    assert.match(src, new RegExp(esc(token)), token);
  }
  // All four KPI ids are declared in the card spec array.
  for (const id of ['id: "total"', 'id: "employees"', 'id: "entries"', 'id: "vouchers"']) {
    assert.match(src, new RegExp(esc(id)), id);
  }
});

test("report grid columns are sortable client-side with aria-sort", () => {
  const src = page();
  for (const token of [
    "toggleSort",
    "sortedRows",
    "aria-sort",
    "ascending",
    "descending",
    'sort.dir === "asc" ? "↑" : "↓"',
    "bodyRows.slice(viewPage * PAGE_SIZE",
  ]) {
    assert.match(src, new RegExp(esc(token)), token);
  }
});

test("Commission BI group-by renders as segmented chips with pressed state", () => {
  const src = page();
  for (const token of [
    "bi-group-by-chip-${g.id}",
    "aria-pressed",
    'role="group"',
    'data-testid="bi-group-by"',
  ]) {
    assert.match(src, new RegExp(esc(token)), token);
  }
  // All five group dimensions feed the chip row.
  for (const id of ['id: "employee"', 'id: "month"', 'id: "department"', 'id: "voucher"', 'id: "pay_group"']) {
    assert.match(src, new RegExp(esc(id)), id);
  }
});

test("Commission BI grid emphasizes the group label column", () => {
  const src = page();
  assert.match(src, /COMMISSION_BI_REPORTS\.has\(selected as ReportName\) && j === 0/);
  assert.match(src, /font-semibold text-\[var\(--color-foreground\)\]/);
});
