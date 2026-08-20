# Phase 6 — API Design

## Conventions

The canonical base is `/v1`; JSON uses snake_case, dates ISO-8601, UUID strings, and decimal values serialized without binary floating-point assumptions. Mutations return `201` on creation and should return `ETag: "<version>"`. Concurrency requires `If-Match`; target applies it to every aggregate update. Errors use RFC 7807 fields `type`, `title`, `status`, `code`, `detail`, `correlation_id`, and optional field `errors`. Existing handlers return this shape for domain/integrity errors, while FastAPI validation and `HTTPException` still use a different shape.

## Actual endpoint catalog and target contract

“Audit” lists the event required by target design; current generic SQLAlchemy audit captures row metadata only.

| Method / route | Purpose; permission | Validation and response | Audit event |
|---|---|---|---|
| GET `/` and `/app` | Web shell; public | Static `index.html`; target security headers/CSP | none |
| GET `/health` | Liveness; public | `{status,version,port}`; no dependency probe | none |
| GET `/ready` | DB readiness; orchestrator | Executes Company count; 200/503 | readiness failure only |
| POST `/v1/auth/login` | Authenticate; public | `LoginRequest(username 1..100,password 1..200)` → access token/expiry; generic 401 | `auth.login.succeeded/failed` |
| GET `/v1/auth/me` | Current principal; authenticated | `{id,username,roles}` | none |
| GET `/v1/dashboard` | KPIs; authenticated | Counts employees, open tickets, loans/outstanding; target tenant scope | `dashboard.viewed` optional |
| GET `/v1/companies` | List companies; authenticated | Ordered list `{id,code,name,currency,active}`; target scoped pagination | none |
| POST `/v1/companies` | Create company; admin | Code regex `[A-Za-z0-9_-]+`, name 2..200, ISO currency length 3 → 201 | `company.created` |
| GET `/v1/employees` | Search employees; authenticated | `search`, limit 1..500 default 100, offset ≥0 → active rows | none |
| POST `/v1/employees` | Register; admin/hr | `EmployeeCreate`: code, name, company UUID, join date, dept/branch ≤100, valid email; company must exist → 201 | `employee.created` |
| POST `/v1/employees/import` | Preview/commit XLSX; admin/hr | Multipart XLSX, `dry_run`; ≤10,000 data rows, required code/name/company/join; target MIME/ZIP-bomb/formula controls | `employee.import.previewed/committed` |
| GET `/v1/employees/export.xlsx` | Export employees; authenticated | XLSX attachment; target scoped, async for large set | `employee.exported` |
| GET `/v1/opening-balances` | List annual balances; authenticated | Current unpaged list ordered year descending | none |
| POST `/v1/opening-balances` | Establish balance; admin/hr/finance | Employee UUID, year 2000..2200, days 0..60, non-negative amounts → 201; target employee existence/policy | `opening_balance.created` |
| POST `/v1/entitlements/preview` | Side-effect-free calculation; admin/hr/manager/finance | Scenario plus dates/amounts, or working-days override 0..360 → `{current_days,remaining_days,payable}` | `entitlement.previewed` optional |
| GET `/v1/tickets` | List tickets; authenticated | Current unpaged global list with computed excess/format | none |
| POST `/v1/tickets` | Create draft; admin/hr/manager | Employee UUID, date, 3-char route, non-negative amounts, different route → 201 | `ticket.created` |
| PATCH `/v1/tickets/{ticket_id}/status` | Transition workflow; admin/hr/manager/finance | Required integer `If-Match`; status in fixed enum and transition map; 404/409/422 → `{id,status,version}` | `ticket.submitted/approved/rejected/paid` |
| POST `/v1/loans/preview` | Calculate EMI; admin/hr/manager/finance | Principal >0, rate 0..100, installments 1..600 → monthly installment | none |
| GET `/v1/loans` | List loans; authenticated | Current unpaged global list, newest first | none |
| POST `/v1/loans` | Create recovery loan; admin/hr/finance | Preview terms + employee UUID, optional source ticket string, first due date → 201; target validates references/excess uniqueness | `loan.created` |
| GET `/v1/loans/{loan_id}/schedule` | Generate amortization; authenticated | Existing loan → installment array; 404 | `loan.schedule.viewed` optional |
| POST `/v1/loans/{loan_id}/payments` | Post recovery; admin/finance | Amount >0 and ≤ outstanding, date/reference ≤100 → 201; target `If-Match` + idempotency key | `loan.payment.posted`, `loan.settled` |
| PUT `/v1/preferences` | Upsert preference; admin/hr | Scope enum, scope ID ≤100, key 1..200, JSON value, lock flag; target `If-Match`, schema and lock enforcement | `preference.created/changed/locked` |
| GET `/v1/preferences/effective` | Resolve cascade; authenticated | Optional company/branch/department; user scope from JWT → merged JSON | none |
| POST `/v1/attachments` | Upload evidence; admin/hr/manager/finance | Query entity type/id + multipart file; 1..configured 25 MiB; SHA-256; pending scan → 201 | `attachment.uploaded` |
| GET `/v1/reports/excess.pdf` | Excess report; admin/hr/finance/auditor | PDF of tickets with excess >0; target filters/company/date and async generation | `report.exported` |

