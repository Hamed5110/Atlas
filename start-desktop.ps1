$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot
if (-not (Test-Path -LiteralPath ".venv\Scripts\python.exe")) {
    py -3.12 -m venv .venv
    .\.venv\Scripts\python.exe -m pip install -e ".[dev]"
}
$env:AIRFARE_API_BASE_URL = "http://127.0.0.1:3388"
.\.venv\Scripts\python.exe -m airfare_management.desktop.main
