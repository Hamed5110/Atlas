"use client";

/**
 * Classic ticket register — compact density so more rows fit on one screen.
 * Full name wraps in the identity column (no truncate).
 */

import { Eye, Paperclip, Pencil, Printer, Send, Trash2, type LucideIcon } from "lucide-react";
import { useRef } from "react";
import { SelectBox } from "@/components/bulk-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useTableCards } from "@/components/ui/table";
import { fmtDate, money, statusTone, ticketWorkflowStatusLabel } from "@/lib/format";
import { ticketPayBreakdown } from "@/lib/ticket-money";
import type { Ticket } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  waitingAgeClass,
  waitingAgeLabel,
  waitingDaysFromCreated,
} from "@/lib/waiting-age";

function paymentOptionLabel(handling: string | null | undefined): string {
  const key = (handling || "").trim().toUpperCase();
  if (key === "SELF_PAID") return "Self paid";
  if (key === "COMPANY_PAID") return "Company paid";
  if (key === "CONVERT_TO_LOAN" || key === "LOAN") return "Make loan";
  if (key === "ENTITLEMENT_AMOUNT") return "Entitlement";
  if (key === "SELF_PAID_FULL") return "Self paid (full)";
  return handling?.replace(/_/g, " ") || "—";
}

export function AllocationRegisterTable({
  tickets,
  selected,
  onToggle,
  onEdit,
  onPrint,
  onDocs,
  onDelete,
  onWorkflow,
  workflowFor,
  docsBusyId,
  selectLabel,
  workflowBusyId,
}: {
  tickets: Ticket[];
  selected: Set<string>;
  onToggle: (id: string, on: boolean) => void;
  onEdit: (t: Ticket) => void;
  onPrint: (t: Ticket) => void;
  onDocs: (t: Ticket) => void;
  onDelete: (t: Ticket) => void;
  onWorkflow?: (t: Ticket, next: string) => void;
  workflowFor?: (
    status: string
  ) => Array<{ next: string; label: string; icon: LucideIcon; tone: string }>;
  docsBusyId?: string | null;
  workflowBusyId?: string | null;
  selectLabel: (t: Ticket) => string;
}) {
  const tableRef = useRef<HTMLTableElement>(null);
  useTableCards(tableRef, tickets.length > 0);

  return (
    <div
      className="ticket-register-shell tt-table-scroll table-sheet-scroll relative w-full min-w-0 max-w-full max-h-[min(70vh,40rem)] overflow-auto overscroll-contain"
      data-testid="ticket-register"
    >
      <table
        ref={tableRef}
        className="table-cards ticket-register ticket-register--compact table-header-clip table-zebra text-xs"
        aria-label="Airfare ticket applications"
      >
        <caption className="sr-only">
          Ticket register: full name, route, amounts, payment option, and row actions. Approve, mark
          paid, and reject are on the Dashboard New Ticket desk.
        </caption>
        <colgroup>
          <col data-col="select" />
          <col data-col="name" />
          <col data-col="money" />
          <col data-col="money" />
          <col data-col="pay" />
          <col data-col="money" />
          <col data-col="money" />
          <col data-col="money" />
          <col data-col="money" />
          <col data-col="money" />
          <col data-col="actions" />
        </colgroup>
        <thead>
          <tr className="border-b border-[var(--color-border)] text-left text-[10px] font-bold uppercase tracking-wide text-[var(--color-muted-foreground)]">
            <th scope="col" data-cell="select" className="px-0.5 py-1">
              <span className="sr-only">Select</span>
            </th>
            <th scope="col" className="px-1 py-1">
              Employee name
            </th>
            <th scope="col" className="px-0.5 py-1 text-end" title="Ticket amount (BHD)">
              Ticket amount
            </th>
            <th scope="col" className="px-0.5 py-1 text-end" title="Total available funds (BHD)">
              Total available funds
            </th>
            <th scope="col" className="px-0.5 py-1" title="Payment option">
              Payment option
            </th>
            <th scope="col" className="px-0.5 py-1 text-end" title="Loan (BHD)">
              Loan
            </th>
            <th scope="col" className="px-0.5 py-1 text-end" title="Company pays (BHD)">
              Company pays
            </th>
            <th scope="col" className="px-0.5 py-1 text-end" title="Employee pays (BHD)">
              Employee pays
            </th>
            <th
              scope="col"
              className="px-0.5 py-1 text-end"
              title="Airfare balance deduction (BHD)"
            >
              Airfare balance deduction
            </th>
            <th scope="col" className="px-0.5 py-1 text-end" title="Net amount (BHD)">
              Net amount
            </th>
            <th scope="col" className="px-0.5 py-1 text-end">
              Action
            </th>
          </tr>
        </thead>
        <tbody>
          {tickets.map((t) => {
            const pay = ticketPayBreakdown(t);
            const displayName = t.employee_name || t.employee_code || "Employee";
            const waitDays =
              t.status === "submitted" ? waitingDaysFromCreated(t.created_at) : null;
            const actions = workflowFor?.(t.status) ?? [];
            const loanHot = pay.loanAmount > 0;

            return (
              <tr
                key={t.id}
                className={cn(
                  "border-b border-[var(--color-border)] last:border-0",
                  selected.has(t.id) && "bg-[var(--color-primary-muted)]/35"
                )}
                data-testid="ticket-card"
                data-ticket-id={t.id}
              >
                <td data-cell="select" className="px-0.5 py-0.5 align-middle">
                  <SelectBox
                    checked={selected.has(t.id)}
                    onChange={(on) => onToggle(t.id, on)}
                    label={selectLabel(t)}
                    testId={`select-ticket-${t.id}`}
                  />
                </td>
                <td data-cell="title" className="px-1 py-0.5 align-middle" data-label="Employee name">
                  <div className="min-w-0 max-w-full">
                    <p
                      className="font-semibold leading-snug text-[var(--color-foreground)] break-words whitespace-normal"
                      title={displayName}
                      data-testid={`ticket-full-name-${t.id}`}
                    >
                      {displayName}
                    </p>
                    <p className="mt-0.5 text-[10px] leading-tight text-[var(--color-muted-foreground)]">
                      {t.employee_code}
                      {t.ticket_code ? ` · ${t.ticket_code}` : ""}
                      {" · "}
                      <span className="font-mono font-semibold text-[var(--color-foreground)]">
                        {t.origin_code}→{t.destination_code}
                      </span>
                      {" · "}
                      {fmtDate(t.travel_date)}
                    </p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                      <Badge
                        variant={statusTone(t.status) as never}
                        className="max-w-full text-[9px] leading-none"
                      >
                        {ticketWorkflowStatusLabel(t.status)}
                      </Badge>
                      {waitDays != null ? (
                        <span
                          className={cn("text-[9px] tabular-nums", waitingAgeClass(waitDays))}
                          title="Days waiting in this queue"
                          data-testid={`ticket-waiting-${t.id}`}
                        >
                          {waitingAgeLabel(waitDays)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </td>
                <td
                  data-label="Ticket amount"
                  className="desk-num px-0.5 py-0.5 align-middle text-end tabular-nums font-semibold"
                >
                  {money(pay.ticketAmount, "")}
                </td>
                <td
                  data-label="Total available funds"
                  className="desk-num px-0.5 py-0.5 align-middle text-end tabular-nums"
                >
                  {money(pay.availableFund, "")}
                </td>
                <td
                  data-label="Payment option"
                  className="px-0.5 py-0.5 align-middle whitespace-nowrap text-[10px]"
                >
                  {paymentOptionLabel(t.excess_handling)}
                </td>
                <td
                  data-label="Loan"
                  className={cn(
                    "desk-num px-0.5 py-0.5 align-middle text-end tabular-nums",
                    loanHot && "font-semibold text-[var(--color-destructive)]"
                  )}
                >
                  {money(pay.loanAmount, "")}
                </td>
                <td
                  data-label="Company pays"
                  className="desk-num px-0.5 py-0.5 align-middle text-end tabular-nums"
                >
                  {money(pay.companyPays, "")}
                </td>
                <td
                  data-label="Employee pays"
                  className="desk-num px-0.5 py-0.5 align-middle text-end tabular-nums"
                >
                  {money(pay.employeePays, "")}
                </td>
                <td
                  data-label="Airfare balance deduction"
                  className="desk-num px-0.5 py-0.5 align-middle text-end tabular-nums"
                  title="Airfare balance deduction (BHD)"
                >
                  {money(pay.deduction, "")}
                </td>
                <td
                  data-label="Net amount"
                  className="desk-num px-0.5 py-0.5 align-middle text-end tabular-nums font-semibold"
                  data-testid="ticket-net-amount"
                >
                  {money(pay.netAmount, "")}
                </td>
                <td
                  data-label="Action"
                  data-cell="actions"
                  className="px-1 py-0.5 align-middle text-end whitespace-nowrap"
                >
                  <div
                    className="ms-auto inline-flex flex-nowrap items-center justify-end gap-1"
                    role="group"
                    aria-label={`Actions for ${displayName}`}
                    data-testid={`ticket-actions-${t.id}`}
                  >
                    {actions.map((a) => {
                      const Icon = a.icon || Send;
                      return (
                        <Button
                          key={a.next}
                          size="icon-sm"
                          variant={a.tone === "outline" ? "outline" : "default"}
                          disabled={workflowBusyId === t.id}
                          title={a.label}
                          aria-label={`${a.label} ${displayName}`}
                          data-testid={`btn-workflow-${a.next}-${t.id}`}
                          onClick={() => onWorkflow?.(t, a.next)}
                        >
                          <Icon size={13} aria-hidden />
                        </Button>
                      );
                    })}
                    <Button
                      size="icon-sm"
                      variant="outline"
                      title="Edit ticket"
                      aria-label={`Edit ticket for ${displayName}`}
                      data-testid={`btn-edit-ticket-${t.id}`}
                      onClick={() => onEdit(t)}
                    >
                      <Pencil size={13} aria-hidden />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="outline"
                      title="Print ticket"
                      aria-label={`Print ticket for ${displayName}`}
                      data-testid={`btn-print-ticket-${t.id}`}
                      onClick={() => onPrint(t)}
                    >
                      <Printer size={13} aria-hidden />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="outline"
                      title="Documents"
                      aria-label={`Documents for ${displayName}`}
                      data-testid={`btn-ticket-docs-${t.id}`}
                      disabled={docsBusyId === t.id}
                      onClick={() => onDocs(t)}
                    >
                      {docsBusyId === t.id ? (
                        <Eye size={13} className="animate-pulse" aria-hidden />
                      ) : (
                        <Paperclip size={13} aria-hidden />
                      )}
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="destructive"
                      title="Delete ticket"
                      aria-label={`Delete ticket for ${displayName}`}
                      data-testid={`btn-delete-ticket-${t.id}`}
                      onClick={() => onDelete(t)}
                    >
                      <Trash2 size={13} aria-hidden />
                    </Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
