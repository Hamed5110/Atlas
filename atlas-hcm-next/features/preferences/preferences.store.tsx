"use client";

import React, { createContext, useCallback, useContext, useMemo, useReducer } from "react";
import {
  type AtlasPreferences,
  type PreferenceSection,
  createDefaultPreferences,
  normalizePreferences
} from "./preferences.schema";

export type PreferencesSaveStatus = "idle" | "loading" | "saving" | "saved" | "error";

type PreferencesState = {
  currentSection: PreferenceSection;
  draft: AtlasPreferences;
  saved: AtlasPreferences;
  status: PreferencesSaveStatus;
  error: string | null;
  lastSavedAt: string | null;
};

type PreferencesAction =
  | { type: "hydrate"; preferences: AtlasPreferences; source?: PreferenceSection }
  | { type: "section"; section: PreferenceSection }
  | { type: "patch"; updater: (draft: AtlasPreferences) => AtlasPreferences }
  | { type: "status"; status: PreferencesSaveStatus; error?: string | null }
  | { type: "saved"; preferences: AtlasPreferences; savedAt: string }
  | { type: "reset"; preferences?: AtlasPreferences };

const defaultPreferences = createDefaultPreferences();

const initialState: PreferencesState = {
  currentSection: "appearance",
  draft: defaultPreferences,
  saved: defaultPreferences,
  status: "idle",
  error: null,
  lastSavedAt: null
};

function preferencesReducer(state: PreferencesState, action: PreferencesAction): PreferencesState {
  switch (action.type) {
    case "hydrate": {
      const preferences = normalizePreferences(action.preferences);
      return {
        ...state,
        currentSection: action.source || preferences.uiOnly.activeSection,
        draft: preferences,
        saved: preferences,
        status: "idle",
        error: null,
        lastSavedAt: preferences.metadata.updatedAt
      };
    }
    case "section":
      return {
        ...state,
        currentSection: action.section,
        draft: normalizePreferences({
          ...state.draft,
          uiOnly: { ...state.draft.uiOnly, activeSection: action.section }
        })
      };
    case "patch": {
      const draft = normalizePreferences(action.updater(state.draft));
      return { ...state, draft, status: state.status === "loading" ? "loading" : "idle", error: null };
    }
    case "status":
      return { ...state, status: action.status, error: action.error ?? null };
    case "saved": {
      const preferences = normalizePreferences(action.preferences);
      return {
        ...state,
        draft: preferences,
        saved: preferences,
        status: "saved",
        error: null,
        lastSavedAt: action.savedAt
      };
    }
    case "reset": {
      const preferences = normalizePreferences(action.preferences || createDefaultPreferences());
      return {
        ...state,
        draft: preferences,
        status: "idle",
        error: null
      };
    }
    default:
      return state;
  }
}

type PreferencesContextValue = PreferencesState & {
  hasUnsavedChanges: boolean;
  setSection: (section: PreferenceSection) => void;
  patchDraft: (updater: (draft: AtlasPreferences) => AtlasPreferences) => void;
  hydrate: (preferences: AtlasPreferences) => void;
  markSaving: () => void;
  markError: (message: string) => void;
  markSaved: (preferences: AtlasPreferences, savedAt?: string) => void;
  resetDraft: (preferences?: AtlasPreferences) => void;
};

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(preferencesReducer, initialState);
  const hasUnsavedChanges = useMemo(
    () => JSON.stringify(state.draft) !== JSON.stringify(state.saved),
    [state.draft, state.saved]
  );

  const value = useMemo<PreferencesContextValue>(() => ({
    ...state,
    hasUnsavedChanges,
    setSection: (section) => dispatch({ type: "section", section }),
    patchDraft: (updater) => dispatch({ type: "patch", updater }),
    hydrate: (preferences) => dispatch({ type: "hydrate", preferences }),
    markSaving: () => dispatch({ type: "status", status: "saving" }),
    markError: (message) => dispatch({ type: "status", status: "error", error: message }),
    markSaved: (preferences, savedAt = new Date().toISOString()) => dispatch({ type: "saved", preferences, savedAt }),
    resetDraft: (preferences) => dispatch({ type: "reset", preferences })
  }), [hasUnsavedChanges, state]);

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferencesStore() {
  const context = useContext(PreferencesContext);
  if (!context) {
    throw new Error("usePreferencesStore must be used inside PreferencesProvider");
  }
  return context;
}

export function usePreferencePatch() {
  const { patchDraft } = usePreferencesStore();
  return useCallback(patchDraft, [patchDraft]);
}
