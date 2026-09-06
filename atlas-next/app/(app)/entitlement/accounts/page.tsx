"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Select } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/primitives";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { api } from "@/lib/api";
import type { Employee } from "@/lib/types";

export default function EntitlementAccountsPage() {
  const year = new Date().getFullYear();
  const [employeeId, setEmployeeId] = useState("");
  const [fiscalYear, setFiscalYear] = useState(String(year));

  const employees = useQuery({
    queryKey: ["employees", "all"],
    queryFn: () => api<Employee[]>("/employees?limit=500"),
  });

  const balance = useQuery({
    queryKey: ["entitlement-balance", employeeId, fiscalYear],
    queryFn: () =>
      api<{
        account: {
          opening_balance: number;
          accruals: number;
          used_amount: number;
          adjustments: number;
          current_balance: number;
        } | null;
        transactions: Array<{ id: string; txn_type: string; amount: number }>;
      }>(`/entitlement/employee/${employeeId}/balance?fiscal_year=${fiscalYear}`),
    enabled: Boolean(employeeId),
  });

  const account = balance.data?.account;

  return (
    <div className="animate-[fade-in_0.3s_ease-out]" data-testid="page-entitlement-accounts">
      <PageHeader title="Entitlement accounts" subtitle="Recurring annual ledger per employee" />
      <Card className="mb-4">
        <CardContent className="grid gap-3 p-4 sm:grid-cols-3">
          <Field label="Employee">
            <Select data-testid="select-employee" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              <option value="">Select…</option>
              {(employees.data ?? []).map((e) => (
                <option key={e.id} value={e.id}>
                  {e.code} — {e.full_name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Fiscal year">
            <Select data-testid="select-fiscal-year" value={fiscalYear} onChange={(e) => setFiscalYear(e.target.value)}>
              {[year - 1, year, year + 1].map((y) => (
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
        </CardContent>
      </Card>

      <Card className="mb-4" data-testid="card-account-summary">
        <CardHeader>
          <CardTitle>Account summary</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <div>
            <p className="text-xs uppercase text-[var(--color-muted-foreground)]">Opening</p>
            <p className="text-lg font-bold" data-testid="text-opening-balance">
              {account ? Number(account.opening_balance).toFixed(2) : "—"}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase text-[var(--color-muted-foreground)]">Accruals</p>
            <p className="text-lg font-bold" data-testid="text-accruals">
              {account ? Number(account.accruals).toFixed(2) : "—"}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase text-[var(--color-muted-foreground)]">Used</p>
            <p className="text-lg font-bold" data-testid="text-used">
              {account ? Number(account.used_amount).toFixed(2) : "—"}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase text-[var(--color-muted-foreground)]">Adjustments</p>
            <p className="text-lg font-bold" data-testid="text-adjustments">
              {account ? Number(account.adjustments).toFixed(2) : "—"}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase text-[var(--color-muted-foreground)]">Current</p>
            <p className="text-lg font-bold" data-testid="text-current-balance">
              {account ? Number(account.current_balance).toFixed(2) : "—"}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table data-testid="table-transaction-history">
            <THead>
              <TR>
                <TH>Type</TH>
                <TH>Amount</TH>
              </TR>
            </THead>
            <TBody>
              {(balance.data?.transactions ?? []).map((t) => (
                <TR key={t.id} data-testid={`row-transaction-${t.id}`}>
                  <TD>
                    <span data-testid={`badge-txn-type-${t.txn_type}`}>{t.txn_type}</span>
                  </TD>
                  <TD>{Number(t.amount).toFixed(2)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
