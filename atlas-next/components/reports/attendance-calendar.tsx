"use client";

import { ArrowLeft } from "lucide-react";
import { useMemo, useState, type CSSProperties } from "react";
import { cn } from "@/lib/utils";

/**
 * Calendar layout for weekly / monthly time reports. Employee rows x day columns with one
 * coloured mark per day (Zoho present/absent view, greytHR muster, Horilla work records,
 * Odoo attendance matrix); a week shows IN-OUT in each cell (Deputy / BambooHR weekly grid);
 * one employee opens as a month calendar (Zoho calendar view). Exceptions are solid, normal
 * days are tinted, rest days are quiet, and late / early / overtime cells deepen with the
 * minutes like a heatmap, so problems stand out at a glance.
 */

export interface CalendarCell {
  s: string;
  k: string;
  i?: string;
  o?: string;
  v?: string;
  ot?: string;
  sh?: string;
  f?: number;
}

export interface CalendarDay {
  d: string;
  dow: string;
  n: number;
  today?: boolean;
  future?: boolean;
  off?: boolean;
}

export interface CalendarRow {
  name: string;
  code: string;
  dept: string;
  cells: Record<string, CalendarCell>;
  t: (string | number)[];
}

export interface AttendanceCalendarData {
  from: string;
  to: string;
  metric: "status" | "late" | "early" | "absent" | "missing" | "ot";
  days: CalendarDay[];
  totals: string[];
  rows: CalendarRow[];
}

type Weight = "solid" | "tint" | "quiet";

interface StatusMeta {
  label: string;
  mark: string;
  token: string;
  weight: Weight;
}

const STATUS: Record<string, StatusMeta> = {
  present: { label: "Present", mark: "P", token: "--att-present", weight: "tint" },
  late: { label: "Late", mark: "L", token: "--att-late", weight: "tint" },
  half_day: { label: "Half day", mark: "HD", token: "--att-half-day", weight: "tint" },
  missing_punch: { label: "Missing punch", mark: "MP", token: "--att-missing", weight: "solid" },
  absent: { label: "Absent", mark: "A", token: "--att-absent", weight: "solid" },
  on_duty: { label: "On duty now", mark: "OD", token: "--att-on-duty", weight: "tint" },
  not_started: { label: "Shift not started", mark: "·", token: "--att-none", weight: "quiet" },
  leave: { label: "Leave", mark: "LV", token: "--att-leave", weight: "tint" },
  holiday: { label: "Holiday", mark: "H", token: "--att-holiday", weight: "tint" },
  weekly_off: { label: "Weekly off", mark: "WO", token: "--att-off", weight: "quiet" },
  no_shift: { label: "No shift", mark: "–", token: "--att-none", weight: "quiet" },
};

const METRIC_TOKEN: Record<AttendanceCalendarData["metric"], string> = {
  status: "--att-absent",
  late: "--att-late",
  early: "--att-half-day",
  absent: "--att-absent",
  missing: "--att-missing",
  ot: "--att-overtime",
};

/** Minutes at which a heat cell reaches full strength. */
const HEAT_CAP: Partial<Record<AttendanceCalendarData["metric"], number>> = { late: 60, early: 60, ot: 240 };

const METRIC_HINT: Record<string, string> = {
  status: "Each cell is that day's status; solid cells need action. A small time is lateness.",
  late: "Cells show how late the person arrived — the darker, the later.",
  early: "Cells show how early the person left — the darker, the earlier.",
  absent: "Solid cells are absent working days.",
  missing: "Cells show which punch is missing (IN or OUT).",
  ot: "Cells show overtime — the darker, the longer.",
};

const PER_DAY_LABEL: Record<string, string> = {
  status: "Absent per day",
  late: "Late per day",
  early: "Early per day",
  absent: "Absent per day",
  missing: "Missing per day",
  ot: "OT per day",
};

const WHITE = "var(--neutral-0)";

const meta = (kind: string): StatusMeta =>
  STATUS[kind] ?? { label: kind.replace(/_/g, " "), mark: "?", token: "--att-none", weight: "quiet" };

const mix = (token: string, pct: number, base = "transparent") =>
  `color-mix(in srgb, var(${token}) ${pct}%, ${base})`;

