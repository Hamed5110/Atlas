"use client";

import {
  Bell,
  Command,
  Database,
  Download,
  Eye,
  Keyboard,
  LayoutDashboard,
  MonitorCog,
  Palette,
  RotateCcw,
  ShieldAlert,
  SlidersHorizontal,
  Upload
} from "lucide-react";
import type { CSSProperties } from "react";
import { useMemo, useRef, useState } from "react";
import {
  type AtlasPreferences,
  type PreferenceSection,
  createDefaultPreferences,
  preferenceSectionLabels,
  preferenceSections,
  serializePreferences
} from "../preferences.schema";
import { PreferencesProvider, usePreferencesStore } from "../preferences.store";
import { useAtlasPreferences } from "../usePreferences";
import styles from "./PreferencesShell.module.css";

const sectionDescriptions: Record<PreferenceSection, string> = {
  appearance: "Theme, density, table row height, and live preview.",
  workspace: "Default page, panels, metrics, and navigation behavior.",
  dataSafety: "Import, export, reset, and destructive-action confirmations.",
  keyboard: "Shortcut registry and command palette behavior.",
  notifications: "Database, Year End, import/export, and installer warnings.",
  admin: "Rate-limit visibility, diagnostics, version health, and support bundle settings."
};

const sectionIcons = {
  appearance: Palette,
  workspace: LayoutDashboard,
  dataSafety: ShieldAlert,
  keyboard: Keyboard,
  notifications: Bell,
  admin: MonitorCog
} satisfies Record<PreferenceSection, typeof Palette>;

function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description: string;
  disabled?: boolean;
}) {
  return (
    <div className={styles.toggleRow}>
      <div className={styles.toggleText}>
        <strong>{label}</strong>
        <span>{description}</span>
      </div>
      <button
        type="button"
        className={styles.switch}
        aria-label={label}
        aria-checked={checked}
        role="switch"
        disabled={disabled}
        onClick={() => onChange(!checked)}
      />
    </div>
  );
}

