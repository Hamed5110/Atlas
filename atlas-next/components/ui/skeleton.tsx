import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/*
  Skeleton system — layout-matched shimmer placeholders.
  Research: NN/g Skeleton Screens 101 (wireframe the real layout, <10s waits);
  UXCollective (slow left-to-right shimmer beats pulsing for perceived speed);
  72Technologies (match dimensions/structure/counts; reduced-motion is
  non-negotiable — handled globally in globals.css).
  A11y: shimmer blocks are aria-hidden; the wrapper is a single role="status"
  live region with a visually-hidden loading announcement.
*/

export function Skeleton({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      aria-hidden="true"
      style={style}
      className={cn("skeleton-shimmer rounded-[var(--radius-sm)]", className)}
    />
  );
}

function Status({ label, children, testId }: { label: string; children: ReactNode; testId: string }) {
  return (
    <div role="status" aria-label={label} data-testid={testId}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

/** Table skeleton: header bar + rows of per-column cells, matching data-table rhythm. */
export function TableSkeleton({
  rows = 6,
  columns = 5,
  label = "Loading…",
}: {
  rows?: number;
  columns?: number;
  label?: string;
}) {
  const widths = ["w-3/12", "w-2/12", "w-2/12", "w-2/12", "w-3/12", "w-1/12", "w-2/12", "w-2/12"];
  return (
    <Status label={label} testId="skeleton-table">
      <div className="flex flex-col p-4">
        <div className="flex h-11 items-center gap-4 border-b border-[var(--color-border)]">
          {Array.from({ length: columns }).map((_, c) => (
            <Skeleton key={c} className={cn("h-3", widths[c % widths.length])} />
          ))}
        </div>
        {Array.from({ length: rows }).map((_, r) => (
          <div
            key={r}
            className="flex h-[var(--row-height)] items-center gap-4 border-b border-[var(--color-border)] last:border-0"
          >
            {Array.from({ length: columns }).map((_, c) => (
              <Skeleton
                key={c}
                className={cn("h-3.5", widths[(c + 1) % widths.length], c === 0 && "h-4")}
              />
            ))}
          </div>
        ))}
      </div>
    </Status>
  );
}

/** Stat-card grid skeleton: icon tile + label/value/hint lines, mirroring StatCard. */
export function CardsSkeleton({
  count = 4,
  label = "Loading…",
}: {
  count?: number;
  label?: string;
}) {
  return (
    <Status label={label} testId="skeleton-cards">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: count }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-4 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-5 shadow-[var(--shadow-card)]"
          >
            <Skeleton className="h-12 w-12 shrink-0 rounded-[var(--radius-md)]" />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <Skeleton className="h-2.5 w-1/3" />
              <Skeleton className="h-6 w-1/2" />
              <Skeleton className="h-2.5 w-2/3" />
            </div>
          </div>
        ))}
      </div>
    </Status>
  );
}

/** Chart panel skeleton: axis-like bars inside the same h-64 frame as recharts. */
export function ChartSkeleton({ label = "Loading…" }: { label?: string }) {
  return (
    <Status label={label} testId="skeleton-chart">
      <div className="flex h-64 flex-col justify-end gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] p-4">
        <Skeleton className="h-3 w-24" />
        <div className="flex flex-1 items-end gap-2">
          {[38, 62, 45, 78, 55, 88, 66, 72, 50, 82, 60, 70].map((h, i) => (
            <Skeleton key={i} className="flex-1" style={{ height: `${h}%` }} />
          ))}
        </div>
        <Skeleton className="h-2.5 w-full" />
      </div>
    </Status>
  );
}

/** List skeleton: avatar + two text lines + trailing value, mirroring activity lists. */
export function ListSkeleton({
  items = 6,
  label = "Loading…",
}: {
  items?: number;
  label?: string;
}) {
  return (
    <Status label={label} testId="skeleton-list">
      <div className="space-y-3">
        {Array.from({ length: items }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] p-2.5"
          >
            <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Skeleton className="h-3.5 w-1/3" />
              <Skeleton className="h-2.5 w-1/2" />
            </div>
            <Skeleton className="h-3.5 w-14" />
          </div>
        ))}
      </div>
    </Status>
  );
}

/** Form skeleton: label + field pairs mirroring .form-stack dialogs. */
export function FormSkeleton({
  fields = 4,
  label = "Loading…",
}: {
  fields?: number;
  label?: string;
}) {
  return (
    <Status label={label} testId="skeleton-form">
      <div className="form-stack">
        {Array.from({ length: fields }).map((_, i) => (
          <div key={i}>
            <Skeleton className="mb-1 h-3 w-24" />
            <Skeleton className="h-10 w-full" />
          </div>
        ))}
      </div>
    </Status>
  );
}

/** Ticket/card-grid skeleton: mirrors the allocation register's 2-col card grid. */
export function CardGridSkeleton({
  count = 4,
  label = "Loading…",
}: {
  count?: number;
  label?: string;
}) {
  return (
    <Status label={label} testId="skeleton-card-grid">
      <div className="grid gap-3 lg:grid-cols-2">
        {Array.from({ length: count }).map((_, i) => (
          <div
            key={i}
            className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] p-4 shadow-[var(--shadow-card)]"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <Skeleton className="h-10 w-10 rounded-[var(--radius-sm)]" />
                <div className="flex flex-col gap-1.5">
                  <Skeleton className="h-3.5 w-32" />
                  <Skeleton className="h-2.5 w-24" />
                </div>
              </div>
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
            <Skeleton className="mt-3 h-8 w-full" />
            <div className="mt-3 flex gap-2">
              <Skeleton className="h-8 w-20" />
              <Skeleton className="h-8 w-20" />
            </div>
          </div>
        ))}
      </div>
    </Status>
  );
}
