import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const page = () => readFileSync(join(root, "app/(app)/time-tracking/page.tsx"), "utf8");

test("auto sync status + Process WA queue buttons wired", () => {
  const src = page();
  assert.match(src, /tt-auto-sync-status/);
  assert.match(src, /tt-process-wa-queue/);
  assert.match(src, /tt-logs-process-wa/);
  assert.match(src, /scheduler\/tick/);
  assert.match(src, /Process WA queue/);
  assert.match(src, /trigger.*schedule|schedule.*manual/i);
});
