"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ClipboardCopy,
  Download,
  History,
  Pencil,
  Plus,
  Trash2,
  UserCheck,
  UserX,
  Users,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { BulkBar, SelectBox, downloadCsv } from "@/components/bulk-bar";
import { EmployeeCombobox } from "@/components/employee-combobox";
import { ImportPanel } from "@/components/import-panel";
import { SavedViews } from "@/components/saved-views";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog, Dialog, DialogSection, revealField } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { EmptyState, ErrorState, PageHeader, SearchInput } from "@/components/ui/primitives";
import { TableSkeleton } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { api, download, errorMessage } from "@/lib/api";
import { pickPrimaryCompanyId } from "@/lib/company";
import { fmtDate, fmtDateTime, initials } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { appPath } from "@/lib/paths";
import type { Company, Employee, Lookup } from "@/lib/types";

const VIEW_DEFAULTS = { search: "", department: "", empDepartment: "", company: "", payGroup: "", status: "all" };

/** Resolve a stored value to the lookup display name (legacy codes stay readable). */
function lookupDisplayName(value: string, lookups: Lookup[]): string {
  const v = value.trim();
  if (!v) return "";
  const byCode = lookups.find((l) => l.code === v);
  return byCode ? byCode.name : v;
}

function payGroupLabel(value: string, lookups: Lookup[]): string {
  const v = value.trim();
  if (!v) return "—";
  const hit = lookups.find((l) => l.code === v || l.name === v);
  if (!hit) return v;
  return hit.code === hit.name ? hit.code : `${hit.name} (${hit.code})`;
}

function payGroupMatches(employeeValue: string | null | undefined, filterCode: string, lookups: Lookup[]): boolean {
  if (!filterCode) return true;
  const v = (employeeValue ?? "").trim();
  if (!v) return false;
  if (v === filterCode) return true;
  const hit = lookups.find((l) => l.code === filterCode);
  return Boolean(hit && (v === hit.code || v === hit.name));
}

/** Prefer lookup code so Rates scope_id stays aligned; keep unknown free-text as-is. */
function canonicalizePayGroup(value: string, lookups: Lookup[]): string {
  const v = value.trim();
  if (!v) return "";
  const byCode = lookups.find((l) => l.code === v);
  if (byCode) return byCode.code;
  const byName = lookups.find((l) => l.name === v);
  if (byName) return byName.code;
  return v;
}

export function employeeGaps(employee: {
  email?: string | null;
  whatsapp_mobile?: string | null;
  passport_no?: string | null;
  passport_expiry?: string | null;
  cpr_no?: string | null;
}): Array<"email" | "whatsapp" | "passport" | "id"> {
  const gaps: Array<"email" | "whatsapp" | "passport" | "id"> = [];
  if (!employee.email?.trim()) gaps.push("email");
  if (!employee.whatsapp_mobile?.trim()) gaps.push("whatsapp");
  if (!employee.passport_no?.trim() || !employee.passport_expiry) gaps.push("passport");
  if (!employee.cpr_no?.trim()) gaps.push("id");
  return gaps;
}

interface HistoryEvent {
  id: number;
  occurred_at: string | null;
  actor: string | null;
  action: string;
  changes: Record<string, { old?: string | null; new?: string | null }>;
}

const HISTORY_FIELDS: Record<string, string> = {
  code: "Code",
  full_name: "Full name",
  arabic_name: "Arabic name",
  join_date: "Join date",
  department: "Department",
  emp_department: "Emp. Department",
  branch: "Branch",
  pay_group: "Pay group",
  repair_center: "Repair center",
  designation: "Designation",
  nationality: "Nationality",
  origin_country: "Origin country",
  passport_no: "Passport number",
  passport_expiry: "Passport expiry",
  cpr_no: "Bahrain ID",
  visa_no: "Visa number",
  visa_expiry: "Visa expiry",
  date_of_birth: "Date of birth",
  gender: "Gender",
  sub_section: "Sub section",
  grade: "Grade",
  reporting_officer_id: "Reporting officer",
  whatsapp_mobile: "WhatsApp",
  contract_type: "Contract type",
  employment_status: "Employment status",
  monthly_salary: "Monthly salary",
  probation_end_date: "Probation end",
  airline_sector: "Airline sector",
  travel_class: "Travel class",
  last_airticket_date: "Last air ticket date",
  email: "Email",
  company_id: "Company",
  active: "Active",
};

