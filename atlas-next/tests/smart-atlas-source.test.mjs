import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return readFileSync(join(root, rel), "utf8");
}

test("AI Insights exposes smart agent and ML anomaly surfaces", () => {
  const source = read("app/(app)/ai-insights/page.tsx");
  assert.match(source, /\/ai\/agent\/chat/);
  assert.match(source, /Ask agent|agentMutation|prompt/);
  assert.match(source, /\/ai\/anomalies/);
  assert.match(source, /atlas\.reportSpec/);
  assert.match(source, /Auto-Repair/);
  assert.match(source, /apply_token/);
  assert.match(source, /Schema-gated/);
  assert.match(source, /Data Agent/);
});

test("Reports page includes designer, excess-recovery, and Crystal status", () => {
  const source = read("app/(app)/reports/page.tsx");
  assert.match(source, /excess-recovery/);
  assert.match(source, /Crystal/);
  assert.match(source, /\/report-templates|report-templates|designer/i);
  assert.match(source, /\/crystal\/status/);
  assert.match(source, /atlas\.reportSpec/);
});
