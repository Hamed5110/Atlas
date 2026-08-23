$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

function Write-StartupError {
    param([string]$Message, [string]$Hint)
    Write-Host ""
    Write-Host "HCM Airfare API failed to start." -ForegroundColor Red
    Write-Host $Message -ForegroundColor Yellow
    if ($Hint) {
        Write-Host $Hint -ForegroundColor Cyan
    }
    Write-Host ""
    exit 1
}

function Test-PortInUse {
    param([int]$Port)
    $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    return $null -ne $listener
}

function Wait-ApiReady {
    param([string]$Url, [int]$Seconds = 45)
    for ($attempt = 0; $attempt -lt $Seconds; $attempt++) {
        try {
            Invoke-RestMethod -Uri $Url -TimeoutSec 2 | Out-Null
            return $true
        } catch {
            Start-Sleep -Seconds 1
        }
    }
    return $false
}

if (-not (Test-Path -LiteralPath ".venv\Scripts\python.exe")) {
    Write-Host "Creating virtual environment..." -ForegroundColor Cyan
    py -3.12 -m venv .venv
    .\.venv\Scripts\python.exe -m pip install -e ".[dev]"
}

if (-not (Test-Path -LiteralPath ".env")) {
    Write-StartupError `
        "Missing .env file." `
        "Copy .env.example to .env, set AIRFARE_DATABASE_URL, then retry."
}

$python = ".\.venv\Scripts\python.exe"
$env:PYTHONPATH = "src"
$port = 3389
$baseUrl = "http://127.0.0.1:$port"

if (Test-PortInUse -Port $port) {
    Write-Host "Port $port is already in use — checking if HCM Airfare is healthy..." -ForegroundColor Yellow
    try {
        $health = Invoke-RestMethod -Uri "$baseUrl/health" -TimeoutSec 3
        Write-Host "API already running: $($health | ConvertTo-Json -Compress)" -ForegroundColor Green
        Write-Host "Open: $baseUrl/" -ForegroundColor Green
        Start-Process "$baseUrl/"
        exit 0
    } catch {
        Write-StartupError `
            "Port $port is occupied by another process that is not HCM Airfare." `
            "Stop the other process or change AIRFARE_PORT in .env, then retry."
    }
}

Write-Host "Checking database connectivity..." -ForegroundColor Cyan
$dbCheck = & $python -c @"
from sqlalchemy import create_engine, text
from airfare_management.config import get_settings
settings = get_settings()
engine = create_engine(settings.database_url, pool_pre_ping=True)
with engine.connect() as conn:
    conn.execute(text('SELECT 1'))
print('ok')
"@ 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host $dbCheck -ForegroundColor DarkYellow
    Write-StartupError `
        "Cannot reach SQL Server using AIRFARE_DATABASE_URL." `
        @(
            "Ensure SQL Server is running and ODBC Driver 18 is installed.",
            "Verify credentials in .env (password must be URL-encoded).",
            "For offline UI work only, set AIRFARE_DATABASE_URL=sqlite+pysqlite:///./var/local.db"
        ) -join "`n"
}

Write-Host "Applying Alembic migrations..." -ForegroundColor Cyan
$migrate = & $python -m alembic upgrade head 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host $migrate -ForegroundColor DarkYellow
    Write-StartupError `
        "Alembic migration failed." `
        "Review the traceback above. Common fixes: start SQL Server, fix .env URL, rerun."
}
Write-Host $migrate

Write-Host "Ensuring reporting views and stored procedures..." -ForegroundColor Cyan
$reporting = & $python scripts\apply_reporting_sql.py 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host $reporting -ForegroundColor DarkYellow
    Write-Host "Reporting SQL apply failed — continuing so the UI can still open." -ForegroundColor Yellow
} else {
    Write-Host $reporting
}

Write-Host "Ensuring entitlement engine SQL..." -ForegroundColor Cyan
$entitlement = & $python scripts\apply_entitlement_sql.py 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host $entitlement -ForegroundColor DarkYellow
    Write-Host "Entitlement SQL apply failed — Python fallback remains available." -ForegroundColor Yellow
} else {
    Write-Host $entitlement
}

Write-Host ""
Write-Host "Starting API on $baseUrl ..." -ForegroundColor Green
Write-Host "Web UI:     $baseUrl/" -ForegroundColor Green
Write-Host "API docs:   $baseUrl/docs" -ForegroundColor Green
Write-Host "Health:     $baseUrl/health" -ForegroundColor Green
Write-Host "Login user: admin  (password from AIRFARE_BOOTSTRAP_ADMIN_PASSWORD in .env)" -ForegroundColor Cyan
Write-Host ""

# Open browser once /health/live responds (do not block uvicorn).
Start-Job -Name "OpenBrowserWhenReady" -ScriptBlock {
    param($LiveUrl, $HomeUrl)
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        try {
            Invoke-RestMethod -Uri $LiveUrl -TimeoutSec 2 | Out-Null
            Start-Process $HomeUrl
            break
        } catch {
            Start-Sleep -Seconds 1
        }
    }
} -ArgumentList "$baseUrl/health/live", "$baseUrl/" | Out-Null

& $python -m uvicorn airfare_management.api.main:app --host 127.0.0.1 --port $port
