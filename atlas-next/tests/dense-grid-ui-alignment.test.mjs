import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

/** Wide identity grids that may pin the first column (never sticky Actions). */
const STICKY_FIRST_ALLOWED = [
  "app/(app)/opening-balances/page.tsx",
  "app/(app)/loans/page.tsx",
  "app/(app)/users/page.tsx",
  "app/(app)/lookups/page.tsx",
  "app/(app)/rates/page.tsx",
  "app/(app)/reports/page.tsx",
  "app/(app)/finance/page.tsx",
  "app/(app)/entitlement/reconcile/page.tsx",
  "app/(app)/entitlement/rules/page.tsx",
  "app/(app)/time-tracking/page.tsx",
  "components/document-studio.tsx",
  "components/company-profile-card.tsx",
];

test("employees dense grid: no stickyFirst and no sticky Actions (no overlap)", () => {
  const page = read("app/(app)/employees/page.tsx");
  assert.doesNotMatch(page, /stickyFirst/, "employees must not use stickyFirst");
  assert.doesNotMatch(page, /sticky end-0|sticky right-0/, "employees must not pin Actions");
  // Fit-to-viewport floor: slim enough that Actions stay visible on desktop
  // content widths (sidebar + 1400px container) without horizontal scroll.
  assert.match(page, /min-w-\[54rem\]/, "employees table keeps a modest min-width floor");
  assert.match(page, /table-employee-master/);
});

test("employees Actions are always-visible icon buttons (no text-label width)", () => {
  const page = read("app/(app)/employees/page.tsx");
  assert.match(page, /aria-label=\{`Edit \$\{e\.full_name\}`\}/);
  assert.match(page, /aria-label=\{`Delete \$\{e\.full_name\}`\}/);
  // Sub section merges into the Department cell to slim the grid.
  assert.doesNotMatch(page, /<TH>Sub section<\/TH>/);
  assert.doesNotMatch(page, /<TH>Nationality<\/TH>/);
});

test("table scroll container exposes a scroll-edge shadow affordance", () => {
  const css = read("app/globals.css");
  assert.match(css, /\.tt-table-scroll/);
  assert.match(css, /background-attachment:\s*local, local, scroll, scroll/);
});

test("no sticky Actions column anywhere in atlas-next app/components", () => {
  const roots = [join(root, "app"), join(root, "components")];
  const offenders = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, name.name);
      if (name.isDirectory()) walk(p);
      else if (/\.(tsx|ts)$/.test(name.name)) {
        const src = readFileSync(p, "utf8");
        if (/sticky end-0|sticky right-0/.test(src)) offenders.push(p);
      }
    }
  };
  for (const r of roots) walk(r);
  assert.equal(offenders.length, 0, `sticky Actions found in:\n${offenders.join("\n")}`);
});

test("stickyFirst only on allowlisted wide grids (not employees)", () => {
  for (const rel of STICKY_FIRST_ALLOWED) {
    assert.match(read(rel), /stickyFirst/, `${rel} should use stickyFirst`);
  }
  assert.doesNotMatch(read("app/(app)/employees/page.tsx"), /stickyFirst/);
  assert.doesNotMatch(read("components/import-panel.tsx"), /stickyFirst/);
  assert.doesNotMatch(read("app/(app)/entitlement/payroll-export/page.tsx"), /stickyFirst/);
});

test("globals.css documents sticky-first and forbids sticky-right Actions pattern", () => {
  const css = read("app/globals.css");
  assert.match(css, /\.table-sticky-first/);
  assert.match(css, /Do NOT add sticky last\/Actions/);
});

test("filter/action toolbars use items-end alignment on key screens", () => {
  const samples = {
    "app/(app)/loans/page.tsx": /items-end/,
    "app/(app)/opening-balances/page.tsx": /items-end/,
    "app/(app)/allocation/page.tsx": /items-end/,
    "app/(app)/reports/page.tsx": /items-end/,
    "app/(app)/finance/page.tsx": /items-end/,
    "app/(app)/entitlement/reconcile/page.tsx": /items-end/,
    "components/import-panel.tsx": /items-end/,
  };
  for (const [rel, re] of Object.entries(samples)) {
    assert.match(read(rel), re, `${rel} should align filter/actions with items-end`);
  }
});

test("shared table primitive still exposes stickyFirst + select-none TH", () => {
  const table = read("components/ui/table.tsx");
  assert.match(table, /stickyFirst/);
  assert.match(table, /select-none/);
  assert.match(table, /table-sticky-first/);
  assert.match(table, /wrap = true/);
});
