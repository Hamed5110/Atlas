/**
 * Commissions ERP worksheet layout — source assertions.
 *
 * Pattern (local Focus Lyte help, Sales Invoice):
 *   1. List screen of vouchers
 *   2. New opens a voucher window (header + body grid + Net)
 *   3. Product cell opens a Containing list popup (F2) — not a full-page overlay
 * Two-pane split is forbidden.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const page = readFileSync(join(root, "app", "(app)", "commissions", "page.tsx"), "utf8");
const shell = readFileSync(join(root, "components", "layout", "app-shell.tsx"), "utf8");

let failures = 0;
const check = (name, ok) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failures += 1;
};

check(
  "app-shell removes max-width cap on /commissions (full viewport width)",
  /FULL_WIDTH_PATHS = \[[^\]]*"\/commissions"/.test(shell) &&
    /FULL_WIDTH_PATHS\.some[\s\S]*?"max-w-none/.test(shell)
);
check(
  "no two-pane split (no sticky side form / fixed-rem column tracks)",
  !page.includes("xl:sticky xl:top-4") && !/grid-cols-\[minmax\(\d+rem/.test(page)
);
check(
  "voucher header band is Focus-style 2–3 columns (not a 6-up strip)",
  page.includes("md:grid-cols-2 xl:grid-cols-3")
);
check(
  "New opens a voucher window (Focus list → New screen)",
  page.includes('data-testid="btn-new-voucher"') && page.includes("entryOpen")
);
check(
  "line grid fills remaining sheet height (body scrolls, footer pinned)",
  page.includes('className="table-fixed"') &&
    page.includes("table-sheet-scroll") &&
    page.includes("min-h-0") &&
    page.includes('data-testid="commission-voucher-footer"')
);
check(
  "New voucher pins actions on Dialog footer",
  page.includes("commission-voucher-footer") && page.includes("btn-save-voucher")
);
check(
  "entry card precedes register card (worksheet: header+repeater, then list)",
  page.indexOf('data-testid="commission-voucher-card"') < page.indexOf('t("comm.voucherList")')
);
check(
  "build stamp is pin-footer",
  page.includes('const BUILD_STAMP = "2026-09-21.pin-footer"')
);
check(
  "build stamp rendered with testid",
  page.includes('data-testid="commissions-build-stamp"') && page.includes("{BUILD_STAMP}")
);

console.log(failures === 0 ? "\nAll worksheet layout checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
