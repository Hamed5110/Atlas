"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { api } from "./api";
import { useAuth } from "./auth";
import { LOCALES, useLocaleStore, type Locale } from "./i18n";
import { useEffectivePreferences } from "./theme";

export const LOCALE_PREFERENCE_KEY = "ui.locale";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as string[]).includes(value);
}

/** Apply the language saved in the user's profile; the browser copy is only a boot cache. */
export function useLocaleSync(): void {
  const { data, isSuccess } = useEffectivePreferences();
  const saved = data?.[LOCALE_PREFERENCE_KEY];
  useEffect(() => {
    if (isSuccess && isLocale(saved) && useLocaleStore.getState().locale !== saved) {
      useLocaleStore.getState().setLocale(saved);
    }
  }, [isSuccess, saved]);
}

/** Switch language now and, when signed in, save it to the profile so it follows the user. */
export function useChooseLocale() {
  const qc = useQueryClient();
  const signedIn = useAuth((s) => Boolean(s.session));
  const save = useMutation({
    mutationFn: (locale: Locale) =>
      api("/preferences/me", { method: "PUT", body: { preference_key: LOCALE_PREFERENCE_KEY, value: locale } }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["preferences"] }),
  });
  return (locale: Locale) => {
    useLocaleStore.getState().setLocale(locale);
    if (signedIn) save.mutate(locale);
  };
}
