"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  ArrowUpDown,
  CalendarDays,
  CircleCheck,
  Info,
  Lock,
  MessageCircle,
  Plane,
  Send,
  Wallet,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AirportCombobox } from "@/components/airport-combobox";
import { EmployeeCombobox } from "@/components/employee-combobox";
import { toastEssWhatsApp } from "@/components/ess-whatsapp-toast";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { api, ApiError, errorMessage } from "@/lib/api";
import {
  addDaysIso,
  essDetailsChanged,
  essFormChecks,
  essNotesOnlyReason,
  inclusiveLeaveDays,
  isTravelRequest,
  splitEssNotes,
  type EssFieldKey,
  type EssFormValues,
  type EssWhatsAppResult,
} from "@/lib/ess-process";
import { fmtDate, initials, money, num, todayLocal } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Employee, EssRequest, Ticket } from "@/lib/types";

const DURATIONS = [
  { days: 7, label: "1 week" },
  { days: 14, label: "2 weeks" },
  { days: 21, label: "3 weeks" },
  { days: 30, label: "30 days" },
] as const;

function Section({
  step,
  title,
  description,
  children,
}: {
  step: number;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-[var(--color-border)] px-5 py-5 last:border-b-0">
      <div className="mb-4 flex items-start gap-3">
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary-muted)] text-xs font-bold text-[var(--color-primary)]"
          aria-hidden="true"
        >
          {step}
        </span>
        <div>
          <h2 className="text-sm font-bold">{title}</h2>
          {description ? (
            <p className="text-xs text-[var(--color-muted-foreground)]">{description}</p>
          ) : null}
        </div>
      </div>
      {children}
    </section>
  );
}

function SummaryRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 text-sm">
      <span className="text-[var(--color-muted-foreground)]">{label}</span>
      <span className="text-right font-semibold">{children}</span>
    </div>
  );
}

const isoDay = (v: string | null | undefined) => (v ? String(v).slice(0, 10) : "");

