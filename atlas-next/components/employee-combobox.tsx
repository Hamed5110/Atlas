"use client";

import { Search, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
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
  /** inline = typeahead list (default). lookup = SAP F4 / BC lookup popup. */
  mode?: "inline" | "lookup";
  /** full = "code — name" (standalone fields). code = code only (grid with a Name column). */
  labelMode?: "full" | "code";
  /** Employee ids that cannot be picked (already on this voucher, etc.). */
  excludeIds?: string[];
  "data-testid"?: string;
  className?: string;
}

/**
 * Ranked employee search (typeahead / F4).
 * 0 prefix-name, 1 prefix-arabic, 2 prefix-code, 3 contains-name, 4 other field.
 * Unmatched rows drop out. Stable tie-break: name A–Z.
 */
export function rankEmployees(list: Employee[], query: string): Employee[] {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  const scored = list
    .map((e) => {
      const name = (e.full_name || "").toLowerCase();
      const arabic = (e.arabic_name || "").toLowerCase();
      const code = (e.code || "").toLowerCase();
      const dept = (e.department || "").toLowerCase();
      const desig = (e.designation || "").toLowerCase();
      const cpr = (e.cpr_no || "").toLowerCase();
      let score = 99;
      if (name.startsWith(q)) score = 0;
      else if (arabic.startsWith(q)) score = 1;
      else if (code.startsWith(q)) score = 2;
      else if (name.includes(` ${q}`) || name.includes(q)) score = 3;
      else if (
        code.includes(q) ||
        dept.includes(q) ||
        desig.includes(q) ||
        cpr.includes(q) ||
        arabic.includes(q)
      ) {
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
  mode = "inline",
  labelMode = "full",
  excludeIds,
  className,
  "data-testid": testId,
}: EmployeeComboboxProps) {
  if (mode === "lookup") {
    return (
      <EmployeeLookup
        employees={employees}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        disabled={disabled}
        activeOnly={activeOnly}
        excludeIds={excludeIds}
        className={className}
        data-testid={testId}
      />
    );
  }
  return (
      <EmployeeInline
        employees={employees}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        disabled={disabled}
        allowEmpty={allowEmpty}
        emptyLabel={emptyLabel}
        activeOnly={activeOnly}
        labelMode={labelMode}
        excludeIds={excludeIds}
        className={className}
        data-testid={testId}
      />
  );
}

function useEmployeePool(employees: Employee[], activeOnly: boolean) {
  return useMemo(() => {
    const list = activeOnly ? employees.filter((e) => e.active) : employees;
    return [...list].sort((a, b) =>
      (a.full_name || a.code || "").localeCompare(b.full_name || b.code || "")
    );
  }, [employees, activeOnly]);
}

function EmployeeInline({
  employees,
  value,
  onChange,
  placeholder,
  disabled,
  allowEmpty,
  emptyLabel,
  activeOnly,
  labelMode = "full",
  excludeIds,
  className,
  "data-testid": testId,
}: Omit<EmployeeComboboxProps, "mode"> & { activeOnly: boolean }) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [box, setBox] = useState({ top: 0, left: 0, width: 0, maxH: 320 });
  const pool = useEmployeePool(employees, activeOnly);
  const blocked = useMemo(() => new Set((excludeIds ?? []).filter(Boolean)), [excludeIds]);
  const selected = pool.find((e) => e.id === value) ?? employees.find((e) => e.id === value);
  const matches = useMemo(() => {
    const ranked = rankEmployees(pool, open ? query : "");
    return ranked.filter((e) => !blocked.has(e.id) || e.id === value);
  }, [pool, query, open, blocked, value]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setHighlight(0);
    }
  }, [open]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        const list = document.getElementById(listId);
        if (list && list.contains(e.target as Node)) return;
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [listId]);

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const el = rootRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const width = Math.min(Math.max(r.width, 28 * 16), window.innerWidth - 16);
      let left = r.left;
      if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - width - 8);
      const maxH = Math.min(20 * 16, window.innerHeight - 24);
      let top = r.bottom + 4;
      if (top + Math.min(maxH, 240) > window.innerHeight && r.top > maxH) {
        top = Math.max(8, r.top - maxH - 4);
      }
      setBox({ top, left, width, maxH });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, matches.length]);

  const pick = (id: string) => {
    onChange(id);
    setOpen(false);
    setQuery("");
  };

  const display = open
    ? query
    : selected
      ? labelMode === "code"
        ? selected.code
        : `${selected.code} — ${selected.full_name}`
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
            if (!open && (e.key === "ArrowDown" || e.key === "Enter" || e.key === "F4")) {
              e.preventDefault();
              setOpen(true);
              return;
            }
            if (e.key === "Escape") {
              if (open) e.preventDefault();
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
            onClick={() => {
              onChange("");
              setQuery("");
              setOpen(true);
            }}
          >
            <X size={14} />
          </button>
        ) : null}
      </div>
      {open && !disabled && typeof document !== "undefined"
        ? createPortal(
            <ul
              id={listId}
              role="listbox"
              data-testid="employee-inline-list"
              style={{ top: box.top, left: box.left, width: box.width, maxHeight: box.maxH }}
              className="fixed z-[80] overflow-auto rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white py-1 shadow-[var(--shadow-pop)]"
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
                        "flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left hover:bg-[var(--color-secondary)]",
                        index === highlight && "bg-[var(--color-secondary)]",
                        e.id === value && "font-semibold"
                      )}
                      onMouseDown={(ev) => ev.preventDefault()}
                      onMouseEnter={() => setHighlight(index)}
                      onClick={() => pick(e.id)}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm">{e.full_name}</span>
                        <span className="font-mono text-[11px] text-[var(--color-muted-foreground)]">
                          {e.code}
                          {e.designation ? ` · ${e.designation}` : ""}
                          {e.department ? ` · ${e.department}` : ""}
                        </span>
                      </span>
                    </button>
                  </li>
                ))
              )}
            </ul>,
            document.body
          )
        : null}
    </div>
  );
}

