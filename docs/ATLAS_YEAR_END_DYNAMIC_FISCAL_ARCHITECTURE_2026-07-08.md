# ATLAS Year-End Dynamic Fiscal Architecture and Self-Learning Prompt Framework

## Purpose

This artifact defines the Phase-1 architecture for Atlas AirFare System year-end processing, dynamic fiscal year switching, multi-year mutation controls, and self-correcting operational intelligence. It is a logic and prompt framework only. It does not introduce hardcoded airfare rates, does not change backend serialization, and does not alter database formulas.

> System guardrail: Every airfare rate, payout cap, cycle rule, eligibility rule, and operational variable must resolve from Preferences, policy snapshots, employee context, company context, and fiscal effective dates at runtime.

> System guardrail: Historical fiscal years are never treated as ordinary editable screens. They are contextual snapshots with explicit mutation permissions, reason capture, audit history, recalculation impact review, and post-change verification.

## Section 1: Open-Source Benchmarking and Comparison

| System | Year-end close pattern | Fiscal year context pattern | Mutation control pattern | ATLAS feature to adopt |
| --- | --- | --- | --- | --- |
| Odoo | Uses fiscal year workflow with year-end checklist and lock dates. Lock dates prevent posted journal changes on or before the locked date, with controlled administrator exceptions. | Accounting screens and reports are date/fiscal-period driven. The fiscal boundary influences allowed posting and reporting context. | Lock Everything date blocks old-period modifications and posting. Exceptions require administrator authority and reasoned unlock behavior. | Add fiscal lock state per company/year, exception workflow, visible lock banner, reason-required historical edits, and post-edit audit verification. |
| ERPNext / Frappe | Uses Period Closing Voucher to transfer income and expense balances to a closing account while carrying balance sheet continuity forward. Opening Entry becomes restricted after Period Closing Voucher exists. | Fiscal Year is an explicit setup object used for reports and closing. The selected fiscal year defines statement period and close target. | Closing voucher submission produces general ledger entries. Later adjustments require another closing voucher for pending profit/loss movement. | Add preview-first close, closing voucher equivalent, next-year opening register mapping, and incremental adjustment voucher rules for post-close corrections. |
| Apache OFBiz | Uses accounting time periods and party/accounting preferences to define fiscal year starts, periods, organization-specific accounting setup, and cost-center style partitions. | Fiscal period belongs to party/accounting organization setup, making company and period context first-class operating dimensions. | Mutations are controlled through accounting period state, organization context, service permissions, and ledger effect. | Add company-year context as a first-class session dimension and require every API query to carry company, fiscal year, and mutation mode. |

### Data Isolation vs. Continuity

| Concern | Open-source pattern | ATLAS Phase-1 rule |
| --- | --- | --- |
| Temporary income/expense closure | ERPNext zeroes income and expense balances through a period closing voucher and transfers profit/loss to a closing account. | Airfare year-end must close temporary annual employee entitlement movements into a closing snapshot while preserving permanent employee, loan, and company master continuity. |
| Permanent balance continuity | Balance sheet accounts continue after close; opening entries are not recreated every year after closing history exists. | Employee master, active loans, company setup, policy history, and audit records continue. Only calculated opening balances for the new fiscal year are created from verified closing outputs. |
| Locking closed periods | Odoo lock dates prevent posted journal mutation before or on a lock date, with explicit exceptions. | Closed ATLAS fiscal years are read-only by default. Mutation requires privileged exception mode, reason, before/after snapshot, recalculation scope, and verification result. |
| Company isolation | OFBiz accounting setup is organization/party scoped; Odoo multi-company accounting keeps company context explicit. | Every close, preview, switch, mutation, report, and export must be partitioned by selected company and fiscal year. |

### Year Switching Mechanism

| Layer | Required behavior |
| --- | --- |
| UI shell | A global fiscal selector appears in year-sensitive screens. Switching year updates screen labels, command availability, fiscal lock banner, and selected-year totals. |
| Session context | Active context contains company ID, fiscal year, fiscal status, lock status, effective date range, user role, and mutation mode. |
| API request context | Year-sensitive requests must include fiscal year and company partition. Missing fiscal context must default only through a documented session rule and must be visible in response metadata. |
| Reporting context | Reports read from the selected fiscal year snapshot and expose whether the result is live operational, preview, closed snapshot, or historical mutation view. |
| Mutation context | Edit, update, import, delete, allocation, loan, opening balance, and year-end actions evaluate fiscal lock state before saving. |

### Multi-Year Mutation Rules

