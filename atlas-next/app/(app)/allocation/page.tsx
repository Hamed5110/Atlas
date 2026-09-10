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
  MessageCircle,
  Pencil,
  Plane,
  Printer,
  RefreshCw,
  Send,
  ShieldCheck,
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
import { useT } from "@/lib/i18n";
import {
  buildWhatsAppUrl,
  formatWhatsAppDisplayList,
  parseWhatsAppNumbers,
} from "@/lib/whatsapp-click-to-chat";
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
  manager_approval: string;
  manager_whatsapp: string;
  notify_whatsapp: boolean;
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
  const t = useT();
  const queryClient = useQueryClient();
  const [employeeId, setEmployeeId] = useState("");
  const [travelDate, setTravelDate] = useState(() => todayLocal());
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [amount, setAmount] = useState("");
  const [excessOption, setExcessOption] = useState<string>("");
  const [tenure, setTenure] = useState("12");
  const [notes, setNotes] = useState("");
  const [managerApproval, setManagerApproval] = useState("");
  const [managerWhatsapp, setManagerWhatsapp] = useState("");
  const [tripType, setTripType] = useState<"ROUND_TRIP" | "ONE_WAY">("ROUND_TRIP");
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
    manager_approval: "",
    manager_whatsapp: "",
    notify_whatsapp: false,
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

  const ticketsThisYear = useMemo(() => {
    if (!employeeId || !travelDate) return 0;
    const year = Number(String(travelDate).slice(0, 4));
    return (tickets.data ?? []).filter((t) => {
      if (String(t.employee_id) !== String(employeeId)) return false;
      if (Number(String(t.travel_date).slice(0, 4)) !== year) return false;
      return ["draft", "submitted", "approved", "paid"].includes(t.status);
    }).length;
  }, [tickets.data, employeeId, travelDate]);

  const requiresManagerApproval =
    excessOption === "CONVERT_TO_LOAN" || ticketsThisYear >= 1;

  useEffect(() => {
    if (!employee) {
      setManagerApproval("");
      setManagerWhatsapp("");
      return;
    }
    setManagerApproval(String(employee.reporting_officer_id || "").trim());
  }, [employee?.id]);

  const reloadEmployeeMut = useMutation({
    mutationFn: async () => {
      if (!employeeId) throw new Error("Select an employee first");
      const fresh = await api<Employee>(`/employees/${employeeId}`);
      await queryClient.invalidateQueries({ queryKey: ["employees"] });
      return fresh;
    },
    onSuccess: (fresh) => {
      setPreview(null);
      setManagerApproval(String(fresh.reporting_officer_id || "").trim());
      toast.success("Reloaded from master", `${fresh.code} — ${fresh.full_name}`);
    },
    onError: (e) => toast.error("Reload failed", errorMessage(e)),
  });

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
      manager_approval: "",
      manager_whatsapp: "",
      notify_whatsapp: false,
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
    if (editForm.notify_whatsapp && parseWhatsAppNumbers(editForm.manager_whatsapp).length === 0) {
      toast.warning(
        "Manager WhatsApp required",
        "Enter at least one valid number, or uncheck Send WhatsApp on save."
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
      api<PreviewData & { whatsapp?: Record<string, unknown> }>("/allocations/issue", {
        method: "POST",
        body: payload,
      }),
    onSuccess: (data) => {
      const wa = data.whatsapp || {};
      const ticketMsg = data.ticket_code
        ? `Ticket ${data.ticket_code} created.`
        : "Allocation recorded.";
      const recipients = Array.isArray(wa.recipients)
        ? (wa.recipients as string[])
        : wa.to
          ? [String(wa.to)]
          : [];
      const toLabel =
        recipients.length > 1
          ? `${recipients.length} numbers`
          : recipients[0] || "manager";
      const pdfPart = wa.pdf_attached
        ? " A4 print PDF attached on WhatsApp."
        : wa.attachment_id
          ? " A4 PDF stored on ticket (WhatsApp PDF not delivered)."
          : wa.pdf_error
            ? ` PDF: ${String(wa.pdf_error)}`
            : "";
      if (wa.sent && wa.pdf_attached) {
        toast.success(
          "Ticket issued · WhatsApp + PDF",
          `${ticketMsg} Evolution (${wa.instance || "instance"}) → ${toLabel}.${pdfPart}`
        );
      } else if (wa.sent) {
        toast.success(
          "Ticket issued · WhatsApp sent",
          `${ticketMsg} Evolution (${wa.instance || "instance"}) → ${toLabel}.${pdfPart}`
        );
      } else if (wa.queued) {
        toast.warning(
          "Ticket issued · WhatsApp queued",
          String(wa.error || `${ticketMsg} WhatsApp session not Connected — scan QR in Settings.`) +
            pdfPart
        );
      } else if (wa.skipped === "evolution_disabled") {
        toast.success("Ticket issued", ticketMsg + pdfPart);
      } else if (wa.error) {
        toast.warning("Ticket issued · WhatsApp failed", String(wa.error) + pdfPart);
      } else {
        toast.success("Ticket issued", ticketMsg + pdfPart);
      }
      setPreview(data);
      queryClient.invalidateQueries({ queryKey: ["tickets"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["wa-events"] });
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
      const waNumbers = parseWhatsAppNumbers(editForm.manager_whatsapp);
      if (editForm.notify_whatsapp && waNumbers.length === 0) {
        throw new ApiError(
          400,
          "manager_whatsapp_required",
          "Enter at least one valid WhatsApp number when Send WhatsApp on save is checked."
        );
      }
      return api<
        Ticket & {
          loan_created?: boolean;
          loan_revised?: boolean;
          loan_code?: string | null;
          whatsapp?: Record<string, unknown>;
        }
      >(`/tickets/${editing.id}`, {
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
          manager_approval: editForm.manager_approval.trim() || undefined,
          manager_whatsapp_numbers: waNumbers,
          manager_whatsapp: waNumbers[0] || "",
          notify_whatsapp: Boolean(editForm.notify_whatsapp),
        },
      });
    },
    onSuccess: (data) => {
      const loanLabel = data.loan_code || (data.loan_id ? "loan" : null);
      const wa = data.whatsapp || {};
      let base = "Ticket updated";
      if (data.loan_revised && loanLabel) {
        base = `Ticket updated · Recovery revised — ${loanLabel} created.`;
      } else if (data.loan_created && loanLabel) {
        base = `Ticket updated · Recovery loan ${loanLabel} created.`;
      }
      if (editForm.notify_whatsapp) {
        if (wa.sent && wa.pdf_attached) {
          toast.success("Saved · WhatsApp + PDF", `${base} Sent to ${formatWhatsAppDisplayList(String((wa.recipients as string[])?.join(",") || wa.to || ""))}.`);
        } else if (wa.sent) {
          toast.success("Saved · WhatsApp sent", base);
        } else if (wa.queued) {
          toast.warning("Saved · WhatsApp queued", String(wa.error || base));
        } else if (wa.error) {
          toast.warning("Saved · WhatsApp failed", String(wa.error));
        } else {
          toast.success(base);
        }
      } else {
        toast.success(base);
      }
      setLoanConfirmOpen(false);
      setEditing(null);
      queryClient.invalidateQueries({ queryKey: ["tickets"] });
      queryClient.invalidateQueries({ queryKey: ["loans"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["wa-events"] });
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

  const approvalWhatsAppMessage = useMemo(() => {
    if (!employee || !preview) return "";
    const lines = [
      "ATLAS Airfare Allocation — approval request",
      `Employee: ${employee.code} — ${employee.full_name}`,
      employee.reporting_officer_id ? `Reporting to: ${employee.reporting_officer_id}` : "",
      `Travel date: ${travelDate}`,
      `Route: ${origin || "—"} → ${destination || "—"}`,
      `Ticket: ${money(requested)} · Entitlement: ${money(entitlement)} · Excess: ${money(excess)}`,
      excessOption ? `Settlement: ${excessOption.replaceAll("_", " ")}` : "",
      managerApproval.trim() ? `Approval authority: ${managerApproval.trim()}` : "",
      "Please review and approve.",
    ];
    return lines.filter(Boolean).join("\n");
  }, [
    employee,
    preview,
    travelDate,
    origin,
    destination,
    requested,
    entitlement,
    excess,
    excessOption,
    managerApproval,
  ]);

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
    if (requiresManagerApproval && !managerApproval.trim()) {
      toast.warning(
        "Approval authority required",
        ticketsThisYear >= 1 && excessOption !== "CONVERT_TO_LOAN"
          ? "Second ticket this year needs approval authority before issue. Round trip (going + return) as one issued ticket counts as one claim."
          : "Loan settlement needs approval authority before issue."
      );
      return;
    }
    const waNumbers = parseWhatsAppNumbers(managerWhatsapp);
    if (waNumbers.length === 0) {
      toast.warning(
        "Manager WhatsApp required",
        "Enter at least one valid WhatsApp number (8–15 digits, one per line). Issue sends via Evolution."
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
      manager_approval: managerApproval.trim() || undefined,
      manager_whatsapp: waNumbers[0],
      manager_whatsapp_numbers: waNumbers,
      trip_type: tripType,
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
        title={t("page.allocation.title")}
        subtitle={t("page.allocation.subtitle")}
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
              <div className="space-y-2">
                <div className="flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[hsl(243_75%_98%)] p-3">
                  <div className="gradient-hero flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white">
                    {initials(employee.full_name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold">{employee.full_name}</p>
                    <p className="text-xs text-[var(--color-muted-foreground)]">
                      {employee.code} · joined {fmtDate(employee.join_date)}
                    </p>
                    {employee.reporting_officer_id ? (
                      <p className="mt-0.5 truncate text-[11px] text-[var(--color-muted-foreground)]">
                        Reporting to: {employee.reporting_officer_id}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <Badge variant="secondary">{employee.department || "—"}</Badge>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-[11px]"
                      data-testid="btn-reload-employee-master"
                      disabled={reloadEmployeeMut.isPending}
                      title="Reload this employee from ATLAS master"
                      onClick={() => reloadEmployeeMut.mutate()}
                    >
                      {reloadEmployeeMut.isPending ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <RefreshCw size={12} />
                      )}
                      Reload
                    </Button>
                  </div>
                </div>
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

                    <div
                      className="space-y-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[hsl(243_40%_98%)] p-3"
                      data-testid="panel-approval-whatsapp"
                    >
                      <div className="flex items-start gap-2">
                        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-primary)]" />
                        <div>
                          <p className="text-sm font-bold">Approval & WhatsApp</p>
                          <p className="text-xs text-[var(--color-muted-foreground)]">
                            Issue sends the approval request + A4 PDF through Evolution WhatsApp to every
                            manager number below (max 5)
                            {requiresManagerApproval ? " — approval authority required for loan or 2nd+ ticket" : ""}.
                          </p>
                          <p className="mt-1 text-[11px] text-[var(--color-muted-foreground)]">
                            Ticket counting: each issued allocation is one claim. Round trip (going + return)
                            booked as one ticket = one claim; two one-ways = two claims.
                          </p>
                        </div>
                      </div>

                      <Field label="Trip type">
                        <Select
                          value={tripType}
                          data-testid="select-trip-type"
                          onChange={(e) =>
                            setTripType(e.target.value === "ONE_WAY" ? "ONE_WAY" : "ROUND_TRIP")
                          }
                        >
                          <option value="ROUND_TRIP">Round trip (going and return)</option>
                          <option value="ONE_WAY">One way</option>
                        </Select>
                      </Field>

                      <Field
                        label={
                          requiresManagerApproval
                            ? "Approval authority (required)"
                            : "Approval authority"
                        }
                      >
                        <Input
                          value={managerApproval}
                          data-testid="input-approval-authority"
                          placeholder="Manager name, employee code, or approval reference"
                          onChange={(e) => setManagerApproval(e.target.value)}
                        />
                      </Field>

                      <Field label="Manager WhatsApp numbers (required)">
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <Textarea
                            value={managerWhatsapp}
                            data-testid="input-manager-whatsapp"
                            placeholder={"97335000001\n97335000002"}
                            dir="ltr"
                            rows={3}
                            className="flex-1 font-mono text-sm"
                            onChange={(e) => setManagerWhatsapp(e.target.value)}
                          />
                          <Button
                            type="button"
                            variant="outline"
                            data-testid="btn-open-manager-whatsapp"
                            disabled={
                              parseWhatsAppNumbers(managerWhatsapp).length === 0 ||
                              !approvalWhatsAppMessage
                            }
                            onClick={() => {
                              const first = parseWhatsAppNumbers(managerWhatsapp)[0];
                              const url = buildWhatsAppUrl(first, approvalWhatsAppMessage);
                              if (!url) {
                                toast.warning("Invalid WhatsApp", "Check the number (8–15 digits).");
                                return;
                              }
                              window.open(url, "_blank", "noopener,noreferrer");
                            }}
                          >
                            <MessageCircle size={15} />
                            Preview chat
                          </Button>
                        </div>
                        {parseWhatsAppNumbers(managerWhatsapp).length > 0 ? (
                          <p className="mt-1 text-[11px] text-[var(--color-muted-foreground)]" dir="ltr">
                            Evolution will message {formatWhatsAppDisplayList(managerWhatsapp)} on Issue
                          </p>
                        ) : (
                          <p className="mt-1 text-[11px] text-[var(--color-destructive)]">
                            Required — one number per line (or comma-separated). Issue will not proceed
                            without at least one valid number.
                          </p>
                        )}
                      </Field>
                    </div>

                    <Field label="Notes (optional)">
                      <Textarea
                        rows={2}
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="Extra context (approval is stored separately above)"
                      />
                    </Field>

                    <Button
                      variant="gradient"
                      size="lg"
                      className="w-full"
                      data-testid="btn-issue-ticket"
                      disabled={
                        issueMutation.isPending ||
                        (needsSettlement && !excessOption) ||
                        (requiresManagerApproval && !managerApproval.trim()) ||
                        parseWhatsAppNumbers(managerWhatsapp).length === 0
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
                        : requiresManagerApproval && !managerApproval.trim()
                          ? "Enter approval authority"
                          : parseWhatsAppNumbers(managerWhatsapp).length === 0
                            ? "Enter manager WhatsApp"
                            : "Issue ticket & WhatsApp"}
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
                        <Button
                          size="sm"
                          variant="outline"
                          data-testid="btn-print-ticket"
                          onClick={() => setPrinting(t)}
                        >
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
          <div
            className="sm:col-span-2 space-y-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[hsl(243_40%_98%)] p-3"
            data-testid="panel-edit-whatsapp"
          >
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                data-testid="chk-edit-notify-whatsapp"
                checked={editForm.notify_whatsapp}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, notify_whatsapp: e.target.checked }))
                }
              />
              <span>
                <span className="font-semibold">Send WhatsApp on save</span>
                <span className="block text-xs text-[var(--color-muted-foreground)]">
                  Opt-in only. Sends update notice + A4 PDF via Evolution to the numbers below.
                </span>
              </span>
            </label>
            {editForm.notify_whatsapp ? (
              <>
                <Field label="Approval authority (optional)">
                  <Input
                    value={editForm.manager_approval}
                    data-testid="input-edit-approval-authority"
                    placeholder="Manager name or reference"
                    onChange={(e) =>
                      setEditForm((f) => ({ ...f, manager_approval: e.target.value }))
                    }
                  />
                </Field>
                <Field label="Manager WhatsApp numbers (required when sending)">
                  <Textarea
                    value={editForm.manager_whatsapp}
                    data-testid="input-edit-manager-whatsapp"
                    placeholder={"97335000001\n97335000002"}
                    dir="ltr"
                    rows={3}
                    className="font-mono text-sm"
                    onChange={(e) =>
                      setEditForm((f) => ({ ...f, manager_whatsapp: e.target.value }))
                    }
                  />
                  {parseWhatsAppNumbers(editForm.manager_whatsapp).length > 0 ? (
                    <p className="mt-1 text-[11px] text-[var(--color-muted-foreground)]" dir="ltr">
                      Will message {formatWhatsAppDisplayList(editForm.manager_whatsapp)}
                    </p>
                  ) : (
                    <p className="mt-1 text-[11px] text-[var(--color-destructive)]">
                      Enter at least one valid number to send on save.
                    </p>
                  )}
                </Field>
              </>
            ) : null}
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
              data-testid="btn-download-a4-pdf"
              onClick={() => printing && printTicketPdf(printing)}
            >
              {printBusy ? "Preparing…" : "Download A4 PDF"}
            </Button>
            <Button
              variant="gradient"
              disabled={!printing}
              data-testid="btn-print-allocation"
              onClick={() => window.print()}
            >
              <Printer size={14} /> Print
            </Button>
          </>
        }
      >
        {printing ? (
          <div className="overflow-auto bg-[hsl(210_20%_96%)] p-4" data-testid="allocation-print-preview">
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
