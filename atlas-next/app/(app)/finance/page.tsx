"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Download, Scale, Sparkles, Wallet } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { EmptyState, PageHeader } from "@/components/ui/primitives";
import { TableSkeleton } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { api, download, errorMessage } from "@/lib/api";
import { num } from "@/lib/format";
import { useT } from "@/lib/i18n";

interface FinanceStatus {
  ready: boolean;
  engine: string;
  currency: string;
  pattern_source: string;
  ai_support: boolean;
  message: string;
  how_to_report?: string;
}

interface FinanceAccount {
  code: string;
  name: string;
  account_type: string;
  currency?: string;
}

interface TrialRow {
  code: string;
  name: string;
  account_type: string;
  debit: string;
  credit: string;
  net: string;
}

interface LedgerReport {
  balanced: boolean;
  total_debit: string;
  total_credit: string;
  currency: string;
  as_of: string;
  accounts: TrialRow[];
  entries: Array<{
    entry_date: string;
    narration: string;
    source_type: string;
    account_code: string;
    debit: string;
    credit: string;
    memo: string;
  }>;
  engine?: string;
  pattern_source?: string;
}

interface BackfillResult {
  posted_tickets: number;
  skipped_tickets: number;
  posted_loans: number;
  skipped_loans: number;
  posted_payments: number;
  skipped_payments: number;
  trial_balance?: { balanced?: boolean; total_debit?: string; total_credit?: string };
  errors?: string[];
}

