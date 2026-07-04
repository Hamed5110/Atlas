# ATLAS Full System Testing Artifacts - 2026-06-28

## Result

Overall result: PASSED

No airfare formula, loan formula, year-end formula, report calculation, or business workflow logic was changed during this pass.

## Live Access Verified

- Main name URL: http://<server-name>/
- Current IP fallback: http://192.168.15.208/
- API health: http://<server-name>/api/health
- SQL health status: healthy / connected

## Repairs Made

- Startup/network helper now selects the current preferred LAN route for the fallback IP.
- Added focused acceptance regression test: `tests/acceptance-regression-test.js`.
- Added other-PC automatic opener/finder: `Open-ATLAS-From-Other-PC.ps1` and `.bat`.
- Added name-discovery repair helper: `Enable-ATLAS-Name-Discovery-Admin.ps1` and `.bat`.

These repairs are infrastructure/testing/support helpers only. They do not change application formulas or business calculations.

## Test Reports

- Acceptance regression Markdown: `test-reports/atlas-acceptance-regression-20260628083145.md`
- Acceptance regression JSON: `test-reports/atlas-acceptance-regression-20260628083145.json`
- Full system Markdown: `test-reports/atlas-full-system-test-20260628083216.md`
- Full system JSON: `test-reports/atlas-full-system-test-20260628083216.json`
- Live UI screenshot: `test-reports/atlas-live-ui-companies-20260628.png`
- Support guide DOCX: `docs/ATLAS_Airfare_HCM_Support_Guide_2026-06-28.docx`
- Support guide Markdown: `docs/ATLAS_User_Support_Guide.md`

## Commands Run

- `powershell -NoProfile -ExecutionPolicy Bypass -File .\Start-ATLAS-LAN.ps1`
- `npm run check`
- `node tests\acceptance-regression-test.js`
- `npm run test:smoke`
- `npm run test:phase1`
- `npm run test:loan-sql`
- `npm run test:attachments-sql`
- `npm run test:company-admin`
- `npm run test:employee-status`
- `node tests\airfare-policy-scope.test.js`
- `npm run test:full`
- `npm test` in `atlas-hcm-next`
- `npm run build` in `atlas-hcm-next`

## Coverage Summary

### Year End Process

- Year-end preview returned employee counts, closing days, closing amount, pending loan count, and pending loan amount.
- Year-end dry-run close completed without committing.
- Full system test performed a real close on temporary future-year data and verified next-year opening balance carry-forward.

### Loans

- Loan SQL function and stored procedure checks passed.
- Loan register and summary loaded.
- EMI preview loaded.
- Full system test created a temporary loan, ran EMI, restructured EMI, deferred EMI, settled loan, and verified loan history.

### Reports

- Employee Master report loaded.
- Airfare Payable report loaded.
- Year Summary report loaded.
- Report viewer source/UI checks passed.
- Dashboard totals matched SQL-backed report behavior.

### Views / Frontend Display

- Production frontend build passed.
- Live browser login passed.
- Live UI screens verified: Overview, Employees, Opening Balance, Airfare, Loans, Year End, Reports, Companies.
- Browser console error check returned no errors during the live UI pass.
- Live UI screenshot saved after browser navigation.

### Company Process

- Company list loaded.
- Backup list loaded.
- Full system test created a temporary company database with logo, updated it, backed it up, restored it, and validated the process.

### Security / Session

- Anonymous protected endpoint rejected access.
- Admin login returned token and session ID.
- Authenticated endpoints loaded with token and session header.

## Online / Open-Source Research Applied

- Playwright-style browser end-to-end testing pattern: verify the rendered app, not just source code.
- OWASP-style authentication check: protected endpoints must reject anonymous access.
- Microsoft SQL backup/restore validation principle: backup and restore should be exercised with a real test database.
- Windows name discovery and DNS/NetBIOS behavior: helper scripts now avoid fixed IP dependency and provide a subnet finder when LAN name lookup is blocked.

## Document QA Note

The support guide DOCX was generated and structurally checked: 43 paragraphs, 9 headings, 3 tables, matching table grids, and no placeholder text. Visual DOCX-to-PNG rendering could not be completed because LibreOffice/soffice is not installed on this PC. The document file itself was still produced successfully.
