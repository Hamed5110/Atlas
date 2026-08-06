import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");
const source = readFileSync(join(process.cwd(), "app", "page.tsx"), "utf8");

assert.match(source, /FreshAtlasApp/, "active route must use the fresh rebuilt shell");
assert.match(source, /Fresh build · port 3356/, "fresh shell must identify the 3356 build line");
assert.match(source, /Command Center[\s\S]*Employees[\s\S]*Entitlement Seeds[\s\S]*Airfare Activity[\s\S]*Loans[\s\S]*Reconciliation[\s\S]*Preferences/, "fresh navigation must cover the core ATLAS concepts");
assert.match(source, /atlasVersion\(\)[\s\S]*atlasHealth\(\)/, "fresh shell must read runtime version and health from the backend");
assert.match(source, /atlasFetch<Employee\[]>[\s\S]*atlasFetch<OpeningBalanceSeed\[]>[\s\S]*atlasFetch<Allocation\[]>[\s\S]*atlasFetch<LoanSummary>[\s\S]*atlasFetch<AirfarePolicy\[]>/, "fresh shell must load live SQL-backed modules through typed API helpers");
assert.match(source, /calculateExcelTotal[\s\S]*closingBalanceDays/, "fresh shell must reuse existing ATLAS formulas instead of inventing UI math");
assert.match(source, /Migration debug \/ reconciliation[\s\S]*Not used for payroll/, "reconciliation must be clearly separated from payroll writes");
assert.doesNotMatch(source, /Year End|year-end|YearEnd|Update next year|prepareNextYearOpeningUpdate|5110/, "fresh shell must not expose old process labels, old carry-forward action, or old 5110 port");

assert.match(css, /:root\s*{[\s\S]*--sidebar:\s*304px/, "fresh CSS must use explicit layout tokens");
assert.match(css, /\.atlas-root\s*{[\s\S]*display:\s*grid[\s\S]*grid-template-columns:\s*var\(--sidebar\)\s*minmax\(0,\s*1fr\)/, "root layout must use a strict sidebar/content grid");
assert.match(css, /\.atlas-sidebar\s*{[\s\S]*grid-template-rows:\s*auto auto minmax\(0,\s*1fr\) auto[\s\S]*height:\s*calc\(100vh - 32px\)/, "sidebar must isolate header, context, scrollable nav, and footer zones");
assert.match(css, /\.module-list\s*{[\s\S]*overflow-y:\s*auto/, "navigation must scroll independently instead of clipping");
assert.match(css, /\.module-button\s*{[\s\S]*grid-template-columns:\s*24px minmax\(0,\s*1fr\) auto/, "nav rows must reserve a safe shortcut column");
assert.match(css, /\.topbar\s*{[\s\S]*grid-template-columns:\s*minmax\(220px,\s*1fr\)\s*minmax\(260px,\s*520px\)\s*auto/, "topbar must align title, search, and actions predictably");
assert.match(css, /\.table-card\s*{[\s\S]*overflow:\s*hidden/, "tables must be contained inside cards");
assert.match(css, /@media \(max-width:\s*1180px\)[\s\S]*\.atlas-root,[\s\S]*\.login-grid,[\s\S]*\.workspace-grid\s*{[\s\S]*grid-template-columns:\s*1fr/, "tablet layout must collapse to one column");
assert.match(css, /@media \(max-width:\s*760px\)[\s\S]*\.table-card\s*{[\s\S]*overflow-x:\s*auto/, "mobile tables must scroll horizontally only inside the table container");

console.log("fresh 3356 UI layout source checks passed");
