"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeftRight,
  ArrowRight,
  Banknote,
  CalendarDays,
  Check,
  CircleCheck,
  Inbox,
  Lock,
  MessageCircle,
  Pencil,
  Plane,
  Plus,
  Ticket as TicketIcon,
  Trash2,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toastEssWhatsApp } from "@/components/ess-whatsapp-toast";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, Textarea } from "@/components/ui/input";
import { EmptyState, ErrorState, PageHeader, SearchInput, StatCard } from "@/components/ui/primitives";
import { TableSkeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { api, ApiError, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  essActor,
  essDeleteNeedsReason,
  essLockReason,
  essNotesOnlyReason,
  splitEssNotes,
  essStepIndex,
  essSteps,
  inclusiveLeaveDays,
  isTravelRequest,
  type EssWhatsAppResult,
} from "@/lib/ess-process";
import { fmtDate, statusTone, titleCase } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { Employee, EssRequest } from "@/lib/types";
import { ExcelToolbar } from "@/components/excel-toolbar";

type StatusFilter = "all" | "submitted" | "approved" | "allocated" | "paid" | "rejected";

function badgeTone(status: string) {
  return (status === "allocated" ? "default" : statusTone(status)) as never;
}

function ProcessStepper({ request }: { request: EssRequest }) {
  const steps = essSteps(request.request_type);
  const done = essStepIndex(request.status, request.request_type);
  if (done < 0) {
    return (
      <p className="text-xs font-semibold text-[var(--color-destructive-emphasis)]">
        Rejected. No ticket will be issued.
      </p>
    );
  }
  return (
    <ol
      className="grid gap-1"
      style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
      aria-label="Request progress"
      data-testid="ess-stepper"
    >
      {steps.map((step, i) => (
        <li key={step.key} className="relative flex flex-col items-center gap-1 text-center">
          {i < steps.length - 1 ? (
            <span
              className={cn(
                "absolute left-1/2 top-2.5 h-px w-full",
                i < done ? "bg-[var(--color-success)]" : "bg-[var(--color-border)]"
              )}
              aria-hidden="true"
            />
          ) : null}
          <span
            className={cn(
              "relative flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
              i <= done
                ? "bg-[var(--color-success)] text-white"
                : "bg-[var(--color-secondary)] text-[var(--color-muted-foreground)] ring-1 ring-[var(--color-border)]"
            )}
            aria-hidden="true"
          >
            {i <= done ? <Check size={11} /> : i + 1}
          </span>
          <span
            className={cn(
              "text-[10px] leading-tight",
              i <= done ? "font-semibold" : "text-[var(--color-muted-foreground)]"
            )}
          >
            {step.label}
            <span className="sr-only">{i <= done ? " (done)" : " (pending)"}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function EssPage() {
  const t = useT();
  const queryClient = useQueryClient();
  const actor = essActor(useAuth((s) => s.me));
  const [search, setSearch] = useState("");
  const searchParams = useSearchParams();
  const deepQuery = searchParams.get("q");
  const deepRequest = searchParams.get("request");
  useEffect(() => {
    if (deepQuery != null) setSearch(deepQuery);
  }, [deepQuery]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [notifyEmployee, setNotifyEmployee] = useState(true);
  const [panel, setPanel] = useState<{ id: string; kind: "reject" | "delete" } | null>(null);
  const [panelReason, setPanelReason] = useState("");

  const requests = useQuery({
    queryKey: ["ess-requests"],
    queryFn: () => api<EssRequest[]>("/ess/requests"),
  });
  useEffect(() => {
    if (!deepRequest || !requests.data) return;
    setStatusFilter("all");
    document.getElementById(`ess-request-${deepRequest}`)?.scrollIntoView({ block: "center" });
  }, [deepRequest, requests.data]);
  const employees = useQuery({
    queryKey: ["employees", "all"],
    queryFn: () => api<Employee[]>("/employees?limit=500"),
  });

  const employeeById = useMemo(
    () => new Map((employees.data ?? []).map((e) => [e.id, e])),
    [employees.data]
  );
  const nameOf = (r: EssRequest) => {
    const emp = employeeById.get(r.employee_id);
    return {
      name: r.employee_name || emp?.full_name || "Unknown employee",
      code: r.employee_code || emp?.code || "",
    };
  };

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (requests.data ?? []).filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (!term) return true;
      const emp = employeeById.get(r.employee_id);
      return [
        r.employee_name,
        r.employee_code,
        emp?.full_name,
        emp?.code,
        r.request_type,
        r.status,
        r.origin_code,
        r.destination_code,
        r.ticket_code,
      ]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(term));
    });
  }, [requests.data, search, statusFilter, employeeById]);

  const stats = useMemo(() => {
    const all = requests.data ?? [];
    const count = (s: string) => all.filter((r) => r.status === s).length;
    return {
      submitted: count("submitted"),
      approved: count("approved"),
      allocated: count("allocated"),
      paid: count("paid"),
      rejected: count("rejected"),
    };
  }, [requests.data]);

  const statusMutation = useMutation({
    mutationFn: ({ request, next, reason }: { request: EssRequest; next: string; reason?: string }) =>
      api<EssRequest>(`/ess/requests/${request.id}/status`, {
        method: "PATCH",
        body: { status: next, reason: reason ?? "", notify_whatsapp: notifyEmployee },
        headers: { "If-Match": String(request.version) },
      }),
    onSuccess: (data, vars) => {
      toast.success(
        `Request ${vars.next}`,
        vars.next === "approved" && isTravelRequest(vars.request.request_type)
          ? "Next: use Allocate ticket to issue it in Airfare Allocation."
          : undefined
      );
      toastEssWhatsApp(data.whatsapp);
      setPanel(null);
      queryClient.invalidateQueries({ queryKey: ["ess-requests"] });
    },
    onError: (err) => toast.error("Update failed", errorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: ({ request, reason }: { request: EssRequest; reason: string }) => {
      const qs = new URLSearchParams({ notify_whatsapp: String(notifyEmployee) });
      if (reason) qs.set("reason", reason);
      return api(`/ess/requests/${request.id}?${qs}`, {
        method: "DELETE",
        headers: { "If-Match": String(request.version) },
      });
    },
    onSuccess: (_d, vars) => {
      toast.success(
        "Request deleted",
        ["submitted", "approved"].includes(vars.request.status) && notifyEmployee
          ? "The approver is told on WhatsApp when a number is on file. The record is kept for audit."
          : "The record is kept for audit."
      );
      setPanel(null);
      queryClient.invalidateQueries({ queryKey: ["ess-requests"] });
    },
    onError: (err) => {
      toast.error("Delete failed", errorMessage(err));
      if (err instanceof ApiError && err.code === "stale_version") {
        setPanel(null);
        queryClient.invalidateQueries({ queryKey: ["ess-requests"] });
      }
    },
  });

  const resendMutation = useMutation({
    mutationFn: (request: EssRequest) =>
      api<EssWhatsAppResult>(`/ess/requests/${request.id}/whatsapp-notify`, { method: "POST" }),
    onSuccess: (wa) => toastEssWhatsApp(wa),
    onError: (err) => toast.error("WhatsApp failed", errorMessage(err)),
  });

  const openPanel = (r: EssRequest, kind: "reject" | "delete") => {
    setPanelReason("");
    setPanel({ id: r.id, kind });
  };

  const filterCard = (key: StatusFilter) => () =>
    setStatusFilter((cur) => (cur === key ? "all" : key));

  return (
    <div className="animate-[fade-in_0.3s_ease-out]" data-testid="ess-page">
      <PageHeader
        title={t("page.ess.title")}
        subtitle={t("page.ess.subtitle")}
        actions={
          <>
            <ExcelToolbar dataset="ess-requests" />
            <Link href="/ess/new" className={buttonVariants({ variant: "gradient" })} data-testid="ess-new">
              <Plus size={15} /> New leave &amp; ticket request
            </Link>
          </>
        }
      />

      <div className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
        <StatCard label="Awaiting review" value={stats.submitted} hint="Approve or reject" icon={<Inbox size={20} />} tone="warning" onClick={filterCard("submitted")} />
        <StatCard label="Approved" value={stats.approved} hint="Ready to allocate a ticket" icon={<CircleCheck size={20} />} tone="success" onClick={filterCard("approved")} />
        <StatCard label="Ticket allocated" value={stats.allocated} hint="Waiting for payment" icon={<TicketIcon size={20} />} tone="primary" onClick={filterCard("allocated")} />
        <StatCard label="Paid" value={stats.paid} hint="Ticket paid, request closed" icon={<Banknote size={20} />} tone="accent" onClick={filterCard("paid")} />
        <StatCard label="Rejected" value={stats.rejected} icon={<XCircle size={20} />} tone="destructive" onClick={filterCard("rejected")} />
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>Request queue</CardTitle>
              <CardDescription>
                Submitted → Approved → Ticket allocated (in Airfare Allocation) → Paid (when the ticket is paid)
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label
                className="flex items-center gap-2 text-xs font-medium"
                title="When on: the employee is told when you approve or reject, and the approver is told when a pending or approved request is deleted"
              >
                <input
                  type="checkbox"
                  data-testid="ess-notify-employee"
                  checked={notifyEmployee}
                  onChange={(e) => setNotifyEmployee(e.target.checked)}
                />
                Send WhatsApp notices
              </label>
              <Select
                aria-label="Filter by status"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                className="w-44"
              >
                <option value="all">All statuses</option>
                <option value="submitted">Awaiting review</option>
                <option value="approved">Approved</option>
                <option value="allocated">Ticket allocated</option>
                <option value="paid">Paid</option>
                <option value="rejected">Rejected</option>
              </Select>
              <SearchInput value={search} onChange={setSearch} placeholder="Search name, code, route, ticket…" className="w-72" />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {requests.isPending ? (
            <TableSkeleton label={t("state.loading")} />
          ) : requests.isError ? (
            <ErrorState error={requests.error} onRetry={requests.refetch} />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<Inbox size={22} />}
              title={statusFilter === "all" && !search ? "No requests" : "No matching requests"}
              message={
                statusFilter === "all" && !search
                  ? "Leave and ticket requests will appear here for review."
                  : "Try another status or search term."
              }
            />
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4" data-testid="ess-request-grid">
              {filtered.map((r) => {
                const who = nameOf(r);
                const days = r.leave_days ?? inclusiveLeaveDays(r.leave_start_date, r.leave_end_date);
                const oneWay = r.trip_type === "ONE_WAY";
                const travelReq = isTravelRequest(r.request_type);
                const open = panel?.id === r.id ? panel.kind : null;
                const editLock = essLockReason(r, "edit", actor);
                const deleteLock = essLockReason(r, "delete", actor);
                const notesOnly = essNotesOnlyReason(r);
                const noNumber = r.status !== "submitted" && r.employee_whatsapp_on_file === false;
                const notes = splitEssNotes(r.notes);
                const lastAction = notes.history[notes.history.length - 1];
                const reasonRequired = open === "reject" || (open === "delete" && essDeleteNeedsReason(r.status));
                return (
                  <div
                    key={r.id}
                    id={`ess-request-${r.id}`}
                    data-testid="ess-request-card"
                    className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white p-4 shadow-[var(--shadow-card)]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold" title={who.name}>{who.name}</p>
                        <p className="text-xs text-[var(--color-muted-foreground)]">
                          {[who.code, titleCase(r.request_type)].filter(Boolean).join(" · ")}
                        </p>
                      </div>
                      <Badge variant={badgeTone(r.status)}>
                        {r.status === "allocated" ? "Ticket allocated" : titleCase(r.status)}
                      </Badge>
                    </div>

                    <dl className="grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-[var(--radius-sm)] bg-[var(--color-secondary)] px-3 py-2">
                        <dt className="flex items-center gap-1 text-[var(--color-muted-foreground)]">
                          <CalendarDays size={12} aria-hidden="true" /> Leave
                        </dt>
                        <dd className="mt-0.5 font-semibold">
                          {r.leave_start_date && r.leave_end_date ? (
                            <>
                              <span className="whitespace-nowrap">{fmtDate(r.leave_start_date)}</span> to{" "}
                              <span className="whitespace-nowrap">{fmtDate(r.leave_end_date)}</span>
                              <span className="block text-[var(--color-primary)]">
                                {days} day{days === 1 ? "" : "s"}
                              </span>
                            </>
                          ) : (
                            <span className="text-[var(--color-muted-foreground)]">Not given</span>
                          )}
                        </dd>
                      </div>
                      <div className="rounded-[var(--radius-sm)] bg-[var(--color-secondary)] px-3 py-2">
                        <dt className="flex items-center gap-1 text-[var(--color-muted-foreground)]">
                          {oneWay ? <ArrowRight size={12} aria-hidden="true" /> : <ArrowLeftRight size={12} aria-hidden="true" />}
                          {oneWay ? "One-way" : "Return ticket"}
                        </dt>
                        <dd className="mt-0.5 font-semibold">
                          <span className="block whitespace-nowrap">Depart {fmtDate(r.travel_date)}</span>
                          {!oneWay ? (
                            <span className="block whitespace-nowrap">
                              Return {r.return_date ? fmtDate(r.return_date) : "open"}
                            </span>
                          ) : null}
                        </dd>
                      </div>
                    </dl>

                    <div className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 py-2">
                      <Plane size={14} className="text-[var(--color-muted-foreground)]" aria-hidden="true" />
                      <span className="font-mono text-sm font-bold">{r.origin_code}</span>
                      {oneWay ? (
                        <ArrowRight size={14} className="text-[var(--color-muted-foreground)]" aria-label="to" />
                      ) : (
                        <ArrowLeftRight size={14} className="text-[var(--color-muted-foreground)]" aria-label="round trip to" />
                      )}
                      <span className="font-mono text-sm font-bold">{r.destination_code}</span>
                      {r.ticket_code ? (
                        <Link
                          href={r.ticket_id ? `/allocation?ticket=${encodeURIComponent(r.ticket_id)}` : "/allocation"}
                          className="ml-auto truncate text-xs font-semibold text-[var(--color-primary)] hover:underline"
                          title="Open this ticket in Airfare Allocation to edit or delete it"
                          data-testid="ess-ticket-link"
                        >
                          Ticket {r.ticket_code}
                          {r.ticket_status ? ` · ${titleCase(r.ticket_status)}` : ""}
                        </Link>
                      ) : null}
                    </div>

                    <ProcessStepper request={r} />

                    {notes.text ? (
                      <p className="line-clamp-2 whitespace-pre-line text-xs text-[var(--color-muted-foreground)]" title={notes.text}>{notes.text}</p>
                    ) : null}
                    {lastAction ? (
                      <p
                        className="truncate text-[11px] italic text-[var(--color-muted-foreground)]"
                        title={notes.history.join("\n")}
                        data-testid="ess-last-action"
                      >
                        {lastAction}
                      </p>
                    ) : null}

                    {open ? (
                      <div
                        className="space-y-2 rounded-[var(--radius-sm)] border border-[var(--color-destructive-ring)] bg-[var(--color-destructive-muted)] p-3"
                        data-testid={`ess-${open}-panel`}
                      >
                        <label className="block text-xs font-semibold" htmlFor={`${open}-${r.id}`}>
                          {open === "reject"
                            ? `Reason for rejecting (required${notifyEmployee ? ", sent to the employee on WhatsApp" : ""})`
                            : r.status === "paid"
                              ? "Delete this paid request? Reason (required)"
                              : reasonRequired
                                ? "Delete this approved request? Reason (required, sent to the approver)"
                                : "Delete this request? Reason (optional)"}
                        </label>
                        <Textarea
                          id={`${open}-${r.id}`}
                          rows={2}
                          autoFocus
                          maxLength={500}
                          data-testid={open === "reject" ? "ess-reject-reason" : "ess-delete-reason"}
                          placeholder={open === "reject" ? "e.g. Peak season, please move to August" : "e.g. Trip cancelled by the employee"}
                          value={panelReason}
                          onChange={(e) => setPanelReason(e.target.value)}
                        />
                        {open === "delete" ? (
                          <p className="text-[11px] text-[var(--color-muted-foreground)]">
                            The request disappears from the queue; the record and its history stay in the database for audit.
                            {r.status === "paid" ? " The ticket and finance records are not changed." : ""}
                          </p>
                        ) : null}
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="ghost" onClick={() => setPanel(null)}>
                            Cancel
                          </Button>
                          {open === "reject" ? (
                            <Button
                              size="sm"
                              variant="destructive"
                              data-testid="ess-reject-confirm"
                              disabled={statusMutation.isPending || !panelReason.trim()}
                              onClick={() => statusMutation.mutate({ request: r, next: "rejected", reason: panelReason.trim() })}
                            >
                              <XCircle size={13} /> Confirm reject
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="destructive"
                              data-testid="ess-delete-confirm"
                              disabled={deleteMutation.isPending || (reasonRequired && !panelReason.trim())}
                              onClick={() => deleteMutation.mutate({ request: r, reason: panelReason.trim() })}
                            >
                              <Trash2 size={13} /> Delete request
                            </Button>
                          )}
                        </div>
                      </div>
                    ) : null}

                    <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-[var(--color-border)] pt-3">
                      {r.status === "submitted" && !open && actor.staff ? (
                        <>
                          <Button size="sm" variant="success" disabled={statusMutation.isPending} onClick={() => statusMutation.mutate({ request: r, next: "approved" })}>
                            <CircleCheck size={13} /> Approve
                          </Button>
                          <Button size="sm" variant="destructive" disabled={statusMutation.isPending} onClick={() => openPanel(r, "reject")}>
                            <XCircle size={13} /> Reject
                          </Button>
                        </>
                      ) : null}
                      {r.status === "approved" && travelReq && !open && actor.staff ? (
                        <>
                          <Link
                            href={`/allocation?ess=${encodeURIComponent(r.id)}`}
                            data-testid="ess-allocate"
                            title="Opens Airfare Allocation with this request pre-filled"
                            className={buttonVariants({ size: "sm" })}
                          >
                            <TicketIcon size={13} /> Allocate ticket
                          </Link>
                          <Button size="sm" variant="outline" disabled={statusMutation.isPending} onClick={() => openPanel(r, "reject")}>
                            <XCircle size={13} /> Reject
                          </Button>
                        </>
                      ) : null}
                      {r.status === "approved" && !travelReq && actor.staff ? (
                        <Button size="sm" disabled={statusMutation.isPending} onClick={() => statusMutation.mutate({ request: r, next: "paid" })}>
                          <Banknote size={13} /> Mark paid
                        </Button>
                      ) : null}
                      {r.status === "allocated" ? (
                        <p className="text-xs text-[var(--color-muted-foreground)]">
                          Becomes Paid automatically when the ticket is marked paid in Airfare Allocation.
                        </p>
                      ) : null}
                      <div className="ml-auto flex items-center gap-1.5">
                        {actor.staff ? (
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            data-testid="ess-whatsapp-resend"
                            disabled={resendMutation.isPending}
                            aria-label={noNumber ? "WhatsApp (employee has no number on file)" : "Resend on WhatsApp"}
                            title={
                              r.status === "submitted"
                                ? "Resend the approval request to the reporting officer (or HR) on WhatsApp"
                                : noNumber
                                  ? "The employee has no WhatsApp number on file (Employees screen)"
                                  : "Resend the current status to the employee on WhatsApp"
                            }
                            onClick={() => resendMutation.mutate(r)}
                            className={noNumber ? "text-[var(--color-warning-emphasis)]" : undefined}
                          >
                            <MessageCircle size={14} />
                          </Button>
                        ) : null}
                        {editLock ? null : (
                          <Link
                            href={`/ess/edit?id=${encodeURIComponent(r.id)}`}
                            aria-label={`${notesOnly ? "Edit notes" : "Edit request"} for ${who.name}`}
                            title={
                              notesOnly ??
                              (r.status === "approved"
                                ? "Changing dates, route or type sends it back to Awaiting review"
                                : "Edit request")
                            }
                            data-testid="ess-edit"
                            className={buttonVariants({ variant: "outline", size: "sm" })}
                          >
                            <Pencil size={13} /> {notesOnly ? "Edit notes" : "Edit"}
                          </Link>
                        )}
                        {deleteLock ? null : (
                          <Button
                            size="sm"
                            variant="outline"
                            aria-label={`Delete request for ${who.name}`}
                            title={essDeleteNeedsReason(r.status) ? "Delete (reason required)" : "Delete request"}
                            data-testid="ess-delete"
                            disabled={open === "delete"}
                            onClick={() => openPanel(r, "delete")}
                            className="text-[var(--color-destructive)]"
                          >
                            <Trash2 size={13} /> Delete
                          </Button>
                        )}
                      </div>
                    </div>
                    {editLock || deleteLock ? (
                      <p
                        className="-mt-1 flex items-start gap-1.5 text-[11px] text-[var(--color-muted-foreground)]"
                        data-testid="ess-locked"
                      >
                        <Lock size={12} className="mt-px shrink-0" aria-hidden="true" />
                        <span>
                          {editLock ?? `Delete: ${deleteLock}`}
                          {!editLock && r.ticket_id && r.status === "allocated" && actor.staff ? (
                            <>
                              {" "}
                              <Link
                                href={`/allocation?ticket=${encodeURIComponent(r.ticket_id)}`}
                                data-testid="ess-open-ticket"
                                className="font-semibold text-[var(--color-primary)] hover:underline"
                              >
                                Open ticket to edit or delete
                              </Link>
                            </>
                          ) : null}
                        </span>
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default EssPage;
