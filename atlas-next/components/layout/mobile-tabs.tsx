"use client";

import { MoreHorizontal } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BadgePill, isActivePath, type NavEntry } from "@/components/layout/sidebar-nav";
import type { NavBadges } from "@/lib/nav-badges";
import { appPath } from "@/lib/paths";
import { cn } from "@/lib/utils";

/** Four destinations, then fallbacks. Empty slots are omitted rather than shown dead. */
export const MOBILE_TAB_HREFS = ["/dashboard", "/allocation", "/employees", "/ess"] as const;
const FALLBACK_HREFS = ["/loans", "/finance", "/reports", "/time-tracking", "/settings"];

/** Short labels that fit a 64px tab in English and Arabic. Full names stay in the sidebar. */
export const TAB_LABEL_KEY: Record<string, string> = {
  "/dashboard": "nav.tab.home",
  "/allocation": "nav.tab.tickets",
  "/employees": "nav.tab.people",
  "/ess": "nav.tab.inbox",
  "/loans": "nav.tab.loans",
  "/finance": "nav.tab.finance",
  "/reports": "nav.tab.reports",
  "/time-tracking": "nav.tab.time",
  "/settings": "nav.tab.settings",
};

export function pickMobileTabs(byHref: Map<string, NavEntry>): NavEntry[] {
  const out: NavEntry[] = [];
  const take = (href: string) => {
    if (out.length >= 4) return;
    const entry = byHref.get(href);
    if (entry && !out.some((item) => item.href === entry.href)) out.push(entry);
  };
  for (const href of MOBILE_TAB_HREFS) take(href);
  for (const href of FALLBACK_HREFS) take(href);
  return out;
}

export function MobileTabBar({
  tabs,
  labelFor,
  moreLabel,
  moreOpen,
  onMore,
  badges,
}: {
  tabs: NavEntry[];
  labelFor: (entry: NavEntry) => string;
  moreLabel: string;
  moreOpen: boolean;
  onMore: () => void;
  badges: NavBadges;
}) {
  const pathname = usePathname();
  if (moreOpen) return null;
  const count = tabs.length + 1;
  const activeIndex = tabs.findIndex((entry) => isActivePath(pathname, entry.href));
  return (
    <nav
      data-testid="mobile-tabs"
      aria-label={moreLabel}
      className="surface-bar fixed inset-x-0 bottom-0 z-40 flex border-t border-[var(--color-border)] no-print lg:hidden"
      style={{
        height: "calc(3.5rem + env(safe-area-inset-bottom))",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      {activeIndex >= 0 ? (
        <span
          aria-hidden="true"
          data-testid="mobile-tab-indicator"
          className="pointer-events-none absolute top-1.5 h-1 w-8 rounded-full bg-[var(--color-primary)] motion-safe:transition-[inset-inline-start] motion-safe:duration-200 motion-safe:ease-out"
          style={{
            insetInlineStart: `calc((100% / ${count}) * ${activeIndex} + (100% / ${count} - 2rem) / 2)`,
          }}
        />
      ) : null}
      {tabs.map((entry) => {
        const active = isActivePath(pathname, entry.href);
        const Icon = entry.icon;
        const badge = badges[entry.href];
        return (
          <Link
            key={entry.href}
            href={appPath(entry.href)}
            data-testid={`mobile-tab-${entry.testId}`}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 text-[11px] font-medium leading-[14px] motion-safe:active:scale-[0.97]",
              active ? "font-semibold text-[var(--color-primary)]" : "text-[var(--color-muted-foreground)]"
            )}
          >
            <span className="relative grid h-6 w-6 place-items-center">
              <Icon size={24} strokeWidth={active ? 2.4 : 1.75} aria-hidden="true" />
              {badge && badge.count > 0 ? (
                <BadgePill badge={badge} variant="bubble" testId={`badge-mobile-${entry.testId}`} />
              ) : null}
            </span>
            <span className="max-w-full truncate">{labelFor(entry)}</span>
          </Link>
        );
      })}
      <button
        type="button"
        data-testid="mobile-tab-more"
        aria-expanded={moreOpen}
        aria-controls="nav-main"
        onClick={onMore}
        className="flex min-h-11 min-w-0 flex-1 cursor-pointer flex-col items-center justify-center gap-1 px-1 text-[11px] font-medium leading-[14px] text-[var(--color-muted-foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)] motion-safe:active:scale-[0.97]"
      >
        <MoreHorizontal size={24} strokeWidth={1.75} aria-hidden="true" />
        <span className="max-w-full truncate">{moreLabel}</span>
      </button>
    </nav>
  );
}
