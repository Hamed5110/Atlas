"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Pencil, Plus, ShieldCheck, Trash2, UserCog } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { EmptyState, ErrorState, PageHeader } from "@/components/ui/primitives";
import { TableSkeleton } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { api, errorMessage } from "@/lib/api";
import { fmtDateTime, initials, titleCase } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { Employee, UserRow } from "@/lib/types";
import { ExcelToolbar } from "@/components/excel-toolbar";

const ROLES = [
  {
    id: "SYSTEM_ADMIN",
    label: "System Admin",
    description: "Everything, including users, settings, backups, WhatsApp setup and AI repairs.",
  },
  {
    id: "HR_MANAGER",
    label: "HR Manager",
    description: "Employees, opening balances, allocation, HR letters, attendance and ESS approvals.",
  },
  {
    id: "FINANCE_MANAGER",
    label: "Finance Manager",
    description: "Loans and EMI, finance ledger, reports, payroll export and audit views.",
  },
  {
    id: "EMPLOYEE",
    label: "Employee",
    description: "Self-service only: own requests and balances. Link the employee record below.",
  },
] as const;

function UsersPage() {
  const t = useT();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [deleting, setDeleting] = useState<UserRow | null>(null);
  const [form, setForm] = useState({
    username: "",
    display_name: "",
    password: "",
    roles: new Set<string>(["EMPLOYEE"]),
    employee_id: "",
    active: true,
  });

  const users = useQuery({ queryKey: ["users"], queryFn: () => api<UserRow[]>("/users") });
  const customRoles = useQuery({
    queryKey: ["roles"],
    queryFn: () =>
      api<{ custom: Array<{ code: string; name: string; description: string; active: boolean }> }>("/roles"),
  });
  const roleOptions = [
    ...ROLES,
    ...(customRoles.data?.custom ?? [])
      .filter((r) => r.active)
      .map((r) => ({ id: r.code, label: r.name, description: r.description || "Custom role" })),
  ];
  const roleLabel = (code: string) => roleOptions.find((r) => r.id === code)?.label ?? titleCase(code);
  const employees = useQuery({
    queryKey: ["employees", "all"],
    queryFn: () => api<Employee[]>("/employees?limit=500"),
  });

  const openCreate = () => {
    setEditing(null);
    setForm({
      username: "",
      display_name: "",
      password: "",
      roles: new Set(["EMPLOYEE"]),
      employee_id: "",
      active: true,
    });
    setShowForm(true);
  };

  const openEdit = (u: UserRow) => {
    setEditing(u);
    setForm({
      username: u.username,
      display_name: u.display_name || u.full_name || "",
      password: "",
      roles: new Set(u.roles),
      employee_id: u.employee_id || "",
      active: u.active ?? u.is_active ?? true,
    });
    setShowForm(true);
  };

  const saveMutation = useMutation({
    mutationFn: () => {
      if (editing) {
        const body: Record<string, unknown> = {
          display_name: form.display_name.trim(),
          roles: [...form.roles],
          employee_id: form.employee_id || null,
          active: form.active,
        };
        if (form.password.trim()) body.password = form.password;
        return api(`/users/${editing.id}`, { method: "PUT", body });
      }
      return api("/users", {
        method: "POST",
        body: {
          username: form.username.trim(),
          password: form.password,
          display_name: form.display_name.trim(),
          roles: [...form.roles],
          employee_id: form.employee_id || null,
        },
      });
    },
    onSuccess: () => {
      toast.success(editing ? "User updated" : "User created");
      setShowForm(false);
      setEditing(null);
      queryClient.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (err) => toast.error("Save failed", errorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: (u: UserRow) => api(`/users/${u.id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("User deleted");
      setDeleting(null);
      queryClient.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (err) => toast.error("Delete failed", errorMessage(err)),
  });

  const toggleRole = (role: string) =>
    setForm((f) => {
      const next = new Set(f.roles);
      if (next.has(role)) next.delete(role);
      else next.add(role);
      return { ...f, roles: next };
    });

  const missing = [
    !editing && !form.username.trim() ? "username" : null,
    !form.display_name.trim() ? "display name" : null,
    !editing && form.password.length < 12 ? "password (12+ characters)" : null,
    editing && form.password && form.password.length < 12 ? "password (12+ characters)" : null,
    form.roles.size === 0 ? "at least one role" : null,
  ].filter(Boolean);
  const canSave = missing.length === 0;

  return (
    <div className="animate-[fade-in_0.3s_ease-out]">
      <PageHeader
        title={t("page.users.title")}
        subtitle={t("page.users.subtitle")}
        actions={
          <>
            <ExcelToolbar dataset="users" />
            <Button variant="gradient" onClick={openCreate}>
              <Plus size={15} /> New user
            </Button>
          </>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Accounts</CardTitle>
          <CardDescription>{users.data?.length ?? 0} users</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {users.isPending ? (
            <TableSkeleton label={t("state.loading")} />
          ) : users.isError ? (
            <ErrorState error={users.error} onRetry={users.refetch} />
          ) : (users.data ?? []).length === 0 ? (
            <EmptyState icon={<UserCog size={22} />} title="No users" />
          ) : (
            <Table stickyFirst cards className="min-w-[44rem]">
              <THead>
                <TR>
                  <TH>User</TH>
                  <TH>Roles</TH>
                  <TH>Status</TH>
                  <TH>Last sign-in</TH>
                  <TH>Security</TH>
                  <TH className="text-end">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {(users.data ?? []).map((u) => {
                  const name = u.display_name || u.full_name || u.username;
                  const active = u.active ?? u.is_active ?? false;
                  return (
                    <TR key={u.id}>
                      <TD>
                        <div className="flex items-center gap-3">
                          <div className="gradient-hero flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white">
                            {initials(name)}
                          </div>
                          <div>
                            <p className="font-semibold">{name}</p>
                            <p className="text-xs font-mono text-[var(--color-muted-foreground)]">@{u.username}</p>
                          </div>
                        </div>
                      </TD>
                      <TD>
                        <div className="flex flex-wrap gap-1">
                          {u.roles.map((role) => (
                            <Badge key={role} variant={role === "SYSTEM_ADMIN" ? "default" : "secondary"}>
                              {roleLabel(role)}
                            </Badge>
                          ))}
                        </div>
                      </TD>
                      <TD>
                        <Badge variant={active ? "success" : "secondary"}>
                          {active ? "Active" : "Disabled"}
                        </Badge>
                      </TD>
                      <TD className="text-xs text-[var(--color-muted-foreground)]">
                        {u.last_login_at ? fmtDateTime(u.last_login_at) : "Never"}
                      </TD>
                      <TD>
                        {u.locked_until ? (
                          <Badge variant="destructive">Locked</Badge>
                        ) : (u.failed_login_count ?? 0) > 0 ? (
                          <Badge variant="warning">{u.failed_login_count} failed</Badge>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-success)]">
                            <ShieldCheck size={13} aria-hidden /> Clear
                          </span>
                        )}
                      </TD>
                      <TD className="text-end">
                        <div className="inline-flex flex-nowrap justify-end gap-1.5" role="group" aria-label={`Actions for ${u.username}`}>
                          <Button variant="ghost" size="icon-sm" onClick={() => openEdit(u)} title="Edit" aria-label={`Edit ${u.username}`}>
                            <Pencil size={15} aria-hidden="true" />
                          </Button>
                          <Button variant="ghost" size="icon-sm" onClick={() => setDeleting(u)} title="Delete" aria-label={`Delete ${u.username}`}>
                            <Trash2 size={15} className="text-[var(--color-destructive)]" aria-hidden="true" />
                          </Button>
                        </div>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={showForm}
        onClose={() => setShowForm(false)}
        title={editing ? `Edit ${editing.username}` : "New user"}
        description={editing ? "Leave password blank to keep the current password" : "Minimum password length is 12 characters"}
        footer={
          <>
            {!canSave ? (
              <p className="me-auto text-xs text-[var(--color-muted-foreground)]" data-testid="text-user-missing">
                Enter {missing.join(", ")}
              </p>
            ) : null}
            <Button variant="ghost" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
            <Button
              variant="gradient"
              disabled={!canSave || saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
            >
              {saveMutation.isPending ? t("state.saving") : editing ? "Save changes" : "Create user"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Username">
              <Input
                className="font-mono"
                autoComplete="off"
                value={form.username}
                disabled={Boolean(editing)}
                onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
              />
            </Field>
            <Field label="Display name">
              <Input
                value={form.display_name}
                onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))}
              />
            </Field>
            <Field
              label={editing ? "New password (optional)" : "Temporary password"}
              hint={`${form.password.length}/12 minimum`}
              className="col-span-2"
            >
              <Input
                type="password"
                autoComplete="new-password"
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              />
            </Field>
            <Field label="Link employee (optional)" className="col-span-2">
              <select
                value={form.employee_id}
                onChange={(e) => setForm((f) => ({ ...f, employee_id: e.target.value }))}
                className="h-10 w-full rounded-[var(--radius-sm)] border border-[var(--color-input)] bg-white px-3 text-sm"
              >
                <option value="">Not linked</option>
                {(employees.data ?? []).map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.code} — {e.full_name}
                  </option>
                ))}
              </select>
            </Field>
            {editing ? (
              <Field label="Status" className="col-span-2">
                <select
                  value={form.active ? "true" : "false"}
                  onChange={(e) => setForm((f) => ({ ...f, active: e.target.value === "true" }))}
                  className="h-10 w-full rounded-[var(--radius-sm)] border border-[var(--color-input)] bg-white px-3 text-sm"
                >
                  <option value="true">Active</option>
                  <option value="false">Disabled</option>
                </select>
              </Field>
            ) : null}
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
              Roles <span className="text-[var(--color-destructive)]">*</span>
              <span className="ms-2 font-normal normal-case tracking-normal">
                Pick one or more — the user only sees screens their roles allow. Custom roles are made on Roles &amp; Permissions.
              </span>
            </p>
            <div className="grid gap-2 sm:grid-cols-2" role="group" aria-label="Roles">
              {roleOptions.map((role) => {
                const selected = form.roles.has(role.id);
                return (
                  <button
                    key={role.id}
                    type="button"
                    aria-pressed={selected}
                    data-testid={`role-${role.id}`}
                    onClick={() => toggleRole(role.id)}
                    className={cn(
                      "flex items-start gap-2 rounded-[var(--radius-md)] border p-3 text-start transition-colors cursor-pointer",
                      selected
                        ? "border-[var(--color-primary)] bg-[var(--color-primary-muted)]"
                        : "border-[var(--color-border)] bg-[var(--color-card)] hover:border-[var(--color-input-hover)]"
                    )}
                  >
                    <span
                      className={cn(
                        "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                        selected
                          ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-[var(--color-primary-foreground)]"
                          : "border-[var(--color-input)]"
                      )}
                      aria-hidden="true"
                    >
                      {selected ? <Check size={12} /> : null}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">{role.label}</span>
                      <span className="block text-xs text-[var(--color-muted-foreground)]">{role.description}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && deleteMutation.mutate(deleting)}
        title="Delete user?"
        message={`Remove account @${deleting?.username}? Active sessions will be revoked.`}
        confirmLabel="Delete"
        destructive
        busy={deleteMutation.isPending}
      />
    </div>
  );
}

export default UsersPage;
