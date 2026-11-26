"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { api } from "./api";
import { useAuth } from "./auth";
import { THEME_CACHE_KEY } from "./theme-boot";
import { DEFAULT_THEME_ID, THEME_CATALOG, type ThemeId } from "./theme-catalog";

export { DEFAULT_THEME_ID, THEME_CATALOG, type ThemeId };

export const THEME_PREFERENCE_KEY = "ui.theme";

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && THEME_CATALOG.some((t) => t.id === value);
}

/** Accept a plain id or a JSON-quoted id. Anything else is not a theme. */
export function normalizeThemeId(value: unknown): ThemeId | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/^"|"$/g, "");
  return isThemeId(trimmed) ? trimmed : null;
}

export function preferenceWithTheme(
  current: Record<string, unknown> | undefined,
  value: string | null
): Record<string, unknown> {
  const next = { ...(current ?? {}) };
  if (value == null) delete next[THEME_PREFERENCE_KEY];
  else next[THEME_PREFERENCE_KEY] = value;
  return next;
}

export function applyTheme(id: ThemeId): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = id;
  try {
    localStorage.setItem(THEME_CACHE_KEY, id);
  } catch {
    /* storage disabled: theme still applies for this page */
  }
}

const EFFECTIVE_KEY = ["preferences", "effective", "theme"] as const;

/** The signed-in user's effective preferences (user choice > company default), from MSSQL. */
export function useEffectivePreferences() {
  const session = useAuth((s) => s.session);
  return useQuery({
    queryKey: EFFECTIVE_KEY,
    queryFn: () => api<Record<string, unknown>>("/preferences/effective"),
    enabled: Boolean(session),
    staleTime: 5 * 60_000,
  });
}

/** Effective theme for the signed-in user (user choice > company default > built-in default). */
export function useThemePreference() {
  const query = useEffectivePreferences();
  const themeId: ThemeId = normalizeThemeId(query.data?.[THEME_PREFERENCE_KEY]) ?? DEFAULT_THEME_ID;
  return { themeId, loaded: query.isSuccess };
}

export function useThemeSync(): void {
  const { themeId, loaded } = useThemePreference();
  useEffect(() => {
    if (loaded) applyTheme(themeId);
  }, [loaded, themeId]);
}

/** Save the user's own theme (null = follow the company default). */
export function useSaveMyTheme() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: ThemeId | null) =>
      api<{ preference_key: string; value: string | null }>("/preferences/me", {
        method: "PUT",
        body: { preference_key: THEME_PREFERENCE_KEY, value: id },
      }),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: EFFECTIVE_KEY });
      const previous = qc.getQueryData<Record<string, unknown>>(EFFECTIVE_KEY);
      if (id) {
        applyTheme(id);
        qc.setQueryData(EFFECTIVE_KEY, preferenceWithTheme(previous, id));
      }
      return { previous };
    },
    onError: (_err, _id, context) => {
      qc.setQueryData(EFFECTIVE_KEY, context?.previous);
      applyTheme(normalizeThemeId(context?.previous?.[THEME_PREFERENCE_KEY]) ?? DEFAULT_THEME_ID);
    },
    onSuccess: (saved, id) => {
      const chosen = id == null ? null : normalizeThemeId(saved?.value) ?? id;
      qc.setQueryData<Record<string, unknown>>(EFFECTIVE_KEY, (current) =>
        preferenceWithTheme(current, chosen)
      );
      if (chosen) applyTheme(chosen);
      else void qc.invalidateQueries({ queryKey: EFFECTIVE_KEY });
    },
  });
}

/** Admin: set the company-wide default theme. */
export function useSaveCompanyTheme() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: ThemeId) =>
      api("/preferences", {
        method: "PUT",
        body: { scope_type: "global", scope_id: "", preference_key: THEME_PREFERENCE_KEY, value: id },
      }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["preferences"] }),
  });
}
