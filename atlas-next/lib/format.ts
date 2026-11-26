export function money(value: unknown, currency = "BHD"): string {
  const num = Number(value ?? 0);
  if (Number.isNaN(num)) return String(value ?? "—");
  // Bahraini Dinar uses 3 decimal places (fils).
  const formatted = new Intl.NumberFormat("en-BH", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  }).format(num);
  return currency ? `${currency} ${formatted}` : formatted;
}

export function num(value: unknown): string {
  const n = Number(value ?? 0);
  return Number.isNaN(n) ? String(value ?? "—") : new Intl.NumberFormat("en-BH").format(n);
}

/** Local calendar date as YYYY-MM-DD (avoids UTC day-shift from toISOString). */
export function todayLocal(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseDateInput(value: unknown): Date | null {
  if (!value) return null;
  const raw = String(value).trim();
  // Date-only ISO must be local calendar day, not UTC midnight.
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (dateOnly) {
    const y = Number(dateOnly[1]);
    const m = Number(dateOnly[2]);
    const d = Number(dateOnly[3]);
    const local = new Date(y, m - 1, d);
    return Number.isNaN(local.getTime()) ? null : local;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function fmtDate(value: unknown): string {
  const d = parseDateInput(value);
  if (!d) return value ? String(value) : "—";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

/** Period month display: "2026-09" → "September 2026". Non-month strings pass through. */
export function fmtMonth(value: unknown): string {
  if (!value) return "—";
  const raw = String(value).trim();
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(raw);
  if (!match) return raw;
  const d = new Date(Number(match[1]), Number(match[2]) - 1, 1);
  return d.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

export function fmtDateTime(value: unknown): string {
  if (!value) return "—";
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Dense-grid display only — formats ISO date/datetime strings; never mutates API payloads. */
export function fmtGridCell(value: unknown): string {
  if (value == null || value === "") return "—";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return fmtDate(raw);
  const dmy = /^(\d{2})-(\d{2})-(\d{4})$/.exec(raw);
  if (dmy) return fmtDate(`${dmy[3]}-${dmy[2]}-${dmy[1]}`);
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(raw)) return fmtDateTime(raw);
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(raw)) return fmtMonth(raw);
  // "2.0000" → "2.000": trailing zeros only, so real precision (0.20833) is never lost.
  if (/^-?\d+\.\d{4,}$/.test(raw)) return raw.replace(/(\.\d{3}\d*?)0+$/, "$1");
  return raw;
}

export type ReportColumnKind = "days" | "amount" | "count" | "text";

/** Column role for report grids — drives alignment + fixed fraction digits. */
export function reportColumnKind(column: string): ReportColumnKind {
  const name = column.trim();
  if (/\b(days|day)\b/i.test(name) && !/rate|date/i.test(name)) return "days";
  if (
    /\b(tickets?|trips?|count|qty|quantity|entries|employees|headcount|rank)\b/i.test(name) &&
    !/amount|balance|entitlement|rate/i.test(name)
  ) {
    return "count";
  }
  if (
    /amount|amt|balance|entitlement|payable|fare|cost|spend|salary|commission|funds|fund|payout|excess|rate|opening|closing|accrued|paid|pays|total|value|fine|bonus|fee|tax|vat|budget/i.test(
      name
    )
  ) {
    return "amount";
  }
  return "text";
}

function formatFixed(value: unknown, fractionDigits: number): string {
  const n = typeof value === "number" ? value : Number(String(value ?? "").replace(/,/g, "").trim());
  if (!Number.isFinite(n)) return fmtGridCell(value);
  return new Intl.NumberFormat("en-BH", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
    useGrouping: fractionDigits === 0 ? false : true,
  }).format(n);
}

/**
 * Comfortable report cell: fixed days (4dp) / amounts (BHD 3dp) / counts (int).
 * Maersk/CFPB: right-align quantities; keep identifiers as text via fmtGridCell.
 */
export function fmtReportCell(column: string, value: unknown): string {
  if (value == null || value === "") return "—";
  const kind = reportColumnKind(column);
  if (kind === "days") return formatFixed(value, 4);
  if (kind === "amount") return formatFixed(value, 3);
  if (kind === "count") return formatFixed(value, 0);
  // Ticket Status column: same wording as Allocation (Waiting for payment, etc.)
  if (/^status$/i.test(column.trim())) {
    const key = String(value).trim().toLowerCase();
    if (["draft", "submitted", "approved", "paid", "rejected"].includes(key)) {
      return ticketWorkflowStatusLabel(key);
    }
  }
  return fmtGridCell(value);
}

/**
 * Biometric / attendance punch display — treat values without Z/offset as
 * site wall-clock (Asia/Bahrain). Never shift via Date UTC conversion.
 */
export function fmtPunchTime(value: unknown): string {
  if (!value) return "—";
  const raw = String(value).trim();
  const wall = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(raw);
  const hasTz = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(raw);
  if (wall && !hasTz) {
    return `${wall[2]}:${wall[3]}${wall[4] ? `:${wall[4]}` : ""}`;
  }
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

export function titleCase(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!text) return "—";
  return text
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Airfare ticket workflow labels (API keeps draft/submitted/approved/paid).
 * Process: Waiting for approval → Approve/Reject → Waiting for payment → Paid.
 * Refs: Concur pending-approval vs sent-for-payment; Coupa OK-to-Pay after approve;
 * Statecraft approval UX (named stages + fixed decision actions).
 */
export function ticketWorkflowStatusLabel(status: unknown): string {
  const key = String(status ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  const labels: Record<string, string> = {
    draft: "Draft",
    submitted: "Waiting for approval",
    approved: "Waiting for payment",
    paid: "Paid",
    rejected: "Rejected",
  };
  return labels[key] || titleCase(status);
}

/** Human toast / confirm copy for a workflow transition target. */
export function ticketWorkflowActionLabel(nextStatus: unknown): string {
  const key = String(nextStatus ?? "")
    .trim()
    .toLowerCase();
  const labels: Record<string, string> = {
    submitted: "Submit for approval",
    approved: "Approve → Waiting for payment",
    rejected: "Reject",
    paid: "Mark paid",
    draft: "Re-open as draft",
  };
  return labels[key] || ticketWorkflowStatusLabel(nextStatus);
}

export function statusTone(status: unknown): string {
  const s = String(status ?? "").toLowerCase();
  // approved = waiting for payment (amber), paid = done (green)
  if (["posted", "active", "resolved", "healthy", "paid", "ready", "success"].includes(s))
    return "success";
  if (["approved", "warning", "deferred", "locked"].includes(s)) return "warning";
  if (["draft", "submitted", "pending", "info", "open"].includes(s)) return "info";
  if (["rejected", "cancelled", "failed", "critical", "overdue", "closed"].includes(s))
    return "destructive";
  return "secondary";
}

export function forecastMonthLabel(offset: number): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offset);
  return d.toLocaleString("en-GB", { month: "short" });
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