| Fiscal state | Default privilege | Allowed mutation | Required verification |
| --- | --- | --- | --- |
| Current open year | Admin, manager, HR according to module role | Normal operational edits through existing workflows | Field validation, formula verification, audit log |
| Transitional close preview | Admin only for close command, read access by authorized finance roles | Preview recalculation and evidence print only | Trial balance integrity, opening/closing reconciliation, pending loan review |
| Closed historical year | Read-only for normal users | Exception edit only through privileged mutation workflow | Reason, approval, before/after snapshot, reverse/adjustment voucher, consolidated statement impact |
| Prior year with unlocked exception | Admin with explicit exception window | Controlled correction entries and re-run of close delta | Exception expiry, audit log, delta voucher, next-year opening balance impact |
| Future setup year | Admin or configured finance setup role | Fiscal setup, opening balance preparation, policy staging | Preference lookup, duplicate opening guard, company isolation check |

## Section 2: Phase-1 System Architecture Specification

### Phase-1 Scope

| Included | Excluded |
| --- | --- |
| Year-end preview logic | Autonomous change to existing formulas |
| Runtime preference lookup | Hardcoded airfare rates |
| Fiscal year session context | Database schema rewrite without migration design |
| Historical mutation guardrails | Silent backdated updates |
| Audit and verification framework | Unverified AI-generated business-rule changes |
| Self-learning prompt artifact generation | Direct modification of model weights |

### Core Domain Schemas

| Schema | Key fields | Purpose |
| --- | --- | --- |
| FiscalYearContext | CompanyID, FiscalYear, StartDate, EndDate, Status, LockDate, MutationMode, UserRole, SessionID | Single source of truth for selected company-year session behavior. |
| YearEndPreview | CompanyID, CloseYear, NextYear, ClosingDate, EmployeeScope, TotalClosingDays, TotalClosingAmount, PendingLoanCount, PendingLoanAmount, IntegrityStatus | Non-committing preview evidence before year close. |
| YearEndCloseBatch | BatchID, CompanyID, ClosedYear, NextOpeningYear, ClosingDate, ClosedBy, ClosedAt, Status, Remarks, VerificationScore | Auditable close operation and rollback anchor. |
| YearEndEmployeeSnapshot | BatchID, EmployeeID, OpeningDays, OpeningAmount, EarnedDays, EarnedAmount, PaidDays, PaidAmount, ClosingDays, ClosingAmount, PendingLoanBalance | Employee-level bridge from closed year to next-year opening balance. |
| HistoricalMutationRequest | RequestID, CompanyID, FiscalYear, EntityType, EntityID, MutationType, Reason, RequestedBy, ApprovalStatus, LockExceptionID | Controlled entry point for editing closed or prior-year records. |
| MutationImpactReport | RequestID, BeforeSnapshot, ProposedAfterSnapshot, AffectedReports, NextYearImpact, ConsolidationImpact, VerificationResult | Required evidence before historical mutation commit. |
| PreferenceResolutionEvidence | CompanyID, EmployeeID, FiscalYear, EffectiveDate, PreferenceKey, ResolvedValue, SourceScope, SourceRecordID | Proof that rates and operational variables came from Preferences/policy lookup. |
| SelfLearningSignal | SignalID, Source, Severity, UserCorrection, FailedExpectation, Module, FiscalYear, VectorTags, ResolutionStatus | Captures errors, corrections, and ambiguity patterns for future prompt optimization. |

### Year-End Processing Engine

#### Runtime Variable Resolution

| Variable | Resolution order | Forbidden behavior |
| --- | --- | --- |
| Airfare rate / maximum payout | Employee exception, pay-group matrix, department matrix, company default, global default, all filtered by effective fiscal date | Fixed numeric value inside calculation logic |
| Closing date | User-selected date validated against fiscal year end date and lock state | Implicit unshown close date |
| Employee eligibility | Employee status, join date, last working date, policy scope, selected employee scope | Hardcoded active employee assumptions |
| Loan carry-forward | Loan register status and remaining balance as of closing date | Recomputing loan terms from unrelated formulas |
| Opening balance creation | Verified closing snapshot only | Manual copy without batch reference |

#### Trial Balance and Ledger Integrity Algorithm

1. Resolve FiscalYearContext.
2. Load all selected employees for company/year scope.
3. Resolve preference evidence per employee and effective date.
4. Calculate opening balance, current-year earned entitlement, consumed entitlement, and closing balance using existing formulas.
5. Load loan balances and pending EMI status as of closing date.
6. Reconcile employee-level closing totals against report-level payable totals.
7. Verify no duplicate opening balance already exists for next year unless operation mode is approved update.
8. Verify no negative balance appears without an explicit review flag.
9. Verify all preference values have evidence rows.
10. Produce YearEndPreview with blocking issues, warnings, and close readiness score.

