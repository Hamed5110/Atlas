"use client";

import {
  BadgeDollarSign,
  BarChart3,
  BookOpen,
  Command,
  DatabaseBackup,
  FileSignature,
  FileText,
  HandCoins,
  KeyRound,
  Landmark,
  LayoutDashboard,
  LifeBuoy,
  ListTree,
  LogOut,
  Menu,
  MessageCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Plane,
  Scale,
  ScrollText,
  Search,
  ShieldCheck,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  UserCog,
  Users,
  Inbox,
  X,
  Clock,
  Wallet,
  FileWarning,
  History,
  LayoutGrid,
  PlaneTakeoff,
  Star,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useAuth, canManage, isAdmin } from "@/lib/auth";
import { api, ApiError } from "@/lib/api";
import { usePrimaryCompany } from "@/lib/branding";
import { initials } from "@/lib/format";
import { BADGE_HINT_KEY, sumBadges, useNavBadges } from "@/lib/nav-badges";
import { useNavPrefs } from "@/lib/nav-prefs";
import { appPath } from "@/lib/paths";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ThemePicker } from "@/components/theme-picker";
import { CommandPalette } from "@/components/command-palette";
import {
  BadgePill,
  NavItem,
  NavSection,
  SidebarGlance,
  SidebarSearch,
  isActivePath,
  matchScore,
  type GlanceTile,
  type NavEntry,
} from "@/components/layout/sidebar-nav";
import { MobileTabBar, TAB_LABEL_KEY, pickMobileTabs } from "@/components/layout/mobile-tabs";
import { useDashboardInsights } from "@/lib/dashboard-insights";
import type { DashboardInsights } from "@/lib/types";
import { useT } from "@/lib/i18n";

/** Kept for layout tests — every page is full-bleed now (no 1400px reading column). */
const FULL_WIDTH_PATHS = ["/commissions", "/ess"];

// tone = meaning-coded icon color: money mint, people violet, time/caution amber,
// alerts rose, travel teal, general sky, system slate. keywords = English synonyms for menu search.
const NAV = [
  { href: "/dashboard", labelKey: "nav.dashboard", icon: LayoutDashboard, testId: "nav-dashboard", tone: "sky", keywords: "home overview kpi summary" },
  { href: "/allocation", labelKey: "nav.allocation", icon: Plane, testId: "nav-airfare-allocation", tone: "teal", keywords: "tickets flights travel booking issue airfare" },
  { href: "/allocation/whatsapp", labelKey: "nav.allocationWhatsapp", icon: MessageCircle, testId: "nav-allocation-whatsapp", tone: "teal", keywords: "whatsapp allocation message pdf pack approval send" },
  { href: "/employees", labelKey: "nav.employees", icon: Users, testId: "nav-employee-master", tone: "violet", keywords: "staff people master profile workers" },
  { href: "/time-tracking", labelKey: "nav.timeTracking", icon: Clock, testId: "nav-time-tracking", tone: "amber", keywords: "attendance punches late absence shifts timesheet" },
  { href: "/opening-balances", labelKey: "nav.openingBalances", icon: Wallet, testId: "nav-opening-balances", tone: "mint", keywords: "carry forward balance" },
  { href: "/loans", labelKey: "nav.loans", icon: HandCoins, testId: "nav-loans", tone: "mint", keywords: "recovery advance deduction excess installment" },
  { href: "/commissions", labelKey: "nav.commissions", icon: BadgeDollarSign, testId: "nav-commissions", tone: "mint", keywords: "incentive sales bonus" },
  { href: "/finance", labelKey: "nav.finance", icon: Landmark, testId: "nav-finance-ledger", tone: "mint", keywords: "ledger accounting vouchers journal gl payable" },
  { href: "/ess", labelKey: "nav.ess", icon: Inbox, testId: "nav-ess", tone: "sky", keywords: "self service requests approvals leave" },
  { href: "/rates", labelKey: "nav.rates", icon: SlidersHorizontal, testId: "nav-rates", tone: "teal", keywords: "fares routes prices entitlement" },
  { href: "/reports", labelKey: "nav.reports", icon: BarChart3, testId: "nav-reports", tone: "sky", keywords: "analytics export excel pdf register" },
  { href: "/ai-insights", labelKey: "nav.aiInsights", icon: Sparkles, testId: "nav-ai-insights", tone: "sky", keywords: "assistant forecast chat" },
  { href: "/help", labelKey: "nav.help", icon: LifeBuoy, testId: "nav-help", tone: "sky", keywords: "guide support documentation faq" },
] as const;

