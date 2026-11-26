"use client";

import type { QueryClient } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import type { DashboardInsights } from "./types";

export const DASHBOARD_INSIGHTS_KEY = ["dashboard-insights"] as const;

/** Bust every dashboard surface (KPIs, insights, amount balance, nav badges, trackers). */
export function invalidateDashboardData(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: ["dashboard"] });
  void qc.invalidateQueries({ queryKey: DASHBOARD_INSIGHTS_KEY });
  void qc.invalidateQueries({ queryKey: ["dashboard-amount-balance"] });
  void qc.invalidateQueries({ queryKey: ["nav-badges"] });
  void qc.invalidateQueries({ queryKey: ["forecast-budget"] });
  void qc.invalidateQueries({ queryKey: ["tickets", "recent"] });
}

/** Shared by the dashboard widgets and the sidebar glance so both read one cached request. */
export function useDashboardInsights(enabled = true) {
  return useQuery({
    queryKey: DASHBOARD_INSIGHTS_KEY,
    queryFn: () => api<DashboardInsights>("/dashboard/insights"),
    enabled,
    staleTime: 15_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: 2 * 60_000,
    retry: 1,
  });
}