function historyField(key: string): string {
  return HISTORY_FIELDS[key] ?? key.replaceAll("_", " ");
}

function historyDiffs(changes: HistoryEvent["changes"] | string | null | undefined) {
  if (!changes || typeof changes !== "object") return [];
  return Object.entries(changes);
}

interface EmployeeForm {
  code: string;
  company_id: string;
  full_name: string;
  arabic_name: string;
  join_date: string;
  department: string;
  emp_department: string;
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
  whatsapp_mobile: string;
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

/** Form order, so a failed save jumps to the topmost missing field. */
const REQUIRED_FIELDS = ["code", "company_id", "full_name", "join_date"] as const;
type RequiredField = (typeof REQUIRED_FIELDS)[number];

const EMPTY_FORM: EmployeeForm = {
  code: "",
  company_id: "",
  full_name: "",
  arabic_name: "",
  join_date: "",
  department: "",
  emp_department: "",
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
  whatsapp_mobile: "",
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

function preferredCompanyId(list: Company[]): string {
  return pickPrimaryCompanyId(list);
}

function toForm(
  e: Employee,
  payGroupLookups: Lookup[] = [],
  deptLookups: Lookup[] = [],
  empDeptLookups: Lookup[] = []
): EmployeeForm {
  return {
    code: e.code,
    company_id: e.company_id ?? "",
    full_name: e.full_name,
    arabic_name: e.arabic_name ?? "",
    join_date: e.join_date ?? "",
    department: lookupDisplayName(e.department ?? "", deptLookups),
    emp_department: lookupDisplayName(e.emp_department ?? "", empDeptLookups),
    branch: e.branch ?? "",
    pay_group: canonicalizePayGroup(e.pay_group ?? "", payGroupLookups),
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
    whatsapp_mobile: e.whatsapp_mobile ?? "",
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
  const router = useRouter();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState("");
  const [department, setDepartment] = useState("");
  const [empDepartment, setEmpDepartment] = useState("");
  const [company, setCompany] = useState("");
  const [payGroup, setPayGroup] = useState("");
  const [status, setStatus] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [bulkActive, setBulkActive] = useState<boolean | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [deleting, setDeleting] = useState<Employee | null>(null);
  const [historyFor, setHistoryFor] = useState<Employee | null>(null);
  const [form, setForm] = useState<EmployeeForm>(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<Partial<Record<RequiredField, string>>>({});

  const employees = useQuery({
    queryKey: ["employees", "all"],
    queryFn: () => api<Employee[]>("/employees?limit=500"),
  });
  const companies = useQuery({
    queryKey: ["companies"],
    queryFn: () => api<Company[]>("/companies"),
  });
  const payGroups = useQuery({
    queryKey: ["lookups", "pay_groups"],
    queryFn: () => api<Lookup[]>("/lookups/pay_groups"),
  });
  const deptLookupsQuery = useQuery({
    queryKey: ["lookups", "departments"],
    queryFn: () => api<Lookup[]>("/lookups/departments"),
  });
  const empDeptLookupsQuery = useQuery({
    queryKey: ["lookups", "emp_departments"],
    queryFn: () => api<Lookup[]>("/lookups/emp_departments"),
  });
  const history = useQuery({
    queryKey: ["employee-history", historyFor?.id],
    queryFn: () => api<{ events: HistoryEvent[] }>(`/employees/${historyFor!.id}/history`),
    enabled: Boolean(historyFor),
  });

  const deptLookups = useMemo(() => deptLookupsQuery.data ?? [], [deptLookupsQuery.data]);
  const empDeptLookups = useMemo(() => empDeptLookupsQuery.data ?? [], [empDeptLookupsQuery.data]);
  /** Filter options: lookup names first, then any orphan values still on employees. */
  const deptFilterOptions = useMemo(() => {
    const build = (field: "department" | "emp_department", lookups: Lookup[]) => {
      const names = lookups.filter((l) => l.active).map((l) => l.name);
      const known = new Set(lookups.flatMap((l) => [l.code, l.name]));
      const orphans = [
        ...new Set(
          (employees.data ?? [])
            .map((e) => lookupDisplayName(e[field] ?? "", lookups))
            .filter((v) => v && !known.has(v))
        ),
      ];
      return [...new Set([...names, ...orphans])].sort((a, b) => a.localeCompare(b));
    };
    return {
      department: build("department", deptLookups),
      empDepartment: build("emp_department", empDeptLookups),
    };
  }, [employees.data, deptLookups, empDeptLookups]);
  const companyById = useMemo(() => {
    const map = new Map<string, Company>();
    for (const c of companies.data ?? []) map.set(c.id, c);
    return map;
  }, [companies.data]);
  const companyOptions = useMemo(() => {
    const list = companies.data ?? [];
    return [...list].sort((a, b) => a.name.localeCompare(b.name));
  }, [companies.data]);
  const payGroupLookups = payGroups.data ?? [];
  const payGroupOptions = useMemo(() => {
    const list = [...payGroupLookups].sort((a, b) => a.name.localeCompare(b.name) || a.code.localeCompare(b.code));
    const known = new Set(list.flatMap((l) => [l.code, l.name]));
    const orphans = [
      ...new Set(
        (employees.data ?? [])
          .map((e) => (e.pay_group ?? "").trim())
          .filter((v) => v && !known.has(v))
      ),
    ].sort((a, b) => a.localeCompare(b));
    return { list, orphans };
  }, [payGroupLookups, employees.data]);

  /** Same-company Employee Master pool for searchable Reporting-to. */
  const reportingCandidates = useMemo(() => {
    const companyId = form.company_id;
    return (employees.data ?? []).filter((e) => !companyId || e.company_id === companyId);
  }, [employees.data, form.company_id]);
  const reportingOfficerValue = useMemo(() => {
    const key = form.reporting_officer_id.trim();
    if (!key) return "";
    const hit =
      reportingCandidates.find((e) => e.id === key || e.code === key) ??
      (employees.data ?? []).find((e) => e.id === key || e.code === key);
    return hit?.id ?? key;
  }, [form.reporting_officer_id, reportingCandidates, employees.data]);
  const reportingOfficer = useMemo(() => {
    const key = reportingOfficerValue || form.reporting_officer_id.trim();
    if (!key) return null;
    return (
      reportingCandidates.find((e) => e.id === key || e.code === key) ??
      (employees.data ?? []).find((e) => e.id === key || e.code === key) ??
      null
    );
  }, [reportingOfficerValue, form.reporting_officer_id, reportingCandidates, employees.data]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (employees.data ?? []).filter((e) => {
      if (company && e.company_id !== company) return false;
      if (!payGroupMatches(e.pay_group, payGroup, payGroupLookups)) return false;
      if (department && lookupDisplayName(e.department ?? "", deptLookups) !== department) return false;
      if (empDepartment && lookupDisplayName(e.emp_department ?? "", empDeptLookups) !== empDepartment) return false;
      if (status === "active" && !e.active) return false;
      if (status === "inactive" && e.active) return false;
      if (status === "incomplete" && employeeGaps(e).length === 0) return false;
      if (!term) return true;
      const companyName = companyById.get(e.company_id)?.name ?? "";
      return [
        e.code,
        e.full_name,
        e.arabic_name,
        e.department,
        e.emp_department,
        e.designation,
        e.nationality,
        e.cpr_no,
        e.passport_no,
        e.email,
        companyName,
        e.pay_group,
        payGroupLabel(e.pay_group ?? "", payGroupLookups),
      ]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(term));
    });
  }, [employees.data, search, department, empDepartment, company, payGroup, status, companyById, payGroupLookups, deptLookups, empDeptLookups]);

  const selectedRows = useMemo(
    () => filtered.filter((e) => selected.has(e.id)),
    [filtered, selected]
  );
  const allSelected = filtered.length > 0 && selectedRows.length === filtered.length;
  const toggleOne = (id: string, on: boolean) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const toggleAll = (on: boolean) => setSelected(on ? new Set(filtered.map((e) => e.id)) : new Set());

  const applyView = (view: Record<string, string>) => {
    setSearch(view.search ?? "");
    setDepartment(view.department ?? "");
    setEmpDepartment(view.empDepartment ?? "");
    setCompany(view.company ?? "");
    setPayGroup(view.payGroup ?? "");
    setStatus(view.status || "all");
    setSelected(new Set());
  };

  const deepLinked = useRef(false);
  useEffect(() => {
    const editId = searchParams.get("edit");
    const wantsNew = searchParams.get("new") === "1";
    const q = searchParams.get("q");
    if (!editId && !wantsNew && q == null) {
      deepLinked.current = false;
      return;
    }
    if (deepLinked.current) return;
    if (wantsNew) {
      openCreate();
    } else if (editId) {
      if (!employees.data) return;
      const target = employees.data.find((e) => e.id === editId);
      if (target) openEdit(target);
      else toast.warning("Employee not found", "It may have been removed.");
    } else if (q != null) {
      applyView({ ...VIEW_DEFAULTS, search: q });
    }
    deepLinked.current = true;
    router.replace(appPath("/employees"));
  }, [employees.data, searchParams]);

  const bulkStatusMutation = useMutation({
    mutationFn: async ({ rows, active }: { rows: Employee[]; active: boolean }) => {
      const results = await Promise.allSettled(
        rows.map((e) =>
          api(`/employees/${e.id}`, {
            method: "PUT",
            body: { full_name: e.full_name, join_date: e.join_date, active },
            headers: { "If-Match": String(e.version) },
          })
        )
      );
      return { ok: results.filter((r) => r.status === "fulfilled").length, total: rows.length };
    },
    onSuccess: ({ ok, total }) => {
      if (ok === total) toast.success(t("bulk.done"), `${ok} / ${total}`);
      else toast.warning(t("bulk.partial"), `${ok} / ${total}`);
      setBulkActive(null);
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ["employees"] });
    },
    onError: (err) => toast.error(t("bulk.failed"), errorMessage(err)),
  });

