"use client";

import { ChevronDown, Search, Star, X, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { forwardRef, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { formatBadgeCount, type BadgeTone, type NavBadge } from "@/lib/nav-badges";
import { appPath } from "@/lib/paths";
import { cn } from "@/lib/utils";

export type NavTone = "sky" | "mint" | "amber" | "rose" | "violet" | "teal" | "slate";

export interface NavEntry {
  href: string;
  labelKey: string;
  icon: LucideIcon;
  testId: string;
  tone: NavTone;
  keywords?: string;
}

const TONE_TILE: Record<NavTone, { rest: string; active: string }> = {
  sky: {
    rest: "bg-[var(--color-nav-sky)]/15 text-[var(--color-nav-sky)] group-hover:bg-[var(--color-nav-sky)]/25",
    active: "bg-[var(--color-nav-sky)] text-[var(--color-sidebar)]",
  },
  mint: {
    rest: "bg-[var(--color-nav-mint)]/15 text-[var(--color-nav-mint)] group-hover:bg-[var(--color-nav-mint)]/25",
    active: "bg-[var(--color-nav-mint)] text-[var(--color-sidebar)]",
  },
  amber: {
    rest: "bg-[var(--color-nav-amber)]/15 text-[var(--color-nav-amber)] group-hover:bg-[var(--color-nav-amber)]/25",
    active: "bg-[var(--color-nav-amber)] text-[var(--color-sidebar)]",
  },
  rose: {
    rest: "bg-[var(--color-nav-rose)]/15 text-[var(--color-nav-rose)] group-hover:bg-[var(--color-nav-rose)]/25",
    active: "bg-[var(--color-nav-rose)] text-[var(--color-sidebar)]",
  },
  violet: {
    rest: "bg-[var(--color-nav-violet)]/15 text-[var(--color-nav-violet)] group-hover:bg-[var(--color-nav-violet)]/25",
    active: "bg-[var(--color-nav-violet)] text-[var(--color-sidebar)]",
  },
  teal: {
    rest: "bg-[var(--color-nav-teal)]/15 text-[var(--color-nav-teal)] group-hover:bg-[var(--color-nav-teal)]/25",
    active: "bg-[var(--color-nav-teal)] text-[var(--color-sidebar)]",
  },
  slate: {
    rest: "bg-[var(--color-sidebar-foreground)]/10 text-[var(--color-sidebar-foreground)] group-hover:bg-[var(--color-sidebar-foreground)]/20",
    active: "bg-[var(--color-sidebar-foreground)] text-[var(--color-sidebar)]",
  },
};

const BADGE_TONE: Record<BadgeTone, string> = {
  danger: "bg-[var(--color-destructive)] text-[var(--color-destructive-foreground)]",
  warning: "bg-[var(--color-warning)] text-[var(--color-warning-foreground)]",
  info: "bg-[var(--color-info)] text-[var(--color-info-foreground)]",
};

/** Visual count only; callers put the spoken hint in the accessible name. */
export function BadgePill({
  badge,
  variant = "inline",
  testId,
  className,
}: {
  badge: NavBadge;
  variant?: "inline" | "bubble";
  testId?: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      data-testid={testId}
      data-badge-tone={badge.tone}
      data-badge-count={badge.count}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-bold tabular-nums leading-none shadow-sm",
        variant === "bubble"
          ? "absolute -end-1.5 -top-1.5 h-[18px] min-w-[18px] px-1 text-[10px] ring-2 ring-[var(--color-sidebar)]"
          : "h-5 min-w-5 px-1.5 text-[11px]",
        BADGE_TONE[badge.tone],
        className
      )}
    >
      {formatBadgeCount(badge.count)}
    </span>
  );
}

export function isActivePath(pathname: string, href: string) {
  const target = appPath(href);
  return (
    pathname === target ||
    pathname === href ||
    (target !== "/" && (pathname.startsWith(target) || pathname.startsWith(`${href}/`)))
  );
}

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** 0 = no match; higher = better (label prefix > label word prefix > anywhere/keyword). */
export function matchScore(label: string, entry: NavEntry, query: string): number {
  const q = fold(query.trim());
  if (!q) return 0;
  const name = fold(label);
  const haystack = `${name} ${fold(entry.keywords ?? "")} ${entry.href.replace(/[/-]/g, " ")}`;
  if (!q.split(/\s+/).every((token) => haystack.includes(token))) return 0;
  if (name.startsWith(q)) return 3;
  if (name.split(/[\s&:/-]+/).some((word) => word.startsWith(q))) return 2;
  return 1;
}

