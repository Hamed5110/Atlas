# ATLAS Continuous Airfare Entitlement Blueprint

Date: 2026-08-01  
Scope: remove mandatory airfare Year End close from ATLAS HCM/payroll and replace it with continuous, MSSQL-backed entitlement plans.

## Executive truth

The current ATLAS Year End close is misaligned with modern HCM benefit/absence patterns. It behaves like a mini accounting close: preview, close, carry forward opening balances, lock the year, and generate snapshots. For an airfare allowance module, that is too brittle.

The correct target is not “no year concept.” The correct target is:

- no mandatory hard Year End close job;
- yes to policy terms, reset dates, carryover caps, payout rules, audit snapshots, and soft payroll-period locks;
- all balances computed from MSSQL plan rules plus transactions, with optional cached balance rows for speed;
- fiscal year becomes a reporting dimension, not a state machine that must be closed.

## Research summary

### Open-source HCM / leave systems

| Source | Pattern observed | ATLAS relevance |
|---|---|---|
| Frappe HRMS Leave Allocation: https://docs.frappe.io/hr/leave-allocation | Leave allocation is assigned to employee/date periods and can be managed per leave type. | Supports replacing global year close with employee/plan/date-bounded entitlement allocation. |
| Frappe HRMS issue 447: https://github.com/frappe/hrms/issues/447 | Users expect monthly earned leave to accrue automatically across an assignment period. | Airfare can accrue monthly or per service period without closing a year. |
| Frappe HRMS issue 1757: https://github.com/frappe/hrms/issues/1757 | Carry-forward and maximum allocation thresholds are tricky and must be rule-bound. | ATLAS must model carryover caps explicitly, not bake them into Year End snapshots. |
| Horilla issue 494: https://github.com/horilla/horilla-hr/issues/494 | Proposed entitlement policy includes monthly/yearly accrual, prorated earning, anniversary-based earning, and admin-controlled accrual periods. | This is almost exactly the target ATLAS airfare design. |
| Horilla leave type docs/blog: https://www.horilla.com/blogs/how-to-create-a-leave-type-in-horilla-hrms/ | Leave type can have carryforward and expiration settings. | ATLAS should define airfare plan carryover and expiry rules in SQL policy tables. |
| Jorani repo: https://github.com/jorani/jorani | Lightweight leave/overtime management with leave balance reporting. | Small-system proof that balance reporting can be separate from hard close workflow. |
| Jorani entitlement docs: https://jorani.org/page-leave-entitlements-for-an-employee.html | Entitlements can exist at contract or employee level; employee-level adjustments can be negative for special cases. | ATLAS needs employee overrides and adjustment transactions, not destructive balance resets. |
| IceHrm leave accrual/carry forward: https://icehrm.com/leave-accrual-and-carry-forward | Accrual and carry forward are configured on leave types; employees build entitlement over time. | Use plan rules; do not force manual annual rollover. |

### Vendor HCM / payroll absence patterns

| Source | Pattern observed | ATLAS relevance |
|---|---|---|
| Oracle HCM anniversary absence plan: https://docs.oracle.com/en/cloud/saas/human-resources/oapff/global-absence-plan-period-anniversary-event-date.html | Absence plans can use Anniversary year and formula-based anniversary event rules. | ATLAS should support calendar year, anniversary year, and contract-cycle terms. |
| Oracle EBS Absence Management: https://docs.oracle.com/cd/E18727_01/doc.121/e13508/T230581T230583.htm | Accrual plans maintain increasing balances and available accrued time. | Continuous balances are standard HCM behavior. |
| Oracle Fast Formula guide: https://ora-fusion-apps.custhelp.com/euf/assets/fusion/documents/Global_Absence_FastFormula_User_Guide%20_11July2014.pdf | Accrual formulas return accrual, ceiling, and carryOver values. | ATLAS should store rule parameters and compute accrual/carryover deterministically. |
| Dynamics 365 Leave and Absence Plans: https://learn.microsoft.com/en-us/dynamics365/human-resources/hr-leave-and-absence-plans | Plans accrue annually/monthly/semimonthly or as a grant on a specific date. | Airfare plans need `AccrualFrequency` and grant-date options. |
| Dynamics 365 Leave Types: https://learn.microsoft.com/en-us/dynamics365/human-resources/hr-leave-and-absence-types | Leave types are configured separately from requests and balances. | ATLAS should separate airfare plan setup from allocations/claims. |
| Workday time off balances example: https://hr.wisc.edu/hr-guides/for-employees/how-to-view-time-off-balances-in-workday/ | Available balances and YTD/carryover are shown as of report/effective dates; accrual happens per pay period. | Reporting period is a lens over continuous balance, not a hard close. |
| Workday Absence Management datasheet: https://www.workday.com/content/dam/web/en-us/documents/datasheets/workday-absence-management-datasheet-en-us.pdf | Balances are automatically calculated and shared with payroll. | ATLAS should publish computed balances to payroll rather than manually closing airfare years. |

