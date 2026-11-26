"use client";

import { useEffect, useId } from "react";
import { Input, Label } from "@/components/ui/input";
import { money } from "@/lib/format";
import { useT } from "@/lib/i18n";
import {
  MAX_LOAN_MONTHS,
  planForEmi,
  planForMonths,
  type LoanPlan,
  type LoanTermsMode,
  type LoanTermsValue,
} from "@/lib/loan-terms";
import { cn } from "@/lib/utils";

/** "8 × BHD 50.000 + last instalment BHD 35.210 · 9 months", or "12 × BHD 25.000 / month" when even. */
export function formatLoanPlan(t: (key: string) => string, plan: LoanPlan): string {
  if (plan.months > 1 && plan.last !== plan.emi) {
    return t("loanTerms.planLast")
      .replace("{count}", String(plan.months - 1))
      .replace("{emi}", money(plan.emi))
      .replace("{last}", money(plan.last))
      .replace("{months}", String(plan.months));
  }
  return t("loanTerms.planEven").replace("{months}", String(plan.months)).replace("{emi}", money(plan.emi));
}

export function LoanPlanText({ plan, className, testId }: { plan: LoanPlan; className?: string; testId?: string }) {
  const t = useT();
  return (
    <span className={className} data-testid={testId}>
      {formatLoanPlan(t, plan)}
    </span>
  );
}

/**
 * Loan terms entered as months or as a fixed monthly EMI. In EMI mode every instalment is the
 * EMI typed and the last one is the remainder; the months are worked out here so the parent
 * always has both. `plan` overrides the local interest-free plan (e.g. a server preview with
 * interest).
 */
export function LoanTermsInput({
  excess,
  value,
  onChange,
  onCommit,
  autoFocus,
  plan: planOverride,
  testId = "loan-terms",
}: {
  excess: number;
  value: LoanTermsValue;
  onChange: (value: LoanTermsValue) => void;
  /** Called when a typed value is final (blur / mode switch), e.g. to refresh a server preview. */
  onCommit?: (value: LoanTermsValue) => void;
  autoFocus?: boolean;
  plan?: LoanPlan | null;
  testId?: string;
}) {
  const t = useT();
  const inputId = useId();
  const mode: LoanTermsMode = value.emi == null ? "months" : "emi";

  const emiResult = mode === "emi" && value.emi?.trim() ? planForEmi(excess, Number(value.emi)) : null;
  const localPlan = mode === "months" ? planForMonths(excess, Number(value.months)) : emiResult?.ok ? emiResult.plan : null;
  const plan = planOverride !== undefined ? planOverride : localPlan;

  // The excess can change while EMI mode is on (ticket amount edited): keep months in step.
  useEffect(() => {
    if (mode !== "emi" || !emiResult?.ok) return;
    const months = String(emiResult.plan.months);
    if (months !== value.months) onChange({ months, emi: value.emi });
  }, [mode, excess]); // eslint-disable-line react-hooks/exhaustive-deps

  const switchMode = (next: LoanTermsMode) => {
    if (next === mode) return;
    let updated: LoanTermsValue;
    if (next === "emi") {
      const even = planForMonths(excess, Number(value.months));
      updated = { months: value.months, emi: even ? String(even.emi) : "" };
    } else {
      updated = { months: localPlan ? String(localPlan.months) : value.months, emi: null };
    }
    onChange(updated);
    onCommit?.(updated);
  };

  const typeEmi = (text: string) => {
    const result = planForEmi(excess, Number(text));
    onChange({ months: result.ok ? String(result.plan.months) : value.months, emi: text });
  };

  let error: string | null = null;
  if (emiResult && !emiResult.ok) {
    error =
      emiResult.reason === "too_small"
        ? t("loanTerms.emiTooSmall").replace("{max}", String(MAX_LOAN_MONTHS))
        : t("loanTerms.emiInvalid");
  }

  return (
    <div className="flex flex-col gap-1.5" data-testid={testId}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label htmlFor={inputId}>{t("loanTerms.label")}</Label>
        <div
          role="radiogroup"
          aria-label={t("loanTerms.mode")}
          className="inline-flex rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-secondary)] p-0.5 text-xs font-semibold"
        >
          {(["months", "emi"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              data-testid={`${testId}-mode-${m}`}
              onClick={() => switchMode(m)}
              className={cn(
                "min-h-7 rounded-[calc(var(--radius-sm)-2px)] px-3 transition-colors cursor-pointer",
                mode === m
                  ? "bg-[var(--color-card)] text-[var(--color-primary-emphasis)] shadow-sm"
                  : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
              )}
            >
              {m === "months" ? t("loanTerms.byMonths") : t("loanTerms.byEmi")}
            </button>
          ))}
        </div>
      </div>
      {mode === "months" ? (
        <Input
          id={inputId}
          type="number"
          inputMode="numeric"
          min="1"
          max={String(MAX_LOAN_MONTHS)}
          step="1"
          autoFocus={autoFocus}
          value={value.months}
          placeholder={t("loanTerms.monthsPlaceholder")}
          data-testid={`${testId}-months`}
          onChange={(e) => onChange({ months: e.target.value, emi: null })}
          onBlur={() => onCommit?.(value)}
        />
      ) : (
        <Input
          id={inputId}
          type="number"
          inputMode="decimal"
          min="0.01"
          step="0.01"
          autoFocus={autoFocus}
          value={value.emi ?? ""}
          placeholder={t("loanTerms.emiPlaceholder")}
          aria-invalid={Boolean(error)}
          data-testid={`${testId}-emi`}
          onChange={(e) => typeEmi(e.target.value)}
          onBlur={() => onCommit?.(value)}
        />
      )}
      {error ? (
        <p role="alert" className="text-xs font-medium text-[var(--color-destructive-emphasis)]">
          {error}
        </p>
      ) : plan ? (
        <p className="text-xs text-[var(--color-muted-foreground)]" data-testid={`${testId}-hint`}>
          <LoanPlanText plan={plan} />
        </p>
      ) : null}
    </div>
  );
}
