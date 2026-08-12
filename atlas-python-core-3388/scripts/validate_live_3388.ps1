$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $Root

function Invoke-Checked {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments
    )

    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed with exit code $LASTEXITCODE`: $FilePath $($Arguments -join ' ')"
    }
}

$Python = Join-Path $Root ".venv\Scripts\python.exe"
if (-not (Test-Path $Python)) {
    py -3.12 -m venv .venv
}

Invoke-Checked $Python -m pip install -r requirements.txt
Invoke-Checked $Python scripts\migrate_and_seed.py

$listener = Get-NetTCPConnection -LocalPort 3388 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
    Stop-Process -Id $listener.OwningProcess -Force
    Start-Sleep -Seconds 2
}

$processInfo = New-Object System.Diagnostics.ProcessStartInfo
$processInfo.FileName = $Python
$processInfo.WorkingDirectory = $Root
$processInfo.UseShellExecute = $false
$processInfo.CreateNoWindow = $true
$processInfo.Arguments = "-m app.server"
$processInfo.Environment["PORT"] = "3388"
$processInfo.Environment["ATLAS_PYTHON_PORT"] = "3388"
$processInfo.Environment["ATLAS_PYTHON_DB_SERVER"] = "localhost"
$processInfo.Environment["ATLAS_PYTHON_DB_PORT"] = "1433"
$processInfo.Environment["ATLAS_PYTHON_DB_USER"] = "sa"
$processInfo.Environment["ATLAS_PYTHON_DB_PASSWORD"] = "Atlas@25"
$processInfo.Environment["ATLAS_PYTHON_DB_NAME"] = "AtlasPythonCore3388"
$processInfo.Environment["ATLAS_PYTHON_DB_ENCRYPT"] = "yes"
$processInfo.Environment["ATLAS_PYTHON_DB_TRUST_CERT"] = "yes"
$processInfo.Environment["JWT_SECRET"] = "local-phase3-validation-secret-change-before-production"
$processInfo.Environment["ATLAS_UVICORN_WORKERS"] = "1"

$server = [System.Diagnostics.Process]::Start($processInfo)
try {
    $ready = $false
    for ($attempt = 1; $attempt -le 20; $attempt++) {
        try {
            $health = Invoke-RestMethod -Uri "http://127.0.0.1:3388/api/v1/health" -TimeoutSec 3
            if ($health.status -eq "ok" -and $health.port -eq 3388 -and $health.runtimeIsolated -eq $true -and $health.continuousModelOnly -eq $true) {
                $ready = $true
                break
            }
        } catch {
            Start-Sleep -Seconds 1
        }
    }
    if (-not $ready) {
        throw "FastAPI service on port 3388 did not become ready."
    }

    $env:ATLAS_RUN_LIVE_3388_TESTS = "true"
    $env:ATLAS_LIVE_3388_BASE_URL = "http://127.0.0.1:3388"

    Invoke-Checked $Python -m pytest -q
    Invoke-Checked $Python -m pytest tests\test_live_system_3388.py -q

    Write-Host "PASS: live 3388 FastAPI + MSSQL validation succeeded."
} finally {
    if ($server -and -not $server.HasExited) {
        Stop-Process -Id $server.Id -Force
    }
}



