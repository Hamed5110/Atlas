"use client";

import { useQuery } from "@tanstack/react-query";
import { Plane } from "lucide-react";
import {
  PENDING_RANGES,
  PENDING_TICKET_KEY,
  type PendingAppStatus,
  type PendingFilter,
  type PendingRangeKey,
  type PendingTrackerData,
} from "@/components/dashboard/pending-ticket-tracker";
import { StatCard } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";

const OPEN: PendingAppStatus[] = ["submitted", "approved"];

/** Compact pending-ticket pulse — same StatCard footprint as Open leave. */
export function PendingTicketCountBar({
  filter: _filter,
  onFilter,
  range,
  rangeReady = true,
}: {
  filter: PendingFilter;
  onFilter: (next: PendingFilter) => void;
  range: PendingRangeKey;
  rangeReady?: boolean;
}) {
  const t = useT();
  const { past, ahead } = PENDING_RANGES[range];
  const tracker = useQuery({
    queryKey: [...PENDING_TICKET_KEY, range],
    queryFn: () =>
      api<PendingTrackerData>(
        `/pending-tickets/tracker?past_days=${past}&ahead_days=${ahead}`
      ),
    enabled: rangeReady,
    staleTime: 0,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const counts = tracker.data?.counts;
  const openCount = (tracker.data?.items ?? []).filter((item) =>
    OPEN.includes(item.application_status)
  ).length;
  const waitingApproval = counts?.submitted ?? 0;
  const waitingPayment = counts?.approved ?? 0;
  const rejected = counts?.rejected ?? 0;

  const value =
    tracker.isPending && !tracker.data ? "…" : tracker.isError ? "—" : openCount;

  const hint = tracker.data
    ? t("pending.countBarHintCompact")
        .replace("{approval}", String(waitingApproval))
        .replace("{payment}", String(waitingPayment))
        .replace("{rejected}", String(rejected))
    : t("pending.countBarHint");

  const tone =
    waitingApproval > 0 ? "warning" : waitingPayment > 0 ? "accent" : "success";

  const open = () => {
    onFilter(waitingApproval > 0 ? "submitted" : "open");
    requestAnimationFrame(() => {
      document
        .getElementById("pending-ticket-tracker")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  return (
    <div data-testid="pending-ticket-count-bar">
      <StatCard
        label={t("pending.countBarTitle")}
        value={value}
        hint={hint}
        icon={<Plane size={22} />}
        tone={tone}
        onClick={open}
        data-testid="pending-count-open"
      />
    </div>
  );
}
