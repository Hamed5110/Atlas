import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const page = () => readFileSync(join(root, "app/(app)/time-tracking/page.tsx"), "utf8");

test("assignment list has Edit action and PUT update dialog", () => {
  const src = page();
  assert.match(src, /employee-shifts\/\$\{editingAssignment\.id\}/);
  assert.match(src, /method:\s*"PUT"/);
  assert.match(src, /tt-edit-assign/);
  assert.match(src, /tt-edit-assign-save/);
  assert.match(src, /openEditAssignDialog/);
  assert.match(src, /Pencil/);
  assert.match(src, /Edit shift assignment/);
  assert.match(src, /tt-assignments-card/);
  assert.match(src, /Actions/);
});

test("bulk assign multi-select still wired for big screen", () => {
  const src = page();
  assert.match(src, /employee-shifts\/bulk/);
  assert.match(src, /size="full"/);
  assert.match(src, /tt-assign-multi/);
  assert.match(src, /Select all filtered/);
});
