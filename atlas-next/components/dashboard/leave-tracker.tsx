"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck, CalendarClock, CalendarX, Undo2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { ListSkeleton } from "@/components/ui/skeleton";
import { useTableCards } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { api, errorMessage } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { useT } from "@/lib/i18n";
import {
  LEAVE_STATUS_VARIANT,
  leaveFilterChipClass,
  type LeaveStatusKey,
} from "@/lib/leave-status";
import { cn } from "@/lib/utils";

type LeaveStatus = LeaveStatusKey;
export type LeaveFilter = LeaveStatus | "open";
type LeaveOutcome = "returned" | "cancelled";

interface LeaveItem {
  ticket_id: string;
  ticket_code: string | null;
  employee_code: string;
  employee_name: string;
  leave_start_date: string;
  leave_end_date: string;
  due_back_date: string;
  status: LeaveStatus;
  outcome?: LeaveOutcome | null;
  days_late: number | null;
  leave_days: number;
  actual_return_date: string | null;
  return_note: string;
}

interface LeaveTrackerData {
  as_of: string;
  counts: Record<LeaveStatus, number>;
  items: LeaveItem[];
}

const STATUSES: LeaveStatus[] = ["overdue", "due_back", "on_leave", "upcoming", "returned", "cancelled"];
const OPEN_STATUSES: LeaveStatus[] = ["overdue", "due_back", "on_leave", "upcoming"];
const VARIANT = LEAVE_STATUS_VARIANT;

export type LeaveRangeKey = "recent" | "6m" | "12m";
export const LEAVE_RANGES: Record<LeaveRangeKey, { past: number; ahead: number }> = {
  recent: { past: 60, ahead: 30 },
  "6m": { past: 183, ahead: 90 },
  "12m": { past: 365, ahead: 365 },
};
export const LEAVE_RANGE_STORAGE_KEY = "leave-tracker-range";
export const LEAVE_TRACKER_KEY = ["dashboard", "leave-tracker"] as const;

function applyClosure(
  data: LeaveTrackerData,
  ticketId: string,
  closedOn: string,
  note: string,
  status: "returned" | "cancelled"
): LeaveTrackerData {
  const counts = { ...data.counts };
  const items = data.items.map((item) => {
    if (item.ticket_id !== ticketId) return item;
    if (item.status !== status) {
      counts[item.status] = Math.max(0, (counts[item.status] ?? 0) - 1);
      counts[status] = (counts[status] ?? 0) + 1;
    }
    return {
      ...item,
      status,
      outcome: status,
      actual_return_date: closedOn,
      return_note: note,
      days_late: status === "cancelled" ? null : item.days_late,
    };
  });
  return { ...data, counts, items };
}

const todayIso = () => {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};

