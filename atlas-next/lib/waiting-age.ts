/**
 * Approval-queue aging (Concur / Jupityr pattern).
 * Shows how long a ticket has waited in the current workflow state.
 */

export type WaitingUrgency = "fresh" | "watch" | "stale";

export function waitingDaysFromCreated(createdAt: string | null | undefined, today = new Date()): number | null {
  if (!createdAt) return null;
  const raw = String(createdAt).trim();
  if (!raw) return null;
  const day = raw.slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return null;
  const created = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(created.getTime())) return null;
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.max(0, Math.round((start.getTime() - created.getTime()) / 86_400_000));
}

export function waitingUrgency(days: number | null | undefined): WaitingUrgency {
  if (days == null || days < 3) return "fresh";
  if (days < 7) return "watch";
  return "stale";
}

/** Short label: Today · 1 day · N days */
export function waitingAgeLabel(days: number | null | undefined): string {
  if (days == null) return "";
  if (days <= 0) return "Today";
  if (days === 1) return "1 day";
  return `${days} days`;
}

export function waitingAgeClass(days: number | null | undefined): string {
  const level = waitingUrgency(days);
  if (level === "stale") return "text-[var(--color-destructive)] font-semibold";
  if (level === "watch") return "text-[var(--color-warning-emphasis,var(--color-primary-emphasis))] font-semibold";
  return "text-[var(--color-muted-foreground)]";
}
