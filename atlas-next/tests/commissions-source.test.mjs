import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return readFileSync(join(root, rel), "utf8");
}

test("commissions page is a voucher header + multi-line grid (screenshot contract)", () => {
  const src = read("app/(app)/commissions/page.tsx");
  for (const token of [
    'data-testid="commissions-page"',
    'data-testid="commission-voucher-card"',
    'data-testid="commission-voucher-no"',
    'data-testid="commission-voucher-date"',
    'data-testid="commission-voucher-month"',
    'data-testid="commission-line-grid"',
    'data-testid="btn-new-voucher"',
    'data-testid="btn-add-line"',
    '"commission-line"',
    "-employee-${index}",
    "-amount-${index}",
    "-remarks-${index}",
    "-total`}",
    'data-testid="btn-save-voucher"',
    'data-testid="btn-save-print-voucher"',
    'data-testid="btn-clear-voucher"',
    'data-testid="commission-voucher-footer"',
    "EmployeeCombobox",
    'type="month"',
    "bi.voucherNo",
    "comm.total",
    "comm.savePrint",
  ]) {
    assert.match(src, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), token);
  }
});

test("commissions voucher grid uses plain row numbers — never 'Line N' labels", () => {
  const src = read("app/(app)/commissions/page.tsx");
  assert.doesNotMatch(src, />\s*Line\s+\d/, "JSX must not render 'Line N' row labels");
  assert.doesNotMatch(src, /["'`]Line\s+\$\{/, "no 'Line ${n}' template labels");
  assert.doesNotMatch(src, /["'`]Line\s+\d/, "no 'Line N' string literals");
  assert.match(src, /index \+ 1/, "rows keep plain 1-based numbers in the # column");
});

test("commissions voucher entry guards: duplicate block, BHD lock, Enter-row, amount hint", () => {
  const src = read("app/(app)/commissions/page.tsx");
  for (const token of [
    "already on this voucher", // pick-time duplicate block (toast)
    "merge the amounts into one line", // validateForm duplicate guard
    "Currency locked to BHD", // currency input locked
    "LOCKED_CURRENCY",
    "HIGH_LINE_AMOUNT", // soft high-value threshold
    'data-testid="commission-high-amount-hint"',
    "onKeyDown", // Enter on amount appends the next row
    "preloadedMonthRef", // one-time preload of the latest voucher's month
  ]) {
    assert.match(src, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), token);
  }
});

test("commissions page lists vouchers with filters and view/edit/print/delete actions", () => {
  const src = read("app/(app)/commissions/page.tsx");
  for (const token of [
    "/commissions/vouchers?",
    'data-testid="voucher-filter-no"',
    'data-testid="voucher-filter-status"',
    'data-testid="voucher-filter-month-from"',
    'data-testid="voucher-filter-month-to"',
    'data-testid="voucher-filter-amount-min"',
    'data-testid="voucher-filter-amount-max"',
    'data-testid="voucher-search"',
    "btn-edit-voucher-",
    "btn-delete-voucher-",
    "btn-print-voucher-",
    "print.pdf",
    "duplicate_warning",
    "allow_duplicate",
    "If-Match",
    "ConfirmDialog",
    "page.commissions.title",
  ]) {
    assert.match(src, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), token);
  }
});

test("commissions register does not pin columns (sticky overlays neighbouring headers)", () => {
  const src = read("app/(app)/commissions/page.tsx");
  const css = read("app/globals.css");
  assert.doesNotMatch(src, /stickyFirst/, "sticky first column overlays Voucher Date");
  assert.doesNotMatch(
    src,
    /sticky\s+(?:end|right)-0/,
    "Actions cells must not use sticky end/right — overlaps neighboring columns",
  );
  assert.match(src, /table-header-clip/, "register uses header paint-fence class");
  assert.match(src, /min-w-\[8\.5rem\]/, "voucher-no column has a header-fit min-width");
  assert.match(src, /min-w-\[9rem\]/, "voucher-date column has a header-fit min-width");
  assert.match(src, /tracking-normal/, "register headers drop tracking-wider so labels fit");
  assert.match(css, /\.table-header-clip/);
  assert.match(src, /text-right">Actions<\/TH>/);
});

test("commissions nav entry sits after Loans with BadgeDollarSign", () => {
  const shell = read("components/layout/app-shell.tsx");
  assert.match(shell, /BadgeDollarSign/);
  assert.match(shell, /nav-commissions/);
  const loansIdx = shell.indexOf('testId: "nav-loans"');
  const commIdx = shell.indexOf('testId: "nav-commissions"');
  const financeIdx = shell.indexOf('testId: "nav-finance-ledger"');
  assert.ok(loansIdx >= 0 && commIdx > loansIdx, "commissions nav must follow loans");
  assert.ok(financeIdx > commIdx, "commissions nav must precede finance");
});

test("commissions + voucher i18n keys exist in EN and AR dicts", () => {
  const src = read("lib/i18n/messages.ts");
  for (const key of [
    "nav.commissions",
    "page.commissions.title",
    "page.commissions.subtitle",
    "comm.voucherNo",
    "comm.voucherDate",
    "comm.periodMonth",
    "comm.total",
    "comm.addLine",
    "comm.save",
    "comm.savePrint",
    "comm.clear",
    "report.commissionBi",
    "bi.groupBy",
  ]) {
    const occurrences = src.split(`"${key}"`).length - 1;
    assert.ok(occurrences >= 2, `${key} must exist in both EN and AR dicts`);
  }
});

test("reports catalog includes commission reports and the Commission BI tile", () => {
  const src = read("app/(app)/reports/page.tsx");
  for (const token of [
    "commission-details",
    "commission-summary",
    "commission-bi",
    "COMMISSION_REPORTS",
    "COMMISSION_BI_REPORTS",
    'data-testid="commission-filters"',
    'idPrefix="comm"',
    'data-testid="comm-status"',
    "month_from",
    "month_to",
  ]) {
    assert.match(src, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), token);
  }
});

test("Commission BI filter card exposes group-by and all multi-filters", () => {
  const src = read("app/(app)/reports/page.tsx");
  for (const token of [
    'data-testid="commission-bi-filters"',
    'data-testid="bi-group-by"',
    'idPrefix="bi"',
    'data-testid="bi-employee"',
    'data-testid="bi-department"',
    'data-testid="bi-designation"',
    'data-testid="bi-pay-group"',
    'data-testid="bi-status"',
    'data-testid="bi-amount-min"',
    'data-testid="bi-amount-max"',
    'data-testid="bi-voucher-no"',
    'data-testid="bi-currency"',
    "group_by",
    "employee_id",
    "designation",
    "pay_group",
    "By pay group",
    "amount_min",
    "amount_max",
    "voucher_no",
    "currency",
  ]) {
    assert.match(src, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), token);
  }
});

test("reports grid design: numeric right-align, totals footer, filter echo, no 'line' wording", () => {
  const src = read("app/(app)/reports/page.tsx");
  for (const token of [
    'data-testid="report-filter-echo"',
    'data-testid="report-totals-row"',
    "numericColumns",
    "isNumericCell",
    "tabular-nums",
    "text-right",
    "Monthly commission vouchers",
  ]) {
    assert.match(src, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), token);
  }
  assert.doesNotMatch(src, /Line-wise/, "no 'Line-wise' wording in report blurbs");
  assert.doesNotMatch(src, /voucher lines/, "no 'voucher lines' wording");
  assert.doesNotMatch(src, /line status/, "no 'line status' wording");
  assert.doesNotMatch(src, /journal lines/, "no 'journal lines' wording");
});

test("Commission voucher types match the API payload shape", () => {
  const src = read("lib/types.ts");
  assert.match(src, /export interface Commission \{/);
  assert.match(src, /export interface CommissionMeta \{/);
  assert.match(src, /export interface CommissionVoucherLine \{/);
  assert.match(src, /export interface CommissionVoucher \{/);
  for (const field of [
    "voucher_no",
    "voucher_date",
    "period_month",
    "line_count",
    "total",
    "lines",
    "employee_code",
    "designation",
    "department",
    "remarks",
    "version",
  ]) {
    assert.match(src, new RegExp(field), field);
  }
});
