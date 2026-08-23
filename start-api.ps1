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
    Write-StartupError `
        "Reporting SQL apply step failed." `
        "Check sql/reporting_views.sql and sql/reporting_procedures.sql for syntax errors."
}
Write-Host $reporting

Write-Host "Starting API on http://127.0.0.1:3389 ..." -ForegroundColor Green
Start-Job -Name "OpenBrowserWhenReady" -ScriptBlock {
    for ($attempt = 0; $attempt -lt 45; $attempt++) {
        try {
            Invoke-RestMethod -Uri "http://127.0.0.1:3389/health/live" -TimeoutSec 2 | Out-Null
            Start-Process "http://127.0.0.1:3389"
            break
        } catch {
            Start-Sleep -Seconds 1
        }
    }
} | Out-Null
& $python -m uvicorn airfare_management.api.main:app --host 127.0.0.1 --port 3389 --reload
