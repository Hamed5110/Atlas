"use client";

/**
 * HR Document Lifecycle studio — warning, increment, certificates, disciplinary, promotion.
 * Field list is driven by /v1/hr-lifecycle/forms (soft-delete safe) with template required/optional fallback.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, FileDown, HandCoins, MessageCircle, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { EmployeeCombobox } from "@/components/employee-combobox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { EmptyState, ErrorState, PageHeader } from "@/components/ui/primitives";
import { TableSkeleton } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { api, ApiError, authedFetch, download, errorMessage } from "@/lib/api";
import { canManage, useAuth } from "@/lib/auth";
import { fmtDateTime, titleCase, todayLocal } from "@/lib/format";
import type { Employee } from "@/lib/types";
import {
  formatWhatsAppDisplayList,
  parseWhatsAppNumbers,
} from "@/lib/whatsapp-click-to-chat";

export type LifecycleKind =
  | "warning_letter"
  | "salary_increment"
  | "experience_certificate"
  | "relieving_certificate"
  | "disciplinary_notice"
  | "promotion_notice"
  | "mistake_with_fine";

interface TemplateInfo {
  key: string;
  kind: string;
  label: string;
  description: string;
  required_params: string[];
  optional_params: string[];
  source?: string;
  merge_tokens?: string[];
}

interface FormField {
  key: string;
  label: string;
  type: string;
  required: boolean;
  active?: boolean;
  options?: string[];
  sort_order?: number;
}

interface FormDef {
  id: string;
  kind: string;
  name: string;
  fields: FormField[];
}

interface DocRow {
  id: string;
  voucher_no?: string | null;
  kind: string;
  template_key: string;
  title: string;
  status: string;
  employee_name?: string;
  issued_at?: string | null;
  has_pdf?: boolean;
  version: number;
  loan_id?: string | null;
  loan_code?: string | null;
}

interface DocDetail extends DocRow {
  employee_id?: string | null;
  params?: Record<string, string>;
  document_date?: string | null;
}

const KIND_LABELS: Record<LifecycleKind, string> = {
  warning_letter: "Warning letters",
  salary_increment: "Salary revisions",
  experience_certificate: "Experience certificates",
  relieving_certificate: "Relieving certificates",
  disciplinary_notice: "Disciplinary notices",
  promotion_notice: "Promotion notices",
  mistake_with_fine: "Mistake with Fine",
};

const DEFAULT_TEMPLATE: Record<LifecycleKind, string> = {
  warning_letter: "warning_first",
  salary_increment: "increment_default",
  experience_certificate: "experience_default",
  relieving_certificate: "relieving_default",
  disciplinary_notice: "disciplinary_default",
  promotion_notice: "promotion_default",
  mistake_with_fine: "mistake_fine_default",
};

function blankParams(fields: FormField[]): Record<string, string> {
  const out: Record<string, string> = {
    document_date: todayLocal(),
    signatory_name: "Authorized Signatory",
    signatory_title: "Human Resources",
    recovery_method: "lump_sum_payroll",
    tenure_months: "3",
    consent_acknowledged: "true",
  };
  for (const f of fields) {
    if (out[f.key] === undefined) out[f.key] = f.type === "date" ? todayLocal() : "";
  }
  return out;
}

export function HrLifecycleStudio({ kind }: { kind: LifecycleKind }) {
  const { me } = useAuth();
  const writable = canManage(me);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<{ id: string; version: number; voucherNo: string } | null>(
    null
  );
  const skipBlankOnOpen = useRef(false);
  const [templateKey, setTemplateKey] = useState(DEFAULT_TEMPLATE[kind]);
  const [employeeId, setEmployeeId] = useState("");
  const [params, setParams] = useState<Record<string, string>>({});
  const [previewHtml, setPreviewHtml] = useState("");
  const [status, setStatus] = useState<"draft" | "pending_signature" | "issued">("issued");
  const [notifyWhatsapp, setNotifyWhatsapp] = useState(false);
  const [managerWhatsapp, setManagerWhatsapp] = useState("");
  const [waDefaultsHydrated, setWaDefaultsHydrated] = useState(false);
  const [waSendTarget, setWaSendTarget] = useState<DocRow | null>(null);
  const [waSendNumbers, setWaSendNumbers] = useState("");

  const templates = useQuery({
    queryKey: ["hr-lifecycle-templates"],
    queryFn: () => api<{ templates: TemplateInfo[] }>("/hr-lifecycle/templates"),
  });
  const forms = useQuery({
    queryKey: ["hr-lifecycle-forms", kind],
    queryFn: () => api<{ forms: FormDef[] }>(`/hr-lifecycle/forms?kind=${kind}`),
  });
  const employees = useQuery({
    queryKey: ["employees", "all"],
    queryFn: () => api<Employee[]>("/employees?limit=500"),
  });
  const docs = useQuery({
    queryKey: ["documents", kind],
    queryFn: () => api<{ documents: DocRow[] }>(`/documents?kind=${kind}&limit=200`),
  });
  const waPrefs = useQuery({
    queryKey: ["preferences", "effective", "whatsapp"],
    queryFn: () => api<Record<string, unknown>>("/preferences/effective"),
  });

  useEffect(() => {
    if (waDefaultsHydrated || !waPrefs.data) return;
    const raw = waPrefs.data.whatsapp_default_recipients;
    let next = "";
    if (typeof raw === "string") next = raw;
    else if (Array.isArray(raw)) next = raw.map(String).join("\n");
    if (next.trim() && !managerWhatsapp.trim()) {
      setManagerWhatsapp(next);
    }
    setWaDefaultsHydrated(true);
  }, [waPrefs.data, waDefaultsHydrated, managerWhatsapp]);

  const kindTemplates = useMemo(
    () => (templates.data?.templates ?? []).filter((t) => t.kind === kind),
    [templates.data, kind]
  );
  const form = forms.data?.forms?.[0];
  const activeFields: FormField[] = useMemo(() => {
    if (form?.fields?.length) {
      return [...form.fields]
        .filter((f) => f.active !== false)
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    }
    const tpl = kindTemplates.find((t) => t.key === templateKey) ?? kindTemplates[0];
    if (!tpl) return [];
    return [
      ...tpl.required_params.map((key) => ({
        key,
        label: key.replace(/_/g, " "),
        type: key.includes("date") ? "date" : "text",
        required: true,
        options: [] as string[],
      })),
      ...tpl.optional_params.map((key) => ({
        key,
        label: key.replace(/_/g, " "),
        type: key.includes("date") ? "date" : "text",
        required: false,
        options: [] as string[],
      })),
    ];
  }, [form, kindTemplates, templateKey]);

  useEffect(() => {
    if (!open) return;
    if (skipBlankOnOpen.current) {
      skipBlankOnOpen.current = false;
      return;
    }
    if (editing) return;
    setParams(blankParams(activeFields));
    setPreviewHtml("");
  }, [open, kind, templateKey, editing, activeFields]);

  useEffect(() => {
    if (kindTemplates.length && !kindTemplates.some((t) => t.key === templateKey)) {
      setTemplateKey(kindTemplates[0].key);
    }
  }, [kindTemplates, templateKey]);

  const resetForm = () => {
    setEditing(null);
    setEmployeeId("");
    setStatus("issued");
    setTemplateKey(DEFAULT_TEMPLATE[kind]);
    setParams(blankParams(activeFields));
    setPreviewHtml("");
    setNotifyWhatsapp(false);
  };

  const toastWhatsappResult = (base: string, wa: Record<string, unknown> | undefined) => {
    if (!wa) {
      toast.success(base);
      return;
    }
    const recipients = Array.isArray(wa.recipients)
      ? (wa.recipients as string[])
      : wa.to
        ? [String(wa.to)]
        : [];
    const toLabel =
      recipients.length > 1 ? `${recipients.length} numbers` : recipients[0] || "recipient";
    const pdfPart = wa.pdf_attached
      ? " PDF attached."
      : wa.pdf_error
        ? ` PDF: ${String(wa.pdf_error)}`
        : "";
    if (wa.sent && wa.pdf_attached) {
      toast.success(`${base} · WhatsApp + PDF`, `Evolution → ${toLabel}.${pdfPart}`);
    } else if (wa.sent) {
      toast.success(`${base} · WhatsApp sent`, `Evolution → ${toLabel}.${pdfPart}`);
    } else if (wa.queued) {
      toast.warning(`${base} · WhatsApp queued`, String(wa.error || "") + pdfPart);
    } else if (wa.error) {
      toast.warning(`${base} · WhatsApp failed`, String(wa.error) + pdfPart);
    } else {
      toast.success(base, pdfPart.trim() || undefined);
    }
  };

  const openNew = () => {
    resetForm();
    setOpen(true);
  };

  const closeDialog = () => {
    setOpen(false);
    resetForm();
  };

  const loadForEdit = async (doc: DocRow) => {
    try {
      const detail = await api<DocDetail>(`/documents/${doc.id}`);
      skipBlankOnOpen.current = true;
      setEditing({
        id: detail.id,
        version: detail.version,
        voucherNo: detail.voucher_no || "",
      });
      setTemplateKey(detail.template_key || DEFAULT_TEMPLATE[kind]);
      setEmployeeId(detail.employee_id || "");
      const loaded = { ...blankParams(activeFields), ...(detail.params || {}) };
      if (detail.document_date && !loaded.document_date) {
        loaded.document_date = detail.document_date;
      }
      // Coerce all values to strings for controlled inputs
      const asStrings: Record<string, string> = {};
      for (const [k, v] of Object.entries(loaded)) {
        asStrings[k] = v == null ? "" : String(v);
      }
      setParams(asStrings);
      const st = detail.status;
      setStatus(
        st === "draft" || st === "pending_signature" || st === "issued" ? st : "issued"
      );
      setPreviewHtml("");
      setOpen(true);
      toast.success("Editing", detail.voucher_no || detail.title);
    } catch (e) {
      toast.error("Could not load document", errorMessage(e));
    }
  };

  const loadDefaults = useMutation({
    mutationFn: (id: string) =>
      api<{ params: Record<string, string> }>(`/hr-lifecycle/defaults/${id}`),
    onSuccess: (data) => {
      setParams((prev) => ({ ...prev, ...data.params }));
      toast.success("Prefill", "Employee master values loaded.");
    },
    onError: (e) => toast.error("Prefill failed", errorMessage(e)),
  });

  const preview = useMutation({
    mutationFn: async () => {
      const res = await authedFetch("/hr-lifecycle/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          template_key: templateKey,
          employee_id: employeeId || null,
          params,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.text();
    },
    onSuccess: (html) => setPreviewHtml(html),
    onError: (e) => toast.error("Preview failed", errorMessage(e)),
  });

  const save = useMutation({
    mutationFn: () => {
      const waNumbers = parseWhatsAppNumbers(managerWhatsapp);
      if (notifyWhatsapp && waNumbers.length === 0) {
        throw new ApiError(
          400,
          "manager_whatsapp_required",
          "Enter at least one valid WhatsApp number, or uncheck Send WhatsApp with PDF."
        );
      }
      const waFields = {
        notify_whatsapp: notifyWhatsapp,
        manager_whatsapp: waNumbers[0] || "",
        manager_whatsapp_numbers: waNumbers,
      };
      const payload = {
        kind,
        template_key: templateKey,
        employee_id: employeeId || null,
        params: { ...(params ?? {}) },
        status,
        ...waFields,
      };
      if (editing) {
        return api<DocRow & { whatsapp?: Record<string, unknown> }>(
          `/hr-lifecycle/documents/${editing.id}`,
          {
            method: "PUT",
            headers: { "If-Match": String(editing.version) },
            body: {
              template_key: templateKey,
              employee_id: employeeId || null,
              params: payload.params,
              status,
              ...waFields,
            },
          }
        );
      }
      return api<DocRow & { whatsapp?: Record<string, unknown> }>("/hr-lifecycle/documents", {
        method: "POST",
        body: payload,
      });
    },
    onSuccess: (doc) => {
      const base = editing ? "Updated" : "Issued";
      const detail = editing
        ? `${editing.voucherNo} saved — PDF regenerated.`
        : `${doc.voucher_no || doc.title || "Document"} saved and PDF generated.`;
      if (notifyWhatsapp) {
        toastWhatsappResult(`${base} · ${detail}`, doc.whatsapp);
      } else {
        toast.success(base, detail);
      }
      closeDialog();
      void qc.invalidateQueries({ queryKey: ["documents", kind] });
      void qc.invalidateQueries({ queryKey: ["wa-events"] });
    },
    onError: (e) => toast.error(editing ? "Update failed" : "Issue failed", errorMessage(e)),
  });

  const sendWhatsappMut = useMutation({
    mutationFn: async () => {
      if (!waSendTarget) throw new Error("No document selected");
      const nums = parseWhatsAppNumbers(waSendNumbers);
      if (nums.length === 0) {
        throw new ApiError(
          400,
          "manager_whatsapp_required",
          "Enter at least one valid WhatsApp number."
        );
      }
      return api<{ whatsapp?: Record<string, unknown> }>(
        `/documents/${waSendTarget.id}/whatsapp`,
        {
          method: "POST",
          body: {
            manager_whatsapp: nums[0],
            manager_whatsapp_numbers: nums,
          },
        }
      );
    },
    onSuccess: (data) => {
      toastWhatsappResult(
        `Sent ${waSendTarget?.voucher_no || "document"}`,
        data.whatsapp
      );
      setWaSendTarget(null);
      void qc.invalidateQueries({ queryKey: ["wa-events"] });
    },
    onError: (e) => toast.error("WhatsApp send failed", errorMessage(e)),
  });

  const convertToLoanMut = useMutation({
    mutationFn: async (doc: DocRow) => {
      const detail = await api<DocDetail>(`/documents/${doc.id}`);
      const tenureRaw = detail.params?.tenure_months;
      const tenure = tenureRaw ? Number(tenureRaw) : undefined;
      return api<{
        loan?: { loan_code?: string; principal?: string; monthly_installment?: string };
        warnings?: string[];
      }>(`/hr-lifecycle/documents/${doc.id}/convert-to-loan`, {
        method: "POST",
        body: {
          tenure_months: Number.isFinite(tenure) && tenure! > 0 ? tenure : undefined,
          annual_rate: 0,
          consent_acknowledged: true,
        },
      });
    },
    onSuccess: (data) => {
      const loan = data.loan;
      const warn = data.warnings?.length ? ` ${data.warnings.join(" ")}` : "";
      toast.success(
        "Converted to loan",
        `${loan?.loan_code || "Loan"} · principal ${loan?.principal || "—"} · EMI ${loan?.monthly_installment || "—"}.${warn}`
      );
      void qc.invalidateQueries({ queryKey: ["documents", kind] });
      void qc.invalidateQueries({ queryKey: ["loans"] });
    },
    onError: (e) => toast.error("Convert to loan failed", errorMessage(e)),
  });

  const remove = useMutation({
    mutationFn: ({ id, version }: { id: string; version: number }) =>
      api(`/documents/${id}`, {
        method: "DELETE",
        headers: { "If-Match": String(version) },
      }),
    onSuccess: () => {
      toast.success("Deleted", "Document removed.");
      void qc.invalidateQueries({ queryKey: ["documents", kind] });
    },
    onError: (e) => toast.error("Delete failed", errorMessage(e)),
  });

  const patch = (key: string, value: string) => setParams((p) => ({ ...p, [key]: value }));

  return (
    <div className="space-y-4" data-testid={`hr-lifecycle-${kind}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Merge fields use <code className="text-xs">{"{{ employee.* }}"}</code> /{" "}
          <code className="text-xs">{"{{ params.* }}"}</code>. Soft-deleted form fields are ignored.
        </p>
        {writable ? (
          <Button variant="gradient" data-testid="btn-new-lifecycle-doc" onClick={openNew}>
            <Plus size={15} /> New
          </Button>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{KIND_LABELS[kind]}</CardTitle>
          <CardDescription>
            {(docs.data?.documents?.length ?? 0)} issued — edit any voucher to regenerate PDF
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {docs.isPending ? (
            <TableSkeleton columns={6} label="Loading…" />
          ) : docs.isError ? (
            <ErrorState error={docs.error} onRetry={docs.refetch} />
          ) : !(docs.data?.documents?.length) ? (
            <EmptyState title="No documents yet" message="Issue the first letter from New." />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Voucher</TH>
                  <TH>Title</TH>
                  <TH>Status</TH>
                  <TH>Issued</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {(docs.data?.documents ?? []).map((d) => (
                  <TR key={d.id}>
                    <TD className="font-mono font-semibold">{d.voucher_no}</TD>
                    <TD>
                      <div className="font-semibold">{d.title}</div>
                      <div className="text-xs text-[var(--color-muted-foreground)]">
                        {d.employee_name || "—"}
                      </div>
                    </TD>
                    <TD>
                      <Badge variant={d.status === "issued" ? "success" : "info"}>
                        {titleCase(d.status)}
                      </Badge>
                    </TD>
                    <TD className="text-xs text-[var(--color-muted-foreground)]">
                      {d.issued_at ? fmtDateTime(d.issued_at) : "—"}
                    </TD>
                    <TD className="text-right">
                      <div className="flex justify-end gap-1.5">
                        {writable ? (
                          <Button
                            variant="outline"
                            size="sm"
                            data-testid={`btn-edit-lifecycle-${d.id}`}
                            onClick={() => void loadForEdit(d)}
                          >
                            <Pencil size={14} /> Edit
                          </Button>
                        ) : null}
                        {d.has_pdf ? (
                          <Button
                            variant="outline"
                            size="sm"
                            aria-label="Download PDF"
                            onClick={() =>
                              void download(
                                `/documents/${d.id}/pdf`,
                                `${d.voucher_no || d.id}.pdf`
                              )
                            }
                          >
                            <FileDown size={14} /> PDF
                          </Button>
                        ) : null}
                        {writable && d.has_pdf ? (
                          <Button
                            variant="outline"
                            size="sm"
                            data-testid={`btn-lifecycle-send-whatsapp-${d.id}`}
                            onClick={() => {
                              setWaSendTarget(d);
                              setWaSendNumbers(managerWhatsapp);
                            }}
                          >
                            <MessageCircle size={14} /> WhatsApp
                          </Button>
                        ) : null}
                        {writable && kind === "mistake_with_fine" && d.has_pdf && !d.loan_id ? (
                          <Button
                            variant="outline"
                            size="sm"
                            data-testid={`btn-lifecycle-convert-loan-${d.id}`}
                            disabled={convertToLoanMut.isPending}
                            onClick={() => convertToLoanMut.mutate(d)}
                          >
                            <HandCoins size={14} /> To Loan
                          </Button>
                        ) : null}
                        {kind === "mistake_with_fine" && d.loan_id ? (
                          <Badge variant="success">{d.loan_code || "Loan"}</Badge>
                        ) : null}
                        {writable ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Delete"
                            onClick={() => remove.mutate({ id: d.id, version: d.version })}
                          >
                            <Trash2 size={14} className="text-[var(--color-destructive)]" />
                          </Button>
                        ) : null}
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
        open={open}
        onClose={closeDialog}
        size="full"
        title={
          editing
            ? `Edit — ${editing.voucherNo || KIND_LABELS[kind]}`
            : `New — ${KIND_LABELS[kind]}`
        }
        description={
          editing
            ? "Update merge fields and save to regenerate the PDF (voucher number kept)."
            : "Fill merge fields, preview, then issue PDF."
        }
        footer={
          <div className="flex w-full flex-wrap justify-between gap-2">
            <Button variant="outline" onClick={() => preview.mutate()} disabled={preview.isPending}>
              <Eye size={15} /> Preview
            </Button>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={closeDialog}>
                Cancel
              </Button>
              {editing ? (
                <Button variant="ghost" onClick={resetForm}>
                  Clear edit
                </Button>
              ) : null}
              <Button
                variant="gradient"
                data-testid="btn-issue-lifecycle-doc"
                disabled={
                  save.isPending ||
                  (notifyWhatsapp && parseWhatsAppNumbers(managerWhatsapp).length === 0)
                }
                onClick={() => {
                  if (notifyWhatsapp && parseWhatsAppNumbers(managerWhatsapp).length === 0) {
                    toast.warning(
                      "WhatsApp number required",
                      "Enter at least one valid number, or uncheck Send WhatsApp with PDF."
                    );
                    return;
                  }
                  save.mutate();
                }}
              >
                {save.isPending
                  ? editing
                    ? "Saving…"
                    : "Issuing…"
                  : editing
                    ? notifyWhatsapp
                      ? "Save & WhatsApp"
                      : "Save & regenerate PDF"
                    : notifyWhatsapp
                      ? "Issue & WhatsApp"
                      : "Issue PDF"}
              </Button>
            </div>
          </div>
        }
      >
        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-2">
          <div className="space-y-3 overflow-y-auto pr-1">
            {editing ? (
              <p className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-muted)]/40 px-3 py-2 text-xs text-[var(--color-muted-foreground)]">
                Editing voucher <strong className="font-mono text-[var(--color-foreground)]">{editing.voucherNo}</strong>
                — voucher number will not change.
              </p>
            ) : null}
            <Field label="Template">
              <Select value={templateKey} onChange={(e) => setTemplateKey(e.target.value)}>
                {kindTemplates.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Employee (optional prefill)">
              <EmployeeCombobox
                employees={employees.data ?? []}
                value={employeeId}
                onChange={(id) => {
                  setEmployeeId(id);
                  if (id) loadDefaults.mutate(id);
                }}
              />
            </Field>
            <Field label="Status">
              <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
                <option value="issued">Issued</option>
                <option value="draft">Draft</option>
                <option value="pending_signature">Pending signature</option>
              </Select>
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              {activeFields.map((f) => (
                <Field key={f.key} label={`${f.label}${f.required ? " *" : ""}`}>
                  {f.type === "textarea" ? (
                    <Textarea value={params[f.key] ?? ""} onChange={(e) => patch(f.key, e.target.value)} />
                  ) : f.type === "dropdown" && f.options?.length ? (
                    <Select value={params[f.key] ?? ""} onChange={(e) => patch(f.key, e.target.value)}>
                      <option value="">—</option>
                      {f.options.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <Input
                      type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}
                      value={params[f.key] ?? ""}
                      onChange={(e) => patch(f.key, e.target.value)}
                    />
                  )}
                </Field>
              ))}
            </div>
            <div
              className="space-y-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-muted)] p-3"
              data-testid="panel-lifecycle-whatsapp"
            >
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  data-testid="chk-lifecycle-notify-whatsapp"
                  checked={notifyWhatsapp}
                  onChange={(e) => setNotifyWhatsapp(e.target.checked)}
                />
                <span>
                  <span className="font-semibold">Send WhatsApp with PDF</span>
                  <span className="block text-xs text-[var(--color-muted-foreground)]">
                    Opt-in. Evolution sends a notice + the issued PDF (max 5 numbers).
                  </span>
                </span>
              </label>
              {notifyWhatsapp ? (
                <Field label="WhatsApp numbers (required when sending)">
                  <Textarea
                    value={managerWhatsapp}
                    data-testid="input-lifecycle-whatsapp"
                    placeholder={"97335000001\n97335000002"}
                    dir="ltr"
                    rows={3}
                    className="font-mono text-sm"
                    onChange={(e) => setManagerWhatsapp(e.target.value)}
                  />
                  {parseWhatsAppNumbers(managerWhatsapp).length > 0 ? (
                    <p className="mt-1 text-[11px] text-[var(--color-muted-foreground)]" dir="ltr">
                      Will message {formatWhatsAppDisplayList(managerWhatsapp)}
                    </p>
                  ) : (
                    <p className="mt-1 text-[11px] text-[var(--color-destructive)]">
                      Enter at least one valid number (8–15 digits), one per line.
                    </p>
                  )}
                </Field>
              ) : null}
            </div>
          </div>
          <div className="min-h-[20rem] overflow-auto rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white p-3">
            {previewHtml ? (
              <iframe title="preview" className="h-full min-h-[28rem] w-full" srcDoc={previewHtml} />
            ) : (
              <p className="text-sm text-[var(--color-muted-foreground)]">Click Preview to render.</p>
            )}
          </div>
        </div>
      </Dialog>

      <Dialog
        open={Boolean(waSendTarget)}
        onClose={() => setWaSendTarget(null)}
        title="Send document via WhatsApp"
        description={
          waSendTarget
            ? `${waSendTarget.voucher_no || waSendTarget.title} — Evolution sends text + stored PDF`
            : undefined
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setWaSendTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="gradient"
              data-testid="btn-confirm-lifecycle-whatsapp"
              disabled={
                sendWhatsappMut.isPending || parseWhatsAppNumbers(waSendNumbers).length === 0
              }
              onClick={() => sendWhatsappMut.mutate()}
            >
              <MessageCircle size={15} />
              {sendWhatsappMut.isPending ? "Sending…" : "Send WhatsApp"}
            </Button>
          </>
        }
      >
        <Field label="WhatsApp numbers">
          <Textarea
            value={waSendNumbers}
            data-testid="input-history-lifecycle-whatsapp"
            placeholder={"97335000001\n97335000002"}
            dir="ltr"
            rows={4}
            className="font-mono text-sm"
            onChange={(e) => setWaSendNumbers(e.target.value)}
          />
          {parseWhatsAppNumbers(waSendNumbers).length > 0 ? (
            <p className="mt-1 text-[11px] text-[var(--color-muted-foreground)]" dir="ltr">
              Will message {formatWhatsAppDisplayList(waSendNumbers)}
            </p>
          ) : (
            <p className="mt-1 text-[11px] text-[var(--color-destructive)]">
              Enter at least one valid number (8–15 digits).
            </p>
          )}
        </Field>
      </Dialog>
    </div>
  );
}

export function HrLifecyclePageShell({
  kind,
  title,
  subtitle,
}: {
  kind: LifecycleKind;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="space-y-6 animate-[fade-in_0.25s_ease-out]">
      <PageHeader title={title} subtitle={subtitle} />
      <HrLifecycleStudio kind={kind} />
    </div>
  );
}
