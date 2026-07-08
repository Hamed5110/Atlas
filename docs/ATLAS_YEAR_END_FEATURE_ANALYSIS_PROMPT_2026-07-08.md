# ATLAS Year-End Feature Analysis and Testing Prompt Template

## Purpose

This template defines the system analysis, feature-addition logic, and testing framework for Atlas AirFare System evaluation. It adds year-end process architecture, open-source-inspired operational features, and cross-year data isolation requirements without changing existing business rules, formulas, airfare calculation logic, or database behavior.

> Systemic Guardrail: No business formula may be replaced, simplified, or hardcoded. New features must wrap, validate, audit, preview, or organize existing logic only.

> Systemic Guardrail: The `Airfare rate` must always be resolved dynamically from the global system preferences table at runtime. Any feature that calculates or previews airfare must prove preference lookup.

> Systemic Guardrail: Multi-company operation must isolate company assets, names, logos, session state, tenant-scoped records, fiscal-year data, and schema boundaries.

## Open-Source Benchmark Basis

| Source System | Observed Pattern | Atlas Feature Direction |
| --- | --- | --- |
| Frappe HR / ERPNext | Employee records can be bulk-created through a Data Import tool with templates and required employee/company/date fields | Add a stronger staging matrix, field mapping validation, inline correction, and pre-commit duplicate detection |
| ERPNext Accounting | Opening balances are treated as transition values from prior systems and require careful reconciliation before activation | Add double-entry opening balance audit trail and immutable legacy adjustment history |
| Odoo Community | CSV/XLSX imports are available on business objects through import records workflows | Add mapping validation, field-type mismatch detection, and user-facing import preview grid |
| Odoo Multi-Company | Active company context and company switching are core interaction models | Add strict Atlas company/year matrix boundaries and visual state separation |
| Odoo / ERPNext Fiscal Controls | Fiscal closing, reconciliation, and historical reporting are explicit accounting safety concepts | Add year-end close checklist, rollover matrix, and read-only historical snapshots |

## Feature Addition Matrix

| Feature | New Capability | Existing Rule Protection | Required Verification |
| --- | --- | --- | --- |
| Data Mapping Validation Engine | Detect field mapping errors, data type disparities, duplicate employee IDs, missing required values before commit | Does not alter employee formulas or existing import commit rules | Invalid rows cannot commit; corrected rows revalidate |
| Double-Entry Ledger Audit Trail | Every opening balance import, edit, correction, and soft-delete creates immutable debit/credit-style adjustment evidence | Does not change opening balance calculation rules | Each mutation has before/after and balancing audit row |
| Voucher Template Engine | Bulk voucher data packaging for web-to-print and PDF review | Does not change allocation amounts or formulas | Voucher payload matches approved allocation values |
| Amortization Shift Engine | Handles early settlement and multi-month deferment schedules | Does not change EMI formulas; only shifts approved future schedule states | Schedule preview, exception audit, final variance confirmation |
| Year-End Closing Engine | Compiles closing loan balance, unused airfare amount, and eligible days | Uses current formulas and preference-resolved rates only | Closing preview equals ledger-derived totals |
| Cross-Year Shifting Matrix | Lets users toggle company/year states safely | Historical closed years are read-only unless formal adjustment flow is used | No current-year mutation from historical view |

## 1. Employee Import: Data Mapping Validation Engine

### Functional Requirements

| Requirement | Logic Specification |
| --- | --- |
| Staging memory matrix | Uploaded CSV/XLSX rows must load into a temporary matrix before database commit |
| Header mapping | Source columns must map to Atlas employee fields through a visible mapping layer |
| Data type validation | Dates, text, numeric fields, identifiers, and status fields must be checked before commit |
| Duplicate detection | Detect duplicates inside file and against existing company-scoped employee IDs |
| Inline correction | User may edit staged row values directly in the selection grid |
| Inline delete | User may remove staged rows from the commit set before database write |
| Revalidation | Edited rows must re-enter validation immediately |
| Commit scope | Only valid, selected, company-scoped rows may commit |

### Validation Matrix

| Validation | Pass Criteria | Fail Action |
| --- | --- | --- |
| Employee ID uniqueness | Unique within selected company and file | Flag duplicate row |
| Company scope | Row belongs to active company or is blank and inheritable | Block row |
| Required fields | Employee ID, name, joining date, status present | Mark row invalid |
| Data type match | Each mapped column matches target field type | Flag mapping mismatch |
| Date normalization | Date can be parsed into approved system format | Mark invalid |
| Status policy | Employee status exists in allowed status list | Mark invalid |
| Commit readiness | Row has no blocking errors | Allow selection for commit |

### Workflow Tree

```text
Employee Import
  Select company
  Upload file
  Detect file type
  Build staging matrix
  Map fields
  Validate data types
  Detect duplicates
  Show selection grid
    Edit row
      Revalidate row
    Delete row
      Remove from commit set
    Export errors
      Produce row-level correction report
  Commit valid selected rows
  Write import audit batch
```

