import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

test("dashboard invalidation helper busts insights + amount balance + badges", () => {
  const src = read("lib/dashboard-insights.ts");
  assert.match(src, /export function invalidateDashboardData/);
  assert.match(src, /DASHBOARD_INSIGHTS_KEY/);
  assert.match(src, /\["dashboard-amount-balance"\]/);
  assert.match(src, /\["nav-badges"\]/);
  assert.match(src, /refetchOnMount:\s*"always"/);
});

test("allocation and loans use invalidateDashboardData after mutations", () => {
  assert.match(read("app/(app)/allocation/page.tsx"), /invalidateDashboardData\(queryClient\)/);
  assert.match(read("app/(app)/loans/page.tsx"), /invalidateDashboardData\(queryClient\)/);
  assert.match(
    read("components/dashboard/pending-ticket-tracker.tsx"),
    /invalidateDashboardData\(queryClient\)/
  );
});

test("PageHeader / EmptyState / print A4 are mobile-safe", () => {
  const prim = read("components/ui/primitives.tsx");
  assert.match(prim, /w-full min-w-0 flex-col/);
  assert.match(prim, /break-words text-pretty/);
  const css = read("app/globals.css");
  assert.match(css, /width:\s*min\(100%,\s*210mm\)/);
  assert.match(css, /minmax\(min\(100%,\s*11rem\),\s*1fr\)/);
});

test("dashboard route refetches KPIs on mount", () => {
  const page = read("app/(app)/dashboard/page.tsx");
  assert.match(page, /staleTime:\s*0/);
  assert.match(page, /refetchOnMount:\s*"always"/);
  assert.match(page, /min-w-0 animate-/);
});