export function LeaveTracker({
  filter: controlledFilter,
  onFilterChange,
  range: controlledRange,
  onRangeChange,
  rangeReady = true,
}: {
  filter?: LeaveFilter;
  onFilterChange?: (next: LeaveFilter) => void;
  range?: LeaveRangeKey;
  onRangeChange?: (next: LeaveRangeKey) => void;
  rangeReady?: boolean;
} = {}) {
  const t = useT();
  const queryClient = useQueryClient();
  const [internalFilter, setInternalFilter] = useState<LeaveFilter>("open");
  const [internalRange, setInternalRange] = useState<LeaveRangeKey>("recent");
  const filter = controlledFilter ?? internalFilter;
  const setFilter = onFilterChange ?? setInternalFilter;
  const range = controlledRange ?? internalRange;
  const [marking, setMarking] = useState<LeaveItem | null>(null);
  const [cancelling, setCancelling] = useState<LeaveItem | null>(null);
  const [returnDate, setReturnDate] = useState(todayIso());
  const [cancelDate, setCancelDate] = useState(todayIso());
  const [note, setNote] = useState("");
  const [cancelNote, setCancelNote] = useState("");
  const [undoing, setUndoing] = useState<LeaveItem | null>(null);
  const [rangeLoaded, setRangeLoaded] = useState(controlledRange != null ? rangeReady : false);

  useEffect(() => {
    if (controlledRange != null) {
      setRangeLoaded(rangeReady);
      return;
    }
    const saved = window.localStorage.getItem(LEAVE_RANGE_STORAGE_KEY);
    if (saved && saved in LEAVE_RANGES) setInternalRange(saved as LeaveRangeKey);
    setRangeLoaded(true);
  }, [controlledRange, rangeReady]);

  const changeRange = (next: LeaveRangeKey) => {
    window.localStorage.setItem(LEAVE_RANGE_STORAGE_KEY, next);
    if (onRangeChange) onRangeChange(next);
    else setInternalRange(next);
  };

  const { past, ahead } = LEAVE_RANGES[range];
  const trackerKey = [...LEAVE_TRACKER_KEY, range];
  const tracker = useQuery({
    queryKey: trackerKey,
    queryFn: () =>
      api<LeaveTrackerData>(`/leave/tracker?past_days=${past}&ahead_days=${ahead}`),
    enabled: rangeLoaded,
    staleTime: 0,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: LEAVE_TRACKER_KEY });

  const record = useMutation({
    mutationFn: (item: LeaveItem) =>
      api(`/leave/returns/${encodeURIComponent(item.ticket_id)}`, {
        method: "PUT",
        body: { actual_return_date: returnDate, note, outcome: "returned" },
      }),
    onSuccess: (_result, item) => {
      queryClient.setQueryData<LeaveTrackerData>(trackerKey, (current) =>
        current ? applyClosure(current, item.ticket_id, returnDate, note, "returned") : current
      );
      toast.success(
        t("leave.saved"),
        item.status === "returned" ? item.employee_name : `${item.employee_name} — ${t("leave.movedToReturned")}`
      );
      setMarking(null);
      void refresh();
    },
    onError: (err) => toast.error(t("leave.saveFailed"), errorMessage(err)),
  });

  const cancelLeave = useMutation({
    mutationFn: (item: LeaveItem) =>
      api(`/leave/returns/${encodeURIComponent(item.ticket_id)}`, {
        method: "PUT",
        body: { actual_return_date: cancelDate, note: cancelNote, outcome: "cancelled" },
      }),
    onSuccess: (_result, item) => {
      queryClient.setQueryData<LeaveTrackerData>(trackerKey, (current) =>
        current
          ? applyClosure(current, item.ticket_id, cancelDate, cancelNote, "cancelled")
          : current
      );
      toast.success(
        t("leave.cancelSaved"),
        `${item.employee_name} — ${t("leave.movedToCancelled")}`
      );
      setCancelling(null);
      void refresh();
    },
    onError: (err) => toast.error(t("leave.saveFailed"), errorMessage(err)),
  });

  const undo = useMutation({
    mutationFn: (item: LeaveItem) =>
      api(`/leave/returns/${encodeURIComponent(item.ticket_id)}`, { method: "DELETE" }),
    onSuccess: () => {
      setUndoing(null);
      void refresh();
    },
    onError: (err) => toast.error(t("leave.saveFailed"), errorMessage(err)),
  });

  const openMark = (item: LeaveItem) => {
    setMarking(item);
    setReturnDate(item.actual_return_date ?? todayIso());
    setNote(item.return_note ?? "");
  };

  const openCancel = (item: LeaveItem) => {
    setCancelling(item);
    setCancelDate(item.status === "cancelled" && item.actual_return_date ? item.actual_return_date : todayIso());
    setCancelNote(item.status === "cancelled" ? item.return_note ?? "" : "");
  };

  const data = tracker.data;
  const openCount = (data?.items ?? []).filter((item) => OPEN_STATUSES.includes(item.status)).length;
  const items = (data?.items ?? []).filter((item) =>
    filter === "open" ? OPEN_STATUSES.includes(item.status) : item.status === filter
  );
  const tableRef = useRef<HTMLTableElement>(null);
  useTableCards(tableRef, tracker.isSuccess && items.length > 0);

  const lateText = (item: LeaveItem) => {
    if (item.status === "cancelled") return "";
    if (item.days_late == null) return "";
    if (item.status === "overdue") return `${item.days_late} ${t("leave.daysOverdue")}`;
    if (item.days_late > 0) return `${item.days_late} ${t("leave.daysLate")}`;
    if (item.days_late < 0) return `${Math.abs(item.days_late)} ${t("leave.daysEarly")}`;
    return t("leave.onTime");
  };

  const canCancel = (item: LeaveItem) =>
    item.status === "overdue" ||
    item.status === "due_back" ||
    item.status === "on_leave" ||
    item.status === "upcoming" ||
    item.status === "cancelled";

  return (
    <Card id="leave-tracker" className="mt-6" data-testid="leave-tracker">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>{t("leave.title")}</CardTitle>
            <CardDescription>{t("leave.subtitle")}</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t("leave.title")}>
            <Select
              aria-label={t("leave.range.label")}
              value={range}
              onChange={(e) => changeRange(e.target.value as LeaveRangeKey)}
              className="h-8 w-auto py-0 text-xs"
              data-testid="leave-range"
            >
              {(Object.keys(LEAVE_RANGES) as LeaveRangeKey[]).map((key) => (
                <option key={key} value={key}>
                  {t(`leave.range.${key}`)}
                </option>
              ))}
            </Select>
            {(["open", ...STATUSES] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                data-testid={`leave-filter-${key}`}
                data-status-pill=""
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-semibold transition-colors cursor-pointer hover:brightness-[0.98]",
                  leaveFilterChipClass(key, filter === key)
                )}
              >
                {t(`leave.status.${key}`)}
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
            {t("leave.loadFailed")} {errorMessage(tracker.error)}
          </p>
        ) : items.length === 0 ? (
          <div className="py-8 text-center text-sm text-[var(--color-muted-foreground)]" data-testid="leave-empty">
            <p>{filter === "open" ? t("leave.emptyOpen") : t("leave.empty")}</p>
            <p className="mt-1 text-xs">
              {t("leave.windowHint")
                .replace("{past}", String(past))
                .replace("{ahead}", String(ahead))}
            </p>
            {range !== "12m" &&
            (filter === "returned" || filter === "cancelled" || filter === "upcoming") ? (
              <Button
                size="sm"
                variant="outline"
                className="mt-3"
                data-testid="leave-widen"
                onClick={() => changeRange("12m")}
              >
                {t("leave.widen")}
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table
              ref={tableRef}
              className="table-cards w-full text-sm"
              aria-label={t("leave.title")}
            >
              <caption className="sr-only">{t("leave.title")}</caption>
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-[11px] font-bold uppercase tracking-wide text-[var(--color-muted-foreground)]">
                  <th scope="col" className="py-2 pr-3">{t("leave.col.employee")}</th>
                  <th scope="col" className="py-2 pr-3">{t("leave.col.start")}</th>
                  <th scope="col" className="py-2 pr-3">{t("leave.col.end")}</th>
                  <th scope="col" className="py-2 pr-3">{t("leave.col.status")}</th>
                  <th scope="col" className="py-2 pr-3">{t("leave.col.returned")}</th>
                  <th scope="col" className="py-2 text-end">{t("leave.col.action")}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr
                    key={item.ticket_id}
                    className="border-b border-[var(--color-border)] last:border-0"
                    data-testid={`leave-row-${item.ticket_id}`}
                  >
                    <td className="py-2.5 pr-3">
                      <p className="font-semibold">{item.employee_name}</p>
                      <p className="text-xs text-[var(--color-muted-foreground)]">
                        {item.employee_code}
                        {item.ticket_code ? ` · ${item.ticket_code}` : ""}
                      </p>
                    </td>
                    <td className="py-2.5 pr-3 whitespace-nowrap">{fmtDate(item.leave_start_date)}</td>
                    <td className="py-2.5 pr-3 whitespace-nowrap">
                      {fmtDate(item.leave_end_date)}
                      <p className="text-xs text-[var(--color-muted-foreground)]">
                        {item.leave_days} {t("leave.days")}
                      </p>
                    </td>
                    <td className="py-2.5 pr-3">
                      <Badge variant={VARIANT[item.status]}>{t(`leave.status.${item.status}`)}</Badge>
                      {lateText(item) ? (
                        <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">{lateText(item)}</p>
                      ) : null}
                    </td>
                    <td className="py-2.5 pr-3 whitespace-nowrap">
                      {item.actual_return_date ? fmtDate(item.actual_return_date) : "—"}
                      {item.return_note ? (
                        <p className="max-w-[16rem] truncate text-xs text-[var(--color-muted-foreground)]">
                          {item.return_note}
                        </p>
                      ) : null}
                    </td>
                    <td className="py-2.5 text-end whitespace-nowrap">
                      <div
                        className="inline-flex flex-nowrap items-center justify-end gap-1.5 overflow-x-auto"
                        role="group"
                        aria-label={`Actions for ${item.employee_name}`}
                      >
                        {item.status !== "cancelled" ? (
                          <Button
                            size="sm"
                            variant={item.status === "returned" ? "outline" : "default"}
                            data-testid={`leave-mark-${item.ticket_id}`}
                            aria-label={`${item.status === "returned" ? t("leave.edit") : t("leave.markReturned")} ${item.employee_name}`}
                            onClick={() => openMark(item)}
                          >
                            <CalendarCheck size={14} aria-hidden />
                            {item.status === "returned" ? t("leave.edit") : t("leave.markReturned")}
                          </Button>
                        ) : null}
                        {canCancel(item) ? (
                          <Button
                            size="sm"
                            variant="outline"
                            data-testid={`leave-cancel-${item.ticket_id}`}
                            aria-label={`${item.status === "cancelled" ? t("leave.edit") : t("leave.employeeCancel")} ${item.employee_name}`}
                            onClick={() => openCancel(item)}
                          >
                            <CalendarX size={14} aria-hidden />
                            {item.status === "cancelled" ? t("leave.edit") : t("leave.employeeCancel")}
                          </Button>
                        ) : null}
                        {item.status === "returned" || item.status === "cancelled" ? (
                          <Button
                            size="icon-sm"
                            variant="outline"
                            aria-label={`${t("leave.undo")} ${item.employee_name}`}
                            title={t("leave.undo")}
                            onClick={() => setUndoing(item)}
                          >
                            <Undo2 size={14} aria-hidden />
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>

      <Dialog
        open={Boolean(marking)}
        onClose={() => setMarking(null)}
        title={t("leave.markTitle")}
        description={
          marking
            ? `${marking.employee_name} · ${fmtDate(marking.leave_start_date)} → ${fmtDate(marking.leave_end_date)} · ${t("leave.dueBack")} ${fmtDate(marking.due_back_date)}`
            : undefined
        }
        footer={
          <>
            <Button variant="outline" onClick={() => setMarking(null)}>
              {t("action.cancel")}
            </Button>
            <Button
              disabled={!returnDate || record.isPending}
              data-testid="leave-save-return"
              onClick={() => marking && record.mutate(marking)}
            >
              <CalendarClock size={15} />
              {record.isPending ? t("state.working") : t("action.save")}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label={t("leave.actualReturn")}>
            <Input
              type="date"
              value={returnDate}
              max={todayIso()}
              data-testid="leave-return-date"
              onChange={(e) => setReturnDate(e.target.value)}
            />
          </Field>
          <Field label={t("leave.note")}>
            <Input
              value={note}
              maxLength={500}
              placeholder={t("leave.notePlaceholder")}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
        </div>
      </Dialog>

      <Dialog
        open={Boolean(cancelling)}
        onClose={() => setCancelling(null)}
        title={t("leave.cancelTitle")}
        description={
          cancelling
            ? `${cancelling.employee_name} · ${fmtDate(cancelling.leave_start_date)} → ${fmtDate(cancelling.leave_end_date)}`
            : undefined
        }
        footer={
          <>
            <Button variant="outline" onClick={() => setCancelling(null)}>
              {t("action.cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={!cancelDate || cancelNote.trim().length < 3 || cancelLeave.isPending}
              data-testid="leave-save-cancel"
              onClick={() => cancelling && cancelLeave.mutate(cancelling)}
            >
              <CalendarX size={15} />
              {cancelLeave.isPending ? t("state.working") : t("leave.employeeCancel")}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-[var(--color-muted-foreground)]">{t("leave.cancelHint")}</p>
          <Field label={t("leave.cancelDate")}>
            <Input
              type="date"
              value={cancelDate}
              max={todayIso()}
              data-testid="leave-cancel-date"
              onChange={(e) => setCancelDate(e.target.value)}
            />
          </Field>
          <Field label={t("leave.note")}>
            <Input
              value={cancelNote}
              maxLength={500}
              placeholder={t("leave.cancelReasonPlaceholder")}
              data-testid="leave-cancel-note"
              onChange={(e) => setCancelNote(e.target.value)}
            />
          </Field>
        </div>
      </Dialog>

      <ConfirmDialog
        open={Boolean(undoing)}
        onClose={() => setUndoing(null)}
        onConfirm={() => undoing && undo.mutate(undoing)}
        title={t("leave.undo")}
        message={undoing ? `${undoing.employee_name} — ${t("leave.undoBody")}` : ""}
        confirmLabel={t("leave.undo")}
        destructive
        busy={undo.isPending}
      />
    </Card>
  );
}
