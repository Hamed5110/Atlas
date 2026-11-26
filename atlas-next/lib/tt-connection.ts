/** Client guards for Time Tracking biometric connection (company + SQL fields). */

export type ConnectionDraft = {
  host: string;
  database_name: string;
  username: string;
  password: string;
  table_name?: string;
};

/** Accept 4-digit company ids (e.g. 0001) or legacy UUID strings. */
const COMPANY_ID_RE =
  /^(?:\d{4}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export function isCompanyId(value: string | null | undefined): boolean {
  return !!value && COMPANY_ID_RE.test(value.trim());
}

/** Returns a user-facing error, or null when the draft is ready to Test/Save. */
export function connectionDraftError(
  companyId: string | null | undefined,
  draft: ConnectionDraft,
  opts?: { configured?: boolean; requirePassword?: boolean }
): string | null {
  if (!isCompanyId(companyId)) {
    return "Select an active company before saving the biometric connection.";
  }
  if (!draft.host?.trim()) return "Host / SQL Server IP is required.";
  if (!draft.database_name?.trim()) {
    return "Database name is required (e.g. etrimetracklite1 — not the punch table).";
  }
  if (!draft.username?.trim()) return "SQL username is required.";
  const pwd = draft.password ?? "";
  const hasRealPassword = pwd.length > 0 && pwd !== "********";
  const requirePassword = opts?.requirePassword ?? !opts?.configured;
  if (requirePassword && !hasRealPassword && !opts?.configured) {
    return "Password is required for a new biometric connection.";
  }
  return null;
}

export function connectionSaveBody(
  companyId: string,
  draft: ConnectionDraft & {
    port: number;
    lookback_hours: number;
    is_active: boolean;
  }
) {
  const password = draft.password === "********" ? "" : draft.password;
  return {
    company_id: companyId,
    host: draft.host.trim(),
    port: draft.port || 1433,
    database_name: draft.database_name.trim(),
    username: draft.username.trim(),
    password,
    table_name: (draft.table_name || "esslpunchlog").trim() || "esslpunchlog",
    trust_server_certificate: true,
    is_active: draft.is_active,
    lookback_hours: draft.lookback_hours || 48,
  };
}
