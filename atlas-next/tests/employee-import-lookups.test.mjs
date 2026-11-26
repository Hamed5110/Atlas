import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("Import panel surfaces lookup plan from employee Excel verify", () => {
  const src = readFileSync(join(root, "components/import-panel.tsx"), "utf8");
  assert.match(src, /data-testid="import-lookup-plan"/);
  assert.match(src, /lookups_created/);
  assert.match(src, /Lookups from this workbook/);
});

test("Employee Master import copy mentions lookups sync", () => {
  const src = readFileSync(join(root, "app/(app)/employees/page.tsx"), "utf8");
  // Emp. Department is part of the same workbook → lookups sync.
  assert.match(src, /Lookups \(department, emp\. department, designation/);
  assert.match(src, /invalidateQueries\(\{ queryKey: \["lookups"\] \}\)/);
});
