"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BadgeCheck,
  CalendarClock,
  CircleDollarSign,
  HandCoins,
  ListOrdered,
  Pencil,
  Play,
  Plus,
  Receipt,
  RotateCcw,
  Trash2,
  Wallet,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { EmployeeCombobox } from "@/components/employee-combobox";
import { LoanPlanText, LoanTermsInput, formatLoanPlan } from "@/components/loan-terms-input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { OverflowMenu, type OverflowMenuItem } from "@/components/ui/overflow-menu";
import { EmptyState, ErrorState, PageHeader, SearchInput, StatCard } from "@/components/ui/primitives";
import { TableSkeleton } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { api, ApiError, errorMessage } from "@/lib/api";
import { hasRole, useAuth } from "@/lib/auth";
import { invalidateDashboardData } from "@/lib/dashboard-insights";
import { fmtDate, money, statusTone, titleCase, todayLocal } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { emiAmountFor, type LoanPlan } from "@/lib/loan-terms";
import { cn } from "@/lib/utils";
import { ExcelToolbar } from "@/components/excel-toolbar";
import type {
  Employee,
  Loan,
  LoanInstallment,
  LoanInstallmentStatus,
  LoanPayment,
  LoanPaymentEvent,
} from "@/lib/types";

const INSTALLMENT_TONE: Record<LoanInstallmentStatus, "success" | "warning" | "destructive" | "outline"> = {
  paid: "success",
  partial: "warning",
  overdue: "destructive",
  due: "outline",
};

type ConfirmKind = "create" | "edit" | "pay" | "defer" | "settle" | "return" | "delete" | "emi-run" | null;

interface LoanPreview {
  monthly_installment: string | number;
  installments: number;
  last_installment: string | number;
  repayment_basis: "emi" | "tenure";
}

const toLoanPlan = (data: LoanPreview): LoanPlan => ({
  basis: data.repayment_basis,
  months: data.installments,
  emi: Number(data.monthly_installment),
  last: Number(data.last_installment),
});

type Translate = ReturnType<typeof useT>;

/** Fill `{placeholder}` tokens in a translated template (function replacer keeps "$" in values safe). */
const fill = (template: string, vars: Record<string, string>) =>
  Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, () => v), template);

/** Localized loan-book status label, falling back to title case for unknown values. */
const loanStatusLabel = (t: Translate, status: string) =>
  status === "active" || status === "deferred" || status === "settled"
    ? t(`loans.kpi.${status}`)
    : titleCase(status);

function describeChange(event: LoanPaymentEvent): string {
  const parts: string[] = [];
  const pair = (value: LoanPaymentEvent["amount"]) =>
    value && typeof value === "object" && value.old !== value.new ? value : null;
  const amount = pair(event.amount);
  if (amount) parts.push(`${money(amount.old)} → ${money(amount.new)}`);
  const paidOn = pair(event.paid_on);
  if (paidOn) parts.push(`${fmtDate(paidOn.old)} → ${fmtDate(paidOn.new)}`);
  const reference = pair(event.reference);
  if (reference) parts.push(`${reference.old || "—"} → ${reference.new || "—"}`);
  return parts.join(" · ");
}

