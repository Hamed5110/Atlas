export function money(value: unknown, currency = "BHD"): string {
  const num = Number(value ?? 0);
  if (Number.isNaN(num)) return String(value ?? "—");
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

export function fmtDate(value: unknown): string {
  if (!value) return "—";
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value);
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

export function titleCase(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function statusTone(status: string): string {
  const s = status.toLowerCase();
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
