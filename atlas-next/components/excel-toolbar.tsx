"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileDown, FileUp, Loader2 } from "lucide-react";
import { useState } from "react";
import { ImportPanel } from "@/components/import-panel";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Select } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { api, download, errorMessage } from "@/lib/api";
import { useT } from "@/lib/i18n";

export type ImportMode = "upsert" | "insert_only" | "update_only";

export const IMPORT_MODES: ImportMode[] = ["upsert", "insert_only", "update_only"];

export interface ExchangeDataset {
  key: string;
  label: string;
  screen: string;
  importable: boolean;
  key_columns: string[];
  columns: Array<{ name: string; label: string; required: boolean; kind: string }>;
  note: string;
}

export interface ExchangeCatalog {
  datasets: ExchangeDataset[];
}

export function exchangePaths(key: string, mode: ImportMode = "upsert") {
  const base = `/exchange/${encodeURIComponent(key)}`;
  return {
    exportPath: `${base}/export.xlsx`,
    templatePath: `${base}/template.xlsx`,
    previewPath: `${base}/preview?mode=${mode}`,
    commitPath: `${base}/commit`,
    errorReportPath: `${base}/errors.xlsx`,
  };
}

export function useExchangeCatalog() {
  return useQuery({
    queryKey: ["exchange-catalog"],
    queryFn: () => api<ExchangeCatalog>("/exchange"),
    staleTime: 5 * 60_000,
  });
}

/** Export / Import Excel buttons for one `/v1/exchange` dataset; hidden when the role cannot see it. */
export function ExcelToolbar({
  dataset,
  onImported,
  exportOnly,
  importOnly,
}: {
  dataset: string;
  onImported?: () => void;
  /** Hide the import button even when the dataset is importable (e.g. a read-only tab). */
  exportOnly?: boolean;
  /** Hide the export button. Used when another dataset on the same screen already exports. */
  importOnly?: boolean;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const catalog = useExchangeCatalog();
  const [exporting, setExporting] = useState(false);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ImportMode>("upsert");

  const entry = catalog.data?.datasets.find((d) => d.key === dataset);
  if (!entry) return null;
  const paths = exchangePaths(entry.key, mode);
  const canImport = entry.importable && !exportOnly;

  const runExport = async () => {
    setExporting(true);
    try {
      await download(paths.exportPath, `${entry.key}.xlsx`);
    } catch (err) {
      toast.error("Export failed", errorMessage(err));
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      {importOnly ? null : (
        <Button variant="outline" onClick={runExport} disabled={exporting} title={entry.note || undefined}>
          {exporting ? <Loader2 size={15} className="animate-spin" /> : <FileDown size={15} />}
          {t("excel.export")}
        </Button>
      )}
      {canImport ? (
        <Button variant="outline" onClick={() => setOpen(true)}>
          <FileUp size={15} /> {t("excel.import")}
        </Button>
      ) : null}
      {canImport ? (
        <Dialog
          open={open}
          onClose={() => setOpen(false)}
          title={`${t("excel.import")} — ${entry.label}`}
          description={[t("excel.importHelp"), entry.note].filter(Boolean).join(" ")}
          size="full"
        >
          <ImportPanel
            title={entry.label}
            description={`Rows are matched on ${entry.key_columns.join(" + ")}. Red headers are required.`}
            templateName={entry.key}
            templatePath={paths.templatePath}
            previewPath={paths.previewPath}
            commitPath={paths.commitPath}
            errorReportPath={paths.errorReportPath}
            commitExtra={{ mode }}
            columns={entry.columns.map((c) => ({ key: c.name, label: c.label }))}
            toolbar={
              <label className="flex flex-col gap-1 text-xs text-[var(--color-muted-foreground)]">
                {t("excel.mode")}
                <Select
                  aria-label={t("excel.mode")}
                  value={mode}
                  onChange={(e) => setMode(e.target.value as ImportMode)}
                >
                  {IMPORT_MODES.map((m) => (
                    <option key={m} value={m}>
                      {t(`excel.mode.${m}`)}
                    </option>
                  ))}
                </Select>
              </label>
            }
            onCommitted={() => {
              setOpen(false);
              void queryClient.invalidateQueries();
              onImported?.();
            }}
          />
        </Dialog>
      ) : null}
    </>
  );
}
