export const ATLAS_PREFERENCES_SCHEMA_VERSION = 2;

export const atlasThemeModes = ["light", "dark", "system", "contrast"] as const;
export const atlasThemeAccents = ["blue", "emerald", "slate", "ocean", "sunset", "custom"] as const;
export const atlasDensityModes = ["compact", "standard", "comfortable"] as const;
export const atlasViewModes = ["grid", "list", "split"] as const;
export const atlasShortcutScopes = ["global", "navigation", "records", "reports"] as const;
export const atlasNotificationChannels = ["inApp", "desktop", "email"] as const;

export type AtlasThemeMode = typeof atlasThemeModes[number];
export type AtlasThemeAccent = typeof atlasThemeAccents[number];
export type AtlasDensityMode = typeof atlasDensityModes[number];
export type AtlasViewMode = typeof atlasViewModes[number];
export type AtlasShortcutScope = typeof atlasShortcutScopes[number];
export type AtlasNotificationChannel = typeof atlasNotificationChannels[number];

export type AtlasShortcut = {
  id: string;
  label: string;
  scope: AtlasShortcutScope;
  keys: string[];
  enabled: boolean;
};

export type AtlasUserPreferences = {
  schemaVersion: typeof ATLAS_PREFERENCES_SCHEMA_VERSION;
  appearance: {
    themeMode: AtlasThemeMode;
    themeAccent: AtlasThemeAccent;
    customAccent: string;
    density: AtlasDensityMode;
    viewMode: AtlasViewMode;
    reduceMotion: boolean;
  };
  layout: {
    sidebarCollapsed: boolean;
    rightPanelsCollapsed: boolean;
    showSyncStatus: boolean;
    commandBarCompact: boolean;
    stickyPanels: boolean;
  };
  shortcuts: AtlasShortcut[];
  notifications: Record<AtlasNotificationChannel, boolean> & {
    entitlementAlerts: boolean;
    installerAlerts: boolean;
    loanAlerts: boolean;
    selfServiceAlerts: boolean;
    digestFrequency: "off" | "daily" | "weekly";
  };
  privacy: {
    maskAmountsInScreenshots: boolean;
    hideEmployeeIdentifiers: boolean;
    rememberSession: boolean;
    telemetryHealthPing: boolean;
  };
  sync: {
    autoExportJson: boolean;
    lastImportedAt?: string;
    lastExportedAt?: string;
  };
};

export const atlasPreferencesSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://atlas.local/schemas/user-preferences.schema.json",
  title: "ATLAS user preferences",
  type: "object",
  required: ["schemaVersion", "appearance", "layout", "shortcuts", "notifications", "privacy", "sync"],
  additionalProperties: false,
  properties: {
    schemaVersion: { const: ATLAS_PREFERENCES_SCHEMA_VERSION },
    appearance: {
      type: "object",
      required: ["themeMode", "themeAccent", "customAccent", "density", "viewMode", "reduceMotion"],
      additionalProperties: false,
      properties: {
        themeMode: { enum: atlasThemeModes },
        themeAccent: { enum: atlasThemeAccents },
        customAccent: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
        density: { enum: atlasDensityModes },
        viewMode: { enum: atlasViewModes },
        reduceMotion: { type: "boolean" }
      }
    },
    layout: {
      type: "object",
      required: ["sidebarCollapsed", "rightPanelsCollapsed", "showSyncStatus", "commandBarCompact", "stickyPanels"],
      additionalProperties: false,
      properties: {
        sidebarCollapsed: { type: "boolean" },
        rightPanelsCollapsed: { type: "boolean" },
        showSyncStatus: { type: "boolean" },
        commandBarCompact: { type: "boolean" },
        stickyPanels: { type: "boolean" }
      }
    },
    shortcuts: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "label", "scope", "keys", "enabled"],
        additionalProperties: false,
        properties: {
          id: { type: "string", minLength: 2 },
          label: { type: "string", minLength: 2 },
          scope: { enum: atlasShortcutScopes },
          keys: { type: "array", items: { type: "string", minLength: 1 }, minItems: 1 },
          enabled: { type: "boolean" }
        }
      }
    },
    notifications: {
      type: "object",
      required: ["inApp", "desktop", "email", "entitlementAlerts", "installerAlerts", "loanAlerts", "selfServiceAlerts", "digestFrequency"],
      additionalProperties: false,
      properties: {
        inApp: { type: "boolean" },
        desktop: { type: "boolean" },
        email: { type: "boolean" },
        entitlementAlerts: { type: "boolean" },
        installerAlerts: { type: "boolean" },
        loanAlerts: { type: "boolean" },
        selfServiceAlerts: { type: "boolean" },
        digestFrequency: { enum: ["off", "daily", "weekly"] }
      }
    },
    privacy: {
      type: "object",
      required: ["maskAmountsInScreenshots", "hideEmployeeIdentifiers", "rememberSession", "telemetryHealthPing"],
      additionalProperties: false,
      properties: {
        maskAmountsInScreenshots: { type: "boolean" },
        hideEmployeeIdentifiers: { type: "boolean" },
        rememberSession: { type: "boolean" },
        telemetryHealthPing: { type: "boolean" }
      }
    },
    sync: {
      type: "object",
      required: ["autoExportJson"],
      additionalProperties: false,
      properties: {
        autoExportJson: { type: "boolean" },
        lastImportedAt: { type: "string" },
        lastExportedAt: { type: "string" }
      }
    }
  }
} as const;

