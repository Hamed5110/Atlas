# Local workspace sanitize + MSSQL catalog sync (dry-run first)
# Proxies to HCM Airfare script so UI workspace ops use the live DB.
#
#   powershell -File scripts/Sanitize-LocalWorkspace.ps1
#   powershell -File scripts/Sanitize-LocalWorkspace.ps1 -Apply -SyncDb

param(
    [switch]$Apply,
    [switch]$SyncDb,
    [switch]$EnsureSchema,
    [switch]$Migrate,
    [switch]$LogDryRun,
    [switch]$Verbose
)

$ErrorActionPreference = "Stop"
$Hcm = "C:\HCM Airfare"
$Py = Join-Path $Hcm ".venv\Scripts\python.exe"
$Script = Join-Path $Hcm "scripts\local_workspace_sanitize.py"

if (-not (Test-Path $Py)) { throw "Missing $Py" }
if (-not (Test-Path $Script)) { throw "Missing $Script" }

$argsList = @()
if ($Apply) { $argsList += "--apply" } else { $argsList += "--dry-run" }
if ($SyncDb) { $argsList += "--sync-db" }
if ($EnsureSchema) { $argsList += "--ensure-schema" }
if ($Migrate) { $argsList += "--migrate" }
if ($LogDryRun) { $argsList += "--log-dry-run" }
if ($Verbose) { $argsList += "--verbose" }

& $Py $Script @argsList
exit $LASTEXITCODE
