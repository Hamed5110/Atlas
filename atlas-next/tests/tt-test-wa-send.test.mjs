import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const page = () => readFileSync(join(root, "app/(app)/time-tracking/page.tsx"), "utf8");

test("Send test WhatsApp button on alerts settings", () => {
  const src = page();
  assert.match(src, /tt-send-test-wa/);
  assert.match(src, /alerts\/test-send/);
  assert.match(src, /Send test WhatsApp/);
  assert.match(src, /tt-test-wa-help/);
  assert.match(src, /hr_whatsapp: alertForm\.hr_whatsapp/);
  assert.match(src, /hr_whatsapp=\$\{encodeURIComponent/);
  assert.match(src, /settings_saved/);
  assert.match(src, /saves the numbers above/);
});

test("WhatsApp alerts are described as short text messages, not PDFs", () => {
  const src = page();
  assert.match(src, /Short text messages/);
  assert.doesNotMatch(src, /layout_version/);
});
