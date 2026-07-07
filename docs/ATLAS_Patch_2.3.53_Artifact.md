# ATLAS Patch 2.3.53 Artifact Report

- Build date: 2026-07-07
- Branch: codex/atlas-installer-2.2.8
- Patch type: update-only EXE plus MSI payload
- Target port: 3355
- Backend/database policy: preserve existing APIs, routes, controllers, serialization, database schema, `.env`, registry settings, and MSSQL connection values.

## Patch Files

| Artifact | Path | SHA256 |
| --- | --- | --- |
| Update-only EXE | `C:\Airfare_Allowance\artifacts\patch-2.3.53\ATLAS-Airfare-Allowance-UpdateOnly-2.3.53-x64.exe` | `49B21C66D829280F42596EDB7864779711BF006DA63F5C4995A2DECEA4FAF439` |
| MSI payload | `C:\Airfare_Allowance\artifacts\patch-2.3.53\ATLAS-Airfare-Allowance-2.3.53-x64.msi` | `F25B796885F1D4BA888EBB5CB8B7E2F1DAA6B2EA3A8F0C3DEB5BAD2E1560071F` |

## Dependency Relationships

| Element | Relies on | Purpose |
| --- | --- | --- |
| Update EXE | WiX Burn chain | Runs preflight, MSI replacement, and finalize verification in strict order. |
| MSI replacement payload | `atlas-payload-manifest.json` | Verifies copied/replaced files by length and SHA256 on the target machine. |
| Backend service | `server.js`, `node_modules`, bundled `runtime\nodejs\node.exe` | Keeps the existing API process running on preserved port 3355. |
| Frontend UI | built `atlas-hcm-next` output and static assets | Serves the verified HD UI fixes through the existing Express host. |
| Database repair | existing `.env`, registry MSSQL values, database SQL scripts | Repairs missing objects only, without changing customer schema settings or data. |
| Startup task | installed root and `Install-ATLAS-StartupTask.ps1` | Restarts ATLAS after replacement and health validation. |
| Support rollback | backup folder, `install_debug.log`, checksum report, payload audit CSV | Provides detailed evidence of copied/replaced files and verification status. |

## Installer Process Visibility

During update install, `installer\bootstrapper\deploy.ps1` now writes:

- `update-finalize-*.txt`: top-level patch process and result.
- `patch-dependency-map-*.md`: human-readable dependency relationship map.
- `patch-dependency-map-*.json`: machine-readable dependency relationship map.
- `patch-file-replacement-audit-*.csv`: per-file copy/replace verification details.
- `patch-file-replacement-audit-*.json`: replacement audit totals.
- `checksum-diagnostic-*.json`: installed file hash verification against the payload manifest.
- `install_debug.log`: structured step events for support.

## Verification Completed

- `node tests/atlas-patch-artifact.test.js`
- `node tests/employee-self-service-allocation-link.test.js`
- `npm run check`
- `npm run test:full`
- `npm test` in `atlas-hcm-next`
- `npm run build` in `atlas-hcm-next`
- MSI package build with WiX 7.0.0
- Update-only EXE bundle build with WiX 7.0.0

## Open Source / Public References

- Microsoft Learn: [`Copy-Item`](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.management/copy-item?view=powershell-7.5) supports recursive file copy behavior and `Force` for replacement scenarios.
- WiX/FireGiant: [`ExePackage`](https://docs.firegiant.com/wix/schema/wxs/exepackage/) packages can be chained in a bundle, which matches the ATLAS preflight -> MSI -> finalize patch flow.
