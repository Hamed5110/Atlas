"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Banknote, CircleCheck, Inbox, Plus, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { AirportCombobox } from "@/components/airport-combobox";
import { EmployeeCombobox } from "@/components/employee-combobox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { EmptyState, ErrorState, PageHeader, SearchInput, StatCard } from "@/components/ui/primitives";
import { TableSkeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { fmtDate, statusTone, titleCase, todayLocal } from "@/lib/format";
import type { Employee, EssRequest } from "@/lib/types";

function EssPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    employee_id: "",
    request_type: "airfare",
    travel_date: todayLocal(),
    origin_code: "",
    destination_code: "",
    notes: "",
  });

  const requests = useQuery({
    queryKey: ["ess-requests"],
    queryFn: () => api<EssRequest[]>("/ess/requests"),
  });
  const employees = useQuery({
    queryKey: ["employees", "all"],
    queryFn: () => api<Employee[]>("/employees?limit=500"),
  });

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return requests.data ?? [];
    return (requests.data ?? []).filter((r) =>
      [r.employee_name, r.employee_code, r.request_type, r.status]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(term))
    );
  }, [requests.data, search]);

  const stats = useMemo(() => {
    const all = requests.data ?? [];
    return {
      submitted: all.filter((r) => r.status === "submitted").length,
      approved: all.filter((r) => r.status === "approved").length,
      rejected: all.filter((r) => r.status === "rejected").length,
      paid: all.filter((r) => r.status === "paid").length,
    };
  }, [requests.data]);

  const createMutation = useMutation({
    mutationFn: () =>
      api("/ess/requests", {
        method: "POST",
        body: {
          employee_id: form.employee_id,
          request_type: form.request_type,
          travel_date: form.travel_date,
          origin_code: form.origin_code.toUpperCase(),
          destination_code: form.destination_code.toUpperCase(),
          notes: form.notes,
        },
      }),
    onSuccess: () => {
      toast.success("Request submitted");
      setShowForm(false);
      queryClient.invalidateQueries({ queryKey: ["ess-requests"] });
    },
    onError: (err) => toast.error("Submit failed", err instanceof Error ? err.message : undefined),
  });

  const statusMutation = useMutation({
    mutationFn: ({ request, next }: { request: EssRequest; next: string }) =>
      api(`/ess/requests/${request.id}/status`, {
        method: "PATCH",
        body: { status: next },
        headers: { "If-Match": String(request.version) },
      }),
    onSuccess: (_d, vars) => {
      toast.success(`Request ${vars.next}`);
      queryClient.invalidateQueries({ queryKey: ["ess-requests"] });
    },
    onError: (err) => toast.error("Update failed", err instanceof Error ? err.message : undefined),
  });

  return (
    <div className="animate-[fade-in_0.3s_ease-out]">
      <PageHeader
        title="ESS Requests"
        subtitle="Employee self-service airfare, ticket, and loan requests"
        actions={
          <Button variant="gradient" onClick={() => setShowForm(true)}>
            <Plus size={15} /> New request
          </Button>
        }
      />

      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Awaiting review" value={stats.submitted} icon={<Inbox size={20} />} tone="warning" />
        <StatCard label="Approved" value={stats.approved} icon={<CircleCheck size={20} />} tone="success" />
        <StatCard label="Rejected" value={stats.rejected} icon={<XCircle size={20} />} tone="destructive" />
        <StatCard label="Paid" value={stats.paid} icon={<Banknote size={20} />} tone="primary" />
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>Request queue</CardTitle>
              <CardDescription>submitted → approved → paid</CardDescription>
            </div>
            <SearchInput value={search} onChange={setSearch} placeholder="Search requests…" className="w-64" />
          </div>
        </CardHeader>
        <CardContent>
          {requests.isPending ? (
            <TableSkeleton />
          ) : requests.isError ? (
            <ErrorState error={requests.error} onRetry={requests.refetch} />
          ) : filtered.length === 0 ? (
            <EmptyState icon={<Inbox size={22} />} title="No requests" message="Self-service requests will appear here for review." />
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {filtered.map((r) => (
                <div key={r.id} className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white p-4 shadow-[var(--shadow-card)]">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold">{r.employee_name || r.employee_code || "Employee"}</p>
                      <p className="text-xs text-[var(--color-muted-foreground)]">
                        {titleCase(r.request_type)} · {fmtDate(r.travel_date)}
                      </p>
                    </div>
                    <Badge variant={statusTone(r.status) as never}>{titleCase(r.status)}</Badge>
                  </div>
                  <div className="mt-3 flex items-center gap-2 rounded-[var(--radius-sm)] bg-[var(--color-secondary)] px-3 py-2">
                    <span className="font-mono text-sm font-bold">{r.origin_code}</span>
                    <ArrowRight size={14} className="text-[var(--color-muted-foreground)]" />
                    <span className="font-mono text-sm font-bold">{r.destination_code}</span>
                  </div>
                  {r.notes ? (
                    <p className="mt-2 line-clamp-2 text-xs text-[var(--color-muted-foreground)]">{r.notes}</p>
                  ) : null}
                  <div className="mt-3 flex gap-2 border-t border-[var(--color-border)] pt-3">
                    {r.status === "submitted" ? (
                      <>
                        <Button size="sm" variant="success" disabled={statusMutation.isPending} onClick={() => statusMutation.mutate({ request: r, next: "approved" })}>
                          <CircleCheck size={13} /> Approve
                        </Button>
                        <Button size="sm" variant="destructive" disabled={statusMutation.isPending} onClick={() => statusMutation.mutate({ request: r, next: "rejected" })}>
                          <XCircle size={13} /> Reject
                        </Button>
                      </>
                    ) : null}
                    {r.status === "approved" ? (
                      <Button size="sm" disabled={statusMutation.isPending} onClick={() => statusMutation.mutate({ request: r, next: "paid" })}>
                        <Banknote size={13} /> Mark paid
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={showForm}
        onClose={() => setShowForm(false)}
        title="New ESS request"
        description="Submit an airfare request on behalf of an employee"
        footer={
          <>
            <Button variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button variant="gradient" disabled={createMutation.isPending} onClick={() => createMutation.mutate()}>
              {createMutation.isPending ? "Submitting…" : "Submit request"}
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
          <Field label="Request type">
            <Select value={form.request_type} onChange={(e) => setForm((f) => ({ ...f, request_type: e.target.value }))}>
              <option value="airfare">Airfare</option>
              <option value="ticket">Ticket</option>
              <option value="loan">Loan</option>
            </Select>
          </Field>
          <Field label="Travel date">
            <Input type="date" value={form.travel_date} onChange={(e) => setForm((f) => ({ ...f, travel_date: e.target.value }))} />
          </Field>
          <Field label="Origin">
            <AirportCombobox
              value={form.origin_code}
              placeholder="Search DXB, Dubai…"
              onChange={(code) => setForm((f) => ({ ...f, origin_code: code }))}
            />
          </Field>
          <Field label="Destination">
            <AirportCombobox
              value={form.destination_code}
              placeholder="Search COK, Karachi…"
              onChange={(code) => setForm((f) => ({ ...f, destination_code: code }))}
            />
          </Field>
          <Field label="Notes" className="col-span-2">
            <Textarea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </Field>
        </div>
      </Dialog>
    </div>
  );
}

export default EssPage;
