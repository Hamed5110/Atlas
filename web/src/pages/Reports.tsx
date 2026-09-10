import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  Download,
  FileText,
  LineChart,
  ListOrdered,
  Plane,
  Scale,
  Users,
  Wallet,
} from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/primitives";
import { TableSkeleton } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { download } from "@/lib/api";
import { fmtDateTime, num } from "@/lib/format";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";

const REPORTS = [
  { name: "airfare-payable", label: "Airfare Payable", icon: Scale, blurb: "Opening / earned / paid / payable as-of date" },
  { name: "airfare-payable-summary", label: "Payable Summary", icon: BarChart3, blurb: "Entitlement vs payable by employee" },
  { name: "airfare-payable-exceptions", label: "Payable Exceptions", icon: FileText, blurb: "Non-OK verification notes" },
  { name: "employee-master", label: "Employee Master", icon: Users, blurb: "All profiles with rates and status" },
  { name: "opening-balances", label: "Opening Balances", icon: Scale, blurb: "Carried-forward days and amounts" },
  { name: "entitlements", label: "Entitlements", icon: BarChart3, blurb: "Live entitlement per employee" },
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

export function ReportsPage() {
  const [selected, setSelected] = useState<ReportName | null>(null);

  const detail = useQuery({
    queryKey: ["report-detail", selected],
    queryFn: () => api<ReportDetail>(`/reports/detail/${selected}`),
    enabled: Boolean(selected),
  });

  return (
    <div className="animate-[fade-in_0.3s_ease-out]">
      <PageHeader
        title="Reports"
        subtitle="Pick a report — it opens right here, with PDF and Excel export"
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {REPORTS.map(({ name, label, icon: Icon, blurb }) => (
          <button
            key={name}
            onClick={() => setSelected(name)}
            className={cn(
              "flex items-start gap-3 rounded-[var(--radius-lg)] border-2 bg-white p-4 text-left transition-all cursor-pointer",
              selected === name
                ? "border-[var(--color-primary)] shadow-[var(--shadow-pop)]"
                : "border-[var(--color-border)] shadow-[var(--shadow-card)] hover:border-[hsl(243_75%_75%)]"
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

      <Card className="mt-4">
        {!selected ? (
          <EmptyState
            icon={<BarChart3 size={22} />}
            title="Select a report"
            message="Reports render inline in this panel — no pop-ups."
          />
        ) : (
          <>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle>
                    {REPORTS.find((r) => r.name === selected)?.label}
                  </CardTitle>
                  <CardDescription>
                    {detail.data
                      ? `${num(detail.data.count)} rows · generated ${fmtDateTime(detail.data.generated_at)}`
                      : "Loading…"}
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">Inline</Badge>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => download(`/reports/export/${selected}.pdf`, `${selected}.pdf`)}
                  >
                    <FileText size={14} /> PDF
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => download(`/reports/export/${selected}.xlsx`, `${selected}.xlsx`)}
                  >
                    <Download size={14} /> Excel
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {detail.isPending ? (
                <TableSkeleton rows={8} />
              ) : detail.isError ? (
                <EmptyState
                  title="Report failed to load"
                  message={detail.error instanceof Error ? detail.error.message : undefined}
                />
              ) : (
                <div className="max-h-[560px] overflow-auto border-t border-[var(--color-border)]">
                  <Table>
                    <THead className="sticky top-0 z-10">
                      <TR>
                        {(detail.data?.columns ?? []).map((col) => (
                          <TH key={col}>{col}</TH>
                        ))}
                      </TR>
                    </THead>
                    <TBody>
                      {(detail.data?.rows ?? []).map((row, i) => (
                        <TR key={i}>
                          {row.map((cell, j) => (
                            <TD key={j} className="whitespace-nowrap">
                              {cell == null || cell === "" ? "—" : String(cell)}
                            </TD>
                          ))}
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </>
        )}
      </Card>
    </div>
  );
}
