"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { api } from "./api";

export type BadgeTone = "danger" | "warning" | "info";
export type BadgeKind = "ess_action" | "ess_open" | "tickets_submitted" | "documents_expiring";

export interface NavBadge {
  count: number;
  tone: BadgeTone;
  kind: BadgeKind;
  expired?: number;
  due?: number;
}

export type NavBadges = Record<string, NavBadge>;

export const NAV_BADGES_KEY = ["nav-badges"] as const;

export const BADGE_HINT_KEY: Record<BadgeKind, string> = {
  ess_action: "badge.essAction",
  ess_open: "badge.essOpen",
  tickets_submitted: "badge.ticketsSubmitted",
  documents_expiring: "badge.documentsExpiring",
};

const TONE_RANK: Record<BadgeTone, number> = { info: 0, warning: 1, danger: 2 };

export const formatBadgeCount = (count: number) => (count > 99 ? "99+" : String(count));

/** Strongest tone wins so a collapsed group still signals the most urgent item inside it. */
export function sumBadges(badges: NavBadges, hrefs: readonly string[]): NavBadge | undefined {
  let total: NavBadge | undefined;
  for (const href of hrefs) {
    const badge = badges[href];
    if (!badge?.count) continue;
    total = total
      ? {
          ...total,
          count: total.count + badge.count,
          tone: TONE_RANK[badge.tone] > TONE_RANK[total.tone] ? badge.tone : total.tone,
        }
      : badge;
  }
  return total;
}

async function fetchBadges(): Promise<NavBadges> {
  try {
    const data = await api<{ badges?: NavBadges }>("/nav/badges");
    return data?.badges ?? {};
  } catch {
    // Older API builds have no badge route; the menu must keep working without counts.
    return {};
  }
}

export function useNavBadges(enabled: boolean, pathname: string): NavBadges {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: NAV_BADGES_KEY,
    queryFn: fetchBadges,
    enabled,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    retry: false,
  });

  useEffect(() => {
    if (!enabled) return;
    const state = client.getQueryState(NAV_BADGES_KEY);
    if (state && Date.now() - state.dataUpdatedAt > 15_000) {
      void client.invalidateQueries({ queryKey: NAV_BADGES_KEY });
    }
  }, [client, enabled, pathname]);

  return query.data ?? {};
}
