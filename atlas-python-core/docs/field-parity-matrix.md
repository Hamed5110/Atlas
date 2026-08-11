# ATLAS Python Core Field Parity Matrix

This is a greenfield comparison record. The old system is used only to extract domain requirements, not implementation.

## Employee master

| Domain need | Old-system signal | New core field/API | Status |
|---|---|---|---|
| Employee identity | `EmployeeCode`, employee grids, imports | `core.Employees.EmployeeNumber`, `/api/employees` | Implemented |
| Display/legal name | employee display rows | `DisplayName`, `LegalName` | Implemented |
| Company/tenant scope | multi-company UI and database split failures | `TenantID`, `CompanyID` on every business table | Implemented |
| Hire/termination dates | year/opening logic depended on employee dates | `HireDate`, `TerminationDate` | Implemented |
| Department/job/pay group | policy-rate matrix and employee group import | `Department`, `JobTitle`, `PayGroup`, `EmploymentType` | Implemented |
| CPR/passport/nationality | employee master payroll identity | `CPRNumber`, `PassportNumber`, `Nationality` | Implemented |
| Contact | employee master / self-service | `WorkEmail`, `PhoneNumber` | Implemented |
| Bank/payroll metadata | payroll-adjacent master record | `BankName`, `IBAN`, `BasicSalary` | Implemented |
| Airfare eligibility | allocation and entitlement guard | `EligibleForAirfare`, `HomeAirportCode`, `DestinationAirportCode` | Implemented |

## Master import

| Domain need | New core behavior |
|---|---|
| Preview before write | `/api/import-preview` validates rows and isolates failures |
| Excel execution | `/api/import-excel/preview`, `/api/import-excel/execute` parse `.xlsx` |
| Required-field validation | `employeeNumber`, `displayName`, `hireDate` required |
| Travel/payroll field import | CPR, passport, pay group, airports, salary, eligibility mapped |

## Airfare allocation

| Domain need | New core field/API | Status |
|---|---|---|
| Ticket transaction | `/api/allocations` | Implemented |
| Origin/destination | `OriginAirportCode`, `DestinationAirportCode` | Implemented |
| Travel date | `TravelDate` | Implemented |
| Airline/ticket reference | `AirlineName`, `TicketNumber` | Implemented |
| Payment mode | `PaymentMode` = entitlement/loan/employee/company/mixed | Implemented |
| Entitlement consumption | allocation writes a `usage` entitlement event in same transaction | Implemented |

## Loans / EMI

| Domain need | New core field/API | Status |
|---|---|---|
| Loan creation | `/api/loans` | Implemented |
| EMI | `EmiAmount` | Implemented |
| Tenure | `TenureMonths` | Implemented |
| Outstanding balance | `OutstandingAmount` | Implemented |
| Loan type and notes | `LoanType`, `Notes` | Implemented |

## Reports

| Report | API | Status |
|---|---|---|
| Airfare payable as-of date | `/api/reports/airfare-payable?asOfDate=YYYY-MM-DD` | Implemented |
| Employee summary | `/api/reports/employees` | Implemented |
| Export employees/allocations/loans | `/api/export?module=...` | Implemented |

## Removed legacy risk

| Legacy risk | New stance |
|---|---|
| Year End reset / annual close batch | Not present in Python core schema, routes, UI, or diagnostics |
| One giant mixed screen | Replaced with separate routes for command, employees, import, airfare, loans, reports, admin, support |
| Blind import execution | Preview and validation first |
| Allocation-only balance mutation | Allocation writes usage event transactionally |