export function EssRequestForm({
  existing,
  initialEmployeeId = "",
}: {
  /** Present in edit mode. */
  existing?: EssRequest;
  initialEmployeeId?: string;
}) {
  const editing = Boolean(existing);
  const router = useRouter();
  const queryClient = useQueryClient();
  const today = todayLocal();
  const [form, setForm] = useState<EssFormValues & { notes: string }>(() =>
    existing
      ? {
          employee_id: existing.employee_id,
          request_type: existing.request_type,
          trip_type: existing.trip_type === "ONE_WAY" ? "ONE_WAY" : "ROUND_TRIP",
          leave_start_date: isoDay(existing.leave_start_date),
          leave_end_date: isoDay(existing.leave_end_date),
          travel_date: isoDay(existing.travel_date),
          return_date: isoDay(existing.return_date),
          origin_code: existing.origin_code,
          destination_code: existing.destination_code,
          notes: splitEssNotes(existing.notes).text,
        }
      : {
          employee_id: initialEmployeeId,
          request_type: "airfare",
          trip_type: "ROUND_TRIP",
          leave_start_date: "",
          leave_end_date: "",
          travel_date: "",
          return_date: "",
          origin_code: "",
          destination_code: "",
          notes: "",
        }
  );
  // Departure/return follow the leave window until the user edits them.
  const [travelTouched, setTravelTouched] = useState(
    () => Boolean(existing) && isoDay(existing?.travel_date) !== isoDay(existing?.leave_start_date)
  );
  const [returnTouched, setReturnTouched] = useState(
    () => Boolean(existing) && isoDay(existing?.return_date) !== isoDay(existing?.leave_end_date)
  );
  const [initial] = useState(form);
  const history = useMemo(() => splitEssNotes(existing?.notes).history, [existing?.notes]);
  const detailsChanged = editing && essDetailsChanged(initial, form);
  const notesChanged = editing && form.notes.trim() !== initial.notes.trim();
  const needsReapproval = existing?.status === "approved" && detailsChanged;
  const notesOnly = existing ? essNotesOnlyReason(existing) : null;
  const [routeTouched, setRouteTouched] = useState(editing);
  // Default edit Save must not re-notify — opt in per save ("Save & WhatsApp").
  const [notifyApprover, setNotifyApprover] = useState(!editing);
  const [attempted, setAttempted] = useState(false);

  const employees = useQuery({
    queryKey: ["employees", "all"],
    queryFn: () => api<Employee[]>("/employees?limit=500"),
  });
  const requests = useQuery({
    queryKey: ["ess-requests"],
    queryFn: () => api<EssRequest[]>("/ess/requests"),
  });
  const employee = useMemo(
    () => (employees.data ?? []).find((e) => e.id === form.employee_id) ?? null,
    [employees.data, form.employee_id]
  );
  const lastTicket = useQuery({
    queryKey: ["tickets", "employee-last", employee?.code],
    enabled: Boolean(employee?.code),
    queryFn: () =>
      api<Ticket[]>(
        `/tickets?search=${encodeURIComponent(employee!.code)}&limit=20&sort_by=travel_date&sort_order=desc`
      ),
    select: (rows) => rows.find((t) => t.employee_id === employee?.id) ?? null,
  });
  const entitlement = useQuery({
    queryKey: ["ess-entitlement", form.employee_id, form.travel_date],
    enabled: Boolean(form.employee_id && form.travel_date),
    retry: false,
    queryFn: () =>
      api<Record<string, unknown>>("/allocations/preview", {
        method: "POST",
        body: { employee_id: form.employee_id, as_of_date: form.travel_date },
      }),
  });

  // Suggest the employee's last ticket route until the user picks one.
  useEffect(() => {
    const t = lastTicket.data;
    if (!t || routeTouched) return;
    setForm((f) =>
      f.origin_code || f.destination_code
        ? f
        : { ...f, origin_code: t.origin_code || "", destination_code: t.destination_code || "" }
    );
  }, [lastTicket.data, routeTouched]);

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const setLeaveStart = (value: string) =>
    setForm((f) => ({
      ...f,
      leave_start_date: value,
      travel_date: travelTouched ? f.travel_date : value,
    }));
  const setLeaveEnd = (value: string) =>
    setForm((f) => ({ ...f, leave_end_date: value, return_date: returnTouched ? f.return_date : value }));
  const applyDuration = (days: number) => {
    const from = form.leave_start_date || today;
    const to = addDaysIso(from, days - 1);
    setForm((f) => ({
      ...f,
      leave_start_date: from,
      leave_end_date: to,
      travel_date: travelTouched ? f.travel_date : from,
      return_date: returnTouched ? f.return_date : to,
    }));
  };

  const leaveDays = inclusiveLeaveDays(form.leave_start_date, form.leave_end_date);
  const travel = isTravelRequest(form.request_type);
  const employeeHasWhatsApp = employee
    ? String(employee.whatsapp_mobile ?? "").replace(/\D/g, "").length >= 8
    : undefined;
  const checks = essFormChecks(form, {
    today,
    otherRequests: (requests.data ?? []).filter(
      (r) => r.employee_id === form.employee_id && r.id !== existing?.id
    ),
    employeeHasWhatsApp,
  });
  const errors = checks.filter((c) => c.level === "error");
  const warnings = checks.filter((c) => c.level === "warning");
  const fieldError = (key: EssFieldKey) =>
    attempted ? errors.find((c) => c.field === key)?.text : undefined;

  const createMutation = useMutation({
    mutationFn: () =>
      api<
        EssRequest & { reapproval_required?: boolean; changed?: boolean; whatsapp_employee?: EssWhatsAppResult }
      >(
        existing ? `/ess/requests/${existing.id}` : "/ess/requests",
        {
        method: existing ? "PUT" : "POST",
        headers: existing ? { "If-Match": String(existing.version) } : undefined,
        body: {
          employee_id: form.employee_id,
          request_type: form.request_type,
          trip_type: form.trip_type,
          travel_date: form.travel_date,
          return_date: form.trip_type === "ROUND_TRIP" && form.return_date ? form.return_date : null,
          leave_start_date: form.leave_start_date || null,
          leave_end_date: form.leave_end_date || null,
          origin_code: form.origin_code.toUpperCase(),
          destination_code: form.destination_code.toUpperCase(),
          notes: form.notes,
          notify_whatsapp: notifyApprover,
        },
        }
      ),
    onSuccess: (data) => {
      if (!existing) {
        toast.success("Request submitted", "It is now waiting for approval in ESS Requests.");
      } else if (data.changed === false) {
        toast.info("No changes to save");
      } else if (data.reapproval_required) {
        toast.warning("Changes saved", "The request was approved before, so it is back to Awaiting review.");
      } else {
        toast.success("Changes saved", detailsChanged ? undefined : "Notes only, so the status did not change.");
      }
      toastEssWhatsApp(data.whatsapp);
      toastEssWhatsApp(data.whatsapp_employee);
      queryClient.invalidateQueries({ queryKey: ["ess-requests"] });
      queryClient.invalidateQueries({ queryKey: ["ess-request"] });
      router.push("/ess");
    },
    onError: (err) => {
      if (existing && err instanceof ApiError && err.code === "stale_version") {
        toast.warning("Someone else changed this request", "The latest version is loaded. Make your change again.");
        queryClient.invalidateQueries({ queryKey: ["ess-request", existing.id] });
        queryClient.invalidateQueries({ queryKey: ["ess-requests"] });
        return;
      }
      toast.error(existing ? "Save failed" : "Submit failed", errorMessage(err));
    },
  });

  const submit = () => {
    if (editing && !detailsChanged && !notesChanged) {
      toast.info("No changes to save");
      return;
    }
    setAttempted(true);
    if (errors.length && !notesOnly) {
      toast.warning("Check the request", errors[0].text);
      return;
    }
    createMutation.mutate();
  };

  const oneWay = form.trip_type === "ONE_WAY";
  const ent = entitlement.data;

  return (
    <div className="animate-[fade-in_0.3s_ease-out]" data-testid={editing ? "ess-edit-page" : "ess-new-page"}>
      <PageHeader
        title={editing ? "Edit leave & ticket request" : "New leave & ticket request"}
        subtitle="Leave days count both ends. Departure and return follow the leave dates unless you change them."
        actions={
          <Link href="/ess" className={buttonVariants({ variant: "outline" })} data-testid="ess-back">
            <ArrowLeft size={15} /> Back to requests
          </Link>
        }
      />

      {notesOnly ? (
        <div
          className="mb-4 flex items-start gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-secondary)] px-4 py-3 text-sm"
          data-testid="ess-notes-only-banner"
        >
          <Lock size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            {notesOnly}
            {existing?.ticket_id ? (
              <>
                {" "}
                <Link
                  href={`/allocation?ticket=${encodeURIComponent(existing.ticket_id)}`}
                  data-testid="ess-form-open-ticket"
                  className="font-semibold text-[var(--color-primary)] hover:underline"
                >
                  Open the ticket
                </Link>
              </>
            ) : null}
          </span>
        </div>
      ) : null}

      {existing?.status === "approved" && !notesOnly ? (
        <div
          className="mb-4 flex items-start gap-2 rounded-[var(--radius-md)] border border-[var(--color-warning-ring)] bg-[var(--color-warning-muted)] px-4 py-3 text-sm text-[var(--color-warning-emphasis)]"
          data-testid="ess-reapproval-banner"
        >
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          {needsReapproval
            ? "You changed the travel or leave details of an approved request. Saving sends it back to Awaiting review, so the approver must approve the new details."
            : "This request is already approved. Changing dates, route or type sends it back for approval; changing only the notes keeps the approval."}
        </div>
      ) : null}

      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            submit();
          }
        }}
        className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_400px]"
      >
        <Card className="overflow-visible">
          <fieldset
            disabled={Boolean(notesOnly)}
            className="m-0 min-w-0 border-0 p-0 disabled:opacity-60"
            data-testid="ess-details"
          >
          <Section step={1} title="Employee" description="Who is going on leave.">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              {editing ? (
                <Field label="Employee" hint="The employee cannot be changed. Delete this request and create a new one instead.">
                  <Input
                    readOnly
                    data-testid="ess-employee-locked"
                    value={
                      employee
                        ? `${employee.code} — ${employee.full_name}`
                        : [existing?.employee_code, existing?.employee_name].filter(Boolean).join(" — ")
                    }
                  />
                </Field>
              ) : (
                <Field label="Employee" error={fieldError("employee_id")}>
                  <EmployeeCombobox
                    employees={employees.data ?? []}
                    value={form.employee_id}
                    placeholder="Type a name or code…"
                    onChange={(id) => {
                      setRouteTouched(false);
                      setForm((f) => ({ ...f, employee_id: id, origin_code: "", destination_code: "" }));
                    }}
                  />
                </Field>
              )}
              <Field
                label="Request type"
                hint={travel ? "Issued as a ticket in Airfare Allocation after approval." : "Paid directly after approval."}
              >
                <Select value={form.request_type} onChange={(e) => set("request_type", e.target.value)}>
                  <option value="airfare">Airfare (annual leave ticket)</option>
                  <option value="ticket">Ticket</option>
                  <option value="loan">Loan</option>
                </Select>
              </Field>
            </div>
            {employee ? (
              <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-1 rounded-[var(--radius-md)] bg-[var(--color-secondary)] px-4 py-3 text-xs">
                <span className="font-bold">{employee.full_name}</span>
                <span>{employee.code}</span>
                {employee.designation ? <span>{employee.designation}</span> : null}
                {employee.department ? <span>{employee.department}</span> : null}
                <span>Joined {fmtDate(employee.join_date)}</span>
                <span className={employeeHasWhatsApp ? "" : "text-[var(--color-warning-emphasis)]"}>
                  <MessageCircle size={12} className="mr-1 inline" aria-hidden="true" />
                  {employeeHasWhatsApp ? "WhatsApp on file" : "No WhatsApp number"}
                </span>
              </div>
            ) : null}
          </Section>

          <Section step={2} title="Leave" description="Both the first and the last day are counted.">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <Field label="Leave from" error={fieldError("leave_start_date")}>
                <Input
                  type="date"
                  data-testid="ess-leave-from"
                  value={form.leave_start_date}
                  onChange={(e) => setLeaveStart(e.target.value)}
                />
              </Field>
              <Field label="Leave to" error={fieldError("leave_end_date")}>
                <Input
                  type="date"
                  data-testid="ess-leave-to"
                  min={form.leave_start_date || undefined}
                  value={form.leave_end_date}
                  onChange={(e) => setLeaveEnd(e.target.value)}
                />
              </Field>
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
                  Leave days
                </span>
                <div
                  className="flex h-10 items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-primary-muted)] px-3"
                  data-testid="ess-leave-days"
                  aria-live="polite"
                >
                  <CalendarDays size={15} className="text-[var(--color-primary)]" aria-hidden="true" />
                  {leaveDays ? (
                    <span className="text-sm font-bold">
                      Leave days: {leaveDays} <span className="font-normal">(both days included)</span>
                    </span>
                  ) : form.leave_start_date && form.leave_end_date ? (
                    <span className="text-sm text-[var(--color-destructive-emphasis)]">Leave to is before Leave from.</span>
                  ) : (
                    <span className="text-sm text-[var(--color-muted-foreground)]">Pick both dates</span>
                  )}
                </div>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label="Quick leave length">
              <span className="text-xs text-[var(--color-muted-foreground)]">Quick length:</span>
              {DURATIONS.map((d) => (
                <Button
                  key={d.days}
                  size="sm"
                  variant={leaveDays === d.days ? "default" : "outline"}
                  data-testid={`ess-duration-${d.days}`}
                  onClick={() => applyDuration(d.days)}
                  title={`Leave to = Leave from + ${d.days - 1} days (${d.days} days in total)`}
                >
                  {d.label}
                </Button>
              ))}
            </div>
          </Section>

          {travel ? (
            <Section step={3} title="Travel" description="Return ticket covers going and coming back on one ticket.">
              <div className="mb-4 inline-flex rounded-[var(--radius-sm)] border border-[var(--color-border)] p-1" role="group" aria-label="Trip type">
                {(
                  [
                    ["ROUND_TRIP", "Return ticket", <ArrowLeftRight key="r" size={14} />],
                    ["ONE_WAY", "One-way", <ArrowRight key="o" size={14} />],
                  ] as const
                ).map(([value, label, icon]) => (
                  <button
                    key={value}
                    type="button"
                    data-testid={`ess-trip-${value === "ONE_WAY" ? "one-way" : "return"}`}
                    aria-pressed={form.trip_type === value}
                    onClick={() => set("trip_type", value)}
                    className={cn(
                      "inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] px-3 text-xs font-semibold transition-colors",
                      form.trip_type === value
                        ? "bg-[var(--color-primary)] text-white"
                        : "text-[var(--color-muted-foreground)] hover:bg-[var(--color-secondary)]"
                    )}
                  >
                    {icon} {label}
                  </button>
                ))}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Departure date" error={fieldError("travel_date")} hint="Defaults to the first leave day.">
                  <Input
                    type="date"
                    data-testid="ess-travel-date"
                    value={form.travel_date}
                    onChange={(e) => {
                      setTravelTouched(true);
                      set("travel_date", e.target.value);
                    }}
                  />
                </Field>
                {!oneWay ? (
                  <Field label="Return date" error={fieldError("return_date")} hint="Defaults to the last leave day. Leave blank if open.">
                    <Input
                      type="date"
                      data-testid="ess-return-date"
                      min={form.travel_date || undefined}
                      value={form.return_date}
                      onChange={(e) => {
                        setReturnTouched(true);
                        set("return_date", e.target.value);
                      }}
                    />
                  </Field>
                ) : (
                  <div className="hidden sm:block" aria-hidden="true" />
                )}
              </div>
              <div className="mt-4 grid items-end gap-4 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
                <Field label="Origin" error={fieldError("origin_code")}>
                  <AirportCombobox
                    value={form.origin_code}
                    placeholder="Search BAH, Bahrain…"
                    onChange={(code) => {
                      setRouteTouched(true);
                      set("origin_code", code);
                    }}
                  />
                </Field>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Swap origin and destination"
                  title="Swap origin and destination"
                  className={fieldError("origin_code") || fieldError("destination_code") ? "sm:mb-6" : ""}
                  onClick={() => {
                    setRouteTouched(true);
                    setForm((f) => ({ ...f, origin_code: f.destination_code, destination_code: f.origin_code }));
                  }}
                >
                  <ArrowUpDown size={15} className="sm:rotate-90" />
                </Button>
                <Field label="Destination" error={fieldError("destination_code")}>
                  <AirportCombobox
                    value={form.destination_code}
                    placeholder="Search KHI, Karachi…"
                    onChange={(code) => {
                      setRouteTouched(true);
                      set("destination_code", code);
                    }}
                  />
                </Field>
              </div>
              {lastTicket.data && !routeTouched ? (
                <p className="mt-2 text-xs text-[var(--color-muted-foreground)]">
                  Route suggested from the last ticket ({lastTicket.data.origin_code} to {lastTicket.data.destination_code},{" "}
                  {fmtDate(lastTicket.data.travel_date)}).
                </p>
              ) : null}
            </Section>
          ) : (
            <Section step={3} title="Dates and route" description="Still needed for the record.">
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Date" error={fieldError("travel_date")}>
                  <Input type="date" data-testid="ess-travel-date" value={form.travel_date} onChange={(e) => set("travel_date", e.target.value)} />
                </Field>
                <Field label="Origin" error={fieldError("origin_code")}>
                  <AirportCombobox value={form.origin_code} placeholder="Search BAH…" onChange={(c) => set("origin_code", c)} />
                </Field>
                <Field label="Destination" error={fieldError("destination_code")}>
                  <AirportCombobox value={form.destination_code} placeholder="Search KHI…" onChange={(c) => set("destination_code", c)} />
                </Field>
              </div>
            </Section>
          )}
          </fieldset>

          <Section step={4} title={notesOnly ? "Notes" : "Notes and notification"}>
            <Field label="Notes" hint="Reason for leave, family members travelling, special requests.">
              <Textarea
                rows={3}
                maxLength={2000}
                value={form.notes}
                onChange={(e) => set("notes", e.target.value)}
                data-testid="ess-notes"
              />
            </Field>
            {history.length ? (
              <div className="mt-3" data-testid="ess-history">
                <p className="text-xs font-semibold">History (kept for audit, cannot be edited)</p>
                <ol className="mt-1 space-y-0.5 text-xs text-[var(--color-muted-foreground)]">
                  {history.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ol>
              </div>
            ) : null}
            <label className={cn("mt-4 flex items-start gap-2 text-sm", notesOnly && "hidden")}>
              <input
                type="checkbox"
                className="mt-0.5"
                data-testid="ess-notify-approver"
                checked={notifyApprover}
                onChange={(e) => setNotifyApprover(e.target.checked)}
              />
              <span>
                {editing ? "Send WhatsApp about the change" : "Send WhatsApp to the approver"}
                <span className="block text-xs text-[var(--color-muted-foreground)]">
                  {editing
                    ? "Only when dates, route or type change. The approver is told; when HR edits, the employee is told too."
                    : "The reporting officer, or the HR WhatsApp number (Time Tracking settings) if there is none."}
                </span>
              </span>
            </label>
          </Section>

          <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-end gap-2 rounded-b-[var(--radius-lg)] border-t border-[var(--color-border)] bg-white/95 px-5 py-3 backdrop-blur">
            <span className="mr-auto hidden text-xs text-[var(--color-muted-foreground)] sm:inline">Ctrl + Enter submits</span>
            <Link href="/ess" className={buttonVariants({ variant: "ghost" })}>
              Cancel
            </Link>
            <Button
              type="submit"
              variant="gradient"
              disabled={createMutation.isPending || (editing && !detailsChanged && !notesChanged)}
              data-testid="ess-submit"
            >
              <Send size={15} />{" "}
              {createMutation.isPending
                ? editing
                  ? "Saving…"
                  : "Submitting…"
                : editing
                  ? !detailsChanged && !notesChanged
                    ? "No changes yet"
                    : notesOnly
                      ? "Save notes"
                      : needsReapproval
                      ? "Save and send for re-approval"
                      : "Save changes"
                  : "Submit request"}
            </Button>
          </div>
        </Card>

        <div className="space-y-4 xl:sticky xl:top-4">
          <Card>
            <CardHeader>
              <CardTitle>Request summary</CardTitle>
              <CardDescription>Updates as you type</CardDescription>
            </CardHeader>
            <CardContent>
              {employee ? (
                <div className="mb-3 flex items-center gap-3">
                  <div className="gradient-hero flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white">
                    {initials(employee.full_name)}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold">{employee.full_name}</p>
                    <p className="text-xs text-[var(--color-muted-foreground)]">{employee.code}</p>
                  </div>
                </div>
              ) : (
                <p className="mb-3 text-sm text-[var(--color-muted-foreground)]">No employee chosen yet.</p>
              )}
              <div className="divide-y divide-[var(--color-border)]">
                <SummaryRow label="Leave">
                  {form.leave_start_date && form.leave_end_date ? (
                    <>
                      {fmtDate(form.leave_start_date)} to {fmtDate(form.leave_end_date)}
                      {leaveDays ? <span className="block text-[var(--color-primary)]">{leaveDays} days</span> : null}
                    </>
                  ) : (
                    "—"
                  )}
                </SummaryRow>
                {travel ? (
                  <SummaryRow label={oneWay ? "One-way" : "Return ticket"}>
                    {form.travel_date ? `Depart ${fmtDate(form.travel_date)}` : "—"}
                    {!oneWay ? (
                      <span className="block">Return {form.return_date ? fmtDate(form.return_date) : "open"}</span>
                    ) : null}
                  </SummaryRow>
                ) : null}
                <SummaryRow label="Route">
                  {form.origin_code && form.destination_code ? (
                    <span className="inline-flex items-center gap-1 font-mono">
                      <Plane size={13} aria-hidden="true" /> {form.origin_code}
                      {oneWay ? <ArrowRight size={12} aria-label="to" /> : <ArrowLeftRight size={12} aria-label="to and back from" />}
                      {form.destination_code}
                    </span>
                  ) : (
                    "—"
                  )}
                </SummaryRow>
              </div>
            </CardContent>
          </Card>

          {travel && form.employee_id ? (
            <Card data-testid="ess-entitlement">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Wallet size={16} aria-hidden="true" /> Ticket entitlement
                </CardTitle>
                <CardDescription>
                  {form.travel_date ? `As of departure, ${fmtDate(form.travel_date)}` : "Pick a departure date"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {!form.travel_date ? null : entitlement.isPending ? (
                  <p className="text-sm text-[var(--color-muted-foreground)]">Calculating…</p>
                ) : entitlement.isError || !ent ? (
                  <p className="text-sm text-[var(--color-muted-foreground)]">
                    Not available: {errorMessage(entitlement.error)}
                  </p>
                ) : (
                  <>
                    <p className="text-2xl font-extrabold">{money(ent.final_entitlement_amount)}</p>
                    <div className="mt-2 divide-y divide-[var(--color-border)]">
                      <SummaryRow label="Balance days">{num(ent.eligible_balance_days)}</SummaryRow>
                      <SummaryRow label="Last ticket">
                        {ent.previous_allocation_date ? fmtDate(String(ent.previous_allocation_date)) : "None"}
                      </SummaryRow>
                    </div>
                    <p className="mt-2 text-xs text-[var(--color-muted-foreground)]">
                      HR sets the final ticket amount and any excess in Airfare Allocation.
                    </p>
                  </>
                )}
              </CardContent>
            </Card>
          ) : null}

          <Card data-testid="ess-checks">
            <CardHeader>
              <CardTitle>Checks</CardTitle>
              <CardDescription>Red items stop the request; amber items are advice.</CardDescription>
            </CardHeader>
            <CardContent>
              {checks.length === 0 ? (
                <p className="flex items-center gap-2 text-sm font-semibold text-[var(--color-success-emphasis)]">
                  <CircleCheck size={15} /> All checks passed
                </p>
              ) : (
                <ul className="space-y-2">
                  {[...errors, ...warnings].map((c, i) => (
                    <li
                      key={`${c.level}-${i}`}
                      className={cn(
                        "flex items-start gap-2 text-sm",
                        c.level === "error"
                          ? "text-[var(--color-destructive-emphasis)]"
                          : "text-[var(--color-warning-emphasis)]"
                      )}
                    >
                      {c.level === "error" ? (
                        <XCircle size={15} className="mt-0.5 shrink-0" aria-label="Must fix" />
                      ) : (
                        <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-label="Advice" />
                      )}
                      {c.text}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Info size={16} aria-hidden="true" /> What happens next
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="list-decimal space-y-1 pl-5 text-sm">
                <li>The approver gets a WhatsApp and approves or rejects in ESS Requests.</li>
                {travel ? (
                  <>
                    <li>HR clicks Allocate ticket: Airfare Allocation opens pre-filled.</li>
                    <li>When the ticket is paid, this request closes as Paid automatically.</li>
                  </>
                ) : (
                  <li>HR marks the loan request paid.</li>
                )}
              </ol>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Badge variant="info">Submitted</Badge>
                <Badge variant="success">Approved</Badge>
                {travel ? <Badge variant="default">Ticket allocated</Badge> : null}
                <Badge variant="secondary">Paid</Badge>
              </div>
            </CardContent>
          </Card>
        </div>
      </form>
    </div>
  );
}