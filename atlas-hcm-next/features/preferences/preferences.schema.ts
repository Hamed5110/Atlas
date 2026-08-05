import { z } from "zod";

export const ATLAS_PREFERENCES_SCHEMA_VERSION = 3;

export const preferenceSections = [
  "appearance",
  "workspace",
  "dataSafety",
  "keyboard",
  "entitlement",
  "notifications",
  "admin"
] as const;

export type PreferenceSection = typeof preferenceSections[number];

export const preferenceSectionLabels: Record<PreferenceSection, string> = {
  appearance: "Appearance",
  workspace: "Workspace",
  dataSafety: "Data & Safety",
  keyboard: "Keyboard",
  entitlement: "Entitlement Process",
  notifications: "Notifications",
  admin: "Admin"
};

export const shortcutSchema = z.object({
  id: z.string().min(2),
  label: z.string().min(2),
  scope: z.enum(["global", "navigation", "records", "reports", "safety"]),
  keys: z.array(z.string().min(1)).min(1),
  enabled: z.boolean()
});

export const atlasPreferencesSchema = z.object({
  schemaVersion: z.literal(ATLAS_PREFERENCES_SCHEMA_VERSION),
  uiOnly: z.object({
    activeSection: z.enum(preferenceSections),
    sidebarCollapsed: z.boolean(),
    densityPreview: z.boolean()
  }),
  appearance: z.object({
    theme: z.enum(["light", "dark", "system", "high-contrast"]),
    accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    density: z.enum(["compact", "standard", "comfortable"]),
    tableRowHeight: z.enum(["small", "medium", "large"]),
    reduceMotion: z.boolean()
  }),
  workspace: z.object({
    defaultLandingPage: z.enum(["overview", "employees", "airfare", "loans", "reports", "preferences"]),
    sidebarCollapsedByDefault: z.boolean(),
    rightPanelsVisible: z.boolean(),
    compactMetrics: z.boolean()
  }),
  dataSafety: z.object({
    requireDestructiveConfirmations: z.boolean(),
    confirmBulkDelete: z.boolean(),
    exportIncludesUiOnly: z.boolean(),
    lastExportedAt: z.string().optional(),
    lastImportedAt: z.string().optional()
  }),
  keyboard: z.object({
    commandPaletteEnabled: z.boolean(),
    showShortcutHints: z.boolean(),
    shortcuts: z.array(shortcutSchema).min(1)
  }),
  notifications: z.object({
    muteAllWarnings: z.boolean(),
    databaseWarnings: z.boolean(),
    entitlementWarnings: z.boolean(),
    importExportAlerts: z.boolean(),
    installerPatchAlerts: z.boolean(),
    desktopAlerts: z.boolean()
  }),
  entitlement: z.object({
    showProcessPanel: z.boolean(),
    showLegacySeedGuidance: z.boolean(),
    reconciliationDefaultScope: z.enum(["all", "company"]),
    accrualForecastHorizonDays: z.number().int().min(30).max(730),
    requireAdminForWrites: z.boolean()
  }),
  admin: z.object({
    apiRateLimitWarningVisible: z.boolean(),
    diagnosticsVisible: z.boolean(),
    supportBundleExportEnabled: z.boolean(),
    showVersionHealth: z.boolean()
  }),
  metadata: z.object({
    updatedAt: z.string(),
    migratedFromVersion: z.number().optional()
  })
});

export type AtlasPreferences = z.infer<typeof atlasPreferencesSchema>;
export type AtlasPreferenceShortcut = z.infer<typeof shortcutSchema>;

