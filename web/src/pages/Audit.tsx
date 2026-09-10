import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, ScrollText } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { EmptyState, ErrorState, PageHeader, SearchInput } from "@/components/ui/primitives";
import { TableSkeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { fmtDateTime, statusTone, titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";

interface AuditEventRow {
  id: number;
  occurred_at: string | null;
  actor?: string | null;
  correlation_id?: string | null;
  ip_address?: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  changes: Record<string, unknown>;
}

export function AuditPage() {
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);

  const events = useQuery({
    queryKey: ["audit"],
    queryFn: () => api<{ total: number; events: AuditEventRow[] }>("/audit?limit=200"),
  });

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (events.data?.events ?? []).filter((e) => {
      if (actionFilter && e.action !== actionFilter) return false;
      if (!term) return true;
      return [e.actor, e.entity_type, e.entity_id, e.action]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(term));
    });
  }, [events.data, search, actionFilter]);

  const actions = useMemo(
    () => [...new Set((events.data?.events ?? []).map((e) => e.action))].sort(),
    [events.data]
  );

  return (
    <div className="animate-[fade-in_0.3s_ease-out]">
      <PageHeader
        title="Audit Log"
        subtitle={`Append-only trail of every mutation · ${events.data?.total ?? 0} events`}
      />

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>Events</CardTitle>
              <CardDescription>Newest first — click a row to inspect the change payload</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)} className="w-40">
                <option value="">All actions</option>
                {actions.map((a) => (
                  <option key={a} value={a}>{titleCase(a)}</option>
                ))}
              </Select>
              <SearchInput value={search} onChange={setSearch} placeholder="Actor, entity…" className="w-56" />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {events.isPending ? (
            <TableSkeleton rows={8} />
          ) : events.isError ? (
            <ErrorState error={events.error} onRetry={events.refetch} />
          ) : filtered.length === 0 ? (
            <EmptyState icon={<ScrollText size={22} />} title="No events" message="Mutations will appear here as they happen." />
          ) : (
            <div className="space-y-1.5">
              {filtered.map((e) => (
                <div key={e.id} className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-white">
                  <button
                    className="flex w-full flex-wrap items-center gap-3 px-3 py-2.5 text-left cursor-pointer"
                    onClick={() => setExpanded(expanded === e.id ? null : e.id)}
                  >
                    {expanded === e.id ? (
                      <ChevronDown size={14} className="shrink-0 text-[var(--color-muted-foreground)]" />
                    ) : (
                      <ChevronRight size={14} className="shrink-0 text-[var(--color-muted-foreground)]" />
                    )}
                    <Badge variant={statusTone(e.action) as never} className="shrink-0">{e.action}</Badge>
                    <span className="text-sm font-bold">{e.entity_type}</span>
                    <span className="max-w-[200px] truncate font-mono text-xs text-[var(--color-muted-foreground)]">
                      {e.entity_id}
                    </span>
                    <span className="ml-auto text-xs text-[var(--color-muted-foreground)]">
                      {e.actor ?? "system"} · {fmtDateTime(e.occurred_at)}
                    </span>
                  </button>
                  {expanded === e.id ? (
                    <div className="border-t border-[var(--color-border)] px-4 py-3">
                      <div className="mb-2 flex flex-wrap gap-4 text-xs text-[var(--color-muted-foreground)]">
                        {e.correlation_id ? <span>correlation: <span className="font-mono">{e.correlation_id.slice(0, 12)}…</span></span> : null}
                        {e.ip_address ? <span>ip: <span className="font-mono">{e.ip_address}</span></span> : null}
                      </div>
                      <pre className={cn("max-h-72 overflow-auto rounded-[var(--radius-sm)] bg-[hsl(222_47%_9%)] p-3 font-mono text-xs text-[hsl(220_14%_85%)]")}>
                        {JSON.stringify(e.changes, null, 2)}
                      </pre>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
