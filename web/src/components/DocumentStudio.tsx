import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileText, Plus, Printer, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { EmptyState, ErrorState, PageHeader } from "@/components/ui/primitives";
import { TableSkeleton } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { api, ApiError, download } from "@/lib/api";
import { fmtDateTime, money } from "@/lib/format";

interface Employee {
  id: string;
  code: string;
  full_name: string;
  designation?: string;
  department?: string;
  join_date?: string;
}

interface DocumentTemplate {
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
  kind: string;
  template_key: string;
  title: string;
  status: string;
  employee_id: string;
  employee_code?: string;
  employee_name?: string;
  issued_at?: string | null;
  has_pdf?: boolean;
  version: number;
}

const LABELS: Record<string, string> = {
  position_title: "Position title",
  start_date: "Start date",
  probation_months: "Probation (months)",
  basic_salary: "Basic salary",
  annual_leave_days: "Annual leave days",
  signatory_name: "Signatory name",
  offer_valid_until: "Offer valid until",
  working_hours: "Working hours",
  notice_period_days: "Notice period (days)",
  duration_months: "Contract duration (months)",
  housing_allowance: "Housing allowance",
  transport_allowance: "Transport allowance",
  other_allowance: "Other allowance",
  signatory_title: "Signatory title",
  special_terms: "Special terms",
};

