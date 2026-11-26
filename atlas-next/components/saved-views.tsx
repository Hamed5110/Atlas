"use client";

import { Bookmark, BookmarkPlus, Check, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "@/components/ui/toast";
import { useAuth } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { sameFilters, useSavedViews, type ViewFilters } from "@/lib/saved-views";
import { cn } from "@/lib/utils";

const chip =
  "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors cursor-pointer";

export function SavedViews({
  scope,
  filters,
  defaults,
  onApply,
}: {
  scope: string;
  filters: ViewFilters;
  defaults: ViewFilters;
  onApply: (filters: ViewFilters) => void;
}) {
  const t = useT();
  const user = useAuth((s) => s.me?.id) ?? "anonymous";
  const key = `${user}:${scope}`;
  const views = useSavedViews((s) => s.views[key]) ?? [];
  const save = useSavedViews((s) => s.save);
  const remove = useSavedViews((s) => s.remove);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");

  useEffect(() => {
    void useSavedViews.persist.rehydrate();
  }, []);

  const isDefault = sameFilters(filters, defaults);
  const commit = () => {
    const label = name.trim();
    if (!label) return;
    if (!save(key, label, filters)) {
      toast.warning(t("views.limit"));
      return;
    }
    toast.success(t("views.saved"), label);
    setName("");
    setNaming(false);
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid={`saved-views-${scope}`}>
      <Bookmark size={14} className="text-[var(--color-muted-foreground)]" aria-hidden="true" />
      <button
        type="button"
        onClick={() => onApply(defaults)}
        aria-pressed={isDefault}
        className={cn(
          chip,
          isDefault
            ? "border-[var(--color-primary)] bg-[var(--color-primary-muted)] text-[var(--color-primary-emphasis)]"
            : "border-[var(--color-border)] hover:bg-[var(--color-muted)]"
        )}
      >
        {t("views.all")}
      </button>
      {views.map((view) => {
        const active = !isDefault && sameFilters(filters, view.filters);
        return (
          <span
            key={view.id}
            className={cn(
              chip,
              "pe-1",
              active
                ? "border-[var(--color-primary)] bg-[var(--color-primary-muted)] text-[var(--color-primary-emphasis)]"
                : "border-[var(--color-border)] hover:bg-[var(--color-muted)]"
            )}
          >
            <button type="button" onClick={() => onApply({ ...defaults, ...view.filters })} aria-pressed={active} className="cursor-pointer">
              {view.name}
            </button>
            <button
              type="button"
              onClick={() => remove(key, view.id)}
              aria-label={`${t("views.delete")} ${view.name}`}
              className="rounded-full p-0.5 hover:bg-[var(--color-card)] cursor-pointer"
            >
              <X size={11} aria-hidden="true" />
            </button>
          </span>
        );
      })}
      {naming ? (
        <span className="inline-flex items-center gap-1">
          <input
            autoFocus
            value={name}
            maxLength={40}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") setNaming(false);
            }}
            placeholder={t("views.name")}
            data-testid={`saved-views-name-${scope}`}
            className="h-7 w-36 rounded-full border border-[var(--color-border)] bg-[var(--color-card)] px-3 text-xs outline-none focus:border-[var(--color-primary)]"
          />
          <button type="button" onClick={commit} aria-label={t("views.save")} className={cn(chip, "border-[var(--color-border)] px-1.5")}>
            <Check size={12} aria-hidden="true" />
          </button>
        </span>
      ) : isDefault ? null : (
        <button
          type="button"
          onClick={() => setNaming(true)}
          data-testid={`saved-views-add-${scope}`}
          className={cn(chip, "border-dashed border-[var(--color-border)] text-[var(--color-primary)] hover:bg-[var(--color-muted)]")}
        >
          <BookmarkPlus size={12} aria-hidden="true" /> {t("views.save")}
        </button>
      )}
    </div>
  );
}