  const exportSelected = () =>
    downloadCsv(
      `employees-${selectedRows.length}.csv`,
      ["Code", "Name", "Arabic name", "Department", "Emp. Department", "Designation", "Pay group", "Bahrain ID", "Passport", "Passport expiry", "WhatsApp", "Joined", "Active"],
      selectedRows.map((e) => [
        e.code,
        e.full_name,
        e.arabic_name,
        lookupDisplayName(e.department ?? "", deptLookups),
        lookupDisplayName(e.emp_department ?? "", empDeptLookups),
        e.designation,
        e.pay_group,
        e.cpr_no,
        e.passport_no,
        e.passport_expiry,
        e.whatsapp_mobile,
        e.join_date,
        e.active ? "Yes" : "No",
      ])
    );

  const copyCodes = async () => {
    try {
      await navigator.clipboard.writeText(selectedRows.map((e) => e.code).join("\n"));
      toast.success(t("bulk.copied"), `${selectedRows.length}`);
    } catch {
      toast.error(t("bulk.failed"), "Clipboard is not available in this browser.");
    }
  };

  const openCreate = () => {
    setEditing(null);
    setForm({
      ...EMPTY_FORM,
      company_id: company || preferredCompanyId(companies.data ?? []),
    });
    setFormErrors({});
    setShowForm(true);
  };