const DEFAULTS: Record<string, string> = {
  probation_months: "3",
  annual_leave_days: "30",
  working_hours: "48 hours / week",
  notice_period_days: "30",
  duration_months: "24",
  signatory_title: "Human Resources Manager",
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function plusDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function DocumentStudio({
  kind,
  title,
  subtitle,
}: {
  kind: "offer_letter" | "contract";
  title: string;
  subtitle: string;
}) {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<DocumentRow | null>(null);
  const [employeeId, setEmployeeId] = useState("");
  const [templateKey, setTemplateKey] = useState("");
  const [params, setParams] = useState<Record<string, string>>({});

  const employees = useQuery({
    queryKey: ["employees", "all"],
    queryFn: () => api<Employee[]>("/employees?limit=500"),
  });

  const templates = useQuery({
    queryKey: ["document-templates"],
    queryFn: () => api<{ templates: DocumentTemplate[] }>("/documents/templates"),
  });

  const documents = useQuery({
    queryKey: ["documents", kind],
    queryFn: () => api<{ documents: DocumentRow[] }>(`/documents?kind=${kind}`),
  });

  const kindTemplates = useMemo(
    () => (templates.data?.templates ?? []).filter((t) => t.kind === kind),
    [templates.data, kind]
  );

  const activeTemplate = kindTemplates.find((t) => t.key === templateKey) ?? kindTemplates[0];

  const openForm = () => {
    const first = kindTemplates[0];
    const firstEmployee = employees.data?.[0];
    setTemplateKey(first?.key ?? "");
    setEmployeeId(firstEmployee?.id ?? "");
    const seed: Record<string, string> = { ...DEFAULTS };
    if (firstEmployee?.designation) seed.position_title = firstEmployee.designation;
    seed.start_date = firstEmployee?.join_date?.slice(0, 10) || todayIso();
    seed.offer_valid_until = plusDays(14);
    seed.signatory_name = "Human Resources";
    setParams(seed);
    setPreviewHtml(null);
    setShowForm(true);
  };

  const previewMutation = useMutation({
    mutationFn: async () => {
      const resp = await api<Response>("/documents/preview", {
        method: "POST",
        body: {
          kind,
          template_key: activeTemplate?.key,
          employee_id: employeeId,
          params,
        },
        raw: true,
      });
      return resp.text();
    },
    onSuccess: (html) => setPreviewHtml(html),
    onError: (err) =>
      toast.error("Preview failed", err instanceof ApiError ? err.detail : err.message),
  });

  const issueMutation = useMutation({
    mutationFn: () =>
      api("/documents", {
        method: "POST",
        body: {
          kind,
          template_key: activeTemplate?.key,
          employee_id: employeeId,
          params,
        },
      }),
    onSuccess: () => {
      toast.success(`${title.slice(0, -1)} issued`);
      setShowForm(false);
      queryClient.invalidateQueries({ queryKey: ["documents", kind] });
    },
    onError: (err) =>
      toast.error("Issue failed", err instanceof ApiError ? err.detail : err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (row: DocumentRow) =>
      api(`/documents/${row.id}`, {
        method: "DELETE",
        headers: { "If-Match": String(row.version) },
      }),
    onSuccess: () => {
      toast.success("Document deleted");
      setDeleting(null);
      queryClient.invalidateQueries({ queryKey: ["documents", kind] });
    },
    onError: (err) =>
      toast.error("Delete failed", err instanceof ApiError ? err.detail : err.message),
  });

  const rows = documents.data?.documents ?? [];
  const fields = [
    ...(activeTemplate?.required_params ?? []),
    ...(activeTemplate?.optional_params ?? []),
  ];

  return (
    <div className="animate-[fade-in_0.3s_ease-out] space-y-6">
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={
          <Button variant="gradient" onClick={openForm} disabled={!kindTemplates.length}>
            <Plus size={15} /> New {kind === "offer_letter" ? "offer letter" : "contract"}
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Issued documents</CardTitle>
          <CardDescription>
            Generated from Jinja2 HTML templates · PDF via xhtml2pdf (same source as preview)
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {documents.isPending ? (
            <TableSkeleton />
          ) : documents.isError ? (
            <ErrorState error={documents.error} onRetry={documents.refetch} />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={<FileText size={22} />}
              title={`No ${kind === "offer_letter" ? "offer letters" : "contracts"} yet`}
              message="Pick an employee, fill the terms, preview, then issue a PDF."
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>#</TH>
                  <TH>Employee</TH>
                  <TH>Title</TH>
                  <TH>Template</TH>
                  <TH>Issued</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((row) => (
                  <TR key={row.id}>
                    <TD className="font-mono text-xs">{row.document_number ?? "—"}</TD>
                    <TD>
                      <div className="font-semibold">{row.employee_name ?? "—"}</div>
                      <div className="text-xs text-[var(--color-muted-foreground)]">
                        {row.employee_code}
                      </div>
                    </TD>
                    <TD className="font-medium">{row.title}</TD>
                    <TD>
                      <Badge variant="secondary">{row.template_key}</Badge>
                    </TD>
                    <TD className="text-sm">{fmtDateTime(row.issued_at)}</TD>
                    <TD>
                      <Badge variant="success">{row.status}</Badge>
                    </TD>
                    <TD className="text-right">
                      <div className="flex justify-end gap-1">
                        {row.has_pdf ? (
                          <Button
                            size="icon"
                            variant="ghost"
                            title="Download PDF"
                            onClick={() =>
                              download(`/documents/${row.id}/pdf`, `${row.title}.pdf`)
                            }
                          >
                            <Download size={15} />
                          </Button>
                        ) : null}
                        <Button
                          size="icon"
                          variant="ghost"
                          title="Delete"
                          onClick={() => setDeleting(row)}
                        >
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
        title={`New ${kind === "offer_letter" ? "offer letter" : "employment contract"}`}
        description="Preview uses the same HTML template that becomes the PDF."
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
            <Button
              variant="outline"
              disabled={!employeeId || !activeTemplate || previewMutation.isPending}
              onClick={() => previewMutation.mutate()}
            >
              <Printer size={15} />
              {previewMutation.isPending ? "Rendering…" : "Preview"}
            </Button>
            <Button
              variant="gradient"
              disabled={!employeeId || !activeTemplate || issueMutation.isPending}
              onClick={() => issueMutation.mutate()}
            >
              {issueMutation.isPending ? "Issuing…" : "Issue PDF"}
            </Button>
          </>
        }
      >
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-4">
            <Field label="Employee">
              <Select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
                <option value="">Select employee…</option>
                {(employees.data ?? []).map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.code} — {emp.full_name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Template">
              <Select
                value={activeTemplate?.key ?? ""}
                onChange={(e) => setTemplateKey(e.target.value)}
              >
                {kindTemplates.map((tpl) => (
                  <option key={tpl.key} value={tpl.key}>
                    {tpl.label}
                  </option>
                ))}
              </Select>
              {activeTemplate ? (
                <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
                  {activeTemplate.description}
                </p>
              ) : null}
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              {fields.map((field) => (
                <Field
                  key={field}
                  label={LABELS[field] ?? field}
                  className={field === "special_terms" ? "sm:col-span-2" : undefined}
                >
                  {field === "special_terms" ? (
                    <Textarea
                      rows={3}
                      value={params[field] ?? ""}
                      onChange={(e) => setParams((p) => ({ ...p, [field]: e.target.value }))}
                    />
                  ) : (
                    <Input
                      type={
                        field.includes("date")
                          ? "date"
                          : field.includes("salary") ||
                              field.includes("allowance") ||
                              field.includes("months") ||
                              field.includes("days")
                            ? "number"
                            : "text"
                      }
                      value={params[field] ?? ""}
                      onChange={(e) => setParams((p) => ({ ...p, [field]: e.target.value }))}
                    />
                  )}
                </Field>
              ))}
            </div>
          </div>
          <div className="min-h-[420px] overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white">
            {previewHtml ? (
              <iframe
                title="Document preview"
                srcDoc={previewHtml}
                className="h-full min-h-[420px] w-full"
              />
            ) : (
              <div className="flex h-full min-h-[420px] flex-col items-center justify-center gap-2 p-6 text-center text-sm text-[var(--color-muted-foreground)]">
                <FileText size={28} className="opacity-40" />
                Fill the form and click Preview to render the letterhead document.
                {activeTemplate ? (
                  <span className="text-xs">
                    Compensation sample: basic {money(params.basic_salary || 0)}
                  </span>
                ) : null}
              </div>
            )}
          </div>
        </div>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && deleteMutation.mutate(deleting)}
        title="Delete document"
        message={`Permanently delete ${deleting?.title}?`}
        confirmLabel="Delete"
        destructive
        busy={deleteMutation.isPending}
      />
    </div>
  );
}
