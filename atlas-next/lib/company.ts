/** Canonical bootstrap company id (not business code — code is often "DEFAULT"). */
export const DEFAULT_COMPANY_ID = "0001";

export type CompanyLike = {
  id: string;
  code?: string;
  active?: boolean;
};

/**
 * Pick the company operators expect as "default":
 * active id 0001 → first active → "" (never an inactive fallback).
 */
export function pickPrimaryCompanyId(list: readonly CompanyLike[] | null | undefined): string {
  const rows = list ?? [];
  const active = rows.filter((c) => c.active !== false);
  const pool = active.length ? active : [];
  if (!pool.length) return "";
  return pool.find((c) => c.id === DEFAULT_COMPANY_ID)?.id ?? pool[0]?.id ?? "";
}

export function pickPrimaryCompany<T extends CompanyLike>(
  list: readonly T[] | null | undefined
): T | undefined {
  const id = pickPrimaryCompanyId(list);
  if (!id) return undefined;
  return (list ?? []).find((c) => c.id === id);
}
