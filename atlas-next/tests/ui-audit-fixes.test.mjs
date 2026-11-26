import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

test("table scroll box is a positioning parent so sr-only cells cannot widen the page", () => {
  assert.match(read("components/ui/table.tsx"), /tt-table-scroll relative /);
  assert.match(read("app/(app)/commissions/page.tsx"), /table-sheet-scroll relative /);
});

test("tabs scroll sideways on phones and expose tab roles", () => {
  const src = read("components/ui/tabs.tsx");
  assert.match(src, /role="tablist"/);
  assert.match(src, /max-w-full[^"]*overflow-x-auto/);
  assert.match(src, /role="tab"/);
  assert.match(src, /aria-selected=\{active === tab\.id\}/);
  assert.match(src, /shrink-0[^"]*whitespace-nowrap/);
});

test("Field links its visible label to the input, select or textarea", () => {
  const src = read("components/ui/input.tsx");
  assert.match(src, /useId\(\)/);
  assert.match(src, /FIELD_CONTROLS = new Set<unknown>\(\[Input, Select, Textarea/);
  assert.match(src, /<Label htmlFor=\{targetId\}>/);
});

test("phone layouts use a shrinkable single column", () => {
  assert.match(read("app/(app)/settings/page.tsx"), /grid grid-cols-1 gap-6 lg:grid-cols-\[260px_minmax\(0,1fr\)\]/);
  assert.match(read("app/(app)/settings/page.tsx"), /w-full min-w-0 shrink-0 [^"]*sm:w-64/);
  assert.match(read("app/(app)/hr-forms/page.tsx"), /grid grid-cols-1 gap-4 lg:grid-cols-\[15rem_minmax\(0,1fr\)\]/);
  assert.match(read("app/(app)/entitlement/rules/page.tsx"), /grid grid-cols-1 gap-3 sm:grid-cols-2/);
});

test("KPI cards never cut off amounts", () => {
  const src = read("components/ui/primitives.tsx");
  assert.doesNotMatch(src, /truncate text-2xl font-extrabold/);
  assert.match(src, /text-xl font-extrabold leading-tight tracking-tight tabular-nums 2xl:text-2xl/);
  assert.match(src, /function StatValue/, "currency code is a small label beside the full amount");
});

test("every page shares the same side padding; commission totals stay on one line", () => {
  assert.doesNotMatch(read("components/layout/app-shell.tsx"), /max-w-none px-4/);
  const comm = read("app/(app)/commissions/page.tsx");
  assert.match(comm, /whitespace-nowrap text-right font-bold tabular-nums">\{money\(v\.total/);
  assert.match(comm, /table-header-clip min-w-\[66rem\]/, "register fits a desktop card so actions stay on one line");
  assert.match(read("app/(app)/reports/page.tsx"), /\/\^0\\d\/\.test\(cell\.trim\(\)\)/, "leading-zero codes are text");
});

test("dates use one app-wide format and never stack onto several lines", () => {
  const tt = read("app/(app)/time-tracking/page.tsx");
  assert.doesNotMatch(tt, /toLocaleString\(\)/);
  assert.match(tt, /<TD className="whitespace-nowrap">\{fmtDate\(r\.work_date\)\}<\/TD>/);
  assert.match(read("lib/format.ts"), /const dmy = /);
  assert.match(read("app/(app)/reports/page.tsx"), /isDateColumn\(viewColumns\[j\] \?\? ""\) && "whitespace-nowrap"/);
  assert.match(read("app/(app)/reports/page.tsx"), /\{columnLabel\(c\)\}/);
});

test("grid cells: dd-mm-yyyy dates and padded decimals read the app-wide way", async () => {
  const { fmtGridCell } = await import("../lib/format.ts");
  assert.equal(fmtGridCell("21-10-2026"), "21 Oct 2026");
  assert.equal(fmtGridCell("2.0000"), "2.000");
  assert.equal(fmtGridCell("99.9980"), "99.998");
  assert.equal(fmtGridCell("0.20833"), "0.20833");
  assert.equal(fmtGridCell("12.5"), "12.5");
});

test("row actions share one button height", () => {
  assert.match(read("components/ui/button.tsx"), /"icon-sm": "h-11 w-11 lg:h-8 lg:w-8"/);
  assert.match(read("components/hr-lifecycle-studio.tsx"), /size="icon-sm"/);
  assert.match(read("app/(app)/backups/page.tsx"), /size="icon-sm"/);
});

test("audit log shows plain entity names", () => {
  assert.match(read("app/(app)/audit/page.tsx"), /function entityLabel/);
});

test("report codes and document numbers are text columns, not money", () => {
  assert.match(read("lib/report-view.ts"), /export function isIdentifierColumn/);
  assert.match(read("app/(app)/reports/page.tsx"), /!isIdentifierColumn\(data\.columns\[j\] \?\? ""\)/);
});
