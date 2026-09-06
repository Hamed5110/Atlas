"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/primitives";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { api, errorMessage } from "@/lib/api";

interface EntitlementRule {
  id: string;
  grade: string;
  location: string;
  family_status: string;
  los_band_from: string | number;
  los_band_to: string | number;
  annual_amount: string | number;
  is_active: boolean;
  entitlement_type_id: string;
}

const emptyForm = {
  grade: "",
  location: "",
  family_status: "",
  los_band_from: "0",
  los_band_to: "99",
  annual_amount: "150",
  is_active: true,
};

export default function EntitlementRulesPage() {
  const qc = useQueryClient();
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<EntitlementRule | null>(null);

  const rules = useQuery({
    queryKey: ["entitlement-rules"],
    queryFn: () => api<EntitlementRule[]>("/entitlement/rules"),
  });

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        grade: form.grade,
        location: form.location,
        family_status: form.family_status,
        los_band_from: Number(form.los_band_from),
        los_band_to: Number(form.los_band_to),
        annual_amount: Number(form.annual_amount),
        is_active: form.is_active,
      };
      if (editingId) {
        return api(`/entitlement/rules/${editingId}`, { method: "PUT", body });
      }
      return api("/entitlement/rules", { method: "POST", body });
    },
    onSuccess: () => {
      toast.success(editingId ? "Rule updated (effective-dated)" : "Rule created");
      setForm(emptyForm);
      setEditingId(null);
      qc.invalidateQueries({ queryKey: ["entitlement-rules"] });
    },
    onError: (err) => toast.error("Save failed", errorMessage(err)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/entitlement/rules/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Rule deleted");
      setDeleting(null);
      qc.invalidateQueries({ queryKey: ["entitlement-rules"] });
    },
    onError: (err) => toast.error("Delete failed", errorMessage(err)),
  });

  return (
    <div className="animate-[fade-in_0.3s_ease-out]" data-testid="page-entitlement-rules">
      <PageHeader
        title="Entitlement rule matrix"
        subtitle="Advanced / Phase 3 candidate — Grade × Location × Family × LOS. Prefer Entitlement Rates for Phase 1–2."
        actions={
          <Button
            variant="gradient"
            data-testid="btn-add-rule"
            onClick={() => {
              setEditingId(null);
              setForm(emptyForm);
            }}
          >
            <Plus size={15} /> Add rule
          </Button>
        }
      />

      <Card className="mb-4 border-[var(--color-warning)]/40 bg-[hsl(38_92%_50%/0.08)]" data-testid="rules-deprecated-banner">
        <CardContent className="p-4 text-sm">
          Base airfare uses the <strong>Entitlement Rates</strong> hierarchy (employee → pay group → company →
          global). This matrix is kept for advanced experiments only — see{" "}
          <code className="text-xs">docs/ENTITLEMENT_RATE_VS_RULE.md</code>.
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>{editingId ? "Edit rule" : "New rule"}</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <Field label="Grade">
              <Select
                data-testid="select-grade"
                value={form.grade}
                onChange={(e) => setForm((f) => ({ ...f, grade: e.target.value }))}
              >
                <option value="">Any</option>
                <option value="A">A</option>
                <option value="B">B</option>
                <option value="C">C</option>
              </Select>
            </Field>
            <Field label="Location">
              <Input
                data-testid="select-location"
                value={form.location}
                onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
                placeholder="Branch / city"
              />
            </Field>
            <Field label="Family status">
              <Select
                data-testid="select-family-status"
                value={form.family_status}
                onChange={(e) => setForm((f) => ({ ...f, family_status: e.target.value }))}
              >
                <option value="">Any</option>
                <option value="Single">Single</option>
                <option value="Married">Married</option>
              </Select>
            </Field>
            <Field label="Entitlement type">
              <Select data-testid="select-entitlement-type" defaultValue="AIRFARE">
                <option value="AIRFARE">Airfare</option>
              </Select>
            </Field>
            <Field label="LOS from">
              <Input
                data-testid="input-los-band-from"
                type="number"
                value={form.los_band_from}
                onChange={(e) => setForm((f) => ({ ...f, los_band_from: e.target.value }))}
              />
            </Field>
            <Field label="LOS to">
              <Input
                data-testid="input-los-band-to"
                type="number"
                value={form.los_band_to}
                onChange={(e) => setForm((f) => ({ ...f, los_band_to: e.target.value }))}
              />
            </Field>
            <Field label="Annual amount" className="col-span-2">
              <Input
                data-testid="input-annual-amount"
                type="number"
                step="0.01"
                value={form.annual_amount}
                onChange={(e) => setForm((f) => ({ ...f, annual_amount: e.target.value }))}
              />
            </Field>
            <label className="col-span-2 flex items-center gap-2 text-sm" data-testid="toggle-is-active">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
              />
              Active
            </label>
            <div className="col-span-2 flex gap-2">
              <Button variant="ghost" data-testid="btn-cancel-rule" onClick={() => setForm(emptyForm)}>
                Cancel
              </Button>
              <Button variant="gradient" data-testid="btn-save-rule" disabled={save.isPending} onClick={() => save.mutate()}>
                {save.isPending ? "Saving…" : "Save rule"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="xl:col-span-3">
          <CardContent className="p-0">
            <Table data-testid="table-rules-matrix">
              <THead>
                <TR>
                  <TH>Grade</TH>
                  <TH>Location</TH>
                  <TH>Family</TH>
                  <TH>LOS</TH>
                  <TH>Amount</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {(rules.data ?? []).map((r) => (
                  <TR key={r.id} data-testid={`row-rule-${r.id}`}>
                    <TD>{r.grade || "—"}</TD>
                    <TD>{r.location || "—"}</TD>
                    <TD>{r.family_status || "—"}</TD>
                    <TD>
                      {r.los_band_from}–{r.los_band_to}
                    </TD>
                    <TD className="font-semibold">{Number(r.annual_amount).toFixed(2)}</TD>
                    <TD>
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          data-testid="btn-edit-rule"
                          onClick={() => {
                            setEditingId(r.id);
                            setForm({
                              grade: r.grade,
                              location: r.location,
                              family_status: r.family_status,
                              los_band_from: String(r.los_band_from),
                              los_band_to: String(r.los_band_to),
                              annual_amount: String(r.annual_amount),
                              is_active: r.is_active,
                            });
                          }}
                        >
                          Edit
                        </Button>
                        <Button variant="ghost" size="sm" data-testid="btn-delete-rule" onClick={() => setDeleting(r)}>
                          <Trash2 size={14} className="text-[var(--color-destructive)]" />
                        </Button>
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
        title="Delete rule?"
        message="Soft-delete this matrix row."
        confirmLabel="Delete"
        destructive
      />
      {deleting ? (
        <button
          type="button"
          className="sr-only"
          data-testid="btn-confirm-delete"
          onClick={() => remove.mutate(deleting.id)}
        >
          Confirm delete
        </button>
      ) : (
        <div data-testid="dialog-confirm-delete" className="hidden" />
      )}
    </div>
  );
}
