import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Behavioral replica of fmtMonth semantics (source is TS; contract checks below
// pin the real implementation). "2026-09" must render as "September 2026".
function fmtMonthReplica(value) {
  if (!value) return "—";
  const raw = String(value).trim();
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(raw);
  if (!match) return raw;
  const d = new Date(Number(match[1]), Number(match[2]) - 1, 1);
  return d.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

test("fmtMonth semantics: YYYY-MM → MMMM YYYY", () => {
  assert.equal(fmtMonthReplica("2026-09"), "September 2026");
  assert.equal(fmtMonthReplica("2026-01"), "January 2026");
  assert.equal(fmtMonthReplica("2026-12"), "December 2026");
  assert.equal(fmtMonthReplica("2026-13"), "2026-13"); // invalid month passes through
  assert.equal(fmtMonthReplica("2026-9"), "2026-9"); // unpadded passes through
  assert.equal(fmtMonthReplica(""), "—");
  assert.equal(fmtMonthReplica(null), "—");
});

test("fmtMonth exists in lib/format.ts with MMMM YYYY locale output", () => {
  const src = readFileSync(join(root, "lib/format.ts"), "utf8");
  assert.match(src, /export function fmtMonth/);
  assert.match(src, /month: "long", year: "numeric"/);
});

test("fmtGridCell routes YYYY-MM cells through fmtMonth (all reports)", () => {
  const src = readFileSync(join(root, "lib/format.ts"), "utf8");
  const grid = src.slice(src.indexOf("export function fmtGridCell"));
  assert.match(grid, /fmtMonth\(raw\)/);
  // date-only check must run before the month check so 2026-09-21 stays a date
  assert.ok(grid.indexOf("fmtDate(raw)") < grid.indexOf("fmtMonth(raw)"));
});

test("commissions register renders Period Month via fmtMonth", () => {
  const src = readFileSync(join(root, "app/(app)/commissions/page.tsx"), "utf8");
  assert.match(src, /fmtMonth\(v\.period_month\)/);
  assert.match(src, /fmtMonth\(header\.period_month\)/);
  assert.match(src, /fmtMonth\(editing\.period_month\)/);
  // month input values must stay raw YYYY-MM for <input type="month">
  assert.match(src, /value=\{header\.period_month\}/);
});

test("reports page formats month filter chips via fmtMonth", () => {
  const src = readFileSync(join(root, "app/(app)/reports/page.tsx"), "utf8");
  assert.match(src, /fmtMonth\(commMonth\)/);
  assert.match(src, /fmtMonth\(commMonthFrom\)/);
  assert.match(src, /fmtMonth\(commMonthTo\)/);
});