function ConfirmDialog({
  title,
  description,
  confirmLabel,
  destructive,
  onCancel,
  onConfirm
}: {
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className={styles.dialogBackdrop} role="presentation" onClick={onCancel}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="preferences-dialog-title" onClick={(event) => event.stopPropagation()}>
        <h3 id="preferences-dialog-title">{title}</h3>
        <p>{description}</p>
        <div className={styles.buttonRow}>
          <button type="button" className={styles.secondaryButton} onClick={onCancel}>Cancel</button>
          <button type="button" className={destructive ? styles.dangerButton : styles.button} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function patch<T extends keyof AtlasPreferences>(
  draft: AtlasPreferences,
  key: T,
  value: Partial<AtlasPreferences[T]>
) {
  return {
    ...draft,
    [key]: {
      ...(draft[key] as object),
      ...value
    },
    metadata: { ...draft.metadata, updatedAt: new Date().toISOString() }
  } as AtlasPreferences;
}

function PreferencesNavigation() {
  const { currentSection, setSection } = usePreferencesStore();

  return (
    <aside className={styles.sidebar} aria-label="Preferences sections">
      <div className={styles.sidebarIntro}>
        <p className={styles.eyebrow}>Settings</p>
        <h2>Preferences center</h2>
        <p>Local UI changes are instant. Persisted settings are batched to avoid API bursts.</p>
      </div>
      <nav className={styles.nav}>
        {preferenceSections.map((section, index) => {
          const Icon = sectionIcons[section];
          return (
            <button
              type="button"
              key={section}
              className={styles.navButton}
              data-active={currentSection === section}
              onClick={() => setSection(section)}
            >
              <Icon size={18} aria-hidden />
              <span className={styles.navLabel}>
                <strong>{preferenceSectionLabels[section]}</strong>
                <span>{sectionDescriptions[section]}</span>
              </span>
              <kbd className={styles.shortcut}>⌘{index + 1}</kbd>
            </button>
          );
        })}
      </nav>
      <div className={styles.sidebarFooter}>
        <strong>Schema v2 guarded</strong>
        <span>Imports are validated and migrated before anything is saved to SQL.</span>
      </div>
    </aside>
  );
}

function AppearanceSection() {
  const { draft, patchDraft } = usePreferencesStore();
  const densityVars = useMemo(() => {
    const density = draft.appearance.density;
    const rowHeight = draft.appearance.tableRowHeight;
    return {
      "--atlas-accent": draft.appearance.accentColor,
      "--density-gap": density === "compact" ? "0.35rem" : density === "comfortable" ? "0.8rem" : "0.55rem",
      "--density-font": density === "compact" ? "0.84rem" : density === "comfortable" ? "1rem" : "0.92rem",
      "--row-height": rowHeight === "small" ? "2.2rem" : rowHeight === "large" ? "3.25rem" : "2.6rem"
    } as CSSProperties;
  }, [draft.appearance]);

  return (
    <section className={styles.section} style={{ "--atlas-accent": draft.appearance.accentColor } as CSSProperties}>
      <div className={styles.sectionHeader}>
        <div>
          <h3>Appearance</h3>
          <p>Inspired by shadcn-admin’s Appearance/Display split, with ATLAS density controls for payroll tables.</p>
        </div>
      </div>
      <div className={styles.cardGrid}>
        <div className={styles.card}>
          <h4>Theme and density</h4>
          <p>Immediate UI-only preview, then batched save after a short pause.</p>
          <div className={styles.fieldGrid}>
            <div className={styles.field}>
              <label htmlFor="theme">Theme</label>
              <select
                id="theme"
                value={draft.appearance.theme}
                onChange={(event) => patchDraft((current) => patch(current, "appearance", { theme: event.target.value as AtlasPreferences["appearance"]["theme"] }))}
              >
                <option value="light">Light</option>
                <option value="dark">Dark</option>
                <option value="system">System</option>
                <option value="high-contrast">High contrast</option>
              </select>
            </div>
            <div className={styles.field}>
              <label htmlFor="accentColor">Accent</label>
              <input
                id="accentColor"
                type="color"
                value={draft.appearance.accentColor}
                onChange={(event) => patchDraft((current) => patch(current, "appearance", { accentColor: event.target.value }))}
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="density">Density</label>
              <select
                id="density"
                value={draft.appearance.density}
                onChange={(event) => patchDraft((current) => patch(current, "appearance", { density: event.target.value as AtlasPreferences["appearance"]["density"] }))}
              >
                <option value="compact">Compact</option>
                <option value="standard">Standard</option>
                <option value="comfortable">Comfortable</option>
              </select>
            </div>
            <div className={styles.field}>
              <label htmlFor="tableRowHeight">Table row height</label>
              <select
                id="tableRowHeight"
                value={draft.appearance.tableRowHeight}
                onChange={(event) => patchDraft((current) => patch(current, "appearance", { tableRowHeight: event.target.value as AtlasPreferences["appearance"]["tableRowHeight"] }))}
              >
                <option value="small">Small</option>
                <option value="medium">Medium</option>
                <option value="large">Large</option>
              </select>
            </div>
          </div>
          <div className={styles.toggleList} style={{ marginTop: "1rem" }}>
            <Toggle
              checked={draft.appearance.reduceMotion}
              onChange={(checked) => patchDraft((current) => patch(current, "appearance", { reduceMotion: checked }))}
              label="Reduce motion"
              description="Limit animation for users who prefer calmer screens."
            />
          </div>
        </div>
        <div className={styles.previewCard}>
          <h4>Live preview</h4>
          <p>Shows how dense payroll tables and action rows will feel before saving.</p>
          <div className={styles.previewCanvas} style={densityVars}>
            <div className={styles.previewBar} />
            <div className={styles.previewRows}>
              <div className={styles.previewRow}><span>Airfare payable</span><strong>BHD 150.00</strong></div>
              <div className={styles.previewRow}><span>Year End warning</span><strong>Enabled</strong></div>
              <div className={styles.previewRow}><span>Employee grid row</span><strong>{draft.appearance.tableRowHeight}</strong></div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function WorkspaceSection() {
  const { draft, patchDraft } = usePreferencesStore();
  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <div>
          <h3>Workspace</h3>
          <p>Controls that change daily navigation, not payroll calculation logic.</p>
        </div>
      </div>
      <div className={styles.card}>
        <div className={styles.fieldGrid}>
          <div className={styles.field}>
            <label htmlFor="landingPage">Default landing page</label>
            <select
              id="landingPage"
              value={draft.workspace.defaultLandingPage}
              onChange={(event) => patchDraft((current) => patch(current, "workspace", { defaultLandingPage: event.target.value as AtlasPreferences["workspace"]["defaultLandingPage"] }))}
            >
              <option value="overview">Overview</option>
              <option value="employees">Employees</option>
              <option value="airfare">Airfare</option>
              <option value="loans">Loans</option>
              <option value="reports">Reports</option>
              <option value="preferences">Preferences</option>
            </select>
            <p className={styles.helpText}>Saved to SQL so admin workstations stay consistent.</p>
          </div>
        </div>
        <div className={styles.toggleList} style={{ marginTop: "1rem" }}>
          <Toggle checked={draft.workspace.sidebarCollapsedByDefault} onChange={(checked) => patchDraft((current) => patch(current, "workspace", { sidebarCollapsedByDefault: checked }))} label="Sidebar collapsed by default" description="Start with more horizontal space on small screens." />
          <Toggle checked={draft.workspace.rightPanelsVisible} onChange={(checked) => patchDraft((current) => patch(current, "workspace", { rightPanelsVisible: checked }))} label="Right panels visible" description="Show insights/support panels unless a user hides them." />
          <Toggle checked={draft.workspace.compactMetrics} onChange={(checked) => patchDraft((current) => patch(current, "workspace", { compactMetrics: checked }))} label="Compact metrics" description="Use smaller cards for dense payroll review sessions." />
        </div>
      </div>
    </section>
  );
}

function DataSafetySection({ exportJson, importJson, resetToDefaults }: ReturnType<typeof useAtlasPreferences>) {
  const { draft, patchDraft } = usePreferencesStore();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [dialog, setDialog] = useState<"reset" | "import" | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <div>
          <h3>Data & Safety</h3>
          <p>Origin UI style danger-zone behavior: explicit actions, no surprise destructive saves.</p>
        </div>
      </div>
      <div className={styles.cardGrid}>
        <div className={styles.card}>
          <h4>Import / export</h4>
          <p>JSON is schema-validated and migrated before it becomes the active draft.</p>
          <input
            ref={fileRef}
            className={styles.hiddenFile}
            type="file"
            accept="application/json,.json"
            onChange={(event) => {
              const file = event.target.files?.[0] || null;
              if (!file) return;
              setPendingFile(file);
              setDialog("import");
            }}
          />
          <div className={styles.buttonRow}>
            <button type="button" className={styles.button} onClick={() => void exportJson()}><Download size={16} /> Export JSON</button>
            <button type="button" className={styles.secondaryButton} onClick={() => fileRef.current?.click()}><Upload size={16} /> Import JSON</button>
          </div>
          <pre style={{ whiteSpace: "pre-wrap", marginTop: "1rem", color: "#475569", fontSize: "0.78rem" }}>
            {serializePreferences(draft, draft.dataSafety.exportIncludesUiOnly).slice(0, 420)}…
          </pre>
        </div>
        <div className={styles.dangerCard}>
          <h4>Safety rules</h4>
          <p>These settings control how destructive actions are confirmed across ATLAS.</p>
          <div className={styles.toggleList}>
            <Toggle checked={draft.dataSafety.requireDestructiveConfirmations} onChange={(checked) => patchDraft((current) => patch(current, "dataSafety", { requireDestructiveConfirmations: checked }))} label="Require destructive confirmations" description="Protect delete/reset/year-end actions from accidental clicks." />
            <Toggle checked={draft.dataSafety.confirmBulkDelete} onChange={(checked) => patchDraft((current) => patch(current, "dataSafety", { confirmBulkDelete: checked }))} label="Confirm bulk delete" description="Require confirmation before deleting many records." />
            <Toggle checked={draft.dataSafety.exportIncludesUiOnly} onChange={(checked) => patchDraft((current) => patch(current, "dataSafety", { exportIncludesUiOnly: checked }))} label="Include UI-only settings in exports" description="Useful for cloning a workstation layout; off by default for clean user migrations." />
          </div>
          <div className={styles.buttonRow} style={{ marginTop: "1rem" }}>
            <button type="button" className={styles.dangerButton} onClick={() => setDialog("reset")}><RotateCcw size={16} /> Reset preferences</button>
          </div>
        </div>
      </div>
      {dialog === "reset" && (
        <ConfirmDialog
          destructive
          title="Reset all preferences?"
          description="This resets the Preferences module to ATLAS defaults and saves that reset. Payroll records and airfare policies are not changed."
          confirmLabel="Reset preferences"
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            setDialog(null);
            void resetToDefaults();
          }}
        />
      )}
      {dialog === "import" && pendingFile && (
        <ConfirmDialog
          title="Import preferences JSON?"
          description={`ATLAS will validate ${pendingFile.name}, migrate old schema fields if possible, then save the imported preferences.`}
          confirmLabel="Import and save"
          onCancel={() => {
            setDialog(null);
            setPendingFile(null);
          }}
          onConfirm={() => {
            const file = pendingFile;
            setDialog(null);
            setPendingFile(null);
            void importJson(file);
          }}
        />
      )}
    </section>
  );
}

