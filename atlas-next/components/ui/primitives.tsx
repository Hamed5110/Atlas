import type { KeyboardEvent, ReactNode } from "react";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Button } from "./button";

export function PageHeader({
  title,
  subtitle,
  actions,
  className,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  /** Override the default mb-6 rhythm (e.g. mb-3 when a KPI band follows immediately). */
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mb-6 flex w-full min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between",
        className
      )}
    >
      <div className="min-w-0 flex-1">
        <h1 className="text-balance text-xl font-extrabold tracking-tight sm:text-2xl">{title}</h1>
        {subtitle ? (
          <p className="mt-1 max-w-prose text-pretty text-sm text-[var(--color-muted-foreground)]">
            {subtitle}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2 sm:justify-end">
          {actions}
        </div>
      ) : null}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  message,
  action,
}: {
  icon?: ReactNode;
  title: string;
  message?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex w-full min-w-0 flex-col items-center justify-center gap-2 px-4 py-10 text-center sm:px-6 sm:py-14">
      {icon ? (
        <div className="mb-1 flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary-muted)] text-[var(--color-primary)]">
          {icon}
        </div>
      ) : null}
      <p className="max-w-full text-balance text-sm font-bold">{title}</p>
      {message ? (
        <p className="max-w-md break-words text-pretty text-sm text-[var(--color-muted-foreground)]">
          {message}
        </p>
      ) : null}
      {action ? <div className="mt-3 flex w-full min-w-0 max-w-sm flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}

/** "BHD 5,539.150" → small currency code + full-size amount, so totals fit without cutting digits. */
function StatValue({ value }: { value: ReactNode }) {
  const money = typeof value === "string" ? /^([A-Z]{3})\s+(.+)$/.exec(value) : null;
  if (!money) return <>{value}</>;
  return (
    <>
      <span className="me-1 align-baseline text-xs font-bold text-[var(--color-muted-foreground)]">{money[1]}</span>
      <span className="break-all sm:whitespace-nowrap">{money[2]}</span>
    </>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = "primary",
  onClick,
  "data-testid": dataTestId,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: ReactNode;
  tone?: "primary" | "success" | "warning" | "destructive" | "accent";
  onClick?: () => void;
  "data-testid"?: string;
}) {
  const tones: Record<string, string> = {
    primary: "bg-[var(--color-primary-muted)] text-[var(--color-primary)]",
    accent: "bg-[var(--color-accent-muted)] text-[var(--color-accent)]",
    success: "bg-[var(--color-success-muted)] text-[var(--color-success)]",
    warning: "bg-[var(--color-warning-muted)] text-[var(--color-warning)]",
    destructive: "bg-[var(--color-destructive-muted)] text-[var(--color-destructive)]",
  };
  const className = cn(
    "group flex w-full min-w-0 items-center gap-3 overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-4 text-start shadow-[var(--shadow-card)] transition-all sm:gap-4 sm:p-5",
    onClick && "hover:-translate-y-0.5 hover:shadow-[var(--shadow-pop)] cursor-pointer"
  );
  const body = (
    <>
      {icon ? (
        <div
          className={cn(
            "flex h-12 w-12 shrink-0 items-center justify-center rounded-[var(--radius-md)] transition-transform group-hover:scale-105",
            tones[tone]
          )}
        >
          {icon}
        </div>
      ) : null}
      <div className="min-w-0">
        <p className="text-xs font-bold uppercase tracking-wider text-[var(--color-muted-foreground)]">
          {label}
        </p>
        <p className="mt-0.5 text-xl font-extrabold leading-tight tracking-tight tabular-nums 2xl:text-2xl">
          <StatValue value={value} />
        </p>
        {hint ? (
          <p className="mt-0.5 text-xs text-[var(--color-muted-foreground)]">{hint}</p>
        ) : null}
      </div>
    </>
  );
  // Static KPIs must not be announced as dimmed/unavailable buttons — only real
  // actions get <button type="button">; the rest is a labelled, non-interactive group.
  if (!onClick) {
    return (
      <div role="group" aria-label={label} data-testid={dataTestId} className={className}>
        {body}
      </div>
    );
  }
  return (
    <button type="button" onClick={onClick} data-testid={dataTestId} className={className}>
      {body}
    </button>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder,
  className,
  hint,
  onKeyDown,
  "data-testid": dataTestId,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  /** Optional helper under the field (operators / examples). */
  hint?: string;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  "data-testid"?: string;
}) {
  const t = useT();
  const label = placeholder ?? t("action.search");
  return (
    <div className={cn("relative", className)}>
      <svg
        className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-muted-foreground)]"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && value) {
            e.preventDefault();
            onChange("");
          }
          onKeyDown?.(e);
        }}
        placeholder={label}
        aria-label={label}
        title={hint}
        aria-describedby={hint && dataTestId ? `${dataTestId}-hint` : undefined}
        data-testid={dataTestId}
        className={cn(
          "peer h-11 w-full rounded-[var(--radius-sm)] border border-[var(--color-input)] bg-[var(--color-card)] ps-9 text-base text-[var(--color-foreground)] shadow-xs transition-colors placeholder:text-[var(--color-muted-foreground)] focus:border-[var(--color-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-ring)] lg:h-10 lg:text-sm",
          value ? "pe-9" : "pe-3"
        )}
      />
      {value ? (
        <button
          type="button"
          className="absolute end-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-[var(--color-muted-foreground)] hover:bg-[var(--color-secondary)] hover:text-[var(--color-foreground)]"
          aria-label="Clear search"
          data-testid={dataTestId ? `${dataTestId}-clear` : "search-clear"}
          onClick={() => onChange("")}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-3.5 w-3.5"
            aria-hidden
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      ) : null}
      {/* Absolute so hint never shifts sibling toolbar alignment. */}
      {hint ? (
        <p
          id={dataTestId ? `${dataTestId}-hint` : undefined}
          className="pointer-events-none absolute start-0 top-[calc(100%+0.25rem)] z-10 hidden max-w-[22rem] rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-card)] px-2 py-1 text-[11px] text-[var(--color-muted-foreground)] shadow-[var(--shadow-card)] peer-focus:block"
        >
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function RetryButton({ onRetry }: { onRetry: () => void }) {
  const t = useT();
  return (
    <Button variant="outline" size="sm" onClick={onRetry}>
      {t("action.retry")}
    </Button>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const t = useT();
  const message =
    error instanceof Error ? error.message : "Something went wrong loading this data.";
  return (
    <EmptyState
      title={t("common.unableToLoad")}
      message={message}
      action={onRetry ? <RetryButton onRetry={onRetry} /> : undefined}
    />
  );
}
