import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

test("daily grid uses sticky-first table and aligned filters", () => {
  const page = read("app/(app)/time-tracking/page.tsx");
  assert.match(page, /stickyFirst/);
  assert.match(page, /tt-daily-filters/);
  assert.match(page, /tt-daily-grid/);
  assert.match(page, /items-end/);
  assert.match(page, /fmtDate\(r\.work_date\)/);
});

test("table primitive supports sticky first column without collapse", () => {
  const table = read("components/ui/table.tsx");
  assert.match(table, /stickyFirst/);
  assert.match(table, /border-separate/);
  assert.match(table, /table-sticky-first/);
  assert.match(table, /select-none/);
});

test("sticky-first CSS pins first column with start padding", () => {
  const css = read("app/globals.css");
  assert.match(css, /\.table-sticky-first/);
  assert.match(css, /padding-inline-start:\s*1\.25rem/);
  assert.match(css, /position:\s*sticky/);
  assert.match(css, /left:\s*0/);
});

test("Field labels use readable token size (not tiny text-xs only)", () => {
  const input = read("components/ui/input.tsx");
  assert.match(input, /text-\[0\.8125rem\]/);
});
