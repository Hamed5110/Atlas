import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return readFileSync(join(root, rel), "utf8");
}

test("ImportPanel verifies workbook, selects READY rows, and commits selection", () => {
  const source = read("components/import-panel.tsx");
  assert.match(source, /Verify workbook/);
  assert.match(source, /type="checkbox"/);
  assert.match(source, /toggleRow/);
  assert.match(source, /selectedRows/);
  assert.match(source, /severity === "READY"/);
  assert.match(source, /commitPath/);
  assert.match(source, /previewPath/);
  assert.match(source, /r\.action/);
  assert.match(source, /Import \{selectedRows\.length\} rows/);
});

test("Opening balances page exports Excel and uses ImportPanel", () => {
  const source = read("app/(app)/opening-balances/page.tsx");
  assert.match(source, /opening-balances\/export\.xlsx/);
  assert.match(source, /Export Excel/);
  assert.match(source, /ImportPanel/);
  assert.match(source, /opening-balances\/import\/preview/);
  assert.match(source, /opening-balances\/import\/commit/);
});
