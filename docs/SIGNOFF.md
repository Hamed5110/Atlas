# HCM Airfare — Full Process Review and Sign-off Pack

**Review date:** 2026-08-18  
**Scope:** Entire build process from the original enterprise command through the live 3388 system.  
**Decision requested:** one yes/no on this pack. Do not treat individual rows as separately signed.

This document is the durable record. It does **not** certify SOC 2, OWASP ASVS, or unrestricted financial production readiness.

---

## 1. What is being signed

| Product | Path | Port | Database | Rule |
|---|---|---|---|---|
| HCM Airfare (this pack) | `C:\HCM Airfare` | 3388 | `HCM_Airfare_Management` | In scope |
| ATLAS (reference) | `C:\Airfare_Allowance` | 3355 | `Atlasairfare010` | Read-only; do not modify |

Sign-off covers the **operational baseline** delivered on 3388: FastAPI + vanilla JS SPA + PySide6 desktop, Alembic-managed MSSQL, ATLAS 30/360 allocation formula, imported reference data, and passing automated tests.

Sign-off **excludes** the original factory’s commercial-ERP claims (tenant RLS, malware scanning, payroll/HRIS adapters, Celery/Redis/Nginx, WCAG evidence, concurrent payment safety, visual identity with ATLAS Next.js).

---

## 2. Evidence collected 2026-08-18

| Check | Result |
|---|---|
| `GET http://127.0.0.1:3388/health` | `{"status":"ok","version":"1.0.0","port":"3388"}` |
| `GET http://127.0.0.1:3355/api/health` | ATLAS 2.3.92, database connected, `continuousAirfareEntitlement: false` |
| Alembic on `HCM_Airfare_Management` | `0006_users_company_fk` (head) |
| Pytest | **52 passed**, 90.49% coverage (90% gate met), 18.75s |
| Live SPA `app.js` | Contains Airfare Allocation Engine, `/allocations/preview`, `/allocations/issue`, MaxPayout |
| HCM row counts | employees 130, opening_balances 259, entitlement_rates 21, tickets 6, loans 6, companies 1, users 1 |

Formula in `domain/services.py` (allocation path):

- Working days: `(month-1)*30 + day`, cap 360.
- Accrual start: `max(1 Jan, join date, last allocation + 1 day)`.
- Airfare days: `workingDays / 30 * 2.5` (4 dp, half-up).
- Remaining: `min(60, opening + current − paid)`.
- Payable: `min(MaxPayout, MaxPayout / 60 * remaining)`.
- Daily rate: `MaxPayout / 60` (not `/365`).

ATLAS live flags confirm 3355 is still on this 30/360 path; continuous-entitlement flags are off.

---

## 3. Process chronology (every request, one review)

| Step | Request | Outcome |
|---|---|---|
| 1 | Enterprise Airfare Management (Clean Architecture, FastAPI, PySide6, MSSQL, 90% tests) | Foundation started under `C:\Airfare_Allowance\airfare_management`, then relocated. |
| 2 | Put the full system in `C:\HCM Airfare` on port **3388** | Canonical runtime is 3388. Do not bind this product to 3355. |
| 3 | Persist everything in MSSQL (`sa` / encoded password in gitignored `.env`) | Live DB `HCM_Airfare_Management`; Alembic through 0006. SQLite is tests-only. |
| 4 | Browser UI (not JSON at `/`) | SPA at `/` and `/assets/app.js` (`Cache-Control: no-store` for `app.js`). |
| 5 | 12-phase factory + four review reports | Blueprint `docs/phase-01`–`08` plus architecture/security/DBA/QA reviews. Reports remain defect lists, not closure certificates. |
| 6 | “Nothing working like 3355” | Root cause: 3388 had ~1 employee vs ATLAS ~129 plus real balances/tickets/loans. Importer added. |
| 7 | Git remote `https://github.com/Hamed5110/Atlas.git` | Executed on `C:\Airfare_Allowance` (`main`). `C:\HCM Airfare` is a separate tree; do not overwrite ATLAS `main` without an explicit branch. |
| 8 | Match 3355 calculation (learn from ATLAS git), not the earlier 365-day engine | Allocation engine switched to 30/360. Tests rewritten to ATLAS cases. |
| 9 | This review | Full pack below. No piecemeal ticks. |

