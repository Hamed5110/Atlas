import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("fmtReportCell fixes days / amounts / counts for comfortable grids", async () => {
  const { fmtReportCell, reportColumnKind } = await import("../lib/format.ts");
  assert.equal(reportColumnKind("Accrued Days"), "days");
  assert.equal(reportColumnKind("Closing Balance"), "amount");
  assert.equal(reportColumnKind("Tickets Taken"), "count");
  assert.equal(fmtReportCell("Accrued Days", "1.4167"), "1.4167");
  assert.equal(fmtReportCell("Accrued Days", "55.416"), "55.4160");
  assert.equal(fmtReportCell("Accrued Amount", "3.54"), "3.54");
  assert.equal(fmtReportCell("Closing Balance", 67.08), "67.08");
  assert.equal(fmtReportCell("Tickets Taken", "1"), "1");
  assert.equal(fmtReportCell("Employee Code", "0003"), "0003");
});

test("sticky identity pins Code + Name for allocation columns", async () => {
  const { stickyIdentityCount, isEmphasisColumn } = await import("../lib/report-view.ts");
  assert.equal(
    stickyIdentityCount(["Employee Code", "Employee Name", "Department", "Closing Balance"]),
    2
  );
  assert.equal(stickyIdentityCount(["Department", "Closing Balance"]), 0);
  assert.equal(isEmphasisColumn("Closing Balance"), true);
  assert.equal(isEmphasisColumn("Accrued Days"), false);
});

test("reports table uses compact sheet scroll + zebra for wide views", () => {
  const src = readFileSync(join(root, "app/(app)/reports/page.tsx"), "utf8");
  assert.match(src, /fmtReportCell/);
  assert.match(src, /stickyIdentityCount/);
  assert.match(src, /density=\{density\}/);
  assert.match(src, /sheetScroll/);
  assert.match(src, /zebra=\{useZebra\}/);
  assert.match(src, /data-testid="report-data-table"/);
});