function KeyboardSection() {
  const { draft, patchDraft } = usePreferencesStore();
  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <div>
          <h3>Keyboard</h3>
          <p>Shortcut list is read-only for now; enable/disable behavior is saved safely.</p>
        </div>
      </div>
      <div className={styles.card}>
        <div className={styles.toggleList}>
          <Toggle checked={draft.keyboard.commandPaletteEnabled} onChange={(checked) => patchDraft((current) => patch(current, "keyboard", { commandPaletteEnabled: checked }))} label="Command palette binding" description="Enable Ctrl/⌘K command palette behavior." />
          <Toggle checked={draft.keyboard.showShortcutHints} onChange={(checked) => patchDraft((current) => patch(current, "keyboard", { showShortcutHints: checked }))} label="Show shortcut hints" description="Display small key badges at the right edge of navigation rows." />
        </div>
        <div className={styles.shortcutTable} style={{ marginTop: "1rem" }}>
          <div className={`${styles.shortcutRow} ${styles.shortcutRowHeader}`}>
            <span>Action</span><span>Scope</span><span>Keys</span>
          </div>
          {draft.keyboard.shortcuts.map((shortcut) => (
            <div className={styles.shortcutRow} key={shortcut.id}>
              <strong>{shortcut.label}</strong>
              <span>{shortcut.scope}</span>
              <span className={styles.kbdGroup}>{shortcut.keys.map((key) => <kbd className={styles.kbd} key={key}>{key}</kbd>)}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function NotificationsSection() {
  const { draft, patchDraft } = usePreferencesStore();
  const [confirmMute, setConfirmMute] = useState(false);
  const setNotification = (value: Partial<AtlasPreferences["notifications"]>) => patchDraft((current) => patch(current, "notifications", value));

  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <div>
          <h3>Notifications</h3>
          <p>Granular warning controls. Mute-all requires confirmation because it can hide Year End warnings.</p>
        </div>
      </div>
      <div className={styles.card}>
        <div className={styles.toggleList}>
          <Toggle checked={draft.notifications.muteAllWarnings} onChange={(checked) => checked ? setConfirmMute(true) : setNotification({ muteAllWarnings: false })} label="Mute all warnings" description="Requires confirmation. Keeps the UI calm, but hides important operational warnings." />
          <Toggle checked={draft.notifications.databaseWarnings} disabled={draft.notifications.muteAllWarnings} onChange={(checked) => setNotification({ databaseWarnings: checked })} label="Database warnings" description="Show SQL connection, schema, and version mismatch alerts." />
          <Toggle checked={draft.notifications.yearEndWarnings} disabled={draft.notifications.muteAllWarnings} onChange={(checked) => setNotification({ yearEndWarnings: checked })} label="Year End warnings" description="Warn before closing fiscal-year state or using stale balances." />
          <Toggle checked={draft.notifications.importExportAlerts} disabled={draft.notifications.muteAllWarnings} onChange={(checked) => setNotification({ importExportAlerts: checked })} label="Import/export alerts" description="Show import validation and export completion alerts." />
          <Toggle checked={draft.notifications.installerPatchAlerts} disabled={draft.notifications.muteAllWarnings} onChange={(checked) => setNotification({ installerPatchAlerts: checked })} label="Installer patch alerts" description="Show MSI/EXE manifest, health, and version mismatch warnings." />
          <Toggle checked={draft.notifications.desktopAlerts} disabled={draft.notifications.muteAllWarnings} onChange={(checked) => setNotification({ desktopAlerts: checked })} label="Desktop alerts" description="Allow browser desktop notifications where supported." />
        </div>
      </div>
      {confirmMute && (
        <ConfirmDialog
          destructive
          title="Mute all warnings?"
          description="This can hide database, Year End, and installer mismatch warnings. Use only during controlled testing or low-noise review sessions."
          confirmLabel="Mute warnings"
          onCancel={() => setConfirmMute(false)}
          onConfirm={() => {
            setConfirmMute(false);
            setNotification({ muteAllWarnings: true });
          }}
        />
      )}
    </section>
  );
}

function AdminSection() {
  const { draft, patchDraft } = usePreferencesStore();
  const setAdmin = (value: Partial<AtlasPreferences["admin"]>) => patchDraft((current) => patch(current, "admin", value));
  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <div>
          <h3>Admin</h3>
          <p>Operational controls for diagnostics and manifest-driven patch visibility.</p>
        </div>
      </div>
      <div className={styles.cardGrid}>
        <div className={styles.card}>
          <h4>Operational visibility</h4>
          <p>These controls affect what admin/support panels show; they do not change API rate-limit values.</p>
          <div className={styles.toggleList}>
            <Toggle checked={draft.admin.apiRateLimitWarningVisible} onChange={(checked) => setAdmin({ apiRateLimitWarningVisible: checked })} label="API rate-limit warning display" description="Show HTTP 429 guidance and retry timing in the UI." />
            <Toggle checked={draft.admin.diagnosticsVisible} onChange={(checked) => setAdmin({ diagnosticsVisible: checked })} label="Diagnostics visibility" description="Allow the diagnostics panel to appear for authorized users." />
            <Toggle checked={draft.admin.showVersionHealth} onChange={(checked) => setAdmin({ showVersionHealth: checked })} label="Version health panel" description="Show /api/version and /api/health status in support screens." />
          </div>
        </div>
        <div className={styles.card}>
          <h4>Support bundle</h4>
          <p>Exports should include manifest/version evidence, not manual notes only.</p>
          <div className={styles.toggleList}>
            <Toggle checked={draft.admin.supportBundleExportEnabled} onChange={(checked) => setAdmin({ supportBundleExportEnabled: checked })} label="Support bundle export" description="Allow admins to export logs, version info, and local diagnostics for support." />
          </div>
          <div className={styles.buttonRow} style={{ marginTop: "1rem" }}>
            <button className={styles.secondaryButton} type="button"><Database size={16} /> Schema-aware</button>
            <button className={styles.secondaryButton} type="button"><Eye size={16} /> Version visible</button>
          </div>
        </div>
      </div>
    </section>
  );
}

function ActiveSection(props: ReturnType<typeof useAtlasPreferences>) {
  switch (props.currentSection) {
    case "appearance":
      return <AppearanceSection />;
    case "workspace":
      return <WorkspaceSection />;
    case "dataSafety":
      return <DataSafetySection {...props} />;
    case "keyboard":
      return <KeyboardSection />;
    case "notifications":
      return <NotificationsSection />;
    case "admin":
      return <AdminSection />;
    default:
      return <AppearanceSection />;
  }
}

function PreferencesContent() {
  const preferences = useAtlasPreferences();
  const accentStyle = { "--atlas-accent": preferences.draft.appearance.accentColor } as CSSProperties;
  const statusText = preferences.status === "loading"
    ? "Loading"
    : preferences.status === "saving"
      ? "Saving"
      : preferences.status === "saved"
        ? "Saved"
        : preferences.status === "error"
          ? "Needs attention"
          : preferences.hasUnsavedChanges
            ? "Waiting to save"
            : "Ready";

  return (
    <main className={styles.shell} style={accentStyle}>
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <div className={styles.brandMark}><SlidersHorizontal size={22} /></div>
          <div>
            <p className={styles.eyebrow}>ATLAS HCM</p>
            <h1 className={styles.title}>Preferences</h1>
          </div>
        </div>
        <div className={styles.topActions}>
          <span className={styles.statusPill} data-state={preferences.status}>{statusText}</span>
          <button type="button" className={styles.secondaryButton} onClick={() => void preferences.saveNow()}>
            Save changes
          </button>
          <a className={styles.secondaryButton} href="/">Back to dashboard</a>
        </div>
      </header>

      <div className={styles.layout}>
        <PreferencesNavigation />
        <div className={styles.content}>
          <section className={styles.hero}>
            <div>
              <p className={styles.eyebrow}>Settings Command Center</p>
              <h2>Clean preferences, safe persistence, no API bursts.</h2>
              <p>
                This module separates UI-only behavior from backend-persisted settings, validates JSON imports with a schema,
                and batches safe preference saves after {preferences.debounceMs / 1000} second of idle time.
              </p>
            </div>
            <div className={styles.heroMeta}>
              <div className={styles.metaCard}><span>Schema</span><strong>v{preferences.draft.schemaVersion}</strong></div>
              <div className={styles.metaCard}><span>Persistence</span><strong>{preferences.isAuthenticated ? "SQL + local" : "Local only"}</strong></div>
            </div>
          </section>
          {preferences.error && <div className={styles.toast}>{preferences.error}</div>}
          <ActiveSection {...preferences} />
        </div>
      </div>
    </main>
  );
}

export function PreferencesShell() {
  return (
    <PreferencesProvider>
      <PreferencesContent />
    </PreferencesProvider>
  );
}
