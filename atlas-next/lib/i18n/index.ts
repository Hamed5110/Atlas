"use client";

import { useCallback } from "react";
import { translate, type Locale } from "./messages";
import { useLocaleStore } from "./locale-store";

export type { Locale };
export { isRtl, LOCALES } from "./messages";
export { useLocaleStore } from "./locale-store";

export function useT() {
  const locale = useLocaleStore((s) => s.locale);
  return useCallback((key: string) => translate(locale, key), [locale]);
}

export function useLocale(): Locale {
  return useLocaleStore((s) => s.locale);
}
