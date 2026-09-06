# ATLAS HCM - One Health Check (Windows / port 3389 only)
# Adapted from ATLAS_HCM_Port_3389_Fix_Prompt.md:
#   FastAPI already owns :3389 - do NOT replace it with npx serve.
#   Build atlas-next -> deploy web_dist_next -> count testids -> list specs -> smoke + year-end.

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $Root "atlas-next\package.json"))) {
  $Root = "C:\Airfare_Allowance"
}
$AtlasNext = Join-Path $Root "atlas-next"
$OutDir = Join-Path $AtlasNext "out"
$DeployDir = "C:\HCM Airfare\src\airfare_management\interface\web_dist_next"
$Base = "http://127.0.0.1:3389"

Write-Host "== Phase 0: free :3355 only (keep FastAPI on :3389) ==" -ForegroundColor Cyan
Get-NetTCPConnection -LocalPort 3355 -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
$still3355 = Get-NetTCPConnection -LocalPort 3355 -ErrorAction SilentlyContinue
if ($still3355) { throw "Port 3355 still occupied after kill" }
$p3389 = Get-NetTCPConnection -LocalPort 3389 -State Listen -ErrorAction SilentlyContinue
if (-not $p3389) { throw "Port 3389 is not listening - start HCM FastAPI first" }

Write-Host "== Phase 1: purge caches + build atlas-next ==" -ForegroundColor Cyan
Push-Location $AtlasNext
try {
  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue .\.next, .\out, .\node_modules\.cache
  npm run build
  if ($LASTEXITCODE -ne 0) { throw "atlas-next build failed" }
  if (-not (Test-Path (Join-Path $OutDir "index.html"))) { throw "Missing out/index.html" }
} finally {
  Pop-Location
}

Write-Host "== Phase 1b: deploy to HCM web_dist_next ==" -ForegroundColor Cyan
if (-not (Test-Path $DeployDir)) { New-Item -ItemType Directory -Path $DeployDir -Force | Out-Null }
robocopy $OutDir $DeployDir /MIR /NFL /NDL /NJH /NJS | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy failed with exit $LASTEXITCODE" }
$script:LASTEXITCODE = 0

Write-Host "== Phase 2: data-testid count in production build (>= 50) ==" -ForegroundColor Cyan
$testidHits = 0
Get-ChildItem -Path $OutDir -Recurse -Include *.html,*.js | ForEach-Object {
  $text = Get-Content -Raw -LiteralPath $_.FullName -ErrorAction SilentlyContinue
  if ($text) {
    $testidHits += ([regex]::Matches($text, "data-testid")).Count
  }
}
Write-Host "data-testid_count=$testidHits"
if ($testidHits -lt 50) { throw "Need >= 50 data-testid in out/; got $testidHits" }

Write-Host "== Phase 3: live :3389 responds ==" -ForegroundColor Cyan
$live = curl.exe -s -o NUL -w "%{http_code}" "$Base/login/"
if ($live -ne "200") { throw "GET $Base/login/ returned $live" }

Write-Host "== Phase 4: Playwright spec discovery (>= 11) ==" -ForegroundColor Cyan
Push-Location $Root
try {
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  $seedPy = "C:\HCM Airfare\tests\write_e2e_auth_seed.py"
  $venvPy = "C:\HCM Airfare\.venv\Scripts\python.exe"
  if ((Test-Path $venvPy) -and (Test-Path $seedPy)) {
    Write-Host "Refreshing E2E auth seed (1440m TTL)..."
    Push-Location "C:\HCM Airfare"
    try {
      & $venvPy $seedPy (Join-Path $Root "tests\e2e\.auth.json") | Out-Host
    } finally {
      Pop-Location
    }
  }
  $list = & npx playwright test --list --project=chromium 2>&1 | Out-String
  $ErrorActionPreference = $prevEap
  $specLines = ([regex]::Matches($list, "\.spec\.ts")).Count
  $uniqueSpecs = @(Get-ChildItem -Path (Join-Path $Root "tests\e2e") -Filter "*.spec.ts").Count
  Write-Host "spec_path_mentions=$specLines"
  Write-Host "spec_files=$uniqueSpecs"
  if ($uniqueSpecs -lt 11) { throw "Need >= 11 spec files; got $uniqueSpecs" }

  Write-Host "== Phase 5: smoke + year-end @critical ==" -ForegroundColor Cyan
  $env:ATLAS_E2E_BASE_URL = $Base
  $ErrorActionPreference = "Continue"
  & npx playwright test tests/e2e/frontend-smoke.spec.ts tests/e2e/year-end-close.spec.ts --project=chromium
  $pwExit = $LASTEXITCODE
  $ErrorActionPreference = $prevEap
  if ($pwExit -ne 0) { throw "smoke + year-end failed (exit $pwExit)" }
} finally {
  Pop-Location
}

Write-Host "HEALTH CHECK OK - :3389 build deployed, testids=$testidHits, specs=$uniqueSpecs" -ForegroundColor Green