export function createDefaultAtlasPreferences(): AtlasUserPreferences {
  return {
    schemaVersion: ATLAS_PREFERENCES_SCHEMA_VERSION,
    appearance: {
      themeMode: "light",
      themeAccent: "blue",
      customAccent: "#0b63f6",
      density: "standard",
      viewMode: "grid",
      reduceMotion: false
    },
    layout: {
      sidebarCollapsed: false,
      rightPanelsCollapsed: false,
      showSyncStatus: true,
      commandBarCompact: true,
      stickyPanels: true
    },
    shortcuts: [
      { id: "global.search", label: "Focus search", scope: "global", keys: ["Ctrl", "K"], enabled: true },
      { id: "nav.preferences", label: "Open Preferences", scope: "navigation", keys: ["Ctrl", ","], enabled: true },
      { id: "records.new", label: "Create new record", scope: "records", keys: ["Ctrl", "N"], enabled: true },
      { id: "reports.print", label: "Print current view", scope: "reports", keys: ["Ctrl", "P"], enabled: true }
    ],
    notifications: {
      inApp: true,
      desktop: false,
      email: false,
      entitlementAlerts: true,
      installerAlerts: true,
      loanAlerts: true,
      selfServiceAlerts: true,
      digestFrequency: "daily"
    },
    privacy: {
      maskAmountsInScreenshots: false,
      hideEmployeeIdentifiers: false,
      rememberSession: true,
      telemetryHealthPing: true
    },
    sync: {
      autoExportJson: false
    }
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
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

const legacyAnnualAlertKey = "year" + "EndAlerts";

function normalizeShortcuts(value: unknown, fallback: AtlasShortcut[]) {
  if (!Array.isArray(value)) return fallback;
  const rows = value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const id = typeof item.id === "string" ? item.id.trim() : "";
    const label = typeof item.label === "string" ? item.label.trim() : "";
    const keys = Array.isArray(item.keys) ? item.keys.filter((key): key is string => typeof key === "string" && key.trim().length > 0) : [];
    if (!id || !label || keys.length === 0) return [];
    return [{
      id,
      label,
      scope: pickEnum(item.scope, atlasShortcutScopes, "global"),
      keys,
      enabled: pickBoolean(item.enabled, true)
    }];
  });
  const merged = new Map(fallback.map((shortcut) => [shortcut.id, shortcut]));
  rows.forEach((shortcut) => merged.set(shortcut.id, shortcut));
  return [...merged.values()];
}

