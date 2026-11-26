"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Banknote, CircleCheck, ExternalLink, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Select, Textarea } from "@/components/ui/input";
import { ListSkeleton } from "@/components/ui/skeleton";
import { useTableCards } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { ApiError, api, errorMessage } from "@/lib/api";
import { hasRole, useAuth } from "@/lib/auth";
import { invalidateDashboardData } from "@/lib/dashboard-insights";
import { fmtDate, ticketWorkflowStatusLabel } from "@/lib/format";
import {
  waitingAgeClass,
  waitingAgeLabel,
  waitingDaysFromCreated,
} from "@/lib/waiting-age";
import { useT } from "@/lib/i18n";
import {
  leaveFilterChipClass,
  leaveStatusVariant,
  parseLeaveStatus,
  ticketWorkflowVariant,
  type LeaveStatusKey,
} from "@/lib/leave-status";
import { appPath } from "@/lib/paths";
import { ticketDocumentPath } from "@/lib/record-links";
import { cn } from "@/lib/utils";

export type PendingAppStatus = "submitted" | "approved" | "rejected";
export type PendingFilter = PendingAppStatus | "open";

export interface PendingItem {
  ticket_id: string;
  ticket_code: string | null;
  employee_id: string;
  employee_code: string;
  employee_name: string;
  sub_section: string;
  trip_type: string;
  travel_date: string;
  created_at?: string;
  waiting_days?: number;
  leave_end_date: string;
  one_way_status?: string;
  duration: number | string;
  leave_status: string;
  application_status: PendingAppStatus;
  version: number;
}

export interface PendingTrackerData {
  as_of: string;
  counts: Record<PendingAppStatus, number>;
  items: PendingItem[];
}

const STATUSES: PendingAppStatus[] = ["submitted", "approved", "rejected"];
const OPEN_STATUSES: PendingAppStatus[] = ["submitted", "approved"];

export type PendingRangeKey = "recent" | "6m" | "12m";
/** past = backdated travel/application dates; ahead = upcoming travel. */
export const PENDING_RANGES: Record<PendingRangeKey, { past: number; ahead: number }> = {
  recent: { past: 90, ahead: 30 },
  "6m": { past: 180, ahead: 90 },
  "12m": { past: 365, ahead: 365 },
};
export const PENDING_RANGE_STORAGE_KEY = "pending-ticket-tracker-range";
export const PENDING_TICKET_KEY = ["dashboard", "pending-ticket-tracker"] as const;

/** Chip tones for application-status filters (mirror leaveFilterChipClass). */
function pendingFilterChipClass(key: PendingFilter, active: boolean): string {
  if (key === "open") {
    return leaveFilterChipClass("open", active);
  }
  const leaveKey: LeaveStatusKey =
    key === "submitted" ? "due_back" : key === "approved" ? "on_leave" : "overdue";
  return leaveFilterChipClass(leaveKey, active);
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}/.test(value.trim());
}

function applyStatusChange(
  data: PendingTrackerData,
  ticketId: string,
  next: string
): PendingTrackerData {
  const counts = { ...data.counts };
  const items: PendingItem[] = [];
  for (const item of data.items) {
    if (item.ticket_id !== ticketId) {
      items.push(item);
      continue;
    }
    counts[item.application_status] = Math.max(0, (counts[item.application_status] ?? 0) - 1);
    if (next === "paid") {
      // Paid leaves the pending desk.
      continue;
    }
    if (next === "approved" || next === "rejected") {
      const status = next as PendingAppStatus;
      counts[status] = (counts[status] ?? 0) + 1;
      items.push({
        ...item,
        application_status: status,
        version: item.version + 1,
      });
      continue;
    }
    items.push(item);
  }
  return { ...data, counts, items };
}

