"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  BadgeCheck,
  Banknote,
  CircleCheck,
  CircleDollarSign,
  Clock,
  HandCoins,
  Loader2,
  Pencil,
  Plane,
  Printer,
  Send,
  Ticket as TicketIcon,
  Trash2,
  Wallet,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AllocationPrintSheet } from "@/components/allocation-print-sheet";
import { AirportCombobox } from "@/components/airport-combobox";
import { EmployeeCombobox } from "@/components/employee-combobox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import {
  EmptyState,
  ErrorState,
  PageHeader,
  SearchInput,
  StatCard,
} from "@/components/ui/primitives";
import { TableSkeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { api, ApiError, downloadPost, errorMessage } from "@/lib/api";
import { fmtDate, initials, money, num, statusTone, titleCase, todayLocal } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Employee, Ticket } from "@/lib/types";

type PreviewData = Record<string, unknown>;
type LinkedLoanPrompt = null | "edit" | "delete-ticket" | "delete-loan-only";

interface TicketEditForm {
  travel_date: string;
  origin_code: string;
  destination_code: string;
  ticket_cost: string;
  entitlement: string;
  excess_handling: string;
  tenure_months: string;
  notes: string;
}

const EXCESS_OPTIONS = [
  {
    value: "SELF_PAID",
    label: "Self paid",
    icon: Wallet,
    blurb: "Employee pays the excess directly",
  },
  {
    value: "COMPANY_PAID",
    label: "Fully company paid",
    icon: CircleDollarSign,
    blurb: "Company absorbs the full excess",
  },
  {
    value: "CONVERT_TO_LOAN",
    label: "Make loan",
    icon: HandCoins,
    blurb: "Recover excess via EMI installments",
  },
  {
    value: "ENTITLEMENT_AMOUNT",
    label: "Entitlement amount",
    icon: BadgeCheck,
    blurb: "Cap the ticket at the entitlement",
  },
] as const;

const WORKFLOW: Record<string, Array<{ next: string; label: string; icon: typeof Send; tone: string }>> = {
  draft: [{ next: "submitted", label: "Submit", icon: Send, tone: "default" }],
  submitted: [
    { next: "approved", label: "Approve", icon: CircleCheck, tone: "success" },
    { next: "rejected", label: "Reject", icon: XCircle, tone: "destructive" },
  ],
  approved: [{ next: "paid", label: "Mark paid", icon: Banknote, tone: "default" }],
  rejected: [{ next: "draft", label: "Re-open", icon: Clock, tone: "outline" }],
};

