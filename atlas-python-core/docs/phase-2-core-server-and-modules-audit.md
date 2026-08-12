# Phase 2: Core Server Wiring and Modules 02-11 Rollout Audit

STATUS: GREEN — FastAPI wiring and multi-module artifacts were generated and validated.

ACTION: Port 3356 now has a FastAPI application foundation, SQLAlchemy MSSQL dependency, Employee Master TestClient coverage, and DDL/API/UI blueprint artifacts for modules 02 through 11.

RED TEAM: These modules are implementation blueprints plus concrete route/table contracts. They are not all fully integrated screens in the live stdlib server. Production completion requires applying DDL to a target MSSQL database and mounting the FastAPI process as the official Port 3356 runtime.

HISTORY GIT REF: Legacy Port 3355 remains read-only reference only. No legacy UI or Year-End code was copied.

## Core Engine

| Artifact | Purpose | Status |
|---|---|---|
| `app/database.py` | SQLAlchemy MSSQL engine, pooling, session factory, `get_db` dependency | Implemented |
| `app/main.py` | FastAPI app, CORS, exception handlers, health endpoint, router registration | Implemented |
| `tests/test_employee_api.py` | TestClient API coverage for Employee Master GET/POST/PUT/DELETE | Implemented |

## Modules 02-11

| Module | DDL Coverage | API Coverage | UI Coverage |
|---|---|---|---|
| Employee Import | `ImportBatches`, `ImportRowErrors` | `/api/v1/imports/{module}/preview` | `modules-02-11-blueprint.html#import` |
| Airfare Allocation | `AirfareClaims`, `AirfareAllocationsV2` | claim create/approve | `#airfare` |
| Loans / EMI | `Loans`, `LoanSchedules` | amortization, loan create | `#loans` |
| Opening Balance / Seed Evidence | `SeedEvidence` | seed evidence create | `#seed` |
| Reports Engine | `ReportRuns` | report run request | `#reports` |
| Preferences / Admin | `SystemSettings`, `UserRoles` | setting upsert | `#admin` |
| Self-Service Portal | `SelfServiceRequestsV2` | `/api/v1/me/requests` | `#self` |
| Attachments / Documents | `DocumentMetadata` | metadata create | `#docs` |
| Airport Search | `Airports` | `/api/v1/airports?q=` | `#airports` |
| Backup / Restore / Audit | `AuditLogs`, `BackupJobs` | backup queue | `#backup` |

## Verification

| Check | Result |
|---|---|
| Python compile | PASS |
| TestClient Employee API tests | PASS: 3/3 |
| Full Python core tests | PASS: 5/5 |
| Port isolation fields | PASS: FastAPI health reports `port = 3356` |
| Year-End implementation leakage | PASS: no Year-End tables, endpoints, UI buttons, or routines in new artifacts |

## Kill Critic Notes

- Do not call these modules finished payroll production until DDL has been applied to a clean MSSQL database and the FastAPI app is run as the official Port 3356 server.
- Do not wire these endpoints into Port 3355.
- Do not add Year-End closing, yearly rollover, or annual close fields to seed evidence. Seed evidence is migration-only historical input.
