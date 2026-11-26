/**
 * Focus-style report views: Standard, Grouped (sub-totals) and Summary layouts.
 * Same rules as the API (application/report_views.py) so the screen, PDF and
 * Excel show identical groups and totals; keep the two regexes in sync.
 */

export type ViewLayout = "standard" | "grouped" | "summary" | "share" | "ranked" | "calendar";

export interface ReportView {
  layout: ViewLayout;
  group: number;
  hideZero: boolean;
}

export type ViewRowKind = "data" | "group" | "subtotal" | "total";

export interface ViewRow {
  kind: ViewRowKind;
  key: string;
  cells: unknown[];
  group?: string;
  count?: number;
}

export const DEFAULT_VIEW: ReportView = { layout: "standard", group: 0, hideZero: false };

export const VIEW_LAYOUTS: { id: ViewLayout; label: string; hint: string }[] = [
  { id: "standard", label: "Standard", hint: "Every row with a grand total" },
  { id: "grouped", label: "Grouped", hint: "Rows under group headings with sub-totals" },
  { id: "summary", label: "Summary", hint: "One line per group with counts and totals" },
  { id: "share", label: "Share", hint: "Each group's amount as a percent of the total" },
  { id: "ranked", label: "Ranked", hint: "Highest amount first, with its share of the total" },
  { id: "calendar", label: "Calendar", hint: "Employees by day for a week or month, one coloured mark per day" },
];

const SUM_RE =
  /amount|amt|total|balance|paid|\bpays\b|payable|payout|outstanding|arrears|cost|fare|spend|value|salary|earned|deduct|recover|opening|closing|debit|credit|liabilit|commission|net|gross|trips|tickets|count|headcount|installment|days|hours|minutes|qty|quantity|entries|employees|principal|excess|entitlement|allowance|fine|bonus|advance|payment|charge|fee|tax|vat|expense|budget|variance|accrued|utilised|utilized|lapsed|adjusted|off\b|holiday|\bleave\b/i;
const NO_SUM_RE =
  /rate|year|\bage\b|%|pct|percent|share|score|avg|average|median|mean|ratio|since|tenure|slope|trend|number|\bno\b|\bid\b|code|month/i;

const IDENTIFIER_RE = /\bcode\b|\bid\b|\bno\.?$|number|\bcpr\b|passport|phone|mobile|iban/i;
const IDENTITY_RE = /\b(employee\s*)?(code|name|full.?name)\b|^name$/i;

/** Codes and document numbers look numeric but read as text: left-aligned, never summed. */
export function isIdentifierColumn(name: string): boolean {
  return IDENTIFIER_RE.test(name);
}

/** Leading identity columns to pin while scrolling wide financial grids. */
export function stickyIdentityCount(columns: string[]): number {
  let n = 0;
  for (let i = 0; i < Math.min(2, columns.length); i++) {
    if (!IDENTITY_RE.test(columns[i] ?? "")) break;
    n += 1;
  }
  return n;
}

/** Closing / entitlement / balance — slight emphasis so the eye finds the answer column. */
export function isEmphasisColumn(name: string): boolean {
  return /^(closing balance|entitlement|balance days|payable amount)$/i.test(name.trim());
}

const DATE_COLUMN_RE =
  /date|^day$|time|month|joined|expiry|created|issued|returned on|cancelled on|cancel on|period (from|to)/i;

/** Dates and times read on one line ("21-10-2026"), never stacked digit groups. */
export function isDateColumn(name: string): boolean {
  return DATE_COLUMN_RE.test(name);
}

/** "TimeIn" → "Time In": source column names shown as readable headings. */
export function columnLabel(name: string): string {
  return name.replace(/([a-z])([A-Z])/g, "$1 $2");
}

export const VIEW_PREFERENCE_PREFIX = "report.view.";
const VIEW_VALUE = /^(standard|grouped|summary|share|ranked|calendar):(\d{1,2}):([01])$/;

