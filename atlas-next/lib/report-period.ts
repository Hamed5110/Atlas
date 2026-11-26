/**
 * ERP date ranges for reports (Focus / SAP convention).
 *
 * - From and To are both inclusive: 1 Jan → 31 Jan is 31 days.
 * - Relative presets (This month, Year to date…) are re-resolved every time they are
 *   loaded, so a remembered "This month" always means the current month.
 * - Editing From never touches To (and vice versa); a reversed range is swapped when it
 *   is applied, never rejected.
 * - Balance reports read Opening at From − 1 day and Closing at To.
 */

/** YYYY-MM-DD in local time (toISOString would shift to UTC and can return yesterday). */
export function localIsoDate(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export const RANGE_PRESETS = [
  { id: "all", label: "All dates", hint: "No date limit — every record" },
  { id: "today", label: "Today", hint: "Only today" },
  { id: "yesterday", label: "Yesterday", hint: "Only yesterday" },
  { id: "this_week", label: "This week", hint: "Monday of this week to today" },
  { id: "last_week", label: "Last week", hint: "Monday to Sunday of last week" },
  { id: "this_month", label: "This month", hint: "1st of this month to today" },
  { id: "last_month", label: "Last month", hint: "The whole of last month" },
  { id: "this_quarter", label: "This quarter", hint: "Start of this quarter to today" },
  { id: "last_quarter", label: "Last quarter", hint: "The whole of last quarter" },
  { id: "this_year", label: "This year", hint: "1 January to 31 December this year" },
  { id: "ytd", label: "Year to date", hint: "1 January to today" },
  { id: "last_year", label: "Last year", hint: "The whole of last year" },
  { id: "fiscal_year", label: "Fiscal year", hint: "A whole fiscal year — for year-end and opening balances" },
  { id: "custom", label: "Custom range", hint: "Pick any From and To dates" },
] as const;

export type RangePresetId = (typeof RANGE_PRESETS)[number]["id"];

export type DateRange = { from: string; to: string };

export type RangeState = DateRange & { preset: RangePresetId; fiscalYear?: number };

/** Report dates run Monday-first, matching the API's resolve_report_period. */
function mondayOf(d: Date): Date {
  const offset = (d.getDay() + 6) % 7;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - offset);
}

/** Fiscal year named by the calendar year it starts in. */
export function fiscalYearRange(year: number, startMonth = 1): DateRange {
  const start = new Date(year, startMonth - 1, 1);
  const end = new Date(year + 1, startMonth - 1, 0);
  return { from: localIsoDate(start), to: localIsoDate(end) };
}

export function currentFiscalYear(today = new Date(), startMonth = 1): number {
  return today.getMonth() + 1 >= startMonth ? today.getFullYear() : today.getFullYear() - 1;
}

export function fiscalYearLabel(year: number, startMonth = 1): string {
  return startMonth === 1 ? `FY ${year}` : `FY ${year}-${String((year + 1) % 100).padStart(2, "0")}`;
}

export function resolvePreset(
  preset: RangePresetId,
  today = new Date(),
  fiscalYear?: number,
  fiscalStartMonth = 1,
): DateRange {
  const y = today.getFullYear();
  const m = today.getMonth();
  const t = new Date(y, m, today.getDate());
  const range = (from: Date, to: Date): DateRange => ({ from: localIsoDate(from), to: localIsoDate(to) });
  const quarterStart = m - (m % 3);
  switch (preset) {
    case "all":
      return { from: "", to: "" };
    case "today":
      return range(t, t);
    case "yesterday": {
      const d = new Date(y, m, today.getDate() - 1);
      return range(d, d);
    }
    case "this_week":
      return range(mondayOf(t), t);
    case "last_week": {
      const monday = mondayOf(t);
      return range(
        new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 7),
        new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 1),
      );
    }
    case "this_month":
      return range(new Date(y, m, 1), t);
    case "last_month":
      return range(new Date(y, m - 1, 1), new Date(y, m, 0));
    case "this_quarter":
      return range(new Date(y, quarterStart, 1), t);
    case "last_quarter":
      return range(new Date(y, quarterStart - 3, 1), new Date(y, quarterStart, 0));
    case "this_year":
      return range(new Date(y, 0, 1), new Date(y, 11, 31));
    case "last_year":
      return range(new Date(y - 1, 0, 1), new Date(y - 1, 11, 31));
    case "fiscal_year":
      return fiscalYearRange(fiscalYear ?? currentFiscalYear(today, fiscalStartMonth), fiscalStartMonth);
    case "ytd":
    case "custom":
    default:
      return range(new Date(y, 0, 1), t);
  }
}

/** Picking Custom keeps the dates already on screen. Every other preset is resolved from today. */
export function applyPreset(
  current: RangeState,
  preset: RangePresetId,
  today = new Date(),
  fiscalStartMonth = 1,
): RangeState {
  if (preset === "custom") return { ...current, preset: "custom" };
  return rangeFromPreset(preset, today, undefined, fiscalStartMonth);
}

