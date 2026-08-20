# Phase 3 — Enterprise Architecture

## C4 context

```mermaid
C4Context
  title HCM Airfare Management
  Person(employee, "Employee", "Requests and tracks airfare")
  Person(hr, "HR/Manager", "Maintains eligibility and approves")
  Person(finance, "Finance/Auditor", "Pays, recovers, reconciles and audits")
  System(airfare, "Airfare Management", "Entitlements, tickets, loans, preferences, reports")
  System_Ext(hris, "HRIS", "Employee and organization master")
  System_Ext(payroll, "Payroll", "Loan deductions and acknowledgements")
  System_Ext(idp, "Enterprise IdP", "OIDC/MFA")
  System_Ext(scanner, "Malware Scanner", "Attachment verdicts")
  Rel(employee, airfare, "Uses", "HTTPS")
  Rel(hr, airfare, "Uses", "HTTPS/PySide6")
  Rel(finance, airfare, "Uses", "HTTPS/PySide6")
  Rel(airfare, hris, "Consumes master changes")
  Rel(airfare, payroll, "Exchanges deductions")
  Rel(airfare, idp, "Authenticates")
  Rel(airfare, scanner, "Scans evidence")
```

## Containers

```mermaid
C4Container
  Person(user, "Business user")
  System_Boundary(s, "Airfare Management") {
    Container(nginx, "Nginx", "TLS reverse proxy", "TLS, headers, limits")
    Container(web, "Web client", "Pure JavaScript", "Same-origin browser UI")
    Container(desktop, "Desktop client", "PySide6/httpx", "Native UI")
    Container(api, "API", "Python 3.11/FastAPI", "Application and domain orchestration")
    Container(worker, "Worker", "Celery", "Reports, imports, integrations, scans")
    Container(redis, "Redis", "Broker/cache", "Short-lived jobs, rate limits, revocation")
    ContainerDb(db, "HCM_Airfare_Management", "MSSQL", "System of record")
    ContainerDb(blob, "Attachment storage", "Encrypted object/file store", "Evidence and reports")
  }
  Rel(user, nginx, "HTTPS")
  Rel(nginx, web, "Static assets")
  Rel(nginx, api, "/v1")
  Rel(desktop, nginx, "JSON/HTTPS")
  Rel(api, db, "SQLAlchemy 2/pyodbc")
  Rel(api, redis, "enqueue/cache")
  Rel(worker, redis, "consume")
  Rel(worker, db, "transactional work")
  Rel(api, blob, "authorized stream")
```

Current `compose.yaml` contains only the API and attachment volume. Redis, Celery and Nginx are target containers, not deployed components.

## API component view

```mermaid
C4Component
  Container_Boundary(api, "FastAPI API") {
    Component(routes, "Transport adapters", "FastAPI/Pydantic", "Validation and RFC 7807")
    Component(auth, "Security adapter", "JWT/RBAC", "Identity and permissions")
    Component(app, "Application services", "Commands/queries/UoW", "Use-case orchestration")
    Component(domain, "Domain model", "Python/Decimal", "Invariants and calculations")
    Component(repo, "Persistence adapters", "SQLAlchemy 2", "Repositories/outbox")
    Component(docs, "Document services", "openpyxl/reportlab", "XLSX/PDF")
  }
  Rel(routes, auth, "authorize")
  Rel(routes, app, "commands/queries")
  Rel(app, domain, "invoke")
  Rel(app, repo, "ports")
  Rel(app, docs, "render")
```

## Key sequences

```mermaid
sequenceDiagram
  actor U as HR/Manager
  participant A as API
  participant T as TicketService
  participant D as MSSQL
  participant O as Outbox
  U->>A: PATCH status + If-Match
  A->>T: decide(ticket, decision, actor, version)
  T->>D: load ticket + approval chain
  T->>T: permission, SoD, transition, value checks
  T->>D: UPDATE ... WHERE Version=expected
  T->>O: append TicketApproved
  D-->>T: commit
  A-->>U: 200 + ETag/new version
```

```mermaid
sequenceDiagram
  participant P as Payroll
  participant A as Integration API
  participant L as LoanService
  participant D as MSSQL
  P->>A: deduction callback + idempotency key
  A->>D: lookup InboxMessage
  alt duplicate
    D-->>A: prior response
  else new
    A->>L: post payment
    L->>D: lock loan; payment + outstanding + audit
    D-->>A: commit
  end
  A-->>P: acknowledgement
```

## Deployment and operations

Nginx terminates TLS, sets HSTS/CSP, limits bodies/rates and forwards verified proxy headers. API and workers run as non-root immutable containers. MSSQL is private-network only. Redis requires TLS/auth and is not the source of record. Secrets come from a vault/managed identity, never image or source. OpenTelemetry exports traces; Prometheus-compatible metrics cover latency, queue depth, DB pools and workflow failures.

## Architecture decisions and trade-offs

- Modular monolith first: one transactional MSSQL boundary fits coupled entitlement/ticket/loan consistency and team size. Reject microservices now because distributed transactions and operational overhead exceed independent-scaling value.
- SQLAlchemy repositories: portability and testability, while allowing targeted MSSQL SQL for locking/temporal features. Reject active-record route logic as the target because it scatters invariants.
- Celery/Redis for slow/retriable jobs, never synchronous financial mutation. Reject in-process background tasks because restart loses work.
- MSSQL temporal history plus application audit: temporal answers “what row existed”; audit answers “who/why/request.” Either alone is insufficient.
- Same versioned API for web and desktop. Reject desktop direct DB connectivity because it bypasses authorization/audit.
- HS256 is acceptable only for a tightly controlled single issuer; target OIDC/RS256 or asymmetric internal signing improves rotation and key separation.

## Current vs target gaps

The present FastAPI module is a 923-line composition-and-use-case file, reports/imports execute in request threads, attachments use local disk, and events are synchronous/in-memory. The target introduces application boundaries, durable outbox, asynchronous workers, reverse proxy, centralized identity and operational telemetry without changing the documented business semantics.
