"use client";

import { useQuery } from "@tanstack/react-query";
import { CalendarClock } from "lucide-react";
import {
  LEAVE_RANGES,
  LEAVE_TRACKER_KEY,
  type LeaveFilter,
  type LeaveRangeKey,
} from "@/components/dashboard/leave-tracker";
import { StatCard } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";

type LeaveStatus = "overdue" | "due_back" | "on_leave" | "upcoming" | "returned" | "cancelled";

type LeaveTrackerData = {
  as_of: string;
  counts: Record<LeaveStatus, number>;
  items: { status: LeaveStatus }[];
};

const OPEN: LeaveStatus[] = ["overdue", "due_back", "on_leave", "upcoming"];

/** Compact leave pulse — same StatCard footprint as Airfare spend (YTD). */
export function LeaveCountBar({
  filter: _filter,
  onFilter,
  range,
  rangeReady = true,
}: {
  filter: LeaveFilter;
  onFilter: (next: LeaveFilter) => void;
  range: LeaveRangeKey;
  rangeReady?: boolean;
}) {
  const t = useT();
  const { past, ahead } = LEAVE_RANGES[range];
  const tracker = useQuery({
    queryKey: [...LEAVE_TRACKER_KEY, range],
    queryFn: () => api<LeaveTrackerData>(`/leave/tracker?past_days=${past}&ahead_days=${ahead}`),
    enabled: rangeReady,
    staleTime: 0,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const counts = tracker.data?.counts;
  const openCount = (tracker.data?.items ?? []).filter((item) => OPEN.includes(item.status)).length;
  const overdue = counts?.overdue ?? 0;
  const dueBack = counts?.due_back ?? 0;
  const onLeave = counts?.on_leave ?? 0;
  const upcoming = counts?.upcoming ?? 0;

  const value =
    tracker.isPending && !tracker.data ? "…" : tracker.isError ? "—" : openCount;

  const hint = tracker.data
    ? t("leave.countBarHintCompact")
        .replace("{overdue}", String(overdue))
        .replace("{dueBack}", String(dueBack))
        .replace("{onLeave}", String(onLeave))
        .replace("{upcoming}", String(upcoming))
    : t("leave.countBarHint");

  // Priority pulse: overdue → due back → on leave (accent ≈ info on StatCard) → clear.
  const tone =
    overdue > 0 ? "destructive" : dueBack > 0 ? "warning" : onLeave > 0 ? "accent" : "success";

  const open = () => {
    onFilter(overdue > 0 ? "overdue" : "open");
    requestAnimationFrame(() => {
      document.getElementById("leave-tracker")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  return (
    <div data-testid="leave-count-bar">
      <StatCard
        label={t("leave.countBarTitle")}
        value={value}
        hint={hint}
        icon={<CalendarClock size={22} />}
        tone={tone}
        onClick={open}
        data-testid="leave-count-open"
      />
    </div>
  );
}
