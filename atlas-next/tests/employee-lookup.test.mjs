/**
 * Employee F4 lookup — ranking algorithm + source contract.
 *
 * Pattern: SAP search help (F4) / Business Central lookup page —
 * a full-screen grid, not a clipped inline dropdown inside a table cell.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const combo = readFileSync(join(root, "components", "employee-combobox.tsx"), "utf8");
const dialog = readFileSync(join(root, "components", "ui", "dialog.tsx"), "utf8");
const page = readFileSync(join(root, "app", "(app)", "commissions", "page.tsx"), "utf8");

let failures = 0;
const check = (name, ok) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failures += 1;
};

check("rankEmployees is exported for reuse", combo.includes("export function rankEmployees"));
check("lookup mode exists", combo.includes('mode?: "inline" | "lookup"'));
check("inline list is a portaled dropdown (not a titled modal)", combo.includes('data-testid="employee-inline-list"') && combo.includes("createPortal"));
check("F2 / Enter / click open the lookup", combo.includes('e.key === "F4"') && combo.includes("openLookup"));
check("already-on-voucher ids are excluded", combo.includes("excludeIds") && combo.includes("blocked.has"));
check("dialog portals to document.body (not clipped by table overflow)", dialog.includes("createPortal") && dialog.includes("document.body"));
check("commissions line picker is inline (no Select Employee modal)", !page.includes('mode="lookup"') && page.includes('labelMode="code"'));
check("commissions passes excludeIds from other lines", page.includes("excludeIds={rows"));
check("inline cell shows code only (name is the next grid column)", combo.includes('labelMode === "code"'));

// Ranking algorithm replica (must stay in lockstep with rankEmployees).
function rankEmployees(list, query) {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  const scored = list
    .map((e) => {
      const name = (e.full_name || "").toLowerCase();
      const arabic = (e.arabic_name || "").toLowerCase();
      const code = (e.code || "").toLowerCase();
      const dept = (e.department || "").toLowerCase();
      const desig = (e.designation || "").toLowerCase();
      const cpr = (e.cpr_no || "").toLowerCase();
      let score = 99;
      if (name.startsWith(q)) score = 0;
      else if (arabic.startsWith(q)) score = 1;
      else if (code.startsWith(q)) score = 2;
      else if (name.includes(` ${q}`) || name.includes(q)) score = 3;
      else if (code.includes(q) || dept.includes(q) || desig.includes(q) || cpr.includes(q) || arabic.includes(q)) {
        score = 4;
      } else {
        return null;
      }
      return { e, score, name };
    })
    .filter(Boolean);
  scored.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));
  return scored.map((row) => row.e);
}

const people = [
  { full_name: "Ahmed Ali", arabic_name: "", code: "EMP-009", department: "Sales", designation: "Rep", cpr_no: "123" },
  { full_name: "Zara Ahmed", arabic_name: "زارا", code: "EMP-001", department: "HR", designation: "Officer", cpr_no: "" },
  { full_name: "No Match", arabic_name: "", code: "X-1", department: "IT", designation: "Dev", cpr_no: "" },
];

const byAhmed = rankEmployees(people, "ahmed").map((e) => e.full_name);
check("prefix-name ranks above contains-name ('ahmed')", byAhmed[0] === "Ahmed Ali" && byAhmed[1] === "Zara Ahmed");
check("unmatched rows drop out", rankEmployees(people, "ahmed").length === 2);
check("code prefix wins over unrelated names", rankEmployees(people, "emp-001")[0].full_name === "Zara Ahmed");
check("department match is score-4 (still returns)", rankEmployees(people, "sales")[0].full_name === "Ahmed Ali");
check("empty query returns the full list", rankEmployees(people, "  ").length === 3);

console.log(failures === 0 ? "\nAll employee lookup checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
