/** App route helper — Next static export uses trailingSlash: true. */

export function appPath(path: string): string {
  const raw = (path || "/").trim();
  if (!raw || raw === "/") return "/";
  // Keep API / asset / file URLs untouched
  if (
    raw.startsWith("/v1/") ||
    raw.startsWith("/_next/") ||
    raw.startsWith("/assets/") ||
    raw.includes("?") ||
    raw.includes("#") ||
    /\.[a-z0-9]+$/i.test(raw.split("/").pop() || "")
  ) {
    return raw.startsWith("/") ? raw : `/${raw}`;
  }
  const withSlash = raw.startsWith("/") ? raw : `/${raw}`;
  return withSlash.endsWith("/") ? withSlash : `${withSlash}/`;
}

/** Normalize API-relative paths for /v1 fetch + download helpers. */
export function apiPath(path: string): string {
  let p = (path || "").trim();
  if (!p) return "/";
  // Absolute app URL mistakenly passed → strip origin
  if (/^https?:\/\//i.test(p)) {
    try {
      p = new URL(p).pathname + new URL(p).search;
    } catch {
      /* keep */
    }
  }
  if (p.startsWith("/v1/")) p = p.slice(3); // → /auth/...
  if (!p.startsWith("/")) p = `/${p}`;
  return p;
}