### Home leave / airfare-related policy evidence

| Source | Pattern observed | ATLAS relevance |
|---|---|---|
| UN Annual and Special Leave policy: https://policy.un.org/en/annual-and-special-leave-1 | Home leave eligibility can be every 24 months, with exceptions. | Airfare/home leave often follows service-cycle eligibility, not fiscal year close. |
| U.S. Commerce Home Leave: https://www.commerce.gov/hr/practitioners/leave-policies/home-leave | Home leave accrues from qualifying service; interruptions may affect accrual. | ATLAS must support service-based accrual and eligibility pauses. |
| UAE annual leave public guidance: https://u.ae/en/information-and-services/jobs/employment-in-the-private-sector/types-of-leaves-and-entitlements-in-the-private-sector/annual-leave | Leave entitlement can accrue monthly before one year of service. | Regional HCM systems need pro-rated, service-based calculations. |
| AIRINC home leave allowances: https://airshare.air-inc.com/home-leave-allowances-why-nows-a-good-time-to-switch | Home leave allowance can be defined at the beginning of year as an allowance. | Lump-sum grant on configured date is valid, but still not a year-close job. |

## Red-team critique of current ATLAS Year End

### Unnecessary complexity

1. The final close button is unnecessary for airfare entitlement.
   - Airfare is an employee benefit, not a GL ledger close.
   - Reports need period boundaries; entitlements need rule boundaries.

2. Opening balances generated by close are a fragile cache.
   - If allocation history changes later, the opening balance drifts.
   - Corrections require special close reversal logic or manual edits.

3. Calendar-only close is too narrow.
   - Existing code enforces `YYYY-12-31`.
   - Real HCM policies include anniversary year, contract year, 24-month home-leave cycle, and fixed grant dates.

4. Hard locks block legitimate HR corrections.
   - HR often needs approved prior-period corrections.
   - The control should be role + audit + payroll period lock, not “year is dead.”

### Actually required controls

- Audit history of entitlement balance as of a date.
- Payroll-period lock for already-paid months.
- Policy versioning so old claims keep old rules.
- Reconciliation reports for “as of Dec 31” or any payroll cutoff.
- Approval and evidence for manual adjustments.

### Fragile areas in current code

Current ATLAS Year End dependencies include:

- `server.js`
  - `/api/year-end/preview/:year`
  - `/api/year-end/close`
  - `/api/year-end/history`
  - `assertCalendarYearEnd`
  - `assertYearEndCloseSequence`
  - `OpeningBalances` writes
  - `OpeningLoanBalances` writes
  - `YearEndHistory`
  - `YearEndEmployeeSnapshots`
- `atlas-hcm-next/app/page.tsx`
  - `ViewKey` includes `Year End`
  - `handleYearEndPreview`
  - `handleYearEndClose`
  - “Close year” destructive button
  - next-year opening balance actions

## Target architecture: continuous airfare entitlement

### Core model

Each employee is enrolled in an airfare entitlement plan. A plan defines:

- accrual rule:
  - `lump_sum`
  - `monthly`
  - `semi_monthly`
  - `per_pay_period`
  - `service_month`
  - `contract_cycle`
- reset rule:
  - `calendar_year`
  - `fiscal_year`
  - `employee_anniversary`
  - `contract_start`
  - `none`
- carryover rule:
  - no carryover
  - carryover capped by days or amount
  - carryover expires after N days/months
- payout rule:
  - no payout
  - fixed date
  - termination
  - eligibility loss
  - manual approved payout

### Balance model

Use transactions as truth; use balance rows as cache.

Truth table:

```text
EmployeeAirfareTransactions
  accrual, usage, payout, adjustment, carryover, forfeiture, reversal
```

Cached table:

```text
EmployeeAirfareBalances
  one row per EmployeeID + PlanID + AsOfDate bucket/current balance
```

Do not let cached balance become the legal truth. It can be rebuilt from transactions.

### Fiscal year handling

Fiscal year is stored on transactions for reporting:

```text
TransactionDate
FiscalYear
PeriodCode
CompanyID
EmployeeID
PlanID
```

There is no requirement to close 2026 before employees accrue/use 2027.

### Controls

- Replace “Close Year” with:
  - “Reconcile as of date”
  - “Lock payroll period”
  - “Generate employee statement”
  - “Run policy reset preview”
  - “Apply scheduled reset/accrual”
- Manual prior-period changes require:
  - privileged role
  - reason
  - audit log
  - reversal transaction if already paid

## Target UI

