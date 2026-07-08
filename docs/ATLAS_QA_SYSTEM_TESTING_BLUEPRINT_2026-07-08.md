# ATLAS QA System Testing Blueprint

## Scope

| Area | Required Coverage |
| --- | --- |
| Employee Import with Selection Screen | File ingestion, staging grid, inline edit, delete, commit |
| Opening Balance Management | Bulk import, manual adjustment, soft delete, audit trace |
| Airfare Allocation with Print Functions | Preference-driven allocation, record audit, PDF/HTML voucher payload |
| Loan Management | Edit, settlement, deferment, delete, EMI run |
| Year-End Process | Closing calculations, rollover, cross-year view shifting |
| Multi-Company Login, Logout, Theming | Company isolation, session clearing, asset switching |
| Preferences Setting | Dynamic airfare rate lookup and immediate allocation impact |

## Mandatory Compliance Gates

| Gate | Pass Criteria | Failure Condition |
| --- | --- | --- |
| Dynamic airfare rate | Every pending allocation resolves `Airfare rate` from preferences at runtime | Any fixed or hardcoded rate controls calculation |
| Multi-company isolation | Company logos, names, sessions, records, and schemas remain isolated | Cross-company data, branding, or session leakage |
| Auditability | Financial edits, deletes, reversals, imports, and approvals create audit traces | Silent mutation of financial records |
| Fiscal-year safety | Closed-year data is frozen except controlled adjustment workflow | Current-year action mutates historical records |
| Batch integrity | Batch EMI and imports commit atomically | Partial posting without recovery evidence |

## Open-Source Gap Analysis Matrix

| Module | ERPNext / Frappe HR Pattern | Odoo Community Pattern | Atlas Current Target | High-Value Gap to Add |
| --- | --- | --- | --- | --- |
| Employee Import | Template-driven Data Import for Employee records | CSV/XLSX import wizard on business objects | Staging matrix with validation before commit | Template download, dry-run mode, downloadable row error file |
| Opening Balance | Opening balances tied to accounting initialization and reconciliation | Accounting opening balances and fiscal close workflows | Employee entitlement and loan opening balances | Temporary balancing/reconciliation control and immutable audit explorer |
| Airfare Allocation | Generic HR/payroll and accounting documents | Payroll/accounting customization and report templates | Airfare-specific allowance allocation and voucher output | Rule simulation, effective-date preview, versioned print templates |
| Loan Management | Requires customization for specialized loan amortization | Requires customization for payroll loan lifecycle | Native settlement, deferment, EMI batch engine | Variance dashboard and amortization preview before posting |
| Year-End | Accounting close and opening balance transfer concepts | Fiscal-year close, reconciliation, live reporting | Airfare/loan/year-state rollover | Close checklist with blocking exceptions and historical snapshot comparison |
| Multi-Company | Company dimension and permissions | Active company selector and record rules | Isolated company assets, session states, and schema boundaries | Visual company identity banner and permission simulation |
| Preferences | System/global defaults | Settings and company properties | Runtime preferences table for airfare rate | Effective-date rate history, approval workflow, rollback |

## 1. Employee Import with Selection Screen

### Workflow

```text
Select company
Upload CSV/XLSX
Parse file into staging matrix
Normalize headers
Validate rows
Display selection grid
Allow inline edit/delete
Revalidate changed rows
Commit valid rows
Write import batch audit
```

### Test Checksheet

| Test Case | Input | Action | Expected Result |
| --- | --- | --- | --- |
| Valid import | Clean employee file | Upload and validate | All rows valid and commit-ready |
| Duplicate in file | Same employee ID appears twice | Upload | Duplicate rows flagged |
| Duplicate in database | Existing employee ID | Upload | Row marked update candidate or blocked by mode |
| Invalid format | Bad date, invalid email, bad status | Upload | Row invalid with field-level error |
| Inline correction | Invalid staged row | Edit grid cell | Row revalidates without reupload |
| Delete before commit | Valid staged row | Delete in grid | Row removed from commit set |
| Bulk commit | Valid and invalid rows | Commit valid only | Valid rows saved, invalid rows remain staged |
| Company boundary | Other-company employee in file | Upload under active company | Row blocked from commit |

## 2. Opening Balance Management

### Workflow

```text
Select company and fiscal year
Choose upload or manual entry
Stage opening balances
Validate employee, fiscal year, and duplicates
Preview financial impact
Commit balances
Allow corrections only through audited adjustment
Soft-delete only with reversal trace
```

### Test Checksheet

| Test Case | Input | Action | Expected Result |
| --- | --- | --- | --- |
| Bulk valid balances | Employee/year balances | Upload | Valid rows commit |
| Duplicate employee/year | Same employee opening twice | Validate | Duplicate blocked |
| Unknown employee | Missing employee master | Validate | Row invalid |
| Manual correction | Existing balance | Edit with reason | Adjustment row and audit created |
| Soft delete | Existing balance row | Delete with reason | Row inactive, reversal audit exists |
| Closed year edit | Closed fiscal year | Attempt edit | Blocked without adjustment privilege |
| Cross-company isolation | Company A user | Access Company B balance | Access denied |