  const openEdit = (e: Employee) => {
    setEditing(e);
    setForm(toForm(e, payGroups.data ?? [], deptLookups, empDeptLookups));
    setFormErrors({});
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
      emp_department: form.emp_department.trim(),
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
      whatsapp_mobile: form.whatsapp_mobile.trim(),
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
    const companyId = form.company_id.trim();
    const missing: Partial<Record<RequiredField, string>> = {};
    if (!editing && !form.code.trim()) missing.code = "Employee code is required.";
    if (!companyId) missing.company_id = "Company is required.";
    if (!shared.full_name) missing.full_name = "Full name is required.";
    if (!shared.join_date) missing.join_date = "Join date is required.";
    setFormErrors(missing);
    const firstMissing = REQUIRED_FIELDS.find((key) => missing[key]);
    if (firstMissing) {
      toast.error("Missing required fields", Object.values(missing).join(" "));
      revealField(`employee-${firstMissing}`);
      return;
    }
    if (editing) {
      saveMutation.mutate({ ...shared, company_id: companyId });
      return;
    }
    saveMutation.mutate({
      ...shared,
      code: form.code.trim(),
      company_id: companyId,
    });
  };

  const set = (key: keyof EmployeeForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    if (key in formErrors) {
      setFormErrors((prev) => {
        const next = { ...prev };
        delete next[key as RequiredField];
        return next;
      });
    }
  };

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
        description="One Excel file updates employees and Lookups (department, emp. department, designation, nationality, pay group, sub section, repair center). Verify → review lookup plan → import."
        templateName="employees"
        previewPath="/employees/import/preview"
        commitPath="/employees/import/commit"
        columns={[
          { key: "code", label: "Code" },
          { key: "company_id", label: "Company" },
          { key: "full_name", label: "Name" },
          { key: "join_date", label: "Date of joining" },
          { key: "grade", label: "Job band" },
          { key: "cpr_no", label: "Bahrain ID / CPR" },
          { key: "designation", label: "Designation" },
          { key: "nationality", label: "Nationality" },
          { key: "pay_group", label: "Pay group" },
          { key: "sub_section", label: "Sub section" },
          { key: "department", label: "Department" },
          { key: "emp_department", label: "Emp. Department" },
          { key: "reporting_officer_id", label: "Reporting to" },
        ]}
        onCommitted={() => {
          queryClient.invalidateQueries({ queryKey: ["employees"] });
          queryClient.invalidateQueries({ queryKey: ["lookups"] });
          queryClient.invalidateQueries({ queryKey: ["companies"] });
        }}
      />

