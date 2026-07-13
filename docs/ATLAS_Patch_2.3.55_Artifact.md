# ATLAS Patch 2.3.55 Artifact Report

- Build date: 2026-07-13
- Branch: `codex/atlas-installer-2.2.8`
- Source fix commit: `5bd2db2`
- Patch type: update-only EXE plus MSI payload
- Target behavior: preserve the installed application root, `.env`, MSSQL connection settings, company data, existing application port, and SQL port.

## Resolved Update Failure

Patch `2.3.54` completed its payload audit successfully: 10,700 files were verified with zero missing and zero mismatched files. It then rolled back because its finalizer required the obsolete `payableFromProcedure` source-text marker.

Patch `2.3.55` verifies the supported payable-report health contract instead:

- installed `server.js` exposes `payableReportSource` with value `mssql-procedure-payable-bhd`;
- the restarted application reports the same value from `http://127.0.0.1:3355/api/health`;
- the existing self-service workflow health contract remains required.

This prevents a valid update from being rolled back for a removed implementation-detail marker.

## Existing Installer Compatibility

The provided Inno Setup `v1.0.10` SHA-256, `E801EA311D7327A99589EFF2A1D3B4F75AAC7E786B7604B4B291A549C52B3DB2`, is an installer-package checksum, not application source to merge. The current repository `server.js` and the existing installer payload were compared and are byte-for-byte identical. Compatibility is therefore verified through preserved configuration, payload auditing, and the live health endpoint rather than by embedding the prior installer.

## Files

| Artifact | Path | SHA-256 |
| --- | --- | --- |
| Update-only EXE | `C:\Airfare_Allowance\artifacts\patch-2.3.55\ATLAS-Airfare-Allowance-UpdateOnly-2.3.55-x64.exe` | `A16727735BE88B504AEB1B66096CC6DFB4F917B3E022532C471DCF5E13444840` |
| MSI payload | `C:\Airfare_Allowance\artifacts\patch-2.3.55\ATLAS-Airfare-Allowance-2.3.55-x64.msi` | `17E83F6A4DF180E26B173F81FB3F3F910B00C9BCB5AEA0C02FCAF9BCD416F2F9` |

## Verification

- PowerShell parser check for the update finalizer: passed.
- `node tests/atlas-patch-artifact.test.js`: passed.
- `npm run check`: passed.
- `npm run test:full`: passed.
- Full frontend tests and production build: passed during MSI packaging.
- Live health check on port `3355`: `status=healthy`, `database=connected`, payable and self-service health contracts present.
- Update prerequisite check: application configuration, data folder, application port `3355`, and reachable MSSQL TCP port passed.

The artifacts are unsigned.