const HR_NAV = [
  { href: "/offer-letters", labelKey: "nav.offerLetters", icon: FileText, testId: "nav-offer-letters", tone: "mint", keywords: "hiring recruitment job offer" },
  { href: "/contracts", labelKey: "nav.contracts", icon: FileSignature, testId: "nav-contracts", tone: "sky", keywords: "employment agreement" },
  { href: "/warning-letters", labelKey: "nav.warningLetters", icon: ScrollText, testId: "nav-warning-letters", tone: "rose", keywords: "discipline caution" },
  { href: "/salary-revisions", labelKey: "nav.salaryRevisions", icon: BadgeDollarSign, testId: "nav-salary-revisions", tone: "mint", keywords: "increment raise pay" },
  { href: "/experience-certificates", labelKey: "nav.experienceCerts", icon: BookOpen, testId: "nav-experience-certs", tone: "teal", keywords: "service certificate letter" },
  { href: "/relieving-certificates", labelKey: "nav.relievingCerts", icon: FileSignature, testId: "nav-relieving-certs", tone: "teal", keywords: "exit resignation clearance" },
  { href: "/disciplinary-notices", labelKey: "nav.disciplinaryNotices", icon: Scale, testId: "nav-disciplinary", tone: "rose", keywords: "discipline violation notice" },
  { href: "/promotion-notices", labelKey: "nav.promotionNotices", icon: Sparkles, testId: "nav-promotion", tone: "amber", keywords: "promotion designation upgrade" },
  { href: "/mistake-fines", labelKey: "nav.mistakeFines", icon: HandCoins, testId: "nav-mistake-fines", tone: "rose", keywords: "penalty fine deduction" },
  { href: "/hr-forms", labelKey: "nav.hrForms", icon: SlidersHorizontal, testId: "nav-hr-forms", tone: "violet", keywords: "templates form builder" },
] as const;

const ADMIN_NAV = [
  { href: "/settings", labelKey: "nav.settings", icon: Settings2, testId: "nav-settings", tone: "amber", keywords: "configuration preferences company" },
  { href: "/lookups", labelKey: "nav.lookups", icon: ListTree, testId: "nav-companies", tone: "amber", keywords: "companies departments master data" },
  { href: "/users", labelKey: "nav.users", icon: UserCog, testId: "nav-users", tone: "amber", keywords: "accounts logins access" },
  { href: "/roles", labelKey: "nav.roles", icon: ShieldCheck, testId: "nav-roles", tone: "amber", keywords: "permissions security" },
  { href: "/backups", labelKey: "nav.backups", icon: DatabaseBackup, testId: "nav-backups", tone: "teal", keywords: "restore database" },
  { href: "/audit", labelKey: "nav.audit", icon: ScrollText, testId: "nav-audit", tone: "amber", keywords: "log history trail changes" },
  {
    href: "/entitlement/reconcile",
    labelKey: "nav.reconcile",
    icon: Scale,
    testId: "nav-entitlement-reconcile",
    tone: "mint",
    keywords: "entitlement ledger reconcile",
  },
  {
    href: "/entitlement/accounts",
    labelKey: "nav.accounts",
    icon: BookOpen,
    testId: "nav-entitlement-accounts",
    tone: "mint",
    keywords: "entitlement ledger accounts",
  },
  {
    href: "/entitlement/rules",
    labelKey: "nav.rules",
    icon: ListTree,
    testId: "nav-entitlement-rules",
    tone: "mint",
    keywords: "entitlement rules legacy",
  },
] as const;

