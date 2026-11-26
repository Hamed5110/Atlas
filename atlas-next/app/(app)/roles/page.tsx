"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Lock, Minus, Pencil, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/input";
import { ErrorState, PageHeader } from "@/components/ui/primitives";
import { TableSkeleton } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { api, errorMessage } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { ExcelToolbar } from "@/components/excel-toolbar";

interface ModuleInfo {
  id: string;
  label: string;
  screens: string[];
  endpoints: number;
}

interface RoleInfo {
  code: string;
  name: string;
  description: string;
  users: number;
  builtin: boolean;
  access: Record<string, number>;
  base_roles?: string[];
  denied_modules?: string[];
  active?: boolean;
}

interface RolesResponse {
  builtin: RoleInfo[];
  custom: RoleInfo[];
  modules: ModuleInfo[];
}

interface RoleForm {
  name: string;
  description: string;
  base: Set<string>;
  denied: Set<string>;
  active: boolean;
}

const EMPTY_FORM: RoleForm = {
  name: "",
  description: "",
  base: new Set(["HR_MANAGER"]),
  denied: new Set(),
  active: true,
};

/** Endpoints a role reaches in a module: full, partial, or none. */
function AccessCell({ granted, total }: { granted: number; total: number }) {
  if (!total || granted === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-[var(--color-muted-foreground)]" title="No access">
        <Minus size={14} aria-hidden="true" />
        <span className="sr-only">No access</span>
      </span>
    );
  }
  const full = granted >= total;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs font-semibold",
        full ? "text-[var(--color-success)]" : "text-[var(--color-warning)]"
      )}
      title={`${granted} of ${total} actions`}
    >
      <Check size={14} aria-hidden="true" />
      {full ? "Full" : `${granted}/${total}`}
    </span>
  );
}