Remove the Year End module from daily navigation.

Add:

1. Airfare Entitlements
   - Plans
   - Employee enrollments
   - Current balances
   - Upcoming resets/payouts

2. Reconciliation
   - As-of date
   - Company
   - Exceptions
   - Export evidence

3. Period Locks
   - Payroll periods
   - Lock/unlock with reason
   - Impacted employee count

4. Legacy Year End History
   - read-only archive
   - old snapshots for audit only

## API design

```http
GET /api/airfare-entitlement/plans
POST /api/airfare-entitlement/plans
PUT /api/airfare-entitlement/plans/:planId

GET /api/airfare-entitlement/enrollments?employeeId=&companyId=&asOfDate=
POST /api/airfare-entitlement/enrollments

GET /api/airfare-entitlement/balances?companyId=&employeeId=&asOfDate=
GET /api/airfare-entitlement/transactions?companyId=&employeeId=&from=&to=

POST /api/airfare-entitlement/accruals/preview
POST /api/airfare-entitlement/accruals/apply

POST /api/airfare-entitlement/resets/preview
POST /api/airfare-entitlement/resets/apply

POST /api/airfare-entitlement/payouts/preview
POST /api/airfare-entitlement/payouts/apply

GET /api/airfare-entitlement/reconciliation?companyId=&asOfDate=

GET /api/payroll-period-locks
POST /api/payroll-period-locks
POST /api/payroll-period-locks/:periodId/unlock
```

Example balance response:

```json
{
  "employeeId": 101,
  "planId": 3,
  "asOfDate": "2026-08-01",
  "planName": "Annual Airfare - Calendar Year",
  "termStart": "2026-01-01",
  "termEnd": "2026-12-31",
  "accruedAmount": 150.00,
  "usedAmount": 60.00,
  "payoutAmount": 0.00,
  "adjustmentAmount": 0.00,
  "forfeitedAmount": 0.00,
  "remainingAmount": 90.00,
  "nextResetDate": "2027-01-01",
  "source": "transactions"
}
```

## Migration plan

### Phase 1: parallel continuous model

- Add new tables/procedures.
- Seed default airfare plan from current `AirfarePolicyRates`.
- Generate initial transactions from:
  - `OpeningBalances`
  - `Allocations`
  - `YearEndEmployeeSnapshots`
- Run continuous balance reports beside existing Year End preview.
- Do not remove Year End UI yet.

### Phase 2: switch reports/calculations

- Update allocation eligibility to use continuous balance as of allocation date.
- Update dashboard/report totals to use transaction-derived balances.
- Keep `YearEndHistory` read-only.

### Phase 3: disable Year End close

- Hide/remove “Close year” button.
- Keep `/api/year-end/history` read-only.
- Return `410 Gone` or feature-disabled response from `/api/year-end/close`, unless compatibility mode enabled.
- Rename UI to “Legacy Year End Archive.”

### Phase 4: retire legacy objects safely

- Keep old tables for audit for at least one retention cycle.
- Remove write paths only after auditors/payroll users sign off.
- Do not drop `YearEndHistory` or snapshots until retention policy allows.

## Risks and mitigations

| Risk | Why it matters | Mitigation |
|---|---|---|
| Historical policy drift | A policy change can recalculate old entitlement incorrectly. | Effective-dated plans and store policy snapshot on every transaction. |
| Balance performance | On-the-fly calculation can be slow for many employees. | Transaction truth + rebuildable current balance cache. |
| Payroll audit requires period closure | Payroll needs stable paid-period records. | Soft payroll period locks, not airfare year close. |
| Carryover ambiguity | Carryover cap/expiry rules are easy to misunderstand. | Explicit carryover transactions with source period and expiry date. |
| Retroactive corrections | HR corrections can affect paid periods. | Adjustment/reversal transactions, approval workflow, audit logs. |
| Employee communication | “No Year End” may sound like “no reset.” | UI shows next reset date, carryover cap, expiry, and payout schedule. |

## What not to build

- Do not build another annual close under a new name.
- Do not store business configuration in JSON files.
- Do not use localStorage for entitlement rules.
- Do not delete Year End history immediately.
- Do not recompute historical balances from today’s policy.
- Do not mix loan carry-forward with airfare entitlement. Loans are debt ledgers; airfare entitlement is benefit accrual.

## Implementation acceptance criteria

- New allocations use continuous balance as of `AllocationDate`.
- Reports can run for any date range without requiring a closed year.
- `YearEndHistory` is read-only archive.
- Payroll period locks prevent unauthorized prior-period mutation.
- Every manual adjustment creates an auditable transaction.
- Current balance can be rebuilt from transactions and matches cached balance.
- `/api/version.databaseSchemaVersion` is bumped when the new model ships.
