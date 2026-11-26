"use client";

import { Languages } from "lucide-react";
import { useLocaleStore, useT } from "@/lib/i18n";
import { useChooseLocale } from "@/lib/locale-preference";
import { cn } from "@/lib/utils";

export function LanguageSwitcher({
  className,
  compact = false,
  tone = "surface",
}: {
  className?: string;
  compact?: boolean;
  tone?: "surface" | "sidebar";
}) {
  const locale = useLocaleStore((s) => s.locale);
  const setLocale = useChooseLocale();
  const t = useT();
  const idle =
    tone === "sidebar"
      ? "text-[var(--color-sidebar-foreground)] hover:text-[var(--color-sidebar-active)]"
      : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]";

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-white/80 p-0.5",
        className
      )}
      data-testid="language-switcher"
      role="group"
      aria-label={t("lang.switch")}
    >
      {!compact ? (
        <Languages
          size={14}
          className={cn(
            "ms-1.5",
            tone === "sidebar" ? "text-[var(--color-sidebar-indicator)]" : "text-[var(--color-muted-foreground)]"
          )}
        />
      ) : null}
      <button
        type="button"
        data-testid="lang-en"
        aria-pressed={locale === "en"}
        onClick={() => setLocale("en")}
        className={cn(
          "rounded-[var(--radius-sm)] px-2 py-1 text-xs font-semibold cursor-pointer",
          locale === "en" ? "bg-[var(--color-primary)] text-white" : idle
        )}
      >
        EN
      </button>
      <button
        type="button"
        data-testid="lang-ar"
        aria-pressed={locale === "ar"}
        onClick={() => setLocale("ar")}
        className={cn(
          "min-w-7 rounded-[var(--radius-sm)] px-2 py-1 text-center text-xs font-semibold cursor-pointer",
          locale === "ar" ? "bg-[var(--color-primary)] text-white" : idle
        )}
        lang="ar"
        aria-label="العربية"
      >
        ع
      </button>
    </div>
  );
}
