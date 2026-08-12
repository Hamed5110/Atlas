param(
    [string]$InnoCompiler = "",
    [string]$InstallDir = "C:\Atlas3388",
    [string]$SqlHost = "localhost",
    [string]$SqlPort = "1433",
    [string]$DbName = "AtlasPythonCore3388",
    [string]$DbUser = "sa",
    [string]$DbPassword = "Atlas@25",
    [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $Root

function Write-Ok {
    param([string]$Message)
    Write-Host "OK: $Message" -ForegroundColor Green
}

function Write-Step {
    param([string]$Message)
    Write-Host "STEP: $Message" -ForegroundColor Cyan
}

function Find-InnoCompiler {
    if (-not [string]::IsNullOrWhiteSpace($InnoCompiler) -and (Test-Path -LiteralPath $InnoCompiler)) {
        return $InnoCompiler
    }
    $candidates = @(
        "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe",
        "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
        "C:\Program Files\Inno Setup 6\ISCC.exe"
    )
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate) { return $candidate }
    }
    $command = Get-Command ISCC.exe -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    throw "ISCC.exe not found. Install Inno Setup 6 or pass -InnoCompiler."
}

function Invoke-Checked {
    param([string]$FilePath, [string[]]$Arguments)
    Write-Step "$FilePath $($Arguments -join ' ')"
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed with exit code $LASTEXITCODE`: $FilePath $($Arguments -join ' ')"
    }
}

function Assert-Admin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw "Administrator rights required to run installer/service/firewall verification. Re-open PowerShell as Administrator or pass -SkipInstall for compile-only verification."
    }
}

if (-not (Test-Path -LiteralPath ".\.venv\Scripts\python.exe")) {
    Write-Step "Creating Python 3.12 virtual environment"
    py -3.12 -m venv .venv
    if ($LASTEXITCODE -ne 0) { throw "Python 3.12 is required. Install Python 3.12 and rerun." }
}
Write-Step "Building PyInstaller distribution and manifest"
.\.venv\Scripts\python.exe scripts\build_release_artifact.py
if ($LASTEXITCODE -ne 0) { throw "Release artifact build failed." }
Write-Ok "Release zip and binary distribution rebuilt"

$iscc = Find-InnoCompiler
Write-Ok "Inno compiler found: $iscc"
Invoke-Checked $iscc @("installer\setup_atlas_3388.iss")

$setup = Join-Path $Root "dist\Setup_AtlasPythonCore3388_v0.3.0.exe"
if (-not (Test-Path -LiteralPath $setup)) { throw "Setup EXE was not created: $setup" }
Write-Ok "Setup EXE exists: $setup"

$manifest = Get-Content -LiteralPath (Join-Path $Root "dist\atlas-python-core-3388\python-core-manifest.json") -Raw | ConvertFrom-Json
if ($manifest.service.port -ne 3388 -or $manifest.oldRuntimeLinked -ne $false -or $manifest.legacyBatchCloseLinked -ne $false) {
    throw "Manifest isolation verification failed: $($manifest | ConvertTo-Json -Depth 6)"
}
Write-Ok "Manifest confirms port 3388 and isolated runtime links"

if ($SkipInstall) {
    Write-Host "PASS: Build verified without install. Setup EXE is ready for interactive execution." -ForegroundColor Green
    exit 0
}

Assert-Admin

$setupArgs = @(
    "/NORESTART",
    "/DIR=$InstallDir",
    "/SQLHOST=$SqlHost",
    "/SQLPORT=$SqlPort",
    "/DBNAME=$DbName",
    "/DBUSER=$DbUser",
    "/DBPASSWORD=$DbPassword",
    "/APPPORT=3388",
    "/LOG=$InstallDir\logs\Setup_AtlasPythonCore3388_v0.3.0.log"
)
Invoke-Checked $setup $setupArgs
Write-Ok "Interactive verification install completed."

$config = Join-Path $InstallDir "config\env.json"
if (-not (Test-Path -LiteralPath $config)) { throw "Install config was not written: $config" }
$configJson = Get-Content -LiteralPath $config -Raw | ConvertFrom-Json
if ($configJson.sqlServerHost -ne $SqlHost -or $configJson.sqlCustomPort -ne $SqlPort -or $configJson.databaseName -ne $DbName -or $configJson.applicationPort -ne "3388") {
    throw "Installed config mismatch: $($configJson | ConvertTo-Json -Depth 6)"
}
Write-Ok "Installed config contains SQL host, custom port, DB name, and app port"

$service = Get-Service -Name AtlasPythonCore3388 -ErrorAction Stop
if ($service.Status -ne "Running") {
    throw "AtlasPythonCore3388 service is not running. Current status: $($service.Status)"
}
Write-Ok "Windows service is running"

$health = Invoke-RestMethod -Uri "http://127.0.0.1:3388/api/v1/health" -TimeoutSec 20
if ($health.status -ne "ok" -or $health.port -ne 3388 -or $health.oldRuntimeLinked -ne $false -or $health.legacyBatchCloseLinked -ne $false) {
    throw "Health verification failed: $($health | ConvertTo-Json -Depth 6)"
}
Write-Ok "Health endpoint is OK on port 3388"

$root = & curl.exe -s -o NUL -w "%{http_code}" http://127.0.0.1:3388/
if ($root -ne "200") {
    throw "Root dashboard did not return HTTP 200. Status: $root"
}
Write-Ok "Dashboard root returns HTTP 200"

Write-Host "PASS: Setup_AtlasPythonCore3388_v0.3.0.exe built, installed, migrated, served, and verified on port 3388." -ForegroundColor Green