export function parseView(raw: unknown): ReportView | null {
  if (typeof raw !== "string") return null;
  const m = VIEW_VALUE.exec(raw);
  if (!m) return null;
  return { layout: m[1] as ViewLayout, group: Number(m[2]), hideZero: m[3] === "1" };
}

export function serializeView(view: ReportView): string {
  return `${view.layout}:${view.group}:${view.hideZero ? 1 : 0}`;
}

/** Query string for exports so PDF / Excel follow the on-screen layout. */
export function viewQuery(view: ReportView): string {
  const params = new URLSearchParams({ view_layout: view.layout });
  if (view.layout === "grouped" || view.layout === "summary" || view.layout === "share") {
    params.set("view_group", String(view.group));
  }
  if (view.hideZero) params.set("hide_zero", "true");
  return params.toString();
}

export function summableColumns(columns: string[], numeric: Set<number>): number[] {
  return columns.flatMap((name, i) => (numeric.has(i) && SUM_RE.test(name) && !NO_SUM_RE.test(name) ? [i] : []));
}

/** Text columns worth grouping by: repeated values, not one value per row. */
export function groupableColumns(columns: string[], rows: unknown[][], numeric: Set<number>): number[] {
  return columns.flatMap((_, i) => {
    if (numeric.has(i)) return [];
    const distinct = new Set(rows.map((r) => label(r[i])));
    return distinct.size >= 1 && (distinct.size < rows.length || rows.length <= 1) && distinct.size <= 500 ? [i] : [];
  });
}

function label(value: unknown): string {
  const text = value == null ? "" : String(value).trim();
  return text || "(blank)";
}

