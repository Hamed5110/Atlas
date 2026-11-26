"use client";

import { money } from "@/lib/format";
import { usePrimaryCompany } from "@/lib/branding";
import { ticketPayBreakdown } from "@/lib/ticket-money";
import { cn } from "@/lib/utils";
import type { Ticket } from "@/lib/types";

function printDate(value: unknown): string {
  if (!value) return "—";
  const raw = String(value).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

/** Ticket workflow status → Arabic (TRUE MODE bilingual slip). */
function statusAr(status: string): string {
  const key = status.trim().toUpperCase().replace(/\s+/g, "_");
  const map: Record<string, string> = {
    PAID: "مدفوع",
    APPROVED: "معتمد",
    SUBMITTED: "مقدَّم",
    DRAFT: "مسودة",
    REJECTED: "مرفوض",
    CANCELLED: "ملغى",
    CANCELED: "ملغى",
  };
  return map[key] || status;
}

function BiHeader({ en, ar, align = "left" }: { en: string; ar: string; align?: "left" | "right" }) {
  return (
    <th
      className={cn(
        "px-2 py-1.5 text-[10px] font-bold uppercase leading-tight text-[var(--color-primary-emphasis)]",
        align === "right" ? "text-right" : "text-left"
      )}
    >
      <div>{en}</div>
      <div className="mt-0.5 text-[11px] font-semibold normal-case tracking-normal" dir="rtl" lang="ar">
        {ar}
      </div>
    </th>
  );
}

/** Browser A4 preview — same full bilingual layout as Download A4 PDF (attached slip). */
export function AllocationPrintSheet({
  ticket,
  className,
}: {
  ticket: Ticket;
  className?: string;
}) {
  const { company, logo } = usePrimaryCompany();
  const handling = String(ticket.excess_handling || "").toUpperCase();
  const isLoan = handling === "CONVERT_TO_LOAN" || handling === "LOAN";
  // Shared settle desk (lib/ticket-money.ts) — same money as the register,
  // CSV export and the backend Ticket Cost report, incl. legacy rows.
  const pay = ticketPayBreakdown(ticket);
  const companyPaid = pay.companyPays;
  const employeePayable = pay.employeePays;
  const excess = pay.loanAmount; // print "Loan" uses the loan-principal field
  const docNo =
    ticket.ticket_code ||
    (ticket.ticket_number != null
      ? `T-${String(ticket.ticket_number).padStart(6, "0")}`
      : ticket.id.slice(0, 8));
  const currency = company?.currency || "BHD";
  const status = String(ticket.status || "APPROVED").toUpperCase();
  const statusArabic = statusAr(status);
  const excessHandling = (handling || "SELF_PAID").replace(/_/g, " ");
  const loanLabel = ticket.loan_code
    ? `${ticket.loan_code}${ticket.loan_status ? ` (${String(ticket.loan_status).toUpperCase()})` : ""}`
    : isLoan && ticket.tenure_months
      ? `${ticket.tenure_months} mo · ${money(excess)}`
      : null;
  const asOf = ticket.as_of_date || ticket.travel_date;
  const opening = ticket.opening_balance_amount;
  const earned = ticket.current_year_earned_amount ?? ticket.current_year_amount;
  const alreadyPaid = ticket.already_paid_amount ?? ticket.entitlement;

  return (
    <article
      className={cn(
        "print-page allocation-print-a4 mx-auto bg-white text-[var(--color-foreground)]",
        className
      )}
    >
      <div className="mb-2 h-1 w-full bg-[var(--color-primary)]" />
      <header className="border-b border-[var(--color-primary-emphasis)] pb-3 text-center">
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} alt={company?.name || "Company"} className="mx-auto h-14 w-14 object-contain" />
        ) : (
          <>
            <p className="text-base font-bold text-[var(--color-primary-emphasis)]">{company?.name || "Company"}</p>
            <p className="text-[10px] text-[var(--color-muted-foreground)]">Confidential · Human Resources</p>
          </>
        )}
      </header>

      <div className="mt-3 text-center">
        <h1 className="text-base font-bold uppercase tracking-[0.12em] text-[var(--color-primary-emphasis)]">
          Airfare Allocation
        </h1>
        <p className="mt-0.5 text-[15px] font-semibold leading-snug text-[var(--color-primary-emphasis)]" dir="rtl" lang="ar">
          تخصيص بدل تذاكر السفر
        </p>
        <div className="mx-auto mt-2 h-px w-full bg-[var(--color-border)]" />
      </div>

      <table className="mt-3 w-full table-fixed text-[13px]">
        <tbody>
          <tr>
            <td className="w-[55%] py-0.5 align-top">
              <span className="text-[var(--color-muted-foreground)]">Document No.</span>{" "}
              <span className="font-semibold" dir="ltr">
                {docNo}
              </span>
            </td>
            <td className="w-[45%] py-0.5 text-right align-top" dir="rtl" lang="ar">
              رقم الوثيقة{" "}
              <span dir="ltr" className="font-semibold">
                {docNo}
              </span>
            </td>
          </tr>
          <tr>
            <td className="py-0.5 align-top">
              <span className="text-[var(--color-muted-foreground)]">Travel Date :</span>{" "}
              <span className="font-semibold" dir="ltr">
                {printDate(ticket.travel_date)}
              </span>
            </td>
            <td className="py-0.5 text-right align-top" dir="rtl" lang="ar">
              تاريخ السفر{" "}
              <span dir="ltr" className="font-semibold">
                {printDate(ticket.travel_date)}
              </span>
            </td>
          </tr>
          {ticket.leave_start_date && ticket.leave_end_date ? (
            <tr>
              <td className="py-0.5 align-top">
                <span className="text-[var(--color-muted-foreground)]">Leave Dates :</span>{" "}
                <span className="font-semibold" dir="ltr">
                  {printDate(ticket.leave_start_date)} → {printDate(ticket.leave_end_date)}
                </span>
              </td>
              <td className="py-0.5 text-right align-top" dir="rtl" lang="ar">
                تواريخ الإجازة{" "}
                <span dir="ltr" className="font-semibold">
                  {printDate(ticket.leave_start_date)} → {printDate(ticket.leave_end_date)}
                </span>
              </td>
            </tr>
          ) : null}
          <tr>
            <td className="py-0.5 align-top">
              <span className="text-[var(--color-muted-foreground)]">As of Date :</span>{" "}
              <span className="font-semibold" dir="ltr">
                {printDate(asOf)}
              </span>
            </td>
            <td className="py-0.5 text-right align-top" dir="rtl" lang="ar">
              اعتبارًا من{" "}
              <span dir="ltr" className="font-semibold">
                {printDate(asOf)}
              </span>
            </td>
          </tr>
          <tr>
            <td className="py-0.5 align-top">
              <span className="text-[var(--color-muted-foreground)]">Status :</span>{" "}
              <span className="font-semibold" dir="ltr">
                {status}
              </span>
            </td>
            <td className="py-0.5 text-right align-top font-semibold" dir="rtl" lang="ar">
              الحالة: {statusArabic}
            </td>
          </tr>
        </tbody>
      </table>

      <table className="mt-3 w-full table-fixed text-[13px]">
        <tbody>
          {(
            [
              ["Employee ID :", ticket.employee_code || "—", "رقم الموظف", ""],
              ["Name :", ticket.employee_name || "—", "الاسم", ticket.arabic_name || "—"],
              ["Nationality :", ticket.nationality || "—", "الجنسية", ""],
              ["Department :", ticket.department || "—", "القسم", ""],
              ["Designation :", ticket.designation || "—", "المسمى الوظيفي", ""],
              [
                "Date of Joining :",
                ticket.join_date ? printDate(ticket.join_date) : "—",
                "تاريخ الالتحاق",
                "",
              ],
              ["Reporting To :", ticket.reporting_officer || "—", "المدير المباشر", ""],
              ["Pay Group :", ticket.pay_group || "—", "مجموعة الرواتب", ""],
            ] as [string, string, string, string][]
          ).map(([en, value, ar, arVal]) => (
              <tr key={en}>
                <td className="w-[22%] py-1 text-[var(--color-muted-foreground)]">{en}</td>
                <td className="w-[34%] py-1 font-semibold" dir="ltr">
                  {value}
                </td>
                <td className="w-[22%] py-1 text-right font-semibold" dir="rtl" lang="ar">
                  {arVal}
                </td>
                <td className="w-[22%] py-1 text-right text-[var(--color-muted-foreground)]" dir="rtl" lang="ar">
                  {ar}
                </td>
              </tr>
            ))}
        </tbody>
      </table>

      <section className="mt-4 overflow-hidden rounded border border-[var(--neutral-300)]">
        <table className="w-full table-fixed text-[13px]">
          <thead className="bg-[var(--color-muted)] text-[var(--color-primary-emphasis)]">
            <tr>
              <th className="w-[40%] px-2 py-1.5 text-left text-[10px] font-bold uppercase">
                Ticket &amp; entitlement
              </th>
              <th className="w-[30%] px-2 py-1.5 text-right text-[10px] font-bold uppercase">
                Amount ({currency})
              </th>
              <th className="w-[30%] px-2 py-1.5 text-right text-[11px] font-bold" dir="rtl" lang="ar">
                التذكرة والاستحقاق
              </th>
            </tr>
          </thead>
          <tbody>
            {(
              [
                ["Route", `${ticket.origin_code} → ${ticket.destination_code}`, "المسار"],
                ["Entitlement Amount", money(ticket.entitlement), "مبلغ الاستحقاق"],
                ["Ticket Amount", money(ticket.ticket_cost), "مبلغ التذكرة"],
                ["Company Payout", money(companyPaid), "حصة الشركة"],
                ["Employee Payable", money(employeePayable), "المبلغ المستحق على الموظف"],
                ["Loan / Handling", `${money(excess)} / ${excessHandling}`, "القرض / المعالجة"],
              ] as const
            ).map(([en, value, ar]) => (
              <tr key={en} className="border-t border-[var(--color-border)]">
                <td className="px-2 py-1.5">{en}</td>
                <td className="px-2 py-1.5 text-right font-semibold" dir="ltr">
                  {value}
                </td>
                <td className="px-2 py-1.5 text-right" dir="rtl" lang="ar">
                  {ar}
                </td>
              </tr>
            ))}
            {loanLabel ? (
              <tr className="border-t border-[var(--color-border)]">
                <td className="px-2 py-1.5">Recovery Loan</td>
                <td className="px-2 py-1.5 text-right font-semibold" dir="ltr">
                  {loanLabel}
                </td>
                <td className="px-2 py-1.5 text-right" dir="rtl" lang="ar">
                  قرض الاسترداد
                </td>
              </tr>
            ) : null}
            <tr className="border-t border-[var(--color-border)] bg-[var(--color-primary-muted)]">
              <td className="px-2 py-1.5 font-semibold">Settlement</td>
              <td className="px-2 py-1.5 text-right font-semibold" dir="ltr">
                Company {money(companyPaid)} · Employee {money(employeePayable)}
              </td>
              <td className="px-2 py-1.5 text-right" dir="rtl" lang="ar">
                التسوية
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="mt-3 overflow-hidden rounded border border-[var(--neutral-300)]">
        <table className="w-full table-fixed text-[12px]">
          <thead className="bg-[var(--color-muted)]">
            <tr>
              <BiHeader en="Balance" ar="الرصيد" align="left" />
              <BiHeader en="Opening" ar="الافتتاحي" align="right" />
              <BiHeader en="Earned" ar="المكتسب" align="right" />
              <BiHeader en="Already Paid" ar="المدفوع مسبقاً" align="right" />
              <BiHeader en="Entitlement" ar="الاستحقاق" align="right" />
              <BiHeader en="Ticket" ar="التذكرة" align="right" />
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-[var(--color-border)]">
              <td className="px-2 py-1.5">
                <div>Airfare</div>
                <div className="text-[11px] text-[var(--color-muted-foreground)]" dir="rtl" lang="ar">
                  تذاكر السفر
                </div>
              </td>
              <td className="px-2 py-1.5 text-right font-semibold" dir="ltr">
                {money(opening ?? 0)}
              </td>
              <td className="px-2 py-1.5 text-right font-semibold" dir="ltr">
                {money(earned ?? 0)}
              </td>
              <td className="px-2 py-1.5 text-right font-semibold" dir="ltr">
                {money(alreadyPaid)}
              </td>
              <td className="px-2 py-1.5 text-right font-semibold" dir="ltr">
                {money(ticket.entitlement)}
              </td>
              <td className="px-2 py-1.5 text-right font-semibold" dir="ltr">
                {money(ticket.ticket_cost)}
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      {ticket.notes ? (
        <p className="mt-3 text-[13px]">
          <span className="font-semibold">Notes:</span> {ticket.notes}
        </p>
      ) : null}

      <p className="mt-3 text-[11px] text-[var(--color-muted-foreground)]">
        Computer-generated allocation slip — retain with the ticket voucher.
      </p>

      <footer className="mt-8 grid grid-cols-2 gap-8 text-xs text-[var(--color-muted-foreground)]">
        <div>
          <div className="mb-8 border-t border-[var(--color-foreground)] pt-1">Prepared by / أعدّه</div>
        </div>
        <div className="text-right">
          <div className="mb-8 ml-auto w-[78%] border-t border-[var(--color-foreground)] pt-1">
            Approved by / اعتمد من
          </div>
        </div>
      </footer>
    </article>
  );
}
