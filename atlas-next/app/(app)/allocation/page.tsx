"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  BadgeCheck,
  Banknote,
  CircleAlert,
  CircleCheck,
  CircleDollarSign,
  Clock,
  Download,
  HandCoins,
  Loader2,
  MessageCircle,
  MoreHorizontal,
  Paperclip,
  Eye,
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
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AllocationPrintSheet } from "@/components/allocation-print-sheet";
import { AllocationRegisterTable } from "@/components/allocation-register-table";
import { AirportCombobox } from "@/components/airport-combobox";
import { BulkBar, SelectBox, downloadCsv } from "@/components/bulk-bar";
import { DocumentViewer, formatBytes, uploadProblem, type ViewerDoc } from "@/components/document-viewer";
import { EmployeeCombobox } from "@/components/employee-combobox";
import { FareCheckPanel } from "@/components/fare-check-panel";
import { LoanPlanText, LoanTermsInput } from "@/components/loan-terms-input";
import { emiAmountFor, type LoanPlan, type LoanTermsValue } from "@/lib/loan-terms";
import { SavedViews } from "@/components/saved-views";
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
import { CardGridSkeleton, ListSkeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { api, ApiError, download, downloadPost, errorMessage, getBlob, postBlob } from "@/lib/api";
import {
  fmtDate,
  initials,
  money,
  num,
  statusTone,
  ticketWorkflowActionLabel,
  ticketWorkflowStatusLabel,
  titleCase,
  todayLocal,
} from "@/lib/format";
import {
  waitingAgeClass,
  waitingAgeLabel,
  waitingDaysFromCreated,
} from "@/lib/waiting-age";
import { useAuth, hasRole } from "@/lib/auth";
import { invalidateDashboardData } from "@/lib/dashboard-insights";
import { useFareCheck } from "@/lib/fare-check";
import { useT } from "@/lib/i18n";
import { appPath } from "@/lib/paths";
import {
  buildWhatsAppUrl,
  formatWhatsAppDisplayList,
  normalizeWhatsAppNumber,
  parseWhatsAppNumbers,
  WhatsAppClickToChatLimits,
} from "@/lib/whatsapp-click-to-chat";
import { cn } from "@/lib/utils";
import { describeEssWhatsApp, inclusiveLeaveDays, type EssWhatsAppResult } from "@/lib/ess-process";
import {
  filterTicketsBySearch,
  removeTicketQueryChip,
  ticketInPolicy,
  ticketQueryChips,
} from "@/lib/ticket-search";
import {
  settlementKpis,
  ticketPayBreakdown,
} from "@/lib/ticket-money";
import type { Employee, EssRequest, Ticket } from "@/lib/types";
import { ExcelToolbar } from "@/components/excel-toolbar";

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
  /** Fixed EMI typed in EMI mode; `null` when the loan is entered in months. */
  emi_amount: string | null;
  leave_start_date: string;
  leave_end_date: string;
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
    blurb: "Apply airfare balance; employee pays the shortfall — company pays 0",
  },
  {
    value: "COMPANY_PAID",
    label: "Fully company paid",
    icon: CircleDollarSign,
    blurb: "Company pays the whole ticket — employee funds are not deducted",
  },
  {
    value: "CONVERT_TO_LOAN",
    label: "Make loan",
    icon: HandCoins,
    blurb: "Apply airfare balance; shortfall becomes loan (EMI) — company pays 0",
  },
  {
    value: "ENTITLEMENT_AMOUNT",
    label: "Entitlement amount",
    icon: BadgeCheck,
    blurb: "Use employee available funds first; company tops up any shortfall",
  },
  {
    value: "SELF_PAID_FULL",
    label: "Self paid (full ticket)",
    icon: Wallet,
    blurb: "Employee pays the whole ticket — airfare balance is kept",
  },
] as const;

const FULL_SELF_PAID = "SELF_PAID_FULL";

// Money math (fare reconstruction, deduction, net) lives in @/lib/ticket-money —
// one shared port of the backend settle rules for register, CSV, print and the
// Settlement desk.

const allocationPdfName = (ticket: Ticket) =>
  `airfare-allocation-${ticket.employee_code || ticket.id.slice(0, 8)}.pdf`;

/** Allocation list — Submit / Re-open only. Approve · Mark paid · Reject live on Dashboard. */
const WORKFLOW: Record<string, Array<{ next: string; label: string; icon: typeof Send; tone: string }>> = {
  draft: [{ next: "submitted", label: "Submit", icon: Send, tone: "default" }],
  submitted: [],
  approved: [],
  rejected: [{ next: "draft", label: "Re-open", icon: Clock, tone: "outline" }],
};

function paymentOptionLabel(handling: string | null | undefined): string {
  const key = (handling || "").trim().toUpperCase();
  const hit = EXCESS_OPTIONS.find((opt) => opt.value === key);
  if (hit) return hit.label;
  if (key === "LOAN") return "Make loan";
  return titleCase(handling || "—");
}

