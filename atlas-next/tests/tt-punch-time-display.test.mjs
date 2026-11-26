import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("fmtPunchTime treats wall-clock ISO without TZ shift", async () => {
  const src = readFileSync(join(root, "lib/format.ts"), "utf8");
  assert.match(src, /fmtPunchTime/);
  assert.match(src, /site wall-clock/);
  assert.match(src, /hasTz/);
});

test("time-tracking page uses fmtPunchTime for First In / Last Out", () => {
  const src = readFileSync(join(root, "app/(app)/time-tracking/page.tsx"), "utf8");
  assert.match(src, /fmtPunchTime\(r\.first_in\)/);
  assert.match(src, /fmtPunchTime\(r\.last_out\)/);
  assert.doesNotMatch(src, /new Date\(r\.first_in\)\.toLocaleTimeString/);
});
