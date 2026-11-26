import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const page = () => readFileSync(join(root, "app/(app)/reports/page.tsx"), "utf8");

test("Reports menu includes TT catalog + period presets", () => {
  const src = page();
  for (const name of [
    "hcm-attendance",
    "tt-latecomers",
    "tt-absences",
    "tt-missing-punch",
    "tt-employee-summary",
    "tt-department-summary",
  ]) {
    assert.match(src, new RegExp(name));
  }
  assert.match(src, /idPrefix="att"/);
  assert.match(src, /presets=\{ATTENDANCE_PRESETS\}/);
  const presets = readFileSync(join(root, "components/reports/date-range-filter.tsx"), "utf8");
  assert.match(presets, /export const ATTENDANCE_PRESETS/);
  for (const id of ["this_quarter", "last_quarter", "this_year", "ytd", "last_year"]) {
    assert.match(presets, new RegExp(`"${id}"`));
  }
  assert.match(src, /this_week/);
  assert.match(src, /this_month/);
  assert.match(src, /att-department/);
});
