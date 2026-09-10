import { create } from "zustand";
import type { Me, Session } from "./types";

const STORAGE_KEY = "atlas.hcm.session";

interface AuthState {
  session: Session | null;
  me: Me | null;
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
  session: loadSession(),
  me: null,
  setSession: (session) => {
    if (session) {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } else {
      sessionStorage.removeItem(STORAGE_KEY);
    }
    set({ session });
  },
  setMe: (me) => set({ me }),
  clear: () => {
    sessionStorage.removeItem(STORAGE_KEY);
    set({ session: null, me: null });
  },
}));

export function hasRole(me: Me | null, ...roles: string[]): boolean {
  if (!me) return false;
  const owned = new Set(me.roles);
  return roles.some((role) => owned.has(role));
}

export const isAdmin = (me: Me | null) => hasRole(me, "SYSTEM_ADMIN");
export const canManage = (me: Me | null) =>
  hasRole(me, "SYSTEM_ADMIN", "HR_MANAGER", "FINANCE_MANAGER");
