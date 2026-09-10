"use client";

import { create } from "zustand";
import { isRtl, type Locale, LOCALES } from "./messages";

const STORAGE_KEY = "atlas.locale";

function readStored(): Locale {
  if (typeof window === "undefined") return "en";
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw && (LOCALES as string[]).includes(raw)) return raw as Locale;
  } catch {
    /* ignore */
  }
  return "en";
}

function applyDocumentLocale(locale: Locale) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.lang = locale;
  root.dir = isRtl(locale) ? "rtl" : "ltr";
  root.dataset.locale = locale;
  document.body.classList.toggle("locale-ar", locale === "ar");
  document.body.classList.toggle("locale-en", locale === "en");
}

type LocaleState = {
  locale: Locale;
  hydrated: boolean;
  hydrate: () => void;
  setLocale: (locale: Locale) => void;
  toggleLocale: () => void;
};

export const useLocaleStore = create<LocaleState>((set, get) => ({
  locale: "en",
  hydrated: false,
  hydrate: () => {
    const locale = readStored();
    applyDocumentLocale(locale);
    set({ locale, hydrated: true });
  },
  setLocale: (locale) => {
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      /* ignore */
    }
    applyDocumentLocale(locale);
    set({ locale });
  },
  toggleLocale: () => {
    const next: Locale = get().locale === "en" ? "ar" : "en";
    get().setLocale(next);
  },
}));
