"use client";

import { Search, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import {
  AIRPORT_CATALOG_STATS,
  airportLabel,
  countryFlagHint,
  findAirport,
  searchAirportsGrouped,
  type AirportRecord,
} from "@/lib/airports";
import { cn } from "@/lib/utils";

interface AirportComboboxProps {
  value: string;
  onChange: (code: string) => void;
  placeholder?: string;
  disabled?: boolean;
  "data-testid"?: string;
  className?: string;
}

export function AirportCombobox({
  value,
  onChange,
  placeholder = "Search city or IATA code…",
  disabled,
  className,
  "data-testid": testId,
}: AirportComboboxProps) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);

  const selected = findAirport(value);
  const groups = useMemo(
    () => searchAirportsGrouped(open ? query : query || "", 50),
    [query, open]
  );
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

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

  const pick = (a: AirportRecord) => {
    onChange(a.code);
    setOpen(false);
    setQuery("");
  };

  const clear = () => {
    onChange("");
    setQuery("");
    setOpen(true);
  };

  const display = open ? query : selected ? `${selected.code} — ${selected.city}` : value;

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
            const raw = e.target.value;
            setQuery(raw);
            setOpen(true);
            setHighlight(0);
            const upper = raw.trim().toUpperCase();
            if (/^[A-Z]{3}$/.test(upper)) onChange(upper);
            else if (!raw.trim()) onChange("");
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
              setHighlight((h) => Math.min(h + 1, Math.max(0, flat.length - 1)));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHighlight((h) => Math.max(h - 1, 0));
            } else if (e.key === "Enter" && flat[highlight]) {
              e.preventDefault();
              pick(flat[highlight]);
            }
          }}
        />
        {value ? (
          <button
            type="button"
            aria-label="Clear airport"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-[var(--color-muted-foreground)] hover:bg-[var(--color-secondary)]"
            onClick={clear}
          >
            <X size={14} />
          </button>
        ) : null}
      </div>

      {open ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-40 mt-1 max-h-64 w-full overflow-auto rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white py-1 shadow-lg"
        >
          {flat.length === 0 ? (
            <li className="px-3 py-2 text-xs text-[var(--color-muted-foreground)]">
              No airports match. Try a city (Kochi, London) or IATA (COK, LHR).
            </li>
          ) : (
            groups.map((group) => (
              <li key={group.id} className="list-none">
                <div className="sticky top-0 z-10 bg-[var(--color-secondary)] px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
                  {group.label}
                </div>
                <ul>
                  {group.items.map((a) => {
                    const idx = flat.indexOf(a);
                    return (
                      <li key={`${group.id}-${a.code}`}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={a.code === value}
                          className={cn(
                            "flex w-full items-start gap-2 px-3 py-1.5 text-left text-sm hover:bg-[var(--color-secondary)]",
                            idx === highlight && "bg-[var(--color-secondary)]"
                          )}
                          onMouseEnter={() => setHighlight(idx)}
                          onClick={() => pick(a)}
                        >
                          <span className="w-10 shrink-0 font-mono font-semibold">{a.code}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">{a.city}</span>
                            <span className="block truncate text-[11px] text-[var(--color-muted-foreground)]">
                              {a.name} · {countryFlagHint(a.country)}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))
          )}
          <li className="border-t border-[var(--color-border)] px-3 py-1.5 text-[10px] text-[var(--color-muted-foreground)]">
            {AIRPORT_CATALOG_STATS.total.toLocaleString()} world IATA airports · India{" "}
            {AIRPORT_CATALOG_STATS.india} · Pakistan {AIRPORT_CATALOG_STATS.pakistan} first ·
            OurAirports
          </li>
        </ul>
      ) : null}

      {!open && selected ? (
        <p className="mt-1 truncate text-[11px] text-[var(--color-muted-foreground)]">
          {airportLabel(selected)} · {countryFlagHint(selected.country)}
        </p>
      ) : null}
    </div>
  );
}
