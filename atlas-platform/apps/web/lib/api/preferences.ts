import { atlasFetch, atlasMutation, type AtlasSession } from "../atlas-api";
import {
  type AtlasPreferences,
  makePreferencesSavePayload,
  normalizePreferences
} from "../../features/preferences/preferences.schema";

export type PreferencesEnvelope = {
  preferences: AtlasPreferences;
  persisted: boolean;
  source: "database" | "local" | "default";
  updatedAt?: string;
  selectedCompanyId?: number | null;
  fiscalYear?: number;
};

export type SavePreferencesResult = PreferencesEnvelope & {
  idempotencyKey: string;
};

export async function getPreferences(session: AtlasSession, fiscalYear: number): Promise<PreferencesEnvelope> {
  const response = await atlasFetch<Partial<PreferencesEnvelope>>(
    `/preferences?fiscalYear=${encodeURIComponent(String(fiscalYear))}`,
    session.token,
    session.sessionId
  );
  return {
    preferences: normalizePreferences(response.preferences),
    persisted: Boolean(response.persisted),
    source: response.source || "default",
    updatedAt: response.updatedAt,
    selectedCompanyId: response.selectedCompanyId ?? null,
    fiscalYear: response.fiscalYear || fiscalYear
  };
}

export async function savePreferences(
  session: AtlasSession,
  fiscalYear: number,
  preferences: AtlasPreferences,
  idempotencyKey: string,
  selectedCompanyId?: number | null
): Promise<SavePreferencesResult> {
  const body = {
    fiscalYear,
    selectedCompanyId: selectedCompanyId ?? null,
    ...makePreferencesSavePayload(preferences)
  };
  const response = await atlasMutation<Partial<SavePreferencesResult>>(
    "/preferences",
    session.token,
    session.sessionId,
    "PUT",
    { ...body, idempotencyKey }
  );
  return {
    preferences: normalizePreferences(response.preferences || preferences),
    persisted: Boolean(response.persisted ?? true),
    source: response.source || "database",
    updatedAt: response.updatedAt,
    selectedCompanyId: response.selectedCompanyId ?? selectedCompanyId ?? null,
    fiscalYear: response.fiscalYear || fiscalYear,
    idempotencyKey: response.idempotencyKey || idempotencyKey
  };
}
