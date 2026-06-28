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
  "function SelectField"
]) {
  assert.ok(source.includes(expected), `Expected dropdown option/source marker: ${expected}`);
}

assert.ok(!source.includes("function ComboInput"), "Work fields should use native select dropdowns, not datalist input");

console.log("Employee dropdown options test passed");
