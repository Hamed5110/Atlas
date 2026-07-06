param(
    [string]$OutputDir = "C:\Airfare_Allowance\artifacts\employee-portal-phase2"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null

$files = Get-ChildItem -LiteralPath $root -File -Recurse | Sort-Object FullName | ForEach-Object {
    $hash = Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName
    [pscustomobject]@{
        path = $_.FullName.Substring($root.Length + 1)
        length = $_.Length
        sha256 = $hash.Hash
    }
}

$report = [pscustomobject]@{
    extension = "employee-portal"
    phase = "phase-2-local-sandbox"
    createdAt = (Get-Date).ToString("o")
    fileCount = @($files).Count
    totalBytes = (@($files) | Measure-Object -Property length -Sum).Sum
    files = @($files)
}

$jsonPath = Join-Path $OutputDir "employee-portal-extension-audit-$stamp.json"
$report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $jsonPath -Encoding UTF8

$scriptChecks = @(
    @{ name = "backend syntax"; command = "node"; args = @("--check", (Join-Path $root "server\employee-portal-server.js")) },
    @{ name = "sql script present"; command = "powershell"; args = @("-NoProfile", "-Command", "if (!(Test-Path '$root\sql\ATLAS_Employee_Portal_Extension.sql')) { exit 1 }") }
)

foreach ($check in $scriptChecks) {
    Write-Host "[VERIFY] $($check.name)"
    & $check.command @($check.args)
    if ($LASTEXITCODE -ne 0) { throw "Verification failed: $($check.name)" }
}

Write-Host "[SUCCESS] Employee portal extension audit written: $jsonPath"
