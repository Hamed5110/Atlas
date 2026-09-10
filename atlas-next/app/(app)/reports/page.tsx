"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BarChart3,
  Download,
  FileText,
  LineChart,
  ListOrdered,
  Plane,
  Scale,
  Sparkles,
  Users,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { EmptyState, PageHeader } from "@/components/ui/primitives";
import { TableSkeleton } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { api, download, errorMessage } from "@/lib/api";
import { fmtDateTime, num } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const REPORTS = [
  {
    name: "airfare-payable",
    label: "Airfare Payable",
    icon: Scale,
    blurb: "Opening / earned / paid / payable as-of date (3355 control sheet)",
  },
  {
    name: "airfare-payable-summary",
    label: "Payable Summary",
    icon: BarChart3,
    blurb: "Compact entitlement vs payable by employee",
  },
  {
    name: "airfare-payable-exceptions",
    label: "Payable Exceptions",
    icon: FileText,
    blurb: "Non-OK verification notes only",
  },
  { name: "employee-master", label: "Employee Master", icon: Users, blurb: "All profiles with rates and status" },
  { name: "opening-balances", label: "Opening Balances", icon: Scale, blurb: "Carried-forward days and amounts" },
  { name: "entitlements", label: "Entitlements", icon: BarChart3, blurb: "Live entitlement rate schedule" },
  { name: "ticket-register", label: "Ticket Register", icon: Plane, blurb: "Every ticket with settlement detail" },
  { name: "loan-outstanding", label: "Loan Outstanding", icon: Wallet, blurb: "Balances by employee and loan" },
  { name: "loan-statement", label: "Loan Statement", icon: ListOrdered, blurb: "Installments and payments" },
  { name: "liability-projections", label: "Liability Projections", icon: LineChart, blurb: "Future recovery schedule" },
  { name: "excess-recovery", label: "Excess Recovery", icon: FileText, blurb: "Tickets where cost exceeded entitlement" },
] as const;

type ReportName = (typeof REPORTS)[number]["name"];

interface ReportDetail {
  report: string;
  columns: string[];
  rows: unknown[][];
  count: number;
  generated_at: string;
}

interface ReportTemplate {
  id: string;
  code: string;
  title: string;
  dataset: string;
  definition: {
    title?: string;
    dataset?: string;
    bands?: { detail?: { columns?: string[] } };
    group_by?: string[];
    sort_by?: string | null;
  };
  is_system: boolean;
  version: number;
}

interface CrystalStatus {
  configured: boolean;
  note: string;
  bip_url?: string | null;
}

