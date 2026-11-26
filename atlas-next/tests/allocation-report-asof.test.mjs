import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const page = () => readFileSync(join(root, "app/(app)/reports/page.tsx"), "utf8");

test("airfare Allocation report uses SAP From/To with To as key date", () => {
  const src = page();
  assert.match(src, /data-testid="allocation-report-banner"/);
  assert.match(src, /idPrefix="payable"/);
  assert.match(src, /STATEMENT_PRESETS/);
  assert.match(src, /params\.set\("date_from", allocationPeriodFrom\)/);
  assert.match(src, /params\.set\("date_to", allocationAsOf\)/);
  assert.match(src, /Matches Allocation Calculate entitlement/);
  assert.match(src, /Opening Days/);
  assert.match(src, /Closing Balance/);
  assert.doesNotMatch(src, /Opening balance as on/);
  assert.doesNotMatch(src, /lapsed\/adjusted/i);
  // Default period is YTD (From year-start → To today), not a single As-of field.
  assert.match(src, /rangeFromPreset\("ytd"\)/);
  assert.match(src, /payable-asof-\$\{id\}/);
  assert.match(src, /data-testid="payable-sub-sections"/);
  assert.match(src, /data-testid="payable-bahraini"/);
  assert.match(src, /params\.set\("sub_sections"/);
  assert.match(src, /params\.set\("bahraini", "only"\)/);
  assert.match(src, /params\.set\("bahraini", "exclude"\)/);
  assert.match(src, /Excluding Bahraini/);
  assert.match(src, /payable-key-date-note/);
  assert.match(src, /To is the key date/);
});