## 3. Airfare Allocation with Print Functions

### Workflow

```text
Select company
Select employee and year
Resolve current employee eligibility
Resolve airfare rate from preferences table at runtime
Calculate entitlement and used balance
Calculate company-paid and excess/loan amount
Preview allocation
Commit allocation
Generate voucher payload
```

### Dynamic Rate Tests

| Scenario | Expected Result |
| --- | --- |
| Active company/year rate exists | Allocation calculates using current preference |
| Rate missing | Allocation is blocked with configuration error |
| Rate changed before approval | Pending allocation recalculates from new preference |
| Historical approved allocation | Captured applied rate remains unchanged |
| Different company rates | Each company uses its own preference value |

### Voucher Payload Requirements

| Section | Required Data |
| --- | --- |
| Company | Name, logo, address, active company |
| Employee | Employee ID, name, department, designation |
| Allocation | Document number, year, route, travel date |
| Calculation | Applied preference rate, eligible days, entitlement, ticket amount |
| Financial Summary | Company paid, loan/excess amount, remaining balance |
| Audit | Prepared by, approved by, timestamp |
| Print Metadata | Template version, print date, document status |

## 4. Loan Management

### Lifecycle Workflow

```text
Create loan
Generate amortization schedule
Allow edit before posted EMI
Require adjustment after posted EMI
Support settlement
Support deferment
Run monthly EMI batch
Post ledger entries
Update balance
Close or settle loan
```

### EMI Batch Verification Sequence

```text
Step 1: Selection and filtering
  Filter active eligible loans by company, month, employee, and status.

Step 2: Exception application
  Apply settlements, deferments, manual holds, and exclusions.

Step 3: Multi-user confirmation
  Show original total, adjusted total, settlement total, deferred total, excluded count, and variance before final ledger commit.
```

### Test Checksheet

| Test Case | Condition | Expected Result |
| --- | --- | --- |
| Edit unposted loan | No EMI posted | Principal/tenure editable |
| Edit posted loan | Historical EMI exists | Historical rows locked, future rows adjusted |
| Early settlement | Active loan | Settlement preview and ledger close |
| Multi-month deferment | Future EMI rows | Schedule shifts forward sequentially |
| Delete draft loan | No ledger impact | Soft delete allowed |
| Delete active loan | Ledger exists | Reversal approval required |
| Batch duplicate | Same company/month posted twice | Second posting blocked |

## 5. Year-End Process and Cross-Year Shifting

### Workflow

```text
Select company and fiscal year
Validate unresolved allocations, loans, and EMI batches
Calculate closing airfare values
Calculate remaining loan balances
Calculate remaining eligible days
Preview rollover
Approve close
Freeze historical snapshot
Create next-year opening balances
Enable historical/current year selector
```

### Test Checksheet

| Test Case | Expected Result |
| --- | --- |
| Loan rollover | Closing loan balance equals opening plus loans minus EMI and settlements |
| Airfare closing | Closing value equals opening plus entitlement minus used allocation |
| Eligible days | Remaining days match policy |
| Current-to-last-year toggle | View changes without data mutation |
| Closed-year edit | Blocked for normal users |
| Company switch in history | Company A and B snapshots stay isolated |
| Historical print | Uses frozen snapshot values |

## 6. Multi-Company Login, Logout, and Theming

### Workflow

```text
Login
Resolve permitted companies
Select active company
Load company assets and preferences
Operate inside company scope
Switch company
Clear previous company state
Load new company state
Logout
Clear token, session, company, and cached assets
```

### Test Checksheet

| Test Case | Expected Result |
| --- | --- |
| Company A login | Company A logo, name, data, preferences load |
| Company switch | Company B assets and data replace Company A state |
| Logout | Session and active company state cleared |
| Browser back after logout | Protected screen inaccessible |
| Cross-company API attempt | Access denied or empty result |
| Theme isolation | Company-specific UI preferences apply correctly |

## 7. Preferences Setting with Dynamic Airfare Rate

### Workflow

```text
Admin opens preferences
Updates airfare rate for company/year/effective date
System validates preference
Preference becomes active
Pending allocations use new rate immediately
Approved allocations keep captured applied rate
Audit records old and new values
```

### Test Checksheet

| Test Case | Action | Expected Result |
| --- | --- | --- |
| Change active rate | Update preferences | Pending allocations use new rate |
| Missing rate | Remove active rate | Allocation blocked |
| Company-specific rate | Set different rates per company | Each company calculates separately |
| Effective date | Add future rate | Applies only within effective date rules |
| Historical allocation | Reopen approved allocation | Original applied rate remains |
| Audit | Change preference | Old value, new value, user, timestamp captured |

## Final Acceptance Matrix

| Gate | Required Result |
| --- | --- |
| Core backend checks | Passed |
| Frontend tests | Passed |
| Full system regression | Passed |
| Dynamic airfare preference tests | Passed |
| Multi-company isolation tests | Passed |
| Loan EMI batch tests | Passed |
| Year-end rollover tests | Passed |
| Print voucher tests | Passed |
| Audit trail tests | Passed |
| Security/logout tests | Passed |

