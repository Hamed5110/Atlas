# ATLAS Loan EMI Return / Reversal Artifact

Date: 2026-06-28

## Request

If a monthly EMI process is done wrongly, provide a return or revised option after loan selection.

## Implemented Logic

ATLAS now supports a controlled EMI return workflow:

1. User selects one or more loan rows.
2. User previews the EMI return.
3. System checks each selected loan's latest loan history row.
4. Only loans whose latest history row is `emi` are allowed for return.
5. Return process restores:
   - `RemainingBalance = RemainingBalance + returned EMI`
   - `TotalPaid = TotalPaid - returned EMI`
   - `MonthsPaid = MonthsPaid - 1`
   - `Status = active`
   - `SettledDate = NULL`
6. System writes a new `LoanHistory` row with `PaymentType = reversal`.
7. System writes audit action `LOAN_EMI_REVERSAL`.

## Safety Rules

- Does not delete the original EMI history.
- Does not change EMI formula.
- Does not change loan creation, restructure, defer, settlement, or report formulas.
- Does not reverse older EMI rows when a newer action exists.
- Protects later restructure/defer/settle actions because only the latest `emi` history row can be returned.

## UI

Added to Loans screen:

- `Preview return EMI`
- `Process return`
- `Return EMI preview` panel
- Per-loan ready/blocked status
- Returned amount and after-return balance

## Verification

- Backend syntax check: passed
- Frontend UI layout source test: passed
- Frontend production build: passed
- Live API reversal probe: passed
- Smoke test: passed
- Acceptance regression: passed
- Environment/network fallback verification: passed
- Full system test: passed

## Reports

- Full system: `C:\Airfare_Allowance\test-reports\atlas-full-system-test-20260628124708.md`
- Acceptance: `C:\Airfare_Allowance\test-reports\atlas-acceptance-regression-20260628124654.md`
- Environment: `C:\Airfare_Allowance\test-reports\atlas-environment-verification-20260628154655.md`