function AllocationPage() {
  const queryClient = useQueryClient();
  const [employeeId, setEmployeeId] = useState("");
  const [travelDate, setTravelDate] = useState(() => todayLocal());
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [amount, setAmount] = useState("");
  const [excessOption, setExcessOption] = useState<string>("");
  const [tenure, setTenure] = useState("12");
  const [notes, setNotes] = useState("");
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [ticketSearch, setTicketSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [editing, setEditing] = useState<Ticket | null>(null);
  const [deleting, setDeleting] = useState<Ticket | null>(null);
  const [loanConfirmOpen, setLoanConfirmOpen] = useState(false);
  const [confirmTenure, setConfirmTenure] = useState("12");
  const [emiPreview, setEmiPreview] = useState<string | null>(null);
  const [printing, setPrinting] = useState<Ticket | null>(null);
  const [printBusy, setPrintBusy] = useState(false);
  const [linkedLoanPrompt, setLinkedLoanPrompt] = useState<LinkedLoanPrompt>(null);
  const [loanActionTicket, setLoanActionTicket] = useState<Ticket | null>(null);
  const [editForm, setEditForm] = useState<TicketEditForm>({
    travel_date: todayLocal(),
    origin_code: "",
    destination_code: "",
    ticket_cost: "",
    entitlement: "",
    excess_handling: "SELF_PAID",
    tenure_months: "12",
    notes: "",
  });

  const employees = useQuery({
    queryKey: ["employees", "all"],
    queryFn: () => api<Employee[]>("/employees?limit=500"),
  });
  const tickets = useQuery({
    queryKey: ["tickets", "register"],
    queryFn: () => api<Ticket[]>("/tickets?limit=500&sort_by=travel_date&sort_order=desc"),
  });

  const employee = useMemo(
    () => (employees.data ?? []).find((e) => e.id === employeeId) ?? null,
    [employees.data, employeeId]
  );

  const openEdit = (ticket: Ticket) => {
    setEditing(ticket);
    setLoanConfirmOpen(false);
    const handling =
      ticket.excess_handling === "LOAN" ? "CONVERT_TO_LOAN" : ticket.excess_handling || "SELF_PAID";
    setEditForm({
      travel_date: String(ticket.travel_date).slice(0, 10),
      origin_code: ticket.origin_code,
      destination_code: ticket.destination_code,
      ticket_cost: String(ticket.ticket_cost),
      entitlement: String(ticket.entitlement),
      excess_handling: handling,
      tenure_months: String(ticket.tenure_months || 12),
      notes: ticket.notes || "",
    });
  };

  const editExcess = Math.max(0, Number(editForm.ticket_cost) - Number(editForm.entitlement));
  const editIsLoan = editForm.excess_handling === "CONVERT_TO_LOAN";

  useEffect(() => {
    if (!loanConfirmOpen || !editIsLoan) {
      setEmiPreview(null);
      return;
    }
    const principal = editExcess;
    const months = Number(confirmTenure);
    if (!(principal > 0) || !Number.isFinite(months) || months < 1) {
      setEmiPreview(null);
      return;
    }
    let cancelled = false;
    api<{ monthly_installment: string | number }>("/loans/preview", {
      method: "POST",
      body: { principal, annual_rate: 0, installments: months },
    })
      .then((data) => {
        if (!cancelled) setEmiPreview(String(data.monthly_installment));
      })
      .catch(() => {
        if (!cancelled) setEmiPreview(null);
      });
    return () => {
      cancelled = true;
    };
  }, [loanConfirmOpen, editIsLoan, editExcess, confirmTenure]);

  const requestSaveEdit = () => {
    if (!editing) return;
    const originCode = editForm.origin_code.trim().toUpperCase();
    const destinationCode = editForm.destination_code.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(originCode) || !/^[A-Z]{3}$/.test(destinationCode)) {
      toast.error("Invalid route", "Enter valid 3-letter airport codes.");
      return;
    }
    if (
      editForm.excess_handling === "ENTITLEMENT_AMOUNT" &&
      !(Number(editForm.entitlement) > 0)
    ) {
      toast.warning(
        "No entitlement",
        "Entitlement amount cannot be used with a zero balance. Choose Self paid, Fully company paid, or Make loan."
      );
      return;
    }
    if (editing.loan_id) {
      setLoanActionTicket(editing);
      setLinkedLoanPrompt("edit");
      return;
    }
    continueSaveAfterLoanChoice();
  };

  const continueSaveAfterLoanChoice = () => {
    if (editIsLoan) {
      if (editExcess <= 0) {
        toast.warning("No excess", "Make loan requires ticket amount above entitlement.");
        return;
      }
      setConfirmTenure(editForm.tenure_months || "12");
      setLoanConfirmOpen(true);
      return;
    }
    updateMutation.mutate();
  };

  const confirmLoanSave = () => {
    const months = Number(confirmTenure);
    if (!Number.isFinite(months) || months < 1) {
      toast.error("EMI months required", "Enter a valid number of EMI months.");
      return;
    }
    setEditForm((f) => ({ ...f, tenure_months: String(months) }));
    setLoanConfirmOpen(false);
    updateMutation.mutate({ tenureMonths: months });
  };

  const deleteLinkedLoanMutation = useMutation({
    mutationFn: async (ticket: Ticket) => {
      if (!ticket.loan_id) throw new Error("No linked loan");
      if (ticket.loan_status === "settled") {
        throw new ApiError(
          422,
          "loan_settled",
          "Settled loans must be Reopened on the Loans page before they can be deleted."
        );
      }
      if (ticket.loan_version == null) {
        throw new ApiError(400, "missing_loan_version", "Refresh the register and try again.");
      }
      await api(`/loans/${ticket.loan_id}`, {
        method: "DELETE",
        headers: { "If-Match": String(ticket.loan_version) },
      });
      return ticket;
    },
    onSuccess: (ticket) => {
      toast.success("Loan deleted", `${ticket.loan_code || "Recovery loan"} removed.`);
      queryClient.invalidateQueries({ queryKey: ["loans"] });
      queryClient.invalidateQueries({ queryKey: ["tickets"] });
      const prompt = linkedLoanPrompt;
      setLinkedLoanPrompt(null);
      if (prompt === "edit" && editing) {
        setEditing({
          ...editing,
          loan_id: null,
          loan_code: null,
          loan_number: null,
          loan_status: null,
          loan_version: null,
          loan_outstanding: null,
        });
        continueSaveAfterLoanChoice();
      } else if (prompt === "delete-ticket" && deleting) {
        deleteMutation.mutate({
          ...deleting,
          loan_id: null,
          loan_code: null,
          loan_number: null,
          loan_status: null,
          loan_version: null,
        });
      } else {
        setLoanActionTicket(null);
      }
    },
    onError: (err) => toast.error("Delete loan failed", errorMessage(err)),
  });

  const printTicketPdf = async (ticket: Ticket) => {
    setPrintBusy(true);
    try {
      const excessOption =
        ticket.excess_handling === "LOAN" ? "CONVERT_TO_LOAN" : ticket.excess_handling || undefined;
      await downloadPost(
        "/allocations/print.pdf",
        {
          ticket_id: ticket.id,
          employee_id: ticket.employee_id,
          as_of_date: String(ticket.travel_date).slice(0, 10),
          requested_ticket_amount: Number(ticket.ticket_cost),
          excess_option: excessOption,
          tenure_months:
            excessOption === "CONVERT_TO_LOAN"
              ? ticket.tenure_months || Number(confirmTenure) || 12
              : undefined,
          origin_code: ticket.origin_code,
          destination_code: ticket.destination_code,
          notes: ticket.notes || "",
          ticket_code:
            ticket.ticket_code ||
            (ticket.ticket_number != null
              ? `T-${String(ticket.ticket_number).padStart(6, "0")}`
              : undefined),
          status: ticket.status,
        },
        `airfare-allocation-${ticket.employee_code || ticket.id.slice(0, 8)}.pdf`
      );
      toast.success("A4 PDF ready", "Allocation slip downloaded from MSSQL.");
    } catch (err) {
      toast.error("Print failed", errorMessage(err));
    } finally {
      setPrintBusy(false);
    }
  };

  const previewMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      api<PreviewData>("/allocations/preview", { method: "POST", body: payload }),
    onSuccess: (data) => setPreview(data),
    onError: (err) => {
      setPreview(null);
      if (!(err instanceof ApiError && err.code === "settlement_required")) {
        toast.error("Preview failed", errorMessage(err));
      }
    },
  });

  const issueMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      api<PreviewData>("/allocations/issue", { method: "POST", body: payload }),
    onSuccess: (data) => {
      toast.success(
        "Ticket issued",
        data.ticket_code ? `Ticket ${data.ticket_code} created.` : "Allocation recorded."
      );
      setPreview(data);
      queryClient.invalidateQueries({ queryKey: ["tickets"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (err) => toast.error("Issue failed", errorMessage(err)),
  });

  const transitionMutation = useMutation({
    mutationFn: ({ ticket, next }: { ticket: Ticket; next: string }) =>
      api(`/tickets/${ticket.id}/status`, {
        method: "PATCH",
        body: { status: next },
        headers: { "If-Match": String(ticket.version) },
      }),
    onSuccess: (_data, vars) => {
      toast.success(`Ticket ${vars.next}`);
      queryClient.invalidateQueries({ queryKey: ["tickets"] });
      queryClient.invalidateQueries({ queryKey: ["loans"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (err) => toast.error("Workflow failed", errorMessage(err)),
  });

  const updateMutation = useMutation({
    mutationFn: (opts?: { tenureMonths?: number }) => {
      if (!editing) throw new Error("No ticket selected");
      const originCode = editForm.origin_code.trim().toUpperCase();
      const destinationCode = editForm.destination_code.trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(originCode) || !/^[A-Z]{3}$/.test(destinationCode)) {
        throw new ApiError(400, "invalid_route", "Enter valid 3-letter airport codes.");
      }
      const isLoan = editForm.excess_handling === "CONVERT_TO_LOAN";
      const tenure = opts?.tenureMonths ?? Number(editForm.tenure_months);
      if (isLoan && (!Number.isFinite(tenure) || tenure < 1)) {
        throw new ApiError(400, "invalid_loan_terms", "Enter a valid loan tenure in months.");
      }
      return api<Ticket & { loan_created?: boolean; loan_revised?: boolean; loan_code?: string | null }>(
        `/tickets/${editing.id}`,
        {
          method: "PUT",
          headers: { "If-Match": String(editing.version) },
          body: {
            travel_date: editForm.travel_date,
            origin_code: originCode,
            destination_code: destinationCode,
            ticket_cost: Number(editForm.ticket_cost),
            entitlement: Number(editForm.entitlement),
            company_paid: Number(editForm.entitlement),
            excess_handling: editForm.excess_handling,
            tenure_months: isLoan ? tenure : null,
            notes: editForm.notes,
          },
        }
      );
    },
    onSuccess: (data) => {
      const loanLabel = data.loan_code || (data.loan_id ? "loan" : null);
      if (data.loan_revised && loanLabel) {
        toast.success("Ticket updated", `Recovery revised — ${loanLabel} created.`);
      } else if (data.loan_created && loanLabel) {
        toast.success("Ticket updated", `Recovery loan ${loanLabel} created.`);
      } else {
        toast.success("Ticket updated");
      }
      setLoanConfirmOpen(false);
      setEditing(null);
      queryClient.invalidateQueries({ queryKey: ["tickets"] });
      queryClient.invalidateQueries({ queryKey: ["loans"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (err) => toast.error("Update failed", errorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: (ticket: Ticket) =>
      api(`/tickets/${ticket.id}`, {
        method: "DELETE",
        headers: { "If-Match": String(ticket.version) },
      }),
    onSuccess: () => {
      toast.success("Ticket deleted");
      setDeleting(null);
      queryClient.invalidateQueries({ queryKey: ["tickets"] });
      queryClient.invalidateQueries({ queryKey: ["loans"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (err) => toast.error("Delete failed", errorMessage(err)),
  });

  const runPreview = (overrides: Record<string, unknown> = {}) => {
    if (!employeeId) return;
    const amt = Number(overrides.amount ?? amount);
    previewMutation.mutate({
      employee_id: employeeId,
      as_of_date: overrides.travel_date ?? travelDate,
      requested_ticket_amount: Number.isFinite(amt) && amt > 0 ? amt : undefined,
      excess_option: (overrides.excess_option ?? excessOption) || undefined,
      tenure_months:
        (overrides.excess_option ?? excessOption) === "CONVERT_TO_LOAN"
          ? Number(overrides.tenure ?? tenure)
          : undefined,
    });
  };

  const entitlement = preview ? Number(preview.final_entitlement_amount ?? 0) : 0;
  const requested = Number(amount) || 0;
  const excess = Math.max(0, requested - entitlement);
  const needsSettlement = Boolean(preview && requested > 0 && excess > 0);
  const entitlementOptionAvailable = entitlement > 0;

  useEffect(() => {
    if (excessOption !== "ENTITLEMENT_AMOUNT") return;
    if (entitlementOptionAvailable) return;
    setExcessOption("");
  }, [entitlementOptionAvailable, excessOption]);

  const issue = () => {
    const amt = Number(amount);
    if (!employeeId || !Number.isFinite(amt) || amt <= 0) {
      toast.warning("Missing details", "Select an employee and enter the ticket amount.");
      return;
    }
    const originCode = origin.trim().toUpperCase();
    const destinationCode = destination.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(originCode) || !/^[A-Z]{3}$/.test(destinationCode)) {
      toast.warning("Route required", "Enter 3-letter origin and destination airport codes.");
      return;
    }
    if (excessOption === "ENTITLEMENT_AMOUNT" && entitlement <= 0) {
      toast.warning(
        "No entitlement",
        "Entitlement amount is unavailable with a zero balance. Choose Self paid, Fully company paid, or Make loan."
      );
      return;
    }
    issueMutation.mutate({
      employee_id: employeeId,
      as_of_date: travelDate,
      requested_ticket_amount: amt,
      excess_option: excessOption || undefined,
      tenure_months: excessOption === "CONVERT_TO_LOAN" ? Number(tenure) : undefined,
      origin_code: originCode,
      destination_code: destinationCode,
      notes,
    });
  };

  const filteredTickets = useMemo(() => {
    const term = ticketSearch.trim().toLowerCase();
    return (tickets.data ?? []).filter((t) => {
      if (statusFilter !== "all" && t.status !== statusFilter) return false;
      if (!term) return true;
      return [t.employee_name, t.employee_code, t.origin_code, t.destination_code, t.ticket_number]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(term));
    });
  }, [tickets.data, ticketSearch, statusFilter]);

  const stats = useMemo(() => {
    const all = tickets.data ?? [];
    return {
      total: all.length,
      draft: all.filter((t) => t.status === "draft").length,
      submitted: all.filter((t) => t.status === "submitted").length,
      posted: all.filter((t) => ["paid", "approved"].includes(t.status)).length,
    };
  }, [tickets.data]);

  return (
    <div className="animate-[fade-in_0.3s_ease-out]" data-testid="airfare-allocation-page">
      <div className={printing ? "no-print" : undefined}>
      <PageHeader
        title="Airfare Allocation"
        subtitle="Calculate entitlement, settle the excess, and issue the ticket"
      />

      <div className="grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Ticket request</CardTitle>
            <CardDescription>Select an employee to auto-calculate entitlement</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="Employee">
              <EmployeeCombobox
                employees={employees.data ?? []}
                value={employeeId}
                data-testid="select-employee"
                placeholder="Type name — e.g. A for names starting with A…"
                onChange={(id) => {
                  setEmployeeId(id);
                  setPreview(null);
                }}
              />
            </Field>

            {employee ? (
              <div className="flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[hsl(243_75%_98%)] p-3">
                <div className="gradient-hero flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white">
                  {initials(employee.full_name)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">{employee.full_name}</p>
                  <p className="text-xs text-[var(--color-muted-foreground)]">
                    {employee.code} · joined {fmtDate(employee.join_date)}
                  </p>
                </div>
                <Badge variant="secondary">{employee.department || "—"}</Badge>
              </div>
            ) : null}

            <div className="grid grid-cols-2 gap-3">
              <Field label="Travel date">
                <Input
                  type="date"
                  value={travelDate}
                  data-testid="input-travel-date"
                  onChange={(e) => setTravelDate(e.target.value)}
                />
              </Field>
              <Field label="Ticket amount">
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={amount}
                  data-testid="input-ticket-amount"
                  onChange={(e) => setAmount(e.target.value)}
                  onBlur={() => runPreview()}
                />
              </Field>
              <Field label="Origin">
                <AirportCombobox
                  value={origin}
                  data-testid="input-origin"
                  placeholder="Search DXB, Dubai, Kochi…"
                  onChange={setOrigin}
                />
              </Field>
              <Field label="Destination">
                <AirportCombobox
                  value={destination}
                  data-testid="input-destination"
                  placeholder="Search COK, Delhi, Lahore…"
                  onChange={setDestination}
                />
              </Field>
            </div>

            <Button
              variant="outline"
              className="w-full"
              data-testid="btn-calculate-entitlement"
              disabled={!employeeId || previewMutation.isPending}
              onClick={() => runPreview()}
            >
              {previewMutation.isPending ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Plane size={15} />
              )}
              Calculate entitlement
            </Button>
          </CardContent>
        </Card>

        <div className="xl:col-span-3">
          {preview ? (
            <div
              className="space-y-4 animate-[slide-up_0.3s_cubic-bezier(0.16,1,0.3,1)]"
              data-testid="panel-allocation-summary"
            >
              <div className="gradient-hero relative overflow-hidden rounded-[var(--radius-lg)] p-6 text-white shadow-lg">
                <Plane
                  className="absolute -right-6 -top-6 h-36 w-36 opacity-10"
                  strokeWidth={1}
                />
                <p className="text-xs font-bold uppercase tracking-[0.14em] opacity-80">
                  Airfare entitlement
                </p>
                <p className="mt-1 text-4xl font-extrabold tracking-tight" data-testid="entitlement-preview">
                  {money(preview.final_entitlement_amount)}
                </p>
                <p className="mt-1 text-sm opacity-85">
                  {titleCase(String(preview.scenario ?? ""))} · rate source:{" "}
                  {titleCase(String(preview.rate_source ?? ""))}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {[
                    ["Per-day rate", num(preview.per_day_rate)],
                    ["Balance days", num(preview.eligible_balance_days)],
                    ["Max payout", money(preview.maximum_payout)],
                  ].map(([label, value]) => (
                    <div
                      key={label}
                      className="rounded-[var(--radius-sm)] bg-white/15 px-3 py-1.5 backdrop-blur-sm"
                    >
                      <span className="mr-2 text-[11px] font-medium uppercase tracking-wide opacity-75">
                        {label}
                      </span>
                      <span className="text-sm font-bold">{value}</span>
                    </div>
                  ))}
                </div>
              </div>

              <Card>
                <CardContent className="grid grid-cols-2 gap-x-6 gap-y-2.5 p-4 sm:grid-cols-3">
                  {[
                    ["Join date", fmtDate(preview.join_date)],
                    ["Last ticket", preview.previous_allocation_date ? fmtDate(preview.previous_allocation_date) : "—"],
                    ["Accrued days", num(preview.accrued_days)],
                    ["Already paid days", num(preview.already_paid_days)],
                    ["Current-year remaining", money(preview.current_year_remaining)],
                    ["Total available funds", money(preview.total_available_funds)],
                  ].map(([label, value]) => (
                    <div key={String(label)}>
                      <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-muted-foreground)]">
                        {label}
                      </p>
                      <p className="text-sm font-semibold">{value}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>

              {requested > 0 ? (
                <Card data-testid="panel-settlement">
                  <CardHeader>
                    <CardTitle>Settlement</CardTitle>
                    <CardDescription>
                      Ticket {money(requested)} vs entitlement {money(entitlement)}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-3 gap-3 text-center">
                      <div className="rounded-[var(--radius-sm)] bg-[var(--color-secondary)] p-3">
                        <p className="text-[11px] font-bold uppercase text-[var(--color-muted-foreground)]">Excess</p>
                        <p className={cn("text-lg font-extrabold", excess > 0 ? "text-[var(--color-destructive)]" : "text-[var(--color-success)]")}>
                          {money(excess)}
                        </p>
                      </div>
                      <div className="rounded-[var(--radius-sm)] bg-[var(--color-secondary)] p-3">
                        <p className="text-[11px] font-bold uppercase text-[var(--color-muted-foreground)]">Company pays</p>
                        <p className="text-lg font-extrabold">{money(preview.company_payout ?? entitlement)}</p>
                      </div>
                      <div className="rounded-[var(--radius-sm)] bg-[var(--color-secondary)] p-3">
                        <p className="text-[11px] font-bold uppercase text-[var(--color-muted-foreground)]">Employee pays</p>
                        <p className="text-lg font-extrabold">{money(preview.employee_payable ?? 0)}</p>
                      </div>
                    </div>

                    {needsSettlement ? (
                      <div className="grid gap-2 sm:grid-cols-2">
                        {EXCESS_OPTIONS.map(({ value, label, icon: Icon, blurb }) => {
                          const disabled =
                            value === "ENTITLEMENT_AMOUNT" && !entitlementOptionAvailable;
                          const selected = excessOption === value && !disabled;
                          return (
                            <button
                              key={value}
                              type="button"
                              disabled={disabled}
                              data-testid={`settlement-option-${value}`}
                              aria-disabled={disabled}
                              title={
                                disabled
                                  ? "No entitlement balance — this option caps the ticket at entitlement and cannot be used at zero."
                                  : undefined
                              }
                              onClick={() => {
                                if (disabled) return;
                                setExcessOption(value);
                                runPreview({ excess_option: value });
                              }}
                              className={cn(
                                "flex items-start gap-3 rounded-[var(--radius-md)] border-2 p-3 text-left transition-all",
                                disabled
                                  ? "cursor-not-allowed border-[var(--color-border)] bg-[var(--color-secondary)] opacity-55"
                                  : "cursor-pointer",
                                selected
                                  ? "border-[var(--color-primary)] bg-[var(--color-primary-muted)] shadow-sm"
                                  : !disabled
                                    ? "border-[var(--color-border)] bg-white hover:border-[hsl(243_75%_75%)]"
                                    : ""
                              )}
                            >
                              <div
                                className={cn(
                                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)]",
                                  selected
                                    ? "gradient-hero text-white"
                                    : "bg-[var(--color-secondary)] text-[var(--color-muted-foreground)]"
                                )}
                              >
                                <Icon size={17} />
                              </div>
                              <div>
                                <p className="text-sm font-bold">{label}</p>
                                <p className="text-xs text-[var(--color-muted-foreground)]">
                                  {disabled
                                    ? "Unavailable — employee has no entitlement amount"
                                    : blurb}
                                </p>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    ) : null}

                    {excessOption === "CONVERT_TO_LOAN" && needsSettlement ? (
                      <Field label="Loan tenure (months)">
                        <Input
                          type="number"
                          min="1"
                          max="600"
                          value={tenure}
                          onChange={(e) => setTenure(e.target.value)}
                          onBlur={() => runPreview()}
                        />
                      </Field>
                    ) : null}

                    {needsSettlement && preview.emi != null ? (
                      <p className="rounded-[var(--radius-sm)] bg-[hsl(38_92%_94%)] px-3 py-2 text-sm font-semibold text-[hsl(32_95%_32%)]">
                        EMI preview: {money(preview.emi)} / month
                      </p>
                    ) : null}

                    <Field label="Notes (optional)">
                      <Textarea
                        rows={2}
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="Reason, approval reference…"
                      />
                    </Field>

                    <Button
                      variant="gradient"
                      size="lg"
                      className="w-full"
                      data-testid="btn-issue-ticket"
                      disabled={
                        issueMutation.isPending || (needsSettlement && !excessOption)
                      }
                      onClick={issue}
                    >
                      {issueMutation.isPending ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <TicketIcon size={16} />
                      )}
                      {needsSettlement && !excessOption
                        ? "Choose how to settle the excess"
                        : "Issue ticket"}
                    </Button>
                  </CardContent>
                </Card>
              ) : null}
            </div>
          ) : (
            <Card className="flex h-full min-h-[420px] items-center justify-center">
              <EmptyState
                icon={<Plane size={22} />}
                title="No preview yet"
                message="Pick an employee to see their entitlement, then enter the ticket amount to settle and issue."
              />
            </Card>
          )}
        </div>
      </div>

      <div className="mt-8">
        <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Total tickets" value={stats.total} icon={<TicketIcon size={20} />} tone="primary" />
          <StatCard label="Draft" value={stats.draft} icon={<Clock size={20} />} tone="accent" />
          <StatCard label="Awaiting approval" value={stats.submitted} icon={<Send size={20} />} tone="warning" />
          <StatCard label="Approved / paid" value={stats.posted} icon={<BadgeCheck size={20} />} tone="success" />
        </div>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>Ticket register</CardTitle>
                <CardDescription>Full workflow: draft → submitted → approved → paid</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-40">
                  <option value="all">All statuses</option>
                  {["draft", "submitted", "approved", "rejected", "paid"].map((s) => (
                    <option key={s} value={s}>{titleCase(s)}</option>
                  ))}
                </Select>
                <SearchInput value={ticketSearch} onChange={setTicketSearch} placeholder="Search tickets…" className="w-56" />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {tickets.isPending ? (
              <TableSkeleton />
            ) : tickets.isError ? (
              <ErrorState error={tickets.error} onRetry={tickets.refetch} />
            ) : filteredTickets.length === 0 ? (
              <EmptyState
                icon={<TicketIcon size={22} />}
                title="No tickets found"
                message="Issue a ticket above or adjust the filters."
              />
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {filteredTickets.map((t) => {
                  const excessAmt = Math.max(
                    0,
                    Number(t.excess_cost ?? Number(t.ticket_cost) - Number(t.entitlement))
                  );
                  const actions = WORKFLOW[t.status] ?? [];
                  return (
                    <div
                      key={t.id}
                      className="group rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white p-4 shadow-[var(--shadow-card)] transition-all hover:shadow-[var(--shadow-pop)]"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div className="gradient-hero flex h-10 w-10 items-center justify-center rounded-[var(--radius-sm)] text-white">
                            <Plane size={17} />
                          </div>
                          <div>
                            <p className="text-sm font-bold">
                              {t.employee_name || t.employee_code || "Employee"}
                            </p>
                            <p className="text-xs text-[var(--color-muted-foreground)]">
                              #{t.ticket_number ?? t.id.slice(0, 8)} · {fmtDate(t.travel_date)}
                            </p>
                          </div>
                        </div>
                        <Badge variant={statusTone(t.status) as never}>{titleCase(t.status)}</Badge>
                      </div>
                      <div className="mt-3 flex items-center gap-2 rounded-[var(--radius-sm)] bg-[var(--color-secondary)] px-3 py-2">
                        <span className="font-mono text-sm font-bold">{t.origin_code}</span>
                        <ArrowRight size={14} className="text-[var(--color-muted-foreground)]" />
                        <span className="font-mono text-sm font-bold">{t.destination_code}</span>
                        <span className="ml-auto text-sm font-extrabold">{money(t.ticket_cost)}</span>
                      </div>
                      <div className="mt-2.5 grid grid-cols-3 gap-2 text-center">
                        <div>
                          <p className="text-[10px] font-bold uppercase text-[var(--color-muted-foreground)]">Entitlement</p>
                          <p className="text-xs font-semibold">{money(t.entitlement)}</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-bold uppercase text-[var(--color-muted-foreground)]">Excess</p>
                          <p className={cn("text-xs font-semibold", excessAmt > 0 && "text-[var(--color-destructive)]")}>
                            {money(excessAmt)}
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] font-bold uppercase text-[var(--color-muted-foreground)]">Handling</p>
                          <p className="text-xs font-semibold">{titleCase(t.excess_handling)}</p>
                        </div>
                      </div>
                      {t.loan_code || t.loan_id ? (
                        <p className="mt-2 text-[11px] font-medium text-[var(--color-muted-foreground)]">
                          Linked recovery {t.loan_code || `loan ${String(t.loan_id).slice(0, 8)}`}
                          {t.loan_status ? ` · ${titleCase(t.loan_status)}` : ""}
                          {t.loan_outstanding != null ? ` · ${money(t.loan_outstanding)}` : ""}
                        </p>
                      ) : null}
                      <div className="mt-3 flex flex-wrap gap-2 border-t border-[var(--color-border)] pt-3">
                        {actions.map(({ next, label, icon: Icon, tone }) => (
                          <Button
                            key={next}
                            size="sm"
                            variant={tone as never}
                            disabled={transitionMutation.isPending}
                            onClick={() => transitionMutation.mutate({ ticket: t, next })}
                          >
                            <Icon size={13} /> {label}
                          </Button>
                        ))}
                        <Button size="sm" variant="outline" onClick={() => openEdit(t)}>
                          <Pencil size={13} /> Edit
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setPrinting(t)}>
                          <Printer size={13} /> Print
                        </Button>
                        {t.loan_id ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setLoanActionTicket(t);
                              setLinkedLoanPrompt("delete-loan-only");
                            }}
                          >
                            <HandCoins size={13} /> Delete loan
                          </Button>
                        ) : null}
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => {
                            if (t.loan_id) {
                              setDeleting(t);
                              setLoanActionTicket(t);
                              setLinkedLoanPrompt("delete-ticket");
                            } else {
                              setDeleting(t);
                            }
                          }}
                        >
                          <Trash2 size={13} /> Delete
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      </div>

      <Dialog
        open={Boolean(editing)}
        onClose={() => {
          setEditing(null);
          setLoanConfirmOpen(false);
        }}
        title={editing ? `Edit ticket #${editing.ticket_number ?? editing.id.slice(0, 8)}` : "Edit ticket"}
        description={
          editing
            ? `${editing.employee_name || editing.employee_code || "Employee"} · ${titleCase(editing.status)}${
                editing.loan_code ? ` · ${editing.loan_code}` : ""
              }`
            : undefined
        }
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setEditing(null);
                setLoanConfirmOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="gradient"
              disabled={updateMutation.isPending}
              onClick={requestSaveEdit}
            >
              {updateMutation.isPending ? "Saving…" : "Save changes"}
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {editing?.loan_id ? (
            <p className="sm:col-span-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-secondary)] px-3 py-2 text-xs text-[var(--color-muted-foreground)]">
              Linked loan {editing.loan_code || editing.loan_id.slice(0, 8)}
              {editing.loan_status ? ` (${titleCase(editing.loan_status)})` : ""}. Saving asks whether
              to delete that loan or keep/revise it — same parent/child confirm pattern as expense
              claim rework workflows.
            </p>
          ) : editForm.excess_handling === "CONVERT_TO_LOAN" ? (
            <p className="sm:col-span-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-secondary)] px-3 py-2 text-xs text-[var(--color-muted-foreground)]">
              Saving with Make loan creates (or recreates) the payroll recovery loan for the excess.
            </p>
          ) : null}
          <Field label="Travel date">
            <Input
              type="date"
              value={editForm.travel_date}
              onChange={(e) => setEditForm((f) => ({ ...f, travel_date: e.target.value }))}
            />
          </Field>
          <Field label="Excess handling">
            <Select
              value={editForm.excess_handling}
              onChange={(e) => setEditForm((f) => ({ ...f, excess_handling: e.target.value }))}
            >
              {EXCESS_OPTIONS.map((opt) => {
                const disabled =
                  opt.value === "ENTITLEMENT_AMOUNT" && !(Number(editForm.entitlement) > 0);
                return (
                  <option key={opt.value} value={opt.value} disabled={disabled}>
                    {disabled ? `${opt.label} (no entitlement)` : opt.label}
                  </option>
                );
              })}
            </Select>
          </Field>
          <Field label="Origin">
            <AirportCombobox
              value={editForm.origin_code}
              onChange={(code) => setEditForm((f) => ({ ...f, origin_code: code }))}
            />
          </Field>
          <Field label="Destination">
            <AirportCombobox
              value={editForm.destination_code}
              onChange={(code) => setEditForm((f) => ({ ...f, destination_code: code }))}
            />
          </Field>
          <Field label="Ticket amount">
            <Input
              type="number"
              min="0"
              step="0.01"
              value={editForm.ticket_cost}
              onChange={(e) => setEditForm((f) => ({ ...f, ticket_cost: e.target.value }))}
            />
          </Field>
          <Field label="Entitlement">
            <Input
              type="number"
              min="0"
              step="0.01"
              value={editForm.entitlement}
              onChange={(e) => setEditForm((f) => ({ ...f, entitlement: e.target.value }))}
            />
          </Field>
          {editForm.excess_handling === "CONVERT_TO_LOAN" ? (
            <Field label="Loan tenure (months)">
              <Input
                type="number"
                min="1"
                step="1"
                value={editForm.tenure_months}
                onChange={(e) => setEditForm((f) => ({ ...f, tenure_months: e.target.value }))}
              />
            </Field>
          ) : null}
          <div className="sm:col-span-2">
            <Field label="Notes">
              <Textarea
                rows={3}
                value={editForm.notes}
                onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </Field>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={loanConfirmOpen}
        onClose={() => setLoanConfirmOpen(false)}
        title="Confirm recovery loan"
        description="Confirm EMI months before saving this allocation as a payroll recovery loan."
        footer={
          <>
            <Button variant="ghost" onClick={() => setLoanConfirmOpen(false)}>
              Back
            </Button>
            <Button
              variant="gradient"
              disabled={updateMutation.isPending}
              onClick={confirmLoanSave}
            >
              {updateMutation.isPending ? "Saving…" : "Confirm & save"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-secondary)] p-3 text-sm">
            <div>
              <p className="text-[10px] font-bold uppercase text-[var(--color-muted-foreground)]">Excess</p>
              <p className="text-lg font-extrabold text-[var(--color-destructive)]">{money(editExcess)}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase text-[var(--color-muted-foreground)]">Est. EMI</p>
              <p className="text-lg font-extrabold">{emiPreview != null ? money(emiPreview) : "—"}</p>
            </div>
          </div>
          <Field label="EMI months">
            <Input
              type="number"
              min="1"
              max="600"
              step="1"
              value={confirmTenure}
              autoFocus
              onChange={(e) => setConfirmTenure(e.target.value)}
            />
          </Field>
          <p className="text-xs text-[var(--color-muted-foreground)]">
            {editing?.loan_id
              ? "Saving revises the linked unpaid recovery loan with this EMI schedule."
              : "Saving creates a recovery loan for the excess amount over this EMI tenure."}
          </p>
        </div>
      </Dialog>

      <Dialog
        open={Boolean(printing)}
        onClose={() => setPrinting(null)}
        title="Print allocation (A4)"
        description={
          printing
            ? `${printing.employee_name || printing.employee_code || "Employee"} · ${
                printing.ticket_code ||
                (printing.ticket_number != null ? `#${printing.ticket_number}` : printing.id.slice(0, 8))
              }`
            : undefined
        }
        size="wide"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPrinting(null)}>
              Close
            </Button>
            <Button
              variant="outline"
              disabled={!printing || printBusy}
              onClick={() => printing && printTicketPdf(printing)}
            >
              {printBusy ? "Preparing…" : "Download A4 PDF"}
            </Button>
            <Button
              variant="gradient"
              disabled={!printing}
              onClick={() => window.print()}
            >
              <Printer size={14} /> Print
            </Button>
          </>
        }
      >
        {printing ? (
          <div className="overflow-auto bg-[hsl(210_20%_96%)] p-4">
            <AllocationPrintSheet ticket={printing} className="shadow-[var(--shadow-card)]" />
          </div>
        ) : null}
      </Dialog>

      <Dialog
        open={Boolean(linkedLoanPrompt)}
        onClose={() => {
          setLinkedLoanPrompt(null);
          if (linkedLoanPrompt === "delete-ticket") setDeleting(null);
        }}
        title={
          linkedLoanPrompt === "delete-loan-only"
            ? "Delete linked recovery loan?"
            : linkedLoanPrompt === "delete-ticket"
              ? "Delete ticket with linked loan?"
              : "Linked recovery loan"
        }
        description={
          loanActionTicket
            ? `${loanActionTicket.loan_code || "Loan"} · ${titleCase(
                loanActionTicket.loan_status || "active"
              )} · outstanding ${money(loanActionTicket.loan_outstanding ?? 0)}`
            : undefined
        }
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setLinkedLoanPrompt(null);
                if (linkedLoanPrompt === "delete-ticket") setDeleting(null);
              }}
            >
              Cancel
            </Button>
            {linkedLoanPrompt === "edit" ? (
              <Button
                variant="outline"
                disabled={updateMutation.isPending || deleteLinkedLoanMutation.isPending}
                onClick={() => {
                  setLinkedLoanPrompt(null);
                  continueSaveAfterLoanChoice();
                }}
              >
                Keep loan & save
              </Button>
            ) : null}
            {linkedLoanPrompt === "delete-ticket" && loanActionTicket?.loan_status !== "settled" ? (
              <Button
                variant="outline"
                disabled={deleteMutation.isPending}
                onClick={() => {
                  setLinkedLoanPrompt(null);
                  if (deleting) deleteMutation.mutate(deleting);
                }}
              >
                Delete ticket only
              </Button>
            ) : null}
            <Button
              variant="destructive"
              disabled={deleteLinkedLoanMutation.isPending || deleteMutation.isPending}
              onClick={() => {
                if (!loanActionTicket) return;
                if (loanActionTicket.loan_status === "settled") {
                  toast.warning(
                    "Loan is settled",
                    "Open Loans → Reopen first, then delete the recovery loan."
                  );
                  return;
                }
                deleteLinkedLoanMutation.mutate(loanActionTicket);
              }}
            >
              {deleteLinkedLoanMutation.isPending
                ? "Deleting loan…"
                : linkedLoanPrompt === "edit"
                  ? "Delete loan & save"
                  : linkedLoanPrompt === "delete-ticket"
                    ? "Delete loan & ticket"
                    : "Delete loan"}
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <p>
            This airfare allocation has a linked recovery loan. Compared with ERPNext/Frappe and
            expense-claim rework flows, parent ticket changes should explicitly offer to remove or
            keep the child recovery record.
          </p>
          {loanActionTicket?.loan_status === "settled" ? (
            <p className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-secondary)] px-3 py-2 text-xs text-[var(--color-muted-foreground)]">
              Settled loans cannot be deleted while payments exist. Use Loans → Reopen (reverses
              settlement payments), then delete.
            </p>
          ) : (
            <p className="text-xs text-[var(--color-muted-foreground)]">
              Deleting the loan voids unpaid recovery only. Loans with posted EMI payments are
              blocked until payments are reversed.
            </p>
          )}
        </div>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleting) && linkedLoanPrompt !== "delete-ticket"}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && deleteMutation.mutate(deleting)}
        title="Delete ticket?"
        message={
          deleting
            ? `Remove ticket #${deleting.ticket_number ?? deleting.id.slice(0, 8)} for ${
                deleting.employee_name || deleting.employee_code || "employee"
              }${deleting.status === "paid" ? " (already marked paid)" : ""}? This cannot be undone.`
            : ""
        }
        confirmLabel="Delete"
        destructive
        busy={deleteMutation.isPending}
      />
    </div>
  );
}

export default AllocationPage;