function EmployeeLookup({
  employees,
  value,
  onChange,
  placeholder,
  disabled,
  activeOnly,
  excludeIds,
  className,
  "data-testid": testId,
}: Omit<EmployeeComboboxProps, "mode" | "allowEmpty" | "emptyLabel"> & { activeOnly: boolean }) {
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [matchMode, setMatchMode] = useState<"containing" | "starting">("containing");
  const [dept, setDept] = useState("");
  const [highlight, setHighlight] = useState(0);
  const pool = useEmployeePool(employees, activeOnly);
  const blocked = useMemo(() => new Set((excludeIds ?? []).filter(Boolean)), [excludeIds]);
  const selected = pool.find((e) => e.id === value) ?? employees.find((e) => e.id === value);

  const departments = useMemo(() => {
    const names = new Set<string>();
    for (const e of pool) {
      if (e.department) names.add(e.department);
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [pool]);

  const pickable = useMemo(() => {
    const base = dept ? pool.filter((e) => e.department === dept) : pool;
    const ranked = rankEmployees(
      base.filter((e) => !blocked.has(e.id)),
      query
    );
    if (matchMode !== "starting" || !query.trim()) return ranked;
    const q = query.trim().toLowerCase();
    return ranked.filter(
      (e) =>
        (e.full_name || "").toLowerCase().startsWith(q) ||
        (e.code || "").toLowerCase().startsWith(q) ||
        (e.arabic_name || "").toLowerCase().startsWith(q)
    );
  }, [pool, dept, blocked, query, matchMode]);

  useEffect(() => {
    if (!open) return;
    setHighlight(0);
    const id = window.setTimeout(() => searchRef.current?.focus(), 30);
    return () => window.clearTimeout(id);
  }, [open]);

  useEffect(() => {
    setHighlight(0);
  }, [query, dept]);

  const pick = (id: string) => {
    if (blocked.has(id)) return;
    onChange(id);
    setOpen(false);
    setQuery("");
    setDept("");
  };

  const openLookup = (seed = "") => {
    if (disabled) return;
    setQuery(seed);
    setOpen(true);
  };

  const display = selected ? `${selected.code} — ${selected.full_name}` : "";

  return (
    <div className={cn("flex w-full min-w-0 items-center gap-1", className)}>
      <div className="relative min-w-0 flex-1">
        <Search
          size={14}
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-muted-foreground)]"
        />
        <Input
          value={display}
          disabled={disabled}
          readOnly
          placeholder={placeholder}
          data-testid={testId}
          role="combobox"
          aria-expanded={open}
          aria-haspopup="dialog"
          title="Click or press F4 to look up an employee"
          className="cursor-pointer pl-8 pr-8"
          onClick={() => openLookup()}
          onKeyDown={(e) => {
            if (e.key === "F4" || e.key === "Enter" || e.key === "ArrowDown" || e.key === " ") {
              e.preventDefault();
              openLookup();
            }
          }}
        />
        {value && !disabled ? (
          <button
            type="button"
            aria-label="Clear employee"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
            onClick={(e) => {
              e.stopPropagation();
              onChange("");
            }}
          >
            <X size={14} />
          </button>
        ) : null}
      </div>
      <Button
        type="button"
        variant="outline"
        size="icon"
        disabled={disabled}
        aria-label="Lookup employee (F4)"
        title="Lookup employee (F4)"
        data-testid={testId ? `${testId}-lookup` : "employee-lookup-open"}
        onClick={() => openLookup()}
      >
        <Search size={15} />
      </Button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        size="wide"
        layer="nested"
        title="Select employee"
        description="Focus-style list popup (F2). Containing / Starting search, then click a row."
      >
        <div className="flex min-h-0 flex-1 flex-col gap-3" data-testid="employee-lookup-dialog">
          <div className="flex flex-wrap items-end gap-2" data-testid="employee-lookup-focus-toolbar">
            <label className="block text-sm font-semibold">
              Match
              <Select
                value={matchMode}
                data-testid="employee-lookup-match"
                className="mt-1 h-10 w-36"
                onChange={(e) => setMatchMode(e.target.value as "containing" | "starting")}
              >
                <option value="containing">Containing</option>
                <option value="starting">Starting with</option>
              </Select>
            </label>
            <label className="block min-w-[16rem] flex-1 text-sm font-semibold">
              Search
              <Input
                ref={searchRef}
                value={query}
                placeholder="Name, code, designation, department, CPR…"
                data-testid="employee-lookup-search"
                className="mt-1 h-10"
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setHighlight((h) => Math.min(h + 1, Math.max(pickable.length - 1, 0)));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setHighlight((h) => Math.max(h - 1, 0));
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    const row = pickable[highlight];
                    if (row) pick(row.id);
                  }
                }}
              />
            </label>
            <label className="block text-sm font-semibold">
              Department
              <Select
                value={dept}
                data-testid="employee-lookup-department"
                className="mt-1 h-10 w-52"
                onChange={(e) => setDept(e.target.value)}
              >
                <option value="">All departments</option>
                {departments.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </Select>
            </label>
          </div>

          <p className="text-xs font-semibold text-[var(--color-muted-foreground)]">
            {pickable.length} employee{pickable.length === 1 ? "" : "s"}
            {blocked.size ? ` · ${blocked.size} already on this voucher hidden` : ""}
          </p>

          <div className="min-h-0 flex-1 overflow-auto rounded-[var(--radius-md)] border border-[var(--color-border)]">
            <Table className="table-fixed">
              <THead>
                <TR>
                  <TH className="w-14">SNo</TH>
                  <TH className="w-[14%]">Code</TH>
                  <TH className="w-[28%]">Name</TH>
                  <TH className="w-[20%]">Designation</TH>
                  <TH className="w-[20%]">Department</TH>
                  <TH className="w-[12%]">Grade</TH>
                </TR>
              </THead>
              <TBody>
                {pickable.length === 0 ? (
                  <TR>
                    <TD colSpan={6} className="py-10 text-center text-sm text-[var(--color-muted-foreground)]">
                      No employees match.
                    </TD>
                  </TR>
                ) : (
                  pickable.map((e, index) => (
                    <TR
                      key={e.id}
                      data-testid={`employee-lookup-row-${e.id}`}
                      className={cn(
                        "cursor-pointer",
                        index === highlight && "bg-[var(--brand-50)]",
                        e.id === value && "font-semibold"
                      )}
                      onMouseEnter={() => setHighlight(index)}
                      onClick={() => pick(e.id)}
                      onDoubleClick={() => pick(e.id)}
                    >
                      <TD className="text-xs text-[var(--color-muted-foreground)]">{index + 1}</TD>
                      <TD className="font-mono font-semibold">{e.code}</TD>
                      <TD>
                        {e.full_name}
                        {e.arabic_name ? (
                          <span className="mt-0.5 block text-[11px] font-normal text-[var(--color-muted-foreground)]">
                            {e.arabic_name}
                          </span>
                        ) : null}
                      </TD>
                      <TD>{e.designation || "—"}</TD>
                      <TD>{e.department || "—"}</TD>
                      <TD>{e.grade || "—"}</TD>
                    </TR>
                  ))
                )}
              </TBody>
            </Table>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
