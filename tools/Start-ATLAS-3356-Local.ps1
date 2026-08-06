param(
    [string]$PayloadPath = "C:\Airfare_Allowance\artifacts\patch-2.3.92\payload"
)

$ErrorActionPreference = "Stop"

Set-Location $PayloadPath

$envFile = "C:\Airfare_Allowance\.env"
if (Test-Path -LiteralPath $envFile) {
    Get-Content -LiteralPath $envFile | ForEach-Object {
        $line = [string]$_
        if ([string]::IsNullOrWhiteSpace($line) -or $line.TrimStart().StartsWith("#") -or $line -notmatch "=") { return }
        $name, $value = $line.Split("=", 2)
        if (-not [string]::IsNullOrWhiteSpace($name)) {
            [Environment]::SetEnvironmentVariable($name.Trim(), $value, "Process")
        }
    }
}

$env:PORT = "3356"
$env:DB_SERVER = "localhost"
$env:DB_PORT = "1433"
$env:DB_NAME = "Atlasairfare010"
$env:DB_USER = "sa"
$env:DB_PASSWORD = "Atlas@25"

$env:ATLAS_ENABLE_CONTINUOUS_AIRFARE_ENTITLEMENT = "true"
$env:ATLAS_ENABLE_CONTINUOUS_AIRFARE_RECONCILIATION = "true"
$env:ATLAS_ENABLE_CONTINUOUS_AIRFARE_UI = "true"
$env:ATLAS_ENABLE_CONTINUOUS_AIRFARE_WRITES = "false"
$env:ATLAS_CONTINUOUS_AIRFARE_ADMIN_ONLY = "true"

node server.js
