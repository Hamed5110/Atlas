"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarClock,
  Coins,
  HandCoins,
  Layers,
  RotateCcw,
  Save,
  ShieldCheck,
  Timer,
  Wallet,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { ErrorState, PageHeader } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { CompanyProfileCard } from "@/components/company-profile-card";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

interface SettingOption {
  value: string;
  label: string;
}

interface SettingItem {
  key: string;
  label: string;
  type: "boolean" | "integer" | "decimal" | "select";
  value: string | number | boolean;
  default: string | number | boolean;
  description: string;
  options: SettingOption[];
  minimum: number | null;
  maximum: number | null;
  unit: string;
  is_default: boolean;
}

interface SettingGroup {
  key: string;
  label: string;
  description: string;
  settings: SettingItem[];
}

type DraftMap = Record<string, string | number | boolean>;

const GROUP_ICONS: Record<string, typeof Timer> = {
  accrual: Timer,
  vesting: ShieldCheck,
  carryforward: RotateCcw,
  booking: Wallet,
  cycle: CalendarClock,
  recovery: HandCoins,
  audit: ShieldCheck,
};

function asDisplay(value: string | number | boolean): string {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-6 w-11 shrink-0 rounded-full transition-colors cursor-pointer",
        checked ? "bg-[var(--color-primary)]" : "bg-[hsl(220_13%_82%)]"
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all",
          checked ? "left-[1.375rem]" : "left-0.5"
        )}
      />
    </button>
  );
}

