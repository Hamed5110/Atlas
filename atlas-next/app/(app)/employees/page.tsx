"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Pencil, Plus, Trash2, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { ImportPanel } from "@/components/import-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { EmptyState, ErrorState, PageHeader, SearchInput } from "@/components/ui/primitives";
import { TableSkeleton } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { api, download, errorMessage } from "@/lib/api";
import { fmtDate, initials } from "@/lib/format";
import { useT } from "@/lib/i18n";
import type { Company, Employee } from "@/lib/types";

interface EmployeeForm {
  code: string;
  full_name: string;
  arabic_name: string;
  join_date: string;
  department: string;
  branch: string;
  pay_group: string;
  repair_center: string;
  designation: string;
  nationality: string;
  origin_country: string;
  passport_no: string;
  passport_expiry: string;
  cpr_no: string;
  visa_no: string;
  visa_expiry: string;
  date_of_birth: string;
  gender: string;
  sub_section: string;
  grade: string;
  reporting_officer_id: string;
  contract_type: string;
  employment_status: string;
  monthly_salary: string;
  probation_end_date: string;
  airline_sector: string;
  travel_class: string;
  last_airticket_date: string;
  email: string;
  custom_airfare_rate: string;
  max_entitlement_cap_rate: string;
  active: boolean;
}

const EMPTY_FORM: EmployeeForm = {
  code: "",
  full_name: "",
  arabic_name: "",
  join_date: "",
  department: "",
  branch: "",
  pay_group: "",
  repair_center: "",
  designation: "",
  nationality: "",
  origin_country: "",
  passport_no: "",
  passport_expiry: "",
  cpr_no: "",
  visa_no: "",
  visa_expiry: "",
  date_of_birth: "",
  gender: "",
  sub_section: "",
  grade: "",
  reporting_officer_id: "",
  contract_type: "",
  employment_status: "active",
  monthly_salary: "",
  probation_end_date: "",
  airline_sector: "",
  travel_class: "",
  last_airticket_date: "",
  email: "",
  custom_airfare_rate: "",
  max_entitlement_cap_rate: "",
  active: true,
};

function toForm(e: Employee): EmployeeForm {
  return {
    code: e.code,
    full_name: e.full_name,
    arabic_name: e.arabic_name ?? "",
    join_date: e.join_date ?? "",
    department: e.department ?? "",
    branch: e.branch ?? "",
    pay_group: e.pay_group ?? "",
    repair_center: e.repair_center ?? "",
    designation: e.designation ?? "",
    nationality: e.nationality ?? "",
    origin_country: e.origin_country ?? "",
    passport_no: e.passport_no ?? "",
    passport_expiry: e.passport_expiry ?? "",
    cpr_no: e.cpr_no ?? "",
    visa_no: e.visa_no ?? "",
    visa_expiry: e.visa_expiry ?? "",
    date_of_birth: e.date_of_birth ?? "",
    gender: e.gender ?? "",
    sub_section: e.sub_section ?? "",
    grade: e.grade ?? "",
    reporting_officer_id: e.reporting_officer_id ?? "",
    contract_type: e.contract_type ?? "",
    employment_status: e.employment_status ?? "active",
    monthly_salary: e.monthly_salary ?? "",
    probation_end_date: e.probation_end_date ?? "",
    airline_sector: e.airline_sector ?? "",
    travel_class: e.travel_class ?? "",
    last_airticket_date: e.last_airticket_date ?? "",
    email: e.email ?? "",
    custom_airfare_rate: e.custom_airfare_rate ?? "",
    max_entitlement_cap_rate: e.max_entitlement_cap_rate ?? "",
    active: e.active,
  };
}

