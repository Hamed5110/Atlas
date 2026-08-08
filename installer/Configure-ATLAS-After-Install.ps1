param(
    [string]$InstallRoot = (Split-Path -Parent $MyInvocation.MyCommand.Path)
)

$ErrorActionPreference = "Stop"

function Read-DefaultedValue {
    param([string]$Prompt, [string]$Default)
    $value = Read-Host "$Prompt [$Default]"
    if ([string]::IsNullOrWhiteSpace($value)) { return $Default }
    return $value.Trim()
}

function Read-DefaultedInt {
    param([string]$Prompt, [int]$Default)
    $raw = Read-DefaultedValue -Prompt $Prompt -Default ([string]$Default)
    $parsed = 0
    if (-not [int]::TryParse($raw, [ref]$parsed) -or $parsed -lt 1 -or $parsed -gt 65535) {
        throw "$Prompt must be a TCP port number from 1 to 65535."
    }
    return $parsed
}

function New-RandomSecret {
    $bytes = New-Object byte[] 48
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    [Convert]::ToBase64String($bytes)
}

function Get-InstalledOdbcDrivers {
    $drivers = @()
    foreach ($path in @(
        "HKLM:\SOFTWARE\ODBC\ODBCINST.INI\ODBC Drivers",
        "HKLM:\SOFTWARE\WOW6432Node\ODBC\ODBCINST.INI\ODBC Drivers"
    )) {
        if (Test-Path $path) {
            $props = Get-ItemProperty -Path $path
            $drivers += $props.PSObject.Properties |
                Where-Object { $_.Name -notmatch "^PS" -and $_.Value -eq "Installed" } |
                ForEach-Object { $_.Name }
        }
    }
    return @($drivers | Sort-Object -Unique)
}

Set-Location $InstallRoot

Write-Host ""
Write-Host "ATLAS first-run configuration" -ForegroundColor Cyan
Write-Host "This writes the local .env file used by the bundled server."
Write-Host ""

$appPort = Read-DefaultedInt -Prompt "ATLAS application port" -Default 3355
$dbServer = Read-DefaultedValue -Prompt "MSSQL server host or instance" -Default "localhost\ATLAS"
$dbPort = Read-DefaultedInt -Prompt "MSSQL TCP port" -Default 1433
$dbName = Read-DefaultedValue -Prompt "MSSQL database name" -Default "Atlasairfare3356"
$dbUser = Read-DefaultedValue -Prompt "MSSQL login" -Default "sa"
$securePassword = Read-Host "MSSQL password for '$dbUser'" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
$dbPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)

$drivers = Get-InstalledOdbcDrivers
$recommendedDriver = @($drivers | Where-Object { $_ -match "ODBC Driver (18|17) for SQL Server" } | Select-Object -First 1)[0]
if (-not $recommendedDriver) { $recommendedDriver = "ODBC Driver 18 for SQL Server" }
$odbcDriver = Read-DefaultedValue -Prompt "ODBC driver name for MSSQL" -Default $recommendedDriver

if ($drivers.Count -gt 0 -and -not ($drivers -contains $odbcDriver)) {
    Write-Host "Warning: '$odbcDriver' was not found in installed ODBC drivers." -ForegroundColor Yellow
    Write-Host "Installed drivers: $($drivers -join ', ')" -ForegroundColor Yellow
}

$autoSetup = Read-DefaultedValue -Prompt "Auto setup local SQL Express if missing? (1=yes, 0=no)" -Default "1"

$envContent = @"
PORT=$appPort
DB_SERVER=$dbServer
DB_PORT=$dbPort
DB_NAME=$dbName
DB_USER=$dbUser
DB_PASSWORD=$dbPassword
DB_ODBC_DRIVER=$odbcDriver
DB_AUTO_SETUP=$autoSetup
DB_ENCRYPT=false
DB_TRUST_SERVER_CERTIFICATE=true
JWT_SECRET=$(New-RandomSecret)
JWT_EXPIRES_IN=8h
CORS_ORIGIN=*
MAX_LOGIN_ATTEMPTS=5
LOCKOUT_MINUTES=30
"@

Set-Content -Path (Join-Path $InstallRoot ".env") -Value $envContent -Encoding ASCII
foreach ($folder in @("logs", "backups", "test-reports")) {
    New-Item -ItemType Directory -Path (Join-Path $InstallRoot $folder) -Force | Out-Null
}

Write-Host ""
Write-Host "Configuration complete." -ForegroundColor Green
if (Test-Path (Join-Path $InstallRoot "Verify-ATLAS-Installed.ps1")) {
    Write-Host ""
    Write-Host "Verifying ODBC driver, MSSQL login, and app port..."
    powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $InstallRoot "Verify-ATLAS-Installed.ps1") -InstallRoot $InstallRoot -SkipAppHealth
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Database configuration successful." -ForegroundColor Green
    } else {
        Write-Host "Configuration was saved, but verification failed. Check the report above." -ForegroundColor Red
    }
}
Write-Host "Start ATLAS from the installed Start-ATLAS.bat shortcut or run:"
Write-Host "  $InstallRoot\Start-ATLAS.bat"
Write-Host ""
Read-Host "Press Enter to close"