function leaveEndDisplay(
  t: (key: string) => string,
  leaveEnd: string,
  oneWay?: string
): string {
  const purpose = (oneWay || "").trim();
  if (purpose === "Cancellation") return t("pending.oneWay.cancellation");
  if (purpose === "Return booked later") return t("pending.oneWay.returnLater");
  if (purpose === "Return back ticket") return t("pending.oneWay.returnBack");
  if (leaveEnd === "Cancellation") return t("pending.oneWay.cancellation");
  if (leaveEnd === "Return booked later") return t("pending.oneWay.returnLater");
  if (leaveEnd === "Return back ticket") return t("pending.oneWay.returnBack");
  if (leaveEnd && isIsoDate(leaveEnd)) return fmtDate(leaveEnd);
  return leaveEnd || "—";
}

function leaveStatusLabel(t: (key: string) => string, status: string): string {
  const key = parseLeaveStatus(status);
  if (key) return t(`leave.status.${key}`);
  return status;
}

export function PendingTicketTracker({
  filter: controlledFilter,
  onFilterChange,
  range: controlledRange,
  onRangeChange,
  rangeReady = true,
}: {
  filter?: PendingFilter;
  onFilterChange?: (next: PendingFilter) => void;
  range?: PendingRangeKey;
  onRangeChange?: (next: PendingRangeKey) => void;
  rangeReady?: boolean;
} = {}) {
  const t = useT();
  const router = useRouter();
  const queryClient = useQueryClient();
  const me = useAuth((s) => s.me);
  // Match server policy: finance may only Mark paid; approve/reject need elevated roles.
  const canApproveReject = hasRole(me, "admin", "system_admin", "hr", "hr_manager", "manager");
  const canMarkPaid = canApproveReject || hasRole(me, "finance", "finance_manager");
  const [internalFilter, setInternalFilter] = useState<PendingFilter>("open");
  const [internalRange, setInternalRange] = useState<PendingRangeKey>("12m");
  const filter = controlledFilter ?? internalFilter;
  const setFilter = onFilterChange ?? setInternalFilter;
  const range = controlledRange ?? internalRange;
  const [rangeLoaded, setRangeLoaded] = useState(controlledRange != null ? rangeReady : false);
  const [rejectTarget, setRejectTarget] = useState<PendingItem | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  useEffect(() => {
    if (controlledRange != null) {
      setRangeLoaded(rangeReady);
      return;
    }
    const saved = window.localStorage.getItem(PENDING_RANGE_STORAGE_KEY);
    if (saved && saved in PENDING_RANGES) setInternalRange(saved as PendingRangeKey);
    setRangeLoaded(true);
  }, [controlledRange, rangeReady]);

  const changeRange = (next: PendingRangeKey) => {
    if (onRangeChange) onRangeChange(next);
    else {
      window.localStorage.setItem(PENDING_RANGE_STORAGE_KEY, next);
      setInternalRange(next);
    }
  };

  const { past, ahead } = PENDING_RANGES[range];
  const trackerKey = [...PENDING_TICKET_KEY, range];
  const tracker = useQuery({
    queryKey: trackerKey,
    queryFn: () =>
      api<PendingTrackerData>(
        `/pending-tickets/tracker?past_days=${past}&ahead_days=${ahead}`
      ),
    enabled: rangeLoaded,
    staleTime: 0,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: PENDING_TICKET_KEY });
    void queryClient.invalidateQueries({ queryKey: ["tickets"] });
    invalidateDashboardData(queryClient);
    void queryClient.invalidateQueries({ queryKey: ["loans"] });
  };

  const transition = useMutation({
    mutationFn: ({
      item,
      next,
      reason,
    }: {
      item: PendingItem;
      next: "approved" | "rejected" | "paid";
      reason?: string;
    }) =>
      api(`/tickets/${encodeURIComponent(item.ticket_id)}/status`, {
        method: "PATCH",
        body: { status: next, ...(reason ? { reason } : {}) },
        headers: { "If-Match": String(item.version) },
      }),
    onSuccess: (_result, vars) => {
      queryClient.setQueryData<PendingTrackerData>(trackerKey, (current) =>
        current ? applyStatusChange(current, vars.item.ticket_id, vars.next) : current
      );
      if (vars.next === "approved") {
        toast.success(t("pending.approved"), t("pending.approvedHint"));
        setFilter("approved");
      } else if (vars.next === "paid") {
        toast.success(t("pending.paid"), t("pending.paidHint"));
      } else if (vars.next === "rejected") {
        toast.success(t("pending.rejected"), t("pending.rejectedHint"));
        setRejectTarget(null);
        setRejectReason("");
        setFilter("rejected");
      }
      void refresh();
    },
    onError: (err) => {
      if (err instanceof ApiError && (err.status === 409 || err.code === "stale_version")) {
        toast.error(t("pending.stale"), t("pending.staleHint"));
        void refresh();
        return;
      }
      toast.error(t("pending.workflowFailed"), errorMessage(err));
    },
  });

  const data = tracker.data;
  const openCount = (data?.items ?? []).filter((item) =>
    OPEN_STATUSES.includes(item.application_status)
  ).length;
  const items = useMemo(() => {
    const filtered = (data?.items ?? []).filter((item) =>
      filter === "open"
        ? OPEN_STATUSES.includes(item.application_status)
        : item.application_status === filter
    );
    // Open queue: oldest-first (match Allocation approval desk / Concur).
    if (filter === "open" || filter === "submitted" || filter === "approved") {
      return [...filtered].sort((a, b) =>
        (a.created_at || "").localeCompare(b.created_at || "")
      );
    }
    return filtered;
  }, [data?.items, filter]);
  const tableRef = useRef<HTMLTableElement>(null);
  useTableCards(tableRef, tracker.isSuccess && items.length > 0);

  const openTicket = (ticketId: string) => {
    router.push(appPath(ticketDocumentPath(ticketId)));
  };

  const busyId = transition.isPending ? transition.variables?.item.ticket_id : null;

  return (
    <Card id="pending-ticket-tracker" className="mt-6" data-testid="pending-ticket-tracker">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>{t("pending.title")}</CardTitle>
            <CardDescription>{t("pending.subtitle")}</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t("pending.title")}>
            <Select
              aria-label={t("pending.range.label")}
              value={range}
              onChange={(e) => changeRange(e.target.value as PendingRangeKey)}
              className="h-8 w-auto py-0 text-xs"
              data-testid="pending-range"
            >
              {(Object.keys(PENDING_RANGES) as PendingRangeKey[]).map((key) => (
                <option key={key} value={key}>
                  {t(`pending.range.${key}`)}
                </option>
              ))}
            </Select>
            {(["open", ...STATUSES] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                data-testid={`pending-filter-${key}`}
                data-status-pill=""
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-semibold transition-colors cursor-pointer hover:brightness-[0.98]",
                  pendingFilterChipClass(key, filter === key)
                )}
              >
                {t(`pending.status.${key}`)}
                {data ? ` (${key === "open" ? openCount : (data.counts[key] ?? 0)})` : ""}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {tracker.isPending ? (
          <ListSkeleton items={4} label={t("state.loading")} />
        ) : tracker.isError ? (
          <p className="py-8 text-center text-sm text-[var(--color-destructive)]" role="alert">
            {t("pending.loadFailed")} {errorMessage(tracker.error)}
          </p>
        ) : items.length === 0 ? (
          <div className="py-8 text-center text-sm text-[var(--color-muted-foreground)]" data-testid="pending-empty">
            <p>{filter === "open" ? t("pending.emptyOpen") : t("pending.empty")}</p>
            <p className="mt-1 text-xs">
              {t("pending.windowHint")
                .replace("{past}", String(past))
                .replace("{ahead}", String(ahead))}
            </p>
            {range !== "12m" ? (
              <Button
                size="sm"
                variant="outline"
                className="mt-3"
                data-testid="pending-widen"
                onClick={() => changeRange("12m")}
              >
                {t("pending.widen")}
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="tt-table-scroll table-sheet-scroll relative max-h-[min(60vh,36rem)] w-full min-w-0 overflow-auto">
            <table
              ref={tableRef}
              className="table-cards table-header-clip table-zebra w-full text-sm"
              aria-label={t("pending.title")}
            >
              <caption className="sr-only">{t("pending.title")}</caption>
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-[11px] font-bold uppercase tracking-wide text-[var(--color-muted-foreground)]">
                  <th scope="col" className="py-2 pr-3">{t("pending.col.employee")}</th>
                  <th scope="col" className="py-2 pr-3">{t("pending.col.trip")}</th>
                  <th scope="col" className="py-2 pr-3">{t("pending.col.travel")}</th>
                  <th scope="col" className="py-2 pr-3">{t("pending.col.waiting")}</th>
                  <th scope="col" className="py-2 pr-3">{t("pending.col.leaveEnd")}</th>
                  <th scope="col" className="py-2 pr-3">{t("pending.col.duration")}</th>
                  <th scope="col" className="py-2 pr-3">{t("pending.col.leaveStatus")}</th>
                  <th scope="col" className="py-2 pr-3">{t("pending.col.appStatus")}</th>
                  <th scope="col" className="py-2 text-end">{t("pending.col.action")}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const rowBusy = busyId === item.ticket_id;
                  return (
                    <tr
                      key={item.ticket_id}
                      className="border-b border-[var(--color-border)] last:border-0"
                      data-testid={`pending-row-${item.ticket_id}`}
                    >
                      <td className="py-2.5 pr-3">
                        <p className="font-semibold">{item.employee_name}</p>
                        <p className="text-xs text-[var(--color-muted-foreground)]">
                          {item.employee_code}
                          {item.sub_section ? ` · ${item.sub_section}` : ""}
                          {item.ticket_code ? ` · ${item.ticket_code}` : ""}
                        </p>
                      </td>
                      <td className="py-2.5 pr-3 whitespace-nowrap">{item.trip_type || "—"}</td>
                      <td className="py-2.5 pr-3 whitespace-nowrap">
                        {item.travel_date ? fmtDate(item.travel_date) : "—"}
                      </td>
                      <td
                        className={cn(
                          "py-2.5 pr-3 whitespace-nowrap text-xs tabular-nums",
                          waitingAgeClass(
                            item.application_status === "submitted"
                              ? (item.waiting_days ??
                                  waitingDaysFromCreated(item.created_at))
                              : null
                          )
                        )}
                        title={
                          item.created_at
                            ? `Submitted ${fmtDate(item.created_at.slice(0, 10))}`
                            : undefined
                        }
                        data-testid={`pending-waiting-${item.ticket_id}`}
                      >
                        {item.application_status === "submitted"
                          ? waitingAgeLabel(
                              item.waiting_days ??
                                waitingDaysFromCreated(item.created_at)
                            ) || "—"
                          : "—"}
                      </td>
                      <td className="py-2.5 pr-3 whitespace-nowrap">
                        {leaveEndDisplay(t, item.leave_end_date, item.one_way_status)}
                      </td>
                      <td className="py-2.5 pr-3 whitespace-nowrap">
                        {item.duration !== "" && item.duration != null
                          ? `${item.duration} ${t("pending.days")}`
                          : "—"}
                      </td>
                      <td className="py-2.5 pr-3">
                        {item.leave_status ? (
                          <Badge variant={leaveStatusVariant(item.leave_status)}>
                            {leaveStatusLabel(t, item.leave_status)}
                          </Badge>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="py-2.5 pr-3">
                        <Badge variant={ticketWorkflowVariant(item.application_status)}>
                          {ticketWorkflowStatusLabel(item.application_status)}
                        </Badge>
                      </td>
                      <td className="py-2.5 text-end whitespace-nowrap">
                        <div
                          className="inline-flex flex-nowrap items-center justify-end gap-1.5 overflow-x-auto"
                          role="group"
                          aria-label={`Actions for ${item.employee_name}`}
                        >
                          {item.application_status === "submitted" && canApproveReject ? (
                            <>
                              <Button
                                size="sm"
                                disabled={rowBusy}
                                data-testid={`pending-approve-${item.ticket_id}`}
                                aria-label={`${t("pending.approve")} ${item.employee_name}`}
                                onClick={() =>
                                  transition.mutate({ item, next: "approved" })
                                }
                              >
                                <CircleCheck size={14} aria-hidden />
                                {t("pending.approve")}
                              </Button>
                              <Button
                                size="sm"
                                variant="destructive"
                                disabled={rowBusy}
                                data-testid={`pending-reject-${item.ticket_id}`}
                                aria-label={`${t("pending.reject")} ${item.employee_name}`}
                                onClick={() => {
                                  setRejectTarget(item);
                                  setRejectReason("");
                                }}
                              >
                                <XCircle size={14} aria-hidden />
                                {t("pending.reject")}
                              </Button>
                            </>
                          ) : null}
                          {item.application_status === "approved" ? (
                            <>
                              {canMarkPaid ? (
                                <Button
                                  size="sm"
                                  disabled={rowBusy}
                                  data-testid={`pending-pay-${item.ticket_id}`}
                                  aria-label={`${t("pending.markPaid")} ${item.employee_name}`}
                                  onClick={() => transition.mutate({ item, next: "paid" })}
                                >
                                  <Banknote size={14} aria-hidden />
                                  {t("pending.markPaid")}
                                </Button>
                              ) : null}
                              {canApproveReject ? (
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  disabled={rowBusy}
                                  data-testid={`pending-reject-${item.ticket_id}`}
                                  onClick={() => {
                                    setRejectTarget(item);
                                    setRejectReason("");
                                  }}
                                >
                                  <XCircle size={14} />
                                  {t("pending.reject")}
                                </Button>
                              ) : null}
                            </>
                          ) : null}
                          <Button
                            size="sm"
                            variant="outline"
                            data-testid={`pending-open-${item.ticket_id}`}
                            onClick={() => openTicket(item.ticket_id)}
                          >
                            <ExternalLink size={14} />
                            {t("pending.open")}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>

      <Dialog
        open={Boolean(rejectTarget)}
        onClose={() => {
          setRejectTarget(null);
          setRejectReason("");
        }}
        title={t("pending.rejectTitle")}
        description={t("pending.rejectHint")}
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => {
                setRejectTarget(null);
                setRejectReason("");
              }}
            >
              {t("action.cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={rejectReason.trim().length < 3 || transition.isPending}
              data-testid="pending-confirm-reject"
              onClick={() => {
                if (!rejectTarget) return;
                const fresh =
                  queryClient
                    .getQueryData<PendingTrackerData>(trackerKey)
                    ?.items.find((row) => row.ticket_id === rejectTarget.ticket_id) ??
                  rejectTarget;
                transition.mutate({
                  item: fresh,
                  next: "rejected",
                  reason: rejectReason.trim(),
                });
              }}
            >
              <XCircle size={14} />
              {transition.isPending ? t("state.working") : t("pending.reject")}
            </Button>
          </>
        }
      >
        <Field label={t("pending.rejectReason")} hint={t("pending.rejectReasonHint")}>
          <Textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder={t("pending.rejectPlaceholder")}
            rows={3}
            data-testid="pending-reject-reason"
          />
        </Field>
        {rejectTarget ? (
          <p className="mt-2 text-sm text-[var(--color-muted-foreground)]">
            {rejectTarget.employee_name}
            {rejectTarget.ticket_code ? ` · ${rejectTarget.ticket_code}` : ""}
          </p>
        ) : null}
      </Dialog>
    </Card>
  );
}
