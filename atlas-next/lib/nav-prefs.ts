"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export const MAX_PINS = 8;
const MAX_RECENT = 5;

interface NavPrefsState {
  /** Desktop icon-only rail. */
  rail: boolean;
  /** Collapsed section ids. */
  collapsed: string[];
  /** Pinned hrefs, keyed by user id (shared PCs keep separate favourites). */
  pins: Record<string, string[]>;
  /** Most-recent-first visited hrefs, keyed by user id. */
  recent: Record<string, string[]>;
  setRail: (rail: boolean) => void;
  toggleSection: (id: string) => void;
  /** Returns false when the pin limit blocks a new pin. */
  togglePin: (user: string, href: string) => boolean;
  visit: (user: string, href: string) => void;
}

/** Sidebar preferences (browser-local, per user); call `useNavPrefs.persist.rehydrate()` after mount. */
export const useNavPrefs = create<NavPrefsState>()(
  persist(
    (set, get) => ({
      rail: false,
      collapsed: [],
      pins: {},
      recent: {},
      setRail: (rail) => set({ rail }),
      toggleSection: (id) =>
        set((s) => ({
          collapsed: s.collapsed.includes(id) ? s.collapsed.filter((c) => c !== id) : [...s.collapsed, id],
        })),
      togglePin: (user, href) => {
        const current = get().pins[user] ?? [];
        if (current.includes(href)) {
          set((s) => ({ pins: { ...s.pins, [user]: current.filter((h) => h !== href) } }));
          return true;
        }
        if (current.length >= MAX_PINS) return false;
        set((s) => ({ pins: { ...s.pins, [user]: [...current, href] } }));
        return true;
      },
      visit: (user, href) =>
        set((s) => {
          const current = s.recent[user] ?? [];
          if (current[0] === href) return s;
          return { recent: { ...s.recent, [user]: [href, ...current.filter((h) => h !== href)].slice(0, MAX_RECENT) } };
        }),
    }),
    {
      name: "atlas.nav",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      partialize: ({ rail, collapsed, pins, recent }) => ({ rail, collapsed, pins, recent }),
    }
  )
);
