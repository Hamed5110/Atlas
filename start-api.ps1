$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot
if (-not (Test-Path -LiteralPath ".venv\Scripts\python.exe")) {
    py -3.12 -m venv .venv
    .\.venv\Scripts\python.exe -m pip install -e ".[dev]"
}
if (-not (Test-Path -LiteralPath ".env")) {
    throw "Missing .env. Copy .env.example to .env and set the SQL Server password."
}
.\.venv\Scripts\python.exe -m alembic upgrade head
.\.venv\Scripts\python.exe -m uvicorn airfare_management.api.main:app --host 127.0.0.1 --port 3389 --reload
