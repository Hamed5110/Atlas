/**
 * Frontend source contract: period-end / year-close must stay out of the product path.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return readFileSync(join(root, rel), "utf8");
}

test("modern entitlement front-end has no period-end product path", () => {
  const shell = read("components/layout/app-shell.tsx");
  const yearEnd = read("app/(app)/entitlement/year-end/page.tsx");
  const chips = read("app/(app)/ai-insights/page.tsx");

  assert.doesNotMatch(
    shell,
    /Period End|nav-entitlement-year-end|\/entitlement\/year-end/,
    "primary nav must not expose Period End"
  );
  assert.match(shell, /nav-rates/, "Rates must remain in primary nav");
  assert.match(shell, /nav-airfare-allocation/, "Allocation must remain in primary nav");
  assert.match(yearEnd, /router\.replace\("\/allocation\/"\)/, "legacy year-end URL must redirect to Allocation");
  assert.doesNotMatch(
    yearEnd,
    /btn-run-period-end|btn-run-year-end-close/,
    "year-end page must not run period-end buttons"
  );
  assert.match(yearEnd, /page-year-end-gone|Redirecting to Allocation/, "legacy URL should redirect only");
  assert.doesNotMatch(chips, /Explain year-end close|What is period end/i, "AI chips must not teach period-end");
  assert.match(chips, /modern entitlement/i, "AI chips should teach modern entitlement");
});