/** "01:05" -> 65; anything else -> 0. */
function minutesOf(value: string | undefined): number {
  const m = value ? /^(\d{1,3}):(\d{2})$/.exec(value) : null;
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

/** Colours for one cell: solid exceptions, tinted normal days, quiet rest days, heat for minutes. */
function cellStyle(cell: CalendarCell, metric: AttendanceCalendarData["metric"]): CSSProperties {
  const flagged = metric !== "status" && Boolean(cell.f);
  const token = flagged ? METRIC_TOKEN[metric] : meta(cell.k).token;
  const cap = HEAT_CAP[metric];
  if (flagged && cap) {
    const strength = Math.min(1, minutesOf(cell.v) / cap);
    const pct = Math.round(22 + 78 * strength);
    return {
      background: mix(token, pct),
      color: pct >= 60 ? WHITE : `var(${token})`,
      borderColor: mix(token, Math.min(100, pct + 25)),
    };
  }
  const weight: Weight = flagged ? "solid" : metric !== "status" ? "quiet" : meta(cell.k).weight;
  if (weight === "solid") {
    return { background: `var(${token})`, color: WHITE, borderColor: `var(${token})` };
  }
  if (weight === "quiet") {
    return {
      background: mix(token, 8),
      color: `var(${token})`,
      borderColor: mix(token, 22),
      borderStyle: cell.k === "no_shift" || cell.k === "not_started" ? "dashed" : "solid",
    };
  }
  return { background: mix(token, 20), color: `var(${token})`, borderColor: mix(token, 45) };
}

function legendStyle(kind: string): CSSProperties {
  return cellStyle({ s: "", k: kind }, "status");
}

/** "00:17" -> "17m", "01:05" -> "1h05", "No IN" -> "IN". */
function shortValue(value: string | undefined): string {
  if (!value) return "";
  if (value.startsWith("No ")) return value.slice(3);
  const m = /^(\d{2}):(\d{2})$/.exec(value);
  if (!m) return value;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h > 0 ? `${h}h${min ? String(min).padStart(2, "0") : ""}` : `${min}m`;
}

function cellMark(cell: CalendarCell, metric: string): string {
  if (metric === "status" || !cell.f) return cell.s || meta(cell.k).mark;
  return shortValue(cell.v) || cell.s;
}

function valueLabel(value: string, metric: string): string {
  if (value.startsWith("No ")) return value;
  return `${metric === "ot" ? "OT" : metric === "early" ? "Early" : "Late"} ${value}`;
}

function cellTitle(day: CalendarDay, cell: CalendarCell | undefined, name: string): string {
  const head = `${name} · ${day.dow} ${day.n}`;
  if (!cell) return day.future ? `${head} · upcoming` : head;
  const parts = [head, meta(cell.k).label];
  if (cell.sh) parts.push(`Shift ${cell.sh}`);
  if (cell.i || cell.o) parts.push(`${cell.i ?? "--:--"} – ${cell.o ?? "--:--"}`);
  if (cell.v) parts.push(cell.v.startsWith("No ") ? cell.v : `Value ${cell.v}`);
  if (cell.ot) parts.push(`OT ${cell.ot}`);
  return parts.join(" · ");
}

function dayHeaderStyle(day: CalendarDay): CSSProperties | undefined {
  if (day.today) return { background: mix("--color-primary", 14, "var(--color-card)") };
  if (day.off) return { background: mix("--att-off", 12, "var(--color-card)") };
  return undefined;
}

/** Attendance % is green / amber / red against common HR targets (95 / 85). */
function totalStyle(label: string, value: string | number, metric: string): CSSProperties | undefined {
  if (value === "" || value === 0) return undefined;
  if (label.includes("%") && typeof value === "number") {
    const token = value >= 95 ? "--att-present" : value >= 85 ? "--att-late" : "--att-absent";
    return { background: mix(token, 16), color: `var(${token})` };
  }
  const token =
    label === "Late" ? "--att-late"
    : label === "Absent" ? "--att-absent"
    : label === "Missing" ? "--att-missing"
    : label === "Attended" ? "--att-present"
    : label === "Off" ? "--att-off"
    : metric !== "status" ? METRIC_TOKEN[metric as AttendanceCalendarData["metric"]]
    : undefined;
  return token ? { color: `var(${token})` } : undefined;
}

function formatTotal(label: string, value: string | number): string {
  if (value === "") return "–";
  return typeof value === "number" && label.includes("%") ? `${value}%` : String(value);
}

/** Employees whose name, code or department contains the search text. */
export function visibleCalendarRows(rows: CalendarRow[], query: string): CalendarRow[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((r) => `${r.name} ${r.code} ${r.dept}`.toLowerCase().includes(needle));
}

export function AttendanceCalendar({
  data,
  query,
  printing,
}: {
  data: AttendanceCalendarData;
  query: string;
  printing: boolean;
}) {
  const [focusCode, setFocusCode] = useState<string | null>(null);
  const rows = useMemo(() => visibleCalendarRows(data.rows, query), [data.rows, query]);
  const focused = focusCode ? data.rows.find((r) => r.code === focusCode) ?? null : null;
  const single = focused ?? (rows.length === 1 && data.days.length > 7 ? rows[0] : null);
  const week = data.days.length <= 10;

  const distribution = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) for (const c of Object.values(r.cells)) counts.set(c.k, (counts.get(c.k) ?? 0) + 1);
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    return {
      total,
      parts: Object.keys(STATUS)
        .filter((k) => counts.has(k))
        .map((k) => ({ k, n: counts.get(k) ?? 0 })),
    };
  }, [rows]);

  const perDay = useMemo(
    () =>
      data.days.map((day) =>
        rows.reduce((n, r) => {
          const c = r.cells[day.d];
          if (!c) return n;
          if (data.metric === "status") return n + (c.k === "absent" ? 1 : 0);
          return n + (c.f ? 1 : 0);
        }, 0)
      ),
    [data.days, data.metric, rows]
  );
  const perDayMax = Math.max(1, ...perDay);
  const perDayToken = METRIC_TOKEN[data.metric];

  return (
    <div className="px-4 pb-4" data-testid="attendance-calendar">
      {distribution.total > 0 ? (
        <div className="space-y-2 py-2" data-testid="calendar-legend">
          <div
            className="flex h-2.5 w-full overflow-hidden rounded-full bg-[var(--color-muted)]"
            role="img"
            aria-label={distribution.parts.map((p) => `${meta(p.k).label} ${p.n}`).join(", ")}
          >
            {distribution.parts.map((p) => (
              <span
                key={p.k}
                style={{ width: `${(p.n / distribution.total) * 100}%`, background: `var(${meta(p.k).token})` }}
                title={`${meta(p.k).label}: ${p.n} (${Math.round((p.n / distribution.total) * 100)}%)`}
              />
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            {distribution.parts.map((p) => (
              <span
                key={p.k}
                className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-medium"
                style={legendStyle(p.k)}
                data-testid={`calendar-legend-${p.k}`}
              >
                <b>{meta(p.k).mark}</b>
                {meta(p.k).label}
                <span className="tabular-nums opacity-80">{p.n.toLocaleString()}</span>
              </span>
            ))}
          </div>
          <p className="text-xs text-[var(--color-muted-foreground)]">
            {METRIC_HINT[data.metric]}
            {!single && !printing ? " Click a name to open that person's month." : ""}
          </p>
        </div>
      ) : null}

      {single ? (
        <EmployeeMonth
          row={single}
          data={data}
          onBack={focused ? () => setFocusCode(null) : undefined}
        />
      ) : rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-[var(--color-muted-foreground)]">No employees match.</p>
      ) : (
        <div
          className={cn(
            "rounded-[var(--radius-md)] border border-[var(--color-border)]",
            !printing && "max-h-[70vh] overflow-auto"
          )}
        >
          <table className="w-max min-w-full border-separate border-spacing-0 text-xs">
            <thead className="sticky top-0 z-20">
              <tr>
                <th className="sticky left-0 z-30 min-w-[220px] border-b border-r border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
                  Employee · {rows.length}
                </th>
                {data.days.map((day) => (
                  <th
                    key={day.d}
                    style={dayHeaderStyle(day)}
                    className={cn(
                      "border-b border-[var(--color-border)] bg-[var(--color-card)] px-1 py-1.5 text-center font-semibold",
                      week ? "min-w-[112px]" : "min-w-[38px]",
                      day.future && "text-[var(--color-muted-foreground)]"
                    )}
                    title={day.off ? "Weekly off / holiday for most staff" : undefined}
                  >
                    <div className="text-[10px] font-medium uppercase opacity-70">{day.dow}</div>
                    <div
                      className={cn(
                        "mx-auto text-sm tabular-nums",
                        day.today &&
                          "inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-[var(--color-primary)] px-1 text-[var(--color-primary-foreground)]"
                      )}
                    >
                      {day.n}
                    </div>
                  </th>
                ))}
                {data.totals.map((label) => (
                  <th
                    key={label}
                    className="border-b border-l border-[var(--color-border)] bg-[var(--color-card)] px-2 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]"
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.code} className="group">
                  <td className="sticky left-0 z-10 border-b border-r border-[var(--color-border)] bg-[var(--color-card)] px-3 py-1.5 group-hover:bg-[var(--color-muted)]">
                    <button
                      type="button"
                      className="block max-w-[240px] truncate text-left font-semibold hover:text-[var(--color-primary)] hover:underline"
                      onClick={() => setFocusCode(r.code)}
                      title={`Open ${r.name}'s month`}
                    >
                      {r.name}
                    </button>
                    <div className="truncate text-[11px] text-[var(--color-muted-foreground)]">
                      {r.code}
                      {r.dept ? ` · ${r.dept}` : ""}
                    </div>
                  </td>
                  {data.days.map((day) => {
                    const c = r.cells[day.d];
                    return (
                      <td
                        key={day.d}
                        title={cellTitle(day, c, r.name)}
                        style={
                          day.today
                            ? { background: mix("--color-primary", 6) }
                            : day.off && !c
                              ? { background: mix("--att-off", 7) }
                              : undefined
                        }
                        className={cn(
                          "border-b border-[var(--color-border)] p-0.5 text-center align-middle group-hover:bg-[var(--color-muted)]",
                          day.future && "opacity-60"
                        )}
                      >
                        {c ? (
                          week ? (
                            <WeekCell cell={c} metric={data.metric} />
                          ) : (
                            <span
                              className="inline-flex h-6 min-w-[32px] items-center justify-center rounded border px-0.5 text-[11px] font-bold tabular-nums"
                              style={cellStyle(c, data.metric)}
                            >
                              {cellMark(c, data.metric)}
                            </span>
                          )
                        ) : null}
                      </td>
                    );
                  })}
                  {r.t.map((v, i) => (
                    <td
                      key={data.totals[i] ?? i}
                      className="border-b border-l border-[var(--color-border)] px-2 py-1.5 text-right font-semibold tabular-nums"
                    >
                      <span className="rounded px-1.5 py-0.5" style={totalStyle(data.totals[i] ?? "", v, data.metric)}>
                        {formatTotal(data.totals[i] ?? "", v)}
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="sticky left-0 z-10 border-r border-[var(--color-border)] bg-[var(--color-muted)] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
                  {PER_DAY_LABEL[data.metric]}
                </td>
                {perDay.map((n, i) => (
                  <td
                    key={data.days[i].d}
                    className="bg-[var(--color-muted)] px-1 py-1.5 text-center font-semibold tabular-nums"
                    style={
                      n && !data.days[i].future
                        ? { background: mix(perDayToken, Math.round(12 + 50 * (n / perDayMax)), "var(--color-muted)"), color: `var(${perDayToken})` }
                        : undefined
                    }
                  >
                    {data.days[i].future ? "" : n || ""}
                  </td>
                ))}
                {data.totals.map((label) => (
                  <td key={label} className="border-l border-[var(--color-border)] bg-[var(--color-muted)]" />
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

function WeekCell({ cell, metric }: { cell: CalendarCell; metric: AttendanceCalendarData["metric"] }) {
  const times = cell.i || cell.o ? `${cell.i ?? "--:--"}–${cell.o ?? "--:--"}` : "";
  const style = cellStyle(cell, metric);
  const onSolid = style.color === WHITE;
  return (
    <div
      className="mx-auto flex w-[104px] flex-col items-center gap-0.5 rounded-md border px-1 py-1"
      style={style}
      data-kind={cell.k}
    >
      <span className="text-[11px] font-bold leading-none">{meta(cell.k).label}</span>
      {times ? (
        <span className={cn("text-[10px] tabular-nums", !onSolid && "text-[var(--color-foreground)]")}>{times}</span>
      ) : null}
      {cell.v ? <span className="text-[10px] font-semibold tabular-nums">{valueLabel(cell.v, metric)}</span> : null}
      {cell.ot && metric === "status" ? <span className="text-[10px] tabular-nums">OT {cell.ot}</span> : null}
    </div>
  );
}

function EmployeeMonth({
  row,
  data,
  onBack,
}: {
  row: CalendarRow;
  data: AttendanceCalendarData;
  onBack?: () => void;
}) {
  const weeks = useMemo(() => {
    const first = new Date(`${data.days[0].d}T00:00:00`);
    const lead = (first.getDay() + 6) % 7;
    const slots: (CalendarDay | null)[] = [...Array(lead).fill(null), ...data.days];
    while (slots.length % 7) slots.push(null);
    const out: (CalendarDay | null)[][] = [];
    for (let i = 0; i < slots.length; i += 7) out.push(slots.slice(i, i + 7));
    return out;
  }, [data.days]);

  return (
    <div data-testid="calendar-employee-month">
      <div className="flex flex-wrap items-center gap-3 pb-3">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="no-print inline-flex items-center gap-1 rounded-[var(--radius-md)] border border-[var(--color-border)] px-2.5 py-1 text-sm hover:bg-[var(--color-muted)]"
          >
            <ArrowLeft size={14} aria-hidden="true" /> All employees
          </button>
        ) : null}
        <div>
          <p className="font-semibold">{row.name}</p>
          <p className="text-xs text-[var(--color-muted-foreground)]">
            {row.code}
            {row.dept ? ` · ${row.dept}` : ""}
          </p>
        </div>
        <div className="ms-auto flex flex-wrap gap-2">
          {data.totals.map((label, i) => (
            <span
              key={label}
              className="rounded-[var(--radius-md)] border border-[var(--color-border)] px-2.5 py-1 text-xs"
              style={totalStyle(label, row.t[i] ?? "", data.metric)}
            >
              <span className="opacity-80">{label}</span> <b className="tabular-nums">{formatTotal(label, row.t[i] ?? "")}</b>
            </span>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1.5 text-xs">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="px-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
            {d}
          </div>
        ))}
        {weeks.flat().map((day, i) => {
          if (!day) return <div key={`pad-${i}`} />;
          const c = row.cells[day.d];
          const style = c ? cellStyle(c, data.metric) : undefined;
          const onSolid = style?.color === WHITE;
          return (
            <div
              key={day.d}
              title={cellTitle(day, c, row.name)}
              className={cn(
                "min-h-[78px] rounded-[var(--radius-md)] border border-[var(--color-border)] p-1.5",
                day.today && "ring-2 ring-[var(--color-primary)]",
                day.future && "opacity-50"
              )}
              style={style}
            >
              <div className="flex items-center justify-between">
                <span className={cn("text-sm font-bold tabular-nums", !onSolid && "text-[var(--color-foreground)]")}>{day.n}</span>
                {c?.sh ? <span className="text-[10px] opacity-80">{c.sh}</span> : null}
              </div>
              {c ? (
                <div className="mt-1 space-y-0.5">
                  <p className="font-semibold leading-tight">{meta(c.k).label}</p>
                  {c.i || c.o ? (
                    <p className={cn("tabular-nums", !onSolid && "text-[var(--color-foreground)]")}>
                      {c.i ?? "--:--"}–{c.o ?? "--:--"}
                    </p>
                  ) : null}
                  {c.v ? <p className="font-semibold tabular-nums">{valueLabel(c.v, data.metric)}</p> : null}
                  {c.ot && data.metric === "status" ? <p className="tabular-nums">OT {c.ot}</p> : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
