"use client";

import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/primitives";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { api, errorMessage } from "@/lib/api";

export default function PayrollExportPage() {
  const year = new Date().getFullYear();
  const [fiscalYear, setFiscalYear] = useState(String(year));
  const [payrollRun, setPayrollRun] = useState(`PR-${year}-01`);
  const [result, setResult] = useState<{
    rows_exported: number;
    total_amount: number;
    preview: Array<{ transaction_id: string; employee_id: string; txn_type: string; amount: number }>;
  } | null>(null);

  const exportMut = useMutation({
    mutationFn: () =>
      api<{
        rows_exported: number;
        total_amount: number;
        preview: Array<{ transaction_id: string; employee_id: string; txn_type: string; amount: number }>;
      }>("/entitlement/export-payroll", {
        method: "POST",
        body: { fiscal_year: Number(fiscalYear), payroll_run_id: payrollRun },
      }),
    onSuccess: (res) => {
      setResult(res);
      toast.success("Exported to payroll log");
    },
    onError: (err) => toast.error("Export failed", errorMessage(err)),
  });

  return (
    <div className="animate-[fade-in_0.3s_ease-out]" data-testid="page-payroll-export">
      <PageHeader title="Payroll export" subtitle="Batch approved entitlement transactions" />
      <Card className="mb-4">
        <CardContent className="grid gap-3 p-4 sm:grid-cols-3">
          <Field label="Payroll run">
            <Input
              data-testid="select-payroll-run"
              value={payrollRun}
              onChange={(e) => setPayrollRun(e.target.value)}
            />
          </Field>
          <Field label="Fiscal year">
            <Select data-testid="select-fiscal-year" value={fiscalYear} onChange={(e) => setFiscalYear(e.target.value)}>
              {[year - 1, year].map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex items-end">
            <Button
              variant="gradient"
              data-testid="btn-export-to-payroll"
              disabled={exportMut.isPending}
              onClick={() => exportMut.mutate()}
            >
              Export to payroll
            </Button>
          </div>
        </CardContent>
      </Card>

      {result ? (
        <>
          <p data-testid="alert-export-success" className="mb-2 text-sm text-[var(--color-success)]">
            Export complete
          </p>
          <p data-testid="text-rows-exported">Rows: {result.rows_exported}</p>
          <p data-testid="text-total-export-amount" className="mb-3">
            Total: {Number(result.total_amount).toFixed(2)}
          </p>
          <Table data-testid="table-export-preview">
            <THead>
              <TR>
                <TH>Txn</TH>
                <TH>Employee</TH>
                <TH>Type</TH>
                <TH>Amount</TH>
              </TR>
            </THead>
            <TBody>
              {result.preview.map((r) => (
                <TR key={r.transaction_id}>
                  <TD className="font-mono text-xs">{r.transaction_id.slice(0, 8)}</TD>
                  <TD className="font-mono text-xs">{r.employee_id.slice(0, 8)}</TD>
                  <TD>{r.txn_type}</TD>
                  <TD>{Number(r.amount).toFixed(2)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </>
      ) : null}
    </div>
  );
}
