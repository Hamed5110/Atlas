"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export const MAX_VIEWS = 10;

export type ViewFilters = Record<string, string>;

export interface SavedView {
  id: string;
  name: string;
  filters: ViewFilters;
}

interface SavedViewsState {
  /** Keyed by `${user}:${scope}` so shared PCs and different grids keep separate views. */
  views: Record<string, SavedView[]>;
  /** Returns false when the view limit blocks a new view. */
  save: (key: string, name: string, filters: ViewFilters) => boolean;
  remove: (key: string, id: string) => void;
}

/** Named grid filters (browser-local, per user); call `useSavedViews.persist.rehydrate()` after mount. */
export const useSavedViews = create<SavedViewsState>()(
  persist(
    (set, get) => ({
      views: {},
      save: (key, name, filters) => {
        const current = get().views[key] ?? [];
        const existing = current.find((v) => v.name.toLowerCase() === name.toLowerCase());
        if (!existing && current.length >= MAX_VIEWS) return false;
        const view: SavedView = { id: existing?.id ?? `${Date.now().toString(36)}`, name, filters };
        const next = existing ? current.map((v) => (v.id === existing.id ? view : v)) : [...current, view];
        set((s) => ({ views: { ...s.views, [key]: next } }));
        return true;
      },
      remove: (key, id) =>
        set((s) => ({ views: { ...s.views, [key]: (s.views[key] ?? []).filter((v) => v.id !== id) } })),
    }),
    {
      name: "atlas.views",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
    }
  )
);

export function sameFilters(a: ViewFilters, b: ViewFilters): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((k) => (a[k] ?? "") === (b[k] ?? ""));
}
