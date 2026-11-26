"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Loader2, RefreshCw, Save } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { EmptyState, ErrorState, PageHeader } from "@/components/ui/primitives";
import { TableSkeleton } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { formatBytes } from "@/components/document-viewer";
import { api, errorMessage } from "@/lib/api";
import { useAuth, hasRole } from "@/lib/auth";
import { useCompanies } from "@/lib/branding";
import { pickPrimaryCompanyId } from "@/lib/company";
import { useT } from "@/lib/i18n";
import { formatWhatsAppDisplayList, parseWhatsAppNumbers } from "@/lib/whatsapp-click-to-chat";
import { cn } from "@/lib/utils";

type ManagerRow = {
  manager: string;
  employee_id: string | null;
  code: string;
  whatsapp: string;
  team_size: number;
};

type WaPolicy = {
  include_employee: boolean;
  attachment_mode?: string;
  send_text?: boolean;
  caption_style?: string;
  research_notes?: string[];
  max_manager_numbers?: number;
};

type TicketRow = {
  id: string;
  ticket_code?: string;
  employee_code?: string;
  employee_name?: string;
};

type Preview = {
  text: string;
  caption: string;
  attachments: { kind: string; filename: string; size_bytes: number; pack: boolean }[];
  attachments_count: number;
  rule: string;
  recipients?: {
    recipients: string[];
    managers: string[];
    employee: string[];
    include_employee: boolean;
    employee_on_file: boolean;
  };
  employee?: {
    id: string | null;
    code: string | null;
    name: string | null;
    whatsapp_mobile: string | null;
  };
};

/**
 * Allocation WhatsApp desk — Reporting-managers roster (same UX as Time Tracking).
 * Research: RevoHR / InfiQ — resolve recipients from live org records, edit numbers
 * on the person, show headcount before send, fan-out one-to-one (not a group).
 */
