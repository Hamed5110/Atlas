<#
.SYNOPSIS
  End-to-end local verification for HCM Airfare (API + web shell).
#>
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root
$env:PYTHONPATH = "src"
$python = Join-Path $root ".venv\Scripts\python.exe"
$base = "http://127.0.0.1:3389"
$failed = 0

function Assert-Ok {
    param([string]$Name, [scriptblock]$Block)
    try {
        & $Block
        Write-Host "PASS  $Name" -ForegroundColor Green
    } catch {
        $script:failed++
        Write-Host "FAIL  $Name  $($_.Exception.Message)" -ForegroundColor Red
    }
}

Write-Host "=== HCM Airfare local verification ===" -ForegroundColor Cyan

Assert-Ok "health" {
    $h = Invoke-RestMethod "$base/health"
    if ($h.status -ne "ok") { throw "unexpected health payload" }
}
Assert-Ok "live" { Invoke-RestMethod "$base/health/live" | Out-Null }
Assert-Ok "ready" { Invoke-RestMethod "$base/ready" | Out-Null }
Assert-Ok "home html" {
    $html = (Invoke-WebRequest "$base/" -UseBasicParsing).Content
    if ($html -notmatch "assets/app\.js") { throw "shell missing app.js" }
}
Assert-Ok "app.js" {
    $js = Invoke-WebRequest "$base/assets/app.js" -UseBasicParsing
    if ($js.StatusCode -ne 200 -or $js.Content.Length -lt 1000) { throw "app.js missing" }
}
Assert-Ok "login + modules" {
    if (-not (Test-Path -LiteralPath $python)) { throw "venv python missing at $python" }
    $payload = & $python -c @"
import json, urllib.request
from airfare_management.config import get_settings
s = get_settings()
body = json.dumps({'username': s.bootstrap_admin_username, 'password': s.bootstrap_admin_password}).encode()
req = urllib.request.Request('$base/v1/auth/login', data=body, headers={'Content-Type':'application/json'}, method='POST')
login = json.loads(urllib.request.urlopen(req, timeout=15).read())
token = login['access_token']
headers = {'Authorization': f'Bearer {token}'}
for path in [
    '/v1/auth/me', '/v1/dashboard', '/v1/employees', '/v1/companies',
    '/v1/opening-balances', '/v1/tickets', '/v1/loans',
    '/v1/preferences/effective', '/v1/admin/backups',
    '/v1/lookup-types', '/v1/lookups/departments', '/v1/entitlement-rates',
]:
    urllib.request.urlopen(urllib.request.Request('$base' + path, headers=headers), timeout=15).read()
emps = json.loads(urllib.request.urlopen(urllib.request.Request('$base/v1/employees?limit=1', headers=headers), timeout=15).read())
assert isinstance(emps, list) and len(emps) >= 1, 'expected seeded employees'
assert 'full_name' in emps[0] and 'code' in emps[0]
print('ok')
"@
    if ($payload -notmatch "ok") { throw "auth smoke failed: $payload" }
}

if ($failed -gt 0) {
    Write-Host ""
    Write-Host "$failed check(s) failed. Is the API running? Start with .\start-api.ps1" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "All checks passed. Open $base/" -ForegroundColor Green
exit 0
