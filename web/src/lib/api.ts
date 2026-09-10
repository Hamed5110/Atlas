import { useAuth } from "./auth";
import type { Session } from "./types";

const API_ROOT = "/v1";

export class ApiError extends Error {
  status: number;
  code: string;
  detail: string;
  correlationId?: string;

  constructor(status: number, code: string, detail: string, correlationId?: string) {
    super(detail || code);
    this.status = status;
    this.code = code;
    this.detail = detail;
    this.correlationId = correlationId;
  }
}

async function parseError(resp: Response): Promise<ApiError> {
  let code = `http_${resp.status}`;
  let detail = resp.statusText || "Request failed";
  let correlationId: string | undefined;
  try {
    const body = await resp.json();
    code = body.code || body.error || code;
    detail = body.detail || body.message || detail;
    correlationId = body.correlation_id;
  } catch {
    /* non-JSON error body */
  }
  return new ApiError(resp.status, code, detail, correlationId);
}

async function refreshTokens(): Promise<Session | null> {
  const { session, setSession, clear } = useAuth.getState();
  if (!session?.refresh_token) return null;
  try {
    const resp = await fetch(`${API_ROOT}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: session.refresh_token }),
    });
    if (!resp.ok) {
      clear();
      return null;
    }
    const next = (await resp.json()) as Session;
    setSession(next);
    return next;
  } catch {
    clear();
    return null;
  }
}

let refreshing: Promise<Session | null> | null = null;

async function ensureRefresh(): Promise<Session | null> {
  refreshing ??= refreshTokens().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

export interface ApiOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  raw?: boolean;
}

export async function api<T = unknown>(path: string, options: ApiOptions = {}): Promise<T> {
  const doFetch = async (token: string | undefined) => {
    const headers: Record<string, string> = { ...(options.headers ?? {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    let body: BodyInit | undefined;
    if (options.body instanceof FormData) {
      body = options.body;
    } else if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.body);
    }
    return fetch(`${API_ROOT}${path}`, {
      method: options.method ?? "GET",
      headers,
      body,
    });
  };

  const { session } = useAuth.getState();
  let resp = await doFetch(session?.access_token);
  if (resp.status === 401 && session?.refresh_token) {
    const next = await ensureRefresh();
    if (next) resp = await doFetch(next.access_token);
  }
  if (!resp.ok) throw await parseError(resp);
  if (options.raw) return resp as unknown as T;
  if (resp.status === 204) return undefined as T;
  return (await resp.json()) as T;
}

export async function download(path: string, fallbackName: string): Promise<void> {
  const { session } = useAuth.getState();
  const resp = await fetch(`${API_ROOT}${path}`, {
    headers: session ? { Authorization: `Bearer ${session.access_token}` } : {},
  });
  if (!resp.ok) throw await parseError(resp);
  const blob = await resp.blob();
  const disposition = resp.headers.get("Content-Disposition") ?? "";
  const match = /filename="?([^";]+)"?/.exec(disposition);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = match?.[1] ?? fallbackName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export async function login(username: string, password: string): Promise<Session> {
  const resp = await fetch(`${API_ROOT}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!resp.ok) throw await parseError(resp);
  return (await resp.json()) as Session;
}
