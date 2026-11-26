"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getPreferences, savePreferences } from "../../lib/api/preferences";
import { type AtlasSession } from "../../lib/atlas-api";
import {
  type AtlasPreferences,
  createDefaultPreferences,
  normalizePreferences,
  parsePreferencesJson,
  serializePreferences
} from "./preferences.schema";
import { usePreferencesStore } from "./preferences.store";

const SESSION_STORAGE_KEY = "atlas.session";
const LEGACY_PREFERENCES_STORAGE_KEY = "atlas.ui.preferences";
const NEW_PREFERENCES_STORAGE_KEY = "atlas.preferences.v3";
const PREVIOUS_PREFERENCES_STORAGE_KEY = "atlas.preferences.v2";
const SAVE_DEBOUNCE_MS = 1000;

type SavedSessionEnvelope = {
  session?: AtlasSession;
  companyId?: string;
  fiscalYear?: number;
  expiresAt?: number;
};

function readSavedSession(): { session: AtlasSession; companyId: number | null; fiscalYear: number } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as SavedSessionEnvelope;
    if (!saved.session || !saved.expiresAt || saved.expiresAt <= Date.now()) return null;
    return {
      session: saved.session,
      companyId: saved.companyId ? Number(saved.companyId) || null : null,
      fiscalYear: saved.fiscalYear || new Date().getFullYear()
    };
  } catch {
    return null;
  }
}

function readLocalPreferences(): AtlasPreferences {
  if (typeof window === "undefined") return createDefaultPreferences();
  const keys = [NEW_PREFERENCES_STORAGE_KEY, PREVIOUS_PREFERENCES_STORAGE_KEY, LEGACY_PREFERENCES_STORAGE_KEY];
  for (const key of keys) {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw) return parsePreferencesJson(raw);
    } catch {
      // Keep trying older/default sources.
    }
  }
  return createDefaultPreferences();
}

function writeLocalPreferences(preferences: AtlasPreferences) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(NEW_PREFERENCES_STORAGE_KEY, serializePreferences(preferences, true));
}

function makeIdempotencyKey() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `pref-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function useAtlasPreferences() {
  const store = usePreferencesStore();
  const [sessionEnvelope, setSessionEnvelope] = useState<ReturnType<typeof readSavedSession>>(null);
  const hydratedRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const savedSession = readSavedSession();
    setSessionEnvelope(savedSession);
    const localPreferences = readLocalPreferences();
    store.hydrate(localPreferences);

    if (!savedSession) {
      hydratedRef.current = true;
      return;
    }

    store.markSaving();
    getPreferences(savedSession.session, savedSession.fiscalYear)
      .then((serverPreferences) => {
        const preferences = normalizePreferences(serverPreferences.preferences);
        store.hydrate(preferences);
        writeLocalPreferences(preferences);
      })
      .catch((error) => {
        store.markError(error instanceof Error ? error.message : "Could not load saved preferences.");
      })
      .finally(() => {
        hydratedRef.current = true;
      });
  }, []);

  useEffect(() => {
    writeLocalPreferences(store.draft);
    if (!hydratedRef.current || !store.hasUnsavedChanges || !sessionEnvelope) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

    saveTimerRef.current = setTimeout(() => {
      const idempotencyKey = makeIdempotencyKey();
      store.markSaving();
      savePreferences(
        sessionEnvelope.session,
        sessionEnvelope.fiscalYear,
        store.draft,
        idempotencyKey,
        sessionEnvelope.companyId
      )
        .then((result) => {
          store.markSaved(result.preferences, result.updatedAt || new Date().toISOString());
          writeLocalPreferences(result.preferences);
        })
        .catch((error) => {
          store.markError(error instanceof Error ? error.message : "Could not save preferences.");
        });
    }, SAVE_DEBOUNCE_MS);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [sessionEnvelope, store.draft, store.hasUnsavedChanges]);

  const saveNow = useCallback(async (nextPreferences?: AtlasPreferences) => {
    const preferences = normalizePreferences(nextPreferences || store.draft);
    writeLocalPreferences(preferences);
    if (!sessionEnvelope) {
      store.markSaved(preferences, new Date().toISOString());
      return;
    }
    store.markSaving();
    const result = await savePreferences(
      sessionEnvelope.session,
      sessionEnvelope.fiscalYear,
      preferences,
      makeIdempotencyKey(),
      sessionEnvelope.companyId
    );
    store.markSaved(result.preferences, result.updatedAt || new Date().toISOString());
    writeLocalPreferences(result.preferences);
  }, [sessionEnvelope, store]);

  const exportJson = useCallback(() => {
    const exportedAt = new Date().toISOString();
    const preferences = normalizePreferences({
      ...store.draft,
      dataSafety: { ...store.draft.dataSafety, lastExportedAt: exportedAt },
      metadata: { ...store.draft.metadata, updatedAt: exportedAt }
    });
    store.resetDraft(preferences);
    const blob = new Blob([serializePreferences(preferences, preferences.dataSafety.exportIncludesUiOnly)], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `atlas-preferences-${exportedAt.slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    return saveNow(preferences);
  }, [saveNow, store]);

  const importJson = useCallback(async (file: File) => {
    const text = await file.text();
    const imported = normalizePreferences({
      ...parsePreferencesJson(text),
      dataSafety: { ...parsePreferencesJson(text).dataSafety, lastImportedAt: new Date().toISOString() },
      metadata: { ...parsePreferencesJson(text).metadata, updatedAt: new Date().toISOString() }
    });
    store.resetDraft(imported);
    await saveNow(imported);
  }, [saveNow, store]);

  const resetToDefaults = useCallback(async () => {
    const defaults = normalizePreferences({
      ...createDefaultPreferences(),
      metadata: { updatedAt: new Date().toISOString() }
    });
    store.resetDraft(defaults);
    await saveNow(defaults);
  }, [saveNow, store]);

  return useMemo(() => ({
    ...store,
    saveNow,
    exportJson,
    importJson,
    resetToDefaults,
    isAuthenticated: Boolean(sessionEnvelope),
    debounceMs: SAVE_DEBOUNCE_MS
  }), [exportJson, importJson, resetToDefaults, saveNow, sessionEnvelope, store]);
}
