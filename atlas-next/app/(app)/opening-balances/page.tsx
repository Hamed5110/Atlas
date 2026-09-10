"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Pencil, Plus, Scale, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { ImportPanel } from "@/components/import-panel";
import { EmployeeCombobox } from "@/components/employee-combobox";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { EmptyState, ErrorState, PageHeader, SearchInput } from "@/components/ui/primitives";
import { TableSkeleton } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { api, download, errorMessage } from "@/lib/api";
import { money, num } from "@/lib/format";
import { useT } from "@/lib/i18n";
import type { Employee, OpeningBalance } from "@/lib/types";

function OpeningBalancesPage() {
  const t = useT();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<OpeningBalance | null>(null);
  const [deleting, setDeleting] = useState<OpeningBalance | null>(null);
  const [form, setForm] = useState({
    employee_id: "",
    balance_year: String(new Date().getFullYear()),
    opening_days: "30",
    paid_days: "0",
    opening_amount: "",
    maximum_payout: "",
  });

  const balances = useQuery({
    queryKey: ["opening-balances"],
    queryFn: () => api<OpeningBalance[]>("/opening-balances?limit=500"),
  });
  const employees = useQuery({
    queryKey: ["employees", "all"],
    queryFn: () => api<Employee[]>("/employees?limit=500"),
  });

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return balances.data ?? [];
    return (balances.data ?? []).filter((b) =>
      [b.employee_name, b.employee_code, b.balance_year]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(term))
    );
  }, [balances.data, search]);

  const openCreate = () => {
    setEditing(null);
    setForm({
      employee_id: "",
      balance_year: String(new Date().getFullYear()),
      opening_days: "30",
      paid_days: "0",
      opening_amount: "",
      maximum_payout: "",
    });
    setShowForm(true);
  };

  const openEdit = (b: OpeningBalance) => {
    setEditing(b);
    setForm({
      employee_id: b.employee_id,
      balance_year: String(b.balance_year),
      opening_days: String(b.opening_days ?? ""),
      paid_days: String(b.paid_days ?? "0"),
      opening_amount: String(b.opening_amount ?? ""),
      maximum_payout: String(b.maximum_payout ?? ""),
    });
    setShowForm(true);
  };

  const saveMutation = useMutation({
    mutationFn: () => {
      const body = {
        opening_days: Number(form.opening_days),
        paid_days: Number(form.paid_days),
        opening_amount: Number(form.opening_amount),
        maximum_payout: Number(form.maximum_payout),
      };
      if (editing) {
        return api(`/opening-balances/${editing.id}`, {
          method: "PUT",
          body,
          headers: { "If-Match": String(editing.version) },
        });
      }
      return api("/opening-balances", {
        method: "POST",
        body: {
          ...body,
          employee_id: form.employee_id,
          balance_year: Number(form.balance_year),
        },
      });
    },
    onSuccess: () => {
      toast.success(editing ? "Opening balance updated" : "Opening balance recorded");
      setShowForm(false);
      setEditing(null);
      queryClient.invalidateQueries({ queryKey: ["opening-balances"] });
    },
    onError: (err) => toast.error("Save failed", errorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: (b: OpeningBalance) =>
      api(`/opening-balances/${b.id}`, {
        method: "DELETE",
        headers: { "If-Match": String(b.version) },
      }),
    onSuccess: () => {
      toast.success("Balance removed");
      setDeleting(null);
      queryClient.invalidateQueries({ queryKey: ["opening-balances"] });
    },
    onError: (err) => toast.error("Delete failed", errorMessage(err)),
  });

  return (
    <div className="animate-[fade-in_0.3s_ease-out]">
      <PageHeader
        title={t("page.openingBalances.title")}
        subtitle={t("page.openingBalances.subtitle")}
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => download("/opening-balances/export.xlsx", "opening-balances.xlsx")}
            >
              <Download size={15} /> Export Excel
            </Button>
            <Button variant="gradient" onClick={openCreate}>
              <Plus size={15} /> New balance
            </Button>
          </>
        }
      />

      <ImportPanel
        title="Bulk import"
        description="Opening balances matched by employee code and year."
        templateName="opening-balances"
        previewPath="/opening-balances/import/preview"
        commitPath="/opening-balances/import/commit"
        columns={[
          { key: "employee_code", label: "Employee" },
          { key: "balance_year", label: "Year" },
          { key: "opening_days", label: "Days" },
          { key: "opening_amount", label: "Amount" },
        ]}
        onCommitted={() => queryClient.invalidateQueries({ queryKey: ["opening-balances"] })}
      />

      <Card className="mt-4">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>Balance register</CardTitle>
              <CardDescription>{filtered.length} records</CardDescription>
            </div>
            <SearchInput value={search} onChange={setSearch} placeholder="Search employee or year…" className="w-64" />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {balances.isPending ? (
            <TableSkeleton />
          ) : balances.isError ? (
            <ErrorState error={balances.error} onRetry={balances.refetch} />
          ) : filtered.length === 0 ? (
            <EmptyState icon={<Scale size={22} />} title="No balances" message="Add a balance manually or import from Excel." />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Employee</TH>
                  <TH>Year</TH>
                  <TH>Opening days</TH>
                  <TH>Paid days</TH>
                  <TH>Opening amount</TH>
                  <TH>Max payout</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((b) => (
                  <TR key={b.id}>
                    <TD>
                      <p className="font-semibold">{b.employee_name || "—"}</p>
                      <p className="text-xs font-mono text-[var(--color-muted-foreground)]">{b.employee_code}</p>
                    </TD>
                    <TD className="font-semibold">{b.balance_year}</TD>
                    <TD>{num(b.opening_days)}</TD>
                    <TD>{num(b.paid_days)}</TD>
                    <TD>{money(b.opening_amount)}</TD>
                    <TD>{money(b.maximum_payout)}</TD>
                    <TD className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" onClick={() => openEdit(b)} title="Edit">
                          <Pencil size={15} />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => setDeleting(b)} title="Delete">
                          <Trash2 size={15} className="text-[var(--color-destructive)]" />
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
        open={showForm}
        onClose={() => setShowForm(false)}
        title={editing ? "Edit opening balance" : "New opening balance"}
        description="Carried-forward entitlement for the accrual engine"
        footer={
          <>
            <Button variant="ghost" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
            <Button variant="gradient" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
              {saveMutation.isPending ? "Saving…" : editing ? "Save changes" : "Save balance"}
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-4">
          <Field label="Employee" className="col-span-2">
            <EmployeeCombobox
              employees={employees.data ?? []}
              value={form.employee_id}
              disabled={Boolean(editing)}
              placeholder="Type name — e.g. A…"
              onChange={(id) => setForm((f) => ({ ...f, employee_id: id }))}
            />
          </Field>
          <Field label="Balance year">
            <Input
              type="number"
              min="2000"
              max="2200"
              value={form.balance_year}
              onChange={(e) => setForm((f) => ({ ...f, balance_year: e.target.value }))}
            />
          </Field>
          <Field label="Opening days" hint="0 – 60">
            <Input
              type="number"
              min="0"
              max="60"
              step="0.0001"
              value={form.opening_days}
              onChange={(e) => setForm((f) => ({ ...f, opening_days: e.target.value }))}
            />
          </Field>
          <Field label="Paid days">
            <Input
              type="number"
              min="0"
              max="60"
              step="0.0001"
              value={form.paid_days}
              onChange={(e) => setForm((f) => ({ ...f, paid_days: e.target.value }))}
            />
          </Field>
          <Field label="Opening amount">
            <Input
              type="number"
              min="0"
              step="0.01"
              value={form.opening_amount}
              onChange={(e) => setForm((f) => ({ ...f, opening_amount: e.target.value }))}
            />
          </Field>
          <Field label="Maximum payout">
            <Input
              type="number"
              min="0"
              step="0.01"
              value={form.maximum_payout}
              onChange={(e) => setForm((f) => ({ ...f, maximum_payout: e.target.value }))}
            />
          </Field>
        </div>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && deleteMutation.mutate(deleting)}
        title="Delete opening balance permanently?"
        message={`Permanently remove the ${deleting?.balance_year} balance for ${
          deleting?.employee_name || deleting?.employee_code || "this employee"
        }? You can add the same employee and year again after this.`}
        confirmLabel="Delete permanently"
        destructive
        busy={deleteMutation.isPending}
      />
    </div>
  );
}

export default OpeningBalancesPage;