function AllocationPage() {
  const t = useT();
  // The ticket register maps rows as `t`, shadowing the translator.
  const tr = t;
  const { me } = useAuth();
  const canSaveWaDefaults = hasRole(me, "admin", "system_admin", "hr", "hr_manager");
  /** Matches POST/DELETE /attachments (admin / hr / manager / finance). */
  const canDeleteAttachments = hasRole(
    me,
    "admin",
    "system_admin",
    "hr",
    "hr_manager",
    "manager",
    "finance",
    "finance_manager"
  );
  const queryClient = useQueryClient();
  const [employeeId, setEmployeeId] = useState("");
  const [travelDate, setTravelDate] = useState(() => todayLocal());
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [amount, setAmount] = useState("");
  const [excessOption, setExcessOption] = useState<string>("");
  const [tenure, setTenure] = useState("12");
  const [tenureEmi, setTenureEmi] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [fareReason, setFareReason] = useState("");
  const [managerApproval, setManagerApproval] = useState("");
  const [managerWa1, setManagerWa1] = useState("");
  const [managerWa2, setManagerWa2] = useState("");
  /** Extra numbers 3–5 (paste / additional managers). */
  const [managerWaOther, setManagerWaOther] = useState("");
  const [showWaOther, setShowWaOther] = useState(false);
  const managerWhatsapp = useMemo(() => {
    const fromFields = [managerWa1, managerWa2].filter((s) => s.trim());
    const merged = [...fromFields, managerWaOther].filter(Boolean).join("\n");
    return parseWhatsAppNumbers(merged).join("\n");
  }, [managerWa1, managerWa2, managerWaOther]);
  const setManagerWhatsapp = (raw: string) => {
    const nums = parseWhatsAppNumbers(raw);
    setManagerWa1(nums[0] || "");
    setManagerWa2(nums[1] || "");
    setManagerWaOther(nums.slice(2).join("\n"));
  };

  const saveWaDefaultsMut = useMutation({
    mutationFn: async () => {
      const nums = parseWhatsAppNumbers(managerWhatsapp);
      if (nums.length === 0) {
        throw new ApiError(400, "invalid_whatsapp", "Enter at least one valid number first.");
      }
      const body = {
        scope_type: "global" as const,
        scope_id: "",
        value: nums.join("\n"),
        is_locked: false,
      };
      // Canonical Settings key; legacy alias keeps offer/contract desks in sync.
      await api("/preferences", {
        method: "PUT",
        body: { ...body, preference_key: "whatsapp_manager_recipients" },
      });
      await api("/preferences", {
        method: "PUT",
        body: { ...body, preference_key: "whatsapp_default_recipients" },
      });
    },
    onSuccess: () => {
      toast.success(
        "Fixed defaults saved",
        "Saved as the Settings manager WhatsApp list — every notify includes it."
      );
      queryClient.invalidateQueries({ queryKey: ["preferences"] });
    },
    onError: (e) => toast.error("Save defaults failed", errorMessage(e)),
  });
  const [tripType, setTripType] = useState<"ROUND_TRIP" | "ONE_WAY">("ROUND_TRIP");
  /** One-way purpose — FINAL / RETURN_LATER / RETURN_BACK (return leg ticket). */
  const [oneWayPurpose, setOneWayPurpose] = useState<
    "" | "FINAL" | "RETURN_LATER" | "RETURN_BACK"
  >("");
  /** Round-trip leave window (departure → return). Only collected for ROUND_TRIP. */
  const [leaveStart, setLeaveStart] = useState("");
  const [leaveEnd, setLeaveEnd] = useState("");
  const leaveWindow = useMemo(() => {
    const none = { days: null as number | null, backOn: "", error: null as string | null, warning: null as string | null };
    if (tripType !== "ROUND_TRIP") return none;
    if (leaveStart && leaveEnd && leaveEnd < leaveStart) {
      return { ...none, error: t("alloc.leave.endBeforeStart") };
    }
    const days = inclusiveLeaveDays(leaveStart, leaveEnd);
    const back = leaveEnd ? new Date(`${leaveEnd}T00:00:00Z`) : null;
    if (back) back.setUTCDate(back.getUTCDate() + 1);
    let warning: string | null = null;
    if (leaveStart && travelDate) {
      const gap = Math.round(
        (Date.parse(`${leaveStart}T00:00:00Z`) - Date.parse(`${travelDate}T00:00:00Z`)) / 86_400_000
      );
      if (Math.abs(gap) > 3) warning = t("alloc.leave.farFromTravel").replace("{n}", String(Math.abs(gap)));
    }
    return { days, backOn: back ? back.toISOString().slice(0, 10) : "", error: null, warning };
  }, [tripType, leaveStart, leaveEnd, travelDate, t]);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [ticketSearch, setTicketSearch] = useState("");
  /** Keep in sync with approvalDesk — first paint must match the "Waiting for approval" title. */
  const [statusFilter, setStatusFilter] = useState("submitted");
  /** Policy lens — Expensify-style shortcut for over/in entitlement. */
  const [policyFilter, setPolicyFilter] = useState<"all" | "over" | "in">("all");
  /** Approval desk queue: decisions vs payment vs full register. */
  const [approvalDesk, setApprovalDesk] = useState<"approval" | "payment" | "all">("approval");
  const [rejectTarget, setRejectTarget] = useState<Ticket | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [selectedTickets, setSelectedTickets] = useState<Set<string>>(() => new Set());
  const [bulkAction, setBulkAction] = useState<{ next: string; label: string } | null>(null);
  const [editing, setEditing] = useState<Ticket | null>(null);
  const [deleting, setDeleting] = useState<Ticket | null>(null);
  const [loanConfirmOpen, setLoanConfirmOpen] = useState(false);
  const [confirmTerms, setConfirmTerms] = useState<LoanTermsValue>({ months: "12", emi: null });
  const [emiPreview, setEmiPreview] = useState<LoanPlan | null>(null);
  const [printing, setPrinting] = useState<Ticket | null>(null);
  const [printBusy, setPrintBusy] = useState(false);
  /** Concur-style overflow menu — one open card at a time. */
  const [cardMoreId, setCardMoreId] = useState<string | null>(null);
  /** Viewport anchor for the portaled More menu (the one-line action bar clips absolute children). */
  const [cardMorePos, setCardMorePos] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
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
    emi_amount: null,
    leave_start_date: "",
    leave_end_date: "",
    notes: "",
    manager_approval: "",
    manager_whatsapp: "",
    notify_whatsapp: false,
  });
  /** Optional uploads — A4 slip is always generated; attached files join the pack. */
  const [pendingTicketDoc, setPendingTicketDoc] = useState<File | null>(null);
  const [pendingLeaveDoc, setPendingLeaveDoc] = useState<File | null>(null);

  // Card More menu: Escape / outside click / scroll closes it (APG overflow-menu pattern).
  useEffect(() => {
    if (!cardMoreId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      setCardMoreId(null);
      // Return focus to the trigger per the menu-button pattern.
      (
        document.querySelector(`[data-testid="btn-ticket-more-${cardMoreId}"]`) as HTMLElement | null
      )?.focus();
    };
    const onDoc = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest?.(`[data-testid="menu-ticket-more-${cardMoreId}"]`)) return;
      if (el?.closest?.(`[data-testid="btn-ticket-more-${cardMoreId}"]`)) return;
      setCardMoreId(null);
    };
    const onScroll = () => setCardMoreId(null);
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [cardMoreId]);

  const employees = useQuery({
    queryKey: ["employees", "all"],
    queryFn: () => api<Employee[]>("/employees?limit=500"),
  });
  const tickets = useQuery({
    queryKey: ["tickets", "register"],
    queryFn: () => api<Ticket[]>("/tickets?limit=500&sort_by=travel_date&sort_order=desc"),
  });
  const waPrefs = useQuery({
    queryKey: ["preferences", "effective", "whatsapp"],
    queryFn: () => api<Record<string, unknown>>("/preferences/effective"),
  });
  const waPolicyQ = useQuery({
    queryKey: ["allocation-wa-policy"],
    queryFn: () =>
      api<{ include_employee?: boolean }>("/allocations/whatsapp/policy"),
  });
  /**
   * Default pickup is ON server-side. While policy loads, keep that default so
   * employee-only WhatsApp still enables Issue & WA; after load, honor the API.
   */
  const includeEmployeeWa = waPolicyQ.isSuccess
    ? waPolicyQ.data?.include_employee !== false
    : true;

  // ?ess=<id> — fulfil an approved ESS leave + ticket request.
  const searchParams = useSearchParams();
  const essId = searchParams.get("ess") || "";
  const essRequest = useQuery({
    queryKey: ["ess-request", essId],
    queryFn: () => api<EssRequest>(`/ess/requests/${essId}`),
    enabled: Boolean(essId),
  });
  const essLinkable = essRequest.data?.status === "approved" && !essRequest.data.ticket_id;

  // ?ticket=<id> — open that ticket straight in the edit dialog (e.g. from an ESS request card).
  const router = useRouter();
  const deepTicketId = searchParams.get("ticket") || "";
  const deepView = searchParams.get("view") || "";
  const deepTicket = useQuery({
    queryKey: ["ticket", deepTicketId],
    queryFn: () => api<Ticket>(`/tickets/${encodeURIComponent(deepTicketId)}`),
    enabled: Boolean(deepTicketId),
    retry: false,
  });
  const deepOpened = useRef("");
  const essPrefilled = useRef("");
  // ?employee=<id> — start a new ticket for that employee (command palette).
  const deepEmployeeId = searchParams.get("employee") || "";
  useEffect(() => {
    if (!deepEmployeeId) return;
    setEmployeeId(deepEmployeeId);
    setPreview(null);
    router.replace(appPath("/allocation"));
  }, [deepEmployeeId]);
  useEffect(() => {
    const req = essRequest.data;
    if (!req || essPrefilled.current === req.id || req.status !== "approved") return;
    essPrefilled.current = req.id;
    setEmployeeId(req.employee_id);
    setTravelDate(String(req.travel_date).slice(0, 10));
    setOrigin(req.origin_code);
    setDestination(req.destination_code);
    setTripType(req.trip_type === "ONE_WAY" ? "ONE_WAY" : "ROUND_TRIP");
    const essNotesBlob = String(req.notes || "").toLowerCase();
    // Match backend `_travel_one_way_status`: FINAL/cancellation before return-back.
    const essPurpose: "" | "FINAL" | "RETURN_LATER" | "RETURN_BACK" =
      req.trip_type !== "ONE_WAY"
        ? ""
        : /final|cancell?ation|no return/.test(essNotesBlob)
          ? "FINAL"
          : /return back/.test(essNotesBlob)
            ? "RETURN_BACK"
            : "RETURN_LATER";
    setOneWayPurpose(essPurpose);
    setLeaveStart(req.leave_start_date ? String(req.leave_start_date).slice(0, 10) : "");
    setLeaveEnd(req.leave_end_date ? String(req.leave_end_date).slice(0, 10) : "");
    const days = inclusiveLeaveDays(req.leave_start_date, req.leave_end_date);
    const oneWayNote =
      essPurpose === "FINAL"
        ? "One-way — cancellation (final / no return)"
        : essPurpose === "RETURN_BACK"
          ? "One-way — return back ticket"
          : essPurpose === "RETURN_LATER"
            ? "One-way — return booked later"
            : "";
    const parts = [
      days ? `Leave ${days} day${days === 1 ? "" : "s"}` : "",
      req.trip_type === "ONE_WAY"
        ? oneWayNote
        : req.return_date
          ? `Return flight ${fmtDate(req.return_date)}`
          : "Return trip",
      req.notes || "",
    ].filter(Boolean);
    setNotes(parts.join(" · "));
    setPreview(null);
  }, [essRequest.data]);

  useEffect(() => {
    // Canonical Settings manager list; legacy whatsapp_default_recipients as fallback.
    const raw =
      waPrefs.data?.whatsapp_manager_recipients ?? waPrefs.data?.whatsapp_default_recipients;
    if (!raw) return;
    let next = "";
    if (typeof raw === "string") next = raw;
    else if (Array.isArray(raw)) next = raw.map(String).join("\n");
    if (!next.trim()) return;
    const nums = parseWhatsAppNumbers(next);
    setManagerWa1((cur) => (cur.trim() ? cur : nums[0] || ""));
    setManagerWa2((cur) => (cur.trim() ? cur : nums[1] || ""));
    setManagerWaOther((cur) => (cur.trim() ? cur : nums.slice(2).join("\n")));
    setEditForm((f) =>
      f.manager_whatsapp.trim() ? f : { ...f, manager_whatsapp: next }
    );
  }, [waPrefs.data]);

  const employee = useMemo(
    () => (employees.data ?? []).find((e) => e.id === employeeId) ?? null,
    [employees.data, employeeId]
  );
  const reportingOfficer = useMemo(() => {
    const key = String(employee?.reporting_officer_id || "").trim();
    if (!key) return null;
    return (
      (employees.data ?? []).find((e) => e.id === key || e.code === key) ?? null
    );
  }, [employees.data, employee?.reporting_officer_id]);
  const officerWhatsappNumbers = useMemo(
    () => parseWhatsAppNumbers(String(reportingOfficer?.whatsapp_mobile ?? "")),
    [reportingOfficer?.whatsapp_mobile]
  );
  const employeeWhatsappNumbers = useMemo(
    () => parseWhatsAppNumbers(String(employee?.whatsapp_mobile ?? "")),
    [employee?.whatsapp_mobile]
  );
  const officerWhatsapp = officerWhatsappNumbers[0] || "";
  const employeeWhatsapp = employeeWhatsappNumbers[0] || "";
  const typedManagerNumbers = useMemo(
    () => parseWhatsAppNumbers(managerWhatsapp),
    [managerWhatsapp]
  );
  /** Settings WhatsApp distribution (source of truth for managers/HR/MD per CR). */
  const settingsWaLists = useMemo(() => {
    const prefs = (waPrefs.data ?? {}) as Record<string, unknown>;
    const read = (key: string): string[] => {
      const raw = prefs[key];
      if (typeof raw === "string") return parseWhatsAppNumbers(raw);
      if (Array.isArray(raw)) return parseWhatsAppNumbers(raw.map(String).join("\n"));
      return [];
    };
    const managers = read("whatsapp_manager_recipients");
    return {
      managers: managers.length ? managers : read("whatsapp_default_recipients"),
      hr: read("whatsapp_hr_recipients"),
      md: read("whatsapp_md_recipients"),
    };
  }, [waPrefs.data]);
  /** Reporting manager WhatsApp always comes from Employee Master (Reporting to). */
  const reportingManagerNumbers = officerWhatsappNumbers;
  /** Issue & WhatsApp: RM master + Settings HR/MD (+ optional Settings managers) + traveller + typed. */
  const canNotifyWhatsapp =
    reportingManagerNumbers.length > 0 ||
    settingsWaLists.managers.length > 0 ||
    settingsWaLists.hr.length > 0 ||
    settingsWaLists.md.length > 0 ||
    typedManagerNumbers.length > 0 ||
    (includeEmployeeWa && employeeWhatsappNumbers.length > 0);
  const plannedFanout = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    const sources = [
      ...reportingManagerNumbers,
      ...settingsWaLists.managers,
      ...settingsWaLists.hr,
      ...settingsWaLists.md,
      ...(includeEmployeeWa ? employeeWhatsappNumbers : []),
      ...typedManagerNumbers,
    ];
    for (const n of sources) {
      if (!n || seen.has(n)) continue;
      seen.add(n);
      out.push(n);
      if (out.length >= WhatsAppClickToChatLimits.MAX_RECIPIENTS) break;
    }
    return out;
  }, [settingsWaLists, typedManagerNumbers, reportingManagerNumbers, employeeWhatsappNumbers, includeEmployeeWa]);

  /** Edit dialog: same resolution as Issue (typed + Reporting-to + employee if pickup on). */
  const editEmployee = useMemo(
    () =>
      editing
        ? (employees.data ?? []).find((e) => e.id === editing.employee_id) ?? null
        : null,
    [employees.data, editing]
  );
  const editReportingOfficer = useMemo(() => {
    const key = String(editEmployee?.reporting_officer_id || "").trim();
    if (!key) return null;
    return (employees.data ?? []).find((e) => e.id === key || e.code === key) ?? null;
  }, [employees.data, editEmployee?.reporting_officer_id]);
  const editPlannedFanout = useMemo(() => {
    const typed = parseWhatsAppNumbers(editForm.manager_whatsapp);
    const officer = parseWhatsAppNumbers(String(editReportingOfficer?.whatsapp_mobile ?? ""));
    const emp = parseWhatsAppNumbers(String(editEmployee?.whatsapp_mobile ?? ""));
    const seen = new Set<string>();
    const out: string[] = [];
    for (const n of [
      ...officer,
      ...settingsWaLists.managers,
      ...settingsWaLists.hr,
      ...settingsWaLists.md,
      ...(includeEmployeeWa ? emp : []),
      ...typed,
    ]) {
      if (!n || seen.has(n)) continue;
      seen.add(n);
      out.push(n);
      if (out.length >= WhatsAppClickToChatLimits.MAX_RECIPIENTS) break;
    }
    return out;
  }, [
    editForm.manager_whatsapp,
    settingsWaLists,
    editReportingOfficer?.whatsapp_mobile,
    editEmployee?.whatsapp_mobile,
    includeEmployeeWa,
  ]);
  const editCanNotifyWhatsapp = editPlannedFanout.length > 0;

  const ticketsThisYear = useMemo(() => {
    if (!employeeId || !travelDate) return 0;
    const year = Number(String(travelDate).slice(0, 4));
    return (tickets.data ?? []).filter((t) => {
      if (String(t.employee_id) !== String(employeeId)) return false;
      if (Number(String(t.travel_date).slice(0, 4)) !== year) return false;
      return ["draft", "submitted", "approved", "paid"].includes(t.status);
    }).length;
  }, [tickets.data, employeeId, travelDate]);

  const sameDayTicket = useMemo(() => {
    if (!employeeId || !travelDate) return null;
    const day = String(travelDate).slice(0, 10);
    return (
      (tickets.data ?? []).find(
        (t) =>
          String(t.employee_id) === String(employeeId) &&
          String(t.travel_date).slice(0, 10) === day &&
          ["draft", "submitted", "approved", "paid"].includes(t.status)
      ) ?? null
    );
  }, [tickets.data, employeeId, travelDate]);

  // A new ticket must be dated after the employee's latest live ticket.
  const laterTicket = useMemo(() => {
    if (!employeeId || !travelDate || sameDayTicket) return null;
    const day = String(travelDate).slice(0, 10);
    return (
      (tickets.data ?? [])
        .filter(
          (t) =>
            String(t.employee_id) === String(employeeId) &&
            String(t.travel_date).slice(0, 10) > day &&
            ["draft", "submitted", "approved", "paid"].includes(t.status)
        )
        .sort((a, b) => String(b.travel_date).localeCompare(String(a.travel_date)))[0] ?? null
    );
  }, [tickets.data, employeeId, travelDate, sameDayTicket]);

  const fareCheck = useFareCheck(origin, destination, Number(amount) || 0, travelDate);
  const fareRed = Boolean(fareCheck.data?.reason_required);
  const fareReasonMissing = fareRed && !fareReason.trim();

  const requiresManagerApproval =
    excessOption === "CONVERT_TO_LOAN" || ticketsThisYear >= 1 || fareRed;

  useEffect(() => {
    if (!employee) {
      setManagerApproval("");
      const raw =
        waPrefs.data?.whatsapp_manager_recipients ?? waPrefs.data?.whatsapp_default_recipients;
      let next = "";
      if (typeof raw === "string") next = raw;
      else if (Array.isArray(raw)) next = raw.map(String).join("\n");
      setManagerWhatsapp(next);
      return;
    }
    const key = String(employee.reporting_officer_id || "").trim();
    const officer =
      (employees.data ?? []).find((e) => e.id === key || e.code === key) ?? null;
    setManagerApproval(
      officer ? `${officer.code} — ${officer.full_name}` : key
    );
  }, [employee?.id, employee?.reporting_officer_id, employees.data, waPrefs.data]);

  const reloadEmployeeMut = useMutation({
    mutationFn: async () => {
      if (!employeeId) throw new Error("Select an employee first");
      const fresh = await api<Employee>(`/employees/${employeeId}`);
      await queryClient.invalidateQueries({ queryKey: ["employees"] });
      return fresh;
    },
    onSuccess: (fresh) => {
      setPreview(null);
      const key = String(fresh.reporting_officer_id || "").trim();
      const officer =
        (employees.data ?? []).find((e) => e.id === key || e.code === key) ?? null;
      setManagerApproval(officer ? `${officer.code} — ${officer.full_name}` : key);
      toast.success("Reloaded from master", `${fresh.code} — ${fresh.full_name}`);
    },
    onError: (e) => toast.error("Reload failed", errorMessage(e)),
  });

  const openEdit = (ticket: Ticket) => {
    setEditing(ticket);
    setLoanConfirmOpen(false);
    const handling =
      ticket.excess_handling === "LOAN" ? "CONVERT_TO_LOAN" : ticket.excess_handling || "SELF_PAID";
    // Prefill approval from Reporting-to master; one-off WA extras stay blank
    // (Reporting manager / HR / MD resolve from master + Settings at send time).
    const emp =
      (employees.data ?? []).find((e) => e.id === ticket.employee_id) ?? null;
    const officerKey = String(emp?.reporting_officer_id || "").trim();
    const officer = officerKey
      ? (employees.data ?? []).find((e) => e.id === officerKey || e.code === officerKey) ?? null
      : null;
    setEditForm({
      travel_date: String(ticket.travel_date).slice(0, 10),
      origin_code: ticket.origin_code,
      destination_code: ticket.destination_code,
      ticket_cost: String(ticket.ticket_cost),
      entitlement: String(ticket.entitlement),
      excess_handling: handling,
      tenure_months: String(ticket.tenure_months || 12),
      emi_amount:
        ticket.loan_repayment_basis === "emi" && ticket.loan_emi != null ? String(Number(ticket.loan_emi)) : null,
      leave_start_date: ticket.leave_start_date ? String(ticket.leave_start_date).slice(0, 10) : "",
      leave_end_date: ticket.leave_end_date ? String(ticket.leave_end_date).slice(0, 10) : "",
      notes: ticket.notes || "",
      manager_approval: officer
        ? `${officer.code} — ${officer.full_name}`
        : officerKey || "",
      manager_whatsapp: "",
      notify_whatsapp: false,
    });
  };

  /** Delete one ticket; a linked recovery loan is asked about first. */
  const requestDelete = (ticket: Ticket) => {
    setDeleting(ticket);
    if (ticket.loan_id) {
      setLoanActionTicket(ticket);
      setLinkedLoanPrompt("delete-ticket");
    }
  };

  useEffect(() => {
    const ticket = deepTicket.data;
    if (!ticket || deepView === "documents" || deepOpened.current === ticket.id) return;
    deepOpened.current = ticket.id;
    openEdit(ticket);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open once per linked ticket
  }, [deepTicket.data, deepView]);

  useEffect(() => {
    if (deepTicket.isError)
      toast.error("Ticket not found", "It may already be deleted. The register below shows current tickets.");
  }, [deepTicket.isError]);

  // Once the linked ticket's dialog closes, drop ?ticket= so a refresh does not reopen it.
  useEffect(() => {
    if (deepView === "documents") return;
    if (!editing && deepOpened.current && deepTicketId) router.replace("/allocation", { scroll: false });
  }, [editing, deepTicketId, router, deepView]);

  type TicketAttachmentMeta = {
    id: string;
    entity_type: string;
    original_name: string;
    content_type?: string | null;
    size_bytes: number;
    created_at?: string | null;
    stored_in_mssql?: boolean;
  };
  const REMOVABLE_UPLOAD_TYPES = new Set(["ticket_receipt", "leave_settlement"]);
  const [attachmentPendingDelete, setAttachmentPendingDelete] =
    useState<TicketAttachmentMeta | null>(null);
  const [deletingAttachment, setDeletingAttachment] = useState(false);

  const deleteUploadedAttachment = async (row: TicketAttachmentMeta) => {
    if (!REMOVABLE_UPLOAD_TYPES.has(row.entity_type)) {
      toast.warning(
        t("alloc.docs.removeFailed"),
        "System-generated documents cannot be removed."
      );
      return;
    }
    setDeletingAttachment(true);
    try {
      const viewingDeleted =
        viewerIndex != null &&
        (() => {
          const doc = viewerDocs[viewerIndex];
          return (
            !!doc &&
            "attachmentId" in doc.source &&
            doc.source.attachmentId === row.id
          );
        })();
      await api(`/attachments/${row.id}`, { method: "DELETE" });
      toast.success(t("alloc.docs.removed"), row.original_name);
      setAttachmentPendingDelete(null);
      await queryClient.invalidateQueries({ queryKey: ["attachments"] });
      // Keep the viewer coherent if the open page was the deleted upload.
      if (viewingDeleted) setViewerIndex(0);
    } catch (err) {
      toast.error(t("alloc.docs.removeFailed"), errorMessage(err));
    } finally {
      setDeletingAttachment(false);
    }
  };

  const editAttachments = useQuery({
    queryKey: ["attachments", editing?.id],
    enabled: Boolean(editing?.id),
    queryFn: async () => {
      if (!editing?.id) return [] as TicketAttachmentMeta[];
      // List all ticket-scoped docs (receipt, leave settlement, A4 PDF).
      return api<TicketAttachmentMeta[]>(`/attachments?entity_id=${editing.id}`);
    },
  });

  const attachmentLabel = (entityType: string) => {
    if (entityType === "ticket_receipt") return "Ticket document";
    if (entityType === "leave_settlement") return "Leave settlement";
    if (entityType === "ticket") return "A4 allocation PDF";
    return entityType;
  };

  // Ticket documents first, then leave settlement, then the generated A4 slip.
  const DOC_ORDER: Record<string, number> = { ticket_receipt: 0, leave_settlement: 1, ticket: 2 };
  const [viewerTicket, setViewerTicket] = useState<Ticket | null>(null);
  const viewerTicketId = viewerTicket?.id ?? null;
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const viewerAttachments = useQuery({
    queryKey: ["attachments", viewerTicketId],
    enabled: Boolean(viewerTicketId),
    queryFn: () => api<TicketAttachmentMeta[]>(`/attachments?entity_id=${viewerTicketId}`),
  });
  const toViewerDocs = (rows: TicketAttachmentMeta[]): ViewerDoc[] =>
    [...rows]
      .sort((a, b) => (DOC_ORDER[a.entity_type] ?? 9) - (DOC_ORDER[b.entity_type] ?? 9))
      .map((a) => ({
        key: `att-${a.id}`,
        name: a.original_name,
        label: attachmentLabel(a.entity_type),
        contentType: a.content_type,
        sizeBytes: a.size_bytes,
        createdAt: a.created_at,
        source: { attachmentId: a.id },
        removable: REMOVABLE_UPLOAD_TYPES.has(a.entity_type),
      }));
  const allocationDoc = (ticket: Ticket): ViewerDoc => ({
    key: `alloc-print-${ticket.id}-${ticket.version}`,
    name: allocationPdfName(ticket),
    label: t("alloc.docs.printAllocation"),
    contentType: "application/pdf",
    source: { load: () => postBlob("/allocations/print.pdf", allocationPrintBody(ticket)) },
  });
  /** Slip + ticket documents + leave settlement as one PDF; keyed on the uploads so it rebuilds after a change. */
  const mergedDoc = (ticket: Ticket, rows: TicketAttachmentMeta[]): ViewerDoc => ({
    key: `merged-${ticket.id}-${ticket.version}-${rows.map((r) => r.id).sort().join(".")}`,
    name: `airfare-documents-${ticket.employee_code || ticket.id.slice(0, 8)}.pdf`,
    label: t("alloc.docs.merged"),
    contentType: "application/pdf",
    // Force PDF MIME even if a proxy strips Content-Type; rebuilds after upload change.
    source: {
      load: async () => {
        const blob = await getBlob(`/allocations/${ticket.id}/documents.pdf`);
        return blob.type === "application/pdf" ? blob : new Blob([blob], { type: "application/pdf" });
      },
    },
  });
  /** Merged file and slip come before the uploads, at fixed positions. */
  const LEADING_DOCS = 2;
  const viewerDocs = viewerTicket
    ? [
        mergedDoc(viewerTicket, viewerAttachments.data ?? []),
        allocationDoc(viewerTicket),
        ...toViewerDocs(viewerAttachments.data ?? []),
      ]
    : [];
  const openTicketDocs = (ticket: Ticket, attachmentId?: string) => {
    setViewerTicket(ticket);
    const rows = queryClient.getQueryData<TicketAttachmentMeta[]>(["attachments", ticket.id]);
    const found = attachmentId && rows ? toViewerDocs(rows).findIndex((d) => d.key === `att-${attachmentId}`) : -1;
    setViewerIndex(found >= 0 ? found + LEADING_DOCS : 0);
  };
  const closeTicketDocs = () => {
    setViewerTicket(null);
    setViewerIndex(null);
  };
  const docsArmed = useRef(false);
  const docsSeen = useRef(false);
  useEffect(() => {
    const ticket = deepTicket.data;
    if (deepView !== "documents" || !ticket || deepOpened.current === `doc:${ticket.id}`) return;
    deepOpened.current = `doc:${ticket.id}`;
    docsArmed.current = true;
    openTicketDocs(ticket);
  }, [deepTicket.data, deepView]);
  useEffect(() => {
    if (!docsArmed.current || !viewerTicket) return;
    docsArmed.current = false;
    docsSeen.current = true;
  }, [viewerTicket]);
  useEffect(() => {
    if (!docsSeen.current || viewerTicket || deepView !== "documents") return;
    docsSeen.current = false;
    deepOpened.current = "";
    router.replace("/allocation", { scroll: false });
  }, [viewerTicket, deepView, router]);
  const removeTicketDoc = async (doc: ViewerDoc) => {
    if (!("attachmentId" in doc.source) || doc.removable === false) return;
    try {
      await api(`/attachments/${doc.source.attachmentId}`, { method: "DELETE" });
    } catch (err) {
      toast.error(t("alloc.docs.removeFailed"), errorMessage(err));
      throw err;
    }
    toast.success(t("alloc.docs.removed"), doc.name);
    await queryClient.invalidateQueries({ queryKey: ["attachments"] });
    // Merged pack + A4 slip always remain — jump to merged after removing an upload.
    setViewerIndex(0);
  };

  const [pendingViewerIndex, setPendingViewerIndex] = useState<number | null>(null);
  const pendingDocs = ([
    pendingTicketDoc
      ? {
          key: `pending-ticket-${pendingTicketDoc.name}-${pendingTicketDoc.lastModified}`,
          name: pendingTicketDoc.name,
          label: "Ticket document",
          source: { file: pendingTicketDoc },
          removable: true,
        }
      : null,
    pendingLeaveDoc
      ? {
          key: `pending-leave-${pendingLeaveDoc.name}-${pendingLeaveDoc.lastModified}`,
          name: pendingLeaveDoc.name,
          label: "Leave settlement",
          source: { file: pendingLeaveDoc },
          removable: true,
        }
      : null,
  ] as (ViewerDoc | null)[]).filter((d): d is ViewerDoc => d !== null);
  const removePendingDoc = async (doc: ViewerDoc) => {
    if (doc.key.startsWith("pending-ticket-")) setPendingTicketDoc(null);
    else if (doc.key.startsWith("pending-leave-")) setPendingLeaveDoc(null);
    const remaining = pendingDocs.length - 1;
    if (remaining <= 0) setPendingViewerIndex(null);
    else setPendingViewerIndex((i) => Math.min(i ?? 0, remaining - 1));
  };
  /** Accept a picked file only when the server will take it; otherwise explain and clear the input. */
  const acceptPickedFile = (input: HTMLInputElement): File | null => {
    const file = input.files?.[0] ?? null;
    if (!file) return null;
    const problem = uploadProblem(file);
    if (problem) {
      toast.error(t(`alloc.docs.${problem}`), file.name);
      input.value = "";
      return null;
    }
    return file;
  };

  async function uploadTicketDocs(ticketId: string, ticketFile: File | null, leaveFile: File | null) {
    // Sequential uploads so Ticket + Leave with identical bytes never race on storage_key,
    // and a single failure does not hide which document failed.
    if (ticketFile) {
      const fd = new FormData();
      fd.append("file", ticketFile);
      await api(`/attachments?entity_type=ticket_receipt&entity_id=${ticketId}`, {
        method: "POST",
        body: fd,
      });
    }
    if (leaveFile) {
      const fd = new FormData();
      fd.append("file", leaveFile);
      await api(`/attachments?entity_type=leave_settlement&entity_id=${ticketId}`, {
        method: "POST",
        body: fd,
      });
    }
  }

  const editTicketGap = Math.max(0, Number(editForm.ticket_cost) - Number(editForm.entitlement));
  const editIsLoan = editForm.excess_handling === "CONVERT_TO_LOAN";
  const editFullSelfPaid = editForm.excess_handling === FULL_SELF_PAID;
  const editExcess = editFullSelfPaid ? 0 : editTicketGap;

  useEffect(() => {
    if (!loanConfirmOpen || !editIsLoan) {
      setEmiPreview(null);
      return;
    }
    const principal = editTicketGap;
    const months = Number(confirmTerms.months);
    const emiAmount = emiAmountFor(confirmTerms);
    if (!(principal > 0) || (emiAmount == null && (!Number.isFinite(months) || months < 1))) {
      setEmiPreview(null);
      return;
    }
    let cancelled = false;
    api<{
      monthly_installment: string | number;
      installments: number;
      last_installment: string | number;
      repayment_basis: "emi" | "tenure";
    }>("/loans/preview", {
      method: "POST",
      body:
        emiAmount != null
          ? { principal, annual_rate: 0, emi_amount: emiAmount }
          : { principal, annual_rate: 0, installments: months },
    })
      .then((data) => {
        if (cancelled) return;
        setEmiPreview({
          basis: data.repayment_basis,
          months: data.installments,
          emi: Number(data.monthly_installment),
          last: Number(data.last_installment),
        });
      })
      .catch(() => {
        if (!cancelled) setEmiPreview(null);
      });
    return () => {
      cancelled = true;
    };
  }, [loanConfirmOpen, editIsLoan, editTicketGap, confirmTerms]);

  const requestSaveEdit = (opts?: { notifyWhatsapp?: boolean }) => {
    if (!editing) return;
    const notifyWa =
      opts && "notifyWhatsapp" in opts ? Boolean(opts.notifyWhatsapp) : editForm.notify_whatsapp;
    if (opts && "notifyWhatsapp" in opts) {
      setEditForm((f) => ({ ...f, notify_whatsapp: notifyWa }));
    }
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
    if (notifyWa && !editCanNotifyWhatsapp) {
      toast.warning(
        "WhatsApp recipients required",
        "Enter a manager number, or ensure Reporting-to / employee master WhatsApp is on file (employee pickup on)."
      );
      return;
    }
    if (editing.loan_id) {
      setLoanActionTicket(editing);
      setLinkedLoanPrompt("edit");
      return;
    }
    continueSaveAfterLoanChoice(notifyWa);
  };

  const continueSaveAfterLoanChoice = (notifyWaOverride?: boolean) => {
    const notifyWa =
      typeof notifyWaOverride === "boolean" ? notifyWaOverride : editForm.notify_whatsapp;
    if (typeof notifyWaOverride === "boolean") {
      setEditForm((f) => ({ ...f, notify_whatsapp: notifyWa }));
    }
    if (editIsLoan) {
      if (editTicketGap <= 0) {
        toast.warning("No excess", "Make loan requires ticket amount above entitlement.");
        return;
      }
      setConfirmTerms({ months: editForm.tenure_months || "12", emi: editForm.emi_amount });
      setLoanConfirmOpen(true);
      return;
    }
    updateMutation.mutate({ notifyWhatsapp: notifyWa });
  };

  const confirmLoanSave = () => {
    const months = Number(confirmTerms.months);
    const emiAmount = emiAmountFor(confirmTerms);
    if (confirmTerms.emi != null && emiAmount == null) {
      toast.error("EMI amount required", "Enter an EMI amount above zero.");
      return;
    }
    if (!Number.isFinite(months) || months < 1) {
      toast.error("Months required", "Enter a valid number of months.");
      return;
    }
    setEditForm((f) => ({ ...f, tenure_months: String(months), emi_amount: confirmTerms.emi }));
    setLoanConfirmOpen(false);
    updateMutation.mutate({ tenureMonths: months, emiAmount: emiAmount ?? null });
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
      invalidateDashboardData(queryClient);
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

  function allocationPrintBody(ticket: Ticket) {
    const excessOption =
      ticket.excess_handling === "LOAN" ? "CONVERT_TO_LOAN" : ticket.excess_handling || undefined;
    return {
      ticket_id: ticket.id,
      employee_id: ticket.employee_id,
      as_of_date: String(ticket.travel_date).slice(0, 10),
      requested_ticket_amount: Number(ticket.ticket_cost),
      excess_option: excessOption,
      tenure_months:
        excessOption === "CONVERT_TO_LOAN"
          ? ticket.tenure_months || Number(confirmTerms.months) || 12
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
    };
  }

  const printTicketPdf = async (ticket: Ticket) => {
    setPrintBusy(true);
    try {
      await downloadPost("/allocations/print.pdf", allocationPrintBody(ticket), allocationPdfName(ticket));
      toast.success("Printed", "Allocation slip downloaded from MSSQL.");
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
    onSuccess: async (data, vars) => {
      setFareReason("");
      queryClient.invalidateQueries({ queryKey: ["fare-check"] });
      if (vars.ess_request_id) {
        queryClient.invalidateQueries({ queryKey: ["ess-requests"] });
        queryClient.invalidateQueries({ queryKey: ["ess-request", String(vars.ess_request_id)] });
        const essWa = describeEssWhatsApp(data.ess_whatsapp as EssWhatsAppResult | null | undefined);
        if (essWa) toast[essWa.tone]("ESS request allocated", essWa.text);
      }
      const notifyWa = Boolean(vars.notify_whatsapp);
      const ticketMsg = data.ticket_code
        ? `Ticket ${data.ticket_code} created.`
        : "Allocation recorded.";
      const ticketId = String(data.ticket_id || data.id || "");
      const waNumbers = parseWhatsAppNumbers(managerWhatsapp);
      let wa = data.whatsapp || {};

      // Snapshot attach flags before upload clears pending File state (WA notify needs them).
      const hadTicketDoc = Boolean(pendingTicketDoc);
      const hadLeaveDoc = Boolean(pendingLeaveDoc);
      // Persist Ticket / Leave settlement to MSSQL first, then notify so WA includes them.
      let uploadsOk = true;
      let hadPendingUploads = false;
      if (ticketId && (pendingTicketDoc || pendingLeaveDoc)) {
        hadPendingUploads = true;
        try {
          await uploadTicketDocs(ticketId, pendingTicketDoc, pendingLeaveDoc);
          setPendingTicketDoc(null);
          setPendingLeaveDoc(null);
          toast.success("Attachments saved", "Ticket / leave documents stored in MSSQL.");
        } catch (err) {
          uploadsOk = false;
          toast.warning("Ticket saved · document upload failed", errorMessage(err));
        }
      }

      // Entry always enters Waiting for approval (API status=submitted).
      openApprovalDesk("approval");

      if (!notifyWa) {
        toast.success(
          "Sent for approval",
          `${ticketMsg} Open Waiting for approval to Approve or Reject.`
        );
        setPreview({ ...data, whatsapp: wa });
        queryClient.invalidateQueries({ queryKey: ["tickets"] });
        queryClient.invalidateQueries({ queryKey: ["loans"] });
        invalidateDashboardData(queryClient);
        return;
      }

      // Never fan-out after a failed upload — pack would omit the docs the operator attached.
      if ((wa.deferred || wa.skipped === "defer_whatsapp") && hadPendingUploads && !uploadsOk) {
        toast.warning(
          "Sent for approval · WhatsApp held",
          `${ticketMsg} Documents failed to upload — WhatsApp was not sent. Re-upload on Edit, then Save & WhatsApp.`
        );
        setPreview({
          ...data,
          whatsapp: { ...(data.whatsapp || {}), skipped: "upload_failed", deferred: true },
        });
        queryClient.invalidateQueries({ queryKey: ["tickets"] });
        invalidateDashboardData(queryClient);
        return;
      }

      if (wa.deferred || wa.skipped === "defer_whatsapp") {
        try {
          const notified = await api<{ whatsapp?: Record<string, unknown> }>(
            `/tickets/${ticketId}/whatsapp-notify`,
            {
              method: "POST",
              body: {
                manager_whatsapp: waNumbers[0] || "",
                manager_whatsapp_numbers: waNumbers,
                manager_approval: managerApproval.trim() || undefined,
                trip_type: tripType,
                purpose: "issue",
                wa_include_slip: true,
                wa_include_ticket_doc: hadTicketDoc,
                wa_include_leave_doc: hadLeaveDoc,
              },
            }
          );
          wa = notified.whatsapp || {};
        } catch (err) {
          toast.warning("Ticket issued · WhatsApp notify failed", errorMessage(err));
          wa = { ...(data.whatsapp || {}), error: errorMessage(err) };
        }
      }

      const recipients = Array.isArray(wa.recipients)
        ? (wa.recipients as string[])
        : wa.to
          ? [String(wa.to)]
          : waNumbers;
      const toLabel =
        recipients.length > 1
          ? `${recipients.length} numbers`
          : recipients[0] || "manager";
      const sentCount = Array.isArray(wa.attachments_sent)
        ? (wa.attachments_sent as unknown[]).length
        : wa.pdf_attached
          ? 1
          : 0;
      const plannedCount = Array.isArray(wa.attachments_planned)
        ? (wa.attachments_planned as unknown[]).length
        : 0;
      const packBits = [
        "A4 slip",
        hadTicketDoc ? "Ticket" : null,
        hadLeaveDoc ? "Leave" : null,
      ].filter(Boolean);
      const attachPart =
        sentCount > 0
          ? ` One PDF (${packBits.join(" + ")})${
              plannedCount ? ` · ${sentCount}/${plannedCount}` : ""
            }.`
          : wa.pdf_error
            ? ` Attachments: ${String(wa.pdf_error)}`
            : "";

      const approvalHint = " Now in Waiting for approval — Approve or Reject.";
      if (wa.sent && (wa.pdf_attached || sentCount > 0)) {
        toast.success(
          "Sent for approval · WhatsApp + docs",
          `${ticketMsg} Evolution (${wa.instance || "instance"}) → ${toLabel}.${attachPart}${approvalHint}`
        );
      } else if (wa.sent) {
        toast.warning(
          "Sent for approval · WhatsApp text only",
          `${ticketMsg} Message sent to ${toLabel}, but documents were not attached.` +
            (wa.pdf_error ? ` ${String(wa.pdf_error)}` : " Check Evolution Connected.") +
            approvalHint
        );
      } else if (wa.queued) {
        toast.warning(
          "Sent for approval · WhatsApp queued",
          String(wa.error || `${ticketMsg} WhatsApp session not Connected — scan QR in Settings.`) +
            attachPart +
            approvalHint
        );
      } else if (wa.skipped === "evolution_disabled") {
        toast.warning(
          "Sent for approval · WhatsApp off",
          `${ticketMsg} Evolution is disabled — message was not sent.${approvalHint}`
        );
      } else if (wa.error) {
        toast.warning("Sent for approval · WhatsApp failed", String(wa.error) + attachPart);
      } else {
        toast.success("Sent for approval", ticketMsg + attachPart + approvalHint);
      }
      setPreview({ ...data, whatsapp: wa });
      queryClient.invalidateQueries({ queryKey: ["tickets"] });
      invalidateDashboardData(queryClient);
      queryClient.invalidateQueries({ queryKey: ["wa-events"] });
    },
    onError: (err) => toast.error("Issue failed", errorMessage(err)),
  });

  const transitionMutation = useMutation({
    mutationFn: ({
      ticket,
      next,
      reason,
    }: {
      ticket: Ticket;
      next: string;
      reason?: string;
    }) =>
      api(`/tickets/${ticket.id}/status`, {
        method: "PATCH",
        body: { status: next, ...(reason ? { reason } : {}) },
        headers: { "If-Match": String(ticket.version) },
      }),
    onSuccess: (_data, vars) => {
      const label = ticketWorkflowActionLabel(vars.next);
      if (vars.next === "approved") {
        toast.success("Approved", "Ticket is now Waiting for payment.");
        setApprovalDesk("payment");
        setStatusFilter("approved");
      } else if (vars.next === "paid") {
        toast.success("Paid", "Ticket marked paid.");
      } else if (vars.next === "rejected") {
        toast.success("Rejected", "Rejection reason saved on the ticket.");
        setRejectTarget(null);
        setRejectReason("");
      } else {
        toast.success(label);
      }
      queryClient.invalidateQueries({ queryKey: ["tickets"] });
      queryClient.invalidateQueries({ queryKey: ["loans"] });
      invalidateDashboardData(queryClient);
      queryClient.invalidateQueries({ queryKey: ["ess-requests"] });
      queryClient.invalidateQueries({ queryKey: ["ess-request"] });
    },
    onError: (err) => toast.error("Workflow failed", errorMessage(err)),
  });

  const bulkTransitionMutation = useMutation({
    mutationFn: async ({
      rows,
      next,
      reason,
    }: {
      rows: Ticket[];
      next: string;
      reason?: string;
    }) => {
      let ok = 0;
      const failures: string[] = [];
      for (const row of rows) {
        try {
          await api(`/tickets/${row.id}/status`, {
            method: "PATCH",
            body: { status: next, ...(reason ? { reason } : {}) },
            headers: { "If-Match": String(row.version) },
          });
          ok += 1;
        } catch (err) {
          failures.push(`${row.ticket_code || row.id.slice(0, 8)}: ${errorMessage(err)}`);
        }
      }
      return { ok, total: rows.length, failures, next };
    },
    onSuccess: ({ ok, total, failures, next }) => {
      if (failures.length === 0) {
        toast.success(ticketWorkflowActionLabel(next), `${ok} / ${total}`);
      } else {
        toast.warning(`${t("bulk.partial")} ${ok} / ${total}`, failures.slice(0, 3).join("\n"));
      }
      setBulkAction(null);
      setSelectedTickets(new Set());
      if (next === "approved") {
        setApprovalDesk("payment");
        setStatusFilter("approved");
      }
      queryClient.invalidateQueries({ queryKey: ["tickets"] });
      queryClient.invalidateQueries({ queryKey: ["loans"] });
      invalidateDashboardData(queryClient);
      queryClient.invalidateQueries({ queryKey: ["ess-requests"] });
    },
    onError: (err) => toast.error(t("bulk.failed"), errorMessage(err)),
  });

  const updateMutation = useMutation({
    mutationFn: (opts?: { tenureMonths?: number; emiAmount?: number | null; notifyWhatsapp?: boolean }) => {
      if (!editing) throw new Error("No ticket selected");
      const originCode = editForm.origin_code.trim().toUpperCase();
      const destinationCode = editForm.destination_code.trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(originCode) || !/^[A-Z]{3}$/.test(destinationCode)) {
        throw new ApiError(400, "invalid_route", "Enter valid 3-letter airport codes.");
      }
      const leaveStart = editForm.leave_start_date.trim();
      const leaveEnd = editForm.leave_end_date.trim();
      if (Boolean(leaveStart) !== Boolean(leaveEnd)) {
        throw new ApiError(
          400,
          "leave_window_incomplete",
          "Enter both leave start and end dates, or clear both."
        );
      }
      if (leaveStart && leaveEnd && leaveEnd < leaveStart) {
        throw new ApiError(
          400,
          "leave_window_invalid",
          "Leave end date cannot be before the leave start date."
        );
      }
      const isLoan = editForm.excess_handling === "CONVERT_TO_LOAN";
      const tenure = opts?.tenureMonths ?? Number(editForm.tenure_months);
      const emiAmount =
        opts && "emiAmount" in opts
          ? opts.emiAmount ?? undefined
          : emiAmountFor({ months: editForm.tenure_months, emi: editForm.emi_amount });
      if (isLoan && (!Number.isFinite(tenure) || tenure < 1)) {
        throw new ApiError(400, "invalid_loan_terms", "Enter a valid loan tenure in months.");
      }
      const notifyWa =
        typeof opts?.notifyWhatsapp === "boolean"
          ? opts.notifyWhatsapp
          : Boolean(editForm.notify_whatsapp);
      const waNumbers = parseWhatsAppNumbers(editForm.manager_whatsapp);
      // API resolves Reporting-to / employee master when typed managers are empty.
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
          // company_paid intentionally omitted — the settlement engine recomputes
          // company_paid/company_payout server-side (TicketUpdate field optional).
          excess_handling: editForm.excess_handling,
          tenure_months: isLoan ? tenure : null,
          emi_amount: isLoan ? emiAmount ?? null : null,
          leave_start_date: leaveStart || null,
          leave_end_date: leaveEnd || null,
          notes: editForm.notes,
          manager_approval: editForm.manager_approval.trim() || undefined,
          manager_whatsapp_numbers: waNumbers,
          manager_whatsapp: waNumbers[0] || "",
          notify_whatsapp: notifyWa,
        },
      });
    },
    onSuccess: (data, vars) => {
      const loanLabel = data.loan_code || (data.loan_id ? "loan" : null);
      const wa = data.whatsapp || {};
      const notifyWa =
        typeof vars?.notifyWhatsapp === "boolean"
          ? vars.notifyWhatsapp
          : Boolean(editForm.notify_whatsapp);
      let base = "Ticket updated";
      if (data.loan_revised && loanLabel) {
        base = `Ticket updated · Recovery revised — ${loanLabel} created.`;
      } else if (data.loan_created && loanLabel) {
        base = `Ticket updated · Recovery loan ${loanLabel} created.`;
      }
      if (notifyWa) {
        if (wa.sent && wa.pdf_attached) {
          toast.success("Saved · WhatsApp + PDF", `${base} Sent to ${formatWhatsAppDisplayList(String((wa.recipients as string[])?.join(",") || wa.to || ""))}.`);
        } else if (wa.sent) {
          toast.success("Saved · WhatsApp sent", base);
        } else if (wa.queued) {
          toast.warning("Saved · WhatsApp queued", String(wa.error || base));
        } else if (wa.skipped === "evolution_disabled") {
          toast.warning(
            "Saved · WhatsApp off",
            `${base} Evolution is disabled — message was not sent.`
          );
        } else if (wa.error) {
          toast.warning("Saved · WhatsApp failed", String(wa.error));
        } else {
          toast.success(base);
        }
      } else {
        toast.success("Saved", `${base} No WhatsApp sent.`);
      }
      setLoanConfirmOpen(false);
      setEditing(null);
      queryClient.invalidateQueries({ queryKey: ["tickets"] });
      queryClient.invalidateQueries({ queryKey: ["loans"] });
      invalidateDashboardData(queryClient);
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
      toast.success("Ticket deleted", "A linked ESS request goes back to Approved, ready for a new ticket.");
      setDeleting(null);
      queryClient.invalidateQueries({ queryKey: ["tickets"] });
      queryClient.invalidateQueries({ queryKey: ["loans"] });
      invalidateDashboardData(queryClient);
      queryClient.invalidateQueries({ queryKey: ["ess-requests"] });
      queryClient.invalidateQueries({ queryKey: ["ess-request"] });
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
        (overrides.excess_option ?? excessOption) === "CONVERT_TO_LOAN" &&
        Number(overrides.tenure ?? tenure) >= 1
          ? Number(overrides.tenure ?? tenure)
          : undefined,
      emi_amount:
        (overrides.excess_option ?? excessOption) === "CONVERT_TO_LOAN"
          ? emiAmountFor({
              months: String(overrides.tenure ?? tenure),
              emi: overrides.emi !== undefined ? (overrides.emi as string | null) : tenureEmi,
            })
          : undefined,
    });
  };

  const entitlement = preview ? Number(preview.final_entitlement_amount ?? 0) : 0;
  const availableFunds = preview
    ? Number(preview.total_available_funds ?? preview.final_entitlement_amount ?? 0)
    : 0;
  const requested = Number(amount) || 0;
  /** Fare − pot (drives option availability / loan principal). */
  const ticketGap = Math.max(0, requested - entitlement);
  const fullSelfPaid = excessOption === FULL_SELF_PAID;
  const makeLoanOpt = excessOption === "CONVERT_TO_LOAN";
  const companyPaidOpt = excessOption === "COMPANY_PAID";
  const entitlementAmountOpt = excessOption === "ENTITLEMENT_AMOUNT";
  const needsSettlement = Boolean(preview && requested > 0 && ticketGap > 0);
  const entitlementOptionAvailable = availableFunds > 0 || entitlement > 0;
  /** Company top-up when pot does not cover the fare (Entitlement amount). */
  const companyTopUp = Math.max(0, requested - availableFunds);
  // Settlement desk money — shared port of the backend settle rules (ticket-money.ts).
  const desk = settlementKpis(requested, availableFunds, excessOption as never);
  // Settlement "Loan" KPI (renamed from Excess): Make loan → fare − pot; else 0.
  const loanKpi = desk.excess;
  // Within balance (no gap): pot covers the fare → Company pays 0 (Net = deduction only).
  const companyPays = desk.companyPays;
  // Make loan: employee cash 0 (shortfall is Loan). Self paid: employee cash = shortfall.
  // Until a payment option is chosen, fall back to the preview (no off-matrix Net).
  const employeePays =
    !excessOption && needsSettlement ? Number(preview?.employee_payable ?? 0) : desk.employeePays;
  /** Amount drawn from the airfare pot this issue — 0 when company/full-self keep the balance. */
  const airfareBalanceDeduction = desk.deduction;
  /** Net amount = Airfare balance deduction + Company pays. */
  const netAmount = desk.netAmount;

  const approvalWhatsAppMessage = useMemo(() => {
    if (!employee || !preview) return "";
    // Short utility copy (same style as the Evolution outbound text).
    const parts = [
      `Ticket request for Emp ${employee.code} — ${employee.full_name}.`,
      `Fare BHD ${money(requested)}.`,
      origin || destination ? `Route: ${origin || "—"}→${destination || "—"}.` : "",
      "Awaiting approval.",
    ];
    return parts.filter(Boolean).join(" ");
  }, [
    employee,
    preview,
    travelDate,
    origin,
    destination,
    requested,
    entitlement,
    loanKpi,
    netAmount,
    excessOption,
    managerApproval,
  ]);

  useEffect(() => {
    if (!preview || requested <= 0) return;
    if (ticketGap <= 0) return;
    // Industry default (QuickHCM / Bayzat): when ticket exceeds entitlement and HR
    // has not chosen a path yet, pre-select Self paid so Issue cannot soft-fail.
    if (!excessOption) {
      setExcessOption("SELF_PAID");
    }
  }, [preview, requested, ticketGap, excessOption]);

  useEffect(() => {
    if (excessOption !== "ENTITLEMENT_AMOUNT") return;
    if (entitlementOptionAvailable) return;
    setExcessOption("SELF_PAID");
  }, [entitlementOptionAvailable, excessOption]);

  const issue = (opts: { notifyWhatsapp: boolean }) => {
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
    const settlement =
      excessOption || (needsSettlement ? "SELF_PAID" : undefined);
    if (needsSettlement && !settlement) {
      toast.warning(
        "Settlement required",
        "Ticket exceeds entitlement. Choose Self paid, Fully company paid, Make loan, or Entitlement amount."
      );
      return;
    }
    if (settlement === "ENTITLEMENT_AMOUNT" && entitlement <= 0) {
      toast.warning(
        "No entitlement",
        "Entitlement amount is unavailable with a zero balance. Choose Self paid, Fully company paid, or Make loan."
      );
      return;
    }
    if (
      settlement === "CONVERT_TO_LOAN" &&
      tenureEmi != null &&
      emiAmountFor({ months: tenure, emi: tenureEmi }) == null
    ) {
      toast.warning(t("loanTerms.label"), t("loanTerms.emiInvalid"));
      return;
    }
    if (fareReasonMissing) {
      toast.warning(t("fare.light.red"), t("fare.reasonMissing"));
      return;
    }
    if (requiresManagerApproval && !managerApproval.trim()) {
      toast.warning(
        "Approval authority required",
        settlement === "CONVERT_TO_LOAN"
          ? "Loan settlement needs approval authority before issue."
          : ticketsThisYear >= 1
            ? "Second ticket this year needs approval authority before issue. Round trip (going + return) as one issued ticket counts as one claim."
            : t("fare.approval")
      );
      return;
    }
    const waNumbers = parseWhatsAppNumbers(managerWhatsapp);
    if (opts.notifyWhatsapp && !canNotifyWhatsapp) {
      toast.warning(
        "WhatsApp recipients required",
        "Enter a manager number, or ensure Reporting-to / employee master WhatsApp is on file (employee pickup on)."
      );
      return;
    }
    const leaveStartVal = tripType === "ROUND_TRIP" ? leaveStart.trim() : "";
    const leaveEndVal = tripType === "ROUND_TRIP" ? leaveEnd.trim() : "";
    if (tripType === "ROUND_TRIP") {
      if (!leaveStartVal || !leaveEndVal) {
        toast.warning(
          "Leave dates required",
          "Round trip needs both the leave start date and the leave end date."
        );
        return;
      }
      if (leaveEndVal < leaveStartVal) {
        toast.warning(
          "Invalid leave window",
          "Leave end date cannot be before the leave start date."
        );
        return;
      }
    }
    if (tripType === "ONE_WAY" && !oneWayPurpose) {
      toast.warning(t("alloc.trip.oneWayPurposeRequired"), t("alloc.trip.oneWayPurposeHint"));
      return;
    }
    if (settlement === "CONVERT_TO_LOAN" && !(Number(tenure) >= 1)) {
      toast.error("Months required", "Enter a valid number of months.");
      return;
    }
    const oneWayTag =
      tripType === "ONE_WAY" && oneWayPurpose === "FINAL"
        ? "Trip: One way only — cancellation (final / no return)"
        : tripType === "ONE_WAY" && oneWayPurpose === "RETURN_LATER"
          ? "Trip: One way — return booked later"
          : tripType === "ONE_WAY" && oneWayPurpose === "RETURN_BACK"
            ? "Trip: One way — return back ticket"
            : "";
    const issueNotes = [oneWayTag, notes.trim()].filter(Boolean).join("\n");
    issueMutation.mutate({
      employee_id: employeeId,
      as_of_date: travelDate,
      requested_ticket_amount: amt,
      excess_option: settlement || undefined,
      tenure_months: settlement === "CONVERT_TO_LOAN" ? Number(tenure) : undefined,
      emi_amount:
        settlement === "CONVERT_TO_LOAN" ? emiAmountFor({ months: tenure, emi: tenureEmi }) : undefined,
      origin_code: originCode,
      destination_code: destinationCode,
      notes: issueNotes,
      fare_reason: fareRed ? fareReason.trim() : undefined,
      manager_approval: managerApproval.trim() || undefined,
      manager_whatsapp: waNumbers[0] || "",
      manager_whatsapp_numbers: waNumbers,
      trip_type: tripType,
      leave_start_date: leaveStartVal || undefined,
      leave_end_date: leaveEndVal || undefined,
      ess_request_id:
        essLinkable && essRequest.data?.employee_id === employeeId ? essId : undefined,
      notify_whatsapp: opts.notifyWhatsapp,
      // Defer WA until optional ticket/leave files finish uploading.
      defer_whatsapp: Boolean(
        opts.notifyWhatsapp && (pendingTicketDoc || pendingLeaveDoc)
      ),
      wa_include_slip: true,
      wa_include_ticket_doc: Boolean(pendingTicketDoc),
      wa_include_leave_doc: Boolean(pendingLeaveDoc),
    });
  };

  const registerPool = useMemo(() => {
    const all = tickets.data ?? [];
    if (statusFilter === "all") return all;
    return all.filter((row) => row.status === statusFilter);
  }, [tickets.data, statusFilter]);

  const filteredTickets = useMemo(() => {
    const matched = filterTicketsBySearch(registerPool, ticketSearch, {
      policy: policyFilter,
    });
    // Approval / payment desks: oldest-first (clear backlog). Full register: newest ticket #.
    const openDesk = statusFilter === "submitted" || statusFilter === "approved";
    return [...matched].sort((a, b) => {
      if (openDesk) {
        const ca = a.created_at || "";
        const cb = b.created_at || "";
        if (ca !== cb) return ca.localeCompare(cb);
      }
      const na = Number(a.ticket_number ?? 0);
      const nb = Number(b.ticket_number ?? 0);
      if (nb !== na) return openDesk ? na - nb : nb - na;
      return String(b.id).localeCompare(String(a.id));
    });
  }, [registerPool, ticketSearch, policyFilter, statusFilter]);

  const policyCounts = useMemo(() => {
    let over = 0;
    let inPolicy = 0;
    for (const row of registerPool) {
      if (ticketInPolicy(row)) inPolicy += 1;
      else over += 1;
    }
    return { over, in: inPolicy, all: registerPool.length };
  }, [registerPool]);

  const activeSearchChips = useMemo(
    () => ticketQueryChips(ticketSearch),
    [ticketSearch]
  );

  const appendSearchHint = (fragment: string) => {
    setTicketSearch((cur) => {
      const next = cur.trim();
      if (!next) return fragment;
      if (next.toLowerCase().includes(fragment.toLowerCase())) return next;
      return `${next} ${fragment}`.trim();
    });
  };

  const selectedTicketRows = useMemo(
    () => filteredTickets.filter((row) => selectedTickets.has(row.id)),
    [filteredTickets, selectedTickets]
  );
  const eligibleFor = (next: string) =>
    selectedTicketRows.filter((row) => (WORKFLOW[row.status] ?? []).some((a) => a.next === next));
  const toggleTicket = (id: string, on: boolean) =>
    setSelectedTickets((cur) => {
      const nextSet = new Set(cur);
      if (on) nextSet.add(id);
      else nextSet.delete(id);
      return nextSet;
    });
  const openApprovalDesk = (desk: "approval" | "payment" | "all") => {
    setApprovalDesk(desk);
    setStatusFilter(desk === "approval" ? "submitted" : desk === "payment" ? "approved" : "all");
    setPolicyFilter("all");
    setSelectedTickets(new Set());
  };

  const clearTicketSearch = () => {
    setTicketSearch("");
    setPolicyFilter("all");
  };

  const applyTicketView = (view: Record<string, string>) => {
    setTicketSearch(view.search ?? "");
    const status = view.status || "all";
    setStatusFilter(status);
    const pol = view.policy === "over" || view.policy === "in" ? view.policy : "all";
    setPolicyFilter(pol);
    setApprovalDesk(
      status === "submitted" ? "approval" : status === "approved" ? "payment" : "all"
    );
    setSelectedTickets(new Set());
  };

  const runWorkflowAction = (ticket: Ticket, next: string) => {
    if (next === "rejected") {
      setRejectTarget(ticket);
      setRejectReason("");
      return;
    }
    transitionMutation.mutate({ ticket, next });
  };
  const exportTickets = () =>
    downloadCsv(
      `tickets-${selectedTicketRows.length}.csv`,
      [
        "Ticket",
        "Employee code",
        "Employee",
        "Travel date",
        "Origin",
        "Destination",
        "Ticket cost",
        "Entitlement",
        "Loan",
        "Handling",
        "Status",
        "Loan code",
        "Company pays",
        "Employee pays",
        "Airfare balance deduction",
        "Net amount",
      ],
      selectedTicketRows.map((row) => {
        // Same settle desk as the register / backend Ticket Cost report.
        const pay = ticketPayBreakdown(row);
        return [
          row.ticket_code || row.ticket_number,
          row.employee_code,
          row.employee_name,
          row.travel_date,
          row.origin_code,
          row.destination_code,
          pay.ticketAmount,
          pay.availableFund,
          pay.loanAmount,
          row.excess_handling,
          ticketWorkflowStatusLabel(row.status),
          row.loan_code,
          pay.companyPays,
          pay.employeePays,
          pay.deduction,
          pay.netAmount,
        ];
      })
    );

  const stats = useMemo(() => {
    const all = tickets.data ?? [];
    return {
      total: all.length,
      draft: all.filter((t) => t.status === "draft").length,
      submitted: all.filter((t) => t.status === "submitted").length,
      waitingPayment: all.filter((t) => t.status === "approved").length,
      paid: all.filter((t) => t.status === "paid").length,
    };
  }, [tickets.data]);

  return (
    <div className="animate-[fade-in_0.3s_ease-out]" data-testid="airfare-allocation-page">
      <div className={printing ? "no-print" : undefined}>
      <PageHeader
        title={t("page.allocation.title")}
        subtitle={t("page.allocation.subtitle")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/allocation/whatsapp/"
              className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 text-sm hover:bg-[var(--color-secondary)]"
              data-testid="link-allocation-whatsapp"
            >
              <MessageCircle size={14} /> {t("nav.allocationWhatsapp")}
            </Link>
            <ExcelToolbar dataset="tickets" />
          </div>
        }
      />

      {essId ? (
        <div
          data-testid="ess-allocation-banner"
          className={cn(
            "mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] border px-4 py-3 text-sm",
            essLinkable
              ? "border-[var(--color-primary)] bg-[var(--color-primary-muted)]"
              : "border-[var(--color-border)] bg-[var(--color-secondary)]"
          )}
        >
          <div className="min-w-0">
            {essRequest.isPending ? (
              <p>Loading ESS request…</p>
            ) : essRequest.isError || !essRequest.data ? (
              <p>ESS request not found. It may have been deleted.</p>
            ) : (
              <>
                <p className="font-bold">
                  ESS request · {essRequest.data.employee_name || essRequest.data.employee_code || "Employee"}
                  {essRequest.data.employee_code && essRequest.data.employee_name
                    ? ` (${essRequest.data.employee_code})`
                    : ""}
                </p>
                <p className="text-xs text-[var(--color-muted-foreground)]">
                  {essLinkable
                    ? "Form pre-filled from the approved request. Issuing this ticket links it to the request (status becomes Allocated). With WhatsApp on, the employee is also told the ticket is issued."
                    : essRequest.data.ticket_code
                      ? `Already allocated to ticket ${essRequest.data.ticket_code} (${titleCase(essRequest.data.ticket_status || "")}).`
                      : `Request is ${titleCase(essRequest.data.status)}; only approved requests can be allocated.`}
                </p>
              </>
            )}
          </div>
          <Link href="/ess" className="shrink-0 text-xs font-semibold text-[var(--color-primary)] hover:underline">
            Back to ESS requests
          </Link>
        </div>
      ) : null}

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
                <div className="flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-primary-muted)] p-3">
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
                        Reporting to:{" "}
                        {reportingOfficer
                          ? `${reportingOfficer.code} — ${reportingOfficer.full_name}`
                          : employee.reporting_officer_id}
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
                  onChange={(e) => {
                    const next = e.target.value;
                    // Leave start follows the travel date until the user sets it apart.
                    setLeaveStart((cur) => (!cur || cur === travelDate ? next : cur));
                    setTravelDate(next);
                  }}
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

            <div
              className="space-y-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-muted)] p-3"
              data-testid="panel-leave-dates"
            >
              <Field label="Trip type">
                <Select
                  value={tripType}
                  data-testid="select-trip-type"
                  onChange={(e) => {
                    const next = e.target.value === "ONE_WAY" ? "ONE_WAY" : "ROUND_TRIP";
                    setTripType(next);
                    if (next === "ROUND_TRIP") {
                      setOneWayPurpose("");
                      setLeaveStart((cur) => cur || travelDate);
                    } else if (!oneWayPurpose) {
                      setOneWayPurpose("");
                    }
                  }}
                >
                  <option value="ROUND_TRIP">Round trip (going and return)</option>
                  <option value="ONE_WAY">One way</option>
                </Select>
              </Field>
              {tripType === "ROUND_TRIP" ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Leave start date">
                      <Input
                        type="date"
                        value={leaveStart}
                        data-testid="input-leave-start-date"
                        aria-invalid={Boolean(leaveWindow.error)}
                        onChange={(e) => setLeaveStart(e.target.value)}
                      />
                    </Field>
                    <Field label="Leave end date" error={leaveWindow.error ?? undefined}>
                      <Input
                        type="date"
                        value={leaveEnd}
                        min={leaveStart || undefined}
                        data-testid="input-leave-end-date"
                        aria-invalid={Boolean(leaveWindow.error)}
                        onChange={(e) => setLeaveEnd(e.target.value)}
                      />
                    </Field>
                  </div>
                  {leaveWindow.days ? (
                    <p className="text-xs font-semibold text-[var(--color-foreground)]" data-testid="leave-window-summary">
                      {leaveWindow.days} {t("alloc.leave.days")} · {t("alloc.leave.backOn")}{" "}
                      {fmtDate(leaveWindow.backOn)}
                    </p>
                  ) : null}
                  {leaveWindow.warning ? (
                    <p className="text-xs text-[var(--color-warning-emphasis)]" data-testid="leave-window-warning">
                      {leaveWindow.warning}
                    </p>
                  ) : null}
                  <p className="text-[11px] text-[var(--color-muted-foreground)]">
                    {t("alloc.leave.hint")}
                  </p>
                </>
              ) : (
                <div className="space-y-2" data-testid="panel-one-way-purpose">
                  <Field label={t("alloc.trip.oneWayPurpose")}>
                    <Select
                      value={oneWayPurpose}
                      data-testid="select-one-way-purpose"
                      aria-required
                      onChange={(e) => {
                        const v = e.target.value;
                        setOneWayPurpose(
                          v === "FINAL" || v === "RETURN_LATER" || v === "RETURN_BACK"
                            ? v
                            : ""
                        );
                      }}
                    >
                      <option value="">Select purpose…</option>
                      <option value="FINAL">{t("alloc.trip.final")}</option>
                      <option value="RETURN_LATER">{t("alloc.trip.returnLater")}</option>
                      <option value="RETURN_BACK">{t("alloc.trip.returnBack")}</option>
                    </Select>
                  </Field>
                  <p
                    className="text-[11px] text-[var(--color-muted-foreground)]"
                    data-testid="text-one-way-hint"
                  >
                    {oneWayPurpose === "FINAL"
                      ? t("alloc.trip.finalHint")
                      : oneWayPurpose === "RETURN_LATER"
                        ? t("alloc.trip.returnLaterHint")
                        : oneWayPurpose === "RETURN_BACK"
                          ? t("alloc.trip.returnBackHint")
                          : t("alloc.trip.oneWayPurposeHint")}
                  </p>
                </div>
              )}
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
                <p className="mt-1 text-xs opacity-80" data-testid="preview-trip-type">
                  {tripType === "ROUND_TRIP"
                    ? "Round trip (going and return)"
                    : oneWayPurpose === "FINAL"
                      ? t("alloc.trip.final")
                      : oneWayPurpose === "RETURN_LATER"
                        ? t("alloc.trip.returnLater")
                        : oneWayPurpose === "RETURN_BACK"
                          ? t("alloc.trip.returnBack")
                          : "One way"}
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
                    [
                      t("alloc.panel.service"),
                      preview.service_years != null
                        ? `${preview.service_years} ${t("alloc.panel.years")} ${preview.service_months ?? 0} ${t("alloc.panel.months")}`
                        : "—",
                      t("alloc.panel.recordOnly"),
                    ],
                    [
                      t("alloc.panel.ticketsEarned"),
                      preview.tickets_earned != null ? String(preview.tickets_earned) : "—",
                      preview.service_days != null
                        ? `${Number(preview.service_days).toLocaleString()} ${t("alloc.panel.daysFormula")} · ${t("alloc.panel.recordOnly")}`
                        : t("alloc.panel.recordOnly"),
                    ],
                    [
                      t("alloc.panel.ticketsTaken"),
                      preview.tickets_taken != null ? String(preview.tickets_taken) : "—",
                      t("alloc.panel.recordOnly"),
                    ],
                    [
                      "Last ticket",
                      preview.register_last_ticket_date
                        ? fmtDate(preview.register_last_ticket_date)
                        : preview.previous_allocation_date
                          ? fmtDate(preview.previous_allocation_date)
                          : "—",
                      preview.register_last_ticket_date
                        ? [preview.register_last_ticket_code, titleCase(String(preview.register_last_ticket_status ?? ""))]
                            .filter(Boolean)
                            .join(" · ")
                        : "",
                    ],
                    [
                      t("alloc.panel.openingDays"),
                      num(preview.opening_balance_days),
                      Number(preview.starting_balance_days) > 0 && preview.starting_balance_date
                        ? `${t("alloc.panel.from")} ${num(preview.starting_balance_days)} ${t("alloc.panel.daysOn")} ${fmtDate(preview.starting_balance_date)}`
                        : "",
                    ],
                    [
                      "Accrued days",
                      num(preview.accrued_days),
                      preview.accrual_start
                        ? `${t("alloc.panel.since")} ${fmtDate(preview.accrual_start)}`
                        : "",
                    ],
                    [
                      t("alloc.panel.lastLeaveEnd"),
                      preview.last_leave_end_date ? fmtDate(preview.last_leave_end_date) : "—",
                      preview.last_leave_end_date
                        ? [
                            preview.last_leave_start_date
                              ? `${t("alloc.panel.leaveFrom")} ${fmtDate(preview.last_leave_start_date)}`
                              : "",
                            preview.last_leave_ticket_code ?? "",
                            preview.last_leave_returned_on
                              ? `${t("alloc.panel.backOn")} ${fmtDate(preview.last_leave_returned_on)}`
                              : "",
                          ]
                            .filter(Boolean)
                            .join(" · ")
                        : "",
                    ],
                    ["Already paid days", num(preview.already_paid_days)],
                    preview.entitlement_method === "rolling"
                      ? [
                          t("alloc.panel.balanceDays"),
                          `${num(preview.total_entitlement_days)} / ${num(preview.rate_days)}`,
                          t("alloc.panel.balanceHint"),
                        ]
                      : ["Current-year remaining", money(preview.current_year_remaining)],
                    ["Total available funds", money(preview.total_available_funds)],
                  ].map(([label, value, hint]) => (
                    <div key={String(label)}>
                      <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-muted-foreground)]">
                        {label}
                      </p>
                      <p className="text-sm font-semibold">{value}</p>
                      {hint ? (
                        <p className="text-[11px] text-[var(--color-muted-foreground)]">{hint}</p>
                      ) : null}
                    </div>
                  ))}
                </CardContent>
              </Card>

                <Card data-testid="panel-settlement">
                  <CardHeader>
                    <CardTitle>Settlement</CardTitle>
                    <CardDescription>
                      {requested > 0
                        ? `Ticket ${money(requested)} vs entitlement ${money(entitlement)}`
                        : `Enter the ticket amount — entitlement available ${money(entitlement)}`}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {requested > 0 ? (
                    <div className="grid grid-cols-2 gap-3 text-center sm:grid-cols-3 lg:grid-cols-5">
                      <div className="rounded-[var(--radius-sm)] bg-[var(--color-secondary)] p-3">
                        <p className="text-[11px] font-bold uppercase text-[var(--color-muted-foreground)]">Loan</p>
                        <p
                          className={cn(
                            "text-lg font-extrabold",
                            loanKpi > 0 ? "text-[var(--color-destructive)]" : "text-[var(--color-success)]"
                          )}
                          data-testid="settlement-loan"
                        >
                          {money(loanKpi)}
                        </p>
                        {makeLoanOpt && loanKpi > 0 ? (
                          <p className="mt-0.5 text-[10px] text-[var(--color-muted-foreground)]">
                            Fare − airfare balance
                          </p>
                        ) : null}
                      </div>
                      <div className="rounded-[var(--radius-sm)] bg-[var(--color-secondary)] p-3">
                        <p className="text-[11px] font-bold uppercase text-[var(--color-muted-foreground)]">Company pays</p>
                        <p className="text-lg font-extrabold" data-testid="settlement-company-pays">
                          {money(companyPays)}
                        </p>
                        {entitlementAmountOpt && companyTopUp > 0 ? (
                          <p className="mt-0.5 text-[10px] text-[var(--color-muted-foreground)]">
                            Top-up beyond funds
                          </p>
                        ) : null}
                        {companyPaidOpt ? (
                          <p className="mt-0.5 text-[10px] text-[var(--color-muted-foreground)]">
                            Full fare — pot not deducted
                          </p>
                        ) : null}
                      </div>
                      <div className="rounded-[var(--radius-sm)] bg-[var(--color-secondary)] p-3">
                        <p className="text-[11px] font-bold uppercase text-[var(--color-muted-foreground)]">Employee pays</p>
                        <p className="text-lg font-extrabold" data-testid="settlement-employee-pays">
                          {money(employeePays)}
                        </p>
                      </div>
                      <div className="rounded-[var(--radius-sm)] bg-[var(--color-secondary)] p-3">
                        <p className="text-[11px] font-bold uppercase text-[var(--color-muted-foreground)]">
                          Airfare balance deduction
                        </p>
                        <p className="text-lg font-extrabold" data-testid="settlement-available-funds">
                          {money(airfareBalanceDeduction)}
                        </p>
                        {companyPaidOpt || fullSelfPaid ? (
                          <p className="mt-0.5 text-[10px] text-[var(--color-muted-foreground)]">
                            0 — total available funds unchanged
                          </p>
                        ) : entitlementAmountOpt ? (
                          <p className="mt-0.5 text-[10px] text-[var(--color-muted-foreground)]">
                            {availableFunds >= requested
                              ? "Covers the ticket — company pays 0"
                              : `Applied from total available funds`}
                          </p>
                        ) : airfareBalanceDeduction > 0 ? (
                          <p className="mt-0.5 text-[10px] text-[var(--color-muted-foreground)]">
                            Drawn from total available funds
                          </p>
                        ) : null}
                      </div>
                      <div className="rounded-[var(--radius-sm)] bg-[var(--color-secondary)] p-3">
                        <p className="text-[11px] font-bold uppercase text-[var(--color-muted-foreground)]">Net amount</p>
                        <p className="text-lg font-extrabold" data-testid="settlement-net-amount">
                          {money(netAmount)}
                        </p>
                        <p className="mt-0.5 text-[10px] text-[var(--color-muted-foreground)]">
                          Deduction + company pays
                        </p>
                      </div>
                    </div>
                    ) : null}

                    <div className="space-y-2" data-testid="settlement-options">
                      <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-muted-foreground)]">
                        Payment option
                      </p>
                      {!needsSettlement ? (
                        <p
                          className="rounded-[var(--radius-sm)] bg-[var(--color-secondary)] px-3 py-2 text-xs text-[var(--color-muted-foreground)]"
                          data-testid="settlement-options-note"
                        >
                          {fullSelfPaid
                            ? "The employee pays the whole ticket; the airfare balance is kept."
                            : requested <= 0
                              ? `Enter the ticket amount — balance available ${money(entitlement)}.`
                              : `Ticket within the balance of ${money(entitlement)} — the company pays it from the balance, so there is no excess to self-pay or loan. Choose Self paid (full ticket) to keep the balance.`}
                        </p>
                      ) : null}
                      <div className="grid gap-2 sm:grid-cols-2">
                        {EXCESS_OPTIONS.map(({ value, label, icon: Icon, blurb }) => {
                          const noBalance =
                            value === "ENTITLEMENT_AMOUNT" && !entitlementOptionAvailable;
                          const disabled = noBalance;
                          const selected = excessOption === value && !disabled;
                          return (
                            <button
                              key={value}
                              type="button"
                              disabled={disabled}
                              data-testid={`settlement-option-${value}`}
                              aria-disabled={disabled}
                              title={
                                noBalance
                                  ? "No employee available funds — Entitlement amount needs a positive balance."
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
                                    ? "border-[var(--color-border)] bg-white hover:border-[var(--color-input-hover)]"
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
                                  {noBalance
                                    ? "Unavailable — employee has no entitlement amount"
                                    : blurb}
                                </p>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {excessOption === "CONVERT_TO_LOAN" && needsSettlement ? (
                      <LoanTermsInput
                        excess={ticketGap}
                        value={{ months: tenure, emi: tenureEmi }}
                        onChange={(v) => {
                          setTenure(v.months);
                          setTenureEmi(v.emi);
                        }}
                        onCommit={(v) => runPreview({ tenure: v.months, emi: v.emi })}
                        testId="loan-terms-new"
                      />
                    ) : null}

                    {needsSettlement && preview.emi != null ? (
                      <p
                        className="rounded-[var(--radius-sm)] bg-[var(--color-warning-muted)] px-3 py-2 text-sm font-semibold text-[var(--color-warning-emphasis)]"
                        data-testid="alloc-emi-preview"
                      >
                        EMI preview:{" "}
                        {preview.tenure_months != null && preview.last_installment != null ? (
                          <LoanPlanText
                            plan={{
                              basis: preview.repayment_basis === "emi" ? "emi" : "tenure",
                              months: Number(preview.tenure_months),
                              emi: Number(preview.emi),
                              last: Number(preview.last_installment),
                            }}
                          />
                        ) : (
                          <>{money(preview.emi)} / month</>
                        )}
                      </p>
                    ) : null}

                    {sameDayTicket ? (
                      <div
                        role="alert"
                        data-testid="same-day-ticket"
                        className="flex items-start gap-3 rounded-[var(--radius-md)] border border-[var(--color-destructive)] bg-[var(--color-destructive-muted)] p-3"
                      >
                        <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-destructive)]" />
                        <div className="min-w-0 flex-1 text-sm">
                          <p className="font-bold text-[var(--color-destructive)]">
                            {t("alloc.sameDay.title")}: {sameDayTicket.ticket_code ?? ""}{" "}
                            <span className="font-normal">
                              ({ticketWorkflowStatusLabel(sameDayTicket.status)})
                            </span>
                          </p>
                          <p className="text-xs text-[var(--color-muted-foreground)]">
                            {t("alloc.sameDay.body")}
                          </p>
                        </div>
                        <Button size="sm" variant="outline" onClick={() => openEdit(sameDayTicket)}>
                          <Pencil size={14} /> {t("alloc.sameDay.open")}
                        </Button>
                      </div>
                    ) : null}

                    {laterTicket ? (
                      <div
                        role="alert"
                        data-testid="later-ticket"
                        className="flex items-start gap-3 rounded-[var(--radius-md)] border border-[var(--color-destructive)] bg-[var(--color-destructive-muted)] p-3"
                      >
                        <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-destructive)]" />
                        <div className="min-w-0 flex-1 text-sm">
                          <p className="font-bold text-[var(--color-destructive)]">
                            {t("alloc.laterTicket.title")}: {laterTicket.ticket_code ?? ""}{" "}
                            <span className="font-normal">
                              ({fmtDate(laterTicket.travel_date)} ·{" "}
                              {ticketWorkflowStatusLabel(laterTicket.status)})
                            </span>
                          </p>
                          <p className="text-xs text-[var(--color-muted-foreground)]">
                            {t("alloc.laterTicket.body")}
                          </p>
                        </div>
                        <Button size="sm" variant="outline" onClick={() => openEdit(laterTicket)}>
                          <Pencil size={14} /> {t("alloc.sameDay.open")}
                        </Button>
                      </div>
                    ) : null}

                    <FareCheckPanel
                      check={fareCheck.data}
                      loading={fareCheck.isFetching}
                      reason={fareReason}
                      onReasonChange={setFareReason}
                    />

                    <div
                      className="space-y-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-muted)] p-3"
                      data-testid="panel-approval-whatsapp"
                    >
                      <div className="flex items-start gap-2">
                        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-primary)]" />
                        <div>
                          <p className="text-sm font-bold">Approval & WhatsApp</p>
                          <p className="text-xs text-[var(--color-muted-foreground)]">
                            Issue & WhatsApp sends one PDF pack to Employee (master), Reporting manager
                            (Employee Master → Reporting to + their WhatsApp), HR and MD (Settings),
                            plus any one-off extras
                            {requiresManagerApproval
                              ? fareRed
                                ? " — approval authority required: fare above policy"
                                : " — approval authority required for loan or 2nd+ ticket"
                              : ""}
                            .
                          </p>
                          <p className="mt-1 text-[11px] text-[var(--color-muted-foreground)]">
                            Ticket counting: each issued allocation is one claim. Round trip (going + return)
                            booked as one ticket = one claim; two one-ways = two claims.
                          </p>
                        </div>
                      </div>

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

                      <div className="sm:col-span-2 space-y-3" data-testid="panel-manager-whatsapp">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <p className="text-xs font-semibold text-[var(--color-foreground)]">
                            Who gets the WhatsApp pack
                          </p>
                          <Link
                            href="/settings/#whatsapp-distribution-settings"
                            className="text-[11px] font-medium text-[var(--color-primary)] underline-offset-2 hover:underline"
                            data-testid="link-wa-settings-from-issue"
                          >
                            Edit lists in Settings
                          </Link>
                        </div>
                        <p className="text-[11px] text-[var(--color-muted-foreground)]">
                          Employee + Reporting manager = Employee Master. HR / MD = Settings. One-off
                          numbers below are extras only.
                        </p>

                        {/* Role roster — resolve before send (HR notification UX pattern) */}
                        <div
                          className="grid gap-2"
                          role="list"
                          aria-label="WhatsApp recipients by role"
                          data-testid="wa-role-roster"
                        >
                          {(
                            [
                              {
                                id: "employee",
                                role: "Employee (traveller)",
                                source: "Employee Master",
                                numbers: includeEmployeeWa ? employeeWhatsappNumbers : [],
                                empty: !employee
                                  ? "Select an employee first"
                                  : !employeeWhatsapp
                                    ? "No WhatsApp on this employee’s master record"
                                    : !includeEmployeeWa
                                      ? "Pickup off — turn on at Allocation → WhatsApp desk"
                                      : "",
                                testId: "wa-role-employee",
                              },
                              {
                                id: "manager",
                                role: "Reporting manager",
                                source: "Employee Master → Reporting to",
                                numbers: reportingManagerNumbers,
                                empty: !employee
                                  ? "Select an employee first"
                                  : !employee.reporting_officer_id
                                    ? "Set Reporting to on Employee Master"
                                    : !officerWhatsapp
                                      ? "Reporting manager has no WhatsApp on Employee Master"
                                      : "",
                                testId: "wa-role-manager",
                                note: reportingOfficer
                                  ? `${reportingOfficer.code} — ${reportingOfficer.full_name}`
                                  : undefined,
                              },
                              {
                                id: "hr",
                                role: "HR",
                                source: "Settings → HR list",
                                numbers: settingsWaLists.hr,
                                empty: settingsWaLists.hr.length
                                  ? ""
                                  : "Add numbers in Settings → WhatsApp (HR)",
                                testId: "wa-role-hr",
                              },
                              {
                                id: "md",
                                role: "MD",
                                source: "Settings → MD list",
                                numbers: settingsWaLists.md,
                                empty: settingsWaLists.md.length
                                  ? ""
                                  : "Add numbers in Settings → WhatsApp (MD)",
                                testId: "wa-role-md",
                              },
                            ] as const
                          ).map((row) => (
                            <div
                              key={row.id}
                              role="listitem"
                              data-testid={row.testId}
                              className="flex flex-wrap items-start justify-between gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2"
                            >
                              <div className="min-w-0">
                                <p className="text-xs font-bold text-[var(--color-foreground)]">
                                  {row.role}
                                </p>
                                <p className="text-[10px] text-[var(--color-muted-foreground)]">
                                  {row.source}
                                  {"note" in row && row.note ? ` · ${row.note}` : ""}
                                </p>
                              </div>
                              <div className="min-w-0 text-end" dir="ltr">
                                {row.numbers.length > 0 ? (
                                  <p
                                    className="font-mono text-xs font-semibold text-[var(--color-foreground)]"
                                    data-testid={`${row.testId}-numbers`}
                                  >
                                    {formatWhatsAppDisplayList(row.numbers)}
                                  </p>
                                ) : (
                                  <p
                                    className="text-[11px] text-[var(--color-muted-foreground)]"
                                    data-testid={`${row.testId}-empty`}
                                  >
                                    {row.empty || "—"}
                                  </p>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>

                        <div className="space-y-2 rounded-[var(--radius-sm)] border border-dashed border-[var(--color-border)] p-2">
                          <p className="text-xs font-semibold text-[var(--color-foreground)]">
                            One-off extras (optional)
                          </p>
                          <div className="grid gap-2 sm:grid-cols-2">
                            <Field label="Extra 1">
                              <Input
                                value={managerWa1}
                                data-testid="input-manager-whatsapp-1"
                                placeholder="Optional extra number"
                                dir="ltr"
                                className="font-mono text-sm"
                                onChange={(e) => setManagerWa1(e.target.value)}
                              />
                            </Field>
                            <Field label="Extra 2">
                              <Input
                                value={managerWa2}
                                data-testid="input-manager-whatsapp-2"
                                placeholder="Optional second extra"
                                dir="ltr"
                                className="font-mono text-sm"
                                onChange={(e) => setManagerWa2(e.target.value)}
                              />
                            </Field>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              data-testid="btn-toggle-wa-other"
                              onClick={() => setShowWaOther((v) => !v)}
                            >
                              {showWaOther ? "Hide paste" : "Paste more extras"}
                            </Button>
                            {canSaveWaDefaults ? (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                data-testid="btn-save-wa-defaults"
                                disabled={
                                  saveWaDefaultsMut.isPending || typedManagerNumbers.length === 0
                                }
                                onClick={() => saveWaDefaultsMut.mutate()}
                              >
                                Save extras as Settings managers
                              </Button>
                            ) : null}
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              data-testid="btn-open-manager-whatsapp"
                              disabled={plannedFanout.length === 0 || !approvalWhatsAppMessage}
                              onClick={() => {
                                const first = plannedFanout[0];
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
                          {showWaOther ? (
                            <Field
                              label="Paste extras"
                              hint="Comma or one number per line — merged with Settings lists (capped)"
                            >
                              <Textarea
                                value={managerWaOther}
                                data-testid="input-manager-whatsapp-other"
                                placeholder={"Paste extras, e.g.\n973XXXXXXXX"}
                                dir="ltr"
                                rows={2}
                                className="font-mono text-sm"
                                onChange={(e) => setManagerWaOther(e.target.value)}
                              />
                            </Field>
                          ) : null}
                        </div>

                        {plannedFanout.length > 0 ? (
                          <p
                            className="rounded-[var(--radius-sm)] bg-[var(--color-secondary)] px-2 py-1.5 text-[11px] font-medium"
                            dir="ltr"
                            data-testid="wa-fanout-summary"
                          >
                            Will message {formatWhatsAppDisplayList(plannedFanout)}
                            {plannedFanout.length >= WhatsAppClickToChatLimits.MAX_RECIPIENTS
                              ? ` (capped at ${WhatsAppClickToChatLimits.MAX_RECIPIENTS})`
                              : ""}
                            . One merged PDF pack.
                          </p>
                        ) : (
                          <p className="text-[11px] text-[var(--color-destructive)]" data-testid="wa-fanout-empty">
                            No recipients yet — set Employee Master WhatsApp and/or Settings manager/HR/MD
                            lists.
                          </p>
                        )}
                      </div>
                    </div>

                    <Field label="Notes (optional)">
                      <Textarea
                        rows={2}
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="Extra context (approval is stored separately above)"
                      />
                    </Field>

                    <div
                      className="space-y-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] p-3"
                      data-testid="panel-issue-attachments"
                    >
                      <div>
                        <p className="text-xs font-semibold text-[var(--color-foreground)]">
                          Attach documents (optional)
                        </p>
                        <p className="text-[11px] text-[var(--color-muted-foreground)]">
                          WhatsApp always sends the A4 slip. Attach a ticket or leave file only if you
                          want it merged into that same PDF.
                        </p>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="Ticket document" hint="PDF or image — optional">
                          <Input
                            type="file"
                            accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/*"
                            data-testid="input-issue-ticket-receipt"
                            onChange={(e) => setPendingTicketDoc(acceptPickedFile(e.target))}
                          />
                          {pendingTicketDoc ? (
                            <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-[var(--color-muted-foreground)]">
                              <span className="min-w-0 truncate" data-testid="wa-attach-ticket-ready">
                                {pendingTicketDoc.name} ({formatBytes(pendingTicketDoc.size)})
                              </span>
                              <span className="flex shrink-0 items-center gap-1">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 px-2"
                                  data-testid="btn-preview-issue-ticket"
                                  onClick={() => setPendingViewerIndex(0)}
                                >
                                  <Eye size={13} /> {t("alloc.docs.view")}
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 px-2 text-[var(--color-destructive)]"
                                  data-testid="btn-clear-issue-ticket"
                                  onClick={() => setPendingTicketDoc(null)}
                                >
                                  <Trash2 size={13} /> {t("viewer.remove")}
                                </Button>
                              </span>
                            </div>
                          ) : null}
                        </Field>
                        <Field label="Leave settlement" hint="PDF or image — optional">
                          <Input
                            type="file"
                            accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/*"
                            data-testid="input-issue-leave-settlement"
                            onChange={(e) => setPendingLeaveDoc(acceptPickedFile(e.target))}
                          />
                          {pendingLeaveDoc ? (
                            <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-[var(--color-muted-foreground)]">
                              <span className="min-w-0 truncate" data-testid="wa-attach-leave-ready">
                                {pendingLeaveDoc.name} ({formatBytes(pendingLeaveDoc.size)})
                              </span>
                              <span className="flex shrink-0 items-center gap-1">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 px-2"
                                  data-testid="btn-preview-issue-leave"
                                  onClick={() => setPendingViewerIndex(pendingTicketDoc ? 1 : 0)}
                                >
                                  <Eye size={13} /> {t("alloc.docs.view")}
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 px-2 text-[var(--color-destructive)]"
                                  data-testid="btn-clear-issue-leave"
                                  onClick={() => setPendingLeaveDoc(null)}
                                >
                                  <Trash2 size={13} /> {t("viewer.remove")}
                                </Button>
                              </span>
                            </div>
                          ) : null}
                        </Field>
                      </div>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2" data-testid="panel-issue-actions">
                      <Button
                        variant="outline"
                        size="lg"
                        className="w-full"
                        data-testid="btn-save-ticket"
                        disabled={
                          issueMutation.isPending ||
                          Boolean(sameDayTicket || laterTicket) ||
                          (needsSettlement && !excessOption) ||
                          fareReasonMissing ||
                          (requiresManagerApproval && !managerApproval.trim())
                        }
                        onClick={() => issue({ notifyWhatsapp: false })}
                      >
                        {issueMutation.isPending ? (
                          <Loader2 size={16} className="animate-spin" />
                        ) : (
                          <CircleCheck size={16} />
                        )}
                        {sameDayTicket
                          ? t("alloc.sameDay.button")
                          : laterTicket
                            ? t("alloc.laterTicket.button")
                          : needsSettlement && !excessOption
                          ? "Choose excess settlement"
                          : fareReasonMissing
                            ? t("fare.enterReason")
                            : requiresManagerApproval && !managerApproval.trim()
                              ? "Enter approval authority"
                              : "Save ticket"}
                      </Button>
                      <Button
                        variant="gradient"
                        size="lg"
                        className="w-full"
                        data-testid="btn-issue-ticket"
                        disabled={
                          issueMutation.isPending ||
                          Boolean(sameDayTicket || laterTicket) ||
                          (needsSettlement && !excessOption) ||
                          fareReasonMissing ||
                          (requiresManagerApproval && !managerApproval.trim()) ||
                          !canNotifyWhatsapp
                        }
                        onClick={() => issue({ notifyWhatsapp: true })}
                      >
                        {issueMutation.isPending ? (
                          <Loader2 size={16} className="animate-spin" />
                        ) : (
                          <MessageCircle size={16} />
                        )}
                        {!canNotifyWhatsapp ? "Enter WhatsApp to notify" : "Issue & WhatsApp"}
                      </Button>
                    </div>
                    <p className="text-[11px] text-center text-[var(--color-muted-foreground)]">
                      Save keeps the ticket quiet. Issue & WhatsApp sends the A4 slip (plus any files
                      you attached) as one PDF.
                    </p>
                  </CardContent>
                </Card>
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
        <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <StatCard
            label="Total tickets"
            value={stats.total}
            icon={<TicketIcon size={20} />}
            tone="primary"
            onClick={() => openApprovalDesk("all")}
          />
          <StatCard label="Draft" value={stats.draft} icon={<Clock size={20} />} tone="accent" />
          <StatCard
            label="Waiting for approval"
            value={stats.submitted}
            icon={<Send size={20} />}
            tone="warning"
            onClick={() => openApprovalDesk("approval")}
          />
          <StatCard
            label="Waiting for payment"
            value={stats.waitingPayment}
            icon={<Banknote size={20} />}
            tone="warning"
            onClick={() => openApprovalDesk("payment")}
          />
          <StatCard label="Paid" value={stats.paid} icon={<BadgeCheck size={20} />} tone="success" />
        </div>

        <Card className="mb-4" data-testid="approval-management">
          <CardHeader>
            <CardTitle className="text-base">
              {approvalDesk === "approval"
                ? "Waiting for approval"
                : approvalDesk === "payment"
                  ? "Waiting for payment"
                  : "Ticket register"}
            </CardTitle>
            <CardDescription>
              {approvalDesk === "approval"
                ? "Queue only — Approve or Reject on Dashboard → New Ticket (Pending). Amounts in BHD."
                : approvalDesk === "payment"
                  ? "Queue only — Mark paid or Reject on Dashboard → New Ticket (Pending). Amounts in BHD."
                  : "Name stays pinned while you scroll amounts · BHD · Approve / pay on Dashboard"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 pt-3">
            {/* Single baseline toolbar — PatternFly / Infor: chips left, search+status right */}
            <div
              className="flex flex-col gap-2 border-b border-[var(--color-border)] pb-3"
              data-testid="ticket-search-toolbar"
            >
              <div className="flex flex-wrap items-center gap-2">
                <div
                  className="flex flex-wrap items-center gap-1.5"
                  role="group"
                  aria-label="Policy lenses"
                  data-testid="ticket-search-lenses"
                >
                  {(
                    [
                      { key: "all" as const, label: "All", count: policyCounts.all },
                      {
                        key: "over" as const,
                        label: "Over entitlement",
                        count: policyCounts.over,
                      },
                      {
                        key: "in" as const,
                        label: "In policy",
                        count: policyCounts.in,
                      },
                    ] as const
                  ).map((lens) => (
                    <button
                      key={lens.key}
                      type="button"
                      data-testid={`lens-policy-${lens.key}`}
                      aria-pressed={policyFilter === lens.key}
                      onClick={() => setPolicyFilter(lens.key)}
                      className={cn(
                        "inline-flex h-9 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold ring-1 ring-inset transition-colors",
                        policyFilter === lens.key
                          ? lens.key === "over"
                            ? "bg-[var(--color-destructive-muted)] text-[var(--color-destructive-emphasis)] ring-[var(--color-destructive-ring)]"
                            : lens.key === "in"
                              ? "bg-[var(--color-success-muted)] text-[var(--color-success-emphasis)] ring-[var(--color-success-ring)]"
                              : "bg-[var(--color-primary-muted)] text-[var(--color-primary-emphasis)] ring-[var(--color-primary-ring)]"
                          : "bg-[var(--color-card)] text-[var(--color-muted-foreground)] ring-[var(--color-border)] hover:bg-[var(--color-secondary)]"
                      )}
                    >
                      {lens.label}
                      <span className="tabular-nums opacity-80">{lens.count}</span>
                    </button>
                  ))}
                </div>

                <div className="ms-auto flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2 sm:flex-nowrap">
                  <Select
                    aria-label="Filter by ticket status"
                    value={statusFilter}
                    onChange={(e) => {
                      const next = e.target.value;
                      setStatusFilter(next);
                      setApprovalDesk(
                        next === "submitted"
                          ? "approval"
                          : next === "approved"
                            ? "payment"
                            : "all"
                      );
                    }}
                    className="h-9 w-[10.5rem] shrink-0 lg:h-9"
                    data-testid="select-ticket-status"
                  >
                    <option value="all">All statuses</option>
                    {["draft", "submitted", "approved", "rejected", "paid"].map((s) => (
                      <option key={s} value={s}>
                        {ticketWorkflowStatusLabel(s)}
                      </option>
                    ))}
                  </Select>
                  <SearchInput
                    value={ticketSearch}
                    onChange={setTicketSearch}
                    placeholder="Search name, code, route…"
                    className="w-full min-w-[12rem] sm:w-64 sm:flex-none"
                    data-testid="input-ticket-search"
                    hint="BOM→BLR · name:adel · code:E1042 · &quot;full name&quot; · Esc clears"
                  />
                  <span
                    className="shrink-0 text-xs tabular-nums text-[var(--color-muted-foreground)]"
                    role="status"
                    aria-live="polite"
                    data-testid="ticket-search-count"
                  >
                    {filteredTickets.length}
                    {filteredTickets.length !== registerPool.length
                      ? ` / ${registerPool.length}`
                      : ""}
                  </span>
                </div>
              </div>

              {(activeSearchChips.length > 0 || policyFilter !== "all") && (
                <div
                  className="flex flex-wrap items-center gap-1.5"
                  data-testid="ticket-active-filters"
                >
                  {policyFilter !== "all" ? (
                    <button
                      type="button"
                      className="inline-flex h-7 items-center gap-1 rounded-full bg-[var(--color-secondary)] px-2.5 text-[11px] font-semibold text-[var(--color-foreground)] ring-1 ring-[var(--color-border)]"
                      onClick={() => setPolicyFilter("all")}
                      data-testid="chip-policy-lens"
                    >
                      {policyFilter === "over" ? "Over entitlement" : "In policy"}
                      <XCircle size={12} className="opacity-70" />
                    </button>
                  ) : null}
                  {activeSearchChips.map((chip) => (
                    <button
                      key={chip.id}
                      type="button"
                      className="inline-flex h-7 items-center gap-1 rounded-full bg-[var(--color-primary-muted)] px-2.5 text-[11px] font-semibold text-[var(--color-primary-emphasis)] ring-1 ring-[var(--color-primary-ring)]"
                      data-testid={`chip-search-${chip.id}`}
                      onClick={() =>
                        setTicketSearch(removeTicketQueryChip(ticketSearch, chip))
                      }
                    >
                      {chip.label}
                      <XCircle size={12} className="opacity-70" />
                    </button>
                  ))}
                  <button
                    type="button"
                    className="h-7 px-2 text-[11px] font-semibold text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
                    data-testid="btn-clear-ticket-search"
                    onClick={clearTicketSearch}
                  >
                    Clear all
                  </button>
                </div>
              )}

              {!ticketSearch.trim() && (
                <div
                  className="flex flex-wrap items-center gap-1.5"
                  data-testid="ticket-search-suggestions"
                >
                  <span className="text-[11px] text-[var(--color-muted-foreground)]">Try:</span>
                  {(
                    [
                      { label: "BOM→BLR", value: "BOM→BLR" },
                      { label: "policy:over", value: "policy:over" },
                      { label: "name:", value: "name:" },
                      { label: "code:", value: "code:" },
                    ] as const
                  ).map((s) => (
                    <button
                      key={s.value}
                      type="button"
                      className="inline-flex h-6 items-center rounded-full px-2 text-[11px] font-medium text-[var(--color-muted-foreground)] ring-1 ring-[var(--color-border)] hover:bg-[var(--color-secondary)] hover:text-[var(--color-foreground)]"
                      data-testid={`suggest-${s.value}`}
                      onClick={() => appendSearchHint(s.value)}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <SavedViews
              scope="tickets"
              filters={{ search: ticketSearch, status: statusFilter, policy: policyFilter }}
              defaults={{ search: "", status: "all", policy: "all" }}
              onApply={applyTicketView}
            />
            <div className="flex flex-wrap items-center gap-3">
              <label className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--color-muted-foreground)]">
                <SelectBox
                  checked={filteredTickets.length > 0 && selectedTicketRows.length === filteredTickets.length}
                  indeterminate={selectedTicketRows.length > 0}
                  onChange={(on) => setSelectedTickets(on ? new Set(filteredTickets.map((r) => r.id)) : new Set())}
                  label={t("bulk.selectAll")}
                  testId="select-all-tickets"
                />
                {t("bulk.selectAll")} ({filteredTickets.length})
              </label>
            </div>
            <BulkBar count={selectedTicketRows.length} onClear={() => setSelectedTickets(new Set())} testId="bulk-tickets">
              {[
                { next: "submitted", label: t("bulk.submit"), icon: Send },
              ].map(({ next, label, icon: Icon }) => {
                const count = eligibleFor(next).length;
                return (
                  <Button
                    key={next}
                    size="sm"
                    variant="outline"
                    disabled={count === 0 || bulkTransitionMutation.isPending}
                    data-testid={`bulk-ticket-${next}`}
                    onClick={() => setBulkAction({ next, label })}
                  >
                    <Icon size={13} /> {label} ({count})
                  </Button>
                );
              })}
              <Button size="sm" variant="outline" onClick={exportTickets}>
                <Download size={13} /> {t("bulk.exportCsv")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                data-testid="bulk-open-dashboard-desk"
                onClick={() => router.push(appPath("/dashboard"))}
              >
                <ShieldCheck size={13} /> Approve / pay on Dashboard
              </Button>
            </BulkBar>
            {tickets.isPending ? (
              <ListSkeleton items={6} label={t("state.loading")} />
            ) : tickets.isError ? (
              <ErrorState error={tickets.error} onRetry={tickets.refetch} />
            ) : filteredTickets.length === 0 ? (
              <EmptyState
                icon={<TicketIcon size={22} />}
                title={
                  ticketSearch.trim() || policyFilter !== "all" || statusFilter !== "all"
                    ? "No tickets match this search"
                    : "No tickets found"
                }
                message={
                  ticketSearch.trim() || policyFilter !== "all"
                    ? "Try another name, ticket code (T-000115), route (BOM→BLR), or clear filters."
                    : "Issue a ticket above or adjust the filters."
                }
                action={
                  ticketSearch.trim() || policyFilter !== "all" ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      data-testid="btn-empty-clear-search"
                      onClick={clearTicketSearch}
                    >
                      Clear search
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <AllocationRegisterTable
                tickets={filteredTickets}
                selected={selectedTickets}
                onToggle={toggleTicket}
                onEdit={openEdit}
                onPrint={(row) => setPrinting(row)}
                onDocs={openTicketDocs}
                onDelete={requestDelete}
                onWorkflow={runWorkflowAction}
                workflowFor={(status) => WORKFLOW[status] ?? []}
                docsBusyId={
                  viewerTicketId && viewerAttachments.isFetching ? viewerTicketId : null
                }
                selectLabel={(row) =>
                  `${tr("bulk.select")} ${row.ticket_code || row.employee_name || row.id}`
                }
              />
            )}
          </CardContent>
        </Card>
      </div>
      </div>

      <DocumentViewer
        docs={viewerDocs}
        index={viewerTicketId ? viewerIndex : null}
        onIndexChange={setViewerIndex}
        onClose={closeTicketDocs}
        onRemove={canDeleteAttachments ? removeTicketDoc : undefined}
      />
      <DocumentViewer
        docs={pendingDocs}
        index={pendingViewerIndex}
        onIndexChange={setPendingViewerIndex}
        onClose={() => setPendingViewerIndex(null)}
        onRemove={removePendingDoc}
      />

      <ConfirmDialog
        open={bulkAction !== null && bulkAction.next !== "rejected"}
        onClose={() => setBulkAction(null)}
        onConfirm={() =>
          bulkAction &&
          bulkTransitionMutation.mutate({
            rows: eligibleFor(bulkAction.next),
            next: bulkAction.next,
          })
        }
        title={bulkAction ? ticketWorkflowActionLabel(bulkAction.next) : ""}
        message={
          bulkAction
            ? `${eligibleFor(bulkAction.next).length} ${t("bulk.confirmTickets")}${
                selectedTicketRows.length > eligibleFor(bulkAction.next).length
                  ? ` ${selectedTicketRows.length - eligibleFor(bulkAction.next).length} ${t("bulk.skipped")}`
                  : ""
              }`
            : ""
        }
        confirmLabel={bulkAction?.label ?? ""}
        busy={bulkTransitionMutation.isPending}
      />

      <Dialog
        open={Boolean(rejectTarget) || bulkAction?.next === "rejected"}
        onClose={() => {
          setRejectTarget(null);
          setRejectReason("");
          if (bulkAction?.next === "rejected") setBulkAction(null);
        }}
        title="Reject ticket"
        description="Rejection needs a reason (approval-management practice). The reason is saved on the ticket notes."
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => {
                setRejectTarget(null);
                setRejectReason("");
                if (bulkAction?.next === "rejected") setBulkAction(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={
                rejectReason.trim().length < 3 ||
                transitionMutation.isPending ||
                bulkTransitionMutation.isPending
              }
              data-testid="confirm-reject-ticket"
              onClick={() => {
                const reason = rejectReason.trim();
                if (rejectTarget) {
                  transitionMutation.mutate({
                    ticket: rejectTarget,
                    next: "rejected",
                    reason,
                  });
                  return;
                }
                if (bulkAction?.next === "rejected") {
                  bulkTransitionMutation.mutate({
                    rows: eligibleFor("rejected"),
                    next: "rejected",
                    reason,
                  });
                }
              }}
            >
              <XCircle size={13} /> Reject
            </Button>
          </>
        }
      >
        <Field label="Rejection reason" hint="Required — at least 3 characters.">
          <Textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Why is this ticket rejected?"
            rows={3}
            data-testid="reject-reason"
          />
        </Field>
        {rejectTarget ? (
          <p className="mt-2 text-sm text-[var(--color-muted-foreground)]">
            {rejectTarget.employee_name || rejectTarget.employee_code} ·{" "}
            {rejectTarget.ticket_code || `#${rejectTarget.ticket_number ?? rejectTarget.id.slice(0, 8)}`}
          </p>
        ) : bulkAction?.next === "rejected" ? (
          <p className="mt-2 text-sm text-[var(--color-muted-foreground)]">
            {eligibleFor("rejected").length} selected ticket(s) will be rejected with this reason.
          </p>
        ) : null}
      </Dialog>

      <Dialog
        open={Boolean(editing)}
        onClose={() => {
          setEditing(null);
          setLoanConfirmOpen(false);
        }}
        size="wide"
        title={editing ? `Edit ticket #${editing.ticket_number ?? editing.id.slice(0, 8)}` : "Edit ticket"}
        description={
          editing
            ? `${editing.employee_name || editing.employee_code || "Employee"} · ${ticketWorkflowStatusLabel(editing.status)}${
                editing.loan_code ? ` · ${editing.loan_code}` : ""
              }`
            : undefined
        }
        footer={
          <>
            {editing ? (
              <Button
                variant="destructive"
                className="me-auto"
                data-testid="btn-edit-delete-ticket"
                disabled={updateMutation.isPending || deleteMutation.isPending}
                onClick={() => {
                  const ticket = editing;
                  setEditing(null);
                  setLoanConfirmOpen(false);
                  requestDelete(ticket);
                }}
              >
                <Trash2 size={14} /> Delete ticket
              </Button>
            ) : null}
            <Button
              variant="ghost"
              onClick={() => {
                setEditing(null);
                setLoanConfirmOpen(false);
              }}
            >
              Cancel
            </Button>
            {editing ? (
              <Button
                variant="outline"
                data-testid="btn-edit-print-ticket"
                disabled={printBusy}
                onClick={() => void printTicketPdf(editing)}
              >
                {printBusy ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />}
                Print
              </Button>
            ) : null}
            <Button
              variant="outline"
              data-testid="btn-edit-save-only"
              disabled={updateMutation.isPending}
              onClick={() => requestSaveEdit({ notifyWhatsapp: false })}
            >
              {updateMutation.isPending ? t("state.saving") : "Save"}
            </Button>
            <Button
              variant="gradient"
              data-testid="btn-edit-save-changes"
              disabled={updateMutation.isPending}
              onClick={() => requestSaveEdit()}
            >
              {updateMutation.isPending
                ? t("state.saving")
                : editForm.notify_whatsapp
                  ? "Save & WhatsApp"
                  : "Save changes"}
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
          <Field label="Leave start date" hint="Round trip only — clear both for one way">
            <Input
              type="date"
              value={editForm.leave_start_date}
              data-testid="input-edit-leave-start-date"
              onChange={(e) => setEditForm((f) => ({ ...f, leave_start_date: e.target.value }))}
            />
          </Field>
          <Field label="Leave end date" hint="Return date from leave">
            <Input
              type="date"
              value={editForm.leave_end_date}
              min={editForm.leave_start_date || undefined}
              data-testid="input-edit-leave-end-date"
              onChange={(e) => setEditForm((f) => ({ ...f, leave_end_date: e.target.value }))}
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
            <LoanTermsInput
              excess={editTicketGap}
              value={{ months: editForm.tenure_months, emi: editForm.emi_amount }}
              onChange={(v) => setEditForm((f) => ({ ...f, tenure_months: v.months, emi_amount: v.emi }))}
              testId="loan-terms-edit"
            />
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
            className="sm:col-span-2 space-y-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-muted)] p-3"
            data-testid="panel-edit-attachments"
          >
            <p className="flex items-center gap-2 text-sm font-semibold">
              <Paperclip size={15} className="text-[var(--color-primary)]" />
              Attachments
              <Badge variant={editAttachments.isError ? "destructive" : "secondary"}>
                {editAttachments.isLoading
                  ? "…"
                  : editAttachments.isError
                    ? "load failed"
                    : `${editAttachments.data?.length ?? 0} on file`}
              </Badge>
            </p>
            <p className="text-[11px] text-[var(--color-muted-foreground)]">
              Upload ticket copy and leave settlement. Re-upload replaces the previous file of the
              same type (kept for audit). WhatsApp uses the latest of each. Wrong file? Remove it
              (A4 slip stays protected).
            </p>
            {editAttachments.isError ? (
              <p className="text-xs text-[var(--color-destructive)]" data-testid="text-attachments-error">
                Could not load attachments. {errorMessage(editAttachments.error)}{" "}
                <button
                  type="button"
                  className="underline"
                  onClick={() => void editAttachments.refetch()}
                >
                  Retry
                </button>
              </p>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="1. Ticket document (PDF/JPG)">
                <Input
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/*"
                  data-testid="input-attach-ticket-receipt"
                  onChange={async (e) => {
                    const file = acceptPickedFile(e.target);
                    if (!file || !editing) return;
                    const fd = new FormData();
                    fd.append("file", file);
                    try {
                      await api(
                        `/attachments?entity_type=ticket_receipt&entity_id=${editing.id}`,
                        { method: "POST", body: fd }
                      );
                      toast.success("Attachment saved", "Ticket document stored in MSSQL.");
                      await queryClient.invalidateQueries({
                        queryKey: ["attachments", editing.id],
                      });
                    } catch (err) {
                      toast.error("Upload failed", errorMessage(err));
                    } finally {
                      e.target.value = "";
                    }
                  }}
                />
              </Field>
              <Field label="2. Leave settlement (PDF/JPG)">
                <Input
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/*"
                  data-testid="input-attach-leave-settlement"
                  onChange={async (e) => {
                    const file = acceptPickedFile(e.target);
                    if (!file || !editing) return;
                    try {
                      const fd = new FormData();
                      fd.append("file", file);
                      await api(
                        `/attachments?entity_type=leave_settlement&entity_id=${editing.id}`,
                        { method: "POST", body: fd }
                      );
                      toast.success("Attachment saved", "Leave settlement stored in MSSQL.");
                      await queryClient.invalidateQueries({
                        queryKey: ["attachments", editing.id],
                      });
                    } catch (err) {
                      toast.error("Upload failed", errorMessage(err));
                    } finally {
                      e.target.value = "";
                    }
                  }}
                />
              </Field>
            </div>
            {(editAttachments.data?.length ?? 0) > 0 ? (
              <ul className="space-y-1.5 text-xs" data-testid="list-edit-attachments">
                {editAttachments.data!.map((a, idx) => {
                  const latestOfType =
                    REMOVABLE_UPLOAD_TYPES.has(a.entity_type) &&
                    editAttachments.data!.findIndex((x) => x.entity_type === a.entity_type) === idx;
                  return (
                  <li
                    key={a.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-white px-2 py-1.5"
                    dir="ltr"
                  >
                    <button
                      type="button"
                      className="min-w-0 flex-1 truncate text-left hover:underline"
                      title={t("alloc.docs.view")}
                      onClick={() => openTicketDocs(editing!, a.id)}
                    >
                      <span className="font-semibold">{attachmentLabel(a.entity_type)}</span>
                      {": "}
                      {a.original_name} ({formatBytes(a.size_bytes)})
                      {a.stored_in_mssql ? " · MSSQL" : " · disk"}
                      {latestOfType ? (
                        <Badge variant="success" className="ms-1 align-middle">
                          In pack
                        </Badge>
                      ) : REMOVABLE_UPLOAD_TYPES.has(a.entity_type) ? (
                        <Badge variant="outline" className="ms-1 align-middle">
                          Replaced
                        </Badge>
                      ) : null}
                    </button>
                    <span className="flex shrink-0 items-center gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        data-testid={`btn-view-attachment-${a.id}`}
                        onClick={() => openTicketDocs(editing!, a.id)}
                      >
                        <Eye size={13} /> {t("alloc.docs.view")}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        data-testid={`btn-download-attachment-${a.id}`}
                        onClick={() =>
                          void download(`/attachments/${a.id}/content`, a.original_name).catch((err) =>
                            toast.error("Download failed", errorMessage(err))
                          )
                        }
                      >
                        Download
                      </Button>
                      {canDeleteAttachments && REMOVABLE_UPLOAD_TYPES.has(a.entity_type) ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-[var(--color-destructive)]"
                          data-testid={`btn-delete-attachment-${a.id}`}
                          disabled={deletingAttachment}
                          onClick={() => setAttachmentPendingDelete(a)}
                        >
                          <Trash2 size={13} /> {t("viewer.remove")}
                        </Button>
                      ) : null}
                    </span>
                  </li>
                  );
                })}
              </ul>
            ) : !editAttachments.isLoading && !editAttachments.isError ? (
              <p className="text-[11px] text-[var(--color-muted-foreground)]">
                No Ticket / Leave settlement documents yet — choose files above to upload.
              </p>
            ) : null}
          </div>
          <div
            className="sm:col-span-2 space-y-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-muted)] p-3"
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
                  Opt-in only. Use Save for quiet update; check this for update notice + A4 PDF via
                  Evolution.
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

                <div className="space-y-2" data-testid="panel-edit-wa-roster">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-xs font-semibold text-[var(--color-foreground)]">
                      Who gets the WhatsApp pack
                    </p>
                    <Link
                      href="/settings/#whatsapp-distribution-settings"
                      className="text-[11px] font-medium text-[var(--color-primary)] underline-offset-2 hover:underline"
                      data-testid="link-wa-settings-from-edit"
                    >
                      Edit lists in Settings
                    </Link>
                  </div>
                  <p className="text-[11px] text-[var(--color-muted-foreground)]">
                    Employee + Reporting manager = Employee Master. HR / MD = Settings. Typed numbers
                    are one-off extras only.
                  </p>
                  <div
                    className="grid gap-2"
                    role="list"
                    aria-label="Edit WhatsApp recipients by role"
                    data-testid="edit-wa-role-roster"
                  >
                    {(
                      [
                        {
                          id: "employee",
                          role: "Employee (traveller)",
                          source: "Employee Master",
                          numbers: includeEmployeeWa
                            ? parseWhatsAppNumbers(String(editEmployee?.whatsapp_mobile ?? ""))
                            : [],
                          empty: !editEmployee
                            ? "—"
                            : !String(editEmployee.whatsapp_mobile || "").trim()
                              ? "No WhatsApp on this employee’s master record"
                              : !includeEmployeeWa
                                ? "Pickup off — turn on at Allocation → WhatsApp desk"
                                : "",
                          testId: "edit-wa-role-employee",
                        },
                        {
                          id: "manager",
                          role: "Reporting manager",
                          source: "Employee Master → Reporting to",
                          numbers: parseWhatsAppNumbers(
                            String(editReportingOfficer?.whatsapp_mobile ?? "")
                          ),
                          empty: !editEmployee
                            ? "—"
                            : !editEmployee.reporting_officer_id
                              ? "Set Reporting to on Employee Master"
                              : !String(editReportingOfficer?.whatsapp_mobile || "").trim()
                                ? "Reporting manager has no WhatsApp on Employee Master"
                                : "",
                          testId: "edit-wa-role-manager",
                          note: editReportingOfficer
                            ? `${editReportingOfficer.code} — ${editReportingOfficer.full_name}`
                            : undefined,
                        },
                        {
                          id: "hr",
                          role: "HR",
                          source: "Settings → HR list",
                          numbers: settingsWaLists.hr,
                          empty: settingsWaLists.hr.length
                            ? ""
                            : "Add numbers in Settings → WhatsApp (HR)",
                          testId: "edit-wa-role-hr",
                        },
                        {
                          id: "md",
                          role: "MD",
                          source: "Settings → MD list",
                          numbers: settingsWaLists.md,
                          empty: settingsWaLists.md.length
                            ? ""
                            : "Add numbers in Settings → WhatsApp (MD)",
                          testId: "edit-wa-role-md",
                        },
                      ] as const
                    ).map((row) => (
                      <div
                        key={row.id}
                        role="listitem"
                        data-testid={row.testId}
                        className="flex flex-wrap items-start justify-between gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-[var(--color-foreground)]">
                            {row.role}
                          </p>
                          <p className="text-[10px] text-[var(--color-muted-foreground)]">
                            {row.source}
                            {"note" in row && row.note ? ` · ${row.note}` : ""}
                          </p>
                        </div>
                        <div className="min-w-0 text-end" dir="ltr">
                          {row.numbers.length > 0 ? (
                            <p
                              className="font-mono text-xs font-semibold"
                              data-testid={`${row.testId}-numbers`}
                            >
                              {formatWhatsAppDisplayList(row.numbers)}
                            </p>
                          ) : (
                            <p
                              className="text-[11px] text-[var(--color-muted-foreground)]"
                              data-testid={`${row.testId}-empty`}
                            >
                              {row.empty || "—"}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  <Field label="One-off extras (optional)">
                    <Textarea
                      value={editForm.manager_whatsapp}
                      data-testid="input-edit-manager-whatsapp"
                      placeholder={"Optional extras\n(one per line or comma-separated)"}
                      dir="ltr"
                      rows={2}
                      className="font-mono text-sm"
                      onChange={(e) =>
                        setEditForm((f) => ({ ...f, manager_whatsapp: e.target.value }))
                      }
                    />
                  </Field>

                  {editCanNotifyWhatsapp ? (
                    <p
                      className="rounded-[var(--radius-sm)] bg-[var(--color-secondary)] px-2 py-1.5 text-[11px] font-medium"
                      dir="ltr"
                      data-testid="edit-wa-fanout-summary"
                    >
                      Will message {formatWhatsAppDisplayList(editPlannedFanout)}
                      {editPlannedFanout.length >= WhatsAppClickToChatLimits.MAX_RECIPIENTS
                        ? ` (capped at ${WhatsAppClickToChatLimits.MAX_RECIPIENTS})`
                        : ""}
                      . One merged PDF pack.
                    </p>
                  ) : (
                    <p className="text-[11px] text-[var(--color-destructive)]" data-testid="edit-wa-fanout-empty">
                      No recipients — set Employee Master WhatsApp and/or Settings manager/HR/MD lists.
                    </p>
                  )}
                </div>
              </>
            ) : null}
          </div>
        </div>
      </Dialog>

      <Dialog
        open={loanConfirmOpen}
        onClose={() => setLoanConfirmOpen(false)}
        title="Confirm recovery loan"
        description="Review the recovery terms before saving this allocation as a payroll recovery loan."
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
              {updateMutation.isPending ? t("state.saving") : "Confirm & save"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-secondary)] p-3 text-sm">
            <div>
              <p className="text-[10px] font-bold uppercase text-[var(--color-muted-foreground)]">Loan</p>
              <p className="text-lg font-extrabold text-[var(--color-destructive)]">{money(editTicketGap)}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase text-[var(--color-muted-foreground)]">Est. EMI</p>
              <p className="text-lg font-extrabold">{emiPreview != null ? money(emiPreview.emi) : "—"}</p>
            </div>
            {emiPreview != null && emiPreview.months > 1 && emiPreview.last !== emiPreview.emi ? (
              <div className="col-span-2">
                <p className="text-[10px] font-bold uppercase text-[var(--color-muted-foreground)]">
                  {t("loanTerms.lastInstallment")}
                </p>
                <p className="text-sm font-bold" data-testid="loan-confirm-last">
                  {money(emiPreview.last)} · {emiPreview.months} months
                </p>
              </div>
            ) : null}
          </div>
          <LoanTermsInput
            excess={editTicketGap}
            value={confirmTerms}
            onChange={setConfirmTerms}
            plan={emiPreview ?? undefined}
            autoFocus
            testId="loan-terms-confirm"
          />
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
          <div className="overflow-auto bg-[var(--color-muted)] p-4" data-testid="allocation-print-preview">
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
            This airfare allocation has a linked recovery loan. Choose whether to keep or delete
            the loan before continuing.
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

      <ConfirmDialog
        open={Boolean(attachmentPendingDelete)}
        onClose={() => !deletingAttachment && setAttachmentPendingDelete(null)}
        onConfirm={() => {
          if (attachmentPendingDelete) void deleteUploadedAttachment(attachmentPendingDelete);
        }}
        title={t("alloc.docs.deleteTitle")}
        message={
          attachmentPendingDelete
            ? t("alloc.docs.deleteConfirm")
                .replace("{kind}", attachmentLabel(attachmentPendingDelete.entity_type))
                .replace("{name}", attachmentPendingDelete.original_name)
            : ""
        }
        confirmLabel={t("viewer.remove")}
        destructive
        busy={deletingAttachment}
      />
    </div>
  );
}

function AllocationPageRoute() {
  return (
    <Suspense fallback={<CardGridSkeleton />}>
      <AllocationPage />
    </Suspense>
  );
}

export default AllocationPageRoute;
