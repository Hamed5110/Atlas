# ATLAS MSI/EXE Versioned Patch System

## Purpose

This patching system prevents the historical ATLAS deployment failures:

- MSI and EXE built from different versions.
- Installer reports success while the running app serves old frontend files.
- Backend updates but frontend static build remains stale.
- Manual patch notes exist but no machine-readable migration history exists.

The release manifest is the single source of truth:

- `C:\Airfare_Allowance\release\atlas-release-manifest.json`

The runtime identity file generated from it is:

- `C:\Airfare_Allowance\release\version.json`

## Release artifact layout

```text
C:\Airfare_Allowance\artifacts\patch-2.3.87\
  atlas-release-manifest.json
  ATLAS-Airfare-Allowance-2.3.87-x64.msi
  ATLAS-Airfare-Allowance-Setup-2.3.87-x64.exe
  payload\
    atlas-release-manifest.json
    release\version.json
  reports\
    build-report.md
```

Build command:

```powershell
powershell -ExecutionPolicy Bypass -File C:\Airfare_Allowance\installer\Build-ATLAS-Release.ps1 -Version 2.3.87
```

The build script:

1. reads `release\atlas-release-manifest.json`;
2. verifies version and artifact filenames;
3. builds `atlas-hcm-next\out`;
4. computes `frontendBuildHash`;
5. computes `backendBuildHash`;
6. writes `release\version.json`;
7. builds MSI;
8. builds EXE from the same MSI and version;
9. writes final outer artifact hashes to the adjacent artifact manifest.

Red-team note: final MSI/EXE SHA256 hashes are outer-package metadata. An installer cannot embed its own final SHA256 inside itself without changing that SHA256 again. The embedded/runtime manifest must match on product identity, git commit, frontend hash, backend hash, schema version, and migration plan; the adjacent release manifest records final container hashes.

## Runtime endpoint

Endpoint:

```text
GET /api/version
```

Patch success requires exact match with the release manifest for:

- `productCode`
- `version`
- `gitCommit`
- `frontendBuildHash`
- `backendBuildHash`
- `databaseSchemaVersion`
- `artifact.manifestVersion`

Example success response:

```json
{
  "product": "ATLAS Airfare Allowance",
  "productCode": "ATLAS_AIRFARE_ALLOWANCE",
  "version": "2.3.87",
  "channel": "stable",
  "gitCommit": "f4c19a2",
  "buildTimestampUtc": "2026-08-01T10:00:00Z",
  "frontendBuildHash": "sha256:frontend-2387",
  "backendBuildHash": "sha256:backend-2387",
  "databaseSchemaVersion": "2026.08.01.001",
  "runtime": {
    "nodeVersion": "v22.x",
    "port": 3355,
    "processStartedAtUtc": "2026-08-01T10:11:20Z",
    "installRoot": "C:\\Program Files\\ATLAS Airfare Allowance",
    "dataRoot": "C:\\ProgramData\\ATLAS Airfare Allowance"
  },
  "database": {
    "connected": true,
    "name": "Atlasairfare010",
    "schemaVersion": "2026.08.01.001"
  },
  "artifact": {
    "installedBy": "exe",
    "manifestVersion": "2.3.87",
    "manifestHash": "sha256:manifest-2387"
  }
}
```

## Installed metadata

Registry:

```text
HKLM:\SOFTWARE\ATLAS\AirfareAllowance
  Version
  GitCommit
  FrontendBuildHash
  BackendBuildHash
  DatabaseSchemaVersion
  InstallRoot
  DataRoot
  LastPatchStatus
```

File:

```text
C:\ProgramData\ATLAS Airfare Allowance\install-state.json
```

Example:

```json
{
  "installedVersion": "2.3.87",
  "gitCommit": "f4c19a2",
  "frontendBuildHash": "sha256:frontend-2387",
  "backendBuildHash": "sha256:backend-2387",
  "databaseSchemaVersion": "2026.08.01.001",
  "installRoot": "C:\\Program Files\\ATLAS Airfare Allowance",
  "dataRoot": "C:\\ProgramData\\ATLAS Airfare Allowance",
  "installedAtUtc": "2026-08-01T10:12:30Z",
  "lastPatchStatus": "Success"
}
```

## Patch command

```powershell
powershell -ExecutionPolicy Bypass -File C:\Airfare_Allowance\installer\Invoke-ATLAS-ManifestPatch.ps1 -ArtifactRoot C:\Airfare_Allowance\artifacts\patch-2.3.87
```

