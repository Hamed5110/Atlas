import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, ShieldCheck, UserCog } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { EmptyState, ErrorState, PageHeader } from "@/components/ui/primitives";
import { TableSkeleton } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { fmtDateTime, initials, titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Employee, UserRow } from "@/lib/types";

const ROLES = ["SYSTEM_ADMIN", "HR_MANAGER", "FINANCE_MANAGER", "EMPLOYEE"] as const;

export function UsersPage() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    username: "",
    display_name: "",
    password: "",
    roles: new Set<string>(["EMPLOYEE"]),
    employee_id: "",
  });

  const users = useQuery({ queryKey: ["users"], queryFn: () => api<UserRow[]>("/users") });
  const employees = useQuery({
    queryKey: ["employees", "all"],
    queryFn: () => api<Employee[]>("/employees?limit=500"),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      api("/users", {
        method: "POST",
        body: {
          username: form.username.trim(),
          password: form.password,
          display_name: form.display_name.trim(),
          roles: [...form.roles],
          employee_id: form.employee_id || null,
        },
      }),
    onSuccess: () => {
      toast.success("User created", "They will be asked to change the temporary password.");
      setShowForm(false);
      queryClient.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (err) => toast.error("Create failed", err instanceof Error ? err.message : undefined),
  });

  const toggleRole = (role: string) =>
    setForm((f) => {
      const next = new Set(f.roles);
      if (next.has(role)) next.delete(role);
      else next.add(role);
      return { ...f, roles: next };
    });

  return (
    <div className="animate-[fade-in_0.3s_ease-out]">
      <PageHeader
        title="Users & Access"
        subtitle="Accounts, roles, and security posture"
        actions={
          <Button variant="gradient" onClick={() => setShowForm(true)}>
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
                </TR>
              </THead>
              <TBody>
                {(users.data ?? []).map((u) => (
                  <TR key={u.id}>
                    <TD>
                      <div className="flex items-center gap-3">
                        <div className="gradient-hero flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white">
                          {initials(u.full_name || u.username)}
                        </div>
                        <div>
                          <p className="font-semibold">{u.full_name}</p>
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
                      <Badge variant={u.is_active ? "success" : "secondary"}>
                        {u.is_active ? "Active" : "Disabled"}
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
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={showForm}
        onClose={() => setShowForm(false)}
        title="New user"
        description="Minimum password length is 12 characters"
        footer={
          <>
            <Button variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button
              variant="gradient"
              disabled={createMutation.isPending || form.password.length < 12 || form.roles.size === 0}
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending ? "Creating…" : "Create user"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Username">
              <Input className="font-mono" autoComplete="off" value={form.username} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} />
            </Field>
            <Field label="Display name">
              <Input value={form.display_name} onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))} />
            </Field>
            <Field label="Temporary password" hint={`${form.password.length}/12 minimum`} className="col-span-2">
              <Input type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} />
            </Field>
            <Field label="Link employee (optional)" className="col-span-2">
              <select
                value={form.employee_id}
                onChange={(e) => setForm((f) => ({ ...f, employee_id: e.target.value }))}
                className="h-10 w-full rounded-[var(--radius-sm)] border border-[var(--color-input)] bg-white px-3 text-sm"
              >
                <option value="">Not linked</option>
                {(employees.data ?? []).map((e) => (
                  <option key={e.id} value={e.id}>{e.code} — {e.full_name}</option>
                ))}
              </select>
            </Field>
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">Roles</p>
            <div className="flex flex-wrap gap-2">
              {ROLES.map((role) => (
                <button
                  key={role}
                  onClick={() => toggleRole(role)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs font-bold transition-all cursor-pointer",
                    form.roles.has(role)
                      ? "border-[var(--color-primary)] bg-[var(--color-primary-muted)] text-[var(--color-primary)]"
                      : "border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:border-[hsl(243_75%_75%)]"
                  )}
                >
                  {titleCase(role)}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
