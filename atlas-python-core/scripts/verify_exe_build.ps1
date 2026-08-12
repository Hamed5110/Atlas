param(
    [string]$InnoCompiler = "",
    [string]$InstallDir = "C:\Atlas3356",
    [string]$SqlHost = "localhost",
    [string]$SqlPort = "1433",
    [string]$DbName = "AtlasPythonCore3356",
    [string]$DbUser = "sa",
    [string]$DbPassword = "Atlas@25"
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $Root

function Find-InnoCompiler {
    if (-not [string]::IsNullOrWhiteSpace($InnoCompiler) -and (Test-Path $InnoCompiler)) {
        return $InnoCompiler
    }
    $candidates = @(
        "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe",
        "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
        "C:\Program Files\Inno Setup 6\ISCC.exe"
    )
    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) { return $candidate }
    }
    $command = Get-Command ISCC.exe -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    throw "ISCC.exe not found. Install Inno Setup 6 or pass -InnoCompiler."
}

function Invoke-Checked {
    param([string]$FilePath, [string[]]$Arguments)
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed with exit code $LASTEXITCODE`: $FilePath $($Arguments -join ' ')"
    }
}

.\.venv\Scripts\python.exe scripts\build_release_artifact.py
if ($LASTEXITCODE -ne 0) { throw "Release artifact build failed." }

$iscc = Find-InnoCompiler
Invoke-Checked $iscc @("installer\setup_atlas_3356.iss")

$setup = Join-Path $Root "dist\Setup_AtlasPythonCore3356_v0.3.0.exe"
if (-not (Test-Path $setup)) { throw "Setup EXE was not created: $setup" }

$setupArgs = @(
    "/VERYSILENT",
    "/SUPPRESSMSGBOXES",
    "/NORESTART",
    "/DIR=$InstallDir",
    "/SQLHOST=$SqlHost",
    "/SQLPORT=$SqlPort",
    "/DBNAME=$DbName",
    "/DBUSER=$DbUser",
    "/DBPASSWORD=$DbPassword",
    "/APPPORT=3356"
)
Invoke-Checked $setup $setupArgs

$odbc = "Driver={ODBC Driver 18 for SQL Server};Server=$SqlHost,$SqlPort;Database=$DbName;Uid=$DbUser;Pwd=$DbPassword;Encrypt=yes;TrustServerCertificate=yes;"
Write-Host "ODBC custom-port connection string generated: $($odbc -replace [regex]::Escape($DbPassword), '***')"

$service = Get-Service -Name AtlasPythonCore3356 -ErrorAction Stop
if ($service.Status -ne "Running") {
    throw "AtlasPythonCore3356 service is not running. Current status: $($service.Status)"
}

$health = Invoke-RestMethod -Uri "http://127.0.0.1:3356/api/v1/health" -TimeoutSec 20
if ($health.status -ne "ok" -or $health.port -ne 3356 -or $health.oldRuntimeLinked -ne $false -or $health.legacyBatchCloseLinked -ne $false) {
    throw "Health verification failed: $($health | ConvertTo-Json -Depth 6)"
}

Write-Host "PASS: Setup_AtlasPythonCore3356_v0.3.0.exe compiled, installed, and verified on port 3356."
