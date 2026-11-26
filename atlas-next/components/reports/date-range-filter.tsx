"use client";

import { ArrowLeftRight, CalendarRange } from "lucide-react";
import type { ReactNode } from "react";

import { Field, Input, Select } from "@/components/ui/input";
import {
  RANGE_PRESETS,
  type RangePresetId,
  type RangeState,
  currentFiscalYear,
  describeMonthRange,
  describeRange,
  effectiveRange,
  fiscalYearLabel,
  lastDayOfMonth,
  applyPreset,
  rangeFromPreset,
  withFrom,
  withTo,
} from "@/lib/report-period";

export const TRANSACTION_PRESETS: readonly RangePresetId[] = [
  "all",
  "today",
  "yesterday",
  "this_week",
  "this_month",
  "last_month",
  "this_quarter",
  "last_quarter",
  "this_year",
  "ytd",
  "last_year",
  "custom",
];

export const STATEMENT_PRESETS: readonly RangePresetId[] = [
  "this_month",
  "last_month",
  "this_quarter",
  "last_quarter",
  "ytd",
  "this_year",
  "last_year",
  "fiscal_year",
  "custom",
];

export const MONTH_PRESETS: readonly RangePresetId[] = [
  "all",
  "this_month",
  "last_month",
  "this_quarter",
  "last_quarter",
  "ytd",
  "this_year",
  "last_year",
  "fiscal_year",
  "custom",
];

export const DAILY_PRESETS: readonly RangePresetId[] = [
  "today",
  "yesterday",
  "this_week",
  "last_week",
  "this_month",
  "last_month",
  "custom",
];

/** Attendance summaries also need a quarter, a year and year to date (Zoho payroll periods). */
export const ATTENDANCE_PRESETS: readonly RangePresetId[] = [
  "today",
  "yesterday",
  "this_week",
  "last_week",
  "this_month",
  "last_month",
  "this_quarter",
  "last_quarter",
  "this_year",
  "ytd",
  "last_year",
  "custom",
];

/**
 * Period picker for report filter cards: preset + From/To (both inclusive) and a
 * "Selected: X to Y (N days)" line. Renders as flex children of the card row; the
 * summary line wraps to the bottom of the card.
 */
export function DateRangeFilter({
  idPrefix,
  value,
  onChange,
  presets = TRANSACTION_PRESETS,
  fiscalStartMonth = 1,
  fmt = (iso) => iso,
  granularity = "day",
  fmtMonth = (month) => month,
  note,
}: {
  idPrefix: string;
  value: RangeState;
  onChange: (next: RangeState) => void;
  presets?: readonly RangePresetId[];
  fiscalStartMonth?: number;
  fmt?: (iso: string) => string;
  /** "month" picks whole months (YYYY-MM) for month-keyed data such as commission vouchers. */
  granularity?: "day" | "month";
  fmtMonth?: (month: string) => string;
  note?: ReactNode;
}) {
  const monthly = granularity === "month";
  const unit = monthly ? "month" : "date";
  const options = RANGE_PRESETS.filter((p) => presets.includes(p.id));
  const active = RANGE_PRESETS.find((p) => p.id === value.preset);
  const applied = effectiveRange(value);
  const thisFy = currentFiscalYear(new Date(), fiscalStartMonth);
  const fiscalYears = Array.from({ length: 8 }, (_, i) => thisFy + 1 - i);

  return (
    <>
      <Field label="Period" htmlFor={`${idPrefix}-period`}>
        <Select
          id={`${idPrefix}-period`}
          data-testid={`${idPrefix}-period`}
          value={value.preset}
          title={active?.hint}
          onChange={(e) => onChange(applyPreset(value, e.target.value as RangePresetId, new Date(), fiscalStartMonth))}
          className="min-w-[10.5rem]"
        >
          {options.map((p) => (
            <option key={p.id} value={p.id} title={p.hint}>
              {p.label}
            </option>
          ))}
        </Select>
      </Field>
      {value.preset === "fiscal_year" ? (
        <Field label="Fiscal year" htmlFor={`${idPrefix}-fiscal-year`}>
          <Select
            id={`${idPrefix}-fiscal-year`}
            data-testid={`${idPrefix}-fiscal-year`}
            value={String(value.fiscalYear ?? thisFy)}
            title="Year-end and opening-balance work: the report covers the whole fiscal year"
            onChange={(e) =>
              onChange(rangeFromPreset("fiscal_year", new Date(), Number(e.target.value), fiscalStartMonth))
            }
          >
            {fiscalYears.map((y) => (
              <option key={y} value={y}>
                {fiscalYearLabel(y, fiscalStartMonth)}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      <Field label={monthly ? "From month" : "From"} htmlFor={`${idPrefix}-from`}>
        <Input
          id={`${idPrefix}-from`}
          data-testid={`${idPrefix}-${unit}-from`}
          type={monthly ? "month" : "date"}
          value={monthly ? value.from.slice(0, 7) : value.from}
          title={monthly ? "First month included in the report" : "First day included in the report"}
          onChange={(e) => {
            const v = e.target.value;
            onChange(withFrom(value, monthly && v ? `${v}-01` : v));
          }}
        />
      </Field>
      <Field label={monthly ? "To month" : "To"} htmlFor={`${idPrefix}-to`}>
        <Input
          id={`${idPrefix}-to`}
          data-testid={`${idPrefix}-${unit}-to`}
          type={monthly ? "month" : "date"}
          value={monthly ? value.to.slice(0, 7) : value.to}
          title={
            monthly
              ? "Last month included in the report. If it is before From, the months are swapped."
              : "Last day included in the report. If it is before From, the dates are swapped."
          }
          onChange={(e) => {
            const v = e.target.value;
            onChange(withTo(value, monthly && v ? lastDayOfMonth(v) : v));
          }}
        />
      </Field>
      <div
        className="order-last flex basis-full flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--color-muted-foreground)]"
        data-testid={`${idPrefix}-range-summary`}
        aria-live="polite"
      >
        <span className="inline-flex items-center gap-1.5 font-medium text-[var(--color-foreground)]">
          <CalendarRange size={14} aria-hidden="true" />
          {monthly ? describeMonthRange(applied, fmtMonth) : describeRange(applied, fmt)}
        </span>
        {applied.swapped ? (
          <span
            className="inline-flex items-center gap-1 rounded-full border border-[var(--color-warning)]/50 px-2 py-0.5 font-medium text-[var(--color-warning)]"
            data-testid={`${idPrefix}-range-swapped`}
          >
            <ArrowLeftRight size={12} aria-hidden="true" /> From was after To, so the {monthly ? "months" : "dates"} were
            swapped
          </span>
        ) : null}
        {note ? <span>{note}</span> : null}
      </div>
    </>
  );
}
