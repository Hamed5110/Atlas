import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return readFileSync(join(root, rel), "utf8");
}

test("tt-connection guard blocks empty company/host/database", () => {
  const lib = read("lib/tt-connection.ts");
  assert.match(lib, /isCompanyId/);
  assert.match(lib, /connectionDraftError/);
  assert.match(lib, /Select an active company/);
  assert.match(lib, /Host \/ SQL Server IP is required/);
  assert.match(lib, /Database name is required/);
  assert.match(lib, /connectionSaveBody/);
  // Short 4-digit company ids (e.g. 0001) must be accepted
  assert.match(lib, /\\d\{4\}/);
});

test("isCompanyId accepts short 4-digit and legacy UUID shapes", () => {
  const lib = read("lib/tt-connection.ts");
  // Must not require RFC variant nibble [89ab] — legacy seed id used …-1111-…
  assert.doesNotMatch(lib, /\[89ab\]/);
  assert.match(lib, /\\d\{4\}/);
  assert.match(lib, /\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{12\}/i);
});

test("time-tracking page wires company identity and guards Save", () => {
  const src = read("app/(app)/time-tracking/page.tsx");
  assert.match(src, /connectionDraftError/);
  assert.match(src, /connectionSaveBody/);
  assert.match(src, /tt-connection-company/);
  assert.match(src, /tt-save-connection/);
  assert.match(src, /canSaveConnection/);
  assert.match(src, /setCompanyId\(preferred\.id\)/);
  assert.match(src, /disabled=\{!canSaveConnection/);
});
