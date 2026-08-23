# Airfare Allocation Engine — Reverse-Engineered Source of Truth

Inspected on 2026-08-17 against the live process on `http://127.0.0.1:3355`.
Passwords, JWT secrets, and connection credentials are redacted.

## What listens on port 3355

Port 3355 is **not** the HCM Airfare codebase (`C:\HCM Airfare`, port 3389).
It is the ATLAS Airfare Allowance Node/Express + Next.js stack:

| Item | Value |
| --- | --- |
| Process | `node.exe server.js` (PID observed at inspection time) |
| Product | `ATLAS_AIRFARE_ALLOWANCE` 2.3.92 |
| Frontend title | ATLAS Airfare Intelligence (`atlas-hcm-next`) |
| Health | `GET /api/health` → `{ status: "healthy", database: "connected" }` |
| OpenAPI / FastAPI docs | Not present (`/openapi.json` 404). `/docs` serves the Next app. |
| Auth | JWT Bearer. Unauthenticated allocation/employee routes return 401 `Access token required`. |
| Database | MSSQL `Atlasairfare010` on `localhost:1433`, login `sa` (password redacted) |

HCM Airfare remains on **port 3389** and database **`HCM_Airfare_Management`**.
This inspection did not stop, reconfigure, or write to the 3355 process.

## 3355 allocation HTTP contract

Authenticated JSON API under `/api`:

| Method | Path | Role | Purpose |
| --- | --- | --- | --- |
| GET | `/api/health` | public | Product/version/feature flags |
| POST | `/api/auth/login` | public | `{ username, password }` → JWT |
| GET | `/api/allocations?year=` | any auth | Allocation register |
| GET | `/api/allocations/eligibility-review?employeeId=&date=&year=` | any auth | Preview entitlement for the allocation form |
| GET | `/api/allocations/:id` | any auth | Single allocation |
| POST | `/api/allocations` | admin/manager/hr | Issue allocation |
| PUT | `/api/allocations/:id` | admin/manager/hr | Update allocation |
| GET | `/api/opening-balances` | any auth | Opening days/BHD by year |
| GET | `/api/airfare-policy-rates` | admin/manager/hr | Policy rate table |
| GET/PUT | `/api/preferences` | any auth | User preference JSON |
| GET/POST | `/api/loans` | mixed | Loan register / create |

### Allocation screen form fields (Next.js)

`emptyAllocationForm` in `atlas-hcm-next/app/page.tsx`:

- `employeeId`, `date`, `year`, `ticketCost`
- `paymentMode`: `entitlement` \| `loan` \| `employee` \| `employee_full` \| `company` \| `company_full`
- `loanTenure` (default `"6"`), `decision`, `overrideReason`, `managerApproval`
- `leaveStart`, `leaveEnd`, `route`, `ticketNo`, `supplier`, `invoiceNo`, `remarks`

### POST `/api/allocations` payload (Joi)

```json
{
  "employeeId": 1,
  "date": "2026-08-17",
  "year": 2026,
  "ticketCost": 250.00,
  "paymentMode": "loan",
  "emi": 0,
  "tenure": 6,
  "decision": "process",
  "managerApproval": "approved",
  "leaveStart": null,
  "leaveEnd": null,
  "route": "",
  "ticketNo": "",
  "supplier": "",
  "invoiceNo": "",
  "remarks": ""
}
```

Eligibility review returns policy-capped `AirfareEntitlementAmount`, `PerDayRate`,
opening/current-year days and amounts, and year-to-date spending.

## 3355 MSSQL schema (live `Atlasairfare010`)

38 user tables. Allocation-relevant objects:

### `dbo.Employees` (Employee Master) — 129 rows

Key airfare columns: `JoinDate`, `EmpGroup` (pay group), `OpeningDays`, `OpeningBHD`,
`CurrentAirfareRate`, `AirfarePaidDays`, `RemainingBalance`, `MaximumPayout`,
`LastAllocationYear`, monthly `JanDays`–`DecDays`, `TotalWorkingDays`.

### `dbo.OpeningBalances` — 259 rows

`EmployeeID` FK → Employees, `BalanceYear`, `OpeningDays`, `OpeningBHD`, unique `(EmployeeID, BalanceYear)`.

### `dbo.AirfarePolicyRates` — 21 rows

