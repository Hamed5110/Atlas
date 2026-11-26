"use client";

import { useMutation } from "@tanstack/react-query";
import { FileSpreadsheet, Loader2, Upload, CircleCheck, CircleAlert } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { api, download, downloadPost, errorMessage } from "@/lib/api";
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

export interface LookupImportPlanRow {
  lookup_type: string;
  code: string;
  name: string;
  action: string;
  message?: string;
}

export function ImportPanel({
  title,
  description,
  templateName,
  previewPath,
  commitPath,
  columns,
  onCommitted,
  commitExtra,
  onDuplicateWarning,
  templatePath,
  errorReportPath,
  toolbar,
}: {
  title: string;
  description: string;
  templateName: string;
  previewPath: string;
  commitPath: string;
  columns: Array<{ key: string; label: string }>;
  onCommitted: () => void;
  /** Extra fields merged into the commit body (e.g. default period_month, status). */
  commitExtra?: Record<string, unknown>;
  /** When the commit answers with a duplicate warning, offer a confirmed retry. */
  onDuplicateWarning?: (retry: () => void, message: string) => void;
  /** API path of the template; defaults to `/templates/{templateName}.xlsx`. */
  templatePath?: string;
  /** POST `{rows}` here to download the failed rows as a workbook with an Error column. */
  errorReportPath?: string;
  /** Extra controls shown next to the upload buttons (e.g. import mode). */
  toolbar?: ReactNode;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const allowDuplicateRef = useRef(false);
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [lookupPlan, setLookupPlan] = useState<LookupImportPlanRow[] | null>(null);

  const previewMutation = useMutation({
    mutationFn: (workbook: File) => {
      const form = new FormData();
      form.append("file", workbook);
      return api<
        | { rows?: ImportRow[]; lookups?: LookupImportPlanRow[]; lookups_summary?: Record<string, number> }
        | ImportRow[]
      >(previewPath, {
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
      const lookups = Array.isArray(data) ? [] : (data.lookups ?? []);
      setLookupPlan(lookups.length ? lookups : null);
      const ready = list.filter((r) => r.severity === "READY").length;
      const errors = list.filter((r) => r.severity !== "READY").length;
      const lookupInserts = lookups.filter((l) => l.action === "INSERT").length;
      const lookupUpdates = lookups.filter((l) => l.action === "UPDATE").length;
      toast.info(
        "Workbook verified",
        `${ready} ready · ${errors} with errors${
          lookupInserts || lookupUpdates
            ? ` · lookups ${lookupInserts} new / ${lookupUpdates} update`
            : ""
        }. Review selection, then import.`
      );
    },
    onError: (err) =>
      toast.error("Verification failed", err instanceof Error ? err.message : undefined),
  });

  const commitMutation = useMutation({
    mutationFn: (selected: ImportRow[]) =>
      api<{
        imported: number;
        updated?: number;
        unchanged?: number;
        vouchers?: number;
        committed?: boolean;
        duplicate_warning?: boolean;
        message?: string;
        rows?: ImportRow[];
        lookups_created?: number;
        lookups_updated?: number;
      }>(commitPath, {
        method: "POST",
        body: {
          rows: selected,
          ...commitExtra,
          ...(allowDuplicateRef.current ? { allow_duplicate: true } : {}),
        },
      }),
    onSuccess: (result, selected) => {
      if (result.duplicate_warning && onDuplicateWarning) {
        onDuplicateWarning(
          () => {
            allowDuplicateRef.current = true;
            commitMutation.mutate(selected);
          },
          result.message || "Some rows already exist."
        );
        return;
      }
      allowDuplicateRef.current = false;
      if (result.committed === false) {
        if (result.rows?.length) {
          setRows(
            result.rows.map((r) => ({ ...r, selected: r.severity === "READY" && r.selected !== false }))
          );
        }
        toast.error("Nothing was imported", result.message || "Fix the rows marked Error and retry.");
        return;
      }
      const updated = result.updated ?? 0;
      const unchanged = result.unchanged ?? 0;
      const lookupsCreated = result.lookups_created ?? 0;
      const lookupsUpdated = result.lookups_updated ?? 0;
      toast.success(
        "Import complete",
        `${result.imported} inserted${updated ? ` · ${updated} updated` : ""}${
          unchanged ? ` · ${unchanged} unchanged` : ""
        }${result.vouchers ? ` into ${result.vouchers} voucher(s)` : ""}${
          lookupsCreated || lookupsUpdated
            ? ` · lookups ${lookupsCreated} new / ${lookupsUpdated} updated`
            : ""
        }.`
      );
      setRows(null);
      setLookupPlan(null);
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      onCommitted();
    },
    onError: (err) => {
      allowDuplicateRef.current = false;
      toast.error("Import failed", err instanceof Error ? err.message : undefined);
    },
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
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            {toolbar}
            <Button
              variant="outline"
              className="h-10"
              onClick={() =>
                download(
                  templatePath ?? `/templates/${templateName}.xlsx`,
                  `${templateName}-template.xlsx`
                ).catch((err) => toast.error("Template download failed", errorMessage(err)))
              }
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
                setLookupPlan(null);
              }}
            />
            <Button variant="secondary" className="h-10" onClick={() => fileRef.current?.click()}>
              <Upload size={15} /> {file ? file.name : "Choose Excel workbook"}
            </Button>
            <Button
              className="h-10"
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
          {lookupPlan && lookupPlan.some((l) => l.action !== "UNCHANGED") ? (
            <div
              className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-background)] p-3"
              data-testid="import-lookup-plan"
            >
              <p className="text-sm font-semibold text-[var(--color-foreground)]">
                Lookups from this workbook
              </p>
              <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
                Departments, designations, nationalities, pay groups, sub sections and repair
                centers are created or updated from the same Excel before employees are saved.
              </p>
              <div className="mt-2 max-h-40 overflow-auto">
                <Table>
                  <THead>
                    <TR>
                      <TH>List</TH>
                      <TH>Code</TH>
                      <TH>Name</TH>
                      <TH>Action</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {lookupPlan
                      .filter((l) => l.action !== "UNCHANGED")
                      .map((l) => (
                        <TR key={`${l.lookup_type}-${l.code}-${l.action}`}>
                          <TD className="font-mono text-xs">{l.lookup_type}</TD>
                          <TD className="font-mono text-xs">{l.code}</TD>
                          <TD>{l.name}</TD>
                          <TD>
                            <Badge variant={l.action === "INSERT" ? "success" : "secondary"}>
                              {l.action}
                            </Badge>
                          </TD>
                        </TR>
                      ))}
                  </TBody>
                </Table>
              </div>
            </div>
          ) : null}
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
                  <TR key={r.row} className={cn(r.severity !== "READY" && "bg-[var(--color-destructive-muted)]")}>
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
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-[var(--color-muted-foreground)]">
              {selectedRows.length} of {rows.length} rows selected for import
              {readySelectable.length < rows.length
                ? ` · ${rows.length - readySelectable.length} errors excluded`
                : ""}
            </p>
            {errorReportPath && readySelectable.length < rows.length ? (
              <Button
                variant="outline"
                onClick={() =>
                  downloadPost(errorReportPath, { rows }, `${templateName}-errors.xlsx`).catch((err) =>
                    toast.error("Download failed", errorMessage(err))
                  )
                }
              >
                <FileSpreadsheet size={15} /> Download errors
              </Button>
            ) : null}
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