### Enterprise endpoints added in the current source

| Method / route | Purpose; permission | Validation and response | Audit event |
|---|---|---|---|
| POST `/v1/auth/refresh` | Rotate refresh token; token holder | Opaque token 40..200; detects consumed-family reuse; returns replacement pair | `auth.token.rotated/reuse` |
| POST `/v1/auth/logout` | Revoke refresh member; possession-based | Token digest lookup; always 204 | `auth.logout` |
| POST `/v1/auth/change-password` | Change own password; authenticated | Current password, new ≥12, last five hashes rejected; revokes refresh rows | `auth.password.changed` |
| POST `/v1/users` | Create user; SYSTEM_ADMIN | Username/password/display name, enterprise role enum, optional employee link →201 | `user.created` |
| GET `/v1/lookups/{type}` | List six reference types; authenticated | Active/non-deleted rows | none |
| POST `/v1/lookups/{type}` | Create reference; admin/hr | code 1..30, name 1..200, active →201 | `lookup.created` |
| PUT `/v1/lookups/{type}/{id}` | Replace reference; admin/hr | Required If-Match; matching type/non-deleted | `lookup.updated` |
| DELETE `/v1/lookups/{type}/{id}` | Soft delete; admin/hr | Required If-Match →204 | `lookup.deleted` |
| GET `/v1/employees/{id}` | Employee detail; authenticated/self-scoped | UUID; employee users only self | none |
| PUT `/v1/employees/{id}` | Replace profile; admin/hr | EmployeeUpdate + If-Match | `employee.updated` |
| DELETE `/v1/employees/{id}` | Soft delete/deactivate; admin/hr | If-Match →204 | `employee.deleted` |
| PUT `/v1/opening-balances/{id}` | Replace values; admin/hr/finance | BalanceUpdate + If-Match | `opening_balance.updated` |
| DELETE `/v1/opening-balances/{id}` | Soft delete; admin/hr/finance | If-Match →204 | `opening_balance.deleted` |
| GET `/v1/entitlement-rates` | List effective rates; authenticated | Current unpaged global list | none |
| POST `/v1/entitlement-rates` | Create effective rate; admin/hr/finance | scope global/pay_group/employee; valid date range; non-negative values | `entitlement_rate.created` |
| DELETE `/v1/tickets/{id}` | Delete draft; admin/hr/manager | Draft only + If-Match →204 | `ticket.deleted` |
| POST `/v1/loans/{id}/defer` | Defer active loan; admin/finance | Future date + If-Match | `loan.deferred` |
| POST `/v1/loans/{id}/restructure` | Replace remaining terms; admin/finance | Rate/term/due date + If-Match; not settled | `loan.restructured` |
| POST `/v1/loans/bulk-settle` | Atomic exact settlements; admin/finance | 1..500 unique loan IDs; each amount equals outstanding | `loan.bulk_settled` |
| GET `/v1/ess/dashboard` | Employee request KPIs; authenticated | Employee users self; privileged gets null summary | none |
| GET `/v1/ess/requests` | List ESS requests; authenticated/self-scoped | Current unpaged list | none |
| POST `/v1/ess/requests` | Submit request; authenticated/self-scoped | employee, type, date, different 3-char route, notes | `ess_request.created` |
| PATCH `/v1/ess/requests/{id}/status` | Decide ESS status; admin/hr/manager | If-Match; submitted→approved/rejected→paid path | `ess_request.status_changed` |
| GET `/v1/reports/data/{name}` | Six summary metrics; admin/hr/finance/auditor | Allowlisted report name → value/time | `report.viewed` |

