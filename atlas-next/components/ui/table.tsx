"use client";

import { useLayoutEffect, useRef, type HTMLAttributes, type RefObject, type TdHTMLAttributes, type ThHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type TableProps = HTMLAttributes<HTMLTableElement> & {
  /** Pin the first column while the table scrolls horizontally. */
  stickyFirst?: boolean;
  /** Pin the first N identity columns (1–2). Overrides stickyFirst when > 0. */
  stickyCols?: 0 | 1 | 2;
  /** Alternate row wash for wide grids (CFPB: useful past ~5 columns). */
  zebra?: boolean;
  /** Tighter row padding so more of a statement fits on screen. */
  density?: "comfortable" | "compact";
  /** Cap height and sticky thead while the body scrolls. */
  sheetScroll?: boolean;
  /** When false, skip the overflow wrapper — parent already scrolls. */
  wrap?: boolean;
  /**
   * Record lists: below the `sm` breakpoint each row becomes a card with labelled values and its
   * actions in reach, instead of a table scrolled sideways. Leave off for grids people compare.
   */
  cards?: boolean;
};

/**
 * Tags cells for the phone card layout: `data-label` from the column header, and `data-cell`
 * select / title / actions / full. A `data-cell` written in the markup wins over the guess.
 */
export function labelTableCells(table: HTMLTableElement) {
  // Explicit roles: WebKit drops table semantics once rows are no longer display:table-row.
  table.setAttribute("role", "table");
  for (const section of [table.tHead, ...Array.from(table.tBodies)]) section?.setAttribute("role", "rowgroup");
  for (const row of Array.from(table.rows)) {
    row.setAttribute("role", "row");
    for (const cell of Array.from(row.cells)) cell.setAttribute("role", cell.tagName === "TH" ? "columnheader" : "cell");
  }
  const headRow = table.tHead?.rows[0];
  const labels: string[] = [];
  for (const th of Array.from(headRow?.cells ?? [])) {
    if (th.querySelector('input[type="checkbox"]') && !th.textContent?.trim()) th.dataset.cell ??= "select";
    for (let i = 0; i < th.colSpan; i++) labels.push(th.textContent?.trim() ?? "");
  }
  for (const body of Array.from(table.tBodies)) {
    for (const row of Array.from(body.rows)) {
      let col = 0;
      let titled = false;
      const cells = Array.from(row.cells);
      cells.forEach((cell, index) => {
        const label = labels[col] ?? "";
        if (cell.dataset.label !== label) cell.dataset.label = label;
        if (!cell.dataset.cell || cell.dataset.cellAuto) {
          let kind = "";
          const last = index === cells.length - 1;
          if (labels.length > 1 && cell.colSpan >= labels.length) kind = "full";
          else if (cell.querySelector('input[type="checkbox"]') && !cell.textContent?.trim()) kind = "select";
          else if (last && index > 0 && cell.querySelector("button, a[href]") && (!label || /action|إجراء/i.test(label))) kind = "actions";
          else if (!titled) kind = "title";
          if (kind === "title") titled = true;
          if (kind && cell.dataset.cell !== kind) {
            cell.dataset.cell = kind;
            cell.dataset.cellAuto = "1";
          } else if (!kind && cell.dataset.cellAuto) {
            delete cell.dataset.cell;
            delete cell.dataset.cellAuto;
          }
        } else if (cell.dataset.cell === "title") {
          titled = true;
        }
        col += cell.colSpan;
      });
    }
  }
}

/** Keeps `labelTableCells` current as rows render, sort and filter. */
export function useTableCards(ref: RefObject<HTMLTableElement | null>, enabled = true) {
  useLayoutEffect(() => {
    const table = ref.current;
    if (!enabled || !table) return;
    labelTableCells(table);
    const observer = new MutationObserver(() => labelTableCells(table));
    observer.observe(table, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [ref, enabled]);
}

export function Table({
  className,
  stickyFirst = false,
  stickyCols = 0,
  zebra = false,
  density = "comfortable",
  sheetScroll = false,
  wrap = true,
  cards = false,
  ...props
}: TableProps) {
  const ref = useRef<HTMLTableElement>(null);
  useTableCards(ref, cards);
  const pinned = stickyCols > 0 ? stickyCols : stickyFirst ? 1 : 0;
  const table = (
    <table
      ref={ref}
      className={cn(
        "w-full caption-bottom border-separate border-spacing-0 text-sm",
        pinned === 1 && "table-sticky-first",
        pinned === 2 && "table-sticky-2",
        zebra && "table-zebra",
        density === "compact" && "table-density-compact",
        sheetScroll && "table-header-clip",
        cards && "table-cards",
        className
      )}
      {...props}
    />
  );
  if (!wrap) return table;
  return (
    <div
      className={cn(
        "tt-table-scroll relative w-full min-w-0 max-w-full overflow-x-auto",
        sheetScroll && "table-sheet-scroll max-h-[min(70vh,52rem)] overflow-y-auto"
      )}
    >
      {table}
    </div>
  );
}

export function THead({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={cn("border-b border-[var(--color-border)] bg-[var(--neutral-50)]", className)}
      {...props}
    />
  );
}

export function TBody({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn("[&_tr:last-child]:border-0", className)} {...props} />;
}

export function TR({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn(
        "group border-b border-[var(--color-border)] transition-colors hover:bg-[var(--brand-50)]",
        className
      )}
      {...props}
    />
  );
}

export function TH({
  className,
  scope = "col",
  ...props
}: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope={scope}
      className={cn(
        "h-10 select-none border-b border-[var(--color-border)] px-3 text-left align-middle text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)] whitespace-nowrap",
        className
      )}
      {...props}
    />
  );
}

/** Visually hidden table name for screen readers (WCAG 1.3.1 / 4.1.2). */
export function TableCaption({
  className,
  ...props
}: HTMLAttributes<HTMLTableCaptionElement>) {
  return <caption className={cn("sr-only", className)} {...props} />;
}

export function TD({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={cn(
        "border-b border-[var(--color-border)]/70 px-3 py-2.5 align-middle text-[var(--color-foreground)]",
        className
      )}
      {...props}
    />
  );
}
