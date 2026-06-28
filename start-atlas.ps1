$ErrorActionPreference = "Stop"

Set-Location $PSScriptRoot

if (-not (Test-Path ".env")) {
    Write-Host "Missing .env file. Run setup-atlas.ps1 first." -ForegroundColor Yellow
    exit 1
}

if (-not (Test-Path "node_modules")) {
    Write-Host "Missing Node packages. Installing now..."
    npm install
}

$apiPort = 3355
if (Test-Path ".env") {
    $rawPort = (Select-String -Path ".env" -Pattern "^PORT=" | Select-Object -First 1).Line
    if ($rawPort -and $rawPort -match "^PORT=(\d+)$") { $apiPort = [int]$Matches[1] }
}

Write-Host "Starting ATLAS API (port: $apiPort)..."
Write-Host "Open http://localhost:$apiPort in your browser for API/health checks and service URL."
npm start
