"use client";

import { fmtDate, money, titleCase } from "@/lib/format";
import { usePrimaryCompany } from "@/lib/branding";
import { cn } from "@/lib/utils";
import type { Ticket } from "@/lib/types";

/** Browser A4 preview — mirrors server allocation PDF letterhead (no duplicated values). */
export function AllocationPrintSheet({
  ticket,
  className,
}: {
  ticket: Ticket;
  className?: string;
}) {
  const { company, logo } = usePrimaryCompany();
  const excess = Math.max(
    0,
    Number(ticket.excess_cost ?? Number(ticket.ticket_cost) - Number(ticket.entitlement))
  );
  const isLoan =
    ticket.excess_handling === "CONVERT_TO_LOAN" || ticket.excess_handling === "LOAN";
  const docNo =
    ticket.ticket_code ||
    (ticket.ticket_number != null
      ? `T-${String(ticket.ticket_number).padStart(6, "0")}`
      : ticket.id.slice(0, 8));
  const currency = company?.currency || "BHD";

  return (
    <article
      className={cn(
        "print-page allocation-print-a4 mx-auto bg-white text-[hsl(222_47%_11%)]",
        className
      )}
    >
      <div className="mb-2 h-1 w-full bg-[hsl(217_91%_50%)]" />
      <header className="border-b border-[hsl(210_50%_30%)] pb-3 text-center">
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} alt={company?.name || "Company"} className="mx-auto h-14 w-14 object-contain" />
        ) : (
          <>
            <p className="text-base font-bold text-[hsl(210_50%_30%)]">{company?.name || "Company"}</p>
            <p className="text-[10px] text-[hsl(215_16%_47%)]">Confidential · Human Resources</p>
          </>
        )}
      </header>

      <div className="mt-3 text-center">
        <h1 className="text-base font-bold uppercase tracking-[0.12em] text-[hsl(210_50%_30%)]">
          Airfare Allocation
        </h1>
        <p className="mt-0.5 text-[15px] font-semibold leading-snug text-[hsl(210_50%_30%)]" dir="rtl" lang="ar">
          تخصيص بدل تذاكر السفر
        </p>
        <div className="mx-auto mt-2 h-px w-full bg-[hsl(214_32%_84%)]" />
      </div>

      <table className="mt-3 w-full table-fixed text-[13px]">
        <tbody>
          <tr>
            <td className="w-[55%] py-0.5 align-top">
              <span className="text-[hsl(215_16%_47%)]">Document No.</span>{" "}
              <span className="font-semibold" dir="ltr">
                {docNo}
              </span>
            </td>
            <td className="w-[45%] py-0.5 text-right align-top" dir="rtl" lang="ar">
              <span dir="ltr" className="font-semibold">
                {docNo}
              </span>{" "}
              رقم الوثيقة
            </td>
          </tr>
          <tr>
            <td className="py-0.5 align-top">
              <span className="text-[hsl(215_16%_47%)]">Travel Date :</span>{" "}
              <span className="font-semibold" dir="ltr">
                {fmtDate(ticket.travel_date)}
              </span>
            </td>
            <td className="py-0.5 text-right align-top" dir="rtl" lang="ar">
              <span dir="ltr" className="font-semibold">
                {fmtDate(ticket.travel_date)}
              </span>{" "}
              تاريخ السفر
            </td>
          </tr>
          <tr>
            <td className="py-0.5 align-top">
              <span className="text-[hsl(215_16%_47%)]">Status :</span>{" "}
              <span className="font-semibold">{titleCase(ticket.status)}</span>
            </td>
            <td className="py-0.5 text-right align-top" dir="rtl" lang="ar">
              <span dir="ltr" className="font-semibold">
                {titleCase(ticket.status)}
              </span>{" "}
              الحالة
            </td>
          </tr>
        </tbody>
      </table>

      <table className="mt-3 w-full table-fixed text-[13px]">
        <tbody>
          <tr>
            <td className="w-[22%] py-1 text-[hsl(215_16%_47%)]">Employee ID :</td>
            <td className="w-[56%] py-1 font-semibold" dir="ltr">
              {ticket.employee_code || "—"}
            </td>
            <td className="w-[22%] py-1 text-right text-[hsl(215_16%_47%)]" dir="rtl" lang="ar">
              رقم الموظف
            </td>
          </tr>
          <tr>
            <td className="py-1 text-[hsl(215_16%_47%)]">Name :</td>
            <td className="py-1 font-semibold" dir="ltr">
              {ticket.employee_name || "—"}
            </td>
            <td className="py-1 text-right text-[hsl(215_16%_47%)]" dir="rtl" lang="ar">
              الاسم
            </td>
          </tr>
        </tbody>
      </table>

      <section className="mt-4 overflow-hidden rounded border border-[hsl(215_16%_70%)]">
        <table className="w-full table-fixed text-[13px]">
          <thead className="bg-[hsl(210_40%_96%)] text-[hsl(210_50%_30%)]">
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
                ["Entitlement", money(ticket.entitlement), "مبلغ الاستحقاق"],
                ["Ticket amount", money(ticket.ticket_cost), "مبلغ التذكرة"],
                ["Company payout", money(ticket.company_paid), "حصة الشركة"],
                [
                  "Excess / handling",
                  `${money(excess)} / ${titleCase(ticket.excess_handling)}`,
                  "الفائض / المعالجة",
                ],
              ] as const
            ).map(([en, value, ar]) => (
              <tr key={en} className="border-t border-[hsl(214_32%_91%)]">
                <td className="px-2 py-1.5">{en}</td>
                <td className="px-2 py-1.5 text-right font-semibold" dir="ltr">
                  {value}
                </td>
                <td className="px-2 py-1.5 text-right" dir="rtl" lang="ar">
                  {ar}
                </td>
              </tr>
            ))}
            {isLoan || ticket.loan_code ? (
              <tr className="border-t border-[hsl(214_32%_91%)]">
                <td className="px-2 py-1.5">Recovery loan</td>
                <td className="px-2 py-1.5 text-right font-semibold" dir="ltr">
                  {ticket.loan_code || "—"}
                  {ticket.tenure_months ? ` · ${ticket.tenure_months} mo` : ""}
                </td>
                <td className="px-2 py-1.5 text-right" dir="rtl" lang="ar">
                  قرض الاسترداد
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>

      {ticket.notes ? (
        <p className="mt-3 text-[13px]">
          <span className="font-semibold">Notes:</span> {ticket.notes}
        </p>
      ) : null}

      <footer className="mt-8 grid grid-cols-2 gap-8 text-xs text-[hsl(215_16%_47%)]">
        <div>
          <div className="mb-8 border-t border-[hsl(222_47%_11%)] pt-1">Prepared by / أعدّه</div>
        </div>
        <div className="text-right">
          <div className="mb-8 ml-auto w-[78%] border-t border-[hsl(222_47%_11%)] pt-1">
            Approved by / اعتمد من
          </div>
        </div>
      </footer>
    </article>
  );
}