function ReportsPage() {
  const t = useT();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<ReportName | null>(null);
  const [designerDataset, setDesignerDataset] = useState<ReportName>("employee-master");
  const [designerTitle, setDesignerTitle] = useState("Custom report");
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null);
  const todayIso = new Date().toISOString().slice(0, 10);
  const [reportYear, setReportYear] = useState(String(new Date().getFullYear()));
  const [asOfDate, setAsOfDate] = useState(todayIso);

  const payableFilters = useMemo(() => {
    const params = new URLSearchParams();
    if (reportYear) params.set("year", reportYear);
    if (asOfDate) params.set("as_of_date", asOfDate);
    const q = params.toString();
    return q ? `?${q}` : "";
  }, [reportYear, asOfDate]);

  const needsPayableFilters =
    selected?.startsWith("airfare-payable") || designerDataset.startsWith("airfare-payable");

  const detail = useQuery({
    queryKey: ["report-detail", selected, reportYear, asOfDate],
    queryFn: () =>
      api<ReportDetail>(
        `/reports/detail/${selected}${selected?.startsWith("airfare-payable") ? payableFilters : ""}`,
      ),
    enabled: Boolean(selected),
  });

  const templates = useQuery({
    queryKey: ["report-templates"],
    queryFn: () => api<ReportTemplate[]>("/report-templates"),
  });

  const crystal = useQuery({
    queryKey: ["crystal-status"],
    queryFn: () => api<CrystalStatus>("/crystal/status"),
  });

  const catalogPreview = useQuery({
    queryKey: ["report-detail", designerDataset, "designer", reportYear, asOfDate],
    queryFn: () =>
      api<ReportDetail>(
        `/reports/detail/${designerDataset}${
          designerDataset.startsWith("airfare-payable") ? payableFilters : ""
        }`,
      ),
  });

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("atlas.reportSpec");
      if (!raw) return;
      const spec = JSON.parse(raw) as { dataset?: string; title?: string; columns?: string[] };
      if (spec.dataset && REPORTS.some((r) => r.name === spec.dataset)) {
        setDesignerDataset(spec.dataset as ReportName);
        setDesignerTitle(spec.title || "Agent draft");
        if (spec.columns?.length) setSelectedColumns(spec.columns);
      }
      sessionStorage.removeItem("atlas.reportSpec");
      toast.info("Loaded agent report draft", "Refine columns then save or export.");
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!catalogPreview.data?.columns?.length) return;
    if (!selectedColumns.length) {
      setSelectedColumns(catalogPreview.data.columns);
    }
  }, [catalogPreview.data, selectedColumns.length]);

  const availableColumns = catalogPreview.data?.columns ?? [];

  const previewRows = useMemo(() => {
    if (!catalogPreview.data) return [];
    const indexes = selectedColumns
      .map((c) => availableColumns.indexOf(c))
      .filter((i) => i >= 0);
    return catalogPreview.data.rows.slice(0, 25).map((row) => indexes.map((i) => row[i]));
  }, [catalogPreview.data, selectedColumns, availableColumns]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const definition = {
        title: designerTitle,
        dataset: designerDataset,
        bands: {
          header: { title: designerTitle, show_date: true },
          detail: { columns: selectedColumns },
          footer: { show_count: true },
        },
        parameters: {},
        filters: {},
        group_by: [],
        sort_by: selectedColumns[0] ?? null,
      };
      if (activeTemplateId) {
        const current = templates.data?.find((t) => t.id === activeTemplateId);
        return api(`/report-templates/${activeTemplateId}`, {
          method: "PUT",
          headers: { "If-Match": String(current?.version ?? 1) },
          body: { title: designerTitle, definition },
        });
      }
      const code = `custom_${designerDataset.replace(/-/g, "_")}_${Date.now().toString(36)}`;
      return api("/report-templates", {
        method: "POST",
        body: { code, title: designerTitle, dataset: designerDataset, definition },
      });
    },
    onSuccess: () => {
      toast.success("Template saved");
      setActiveTemplateId(null);
      queryClient.invalidateQueries({ queryKey: ["report-templates"] });
    },
    onError: (err) => toast.error("Save failed", errorMessage(err)),
  });

  const toggleColumn = (column: string) => {
    setSelectedColumns((prev) =>
      prev.includes(column) ? prev.filter((c) => c !== column) : [...prev, column]
    );
  };

  const loadTemplate = (tpl: ReportTemplate) => {
    setActiveTemplateId(tpl.id);
    setDesignerTitle(tpl.title);
    setDesignerDataset(tpl.dataset as ReportName);
    const cols = tpl.definition?.bands?.detail?.columns;
    if (cols?.length) setSelectedColumns(cols);
  };

  return (
    <div className="animate-[fade-in_0.3s_ease-out]" data-testid="reports-page">
      <PageHeader
        title={t("page.reports.title")}
        subtitle={t("page.reports.subtitle")}
      />

      <Link
        href="/finance"
        data-testid="reports-link-finance-ledger"
        className="mb-4 flex items-start gap-3 rounded-[var(--radius-lg)] border-2 border-[var(--color-primary)] bg-[var(--color-primary-muted)] p-4 text-left transition-all hover:shadow-[var(--shadow-pop)]"
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-sm)] gradient-hero text-white">
          <Scale size={18} />
        </div>
        <div>
          <p className="text-sm font-bold text-[var(--color-primary)]">Finance Ledger (GL)</p>
          <p className="mt-0.5 text-xs text-[var(--color-muted-foreground)]">
            Chart of accounts, trial balance, and journal lines for ticket issue and loans — open the
            dedicated Finance Ledger page (not a catalog tile).
          </p>
        </div>
      </Link>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="reports-catalog">
        {REPORTS.map(({ name, label, icon: Icon, blurb }) => (
          <button
            key={name}
            data-testid={`report-tile-${name}`}
            onClick={() => setSelected(name)}
            className={cn(
              "flex items-start gap-3 rounded-[var(--radius-lg)] border-2 bg-white p-4 text-left transition-all cursor-pointer",
              selected === name
                ? "border-[var(--color-primary)] shadow-[var(--shadow-pop)]"
                : "border-[var(--color-border)] shadow-[var(--shadow-card)] hover:border-[hsl(210_55%_70%)]"
            )}
          >
            <div
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-sm)]",
                selected === name
                  ? "gradient-hero text-white"
                  : "bg-[var(--color-primary-muted)] text-[var(--color-primary)]"
              )}
            >
              <Icon size={18} />
            </div>
            <div>
              <p className="text-sm font-bold">{label}</p>
              <p className="mt-0.5 text-xs text-[var(--color-muted-foreground)]">{blurb}</p>
            </div>
          </button>
        ))}
      </div>

      {needsPayableFilters ? (
        <Card className="mt-4" data-testid="payable-filters">
          <CardContent className="flex flex-wrap gap-4 py-4">
            <Field label="Fiscal year" htmlFor="payable-year">
              <Input
                id="payable-year"
                data-testid="payable-year"
                type="number"
                value={reportYear}
                onChange={(e) => setReportYear(e.target.value)}
                min={2000}
                max={2100}
              />
            </Field>
            <Field label="As of date" htmlFor="payable-asof">
              <Input
                id="payable-asof"
                data-testid="payable-asof"
                type="date"
                value={asOfDate}
                onChange={(e) => setAsOfDate(e.target.value)}
              />
            </Field>
            <p className="self-end text-xs text-[var(--color-muted-foreground)] pb-2">
              Payable reports use year + as-of cut-off (ATLAS 3355 parity).
            </p>
          </CardContent>
        </Card>
      ) : null}

      {selected ? (
        <Card className="mt-4">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>{REPORTS.find((r) => r.name === selected)?.label}</CardTitle>
                <CardDescription data-testid="report-row-count">
                  {detail.data
                    ? `${num(detail.data.count)} rows · ${fmtDateTime(detail.data.generated_at)}`
                    : "Loading…"}
                </CardDescription>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  data-testid="report-export-xlsx"
                  onClick={() =>
                    download(
                      `/reports/export/${selected}.xlsx${
                        selected.startsWith("airfare-payable") ? payableFilters : ""
                      }`,
                      `${selected}.xlsx`,
                    )
                  }
                >
                  <Download size={14} /> Excel
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  data-testid="report-export-pdf"
                  onClick={() =>
                    download(
                      `/reports/export/${selected}.pdf${
                        selected.startsWith("airfare-payable") ? payableFilters : ""
                      }`,
                      `${selected}.pdf`,
                    )
                  }
                >
                  <Download size={14} /> PDF
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {detail.isPending ? (
              <TableSkeleton />
            ) : detail.isError || !detail.data ? (
              <EmptyState icon={<FileText size={22} />} title="Could not load report" message="Try again or pick another report." />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <THead>
                    <TR>
                      {detail.data.columns.map((c) => (
                        <TH key={c}>{c}</TH>
                      ))}
                    </TR>
                  </THead>
                  <TBody>
                    {detail.data.rows.slice(0, 100).map((row, i) => (
                      <TR key={i}>
                        {row.map((cell, j) => (
                          <TD key={j}>{String(cell ?? "—")}</TD>
                        ))}
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles size={18} /> Report designer
          </CardTitle>
          <CardDescription data-testid="report-designer">
            <strong>Native banded designer</strong> (header / detail / footer columns) — pick a dataset,
            toggle columns, preview, save a template, then export PDF/Excel. This is the working designer on
            :3389.
            {crystal.data?.configured ? (
              <span className="block mt-1 text-[var(--color-success)]">
                Optional SAP Crystal BIP bridge is also configured ({crystal.data.bip_url || "BIP"}).
              </span>
            ) : (
              <span className="block mt-1">
                SAP Crystal Reports BIP is <em>not required</em>
                {crystal.data?.note ? ` — ${crystal.data.note}` : " (support ends Dec 2026)"}. Use native
                Export below.
              </span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Title">
              <Input value={designerTitle} onChange={(e) => setDesignerTitle(e.target.value)} />
            </Field>
            <Field label="Dataset">
              <Select
                value={designerDataset}
                onChange={(e) => {
                  setDesignerDataset(e.target.value as ReportName);
                  setSelectedColumns([]);
                  setActiveTemplateId(null);
                }}
              >
                {REPORTS.map((r) => (
                  <option key={r.name} value={r.name}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Saved templates">
              <Select
                value={activeTemplateId ?? ""}
                onChange={(e) => {
                  const tpl = templates.data?.find((t) => t.id === e.target.value);
                  if (tpl) loadTemplate(tpl);
                  else setActiveTemplateId(null);
                }}
              >
                <option value="">— New / catalog —</option>
                {(templates.data ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                    {t.is_system ? " (system)" : ""}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
              Detail band columns
            </p>
            <div className="flex flex-wrap gap-2">
              {availableColumns.map((column) => {
                const on = selectedColumns.includes(column);
                return (
                  <button
                    key={column}
                    type="button"
                    onClick={() => toggleColumn(column)}
                    className={cn(
                      "rounded-md border px-2.5 py-1 text-xs font-medium",
                      on
                        ? "border-[var(--color-primary)] bg-[var(--color-primary-muted)] text-[var(--color-primary)]"
                        : "border-[var(--color-border)] text-[var(--color-muted-foreground)]"
                    )}
                  >
                    {column}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="gradient"
              disabled={saveMutation.isPending || !selectedColumns.length}
              onClick={() => saveMutation.mutate()}
            >
              {saveMutation.isPending ? "Saving…" : activeTemplateId ? "Update template" : "Save template"}
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                download(`/reports/export/${designerDataset}.xlsx`, `${designerDataset}.xlsx`)
              }
            >
              <Download size={14} /> Export Excel
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                download(`/reports/export/${designerDataset}.pdf`, `${designerDataset}.pdf`)
              }
            >
              <Download size={14} /> Export PDF
            </Button>
            {activeTemplateId ? (
              <>
                <Button
                  variant="outline"
                  onClick={() =>
                    download(`/report-templates/${activeTemplateId}/run?format=xlsx`, `${designerTitle}.xlsx`)
                  }
                >
                  <Download size={14} /> Run saved Excel
                </Button>
                <Button
                  variant="outline"
                  onClick={() =>
                    download(`/report-templates/${activeTemplateId}/run?format=pdf`, `${designerTitle}.pdf`)
                  }
                >
                  <Download size={14} /> Run saved PDF
                </Button>
              </>
            ) : null}
            {crystal.data?.configured ? (
              <Badge variant="success">Crystal BIP ready</Badge>
            ) : (
              <Badge variant="secondary">Native designer (BIP optional)</Badge>
            )}
          </div>

          <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--color-border)]">
            {catalogPreview.isPending ? (
              <TableSkeleton />
            ) : (
              <Table>
                <THead>
                  <TR>
                    {selectedColumns.map((c) => (
                      <TH key={c}>{c}</TH>
                    ))}
                  </TR>
                </THead>
                <TBody>
                  {previewRows.map((row, i) => (
                    <TR key={i}>
                      {row.map((cell, j) => (
                        <TD key={j}>{String(cell ?? "—")}</TD>
                      ))}
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default ReportsPage;
