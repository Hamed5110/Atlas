/**
 * Canonical Leave status palette — same as Dashboard Leave Tracker badges.
 * Reports / print / export must follow this map (not invent a second one).
 *
 * overdue → destructive · due_back → warning · on_leave → info
 * upcoming → secondary · returned → success · cancelled → outline
 */
import type { BadgeProps } from "@/components/ui/badge";

export type LeaveStatusKey =
  | "overdue"
  | "due_back"
  | "on_leave"
  | "upcoming"
  | "returned"
  | "cancelled";

export const LEAVE_STATUS_VARIANT: Record<
  LeaveStatusKey,
  NonNullable<BadgeProps["variant"]>
> = {
  overdue: "destructive",
  due_back: "warning",
  on_leave: "info",
  upcoming: "secondary",
  returned: "success",
  cancelled: "outline",
};

/** English desk labels (reports grid + Excel/PDF parity with tracker meaning). */
export const LEAVE_STATUS_LABEL: Record<LeaveStatusKey, string> = {
  overdue: "Overdue",
  due_back: "Due back",
  on_leave: "On leave",
  upcoming: "Upcoming",
  returned: "Returned",
  cancelled: "Employee cancel",
};

export function normalizeLeaveStatus(status: unknown): string {
  return String(status ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

export function parseLeaveStatus(status: unknown): LeaveStatusKey | null {
  const key = normalizeLeaveStatus(status);
  if (key === "canceled") return "cancelled";
  if (key === "due_back_today") return "due_back";
  if ((Object.keys(LEAVE_STATUS_VARIANT) as string[]).includes(key)) {
    return key as LeaveStatusKey;
  }
  return null;
}

export function leaveStatusVariant(status: unknown): BadgeProps["variant"] {
  const key = parseLeaveStatus(status);
  return key ? LEAVE_STATUS_VARIANT[key] : "outline";
}

export function formatLeaveStatusLabel(status: unknown): string {
  const key = parseLeaveStatus(status);
  if (key) return LEAVE_STATUS_LABEL[key];
  return String(status ?? "").trim();
}

/** Tailwind pill classes matching Badge muted+emphasis (for grids that avoid Badge). */
export function leaveStatusToneClass(status: unknown): string {
  const base =
    "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold tracking-wide ring-1 ring-inset";
  const key = parseLeaveStatus(status);
  switch (key) {
    case "returned":
      return `${base} bg-[var(--color-success-muted)] text-[var(--color-success-emphasis)] ring-[var(--color-success-ring)]`;
    case "overdue":
      return `${base} bg-[var(--color-destructive-muted)] text-[var(--color-destructive-emphasis)] ring-[var(--color-destructive-ring)]`;
    case "due_back":
      return `${base} bg-[var(--color-warning-muted)] text-[var(--color-warning-emphasis)] ring-[var(--color-warning-ring)]`;
    case "on_leave":
      return `${base} bg-[var(--color-info-muted)] text-[var(--color-info-emphasis)] ring-[var(--color-info-ring)]`;
    case "upcoming":
      return `${base} bg-[var(--color-secondary)] text-[var(--color-muted-foreground)] ring-[var(--color-border)]`;
    case "cancelled":
      return `${base} bg-[var(--color-card)] text-[var(--color-foreground)] ring-[var(--color-border)]`;
    default:
      return "";
  }
}

/** Filter-chip classes on Dashboard Leave Tracker (always tinted so tones read at a glance). */
export function leaveFilterChipClass(
  key: LeaveStatusKey | "open",
  active: boolean
): string {
  if (key === "open") {
    return active
      ? "border-[var(--color-primary)] bg-[var(--color-primary-muted)] text-[var(--color-primary-emphasis)]"
      : "border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-muted-foreground)]";
  }
  const map: Record<LeaveStatusKey, { on: string; off: string }> = {
    overdue: {
      on: "border-[var(--color-destructive)] bg-[var(--color-destructive-muted)] text-[var(--color-destructive-emphasis)] ring-1 ring-[var(--color-destructive-ring)]",
      off: "border-[var(--color-destructive)]/40 bg-[var(--color-destructive-muted)] text-[var(--color-destructive)]",
    },
    due_back: {
      on: "border-[var(--color-warning)] bg-[var(--color-warning-muted)] text-[var(--color-warning-emphasis)] ring-1 ring-[var(--color-warning-ring)]",
      off: "border-[var(--color-warning)]/40 bg-[var(--color-warning-muted)] text-[var(--color-warning)]",
    },
    on_leave: {
      on: "border-[var(--color-info)] bg-[var(--color-info-muted)] text-[var(--color-info-emphasis)] ring-1 ring-[var(--color-info-ring)]",
      off: "border-[var(--color-info)]/40 bg-[var(--color-info-muted)] text-[var(--color-info)]",
    },
    upcoming: {
      on: "border-[var(--color-border)] bg-[var(--color-secondary)] text-[var(--color-foreground)] ring-1 ring-[var(--color-border)]",
      off: "border-[var(--color-border)] bg-[var(--color-secondary)] text-[var(--color-muted-foreground)]",
    },
    returned: {
      on: "border-[var(--color-success)] bg-[var(--color-success-muted)] text-[var(--color-success-emphasis)] ring-1 ring-[var(--color-success-ring)]",
      off: "border-[var(--color-success)]/40 bg-[var(--color-success-muted)] text-[var(--color-success)]",
    },
    cancelled: {
      on: "border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-foreground)] ring-1 ring-[var(--color-border)]",
      off: "border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-muted-foreground)]",
    },
  };
  return active ? map[key].on : map[key].off;
}

/** Ticket workflow Status column (Waiting for approval / Paid / …) — screen + export. */
export function ticketWorkflowVariant(status: unknown): BadgeProps["variant"] {
  const key = normalizeLeaveStatus(status);
  // approved = Waiting for payment (amber), paid = done (green) — match statusTone.
  if (key === "paid" || key === "active") return "success";
  if (
    key === "approved" ||
    key.includes("waiting") ||
    key === "pending" ||
    key === "submitted"
  ) {
    return "warning";
  }
  if (key === "issued" || key === "booked") return "info";
  if (key.includes("cancel") || key === "rejected") return "destructive";
  return "outline";
}
