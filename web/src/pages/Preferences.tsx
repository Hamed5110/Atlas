import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  ImagePlus,
  Layers,
  Save,
  Settings2,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { ErrorState, PageHeader } from "@/components/ui/primitives";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api";
import { useAuth, isAdmin } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

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

interface Company {
  id: string;
  code: string;
  name: string;
  currency: string;
  active: boolean;
  has_logo?: boolean;
  logo_url?: string | null;
}

type DraftMap = Record<string, string | number | boolean>;

function asDisplay(value: string | number | boolean): string {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

export function PreferencesPage() {
  const queryClient = useQueryClient();
  const { me } = useAuth();
  const admin = isAdmin(me);
  const [activeGroup, setActiveGroup] = useState("accrual");
  const [draft, setDraft] = useState<DraftMap>({});
  const [dirty, setDirty] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [currency, setCurrency] = useState("BHD");
  const [showErase, setShowErase] = useState(false);
  const [eraseText, setEraseText] = useState("");

  const settings = useQuery({
    queryKey: ["settings-catalog"],
    queryFn: () => api<{ groups: SettingGroup[] }>("/settings"),
  });

  const companies = useQuery({
    queryKey: ["companies"],
    queryFn: () => api<Company[]>("/companies"),
  });

  const company = companies.data?.[0];

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
    if (settings.data.groups.length && !settings.data.groups.some((g) => g.key === activeGroup)) {
      setActiveGroup(settings.data.groups[0].key);
    }
  }, [settings.data]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!company) return;
    setCompanyName(company.name);
    setCurrency(company.currency);
  }, [company]);

  const groups = settings.data?.groups ?? [];
  const current = useMemo(
    () => groups.find((g) => g.key === activeGroup) ?? groups[0],
    [groups, activeGroup]
  );

  const saveSettings = useMutation({
    mutationFn: () => api("/settings", { method: "PUT", body: { settings: draft } }),
    onSuccess: () => {
      toast.success("Settings saved", "Global rule engine updated.");
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ["settings-catalog"] });
      queryClient.invalidateQueries({ queryKey: ["preferences-effective"] });
    },
    onError: (err) =>
      toast.error("Save failed", err instanceof ApiError ? err.detail : err.message),
  });

  const saveCompany = useMutation({
    mutationFn: () =>
      api(`/companies/${company!.id}`, {
        method: "PATCH",
        body: { name: companyName.trim(), currency: currency.trim().toUpperCase() },
      }),
    onSuccess: () => {
      toast.success("Company profile updated");
      queryClient.invalidateQueries({ queryKey: ["companies"] });
    },
    onError: (err) =>
      toast.error("Company update failed", err instanceof ApiError ? err.detail : err.message),
  });

  const uploadLogo = useMutation({
    mutationFn: async (file: File) => {
      const body = new FormData();
      body.append("file", file);
      return api(`/companies/${company!.id}/logo`, { method: "POST", body });
    },
    onSuccess: () => {
      toast.success("Company logo uploaded");
      queryClient.invalidateQueries({ queryKey: ["companies"] });
    },
    onError: (err) =>
      toast.error("Logo upload failed", err instanceof ApiError ? err.detail : err.message),
  });

  const deleteLogo = useMutation({
    mutationFn: () => api(`/companies/${company!.id}/logo`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Company logo removed");
      queryClient.invalidateQueries({ queryKey: ["companies"] });
    },
    onError: (err) =>
      toast.error("Could not remove logo", err instanceof ApiError ? err.detail : err.message),
  });

  const eraseMutation = useMutation({
    mutationFn: () =>
      api("/admin/erase-data", { method: "POST", body: { confirm: "ERASE_ALL_DATA" } }),
    onSuccess: () => {
      toast.success("Operational data erased", "The action was recorded in the audit log.");
      setShowErase(false);
      setEraseText("");
      queryClient.invalidateQueries();
    },
    onError: (err) =>
      toast.error("Erase failed", err instanceof ApiError ? err.detail : err.message),
  });

  const setValue = (key: string, value: string | number | boolean) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  return (
    <div className="animate-[fade-in_0.3s_ease-out] space-y-6">
      <PageHeader
        title="Preferences & Settings"
        subtitle="Global airfare rule engine — accrual, vesting, carry-forward, booking, cycle, loan recovery, and audit"
        actions={
          admin ? (
            <Button
              variant="gradient"
              disabled={!dirty || saveSettings.isPending}
              onClick={() => saveSettings.mutate()}
            >
              <Save size={15} />
              {saveSettings.isPending ? "Saving…" : "Save settings"}
            </Button>
          ) : null
        }
      />

      {settings.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : settings.isError ? (
        <ErrorState error={settings.error} onRetry={settings.refetch} />
      ) : (
        <div className="grid gap-6 xl:grid-cols-[240px_1fr]">
          <Card className="h-fit">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Settings2 size={16} className="text-[var(--color-primary)]" />
                Rule groups
              </CardTitle>
              <CardDescription>Change one toggle — policy updates company-wide</CardDescription>
            </CardHeader>
            <CardContent className="space-y-1 p-3 pt-0">
              {groups.map((group) => (
                <button
                  key={group.key}
                  type="button"
                  onClick={() => setActiveGroup(group.key)}
                  className={cn(
                    "flex w-full flex-col rounded-[var(--radius-sm)] px-3 py-2.5 text-left transition-colors cursor-pointer",
                    group.key === current?.key
                      ? "bg-[hsl(243_75%_59%/0.12)] text-[var(--color-primary)]"
                      : "hover:bg-[var(--color-secondary)]"
                  )}
                >
                  <span className="text-sm font-semibold">{group.label}</span>
                  <span className="text-[11px] text-[var(--color-muted-foreground)] line-clamp-2">
                    {group.description}
                  </span>
                </button>
              ))}
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
            <CardContent className="space-y-5">
              {(current?.settings ?? []).map((item) => (
                <div
                  key={item.key}
                  className="grid gap-3 border-b border-[var(--color-border)] pb-5 last:border-0 last:pb-0 md:grid-cols-[1fr_220px]"
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold">{item.label}</p>
                      {item.is_default ? (
                        <Badge variant="secondary">Default</Badge>
                      ) : (
                        <Badge variant="info">Custom</Badge>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
                      {item.description}
                    </p>
                    <p className="mt-1 font-mono text-[11px] text-[var(--color-muted-foreground)]">
                      {item.key} · default {asDisplay(item.default)}
                      {item.unit ? ` ${item.unit}` : ""}
                    </p>
                  </div>
                  <div>
                    {item.type === "boolean" ? (
                      <Select
                        disabled={!admin}
                        value={draft[item.key] ? "true" : "false"}
                        onChange={(e) => setValue(item.key, e.target.value === "true")}
                      >
                        <option value="true">Yes</option>
                        <option value="false">No</option>
                      </Select>
                    ) : item.type === "select" ? (
                      <Select
                        disabled={!admin}
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
                          disabled={!admin}
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
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 size={16} className="text-[var(--color-primary)]" />
            Company branding
          </CardTitle>
          <CardDescription>
            Logo appears on allocation prints, offer letters, and employment contracts
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 md:grid-cols-[160px_1fr]">
          <div className="flex h-36 items-center justify-center overflow-hidden rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] bg-[var(--color-secondary)]">
            {company?.has_logo && company.logo_url ? (
              <img
                src={company.logo_url}
                alt={`${company.name} logo`}
                className="max-h-full max-w-full object-contain p-3"
              />
            ) : (
              <div className="text-center text-xs text-[var(--color-muted-foreground)]">
                <ImagePlus className="mx-auto mb-2 opacity-50" size={28} />
                No logo
              </div>
            )}
          </div>
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Company name">
                <Input
                  disabled={!admin}
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                />
              </Field>
              <Field label="Currency">
                <Input
                  disabled={!admin}
                  value={currency}
                  maxLength={3}
                  onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                />
              </Field>
            </div>
            {admin ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  disabled={!company || saveCompany.isPending}
                  onClick={() => saveCompany.mutate()}
                >
                  Save profile
                </Button>
                <label className="inline-flex cursor-pointer">
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) uploadLogo.mutate(file);
                      e.target.value = "";
                    }}
                  />
                  <span
                    className={cn(
                      buttonVariants({ variant: "secondary" }),
                      (!company || uploadLogo.isPending) && "pointer-events-none opacity-50"
                    )}
                  >
                    <ImagePlus size={15} />
                    {uploadLogo.isPending ? "Uploading…" : "Upload logo"}
                  </span>
                </label>
                {company?.has_logo ? (
                  <Button
                    variant="ghost"
                    disabled={deleteLogo.isPending}
                    onClick={() => deleteLogo.mutate()}
                  >
                    <Trash2 size={15} /> Remove logo
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {admin ? (
        <Card className="border-[hsl(0_72%_51%/0.35)]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-[var(--color-destructive)]">
              <ShieldAlert size={16} />
              Danger zone
            </CardTitle>
            <CardDescription>
              Erase all operational data (employees, tickets, loans, balances). Preferences, users,
              and audit history are preserved. Always take a backup first.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="destructive" onClick={() => setShowErase(true)}>
              Erase all operational data
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Dialog
        open={showErase}
        onClose={() => setShowErase(false)}
        title="Erase all operational data"
        description="This is permanent. Type the confirmation phrase to proceed."
        footer={
          <>
            <Button variant="ghost" onClick={() => setShowErase(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={eraseText !== "ERASE_ALL_DATA" || eraseMutation.isPending}
              onClick={() => eraseMutation.mutate()}
            >
              {eraseMutation.isPending ? "Erasing…" : "Erase everything"}
            </Button>
          </>
        }
      >
        <p className="mb-3 text-sm">
          Type{" "}
          <span className="rounded bg-[var(--color-secondary)] px-1.5 py-0.5 font-mono text-xs font-bold">
            ERASE_ALL_DATA
          </span>{" "}
          to confirm:
        </p>
        <Input
          value={eraseText}
          onChange={(e) => setEraseText(e.target.value)}
          className="font-mono"
          placeholder="ERASE_ALL_DATA"
        />
      </Dialog>
    </div>
  );
}