export default function AllocationWhatsAppDeskPage() {
  const t = useT();
  const { me } = useAuth();
  const canEditManagers = hasRole(me, "admin", "system_admin", "hr", "hr_manager");
  const canEditPolicy = hasRole(me, "admin", "system_admin", "hr", "hr_manager");
  const qc = useQueryClient();
  const companies = useCompanies();
  const activeCompany =
    pickPrimaryCompanyId(companies.data);

  const [includeEmployee, setIncludeEmployee] = useState(true);
  const [managerDrafts, setManagerDrafts] = useState<Record<string, string>>({});
  const [ticketId, setTicketId] = useState("");

  const managers = useQuery({
    queryKey: ["alloc-wa-managers", activeCompany],
    enabled: !!activeCompany,
    queryFn: () => api<ManagerRow[]>(`/time-tracking/managers?company_id=${activeCompany}`),
  });

  const policyQ = useQuery({
    queryKey: ["allocation-wa-policy"],
    queryFn: () => api<WaPolicy>("/allocations/whatsapp/policy"),
  });

  const ticketsQ = useQuery({
    queryKey: ["tickets", "wa-desk"],
    queryFn: () => api<TicketRow[]>("/tickets?limit=40"),
  });

  const tickets = useMemo(() => {
    const raw = ticketsQ.data;
    return Array.isArray(raw) ? raw : [];
  }, [ticketsQ.data]);

  useEffect(() => {
    if (policyQ.data) setIncludeEmployee(policyQ.data.include_employee !== false);
  }, [policyQ.data]);

  const withWa = useMemo(
    () => (managers.data ?? []).filter((m) => parseWhatsAppNumbers(m.whatsapp).length > 0).length,
    [managers.data]
  );

  const saveManagerWa = useMutation({
    mutationFn: (m: { employee_id: string; whatsapp: string }) =>
      api<{ whatsapp: string }>("/time-tracking/managers/whatsapp", {
        method: "PUT",
        body: { company_id: activeCompany, ...m },
      }),
    onSuccess: (res, m) => {
      toast.success("Manager WhatsApp saved", res.whatsapp ? `+${res.whatsapp}` : "Cleared");
      setManagerDrafts((d) => {
        const next = { ...d };
        delete next[m.employee_id];
        return next;
      });
      void qc.invalidateQueries({ queryKey: ["alloc-wa-managers", activeCompany] });
      void qc.invalidateQueries({ queryKey: ["tt-managers", activeCompany] });
    },
    onError: (err) => toast.error("Could not save", errorMessage(err)),
  });

  const savePolicyMut = useMutation({
    mutationFn: (include: boolean) => {
      const current = policyQ.data;
      return api<WaPolicy>("/allocations/whatsapp/policy", {
        method: "PUT",
        body: {
          attachment_mode: current?.attachment_mode ?? "single_pack",
          send_text: current?.send_text ?? true,
          caption_style: current?.caption_style ?? "detailed",
          include_employee: include,
        },
      });
    },
    onSuccess: (data) => {
      setIncludeEmployee(data.include_employee !== false);
      toast.success(
        "Send rule saved",
        data.include_employee ? "Employee master pickup on" : "Employee pickup off"
      );
      void qc.invalidateQueries({ queryKey: ["allocation-wa-policy"] });
    },
    onError: (err) => {
      setIncludeEmployee(policyQ.data?.include_employee !== false);
      toast.error("Save failed", errorMessage(err));
    },
  });

  const previewMut = useMutation({
    mutationFn: (id: string) =>
      api<Preview>(`/allocations/${id}/whatsapp/preview`, { method: "POST", body: {} }),
    onError: (err) => toast.error("Preview failed", errorMessage(err)),
  });

  const recipientPlan = previewMut.data?.recipients;

  return (
    <div className="space-y-6" data-testid="allocation-wa-desk">
      <PageHeader
        title={t("nav.allocationWhatsapp")}
        subtitle="Reporting managers = Employee Master “Reporting to”; WhatsApp numbers come from each manager’s master record"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/settings/#whatsapp-distribution-settings"
              className="inline-flex h-8 items-center rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 text-sm hover:bg-[var(--color-secondary)]"
              data-testid="alloc-wa-settings-link"
            >
              Settings → WhatsApp lists
            </Link>
            <Link
              href="/allocation/"
              className="inline-flex h-8 items-center rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 text-sm hover:bg-[var(--color-secondary)]"
            >
              ← {t("nav.allocation")}
            </Link>
          </div>
        }
      />

      <Card data-testid="alloc-wa-managers-card">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Reporting managers</CardTitle>
              <CardDescription>
                From each employee&apos;s &quot;Reporting to&quot;. Managers with a WhatsApp number can
                receive allocation approval packs; numbers save to employee master.
                {managers.data ? (
                  <>
                    {" "}
                    {withWa} of {managers.data.length} managers have WhatsApp.
                  </>
                ) : null}
              </CardDescription>
            </div>
            {canEditPolicy ? (
              <label className="inline-flex items-center gap-2 text-sm whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={includeEmployee}
                  disabled={savePolicyMut.isPending}
                  data-testid="wa-include-employee"
                  onChange={(e) => {
                    const next = e.target.checked;
                    setIncludeEmployee(next);
                    savePolicyMut.mutate(next);
                  }}
                />
                Also send to employee WhatsApp from master
              </label>
            ) : (
              <Badge variant={includeEmployee ? "success" : "outline"}>
                Employee pickup {includeEmployee ? "on" : "off"}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {!activeCompany ? (
            <EmptyState title="No company" message="Activate a company to load reporting managers." />
          ) : managers.isError ? (
            <ErrorState error={managers.error} onRetry={() => managers.refetch()} />
          ) : managers.isLoading ? (
            <TableSkeleton rows={6} />
          ) : !managers.data?.length ? (
            <EmptyState
              title="No reporting managers"
              message="Set Reporting to on employees so allocation can reach their managers."
            />
          ) : (
            <Table cards>
              <THead>
                <TR>
                  <TH>Manager</TH>
                  <TH>Team</TH>
                  <TH>WhatsApp</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {managers.data.map((m) => {
                  const draft = m.employee_id ? managerDrafts[m.employee_id] : undefined;
                  const value = draft ?? m.whatsapp;
                  const dirty =
                    m.employee_id != null && draft !== undefined && draft !== (m.whatsapp || "");
                  return (
                    <TR key={`${m.manager}-${m.code || m.employee_id || "x"}`}>
                      <TD className="font-medium whitespace-normal break-words">
                        {m.manager}
                        {m.code ? (
                          <span className="ms-1 text-xs text-[var(--color-muted-foreground)]">
                            ({m.code})
                          </span>
                        ) : null}
                      </TD>
                      <TD>{m.team_size}</TD>
                      <TD>
                        {m.employee_id && canEditManagers ? (
                          <Input
                            value={value}
                            placeholder="973…"
                            inputMode="tel"
                            dir="ltr"
                            className="max-w-[180px] font-mono text-sm"
                            data-testid={`alloc-wa-mgr-${m.code || m.employee_id}`}
                            onChange={(e) =>
                              setManagerDrafts((d) => ({
                                ...d,
                                [m.employee_id as string]: e.target.value,
                              }))
                            }
                            aria-label={`WhatsApp for ${m.manager}`}
                          />
                        ) : m.whatsapp ? (
                          <span className="font-mono text-sm" dir="ltr">
                            +{parseWhatsAppNumbers(m.whatsapp)[0] || m.whatsapp}
                          </span>
                        ) : m.employee_id ? (
                          <span className="text-xs text-[var(--color-muted-foreground)]">—</span>
                        ) : (
                          <Badge variant="warning">Not an employee — HR only</Badge>
                        )}
                      </TD>
                      <TD>
                        {m.employee_id && canEditManagers && dirty ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={saveManagerWa.isPending}
                            data-testid={`alloc-wa-save-${m.code || m.employee_id}`}
                            onClick={() =>
                              saveManagerWa.mutate({
                                employee_id: m.employee_id as string,
                                whatsapp: draft ?? "",
                              })
                            }
                          >
                            <Save size={14} /> Save
                          </Button>
                        ) : m.whatsapp ? (
                          <Badge variant="success">On file</Badge>
                        ) : null}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText size={16} /> Preview recipients & pack
          </CardTitle>
          <CardDescription>
            Dry-run for a ticket — resolves defaults + employee master. Nothing is sent.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Ticket">
            <Select
              value={ticketId}
              onChange={(e) => setTicketId(e.target.value)}
              data-testid="wa-preview-ticket"
            >
              <option value="">Select ticket…</option>
              {tickets.map((tk) => (
                <option key={tk.id} value={tk.id}>
                  {tk.ticket_code || tk.id.slice(0, 8)}
                  {tk.employee_code ? ` · ${tk.employee_code}` : ""}
                  {tk.employee_name ? ` — ${tk.employee_name}` : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Button
            variant="outline"
            disabled={!ticketId || previewMut.isPending}
            onClick={() => previewMut.mutate(ticketId)}
            data-testid="wa-preview-run"
          >
            {previewMut.isPending ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <RefreshCw size={15} />
            )}{" "}
            Preview
          </Button>

          {previewMut.data ? (
            <div className="space-y-3 rounded-[var(--radius-md)] border border-[var(--color-border)] p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
                {previewMut.data.rule}
              </p>
              <p className="text-sm" dir="ltr">
                <span className="font-semibold">Fan-out ({recipientPlan?.recipients?.length ?? 0}): </span>
                {(recipientPlan?.recipients ?? []).length
                  ? formatWhatsAppDisplayList(recipientPlan?.recipients ?? [])
                  : "—"}
              </p>
              {recipientPlan &&
              "recipients_cap_warning" in recipientPlan &&
              recipientPlan.recipients_cap_warning ? (
                <p className="text-xs font-medium text-[var(--color-warning)]" dir="ltr">
                  {String(recipientPlan.recipients_cap_warning)}
                </p>
              ) : null}
              {previewMut.data.employee ? (
                <p className="text-sm text-[var(--color-muted-foreground)]">
                  Traveller: {previewMut.data.employee.code} — {previewMut.data.employee.name}
                  {recipientPlan?.employee_on_file
                    ? ` · master WA +${(recipientPlan.employee ?? []).join(", +")}`
                    : includeEmployee
                      ? " · no WhatsApp on master"
                      : " · employee pickup off"}
                </p>
              ) : null}
              <div>
                <p className="mb-1 text-xs font-semibold">
                  Attachments ({previewMut.data.attachments_count})
                </p>
                {previewMut.data.attachments.map((a) => (
                  <div
                    key={a.filename}
                    className={cn(
                      "flex items-center gap-2 rounded-[var(--radius-sm)] border px-3 py-2 text-sm",
                      "border-[var(--color-primary)] bg-[var(--color-primary-muted)]"
                    )}
                  >
                    <FileText size={15} />
                    <span className="font-medium">{a.filename}</span>
                    <Badge variant="secondary">{a.kind}</Badge>
                    <span className="ml-auto text-xs text-[var(--color-muted-foreground)]">
                      {formatBytes(a.size_bytes)}
                      {a.pack ? " · pack" : ""}
                    </span>
                  </div>
                ))}
              </div>
              {previewMut.data.caption ? (
                <Field label="PDF caption">
                  <Textarea readOnly rows={2} value={previewMut.data.caption} />
                </Field>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
