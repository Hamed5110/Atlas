param(
    [string]$InstallRoot = (Split-Path -Parent $MyInvocation.MyCommand.Path)
)

$ErrorActionPreference = "Stop"
Set-Location $InstallRoot

$node = Join-Path $InstallRoot "runtime\nodejs\node.exe"
$envFile = Join-Path $InstallRoot ".env"
$logDir = Join-Path $InstallRoot "logs"
$stdoutLog = Join-Path $logDir "atlas-node-out.log"
$stderrLog = Join-Path $logDir "atlas-node-err.log"

foreach ($oldPath in @(
    (Join-Path $InstallRoot "tmp"),
    (Join-Path $InstallRoot ".next"),
    (Join-Path $InstallRoot "installer\stage")
)) {
    if (Test-Path $oldPath) {
        Remove-Item -LiteralPath $oldPath -Recurse -Force -ErrorAction SilentlyContinue
    }
}
Get-ChildItem -LiteralPath $InstallRoot -Filter "*.wixpdb" -File -ErrorAction SilentlyContinue |
    Remove-Item -Force -ErrorAction SilentlyContinue

if (-not (Test-Path $node)) {
    throw "Bundled Node runtime was not found at $node"
}

if (-not (Test-Path $envFile)) {
    $writer = Join-Path $InstallRoot "Write-ATLAS-Env.ps1"
    if (Test-Path $writer) {
        Write-Host "Creating .env from MSI configuration..."
        powershell -NoProfile -ExecutionPolicy Bypass -File $writer -InstallRoot $InstallRoot
    }
    if (-not (Test-Path $envFile)) {
        Write-Host "Missing .env. Starting first-run configuration..."
        powershell -ExecutionPolicy Bypass -File (Join-Path $InstallRoot "Configure-ATLAS-After-Install.ps1") -InstallRoot $InstallRoot
    }
}

$port = 3355
$rawPort = Select-String -Path $envFile -Pattern "^PORT=(\d+)$" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($rawPort -and $rawPort.Line -match "^PORT=(\d+)$") { $port = [int]$Matches[1] }

New-Item -ItemType Directory -Path $logDir -Force | Out-Null

$sqlInstaller = Join-Path $InstallRoot "Install-ATLAS-SQL-Instance.ps1"
if (Test-Path $sqlInstaller) {
    Write-Host "Preparing local SQL Server if configured..."
    powershell -NoProfile -ExecutionPolicy Bypass -File $sqlInstaller -InstallRoot $InstallRoot
}

$dbInitializer = Join-Path $InstallRoot "Initialize-ATLAS-Database.ps1"
if (Test-Path $dbInitializer) {
    Write-Host "Preparing ATLAS database objects..."
    powershell -NoProfile -ExecutionPolicy Bypass -File $dbInitializer -InstallRoot $InstallRoot
    if ($LASTEXITCODE -ne 0) {
        Write-Host ""
        Write-Host "ATLAS database setup failed. Run Configure-ATLAS.bat and verify MSSQL settings." -ForegroundColor Red
        Read-Host "Press Enter to close"
        exit 1
    }
}

$verify = Join-Path $InstallRoot "Verify-ATLAS-Installed.ps1"
if (Test-Path $verify) {
    Write-Host "Verifying ODBC, MSSQL login, and ATLAS port before start..."
    powershell -NoProfile -ExecutionPolicy Bypass -File $verify -InstallRoot $InstallRoot -SkipAppHealth
    if ($LASTEXITCODE -ne 0) {
        Write-Host ""
        Write-Host "ATLAS verification failed. Fix the settings, then run Configure-ATLAS.bat." -ForegroundColor Red
        Read-Host "Press Enter to close"
        exit 1
    }
}

$taskInstaller = Join-Path $InstallRoot "Install-ATLAS-StartupTask.ps1"
if (Test-Path $taskInstaller) {
    Write-Host "Installing and starting ATLAS Windows startup task..."
    powershell -NoProfile -ExecutionPolicy Bypass -File $taskInstaller -InstallRoot $InstallRoot -StartNow
    if ($LASTEXITCODE -ne 0) {
        Write-Host ""
        Write-Host "ATLAS startup task could not be installed." -ForegroundColor Red
        Read-Host "Press Enter to close"
        exit 1
    }
}

function Test-AtlasHealth {
    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/health" -TimeoutSec 3
        return ($health.status -eq "healthy" -and $health.database -eq "connected")
    } catch {
        return $false
    }
}

$ready = $false
for ($attempt = 1; $attempt -le 30; $attempt++) {
    if (Test-AtlasHealth) {
        $ready = $true
        break
    }
    Start-Sleep -Seconds 2
}

if ($ready) {
    Write-Host ""
    Write-Host "ATLAS installed successfully." -ForegroundColor Green
    Write-Host "Database configuration successful." -ForegroundColor Green
    Write-Host "Application status: healthy and database connected." -ForegroundColor Green
    Write-Host "Confirmed port: $port" -ForegroundColor Green
    Write-Host "Opening http://localhost:$port"
    Start-Process "http://localhost:$port"
} else {
    Write-Host ""
    Write-Host "ATLAS did not become healthy on port $port." -ForegroundColor Red
    Write-Host "Check logs:"
    Write-Host "  $stdoutLog"
    Write-Host "  $stderrLog"
    if (Test-Path $verify) {
        powershell -NoProfile -ExecutionPolicy Bypass -File $verify -InstallRoot $InstallRoot
    }
    Read-Host "Press Enter to close"
    exit 1
}

Read-Host "Press Enter to close"
