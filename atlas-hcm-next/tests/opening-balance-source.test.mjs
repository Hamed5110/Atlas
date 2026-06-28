import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(process.cwd(), "app", "page.tsx"), "utf8");

assert.match(source, /Opening Balance/, "opening balance screen should be in navigation");
assert.match(source, /handleSaveOpeningBalance/, "manual opening balance save should exist");
assert.match(source, /handleImportOpeningBalances/, "opening balance Excel import should exist");
assert.match(source, /Opening days/, "opening balance screen should use opening days label");
assert.match(source, /Opening amount BHD/, "opening balance screen should use opening amount label");
assert.match(source, /openingDays: ""/, "opening balance form should start with empty days");
assert.match(source, /openingBhd: ""/, "opening balance form should start with empty amount");
assert.match(source, /Enter opening days and opening amount before saving/, "opening balance save should require manual days and amount");
assert.match(source, /\/opening-balances\/import-preview/, "opening balance import should create SQL validation preview batch");
assert.match(source, /\/opening-balances\/import-confirm/, "opening balance import should confirm selected SQL preview rows only");
assert.match(source, /Opening balance SQL preview ready/, "opening balance screen should show SQL preview confirmation");
assert.match(source, /toggleOpeningPreviewRow/, "opening balance preview should support row selection");
assert.match(source, /removeOpeningPreviewRow/, "opening balance preview should support removing rows");
assert.match(source, /Opening balance is the approved carry-forward balance/, "screen should explain the process");
assert.match(source, /Opening balance is controlled separately/, "employee master should point to separate opening balance process");
assert.match(source, /ATLAS_Opening_Balance_Register\.xlsx/, "opening balance register export should exist");
assert.match(source, /handleExportOpeningBalances/, "dedicated opening balance export handler should exist");
assert.doesNotMatch(source, /Field label="Closing balance days"/i, "old closing balance form label should not be shown");
assert.doesNotMatch(source, /Field label="Closing balance BHD"/i, "old closing amount form label should not be shown");

console.log("Opening balance source test passed");