#### Closing Journal / Voucher Logic

| Voucher type | Trigger | Debit/Credit or movement concept | ATLAS equivalent |
| --- | --- | --- | --- |
| Closing balance snapshot | Preview approved and close confirmed | Freeze employee-level closing days and amount | YearEndEmployeeSnapshot |
| Next-year opening balance | Closing snapshot committed | Carry verified closing values forward | OpeningBalances for next year with batch reference |
| Loan continuity voucher | Active loan exists at close | Preserve remaining balance and EMI schedule | Loan carry-forward evidence row |
| Historical delta voucher | Prior-year correction after close | Reverse or adjust previously closed output | MutationImpactReport and adjustment batch |

### Dynamic Fiscal Year Switcher and Multi-Year Mutation Engine

#### Global Session Context Switching

| Event | Required logic |
| --- | --- |
| User selects fiscal year | Update FiscalYearContext; clear stale previews; reload all year-sensitive widgets; show confirmation message. |
| User selects company | Re-resolve company assets, logo, preferences, fiscal lock state, and available years; clear cross-company cached rows. |
| User enters closed year | Switch UI to historical mode; disable destructive commands; expose exception request flow. |
| User enters future year | Switch UI to setup mode; allow opening balance preparation and policy staging only. |
| User returns to current year | Restore operational command set and live dashboard metrics. |

#### API Filtering Rules

| API category | Fiscal requirement |
| --- | --- |
| Opening balance | Must include selected year or derive it from FiscalYearContext and return the year used. |
| Allocation | Must filter by selected allocation year and company scope. |
| Loan | Must expose current outstanding state and year-specific EMI history where needed. |
| Reports | Must receive year and as-of date; response must identify live vs historical snapshot. |
| Year-end preview | Must be dry-run by default and cannot commit. |
| Year-end close | Must require preview evidence matching the same company/year/date/scope. |
| Historical mutation | Must require lock exception, reason, before/after evidence, and verification result. |

#### Historical Edit / Update Control

1. User opens historical year.
2. System displays read-only state and lock reason.
3. User requests exception edit with reason and target entity.
4. System checks role, fiscal lock, close batch status, and downstream impact.
5. System builds before snapshot and proposed after snapshot.
6. System calculates affected opening balances, reports, loans, and allocations.
7. System requires confirmation with impact summary.
8. System commits adjustment as a new mutation record, never as silent overwrite.
9. System recalculates dependent snapshots and marks reports as adjusted.
10. System writes audit trail and verification evidence.

### Exact System Prompt Framework

#### Architectural Prompt

> Act as ATLAS Year-End Processing Architect. For every year-end, fiscal switching, opening balance, allocation, loan, or report action, first resolve FiscalYearContext and PreferenceResolutionEvidence. Never use hardcoded airfare rates. Never mutate a closed fiscal year without HistoricalMutationRequest, MutationImpactReport, audit log, and verification result. Preserve company isolation. Return explicit command state: live operational, preview required, preview ready, historical locked, exception pending, or closed snapshot.

#### Close Preview Prompt

> Generate a year-end preview for selected CompanyID, FiscalYear, ClosingDate, and EmployeeScope. Resolve preferences at runtime. Calculate employee-level opening, earned, consumed, closing, loan carry-forward, and blocking issues. Do not commit data. Produce readiness score, warnings, blockers, and next-year opening balance proposal.

#### Close Commit Prompt

> Commit year-end only when preview evidence matches current CompanyID, FiscalYear, ClosingDate, EmployeeScope, and user role. Create immutable close batch, employee snapshots, next-year opening balance rows, and audit history. Refuse close if preview is stale, rates lack evidence, duplicate next-year opening rows exist without approved update mode, or database verification fails.

#### Historical Mutation Prompt

> Treat closed-year edits as adjustment workflows. Require reason, role check, fiscal lock exception, before snapshot, proposed after snapshot, downstream impact report, and verification result. Do not overwrite closed evidence silently. Commit only as traceable delta, then refresh affected reports and next-year opening evidence.

#### Fiscal Switch Prompt

> When the user switches fiscal year, update global context, clear stale previews, reload year-sensitive records, update lock banner, update command availability, and show a confirmation message naming the selected year and next required action.

## Section 3: Self-Learning and Self-Correcting Engine

### Safety Boundary

