"use client";

import { X } from "lucide-react";
import type { ReactNode } from "react";
import { useT } from "@/lib/i18n";

export function BulkBar({
  count,
  onClear,
  children,
  testId,
}: {
  count: number;
  onClear: () => void;
  children: ReactNode;
  testId?: string;
}) {
  const t = useT();
  if (count === 0) return null;
  return (
    <div
      role="toolbar"
      aria-label={t("bulk.toolbar")}
      data-testid={testId}
      className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-primary)] bg-[var(--color-primary-muted)] px-3 py-2 shadow-[var(--shadow-pop)]"
    >
      <span className="text-sm font-bold text-[var(--color-primary-emphasis)]">
        {count} {t("bulk.selected")}
      </span>
      <div className="flex flex-1 flex-wrap items-center gap-2">{children}</div>
      <button
        type="button"
        onClick={onClear}
        aria-label={t("bulk.clear")}
        className="rounded-full p-1 text-[var(--color-primary-emphasis)] hover:bg-[var(--color-card)] cursor-pointer"
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

export function SelectBox({
  checked,
  indeterminate = false,
  onChange,
  label,
  testId,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  testId?: string;
}) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      data-testid={testId}
      checked={checked}
      ref={(el) => {
        if (el) el.indeterminate = indeterminate && !checked;
      }}
      onChange={(e) => onChange(e.target.checked)}
      onClick={(e) => e.stopPropagation()}
      className="h-4 w-4 cursor-pointer accent-[var(--color-primary)]"
    />
  );
}

/** Excel-friendly CSV (BOM + CRLF) so Arabic names survive double-click open. */
export function downloadCsv(filename: string, header: string[], rows: unknown[][]) {
  const cell = (value: unknown) => {
    const text = value == null ? "" : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const body = [header, ...rows].map((row) => row.map(cell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["\uFEFF", body], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
