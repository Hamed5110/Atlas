import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, SlidersHorizontal, Trash2 } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { EmptyState, ErrorState, PageHeader } from "@/components/ui/primitives";
import { TableSkeleton } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { fmtDate, money, titleCase } from "@/lib/format";
import type { EntitlementRate } from "@/lib/types";

const SCOPE_ORDER = ["employee", "pay_group", "company", "global"];

export function RatesPage() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [deleting, setDeleting] = useState<EntitlementRate | null>(null);
  const [form, setForm] = useState({
    scope_type: "global",
    scope_id: "",
    amount: "",
    effective_from: new Date().toISOString().slice(0, 10),
    effective_to: "",
    cap_amount: "",
  });

  const rates = useQuery({
    queryKey: ["entitlement-rates"],
    queryFn: () => api<EntitlementRate[]>("/entitlement-rates"),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      api("/entitlement-rates", {
        method: "POST",
        body: {
          scope_type: form.scope_type,
          scope_id: form.scope_id.trim(),
          amount: Number(form.amount),
          effective_from: form.effective_from,
          effective_to: form.effective_to || null,
          cap_amount: form.cap_amount ? Number(form.cap_amount) : null,
        },
      }),
    onSuccess: () => {
      toast.success("Rate created");
      setShowForm(false);
      queryClient.invalidateQueries({ queryKey: ["entitlement-rates"] });
    },
    onError: (err) => toast.error("Save failed", err instanceof Error ? err.message : undefined),
  });

  const deleteMutation = useMutation({
    mutationFn: (r: EntitlementRate) =>
      api(`/entitlement-rates/${r.id}`, {
        method: "DELETE",
        headers: { "If-Match": String(r.version) },
      }),
    onSuccess: () => {
      toast.success("Rate deleted");
      setDeleting(null);
      queryClient.invalidateQueries({ queryKey: ["entitlement-rates"] });
    },
    onError: (err) => toast.error("Delete failed", err instanceof Error ? err.message : undefined),
  });

  const sorted = [...(rates.data ?? [])].sort(
    (a, b) => SCOPE_ORDER.indexOf(a.scope_type) - SCOPE_ORDER.indexOf(b.scope_type)
  );

  return (
    <div className="animate-[fade-in_0.3s_ease-out]">
      <PageHeader
        title="Entitlement Rates"
        subtitle="Effective-dated rate hierarchy: employee → pay group → company → global"
        actions={
          <Button variant="gradient" onClick={() => setShowForm(true)}>
            <Plus size={15} /> New rate
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Rate schedule</CardTitle>
          <CardDescription>The most specific active rate wins during calculation</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {rates.isPending ? (
            <TableSkeleton />
          ) : rates.isError ? (
            <ErrorState error={rates.error} onRetry={rates.refetch} />
          ) : sorted.length === 0 ? (
            <EmptyState icon={<SlidersHorizontal size={22} />} title="No rates configured" message="Add at least a global rate for entitlement calculations." />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Scope</TH>
                  <TH>Target</TH>
                  <TH>Amount</TH>
                  <TH>Cap</TH>
                  <TH>Effective</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {sorted.map((r) => {
                  const now = new Date().toISOString().slice(0, 10);
                  const active = r.effective_from <= now && (!r.effective_to || r.effective_to >= now);
                  return (
                    <TR key={r.id}>
                      <TD>
                        <Badge variant={r.scope_type === "employee" ? "default" : "secondary"}>
                          {titleCase(r.scope_type)}
                        </Badge>
                      </TD>
                      <TD className="font-mono text-xs">{r.scope_id || "—"}</TD>
                      <TD className="font-bold">{money(r.amount)}</TD>
                      <TD>{r.cap_amount ? money(r.cap_amount) : "—"}</TD>
                      <TD>
                        {fmtDate(r.effective_from)} → {r.effective_to ? fmtDate(r.effective_to) : "open"}
                      </TD>
                      <TD>
                        <Badge variant={active ? "success" : "secondary"}>
                          {active ? "Active" : "Inactive"}
                        </Badge>
                      </TD>
                      <TD className="text-right">
                        <Button variant="ghost" size="icon" onClick={() => setDeleting(r)} title="Delete">
                          <Trash2 size={15} className="text-[var(--color-destructive)]" />
                        </Button>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={showForm}
        onClose={() => setShowForm(false)}
        title="New entitlement rate"
        description="Effective-dated rate with an optional payout cap"
        footer={
          <>
            <Button variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button variant="gradient" disabled={createMutation.isPending} onClick={() => createMutation.mutate()}>
              {createMutation.isPending ? "Saving…" : "Save rate"}
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-4">
          <Field label="Scope">
            <Select value={form.scope_type} onChange={(e) => setForm((f) => ({ ...f, scope_type: e.target.value }))}>
              <option value="global">Global</option>
              <option value="company">Company</option>
              <option value="pay_group">Pay group</option>
              <option value="employee">Employee</option>
            </Select>
          </Field>
          <Field label="Scope target" hint="Blank for global; code/ID otherwise">
            <Input value={form.scope_id} onChange={(e) => setForm((f) => ({ ...f, scope_id: e.target.value }))} placeholder="e.g. MONTHLY" disabled={form.scope_type === "global"} />
          </Field>
          <Field label="Amount">
            <Input type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
          </Field>
          <Field label="Cap amount (optional)">
            <Input type="number" min="0" step="0.01" value={form.cap_amount} onChange={(e) => setForm((f) => ({ ...f, cap_amount: e.target.value }))} />
          </Field>
          <Field label="Effective from">
            <Input type="date" value={form.effective_from} onChange={(e) => setForm((f) => ({ ...f, effective_from: e.target.value }))} />
          </Field>
          <Field label="Effective to (optional)">
            <Input type="date" value={form.effective_to} onChange={(e) => setForm((f) => ({ ...f, effective_to: e.target.value }))} />
          </Field>
        </div>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && deleteMutation.mutate(deleting)}
        title="Delete rate"
        message={`Delete the ${deleting?.scope_type} rate of ${money(deleting?.amount)}?`}
        confirmLabel="Delete"
        destructive
        busy={deleteMutation.isPending}
      />
    </div>
  );
}