function toNumber(value: unknown): number {
  const n = typeof value === "number" ? value : Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** One decimal percent of the total; blank when the total is zero.

Half-up, same as the API's Decimal ROUND_HALF_UP. A tiny nudge corrects binary
values that land just under a .5 boundary (Math.round would send those down).
*/
export function shareOf(part: number, whole: number): number | "" {
  if (!whole) return "";
  const scaled = Math.abs(part / whole) * 1000;
  const tenths = Math.floor(scaled + 0.5 + 1e-8);
  return (part / whole < 0 ? -tenths : tenths) / 10;
}

function sumRow(rows: unknown[][], width: number, sums: number[], first: string): unknown[] {
  const out: unknown[] = Array.from({ length: width }, () => null);
  for (const i of sums) out[i] = rows.reduce((acc, r) => acc + toNumber(r[i]), 0);
  out[0] = first;
  return out;
}

export function buildView(
  columns: string[],
  rows: unknown[][],
  view: ReportView,
  sums: number[],
  withTotal = true
): { columns: string[]; rows: ViewRow[]; numeric: Set<number> | null } {
  let data = rows;
  if (view.hideZero && sums.length) {
    data = data.filter((r) => sums.some((i) => toNumber(r[i]) !== 0));
  }
  const width = columns.length;
  if (view.layout === "ranked" && sums.length) {
    const measure = sums[0];
    const whole = data.reduce((acc, r) => acc + toNumber(r[measure]), 0);
    const ordered = data
      .map((cells, index) => ({ cells, index }))
      .sort((a, b) => toNumber(b.cells[measure]) - toNumber(a.cells[measure]) || a.index - b.index);
    const ranked: ViewRow[] = ordered.map(({ cells }, rank) => ({
      kind: "data",
      key: `rank${rank}`,
      cells: [rank + 1, ...cells, shareOf(toNumber(cells[measure]), whole)],
    }));
    const totalCells: unknown[] = Array.from({ length: width + 2 }, () => null);
    totalCells[0] = "Total";
    for (const i of sums) totalCells[i + 1] = data.reduce((acc, r) => acc + toNumber(r[i]), 0);
    totalCells[width + 1] = shareOf(whole, whole);
    const numeric = new Set<number>([0, width + 1]);
    columns.forEach((name, i) => {
      if (isIdentifierColumn(name)) return;
      const values = ranked.map((r) => r.cells[i + 1]).filter((v) => v != null && v !== "");
      if (values.length && values.every((v) => typeof v === "number")) numeric.add(i + 1);
    });
    return {
      columns: ["Rank", ...columns, "Share %"],
      rows: withTotal && data.length ? [...ranked, { kind: "total", key: "total", cells: totalCells }] : ranked,
      numeric,
    };
  }
  const total = (): ViewRow[] =>
    withTotal && sums.length && data.length
      ? [{ kind: "total", key: "total", cells: sumRow(data, width, sums, "Total") }]
      : [];
  const groupCol = view.group;
  if (view.layout === "standard" || groupCol < 0 || groupCol >= width) {
    return {
      columns,
      rows: [...data.map((cells, i) => ({ kind: "data" as const, key: `r${i}`, cells })), ...total()],
      numeric: null,
    };
  }

  const groups = new Map<string, unknown[][]>();
  for (const r of data) {
    const g = label(r[groupCol]);
    const bucket = groups.get(g);
    if (bucket) bucket.push(r);
    else groups.set(g, [r]);
  }
  const ordered = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }));

  if (view.layout === "summary") {
    const valueCols = sums.filter((i) => i !== groupCol);
    const out: ViewRow[] = ordered.map(([name, members]) => ({
      kind: "data",
      key: `s:${name}`,
      cells: [name, members.length, ...valueCols.map((i) => members.reduce((acc, r) => acc + toNumber(r[i]), 0))],
    }));
    if (withTotal && data.length) {
      out.push({
        kind: "total",
        key: "total",
        cells: ["Total", data.length, ...valueCols.map((i) => data.reduce((acc, r) => acc + toNumber(r[i]), 0))],
      });
    }
    const summaryNumeric = new Set<number>(valueCols.map((_, k) => k + 2));
    summaryNumeric.add(1);
    return { columns: [columns[groupCol], "Records", ...valueCols.map((i) => columns[i])], rows: out, numeric: summaryNumeric };
  }

  if (view.layout === "share") {
    const valueCols = sums.filter((i) => i !== groupCol);
    const wholes = valueCols.map((i) => data.reduce((acc, r) => acc + toNumber(r[i]), 0));
    const shareColumns = [columns[groupCol], "Records"];
    for (const i of valueCols) shareColumns.push(columns[i], `${columns[i]} %`);
    const out: ViewRow[] = ordered.map(([name, members]) => {
      const cells: unknown[] = [name, members.length];
      valueCols.forEach((i, k) => {
        const amount = members.reduce((acc, r) => acc + toNumber(r[i]), 0);
        cells.push(amount, shareOf(amount, wholes[k]));
      });
      return { kind: "data" as const, key: `sh:${name}`, cells };
    });
    if (withTotal && data.length) {
      const cells: unknown[] = ["Total", data.length];
      wholes.forEach((whole) => cells.push(whole, shareOf(whole, whole)));
      out.push({ kind: "total", key: "total", cells });
    }
    const numeric = new Set<number>();
    for (let i = 1; i < shareColumns.length; i += 1) numeric.add(i);
    return { columns: shareColumns, rows: out, numeric };
  }

  const out: ViewRow[] = [];
  for (const [name, members] of ordered) {
    out.push({ kind: "group", key: `g:${name}`, cells: [], group: name, count: members.length });
    members.forEach((cells, i) => out.push({ kind: "data", key: `g:${name}:${i}`, cells, group: name }));
    if (sums.length) {
      out.push({ kind: "subtotal", key: `t:${name}`, cells: sumRow(members, width, sums, `Sub-total – ${name}`), group: name });
    }
  }
  return { columns, rows: [...out, ...total()], numeric: null };
}