---

## 4. Factory phases 1–12 — single verdict table

Blueprint phases 1–8 exist as design. Phases 9–12 are implementation/ops. Status is against **delivered code + live 3388**, not against the aspiration in the original prompt.

| Phase | Title | Verdict | Evidence | Residual |
|---|---|---|---|---|
| 1 | Business analysis | Partial | `docs/phase-01-business-analysis.md`; FR/BR catalog | Payroll, four-eyes, period close are target-only |
| 2 | Domain modeling | Partial | `domain/models.py`, `domain/services.py` | Domain/ORM drift; fat API still owns use cases |
| 3 | Enterprise architecture | Partial | C4/docs; FastAPI + desktop + SPA | No outbox; no Redis/Celery/Nginx in proven deploy |
| 4 | Database engineering | Partial | Alembic 0001–0006 on live MSSQL | `sql/mssql_schema.sql` still diverges; financial CHECKs incomplete |
| 5 | Security architecture | Partial | JWT, refresh rotation, lockout, RBAC roles | No tenant RLS; attachments unscanned; bootstrap defaults |
| 6 | API design | Partial | Broad `/v1` catalog including allocations, loans, ESS | Error shapes mixed; some endpoints unused by UI |
| 7 | UI/UX | Partial | 11 web modules + 11 desktop screens; grids with search/sort/page | Not ATLAS Next.js; no WCAG evidence; loan payment/defer UI missing |
| 8 | Service design | Partial | Pure calc + some handlers | Ticket/loan commands still in `api/main.py` |
| 9 | Implementation | Partial | Runnable 3388 against MSSQL with imported data | See module table |
| 10 | Testing / QA | Partial | 52 tests, 90.49% line coverage | QA-03/04/05 open; tests are SQLite, not MSSQL concurrency |
| 11 | DevOps | Partial | `ci.yml`, Docker compose (API), start-*.ps1 | Compose does not prove Redis/Celery/Nginx here |
| 12 | Handover | Partial | README, import docs, this pack | `C:\HCM Airfare` has no git commit; import doc still mentions 365 in one paragraph |

**Phase-set verdict:** design artefacts exist; operational baseline runs; factory “commercial enterprise product” is **not** complete. Do not sign phases 1–12 as individually closed.

---

## 5. Functional requirements (FR-01–FR-12)

| ID | Requirement | Verdict | Note |
|---|---|---|---|
| FR-01 | Companies and employees | Pass (narrow) | Unique codes; one company in live DB; CRUD + soft delete |
| FR-02 | Employee import/export | Partial | API XLSX import/export exist; web SPA has no import button (ATLAS import script used instead) |
| FR-03 | Opening balances | Pass (narrow) | 259 rows imported; API CRUD; unique employee/year |
| FR-04 | Entitlement calculation | Pass | 30/360 matches 3355; unit tests include 360→30 days and June 18→14 days / 35 BHD |
| FR-05 | Ticket workflow | Partial | Draft→status transitions exist; imported ATLAS tickets are not a full edit UI |
| FR-06 | Approval chain | Fail | No configurable manager/finance four-eyes |
| FR-07 | Excess | Pass (narrow) | `LOAN` / `COMPANY_PAID` / `SELF_PAID`; ATLAS six payment modes collapsed |
| FR-08 | Loans | Partial | Create/list/schedule + API payment/defer/restructure/bulk-settle; web has no payment/defer screens |
| FR-09 | Preferences | Partial | Effective merge; lock not enforced in resolver (QA-06) |
| FR-10 | Attachments | Fail | Upload without parent auth or malware scan (SEC-02) |
| FR-11 | Reports | Partial | Dashboard KPIs, report summaries, one excess PDF |
| FR-12 | Audit | Partial | Metadata audit rows; not append-only temporal with before/after |

---

## 6. ATLAS left-panel modules vs 3388

ATLAS nav (3355): Overview, Employees, Entitlement Seeds, Airfare Allocation, ESS, Loans, Reports, Multi-Company, Preferences, Import/Export, AI Insights, User Management, Support.