function SettingsPage() {
  const queryClient = useQueryClient();
  const [activeGroup, setActiveGroup] = useState("accrual");
  const [draft, setDraft] = useState<DraftMap>({});
  const [dirty, setDirty] = useState(false);

  const settings = useQuery({
    queryKey: ["settings-catalog"],
    queryFn: () => api<{ groups: SettingGroup[] }>("/settings"),
  });

  useEffect(() => {
    if (!settings.data) return;
    const next: DraftMap = {};
    for (const group of settings.data.groups) {
      for (const item of group.settings) {
        next[item.key] = item.value;
      }
    }
    setDraft(next);
    setDirty(false);
    if (
      settings.data.groups.length &&
      !settings.data.groups.some((g) => g.key === activeGroup)
    ) {
      setActiveGroup(settings.data.groups[0].key);
    }
  }, [settings.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const groups = settings.data?.groups ?? [];
  const current = useMemo(
    () => groups.find((g) => g.key === activeGroup) ?? groups[0],
    [groups, activeGroup]
  );

  const dirtyCount = useMemo(() => {
    if (!settings.data) return 0;
    let count = 0;
    for (const group of settings.data.groups) {
      for (const item of group.settings) {
        if (String(draft[item.key] ?? "") !== String(item.value ?? "")) count += 1;
      }
    }
    return count;
  }, [draft, settings.data]);

  const save = useMutation({
    mutationFn: () => api("/settings", { method: "PUT", body: { settings: draft } }),
    onSuccess: () => {
      toast.success("Settings saved", "Global rule engine updated.");
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ["settings-catalog"] });
      queryClient.invalidateQueries({ queryKey: ["preferences"] });
    },
    onError: (error) =>
      toast.error("Save failed", error instanceof ApiError ? error.detail : undefined),
  });

  const setValue = (key: string, value: string | number | boolean) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  const discard = () => {
    if (!settings.data) return;
    const next: DraftMap = {};
    for (const group of settings.data.groups) {
      for (const item of group.settings) {
        next[item.key] = item.value;
      }
    }
    setDraft(next);
    setDirty(false);
  };

  if (settings.isError) {
    return <ErrorState error={settings.error} onRetry={settings.refetch} />;
  }

  return (
    <div className="space-y-6 animate-[fade-in_0.25s_ease-out]">
      <PageHeader
        title="Settings"
        subtitle="The global rule engine — every change applies to entitlement calculations immediately"
        actions={
          <>
            <Button variant="ghost" disabled={!dirty || save.isPending} onClick={discard}>
              <RotateCcw size={15} /> Discard
            </Button>
            <Button
              variant="gradient"
              disabled={!dirty || save.isPending}
              onClick={() => save.mutate()}
            >
              <Save size={15} />
              {save.isPending
                ? "Saving…"
                : dirtyCount
                  ? `Save ${dirtyCount} change${dirtyCount === 1 ? "" : "s"}`
                  : "All saved"}
            </Button>
          </>
        }
      />

      <CompanyProfileCard />

      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <Card className="h-fit lg:sticky lg:top-6">
          <CardContent className="p-2">
            {groups.map((g) => {
              const Icon = GROUP_ICONS[g.key] ?? Coins;
              const dirtyInGroup = g.settings.filter(
                (item) => String(draft[item.key] ?? "") !== String(item.value ?? "")
              ).length;
              return (
                <button
                  key={g.key}
                  type="button"
                  onClick={() => setActiveGroup(g.key)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-[var(--radius-sm)] px-3 py-2.5 text-left transition-colors cursor-pointer",
                    g.key === current?.key
                      ? "bg-[var(--color-primary-muted)] text-[var(--color-primary)]"
                      : "text-[var(--color-foreground)] hover:bg-[var(--color-secondary)]"
                  )}
                >
                  <Icon size={16} className="shrink-0" />
                  <span className="flex-1 truncate text-sm font-semibold">{g.label}</span>
                  {dirtyInGroup ? (
                    <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--color-primary)] px-1 text-[10px] font-bold text-white">
                      {dirtyInGroup}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>{current?.label}</CardTitle>
                <CardDescription>{current?.description}</CardDescription>
              </div>
              <Badge variant="secondary">
                <Layers size={12} className="mr-1" />
                {current?.settings.length ?? 0} settings
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {(current?.settings ?? []).map((item) => {
              const dirtyItem = String(draft[item.key] ?? "") !== String(item.value ?? "");
              return (
                <div
                  key={item.key}
                  className={cn(
                    "flex items-start justify-between gap-6 rounded-[var(--radius-md)] border p-4 transition-colors",
                    dirtyItem
                      ? "border-[hsl(243_75%_59%/0.45)] bg-[var(--color-primary-muted)]"
                      : "border-[var(--color-border)] bg-white"
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-bold text-[var(--color-foreground)]">{item.label}</p>
                      {dirtyItem ? <Badge variant="default">unsaved</Badge> : null}
                      {item.is_default ? (
                        <Badge variant="secondary">Default</Badge>
                      ) : (
                        <Badge variant="info">Custom</Badge>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs leading-relaxed text-[var(--color-muted-foreground)]">
                      {item.description}
                    </p>
                    <p className="mt-1 font-mono text-[11px] text-[var(--color-muted-foreground)]">
                      {item.key} · default {asDisplay(item.default)}
                      {item.unit ? ` ${item.unit}` : ""}
                    </p>
                  </div>
                  <div className="w-64 shrink-0">
                    {item.type === "boolean" ? (
                      <div className="flex justify-end pt-0.5">
                        <Toggle
                          checked={Boolean(draft[item.key])}
                          onChange={(v) => setValue(item.key, v)}
                        />
                      </div>
                    ) : item.type === "select" ? (
                      <Select
                        value={String(draft[item.key] ?? item.default)}
                        onChange={(e) => setValue(item.key, e.target.value)}
                      >
                        {item.options.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          step={item.type === "decimal" ? "0.01" : "1"}
                          min={item.minimum ?? undefined}
                          max={item.maximum ?? undefined}
                          value={String(draft[item.key] ?? "")}
                          onChange={(e) =>
                            setValue(
                              item.key,
                              item.type === "integer"
                                ? Number(e.target.value || 0)
                                : e.target.value
                            )
                          }
                        />
                        {item.unit ? (
                          <span className="shrink-0 text-xs text-[var(--color-muted-foreground)]">
                            {item.unit}
                          </span>
                        ) : null}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default SettingsPage;
