import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  dayBefore,
  describeMonthRange,
  describeRange,
  effectiveRange,
  fiscalYearRange,
  inclusiveDays,
  inclusiveMonths,
  lastDayOfMonth,
  localIsoDate,
  monthSpan,
  parseRange,
  applyPreset,
  rangeFromPreset,
  resolvePreset,
  serializeRange,
  withFrom,
  withTo,
} from "../lib/report-period.ts";

const TODAY = new Date(2026, 9, 21); // Wed 21 Oct 2026, local time

test("presets resolve to ERP periods (inclusive start and end)", () => {
  assert.deepEqual(resolvePreset("today", TODAY), { from: "2026-10-21", to: "2026-10-21" });
  assert.deepEqual(resolvePreset("yesterday", TODAY), { from: "2026-10-20", to: "2026-10-20" });
  assert.deepEqual(resolvePreset("this_week", TODAY), { from: "2026-10-19", to: "2026-10-21" });
  assert.deepEqual(resolvePreset("last_week", TODAY), { from: "2026-10-12", to: "2026-10-18" });
  assert.deepEqual(resolvePreset("this_month", TODAY), { from: "2026-10-01", to: "2026-10-21" });
  assert.deepEqual(resolvePreset("last_month", TODAY), { from: "2026-09-01", to: "2026-09-30" });
  assert.deepEqual(resolvePreset("this_quarter", TODAY), { from: "2026-10-01", to: "2026-10-21" });
  assert.deepEqual(resolvePreset("last_quarter", TODAY), { from: "2026-07-01", to: "2026-09-30" });
  assert.deepEqual(resolvePreset("this_year", TODAY), { from: "2026-01-01", to: "2026-12-31" });
  assert.deepEqual(resolvePreset("ytd", TODAY), { from: "2026-01-01", to: "2026-10-21" });
  assert.deepEqual(resolvePreset("last_year", TODAY), { from: "2025-01-01", to: "2025-12-31" });
  assert.deepEqual(resolvePreset("all", TODAY), { from: "", to: "" });
  assert.deepEqual(resolvePreset("last_quarter", new Date(2026, 1, 10)), { from: "2025-10-01", to: "2025-12-31" });
  // Sunday belongs to the week that started on Monday (API resolve_report_period convention).
  assert.deepEqual(resolvePreset("this_week", new Date(2026, 9, 25)), { from: "2026-10-19", to: "2026-10-25" });
});

test("fiscal years cover the whole year, also when the year starts mid-calendar", () => {
  assert.deepEqual(fiscalYearRange(2025), { from: "2025-01-01", to: "2025-12-31" });
  assert.deepEqual(fiscalYearRange(2025, 4), { from: "2025-04-01", to: "2026-03-31" });
  assert.deepEqual(rangeFromPreset("fiscal_year", TODAY, 2024), {
    preset: "fiscal_year",
    from: "2024-01-01",
    to: "2024-12-31",
    fiscalYear: 2024,
  });
});

test("editing From never resets To, and a reversed range is swapped instead of rejected", () => {
  const start = rangeFromPreset("this_month", TODAY);
  const moved = withFrom(start, "2026-11-15");
  assert.equal(moved.to, "2026-10-21");
  assert.equal(moved.preset, "custom");
  assert.deepEqual(effectiveRange(moved), { from: "2026-10-21", to: "2026-11-15", swapped: true });
  assert.equal(withTo(start, "2026-10-31").from, "2026-10-01");
  assert.deepEqual(effectiveRange(start), { from: "2026-10-01", to: "2026-10-21", swapped: false });
});

test("day counts are inclusive and the summary reads naturally", () => {
  assert.equal(inclusiveDays("2026-01-01", "2026-01-31"), 31);
  assert.equal(inclusiveDays("2026-10-21", "2026-10-21"), 1);
  assert.equal(inclusiveDays("2026-03-28", "2026-03-30"), 3);
  assert.equal(inclusiveDays("", "2026-03-30"), null);
  const fmt = (iso) => iso.split("-").reverse().join("/");
  assert.equal(describeRange({ from: "2026-01-01", to: "2026-10-21" }, fmt), "Selected: 01/01/2026 to 21/10/2026 (294 days)");
  assert.equal(describeRange({ from: "2026-10-21", to: "2026-10-21" }, fmt), "Selected: 21/10/2026 to 21/10/2026 (1 day)");
  assert.equal(describeRange({ from: "", to: "" }, fmt), "Selected: all dates");
});