The self-learning engine may optimize versioned prompt artifacts, diagnostic rules, UI command messages, validation test suggestions, and ambiguity warnings. It must not modify business formulas, database tables, close batches, historical financial records, or production permissions without the same verification and release process as human-authored changes.

### Signal Sources

| Source | Examples | Severity |
| --- | --- | --- |
| Execution logs | Failed preview, stale fiscal context, missing preference evidence, API validation error | Medium to critical |
| User correction | "You did not understand year switch", "Option is not visible", "Do not change formulas" | Medium to critical |
| Validation failure | Unit test fail, build fail, full system test fail, browser visibility fail | High |
| Audit exception | Historical mutation denied, missing reason, unauthorized close attempt | High |
| Runtime observation | Repeated navigation confusion, hidden control, ambiguous status message | Low to medium |

### Feature Vector Tuning

| Vector dimension | Description |
| --- | --- |
| Module | Year End, Opening Balance, Loans, Airfare, Preferences, Reports |
| Intent | Design, implement, verify, explain, rollback, compare, patch |
| Failure type | Missing visibility, wrong screen, stale context, formula risk, permission ambiguity, incomplete test |
| Fiscal context | Current, prior, locked, future, transition preview |
| Data scope | Company, employee, department, pay group, global |
| Expected action | Add UI control, add validation, add prompt framework, run test, create backup, commit |
| Correction polarity | User says missing, wrong, not visible, do research, verify, apply |

### Self-Learning Loop

1. Ingest new signal.
2. Normalize it into module, intent, fiscal context, failure type, and expected action.
3. Compare signal against current prompt framework and verification checklist.
4. Identify missing instruction, ambiguous instruction, or failed execution step.
5. Generate a prompt-delta proposal with reason and expected behavior.
6. Run static validation against safety boundaries.
7. Add or update a versioned prompt artifact.
8. Generate a verification test that detects recurrence of the failure.
9. Run relevant tests.
10. Activate the prompt artifact only if tests pass.
11. Record the resolved signal and link it to commit, test report, and affected module.

### Auto-Optimization Meta-Prompt

> Review the latest SelfLearningSignal set. Identify repeated misunderstanding patterns, missing guardrails, weak UI confirmations, and fiscal-context ambiguity. Produce a prompt-delta that improves future reasoning without changing business formulas, database schema, or backend serialization. The delta must name the affected module, the exact failed expectation, the corrected rule, the verification test required, and the rollback condition. If the delta touches historical mutation, year-end close, preferences, or financial values, require explicit verification evidence before activation.

### Activation Rules

| Candidate type | Automatic activation allowed | Required evidence |
| --- | --- | --- |
| UI confirmation text | Yes, after source and layout tests pass | Source test and visual check |
| Prompt guardrail | Yes, after document test passes | Prompt artifact test |
| Validation checklist | Yes, after full system test passes | Test report |
| Business formula change | No | Human approval and full financial regression |
| Database schema change | No | Migration plan, backup, restore test, human approval |
| Historical mutation policy | No direct auto-activation | Security review and close/reopen regression |

## Phase-1 Verification Matrix

| Requirement | Pass criteria |
| --- | --- |
| No hardcoded airfare rates | Tests confirm calculations reference Preferences/policy evidence, not fixed payout logic. |
| Fiscal switch visibility | Year End and Opening Balance expose selected-year controls in first workflow area. |
| Preview-before-close | Close command remains blocked until matching preview exists. |
| Closed year mutation safety | Historical years are read-only unless exception workflow is active. |
| Audit completeness | Every close, exception edit, and opening rollover has batch and user evidence. |
| Company isolation | Company switch reloads assets, preferences, selected year, and scoped rows. |
| Self-learning safety | Prompt deltas can be generated and tested, but formulas/schema cannot be self-modified. |

## Implementation Backlog

| Priority | Feature | Rationale |
| --- | --- | --- |
| P1 | FiscalYearContext response metadata on all year-sensitive APIs | Prevents invisible default-year confusion. |
| P1 | HistoricalMutationRequest workflow | Allows authorized prior-year correction without silent corruption. |
| P1 | Year-end lock banner and exception reason panel | Mirrors Odoo lock-date clarity. |
| P2 | Closing voucher evidence register | Mirrors ERPNext Period Closing Voucher traceability. |
| P2 | SelfLearningSignal table and dashboard | Turns user corrections and failed tests into prompt/test improvements. |
| P3 | Fiscal calendar setup for non-calendar fiscal years | Mirrors OFBiz and ERP fiscal period flexibility. |

