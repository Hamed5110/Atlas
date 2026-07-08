# ATLAS Opening Loan Balance / Year-End Verification

Date: 2026-07-08
Port: http://127.0.0.1:3355
Branch: codex/atlas-installer-2.2.8
Backup branch: backup/opening-loan-balance-baseline-2026-07-08

## Open-Source Comparison Notes

| Reference | Relevant pattern | ATLAS action |
| --- | --- | --- |
| Odoo year-end accounting | Balance-sheet items such as loans remain open across fiscal boundaries while period activity is closed separately. | Pending loan balances now roll into a separate next-year opening loan ledger. |
| ERPNext closing books | Fiscal close preserves ledgers and creates year-separated opening evidence. | Year-end preview and close expose next-year opening loan balance fields. |
| Apache OFBiz opening balance examples | Opening values are initialization records, not ad hoc frontend calculations. | Opening loan balance is owned by MSSQL table/procedures and read through API. |

## Implemented System Contract

| Layer | Artifact | Purpose |
| --- | --- | --- |
| MSSQL table | `dbo.OpeningLoanBalances` | Stores next-year opening loan liabilities by employee and year. |
| MSSQL procedure | `dbo.sp_ATLAS_UpsertOpeningLoanBalance` | Transactional year-end carry-forward writer. |
| MSSQL procedure | `dbo.sp_ATLAS_GetOpeningLoanBalances` | Year-aware opening loan register reader. |
| MSSQL procedure | `dbo.sp_ATLAS_GetYearEndPreview` | Exposes `ClosingLoanBalance` and `NextOpeningLoanBalance`. |
| API | `GET /api/opening-loan-balances?year=YYYY` | Loads selected fiscal year opening loan balances. |
| API | `POST /api/year-end/close` | Writes opening airfare balances and opening loan balances in one close transaction. |
| UI | Loans | Shows selected-year `Opening Loan Balance`. |
| UI | Year End | Shows `Opening loan balance` summary and employee preview column. |

## Live Verification Summary

| Check | Result |
| --- | --- |
| Port health | PASS: `127.0.0.1:3355/api/health` returned healthy/database connected. |
| SQL object installation | PASS: table, upsert procedure, list procedure, and preview field are installed. |
| Opening loan API | PASS: endpoint returned a valid year-aware register. |
| Year-end preview API | PASS: 2026 preview returned `totalOpeningLoanBalance = 417.36`, `loansCarriedForward = 3`. |
| Live UI Loans | PASS: `Opening Loan Balance` metric is visible. |
| Live UI Year End | PASS: `Opening loan balance` summary is visible after preview. |
| Frontend tests | PASS: `npm test` in `atlas-hcm-next`. |
| Frontend build | PASS: `npm run build` in `atlas-hcm-next`. |
| Backend regression | PASS: `npm run test:full`. |
| Python contract | PASS: `python tests/opening_loan_balance_contract_test.py`. |

## Test Artifacts

| Artifact | Path |
| --- | --- |
| Latest full system report | `C:\Airfare_Allowance\test-reports\atlas-full-system-test-20260708103134.md` |
| Latest full system JSON | `C:\Airfare_Allowance\test-reports\atlas-full-system-test-20260708103134.json` |
| Opening loan verification report | `C:\Airfare_Allowance\test-reports\atlas-opening-loan-balance-year-end-20260708.md` |
