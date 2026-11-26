import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const backend = "C:/HCM Airfare/src/airfare_management/api/data_exchange.py";

function read(rel) {
  return readFileSync(join(root, rel), "utf8");
}

/** Screen → dataset keys it must offer through ExcelToolbar. */
const SCREENS = {
  "app/(app)/lookups/page.tsx": ["lookups"],
  "app/(app)/rates/page.tsx": ["entitlement-rates"],
  "app/(app)/entitlement/rules/page.tsx": ["entitlement-rules"],
  "app/(app)/time-tracking/page.tsx": ["tt-shifts", "tt-roster", "tt-calendar"],
  "app/(app)/allocation/page.tsx": ["tickets"],
  "app/(app)/loans/page.tsx": ["loans", "opening-loans"],
  "app/(app)/ess/page.tsx": ["ess-requests"],
  "app/(app)/commissions/page.tsx": ["commission-vouchers"],
  "app/(app)/hr-forms/page.tsx": ["hr-documents"],
  "app/(app)/users/page.tsx": ["users"],
  "app/(app)/roles/page.tsx": ["roles"],
  "app/(app)/audit/page.tsx": ["audit"],
  "app/(app)/settings/page.tsx": ["companies"],
};

test("every list screen offers Excel export (and import where the data allows it)", () => {
  for (const [file, keys] of Object.entries(SCREENS)) {
    const source = read(file);
    assert.match(source, /from "@\/components\/excel-toolbar"/, `${file} imports ExcelToolbar`);
    for (const key of keys) {
      assert.match(source, new RegExp(`<ExcelToolbar dataset="${key}"`), `${file} → ${key}`);
    }
  }
});

test("screens with their own importers keep export + import", () => {
  for (const [file, slug] of [
    ["app/(app)/employees/page.tsx", "employees"],
    ["app/(app)/opening-balances/page.tsx", "opening-balances"],
  ]) {
    const source = read(file);
    assert.match(source, new RegExp(`${slug}/export\\.xlsx`));
    assert.match(source, /ImportPanel/);
  }
  assert.match(read("app/(app)/commissions/page.tsx"), /commissions\/import\/preview/);
});

test("toolbar dataset keys exist in the backend registry", { skip: !existsSync(backend) }, () => {
  const registry = readFileSync(backend, "utf8");
  for (const keys of Object.values(SCREENS)) {
    for (const key of keys) {
      assert.match(registry, new RegExp(`Dataset\\(\\s*"${key}"`), `backend dataset ${key}`);
    }
  }
});

test("ExcelToolbar uses the exchange API, import modes and the error report", () => {
  const source = read("components/excel-toolbar.tsx");
  assert.match(source, /\/exchange\/\$\{encodeURIComponent\(key\)\}/);
  for (const part of ["export.xlsx", "template.xlsx", "preview?mode=", "commit", "errors.xlsx"]) {
    assert.ok(source.includes(part), part);
  }
  assert.match(source, /"upsert", "insert_only", "update_only"/);
  assert.match(source, /if \(!entry\) return null/, "hidden when the role cannot see the dataset");
  assert.match(source, /entry\.importable && !exportOnly/);
  assert.match(source, /commitExtra=\{\{ mode \}\}/);
});

test("ImportPanel reports a rejected all-or-nothing commit and offers the error workbook", () => {
  const source = read("components/import-panel.tsx");
  assert.match(source, /result\.committed === false/);
  assert.match(source, /Nothing was imported/);
  assert.match(source, /downloadPost\(errorReportPath, \{ rows \}/);
  assert.match(source, /templatePath \?\? `\/templates\/\$\{templateName\}\.xlsx`/);
});

test("Excel strings exist in English and Arabic", () => {
  const messages = read("lib/i18n/messages.ts");
  for (const key of [
    "excel.export",
    "excel.import",
    "excel.mode",
    "excel.mode.upsert",
    "excel.mode.insert_only",
    "excel.mode.update_only",
    "excel.importHelp",
  ]) {
    const hits = messages.split(`"${key}":`).length - 1;
    assert.equal(hits, 2, `${key} in en + ar`);
  }
});