function EmployeesPage() {
  const t = useT();
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
      [
        e.code,
        e.full_name,
        e.arabic_name,
        e.department,
        e.designation,
        e.nationality,
        e.cpr_no,
        e.passport_no,
        e.email,
      ]
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
    setForm(toForm(e));
    setShowForm(true);
  };

  const saveMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      editing
        ? api(`/employees/${editing.id}`, {
            method: "PUT",
            body: payload,
            headers: { "If-Match": String(editing.version) },
          })
        : api("/employees", { method: "POST", body: payload }),
    onSuccess: () => {
      toast.success(editing ? "Employee updated" : "Employee created");
      setShowForm(false);
      queryClient.invalidateQueries({ queryKey: ["employees"] });
    },
    onError: (err) => toast.error("Save failed", errorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: (e: Employee) =>
      api(`/employees/${e.id}`, {
        method: "DELETE",
        headers: { "If-Match": String(e.version) },
      }),
    onSuccess: () => {
      toast.success("Employee removed");
      setDeleting(null);
      queryClient.invalidateQueries({ queryKey: ["employees"] });
    },
    onError: (err) => toast.error("Delete failed", errorMessage(err)),
  });

  const numOrNull = (v: string) => (v.trim() ? Number(v) : null);
  const dateOrNull = (v: string) => (v.trim() ? v : null);

  const save = () => {
    const shared = {
      full_name: form.full_name.trim(),
      arabic_name: form.arabic_name.trim(),
      join_date: form.join_date,
      department: form.department.trim(),
      branch: form.branch.trim(),
      pay_group: form.pay_group.trim(),
      repair_center: form.repair_center.trim(),
      designation: form.designation.trim(),
      nationality: form.nationality.trim(),
      origin_country: form.origin_country.trim(),
      passport_no: form.passport_no.trim(),
      passport_expiry: dateOrNull(form.passport_expiry),
      cpr_no: form.cpr_no.trim(),
      visa_no: form.visa_no.trim(),
      visa_expiry: dateOrNull(form.visa_expiry),
      date_of_birth: dateOrNull(form.date_of_birth),
      gender: form.gender.trim(),
      sub_section: form.sub_section.trim(),
      grade: form.grade.trim(),
      reporting_officer_id: form.reporting_officer_id.trim() || null,
      contract_type: form.contract_type.trim(),
      employment_status: form.employment_status.trim() || "active",
      monthly_salary: numOrNull(form.monthly_salary),
      probation_end_date: dateOrNull(form.probation_end_date),
      airline_sector: form.airline_sector.trim(),
      travel_class: form.travel_class.trim(),
      last_airticket_date: dateOrNull(form.last_airticket_date),
      email: form.email.trim() || null,
      custom_airfare_rate: numOrNull(form.custom_airfare_rate),
      max_entitlement_cap_rate: numOrNull(form.max_entitlement_cap_rate),
      active: form.active,
    };
    if (!shared.full_name || !shared.join_date) {
      toast.error("Missing required fields", "Full name and join date are required.");
      return;
    }
    if (editing) {
      saveMutation.mutate(shared);
      return;
    }
    const companyId = companies.data?.[0]?.id;
    if (!companyId) {
      toast.error("No company", "Create a company first.");
      return;
    }
    if (!form.code.trim()) {
      toast.error("Missing code", "Employee code is required.");
      return;
    }
    saveMutation.mutate({
      ...shared,
      code: form.code.trim(),
      company_id: companyId,
    });
  };

  const set = (key: keyof EmployeeForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <div className="animate-[fade-in_0.3s_ease-out]" data-testid="employee-master-page">
      <PageHeader
        title={t("page.employees.title")}
        subtitle={`${employees.data?.length ?? 0} · ${t("page.employees.subtitle")}`}
        actions={
          <>
            <Button variant="outline" onClick={() => download("/employees/export.xlsx", "employees.xlsx")}>
              <Download size={15} /> Export Excel
            </Button>
            <Button variant="gradient" data-testid="btn-add-employee" onClick={openCreate}>
              <Plus size={15} /> New employee
            </Button>
          </>
        }
      />

      <ImportPanel
        title="Bulk import"
        description="Import Focus Soft Employee Information (or HCM template) → verify → select → INSERT / UPDATE."
        templateName="employees"
        previewPath="/employees/import/preview"
        commitPath="/employees/import/commit"
        columns={[
          { key: "code", label: "Code" },
          { key: "full_name", label: "Name" },
          { key: "join_date", label: "Date of joining" },
          { key: "grade", label: "Job band" },
          { key: "cpr_no", label: "Bahrain ID / CPR" },
          { key: "designation", label: "Designation" },
          { key: "nationality", label: "Nationality" },
          { key: "pay_group", label: "Pay group" },
          { key: "sub_section", label: "Sub section" },
          { key: "department", label: "Department" },
          { key: "reporting_officer_id", label: "Reporting to" },
        ]}
        onCommitted={() => queryClient.invalidateQueries({ queryKey: ["employees"] })}
      />

      <Card className="mt-4">
        <CardContent className="p-0">
          <div className="flex items-center justify-between gap-3 p-4 pb-3">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Search code, name, CPR, passport, department…"
              className="w-96"
            />
            <Badge variant="secondary">{filtered.length} shown</Badge>
          </div>
          {employees.isPending ? (
            <TableSkeleton />
          ) : employees.isError ? (
            <ErrorState error={employees.error} onRetry={employees.refetch} />
          ) : filtered.length === 0 ? (
            <EmptyState icon={<Users size={22} />} title="No employees found" message="Add one manually or import from Excel." />
          ) : (
            <Table data-testid="table-employee-master">
              <THead>
                <TR>
                  <TH>Employee</TH>
                  <TH>Joined</TH>
                  <TH>Job band</TH>
                  <TH>Department</TH>
                  <TH>Sub section</TH>
                  <TH>Designation</TH>
                  <TH>Nationality</TH>
                  <TH>Pay group</TH>
                  <TH>Bahrain ID</TH>
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
                          {e.arabic_name ? (
                            <p className="text-xs text-[var(--color-muted-foreground)]" dir="rtl">
                              {e.arabic_name}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </TD>
                    <TD>{fmtDate(e.join_date)}</TD>
                    <TD className="font-mono text-xs">{e.grade || "—"}</TD>
                    <TD>{e.department || "—"}</TD>
                    <TD>{e.sub_section || "—"}</TD>
                    <TD>{e.designation || "—"}</TD>
                    <TD>{e.nationality || "—"}</TD>
                    <TD>{e.pay_group || "—"}</TD>
                    <TD className="font-mono text-xs">{e.cpr_no || "—"}</TD>
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
        size="full"
        title={editing ? `Edit ${editing.full_name}` : "New employee"}
        description="Employee master aligned with Focus Soft HR fields (identity, employment, travel docs, airfare)"
        footer={
          <>
            <Button variant="ghost" data-testid="btn-cancel-employee" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
            <Button
              variant="gradient"
              disabled={saveMutation.isPending}
              data-testid="btn-save-employee"
              onClick={save}
            >
              {saveMutation.isPending ? "Saving…" : editing ? "Save changes" : "Create employee"}
            </Button>
          </>
        }
      >
        <div className="space-y-5 pr-1">
          <section>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
              Identity
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Code *">
                <Input
                  value={form.code}
                  onChange={set("code")}
                  placeholder="E-1001"
                  className="font-mono"
                  disabled={Boolean(editing)}
                  data-testid="input-employee-id"
                />
              </Field>
              <Field label="Full name *">
                <Input value={form.full_name} onChange={set("full_name")} data-testid="input-employee-name" />
              </Field>
              <Field label="Arabic name">
                <Input value={form.arabic_name} onChange={set("arabic_name")} dir="rtl" data-testid="field-arabicName" />
              </Field>
              <Field label="Gender">
                <Select value={form.gender} onChange={set("gender")} data-testid="field-gender">
                  <option value="">—</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                </Select>
              </Field>
              <Field label="Date of birth">
                <Input type="date" value={form.date_of_birth} onChange={set("date_of_birth")} data-testid="field-dob" />
              </Field>
              <Field label="Nationality">
                <Input value={form.nationality} onChange={set("nationality")} data-testid="field-nationality" />
              </Field>
              <Field label="Origin country">
                <Input value={form.origin_country} onChange={set("origin_country")} />
              </Field>
              <Field label="CPR / Bahrain ID">
                <Input value={form.cpr_no} onChange={set("cpr_no")} data-testid="field-cprId" />
              </Field>
              <Field label="Email">
                <Input type="email" value={form.email} onChange={set("email")} data-testid="field-email" />
              </Field>
            </div>
          </section>

          <section>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
              Employment
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Join date *">
                <Input type="date" value={form.join_date} onChange={set("join_date")} />
              </Field>
              <Field label="Probation end">
                <Input type="date" value={form.probation_end_date} onChange={set("probation_end_date")} />
              </Field>
              <Field label="Department">
                <Input value={form.department} onChange={set("department")} data-testid="field-department" />
              </Field>
              <Field label="Sub section">
                <Input value={form.sub_section} onChange={set("sub_section")} />
              </Field>
              <Field label="Designation / Nature of employment">
                <Input value={form.designation} onChange={set("designation")} />
              </Field>
              <Field label="Grade / Job band">
                <Input value={form.grade} onChange={set("grade")} data-testid="field-grade" />
              </Field>
              <Field label="Reporting to">
                <Input
                  value={form.reporting_officer_id}
                  onChange={set("reporting_officer_id")}
                  placeholder="Manager name or employee code"
                />
              </Field>
              <Field label="Branch">
                <Input value={form.branch} onChange={set("branch")} data-testid="field-branch" />
              </Field>
              <Field label="Repair center">
                <Input value={form.repair_center} onChange={set("repair_center")} />
              </Field>
              <Field label="Pay group">
                <Input value={form.pay_group} onChange={set("pay_group")} />
              </Field>
              <Field label="Contract type">
                <Select value={form.contract_type} onChange={set("contract_type")}>
                  <option value="">—</option>
                  <option value="unlimited">Unlimited</option>
                  <option value="limited">Limited</option>
                  <option value="probation">Probation</option>
                </Select>
              </Field>
              <Field label="Employment status">
                <Select value={form.employment_status} onChange={set("employment_status")}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="terminated">Terminated</option>
                </Select>
              </Field>
              <Field label="Monthly salary (basic)">
                <Input type="number" min="0" step="0.001" value={form.monthly_salary} onChange={set("monthly_salary")} />
              </Field>
              {editing ? (
                <Field label="Active">
                  <Select
                    value={form.active ? "true" : "false"}
                    onChange={(e) => setForm((f) => ({ ...f, active: e.target.value === "true" }))}
                  >
                    <option value="true">Active</option>
                    <option value="false">Inactive</option>
                  </Select>
                </Field>
              ) : null}
            </div>
          </section>

          <section>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
              Travel documents
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Passport No.">
                <Input value={form.passport_no} onChange={set("passport_no")} />
              </Field>
              <Field label="Passport expiry">
                <Input type="date" value={form.passport_expiry} onChange={set("passport_expiry")} />
              </Field>
              <Field label="Visa No.">
                <Input value={form.visa_no} onChange={set("visa_no")} />
              </Field>
              <Field label="Visa expiry">
                <Input type="date" value={form.visa_expiry} onChange={set("visa_expiry")} />
              </Field>
            </div>
          </section>

          <section>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
              Airfare entitlement
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Airline sector">
                <Input value={form.airline_sector} onChange={set("airline_sector")} placeholder="e.g. Asia / GCC" />
              </Field>
              <Field label="Travel class">
                <Select value={form.travel_class} onChange={set("travel_class")}>
                  <option value="">—</option>
                  <option value="Economy">Economy</option>
                  <option value="Business">Business</option>
                </Select>
              </Field>
              <Field label="Last airticket date">
                <Input type="date" value={form.last_airticket_date} onChange={set("last_airticket_date")} />
              </Field>
              <Field label="Custom airfare rate" hint="Overrides group/global">
                <Input type="number" min="0" step="0.01" value={form.custom_airfare_rate} onChange={set("custom_airfare_rate")} />
              </Field>
              <Field label="Entitlement cap rate">
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.max_entitlement_cap_rate}
                  onChange={set("max_entitlement_cap_rate")}
                />
              </Field>
            </div>
          </section>
        </div>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && deleteMutation.mutate(deleting)}
        title="Delete employee"
        message={`Remove ${deleting?.full_name} (${deleting?.code})? Related tickets/loans/balances are soft-deleted.`}
        confirmLabel="Delete"
        destructive
        busy={deleteMutation.isPending}
      />
    </div>
  );
}

export default EmployeesPage;