Scoped policy: `CompanyID`, `EmployeeID`, `Department`, `EmpGroup`,
`EffectiveFrom`/`EffectiveTo`, `MaxPayoutAmount`, `CycleDays` (default 60),
`WorkingDaysPerMonth` (30), `AirfareDaysPerMonth` (2.5).

`sp_ATLAS_GetEffectiveAirfarePolicy` priority:
employee → emp group → department → company → global.
`PerDayRate = MaxPayoutAmount / CycleDays` (**not** `/ 365`).

### `dbo.Allocations` (ticket bookings/claims) — 6 rows

`TicketCost`, `Entitlement`, `CompanyPaid`, `ExcessAmount`, `PaymentMode`,
`LoanAmount`, `EmployeePaid`, `CompanyExtra`, `EMI`, `Tenure`,
policy snapshot columns, `Status` (`active`/`cancelled`).

### `dbo.Loans` — 6 rows

`OriginalAmount`, `RemainingBalance`, `EMI`, `Tenure`, `Status`
(`active`/`settled`/`deferred`), optional `AllocationID` FK.

### `dbo.UserPreferences` — 2 rows

Per-user JSON: `PreferencesJSON`, `ThemeSettingsJSON`, `LayoutSettingsJSON`.

## 3355 live algorithm (now also the HCM engine)

ATLAS uses the 30/360 working-day model. HCM Airfare on 3389 now uses the
same formulas so allocation results match port 3355:

- Working days: month serial `(month-1)*30 + day`, capped at 360.
- Accrual start: max(1 Jan, join date, last allocation date + 1).
- Airfare days = `workingDays / 30 * 2.5`.
- Cycle = 60 days. Payable = `min(MaxPayout, MaxPayout / 60 * RemainingDays)`.
- Remaining days = `min(60, OpeningDays + CurrentAirfareDays - PaidDays)`.
- Rate hierarchy: employee custom MaxPayout → pay group → global (default 150).
- Excess: LOAN / COMPANY_PAID (`company_full`) / SELF_PAID (`employee`).

## Intentional HCM deviations from 3355

| Topic | 3355 | HCM Airfare (this engine) | Why |
| --- | --- | --- | --- |
| Port / process | 3355 Node | 3389 FastAPI | Isolation; do not break ATLAS |
| Day count | 30/360 | **Same 30/360** | Learned from ATLAS git history |
| Daily rate | `MaxPayout / 60` | **Same** | Match live allocation screen |
| Rate hierarchy | Policy table scopes | Employee custom → pay group → global | Closest HCM mapping |
| Excess options | six payment modes | `LOAN`, `COMPANY_PAID`, `SELF_PAID` | Map to loan / company_full / employee |
| IDs | INT/BIGINT identity | UUID string PKs | Existing HCM Clean Architecture |

HCM persists results in `HCM_Airfare_Management` (from `.env` `AIRFARE_DATABASE_URL`).

## HCM implementation (port 3389)

Canonical engine: `airfare_management.domain.services`.

- Daily rate `MaxPayout / Decimal("60")` (ATLAS cycle).
- Working days 30/360 from max(1 Jan, DOJ, last ticket + 1).
- Remaining days `min(60, opening + current airfare days - paid)`.
- Payable `min(MaxPayout, MaxPayout/60 * remaining days)`.
- Excess: `LOAN`, `COMPANY_PAID` (full ticket), `SELF_PAID` (employee pays excess).

API:

- `POST /v1/allocations/preview`
- `POST /v1/allocations/issue`

Desktop: PySide6 **Airfare Allocation Engine** screen (auto-preview on employee /
as-of change via QThread). Web SPA remains an API client; primary native UI is PySide6.

## Explicit rejection of calendar `/365` mandates

Product requests that set `Daily_Rate = Resolved_Airfare_Rate / 365.0` and pure
calendar-day accrual are **rejected** for production. They disagree with:

1. Live ATLAS MSSQL (`sp_ATLAS_CalcPolicyEntitlement`, `fn_ATLAS_AirfareAmount`)
2. Verified 3355 entitlement amounts (e.g. employee samples on `Atlasairfare010`)
3. Existing HCM pytest suite (`tests/test_allocation_logic.py`)

Scenarios still label as previous ticket / new joiner / opening-balance accrual for
UI clarity; math stays ATLAS MaxPayout÷60 + 30/360.
