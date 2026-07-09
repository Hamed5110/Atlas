"use client";

import { AtlasSession } from "../../lib/atlas-api";

export const SESSION_STORAGE_KEY = "atlas.session";
export const SESSION_TIMEOUT_MS = 8 * 60 * 60 * 1000;

export type SavedSession = {
  session: AtlasSession;
  companyId: string;
};

export function saveSession(session: AtlasSession, companyId = "") {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    SESSION_STORAGE_KEY,
    JSON.stringify({
      session,
      companyId,
      expiresAt: Date.now() + SESSION_TIMEOUT_MS
    })
  );
}

export function clearSavedSession() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(SESSION_STORAGE_KEY);
}

export function restoreSavedSession(): SavedSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as { session?: AtlasSession; companyId?: string; expiresAt?: number };
    if (!saved.session || !saved.expiresAt || saved.expiresAt <= Date.now()) {
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
      return null;
    }
    return { session: saved.session, companyId: saved.companyId || "" };
  } catch {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
    return null;
  }
}
