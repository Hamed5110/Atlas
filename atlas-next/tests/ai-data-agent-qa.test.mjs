import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return readFileSync(join(root, rel), "utf8");
}

test("AI Insights Data Agent UI enforces Auto-Repair + APPLY + designer handoff", () => {
  const source = read("app/(app)/ai-insights/page.tsx");
  assert.match(source, /\/ai\/agent\/chat/);
  assert.match(source, /\/ai\/agent\/repair\/apply/);
  assert.match(source, /auto_repair_mode|autoRepairMode/);
  assert.match(source, /Auto-Repair/);
  assert.match(source, /disabled=\{!autoRepairMode/);
  assert.match(source, /confirm:\s*"APPLY"/);
  assert.match(source, /apply_token/);
  assert.match(source, /repair_preview/);
  assert.match(source, /report_designer_payload|atlas\.reportSpec/);
  assert.match(source, /atlas\.reportSpec/);
  assert.match(source, /entry\.sql|sql\?/);
  assert.match(source, /awaiting_confirm|manual_review|outcome/);
  assert.match(source, /\/ai\/saa\/baseline/);
  assert.match(source, /\/ai\/saa\/silent-fixes/);
  assert.match(source, /Schema-gated/);
  assert.match(source, /Data Agent/);
  assert.match(source, /never app code|human-gated|whitelist/i);
});

test("AI Insights quick prompts cover core agent intents", () => {
  const source = read("app/(app)/ai-insights/page.tsx");
  for (const prompt of [
    "Run diagnostics",
    "Forecast spend",
    "Draft a report on loans",
    "Show schema",
    "Machine learning anomalies",
  ]) {
    assert.match(source, new RegExp(prompt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});
