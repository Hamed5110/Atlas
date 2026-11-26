"use client";

import { Check, ChevronDown, Search, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface MultiSelectOption {
  value: string;
  label: string;
  hint?: string;
}

interface MultiSelectProps {
  options: MultiSelectOption[];
  values: string[];
  onChange: (values: string[]) => void;
  /** Trigger label when nothing is selected (everything included). */
  placeholder?: string;
  disabled?: boolean;
  searchable?: boolean;
  "data-testid"?: string;
  className?: string;
}

/**
 * Multi-select dropdown (Power BI checkbox slicer + Fiori token pattern):
 * checkbox list with Select all / Clear, search for long lists, and the
 * selection rendered as removable chips outside the open panel.
 */
export function MultiSelect({
  options,
  values,
  onChange,
  placeholder = "All",
  disabled,
  searchable = true,
  "data-testid": testId,
  className,
}: MultiSelectProps) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selected = useMemo(() => new Set(values), [values]);
  const selectedOptions = useMemo(
    () => options.filter((o) => selected.has(o.value)),
    [options, selected]
  );
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        o.value.toLowerCase().includes(q) ||
        (o.hint ?? "").toLowerCase().includes(q)
    );
  }, [options, query]);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const toggle = (value: string) => {
    onChange(
      selected.has(value) ? values.filter((v) => v !== value) : [...values, value]
    );
  };

  const allSelected = options.length > 0 && values.length === options.length;

  return (
    <div ref={rootRef} className={cn("relative", className)} data-multiselect="">
      <button
        type="button"
        disabled={disabled}
        data-testid={testId}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-haspopup="listbox"
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
        className={cn(
          "flex h-11 w-full items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-[var(--color-input)] bg-[var(--color-card)] px-3 text-start text-base text-[var(--color-foreground)] shadow-xs transition-colors lg:h-10 lg:text-sm",
          "hover:border-[var(--color-input-hover)] focus:border-[var(--color-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-ring)]",
          "disabled:cursor-not-allowed disabled:opacity-60",
          values.length
            ? "text-[var(--color-foreground)]"
            : "text-[var(--color-muted-foreground)]"
        )}
      >
        <span className="truncate">
          {values.length ? `${values.length} selected` : placeholder}
        </span>
        <ChevronDown
          size={14}
          className={cn("shrink-0 transition-transform", open && "rotate-180")}
        />
      </button>

      {open && !disabled ? (
        <div
          id={listId}
          data-testid={testId ? `${testId}-panel` : undefined}
          className="absolute z-40 mt-1 w-full min-w-[14rem] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] py-1 text-[var(--color-foreground)] shadow-[var(--shadow-pop)]"
        >
          {searchable && options.length > 8 ? (
            <div className="relative border-b border-[var(--color-border)] px-2 pb-1.5">
              <Search
                size={13}
                className="pointer-events-none absolute left-4 top-1/2 -translate-y-[70%] text-[var(--color-muted-foreground)]"
              />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search…"
                data-testid={testId ? `${testId}-search` : undefined}
                className="h-8 w-full rounded-[var(--radius-sm)] border border-[var(--color-input)] pl-7 pr-2 text-sm focus:border-[var(--color-primary)] focus:outline-none"
              />
            </div>
          ) : null}
          <div className="flex items-center justify-between gap-1 border-b border-[var(--color-border)] px-2 py-1">
            <button
              type="button"
              data-testid={testId ? `${testId}-select-all` : undefined}
              onClick={() => onChange(allSelected ? [] : options.map((o) => o.value))}
              className="rounded px-1.5 py-0.5 text-xs font-semibold text-[var(--color-primary)] hover:bg-[var(--color-primary-muted)]"
            >
              {allSelected ? "Clear all" : "Select all"}
            </button>
            {values.length ? (
              <button
                type="button"
                data-testid={testId ? `${testId}-clear` : undefined}
                onClick={() => onChange([])}
                className="rounded px-1.5 py-0.5 text-xs font-medium text-[var(--color-muted-foreground)] hover:bg-[var(--color-secondary)]"
              >
                Clear
              </button>
            ) : null}
          </div>
          <ul role="listbox" aria-multiselectable="true" className="max-h-56 overflow-auto py-1">
            {matches.length === 0 ? (
              <li className="px-3 py-2 text-sm text-[var(--color-muted-foreground)]">
                No options match.
              </li>
            ) : (
              matches.slice(0, 200).map((o) => {
                const on = selected.has(o.value);
                return (
                  <li key={o.value}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={on}
                      data-testid={testId ? `${testId}-option-${o.value}` : undefined}
                      onClick={() => toggle(o.value)}
                      className={cn(
                        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-[var(--color-secondary)]",
                        on && "font-semibold"
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                          on
                            ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-white"
                            : "border-[var(--color-input)] bg-[var(--color-card)]"
                        )}
                      >
                        {on ? <Check size={11} strokeWidth={3} /> : null}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{o.label}</span>
                      {o.hint ? (
                        <span className="shrink-0 font-mono text-[11px] text-[var(--color-muted-foreground)]">
                          {o.hint}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      ) : null}

      {selectedOptions.length ? (
        <div
          className="mt-1.5 flex flex-wrap gap-1"
          data-testid={testId ? `${testId}-chips` : undefined}
        >
          {selectedOptions.map((o) => (
            <span
              key={o.value}
              data-testid={testId ? `${testId}-chip-${o.value}` : undefined}
              className="inline-flex items-center gap-1 rounded-full border border-[var(--color-primary)] bg-[var(--color-primary-muted)] px-2 py-0.5 text-xs font-medium text-[var(--color-primary)]"
            >
              <span className="max-w-[10rem] truncate">{o.label}</span>
              <button
                type="button"
                aria-label={`Remove ${o.label}`}
                data-testid={testId ? `${testId}-chip-remove-${o.value}` : undefined}
                onClick={() => toggle(o.value)}
                className="rounded-full p-0.5 hover:bg-[var(--color-primary)] hover:text-white"
              >
                <X size={11} strokeWidth={3} />
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
