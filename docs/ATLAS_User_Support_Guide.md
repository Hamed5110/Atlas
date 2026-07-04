# ATLAS Airfare HCM Support Guide

Last verified: 2026-06-28

## Access

- Main URL: http://<server-name>/
- Current IP fallback: http://192.168.15.208/
- If the name URL does not open from another PC, run `Open-ATLAS-From-Other-PC.bat` from that PC.
- If Windows name discovery needs repair on the ATLAS PC, run `Enable-ATLAS-Name-Discovery-Run-As-Admin.bat`.

## Daily Operating Sequence

1. Open ATLAS and sign in.
2. Confirm the selected company at the top-left.
3. Review Overview totals for airfare payable, opening balance, and loan exposure.
4. Maintain Employee Master before allocations.
5. Enter or import Opening Balance before ticket processing.
6. Process Airfare Allocation with ticket amount, payment option, and approval where required.
7. Review Loans for EMI, deferment, restructure, or settlement.
8. Use Reports for review, export, and print.
9. Run Year End preview before any close.

## Company Administration

- Use Companies to create and maintain company records.
- Use Edit on ATLAS or any company to update name, contact details, TRN/CR, address, and logo.
- Use Create Backup before major company/database work.
- Use Restore only with a selected backup file and administrator approval.
- Do not delete the main ATLAS company.

## Employee Master

- Keep employee status accurate.
- Active employees are eligible for airfare calculation.
- Resigned, separated, probation, inactive, and in-active employees are excluded from airfare eligibility.
- Opening balances are maintained in the Opening Balance screen, not inside Employee Master.

## Opening Balance

- Enter opening balance days and amount before processing allocations.
- Excel import supports preview, row selection, and import confirmation.
- Amount is calculated from opening days using the active maximum payout policy.
- Review imported rows before confirming.

## Airfare Allocation

- Select employee, allocation date, ticket amount, and payment mode.
- Use manager approval for second tickets and loan tickets.
- Attach ticket or invoice documents where required.
- If ticket cost is more than eligibility, ATLAS can place the excess on employee self-pay or loan, depending on the selected option and approval.

## Loans

- Manual loans can be created from the Loans screen.
- Airfare excess loans are created from Airfare Allocation after manager approval.
- Use EMI preview before running monthly deductions.
- Use restructure, defer, or settle only after confirming the selected loan.
- Review Loan History after restructure, deferment, EMI run, or settlement.

## Year End

- Preview year end before closing.
- Review pending loans and closing balance.
- Use dry-run/preview for checking.
- Close year only after checking employee balances and reports.
- Closing balance is carried forward as next year opening balance.

## Reports

- Use Reports for dashboard, employee master, airfare payable, allocation register, loan register, company register, and year-end preview.
- Use date filters before exporting or printing.
- Airfare Payable report is the control report for payable entitlement and status review.

## If Something Does Not Work

- If the page does not open by name, try the IP fallback shown by `Start-ATLAS-LAN.ps1`.
- If another PC cannot find the app, run `Open-ATLAS-From-Other-PC.bat` on that PC.
- If login works but data does not load, refresh once and check `http://<server-name>/api/health`.
- If year-end preview shows pending loans, review Loans before closing.
- If a report looks wrong, compare the same employee in Employee Master, Airfare Allocation, and Airfare Payable before editing any data.