export function createDefaultPreferences(): AtlasPreferences {
  return {
    schemaVersion: ATLAS_PREFERENCES_SCHEMA_VERSION,
    uiOnly: {
      activeSection: "appearance",
      sidebarCollapsed: false,
      densityPreview: true
    },
    appearance: {
      theme: "system",
      accentColor: "#0b63f6",
      density: "standard",
      tableRowHeight: "medium",
      reduceMotion: false
    },
    workspace: {
      defaultLandingPage: "overview",
      sidebarCollapsedByDefault: false,
      rightPanelsVisible: true,
      compactMetrics: false
    },
    dataSafety: {
      requireDestructiveConfirmations: true,
      confirmBulkDelete: true,
      exportIncludesUiOnly: false
    },
    keyboard: {
      commandPaletteEnabled: true,
      showShortcutHints: true,
      shortcuts: [
        { id: "global.search", label: "Focus search", scope: "global", keys: ["Ctrl", "K"], enabled: true },
        { id: "nav.preferences", label: "Open Preferences", scope: "navigation", keys: ["Ctrl", ","], enabled: true },
        { id: "records.new", label: "Create new record", scope: "records", keys: ["Ctrl", "N"], enabled: true },
        { id: "reports.print", label: "Print current view", scope: "reports", keys: ["Ctrl", "P"], enabled: true },
        { id: "safety.confirm", label: "Confirm destructive action", scope: "safety", keys: ["Alt", "Enter"], enabled: true }
      ]
    },
    notifications: {
      muteAllWarnings: false,
      databaseWarnings: true,
      entitlementWarnings: true,
      importExportAlerts: true,
      installerPatchAlerts: true,
      desktopAlerts: false
    },
    entitlement: {
      showProcessPanel: true,
      showLegacySeedGuidance: true,
      reconciliationDefaultScope: "all",
      accrualForecastHorizonDays: 90,
      requireAdminForWrites: true
    },
    admin: {
      apiRateLimitWarningVisible: true,
      diagnosticsVisible: true,
      supportBundleExportEnabled: true,
      showVersionHealth: true
    },
    metadata: {
      updatedAt: new Date(0).toISOString()
    }
  };
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function pickEnum<T extends readonly string[]>(value: unknown, allowed: T, fallback: T[number]): T[number] {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? value as T[number] : fallback;
}

function pickBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function pickHex(value: unknown, fallback: string) {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}

function migrateLegacyAtlasPreferences(value: UnknownRecord): AtlasPreferences {
  const defaults = createDefaultPreferences();
  const appearance = isRecord(value.appearance) ? value.appearance : {};
  const layout = isRecord(value.layout) ? value.layout : {};
  const notifications = isRecord(value.notifications) ? value.notifications : {};
  const privacy = isRecord(value.privacy) ? value.privacy : {};
  const sync = isRecord(value.sync) ? value.sync : {};

  return atlasPreferencesSchema.parse({
    ...defaults,
    appearance: {
      theme: pickEnum(appearance.themeMode, ["light", "dark", "system", "contrast"] as const, "system") === "contrast"
        ? "high-contrast"
        : pickEnum(appearance.themeMode, ["light", "dark", "system"] as const, "system"),
      accentColor: pickHex(appearance.customAccent, defaults.appearance.accentColor),
      density: pickEnum(appearance.density, ["compact", "standard", "comfortable"] as const, defaults.appearance.density),
      tableRowHeight: defaults.appearance.tableRowHeight,
      reduceMotion: pickBoolean(appearance.reduceMotion, defaults.appearance.reduceMotion)
    },
    workspace: {
      defaultLandingPage: defaults.workspace.defaultLandingPage,
      sidebarCollapsedByDefault: pickBoolean(layout.sidebarCollapsed, defaults.workspace.sidebarCollapsedByDefault),
      rightPanelsVisible: !pickBoolean(layout.rightPanelsCollapsed, !defaults.workspace.rightPanelsVisible),
      compactMetrics: pickBoolean(layout.commandBarCompact, defaults.workspace.compactMetrics)
    },
    dataSafety: {
      ...defaults.dataSafety,
      lastImportedAt: typeof sync.lastImportedAt === "string" ? sync.lastImportedAt : undefined,
      lastExportedAt: typeof sync.lastExportedAt === "string" ? sync.lastExportedAt : undefined
    },
    keyboard: {
      ...defaults.keyboard,
      shortcuts: Array.isArray(value.shortcuts) ? value.shortcuts : defaults.keyboard.shortcuts
    },
    notifications: {
      ...defaults.notifications,
      databaseWarnings: pickBoolean(notifications.installerAlerts, defaults.notifications.databaseWarnings),
      entitlementWarnings: pickBoolean(
        notifications.entitlementWarnings,
        pickBoolean(notifications.yearEndWarnings, pickBoolean(notifications.yearEndAlerts, defaults.notifications.entitlementWarnings))
      ),
      importExportAlerts: pickBoolean(notifications.selfServiceAlerts, defaults.notifications.importExportAlerts),
      desktopAlerts: pickBoolean(notifications.desktop, defaults.notifications.desktopAlerts)
    },
    entitlement: {
      ...defaults.entitlement,
      showProcessPanel: pickBoolean(value.showEntitlementPanel, defaults.entitlement.showProcessPanel)
    },
    admin: {
      ...defaults.admin,
      diagnosticsVisible: pickBoolean(privacy.telemetryHealthPing, defaults.admin.diagnosticsVisible)
    },
    metadata: {
      updatedAt: new Date().toISOString(),
      migratedFromVersion: typeof value.schemaVersion === "number" ? value.schemaVersion : 1
    }
  });
}

export function normalizePreferences(value: unknown): AtlasPreferences {
  if (!isRecord(value)) return createDefaultPreferences();
  const direct = atlasPreferencesSchema.safeParse(value);
  if (direct.success) return direct.data;
  if (value.schemaVersion === 1 || value.schemaVersion === 2 || isRecord(value.appearance) || isRecord(value.layout)) {
    try {
      return migrateLegacyAtlasPreferences(value);
    } catch {
      return createDefaultPreferences();
    }
  }
  return createDefaultPreferences();
}

export function parsePreferencesJson(json: string): AtlasPreferences {
  return normalizePreferences(JSON.parse(json));
}

export function serializePreferences(preferences: AtlasPreferences, includeUiOnly = true) {
  const normalized = normalizePreferences(preferences);
  const payload = includeUiOnly ? normalized : { ...normalized, uiOnly: createDefaultPreferences().uiOnly };
  return JSON.stringify(payload, null, 2);
}

export function makePreferencesSavePayload(preferences: AtlasPreferences) {
  const normalized = normalizePreferences({
    ...preferences,
    metadata: { ...preferences.metadata, updatedAt: new Date().toISOString() }
  });
  return {
    preferences: normalized,
    uiOnly: normalized.uiOnly,
    persisted: {
      appearance: normalized.appearance,
      workspace: normalized.workspace,
      dataSafety: normalized.dataSafety,
      keyboard: normalized.keyboard,
      entitlement: normalized.entitlement,
      notifications: normalized.notifications,
      admin: normalized.admin,
      metadata: normalized.metadata
    }
  };
}
