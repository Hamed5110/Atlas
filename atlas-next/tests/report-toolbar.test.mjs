import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const page = readFileSync(join(root, "app/(app)/reports/page.tsx"), "utf8");

test("reportExportFilename builds safe stems", async () => {
  const { reportExportFilename } = await import("../lib/report-toolbar.ts");
  assert.equal(
    reportExportFilename("Airfare Allocation", "xlsx", "2026-11-22"),
    "Airfare-Allocation-2026-11-22.xlsx"
  );
  assert.equal(reportExportFilename("Odd / Name?", "pdf", "2026-01-01"), "Odd-Name-2026-01-01.pdf");
});

test("SAP Go mode: Apply / dirty hint / draft vs applied suffix", () => {
  assert.match(page, /draftQuerySuffix/);
  assert.match(page, /appliedQuerySuffix/);
  assert.match(page, /filtersDirty/);
  assert.match(page, /FilterBarActions/);
  assert.match(page, /applyTestId="payable-filter-apply"/);
  assert.match(page, /data-testid="filter-dirty-hint"/);
  assert.match(page, /Filters changed/);
  assert.match(page, /Apply to refresh/);
  assert.match(page, /ttCompanyGate/);
  assert.match(page, /filtersCommittedFor === selected/);
  assert.match(page, /!filtersDirty/);
  assert.match(page, /qs\.set\("department", department\)/);
  assert.match(page, /Apply filters first/);
  assert.match(page, /rangeFromPreset\("today"\)/);
});

test("table toolbar exposes Excel PDF Print Refresh density", () => {
  assert.match(page, /const runExport = useCallback/);
  assert.match(page, /data-testid="report-toolbar-xlsx"/);
  assert.match(page, /data-testid="report-toolbar-pdf"/);
  assert.match(page, /data-testid="report-toolbar-print"/);
  assert.match(page, /data-testid="report-toolbar-refresh"/);
  assert.match(page, /data-testid="report-density"/);
  assert.match(page, /density=\{density\}/);
});

test("dismissible filter chips for nationality / dept", () => {
  assert.match(page, /data-testid=\{`filter-chip-\$\{chip\.key\}`\}/);
  assert.match(page, /onClear/);
});
