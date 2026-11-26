import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const page = () => readFileSync(join(root, "app/(app)/time-tracking/page.tsx"), "utf8");

test("WhatsApp alerts UI exposes buffer-after-late-rule setting", () => {
  const src = page();
  assert.match(src, /alert_buffer_minutes/);
  assert.match(src, /tt-alert-buffer-minutes/);
  assert.match(src, /WA buffer after late rule/);
  assert.match(src, /late rule \+ WA buffer/);
});
