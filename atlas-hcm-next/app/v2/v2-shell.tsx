"use client";

import { Disclosure } from "@headlessui/react";
import {
  Bell,
  Building2,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  LayoutDashboard,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Sun,
  Users,
  WalletCards
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import V2AirfareModule from "./v2-airfare-module";
import V2EmployeesModule from "./v2-employees-module";
import V2OverviewModule from "./v2-overview-module";
import { clearSavedSession, restoreSavedSession } from "./v2-session";
import V2SignInModule from "./v2-sign-in-module";
import styles from "./v2-shell.module.css";

type ThemeId =
  | "light-professional"
  | "dark-professional"
  | "high-contrast"
  | "emerald-command"
  | "slate-executive";

type NavKey =
  | "overview"
  | "employees"
  | "airfare"
  | "reports"
  | "preferences"
  | "security";

type ThemeOption = {
  id: ThemeId;
  label: string;
  summary: string;
};

type NavItem = {
  key: NavKey;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
  eyebrow: string;
  title: string;
  detail: string;
};

const THEME_STORAGE_KEY = "atlas.v2.theme";

const themeOptions: ThemeOption[] = [
  {
    id: "light-professional",
    label: "Light Professional",
    summary: "Default enterprise day mode"
  },
  {
    id: "dark-professional",
    label: "Dark Professional",
    summary: "Low-glare premium workspace"
  },
  {
    id: "high-contrast",
    label: "High Contrast",
    summary: "Accessibility-first separation"
  },
  {
    id: "emerald-command",
    label: "Emerald Command",
    summary: "Operational branded admin mode"
  },
  {
    id: "slate-executive",
    label: "Slate Executive",
    summary: "Neutral executive review mode"
  }
];

const navItems: NavItem[] = [
  {
    key: "overview",
    label: "Overview",
    icon: LayoutDashboard,
    eyebrow: "Command center",
    title: "Executive shell preview",
    detail: "A stable shell for the rebuilt ATLAS workflow, with top-level actions, themes, and navigation separated from module content."
  },
  {
    key: "employees",
    label: "Employees",
    icon: Users,
    eyebrow: "Module staging",
    title: "Employee workspace lane",
    detail: "This area is reserved for the first module migrations once shell verification passes."
  },
  {
    key: "airfare",
    label: "Airfare",
    icon: WalletCards,
    eyebrow: "Travel operations",
    title: "Allocation workflow lane",
    detail: "Airfare allocation and self-service review will plug into this shell without changing backend contracts."
  },
  {
    key: "reports",
    label: "Reports",
    icon: CalendarClock,
    eyebrow: "Evidence surfaces",
    title: "Report and audit lane",
    detail: "Dense reporting screens will inherit the same spacing, breadcrumb, and theme logic from this shell."
  },
  {
    key: "preferences",
    label: "Preferences",
    icon: Settings,
    eyebrow: "Workspace settings",
    title: "Theme and policy lane",
    detail: "All five user-selectable themes remain available here, with Light Professional as the default."
  },
  {
    key: "security",
    label: "Security",
    icon: ShieldCheck,
    eyebrow: "Admin controls",
    title: "Identity and access lane",
    detail: "User management and security administration can be migrated into this shell without disturbing the original interface."
  }
];

const notificationItems = [
  {
    title: "Step 5 shell active",
    detail: "The new /v2 workspace is mounted in parallel to the legacy UI.",
    tone: "info"
  },
  {
    title: "Theme system retained",
    detail: "All five visual modes are exposed to users, with Light Professional as the startup default.",
    tone: "success"
  },
  {
    title: "Module migration pending",
    detail: "Business modules remain on the original UI until clickability verification passes.",
    tone: "warning"
  }
] as const;

function themeIcon(theme: ThemeId) {
  switch (theme) {
    case "dark-professional":
      return <Moon size={16} />;
    case "high-contrast":
      return <CheckCircle2 size={16} />;
    case "emerald-command":
      return <Sparkles size={16} />;
    case "slate-executive":
      return <Building2 size={16} />;
    default:
      return <Sun size={16} />;
  }
}

export default function V2Shell({ initialTheme }: { initialTheme?: ThemeId }) {
  const [activeTheme, setActiveTheme] = useState<ThemeId>(initialTheme || "light-professional");
  const [pendingTheme, setPendingTheme] = useState<ThemeId>(initialTheme || "light-professional");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeNav, setActiveNav] = useState<NavKey>("overview");
  const [searchText, setSearchText] = useState("");
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [themeSavedMessage, setThemeSavedMessage] = useState("Default theme is Light Professional.");
  const [hasSavedSession, setHasSavedSession] = useState(false);
  const themeSelectRef = useRef<HTMLSelectElement | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (initialTheme && themeOptions.some((theme) => theme.id === initialTheme)) {
      setActiveTheme(initialTheme);
      setPendingTheme(initialTheme);
      const selectedTheme = themeOptions.find((theme) => theme.id === initialTheme);
      setThemeSavedMessage(`${selectedTheme?.label || "Theme"} loaded for preview.`);
      window.localStorage.setItem(THEME_STORAGE_KEY, initialTheme);
      return;
    }
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY) as ThemeId | null;
    if (saved && themeOptions.some((theme) => theme.id === saved)) {
      setActiveTheme(saved);
      setPendingTheme(saved);
      const selectedTheme = themeOptions.find((theme) => theme.id === saved);
      setThemeSavedMessage(`${selectedTheme?.label || "Theme"} restored from your saved choice.`);
    } else {
      window.localStorage.setItem(THEME_STORAGE_KEY, "light-professional");
      setThemeSavedMessage("Light Professional is active by default until a user saves another theme.");
    }
  }, [initialTheme]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(THEME_STORAGE_KEY, activeTheme);
  }, [activeTheme]);

  useEffect(() => {
    setHasSavedSession(Boolean(restoreSavedSession()));
  }, []);

  function applyTheme(nextTheme?: ThemeId) {
    const resolvedTheme =
      (themeSelectRef.current?.value as ThemeId | undefined) || nextTheme || pendingTheme;
    setPendingTheme(resolvedTheme);
    setActiveTheme(resolvedTheme);
    const selectedTheme = themeOptions.find((theme) => theme.id === resolvedTheme);
    setThemeSavedMessage(`${selectedTheme?.label || "Theme"} saved for this browser.`);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(THEME_STORAGE_KEY, resolvedTheme);
    }
  }

  const activeThemeOption = useMemo(
    () => themeOptions.find((theme) => theme.id === activeTheme) || themeOptions[0],
    [activeTheme]
  );
  const activeNavItem = useMemo(
    () => navItems.find((item) => item.key === activeNav) || navItems[0],
    [activeNav]
  );
  const themeSelectionChanged = pendingTheme !== activeTheme;
  const overviewActive = activeNav === "overview";

  function handleSignedIn() {
    setHasSavedSession(true);
    setNotificationsOpen(false);
  }

  function handleSignOutPreview() {
    clearSavedSession();
    setHasSavedSession(false);
    setActiveNav("overview");
    setNotificationsOpen(false);
  }

  return (
    <main className={styles.viewport}>
      <section
        className={`${styles.shell} ${sidebarCollapsed ? styles.sidebarCollapsed : ""}`}
        data-theme={activeTheme}
      >
        <aside className={styles.sidebar}>
          <div className={styles.brandBlock}>
            <div className={styles.brandMark}>
              <WalletCards size={20} />
            </div>
            <div className={styles.brandCopy}>
              <strong>ATLAS Airfare HCM</strong>
              <span>V2 shell preview</span>
            </div>
            <button
              type="button"
              className={styles.sidebarToggle}
              onClick={() => setSidebarCollapsed((current) => !current)}
              aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            </button>
          </div>

          <Disclosure as="div" className={styles.mobileNav}>
            <Disclosure.Button className={styles.mobileNavButton}>
              <span>Navigation</span>
              <ChevronDown size={16} />
            </Disclosure.Button>
            <Disclosure.Panel className={styles.mobileNavPanel}>
              <nav className={styles.navGrid}>
                {navItems.map((item) => {
                  const Icon = item.icon;
                  const selected = activeNav === item.key;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      data-nav-key={item.key}
                      data-nav-surface="mobile"
                      className={`${styles.navItem} ${selected ? styles.navItemActive : ""}`}
                      onClick={() => setActiveNav(item.key)}
                    >
                      <Icon size={18} />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </nav>
            </Disclosure.Panel>
          </Disclosure>

          <nav className={styles.desktopNav} aria-label="V2 primary navigation">
            {navItems.map((item) => {
              const Icon = item.icon;
              const selected = activeNav === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  data-nav-key={item.key}
                  data-nav-surface="desktop"
                  className={`${styles.navItem} ${selected ? styles.navItemActive : ""}`}
                  onClick={() => setActiveNav(item.key)}
                >
                  <Icon size={18} />
                  <span className={styles.navLabel}>{item.label}</span>
                </button>
              );
            })}
          </nav>

          <div className={styles.sidebarFoot}>
            <small className={styles.sidebarEyebrow}>Default theme</small>
            <strong>Light Professional</strong>
            <span>Users can switch between all five approved themes from the shell.</span>
          </div>
        </aside>

        <section className={styles.workspace}>
          <header className={styles.topbar}>
            <div className={styles.breadcrumbs}>
              <span>ATLAS</span>
              <span>/</span>
              <span>V2</span>
              <span>/</span>
              <strong>{activeNavItem.label}</strong>
            </div>

            <div className={styles.topbarRow}>
              <label className={styles.searchBox} aria-label="Global search">
                <Search size={18} />
                <input
                  value={searchText}
                  onChange={(event) => setSearchText(event.target.value)}
                  placeholder="Search modules, actions, or workflow names"
                />
              </label>

              <label className={styles.themeSelectWrap}>
                <span className={styles.themeIcon}>{themeIcon(activeTheme)}</span>
                <select
                  ref={themeSelectRef}
                  aria-label="Theme selection"
                  className={styles.themeSelect}
                  value={pendingTheme}
                  onChange={(event) => setPendingTheme(event.target.value as ThemeId)}
                  onInput={(event) => setPendingTheme((event.target as HTMLSelectElement).value as ThemeId)}
                >
                  {themeOptions.map((theme) => (
                    <option key={theme.id} value={theme.id}>
                      {theme.label}
                    </option>
                  ))}
                </select>
                <ChevronDown size={16} className={styles.themeChevron} />
              </label>
              <button
                type="button"
                className={styles.applyThemeButton}
                data-dirty={themeSelectionChanged ? "true" : "false"}
                onClick={() => applyTheme()}
              >
                Save theme
              </button>

              <div className={styles.menuWrap}>
                <button
                  type="button"
                  className={styles.iconButton}
                  aria-label="Open notifications"
                  aria-expanded={notificationsOpen}
                  onClick={() => setNotificationsOpen((current) => !current)}
                >
                  <Bell size={18} />
                  <span className={styles.badge}>{notificationItems.length}</span>
                </button>
                {notificationsOpen ? (
                  <div className={styles.menuPanel} role="dialog" aria-label="Notification center">
                    <div className={styles.menuTitle}>Notification center</div>
                    {notificationItems.map((item) => (
                      <div key={item.title} className={styles.noticeItem} data-tone={item.tone}>
                        <strong>{item.title}</strong>
                        <small>{item.detail}</small>
                      </div>
                    ))}
                    {hasSavedSession ? (
                      <button type="button" className={styles.menuLogoutButton} onClick={handleSignOutPreview}>
                        Clear V2 session
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          </header>

          {!hasSavedSession ? (
            <V2SignInModule onSignedIn={handleSignedIn} />
          ) : overviewActive ? (
            <V2OverviewModule />
          ) : activeNav === "employees" ? (
            <V2EmployeesModule />
          ) : activeNav === "airfare" ? (
            <V2AirfareModule />
          ) : (
            <>
              <section className={styles.hero}>
                <div className={styles.heroCopy}>
                  <p>{activeNavItem.eyebrow}</p>
                  <h1>{activeNavItem.title}</h1>
                  <span>{activeNavItem.detail}</span>
                </div>
                <div className={styles.heroAside}>
                  <div className={styles.heroPill}>Headless shell</div>
                  <strong>Theme-ready</strong>
                  <span>Built on user-selectable design tokens and isolated from the legacy workflow.</span>
                </div>
              </section>

              <section className={styles.metrics}>
                <article className={styles.metricCard}>
                  <small>Default startup mode</small>
                  <strong>Light Professional</strong>
                  <span>Applied when no user preference exists.</span>
                </article>
                <article className={styles.metricCard}>
                  <small>User theme choices</small>
                  <strong>{activeThemeOption.label}</strong>
                  <span>{themeSavedMessage}</span>
                </article>
                <article className={styles.metricCard}>
                  <small>Navigation pattern</small>
                  <strong>Collapsible sidebar</strong>
                  <span>Desktop rail plus compact mobile disclosure navigation.</span>
                </article>
                <article className={styles.metricCard}>
                  <small>Migration policy</small>
                  <strong>Legacy UI preserved</strong>
                  <span>No business module is swapped until module-by-module verification passes.</span>
                </article>
              </section>

              <section className={styles.contentGrid}>
                <article className={styles.panel}>
                  <div className={styles.panelTitle}>
                    <LayoutDashboard size={18} />
                    <span>Shell capabilities</span>
                  </div>
                  <div className={styles.checkList}>
                    <div>
                      <strong>Breadcrumb trail</strong>
                      <small>Stable location awareness for every migrated module.</small>
                    </div>
                    <div>
                      <strong>Global search zone</strong>
                      <small>One consistent command entry point across admin workflows.</small>
                    </div>
                    <div>
                      <strong>Theme switcher</strong>
                      <small>All approved themes available to end users from day one.</small>
                    </div>
                    <div>
                      <strong>Notification center</strong>
                      <small>Unified alert surface instead of scattered status blocks.</small>
                    </div>
                  </div>
                </article>

                <article className={styles.panel}>
                  <div className={styles.panelTitle}>
                    <Sparkles size={18} />
                    <span>Migration guardrails</span>
                  </div>
                  <div className={styles.timeline}>
                    <div>
                      <strong>1. Shell verified on /v2</strong>
                      <small>Legacy route remains untouched.</small>
                    </div>
                    <div>
                      <strong>2. Clickability protocol passes</strong>
                      <small>Interactive controls must be clean before module moves.</small>
                    </div>
                    <div>
                      <strong>3. Modules migrate one by one</strong>
                      <small>Same API contracts, cleaner interaction layer.</small>
                    </div>
                  </div>
                </article>
              </section>
            </>
          )}
        </section>
      </section>
    </main>
  );
}