function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim().toLowerCase();
  const at = q ? text.toLowerCase().indexOf(q) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded-sm bg-[var(--color-sidebar-indicator)]/30 text-[var(--color-sidebar-active)]">
        {text.slice(at, at + q.length)}
      </mark>
      {text.slice(at + q.length)}
    </>
  );
}

export function NavItem({
  entry,
  label,
  rail = false,
  query = "",
  highlighted = false,
  pinned = false,
  idPrefix = "",
  onTogglePin,
  pinLabel,
  badge,
  badgeHint,
}: {
  entry: NavEntry;
  label: string;
  rail?: boolean;
  query?: string;
  highlighted?: boolean;
  pinned?: boolean;
  idPrefix?: string;
  onTogglePin?: () => void;
  pinLabel?: string;
  badge?: NavBadge;
  badgeHint?: string;
}) {
  const pathname = usePathname();
  const active = isActivePath(pathname, entry.href);
  const ref = useRef<HTMLAnchorElement>(null);
  const [tip, setTip] = useState<{ top: number; x: number; rtl: boolean } | null>(null);
  const Icon = entry.icon;
  const counted = badge && badge.count > 0 ? badge : undefined;
  const spoken = counted ? `${counted.count} ${badgeHint ?? ""}`.trim() : "";
  const badgeTestId = `badge-${idPrefix}${entry.testId}`;

  useEffect(() => {
    if (active && !idPrefix) ref.current?.scrollIntoView({ block: "nearest" });
  }, [active, idPrefix]);
  useEffect(() => {
    if (highlighted) ref.current?.scrollIntoView({ block: "nearest" });
  }, [highlighted]);

  const showTip = () => {
    if (!rail || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const edge = ref.current.closest("aside")?.getBoundingClientRect() ?? r;
    const rtl = document.documentElement.dir === "rtl";
    setTip({ top: r.top + r.height / 2, x: rtl ? edge.left - 8 : edge.right + 8, rtl });
  };

  return (
    <div className="group/row relative">
      <Link
        ref={ref}
        id={`nav-opt-${idPrefix}${entry.testId}`}
        href={appPath(entry.href)}
        data-testid={`${idPrefix}${entry.testId}`}
        data-nav-href={entry.href}
        aria-current={active ? "page" : undefined}
        aria-label={rail ? (spoken ? `${label}, ${spoken}` : label) : undefined}
        title={rail ? undefined : spoken ? `${label} · ${spoken}` : label}
        onMouseEnter={showTip}
        onMouseLeave={() => setTip(null)}
        onFocus={showTip}
        onBlur={() => setTip(null)}
        className={cn(
          "group relative flex min-h-11 items-center gap-3 rounded-[var(--radius-md)] py-1.5 text-sm transition-colors",
          rail ? "justify-center px-0" : "pe-8 ps-2",
          active
            ? "nav-active-row bg-[var(--color-sidebar-active-bg)] font-semibold text-[var(--color-sidebar-active)] shadow-sm"
            : "font-medium text-[var(--color-sidebar-foreground)] hover:bg-[var(--color-sidebar-accent)] hover:text-[var(--color-sidebar-active)]",
          highlighted && "ring-2 ring-inset ring-[var(--color-sidebar-indicator)]"
        )}
      >
        {active ? (
          <span
            aria-hidden="true"
            data-nav-indicator=""
            className="nav-indicator absolute inset-y-1.5 -start-3 w-1 rounded-e-full bg-[var(--color-sidebar-indicator)]"
          />
        ) : null}
        <span
          aria-hidden="true"
          className={cn(
            "relative flex shrink-0 items-center justify-center rounded-[var(--radius-sm)] transition-[background-color,color,transform] duration-200 group-hover:scale-110",
            rail ? "h-8 w-8" : "h-6 w-6",
            active ? TONE_TILE[entry.tone].active : TONE_TILE[entry.tone].rest
          )}
        >
          <Icon size={20} strokeWidth={2.1} />
          {rail && counted ? <BadgePill badge={counted} variant="bubble" testId={badgeTestId} /> : null}
        </span>
        {rail ? null : (
          <span className="min-w-0 flex-1 truncate">
            <Highlight text={label} query={query} />
          </span>
        )}
        {!rail && counted ? <BadgePill badge={counted} testId={badgeTestId} /> : null}
        {!rail && spoken ? <span className="sr-only">, {spoken}</span> : null}
      </Link>
      {!rail && onTogglePin ? (
        <button
          type="button"
          onClick={onTogglePin}
          aria-label={`${pinLabel}: ${label}`}
          aria-pressed={pinned}
          title={pinLabel}
          data-testid={`pin-${idPrefix}${entry.testId}`}
          className={cn(
            "absolute end-1.5 top-1/2 -translate-y-1/2 rounded-[var(--radius-sm)] p-1 transition-opacity cursor-pointer",
            "hover:bg-[var(--color-sidebar-accent)] focus-visible:opacity-100 group-hover/row:opacity-100",
            pinned ? "text-[var(--color-sidebar-indicator)]" : "text-[var(--color-sidebar-foreground)]",
            active ? "opacity-70" : "opacity-0"
          )}
        >
          <Star size={14} aria-hidden="true" className={pinned ? "fill-current" : undefined} />
        </button>
      ) : null}
      {tip ? (
        <span
          role="tooltip"
          className="pointer-events-none fixed z-50 whitespace-nowrap rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-popover)] px-2.5 py-1 text-xs font-semibold text-[var(--color-popover-foreground)] shadow-[var(--shadow-pop)]"
          style={{ top: tip.top, left: tip.x, transform: `translate(${tip.rtl ? "-100%" : "0"}, -50%)` }}
        >
          {label}
          {spoken ? (
            <span className="block text-[11px] font-medium text-[var(--color-muted-foreground)]">{spoken}</span>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

export function NavSection({
  id,
  label,
  rail,
  open,
  onToggle,
  testId,
  badge,
  badgeHint,
  icon: SectionIcon,
  count,
  children,
}: {
  id: string;
  label: string;
  rail: boolean;
  open: boolean;
  onToggle?: () => void;
  testId?: string;
  badge?: NavBadge;
  badgeHint?: string;
  icon?: LucideIcon;
  count?: number;
  children: ReactNode;
}) {
  const showBadge = !open && badge && badge.count > 0 ? badge : undefined;
  if (rail) {
    return (
      <div className="mt-2 border-t border-[var(--color-sidebar-border)] pt-2 first:mt-1 first:border-t-0 first:pt-0">
        <div className="space-y-1" data-testid={testId} aria-label={label} role="group">
          {children}
        </div>
      </div>
    );
  }
  return (
    <div className="pt-3 first:pt-1">
      <button
        type="button"
        onClick={onToggle}
        disabled={!onToggle}
        aria-expanded={open}
        data-testid={`nav-section-${id}`}
        className="group/section flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 pb-1.5 pt-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--color-sidebar-label)] transition-colors enabled:hover:text-[var(--color-sidebar-active)] enabled:cursor-pointer"
      >
        {SectionIcon ? <SectionIcon size={12} aria-hidden="true" className="shrink-0 opacity-80" /> : null}
        <span className="text-start">{label}</span>
        <span aria-hidden="true" className="nav-section-rule h-px flex-1 opacity-70" />
        {count && !showBadge ? (
          <span
            aria-hidden="true"
            className="rounded-full border border-[var(--color-sidebar-border)] px-1.5 text-[10px] font-semibold tracking-normal tabular-nums"
          >
            {count}
          </span>
        ) : null}
        {showBadge ? (
          <>
            <BadgePill
              badge={showBadge}
              testId={`badge-section-${id}`}
              className="h-4 min-w-4 px-1 text-[10px] tracking-normal"
            />
            <span className="sr-only">, {`${showBadge.count} ${badgeHint ?? ""}`.trim()}</span>
          </>
        ) : null}
        {onToggle ? (
          <ChevronDown
            size={13}
            aria-hidden="true"
            className={cn("transition-transform", open ? "" : "-rotate-90 rtl:rotate-90")}
          />
        ) : null}
      </button>
      {open ? (
        <div className="space-y-0.5" data-testid={testId}>
          {children}
        </div>
      ) : null}
    </div>
  );
}

export interface GlanceTile {
  href: string;
  label: string;
  value: string;
  hint: string;
  icon: LucideIcon;
  tone: NavTone;
  testId: string;
}

const TONE_TEXT: Record<NavTone, string> = {
  sky: "text-[var(--color-nav-sky)]",
  mint: "text-[var(--color-nav-mint)]",
  amber: "text-[var(--color-nav-amber)]",
  rose: "text-[var(--color-nav-rose)]",
  violet: "text-[var(--color-nav-violet)]",
  teal: "text-[var(--color-nav-teal)]",
  slate: "text-[var(--color-sidebar-foreground)]",
};

/** Compact live KPIs under the menu search; each tile opens the screen behind the number. */
export function SidebarGlance({
  label,
  tiles,
  open,
  onToggle,
}: {
  label: string;
  tiles: GlanceTile[];
  open: boolean;
  onToggle: () => void;
}) {
  if (!tiles.length) return null;
  return (
    <div className="px-3 pb-1" data-testid="nav-glance">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        data-testid="nav-section-glance"
        className="flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 pb-1.5 pt-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--color-sidebar-label)] transition-colors hover:text-[var(--color-sidebar-active)] cursor-pointer"
      >
        <span className="relative flex h-2 w-2 shrink-0" aria-hidden="true">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-sidebar-indicator)] opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--color-sidebar-indicator)]" />
        </span>
        <span className="text-start">{label}</span>
        <span aria-hidden="true" className="nav-section-rule h-px flex-1 opacity-70" />
        <ChevronDown
          size={13}
          aria-hidden="true"
          className={cn("transition-transform", open ? "" : "-rotate-90 rtl:rotate-90")}
        />
      </button>
      {open ? (
        <div className={cn("grid gap-1.5", tiles.length >= 3 ? "grid-cols-3" : "grid-cols-2")}>
          {tiles.map((tile) => {
            const Icon = tile.icon;
            return (
              <Link
                key={tile.testId}
                href={appPath(tile.href)}
                title={`${tile.label} · ${tile.hint}`}
                aria-label={`${tile.label}: ${tile.value}, ${tile.hint}`}
                data-testid={tile.testId}
                className="group flex flex-col items-start gap-0.5 rounded-[var(--radius-md)] border border-[var(--color-sidebar-border)] bg-[var(--color-sidebar-accent)] px-2 py-1.5 transition-[transform,border-color] duration-200 hover:-translate-y-0.5 hover:border-[var(--color-sidebar-indicator)]"
              >
                <Icon size={13} aria-hidden="true" className={TONE_TEXT[tile.tone]} />
                <span className="text-sm font-extrabold leading-tight tabular-nums text-[var(--color-sidebar-active)]">
                  {tile.value}
                </span>
                <span className="w-full truncate text-[10px] font-medium text-[var(--color-sidebar-foreground)]">
                  {tile.label}
                </span>
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export const SidebarSearch = forwardRef<
  HTMLInputElement,
  {
    value: string;
    onChange: (value: string) => void;
    onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
    onFocusChange: (focused: boolean) => void;
    placeholder: string;
    activeId?: string;
    shortcut: string;
  }
>(function SidebarSearch({ value, onChange, onKeyDown, onFocusChange, placeholder, activeId, shortcut }, ref) {
  return (
    <div className="relative px-3 pb-2">
      <Search
        size={15}
        aria-hidden="true"
        className="pointer-events-none absolute start-6 top-1/2 -translate-y-[calc(50%+4px)] text-[var(--color-sidebar-label)]"
      />
      <input
        ref={ref}
        type="text"
        role="combobox"
        aria-expanded={value.trim().length > 0}
        aria-controls="nav-main"
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        aria-label={placeholder}
        data-testid="nav-search"
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => onFocusChange(true)}
        onBlur={() => onFocusChange(false)}
        className="h-9 w-full rounded-[var(--radius-md)] border border-[var(--color-sidebar-border)] bg-[var(--color-sidebar-accent)] pe-14 ps-9 text-sm text-[var(--color-sidebar-active)] placeholder:text-[var(--color-sidebar-label)] outline-none transition-colors focus:border-[var(--color-sidebar-indicator)] focus-visible:outline-none"
      />
      {value ? (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onChange("")}
          aria-label="Clear search"
          data-testid="nav-search-clear"
          className="absolute end-5 top-1/2 -translate-y-[calc(50%+4px)] rounded-[var(--radius-sm)] p-1 text-[var(--color-sidebar-foreground)] hover:text-[var(--color-sidebar-active)] cursor-pointer"
        >
          <X size={14} aria-hidden="true" />
        </button>
      ) : (
        <kbd className="pointer-events-none absolute end-5 top-1/2 -translate-y-[calc(50%+4px)] rounded border border-[var(--color-sidebar-border)] px-1.5 font-sans text-[10px] font-semibold text-[var(--color-sidebar-label)]">
          {shortcut}
        </kbd>
      )}
    </div>
  );
});
