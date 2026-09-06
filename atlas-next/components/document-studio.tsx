"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, FileDown, Pencil, Printer, Trash2, UserRound, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { EmployeeCombobox } from "@/components/employee-combobox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { CardsSkeleton, TableSkeleton } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { api, authedFetch, download, ApiError, errorMessage } from "@/lib/api";
import { usePrimaryCompany } from "@/lib/branding";
import { fmtDate, fmtDateTime, titleCase, todayLocal } from "@/lib/format";
import type { Company, Employee } from "@/lib/types";

export type DocumentKind = "offer_letter" | "contract";

interface TemplateInfo {
  key: string;
  kind: string;
  label: string;
  description: string;
  required_params: string[];
  optional_params: string[];
}

interface DocumentRow {
  id: string;
  document_number?: number | null;
  voucher_no?: string | null;
  kind: string;
  template_key: string;
  title: string;
  status: string;
  employee_id?: string | null;
  employee_name?: string;
  nature_of_employment?: string | null;
  basic?: number | null;
  net?: number | null;
  document_date?: string | null;
  joining_date?: string | null;
  issued_at?: string | null;
  has_pdf?: boolean;
  version: number;
}

const MONEY_KEYS = new Set([
  "basic",
  "hra",
  "petrol_allowance",
  "car_allowance",
  "special_duty_allowance",
]);

interface DocumentDetail extends DocumentRow {
  company_id?: string | null;
  params?: Record<string, string>;
}

/** Focus Soft voucher fields — filled on-screen; Employee Master is optional. */
const DEFAULTS: Record<string, string> = {
  full_name: "",
  nationality: "",
  passport_no: "",
  department: "",
  nature_of_employment: "",
  joining_date: todayLocal(),
  document_date: todayLocal(),
  probation_months: "3",
  basic: "",
  hra: "0",
  petrol_allowance: "0",
  car_allowance: "0",
  special_duty_allowance: "0",
  annual_leave_days: "30",
  offer_valid_until: "",
  working_hours: "48",
  notice_period_days: "30",
  duration_months: "24",
  traveling_airfare: "true",
  narration: "",
  employee_name_arabic: "",
  cpr_no: "",
  additional_details: "",
  address_villa: "",
  address_street: "",
  address_block: "",
  nature_of_employment_arabic: "",
  signatory_name: "Authorized Signatory",
  signatory_title: "Human Resources",
  special_terms: "",
};

function paramInputType(key: string): string {
  if (key.includes("date") || key.includes("until")) return "date";
  if (key === "traveling_airfare") return "text";
  if (
    MONEY_KEYS.has(key) ||
    key.includes("days") ||
    key.includes("months") ||
    key.includes("hours") ||
    key.includes("number")
  )
    return "number";
  return "text";
}

function netFrom(params: Record<string, string>): string {
  const n = (...keys: string[]) =>
    keys.reduce((sum, k) => sum + (Number(params[k] || 0) || 0), 0);
  return n("basic", "hra", "petrol_allowance", "car_allowance", "special_duty_allowance").toFixed(3);
}

function fieldLabel(key: string): string {
  const labels: Record<string, string> = {
    full_name: "Candidate / employee name",
    employee_name_arabic: "Name (Arabic)",
    nationality: "Nationality",
    passport_no: "Passport No.",
    cpr_no: "CPR No.",
    nature_of_employment: "Position / nature of employment",
    nature_of_employment_arabic: "Position (Arabic)",
    joining_date: "Joining date",
    document_date: "Document date",
    traveling_airfare: "Traveling / Airfare",
  };
  return labels[key] ?? titleCase(key);
}

