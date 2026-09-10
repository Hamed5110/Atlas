import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Pencil, Plus, Trash2, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { ImportPanel } from "@/components/ImportPanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { EmptyState, ErrorState, PageHeader, SearchInput } from "@/components/ui/primitives";
import { TableSkeleton } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { api, download } from "@/lib/api";
import { fmtDate, initials, money } from "@/lib/format";
import type { Company, Employee } from "@/lib/types";

interface EmployeeForm {
  code: string;
  full_name: string;
  join_date: string;
  department: string;
  branch: string;
  pay_group: string;
  email: string;
  custom_airfare_rate: string;
  max_entitlement_cap_rate: string;
}

const EMPTY_FORM: EmployeeForm = {
  code: "",
  full_name: "",
  join_date: "",
  department: "",
  branch: "",
  pay_group: "",
  email: "",
  custom_airfare_rate: "",
  max_entitlement_cap_rate: "",
};

export function EmployeesPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [deleting, setDeleting] = useState<Employee | null>(null);
  const [form, setForm] = useState<EmployeeForm>(EMPTY_FORM);

  const employees = useQuery({
    queryKey: ["employees", "all"],
    queryFn: () => api<Employee[]>("/employees?limit=500"),
  });
  const companies = useQuery({
    queryKey: ["companies"],
    queryFn: () => api<Company[]>("/companies"),
  });

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return employees.data ?? [];
    return (employees.data ?? []).filter((e) =>
      [e.code, e.full_name, e.department, e.branch, e.email]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(term))
    );
  }, [employees.data, search]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  };

  const openEdit = (e: Employee) => {
    setEditing(e);
    setForm({
      code: e.code,
      full_name: e.full_name,
      join_date: e.join_date,
      department: e.department ?? "",
      branch: e.branch ?? "",
      pay_group: e.pay_group ?? "",
      email: e.email ?? "",
      custom_airfare_rate: e.custom_airfare_rate ?? "",
      max_entitlement_cap_rate: e.max_entitlement_cap_rate ?? "",
    });
    setShowForm(true);
  };

  const saveMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      editing
        ? api(`/employees/${editing.id}`, { method: "PUT", body: payload, headers: { "If-Match": String(editing.version) } })
        : api("/employees", { method: "POST", body: payload }),
    onSuccess: () => {
      toast.success(editing ? "Employee updated" : "Employee created");
      setShowForm(false);
      queryClient.invalidateQueries({ queryKey: ["employees"] });
    },
    onError: (err) => toast.error("Save failed", err instanceof Error ? err.message : undefined),
  });

  const deleteMutation = useMutation({
    mutationFn: (e: Employee) => api(`/employees/${e.id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Employee removed");
      setDeleting(null);
      queryClient.invalidateQueries({ queryKey: ["employees"] });
    },
    onError: (err) => toast.error("Delete failed", err instanceof Error ? err.message : undefined),
  });

  const save = () => {
    const companyId = companies.data?.[0]?.id;
    if (!companyId) {
      toast.error("No company", "Create a company first.");
      return;
    }
    saveMutation.mutate({
      code: form.code.trim(),
      full_name: form.full_name.trim(),
      company_id: companyId,
      join_date: form.join_date,
      department: form.department.trim(),
      branch: form.branch.trim(),
      pay_group: form.pay_group.trim(),
      email: form.email.trim() || null,
      custom_airfare_rate: form.custom_airfare_rate ? Number(form.custom_airfare_rate) : null,
      max_entitlement_cap_rate: form.max_entitlement_cap_rate
        ? Number(form.max_entitlement_cap_rate)
        : null,
    });
  };

  const set = (key: keyof EmployeeForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <div className="animate-[fade-in_0.3s_ease-out]">
      <PageHeader
        title="Employees"
        subtitle={`${employees.data?.length ?? 0} profiles in the register`}
        actions={
          <>
            <Button variant="outline" onClick={() => download("/employees/export.xlsx", "employees.xlsx")}>
              <Download size={15} /> Export Excel
            </Button>
            <Button variant="gradient" onClick={openCreate}>
              <Plus size={15} /> New employee
            </Button>
          </>
        }
      />

      <ImportPanel
        title="Bulk import"
        description="Template → fill → verify → import. Only valid rows are written."
        templateName="employees"
        previewPath="/employees/import/preview"
        commitPath="/employees/import/commit"
        columns={[
          { key: "code", label: "Code" },
          { key: "full_name", label: "Full name" },
          { key: "join_date", label: "Join date" },
          { key: "custom_airfare_rate", label: "Custom rate" },
        ]}
        onCommitted={() => queryClient.invalidateQueries({ queryKey: ["employees"] })}
      />

      <Card className="mt-4">
        <CardContent className="p-0">
          <div className="flex items-center justify-between gap-3 p-4 pb-3">
            <SearchInput value={search} onChange={setSearch} placeholder="Search code, name, department…" className="w-80" />
            <Badge variant="secondary">{filtered.length} shown</Badge>
          </div>
          {employees.isPending ? (
            <TableSkeleton />
          ) : employees.isError ? (
            <ErrorState error={employees.error} onRetry={employees.refetch} />
          ) : filtered.length === 0 ? (
            <EmptyState icon={<Users size={22} />} title="No employees found" message="Add one manually or import from Excel." />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Employee</TH>
                  <TH>Joined</TH>
                  <TH>Department</TH>
                  <TH>Pay group</TH>
                  <TH>Custom rate</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((e) => (
                  <TR key={e.id}>
                    <TD>
                      <div className="flex items-center gap-3">
                        <div className="gradient-hero flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white">
                          {initials(e.full_name)}
                        </div>
                        <div>
                          <p className="font-semibold">{e.full_name}</p>
                          <p className="text-xs text-[var(--color-muted-foreground)] font-mono">{e.code}</p>
                        </div>
                      </div>
                    </TD>
                    <TD>{fmtDate(e.join_date)}</TD>
                    <TD>{e.department || "—"}</TD>
                    <TD>{e.pay_group || "—"}</TD>
                    <TD>{e.custom_airfare_rate ? money(e.custom_airfare_rate) : "—"}</TD>
                    <TD>
                      <Badge variant={e.active ? "success" : "secondary"}>
                        {e.active ? "Active" : "Inactive"}
                      </Badge>
                    </TD>
                    <TD className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" onClick={() => openEdit(e)} title="Edit">
                          <Pencil size={15} />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => setDeleting(e)} title="Delete">
                          <Trash2 size={15} className="text-[var(--color-destructive)]" />
                        </Button>
                      </div>
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
        title={editing ? `Edit ${editing.full_name}` : "New employee"}
        description="Compensation profile used by the entitlement engine"
        footer={
          <>
            <Button variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button variant="gradient" disabled={saveMutation.isPending} onClick={save}>
              {saveMutation.isPending ? "Saving…" : editing ? "Save changes" : "Create employee"}
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-4">
          <Field label="Code">
            <Input value={form.code} onChange={set("code")} placeholder="E-1001" className="font-mono" />
          </Field>
          <Field label="Full name">
            <Input value={form.full_name} onChange={set("full_name")} placeholder="Full name" />
          </Field>
          <Field label="Join date">
            <Input type="date" value={form.join_date} onChange={set("join_date")} />
          </Field>
          <Field label="Department">
            <Input value={form.department} onChange={set("department")} placeholder="Finance" />
          </Field>
          <Field label="Branch">
            <Input value={form.branch} onChange={set("branch")} placeholder="Head office" />
          </Field>
          <Field label="Pay group">
            <Input value={form.pay_group} onChange={set("pay_group")} placeholder="Monthly" />
          </Field>
          <Field label="Email">
            <Input type="email" value={form.email} onChange={set("email")} placeholder="name@company.com" />
          </Field>
          <Field label="Custom airfare rate" hint="Overrides group and global rates">
            <Input type="number" min="0" step="0.01" value={form.custom_airfare_rate} onChange={set("custom_airfare_rate")} placeholder="—" />
          </Field>
          <Field label="Entitlement cap rate" hint="Maximum payable amount">
            <Input type="number" min="0" step="0.01" value={form.max_entitlement_cap_rate} onChange={set("max_entitlement_cap_rate")} placeholder="—" />
          </Field>
        </div>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && deleteMutation.mutate(deleting)}
        title="Delete employee"
        message={`Remove ${deleting?.full_name} (${deleting?.code})? Their tickets and loans remain for audit.`}
        confirmLabel="Delete"
        destructive
        busy={deleteMutation.isPending}
      />
    </div>
  );
}