function FinancePage() {
  const t = useT();
  const queryClient = useQueryClient();
  const [accountCode, setAccountCode] = useState("");
  const todayIso = new Date().toISOString().slice(0, 10);
  const [asOf, setAsOf] = useState(todayIso);

  const statusQ = useQuery({
    queryKey: ["finance-status"],
    queryFn: () => api<FinanceStatus>("/finance/status"),
  });

  const accountsQ = useQuery({
    queryKey: ["finance-accounts"],
    queryFn: () => api<FinanceAccount[]>("/finance/accounts"),
    enabled: statusQ.data?.ready !== false,
  });

  const reportQ = useQuery({
    queryKey: ["finance-ledger", accountCode, asOf],
    queryFn: () => {
      const params = new URLSearchParams();
      if (accountCode) params.set("account_code", accountCode);
      if (asOf) params.set("to_date", asOf);
      const q = params.toString();
      return api<LedgerReport>(`/finance/ledger-report${q ? `?${q}` : ""}`);
    },
    enabled: statusQ.data?.ready !== false,
  });

  const invalidateAll = () => {
    void queryClient.invalidateQueries({ queryKey: ["finance-status"] });
    void queryClient.invalidateQueries({ queryKey: ["finance-accounts"] });
    void queryClient.invalidateQueries({ queryKey: ["finance-ledger"] });
  };

  const seedM = useMutation({
    mutationFn: () => api("/finance/seed", { method: "POST", body: {} }),
    onSuccess: () => {
      toast.success("Chart of accounts seeded");
      invalidateAll();
    },
    onError: (err) => toast.error(errorMessage(err, "Seed failed")),
  });

  const backfillM = useMutation({
    mutationFn: () => api<BackfillResult>("/finance/backfill", { method: "POST", body: { limit: 200 } }),
    onSuccess: (body) => {
      const n =
        (body.posted_tickets || 0) + (body.posted_loans || 0) + (body.posted_payments || 0);
      toast.success(
        n
          ? `Backfill posted ${n} journal(s). Trial Dr ${body.trial_balance?.total_debit ?? "—"} / Cr ${body.trial_balance?.total_credit ?? "—"}`
          : "Backfill complete — no new journals (already posted or nothing to post).",
      );
      invalidateAll();
      document.getElementById("ledger-report")?.scrollIntoView({ behavior: "smooth" });
    },
    onError: (err) => toast.error(errorMessage(err, "Backfill failed")),
  });

  const exportFile = async (format: "xlsx" | "pdf") => {
    try {
      const params = new URLSearchParams();
      if (accountCode) params.set("account_code", accountCode);
      if (asOf) params.set("to_date", asOf);
      const q = params.toString();
      const ext = format === "xlsx" ? "xlsx" : "pdf";
      await download(
        `/finance/ledger-report.${ext}${q ? `?${q}` : ""}`,
        `finance-ledger-report.${ext}`,
      );
      toast.success(format === "xlsx" ? "Excel ledger downloaded" : "PDF ledger downloaded");
    } catch (err) {
      toast.error(errorMessage(err, "Export failed"));
    }
  };

  const report = reportQ.data;
  const accounts = accountsQ.data ?? [];
  const entryCount = report?.entries?.length ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("page.finance.title")}
        subtitle={t("page.finance.subtitle")}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => void exportFile("xlsx")}
              data-testid="finance-export-xlsx"
            >
              <Download className="mr-1 h-4 w-4" /> Export Excel
            </Button>
            <Button
              variant="outline"
              onClick={() => void exportFile("pdf")}
              data-testid="finance-export-pdf"
            >
              <Download className="mr-1 h-4 w-4" /> Export PDF
            </Button>
            <Button
              variant="outline"
              onClick={() => backfillM.mutate()}
              disabled={backfillM.isPending}
              data-testid="finance-backfill"
            >
              {backfillM.isPending ? "Backfilling…" : "Backfill journals"}
            </Button>
            <Button
              onClick={() => seedM.mutate()}
              disabled={seedM.isPending}
              data-testid="finance-seed"
            >
              {seedM.isPending ? "Seeding…" : "Seed COA"}
            </Button>
          </div>
        }
      />

      <Card className="border-[var(--color-primary)] bg-[var(--color-primary-muted)]">
        <CardContent className="space-y-2 pt-4 text-sm">
          <p className="font-semibold text-[var(--color-primary)]">Where is the report?</p>
          <p className="text-[var(--color-muted-foreground)]">
            It is on <strong>this page</strong> — scroll to <strong>Ledger report</strong> below
            (trial balance by account + recent journal lines). Not a tile under Reports catalog.
          </p>
          <ol className="list-decimal space-y-1 pl-5 text-[var(--color-muted-foreground)]">
            <li>Click <strong>Seed COA</strong> once (you already did — accounts show Ready).</li>
            <li>
              Click <strong>Backfill journals</strong> to post GL from existing tickets/loans, or
              issue a new ticket / loan payment.
            </li>
            <li>
              Filter Account + As of → read Debit/Credit/Net → <strong>Export Excel</strong> or{" "}
              <strong>Export PDF</strong> (Focus ERP style).
            </li>
          </ol>
          <p className="text-xs text-[var(--color-muted-foreground)]">
            Also:{" "}
            <Link href="/allocation" className="underline">
              Airfare Allocation
            </Link>
            {" · "}
            <Link href="/loans" className="underline">
              Loans
            </Link>
            {" · "}
            <Link href="/reports" className="underline">
              Ops Reports
            </Link>
            {" · "}
            <Link href="/ai-insights" className="underline">
              AI Insights
            </Link>
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Scale className="h-4 w-4" /> Status
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {statusQ.isLoading ? (
              <p className="text-muted-foreground">Checking…</p>
            ) : (
              <>
                <Badge variant={statusQ.data?.ready ? "default" : "secondary"}>
                  {statusQ.data?.ready ? "Ready" : "Migration needed"}
                </Badge>
                <p className="text-muted-foreground">{statusQ.data?.message}</p>
                <p className="text-xs text-muted-foreground">{statusQ.data?.pattern_source}</p>
              </>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Wallet className="h-4 w-4" /> Trial balance
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p>
              Debit <strong>{num(report?.total_debit)}</strong> · Credit{" "}
              <strong>{num(report?.total_credit)}</strong>
            </p>
            <Badge variant={report?.balanced ? "default" : "destructive"}>
              {report?.balanced ? "Balanced" : "Out of balance"}
            </Badge>
            <p className="text-xs text-muted-foreground">
              Currency {report?.currency ?? "BHD"} · Journals {entryCount}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4" /> AI
            </CardTitle>
            <CardDescription>
              Ask AI Insights about trial balance, loan receivable 1200, or ticket expense 4000.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BookOpen className="h-4 w-4" /> Chart of accounts
          </CardTitle>
          <CardDescription>Ticket expense, loan receivable, cash, and entitlement liability.</CardDescription>
        </CardHeader>
        <CardContent>
          {accountsQ.isLoading ? (
            <TableSkeleton rows={6} />
          ) : accounts.length === 0 ? (
            <EmptyState title="No accounts" message="Run Seed COA after migration 0015." />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Code</TH>
                  <TH>Name</TH>
                  <TH>Type</TH>
                </TR>
              </THead>
              <TBody>
                {accounts.map((a) => (
                  <TR key={a.code}>
                    <TD className="font-mono">{a.code}</TD>
                    <TD>{a.name}</TD>
                    <TD>{a.account_type}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card id="ledger-report">
        <CardHeader>
          <CardTitle className="text-base">Ledger report</CardTitle>
          <CardDescription>
            This is the GL report (python-accounting Trial Balance + account ledger). Filter by
            account and as-of date. Journals post on ticket issue / loan recovery, or use Backfill.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <Field label="Account">
              <Select
                value={accountCode}
                onChange={(e) => setAccountCode(e.target.value)}
                data-testid="finance-account-filter"
              >
                <option value="">All accounts</option>
                {accounts.map((a) => (
                  <option key={a.code} value={a.code}>
                    {a.code} — {a.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="As of">
              <Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
            </Field>
          </div>

          {reportQ.isLoading ? (
            <TableSkeleton rows={8} />
          ) : (
            <>
              <Table>
                <THead>
                  <TR>
                    <TH>Code</TH>
                    <TH>Name</TH>
                    <TH className="text-right">Debit</TH>
                    <TH className="text-right">Credit</TH>
                    <TH className="text-right">Net</TH>
                  </TR>
                </THead>
                <TBody>
                  {(report?.accounts ?? []).map((row) => (
                    <TR key={row.code}>
                      <TD className="font-mono">{row.code}</TD>
                      <TD>{row.name}</TD>
                      <TD className="text-right">{num(row.debit)}</TD>
                      <TD className="text-right">{num(row.credit)}</TD>
                      <TD className="text-right">{num(row.net)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>

              <h3 className="pt-2 text-sm font-medium">Recent journal lines</h3>
              {entryCount === 0 ? (
                <EmptyState
                  title="No journals yet"
                  message="Zeros are correct until journals exist. Click Backfill journals (above) or Issue a ticket / post a loan payment."
                  action={
                    <Button
                      onClick={() => backfillM.mutate()}
                      disabled={backfillM.isPending}
                      data-testid="finance-backfill-empty"
                    >
                      {backfillM.isPending ? "Backfilling…" : "Backfill journals now"}
                    </Button>
                  }
                />
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Date</TH>
                      <TH>Account</TH>
                      <TH>Source</TH>
                      <TH>Narration</TH>
                      <TH className="text-right">Debit</TH>
                      <TH className="text-right">Credit</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {report!.entries.map((e, i) => (
                      <TR key={`${e.entry_date}-${e.account_code}-${i}`}>
                        <TD>{e.entry_date}</TD>
                        <TD className="font-mono">{e.account_code}</TD>
                        <TD>{e.source_type}</TD>
                        <TD>{e.narration}</TD>
                        <TD className="text-right">{num(e.debit)}</TD>
                        <TD className="text-right">{num(e.credit)}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default FinancePage;
