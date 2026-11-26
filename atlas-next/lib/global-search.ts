"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useDebounced } from "@/lib/use-debounced";

export interface SearchEmployee {
  id: string;
  code: string;
  name: string;
  department: string;
  designation: string;
  active: boolean;
}

export interface SearchTicket {
  id: string;
  code: string;
  employee_code: string;
  employee_name: string;
  route: string;
  travel_date: string;
  status: string;
  cost: string;
}

export interface SearchLoan {
  id: string;
  code: string;
  employee_code: string;
  employee_name: string;
  outstanding: string;
  status: string;
}

export interface SearchEss {
  id: string;
  employee_code: string;
  employee_name: string;
  request_type: string;
  travel_date: string;
  status: string;
}

export interface GlobalSearchResult {
  query: string;
  employees?: SearchEmployee[];
  tickets?: SearchTicket[];
  loans?: SearchLoan[];
  ess?: SearchEss[];
}

export const MIN_SEARCH = 2;

export function useGlobalSearch(query: string, enabled: boolean) {
  const term = useDebounced(query.trim(), 250);
  return useQuery({
    queryKey: ["global-search", term],
    queryFn: () => api<GlobalSearchResult>(`/search?q=${encodeURIComponent(term)}`),
    enabled: enabled && term.length >= MIN_SEARCH,
    staleTime: 30_000,
    placeholderData: (previous) => previous,
    retry: false,
  });
}
