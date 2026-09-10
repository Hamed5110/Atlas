import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DatabaseBackup, HardDriveDownload, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { EmptyState, ErrorState, PageHeader } from "@/components/ui/primitives";
import { TableSkeleton } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import type { BackupInfo } from "@/lib/types";

interface BackupCatalog {
  backups?: BackupInfo[];
  rows?: BackupInfo[];
  native_available?: boolean;
  credentials_ready?: boolean;
  [key: string]: unknown;
}

function formatSize(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

export function BackupsPage() {
  const queryClient = useQueryClient();
  const [restoring, setRestoring] = useState<BackupInfo | null>(null);
  const [deleting, setDeleting] = useState<BackupInfo | null>(null);
  const [showErase, setShowErase] = useState(false);
  const [eraseText, setEraseText] = useState("");

  const catalog = useQuery({
    queryKey: ["backups"],
    queryFn: () => api<BackupCatalog>("/admin/backups"),
  });

  const backupList: BackupInfo[] = catalog.data
    ? (catalog.data.backups ?? catalog.data.rows ?? [])
    : [];

  const createMutation = useMutation({
    mutationFn: (kind: "logical" | "mssql") =>
      api<{ file_name?: string }>("/admin/backups", { method: "POST", body: { kind } }),
    onSuccess: (result, kind) => {
      toast.success(`${kind === "mssql" ? "Native" : "Logical"} backup created`, result.file_name);
      queryClient.invalidateQueries({ queryKey: ["backups"] });
    },
    onError: (err) => toast.error("Backup failed", err instanceof Error ? err.message : undefined),
  });

  const restoreMutation = useMutation({
    mutationFn: (fileName: string) =>
      api<{ restored?: Record<string, number> }>("/admin/backups/restore", {
        method: "POST",
        body: { file_name: fileName },
      }),
    onSuccess: (result) => {
      const summary = Object.entries(result.restored ?? {})
        .map(([table, count]) => `${table}: ${count}`)
        .join(" · ");
      toast.success("Restore complete", summary || "Data restored.");
      setRestoring(null);
      queryClient.invalidateQueries();
    },
    onError: (err) => toast.error("Restore failed", err instanceof Error ? err.message : undefined),
  });

  const deleteMutation = useMutation({
    mutationFn: (fileName: string) => api(`/admin/backups/${fileName}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Backup deleted");
      setDeleting(null);
      queryClient.invalidateQueries({ queryKey: ["backups"] });
    },
    onError: (err) => toast.error("Delete failed", err instanceof Error ? err.message : undefined),
  });

  const eraseMutation = useMutation({
    mutationFn: () => api("/admin/erase-data", { method: "POST", body: { confirm: "ERASE_ALL_DATA" } }),
    onSuccess: () => {
      toast.success("Operational data erased", "The action was recorded in the audit log.");
      setShowErase(false);
      setEraseText("");
      queryClient.invalidateQueries();
    },
    onError: (err) => toast.error("Erase failed", err instanceof Error ? err.message : undefined),
  });

  return (
    <div className="animate-[fade-in_0.3s_ease-out]">
      <PageHeader
        title="Backup & Restore"
        subtitle="Logical JSON snapshots plus native MSSQL backups"
        actions={
          <>
            <Button
              variant="outline"
              disabled={createMutation.isPending}
              onClick={() => createMutation.mutate("logical")}
            >
              <DatabaseBackup size={15} /> Logical backup
            </Button>
            <Button
              variant="gradient"
              disabled={createMutation.isPending || catalog.data?.credentials_ready === false}
              onClick={() => createMutation.mutate("mssql")}
            >
              <HardDriveDownload size={15} /> Native MSSQL backup
            </Button>
          </>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Backup catalog</CardTitle>
          <CardDescription>{backupList.length} snapshots on disk</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {catalog.isPending ? (
            <TableSkeleton />
          ) : catalog.isError ? (
            <ErrorState error={catalog.error} onRetry={catalog.refetch} />
          ) : backupList.length === 0 ? (
            <EmptyState
              icon={<DatabaseBackup size={22} />}
              title="No backups yet"
              message="Create a logical backup before any risky operation."
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>File</TH>
                  <TH>Kind</TH>
                  <TH>Size</TH>
                  <TH>Created</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {backupList.map((b) => (
                  <TR key={b.file_name}>
                    <TD className="font-mono text-xs font-semibold">{b.file_name}</TD>
                    <TD>
                      <Badge variant={b.kind === "mssql" ? "default" : "secondary"}>{b.kind}</Badge>
                    </TD>
                    <TD>{formatSize(b.size_bytes)}</TD>
                    <TD className="text-xs text-[var(--color-muted-foreground)]">{fmtDateTime(b.created_at)}</TD>
                    <TD>
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setRestoring(b)}>
                          <RotateCcw size={14} /> Restore
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

      <Card className="mt-4 border-[hsl(0_72%_51%/0.35)]">
        <CardHeader>
          <CardTitle className="text-[var(--color-destructive)]">Danger zone</CardTitle>
          <CardDescription>
            Erase all operational data (employees, tickets, loans, balances). Preferences, users, and
            audit history are preserved. Always take a backup first.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="destructive" onClick={() => setShowErase(true)}>
            Erase all operational data
          </Button>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={Boolean(restoring)}
        onClose={() => setRestoring(null)}
        onConfirm={() => restoring && restoreMutation.mutate(restoring.file_name)}
        title="Restore backup"
        message={
          <>
            Restore <span className="font-mono font-bold">{restoring?.file_name}</span>? Current
            operational data will be replaced by the snapshot contents.
          </>
        }
        confirmLabel="Restore"
        busy={restoreMutation.isPending}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && deleteMutation.mutate(deleting.file_name)}
        title="Delete backup"
        message={`Permanently delete ${deleting?.file_name}?`}
        confirmLabel="Delete"
        destructive
        busy={deleteMutation.isPending}
      />

      <Dialog
        open={showErase}
        onClose={() => setShowErase(false)}
        title="Erase all operational data"
        description="This is permanent. Type the confirmation phrase to proceed."
        footer={
          <>
            <Button variant="ghost" onClick={() => setShowErase(false)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={eraseText !== "ERASE_ALL_DATA" || eraseMutation.isPending}
              onClick={() => eraseMutation.mutate()}
            >
              {eraseMutation.isPending ? "Erasing…" : "Erase everything"}
            </Button>
          </>
        }
      >
        <p className="mb-3 text-sm">
          Type <span className="rounded bg-[var(--color-secondary)] px-1.5 py-0.5 font-mono text-xs font-bold">ERASE_ALL_DATA</span> to confirm:
        </p>
        <Input
          value={eraseText}
          onChange={(e) => setEraseText(e.target.value)}
          className="font-mono"
          placeholder="ERASE_ALL_DATA"
        />
      </Dialog>
    </div>
  );
}