export function rangeFromPreset(
  preset: RangePresetId,
  today = new Date(),
  fiscalYear?: number,
  fiscalStartMonth = 1,
): RangeState {
  const fy = preset === "fiscal_year" ? (fiscalYear ?? currentFiscalYear(today, fiscalStartMonth)) : undefined;
  return { preset, ...resolvePreset(preset, today, fy, fiscalStartMonth), ...(fy ? { fiscalYear: fy } : {}) };
}

/** Typing a From date never resets To — it only switches the preset to Custom. */
export function withFrom(state: RangeState, from: string): RangeState {
  return { preset: "custom", from, to: state.to };
}

export function withTo(state: RangeState, to: string): RangeState {
  return { preset: "custom", from: state.from, to };
}

/** The range the report actually runs on: reversed dates are swapped, not rejected. */
export function effectiveRange(state: DateRange): DateRange & { swapped: boolean } {
  if (state.from && state.to && state.from > state.to) {
    return { from: state.to, to: state.from, swapped: true };
  }
  return { from: state.from, to: state.to, swapped: false };
}

function utcDay(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

/** Inclusive day count (both ends count). Null when either end is open. */
export function inclusiveDays(from: string, to: string): number | null {
  if (!from || !to) return null;
  return Math.abs(utcDay(to) - utcDay(from)) + 1;
}

/** Day before ``iso`` — the Opening balance date of a statement starting on ``iso``. */
export function dayBefore(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return localIsoDate(new Date(y, m - 1, d - 1));
}

/** "Selected: 01 Jan 2026 to 21 Oct 2026 (294 days)". */
export function describeRange(range: DateRange, fmt: (iso: string) => string): string {
  if (!range.from && !range.to) return "Selected: all dates";
  if (!range.from) return `Selected: up to ${fmt(range.to)}`;
  if (!range.to) return `Selected: from ${fmt(range.from)} onwards`;
  const days = inclusiveDays(range.from, range.to) ?? 0;
  return `Selected: ${fmt(range.from)} to ${fmt(range.to)} (${days} ${days === 1 ? "day" : "days"})`;
}

/** Last calendar day of a YYYY-MM month, as YYYY-MM-DD. */
export function lastDayOfMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return localIsoDate(new Date(y, m, 0));
}

/** Month-period reports (commissions) read whole months: YYYY-MM keys, both inclusive. */
export function monthSpan(range: DateRange): { from: string; to: string } {
  return { from: range.from.slice(0, 7), to: range.to.slice(0, 7) };
}

export function inclusiveMonths(fromMonth: string, toMonth: string): number | null {
  if (!fromMonth || !toMonth) return null;
  const [fy, fm] = fromMonth.split("-").map(Number);
  const [ty, tm] = toMonth.split("-").map(Number);
  return Math.abs((ty - fy) * 12 + (tm - fm)) + 1;
}

/** "Selected: Jan 2026 to Mar 2026 (3 months)". */
export function describeMonthRange(range: DateRange, fmtMonth: (month: string) => string): string {
  const { from, to } = monthSpan(range);
  if (!from && !to) return "Selected: all months";
  if (!from) return `Selected: up to ${fmtMonth(to)}`;
  if (!to) return `Selected: from ${fmtMonth(from)} onwards`;
  const months = inclusiveMonths(from, to) ?? 0;
  if (months === 1) return `Selected: ${fmtMonth(from)} (1 month)`;
  return `Selected: ${fmtMonth(from)} to ${fmtMonth(to)} (${months} months)`;
}

export const RANGE_PREFERENCE_PREFIX = "report.range.";

const RANGE_VALUE_RE =
  /^(?:(all|today|yesterday|this_week|last_week|this_month|last_month|this_quarter|last_quarter|this_year|ytd|last_year)|fiscal_year:(\d{4})|custom:(\d{4}-\d{2}-\d{2})?:(\d{4}-\d{2}-\d{2})?)$/;

/** Stored per report in MSSQL: relative presets by name, custom ranges by their dates. */
export function serializeRange(state: RangeState): string {
  if (state.preset === "fiscal_year") return `fiscal_year:${state.fiscalYear ?? ""}`;
  if (state.preset === "custom") return `custom:${state.from}:${state.to}`;
  return state.preset;
}

export function parseRange(value: unknown, today = new Date(), fiscalStartMonth = 1): RangeState | null {
  if (typeof value !== "string") return null;
  const match = RANGE_VALUE_RE.exec(value);
  if (!match) return null;
  const [, preset, fy, from, to] = match;
  if (preset) return rangeFromPreset(preset as RangePresetId, today, undefined, fiscalStartMonth);
  if (fy) return rangeFromPreset("fiscal_year", today, Number(fy), fiscalStartMonth);
  return { preset: "custom", from: from ?? "", to: to ?? "" };
}
