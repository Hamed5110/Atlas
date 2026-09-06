"use client";

import { Search, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { Employee } from "@/lib/types";

interface EmployeeComboboxProps {
  employees: Employee[];
  value: string;
  onChange: (employeeId: string) => void;
  placeholder?: string;
  disabled?: boolean;
  allowEmpty?: boolean;
  emptyLabel?: string;
  activeOnly?: boolean;
  "data-testid"?: string;
  className?: string;
}

function rankEmployees(list: Employee[], query: string): Employee[] {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  const scored = list
    .map((e) => {
      const name = (e.full_name || "").toLowerCase();
      const arabic = (e.arabic_name || "").toLowerCase();
      const code = (e.code || "").toLowerCase();
      const dept = (e.department || "").toLowerCase();
      const cpr = (e.cpr_no || "").toLowerCase();
      let score = 99;
      if (name.startsWith(q)) score = 0;
      else if (arabic.startsWith(q)) score = 1;
      else if (code.startsWith(q)) score = 2;
      else if (name.includes(` ${q}`) || name.includes(q)) score = 3;
      else if (code.includes(q) || dept.includes(q) || cpr.includes(q) || arabic.includes(q)) {
        score = 4;
      } else {
        return null;
      }
      return { e, score, name };
    })
    .filter(Boolean) as Array<{ e: Employee; score: number; name: string }>;
  scored.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));
  return scored.map((row) => row.e);
}

export function EmployeeCombobox({
  employees,
  value,
  onChange,
  placeholder = "Type a name — e.g. A…",
  disabled,
  allowEmpty = true,
  emptyLabel = "Select employee…",
  activeOnly = true,
  className,
  "data-testid": testId,
}: EmployeeComboboxProps) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);

  const pool = useMemo(() => {
    const list = activeOnly ? employees.filter((e) => e.active) : employees;
    return [...list].sort((a, b) =>
      (a.full_name || a.code || "").localeCompare(b.full_name || b.code || "")
    );
  }, [employees, activeOnly]);

  const selected = pool.find((e) => e.id === value) ?? employees.find((e) => e.id === value);
  const matches = useMemo(() => rankEmployees(pool, open ? query : ""), [pool, query, open]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setHighlight(0);
    }
  }, [open]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const pick = (id: string) => {
    onChange(id);
    setOpen(false);
    setQuery("");
  };

  const clear = () => {
    onChange("");
    setQuery("");
    setOpen(true);
  };

  const display = open
    ? query
    : selected
      ? `${selected.code} — ${selected.full_name}`
      : "";

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <div className="relative">
        <Search
          size={14}
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-muted-foreground)]"
        />
        <Input
          value={display}
          disabled={disabled}
          placeholder={placeholder}
          data-testid={testId}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          autoComplete="off"
          className="pl-8 pr-8"
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setHighlight(0);
            if (!e.target.value.trim()) onChange("");
          }}
          onKeyDown={(e) => {
            if (!open && (e.key === "ArrowDown" || e.key === "Enter")) {
              setOpen(true);
              return;
            }
            if (e.key === "Escape") {
              setOpen(false);
              return;
            }
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setHighlight((h) => Math.min(h + 1, Math.max(matches.length - 1, 0)));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHighlight((h) => Math.max(h - 1, 0));
            } else if (e.key === "Enter" && matches[highlight]) {
              e.preventDefault();
              pick(matches[highlight].id);
            }
          }}
        />
        {value && !disabled ? (
          <button
            type="button"
            aria-label="Clear employee"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
            onClick={clear}
          >
            <X size={14} />
          </button>
        ) : null}
      </div>
      {open && !disabled ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-40 mt-1 max-h-64 w-full overflow-auto rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white py-1 shadow-[var(--shadow-pop)]"
        >
          {allowEmpty ? (
            <li>
              <button
                type="button"
                role="option"
                className="flex w-full px-3 py-2 text-left text-sm text-[var(--color-muted-foreground)] hover:bg-[var(--color-secondary)]"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick("")}
              >
                {emptyLabel}
              </button>
            </li>
          ) : null}
          {matches.length === 0 ? (
            <li className="px-3 py-2 text-sm text-[var(--color-muted-foreground)]">No employees match.</li>
          ) : (
            matches.slice(0, 80).map((e, index) => (
              <li key={e.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={e.id === value}
                  className={cn(
                    "flex w-full flex-col px-3 py-2 text-left hover:bg-[var(--color-secondary)]",
                    index === highlight && "bg-[var(--color-secondary)]",
                    e.id === value && "font-semibold"
                  )}
                  onMouseDown={(ev) => ev.preventDefault()}
                  onMouseEnter={() => setHighlight(index)}
                  onClick={() => pick(e.id)}
                >
                  <span className="text-sm">{e.full_name}</span>
                  <span className="font-mono text-[11px] text-[var(--color-muted-foreground)]">
                    {e.code}
                    {e.department ? ` · ${e.department}` : ""}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