const ADMIN_ONLY = ["/users", "/roles", "/backups", "/audit"];

const SECTION_ICON = { operations: LayoutGrid, hr: FileText, admin: ShieldCheck } as const;

function glanceTiles(data: DashboardInsights | undefined, t: (key: string) => string): GlanceTile[] {
  if (!data) return [];
  const tiles: GlanceTile[] = [];
  const { attendance, people, airfare } = data;
  if (attendance?.latest.rate != null) {
    tiles.push({
      href: "/time-tracking",
      label: t("nav.glance.attendance"),
      value: `${Math.round(attendance.latest.rate)}%`,
      hint: `${attendance.latest.late} ${t("ins.late")} · ${attendance.latest.absent} ${t("ins.absent")}`,
      icon: Clock,
      tone: "amber",
      testId: "glance-attendance",
    });
  }
  if (people) {
    const { expired, due } = people.documents;
    tiles.push({
      href: "/employees",
      label: t("nav.glance.documents"),
      value: String(expired + due),
      hint: `${expired} ${t("ins.expired")} · ${due} ${t("ins.dueSoon")}`,
      icon: FileWarning,
      tone: "rose",
      testId: "glance-documents",
    });
  }
  if (airfare) {
    tiles.push({
      href: "/allocation",
      label: t("nav.glance.trips"),
      value: String(airfare.upcoming_count),
      hint: t("ins.next30"),
      icon: PlaneTakeoff,
      tone: "teal",
      testId: "glance-trips",
    });
  }
  if (people && tiles.length < 3) {
    tiles.push({
      href: "/employees",
      label: t("nav.glance.headcount"),
      value: String(people.active),
      hint: t("ins.headcountHint"),
      icon: Users,
      tone: "violet",
      testId: "glance-headcount",
    });
  }
  return tiles.slice(0, 3);
}

function useIsDesktop() {
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const update = () => setDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return desktop;
}

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

function ChangePasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (next.length < 12) {
      toast.warning("Password too short", t("password.hint"));
      return;
    }
    if (next !== confirm) {
      toast.warning("Passwords do not match");
      return;
    }
    setBusy(true);
    try {
      await api("/auth/change-password", {
        method: "POST",
        body: { current_password: current, new_password: next },
      });
      toast.success(t("password.submit"), "Use your new password next time you sign in.");
      setCurrent("");
      setNext("");
      setConfirm("");
      onClose();
    } catch (error) {
      toast.error(
        t("password.title"),
        error instanceof ApiError ? error.detail : "Unexpected error."
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("password.title")}
      description={t("password.description")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t("action.cancel")}
          </Button>
          <Button onClick={submit} disabled={busy || !current || !next || !confirm}>
            {busy ? "…" : t("password.submit")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t("password.current")}>
          <Input
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </Field>
        <Field label={t("password.next")} hint={t("password.hint")}>
          <Input
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </Field>
        <Field label={t("password.confirm")}>
          <Input
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </Field>
      </div>
    </Dialog>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { me, clear } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [highlight, setHighlight] = useState<number | null>(null);
  const [animate, setAnimate] = useState(false);
  const [shortcut, setShortcut] = useState("Ctrl K");
  const searchRef = useRef<HTMLInputElement>(null);
  const blurTimer = useRef<number | undefined>(undefined);
  const t = useT();
  const isDesktop = useIsDesktop();
  const prefs = useNavPrefs();
  const rail = prefs.rail && isDesktop;
  const userKey = me?.id ?? "anonymous";

  const { company, logo } = usePrimaryCompany();
  const companyName = company?.name ?? "";
  const hidden = new Set(me?.hidden_screens ?? []);
  const visible = <T extends { href: string }>(items: readonly T[]) =>
    items.filter((item) => !hidden.has(item.href));

  const sections: { id: string; label: string; testId?: string; items: readonly NavEntry[] }[] = [
    { id: "operations", label: t("nav.section.operations"), testId: "nav-operations", items: visible(NAV) },
    ...(canManage(me)
      ? [
          { id: "hr", label: t("nav.section.hr"), items: visible(HR_NAV) },
          {
            id: "admin",
            label: t("nav.section.admin"),
            items: visible(ADMIN_NAV).filter((item) => !ADMIN_ONLY.includes(item.href) || isAdmin(me)),
          },
        ]
      : []),
  ];
  const byHref = new Map(sections.flatMap((s) => s.items).map((e) => [e.href, e] as const));
  const pick = (hrefs: string[] | undefined) =>
    (hrefs ?? []).map((h) => byHref.get(h)).filter((e): e is NavEntry => Boolean(e));

  const badges = useNavBadges(Boolean(me), pathname);
  const badgeFor = (entry: NavEntry) => {
    const badge = badges[entry.href];
    return badge ? { badge, badgeHint: t(BADGE_HINT_KEY[badge.kind] ?? "badge.attention") } : {};
  };
  const menuBadge = sumBadges(badges, [...byHref.keys()]);
  const insights = useDashboardInsights(Boolean(me));
  const glance = glanceTiles(insights.data, t);

  const searching = query.trim().length > 0;
  const scored = sections.map((s) => ({
    ...s,
    items: searching ? s.items.filter((e) => matchScore(t(e.labelKey), e, query) > 0) : s.items,
  }));
  const results = scored.flatMap((s) => s.items);
  const pins = pick(prefs.pins[userKey]);
  const pinnedSet = new Set(pins.map((e) => e.href));
  const recents = pick(prefs.recent[userKey]).filter((e) => !isActivePath(pathname, e.href)).slice(0, 4);
  const showRecent = !rail && searchFocused && !searching && recents.length > 0;
  const options = searching ? results : showRecent ? recents : [];
  const optionPrefix = searching ? "" : "recent-";

  let bestIndex = 0;
  if (searching) {
    let bestScore = 0;
    results.forEach((e, i) => {
      const score = matchScore(t(e.labelKey), e, query);
      if (score > bestScore) [bestIndex, bestScore] = [i, score];
    });
  }
  const activeIndex = options.length ? Math.min(highlight ?? bestIndex, options.length - 1) : -1;
  const activeOption = activeIndex >= 0 && (searching || highlight !== null) ? options[activeIndex] : undefined;

  const logout = () => {
    clear();
    router.replace(appPath("/login"));
  };

  useEffect(() => {
    void useNavPrefs.persist.rehydrate();
    if (/Mac|iPhone|iPad/.test(navigator.platform)) setShortcut("⌘K");
    const timer = window.setTimeout(() => setAnimate(true), 300);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    setNavOpen(false);
    setQuery("");
    setHighlight(null);
    const entry = [...byHref.values()].find((e) => isActivePath(pathname, e.href));
    if (me && entry) useNavPrefs.getState().visit(me.id, entry.href);
  }, [pathname, me?.id]);

  useEffect(() => {
    if (!navOpen) return;
    document
      .querySelector('[data-testid="nav-main"] [aria-current="page"]')
      ?.scrollIntoView({ block: "center" });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setNavOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navOpen]);

  const openSearch = useCallback(() => {
    if (!isDesktop) setNavOpen(true);
    if (useNavPrefs.getState().rail) useNavPrefs.getState().setRail(false);
    requestAnimationFrame(() => requestAnimationFrame(() => searchRef.current?.focus()));
  }, [isDesktop]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey || isTyping(event.target)) return;
      if (event.key === "/") {
        event.preventDefault();
        openSearch();
      } else if (event.key === "[" && isDesktop) {
        event.preventDefault();
        const state = useNavPrefs.getState();
        state.setRail(!state.rail);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openSearch, isDesktop]);

  const go = (href: string) => {
    setQuery("");
    setHighlight(null);
    searchRef.current?.blur();
    router.push(appPath(href));
  };

  const onSearchKey = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!options.length) return;
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      const from = activeOption ? activeIndex : step === 1 ? -1 : 0;
      setHighlight((from + step + options.length) % options.length);
    } else if (event.key === "Enter") {
      const target = activeOption ?? (searching ? options[0] : undefined);
      if (target) {
        event.preventDefault();
        go(target.href);
      }
    } else if (event.key === "Escape") {
      event.stopPropagation();
      if (query) {
        setQuery("");
        setHighlight(null);
      } else {
        searchRef.current?.blur();
      }
    }
  };

  const togglePin = (href: string) => {
    if (!prefs.togglePin(userKey, href)) toast.warning(t("nav.pinLimit"));
  };

  return (
    <div className="flex min-h-screen min-w-0 overflow-x-hidden" data-testid="app-shell">
      {navOpen ? (
        <button
          type="button"
          aria-label="Close navigation"
          data-testid="nav-backdrop"
          className="fixed inset-0 z-30 bg-black/40 lg:hidden no-print"
          onClick={() => setNavOpen(false)}
        />
      ) : null}
      <aside
        className={cn(
          "gradient-sidebar fixed inset-y-0 start-0 z-40 flex-col no-print",
          rail ? "w-[76px]" : "w-64",
          animate && "transition-[width] duration-200 ease-out",
          navOpen ? "flex shadow-2xl" : "hidden lg:flex"
        )}
        data-testid="nav-sidebar"
        data-rail={rail ? "true" : "false"}
      >
        <button
          type="button"
          onClick={() => prefs.setRail(!prefs.rail)}
          aria-label={rail ? t("nav.expand") : t("nav.collapse")}
          aria-expanded={!rail}
          title={`${rail ? t("nav.expand") : t("nav.collapse")}  [`}
          data-testid="nav-rail-toggle"
          className="nav-rail-toggle gradient-hero group absolute -end-4 top-7 z-50 hidden h-8 w-8 cursor-pointer items-center justify-center rounded-full text-white shadow-lg ring-4 ring-[var(--color-background)] transition-[transform,box-shadow] duration-200 ease-out hover:shadow-xl focus-visible:outline-none focus-visible:ring-[var(--color-ring)] motion-safe:hover:scale-110 motion-safe:active:scale-95 lg:flex"
        >
          {rail ? (
            <PanelLeftOpen
              size={16}
              strokeWidth={2.25}
              aria-hidden="true"
              className="transition-transform duration-200 rtl:-scale-x-100 motion-safe:group-hover:translate-x-0.5 motion-safe:rtl:group-hover:-translate-x-0.5"
            />
          ) : (
            <PanelLeftClose
              size={16}
              strokeWidth={2.25}
              aria-hidden="true"
              className="transition-transform duration-200 rtl:-scale-x-100 motion-safe:group-hover:-translate-x-0.5 motion-safe:rtl:group-hover:translate-x-0.5"
            />
          )}
        </button>
        <div
          className={cn("flex items-center gap-3 pb-4 pt-5", rail ? "justify-center px-2" : "px-5")}
          data-testid="nav-brand"
        >
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logo}
              alt="Company logo"
              title={rail ? companyName || "ATLAS HCM" : undefined}
              className="h-10 w-10 shrink-0 rounded-[var(--radius-md)] bg-white object-contain shadow-lg"
            />
          ) : (
            <div className="gradient-hero flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] shadow-lg">
              <Plane size={20} className="text-white" />
            </div>
          )}
          {rail ? null : (
            <>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-extrabold tracking-tight text-[var(--color-sidebar-active)]">
                  {companyName || "ATLAS HCM"}
                </p>
                <p className="text-[11px] font-medium text-[var(--color-sidebar-foreground)]">
                  {t("brand.subtitle")}
                </p>
                <p
                  className="mt-0.5 text-[10px] font-semibold tracking-wide text-[var(--color-sidebar-foreground)] opacity-80"
                  data-testid="app-version"
                  title="ATLAS HCM application version"
                >
                  v{process.env.NEXT_PUBLIC_ATLAS_VERSION || "3.0.15"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setNavOpen(false)}
                aria-label="Close navigation"
                data-testid="nav-close"
                className="rounded-[var(--radius-sm)] p-2 text-[var(--color-sidebar-foreground)] transition-colors hover:bg-[var(--color-sidebar-accent)] hover:text-[var(--color-sidebar-active)] lg:hidden cursor-pointer"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </>
          )}
        </div>
        {rail ? (
          <div className="flex justify-center pb-2">
            <button
              type="button"
              onClick={openSearch}
              aria-label={t("nav.search")}
              title={`${t("nav.search")}  ${shortcut}`}
              data-testid="nav-search-rail"
              className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-sidebar-border)] bg-[var(--color-sidebar-accent)] text-[var(--color-sidebar-foreground)] transition-colors hover:text-[var(--color-sidebar-active)] cursor-pointer"
            >
              <Search size={16} aria-hidden="true" />
            </button>
          </div>
        ) : (
          <SidebarSearch
            ref={searchRef}
            value={query}
            onChange={(value) => {
              setQuery(value);
              setHighlight(null);
            }}
            onKeyDown={onSearchKey}
            onFocusChange={(focused) => {
              window.clearTimeout(blurTimer.current);
              // Hiding Recent on mousedown-blur would shift rows under the pointer before the click lands.
              if (focused) setSearchFocused(true);
              else blurTimer.current = window.setTimeout(() => setSearchFocused(false), 200);
            }}
            placeholder={t("nav.search")}
            activeId={activeOption ? `nav-opt-${optionPrefix}${activeOption.testId}` : undefined}
            shortcut="/"
          />
        )}
        {rail ? null : (
          <div className="px-3 pb-3">
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              data-testid="nav-palette-open"
              className="flex w-full items-center gap-2 rounded-[var(--radius-md)] border border-dashed border-[var(--color-sidebar-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-sidebar-foreground)] transition-colors hover:bg-[var(--color-sidebar-accent)] hover:text-[var(--color-sidebar-active)] cursor-pointer"
            >
              <Command size={13} aria-hidden="true" />
              <span className="flex-1 truncate text-start">{t("palette.open")}</span>
              <kbd className="rounded border border-[var(--color-sidebar-border)] px-1 text-[10px]">{shortcut}</kbd>
            </button>
          </div>
        )}
        {!rail && !searching ? (
          <SidebarGlance
            label={t("nav.glance")}
            tiles={glance}
            open={!prefs.collapsed.includes("glance")}
            onToggle={() => prefs.toggleSection("glance")}
          />
        ) : null}
        <nav
          id="nav-main"
          aria-label="Main navigation"
          className="flex-1 overflow-y-auto px-3 pb-3"
          data-testid="nav-main"
        >
          {showRecent ? (
            <div onMouseDown={(e) => e.preventDefault()}>
              <NavSection id="recent" label={t("nav.recent")} rail={false} open testId="nav-recent" icon={History}>
                {recents.map((entry) => (
                  <NavItem
                    key={entry.href}
                    entry={entry}
                    label={t(entry.labelKey)}
                    idPrefix="recent-"
                    highlighted={activeOption?.href === entry.href}
                    {...badgeFor(entry)}
                  />
                ))}
              </NavSection>
            </div>
          ) : null}
          {!searching && pins.length > 0 ? (
            <NavSection
              id="pinned"
              label={t("nav.pinned")}
              rail={rail}
              open={!prefs.collapsed.includes("pinned")}
              onToggle={() => prefs.toggleSection("pinned")}
              testId="nav-pinned"
              icon={Star}
              count={pins.length}
              badge={sumBadges(badges, pins.map((e) => e.href))}
              badgeHint={t("badge.attention")}
            >
              {pins.map((entry) => (
                <NavItem
                  key={entry.href}
                  entry={entry}
                  label={t(entry.labelKey)}
                  rail={rail}
                  idPrefix="pinned-"
                  pinned
                  onTogglePin={() => togglePin(entry.href)}
                  pinLabel={t("nav.unpin")}
                  {...badgeFor(entry)}
                />
              ))}
            </NavSection>
          ) : null}
          {scored.map((section) => {
            if (section.items.length === 0) return null;
            const hasActive = section.items.some((e) => isActivePath(pathname, e.href));
            return (
              <NavSection
                key={section.id}
                id={section.id}
                label={section.label}
                rail={rail}
                open={searching || hasActive || !prefs.collapsed.includes(section.id)}
                onToggle={searching ? undefined : () => prefs.toggleSection(section.id)}
                testId={section.testId}
                icon={SECTION_ICON[section.id as keyof typeof SECTION_ICON]}
                count={section.items.length}
                badge={sumBadges(badges, section.items.map((e) => e.href))}
                badgeHint={t("badge.attention")}
              >
                {section.items.map((entry) => (
                  <NavItem
                    key={entry.href}
                    entry={entry}
                    label={t(entry.labelKey)}
                    rail={rail}
                    query={query}
                    highlighted={searching && activeOption?.href === entry.href}
                    pinned={pinnedSet.has(entry.href)}
                    onTogglePin={() => togglePin(entry.href)}
                    pinLabel={pinnedSet.has(entry.href) ? t("nav.unpin") : t("nav.pin")}
                    {...badgeFor(entry)}
                  />
                ))}
              </NavSection>
            );
          })}
          {searching && results.length === 0 ? (
            <p data-testid="nav-search-empty" className="px-3 py-8 text-center text-sm text-[var(--color-sidebar-label)]">
              {t("nav.searchEmpty")}
            </p>
          ) : null}
          <p className="sr-only" aria-live="polite" data-testid="nav-search-count">
            {searching ? `${results.length} ${t("nav.pages")}` : ""}
          </p>
        </nav>
        <div
          className={cn(
            "border-t border-[var(--color-sidebar-border)]",
            rail ? "px-2 py-3" : "p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
          )}
          data-testid="nav-user-footer"
        >
          {rail ? (
            <div className="flex flex-col items-center gap-2">
              <div
                title={me?.display_name || me?.full_name || me?.username}
                className="gradient-hero flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ring-2 ring-[var(--color-sidebar-indicator)]/70"
              >
                {initials(me?.display_name || me?.full_name || me?.username || "?")}
              </div>
              <button
                onClick={logout}
                title={t("action.signOut")}
                aria-label={t("action.signOut")}
                data-testid="btn-sign-out"
                className="rounded-[var(--radius-sm)] p-2 text-[var(--color-sidebar-foreground)] transition-colors hover:bg-[var(--color-sidebar-accent)] hover:text-[var(--color-sidebar-active)] cursor-pointer"
              >
                <LogOut size={16} aria-hidden="true" />
              </button>
            </div>
          ) : (
            <>
              <div className="mb-3 flex items-center justify-center gap-2">
                <LanguageSwitcher tone="sidebar" className="border-[var(--color-sidebar-border)] bg-[var(--color-sidebar-accent)]" />
                <ThemePicker />
              </div>
              <div className="flex items-center gap-3">
                <div className="gradient-hero relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ring-2 ring-[var(--color-sidebar-indicator)]/70">
                  {initials(me?.display_name || me?.full_name || me?.username || "?")}
                  <span
                    aria-hidden="true"
                    className="absolute -bottom-0.5 -end-0.5 h-2.5 w-2.5 rounded-full bg-[var(--color-success)] ring-2 ring-[var(--color-sidebar)]"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-[var(--color-sidebar-active)]" data-testid="nav-user-name">
                    {me?.display_name || me?.full_name || me?.username}
                  </p>
                  <p className="truncate text-[11px] text-[var(--color-sidebar-foreground)]" data-testid="nav-user-roles">
                    {me?.roles.join(" · ")}
                  </p>
                </div>
                <button
                  onClick={() => setPasswordOpen(true)}
                  title={t("action.changePassword")}
                  aria-label={t("action.changePassword")}
                  data-testid="btn-change-password"
                  className="rounded-[var(--radius-sm)] p-2 text-[var(--color-sidebar-foreground)] transition-colors hover:bg-[var(--color-sidebar-accent)] hover:text-[var(--color-sidebar-active)] cursor-pointer"
                >
                  <KeyRound size={16} aria-hidden="true" />
                </button>
                <button
                  onClick={logout}
                  title={t("action.signOut")}
                  aria-label={t("action.signOut")}
                  data-testid="btn-sign-out"
                  className="rounded-[var(--radius-sm)] p-2 text-[var(--color-sidebar-foreground)] transition-colors hover:bg-[var(--color-sidebar-accent)] hover:text-[var(--color-sidebar-active)] cursor-pointer"
                >
                  <LogOut size={16} aria-hidden="true" />
                </button>
              </div>
            </>
          )}
        </div>
      </aside>
      <main
        className={cn(
          "min-h-screen min-w-0 flex-1 overflow-x-hidden",
          rail ? "lg:ms-[76px]" : "lg:ms-64",
          animate && "transition-[margin] duration-200 ease-out"
        )}
        data-testid="app-main"
      >
        <div className="surface-bar sticky top-0 z-20 flex items-center gap-3 border-b border-[var(--color-border)] px-[var(--page-pad-x)] pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] lg:hidden no-print">
          <button
            type="button"
            data-testid="nav-open"
            aria-expanded={navOpen}
            className="btn-standard inline-flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-card)] px-3 text-sm font-semibold text-[var(--color-primary)] transition-colors hover:bg-[var(--color-primary-muted)] cursor-pointer"
            onClick={() => setNavOpen(true)}
          >
            <Menu size={18} aria-hidden="true" />
            Menu
            {menuBadge ? (
              <>
                <BadgePill badge={menuBadge} testId="badge-menu" />
                <span className="sr-only">, {`${menuBadge.count} ${t("badge.attention")}`}</span>
              </>
            ) : null}
          </button>
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt="" className="h-7 w-7 rounded-[var(--radius-sm)] bg-white object-contain" />
          ) : null}
          <span className="min-w-0 flex-1 truncate text-sm font-bold">{companyName || "ATLAS HCM"}</span>
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            aria-label={t("palette.open")}
            data-testid="nav-search-mobile"
            className="ms-auto rounded-[var(--radius-sm)] p-2 text-[var(--color-muted-foreground)] transition-colors hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)] cursor-pointer"
          >
            <Search size={18} aria-hidden="true" />
          </button>
        </div>
        <div
          className={cn(
            "page-stack mx-auto w-full min-w-0 overflow-x-hidden pt-[var(--page-pad-y)] pb-[max(var(--page-pad-y),env(safe-area-inset-bottom))]",
            FULL_WIDTH_PATHS.some((p) => pathname === p || pathname.startsWith(appPath(p)))
              ? "max-w-none px-[var(--page-pad-x)]"
              : "max-w-[1400px] px-[var(--page-pad-x)]"
          )}
        >
          {children}
        </div>
      </main>
      <MobileTabBar
        tabs={pickMobileTabs(byHref)}
        labelFor={(entry) => t(TAB_LABEL_KEY[entry.href] ?? entry.labelKey)}
        moreLabel={t("nav.tab.more")}
        moreOpen={navOpen}
        onMore={() => setNavOpen(true)}
        badges={badges}
      />
      <ChangePasswordDialog open={passwordOpen} onClose={() => setPasswordOpen(false)} />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onNavigate={(href) => router.push(appPath(href))}
        pages={[...byHref.values()]}
      />
    </div>
  );
}
