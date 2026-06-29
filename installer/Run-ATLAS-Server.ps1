param(
    [string]$InstallRoot = (Split-Path -Parent $MyInvocation.MyCommand.Path)
)

$ErrorActionPreference = "Stop"
Set-Location $InstallRoot

$node = Join-Path $InstallRoot "runtime\nodejs\node.exe"
$envFile = Join-Path $InstallRoot ".env"
$logDir = Join-Path $InstallRoot "logs"
$combinedLog = Join-Path $logDir "atlas-server-task.log"

New-Item -ItemType Directory -Path $logDir -Force | Out-Null

if (-not (Test-Path $node)) {
    "[$(Get-Date -Format o)] Bundled Node runtime missing: $node" | Add-Content -Path $combinedLog
    exit 1
}

if (-not (Test-Path $envFile)) {
    "[$(Get-Date -Format o)] .env missing. Run Configure-ATLAS.bat." | Add-Content -Path $combinedLog
    exit 1
}

$env:ATLAS_BIND_HOST = "0.0.0.0"
"[$(Get-Date -Format o)] ATLAS server task starting from $InstallRoot" | Add-Content -Path $combinedLog

while ($true) {
    try {
        & $node "server.js" *>> $combinedLog
        $exitCode = $LASTEXITCODE
        "[$(Get-Date -Format o)] ATLAS server exited with code $exitCode. Restarting in 10 seconds." | Add-Content -Path $combinedLog
    } catch {
        "[$(Get-Date -Format o)] ATLAS server crashed: $($_.Exception.Message). Restarting in 10 seconds." | Add-Content -Path $combinedLog
    }
    Start-Sleep -Seconds 10
}
