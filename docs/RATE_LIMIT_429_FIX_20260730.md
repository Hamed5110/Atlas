# 2026-07-30 Rate Limit 429 Fix Record

## Problem

Install/test machines were repeatedly hitting:

`Too many requests in a short time. Please wait one minute, then use Refresh. Admin can increase API_RATE_LIMIT_MAX if needed. (HTTP 429 Too Many Requests)`

The failure was caused by local admin workflows producing short request bursts while the general API limiter counted every API request, including authentication traffic already protected by the auth limiter.

## Fix

- Raised the safe default API limit from a low burst ceiling to `5000` requests per window.
- Added a separate local-network limit, `API_RATE_LIMIT_LOCAL_MAX`, defaulting to `30000`.
- Excluded `/api/auth/*` from the general API limiter so login requests are not double-counted.
- Kept a separate auth limiter with a safe local-network floor.
- Added structured `429` JSON responses with stable error codes and `Retry-After` headers.
- Debounced frontend preferences telemetry so visual preference changes do not create unnecessary backend request bursts.
- Updated frontend API error formatting to surface useful retry guidance from `Retry-After`.
- Split read-only support APIs into a dedicated limiter:
  - `/api/health`
  - `/api/diagnostics/*`
- Added lightweight response headers for API troubleshooting:
  - `X-Atlas-Local-Network`
  - `X-Atlas-Support-Api`

## Environment knobs

```env
API_RATE_LIMIT_MAX=5000
API_RATE_LIMIT_LOCAL_MAX=30000
AUTH_RATE_LIMIT_MAX=100
SUPPORT_RATE_LIMIT_MAX=2000
SUPPORT_RATE_LIMIT_LOCAL_MAX=60000
```

## Verification

- `npm run check`
- `npm run test:company-admin`
- `npm --prefix C:\Airfare_Allowance\atlas-hcm-next test`
- `npm --prefix C:\Airfare_Allowance\atlas-hcm-next run build`
- `npm run test:full`
- Authenticated local API sweep:
  - 29/29 checked GET/support API paths returned `200`.
  - `/api/health` and `/api/diagnostics/*` returned `RateLimit-Limit: 60000`.
  - dashboard APIs returned `RateLimit-Limit: 30000`.
  - auth session API returned `RateLimit-Limit: 500`.

Latest full-system report:

- `C:\Airfare_Allowance\test-reports\atlas-full-system-test-20260730132109.md`
- `C:\Airfare_Allowance\test-reports\atlas-full-system-test-20260730132109.json`

## Live deployment note

On 2026-07-30, `http://127.0.0.1:3355/api/health` showed the fixed support limiter headers from the current repo process, while `http://192.168.15.10:3355/api/health` still showed `RateLimit-Limit: 5000` and did not return the new diagnostic headers. That means the LAN target was still running an older installed/deployed copy and must be updated/restarted with a build that includes this fix.

## Research notes

The fix follows current Express and public API rate-limit patterns:

- use clear `429` responses;
- include `Retry-After`;
- separate sensitive auth throttles from general API throttles;
- avoid counting redundant successful local/admin workflow traffic as abuse.
