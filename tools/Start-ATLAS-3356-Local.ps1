param(
    [string]$PayloadPath = "C:\Airfare_Allowance\artifacts\patch-2.3.92\payload"
)

$ErrorActionPreference = "Stop"

Set-Location $PayloadPath

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
