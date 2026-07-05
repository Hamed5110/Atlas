import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

for (const expected of [
  "ATLAS ALUMINUM",
  "Production Department",
  "ATLAS-FACTORY",
  "Salmabad",
  "New Pay Group",
  "Permanent",
  "function SelectField",
  "handleQuickAddOption",
  "handleEditQuickAddOption",
  "handleDeleteQuickAddOption",
  "QUICK_ADD_OPTIONS_STORAGE_KEY",
  "select-manage-actions",
  "onAddOption",
  "onEditOption",
  "onDeleteOption",
  "Add ${label}",
  "System verification"
]) {
  assert.ok(source.includes(expected), `Expected dropdown option/source marker: ${expected}`);
}

assert.ok(!source.includes("function ComboInput"), "Work fields should use native select dropdowns, not datalist input");
assert.match(source, /SelectField placeholder="Job band"[\s\S]*onAddOption/, "Job band should support double-click quick add");
assert.match(source, /SelectField placeholder="Nationality"[\s\S]*onAddOption/, "Nationality should support double-click quick add");
assert.match(source, /SelectField placeholder="Company"[\s\S]*SelectField placeholder="Employee status"[\s\S]*onAddOption/, "Work dropdowns should support double-click quick add");
assert.match(source, /SelectField placeholder="Company"[\s\S]*onEditOption[\s\S]*onDeleteOption[\s\S]*SelectField placeholder="Employee status"[\s\S]*onEditOption[\s\S]*onDeleteOption/, "Work dropdowns should expose edit and delete actions");
assert.match(source, /window\.localStorage\.setItem\(QUICK_ADD_OPTIONS_STORAGE_KEY/, "Custom employee reference values should persist locally");
assert.match(source, /Type the employee code to confirm deletion/, "Employee delete should require explicit employee-code confirmation");
assert.match(source, /EMPLOYEE_DELETE_BLOCKED[\s\S]*force=true/, "Employee delete should offer full delete after linked-record confirmation");
assert.match(source, /Full delete will remove the employee and those linked operational records/, "Full employee delete confirmation should explain linked record removal");
assert.match(source, /Audit log entries and historical system logs remain protected/, "Full employee delete should explain audit protection");

console.log("Employee dropdown options test passed");
