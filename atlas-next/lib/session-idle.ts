/**
 * SPA idle session gate (TRUE MODE).
 *
 * Research (Auth0 idle refresh lifetime, FusionAuth sliding window, Skycloak /
 * PCI guidance): short access tokens alone are not enough — background refresh
 * resets idle. Track real user activity; stop refresh and sign out after idle.
 */
"use client";

import { useAuth } from "./auth";

export const SESSION_IDLE_MS = 20 * 60 * 1000;
const ACTIVITY_KEY = "atlas.hcm.lastActivityAt";
const ACTIVITY_EVENTS = [
  "mousedown",
  "keydown",
  "scroll",
  "touchstart",
  "mousemove",
  "visibilitychange",
] as const;

function now() {
  return Date.now();
}

export function touchSessionActivity(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(ACTIVITY_KEY, String(now()));
  } catch {
    /* private mode */
  }
}

export function lastSessionActivityAt(): number {
  if (typeof window === "undefined") return now();
  try {
    const raw = localStorage.getItem(ACTIVITY_KEY);
    const n = raw ? Number(raw) : 0;
    return Number.isFinite(n) && n > 0 ? n : now();
  } catch {
    return now();
  }
}

export function isSessionIdle(limitMs: number = SESSION_IDLE_MS): boolean {
  return now() - lastSessionActivityAt() >= limitMs;
}

/** Call before token refresh. Returns false when idle — caller must clear session. */
export function allowTokenRefresh(limitMs: number = SESSION_IDLE_MS): boolean {
  if (isSessionIdle(limitMs)) return false;
  touchSessionActivity();
  return true;
}

export function clearSessionActivity(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(ACTIVITY_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Mount once under the signed-in shell. Marks activity and forces login after idle.
 */
export function startSessionIdleWatcher(
  onIdle: () => void,
  limitMs: number = SESSION_IDLE_MS
): () => void {
  if (typeof window === "undefined") return () => undefined;

  touchSessionActivity();

  const onActivity = () => {
    if (document.visibilityState === "hidden") return;
    touchSessionActivity();
  };

  for (const ev of ACTIVITY_EVENTS) {
    window.addEventListener(ev, onActivity, { passive: true });
  }

  const timer = window.setInterval(() => {
    if (!useAuth.getState().session) return;
    if (isSessionIdle(limitMs)) {
      clearSessionActivity();
      onIdle();
    }
  }, 30_000);

  return () => {
    window.clearInterval(timer);
    for (const ev of ACTIVITY_EVENTS) {
      window.removeEventListener(ev, onActivity);
    }
  };
}
