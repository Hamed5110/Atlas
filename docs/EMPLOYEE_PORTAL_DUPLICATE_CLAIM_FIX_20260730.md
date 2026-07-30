# 2026-07-30 Employee Portal Duplicate Claim Fix

## Failure

The Employee Self-Service / portal mapping flow could fail with:

`Violation of UNIQUE KEY constraint 'UQ_ext_employee_auth_claims_UserEmployeeType'. Cannot insert duplicate key in object 'dbo.ext_employee_auth_claims'. The duplicate key value is (1, 1, employee_portal).`

## Cause

The backend used a race-prone pattern:

1. check `IF NOT EXISTS`;
2. then insert into `dbo.ext_employee_auth_claims`.

Two fast or repeated requests could both pass the check before either insert committed. The second insert then hit SQL Server duplicate-key error `2627`.

## Fix

- Added `dbo.ext_sp_UpsertEmployeeAuthClaim` in `extensions/employee-portal/sql/ATLAS_Employee_Portal_Extension.sql`.
- The procedure validates required inputs, uses `TRY...CATCH`, and applies a locked UPSERT:
  - `UPDATE ... WITH (UPDLOCK, HOLDLOCK)`;
  - `IF @@ROWCOUNT = 0 INSERT ...`.
- Replaced backend raw claim inserts with `execute('dbo.ext_sp_UpsertEmployeeAuthClaim')`.
- Added SQL duplicate-key classification for SQL Server error numbers:
  - `2601`
  - `2627`
  - extension error `51036`
- A duplicate-key failure is now mapped to HTTP `409 Conflict` with code `DUPLICATE_KEY` instead of leaking as HTTP `500`.

## Verification

- `npm run check`
- `npm run test:company-admin`
- `npm --prefix C:\Airfare_Allowance\atlas-hcm-next test`
- Confirmed procedure exists in MSSQL:
  - `OBJECT_ID(N'dbo.ext_sp_UpsertEmployeeAuthClaim', N'P')`
- Concurrent self-service stress check:
  - 20 simultaneous `GET /api/employee-self-service/summary`
  - 20 returned HTTP `200`
  - 0 duplicate-key failures

## Follow-up audit standard

For future INSERT/UPDATE/MERGE work:

- use stored procedures for database-owned business upserts;
- add `TRY...CATCH`;
- classify SQL error numbers in the API layer;
- use source tests to block raw `IF NOT EXISTS → INSERT` patterns on unique-key tables;
- prefer idempotent request design for UI double-click and retry-prone screens.
