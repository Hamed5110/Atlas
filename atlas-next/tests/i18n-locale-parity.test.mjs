/** Static contract: EN/AR key parity + Arabic script on chrome keys. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "lib/i18n/messages.ts"), "utf8");

function parseDict(name) {
  const m = src.match(new RegExp(`const ${name}: Dict = \\{([\\s\\S]*?)\\n\\};`));
  assert.ok(m, `missing dict ${name}`);
  const body = m[1];
  const out = {};
  for (const km of body.matchAll(
    /"([^"]+)":\s*((?:"(?:\\.|[^"\\])*")(?:\s*\+\s*(?:"(?:\\.|[^"\\])*"))*)/g
  )) {
    const key = km[1];
    const parts = [...km[2].matchAll(/"(?:\\.|[^"\\])*"/g)].map((p) => JSON.parse(p[0]));
    out[key] = parts.join("");
  }
  return out;
}

const en = parseDict("en");
const ar = parseDict("ar");
const AR = /[\u0600-\u06FF]/;

test("EN/AR key sets are identical", () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(ar).sort());
});

test("no empty translation values", () => {
  for (const [k, v] of Object.entries(en)) assert.ok(String(v).trim(), `empty en ${k}`);
  for (const [k, v] of Object.entries(ar)) assert.ok(String(v).trim(), `empty ar ${k}`);
});

test("Arabic chrome keys contain Arabic script", () => {
  for (const k of [
    "nav.dashboard",
    "nav.ess",
    "page.dashboard.title",
    "login.submit",
    "ai.teachEverything",
  ]) {
    assert.ok(AR.test(ar[k]), `${k}=${ar[k]}`);
    assert.ok(!AR.test(en[k]), `en polluted ${k}`);
  }
});

test("language switcher source has testids", () => {
  const sw = readFileSync(join(root, "components/language-switcher.tsx"), "utf8");
  assert.match(sw, /data-testid="language-switcher"/);
  assert.match(sw, /data-testid="lang-en"/);
  assert.match(sw, /data-testid="lang-ar"/);
});
