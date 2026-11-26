import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("Roles & Permissions screen is admin-only and supports copy-then-restrict", () => {
  const shell = read("components/layout/app-shell.tsx");
  assert.match(shell, /href: "\/roles", labelKey: "nav\.roles"/);
  assert.match(shell, /hidden_screens/);
  const page = read("app/(app)/roles/page.tsx");
  for (const id of ["roles-page", "button-new-role", "permission-matrix", "input-role-name", "button-save-role"]) {
    assert.match(page, new RegExp(`data-testid="${id}"`), id);
  }
  assert.match(page, /denied_modules/);
  assert.match(page, /base_roles/);
  const users = read("app/(app)/users/page.tsx");
  assert.match(users, /"\/roles"/);
});

test("roles labels exist in English and Arabic", () => {
  const messages = read("lib/i18n/messages.ts");
  assert.equal(messages.match(/"nav\.roles"/g)?.length, 2);
  assert.equal(messages.match(/"page\.roles\.title"/g)?.length, 2);
});

test("insight reports are listed in a searchable, grouped catalog", () => {
  const page = read("app/(app)/reports/page.tsx");
  assert.match(page, /name: "travel-spend-trend"/);
  assert.match(page, /reports: \["travel-spend-trend"\]/);
  for (const name of ["top-routes", "ticket-cost-anomalies", "travel-gap", "loan-arrears"]) {
    assert.doesNotMatch(page, new RegExp(`name: "${name}"`), name);
  }
  for (const name of ["document-expiry", "headcount-summary", "service-milestones"]) {
    assert.match(page, new RegExp(`name: "${name}"`), name);
  }
  assert.match(page, /data-testid="reports-search"/);
  assert.match(page, /data-testid=\{`reports-category-\$\{category\.id\}`\}/);
});

test("report results show insight cards, row search and pagination instead of a 100-row cap", () => {
  const page = read("app/(app)/reports/page.tsx");
  assert.match(page, /data-testid="report-insights"/);
  assert.match(page, /data-testid="report-row-search"/);
  assert.match(page, /data-testid="report-pager"/);
  assert.match(page, /visibleRows\.map/);
  assert.doesNotMatch(page, /sortedRows\.slice\(0, 100\)/);
  assert.match(page, /as_of_date/);
});

test("Focus-style report views: layouts, grouping, sub-totals, saved layout, print", () => {
  const page = read("app/(app)/reports/page.tsx");
  for (const id of [
    "report-view-toolbar",
    "view-group-by",
    "view-hide-zero",
    "view-save",
    "report-group-row",
    "report-totals-row",
    "report-print",
    "report-document-header",
  ]) {
    assert.match(page, new RegExp(`data-testid="${id}"`), id);
  }
  assert.match(page, /row\.kind === "subtotal" \? "report-subtotal-row"/);
  assert.match(page, /data-testid=\{`view-layout-\$\{l\.id\}`\}/);
  assert.match(page, /canSortHeader/);
  assert.match(page, /data-print-root/);
  assert.match(page, /\/reports\/export\/\$\{selected\}\.\$\{format\}\$\{exportSuffix\}/);
  assert.match(page, /runExport\("xlsx"\)/);
  assert.match(page, /runExport\("pdf"\)/);
  assert.match(page, /preference_key: `\$\{VIEW_PREFERENCE_PREFIX\}\$\{selected\}`/);
  assert.match(read("app/globals.css"), /body\.print-report \[data-print-root\]/);
});

test("each report opens on its own deep-linkable screen (ERP convention)", () => {
  const page = read("app/(app)/reports/page.tsx");
  assert.match(page, /useSearchParams/);
  assert.match(page, /const REPORT_HREF = \(name: ReportName\) => `\/reports\/\?report=\$\{name\}`/);
  assert.match(page, /href=\{REPORT_HREF\(name\)\}/);
  assert.match(page, /target="_blank"/);
  for (const id of ["report-screen", "report-breadcrumb", "report-screen-header", "report-switcher", "report-back", "report-open-new-tab"]) {
    assert.match(page, new RegExp(`data-testid="${id}"`), id);
  }
  assert.doesNotMatch(page, /setSelected\(/);
  assert.match(page, /<Suspense/);
});

test("screen and API share the same Sum rules and saved-layout format", () => {
  const lib = read("lib/report-view.ts");
  const sumRe = lib.match(/const SUM_RE =\s*\/([^/]+)\/i/)[1];
  const noSumRe = lib.match(/const NO_SUM_RE =\s*\/([^/]+)\/i/)[1];
  assert.match(sumRe, /amount\|amt\|total/);
  assert.match(noSumRe, /rate\|year/);
  assert.match(lib, /\^\(standard\|grouped\|summary\|share\|ranked\|calendar\):\(\\d\{1,2\}\):\(\[01\]\)\$/);
  assert.match(lib, /view_layout/);
  assert.match(lib, /hide_zero/);
});
