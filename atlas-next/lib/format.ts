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

export function titleCase(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!text) return "—";
  return text
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function statusTone(status: unknown): string {
  const s = String(status ?? "").toLowerCase();
  if (["posted", "approved", "active", "resolved", "healthy", "paid", "ready", "success"].includes(s))
    return "success";
  if (["draft", "submitted", "pending", "info", "open"].includes(s)) return "info";
  if (["warning", "deferred", "locked"].includes(s)) return "warning";
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