## 2. Opening Balance Management: Double-Entry Ledger Audit Trail

### Functional Requirements

| Requirement | Logic Specification |
| --- | --- |
| Import trace | Every imported opening balance row receives batch, source, and user identity |
| Manual correction trace | Every edit creates adjustment evidence rather than silent overwrite |
| Double-entry audit | Each balance movement must have an offset/reconciliation entry |
| Legacy balance tracking | Imported balances retain legacy source reference |
| Soft-delete | Deleting an opening row creates reversal audit, not physical removal |
| Fiscal-year lock | Closed fiscal year balances are read-only unless authorized adjustment flow is used |

### Audit Trail Matrix

| Event | Required Audit Data |
| --- | --- |
| Initial import | Batch ID, source file, company, year, employee, value, user, timestamp |
| Manual edit | Original value, new value, reason, adjustment type, user |
| Soft delete | Deleted row reference, reversal value, reason, approval |
| Rollover creation | Source year, target year, closing value, opening value |
| Correction approval | Requester, approver, approval timestamp |

### Workflow Tree

```text
Opening Balance
  Select company and fiscal year
  Upload or manual entry
  Validate employee and fiscal year
  Preview opening balance ledger
  Commit opening balance
    Create primary balance row
    Create double-entry audit row
  Edit or delete
    Require reason
    Create adjustment or reversal audit
    Preserve original row lineage
```

## 3. Airfare Allocation: Bulk Voucher Template Engine

### Functional Requirements

| Requirement | Logic Specification |
| --- | --- |
| Template definition | Admin-defined voucher fields and section order |
| Bulk voucher queue | Multiple approved allocations can be selected for voucher generation |
| Company branding | Voucher pulls company logo/name from active company assets |
| Snapshot payload | Voucher uses captured allocation values and applied preference rate |
| Web-to-print layout | Output must support printable browser layout and PDF conversion |
| Historical stability | Reprinting older vouchers must not recalculate financial values |

### Voucher Data Payload Matrix

| Section | Required Data |
| --- | --- |
| Company header | Company name, logo, address, fiscal year |
| Employee block | Employee ID, name, department, designation |
| Allocation block | Allocation number, route, travel date, document status |
| Calculation block | Applied airfare rate, eligible days, entitlement, ticket amount |
| Financial block | Company paid amount, loan/excess amount, balance |
| Audit block | Prepared by, approved by, print timestamp |
| Template metadata | Template version, language, layout mode |

### Workflow Tree

```text
Voucher Template Engine
  Select company and fiscal year
  Filter approved allocations
  Select voucher template
  Build voucher payloads
  Validate required fields
  Preview print layout
  Generate web-to-print or PDF output
  Store print audit reference
```

## 4. Loan Management and EMI Run: Amortization Shift Engine

### Functional Requirements

| Requirement | Logic Specification |
| --- | --- |
| Early settlement preview | Calculate remaining balance using existing loan formulas and settlement preferences |
| Multi-month deferment | Shift unpaid EMI schedule rows forward without altering posted historical rows |
| Holiday skip | Allow approved skip months based on company policy |
| Schedule integrity | EMI sequence must remain chronological and non-overlapping |
| Exception audit | Settlement and deferment actions must write approval and reason |
| Ledger protection | No loan schedule change may silently mutate posted ledger rows |

### EMI Run Verification Sequence

```text
Step 1: Selection and Filtering
  Select company
  Select EMI month
  Select employee filters
  Load active eligible loans
  Exclude settled, cancelled, already-posted, or held loans
  Show initial total

Step 2: Exception Application
  Apply pending early settlements
  Apply approved deferments
  Apply holiday skip rules
  Recalculate adjusted total
  Show exception list and changed rows

Step 3: Multi-User Confirmation Modal
  Display original EMI total
  Display settlement total
  Display deferred total
  Display excluded count
  Display final posting total
  Require authorized confirmation
  Commit ledger batch atomically
```

### Test Matrix

| Test | Pass Criteria |
| --- | --- |
| Settlement before batch | Settlement replaces normal EMI in batch preview |
| Deferment before batch | Deferred EMI is shifted and not posted in skipped month |
| Posted EMI protection | Posted rows are read-only |
| Duplicate batch | Same company/month cannot post twice |
| Variance display | Confirmation modal shows original vs adjusted totals |
| Audit | Settlement, deferment, and batch confirmation are traceable |

## 5. Year-End Close: Closing Engine Calculation Logic

### Closing Calculation Rules

| Closing Element | Calculation Rule |
| --- | --- |
| Remaining loan balance | Opening loan balance plus loans created minus EMI posted minus settlements and approved reversals |
| Closing unused airfare amount | Opening airfare entitlement plus current-year entitlement minus approved allocations and company-paid amounts |
| Accrued eligible travel days | Policy-derived eligible days minus consumed, expired, or non-carry-forward days |
| Rollover loan opening | Remaining loan balance becomes next-year opening loan balance |
| Rollover airfare opening | Carry-forward airfare amount follows company preference policy |
| Rollover eligible days | Carry-forward days follow company preference policy |
| Historical snapshot | Closed-year company, employee, allocation, loan, and balance states become frozen snapshot data |

