/** Help assistant page: follow-up memory, live-check badge, screen links and starter questions. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");
const page = read("app/(app)/help/page.tsx");
const messages = read("lib/i18n/messages.ts");
const [en, ar] = messages.split("const ar");

test("questions carry the last turns so follow-ups like 'explain simpler' work", () => {
  assert.match(page, /body: \{ question: q, history \}/);
  assert.match(page, /onSuccess: \(data, q\) => setHistory\(\(prev\) => nextHistory\(prev, q, data\.answer\)\)/);
  const lib = read("lib/help-history.ts");
  assert.match(lib, /HELP_HISTORY_TURNS = 3/);
  assert.match(lib, /answer\.slice\(0, 2000\)/);
  assert.match(lib, /question\.slice\(0, 500\)/);
  assert.match(lib, /\.slice\(\s*-HELP_HISTORY_TURNS/);
});

test("page file exports only the page component (Next rejects other exports)", () => {
  const exports = page.match(/^export\s+(?!default)/gm) ?? [];
  assert.equal(exports.length, 0);
});

test("live answers are badged and suggested screens open inside the app", () => {
  assert.match(page, /ask\.data\.live_check \?/);
  assert.match(page, /data-testid="help-live-badge"/);
  assert.match(page, /href=\{appPath\(s\.route\)\}/);
  assert.match(page, /min-h-11[^"]*lg:min-h-9/);
  assert.match(page, /rtl:-scale-x-100/);
  assert.doesNotMatch(page, /dangerouslySetInnerHTML/);
});

test("starter questions and new strings exist in English and Arabic", () => {
  for (const key of [
    "help.askHintLive",
    "help.checkedLive",
    "help.openScreen",
    "help.tryAsking",
    "help.suggest.status",
    "help.suggest.whatsapp",
    "help.suggest.attention",
    "help.suggest.theme",
    "help.suggest.excel",
    "help.followUp",
  ]) {
    assert.ok(en.includes(`"${key}":`), `${key} missing in English`);
    assert.ok(ar.includes(`"${key}":`), `${key} missing in Arabic`);
  }
  assert.match(en, /"help\.suggest\.status": "Is the system working\?"/);
  assert.match(ar, /"help\.suggest\.status": "هل النظام يعمل؟"/);
});
