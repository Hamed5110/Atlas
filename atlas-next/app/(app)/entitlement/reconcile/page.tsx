"use client";

import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Select } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/primitives";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { api, errorMessage } from "@/lib/api";

interface ReconRow {
  employee_id: string;
  employee_name: string;
  expected_balance: number;
  current_balance: number;
  variance: number;
}

export default function EntitlementReconcilePage() {
  const year = new Date().getFullYear();
  const [fiscalYear, setFiscalYear] = useState(String(year));
  const [data, setData] = useState<{
    records: ReconRow[];
    total_variance: number;
    is_balanced: boolean;
  } | null>(null);

  const run = useMutation({
    mutationFn: () =>
      api<{ records: ReconRow[]; total_variance: number; is_balanced: boolean }>(
        `/entitlement/reconcile?fiscal_year=${fiscalYear}`
      ),
    onSuccess: (res) => {
      setData(res);
      toast.success(res.is_balanced ? "Balanced" : "Variances found");
    },
    onError: (err) => toast.error("Reconcile failed", errorMessage(err)),
  });

  return (
    <div className="animate-[fade-in_0.3s_ease-out]" data-testid="page-entitlement-reconcile">
      <PageHeader title="Entitlement reconciliation" subtitle="Expected vs current ledger balance" />
      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <Field label="Fiscal year">
            <Select data-testid="select-fiscal-year" value={fiscalYear} onChange={(e) => setFiscalYear(e.target.value)}>
              {[year - 1, year].map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Type">
            <Select data-testid="select-entitlement-type" defaultValue="AIRFARE">
              <option value="AIRFARE">Airfare</option>
            </Select>
          </Field>
          <Button variant="gradient" data-testid="btn-run-reconciliation" disabled={run.isPending} onClick={() => run.mutate()}>
            Run reconciliation
          </Button>
        </CardContent>
      </Card>

      {data ? (
        <>
          <div className="mb-3 flex flex-wrap gap-3 text-sm">
            <span data-testid="text-total-variance">Total variance: {Number(data.total_variance).toFixed(2)}</span>
            <span data-testid="text-is-balanced">{data.is_balanced ? "Yes" : "No"}</span>
          </div>
          <Table data-testid="table-reconciliation">
            <THead>
              <TR>
                <TH>Employee</TH>
                <TH>Expected</TH>
                <TH>Current</TH>
                <TH>Variance</TH>
              </TR>
            </THead>
            <TBody>
              {data.records.length === 0 ? (
                <TR>
                  <TD colSpan={4}>No ledger accounts for this year — run annual accrual first.</TD>
                </TR>
              ) : null}
              {data.records.map((r) => (
                <TR key={r.employee_id} data-testid={`row-reconcile-${r.employee_id}`}>
                  <TD>{r.employee_name}</TD>
                  <TD data-testid="text-expected-balance">{Number(r.expected_balance).toFixed(2)}</TD>
                  <TD data-testid="text-current-balance">{Number(r.current_balance).toFixed(2)}</TD>
                  <TD data-testid="text-variance">
                    {Number(r.variance) === 0 ? (
                      <Badge variant="success" data-testid="badge-variance-zero">
                        0
                      </Badge>
                    ) : (
                      <Badge variant="destructive" data-testid="badge-variance-nonzero">
                        {Number(r.variance).toFixed(2)}
                      </Badge>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </>
      ) : null}
    </div>
  );
}
