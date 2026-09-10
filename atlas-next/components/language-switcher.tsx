"use client";

import { Languages } from "lucide-react";
import { useLocaleStore, useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function LanguageSwitcher({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  const locale = useLocaleStore((s) => s.locale);
  const setLocale = useLocaleStore((s) => s.setLocale);
  const t = useT();

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
      {!compact ? <Languages size={14} className="ms-1.5 text-[var(--color-muted-foreground)]" /> : null}
      <button
        type="button"
        data-testid="lang-en"
        aria-pressed={locale === "en"}
        onClick={() => setLocale("en")}
        className={cn(
          "rounded-[var(--radius-sm)] px-2 py-1 text-xs font-semibold cursor-pointer",
          locale === "en"
            ? "bg-[var(--color-primary)] text-white"
            : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
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
          "rounded-[var(--radius-sm)] px-2 py-1 text-xs font-semibold cursor-pointer",
          locale === "ar"
            ? "bg-[var(--color-primary)] text-white"
            : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
        )}
        lang="ar"
      >
        ع
      </button>
    </div>
  );
}
