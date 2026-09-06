"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, ShieldCheck, Trash2, UserCog } from "lucide-react";
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
import { cn } from "@/lib/utils";
import type { Employee, UserRow } from "@/lib/types";

const ROLES = ["SYSTEM_ADMIN", "HR_MANAGER", "FINANCE_MANAGER", "EMPLOYEE"] as const;

function UsersPage() {
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

  const canSave = editing
    ? form.display_name.trim().length > 0 && form.roles.size > 0 && (!form.password || form.password.length >= 12)
    : form.username.trim() && form.display_name.trim() && form.password.length >= 12 && form.roles.size > 0;

  return (
    <div className="animate-[fade-in_0.3s_ease-out]">
      <PageHeader
        title="Users & Access"
        subtitle="Accounts, roles, and security posture"
        actions={
          <Button variant="gradient" onClick={openCreate}>
            <Plus size={15} /> New user
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Accounts</CardTitle>
          <CardDescription>{users.data?.length ?? 0} users</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {users.isPending ? (
            <TableSkeleton />
          ) : users.isError ? (
            <ErrorState error={users.error} onRetry={users.refetch} />
          ) : (users.data ?? []).length === 0 ? (
            <EmptyState icon={<UserCog size={22} />} title="No users" />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>User</TH>
                  <TH>Roles</TH>
                  <TH>Status</TH>
                  <TH>Last sign-in</TH>
                  <TH>Security</TH>
                  <TH className="text-right">Actions</TH>
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
                              {titleCase(role)}
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
                            <ShieldCheck size={13} /> Clear
                          </span>
                        )}
                      </TD>
                      <TD className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" onClick={() => openEdit(u)} title="Edit">
                            <Pencil size={15} />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => setDeleting(u)} title="Delete">
                            <Trash2 size={15} className="text-[var(--color-destructive)]" />
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
            <Button variant="ghost" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
            <Button
              variant="gradient"
              disabled={!canSave || saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
            >
              {saveMutation.isPending ? "Saving…" : editing ? "Save changes" : "Create user"}
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
              Roles
            </p>
            <div className="flex flex-wrap gap-2">
              {ROLES.map((role) => (
                <button
                  key={role}
                  type="button"
                  onClick={() => toggleRole(role)}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-semibold ring-1",
                    form.roles.has(role)
                      ? "bg-[var(--color-primary-muted)] text-[var(--color-primary)] ring-[hsl(243_75%_59%/0.35)]"
                      : "bg-white text-[var(--color-muted-foreground)] ring-[var(--color-border)]"
                  )}
                >
                  {titleCase(role)}
                </button>
              ))}
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