export function normalizeAtlasPreferences(value: unknown): AtlasUserPreferences {
  const defaults = createDefaultAtlasPreferences();
  if (!isRecord(value)) return defaults;
  const appearance = isRecord(value.appearance) ? value.appearance : {};
  const layout = isRecord(value.layout) ? value.layout : {};
  const notifications = isRecord(value.notifications) ? value.notifications : {};
  const privacy = isRecord(value.privacy) ? value.privacy : {};
  const sync = isRecord(value.sync) ? value.sync : {};

  return {
    schemaVersion: ATLAS_PREFERENCES_SCHEMA_VERSION,
    appearance: {
      themeMode: pickEnum(appearance.themeMode, atlasThemeModes, defaults.appearance.themeMode),
      themeAccent: pickEnum(appearance.themeAccent, atlasThemeAccents, defaults.appearance.themeAccent),
      customAccent: pickHex(appearance.customAccent, defaults.appearance.customAccent),
      density: pickEnum(appearance.density, atlasDensityModes, defaults.appearance.density),
      viewMode: pickEnum(appearance.viewMode, atlasViewModes, defaults.appearance.viewMode),
      reduceMotion: pickBoolean(appearance.reduceMotion, defaults.appearance.reduceMotion)
    },
    layout: {
      sidebarCollapsed: pickBoolean(layout.sidebarCollapsed, defaults.layout.sidebarCollapsed),
      rightPanelsCollapsed: pickBoolean(layout.rightPanelsCollapsed, defaults.layout.rightPanelsCollapsed),
      showSyncStatus: pickBoolean(layout.showSyncStatus, defaults.layout.showSyncStatus),
      commandBarCompact: pickBoolean(layout.commandBarCompact, defaults.layout.commandBarCompact),
      stickyPanels: pickBoolean(layout.stickyPanels, defaults.layout.stickyPanels)
    },
    shortcuts: normalizeShortcuts(value.shortcuts, defaults.shortcuts),
    notifications: {
      inApp: pickBoolean(notifications.inApp, defaults.notifications.inApp),
      desktop: pickBoolean(notifications.desktop, defaults.notifications.desktop),
      email: pickBoolean(notifications.email, defaults.notifications.email),
      entitlementAlerts: pickBoolean(
        notifications.entitlementAlerts,
        pickBoolean(notifications[legacyAnnualAlertKey], defaults.notifications.entitlementAlerts)
      ),
      installerAlerts: pickBoolean(notifications.installerAlerts, defaults.notifications.installerAlerts),
      loanAlerts: pickBoolean(notifications.loanAlerts, defaults.notifications.loanAlerts),
      selfServiceAlerts: pickBoolean(notifications.selfServiceAlerts, defaults.notifications.selfServiceAlerts),
      digestFrequency: pickEnum(notifications.digestFrequency, ["off", "daily", "weekly"] as const, defaults.notifications.digestFrequency)
    },
    privacy: {
      maskAmountsInScreenshots: pickBoolean(privacy.maskAmountsInScreenshots, defaults.privacy.maskAmountsInScreenshots),
      hideEmployeeIdentifiers: pickBoolean(privacy.hideEmployeeIdentifiers, defaults.privacy.hideEmployeeIdentifiers),
      rememberSession: pickBoolean(privacy.rememberSession, defaults.privacy.rememberSession),
      telemetryHealthPing: pickBoolean(privacy.telemetryHealthPing, defaults.privacy.telemetryHealthPing)
    },
    sync: {
      autoExportJson: pickBoolean(sync.autoExportJson, defaults.sync.autoExportJson),
      lastImportedAt: typeof sync.lastImportedAt === "string" ? sync.lastImportedAt : undefined,
      lastExportedAt: typeof sync.lastExportedAt === "string" ? sync.lastExportedAt : undefined
    }
  };
}

export function parseAtlasPreferencesJson(json: string): AtlasUserPreferences {
  return normalizeAtlasPreferences(JSON.parse(json));
}

export function serializeAtlasPreferences(preferences: AtlasUserPreferences) {
  return JSON.stringify(normalizeAtlasPreferences(preferences), null, 2);
}