      <Card className="mt-4">
        <CardContent className="p-0">
          <div className="flex flex-col gap-3 p-4 pb-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex w-full min-w-0 flex-wrap items-end gap-2">
              <SearchInput
                value={search}
                onChange={setSearch}
                placeholder="Search code, name, CPR, passport, department…"
                className="w-full max-w-md min-w-0"
              />
              <Select
                aria-label="Company"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                className="w-48"
                data-testid="filter-employee-company"
              >
                <option value="">All companies</option>
                {companyOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.code})
                  </option>
                ))}
              </Select>
              <Select
                aria-label="Pay group"
                value={payGroup}
                onChange={(e) => setPayGroup(e.target.value)}
                className="w-48"
                data-testid="filter-employee-pay-group"
              >
                <option value="">All pay groups</option>
                {payGroupOptions.list.map((p) => (
                  <option key={p.id} value={p.code}>
                    {p.name} ({p.code})
                  </option>
                ))}
                {payGroupOptions.orphans.map((code) => (
                  <option key={`orphan-${code}`} value={code}>
                    {code} · not in master
                  </option>
                ))}
              </Select>
              <Select
                aria-label={t("filter.department")}
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                className="w-44"
                data-testid="filter-employee-department"
              >
                <option value="">{t("filter.allDepartments")}</option>
                {deptFilterOptions.department.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </Select>
              <Select
                aria-label={t("filter.empDepartment")}
                value={empDepartment}
                onChange={(e) => setEmpDepartment(e.target.value)}
                className="w-44"
                data-testid="filter-employee-emp-department"
              >
                <option value="">{t("filter.allEmpDepartments")}</option>
                {deptFilterOptions.empDepartment.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </Select>
              <Select
                aria-label={t("filter.status")}
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-48"
                data-testid="filter-employee-status"
              >
                <option value="all">{t("filter.allStatuses")}</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="incomplete">{t("employees.incomplete")}</option>
              </Select>
            </div>
            <Badge variant="secondary">{filtered.length} shown</Badge>
          </div>
          <div className="space-y-2 px-4 pb-3">
            <SavedViews
              scope="employees"
              filters={{ search, department, empDepartment, company, payGroup, status }}
              defaults={VIEW_DEFAULTS}
              onApply={applyView}
            />
            <BulkBar count={selectedRows.length} onClear={() => setSelected(new Set())} testId="bulk-employees">
              <Button size="sm" variant="outline" onClick={exportSelected}>
                <Download size={13} /> {t("bulk.exportCsv")}
              </Button>
              <Button size="sm" variant="outline" onClick={copyCodes}>
                <ClipboardCopy size={13} /> {t("bulk.copyCodes")}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setBulkActive(true)}>
                <UserCheck size={13} /> {t("bulk.markActive")}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setBulkActive(false)}>
                <UserX size={13} /> {t("bulk.markInactive")}
              </Button>
            </BulkBar>
          </div>
          {employees.isPending ? (
            <TableSkeleton columns={10} label={t("state.loading")} />
          ) : employees.isError ? (
            <ErrorState error={employees.error} onRetry={employees.refetch} />
          ) : filtered.length === 0 ? (
            search.trim() || department || empDepartment || company || payGroup || status !== "all" ? (
              <EmptyState
                icon={<Users size={22} />}
                title={t("empty.noResults.title")}
                message={t("empty.noResults.message")}
                action={
                  <Button variant="outline" size="sm" onClick={() => applyView(VIEW_DEFAULTS)}>
                    {t("action.clearSearch")}
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={<Users size={22} />}
                title={t("empty.employees.title")}
                message={t("empty.employees.message")}
                action={
                  <Button variant="gradient" size="sm" onClick={openCreate}>
                    <Plus size={14} /> {t("page.employees.addAction")}
                  </Button>
                }
              />
            )
          ) : (
            <Table cards className="min-w-[60rem]" data-testid="table-employee-master">
              <THead>
                <TR>
                  <TH className="w-10">
                    <SelectBox
                      checked={allSelected}
                      indeterminate={selectedRows.length > 0}
                      onChange={toggleAll}
                      label={t("bulk.selectAll")}
                      testId="select-all-employees"
                    />
                  </TH>
                  <TH>Employee</TH>
                  <TH>Company</TH>
                  <TH>Joined</TH>
                  <TH>Job band</TH>
                  <TH>Department</TH>
                  <TH>Emp. Department</TH>
                  <TH>Designation</TH>
                  <TH>Pay group</TH>
                  <TH>Bahrain ID</TH>
                  <TH>Status</TH>
                  <TH className="text-end">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((e) => (
                  <TR key={e.id} data-testid={`row-employee-${e.code}`}>
                    <TD>
                      <SelectBox
                        checked={selected.has(e.id)}
                        onChange={(on) => toggleOne(e.id, on)}
                        label={`${t("bulk.select")} ${e.full_name}`}
                        testId={`select-employee-${e.code}`}
                      />
                    </TD>
                    <TD className="whitespace-normal">
                      <div className="flex items-center gap-3">
                        <div className="gradient-hero flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white">
                          {initials(e.full_name)}
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold">{e.full_name}</p>
                          <p className="text-xs text-[var(--color-muted-foreground)] font-mono">{e.code}</p>
                          {e.arabic_name ? (
                            <p className="text-xs text-[var(--color-muted-foreground)]" dir="rtl">
                              {e.arabic_name}
                            </p>
                          ) : null}
                          {status === "incomplete" ? (
                            <p className="text-xs text-[var(--color-muted-foreground)]">
                              {t("employees.missing")}:{" "}
                              {employeeGaps(e).map((gap) => t(`employees.gap.${gap}`)).join(", ")}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </TD>
                    <TD>
                      <div className="min-w-0">
                        <p className="font-medium">{companyById.get(e.company_id)?.name || "—"}</p>
                        <p className="text-xs font-mono text-[var(--color-muted-foreground)]">
                          {companyById.get(e.company_id)?.code || e.company_id || "—"}
                        </p>
                      </div>
                    </TD>
                    <TD>{fmtDate(e.join_date)}</TD>
                    <TD className="font-mono text-xs">{e.grade || "—"}</TD>
                    <TD>
                      <div className="min-w-0">
                        <p>{lookupDisplayName(e.department ?? "", deptLookups) || "—"}</p>
                        {e.sub_section ? (
                          <p className="text-xs text-[var(--color-muted-foreground)]">{e.sub_section}</p>
                        ) : null}
                      </div>
                    </TD>
                    <TD>{lookupDisplayName(e.emp_department ?? "", empDeptLookups) || "—"}</TD>
                    <TD>{e.designation || "—"}</TD>
                    <TD>{payGroupLabel(e.pay_group ?? "", payGroupLookups)}</TD>
                    <TD className="font-mono text-xs">{e.cpr_no || "—"}</TD>
                    <TD>
                      <Badge variant={e.active ? "success" : "secondary"}>
                        {e.active ? "Active" : "Inactive"}
                      </Badge>
                    </TD>
                    <TD className="text-end">
                      <div
                        className="inline-flex flex-nowrap justify-end gap-1.5"
                        role="group"
                        aria-label={`Actions for ${e.full_name}`}
                      >
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openEdit(e)}
                          title="Edit employee"
                          aria-label={`Edit ${e.full_name}`}
                          data-testid={`btn-edit-employee-${e.code}`}
                        >
                          <Pencil size={14} aria-hidden />
                          <span className="sr-only">Edit</span>
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setHistoryFor(e)}
                          title={t("employees.history")}
                          aria-label={`${t("employees.history")} ${e.full_name}`}
                          data-testid={`btn-history-employee-${e.code}`}
                        >
                          <History size={14} aria-hidden />
                          <span className="sr-only">{t("employees.history")}</span>
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleting(e)}
                          title="Delete employee"
                          aria-label={`Delete ${e.full_name}`}
                          data-testid={`btn-delete-employee-${e.code}`}
                        >
                          <Trash2 size={14} className="text-[var(--color-destructive)]" />
                          <span className="sr-only">Delete</span>
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
              {saveMutation.isPending ? t("state.saving") : editing ? "Save changes" : "Create employee"}
            </Button>
          </>
        }
      >
        <div className="space-y-6">
          <DialogSection title="Identity">
            <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
              <Field label="Code *" error={formErrors.code}>
                <Input
                  id="employee-code"
                  aria-invalid={Boolean(formErrors.code)}
                  aria-required="true"
                  value={form.code}
                  onChange={set("code")}
                  placeholder="E-1001"
                  className="font-mono"
                  disabled={Boolean(editing)}
                  data-testid="input-employee-id"
                />
              </Field>
              <Field label="Company *" error={formErrors.company_id}>
                <Select
                  id="employee-company"
                  aria-invalid={Boolean(formErrors.company_id)}
                  aria-required="true"
                  value={form.company_id}
                  onChange={(e) => {
                    const nextCompany = e.target.value;
                    setForm((f) => ({
                      ...f,
                      company_id: nextCompany,
                      // RM candidates are company-scoped — clear stale officer on switch.
                      reporting_officer_id: "",
                    }));
                  }}
                  data-testid="input-employee-company"
                >
                  <option value="">Select company…</option>
                  {companyOptions.map((c) => (
                    <option key={c.id} value={c.id} disabled={!c.active && c.id !== form.company_id}>
                      {c.name} ({c.code}){c.active ? "" : " · inactive"}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Full name *" error={formErrors.full_name}>
                <Input
                  id="employee-full_name"
                  aria-invalid={Boolean(formErrors.full_name)}
                  aria-required="true"
                  value={form.full_name}
                  onChange={set("full_name")}
                  data-testid="input-employee-name"
                />
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
          </DialogSection>

          <DialogSection title="Employment">
            <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
              <Field label="Join date *" error={formErrors.join_date}>
                <Input
                  id="employee-join_date"
                  type="date"
                  aria-invalid={Boolean(formErrors.join_date)}
                  aria-required="true"
                  value={form.join_date}
                  onChange={set("join_date")}
                />
              </Field>
              <Field label="Probation end">
                <Input type="date" value={form.probation_end_date} onChange={set("probation_end_date")} />
              </Field>
              <Field label="Department" hint="Master list: Lookups → Departments.">
                <Select value={form.department} onChange={set("department")} data-testid="field-department">
                  <option value="">—</option>
                  {deptLookups
                    .filter((l) => l.active || l.name === form.department || l.code === form.department)
                    .map((l) => (
                      <option key={l.id} value={l.name} disabled={!l.active && l.name !== form.department}>
                        {l.name}
                        {!l.active ? " · inactive" : ""}
                      </option>
                    ))}
                  {form.department &&
                  !deptLookups.some((l) => l.name === form.department || l.code === form.department) ? (
                    <option value={form.department}>{form.department} · not in master</option>
                  ) : null}
                </Select>
              </Field>
              <Field label="Emp. Department" hint="Master list: Lookups → Emp Departments.">
                <Select value={form.emp_department} onChange={set("emp_department")} data-testid="field-emp-department">
                  <option value="">—</option>
                  {empDeptLookups
                    .filter((l) => l.active || l.name === form.emp_department || l.code === form.emp_department)
                    .map((l) => (
                      <option key={l.id} value={l.name} disabled={!l.active && l.name !== form.emp_department}>
                        {l.name}
                        {!l.active ? " · inactive" : ""}
                      </option>
                    ))}
                  {form.emp_department &&
                  !empDeptLookups.some((l) => l.name === form.emp_department || l.code === form.emp_department) ? (
                    <option value={form.emp_department}>{form.emp_department} · not in master</option>
                  ) : null}
                </Select>
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
              <Field
                label="Reporting to"
                hint="Search Employee Master by name or code. Their WhatsApp on master is used for allocation approval packs."
              >
                <EmployeeCombobox
                  employees={reportingCandidates}
                  value={reportingOfficerValue}
                  onChange={(id) => setForm((f) => ({ ...f, reporting_officer_id: id }))}
                  placeholder="Type name or code — e.g. Abdul… or 0016"
                  allowEmpty
                  emptyLabel="— None —"
                  activeOnly
                  excludeIds={editing ? [editing.id] : []}
                  data-testid="select-reporting-officer"
                />
              </Field>
              {reportingOfficer ? (
                <p
                  className="text-[11px] text-[var(--color-muted-foreground)] sm:col-span-2"
                  data-testid="reporting-officer-wa-hint"
                >
                  Manager WhatsApp from master:{" "}
                  {reportingOfficer.whatsapp_mobile?.trim() ? (
                    <span className="font-mono" dir="ltr">
                      {reportingOfficer.whatsapp_mobile.trim()}
                    </span>
                  ) : (
                    <span className="text-[var(--color-warning)]">
                      not on file — add it on the manager’s employee record
                    </span>
                  )}
                </p>
              ) : null}
              <Field label="WhatsApp mobile">
                <Input
                  value={form.whatsapp_mobile}
                  onChange={set("whatsapp_mobile")}
                  placeholder="973…"
                  data-testid="field-whatsapp-mobile"
                />
              </Field>
              <Field label="Branch">
                <Input value={form.branch} onChange={set("branch")} data-testid="field-branch" />
              </Field>
              <Field label="Repair center">
                <Input value={form.repair_center} onChange={set("repair_center")} />
              </Field>
              <Field
                label="Pay group"
                hint="Master list: Lookups → Pay groups. Value stored as code for rates."
              >
                <Select
                  value={form.pay_group}
                  onChange={set("pay_group")}
                  data-testid="input-employee-pay-group"
                >
                  <option value="">—</option>
                  {payGroupOptions.list
                    .filter((p) => p.active || p.code === form.pay_group || p.name === form.pay_group)
                    .map((p) => (
                      <option key={p.id} value={p.code} disabled={!p.active && p.code !== form.pay_group}>
                        {p.name} ({p.code})
                        {!p.active ? " · inactive" : ""}
                      </option>
                    ))}
                  {form.pay_group &&
                  !payGroupOptions.list.some(
                    (p) => p.code === form.pay_group || p.name === form.pay_group
                  ) ? (
                    <option value={form.pay_group}>{form.pay_group} · not in master</option>
                  ) : null}
                </Select>
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
          </DialogSection>

          <DialogSection title="Travel documents">
            <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
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
          </DialogSection>

          <DialogSection title="Airfare entitlement">
            <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
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
              <Field label="Last air ticket date">
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
          </DialogSection>
        </div>
      </Dialog>

      <Dialog
        open={Boolean(historyFor)}
        onClose={() => setHistoryFor(null)}
        title={`${t("employees.history")} · ${historyFor?.full_name ?? ""}`}
        description={historyFor?.code}
      >
        {history.isLoading ? (
          <p className="text-sm text-[var(--color-muted-foreground)]">{t("state.loading")}</p>
        ) : history.isError ? (
          <ErrorState error={history.error} />
        ) : (history.data?.events.length ?? 0) === 0 ? (
          <p className="text-sm text-[var(--color-muted-foreground)]">{t("employees.historyEmpty")}</p>
        ) : (
          <ul className="space-y-3">
            {history.data?.events.map((event) => (
              <li key={event.id} className="rounded-lg border border-[var(--color-border)] p-3">
                <p className="text-sm font-medium">
                  {event.action === "insert"
                    ? t("employees.history.created")
                    : event.action === "delete"
                      ? t("employees.history.removed")
                      : t("employees.history.updated")}
                  {event.actor ? ` · ${event.actor}` : ""}
                  {event.occurred_at ? ` · ${fmtDateTime(event.occurred_at)}` : ""}
                </p>
                <div className="mt-1 space-y-0.5">
                  {historyDiffs(event.changes).length === 0 ? (
                    <p className="text-xs text-[var(--color-muted-foreground)]">
                      {t("employees.historyNoFields")}
                    </p>
                  ) : (
                    historyDiffs(event.changes).map(([field, diff]) => (
                      <p key={field} className="text-xs text-[var(--color-muted-foreground)]">
                        <span className="font-medium">{historyField(field)}</span>
                        {": "}
                        {diff?.old ?? "—"}
                        {" → "}
                        {diff?.new ?? "—"}
                      </p>
                    ))
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
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

      <ConfirmDialog
        open={bulkActive !== null}
        onClose={() => setBulkActive(null)}
        onConfirm={() =>
          bulkActive !== null && bulkStatusMutation.mutate({ rows: selectedRows, active: bulkActive })
        }
        title={bulkActive ? t("bulk.markActive") : t("bulk.markInactive")}
        message={`${selectedRows.length} ${t("bulk.confirmEmployees")}`}
        confirmLabel={bulkActive ? t("bulk.markActive") : t("bulk.markInactive")}
        destructive={bulkActive === false}
        busy={bulkStatusMutation.isPending}
      />
    </div>
  );
}

function EmployeesPageRoute() {
  return (
    <Suspense fallback={<TableSkeleton columns={9} />}>
      <EmployeesPage />
    </Suspense>
  );
}

export default EmployeesPageRoute;
