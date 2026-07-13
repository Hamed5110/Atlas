# ATLAS Patch 2.3.54 Artifact Report

- Build date: 2026-07-13
- Branch: `codex/atlas-installer-2.2.8`
- Source commits: `1a8b16c`, `3b140db`
- Patch type: update-only EXE plus MSI payload
- Target behavior: preserve the installed application root, `.env`, MSSQL connection values, company data, and port `3355`.

## Files

| Artifact | Path | SHA-256 |
| --- | --- | --- |
| Update-only EXE | `C:\Airfare_Allowance\artifacts\patch-2.3.54\ATLAS-Airfare-Allowance-UpdateOnly-2.3.54-x64.exe` | `28A7436721D4DDD998D7BE6904E968B75C274767EE51D1EE8A86BCD2C46976A0` |
| MSI payload | `C:\Airfare_Allowance\artifacts\patch-2.3.54\ATLAS-Airfare-Allowance-2.3.54-x64.msi` | `AEFFB61EEB1DFD5D6B04911235EB62A38363BB48541A8B24E14EEEC9C4468995` |

## Selective Update Workflow

1. The update EXE requires an existing ATLAS installation.
2. Preflight reads the existing installation, `.env`, port, and MSSQL settings.
3. The MSI applies the current application payload while preserving configuration and customer data.
4. Finalization restores preserved configuration, repairs required database objects, restarts ATLAS, and checks the existing health endpoint.
5. The patch writes dependency and per-file replacement audits to the installed data log folder.

The update-only chain intentionally excludes SQL Express setup media. SQL Express remains available in the full installer, but an update patch does not install or replace SQL Server.

## Verification

- `node tests/atlas-patch-artifact.test.js`: passed.
- `npm run check`: passed.
- `npm run test:full`: passed.
- Complete frontend test suite and production build: passed.
- Local update prerequisite check: passed for installed files, configuration, port `3355`, and MSSQL TCP port `1433`.
- Update EXE size: 41.2 MiB, compared with 305.4 MiB for patch 2.3.53.

The artifacts are unsigned.
