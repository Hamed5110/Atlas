import assert from "node:assert/strict";
import fs from "node:fs";
import { readFileSync } from "node:fs";
import { readSheet } from "read-excel-file/node";

const samplePath = "C:/Users/Hamed Ali Khan/Downloads/pay_Employee Information_cb6f88ef-112b-4214-9a98-ba29a7bda2de.xlsx";
const appSource = readFileSync("app/page.tsx", "utf8");

function normalizeHeader(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function cellText(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value ?? "").trim();
}

function findCell(headers, row, names) {
  const wanted = names.map(normalizeHeader);
  let index = headers.findIndex((header) => wanted.some((name) => header === name));
  if (index < 0) {
    index = headers.findIndex((header) => wanted.some((name) => header.includes(name)));
  }
  return index >= 0 ? row[index] : "";
}

assert.ok(fs.existsSync(samplePath), `Missing test workbook: ${samplePath}`);

const rows = await readSheet(samplePath);
assert.ok(Array.isArray(rows), "readSheet must return row array");
assert.ok(Array.isArray(rows[0]), "first sheet row must be an array");

const headerIndex = rows.findIndex((row) => {
  const keys = row.map((cell) => normalizeHeader(cell));
  return keys.includes("codegeneral") && keys.some((key) => key.includes("namegeneral"));
});

assert.ok(headerIndex >= 0, "employee header row should be found");

const headers = rows[headerIndex].map((cell) => normalizeHeader(cell));
const employees = rows
  .slice(headerIndex + 1)
  .map((row) => ({
    code: cellText(findCell(headers, row, ["codegeneral", "employee code", "emp no"])),
    name: cellText(findCell(headers, row, ["namegeneralemployee", "full name", "employee name"])),
    department: cellText(findCell(headers, row, ["departmentgeneral", "department"])),
    designation: cellText(findCell(headers, row, ["designationgeneral", "designation"])),
    email: cellText(findCell(headers, row, ["emailcontactdetails", "email"]))
  }))
  .filter((employee) => employee.code && employee.name);

assert.ok(employees.length > 0, "employee list should be generated for preview");
assert.equal(employees[0].code, "0001");
assert.ok(employees[0].name.length > 0, "first employee should have a name");
assert.match(appSource, /remaining balance 2025/, "Excel airfare import should map remaining balance 2025");
assert.match(appSource, /current airfare 2025/, "Excel airfare import should map current airfare 2025");
assert.match(appSource, /total airfare 2025/, "Excel airfare import should map total airfare 2025");
assert.match(appSource, /employees\/import-preview/, "Employee import must create SQL validation preview batch before saving");
assert.match(appSource, /employees\/import-confirm/, "Employee import must confirm selected SQL preview rows only");
assert.match(appSource, /SQL batch #/, "Import preview should show the SQL batch number to users");
assert.match(appSource, /Warnings/, "Import preview should show warning counts");
assert.match(appSource, /Errors/, "Import preview should show error counts");

console.log(`Employee import preview test passed: ${employees.length} employee(s) parsed`);