> Systemic Guardrail: Year-end close must not derive airfare values from fixed rates. Any entitlement recalculation must resolve the applicable rate from preferences using company, fiscal year, and effective-date context.

### Year-End Close Workflow Tree

```text
Year-End Close
  Select company
  Select fiscal year to close
  Validate company-year status
  Check unresolved exceptions
    Pending allocations
    Unposted EMI batches
    Pending settlements
    Unapproved balance adjustments
  Calculate closing preview
    Remaining loan balance
    Closing unused airfare
    Remaining eligible days
  Generate employee-level close matrix
  Require finance/admin approval
  Freeze historical snapshot
  Create next-year opening ledger
  Mark closed year read-only
  Enable current-year active state
```

### Year-End Verification Matrix

| Test Case | Input | Expected Result |
| --- | --- | --- |
| Clean close | No pending exceptions | Year closes and next-year opening created |
| Pending allocation | Draft/unapproved allocation exists | Close blocked with exception list |
| Pending EMI | EMI batch not posted | Close blocked or requires override policy |
| Remaining loan balance | Active loans with posted EMI | Closing balance equals ledger-derived value |
| Unused airfare | Entitlement less allocations | Closing amount matches allocation ledger |
| Eligible days | Employee service and policy days | Remaining days calculated per policy |
| Rollover | Approved close | Next-year opening rows created with source lineage |
| Historical lock | Closed year selected | Read-only state enforced |

## 6. Company-Wise and Year-Wise Selection Grid

### Matrix Architecture

| Dimension | Required State Rule |
| --- | --- |
| Company | Active company controls visible employees, balances, allocations, loans, logos, names, preferences |
| Fiscal Year | Active year controls editability and historical view mode |
| Year Status | Open years allow operations; closed years allow read-only historical views |
| Session State | User session stores active company and year explicitly |
| Asset Scope | Logo, name, and theme reload on company switch |
| Schema/Partition Scope | All data access must be constrained by company and year |

### Cross-Year Shifting Workflow Tree

```text
Company-Year Matrix
  User selects company
  System loads company assets and allowed years
  User selects year
    If year is current/open
      Load active operational schema
      Enable permitted actions
    If year is historical/closed
      Load frozen historical snapshot
      Disable mutation controls
      Enable reports and print replays
  User switches backward or forward
    Clear previous company-year state
    Reload scoped records
    Verify no stale filters or cached values remain
```

### Partition Boundary Matrix

| Scenario | Required Boundary |
| --- | --- |
| Company X + Year 2025 | Load only Company X, 2025 historical records |
| Company X + Current Year | Load only Company X active records and current preferences |
| Company Y + Year 2025 | Company X records are inaccessible |
| Historical year print | Uses historical snapshot, not current employee/preference edits |
| Current year allocation | Uses current preference lookup, not historical rate |
| Session switch | Clears stale company/year filters and cached assets |

### Cross-Year Test Matrix

| Test | Pass Criteria |
| --- | --- |
| Toggle current to last year | View changes to read-only historical data |
| Toggle last year to current | Active controls return without historical mutation |
| Switch company in historical year | New company historical scope loads independently |
| Attempt edit in closed year | Mutation blocked |
| Print old voucher | Uses frozen snapshot data |
| Preference change in current year | Does not alter closed-year snapshots |
| Company logo change | Does not alter historical voucher snapshot unless policy allows rebranding |

## Final Evaluation Prompt Template

### Prompt Objective

Evaluate Atlas AirFare System for enterprise readiness by validating open-source-inspired workflow maturity, zero-hardcoded preference compliance, strict multi-company isolation, and year-end financial transition safety.

### Required Evaluation Sections

| Section | Required Output |
| --- | --- |
| Feature Benchmark Matrix | Compare Atlas against Frappe HR/ERPNext and Odoo Community patterns |
| New Feature Requirements | Define additive features only; no formula replacement |
| Year-End Close Logic | Employee-level close calculations and rollover mapping |
| Cross-Year Matrix | Company/year state rules, read-only historical boundaries |
| Testing Definitions | Inputs, actions, expected results, pass/fail criteria |
| Guardrail Compliance | Preference runtime lookup and multi-company isolation proof |

### Final Acceptance Checklist

| Gate | Required Result |
| --- | --- |
| No formulas changed | Confirmed |
| No hardcoded airfare rate | Confirmed by runtime preference validation |
| Company/year isolation | Confirmed by matrix tests |
| Year-end rollover | Confirmed by close preview and next-year opening ledger |
| Historical read-only state | Confirmed |
| Loan settlement/deferment | Confirmed through EMI exception batch |
| Voucher output | Confirmed through payload and print preview tests |
| Auditability | Confirmed for imports, balances, allocations, loans, and close |

