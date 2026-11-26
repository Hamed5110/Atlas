import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const page = () => readFileSync(join(root, "app/(app)/time-tracking/page.tsx"), "utf8");

test("assign shift uses bulk multi-select big-screen dialog", () => {
  const src = page();
  assert.match(src, /employee-shifts\/bulk/);
  assert.match(src, /size="full"/);
  assert.match(src, /tt-assign-multi/);
  assert.match(src, /Select all filtered/);
  assert.match(src, /Selected employees/);
  assert.match(src, /employee_ids/);
  assert.doesNotMatch(src, /employee_id: assignForm\.employee_id/);
});
