$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot
if (-not (Test-Path -LiteralPath ".venv\Scripts\python.exe")) {
    py -3.12 -m venv .venv
    .\.venv\Scripts\python.exe -m pip install -e ".[dev]"
}
if (-not (Test-Path -LiteralPath ".env")) {
    throw "Missing .env. Copy .env.example and configure Redis and MSSQL."
}
.\.venv\Scripts\python.exe -m celery `
    -A airfare_management.infrastructure.tasks:celery_app worker --loglevel=INFO
