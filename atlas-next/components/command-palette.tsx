"use client";

import {
  ArrowRight,
  Building2,
  CornerDownLeft,
  FileText,
  HandCoins,
  Inbox,
  Loader2,
  Plane,
  Plus,
  Search,
  Settings2,
  Ticket as TicketIcon,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { matchScore, type NavEntry } from "@/components/layout/sidebar-nav";
import { fmtDate, money, titleCase } from "@/lib/format";
import { MIN_SEARCH, useGlobalSearch } from "@/lib/global-search";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface PaletteItem {
  id: string;
  group: string;
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  meta?: string;
  href: string;
  extras?: { label: string; href: string }[];
}

interface QuickAction {
  id: string;
  labelKey: string;
  keywords: string;
  icon: LucideIcon;
  href: string;
  requires: string;
}

const ACTIONS: QuickAction[] = [
  { id: "new-ticket", labelKey: "palette.action.newTicket", keywords: "issue ticket airfare allocate flight", icon: Plane, href: "/allocation", requires: "/allocation" },
  { id: "new-employee", labelKey: "palette.action.newEmployee", keywords: "add staff hire create employee", icon: UserPlus, href: "/employees?new=1", requires: "/employees" },
  { id: "new-request", labelKey: "palette.action.newRequest", keywords: "ess leave ticket request self service", icon: Inbox, href: "/ess/new", requires: "/ess" },
  { id: "loans", labelKey: "palette.action.loans", keywords: "loan payment recovery installment", icon: HandCoins, href: "/loans", requires: "/loans" },
  { id: "reports", labelKey: "palette.action.reports", keywords: "report export excel register", icon: FileText, href: "/reports", requires: "/reports" },
  { id: "fare-settings", labelKey: "palette.action.fareSettings", keywords: "fare check tolerance policy benchmark settings", icon: Settings2, href: "/settings", requires: "/settings" },
];

function fold(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export function CommandPalette({
  open,
  onClose,
  onNavigate,
  pages,
}: {
  open: boolean;
  onClose: () => void;
  onNavigate: (href: string) => void;
  pages: readonly NavEntry[];
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const search = useGlobalSearch(query, open);
  const term = query.trim();
  const visibleHrefs = useMemo(() => new Set(pages.map((p) => p.href)), [pages]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  const items = useMemo(() => {
    const list: PaletteItem[] = [];
    const q = fold(term);
    for (const action of ACTIONS) {
      if (!visibleHrefs.has(action.requires)) continue;
      const label = t(action.labelKey);
      if (q && !q.split(/\s+/).every((tok) => fold(`${label} ${action.keywords}`).includes(tok))) continue;
      list.push({ id: `action-${action.id}`, group: t("palette.actions"), icon: action.icon, title: label, href: action.href });
    }
    const data = term.length >= MIN_SEARCH ? search.data : undefined;
    for (const e of data?.employees ?? []) {
      list.push({
        id: `employee-${e.id}`,
        group: t("palette.employees"),
        icon: Users,
        title: e.name,
        subtitle: [e.code, e.designation, e.department].filter(Boolean).join(" · "),
        meta: e.active ? undefined : t("palette.inactive"),
        href: `/employees?edit=${encodeURIComponent(e.id)}`,
        extras: [
          ...(visibleHrefs.has("/allocation")
            ? [{ label: t("palette.extra.ticket"), href: `/allocation?employee=${encodeURIComponent(e.id)}` }]
            : []),
          ...(visibleHrefs.has("/ess")
            ? [{ label: t("palette.extra.request"), href: `/ess/new?employee=${encodeURIComponent(e.id)}` }]
            : []),
        ],
      });
    }
    for (const tk of data?.tickets ?? []) {
      list.push({
        id: `ticket-${tk.id}`,
        group: t("palette.tickets"),
        icon: TicketIcon,
        title: `${tk.code} · ${tk.route}`,
        subtitle: `${tk.employee_name} (${tk.employee_code}) · ${fmtDate(tk.travel_date)}`,
        meta: `${money(tk.cost)} · ${titleCase(tk.status)}`,
        href: `/allocation?ticket=${encodeURIComponent(tk.id)}`,
      });
    }
    for (const loan of data?.loans ?? []) {
      list.push({
        id: `loan-${loan.id}`,
        group: t("palette.loans"),
        icon: HandCoins,
        title: loan.code,
        subtitle: `${loan.employee_name} (${loan.employee_code})`,
        meta: `${money(loan.outstanding)} · ${titleCase(loan.status)}`,
        href: `/loans?q=${encodeURIComponent(loan.code)}`,
      });
    }
    for (const req of data?.ess ?? []) {
      list.push({
        id: `ess-${req.id}`,
        group: t("palette.requests"),
        icon: Inbox,
        title: `${req.employee_name} · ${titleCase(req.request_type)}`,
        subtitle: `${req.employee_code} · ${fmtDate(req.travel_date)}`,
        meta: titleCase(req.status),
        href: `/ess/edit?id=${encodeURIComponent(req.id)}`,
      });
    }
    if (term) {
      pages
        .map((p) => ({ entry: p, label: t(p.labelKey), score: matchScore(t(p.labelKey), p, term) }))
        .filter((p) => p.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .forEach(({ entry, label }) =>
          list.push({ id: `page-${entry.href}`, group: t("palette.pages"), icon: entry.icon, title: label, href: entry.href })
        );
    }
    return list;
  }, [term, search.data, pages, visibleHrefs, t]);

  const current = Math.min(active, Math.max(0, items.length - 1));

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${current}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [current]);

  if (!open) return null;

  const choose = (href: string) => {
    onClose();
    onNavigate(href);
  };

  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!items.length) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((current + step + items.length) % items.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const item = items[current];
      if (item) choose(item.href);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  };

  let lastGroup = "";
  const searching = term.length >= MIN_SEARCH && search.isFetching;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/40 p-4 pt-[12vh] no-print" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("palette.title")}
        data-testid="command-palette"
        className="w-full max-w-xl overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-4">
          <Search size={18} className="shrink-0 text-[var(--color-muted-foreground)]" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKey}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={items[current] ? `palette-${items[current].id}` : undefined}
            placeholder={t("palette.placeholder")}
            data-testid="palette-input"
            className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-[var(--color-muted-foreground)]"
          />
          {searching ? <Loader2 size={16} className="animate-spin text-[var(--color-muted-foreground)]" /> : null}
          <kbd className="rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[10px] text-[var(--color-muted-foreground)]">Esc</kbd>
        </div>
        <div id="palette-list" role="listbox" ref={listRef} className="max-h-[60vh] overflow-y-auto p-2">
          {items.map((item, index) => {
            const header = item.group !== lastGroup ? item.group : null;
            lastGroup = item.group;
            const Icon = item.icon;
            return (
              <div key={item.id}>
                {header ? (
                  <p className="px-2 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wide text-[var(--color-muted-foreground)]">
                    {header}
                  </p>
                ) : null}
                <div
                  id={`palette-${item.id}`}
                  role="option"
                  aria-selected={index === current}
                  data-index={index}
                  data-testid={`palette-item-${item.id}`}
                  onMouseMove={() => index !== current && setActive(index)}
                  onClick={() => choose(item.href)}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-[var(--radius-sm)] px-2 py-2",
                    index === current ? "bg-[var(--color-primary-muted)]" : "hover:bg-[var(--color-muted)]"
                  )}
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-muted)] text-[var(--color-primary)]">
                    <Icon size={16} aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{item.title}</span>
                    {item.subtitle ? (
                      <span className="block truncate text-xs text-[var(--color-muted-foreground)]">{item.subtitle}</span>
                    ) : null}
                  </span>
                  {item.extras?.map((extra) => (
                    <button
                      key={extra.href}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        choose(extra.href);
                      }}
                      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[var(--color-border)] bg-[var(--color-card)] px-2 py-0.5 text-[11px] font-semibold text-[var(--color-primary)] hover:bg-[var(--color-primary-muted)] cursor-pointer"
                    >
                      <Plus size={11} aria-hidden="true" /> {extra.label}
                    </button>
                  ))}
                  {item.meta ? (
                    <span className="shrink-0 text-[11px] text-[var(--color-muted-foreground)]">{item.meta}</span>
                  ) : null}
                  {index === current ? (
                    <CornerDownLeft size={14} className="shrink-0 text-[var(--color-muted-foreground)]" aria-hidden="true" />
                  ) : (
                    <ArrowRight size={14} className="shrink-0 text-transparent" aria-hidden="true" />
                  )}
                </div>
              </div>
            );
          })}
          {items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-sm text-[var(--color-muted-foreground)]" data-testid="palette-empty">
              <Building2 size={20} aria-hidden="true" />
              {term.length < MIN_SEARCH ? t("palette.hint") : search.isFetching ? t("state.loading") : t("palette.empty")}
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-[var(--color-border)] px-4 py-2 text-[11px] text-[var(--color-muted-foreground)]">
          <span>↑↓ {t("palette.footer.move")}</span>
          <span>↵ {t("palette.footer.open")}</span>
          <span>/ {t("palette.footer.menu")}</span>
          <span className="ms-auto">{t("palette.footer.tip")}</span>
        </div>
      </div>
    </div>
  );
}
