"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BadgeCheck,
  CalendarClock,
  HandCoins,
  ListOrdered,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Trash2,
  Wallet,
} from "lucide-react";
import { useMemo, useState } from "react";
import { EmployeeCombobox } from "@/components/employee-combobox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { EmptyState, ErrorState, PageHeader, SearchInput, StatCard } from "@/components/ui/primitives";
import { TableSkeleton } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { api, errorMessage } from "@/lib/api";
import { fmtDate, money, statusTone, titleCase, todayLocal } from "@/lib/format";
import type { Employee, Loan, LoanInstallment } from "@/lib/types";

type ConfirmKind = "create" | "edit" | "pay" | "defer" | "settle" | "return" | "delete" | "emi-run" | null;

function LoansPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [scheduleFor, setScheduleFor] = useState<Loan | null>(null);
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
    first_due_date: todayLocal(),
  });
  const [editForm, setEditForm] = useState({
    annual_rate: "0",
    installments: "12",
    first_due_date: todayLocal(),
  });
  const [payment, setPayment] = useState({ amount: "", paid_on: todayLocal() });
  const [deferDate, setDeferDate] = useState("");
  const [settlePaidOn, setSettlePaidOn] = useState(todayLocal());
  const [settleRef, setSettleRef] = useState("");

  const loans = useQuery({
    queryKey: ["loans", statusFilter],
    queryFn: () => api<Loan[]>(`/loans?limit=500${statusFilter ? `&status=${statusFilter}` : ""}`),
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
  const emiPreview = useQuery({
    queryKey: ["emi-preview", form.principal, form.annual_rate, form.installments],
    queryFn: () =>
      api<{ monthly_installment: string }>("/loans/preview", {
        method: "POST",
        body: {
          principal: Number(form.principal),
          annual_rate: Number(form.annual_rate),
          installments: Number(form.installments),
        },
      }),
    enabled: showCreate && Number(form.principal) > 0 && Number(form.installments) > 0,
    retry: false,
  });
  const editEmiPreview = useQuery({
    queryKey: [
      "edit-emi-preview",
      editing?.id,
      editing?.outstanding,
      editForm.annual_rate,
      editForm.installments,
    ],
    queryFn: () =>
      api<{ monthly_installment: string }>("/loans/preview", {
        method: "POST",
        body: {
          principal: Number(editing!.outstanding),
          annual_rate: Number(editForm.annual_rate),
          installments: Number(editForm.installments),
        },
      }),
    enabled:
      Boolean(editing) && Number(editing?.outstanding) > 0 && Number(editForm.installments) > 0,
    retry: false,
  });

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return loans.data ?? [];
    return (loans.data ?? []).filter((l) =>
      [l.employee_name, l.employee_code, l.loan_number]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(term))
    );
  }, [loans.data, search]);

  const stats = useMemo(() => {
    const all = loans.data ?? [];
    return {
      active: all.filter((l) => l.status === "active").length,
      deferred: all.filter((l) => l.status === "deferred").length,
      settled: all.filter((l) => l.status === "settled").length,
      outstanding: all.reduce((sum, l) => sum + Number(l.outstanding), 0),
    };
  }, [loans.data]);

  const activeEmployeeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const l of loans.data ?? []) {
      if (l.status === "active" || l.status === "deferred") ids.add(l.employee_id);
    }
    return [...ids];
  }, [loans.data]);

  const employeeLabel = (employeeId: string) => {
    const emp = (employees.data ?? []).find((e) => e.id === employeeId);
    return emp ? `${emp.code} — ${emp.full_name}` : "employee";
  };

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["loans"] });
    queryClient.invalidateQueries({ queryKey: ["loan-schedule"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const openEdit = (loan: Loan) => {
    setEditing(loan);
    setEditForm({
      annual_rate: String(loan.annual_rate ?? "0"),
      installments: String(loan.installments ?? 12),
      first_due_date: String(loan.first_due_date || todayLocal()).slice(0, 10),
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
          installments: Number(form.installments),
          first_due_date: form.first_due_date,
        },
      }),
    onSuccess: () => {
      toast.success("Loan created");
      setConfirmKind(null);
      setShowCreate(false);
      invalidate();
    },
    onError: (err) => toast.error("Create failed", errorMessage(err)),
  });

  const editMutation = useMutation({
    mutationFn: () =>
      api(`/loans/${editing!.id}/restructure`, {
        method: "POST",
        headers: { "If-Match": String(editing!.version) },
        body: {
          annual_rate: Number(editForm.annual_rate),
          installments: Number(editForm.installments),
          first_due_date: editForm.first_due_date,
        },
      }),
    onSuccess: () => {
      toast.success("Loan updated", "EMI terms revised and schedule rebuilt.");
      setConfirmKind(null);
      setEditing(null);
      invalidate();
    },
    onError: (err) => toast.error("Edit failed", errorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: (loan: Loan) =>
      api(`/loans/${loan.id}`, {
        method: "DELETE",
        headers: { "If-Match": String(loan.version) },
      }),
    onSuccess: () => {
      toast.success("Loan deleted");
      setConfirmKind(null);
      setDeleting(null);
      invalidate();
    },
    onError: (err) => toast.error("Delete failed", errorMessage(err)),
  });

  const paymentMutation = useMutation({
    mutationFn: () =>
      api(`/loans/${paymentFor!.id}/payments`, {
        method: "POST",
        body: { amount: Number(payment.amount), paid_on: payment.paid_on },
      }),
    onSuccess: () => {
      toast.success("Payment posted");
      setConfirmKind(null);
      setPaymentFor(null);
      invalidate();
    },
    onError: (err) => toast.error("Payment failed", errorMessage(err)),
  });

  const deferMutation = useMutation({
    mutationFn: () =>
      api(`/loans/${deferFor!.id}/defer`, {
        method: "POST",
        body: { deferred_until: deferDate },
        headers: { "If-Match": String(deferFor!.version) },
      }),
    onSuccess: () => {
      toast.success("Loan deferred");
      setConfirmKind(null);
      setDeferFor(null);
      invalidate();
    },
    onError: (err) => toast.error("Defer failed", errorMessage(err)),
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
        "Loan returned",
        reversed > 0
          ? `Settlement reversed (${reversed} payment(s)); recovery reopened as active.`
          : "Recovery resumed as active."
      );
      setConfirmKind(null);
      setReturnFor(null);
      invalidate();
    },
    onError: (err) => toast.error("Return failed", errorMessage(err)),
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
      toast.success("Loan settled", `${result.settled} loan closed at full outstanding`);
      setConfirmKind(null);
      setSettleFor(null);
      invalidate();
    },
    onError: (err) => toast.error("Settlement failed", errorMessage(err)),
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
        "Monthly EMI run complete",
        `Schedules refreshed for ${refreshed} loan(s) across ${results.length} employee(s).`
      );
      setConfirmKind(null);
      invalidate();
    },
    onError: (err) => toast.error("Monthly EMI run failed", errorMessage(err)),
  });

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
          title: "Confirm create loan?",
          message: `Create a loan for ${employeeLabel(form.employee_id)} with principal ${money(
            form.principal
          )}, ${form.installments} EMI months at ${form.annual_rate}% (est. ${money(
            emiPreview.data?.monthly_installment ?? 0
          )}/month)?`,
          label: "Create loan",
        };
      case "edit":
        return {
          title: "Confirm edit loan?",
          message: `Revise loan #${editing?.loan_number ?? ""} for ${
            editing?.employee_name || "employee"
          } to ${editForm.installments} EMI months at ${editForm.annual_rate}% from ${fmtDate(
            editForm.first_due_date
          )} (est. ${money(editEmiPreview.data?.monthly_installment ?? 0)}/month on outstanding ${money(
            editing?.outstanding ?? 0
          )})?`,
          label: "Save loan edit",
        };
      case "pay":
        return {
          title: "Confirm payment?",
          message: `Post ${money(payment.amount)} on ${fmtDate(payment.paid_on)} against loan #${
            paymentFor?.loan_number ?? ""
          } (outstanding ${money(paymentFor?.outstanding ?? 0)})?`,
          label: "Post payment",
        };
      case "defer":
        return {
          title: "Confirm defer loan?",
          message: `Pause recovery on loan #${deferFor?.loan_number ?? ""} until ${fmtDate(
            deferDate
          )}? EMI schedule will restart from that date.`,
          label: "Defer loan",
        };
      case "return":
        return {
          title: returnFor?.status === "settled" ? "Confirm reopen settled loan?" : "Confirm return to active?",
          message:
            returnFor?.status === "settled"
              ? `Reopen settled loan #${returnFor?.loan_number ?? ""} for ${
                  returnFor?.employee_name || "employee"
                }? Posted settlement payments will be reversed (soft-deleted) and outstanding restored to ${money(
                  returnFor?.principal ?? 0
                )} — same pattern as ERPNext/Frappe cancel repayment then reopen.`
              : `Return deferred loan #${returnFor?.loan_number ?? ""} for ${
                  returnFor?.employee_name || "employee"
                } to active recovery${
                  returnFor?.deferred_until
                    ? ` (was deferred until ${fmtDate(returnFor.deferred_until)})`
                    : ""
                }?`,
          label: returnFor?.status === "settled" ? "Reopen loan" : "Return to active",
        };
      case "settle":
        return {
          title: "Confirm settle in full?",
          message: `Close loan #${settleFor?.loan_number ?? ""} by posting full outstanding ${money(
            settleFor?.outstanding ?? 0
          )} on ${fmtDate(settlePaidOn)}${settleRef ? ` (ref ${settleRef})` : ""}?`,
          label: "Settle in full",
        };
      case "delete":
        return {
          title: "Confirm delete loan?",
          message: `Remove loan #${deleting?.loan_number ?? ""} for ${
            deleting?.employee_name || "employee"
          }? Loans with payments cannot be deleted.`,
          label: "Delete",
          destructive: true,
        };
      case "emi-run":
        return {
          title: "Confirm monthly EMI run?",
          message: `Rebuild amortization schedules for ${activeEmployeeIds.length} employee(s) with active/deferred loans. This does not post payments.`,
          label: "Run monthly EMI",
        };
      default:
        return { title: "", message: "", label: "Confirm" };
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
    if (!form.employee_id || !(Number(form.principal) > 0) || !(Number(form.installments) > 0)) {
      toast.warning("Missing details", "Select an employee and enter principal and EMI months.");
      return;
    }
    setConfirmKind("create");
  };

  const requestEdit = () => {
    if (!editing || !(Number(editForm.installments) > 0)) {
      toast.warning("Missing details", "Enter valid EMI months.");
      return;
    }
    setConfirmKind("edit");
  };

  const requestPay = () => {
    if (!paymentFor || !(Number(payment.amount) > 0)) {
      toast.warning("Missing details", "Enter a payment amount.");
      return;
    }
    setConfirmKind("pay");
  };

  const requestDefer = () => {
    if (!deferFor || !deferDate) {
      toast.warning("Missing details", "Choose a defer-until date.");
      return;
    }
    setConfirmKind("defer");
  };

  const requestSettle = () => {
    if (!settleFor || Number(settleFor.outstanding) <= 0) {
      toast.warning("Nothing to settle", "Outstanding must be greater than zero.");
      return;
    }
    setConfirmKind("settle");
  };

  const copy = confirmCopy();

  return (
    <div className="animate-[fade-in_0.3s_ease-out]" data-testid="loans-page">
      <PageHeader
        title="Loans"
        subtitle="Excess recovery loans with reducing-balance EMI schedules"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              data-testid="btn-monthly-emi-run"
              disabled={activeEmployeeIds.length === 0 || monthlyRunMutation.isPending}
              onClick={() => setConfirmKind("emi-run")}
            >
              <Play size={15} /> Monthly EMI run
            </Button>
            <Button
              variant="gradient"
              data-testid="btn-new-loan"
              onClick={() => {
                setForm({
                  employee_id: "",
                  principal: "",
                  annual_rate: "0",
                  installments: "12",
                  first_due_date: todayLocal(),
                });
                setShowCreate(true);
              }}
            >
              <Plus size={15} /> New loan
            </Button>
          </div>
        }
      />

      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Active" value={stats.active} icon={<HandCoins size={20} />} tone="primary" />
        <StatCard label="Deferred" value={stats.deferred} icon={<CalendarClock size={20} />} tone="warning" />
        <StatCard label="Settled" value={stats.settled} icon={<Badge variant="success">✓</Badge>} tone="success" />
        <StatCard label="Outstanding" value={money(stats.outstanding)} icon={<Wallet size={20} />} tone="destructive" />
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>Loan register</CardTitle>
              <CardDescription>{filtered.length} loans</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-36">
                <option value="">All statuses</option>
                <option value="active">Active</option>
                <option value="deferred">Deferred</option>
                <option value="settled">Settled</option>
              </Select>
              <SearchInput value={search} onChange={setSearch} placeholder="Search loans…" className="w-52" />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loans.isPending ? (
            <TableSkeleton />
          ) : loans.isError ? (
            <ErrorState error={loans.error} onRetry={loans.refetch} />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<HandCoins size={22} />}
              title="No loans"
              message="Loans are created automatically when ticket excess is converted, or manually here."
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Loan</TH>
                  <TH>Employee</TH>
                  <TH>Principal</TH>
                  <TH>EMI</TH>
                  <TH>Outstanding</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((l) => (
                  <TR key={l.id}>
                    <TD className="font-mono font-semibold">#{l.loan_number ?? l.id.slice(0, 8)}</TD>
                    <TD>
                      <p className="font-semibold">{l.employee_name || "—"}</p>
                      <p className="text-xs text-[var(--color-muted-foreground)] font-mono">{l.employee_code}</p>
                    </TD>
                    <TD>{money(l.principal)}</TD>
                    <TD>
                      {money(l.monthly_installment)}
                      <span className="text-xs text-[var(--color-muted-foreground)]"> × {l.installments}</span>
                    </TD>
                    <TD className="font-bold">{money(l.outstanding)}</TD>
                    <TD>
                      <Badge variant={statusTone(l.status) as never}>{titleCase(l.status)}</Badge>
                      {l.deferred_until ? (
                        <p className="mt-0.5 text-[11px] text-[var(--color-muted-foreground)]">
                          until {fmtDate(l.deferred_until)}
                        </p>
                      ) : null}
                    </TD>
                    <TD>
                      <div className="flex flex-wrap justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setScheduleFor(l)}>
                          <ListOrdered size={14} /> Schedule
                        </Button>
                        {l.status === "active" || l.status === "deferred" ? (
                          <>
                            <Button variant="ghost" size="sm" onClick={() => openEdit(l)}>
                              <Pencil size={14} /> Edit
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setPayment({
                                  amount: String(l.monthly_installment),
                                  paid_on: todayLocal(),
                                });
                                setPaymentFor(l);
                              }}
                            >
                              <Wallet size={14} /> Pay
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              data-testid={`btn-settle-loan-${l.id}`}
                              onClick={() => {
                                setSettlePaidOn(todayLocal());
                                setSettleRef("");
                                setSettleFor(l);
                              }}
                            >
                              <BadgeCheck size={14} /> Settle
                            </Button>
                          </>
                        ) : null}
                        {l.status === "active" ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setDeferDate("");
                              setDeferFor(l);
                            }}
                          >
                            <CalendarClock size={14} /> Defer
                          </Button>
                        ) : null}
                        {l.status === "deferred" || l.status === "settled" ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setReturnFor(l);
                              setConfirmKind("return");
                            }}
                          >
                            <RotateCcw size={14} /> {l.status === "settled" ? "Reopen" : "Return"}
                          </Button>
                        ) : null}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setDeleting(l);
                            setConfirmKind("delete");
                          }}
                          title="Delete"
                        >
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

      <Dialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        title="New loan"
        description="Manual loan with a reducing-balance EMI schedule"
        footer={
          <>
            <Button variant="ghost" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button variant="gradient" onClick={requestCreate}>
              Review & create
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-4">
          <Field label="Employee" className="col-span-2">
            <EmployeeCombobox
              employees={employees.data ?? []}
              value={form.employee_id}
              placeholder="Type name — e.g. A…"
              onChange={(id) => setForm((f) => ({ ...f, employee_id: id }))}
            />
          </Field>
          <Field label="Principal">
            <Input
              type="number"
              min="0"
              step="0.01"
              value={form.principal}
              onChange={(e) => setForm((f) => ({ ...f, principal: e.target.value }))}
            />
          </Field>
          <Field label="Annual rate %">
            <Input
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={form.annual_rate}
              onChange={(e) => setForm((f) => ({ ...f, annual_rate: e.target.value }))}
            />
          </Field>
          <Field label="EMI months">
            <Input
              type="number"
              min="1"
              max="600"
              value={form.installments}
              onChange={(e) => setForm((f) => ({ ...f, installments: e.target.value }))}
            />
          </Field>
          <Field label="First due date">
            <Input
              type="date"
              value={form.first_due_date}
              onChange={(e) => setForm((f) => ({ ...f, first_due_date: e.target.value }))}
            />
          </Field>
        </div>
        {emiPreview.data ? (
          <p className="mt-4 rounded-[var(--radius-sm)] bg-[var(--color-primary-muted)] px-3 py-2 text-sm font-semibold text-[var(--color-primary)]">
            Monthly installment: {money(emiPreview.data.monthly_installment)}
          </p>
        ) : null}
      </Dialog>

      <Dialog
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing ? `Edit loan #${editing.loan_number ?? editing.id.slice(0, 8)}` : "Edit loan"}
        description={
          editing
            ? `${editing.employee_name || editing.employee_code || "Employee"} · outstanding ${money(
                editing.outstanding
              )}`
            : undefined
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button variant="gradient" onClick={requestEdit}>
              Review & save
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-4">
          <Field label="Annual rate %">
            <Input
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={editForm.annual_rate}
              onChange={(e) => setEditForm((f) => ({ ...f, annual_rate: e.target.value }))}
            />
          </Field>
          <Field label="EMI months">
            <Input
              type="number"
              min="1"
              max="600"
              value={editForm.installments}
              onChange={(e) => setEditForm((f) => ({ ...f, installments: e.target.value }))}
            />
          </Field>
          <Field label="First due date" className="col-span-2">
            <Input
              type="date"
              value={editForm.first_due_date}
              onChange={(e) => setEditForm((f) => ({ ...f, first_due_date: e.target.value }))}
            />
          </Field>
        </div>
        {editEmiPreview.data ? (
          <p className="mt-4 rounded-[var(--radius-sm)] bg-[var(--color-primary-muted)] px-3 py-2 text-sm font-semibold text-[var(--color-primary)]">
            Revised monthly installment: {money(editEmiPreview.data.monthly_installment)}
          </p>
        ) : null}
        <p className="mt-3 text-xs text-[var(--color-muted-foreground)]">
          Edit revises remaining recovery terms on the outstanding balance and rebuilds the EMI schedule.
        </p>
      </Dialog>

      <Dialog
        open={Boolean(scheduleFor)}
        onClose={() => setScheduleFor(null)}
        title={`Amortization schedule — #${scheduleFor?.loan_number ?? ""}`}
        description={
          scheduleFor
            ? `${money(scheduleFor.principal)} at ${scheduleFor.annual_rate}% over ${scheduleFor.installments} months`
            : undefined
        }
        wide
      >
        {schedule.isPending ? (
          <TableSkeleton />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>#</TH>
                <TH>Due</TH>
                <TH>Opening</TH>
                <TH>Principal</TH>
                <TH>Interest</TH>
                <TH>Payment</TH>
                <TH>Closing</TH>
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
                  <TD>{money(row.closing_balance)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Dialog>

      <Dialog
        open={Boolean(paymentFor)}
        onClose={() => setPaymentFor(null)}
        title="Post payment"
        description={paymentFor ? `Outstanding: ${money(paymentFor.outstanding)}` : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPaymentFor(null)}>
              Cancel
            </Button>
            <Button variant="gradient" onClick={requestPay}>
              Review & post
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-4">
          <Field label="Amount">
            <Input
              type="number"
              min="0"
              step="0.01"
              value={payment.amount}
              onChange={(e) => setPayment((p) => ({ ...p, amount: e.target.value }))}
            />
          </Field>
          <Field label="Paid on">
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
        title="Settle loan"
        description={
          settleFor
            ? `Close #${settleFor.loan_number ?? ""} by paying the full outstanding ${money(settleFor.outstanding)}.`
            : undefined
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setSettleFor(null)}>
              Cancel
            </Button>
            <Button variant="gradient" onClick={requestSettle}>
              Review & settle
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-4">
          <Field label="Paid on">
            <Input type="date" value={settlePaidOn} onChange={(e) => setSettlePaidOn(e.target.value)} />
          </Field>
          <Field label="Reference">
            <Input value={settleRef} onChange={(e) => setSettleRef(e.target.value)} placeholder="Optional" />
          </Field>
        </div>
      </Dialog>

      <Dialog
        open={Boolean(deferFor)}
        onClose={() => setDeferFor(null)}
        title="Defer loan"
        description="Pause recovery until a future date"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeferFor(null)}>
              Cancel
            </Button>
            <Button variant="gradient" onClick={requestDefer}>
              Review & defer
            </Button>
          </>
        }
      >
        <Field label="Deferred until">
          <Input type="date" value={deferDate} onChange={(e) => setDeferDate(e.target.value)} />
        </Field>
      </Dialog>

      <ConfirmDialog
        open={Boolean(confirmKind)}
        onClose={() => setConfirmKind(null)}
        onConfirm={runConfirmedAction}
        title={copy.title}
        message={copy.message}
        confirmLabel={confirmBusy ? "Working…" : copy.label}
        destructive={copy.destructive}
        busy={confirmBusy}
      />
    </div>
  );
}

export default LoansPage;
