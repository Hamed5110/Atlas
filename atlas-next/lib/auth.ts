"use client";

import { create } from "zustand";
import type { Me, Session } from "./types";

const STORAGE_KEY = "atlas.hcm.session";

interface AuthState {
  session: Session | null;
  me: Me | null;
  hydrated: boolean;
  hydrate: () => void;
  setSession: (session: Session | null) => void;
  setMe: (me: Me | null) => void;
  clear: () => void;
}

function loadSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export const useAuth = create<AuthState>((set) => ({
  session: null,
  me: null,
  hydrated: false,
  hydrate: () => {
    if (typeof window === "undefined") return;
    set({ session: loadSession(), hydrated: true });
  },
  setSession: (session) => {
    if (typeof window !== "undefined") {
      if (session) {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
      } else {
        sessionStorage.removeItem(STORAGE_KEY);
      }
    }
    set({ session });
  },
  setMe: (me) => set({ me }),
  clear: () => {
    if (typeof window !== "undefined") sessionStorage.removeItem(STORAGE_KEY);
    set({ session: null, me: null });
  },
}));

export function hasRole(me: Me | null, ...roles: string[]): boolean {
  if (!me) return false;
  const owned = new Set(me.roles.map((r) => r.toLowerCase()));
  return roles.some((role) => owned.has(role.toLowerCase()));
}

export const isAdmin = (me: Me | null) => hasRole(me, "admin", "system_admin");
export const canManage = (me: Me | null) =>
  hasRole(me, "admin", "system_admin", "hr", "hr_manager", "finance", "finance_manager", "manager");
