import type { ReactNode } from "react";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Button } from "./button";

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">{title}</h1>
        {subtitle ? (
          <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">{subtitle}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
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
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      {icon ? (
        <div className="mb-1 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-primary-muted)] text-[var(--color-primary)]">
          {icon}
        </div>
      ) : null}
      <p className="text-sm font-bold">{title}</p>
      {message ? (
        <p className="max-w-md text-sm text-[var(--color-muted-foreground)]">{message}</p>
      ) : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = "primary",
  onClick,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: ReactNode;
  tone?: "primary" | "success" | "warning" | "destructive" | "accent";
  onClick?: () => void;
}) {
  const tones: Record<string, string> = {
    primary: "bg-[var(--color-primary-muted)] text-[var(--color-primary)]",
    accent: "bg-[hsl(262_83%_96%)] text-[var(--color-accent)]",
    success: "bg-[hsl(142_71%_94%)] text-[var(--color-success)]",
    warning: "bg-[hsl(38_92%_93%)] text-[var(--color-warning)]",
    destructive: "bg-[hsl(0_72%_95%)] text-[var(--color-destructive)]",
  };
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        "group flex w-full items-center gap-4 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-white p-5 text-left shadow-[var(--shadow-card)] transition-all",
        onClick && "hover:-translate-y-0.5 hover:shadow-[var(--shadow-pop)] cursor-pointer"
      )}
    >
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
        <p className="mt-0.5 truncate text-2xl font-extrabold tracking-tight">{value}</p>
        {hint ? (
          <p className="mt-0.5 text-xs text-[var(--color-muted-foreground)]">{hint}</p>
        ) : null}
      </div>
    </button>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder,
  className,
  "data-testid": dataTestId,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  "data-testid"?: string;
}) {
  const t = useT();
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
      >
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? t("action.search")}
        data-testid={dataTestId}
        className="h-10 w-full rounded-[var(--radius-sm)] border border-[var(--color-input)] bg-white ps-9 pe-3 text-sm shadow-xs transition-colors placeholder:text-[var(--color-muted-foreground)] focus:border-[var(--color-primary)] focus:outline-none focus:ring-2 focus:ring-[hsl(243_75%_59%/0.15)]"
      />
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