function PaymentLedger({
  payments,
  isPending,
  error,
  onRetry,
  canFix,
  onEdit,
  onDelete,
  t,
}: {
  payments: LoanPayment[];
  isPending: boolean;
  error: unknown;
  onRetry: () => void;
  canFix: boolean;
  onEdit: (p: LoanPayment) => void;
  onDelete: (p: LoanPayment) => void;
  t: Translate;
}) {
  if (isPending) return <TableSkeleton />;
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (payments.length === 0) {
    return <p className="text-sm text-[var(--color-muted-foreground)]">{t("loans.history.empty")}</p>;
  }
  const lockedTitle = canFix ? undefined : t("loans.emi.noPermission");
  return (
    <>
      <Table>
        <THead>
          <TR>
            <TH>{t("loans.history.date")}</TH>
            <TH className="desk-num">{t("loans.history.amount")}</TH>
            <TH>{t("loans.history.reference")}</TH>
            <TH className="text-end">{t("loans.emi.actions")}</TH>
          </TR>
        </THead>
        <TBody>
          {payments.map((p) => {
            const events = p.history ?? [];
            const reversal = events.find((e) => e.action === "reversed");
            const edits = events.filter((e) => e.action === "edited");
            const lastEdit = edits[edits.length - 1];
            return (
              <TR
                key={p.id}
                data-testid={`loan-payment-row-${p.id}`}
                className={p.reversed ? "bg-[var(--color-muted)]" : undefined}
              >
                <TD className="align-top">
                  <span className={cn(p.reversed && "line-through text-[var(--color-muted-foreground)]")}>
                    {fmtDate(p.paid_on)}
                  </span>
                </TD>
                <TD className="desk-num align-top">
                  <span
                    className={cn(
                      "font-semibold",
                      p.reversed && "line-through font-normal text-[var(--color-muted-foreground)]"
                    )}
                  >
                    {money(p.amount)}
                  </span>
                  {p.reversed ? (
                    <Badge variant="destructive" className="ml-2">
                      {t("loans.emi.reversedBadge")}
                    </Badge>
                  ) : lastEdit ? (
                    <Badge variant="warning" className="ml-2">
                      {t("loans.emi.editedBadge")}
                      {edits.length > 1 ? ` ×${edits.length}` : ""}
                    </Badge>
                  ) : null}
                  {reversal ? (
                    <p className="mt-1 text-[11px] text-[var(--color-muted-foreground)]">
                      {fmtDate(reversal.at)} · {reversal.by} · {reversal.reason}
                    </p>
                  ) : lastEdit ? (
                    <p className="mt-1 text-[11px] text-[var(--color-muted-foreground)]">
                      {[describeChange(lastEdit), `${fmtDate(lastEdit.at)} · ${lastEdit.by}`, lastEdit.reason]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  ) : null}
                </TD>
                <TD className="align-top font-mono text-xs">{p.reference || "—"}</TD>
                <TD className="align-top text-end">
                  {p.reversed ? (
                    <span className="text-xs text-[var(--color-muted-foreground)]">—</span>
                  ) : (
                    <div className="inline-flex flex-nowrap gap-1.5" role="group" aria-label={t("loans.emi.actions")}>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!canFix}
                        title={lockedTitle}
                        aria-label={`${t("loans.emi.edit")} ${fmtDate(p.paid_on)}`}
                        data-testid={`btn-edit-payment-${p.id}`}
                        onClick={() => onEdit(p)}
                      >
                        <Pencil size={13} aria-hidden /> {t("loans.emi.edit")}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={!canFix}
                        title={lockedTitle}
                        className="text-[var(--color-destructive)]"
                        data-testid={`btn-delete-payment-${p.id}`}
                        aria-label={`${t("loans.emi.delete")} ${fmtDate(p.paid_on)}`}
                        onClick={() => onDelete(p)}
                      >
                        <Trash2 size={13} aria-hidden /> {t("loans.emi.delete")}
                      </Button>
                    </div>
                  )}
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
      <p className="mt-2 text-[11px] text-[var(--color-muted-foreground)]">
        {canFix ? t("loans.emi.note") : t("loans.emi.noPermission")}
      </p>
    </>
  );
}

function LoansPage() {
  const t = useT();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  // ?q=<text> — prefilled search (command palette).
  const searchParams = useSearchParams();
  const deepQuery = searchParams.get("q");
  const deepLoanId = searchParams.get("loan");
  useEffect(() => {
    if (deepQuery != null) setSearch(deepQuery);
  }, [deepQuery]);
  const [showCreate, setShowCreate] = useState(false);
  const [scheduleFor, setScheduleFor] = useState<Loan | null>(null);
  const [ledgerFor, setLedgerFor] = useState<Loan | null>(null);
  const [paymentFor, setPaymentFor] = useState<Loan | null>(null);
  const [deferFor, setDeferFor] = useState<Loan | null>(null);
  const [settleFor, setSettleFor] = useState<Loan | null>(null);
  const [editing, setEditing] = useState<Loan | null>(null);
  const [returnFor, setReturnFor] = useState<Loan | null>(null);
  const [deleting, setDeleting] = useState<Loan | null>(null);
  const [confirmKind, setConfirmKind] = useState<ConfirmKind>(null);

  const [form, setForm] = useState({
    employee_id: "",
    principal: "",
    annual_rate: "0",
    installments: "12",
    emi: null as string | null,
    first_due_date: todayLocal(),
  });
  const [editForm, setEditForm] = useState({
    annual_rate: "0",
    installments: "12",
    emi: null as string | null,
    first_due_date: todayLocal(),
  });
  const createEmi = emiAmountFor({ months: form.installments, emi: form.emi });
  const editEmi = emiAmountFor({ months: editForm.installments, emi: editForm.emi });
  const [payment, setPayment] = useState({ amount: "", paid_on: todayLocal() });
  const [deferDate, setDeferDate] = useState("");
  const [settlePaidOn, setSettlePaidOn] = useState(todayLocal());
  const [settleRef, setSettleRef] = useState("");
  const me = useAuth((s) => s.me);
  const canFixPayments = hasRole(me, "admin", "system_admin", "finance", "finance_manager");
  const [paymentEdit, setPaymentEdit] = useState<LoanPayment | null>(null);
  const [paymentDelete, setPaymentDelete] = useState<LoanPayment | null>(null);
  const [paymentForm, setPaymentForm] = useState({ amount: "", paid_on: "", reference: "", reason: "" });
  const [deleteReason, setDeleteReason] = useState("");

  // Always load the full book — status filter is client-side so portfolio KPIs stay true.
  const loans = useQuery({
    queryKey: ["loans"],
    queryFn: () => api<Loan[]>("/loans?limit=500"),
  });
  const employees = useQuery({
    queryKey: ["employees", "all"],
    queryFn: () => api<Employee[]>("/employees?limit=500"),
  });
  const schedule = useQuery({
    queryKey: ["loan-schedule", scheduleFor?.id],
    queryFn: () => api<LoanInstallment[]>(`/loans/${scheduleFor!.id}/schedule`),
    enabled: Boolean(scheduleFor),
  });
  const paymentsLoanId = ledgerFor?.id ?? scheduleFor?.id;
  const payments = useQuery({
    queryKey: ["loan-payments", paymentsLoanId],
    queryFn: () => api<LoanPayment[]>(`/loans/${paymentsLoanId}/payments?include_reversed=true`),
    enabled: Boolean(paymentsLoanId),
  });
  const emiPreview = useQuery({
    queryKey: ["emi-preview", form.principal, form.annual_rate, form.installments, createEmi ?? null],
    queryFn: () =>
      api<LoanPreview>("/loans/preview", {
        method: "POST",
        body: {
          principal: Number(form.principal),
          annual_rate: Number(form.annual_rate),
          ...(createEmi != null ? { emi_amount: createEmi } : { installments: Number(form.installments) }),
        },
      }).then(toLoanPlan),
    enabled:
      showCreate &&
      Number(form.principal) > 0 &&
      (form.emi != null ? createEmi != null : Number(form.installments) > 0),
    retry: false,
  });
  const editEmiPreview = useQuery({
    queryKey: [
      "edit-emi-preview",
      editing?.id,
      editing?.outstanding,
      editForm.annual_rate,
      editForm.installments,
      editEmi ?? null,
    ],
    queryFn: () =>
      api<LoanPreview>("/loans/preview", {
        method: "POST",
        body: {
          principal: Number(editing!.outstanding),
          annual_rate: Number(editForm.annual_rate),
          ...(editEmi != null ? { emi_amount: editEmi } : { installments: Number(editForm.installments) }),
        },
      }).then(toLoanPlan),
    enabled:
      Boolean(editing) &&
      Number(editing?.outstanding) > 0 &&
      (editForm.emi != null ? editEmi != null : Number(editForm.installments) > 0),
    retry: false,
  });

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (loans.data ?? []).filter((l) => {
      if (statusFilter && l.status !== statusFilter) return false;
      if (!term) return true;
      return [
        l.employee_name,
        l.employee_code,
        l.loan_number,
        l.loan_number != null ? `L-${String(l.loan_number).padStart(6, "0")}` : null,
      ]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(term));
    });
  }, [loans.data, search, statusFilter]);

  const stats = useMemo(() => {
    const all = loans.data ?? [];
    return {
      active: all.filter((l) => l.status === "active").length,
      deferred: all.filter((l) => l.status === "deferred").length,
      settled: all.filter((l) => l.status === "settled").length,
      outstanding: all.reduce((sum, l) => sum + Number(l.outstanding), 0),
      recovered: all.reduce((sum, l) => sum + Number(l.paid_amount ?? 0), 0),
    };
  }, [loans.data]);

  const scheduleSummary = useMemo(() => {
    if (!scheduleFor) return null;
    const loan = (loans.data ?? []).find((l) => l.id === scheduleFor.id) ?? scheduleFor;
    const rows = schedule.data ?? [];
    const next = rows.find((row) => Number(row.balance_due ?? 0) > 0) ?? null;
    return {
      principal: Number(loan.principal),
      paid: Number(loan.paid_amount ?? 0),
      outstanding: Number(loan.outstanding),
      next,
    };
  }, [scheduleFor, loans.data, schedule.data]);

  const activeEmployeeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const l of loans.data ?? []) {
      if (l.status === "active" || l.status === "deferred") ids.add(l.employee_id);
    }
    return [...ids];
  }, [loans.data]);

  const employeeLabel = (employeeId: string) => {
    const emp = (employees.data ?? []).find((e) => e.id === employeeId);
    return emp ? `${emp.code} — ${emp.full_name}` : t("loans.unknownEmployee");
  };

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["loans"] });
    queryClient.invalidateQueries({ queryKey: ["loan-schedule"] });
    queryClient.invalidateQueries({ queryKey: ["loan-payments"] });
    invalidateDashboardData(queryClient);
  };

  const loanOpened = useRef("");
  useEffect(() => {
    if (!deepLoanId || !loans.data || loanOpened.current === deepLoanId) return;
    loanOpened.current = deepLoanId;
    const loan = loans.data.find((row) => row.id === deepLoanId);
    if (loan) openEdit(loan);
    else toast.warning(t("loans.toast.notFoundTitle"), t("loans.toast.notFoundBody"));
  }, [deepLoanId, loans.data, t]);

  const openEdit = (loan: Loan) => {
    setEditing(loan);
    setEditForm({
      annual_rate: String(loan.annual_rate ?? "0"),
      installments: String(loan.remaining_installments || loan.installments || 12),
      emi: loan.repayment_basis === "emi" ? String(Number(loan.monthly_installment)) : null,
      first_due_date: String(loan.next_due_date || loan.first_due_date || todayLocal()).slice(0, 10),
    });
  };

  const createMutation = useMutation({
    mutationFn: () =>
      api("/loans", {
        method: "POST",
        body: {
          employee_id: form.employee_id,
          principal: Number(form.principal),
          annual_rate: Number(form.annual_rate),
          ...(createEmi != null ? { emi_amount: createEmi } : { installments: Number(form.installments) }),
          first_due_date: form.first_due_date,
        },
      }),
    onSuccess: () => {
      toast.success(t("loans.toast.created"));
      setConfirmKind(null);
      setShowCreate(false);
      invalidate();
    },
    onError: (err) => toast.error(t("loans.toast.createFailed"), errorMessage(err)),
  });

  const editMutation = useMutation({
    mutationFn: () =>
      api(`/loans/${editing!.id}/restructure`, {
        method: "POST",
        headers: { "If-Match": String(editing!.version) },
        body: {
          annual_rate: Number(editForm.annual_rate),
          ...(editEmi != null ? { emi_amount: editEmi } : { installments: Number(editForm.installments) }),
          first_due_date: editForm.first_due_date,
        },
      }),
    onSuccess: () => {
      toast.success(t("loans.toast.updated"), t("loans.toast.updatedBody"));
      setConfirmKind(null);
      setEditing(null);
      invalidate();
    },
    onError: (err) => toast.error(t("loans.toast.editFailed"), errorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: (loan: Loan) =>
      api(`/loans/${loan.id}`, {
        method: "DELETE",
        headers: { "If-Match": String(loan.version) },
      }),
    onSuccess: () => {
      toast.success(t("loans.toast.deleted"));
      setConfirmKind(null);
      setDeleting(null);
      invalidate();
    },
    onError: (err) => toast.error(t("loans.emi.deleteFailed"), errorMessage(err)),
  });

  const paymentMutation = useMutation({
    mutationFn: () =>
      api(`/loans/${paymentFor!.id}/payments`, {
        method: "POST",
        body: { amount: Number(payment.amount), paid_on: payment.paid_on },
      }),
    onSuccess: () => {
      toast.success(t("loans.toast.paymentPosted"));
      setConfirmKind(null);
      setPaymentFor(null);
      invalidate();
    },
    onError: (err) => toast.error(t("loans.toast.paymentFailed"), errorMessage(err)),
  });

  const paymentsOwner = ledgerFor ?? scheduleFor;
  const scheduleLoan = paymentsOwner
    ? ((loans.data ?? []).find((l) => l.id === paymentsOwner.id) ?? paymentsOwner)
    : null;
  const paymentChangeFailed = (title: string) => (err: unknown) => {
    if (err instanceof ApiError && err.status === 409) {
      toast.error(title, t("loans.emi.stale"));
      invalidate();
      return;
    }
    toast.error(title, errorMessage(err));
  };
  const openPaymentEdit = (p: LoanPayment) => {
    setPaymentEdit(p);
    setPaymentForm({
      amount: String(Number(p.amount)),
      paid_on: String(p.paid_on).slice(0, 10),
      reference: p.reference ?? "",
      reason: "",
    });
  };
  const editImpact = useMemo(() => {
    if (!paymentEdit || !scheduleLoan) return null;
    const before = Number(scheduleLoan.outstanding);
    const most = before + Number(paymentEdit.amount);
    const amount = Number(paymentForm.amount);
    const after = most - (Number.isFinite(amount) ? amount : 0);
    let error: string | null = null;
    if (!(amount > 0)) error = t("loans.emi.amountRequired");
    else if (after < -0.0001) error = t("loans.emi.tooMuch").replace("{max}", money(most));
    else if (
      paymentForm.paid_on > todayLocal() &&
      paymentForm.paid_on !== String(paymentEdit.paid_on).slice(0, 10)
    )
      error = t("loans.emi.future");
    else if (paymentForm.reason.trim().length < 3) error = t("loans.emi.reasonRequired");
    return { before, after: Math.max(0, after), error };
  }, [paymentEdit, scheduleLoan, paymentForm, t]);

  const editPaymentMutation = useMutation({
    mutationFn: () =>
      api(`/loans/${paymentsLoanId}/payments/${paymentEdit!.id}`, {
        method: "PUT",
        body: {
          amount: Number(paymentForm.amount),
          paid_on: paymentForm.paid_on,
          reference: paymentForm.reference.trim(),
          reason: paymentForm.reason.trim(),
          version: paymentEdit!.version ?? 1,
        },
      }),
    onSuccess: () => {
      toast.success(t("loans.emi.edited"));
      setPaymentEdit(null);
      invalidate();
    },
    onError: paymentChangeFailed(t("loans.emi.editFailed")),
  });

  const deletePaymentMutation = useMutation({
    mutationFn: () =>
      api(`/loans/${paymentsLoanId}/payments/${paymentDelete!.id}`, {
        method: "DELETE",
        body: { reason: deleteReason.trim(), version: paymentDelete!.version ?? 1 },
      }),
    onSuccess: () => {
      toast.success(t("loans.emi.deleted"));
      setPaymentDelete(null);
      setDeleteReason("");
      invalidate();
    },
    onError: paymentChangeFailed(t("loans.emi.deleteFailed")),
  });

  const deferMutation = useMutation({
    mutationFn: () =>
      api(`/loans/${deferFor!.id}/defer`, {
        method: "POST",
        body: { deferred_until: deferDate },
        headers: { "If-Match": String(deferFor!.version) },
      }),
    onSuccess: () => {
      toast.success(t("loans.toast.deferred"));
      setConfirmKind(null);
      setDeferFor(null);
      invalidate();
    },
    onError: (err) => toast.error(t("loans.toast.deferFailed"), errorMessage(err)),
  });

  const returnMutation = useMutation({
    mutationFn: () =>
      api(`/loans/${returnFor!.id}/return`, {
        method: "POST",
        headers: { "If-Match": String(returnFor!.version) },
      }),
    onSuccess: (data) => {
      const reversed = Number((data as { reversed_payments?: number })?.reversed_payments ?? 0);
      toast.success(
        t("loans.toast.returned"),
        reversed > 0
          ? fill(t("loans.toast.returnedReversed"), { count: String(reversed) })
          : t("loans.toast.returnedActive")
      );
      setConfirmKind(null);
      setReturnFor(null);
      invalidate();
    },
    onError: (err) => toast.error(t("loans.toast.returnFailed"), errorMessage(err)),
  });

  const settleMutation = useMutation({
    mutationFn: () =>
      api<{ settled: number }>("/loans/bulk-settle", {
        method: "POST",
        body: {
          items: [
            {
              loan_id: settleFor!.id,
              amount: Number(settleFor!.outstanding),
              paid_on: settlePaidOn,
              reference: settleRef || `SETTLE-${settleFor!.loan_number ?? settleFor!.id.slice(0, 8)}`,
            },
          ],
        },
      }),
    onSuccess: (result) => {
      toast.success(
        t("loans.toast.settled"),
        fill(t("loans.toast.settledBody"), { count: String(result.settled) })
      );
      setConfirmKind(null);
      setSettleFor(null);
      invalidate();
    },
    onError: (err) => toast.error(t("loans.toast.settleFailed"), errorMessage(err)),
  });

  const monthlyRunMutation = useMutation({
    mutationFn: async () => {
      const results: Array<{ employee_id: string; loans: number }> = [];
      for (const employee_id of activeEmployeeIds) {
        const res = await api<{ loans: unknown[] }>("/loans/run-emi", {
          method: "POST",
          body: { employee_id },
        });
        results.push({ employee_id, loans: res.loans?.length ?? 0 });
      }
      return results;
    },
    onSuccess: (results) => {
      const refreshed = results.reduce((n, r) => n + r.loans, 0);
      toast.success(
        t("loans.toast.emiRunDone"),
        fill(t("loans.toast.emiRunBody"), {
          loans: String(refreshed),
          employees: String(results.length),
        })
      );
      setConfirmKind(null);
      invalidate();
    },
    onError: (err) => toast.error(t("loans.toast.emiRunFailed"), errorMessage(err)),
  });

  const paymentLedger = (
    <PaymentLedger
      payments={payments.data ?? []}
      isPending={payments.isPending}
      error={payments.isError ? payments.error : null}
      onRetry={() => void payments.refetch()}
      canFix={canFixPayments}
      onEdit={openPaymentEdit}
      onDelete={(p) => {
        setDeleteReason("");
        setPaymentDelete(p);
      }}
      t={t}
    />
  );

  const confirmBusy =
    createMutation.isPending ||
    editMutation.isPending ||
    paymentMutation.isPending ||
    deferMutation.isPending ||
    returnMutation.isPending ||
    settleMutation.isPending ||
    deleteMutation.isPending ||
    monthlyRunMutation.isPending;

  const confirmCopy = (): { title: string; message: string; label: string; destructive?: boolean } => {
    switch (confirmKind) {
      case "create":
        return {
          title: t("loans.confirm.create.title"),
          message: fill(t("loans.confirm.create.message"), {
            employee: employeeLabel(form.employee_id),
            principal: money(form.principal),
            rate: form.annual_rate,
            plan: emiPreview.data
              ? formatLoanPlan(t, emiPreview.data)
              : fill(t("loans.emiMonths"), { count: form.installments }),
          }),
          label: t("loans.confirm.create.label"),
        };
      case "edit":
        return {
          title: t("loans.confirm.edit.title"),
          message: fill(t("loans.confirm.edit.message"), {
            loan: String(editing?.loan_number ?? ""),
            employee: editing?.employee_name || t("loans.unknownEmployee"),
            rate: editForm.annual_rate,
            date: fmtDate(editForm.first_due_date),
            plan: editEmiPreview.data
              ? formatLoanPlan(t, editEmiPreview.data)
              : fill(t("loans.emiMonths"), { count: editForm.installments }),
            outstanding: money(editing?.outstanding ?? 0),
          }),
          label: t("loans.confirm.edit.label"),
        };
      case "pay":
        return {
          title: t("loans.confirm.pay.title"),
          message: fill(t("loans.confirm.pay.message"), {
            amount: money(payment.amount),
            date: fmtDate(payment.paid_on),
            loan: String(paymentFor?.loan_number ?? ""),
            outstanding: money(paymentFor?.outstanding ?? 0),
          }),
          label: t("loans.postPayment"),
        };
      case "defer":
        return {
          title: t("loans.confirm.defer.title"),
          message: fill(t("loans.confirm.defer.message"), {
            loan: String(deferFor?.loan_number ?? ""),
            date: fmtDate(deferDate),
          }),
          label: t("loans.deferLoan"),
        };
      case "return":
        return {
          title:
            returnFor?.status === "settled"
              ? t("loans.confirm.reopen.title")
              : t("loans.confirm.return.title"),
          message:
            returnFor?.status === "settled"
              ? fill(t("loans.confirm.reopen.message"), {
                  loan: String(returnFor?.loan_number ?? ""),
                  employee: returnFor?.employee_name || t("loans.unknownEmployee"),
                  principal: money(returnFor?.principal ?? 0),
                })
              : fill(t("loans.confirm.return.message"), {
                  loan: String(returnFor?.loan_number ?? ""),
                  employee: returnFor?.employee_name || t("loans.unknownEmployee"),
                  deferred: returnFor?.deferred_until
                    ? fill(t("loans.confirm.return.deferredPart"), {
                        date: fmtDate(returnFor.deferred_until),
                      })
                    : "",
                }),
          label:
            returnFor?.status === "settled"
              ? t("loans.confirm.reopen.label")
              : t("loans.confirm.return.label"),
        };
      case "settle":
        return {
          title: t("loans.confirm.settle.title"),
          message: fill(t("loans.confirm.settle.message"), {
            loan: String(settleFor?.loan_number ?? ""),
            amount: money(settleFor?.outstanding ?? 0),
            date: fmtDate(settlePaidOn),
            ref: settleRef ? fill(t("loans.confirm.settle.ref"), { ref: settleRef }) : "",
          }),
          label: t("loans.confirm.settle.label"),
        };
      case "delete":
        return {
          title: t("loans.confirm.delete.title"),
          message: fill(t("loans.confirm.delete.message"), {
            loan: String(deleting?.loan_number ?? ""),
            employee: deleting?.employee_name || t("loans.unknownEmployee"),
          }),
          label: t("action.delete"),
          destructive: true,
        };
      case "emi-run":
        return {
          title: t("loans.confirm.emiRun.title"),
          message: fill(t("loans.confirm.emiRun.message"), {
            count: String(activeEmployeeIds.length),
          }),
          label: t("loans.confirm.emiRun.label"),
        };
      default:
        return { title: "", message: "", label: t("action.confirm") };
    }
  };

  const runConfirmedAction = () => {
    switch (confirmKind) {
      case "create":
        createMutation.mutate();
        break;
      case "edit":
        editMutation.mutate();
        break;
      case "pay":
        paymentMutation.mutate();
        break;
      case "defer":
        deferMutation.mutate();
        break;
      case "return":
        returnMutation.mutate();
        break;
      case "settle":
        settleMutation.mutate();
        break;
      case "delete":
        if (deleting) deleteMutation.mutate(deleting);
        break;
      case "emi-run":
        monthlyRunMutation.mutate();
        break;
      default:
        break;
    }
  };

  const requestCreate = () => {
    const termsOk = form.emi != null ? createEmi != null : Number(form.installments) > 0;
    if (!form.employee_id || !(Number(form.principal) > 0) || !termsOk) {
      toast.warning(t("loans.warn.missingTitle"), t("loans.warn.createBody"));
      return;
    }
    if (emiPreview.isError) {
      toast.warning(t("loans.warn.checkTerms"), errorMessage(emiPreview.error));
      return;
    }
    setConfirmKind("create");
  };

  const requestEdit = () => {
    const termsOk = editForm.emi != null ? editEmi != null : Number(editForm.installments) > 0;
    if (!editing || !termsOk) {
      toast.warning(t("loans.warn.missingTitle"), t("loans.warn.editBody"));
      return;
    }
    if (editEmiPreview.isError) {
      toast.warning(t("loans.warn.checkTerms"), errorMessage(editEmiPreview.error));
      return;
    }
    setConfirmKind("edit");
  };

  const requestPay = () => {
    if (!paymentFor || !(Number(payment.amount) > 0)) {
      toast.warning(t("loans.warn.missingTitle"), t("loans.warn.payBody"));
      return;
    }
    setConfirmKind("pay");
  };

  const requestDefer = () => {
    if (!deferFor || !deferDate) {
      toast.warning(t("loans.warn.missingTitle"), t("loans.warn.deferBody"));
      return;
    }
    setConfirmKind("defer");
  };

  const requestSettle = () => {
    if (!settleFor || Number(settleFor.outstanding) <= 0) {
      toast.warning(t("loans.warn.nothingSettleTitle"), t("loans.warn.nothingSettleBody"));
      return;
    }
    setConfirmKind("settle");
  };

  const copy = confirmCopy();

  return (
    <div
      className="loan-workspace animate-[fade-in_0.3s_ease-out] flex min-h-[calc(100dvh-5.5rem)] flex-col lg:min-h-[calc(100dvh-2.5rem)]"
      data-testid="loans-page"
    >
      <a
        href="#loan-register"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-3 focus:rounded-[var(--radius-sm)] focus:bg-[var(--color-card)] focus:px-3 focus:py-2 focus:shadow-[var(--shadow-pop)]"
      >
        {t("loans.skipToRegister")}
      </a>

      {/* Immersive chrome — one composition (not sticky: avoids app-shell overflow clip) */}
      <header className="loan-workspace__chrome pb-3">
        <PageHeader
          className="mb-3"
          title={t("page.loans.title")}
          subtitle={t("page.loans.subtitle")}
          actions={
            <div className="flex flex-wrap items-center justify-end gap-2" role="toolbar" aria-label={t("loans.toolbar")}>
              <ExcelToolbar dataset="loans" />
              <ExcelToolbar dataset="opening-loans" importOnly />
              <Button
                variant="outline"
                className="min-h-11"
                data-testid="btn-monthly-emi-run"
                disabled={activeEmployeeIds.length === 0 || monthlyRunMutation.isPending}
                onClick={() => setConfirmKind("emi-run")}
              >
                <Play size={15} aria-hidden /> {t("loans.monthlyEmiRun")}
              </Button>
              <Button
                variant="gradient"
                className="min-h-11"
                data-testid="btn-new-loan"
                onClick={() => {
                  setForm({
                    employee_id: "",
                    principal: "",
                    annual_rate: "0",
                    installments: "12",
                    emi: null,
                    first_due_date: todayLocal(),
                  });
                  setShowCreate(true);
                }}
              >
                <Plus size={15} aria-hidden /> {t("loans.newLoan")}
              </Button>
            </div>
          }
        />

        {/* Money-first KPI strip — Outstanding leads (fintech servicing pattern).
            One band: hero (3/12) + four stats (9/12), matched padding/elevation. */}
        <div
          className="mt-2 grid grid-cols-2 gap-3 lg:grid-cols-12"
          role="region"
          aria-label={t("loans.portfolioSummary")}
        >
          <div className="col-span-2 flex flex-col justify-between gap-2 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-5 shadow-[var(--shadow-card)] lg:col-span-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-[var(--color-muted-foreground)]">
                {t("loans.outstanding")}
              </p>
              <p className="mt-0.5 text-2xl font-extrabold tabular-nums leading-tight tracking-tight text-[var(--color-destructive)] 2xl:text-3xl">
                {money(stats.outstanding)}
              </p>
            </div>
            <p className="text-xs text-[var(--color-muted-foreground)]">
              {t("loans.fullBookHint")}
            </p>
          </div>
          <div className="col-span-2 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:col-span-9">
            <StatCard
              label={t("loans.recovered")}
              value={money(stats.recovered)}
              icon={<CircleDollarSign size={18} aria-hidden />}
              tone="success"
            />
            <StatCard
              label={t("loans.kpi.active")}
              value={stats.active}
              icon={<HandCoins size={18} aria-hidden />}
              tone="primary"
            />
            <StatCard
              label={t("loans.kpi.deferred")}
              value={stats.deferred}
              icon={<CalendarClock size={18} aria-hidden />}
              tone="warning"
            />
            <StatCard
              label={t("loans.kpi.settled")}
              value={stats.settled}
              icon={<BadgeCheck size={18} aria-hidden />}
              tone="success"
            />
          </div>
        </div>
      </header>

      {/* Full-height register plane */}
      <section
        id="loan-register"
        tabIndex={-1}
        aria-labelledby="loan-register-heading"
        className="loan-workspace__register flex min-h-0 flex-1 flex-col overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
      >
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--color-border)] px-4 py-3">
          <div>
            <h2 id="loan-register-heading" className="text-base font-bold tracking-tight">
              {t("loans.register.title")}
            </h2>
            <div className="flex flex-wrap items-baseline gap-x-2">
              <p className="text-sm text-[var(--color-muted-foreground)]" aria-live="polite">
                {fill(
                  t(filtered.length === 1 ? "loans.register.count.one" : "loans.register.count.many"),
                  { count: String(filtered.length) }
                )}
                {statusFilter ? ` · ${loanStatusLabel(t, statusFilter)}` : ""}
                {loans.data?.length === 500 ? (
                  <span className="text-xs"> · {fill(t("loans.register.limitHint"), { limit: "500" })}</span>
                ) : null}
              </p>
              {/* Single currency context for the whole grid — cells stay numeric (finance-page pattern). */}
              <p className="text-xs font-semibold text-[var(--color-muted-foreground)]">
                · {t("loans.register.currencyNote")}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <Select
              aria-label={t("filter.status")}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="min-h-11 w-full min-w-0 sm:w-40"
            >
              <option value="">{t("filter.allStatuses")}</option>
              <option value="active">{t("loans.kpi.active")}</option>
              <option value="deferred">{t("loans.kpi.deferred")}</option>
              <option value="settled">{t("loans.kpi.settled")}</option>
            </Select>
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder={t("loans.register.searchPlaceholder")}
              className="min-h-11 w-full min-w-0 sm:w-56"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {loans.isPending ? (
            <div className="p-4">
              <TableSkeleton />
            </div>
          ) : loans.isError ? (
            <div className="p-4">
              <ErrorState error={loans.error} onRetry={loans.refetch} />
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<HandCoins size={22} aria-hidden />}
              title={t("loans.empty.title")}
              message={t("loans.empty.message")}
            />
          ) : (
            <Table stickyFirst cards aria-label={t("loans.register.title")}>
              <THead>
                <TR>
                  <TH>{t("loans.col.loan")}</TH>
                  <TH>{t("loans.col.employee")}</TH>
                  <TH className="desk-num">{t("loans.principal")}</TH>
                  <TH className="desk-num">{t("loans.paid")}</TH>
                  <TH className="desk-num">{t("loans.col.emi")}</TH>
                  <TH className="desk-num">{t("loans.outstanding")}</TH>
                  <TH>{t("loans.statusCol")}</TH>
                  <TH className="text-end">{t("loans.emi.actions")}</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((l) => {
                  const paid = Number(l.paid_amount ?? 0);
                  const principal = Number(l.principal);
                  const paidPct =
                    principal > 0 ? Math.min(100, Math.max(0, (paid / principal) * 100)) : 0;
                  const lastDiffers =
                    l.last_installment != null &&
                    l.installments > 1 &&
                    Number(l.last_installment) !== Number(l.monthly_installment);
                  const loanLabel = String(l.loan_number ?? l.id.slice(0, 8));
                  // Row action hierarchy: Pay = lone visible text action, Settle = quiet icon,
                  // everything else (view → edit → lifecycle → destructive) behind one ⋯ menu.
                  const menuItems: OverflowMenuItem[] = [
                    {
                      key: "schedule",
                      testId: `mi-schedule-loan-${l.id}`,
                      icon: <ListOrdered size={13} aria-hidden />,
                      label: t("loans.actions.schedule"),
                      onSelect: () => setScheduleFor(l),
                    },
                  ];
                  if (paid > 0 || (l.payment_entries ?? 0) > 0) {
                    menuItems.push({
                      key: "ledger",
                      testId: `btn-paid-emis-${l.id}`,
                      icon: <Receipt size={13} aria-hidden />,
                      label: t("loans.emi.paidEmis"),
                      onSelect: () => setLedgerFor(l),
                    });
                  }
                  if (l.status === "active" || l.status === "deferred") {
                    menuItems.push({
                      key: "edit",
                      testId: `mi-edit-loan-${l.id}`,
                      icon: <Pencil size={13} aria-hidden />,
                      label: t("action.edit"),
                      onSelect: () => openEdit(l),
                    });
                  }
                  if (l.status === "active") {
                    menuItems.push({
                      key: "defer",
                      testId: `mi-defer-loan-${l.id}`,
                      icon: <CalendarClock size={13} aria-hidden />,
                      label: t("loans.actions.defer"),
                      onSelect: () => {
                        setDeferDate("");
                        setDeferFor(l);
                      },
                    });
                  }
                  if (l.status === "deferred" || l.status === "settled") {
                    menuItems.push({
                      key: "return",
                      testId: `mi-return-loan-${l.id}`,
                      icon: <RotateCcw size={13} aria-hidden />,
                      label: l.status === "settled" ? t("loans.actions.reopen") : t("loans.actions.return"),
                      onSelect: () => {
                        setReturnFor(l);
                        setConfirmKind("return");
                      },
                    });
                  }
                  menuItems.push({
                    key: "delete",
                    testId: `mi-delete-loan-${l.id}`,
                    icon: <Trash2 size={13} aria-hidden />,
                    label: t("loans.actions.deleteTitle"),
                    destructive: true,
                    onSelect: () => {
                      setDeleting(l);
                      setConfirmKind("delete");
                    },
                  });
                  return (
                    <TR key={l.id}>
                      <TD className="font-mono font-semibold">
                        #{l.loan_number ?? l.id.slice(0, 8)}
                      </TD>
                      <TD>
                        <p className="font-semibold">{l.employee_name || "—"}</p>
                        <p className="font-mono text-xs text-[var(--color-muted-foreground)]">
                          {l.employee_code}
                        </p>
                      </TD>
                      <TD className="desk-num">{money(l.principal, "")}</TD>
                      <TD className="desk-num" data-testid={`loan-paid-${l.id}`}>
                        <p className={paid > 0 ? "font-semibold text-[var(--color-success)]" : undefined}>
                          {money(paid, "")}
                        </p>
                        <div
                          className={cn(
                            "ms-auto mt-1 h-1.5 w-full max-w-24 overflow-hidden rounded-full bg-[var(--color-muted)]",
                            paidPct === 0 && "opacity-40"
                          )}
                          role="progressbar"
                          aria-label={`${t("loans.paid")} ${Math.round(paidPct)}%`}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={Math.round(paidPct)}
                        >
                          <div
                            className="h-full rounded-full bg-[var(--color-success)]"
                            style={{ width: `${paidPct}%` }}
                          />
                        </div>
                        {l.last_paid_on ? (
                          <p className="mt-0.5 text-[11px] text-[var(--color-muted-foreground)]">
                            {t("loans.lastPaid")}: {fmtDate(l.last_paid_on)}
                          </p>
                        ) : null}
                      </TD>
                      <TD className="desk-num" data-testid={`loan-emi-${l.id}`}>
                        {/* Two-line max: line 1 = EMI × tenor; line 2 = remaining · end (+ last if it differs). */}
                        <p className="font-semibold">
                          {money(l.monthly_installment, "")}
                          <span className="text-xs font-normal text-[var(--color-muted-foreground)]">
                            {" "}
                            × {l.installments}
                          </span>
                          {l.repayment_basis === "emi" ? (
                            <Badge variant="outline" className="ms-1 align-middle text-[10px]">
                              {t("loanTerms.basisEmi")}
                            </Badge>
                          ) : null}
                        </p>
                        {l.status !== "settled" && l.end_date ? (
                          <p className="mt-0.5 whitespace-nowrap text-[11px] text-[var(--color-muted-foreground)]">
                            {l.remaining_installments ?? 0} {t("loanTerms.remaining").toLowerCase()} ·{" "}
                            {t("loanTerms.endDate")} {fmtDate(l.end_date)}
                            {lastDiffers ? ` · ${t("loanTerms.lastInstallment")} ${money(l.last_installment, "")}` : ""}
                          </p>
                        ) : lastDiffers ? (
                          <p className="mt-0.5 text-[11px] text-[var(--color-muted-foreground)]">
                            {t("loanTerms.lastInstallment")}: {money(l.last_installment, "")}
                          </p>
                        ) : null}
                      </TD>
                      <TD className="desk-num text-base font-extrabold tabular-nums">
                        {money(l.outstanding, "")}
                      </TD>
                      <TD>
                        <Badge variant={statusTone(l.status) as never}>{loanStatusLabel(t, l.status)}</Badge>
                        {l.deferred_until ? (
                          <p className="mt-0.5 text-[11px] text-[var(--color-muted-foreground)]">
                            {fill(t("loans.deferredUntil"), { date: fmtDate(l.deferred_until) })}
                          </p>
                        ) : null}
                      </TD>
                      <TD className="text-end">
                        <div
                          className="inline-flex flex-nowrap items-center justify-end gap-1.5"
                          role="group"
                          aria-label={fill(t("loans.actions.forLoan"), { loan: loanLabel })}
                        >
                          {(l.status === "active" || l.status === "deferred") && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="min-h-9 border-[var(--color-primary)]/40 text-[var(--color-primary)] hover:bg-[var(--color-primary-muted)]"
                              data-testid={`btn-pay-loan-${l.id}`}
                              onClick={() => {
                                setPayment({
                                  amount: String(l.monthly_installment),
                                  paid_on: todayLocal(),
                                });
                                setPaymentFor(l);
                              }}
                            >
                              <Wallet size={14} aria-hidden /> {t("loans.actions.pay")}
                            </Button>
                          )}
                          {(l.status === "active" || l.status === "deferred") && (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              title={t("loans.actions.settle")}
                              aria-label={fill(t("loans.actions.settleAria"), { loan: loanLabel })}
                              data-testid={`btn-settle-loan-${l.id}`}
                              onClick={() => {
                                setSettlePaidOn(todayLocal());
                                setSettleRef("");
                                setSettleFor(l);
                              }}
                            >
                              <BadgeCheck size={15} className="text-[var(--color-success)]" aria-hidden />
                            </Button>
                          )}
                          <OverflowMenu
                            items={menuItems}
                            label={fill(t("loans.actions.moreAria"), { loan: loanLabel })}
                            menuLabel={fill(t("loans.actions.forLoan"), { loan: loanLabel })}
                            testId={`loan-more-${l.id}`}
                          />
                        </div>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
        </div>
      </section>

      <Dialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        title={t("loans.newLoan")}
        description={t("loans.dialog.newDesc")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setShowCreate(false)}>
              {t("action.cancel")}
            </Button>
            <Button variant="gradient" onClick={requestCreate}>
              {t("loans.dialog.reviewCreate")}
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-4">
          <Field label={t("loans.col.employee")} className="col-span-2">
            <EmployeeCombobox
              employees={employees.data ?? []}
              value={form.employee_id}
              placeholder={t("loans.employeePickerPlaceholder")}
              onChange={(id) => setForm((f) => ({ ...f, employee_id: id }))}
            />
          </Field>
          <Field label={t("loans.principal")}>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={form.principal}
              onChange={(e) => setForm((f) => ({ ...f, principal: e.target.value }))}
            />
          </Field>
          <Field label={t("loans.field.annualRate")}>
            <Input
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={form.annual_rate}
              onChange={(e) => setForm((f) => ({ ...f, annual_rate: e.target.value }))}
            />
          </Field>
          <div className="col-span-2">
            <LoanTermsInput
              excess={Number(form.principal) || 0}
              value={{ months: form.installments, emi: form.emi }}
              onChange={(v) => setForm((f) => ({ ...f, installments: v.months, emi: v.emi }))}
              plan={emiPreview.data}
              testId="loan-terms-create"
            />
          </div>
          <Field label={t("loans.field.firstDue")}>
            <Input
              type="date"
              value={form.first_due_date}
              onChange={(e) => setForm((f) => ({ ...f, first_due_date: e.target.value }))}
            />
          </Field>
        </div>
        {emiPreview.data ? (
          <p
            className="mt-4 rounded-[var(--radius-sm)] bg-[var(--color-primary-muted)] px-3 py-2 text-sm font-semibold text-[var(--color-primary)]"
            data-testid="loan-create-preview"
          >
            {t("loans.monthlyInstallment")} <LoanPlanText plan={emiPreview.data} />
          </p>
        ) : emiPreview.isError ? (
          <p role="alert" className="mt-4 text-sm font-medium text-[var(--color-destructive-emphasis)]">
            {errorMessage(emiPreview.error)}
          </p>
        ) : null}
      </Dialog>

      <Dialog
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={
          editing
            ? fill(t("loans.dialog.editTitle"), {
                loan: String(editing.loan_number ?? editing.id.slice(0, 8)),
              })
            : t("loans.dialog.editFallback")
        }
        description={
          editing
            ? `${editing.employee_name || editing.employee_code || t("loans.unknownEmployee")} · ${t(
                "loans.outstanding"
              )} ${money(editing.outstanding)}`
            : undefined
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              {t("action.cancel")}
            </Button>
            <Button variant="gradient" onClick={requestEdit}>
              {t("loans.dialog.reviewSave")}
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-4">
          <Field label={t("loans.field.annualRate")}>
            <Input
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={editForm.annual_rate}
              onChange={(e) => setEditForm((f) => ({ ...f, annual_rate: e.target.value }))}
            />
          </Field>
          <Field label={t("loans.field.firstDue")}>
            <Input
              type="date"
              value={editForm.first_due_date}
              onChange={(e) => setEditForm((f) => ({ ...f, first_due_date: e.target.value }))}
            />
          </Field>
          <div className="col-span-2">
            <LoanTermsInput
              excess={Number(editing?.outstanding) || 0}
              value={{ months: editForm.installments, emi: editForm.emi }}
              onChange={(v) => setEditForm((f) => ({ ...f, installments: v.months, emi: v.emi }))}
              plan={editEmiPreview.data}
              testId="loan-terms-restructure"
            />
          </div>
        </div>
        {editEmiPreview.data ? (
          <p
            className="mt-4 rounded-[var(--radius-sm)] bg-[var(--color-primary-muted)] px-3 py-2 text-sm font-semibold text-[var(--color-primary)]"
            data-testid="loan-restructure-preview"
          >
            {t("loans.revisedMonthlyInstallment")} <LoanPlanText plan={editEmiPreview.data} />
          </p>
        ) : editEmiPreview.isError ? (
          <p role="alert" className="mt-4 text-sm font-medium text-[var(--color-destructive-emphasis)]">
            {errorMessage(editEmiPreview.error)}
          </p>
        ) : null}
        <p className="mt-3 text-xs text-[var(--color-muted-foreground)]">
          {t("loans.dialog.editNote")}
        </p>
      </Dialog>

      <Dialog
        open={Boolean(scheduleFor)}
        onClose={() => setScheduleFor(null)}
        title={fill(t("loans.schedule.title"), { loan: String(scheduleFor?.loan_number ?? "") })}
        description={
          scheduleFor
            ? `${fill(t("loans.schedule.desc"), {
                principal: money(scheduleFor.principal),
                rate: String(scheduleFor.annual_rate),
                months: String(scheduleFor.installments),
              })}${scheduleFor.repayment_basis === "emi" ? ` (${t("loanTerms.basisEmi")})` : ""} · ${t(
                "loans.outstanding"
              )} ${money(scheduleFor.outstanding)}${
                scheduleFor.end_date ? ` · ${t("loanTerms.endDate")} ${fmtDate(scheduleFor.end_date)}` : ""
              }`
            : undefined
        }
        wide
      >
        {scheduleSummary ? (
          <div
            className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
            data-testid="loan-schedule-summary"
            role="region"
            aria-label={t("loans.schedule.summaryLabel")}
          >
            <div className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-secondary)] px-3 py-2.5">
              <p className="text-[11px] font-bold uppercase text-[var(--color-muted-foreground)]">
                {t("loans.principal")}
              </p>
              <p className="mt-0.5 text-lg font-extrabold tabular-nums">
                {money(scheduleSummary.principal)}
              </p>
            </div>
            <div className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-secondary)] px-3 py-2.5">
              <p className="text-[11px] font-bold uppercase text-[var(--color-muted-foreground)]">
                {t("loans.paid")}
              </p>
              <p className="mt-0.5 text-lg font-extrabold tabular-nums text-[var(--color-success)]">
                {money(scheduleSummary.paid)}
              </p>
            </div>
            <div className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-secondary)] px-3 py-2.5 lg:col-span-1">
              <p className="text-[11px] font-bold uppercase text-[var(--color-muted-foreground)]">
                {t("loans.outstanding")}
              </p>
              <p className="mt-0.5 text-lg font-extrabold tabular-nums text-[var(--color-destructive)]">
                {money(scheduleSummary.outstanding)}
              </p>
            </div>
            <div className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-secondary)] px-3 py-2.5">
              <p className="text-[11px] font-bold uppercase text-[var(--color-muted-foreground)]">
                {t("loans.nextDue")}
              </p>
              {scheduleSummary.next ? (
                <p className="mt-0.5 text-sm font-bold tabular-nums">
                  {fmtDate(scheduleSummary.next.due_date)}
                  <span className="mt-0.5 block text-base font-extrabold">
                    {money(scheduleSummary.next.balance_due ?? scheduleSummary.next.payment)}
                  </span>
                </p>
              ) : (
                <p className="mt-0.5 font-semibold text-[var(--color-muted-foreground)]">
                  {schedule.isPending ? "—" : t("loans.nextDue.none")}
                </p>
              )}
            </div>
          </div>
        ) : null}
        {schedule.isPending ? (
          <TableSkeleton />
        ) : schedule.isError ? (
          <ErrorState error={schedule.error} onRetry={schedule.refetch} />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>#</TH>
                <TH>{t("loans.col.due")}</TH>
                <TH>{t("loans.col.opening")}</TH>
                <TH>{t("loans.principal")}</TH>
                <TH>{t("loans.col.interest")}</TH>
                <TH>{t("loans.col.payment")}</TH>
                <TH>{t("loans.paid")}</TH>
                <TH>{t("loans.balanceDue")}</TH>
                <TH>{t("loans.col.closing")}</TH>
                <TH>{t("loans.statusCol")}</TH>
              </TR>
            </THead>
            <TBody>
              {(schedule.data ?? []).map((row) => (
                <TR key={row.number}>
                  <TD className="text-[var(--color-muted-foreground)]">{row.number}</TD>
                  <TD>{fmtDate(row.due_date)}</TD>
                  <TD>{money(row.opening_balance)}</TD>
                  <TD>{money(row.principal)}</TD>
                  <TD>{money(row.interest)}</TD>
                  <TD className="font-semibold">{money(row.payment)}</TD>
                  <TD>{money(row.paid ?? 0)}</TD>
                  <TD>{money(row.balance_due ?? row.payment)}</TD>
                  <TD>{money(row.closing_balance)}</TD>
                  <TD>
                    {row.status ? (
                      <Badge variant={INSTALLMENT_TONE[row.status] ?? "outline"}>
                        {t(`loans.status.${row.status}`)}
                      </Badge>
                    ) : null}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        <div className="mt-5" data-testid="loan-payment-history">
          <h3 className="mb-2 text-sm font-semibold">{t("loans.history")}</h3>
          {paymentLedger}
        </div>
      </Dialog>

      <Dialog
        open={Boolean(ledgerFor)}
        onClose={() => setLedgerFor(null)}
        title={t("loans.emi.ledgerTitle").replace("{loan}", String(scheduleLoan?.loan_number ?? ""))}
        description={
          ledgerFor && scheduleLoan
            ? `${scheduleLoan.employee_name || scheduleLoan.employee_code || ""} · ${t("loans.paid")} ${money(
                scheduleLoan.paid_amount ?? 0
              )} · ${t("loans.outstanding")} ${money(scheduleLoan.outstanding)} · ${titleCase(scheduleLoan.status)}`
            : undefined
        }
        wide
      >
        <div data-testid="loan-payment-ledger">{paymentLedger}</div>
      </Dialog>

      <Dialog
        open={Boolean(paymentEdit)}
        onClose={() => setPaymentEdit(null)}
        layer="nested"
        title={t("loans.emi.editTitle")}
        description={
          paymentEdit
            ? `${fmtDate(paymentEdit.paid_on)} · ${money(paymentEdit.amount)}${
                paymentEdit.reference ? ` · ${paymentEdit.reference}` : ""
              }`
            : undefined
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setPaymentEdit(null)}>
              {t("action.cancel")}
            </Button>
            <Button
              variant="gradient"
              data-testid="btn-save-payment-edit"
              disabled={Boolean(editImpact?.error) || editPaymentMutation.isPending}
              onClick={() => editPaymentMutation.mutate()}
            >
              {editPaymentMutation.isPending ? t("state.saving") : t("loans.emi.save")}
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("loans.history.amount")}>
            <Input
              type="number"
              min="0"
              step="0.001"
              value={paymentForm.amount}
              data-testid="input-payment-edit-amount"
              onChange={(e) => setPaymentForm((f) => ({ ...f, amount: e.target.value }))}
            />
          </Field>
          <Field label={t("loans.history.date")}>
            <Input
              type="date"
              max={
                paymentEdit && String(paymentEdit.paid_on).slice(0, 10) > todayLocal()
                  ? String(paymentEdit.paid_on).slice(0, 10)
                  : todayLocal()
              }
              value={paymentForm.paid_on}
              onChange={(e) => setPaymentForm((f) => ({ ...f, paid_on: e.target.value }))}
            />
          </Field>
          <Field label={t("loans.history.reference")} className="sm:col-span-2">
            <Input
              value={paymentForm.reference}
              maxLength={100}
              onChange={(e) => setPaymentForm((f) => ({ ...f, reference: e.target.value }))}
            />
          </Field>
          <Field label={t("loans.emi.reason")} className="sm:col-span-2">
            <Textarea
              rows={2}
              maxLength={300}
              value={paymentForm.reason}
              data-testid="input-payment-edit-reason"
              placeholder={t("loans.emi.reasonPlaceholder")}
              onChange={(e) => setPaymentForm((f) => ({ ...f, reason: e.target.value }))}
            />
          </Field>
        </div>
        {editImpact ? (
          <div
            className="mt-4 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-muted)] px-3 py-2 text-sm"
            data-testid="payment-edit-impact"
          >
            <p>
              {t("loans.outstanding")}: {money(editImpact.before)} → <strong>{money(editImpact.after)}</strong>
              {editImpact.after === 0 ? ` · ${t("loans.emi.willSettle")}` : ""}
            </p>
            {editImpact.error ? (
              <p className="mt-1 text-xs font-medium text-[var(--color-destructive-emphasis)]">{editImpact.error}</p>
            ) : (
              <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">{t("loans.emi.ledgerNote")}</p>
            )}
          </div>
        ) : null}
      </Dialog>

      <Dialog
        open={Boolean(paymentDelete)}
        onClose={() => setPaymentDelete(null)}
        layer="nested"
        title={t("loans.emi.deleteTitle")}
        description={
          paymentDelete
            ? `${fmtDate(paymentDelete.paid_on)} · ${money(paymentDelete.amount)}${
                paymentDelete.reference ? ` · ${paymentDelete.reference}` : ""
              }`
            : undefined
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setPaymentDelete(null)}>
              {t("action.cancel")}
            </Button>
            <Button
              variant="destructive"
              data-testid="btn-confirm-payment-delete"
              disabled={deleteReason.trim().length < 3 || deletePaymentMutation.isPending}
              onClick={() => deletePaymentMutation.mutate()}
            >
              {deletePaymentMutation.isPending ? t("state.working") : t("loans.emi.delete")}
            </Button>
          </>
        }
      >
        {paymentDelete && scheduleLoan ? (
          <p className="mb-3 rounded-[var(--radius-sm)] bg-[var(--color-warning-muted)] px-3 py-2 text-sm text-[var(--color-warning-emphasis)]">
            {t("loans.outstanding")}: {money(scheduleLoan.outstanding)} →{" "}
            <strong>{money(Number(scheduleLoan.outstanding) + Number(paymentDelete.amount))}</strong>
            {scheduleLoan.status === "settled" ? ` · ${t("loans.emi.willReopen")}` : ""}
          </p>
        ) : null}
        <Field label={t("loans.emi.reason")}>
          <Textarea
            rows={2}
            maxLength={300}
            value={deleteReason}
            data-testid="input-payment-delete-reason"
            placeholder={t("loans.emi.reasonPlaceholder")}
            onChange={(e) => setDeleteReason(e.target.value)}
          />
        </Field>
        <p className="mt-3 text-xs text-[var(--color-muted-foreground)]">
          {t("loans.emi.deleteExplain")} {t("loans.emi.ledgerNote")}
        </p>
      </Dialog>

      <Dialog
        open={Boolean(paymentFor)}
        onClose={() => setPaymentFor(null)}
        title={t("loans.postPayment")}
        description={paymentFor ? `${t("loans.outstanding")}: ${money(paymentFor.outstanding)}` : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPaymentFor(null)}>
              {t("action.cancel")}
            </Button>
            <Button variant="gradient" onClick={requestPay}>
              {t("loans.dialog.reviewPost")}
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-4">
          <Field label={t("loans.history.amount")}>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={payment.amount}
              onChange={(e) => setPayment((p) => ({ ...p, amount: e.target.value }))}
            />
          </Field>
          <Field label={t("loans.field.paidOn")}>
            <Input
              type="date"
              value={payment.paid_on}
              onChange={(e) => setPayment((p) => ({ ...p, paid_on: e.target.value }))}
            />
          </Field>
        </div>
      </Dialog>

      <Dialog
        open={Boolean(settleFor)}
        onClose={() => setSettleFor(null)}
        title={t("loans.dialog.settleTitle")}
        description={
          settleFor
            ? fill(t("loans.dialog.settleDesc"), {
                loan: String(settleFor.loan_number ?? ""),
                amount: money(settleFor.outstanding),
              })
            : undefined
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setSettleFor(null)}>
              {t("action.cancel")}
            </Button>
            <Button variant="gradient" onClick={requestSettle}>
              {t("loans.dialog.reviewSettle")}
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-4">
          <Field label={t("loans.field.paidOn")}>
            <Input type="date" value={settlePaidOn} onChange={(e) => setSettlePaidOn(e.target.value)} />
          </Field>
          <Field label={t("loans.history.reference")}>
            <Input
              value={settleRef}
              onChange={(e) => setSettleRef(e.target.value)}
              placeholder={t("loans.field.referenceOptional")}
            />
          </Field>
        </div>
      </Dialog>

      <Dialog
        open={Boolean(deferFor)}
        onClose={() => setDeferFor(null)}
        title={t("loans.deferLoan")}
        description={t("loans.dialog.deferDesc")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeferFor(null)}>
              {t("action.cancel")}
            </Button>
            <Button variant="gradient" onClick={requestDefer}>
              {t("loans.dialog.reviewDefer")}
            </Button>
          </>
        }
      >
        <Field label={t("loans.field.deferredUntil")}>
          <Input type="date" value={deferDate} onChange={(e) => setDeferDate(e.target.value)} />
        </Field>
      </Dialog>

      <ConfirmDialog
        open={Boolean(confirmKind)}
        onClose={() => setConfirmKind(null)}
        onConfirm={runConfirmedAction}
        title={copy.title}
        message={copy.message}
        confirmLabel={confirmBusy ? t("state.working") : copy.label}
        destructive={copy.destructive}
        busy={confirmBusy}
      />
    </div>
  );
}

function LoansPageRoute() {
  return (
    <Suspense fallback={<TableSkeleton columns={8} />}>
      <LoansPage />
    </Suspense>
  );
}

export default LoansPageRoute;
