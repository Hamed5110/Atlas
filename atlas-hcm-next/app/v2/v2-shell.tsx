"use client";

import { Disclosure } from "@headlessui/react";
import {
  Bot,
  Bell,
  Building2,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
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
  WalletCards,
  Wrench
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import V2AirfareModule from "./v2-airfare-module";
import V2EmployeesModule from "./v2-employees-module";
import V2OverviewModule from "./v2-overview-module";
import { clearSavedSession, restoreSavedSession } from "./v2-session";
import V2SignInModule from "./v2-sign-in-module";
import V2StagedModule from "./v2-staged-module";
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
  | "opening-balance"
  | "airfare"
  | "employee-self-service"
  | "loans"
  | "year-end"
  | "reports"
  | "companies"
  | "preferences"
  | "ai-insights"
  | "security"
  | "system-maintenance"
  | "support";

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
const LEGACY_MODULE_COUNT = 14;

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
    eyebrow: "People operations",
    title: "Employee workspace lane",
    detail: "Employee register, edit flow, selection actions, and live master data now sit inside the `/v2` shell."
  },
  {
    key: "opening-balance",
    label: "Opening Balance",
    icon: WalletCards,
    eyebrow: "Balance carry-forward",
    title: "Opening balance staging lane",
    detail: "Opening balances, opening loan balances, year switching, and carry-forward review will migrate here without changing legacy formulas."
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
    key: "employee-self-service",
    label: "Employee Self-Service",
    icon: Users,
    eyebrow: "Request workflow",
    title: "Employee self-service lane",
    detail: "Allowance requests, approvals, and linked employee journeys will move here with the same session and workflow contracts."
  },
  {
    key: "loans",
    label: "Loans",
    icon: WalletCards,
    eyebrow: "Recovery workflow",
    title: "Loan management lane",
    detail: "Loan register, settlement, deferment, and EMI execution remain protected while the user experience is rebuilt."
  },
  {
    key: "year-end",
    label: "Year End",
    icon: CalendarClock,
    eyebrow: "Fiscal close",
    title: "Year-end process lane",
    detail: "Close preview, carry-forward, and fiscal switching need careful migration, so this screen is mounted first and activated module by module."
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
    key: "companies",
    label: "Companies",
    icon: Building2,
    eyebrow: "Tenant administration",
    title: "Company administration lane",
    detail: "Company setup, cleanup, and backup/restore tools will migrate here without changing isolated company behavior."
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
    key: "ai-insights",
    label: "AI Insights",
    icon: Bot,
    eyebrow: "Recommendation center",
    title: "AI insights lane",
    detail: "Integrity checks, recommendations, and assistant-driven review surfaces will be redesigned here with a calmer enterprise hierarchy."
  },
  {
    key: "security",
    label: "Security",
    icon: ShieldCheck,
    eyebrow: "Admin controls",
    title: "Identity and access lane",
    detail: "User management and security administration can be migrated into this shell without disturbing the original interface."
  },
  {
    key: "system-maintenance",
    label: "System Maintenance",
    icon: Wrench,
    eyebrow: "Environment control",
    title: "System maintenance lane",
    detail: "Update checks, diagnostics, and service health workflows belong here in the final admin surface."
  },
  {
    key: "support",
    label: "Support",
    icon: CircleHelp,
    eyebrow: "Operator guidance",
    title: "Support and guide lane",
    detail: "Support content, guides, and workflow notes are mounted here so the `/v2` shell matches the full legacy screen count."
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
  const liveModuleCount = 4;

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
          ) : activeNav === "opening-balance" ? (
            <V2StagedModule
              eyebrow={activeNavItem.eyebrow}
              title={activeNavItem.title}
              detail={activeNavItem.detail}
              statusLabel="Mounted for parity"
              legacyModuleCount={LEGACY_MODULE_COUNT}
              v2ModuleCount={navItems.length}
              liveModuleCount={liveModuleCount}
              nextSlice="Opening Balance"
              carryForward={["Opening balance register", "Opening loan balance register", "Year switch matrix", "Edit and delete modals"]}
            />
          ) : activeNav === "airfare" ? (
            <V2AirfareModule />
          ) : activeNav === "employee-self-service" ? (
            <V2StagedModule
              eyebrow={activeNavItem.eyebrow}
              title={activeNavItem.title}
              detail={activeNavItem.detail}
              statusLabel="Mounted for parity"
              legacyModuleCount={LEGACY_MODULE_COUNT}
              v2ModuleCount={navItems.length}
              liveModuleCount={liveModuleCount}
              nextSlice="Employee Self-Service"
              carryForward={["Request form", "Approval transitions", "Allocation linking", "Status and notification messages"]}
            />
          ) : activeNav === "loans" ? (
            <V2StagedModule
              eyebrow={activeNavItem.eyebrow}
              title={activeNavItem.title}
              detail={activeNavItem.detail}
              statusLabel="Mounted for parity"
              legacyModuleCount={LEGACY_MODULE_COUNT}
              v2ModuleCount={navItems.length}
              liveModuleCount={liveModuleCount}
              nextSlice="Loans"
              carryForward={["Loan register", "Settlement and deferment", "EMI preview", "Batch run confirmation"]}
            />
          ) : activeNav === "year-end" ? (
            <V2StagedModule
              eyebrow={activeNavItem.eyebrow}
              title={activeNavItem.title}
              detail={activeNavItem.detail}
              statusLabel="Mounted for parity"
              legacyModuleCount={LEGACY_MODULE_COUNT}
              v2ModuleCount={navItems.length}
              liveModuleCount={liveModuleCount}
              nextSlice="Year End"
              carryForward={["Preview close", "Carry-forward evidence", "Historical year switch", "Company-wise isolation rules"]}
            />
          ) : activeNav === "reports" ? (
            <V2StagedModule
              eyebrow={activeNavItem.eyebrow}
              title={activeNavItem.title}
              detail={activeNavItem.detail}
              statusLabel="Mounted for parity"
              legacyModuleCount={LEGACY_MODULE_COUNT}
              v2ModuleCount={navItems.length}
              liveModuleCount={liveModuleCount}
              nextSlice="Reports"
              carryForward={["Payable reports", "Drill-down panels", "Print and export controls", "Responsive report fit modes"]}
            />
          ) : activeNav === "companies" ? (
            <V2StagedModule
              eyebrow={activeNavItem.eyebrow}
              title={activeNavItem.title}
              detail={activeNavItem.detail}
              statusLabel="Mounted for parity"
              legacyModuleCount={LEGACY_MODULE_COUNT}
              v2ModuleCount={navItems.length}
              liveModuleCount={liveModuleCount}
              nextSlice="Companies"
              carryForward={["Company CRUD", "Empty company cleanup", "Backup and restore", "Logo and branding state"]}
            />
          ) : activeNav === "preferences" ? (
            <V2StagedModule
              eyebrow={activeNavItem.eyebrow}
              title={activeNavItem.title}
              detail={activeNavItem.detail}
              statusLabel="Mounted for parity"
              legacyModuleCount={LEGACY_MODULE_COUNT}
              v2ModuleCount={navItems.length}
              liveModuleCount={liveModuleCount}
              nextSlice="Preferences"
              carryForward={["Policy list", "Delete preview modal", "Theme settings", "Dynamic reference checks"]}
            />
          ) : activeNav === "ai-insights" ? (
            <V2StagedModule
              eyebrow={activeNavItem.eyebrow}
              title={activeNavItem.title}
              detail={activeNavItem.detail}
              statusLabel="Mounted for parity"
              legacyModuleCount={LEGACY_MODULE_COUNT}
              v2ModuleCount={navItems.length}
              liveModuleCount={liveModuleCount}
              nextSlice="AI Insights"
              carryForward={["Control-center cards", "Recommendations", "Integrity checks", "Target-view shortcuts"]}
            />
          ) : activeNav === "security" ? (
            <V2StagedModule
              eyebrow={activeNavItem.eyebrow}
              title={activeNavItem.title}
              detail={activeNavItem.detail}
              statusLabel="Mounted for parity"
              legacyModuleCount={LEGACY_MODULE_COUNT}
              v2ModuleCount={navItems.length}
              liveModuleCount={liveModuleCount}
              nextSlice="Security"
              carryForward={["User register", "Role controls", "Account edit flows", "Admin-only validation"]}
            />
          ) : activeNav === "system-maintenance" ? (
            <V2StagedModule
              eyebrow={activeNavItem.eyebrow}
              title={activeNavItem.title}
              detail={activeNavItem.detail}
              statusLabel="Mounted for parity"
              legacyModuleCount={LEGACY_MODULE_COUNT}
              v2ModuleCount={navItems.length}
              liveModuleCount={liveModuleCount}
              nextSlice="System Maintenance"
              carryForward={["Update placement", "Port 3355 health checks", "Installer guidance", "Diagnostic notices"]}
            />
          ) : activeNav === "support" ? (
            <V2StagedModule
              eyebrow={activeNavItem.eyebrow}
              title={activeNavItem.title}
              detail={activeNavItem.detail}
              statusLabel="Mounted for parity"
              legacyModuleCount={LEGACY_MODULE_COUNT}
              v2ModuleCount={navItems.length}
              liveModuleCount={liveModuleCount}
              nextSlice="Support"
              carryForward={["Support guide links", "Workflow instructions", "Validation notes", "Operator recovery hints"]}
            />
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