test("remembered ranges: relative presets re-resolve, custom keeps its dates, junk is ignored", () => {
  assert.equal(serializeRange(rangeFromPreset("this_month", TODAY)), "this_month");
  assert.equal(serializeRange(rangeFromPreset("fiscal_year", TODAY, 2025)), "fiscal_year:2025");
  const kept = applyPreset({ preset: "this_month", from: "2026-11-01", to: "2026-11-19" }, "custom", TODAY);
  assert.deepEqual(kept, { preset: "custom", from: "2026-11-01", to: "2026-11-19" });
  assert.equal(serializeRange({ preset: "custom", from: "2026-02-01", to: "" }), "custom:2026-02-01:");
  assert.deepEqual(parseRange("this_month", new Date(2026, 11, 5)), { preset: "this_month", from: "2026-12-01", to: "2026-12-05" });
  assert.deepEqual(parseRange("custom:2026-02-01:2026-03-31", TODAY), { preset: "custom", from: "2026-02-01", to: "2026-03-31" });
  assert.equal(parseRange("fiscal_year:2024", TODAY)?.to, "2024-12-31");
  assert.equal(parseRange("drop table", TODAY), null);
  assert.equal(parseRange(undefined, TODAY), null);
});

test("local dates never shift to UTC (just after midnight in UTC+3)", () => {
  assert.equal(localIsoDate(new Date(2026, 9, 21, 0, 30)), "2026-10-21");
  assert.equal(dayBefore("2026-01-01"), "2025-12-31");
  assert.equal(dayBefore("2026-03-01"), "2026-02-28");
});

test("every dated report uses the shared period picker and remembers it in MSSQL", () => {
  const page = readFileSync(new URL("../app/(app)/reports/page.tsx", import.meta.url), "utf8");
  for (const prefix of ["payable", "att", "std", "comm", "bi"]) {
    assert.match(page, new RegExp(`<DateRangeFilter[^>]*idPrefix="${prefix}"`), prefix);
  }
  assert.match(page, /RANGE_PREFERENCE_PREFIX/);
  assert.match(page, /data-testid="report-empty"/);
  assert.match(page, /data-testid="std-expiry-summary"/);
  assert.match(page, /data-testid="std-as-of-summary"/);
  // Allocation as-of controls remain; legacy payable-year / period-error must stay gone.
  assert.doesNotMatch(page, /payable-year|payable-period-error/);
  assert.doesNotMatch(page, /toISOString\(\)\.slice\(0, 10\)/);
  assert.doesNotMatch(page, /items-end gap-4 py-4/, "filter rows align to the top so hints cannot misalign fields");
  const filter = readFileSync(new URL("../components/reports/date-range-filter.tsx", import.meta.url), "utf8");
  for (const id of ["-period", "-${unit}-from", "-${unit}-to", "-range-summary", "-range-swapped", "-fiscal-year"]) {
    assert.match(filter, new RegExp(`\\$\\{idPrefix\\}${id.replace(/[${}]/g, "\\$&")}`), id);
  }
  assert.match(filter, /const unit = monthly \? "month" : "date"/);
});

test("month periods cover whole months, both ends included", () => {
  assert.equal(lastDayOfMonth("2026-02"), "2026-02-28");
  assert.equal(lastDayOfMonth("2024-02"), "2024-02-29");
  assert.equal(lastDayOfMonth("2026-12"), "2026-12-31");
  assert.deepEqual(monthSpan({ from: "2026-01-01", to: "2026-03-31" }), { from: "2026-01", to: "2026-03" });
  assert.equal(inclusiveMonths("2026-01", "2026-03"), 3);
  assert.equal(inclusiveMonths("2025-11", "2026-02"), 4);
  assert.equal(inclusiveMonths("", "2026-02"), null);
  const fmt = (m) => m.replace("-", "/");
  assert.equal(describeMonthRange({ from: "2026-01-01", to: "2026-03-31" }, fmt), "Selected: 2026/01 to 2026/03 (3 months)");
  assert.equal(describeMonthRange({ from: "2026-10-01", to: "2026-10-21" }, fmt), "Selected: 2026/10 (1 month)");
  assert.equal(describeMonthRange({ from: "", to: "" }, fmt), "Selected: all months");
  // Typing a From month after To still swaps whole months.
  const reversed = effectiveRange(withFrom({ preset: "this_year", from: "2026-01-01", to: "2026-03-31" }, "2026-06-01"));
  assert.deepEqual(monthSpan(reversed), { from: "2026-03", to: "2026-06" });
  assert.equal(reversed.swapped, true);
});