## DTO schemas

```yaml
TicketResponse:
  required: [id, employee_id, travel_date, origin_code, destination_code,
             ticket_cost, entitlement, company_paid, excess_amount, status, version]
  properties:
    id: {type: string, format: uuid}
    employee_id: {type: string, format: uuid}
    travel_date: {type: string, format: date}
    origin_code: {type: string, pattern: '^[A-Z]{3}$'}
    destination_code: {type: string, pattern: '^[A-Z]{3}$'}
    ticket_cost: {type: string, pattern: '^\d+(\.\d{1,4})?$'}
    entitlement: {type: string}
    company_paid: {type: string}
    excess_amount: {type: string, readOnly: true}
    status: {enum: [draft, submitted, approved, rejected, paid]}
    version: {type: integer, minimum: 1}
Problem:
  required: [type, title, status, code, detail, correlation_id]
```

Other request DTOs are exactly the Pydantic models in `api/main.py:74-177`: `LoginRequest`, `CompanyCreate`, `EmployeeCreate`, `BalanceCreate`, `EntitlementRequest`, `LoanPreviewRequest`, `TicketCreate`, `StatusChange`, `LoanCreate`, `PaymentCreate`, and `PreferenceUpsert`. Target response DTOs must replace untyped dictionaries and be emitted into OpenAPI.

## Error contract

| Status | Code examples | Meaning |
|---:|---|---|
| 400 | `malformed_request` | Invalid syntax/content type. |
| 401 | `invalid_token` | Missing/invalid/expired credentials; include `WWW-Authenticate`. |
| 403 | `forbidden`, `scope_denied` | Authenticated but not permitted. |
| 404 | `ticket_not_found`, `loan_not_found` | Scoped resource does not exist; do not leak cross-tenant existence. |
| 409 | `stale_version`, `duplicate`, `idempotency_conflict` | Concurrency/uniqueness conflict. |
| 413 | `attachment_too_large` | Body exceeds limit. |
| 415 | `unsupported_media_type` | Invalid upload type. |
| 422 | `invalid_transition`, `invalid_route`, field errors | Semantically invalid command. |
| 429 | `rate_limited` | Retry after advertised delay. |
| 503 | `dependency_unavailable` | Retriable DB/queue/integration outage. |

## Missing target operations

Still add entitlement allocation/close; ticket detail, multi-step approval decisions/reversal; attachment authorized download/delete/scanner verdict; loan resume/payment reversal; payroll export/acknowledge/reconcile; preference list/delete/rule validation; rate update/delete; report-job status/download; audit query. All list operations require cursor pagination, filters, stable sort and company/tenant scoping.

## Current vs target gaps

Current OpenAPI lacks explicit response models and common problem responses. Employee identities are self-scoped for several resources, but company/tenant scope is absent for privileged roles and several global endpoints. List pagination is inconsistent, payment/preference/bulk-settlement concurrency is incomplete, and audit event semantics are not exposed. The target remains backward-compatible through `/v1` while tightening authorization and errors.
