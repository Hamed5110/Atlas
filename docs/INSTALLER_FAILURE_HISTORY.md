# ATLAS Installer Failure History

Purpose: preserve the exact failure chain and fixes so future installer errors can be diagnosed from Git history instead of starting over.

## Current final package

- Version: `2.3.74`
- Artifact folder: `C:\Airfare_Allowance\artifacts\patch-2.3.74-quoted-hash-helper`
- Final EXE: `ATLAS-Airfare-Allowance-Setup-2.3.74-x64.exe`
- SHA256: `630CA24F71A13DAB552C8C0163805C24C1E828523D02FE9562275E447D4DC1A1`
- Latest commit: `5f01e6d fix(installer): quote password hash helper path`

## Failure chain and fixes

| Commit | Problem seen on target machine | Root cause | Fix |
| --- | --- | --- | --- |
| `b9bc8fd` | `The given path's format is not supported` | Burn/runner path arguments with spaces/trailing slashes were split or malformed | Preserve quoted Burn path arguments |
| `a29f8e5` | Configure path failures continued | Trailing backslash before quote escaped the closing quote | Quote trailing backslash arguments safely |
| `77f57bc` | Configure arguments still fragile | Raw Burn args were forwarded directly | Rebuild sanitized configure arguments |
| `c1031bb` | `Invalid column name 'PolicyRateID'` | Legacy/partial DB lacked `AirfarePolicyRates.PolicyRateID` | Repair missing airfare policy identity before procedures compile |
| `ca741a6` | `Invalid column name 'PolicyRateID'` in allocation references | Legacy/partial DB lacked `Allocations.PolicyRateID` | Add allocation policy columns before preference functions compile |
| `2bf96c2` | `Invalid object name 'dbo.Companies'` | Base schema skipped because `Users` existed, but `Companies` was missing | Create/repair `Companies` and `CompanyBackups` early in HCM SQL |
| `8b93453` | Existing install not auto-updated; SQL port uncertainty | Installer defaulted to fresh install unless `.env` was intact; stale/missing SQL port handling weak | Auto-update when ATLAS footprint/registry exists; detect current SQL TCP port |
| `1cb20be` | `Invalid column name 'CompanyID'` in `ATLAS_Company_Admin.sql` batch 9 | Optional legacy Year End/company cleanup compiled against tables missing `CompanyID` | Guard cleanup with `COL_LENGTH` and dynamic SQL |
| `6a35a49` | `node:internal/modules/cjs/loader:1478` at `New-AtlasPasswordHash` | Node stderr was hidden; bcryptjs resolution depended on current working directory | Resolve `bcryptjs` from installed app `node_modules`; capture stderr |
| `5f01e6d` | `Cannot find module 'C:\ProgramData\ATLAS'` | Temporary hash helper path under `C:\ProgramData\ATLAS Airfare Allowance\...` was split at the space | Launch Node through .NET `ProcessStartInfo` with quoted helper script path |

## Diagnostic rules for next time

1. If SQL scripts complete and failure happens at `New-AtlasPasswordHash`, inspect Node stderr first.
2. If the error is `Cannot find module 'C:\ProgramData\ATLAS'`, it is a quoting/splitting problem, not missing bcrypt.
3. If the error is `Cannot find module 'bcryptjs'`, verify:
   - `C:\Program Files\ATLAS Airfare Allowance\node_modules\bcryptjs` exists
   - `ATLAS_INSTALL_PATH` points to the install root
   - `NODE_PATH` points to installed `node_modules`
4. If failure is `Invalid column name ...`, find the exact SQL script and batch in `bootstrapper-Install-*.log`; add compatibility columns in a prior `GO` batch before any procedure/function compiles.
5. If failure is `Invalid object name ...`, create/repair the table before any object references it. Do not rely on deferred name resolution for columns.
6. If Burn log shows `DB_PORT=1433` but bootstrapper config shows `SqlPort=3009`, trust the bootstrapper configure log; MSI properties may be defaults while configure uses the JSON replay.
7. Never hide stderr from external tools during installer configure. Persist the real error in `install_debug.log`.

## Important log files from target-machine testing

- `bootstrapper-Install-20260729162013.log`: proved SQL scripts completed and exposed quoted Node helper path failure.
- `bootstrapper-runner-Install-20260729162013.log`: confirmed stack at `New-AtlasPasswordHash`.
- `install_debug.log`: preserved full final Node error after stderr capture was added.

## Verification used for 2.3.74

- `node tests\company-admin-sql.test.js`
- `npm run check`
- `npm run test:year-end-safety`
- `npm run test:full`
- Local Node launch simulation using a helper path with spaces
- MSI build through `installer\Build-ATLAS-MSI.ps1`
- EXE build through `installer\bootstrapper\deploy.ps1 -Mode Build`
- Local health check: `http://127.0.0.1:3355/api/health`
