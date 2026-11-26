"use client";

import { Check, Palette } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { errorMessage } from "@/lib/api";
import { isAdmin, useAuth } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import {
  THEME_CATALOG,
  useSaveCompanyTheme,
  useSaveMyTheme,
  useThemePreference,
  type ThemeId,
} from "@/lib/theme";
import { cn } from "@/lib/utils";

function useThemeActions() {
  const t = useT();
  const { themeId } = useThemePreference();
  const saveMine = useSaveMyTheme();
  const saveCompany = useSaveCompanyTheme();

  const choose = (id: ThemeId | null) =>
    saveMine.mutate(id, {
      onSuccess: () => toast.success(t("theme.saved")),
      onError: (err) => toast.error(t("theme.saveFailed"), errorMessage(err)),
    });

  const makeCompanyDefault = () =>
    saveCompany.mutate(themeId, {
      onSuccess: () => toast.success(t("theme.companySaved")),
      onError: (err) => toast.error(t("theme.saveFailed"), errorMessage(err)),
    });

  return { themeId, choose, makeCompanyDefault, saveMine, saveCompany };
}

/** Theme swatch grid plus "use default" / "company default" actions. */
export function ThemeOptions({ columns = 2 }: { columns?: 2 | 3 }) {
  const t = useT();
  const me = useAuth((s) => s.me);
  const { themeId, choose, makeCompanyDefault, saveMine, saveCompany } = useThemeActions();

  return (
    <div className="space-y-3">
      <div
        className={cn("grid grid-cols-1 gap-3 sm:grid-cols-2", columns === 3 && "lg:grid-cols-3")}
        role="radiogroup"
        aria-label={t("theme.title")}
      >
        {THEME_CATALOG.map((theme) => {
          const active = theme.id === themeId;
          return (
            <button
              key={theme.id}
              type="button"
              role="radio"
              aria-checked={active}
              data-testid={`theme-option-${theme.id}`}
              onClick={() => choose(theme.id)}
              disabled={saveMine.isPending}
              className={cn(
                "group flex flex-col overflow-hidden rounded-[var(--radius-md)] border text-start transition-all cursor-pointer",
                active
                  ? "border-[var(--color-primary)] ring-2 ring-[var(--color-primary-ring)]"
                  : "border-[var(--color-border)] hover:border-[var(--color-input-hover)]"
              )}
            >
              {/* data-theme scopes the preset's tokens to this preview only */}
              <div className="flex h-16" aria-hidden="true" data-theme={theme.id}>
                <div className="gradient-sidebar w-1/4" />
                <div className="flex flex-1 flex-col justify-center gap-2 bg-[var(--color-background)] px-3">
                  <div className="h-2.5 w-3/4 rounded-full bg-[var(--color-primary)]" />
                  <div className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-[var(--color-accent)]" />
                    <span className="h-1.5 w-1/2 rounded-full bg-[var(--color-border)]" />
                  </div>
                </div>
              </div>
              <div className="flex items-start gap-2 bg-[var(--color-card)] px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-[var(--color-foreground)]">{theme.name}</p>
                  <p className="text-xs text-[var(--color-muted-foreground)]">{theme.description}</p>
                </div>
                {active ? (
                  <Check size={16} className="mt-0.5 shrink-0 text-[var(--color-primary)]" aria-hidden="true" />
                ) : null}
              </div>
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={() => choose(null)} disabled={saveMine.isPending}>
          {t("theme.useDefault")}
        </Button>
        {isAdmin(me) ? (
          <Button
            variant="secondary"
            onClick={makeCompanyDefault}
            disabled={saveCompany.isPending}
            data-testid="btn-theme-company-default"
          >
            {t("theme.setCompanyDefault")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** Labeled sidebar button showing the current theme; opens the theme dialog. */
export function ThemePicker({ className }: { className?: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const { themeId } = useThemePreference();
  const current = THEME_CATALOG.find((theme) => theme.id === themeId);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={t("theme.open")}
        aria-label={t("theme.open")}
        data-testid="btn-theme-picker"
        className={cn(
          "inline-flex h-8 min-w-0 max-w-[8.5rem] items-center gap-1.5 rounded-full border border-[var(--color-sidebar-border)] bg-[var(--color-sidebar-accent)] px-3 text-xs font-semibold text-[var(--color-sidebar-foreground)] transition-colors hover:text-[var(--color-sidebar-active)] cursor-pointer",
          className
        )}
      >
        <Palette size={14} aria-hidden="true" className="shrink-0 text-[var(--color-sidebar-indicator)]" />
        <span className="truncate" data-testid="text-current-theme">{current?.name ?? t("theme.title")}</span>
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t("theme.title")}
        description={t("theme.hint")}
        wide
      >
        <ThemeOptions columns={3} />
      </Dialog>
    </>
  );
}
