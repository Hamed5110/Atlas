# Phase 5 — Security Architecture

## Security model

Authenticate centrally through OIDC/MFA where available. For local fallback, store bcrypt/Argon2id hashes, enforce breached-password screening and history, and rate-limit login by account and source. Issue 10–15 minute access tokens with `iss`, `aud`, `sub`, `iat`, `nbf`, `exp`, `jti`, company scope and authorization version. Store opaque rotating refresh tokens as hashes in `RefreshSessions`; reuse revokes the token family. Logout/revocation is checked through Redis plus durable session state.

RBAC permissions replace route-local role lists: `employee.read/write/import`, `entitlement.calculate/allocate`, `ticket.submit/approve/pay`, `loan.read/write/pay/defer`, `preference.admin`, `report.financial`, `audit.read`. ABAC adds company/branch/department scope and ownership. SQL Server row-level security uses `SESSION_CONTEXT('company_id')` as defense in depth; the application still filters every query. A connection checkout clears and sets context to prevent pool leakage.

## OWASP Top 10 mapping

| Risk | Required controls |
|---|---|
| A01 Broken access control | Deny-by-default permissions, record/tenant scope, SoD, parent authorization for attachments, negative tests. |
| A02 Cryptographic failures | TLS 1.2+, HSTS, vault-managed keys, encrypted DB/backups/storage, no secrets in logs/source. |
| A03 Injection | Pydantic validation, SQLAlchemy bound parameters, no dynamic SQL, formula-injection neutralization in XLSX exports. |
| A04 Insecure design | Threat modeling, state-machine invariants, idempotency, approval separation, transaction limits. |
| A05 Misconfiguration | Production docs disabled, strict CORS/CSP, trusted hosts/proxies, non-root/read-only containers, secure defaults. |
| A06 Vulnerable components | Locked dependencies, SBOM, SCA, signed images, patch SLA. |
| A07 Auth failures | MFA/SSO, lockout/backoff, generic errors, token rotation/revocation, password history. |
| A08 Integrity failures | Signed builds, Alembic provenance, outbox/inbox, malware scanning, content hashes. |
| A09 Logging failures | Append-only security audit, SIEM alerts, correlation, redaction and monitored clock sync. |
| A10 SSRF | No user-controlled outbound URL; allowlist integration hosts and block metadata/private ranges in future connectors. |

## STRIDE threat model

| Threat | Asset/flow | Severity | Mitigation |
|---|---|---:|---|
| Spoofing | Login/JWT | Critical | OIDC/MFA, strong validation including audience/jti, lockout, refresh rotation. |
| Spoofing | Payroll callback | Critical | mTLS, signed payload, timestamp/nonce and idempotent inbox. |
| Tampering | Ticket/loan mutation | Critical | Version compare, DB checks, transaction, audit before/after, SoD. |
| Tampering | Attachment | High | Canonical storage key, malware scan, immutable hash, fail-closed download. |
| Repudiation | Approval/payment | High | Actor, permission, reason, correlation, IP and immutable audit. |
| Information disclosure | Cross-company list/report | Critical | tenant-scoped query + RLS + authorization tests. |
| Information disclosure | Logs/audit/export | High | field classification, redaction, export watermark/expiry and access audit. |
| Denial of service | Login/import/report/upload | High | rate/body/row limits, async jobs, queue quotas, timeouts. |
| Elevation of privilege | JSON roles in JWT | Critical | server-side role source/version, short TTL, admin approval and revocation. |
| Elevation of privilege | Preference scope | High | validate scope ownership; locked/security settings cannot be overridden. |

## Account and password controls

Local password minimum 14 characters, maximum 128, breached list, no arbitrary composition rule, history 12, one-day minimum age for history bypass prevention, reset token single-use/15 minutes. After 5 failures, exponential delay and 15-minute lock; alert on spraying. Successful login resets counters and records device/risk metadata. Bootstrap credentials are disabled after first administrative setup and startup fails in production with known defaults.

## API/browser/desktop controls

Nginx supplies HSTS, CSP (`default-src 'self'; object-src 'none'; frame-ancestors 'none'`), Referrer-Policy and Permissions-Policy. FastAPI validates TrustedHost and proxy chain. The browser keeps access token in memory; secure HttpOnly SameSite refresh cookie is preferred to Web Storage. Desktop stores refresh material in OS credential storage. CSRF tokens protect cookie-authenticated mutations. Every download uses server-side authorization and `Content-Disposition: attachment`.

## Secrets and cryptography

Use Azure Key Vault/HashiCorp Vault or platform secrets via workload identity; rotate signing, DB and integration credentials with overlap. Separate migration and runtime DB identities. HS256 secrets require ≥256 random bits; target asymmetric RS256/EdDSA with key ID and JWKS. Never expose `.env`, stack traces, database URLs or hash values to clients.

## Secure audit logging

Record auth outcome, authorization denial, role/password/session change, import, approval, payment, preference lock and report/export. Include UTC time, actor, effective tenant, action, entity, result, reason code and correlation; tokenize sensitive values. Audit readers are separate from writers. Alert on repeated login failure, cross-tenant denials, admin grants, audit failures and unusual exports.

## Current vs target gaps

Current `security.py` now requires jti/token type and `api/main.py` implements hashed rotating refresh tokens with family-reuse revocation, logout, five-attempt lockout, password history/change and employee self-scope. Remaining gaps are no audience/nbf or access-token session revocation check, no source/account rate limiter, and no company/branch tenant scope for privileged roles. Dashboard, company, lookup, rates, reports and employee export remain global. Attachment upload accepts arbitrary entity type/id and there is no download/scanner callback. `config.py` contains known development defaults, and `app.js` stores bearer tokens in `sessionStorage`. These are verified current-state risks, not target capabilities.
