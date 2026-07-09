"use client";

import { CalendarClock, ClipboardCheck, Download, Paperclip, Plane, RefreshCw, Search, WalletCards } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Allocation, AllocationAttachment, atlasApiBase, atlasFetch } from "../../lib/atlas-api";
import { restoreSavedSession, SavedSession } from "./v2-session";
import styles from "./v2-shell.module.css";

type PaymentScope = "all" | "entitlement" | "company_full" | "employee" | "employee_full" | "loan";

function moneyFormat(amount: number) {
  return new Intl.NumberFormat("en-BH", {
    style: "currency",
    currency: "BHD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number(amount || 0));
}

function formatDate(value: string | undefined) {
  return value ? String(value).slice(0, 10) : "-";
}

const paymentModeLabels: Record<string, string> = {
  entitlement: "Use entitlement",
  company: "Paid by company",
  company_full: "Full paid by company",
  employee: "Paid by self employee",
  employee_full: "Paid by self employee full",
  loan: "Loan amount"
};

function formatPaymentModeLabel(mode: unknown) {
  const key = String(mode || "").trim().toLowerCase();
  if (!key) return "Unknown";
  return paymentModeLabels[key] || key.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function buildAllocationSettlementRows(allocation: Allocation) {
  return [
    { label: "Ticket amount", value: Number(allocation.TicketCost || 0) },
    { label: "Company paid", value: Number(allocation.CompanyPaid || 0) },
    { label: "Employee paid", value: Number(allocation.EmployeePaid || 0) },
    { label: "Loan amount", value: Number(allocation.LoanAmount || 0) },
    { label: "Excess amount", value: Number(allocation.ExcessAmount || 0) }
  ];
}

export default function V2AirfareModule() {
  const [savedSession, setSavedSession] = useState<SavedSession | null>(null);
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [attachmentsByAllocation, setAttachmentsByAllocation] = useState<Record<number, AllocationAttachment[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastCheckedAt, setLastCheckedAt] = useState("");
  const [searchText, setSearchText] = useState("");
  const [paymentScope, setPaymentScope] = useState<PaymentScope>("all");

  const fiscalYear = new Date().getFullYear();

  const loadAllocations = useCallback(async () => {
    const restored = restoreSavedSession();
    setSavedSession(restored);
    if (!restored) {
      setAllocations([]);
      setAttachmentsByAllocation({});
      setLoading(false);
      setError("");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const rows = await atlasFetch<Allocation[]>(
        `/allocations?year=${fiscalYear}`,
        restored.session.token,
        restored.session.sessionId
      );
      setAllocations(rows);
      setLastCheckedAt(new Date().toLocaleString("en-BH"));

      const ids = [...new Set(rows.map((row) => row.AllocationID))]
        .filter((id) => Number.isFinite(Number(id)))
        .slice(0, 1000)
        .map((id) => String(id));

      if (ids.length) {
        const attachments = await atlasFetch<AllocationAttachment[]>(
          `/allocations/attachments?ids=${encodeURIComponent(ids.join(","))}`,
          restored.session.token,
          restored.session.sessionId
        );
        const grouped = attachments.reduce((acc, attachment) => {
          const list = acc[attachment.AllocationID] || [];
          acc[attachment.AllocationID] = [...list, attachment];
          return acc;
        }, {} as Record<number, AllocationAttachment[]>);
        setAttachmentsByAllocation(grouped);
      } else {
        setAttachmentsByAllocation({});
      }
    } catch (loadError) {
      setAllocations([]);
      setAttachmentsByAllocation({});
      setError(loadError instanceof Error ? loadError.message : "Airfare allocations could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [fiscalYear]);

  useEffect(() => {
    void loadAllocations();
  }, [loadAllocations]);

  const filteredAllocations = useMemo(() => {
    const normalizedSearch = searchText.trim().toLowerCase();
    return allocations.filter((allocation) => {
      const mode = String(allocation.PaymentMode || "").toLowerCase();
      if (paymentScope !== "all" && mode !== paymentScope) return false;
      if (!normalizedSearch) return true;
      const haystack = [
        allocation.EmployeeCode,
        allocation.FullName,
        allocation.SelfServiceRequestNo,
        allocation.SelfServiceApprovalStatus,
        allocation.SelfServiceOrigin,
        allocation.SelfServiceDestination,
        allocation.Remarks,
        allocation.PaymentMode,
        allocation.TicketCost
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalizedSearch);
    });
  }, [allocations, paymentScope, searchText]);

  const metrics = useMemo(() => {
    const rows = filteredAllocations;
    const totalTicket = rows.reduce((sum, row) => sum + Number(row.TicketCost || 0), 0);
    const totalCompanyPaid = rows.reduce((sum, row) => sum + Number(row.CompanyPaid || 0), 0);
    const loanBacked = rows.filter((row) => String(row.PaymentMode || "").toLowerCase() === "loan").length;
    const linkedSelfService = rows.filter((row) => Number(row.SelfServiceRequestID || 0) > 0).length;
    return { totalTicket, totalCompanyPaid, loanBacked, linkedSelfService };
  }, [filteredAllocations]);

  async function viewAttachment(attachment: AllocationAttachment) {
    if (!savedSession) return;
    try {
      const response = await fetch(`${atlasApiBase()}/allocation-attachments/${attachment.AttachmentID}/view`, {
        headers: {
          Authorization: `Bearer ${savedSession.session.token}`,
          "X-Session-Id": savedSession.session.sessionId
        }
      });
      if (!response.ok) throw new Error("Attachment view failed.");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (attachmentError) {
      setError(attachmentError instanceof Error ? attachmentError.message : "Attachment view failed.");
    }
  }

  return (
    <section className={styles.moduleStack}>
      <section className={styles.overviewHero}>
        <div className={styles.overviewHeroCopy}>
          <p>Airfare module migration</p>
          <h1>Allocation register, now on live data.</h1>
          <span>
            This first Airfare pass brings the live allocation register, linked request evidence, attachment access, and current-year totals into `/v2` without changing the backend workflow on port 3355.
          </span>
        </div>
        <div className={styles.moduleStateCard}>
          <strong>Fiscal year {fiscalYear}</strong>
          <span>{loading ? "Refreshing allocation register..." : `${allocations.length} allocation row(s) loaded.`}</span>
          <small>{lastCheckedAt ? `Last checked ${lastCheckedAt}` : "Waiting for first sync."}</small>
        </div>
      </section>

      <section className={styles.moduleToolbar}>
        <div className={styles.moduleToolbarMeta}>
          <span className={styles.heroPill}>Airfare allocations</span>
          <span className={styles.toolbarMetaText}>Signed in as {savedSession?.session.user.fullName || savedSession?.session.user.username || "-"}</span>
        </div>
        <div className={styles.actionCluster}>
          <button type="button" className={styles.moduleGhostButton} disabled>
            <Plane size={16} />
            <span>Create allocation</span>
          </button>
          <button type="button" className={styles.moduleGhostButton} disabled>
            <Download size={16} />
            <span>Print / export</span>
          </button>
          <button
            type="button"
            className={styles.moduleActionButton}
            onClick={() => void loadAllocations()}
            aria-label="Refresh allocation data"
            data-testid="airfare-refresh"
            disabled={loading}
          >
            <RefreshCw size={16} />
            <span>{loading ? "Refreshing" : "Refresh data"}</span>
          </button>
        </div>
      </section>

      {error ? (
        <section className={styles.errorPanel} role="alert">
          <Plane size={18} />
          <div>
            <strong>Airfare sync failed</strong>
            <span>{error}</span>
          </div>
        </section>
      ) : null}

      <section className={styles.overviewMetricGrid}>
        <article className={styles.overviewMetricCard} data-testid="airfare-total-rows">
          <small>Visible allocations</small>
          <strong>{filteredAllocations.length}</strong>
          <span>Current-year allocation rows after search and payment-mode filtering.</span>
          <Plane size={18} />
        </article>
        <article className={styles.overviewMetricCard} data-testid="airfare-ticket-total">
          <small>Ticket total</small>
          <strong>{moneyFormat(metrics.totalTicket)}</strong>
          <span>Total ticket value for the filtered live register.</span>
          <WalletCards size={18} />
        </article>
        <article className={styles.overviewMetricCard} data-testid="airfare-company-paid-total">
          <small>Company paid</small>
          <strong>{moneyFormat(metrics.totalCompanyPaid)}</strong>
          <span>Live company-paid total from the same allocation rows.</span>
          <CalendarClock size={18} />
        </article>
        <article className={styles.overviewMetricCard} data-testid="airfare-loan-count">
          <small>Loan-backed tickets</small>
          <strong>{metrics.loanBacked}</strong>
          <span>{metrics.linkedSelfService} row(s) linked to self-service request evidence.</span>
          <ClipboardCheck size={18} />
        </article>
      </section>

      <article className={styles.panel}>
        <div className={styles.panelTitle}>
          <Search size={18} />
          <span>Allocation register</span>
        </div>

        <div className={styles.employeeToolbar}>
          <label className={styles.searchBox} aria-label="Search airfare allocations">
            <Search size={18} />
            <input
              placeholder="Search by employee, route, remarks, linked ESS number, or payment mode"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              data-testid="airfare-search"
            />
          </label>
          <label className={styles.filterSelectWrap}>
            <span>Payment mode</span>
            <select
              value={paymentScope}
              onChange={(event) => setPaymentScope(event.target.value as PaymentScope)}
              data-testid="airfare-payment-filter"
            >
              <option value="all">All payment modes</option>
              <option value="entitlement">Use entitlement</option>
              <option value="company_full">Full paid by company</option>
              <option value="employee">Paid by self employee</option>
              <option value="employee_full">Paid by self employee full</option>
              <option value="loan">Loan amount</option>
            </select>
          </label>
        </div>

        <div className={styles.airfareRegister}>
          {filteredAllocations.length === 0 ? (
            <div className={styles.emptyTableState}>
              <strong>No allocations match this filter.</strong>
              <small>Adjust the year slice later or widen the current payment/search filters.</small>
            </div>
          ) : (
            filteredAllocations.map((allocation) => {
              const attachments = attachmentsByAllocation[allocation.AllocationID] || [];
              return (
                <article key={allocation.AllocationID} className={styles.airfareCard} data-testid="airfare-row">
                  <div className={styles.airfareCardHead}>
                    <div className={styles.airfareIdentity}>
                      <strong>{allocation.EmployeeCode} - {allocation.FullName}</strong>
                      <small>AF-{allocation.AllocationID} / {formatDate(allocation.AllocationDate)}</small>
                    </div>
                    <span className={styles.signalBadge} data-status={String(allocation.PaymentMode || "").toLowerCase() === "loan" ? "warning" : "pass"}>
                      {formatPaymentModeLabel(allocation.PaymentMode)}
                    </span>
                  </div>

                  {allocation.SelfServiceRequestID ? (
                    <div className={styles.airfareEssChip}>
                      <ClipboardCheck size={14} />
                      <span>{allocation.SelfServiceRequestNo || `ESS-${allocation.SelfServiceRequestID}`}</span>
                      <small>{allocation.SelfServiceApprovalStatus || "Linked request"}</small>
                    </div>
                  ) : null}

                  <div className={styles.airfareFacts}>
                    <span><small>Route</small><strong>{allocation.SelfServiceOrigin && allocation.SelfServiceDestination ? `${allocation.SelfServiceOrigin} -> ${allocation.SelfServiceDestination}` : "-"}</strong></span>
                    <span><small>Ticket amount</small><strong>{moneyFormat(Number(allocation.TicketCost || 0))}</strong></span>
                    <span><small>Company paid</small><strong>{moneyFormat(Number(allocation.CompanyPaid || 0))}</strong></span>
                    <span><small>Excess amount</small><strong>{moneyFormat(Number(allocation.ExcessAmount || 0))}</strong></span>
                  </div>

                  <div className={styles.airfareBreakdown}>
                    {buildAllocationSettlementRows(allocation).map((row) => (
                      <span key={`${allocation.AllocationID}-${row.label}`}>
                        <small>{row.label}</small>
                        <strong>{moneyFormat(row.value)}</strong>
                      </span>
                    ))}
                  </div>

                  <div className={styles.airfareCardFoot}>
                    <div className={styles.airfareAttachmentMeta}>
                      <Paperclip size={14} />
                      <span>{attachments.length} attachment(s)</span>
                    </div>
                    <div className={styles.tableActionGroup}>
                      {attachments.length ? attachments.map((attachment) => (
                        <button
                          key={attachment.AttachmentID}
                          type="button"
                          className={styles.secondaryActionButton}
                          onClick={() => void viewAttachment(attachment)}
                        >
                          <Paperclip size={14} />
                          <span>{attachment.MimeType.includes("pdf") ? "View PDF" : "View image"}</span>
                        </button>
                      )) : (
                        <button type="button" className={styles.secondaryActionButton} disabled>
                          <Paperclip size={14} />
                          <span>No attachment</span>
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              );
            })
          )}
        </div>

        <div className={styles.standardNote}>
          <div>
            <strong>Next Airfare slice</strong>
            <span>Create allocation, edit/delete workflow, linked self-service navigation, and print actions remain queued for the next Airfare migration pass.</span>
          </div>
        </div>
      </article>
    </section>
  );
}
