"use client";

import { useMutation } from "@tanstack/react-query";
import { FileSpreadsheet, Loader2, Upload, CircleCheck, CircleAlert } from "lucide-react";
import { useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { api, download } from "@/lib/api";
import { cn } from "@/lib/utils";

export interface ImportRow {
  row: number;
  severity: string;
  message?: string;
  messages?: string[];
  selected: boolean;
  action?: string | null;
  [key: string]: unknown;
}

export function ImportPanel({
  title,
  description,
  templateName,
  previewPath,
  commitPath,
  columns,
  onCommitted,
}: {
  title: string;
  description: string;
  templateName: string;
  previewPath: string;
  commitPath: string;
  columns: Array<{ key: string; label: string }>;
  onCommitted: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<ImportRow[] | null>(null);

  const previewMutation = useMutation({
    mutationFn: (workbook: File) => {
      const form = new FormData();
      form.append("file", workbook);
      return api<{ rows?: ImportRow[] } | ImportRow[]>(previewPath, {
        method: "POST",
        body: form,
      });
    },
    onSuccess: (data) => {
      const list = (Array.isArray(data) ? data : (data.rows ?? [])).map((r) => ({
        ...r,
        selected: r.severity === "READY" && r.selected !== false,
      }));
      setRows(list);
      const ready = list.filter((r) => r.severity === "READY").length;
      const errors = list.filter((r) => r.severity !== "READY").length;
      toast.info(
        "Workbook verified",
        `${ready} ready · ${errors} with errors. Review selection, then import.`
      );
    },
    onError: (err) =>
      toast.error("Verification failed", err instanceof Error ? err.message : undefined),
  });

  const commitMutation = useMutation({
    mutationFn: (selected: ImportRow[]) =>
      api<{ imported: number; updated?: number }>(commitPath, {
        method: "POST",
        body: { rows: selected },
      }),
    onSuccess: (result) => {
      const updated = result.updated ?? 0;
      toast.success(
        "Import complete",
        `${result.imported} inserted${updated ? ` · ${updated} updated` : ""}.`
      );
      setRows(null);
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      onCommitted();
    },
    onError: (err) =>
      toast.error("Import failed", err instanceof Error ? err.message : undefined),
  });

  const toggleRow = (rowNumber: number, checked: boolean) => {
    setRows((prev) =>
      (prev ?? []).map((r) =>
        r.row === rowNumber && r.severity === "READY" ? { ...r, selected: checked } : r
      )
    );
  };

  const readySelectable = (rows ?? []).filter((r) => r.severity === "READY");
  const selectedRows = readySelectable.filter((r) => r.selected);
  const allSelected = readySelectable.length > 0 && selectedRows.length === readySelectable.length;

  const toggleAll = (checked: boolean) => {
    setRows((prev) =>
      (prev ?? []).map((r) => (r.severity === "READY" ? { ...r, selected: checked } : r))
    );
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => download(`/templates/${templateName}.xlsx`, `${templateName}-template.xlsx`)}
            >
              <FileSpreadsheet size={15} /> Excel template
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setRows(null);
              }}
            />
            <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
              <Upload size={15} /> {file ? file.name : "Choose Excel workbook"}
            </Button>
            <Button
              size="sm"
              disabled={!file || previewMutation.isPending}
              onClick={() => file && previewMutation.mutate(file)}
            >
              {previewMutation.isPending ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <CircleCheck size={15} />
              )}
              Verify workbook
            </Button>
          </div>
        </div>
      </CardHeader>
      {rows ? (
        <CardContent className="space-y-4">
          <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--color-border)]">
            <Table>
              <THead>
                <TR>
                  <TH className="w-10">
                    <input
                      type="checkbox"
                      aria-label="Select all valid rows"
                      checked={allSelected}
                      onChange={(e) => toggleAll(e.target.checked)}
                      disabled={!readySelectable.length}
                    />
                  </TH>
                  <TH>#</TH>
                  {columns.map((c) => (
                    <TH key={c.key}>{c.label}</TH>
                  ))}
                  <TH>Action</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((r) => (
                  <TR key={r.row} className={cn(r.severity !== "READY" && "bg-[hsl(0_72%_98%)]")}>
                    <TD>
                      <input
                        type="checkbox"
                        aria-label={`Select row ${r.row}`}
                        checked={Boolean(r.selected) && r.severity === "READY"}
                        disabled={r.severity !== "READY"}
                        onChange={(e) => toggleRow(r.row, e.target.checked)}
                      />
                    </TD>
                    <TD className="text-[var(--color-muted-foreground)]">{r.row}</TD>
                    {columns.map((c) => (
                      <TD key={c.key} className="max-w-[220px] truncate">
                        {String(r[c.key] ?? "—")}
                      </TD>
                    ))}
                    <TD className="font-mono text-xs uppercase">
                      {r.action ? String(r.action) : "—"}
                    </TD>
                    <TD>
                      <div className="flex items-center gap-2">
                        {r.severity === "READY" ? (
                          <Badge variant="success">
                            <CircleCheck size={11} /> Valid
                          </Badge>
                        ) : (
                          <Badge variant="destructive">
                            <CircleAlert size={11} /> Error
                          </Badge>
                        )}
                      </div>
                      {r.severity !== "READY" ? (
                        <p className="mt-1 max-w-[280px] text-xs text-[var(--color-destructive)]">
                          {Array.isArray(r.messages)
                            ? r.messages.join("; ")
                            : String(r.message ?? "Invalid row")}
                        </p>
                      ) : r.message ? (
                        <p className="mt-1 max-w-[280px] text-xs text-[var(--color-muted-foreground)]">
                          {String(r.message)}
                        </p>
                      ) : null}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
          <div className="flex items-center justify-between">
            <p className="text-sm text-[var(--color-muted-foreground)]">
              {selectedRows.length} of {rows.length} rows selected for import
              {readySelectable.length < rows.length
                ? ` · ${rows.length - readySelectable.length} errors excluded`
                : ""}
            </p>
            <Button
              variant="gradient"
              disabled={!selectedRows.length || commitMutation.isPending}
              onClick={() => commitMutation.mutate(selectedRows)}
            >
              {commitMutation.isPending ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Upload size={15} />
              )}
              Import {selectedRows.length} rows
            </Button>
          </div>
        </CardContent>
      ) : null}
    </Card>
  );
}
