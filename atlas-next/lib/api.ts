"use client";

import { useAuth } from "./auth";
import { apiPath } from "./paths";
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

export async function parseError(resp: Response): Promise<ApiError> {
  let code = `http_${resp.status}`;
  let detail = resp.statusText || "Request failed";
  let correlationId: string | undefined;
  try {
    const body = await resp.json();
    code = body.code || body.error || code;
    detail = formatErrorDetail(body.detail ?? body.message ?? detail);
    correlationId = body.correlation_id;
  } catch {
    /* non-JSON error body */
  }
  return new ApiError(resp.status, String(code), detail, correlationId);
}

function formatErrorDetail(value: unknown): string {
  if (value == null || value === "") return "Request failed";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object") {
          const msg = (item as { msg?: unknown; message?: unknown; detail?: unknown }).msg
            ?? (item as { message?: unknown }).message
            ?? (item as { detail?: unknown }).detail;
          const loc = (item as { loc?: unknown[] }).loc;
          const where = Array.isArray(loc) ? loc.filter((p) => p !== "body").join(".") : "";
          if (msg != null) return where ? `${where}: ${String(msg)}` : String(msg);
        }
        try {
          return JSON.stringify(item);
        } catch {
          return String(item);
        }
      })
      .filter(Boolean)
      .join("; ");
  }
  if (typeof value === "object") {
    const obj = value as { detail?: unknown; message?: unknown; msg?: unknown };
    if (obj.detail != null) return formatErrorDetail(obj.detail);
    if (obj.message != null) return String(obj.message);
    if (obj.msg != null) return String(obj.msg);
    try {
      return JSON.stringify(value);
    } catch {
      return "Request failed";
    }
  }
  return String(value);
}

/** Prefer ApiError.detail; never surface "[object Object]". */
export function errorMessage(err: unknown, fallback = "Unexpected error"): string {
  if (err instanceof ApiError) return err.detail || err.message || fallback;
  if (err instanceof Error) {
    const msg = err.message;
    return !msg || msg === "[object Object]" ? fallback : msg;
  }
  if (typeof err === "string") return err;
  return fallback;
}

async function refreshTokens(): Promise<Session | null> {
  const { session, setSession, clear } = useAuth.getState();
  if (!session?.refresh_token) return null;
  // Idle gate: do not silent-refresh after 20 min with no real user activity
  // (Skycloak/Auth0 pattern — background refresh must not defeat idle logout).
  const { allowTokenRefresh, clearSessionActivity } = await import("./session-idle");
  if (!allowTokenRefresh()) {
    clearSessionActivity();
    clear();
    return null;
  }
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
  /** Abort / fail the request after this many ms (browser fetch). */
  timeoutMs?: number;
}

export async function api<T = unknown>(path: string, options: ApiOptions = {}): Promise<T> {
  const normalized = apiPath(path);
  const doFetch = async (token: string | undefined) => {
    const headers: Record<string, string> = { ...(options.headers ?? {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    let body: BodyInit | undefined;
    if (options.body instanceof FormData) {
      body = options.body;
    } else if (typeof options.body === "string") {
      // Already serialized — never JSON.stringify again (double-encode → Pydantic 422).
      headers["Content-Type"] = headers["Content-Type"] ?? "application/json";
      body = options.body;
    } else if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.body);
    }
    const init: RequestInit = {
      method: options.method ?? "GET",
      headers,
      body,
    };
    if (options.timeoutMs && options.timeoutMs > 0) {
      init.signal = AbortSignal.timeout(options.timeoutMs);
    }
    return fetch(`${API_ROOT}${normalized}`, init);
  };

  const { session } = useAuth.getState();
  let resp: Response;
  try {
    resp = await doFetch(session?.access_token);
    if (resp.status === 401 && session?.refresh_token) {
      const next = await ensureRefresh();
      if (next) resp = await doFetch(next.access_token);
    }
  } catch (err) {
    if (err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw new ApiError(408, "timeout", "Request timed out — try a shorter question or check Ollama.");
    }
    throw err;
  }
  if (!resp.ok) throw await parseError(resp);
  if (options.raw) return resp as unknown as T;
  if (resp.status === 204) return undefined as T;
  return (await resp.json()) as T;
}

/** Authenticated fetch with the same 401 refresh path as `api()`. */
export async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  // Never attach Bearer tokens to absolute third-party URLs (open-redirect / SSRF footgun).
  if (/^https?:\/\//i.test(path)) {
    let absolute: URL;
    try {
      absolute = new URL(path);
    } catch {
      throw new ApiError(400, "bad_request", "Invalid absolute URL for authenticated fetch.");
    }
    const sameOrigin =
      typeof window !== "undefined" &&
      absolute.origin === window.location.origin;
    if (!sameOrigin) {
      throw new ApiError(
        400,
        "bad_request",
        "Authenticated fetch refuses cross-origin absolute URLs."
      );
    }
  }
  const url = path.startsWith("http") ? path : `${API_ROOT}${apiPath(path)}`;
  const doFetch = async (token: string | undefined) => {
    const headers = new Headers(init.headers);
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return fetch(url, {
      ...init,
      headers,
    });
  };

  const { session } = useAuth.getState();
  let resp = await doFetch(session?.access_token);
  if (resp.status === 401 && session?.refresh_token) {
    const next = await ensureRefresh();
    if (next) resp = await doFetch(next.access_token);
  }
  return resp;
}

async function saveDownloadResponse(resp: Response, fallbackName: string): Promise<void> {
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

export async function download(path: string, fallbackName: string): Promise<void> {
  const resp = await authedFetch(apiPath(path));
  if (!resp.ok) throw await parseError(resp);
  await saveDownloadResponse(resp, fallbackName);
}

/** Authenticated POST that saves the response body as a file (PDF/XLSX). */
export async function downloadPost(
  path: string,
  body: unknown,
  fallbackName: string
): Promise<void> {
  const resp = await authedFetch(apiPath(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw await parseError(resp);
  await saveDownloadResponse(resp, fallbackName);
}

/** Authenticated GET that returns the response body (e.g. merged allocation PDF) as a Blob. */
export async function getBlob(path: string): Promise<Blob> {
  const resp = await authedFetch(apiPath(path));
  if (!resp.ok) throw await parseError(resp);
  const blob = await resp.blob();
  const headerType = (resp.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
  const pathLower = apiPath(path).toLowerCase();
  const type =
    headerType && headerType !== "application/octet-stream"
      ? headerType
      : pathLower.endsWith(".pdf")
        ? "application/pdf"
        : headerType || blob.type || "application/octet-stream";
  return type && type !== blob.type ? new Blob([blob], { type }) : blob;
}

export async function postBlob(path: string, body: unknown): Promise<Blob> {
  const resp = await authedFetch(apiPath(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw await parseError(resp);
  return resp.blob();
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
