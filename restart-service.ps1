# Restart HCM Airfare API on :3389 (FastAPI/uvicorn + static UI from web_dist_next).
# UI is served by the same process — rebuild atlas-next separately if you need a new frontend.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File "C:\HCM Airfare\restart-service.ps1"
#   powershell -ExecutionPolicy Bypass -File "C:\HCM Airfare\start-service.ps1"   # start only (no-op if already live)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Port = 3389
$BaseUrl = "http://127.0.0.1:$Port"
$LogDir = Join-Path $Root "logs"
$StartupLog = Join-Path $LogDir "service-startup.log"

if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}

function Write-RestartLog([string]$Message) {
    $line = "[{0}] RESTART: {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
    Add-Content -Path $StartupLog -Value $line -Encoding ASCII
    Write-Host $line
}

Write-Host "== HCM Airfare restart (:$Port) ==" -ForegroundColor Cyan
Write-RestartLog "Stopping listeners on port $Port."

$listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
foreach ($listener in $listeners) {
    $procId = $listener.OwningProcess
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$procId" -ErrorAction SilentlyContinue
    Write-RestartLog "Stopping PID $procId ($($proc.Name)) $($proc.CommandLine)"
    Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
}

# Also stop any leftover uvicorn/python children that may still hold the port briefly
Start-Sleep -Seconds 2
$still = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
if ($still.Count -gt 0) {
    foreach ($listener in $still) {
        Write-RestartLog "Force-stop remaining PID $($listener.OwningProcess)"
        Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 2
}

Write-RestartLog "Invoking start-service.ps1"
& (Join-Path $Root "start-service.ps1")
$exit = $LASTEXITCODE
if ($exit -ne 0) {
    Write-RestartLog "start-service.ps1 exited $exit"
    exit $exit
}

try {
    $live = Invoke-RestMethod -Uri "$BaseUrl/health/live" -TimeoutSec 5
    Write-Host "OK: API live at $BaseUrl" -ForegroundColor Green
    Write-Host "UI:  $BaseUrl/login/" -ForegroundColor Green
    exit 0
} catch {
    Write-Host "WARN: start finished but /health/live not ready yet - check logs\service-api-err.log" -ForegroundColor Yellow
    exit 1
}
