# AI Verification Review — Security

This is a source-based threat review, not a penetration test. No secret values were read or printed.

## Findings

### SEC-01 — Employee self-scope exists, but company tenant isolation does not (Critical)

`scoped_employee_id()` (`api/main.py:481-498`) restricts linked non-privileged users on employees, balances, tickets, loans and ESS. Privileged roles still have global access, and dashboard, companies, lookups, entitlement rates, reports and employee export are not company-scoped. JWT claims contain no company/organization scope (`security.py:67-79`).

**Fix:** add tenant/organization claims resolved server-side, scope every query, enforce owner/approval relationships, and add SQL RLS defense in depth with cross-tenant negative tests.

### SEC-02 — Attachment authorization and malware enforcement are absent (Critical)

Upload accepts arbitrary `entity_type` and UUID without parent existence/access checks (`api/main.py:847-875`). Bytes are persisted before the DB transaction commits (863-877), and `scan_status` remains `pending`; there is no scanner callback or authorized download.

**Fix:** allowlist parent types, authorize parent, quarantine outside serving path, scan before promotion, clean orphan files on rollback, and expose only an authorized clean-only stream.

### SEC-03 — Lockout exists but lacks distributed rate limiting and atomic counters (High)

Login tracks failures and locks for 30 minutes after five attempts (`api/main.py:517-545`); refresh rotation/reuse, logout and password-change revocation are implemented at lines 570-659. There is still no source/IP rate limit, atomic failed-attempt update, MFA, or access-token revocation/authorization-version check. Role removal remains effective only after access expiry.

**Fix:** OIDC/MFA preferred; otherwise implement account/source throttling, lockout, refresh families, jti/session store, authorization version and security-event audit.

### SEC-04 — JWT validation remains incomplete for enterprise use (High)

Tokens now include and require jti/token type (`security.py:67-80,96-104`) and validate issuer/expiry. No audience, nbf or key identifier exists; decode does not explicitly reject a non-`access` token type value, and HS256 shares signing and verification secret.

**Fix:** validate audience/type/nbf/jti; adopt short-lived asymmetric tokens with key rotation or strong managed HS256 only in a single trust boundary.

### SEC-05 — Known bootstrap defaults can reach production (High)

`config.py:21,27-28` defines a known JWT secret and admin password; `api/main.py:227-239` creates the user whenever absent. Pydantic length validation does not reject these values in production.

**Fix:** fail startup in production for known/default secrets, require ≥256-bit generated signing material, and replace bootstrap with one-time setup.

### SEC-06 — Bearer token is exposed to browser script (High)

`web_client/app.js:4-7,293-295` stores the access token in `sessionStorage`. Any same-origin XSS can extract it. Middleware sets nosniff/frame denial but no CSP/HSTS/referrer policy (`api/main.py:264-276`).

**Fix:** strict CSP and dependency hygiene; keep access token in memory and use Secure/HttpOnly/SameSite rotating refresh cookie with CSRF protection.

### SEC-07 — Preference scope and locks are not enforced (High)

Admin/HR can write arbitrary scope IDs and JSON (`api/main.py:794-817`); update ignores `is_locked` inheritance. Effective lookup accepts caller-supplied company/branch/department (`819-845`), enabling configuration disclosure/manipulation across organizations.

**Fix:** derive scopes from authorized identity/context, schema-validate keys/values and enforce locked ancestors transactionally.

### SEC-08 — Spreadsheet formula injection on export (Medium)

`documents.py:29-30` writes database strings directly into XLSX cells. A name/code beginning `=`, `+`, `-` or `@` can execute as a formula when opened.

**Fix:** prefix dangerous text with apostrophe or force string cell type; add tests for all formula prefixes.

### SEC-09 — Import/upload resource controls are partial (Medium)

Employee import reads the full upload before row validation (`api/main.py:483-484`); ZIP expansion and file byte limits are not enforced. Attachment content type is trusted metadata and arbitrary bytes are written synchronously.

**Fix:** proxy and application byte limits, ZIP member/compression ratio limits, signature-based MIME detection, timeouts and asynchronous scan/parse.

### SEC-10 — Audit does not capture security intent (Medium)

`database.py` records generic row changes and now has IP/session/change fields, but login failures, authorization denials, complete before/after values and decision reasons are not explicit. Actor/session context is set during authentication (`api/main.py:453-464`) but only correlation/IP tokens are reset in middleware (`398-422`), risking context leakage.

**Fix:** request-scoped actor token with `finally` reset; explicit security/business events; append-only DB controls and SIEM alerts.

## Positive controls observed

Pydantic forbids unknown fields, SQLAlchemy uses bound expressions, bcrypt cost 12 and minimum length are enforced, refresh tokens are random and stored as SHA-256 digests with rotation/reuse handling, password history and lockout exist, CORS is explicit, correlation IDs are propagated, and containers run non-root/read-only. These controls do not offset the critical company-isolation and attachment gaps.