export function DocumentStudio({ kind }: { kind: DocumentKind }) {
  const queryClient = useQueryClient();
  const [companyId, setCompanyId] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [templateKey, setTemplateKey] = useState("");
  const [params, setParams] = useState<Record<string, string>>({ ...DEFAULTS });
  const [previewHtml, setPreviewHtml] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<DocumentRow | null>(null);
  const [editing, setEditing] = useState<{ id: string; version: number; voucherNo: string } | null>(
    null
  );
  const { logo: brandLogo } = usePrimaryCompany();

  const companies = useQuery({
    queryKey: ["companies"],
    queryFn: () => api<Company[]>("/companies"),
  });
  const employees = useQuery({
    queryKey: ["employees", "all"],
    queryFn: () => api<Employee[]>("/employees?limit=500"),
  });
  const templates = useQuery({
    queryKey: ["document-templates"],
    queryFn: () => api<{ templates: TemplateInfo[] }>("/documents/templates"),
  });
  const history = useQuery({
    queryKey: ["documents", kind],
    queryFn: () => api<{ documents: DocumentRow[] }>(`/documents?kind=${kind}&limit=100`),
  });

  const kindTemplates = (templates.data?.templates ?? []).filter((t) => t.kind === kind);
  const template = kindTemplates.find((t) => t.key === templateKey) ?? kindTemplates[0];

  useEffect(() => {
    if (template && !templateKey) setTemplateKey(template.key);
  }, [template, templateKey]);

  useEffect(() => {
    const list = (companies.data ?? []).filter((c) => c.active);
    if (!companyId && list.length) setCompanyId(list[0].id);
  }, [companies.data, companyId]);

  const filteredEmployees = useMemo(() => {
    const all = employees.data ?? [];
    if (!companyId) return all;
    return all.filter((e) => e.company_id === companyId);
  }, [employees.data, companyId]);

  const employee = filteredEmployees.find((e) => e.id === employeeId);

  useEffect(() => {
    if (employeeId && companyId && employee && employee.company_id !== companyId) {
      setEmployeeId("");
    }
  }, [companyId, employeeId, employee]);

  /** Optional helper: load party fields from Employee Master when already hired. */
  useEffect(() => {
    if (!employeeId) return;
    let cancelled = false;
    (async () => {
      try {
        const defaults = await api<{ params: Record<string, string> }>(
          `/documents/defaults/${employeeId}`
        );
        if (cancelled) return;
        setParams({
          ...DEFAULTS,
          ...defaults.params,
          document_date: defaults.params.document_date || todayLocal(),
        });
        setPreviewHtml("");
      } catch {
        if (cancelled || !employee) return;
        setParams({
          ...DEFAULTS,
          full_name: employee.full_name || "",
          nationality: employee.nationality || "",
          passport_no: employee.passport_no || "",
          department: employee.department || "",
          nature_of_employment: employee.designation || "",
          joining_date: employee.join_date || todayLocal(),
          document_date: todayLocal(),
        });
        setPreviewHtml("");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [employeeId, employee]);

  const fieldKeys = useMemo(() => {
    if (!template) return [] as string[];
    return [...template.required_params, ...template.optional_params];
  }, [template]);

  const missingRequired = useMemo(() => {
    if (!template) return ["template"];
    const missing: string[] = [];
    if (!companyId) missing.push("company");
    for (const key of template.required_params) {
      if (!String(params[key] ?? "").trim()) missing.push(key);
    }
    return missing;
  }, [template, companyId, params]);

  const ready = Boolean(template && companyId && missingRequired.length === 0);

  const selectedCompanyLogo = companyId ? `/v1/companies/${companyId}/logo` : brandLogo;

  const payload = () => ({
    kind,
    template_key: template?.key,
    employee_id: employeeId || null,
    company_id: companyId || null,
    params: {
      ...params,
      signatory_name: params.signatory_name || "Authorized Signatory",
      signatory_title: params.signatory_title || "Human Resources",
    },
  });

  const fetchPreview = async () => {
    if (!ready) {
      toast.error("Missing required fields", titleCase(missingRequired.join(", ")));
      return;
    }
    try {
      const resp = await authedFetch("/v1/documents/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload()),
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new ApiError(
          resp.status,
          body.code ?? "preview_failed",
          body.detail ?? "Preview failed."
        );
      }
      let html = await resp.text();
      if (selectedCompanyLogo) {
        html = html.replace(/src="\/v1\/companies\/[^"]+\/logo"/g, `src="${selectedCompanyLogo}"`);
      }
      setPreviewHtml(html);
    } catch (error) {
      toast.error("Preview failed", errorMessage(error));
    }
  };

  const issue = useMutation({
    mutationFn: () => {
      if (!ready) {
        throw new ApiError(400, "missing_fields", `Missing: ${missingRequired.join(", ")}`);
      }
      if (editing) {
        return api<DocumentRow>(`/documents/${editing.id}`, {
          method: "PUT",
          headers: { "If-Match": String(editing.version) },
          body: {
            template_key: template?.key,
            employee_id: employeeId || null,
            company_id: companyId || null,
            params: payload().params,
          },
        });
      }
      return api<DocumentRow>("/documents", {
        method: "POST",
        body: payload(),
      });
    },
    onSuccess: (doc) => {
      toast.success(
        editing ? "Document updated" : "Document issued",
        `${doc.voucher_no || doc.title} — ${doc.has_pdf ? "PDF stored." : "recorded."}`
      );
      setEditing(doc.id ? { id: doc.id, version: doc.version, voucherNo: doc.voucher_no || "" } : null);
      queryClient.invalidateQueries({ queryKey: ["documents"] });
    },
    onError: (error) => toast.error(editing ? "Update failed" : "Issue failed", errorMessage(error)),
  });

  const loadForEdit = async (doc: DocumentRow) => {
    try {
      const detail = await api<DocumentDetail>(`/documents/${doc.id}`);
      setEditing({
        id: detail.id,
        version: detail.version,
        voucherNo: detail.voucher_no || "",
      });
      setTemplateKey(detail.template_key);
      if (detail.company_id) setCompanyId(detail.company_id);
      setEmployeeId(detail.employee_id || "");
      setParams({
        ...DEFAULTS,
        ...(detail.params || {}),
        document_date: detail.params?.document_date || detail.document_date || todayLocal(),
        joining_date: detail.params?.joining_date || detail.joining_date || todayLocal(),
      });
      setPreviewHtml("");
      toast.success("Editing", detail.voucher_no || detail.title);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      toast.error("Could not load document", errorMessage(error));
    }
  };

  const clearEdit = () => {
    setEditing(null);
    setParams({ ...DEFAULTS, document_date: todayLocal(), joining_date: todayLocal() });
    setEmployeeId("");
    setPreviewHtml("");
  };

  const remove = useMutation({
    mutationFn: (doc: DocumentRow) =>
      api(`/documents/${doc.id}`, {
        method: "DELETE",
        headers: { "If-Match": String(doc.version) },
      }),
    onSuccess: () => {
      toast.success("Document deleted");
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ["documents"] });
    },
    onError: (error) => toast.error("Delete failed", errorMessage(error)),
  });

  if (employees.isPending || templates.isPending || companies.isPending) return <CardsSkeleton />;

  const partyFields = fieldKeys.filter((k) =>
    ["full_name", "employee_name_arabic", "nationality", "passport_no", "cpr_no", "department"].includes(
      k
    )
  );
  const headerFields = fieldKeys.filter((k) =>
    [
      "document_date",
      "joining_date",
      "narration",
      "nature_of_employment",
      "nature_of_employment_arabic",
    ].includes(k)
  );
  const moneyFields = fieldKeys.filter((k) => MONEY_KEYS.has(k));
  const addressFields = fieldKeys.filter((k) => k.startsWith("address_"));
  const otherFields = fieldKeys.filter(
    (k) =>
      !partyFields.includes(k) &&
      !headerFields.includes(k) &&
      !moneyFields.includes(k) &&
      !addressFields.includes(k)
  );

  const renderField = (key: string, required = false) => {
    if (key === "traveling_airfare") {
      return (
        <Field key={key} label="Traveling / Airfare">
          <Select
            value={params[key] ?? "true"}
            onChange={(e) => setParams((p) => ({ ...p, [key]: e.target.value }))}
          >
            <option value="true">Yes — include airfare benefit</option>
            <option value="false">No</option>
          </Select>
        </Field>
      );
    }
    return (
      <Field key={key} label={`${fieldLabel(key)}${required ? " *" : ""}`}>
        <Input
          type={paramInputType(key)}
          step="any"
          value={params[key] ?? ""}
          onChange={(e) => setParams((p) => ({ ...p, [key]: e.target.value }))}
        />
      </Field>
    );
  };

  const companyOptions = (companies.data ?? []).filter((c) => c.active);

  return (
    <div
      className="space-y-6"
      data-testid={kind === "offer_letter" ? "page-offer-letters" : "page-contracts"}
    >
      <div className="grid gap-6 xl:grid-cols-[420px_1fr]">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>
              {kind === "offer_letter" ? "Offer Letter" : "Contract of Employment"}
              {editing ? (
                <span className="ml-2 text-sm font-normal text-[var(--color-muted-foreground)]">
                  Editing {editing.voucherNo}
                </span>
              ) : null}
            </CardTitle>
            <CardDescription>
              Enterprise bilingual letterhead (logo only — no CR/currency). Edit any issued voucher
              and regenerate PDF. Pattern: Jinja2 HTML + live form preview (OSS HR letter tools).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="Company *">
              <Select
                value={companyId}
                data-testid="select-document-company"
                onChange={(e) => {
                  setCompanyId(e.target.value);
                  setEmployeeId("");
                  setPreviewHtml("");
                }}
              >
                <option value="">Select company…</option>
                {companyOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Template">
              <Select value={template?.key ?? ""} onChange={(e) => setTemplateKey(e.target.value)}>
                {kindTemplates.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </Field>

            <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-3">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
                Party (on voucher)
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {partyFields.map((k) =>
                  renderField(k, template?.required_params.includes(k))
                )}
              </div>
            </div>

            <Field label="Optional — load from Employee Master">
              <EmployeeCombobox
                employees={filteredEmployees}
                value={employeeId}
                activeOnly={false}
                allowEmpty
                emptyLabel="Type details above (no employee record)…"
                placeholder="Type name — e.g. A…"
                data-testid="select-document-employee"
                onChange={(id) => {
                  setEmployeeId(id);
                  if (!id) {
                    setParams({ ...DEFAULTS, document_date: todayLocal() });
                    setPreviewHtml("");
                  }
                }}
              />
            </Field>
            {employee ? (
              <div className="flex items-center gap-3 rounded-[var(--radius-md)] bg-[var(--color-secondary)] p-3">
                <div className="gradient-hero flex h-10 w-10 items-center justify-center rounded-full text-white">
                  <UserRound size={18} />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold">{employee.full_name}</p>
                  <p className="truncate text-xs text-[var(--color-muted-foreground)]">
                    Prefill only — voucher does not require Employee Master
                  </p>
                </div>
              </div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
              {headerFields.map((k) => renderField(k, template?.required_params.includes(k)))}
            </div>

            <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-3">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
                Compensation grid
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {moneyFields.map((k) => renderField(k, k === "basic"))}
              </div>
              <p className="mt-3 text-sm font-semibold">
                Net: <span className="font-mono">{netFrom(params)}</span>
              </p>
            </div>

            {addressFields.length ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {addressFields.map((k) => renderField(k))}
              </div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
              {otherFields.map((k) => renderField(k, template?.required_params.includes(k)))}
            </div>

            <div className="flex gap-2 pt-1">
              <Button
                variant="outline"
                className="flex-1"
                data-testid="btn-document-preview"
                disabled={!ready || issue.isPending}
                onClick={fetchPreview}
              >
                <Eye size={15} /> Preview
              </Button>
              <Button
                variant="gradient"
                className="flex-1"
                data-testid="btn-document-issue"
                disabled={!ready || issue.isPending}
                onClick={() => {
                  if (!ready) {
                    toast.error("Missing required fields", titleCase(missingRequired.join(", ")));
                    return;
                  }
                  issue.mutate();
                }}
              >
                <Printer size={15} />
                {issue.isPending
                  ? editing
                    ? "Saving…"
                    : "Issuing…"
                  : editing
                    ? "Save & PDF"
                    : "Issue & PDF"}
              </Button>
            </div>
            {editing ? (
              <Button variant="ghost" className="w-full" onClick={clearEdit}>
                <X size={15} /> Cancel edit — new voucher
              </Button>
            ) : null}
            {!ready ? (
              <p className="text-xs text-[var(--color-destructive)]">
                Required: {titleCase(missingRequired.join(", "))}
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card className="min-h-[540px]">
          <CardHeader>
            <CardTitle>Preview</CardTitle>
            <CardDescription>Single A4 page · bilingual letterhead · Arabic RTL</CardDescription>
          </CardHeader>
          <CardContent>
            {previewHtml ? (
              <iframe
                title="Document preview"
                srcDoc={previewHtml}
                className="h-[min(842px,75vh)] w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white"
              />
            ) : (
              <div className="flex h-[480px] items-center justify-center rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] text-sm text-[var(--color-muted-foreground)]">
                Fill company + party fields, then Preview.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            Issued {kind === "offer_letter" ? "offer letters" : "contracts"}
          </CardTitle>
          <CardDescription>Stored with Focus-style voucher numbers (OFL / CO)</CardDescription>
        </CardHeader>
        <CardContent>
          {history.isPending ? (
            <TableSkeleton />
          ) : (history.data?.documents ?? []).length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--color-muted-foreground)]">
              No documents issued yet.
            </p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Voucher No.</TH>
                  <TH>Date</TH>
                  <TH>Party</TH>
                  <TH>Position</TH>
                  <TH>Basic</TH>
                  <TH>Net</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {(history.data?.documents ?? []).map((doc) => (
                  <TR key={doc.id}>
                    <TD className="font-mono text-xs">
                      {doc.voucher_no ||
                        (doc.document_number
                          ? String(doc.document_number).padStart(4, "0")
                          : "—")}
                    </TD>
                    <TD className="text-xs">
                      {fmtDate(doc.document_date) || fmtDateTime(doc.issued_at)}
                    </TD>
                    <TD className="font-semibold">{doc.employee_name || doc.title}</TD>
                    <TD className="text-xs">{doc.nature_of_employment || "—"}</TD>
                    <TD className="text-xs">{doc.basic ?? "—"}</TD>
                    <TD className="text-xs">{doc.net ?? "—"}</TD>
                    <TD>
                      <Badge variant={doc.status === "issued" ? "success" : "secondary"}>
                        {doc.status}
                      </Badge>
                    </TD>
                    <TD className="text-right">
                      <div className="flex justify-end gap-1.5">
                        <Button variant="outline" size="sm" onClick={() => loadForEdit(doc)}>
                          <Pencil size={14} /> Edit
                        </Button>
                        {doc.has_pdf ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              download(
                                `/documents/${doc.id}/pdf`,
                                `${doc.voucher_no || doc.title}.pdf`
                              )
                            }
                          >
                            <FileDown size={14} /> PDF
                          </Button>
                        ) : null}
                        <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(doc)}>
                          <Trash2 size={14} className="text-[var(--color-destructive)]" />
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

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) remove.mutate(deleteTarget);
        }}
        title="Delete document?"
        message={`"${deleteTarget?.voucher_no || deleteTarget?.title}" and its PDF will be permanently removed.`}
        confirmLabel="Delete"
        destructive
        busy={remove.isPending}
      />
    </div>
  );
}
