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
  Plane,
  Send,
  Ticket as TicketIcon,
  Wallet,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { api, ApiError } from "@/lib/api";
import { fmtDate, initials, money, num, statusTone, titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Employee, Ticket } from "@/lib/types";

type PreviewData = Record<string, unknown>;

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

export function AllocationPage() {
  const queryClient = useQueryClient();
  const [employeeId, setEmployeeId] = useState("");
  const [travelDate, setTravelDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [amount, setAmount] = useState("");
  const [excessOption, setExcessOption] = useState<string>("");
  const [tenure, setTenure] = useState("12");
  const [notes, setNotes] = useState("");
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [ticketSearch, setTicketSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

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

  const previewMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      api<PreviewData>("/allocations/preview", { method: "POST", body: payload }),
    onSuccess: (data) => setPreview(data),
    onError: (err) => {
      setPreview(null);
      if (!(err instanceof ApiError && err.code === "settlement_required")) {
        toast.error("Preview failed", err instanceof Error ? err.message : undefined);
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
    onError: (err) =>
      toast.error("Issue failed", err instanceof Error ? err.message : undefined),
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
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (err) =>
      toast.error("Workflow failed", err instanceof Error ? err.message : undefined),
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

  const issue = () => {
    const amt = Number(amount);
    if (!employeeId || !Number.isFinite(amt) || amt <= 0) {
      toast.warning("Missing details", "Select an employee and enter the ticket amount.");
      return;
    }
    issueMutation.mutate({
      employee_id: employeeId,
      as_of_date: travelDate,
      requested_ticket_amount: amt,
      excess_option: excessOption || undefined,
      tenure_months: excessOption === "CONVERT_TO_LOAN" ? Number(tenure) : undefined,
      origin_code: origin || "ORG",
      destination_code: destination || "DST",
      notes,
    });
  };

  const entitlement = preview ? Number(preview.final_entitlement_amount ?? 0) : 0;
  const requested = Number(amount) || 0;
  const excess = Math.max(0, requested - entitlement);
  const needsSettlement = Boolean(preview && requested > 0 && excess > 0);

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
    <div className="animate-[fade-in_0.3s_ease-out]">
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
              <Select
                value={employeeId}
                onChange={(e) => {
                  setEmployeeId(e.target.value);
                  setPreview(null);
                }}
              >
                <option value="">Select employee…</option>
                {(employees.data ?? [])
                  .filter((e) => e.active)
                  .map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.code} — {e.full_name}
                    </option>
                  ))}
              </Select>
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
                  onChange={(e) => setAmount(e.target.value)}
                  onBlur={() => runPreview()}
                />
              </Field>
              <Field label="Origin">
                <Input
                  maxLength={3}
                  placeholder="DXB"
                  value={origin}
                  onChange={(e) => setOrigin(e.target.value.toUpperCase())}
                  className="font-mono uppercase"
                />
              </Field>
              <Field label="Destination">
                <Input
                  maxLength={3}
                  placeholder="COK"
                  value={destination}
                  onChange={(e) => setDestination(e.target.value.toUpperCase())}
                  className="font-mono uppercase"
                />
              </Field>
            </div>

            <Button
              variant="outline"
              className="w-full"
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
            <div className="space-y-4 animate-[slide-up_0.3s_cubic-bezier(0.16,1,0.3,1)]">
              <div className="gradient-hero relative overflow-hidden rounded-[var(--radius-lg)] p-6 text-white shadow-lg">
                <Plane
                  className="absolute -right-6 -top-6 h-36 w-36 opacity-10"
                  strokeWidth={1}
                />
                <p className="text-xs font-bold uppercase tracking-[0.14em] opacity-80">
                  Airfare entitlement
                </p>
                <p className="mt-1 text-4xl font-extrabold tracking-tight">
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
                <Card>
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
                        {EXCESS_OPTIONS.map(({ value, label, icon: Icon, blurb }) => (
                          <button
                            key={value}
                            onClick={() => {
                              setExcessOption(value);
                              runPreview({ excess_option: value });
                            }}
                            className={cn(
                              "flex items-start gap-3 rounded-[var(--radius-md)] border-2 p-3 text-left transition-all cursor-pointer",
                              excessOption === value
                                ? "border-[var(--color-primary)] bg-[var(--color-primary-muted)] shadow-sm"
                                : "border-[var(--color-border)] bg-white hover:border-[hsl(243_75%_75%)]"
                            )}
                          >
                            <div
                              className={cn(
                                "flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)]",
                                excessOption === value
                                  ? "gradient-hero text-white"
                                  : "bg-[var(--color-secondary)] text-[var(--color-muted-foreground)]"
                              )}
                            >
                              <Icon size={17} />
                            </div>
                            <div>
                              <p className="text-sm font-bold">{label}</p>
                              <p className="text-xs text-[var(--color-muted-foreground)]">{blurb}</p>
                            </div>
                          </button>
                        ))}
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
                  const excessAmt = Math.max(0, Number(t.ticket_cost) - Number(t.entitlement));
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
                      {actions.length ? (
                        <div className="mt-3 flex gap-2 border-t border-[var(--color-border)] pt-3">
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
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
