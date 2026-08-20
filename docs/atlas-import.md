# ATLAS reference-data import

`scripts/import_from_atlas.py` copies reference records from the live
`Atlasairfare010` database into `HCM_Airfare_Management`. The source connection uses
SQL Server `ApplicationIntent=ReadOnly`; the script never updates ATLAS. Target IDs
are deterministic UUIDv5 values based on the ATLAS table and integer ID, so a rerun
updates the same rows instead of duplicating them. All six target groups are committed
in one transaction.

## Mapping

- `Employees` → `employees`: code, name, join date, department, branch, pay group,
  location, email, active state, current rate, maximum payout, and audit timestamps.
- `OpeningBalances` → `opening_balances`: employee, year, opening days, BHD amount,
  and the employee maximum payout.
- `AirfarePolicyRates` → `entitlement_rates`: employee, pay-group, department,
  company, or global scope; effective dates; payout amount; deletion state.
- `Allocations` → `tickets`: employee, allocation date, ticket/entitlement/company
  amounts, excess fields, settlement mode, policy snapshot, status, and remarks.
- `Loans` → `loans`: employee/allocation links, original and remaining principal,
  EMI, tenure, deferment, dates, and status.
- `UserPreferences` → `preferences`: each legacy JSON document is retained as one
  `atlas.user_preferences` value under the synthetic user scope `atlas:<UserID>`.

ATLAS fields without a faithful HCM equivalent are intentionally omitted: employee
identity/payroll fields (CPR, passport, salary and allowances), monthly day buckets,
opening-balance archive pointers, policy lock/dependency metadata, allocation leave
dates and creator integer IDs, and loan months-paid/total-paid history. ATLAS does not
store allocation route columns in the inspected schema, so imported tickets use the
explicit legacy route marker `BHR → LTA`. Opening-balance `paid_days` is set to zero
because ATLAS stores paid days on the employee rather than per balance year. The raw
ATLAS policy cycle remains documented but is not substituted for HCM's mandated
365-day allocation engine.

## Applied engineering guidance

- FastAPI query bounds and offset/limit patterns:
  <https://fastapi.tiangolo.com/tutorial/sql-databases/>
- Accessible sortable tables use focusable controls and update `aria-sort`:
  <https://www.w3.org/WAI/ARIA/apg/patterns/table/examples/sortable-table/>
- SQL Server exact numeric types are retained as Python `Decimal`; UUIDv5 gives
  repeatable `uniqueidentifier`-compatible keys:
  <https://learn.microsoft.com/sql/t-sql/data-types/decimal-and-numeric-transact-sql>
  and <https://learn.microsoft.com/sql/t-sql/data-types/uniqueidentifier-transact-sql>
- Employee self-service emphasizes clear status, balance visibility, in-flow
  validation, and task-oriented actions:
  <https://www.pluxee.in/blog/7-features-in-lta-benefit-for-enterprise-hr-teams/>