function RolesPage() {
  const t = useT();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<RoleInfo | null>(null);
  const [deleting, setDeleting] = useState<RoleInfo | null>(null);
  const [form, setForm] = useState<RoleForm>(EMPTY_FORM);

  const roles = useQuery({ queryKey: ["roles"], queryFn: () => api<RolesResponse>("/roles") });
  const modules = roles.data?.modules ?? [];
  const builtin = roles.data?.builtin ?? [];
  const custom = roles.data?.custom ?? [];

  /** Modules reachable by the chosen base roles: only these can be removed. */
  const baseModules = useMemo(
    () =>
      modules.filter((m) => builtin.some((r) => form.base.has(r.code) && (r.access[m.id] ?? 0) > 0)),
    [modules, builtin, form.base]
  );

  const openCreate = (copyOf?: RoleInfo) => {
    setEditing(null);
    setForm({
      name: copyOf ? `${copyOf.name} (copy)` : "",
      description: copyOf?.description ?? "",
      base: new Set(copyOf ? (copyOf.builtin ? [copyOf.code] : copyOf.base_roles ?? []) : ["HR_MANAGER"]),
      denied: new Set(copyOf?.denied_modules ?? []),
      active: true,
    });
    setOpen(true);
  };

  const openEdit = (role: RoleInfo) => {
    setEditing(role);
    setForm({
      name: role.name,
      description: role.description,
      base: new Set(role.base_roles ?? []),
      denied: new Set(role.denied_modules ?? []),
      active: role.active ?? true,
    });
    setOpen(true);
  };

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: form.name.trim(),
        description: form.description.trim(),
        base_roles: [...form.base],
        denied_modules: [...form.denied].filter((id) => baseModules.some((m) => m.id === id)),
        active: form.active,
      };
      return editing
        ? api(`/roles/${editing.code}`, { method: "PUT", body })
        : api("/roles", { method: "POST", body });
    },
    onSuccess: () => {
      toast.success(
        editing ? "Role updated" : "Role created",
        "Users with this role get the new access at their next sign-in."
      );
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: ["roles"] });
    },
    onError: (err) => toast.error("Save failed", errorMessage(err)),
  });

  const remove = useMutation({
    mutationFn: (role: RoleInfo) => api(`/roles/${role.code}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Role deleted");
      setDeleting(null);
      queryClient.invalidateQueries({ queryKey: ["roles"] });
    },
    onError: (err) => toast.error("Delete failed", errorMessage(err)),
  });

  const toggle = (key: "base" | "denied", id: string) =>
    setForm((f) => {
      const next = new Set(f[key]);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...f, [key]: next };
    });

  const missing = [
    form.name.trim().length < 2 ? "a name" : null,
    form.base.size === 0 ? "at least one built-in role to copy" : null,
  ].filter(Boolean);
  const allRoles = [...builtin, ...custom];

  return (
    <div className="animate-[fade-in_0.3s_ease-out]" data-testid="roles-page">
      <PageHeader
        title={t("page.roles.title")}
        subtitle={t("page.roles.subtitle")}
        actions={
          <>
            <ExcelToolbar dataset="roles" />
            <Button variant="gradient" onClick={() => openCreate()} data-testid="button-new-role">
              <Plus size={15} /> New role
            </Button>
          </>
        }
      />

      {roles.isPending ? (
        <TableSkeleton label={t("state.loading")} />
      ) : roles.isError ? (
        <ErrorState error={roles.error} onRetry={roles.refetch} />
      ) : (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Roles</CardTitle>
              <CardDescription>
                Built-in roles are fixed. Make a custom role by copying the closest built-in role and removing
                what the job does not need — removed modules are blocked by the server, not just hidden.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="roles-list">
              {allRoles.map((role) => (
                <div
                  key={role.code}
                  data-testid={`role-card-${role.code}`}
                  className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 font-semibold">
                        {role.builtin ? <Lock size={13} aria-hidden="true" /> : <ShieldCheck size={13} aria-hidden="true" />}
                        {role.name}
                      </p>
                      <p className="font-mono text-[11px] text-[var(--color-muted-foreground)]">{role.code}</p>
                    </div>
                    <div className="flex shrink-0 flex-wrap justify-end gap-1">
                      <Badge variant={role.builtin ? "secondary" : "default"}>
                        {role.builtin ? "Built-in" : "Custom"}
                      </Badge>
                      {role.active === false ? <Badge variant="warning">Inactive</Badge> : null}
                    </div>
                  </div>
                  <p className="text-xs text-[var(--color-muted-foreground)]">{role.description || "—"}</p>
                  {!role.builtin ? (
                    <p className="text-xs">
                      Copy of {(role.base_roles ?? []).map((c) => builtin.find((b) => b.code === c)?.name ?? c).join(" + ")}
                      {role.denied_modules?.length
                        ? ` · removed: ${role.denied_modules
                            .map((id) => modules.find((m) => m.id === id)?.label ?? id)
                            .join(", ")}`
                        : ""}
                    </p>
                  ) : null}
                  <div className="mt-auto flex items-center justify-between pt-1">
                    <span className="text-xs text-[var(--color-muted-foreground)]">
                      {role.users} user{role.users === 1 ? "" : "s"}
                    </span>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon-sm" title="Copy" aria-label={`Copy ${role.name}`} onClick={() => openCreate(role)}>
                        <Copy size={15} aria-hidden="true" />
                      </Button>
                      {!role.builtin ? (
                        <>
                          <Button variant="ghost" size="icon-sm" title="Edit" aria-label={`Edit ${role.name}`} onClick={() => openEdit(role)}>
                            <Pencil size={15} aria-hidden="true" />
                          </Button>
                          <Button variant="ghost" size="icon-sm" title="Delete" aria-label={`Delete ${role.name}`} onClick={() => setDeleting(role)}>
                            <Trash2 size={15} className="text-[var(--color-destructive)]" aria-hidden="true" />
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Permission matrix</CardTitle>
              <CardDescription>
                Read from the live API: “Full” means every action in the module, a fraction means some actions
                (for example view but not delete).
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table stickyFirst data-testid="permission-matrix">
                <THead>
                  <TR>
                    <TH>Module</TH>
                    {allRoles.map((r) => (
                      <TH key={r.code} className="text-center">
                        {r.name}
                      </TH>
                    ))}
                  </TR>
                </THead>
                <TBody>
                  {modules.map((m) => (
                    <TR key={m.id}>
                      <TD>
                        <p className="font-medium">{m.label}</p>
                        <p className="text-[11px] text-[var(--color-muted-foreground)]">{m.endpoints} actions</p>
                      </TD>
                      {allRoles.map((r) => (
                        <TD key={r.code} className="text-center">
                          <AccessCell granted={r.access[m.id] ?? 0} total={m.endpoints} />
                        </TD>
                      ))}
                    </TR>
                  ))}
                </TBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? `Edit ${editing.name}` : "New role"}
        description="Start from the closest built-in role, then untick modules this job should not use."
        footer={
          <>
            {missing.length ? (
              <p className="me-auto text-xs text-[var(--color-muted-foreground)]" data-testid="text-role-missing">
                Enter {missing.join(", ")}
              </p>
            ) : null}
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="gradient"
              disabled={missing.length > 0 || save.isPending}
              onClick={() => save.mutate()}
              data-testid="button-save-role"
            >
              {save.isPending ? t("state.saving") : editing ? "Save role" : "Create role"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Role name">
              <Input
                value={form.name}
                placeholder="e.g. Payroll Clerk"
                data-testid="input-role-name"
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </Field>
            {editing ? (
              <Field label="Status">
                <select
                  value={form.active ? "true" : "false"}
                  onChange={(e) => setForm((f) => ({ ...f, active: e.target.value === "true" }))}
                  className="h-10 w-full rounded-[var(--radius-sm)] border border-[var(--color-input)] bg-white px-3 text-sm"
                >
                  <option value="true">Active</option>
                  <option value="false">Inactive (grants nothing)</option>
                </select>
              </Field>
            ) : null}
            <Field label="Description" className="sm:col-span-2">
              <Textarea
                rows={2}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </Field>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
              Copy from <span className="text-[var(--color-destructive)]">*</span>
            </p>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Copy from">
              {builtin.map((r) => {
                const on = form.base.has(r.code);
                return (
                  <button
                    key={r.code}
                    type="button"
                    aria-pressed={on}
                    data-testid={`base-${r.code}`}
                    onClick={() => toggle("base", r.code)}
                    className={cn(
                      "h-9 rounded-full border px-3 text-sm font-medium transition-colors cursor-pointer",
                      on
                        ? "border-[var(--color-primary)] bg-[var(--color-primary-muted)] text-[var(--color-primary)]"
                        : "border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:border-[var(--color-input-hover)]"
                    )}
                  >
                    {r.name}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
              Modules this role can use
              <span className="ms-2 font-normal normal-case tracking-normal">Untick to remove.</span>
            </p>
            {baseModules.length === 0 ? (
              <p className="text-xs text-[var(--color-muted-foreground)]">Pick a built-in role first.</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2" role="group" aria-label="Modules">
                {baseModules.map((m) => {
                  const kept = !form.denied.has(m.id);
                  return (
                    <label
                      key={m.id}
                      data-testid={`module-${m.id}`}
                      className={cn(
                        "flex cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] border px-3 py-2 text-sm",
                        kept ? "border-[var(--color-border)]" : "border-dashed border-[var(--color-destructive)] text-[var(--color-muted-foreground)] line-through"
                      )}
                    >
                      <input type="checkbox" checked={kept} onChange={() => toggle("denied", m.id)} />
                      {m.label}
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting)}
        title="Delete role?"
        message={`Delete ${deleting?.name}? Roles still assigned to users cannot be deleted — deactivate them instead.`}
        confirmLabel="Delete"
        destructive
        busy={remove.isPending}
      />
    </div>
  );
}

export default RolesPage;