The patch engine:

1. reads target `atlas-release-manifest.json`;
2. detects installed state from registry, `install-state.json`, `/api/version`, or installed `release\version.json`;
3. decides fresh install / patch / repair / downgrade block / no-op;
4. selects migrations from `migrationPlan`;
5. writes rollback marker;
6. backs up previous files and metadata;
7. stops ATLAS and verifies the port is released;
8. applies files through staging and move replacement;
9. runs migrations and verify steps;
10. restarts ATLAS;
11. polls `/api/version`;
12. compares runtime identity to manifest;
13. writes registry, install-state, and patch-history only after proof;
14. rolls back on failure.

## Decision table

| Installed | Target | Decision | Migrations |
|---|---:|---|---|
| none | 2.3.87 | fresh install | baseline + selected manifest steps |
| 2.3.83 | 2.3.87 | patch | `<2.3.84`, `<2.3.85`, `<2.3.87` |
| 2.3.84 | 2.3.87 | patch | `<2.3.85`, `<2.3.87` |
| 2.3.85 | 2.3.87 | patch | `<2.3.87` |
| 2.3.87 with matching hashes | 2.3.87 | no-op | none |
| 2.3.87 with old frontend hash | 2.3.87 | repair | reinstall frontend/runtime payload |
| 2.3.88 | 2.3.87 | block downgrade | none |

## Pending rollback marker

```text
C:\ProgramData\ATLAS Airfare Allowance\rollback\pending-patch.json
```

Example:

```json
{
  "status": "Pending",
  "startedAtUtc": "2026-08-01T10:05:00Z",
  "fromVersion": "2.3.85",
  "toVersion": "2.3.87",
  "backupRoot": "C:\\ProgramData\\ATLAS Airfare Allowance\\rollback\\20260801100500",
  "plannedMigrations": [
    "20260801-version-endpoint-contract"
  ]
}
```

## Patch history

```text
C:\ProgramData\ATLAS Airfare Allowance\patch-history.json
```

Example:

```json
[
  {
    "fromVersion": "2.3.85",
    "toVersion": "2.3.87",
    "startedAtUtc": "2026-08-01T10:05:00Z",
    "finishedAtUtc": "2026-08-01T10:12:30Z",
    "status": "Success",
    "decision": "patch",
    "migrations": [
      {
        "id": "20260801-version-endpoint-contract",
        "status": "Success",
        "verified": true
      }
    ]
  }
]
```

## Frontend hash mismatch failure

Failure:

```json
{
  "version": "2.3.87",
  "gitCommit": "f4c19a2",
  "frontendBuildHash": "sha256:old-2386",
  "backendBuildHash": "sha256:backend-2387"
}
```

Installer behavior:

1. mark patch-history status `Failed`;
2. reason: `Runtime mismatch frontendBuildHash`;
3. stop ATLAS;
4. restore files from rollback backup;
5. restart ATLAS;
6. write registry `LastPatchStatus=RolledBack`;
7. leave patch-history with failure evidence;
8. do not remove the failure log.

Exact failure history example:

```json
{
  "fromVersion": "2.3.86",
  "toVersion": "2.3.87",
  "status": "Failed",
  "error": "Runtime mismatch frontendBuildHash expected 'sha256:frontend-2387' actual 'sha256:old-2386'.",
  "migrations": [
    {
      "id": "20260801-version-endpoint-contract",
      "status": "Failed",
      "verified": false
    }
  ]
}
```

## Rollback triggers

Rollback is triggered by:

- service will not stop;
- port remains occupied;
- payload copy fails;
- staging folder cannot be moved;
- migration action fails;
- migration verification fails;
- service will not restart;
- `/api/version` does not respond;
- `/api/version` field mismatch;
- database unavailable after patch;
- pending rollback marker remains after a claimed success.

## Hard validation rules

Build/install must fail if:

- manifest is missing;
- manifest version differs from MSI filename;
- manifest version differs from EXE filename;
- migration lacks `verify`;
- migration lacks rollback stance;
- `/api/version` is missing;
- runtime `version` differs from target manifest;
- runtime `frontendBuildHash` differs from target manifest;
- runtime `backendBuildHash` differs from target manifest;
- runtime `databaseSchemaVersion` differs from target manifest;
- patch-history cannot be written;
- installer reports success while `pending-patch.json` still exists.
