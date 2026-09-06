$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Test-Path ".env")) {
    if (Test-Path "..\.env") {
        Copy-Item "..\.env" ".env"
        (Get-Content ".env") -replace '^PORT=.*', 'PORT=3360' | Set-Content ".env"
        Write-Host "Copied parent .env and set PORT=3360"
    } else {
        Copy-Item ".env.example" ".env"
        Write-Host "Created .env from example — edit DB credentials before use."
    }
}

if (-not (Test-Path "node_modules")) {
    Write-Host "Installing dependencies..."
    npm install
}

if (-not (Test-Path "apps\web\out\index.html")) {
    Write-Host "Building web frontend..."
    npm run build --workspace @atlas/web
}

if (-not (Test-Path "apps\api\dist\index.js")) {
    Write-Host "Building API..."
    npm run build --workspace @atlas/shared
    npm run build --workspace @atlas/api
}

$port = 3360
if (Test-Path ".env") {
    $line = Select-String -Path ".env" -Pattern "^PORT=" | Select-Object -First 1
    if ($line -and $line.Line -match "^PORT=(\d+)$") { $port = [int]$Matches[1] }
}

Write-Host "Starting ATLAS Platform on http://localhost:$port"
npm run start --workspace @atlas/api