HCM web nav (3388): Dashboard, Employees, Opening Balances, Airfare Entitlement, Airfare Allocation Engine, Tickets, Loans, Preferences, Reports, ESS, Administration.

| ATLAS / queue item | 3388 | Verdict |
|---|---|---|
| Dashboard / Overview | KPI counts | Partial (no ATLAS charts/AI) |
| Company-DB selector | Single company | Not delivered |
| Year-End process | Omitted | Intentional: 3355 continuous flags are off; later ATLAS git removed year-end in favour of continuous entitlement, which is still not live |
| Opening balances / seeds | Grid + CRUD | Partial (no Excel round-trip in SPA) |
| Loan management | List/create | Partial (API extras unused in UI) |
| Airfare entitlement | Calculator | Pass |
| Airfare allocation | Preview + issue | Pass |
| Employees | List/create/edit/delete | Pass (narrow) |
| Tickets | List/create/status | Partial |
| Preferences | Theme/effective JSON | Partial |
| Reports | Summaries + excess PDF | Partial |
| ESS | Basic requests | Partial |
| Administration / users | Lookups + user create API | Partial |
| Multi-company | — | Not delivered |
| AI Insights | — | Not delivered |
| Support | — | Not delivered |
| Visual parity with ATLAS Next.js | Vanilla SPA | Not claimed |

---

## 7. Data import

`scripts/import_from_atlas.py` is read-only against `Atlasairfare010` and writes only to `HCM_Airfare_Management`. Live HCM counts match the ATLAS snapshot (plus one pre-existing HCM employee → 130).

Intentional omissions remain: CPR/passport/salary, monthly day buckets, payroll history, ATLAS identity integers (mapped to UUIDv5).

Stale sentence: `docs/atlas-import.md` still mentions a 365-day engine. Runtime and tests use 30/360. Treat the runtime as authoritative.

---

## 8. Open defects that block a *financial-production* certificate

These findings from `docs/review-*.md` are **still open**. Signing this pack does **not** close them.

| ID | Severity | Topic |
|---|---|---|
| QA-03 / DBA-04 | Critical | Loan payments can race (no compare-and-swap / idempotency) |
| SEC-01 | Critical | No company tenant isolation for privileged roles |
| SEC-02 | Critical | Attachments: no parent auth, no malware scan |
| QA-04 | High | Referential checks inconsistent; SQLite tests may hide FK issues |
| QA-05 | High | Ticket amounts/entitlement not always derived server-side |
| ARCH-01 / DBA-02 | Critical/High | Alembic vs `mssql_schema.sql` drift |
| QA-06 | High | Preference `is_locked` not applied in resolver |

**Release gate from QA review (unchanged):** do not certify financial production until QA-03, QA-04, and QA-05 are closed against MSSQL under concurrency.

---

## 9. Git / handover

| Tree | Git | Remote |
|---|---|---|
| `C:\Airfare_Allowance` | History on `main` (example HEAD `c7ea2fa` at last push) | `https://github.com/Hamed5110/Atlas.git` |
| `C:\HCM Airfare` | No initial commit at last check | Do not push onto ATLAS `main` without an explicit `hcm-airfare` (or similar) branch |

3355 / `Atlasairfare010` were not written during this review.

---

## 10. Sign-off statement (single decision)

I have reviewed this pack as a whole. I accept **one** of the following:

**A — Accept operational baseline (recommended)**  
3388 is accepted as the HCM Airfare runtime: MSSQL Alembic 0006, ATLAS 30/360 allocation, imported reference data, SPA + desktop, 52 tests / 90% coverage. Factory enterprise claims, ATLAS visual parity, and the critical defects in section 8 remain **out of scope** until a later pack.

**B — Reject**  
The system is not accepted until named gaps are closed. List them in the reply.

**C — Accept with named exceptions**  
Accept A, plus or minus a written exception list.

Reply in chat with `SIGN-OFF A`, `SIGN-OFF B`, or `SIGN-OFF C` plus any exceptions. One reply covers every row in this document.
