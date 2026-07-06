param(
    [int]$Port = 3366,
    [string]$HostName = "127.0.0.1"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$server = Join-Path $root "server\employee-portal-server.js"
if (-not (Test-Path -LiteralPath $server)) { throw "Employee portal server not found: $server" }

$env:EXT_EMP_PORT = [string]$Port
$env:EXT_EMP_HOST = $HostName
Write-Host "[EXT] Starting Employee Portal on http://$HostName`:$Port"
node $server
