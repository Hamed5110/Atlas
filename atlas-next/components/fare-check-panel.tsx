"use client";

import { Gauge, Loader2 } from "lucide-react";
import { Field, Textarea } from "@/components/ui/input";
import type { FareCheck, FareLight } from "@/lib/fare-check";
import { money } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const LIGHT_STYLE: Record<FareLight, { box: string; dot: string; label: string }> = {
  green: {
    box: "border-[var(--color-success-ring)] bg-[var(--color-success-muted)]",
    dot: "bg-[var(--color-success)]",
    label: "fare.light.green",
  },
  amber: {
    box: "border-[var(--color-warning-ring)] bg-[var(--color-warning-muted)]",
    dot: "bg-[var(--color-warning)]",
    label: "fare.light.amber",
  },
  red: {
    box: "border-[var(--color-destructive-ring)] bg-[var(--color-destructive-muted)]",
    dot: "bg-[var(--color-destructive)]",
    label: "fare.light.red",
  },
  none: {
    box: "border-[var(--color-border)] bg-[var(--color-muted)]",
    dot: "bg-[var(--color-muted-foreground)]",
    label: "fare.light.none",
  },
  off: {
    box: "border-[var(--color-border)] bg-[var(--color-muted)]",
    dot: "bg-[var(--color-muted-foreground)]",
    label: "fare.light.none",
  },
};

function RangeBar({ check }: { check: FareCheck }) {
  const low = Number(check.low);
  const amount = Number(check.amount);
  const top = Math.max(Number(check.high), Number(check.threshold), amount) || 1;
  const pct = (value: number) => `${Math.min(100, Math.max(0, (value / top) * 100))}%`;
  return (
    <div className="relative mt-2 h-2 rounded-full bg-[var(--color-card)]" aria-hidden>
      <div
        className="absolute inset-y-0 rounded-full bg-[var(--color-success)] opacity-40"
        style={{ left: pct(low), width: `calc(${pct(Number(check.benchmark))} - ${pct(low)})` }}
      />
      <div
        className="absolute inset-y-0 bg-[var(--color-warning)] opacity-40"
        style={{
          left: pct(Number(check.benchmark)),
          width: `calc(${pct(Number(check.threshold))} - ${pct(Number(check.benchmark))})`,
        }}
      />
      <div
        className="absolute -top-1 h-4 w-1 -translate-x-1/2 rounded bg-[var(--color-foreground)]"
        style={{ left: pct(amount) }}
      />
    </div>
  );
}

export function FareCheckPanel({
  check,
  loading,
  reason,
  onReasonChange,
}: {
  check: FareCheck | undefined;
  loading: boolean;
  reason: string;
  onReasonChange: (value: string) => void;
}) {
  const t = useT();
  if (!check && !loading) return null;
  if (check?.light === "off") return null;
  const style = LIGHT_STYLE[check?.light ?? "none"];
  return (
    <div
      className={cn("space-y-2 rounded-[var(--radius-md)] border p-3", style.box)}
      data-testid="panel-fare-check"
      data-light={check?.light ?? "loading"}
    >
      <div className="flex items-center gap-2">
        <Gauge className="h-4 w-4 shrink-0 text-[var(--color-primary)]" />
        <p className="text-sm font-bold">{t("fare.title")}</p>
        {loading && !check ? (
          <Loader2 className="ms-auto h-4 w-4 animate-spin text-[var(--color-muted-foreground)]" />
        ) : (
          <span className="ms-auto inline-flex items-center gap-1.5 text-xs font-semibold">
            <span className={cn("h-2.5 w-2.5 rounded-full", style.dot)} />
            {t(style.label)}
          </span>
        )}
      </div>
      {check ? (
        <>
          <p className="text-xs text-[var(--color-foreground)]">{check.message}</p>
          {check.benchmark ? (
            <>
              <RangeBar check={check} />
              <div className="grid grid-cols-3 gap-2 text-[11px] text-[var(--color-muted-foreground)]">
                <span>
                  {t("fare.benchmark")}: <b className="text-[var(--color-foreground)]">{money(check.benchmark)}</b>
                </span>
                <span>
                  {t("fare.range")}: {money(check.low)} – {money(check.high)}
                </span>
                <span>
                  {t("fare.limit")}: {money(check.threshold)} (+{check.tolerance_pct}%)
                </span>
              </div>
            </>
          ) : null}
          {check.reason_required ? (
            <Field label={t("fare.reason")}>
              <Textarea
                rows={2}
                value={reason}
                maxLength={500}
                data-testid="input-fare-reason"
                placeholder={t("fare.reason.placeholder")}
                onChange={(e) => onReasonChange(e.target.value)}
              />
            </Field>
          ) : null}
          {check.reason_required ? (
            <p className="text-[11px] font-semibold text-[var(--color-destructive-emphasis)]">
              {t("fare.approval")}
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
