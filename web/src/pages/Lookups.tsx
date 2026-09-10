import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ListTree, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { EmptyState, ErrorState, PageHeader } from "@/components/ui/primitives";
import { TableSkeleton } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { titleCase } from "@/lib/format";
import type { Lookup } from "@/lib/types";

const TYPES = ["designations", "nationalities", "pay_groups", "sub_sections"];

export function LookupsPage() {
  const queryClient = useQueryClient();
  const [activeType, setActiveType] = useState(TYPES[0]);
  const [showForm, setShowForm] = useState(false);
  const [deleting, setDeleting] = useState<Lookup | null>(null);
  const [form, setForm] = useState({ code: "", name: "" });

  const lookups = useQuery({
    queryKey: ["lookups", activeType],
    queryFn: () => api<Lookup[]>(`/lookups/${activeType}`),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      api(`/lookups/${activeType}`, {
        method: "POST",
        body: { code: form.code.trim(), name: form.name.trim(), active: true },
      }),
    onSuccess: () => {
      toast.success("Lookup created");
      setShowForm(false);
      setForm({ code: "", name: "" });
      queryClient.invalidateQueries({ queryKey: ["lookups", activeType] });
    },
    onError: (err) => toast.error("Save failed", err instanceof Error ? err.message : undefined),
  });

  const deleteMutation = useMutation({
    mutationFn: (item: Lookup) =>
      api(`/lookups/${activeType}/${item.id}`, {
        method: "DELETE",
        headers: { "If-Match": String(item.version) },
      }),
    onSuccess: () => {
      toast.success("Lookup removed");
      setDeleting(null);
      queryClient.invalidateQueries({ queryKey: ["lookups", activeType] });
    },
    onError: (err) => toast.error("Delete failed", err instanceof Error ? err.message : undefined),
  });

  return (
    <div className="animate-[fade-in_0.3s_ease-out]">
      <PageHeader
        title="Lookups"
        subtitle="Reference lists used across employees, rates, and imports"
        actions={
          <Button variant="gradient" onClick={() => setShowForm(true)}>
            <Plus size={15} /> New entry
          </Button>
        }
      />

      <Tabs
        tabs={TYPES.map((t) => ({ id: t, label: titleCase(t) }))}
        active={activeType}
        onChange={setActiveType}
        className="mb-4"
      />

      <Card>
        <CardHeader>
          <CardTitle>{titleCase(activeType)}</CardTitle>
          <CardDescription>{lookups.data?.length ?? 0} entries</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {lookups.isPending ? (
            <TableSkeleton />
          ) : lookups.isError ? (
            <ErrorState error={lookups.error} onRetry={lookups.refetch} />
          ) : (lookups.data ?? []).length === 0 ? (
            <EmptyState icon={<ListTree size={22} />} title="No entries" message="Add the first entry for this list." />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Code</TH>
                  <TH>Name</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {(lookups.data ?? []).map((item) => (
                  <TR key={item.id}>
                    <TD className="font-mono text-xs font-semibold">{item.code}</TD>
                    <TD className="font-semibold">{item.name}</TD>
                    <TD>
                      <Badge variant={item.active ? "success" : "secondary"}>
                        {item.active ? "Active" : "Inactive"}
                      </Badge>
                    </TD>
                    <TD className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => setDeleting(item)} title="Delete">
                        <Trash2 size={15} className="text-[var(--color-destructive)]" />
                      </Button>
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
        title={`New ${titleCase(activeType).replace(/s$/, "")}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button variant="gradient" disabled={createMutation.isPending} onClick={() => createMutation.mutate()}>
              {createMutation.isPending ? "Saving…" : "Save entry"}
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-4">
          <Field label="Code">
            <Input className="font-mono" value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} placeholder="MGR" />
          </Field>
          <Field label="Name">
            <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Manager" />
          </Field>
        </div>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && deleteMutation.mutate(deleting)}
        title="Delete lookup"
        message={`Remove "${deleting?.name}" from ${titleCase(activeType)}?`}
        confirmLabel="Delete"
        destructive
        busy={deleteMutation.isPending}
      />
    </div>
  );
}
