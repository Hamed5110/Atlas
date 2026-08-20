# Phase 1 — Business Analysis

## Scope and actors

The module manages employee airfare eligibility, opening balances, ticket requests, excess recovery loans, preferences, attachments, and reports. Current actors are `admin`, `hr`, `manager`, `finance`, and `auditor` (roles embedded in JWTs by `api/main.py`). Target actors add Employee/ESS, Payroll Integration, Compliance Officer, and Service Operator.

## Functional requirement specification

| ID | Requirement | Acceptance rule |
|---|---|---|
| FR-01 | Maintain companies and employees | Employee code is unique per active company; company, join date and eligibility attributes are validated. |
| FR-02 | Import/export employees | XLSX preview is mandatory; commit is all-or-nothing; rejected rows retain row number and reason. |
| FR-03 | Establish annual opening balance | One active balance per employee/year; days 0–60 and non-negative monetary limits. |
| FR-04 | Calculate entitlement | Deterministic 30/360 accrual, 2.5 days/30 days, 60-day cap, commercial half-up money rounding. |
| FR-05 | Process ticket request | Draft → Submitted → Approved/Rejected; Rejected → Draft; Approved → Paid. Every transition records actor, timestamp, reason and version. |
| FR-06 | Enforce approval chain | Target: employee/HR submits, line manager approves business eligibility, finance approves value/payment, with delegation and segregation of duties. |
| FR-07 | Calculate excess | `max(CompanyPaid - Entitlement, 0)`; approved excess creates or links a recoverable loan exactly once. |
| FR-08 | Manage loans | Reducing-balance EMI, schedule, deferment, payroll deductions, ad-hoc payments and settlement. |
| FR-09 | Manage preferences | Resolve default → company → branch → department → user; objects merge, arrays/scalars replace, null inherits; locked values cannot be overridden. |
| FR-10 | Manage evidence | Content-address files, verify size/type, malware scan before download or approval, and authorize against the parent record. |
| FR-11 | Report and reconcile | Employee entitlement, ticket liability, excess recovery, loan aging, payroll reconciliation, audit and exception reports. |
| FR-12 | Audit | Every state or financial mutation records before/after, actor, correlation ID, source IP and reason; audit is append-only. |

## Approval and financial controls

Target policy is configurable by company, amount, route and employee grade. A submitter cannot approve the same request; finance cannot mark paid without manager approval; paid tickets are immutable except controlled reversal. Payment and payroll exports use idempotency keys and control totals (count, principal, recovered, rejected). Four-eyes approval is mandatory for policy overrides and write-offs. Period close prevents back-dated posting without controller override.

Payroll touchpoints are: export due deductions by payroll period; receive accepted/rejected acknowledgements; post deduction through `POST /v1/loans/{loan_id}/payments`; reconcile source reference; suspend during approved deferment; emit settlement. HRIS supplies employee status, company, branch, department, manager, grade, join/termination date. Current code exposes only payment posting and has no adapter, period, idempotency key, or reconciliation entity.

## Non-functional requirements

- Availability: 99.9% monthly API target; `/health` liveness and `/ready` dependency readiness.
- Performance: p95 reads <300 ms, writes <600 ms at 100 concurrent users; report requests >2 s execute asynchronously.
- Scale: 100 companies, 250,000 employees, 5 million tickets/payments, 10-year online audit.
- Recovery: RPO ≤15 minutes, RTO ≤4 hours; quarterly restore and annual regional failover exercise.
- Security: TLS 1.2+, OWASP ASVS Level 2, least privilege, MFA/SSO target, 15-minute access token, rotating refresh token.
- Consistency: financial writes serializable or lock-protected where needed; all money `decimal(19,4)` persisted and currency-boundary rounding explicit.
- Accessibility: WCAG 2.2 AA; complete keyboard operation and 4.5:1 normal-text contrast.
- Observability: structured logs, metrics, traces, correlation IDs, alerting on auth failures, workflow errors and reconciliation drift.
- Maintainability: Python 3.11, typed ports, Alembic-only changes, ≥80% branch coverage and contract tests against MSSQL.
- Privacy/compliance: minimization, purpose limitation, retention/legal hold, subject-access support, masking in non-production.

