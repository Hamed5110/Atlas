import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return readFileSync(join(root, rel), "utf8");
}

test("allocation disables ENTITLEMENT_AMOUNT when entitlement is zero", () => {
  const source = read("app/(app)/allocation/page.tsx");
  assert.match(source, /ENTITLEMENT_AMOUNT/);
  assert.match(source, /entitlementOptionAvailable/);
  assert.match(source, /settlement-option-\$\{value\}/);
  assert.match(source, /Unavailable — employee has no entitlement amount/);
  assert.match(source, /No entitlement/);
});
