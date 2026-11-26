"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useDebounced } from "@/lib/use-debounced";

export type FareLight = "green" | "amber" | "red" | "none" | "off";

export interface FareCheck {
  mode: "enforce" | "warn" | "off";
  light: FareLight;
  route: string;
  amount: string;
  tolerance_pct: number;
  lookback_months: number;
  benchmark: string | null;
  threshold: string | null;
  low: string | null;
  high: string | null;
  samples: number;
  basis: "route" | "destination" | null;
  over_pct: number | null;
  reason_required: boolean;
  message: string;
}

const IATA = /^[A-Z]{3}$/;

export function useFareCheck(
  origin: string,
  destination: string,
  amount: number,
  asOf: string,
  excludeTicketId?: string
) {
  const live = new URLSearchParams({
    origin: origin.trim().toUpperCase(),
    destination: destination.trim().toUpperCase(),
    amount: String(amount),
  });
  if (asOf) live.set("as_of", asOf);
  if (excludeTicketId) live.set("exclude_ticket_id", excludeTicketId);
  const query = useDebounced(live.toString(), 400);
  const settled = new URLSearchParams(query);
  const settledAmount = Number(settled.get("amount"));
  const valid =
    IATA.test(settled.get("origin") ?? "") &&
    IATA.test(settled.get("destination") ?? "") &&
    Number.isFinite(settledAmount) &&
    settledAmount > 0;
  return useQuery({
    queryKey: ["fare-check", query],
    queryFn: () => api<FareCheck>(`/fares/check?${query}`),
    enabled: valid,
    staleTime: 60_000,
    retry: false,
  });
}