## Business rule catalog

| Rule | Definition |
|---|---|
| BR-01 Accrual | 30/360 day count; leap day does not change accrual. |
| BR-02 New joiner | Accrual begins at join date; a join date after cutoff yields zero. |
| BR-03 Mid-year allocation | Resume on calendar day after previous allocation; never double count the anchor day. |
| BR-04 Carry-forward | Opening days are capped by company policy (API default 30), then aggregate balance capped at 60. |
| BR-05 Payable | `min(MaximumPayout, MaximumPayout / 60 × RemainingDays)`. |
| BR-06 Ticket route | Three-character origin and destination differ; target requires canonical airport reference data. |
| BR-07 Excess | Company-paid amount over entitlement is recoverable; ticket cost does not currently constrain company paid. |
| BR-08 EMI | Monthly reducing balance; final installment absorbs rounding residual. |
| BR-09 Deferment | Target suspends due dates and payroll export through `DeferredUntil`, preserving principal and audit trail. |
| BR-10 Concurrency | Client sends current version for every mutation; stale versions return 409 without partial effects. |
| BR-11 Tax | Employer reimbursement and tax exemption are separate; domestic route, evidence, fare cap and block-year rules require effective-dated policy. |

## Edge-case matrix

| Case | Expected outcome |
|---|---|
| Feb 29 / leap year | Same contractual 30/360 result as non-leap year. |
| Join Jan 31 / Feb 28 | Month end normalizes to day 30; inclusive start is documented and tested. |
| Join after target date | Zero accrual. |
| Previous allocation equals target | Zero days because accrual resumes next date. |
| Target outside allocation year | Before: zero; after: 360. |
| Opening + accrual >60 | Remaining capped at 60. |
| Paid days exceed available | Remaining floors at zero; exception report records over-consumption. |
| Mid-month first EMI | Target policy selects full-period, actual/365 proration, or next-month anchor; current code applies a full monthly rate. |
| Due day 29–31 | Clamp to month end and retain preferred anchor for later months; current schedule drifts after February. |
| Deferment overlaps payroll | No deduction exported; resume by approved policy without retroactive duplicate. |
| Concurrent ticket approvals | One succeeds; later writer receives 409. |
| Concurrent loan payments | Atomic compare/update prevents outstanding below zero; current endpoint lacks this guard. |
| Duplicate payroll callback | Idempotency key returns original result. |

## Dependency matrix

| Capability | Current dependency | Target dependency / failure behavior |
|---|---|---|
| API | FastAPI/Uvicorn :3388 | Nginx TLS proxy; reject overload with 429/503. |
| Persistence | SQLAlchemy 2, MSSQL, Alembic `0001`/`0002` | HA SQL Server, encrypted backups, Query Store. |
| Async work | None | Redis + Celery; durable retries and dead-letter workflow. |
| Desktop | PySide6 + HTTPX | Same versioned API; no direct DB access. |
| Web | Pure JS same-origin client | CSP-compatible assets, accessible component behavior. |
| Identity | Local bcrypt/JWT | Enterprise IdP/OIDC, MFA, refresh rotation, revocation. |
| Payroll/HRIS | Manual boundary only | Versioned adapter, idempotent outbox/inbox and reconciliation. |
| Malware scan | `scan_status=pending` only | Scanner callback; fail closed. |
| Reporting | In-process PDF/XLSX | Async generation, object storage, expiring authorized download. |

## Current vs target gaps

Current implementation now includes employee-scoped ESS requests, lookup/rate maintenance, loan defer/restructure/bulk settlement, refresh-token rotation, password history and lockout. It still lacks configurable multi-step approval chains, period close, controlled reversals, payroll/HRIS connectors, tax evidence, asynchronous jobs, reconciliation, notification, retention/legal hold, tenant/company isolation, and SSO/MFA. These are requirements, not claims about existing behavior.
