import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, HandCoins, ListOrdered, Plus, Wallet } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { EmptyState, ErrorState, PageHeader, SearchInput, StatCard } from "@/components/ui/primitives";
import { TableSkeleton } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { fmtDate, money, statusTone, titleCase } from "@/lib/format";
import type { Employee, Loan, LoanInstallment } from "@/lib/types";

export function LoansPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [scheduleFor, setScheduleFor] = useState<Loan | null>(null);
  const [paymentFor, setPaymentFor] = useState<Loan | null>(null);
  const [deferFor, setDeferFor] = useState<Loan | null>(null);

  const [form, setForm] = useState({
    employee_id: "",
    principal: "",
    annual_rate: "0",
    installments: "12",
    first_due_date: new Date().toISOString().slice(0, 10),
  });
  const [payment, setPayment] = useState({ amount: "", paid_on: new Date().toISOString().slice(0, 10) });
  const [deferDate, setDeferDate] = useState("");

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

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["loans"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
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
      setShowCreate(false);
      invalidate();
    },
    onError: (err) => toast.error("Create failed", err instanceof Error ? err.message : undefined),
  });

  const paymentMutation = useMutation({
    mutationFn: () =>
      api(`/loans/${paymentFor!.id}/payments`, {
        method: "POST",
        body: { amount: Number(payment.amount), paid_on: payment.paid_on },
      }),
    onSuccess: () => {
      toast.success("Payment posted");
      setPaymentFor(null);
      invalidate();
    },
    onError: (err) => toast.error("Payment failed", err instanceof Error ? err.message : undefined),
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
      setDeferFor(null);
      invalidate();
    },
    onError: (err) => toast.error("Defer failed", err instanceof Error ? err.message : undefined),
  });

  return (
    <div className="animate-[fade-in_0.3s_ease-out]">
      <PageHeader
        title="Loans"
        subtitle="Excess recovery loans with reducing-balance EMI schedules"
        actions={
          <Button variant="gradient" onClick={() => setShowCreate(true)}>
            <Plus size={15} /> New loan
          </Button>
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
            <EmptyState icon={<HandCoins size={22} />} title="No loans" message="Loans are created automatically when ticket excess is converted, or manually here." />
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
                        <p className="mt-0.5 text-[11px] text-[var(--color-muted-foreground)]">until {fmtDate(l.deferred_until)}</p>
                      ) : null}
                    </TD>
                    <TD>
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setScheduleFor(l)}>
                          <ListOrdered size={14} /> Schedule
                        </Button>
                        {l.status === "active" ? (
                          <>
                            <Button variant="ghost" size="sm" onClick={() => { setPayment({ amount: String(l.monthly_installment), paid_on: new Date().toISOString().slice(0, 10) }); setPaymentFor(l); }}>
                              <Wallet size={14} /> Pay
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => { setDeferDate(""); setDeferFor(l); }}>
                              <CalendarClock size={14} /> Defer
                            </Button>
                          </>
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
        open={showCreate}
        onClose={() => setShowCreate(false)}
        title="New loan"
        description="Manual loan with a reducing-balance EMI schedule"
        footer={
          <>
            <Button variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button variant="gradient" disabled={createMutation.isPending} onClick={() => createMutation.mutate()}>
              {createMutation.isPending ? "Creating…" : "Create loan"}
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-4">
          <Field label="Employee" className="col-span-2">
            <Select value={form.employee_id} onChange={(e) => setForm((f) => ({ ...f, employee_id: e.target.value }))}>
              <option value="">Select employee…</option>
              {(employees.data ?? []).filter((e) => e.active).map((e) => (
                <option key={e.id} value={e.id}>{e.code} — {e.full_name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Principal">
            <Input type="number" min="0" step="0.01" value={form.principal} onChange={(e) => setForm((f) => ({ ...f, principal: e.target.value }))} />
          </Field>
          <Field label="Annual rate %">
            <Input type="number" min="0" max="100" step="0.01" value={form.annual_rate} onChange={(e) => setForm((f) => ({ ...f, annual_rate: e.target.value }))} />
          </Field>
          <Field label="Installments">
            <Input type="number" min="1" max="600" value={form.installments} onChange={(e) => setForm((f) => ({ ...f, installments: e.target.value }))} />
          </Field>
          <Field label="First due date">
            <Input type="date" value={form.first_due_date} onChange={(e) => setForm((f) => ({ ...f, first_due_date: e.target.value }))} />
          </Field>
        </div>
        {emiPreview.data ? (
          <p className="mt-4 rounded-[var(--radius-sm)] bg-[var(--color-primary-muted)] px-3 py-2 text-sm font-semibold text-[var(--color-primary)]">
            Monthly installment: {money(emiPreview.data.monthly_installment)}
          </p>
        ) : null}
      </Dialog>

      <Dialog
        open={Boolean(scheduleFor)}
        onClose={() => setScheduleFor(null)}
        title={`Amortization schedule — #${scheduleFor?.loan_number ?? ""}`}
        description={scheduleFor ? `${money(scheduleFor.principal)} at ${scheduleFor.annual_rate}% over ${scheduleFor.installments} months` : undefined}
        wide
      >
        {schedule.isPending ? (
          <TableSkeleton />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>#</TH><TH>Due</TH><TH>Opening</TH><TH>Principal</TH><TH>Interest</TH><TH>Payment</TH><TH>Closing</TH>
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
            <Button variant="ghost" onClick={() => setPaymentFor(null)}>Cancel</Button>
            <Button variant="gradient" disabled={paymentMutation.isPending} onClick={() => paymentMutation.mutate()}>
              {paymentMutation.isPending ? "Posting…" : "Post payment"}
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-4">
          <Field label="Amount">
            <Input type="number" min="0" step="0.01" value={payment.amount} onChange={(e) => setPayment((p) => ({ ...p, amount: e.target.value }))} />
          </Field>
          <Field label="Paid on">
            <Input type="date" value={payment.paid_on} onChange={(e) => setPayment((p) => ({ ...p, paid_on: e.target.value }))} />
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
            <Button variant="ghost" onClick={() => setDeferFor(null)}>Cancel</Button>
            <Button variant="gradient" disabled={!deferDate || deferMutation.isPending} onClick={() => deferMutation.mutate()}>
              {deferMutation.isPending ? "Deferring…" : "Defer loan"}
            </Button>
          </>
        }
      >
        <Field label="Deferred until">
          <Input type="date" value={deferDate} onChange={(e) => setDeferDate(e.target.value)} />
        </Field>
      </Dialog>
    </div>
  );
}
