"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, authedFetch } from "./api";
import type { Company } from "./types";

export interface CompanyBranding extends Company {
  has_logo?: boolean;
  logo_url?: string | null;
}

export function useCompanies() {
  return useQuery({
    queryKey: ["companies"],
    queryFn: () => api<CompanyBranding[]>("/companies"),
    staleTime: 60_000,
  });
}

export function useAuthedImage(url: string | null | undefined): string {
  const [objectUrl, setObjectUrl] = useState("");

  useEffect(() => {
    let cancelled = false;
    let created = "";
    setObjectUrl("");
    if (!url) return;
    authedFetch(url)
      .then((resp) => (resp.ok ? resp.blob() : null))
      .then((blob) => {
        if (blob && !cancelled) {
          created = URL.createObjectURL(blob);
          setObjectUrl(created);
        }
      })
      .catch(() => {
        /* ignore logo load failures */
      });
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [url]);

  return objectUrl;
}

export function usePrimaryCompany(): { company?: CompanyBranding; logo: string } {
  const companies = useCompanies();
  const company = (companies.data ?? []).find((c) => c.active) ?? (companies.data ?? [])[0];
  const logo = useAuthedImage(company?.has_logo ? company.logo_url : null);
  return { company, logo };
}
