import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const page = readFileSync(new URL("../app/(app)/employees/page.tsx", import.meta.url), "utf8");
const messages = readFileSync(new URL("../lib/i18n/messages.ts", import.meta.url), "utf8");

test("employee row opens field history and can filter incomplete profiles", () => {
  assert.match(page, /export function employeeGaps/);
  assert.match(page, /status === "incomplete" && employeeGaps\(e\)\.length === 0/);
  assert.match(page, /btn-history-employee-\$\{e\.code\}/);
  assert.match(page, /function historyField/);
  assert.match(page, /employees\.historyNoFields/);
  assert.match(page, /\/employees\/\$\{historyFor!\.id\}\/history/);
  for (const key of [
    "employees.history",
    "employees.historyEmpty",
    "employees.incomplete",
    "employees.gap.passport",
    "employees.gap.id",
  ]) {
    assert.equal((messages.match(new RegExp(`"${key}"`, "g")) ?? []).length, 2);
  }
});
