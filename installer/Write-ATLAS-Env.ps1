param(
    [string]$InstallRoot,
    [string]$AppPort,
    [string]$DbServer,
    [string]$DbPort,
    [string]$DbName,
    [string]$DbUser,
    [string]$DbPassword,
    [string]$OdbcDriver,
    [string]$AutoSetup
)

$ErrorActionPreference = "Stop"

function New-RandomSecret {
    $bytes = New-Object byte[] 48
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    [Convert]::ToBase64String($bytes)
}

function Get-AtlasConfigValue {
    param([string]$Name, [string]$CurrentValue)
    if ($CurrentValue) { return $CurrentValue }
    foreach ($path in @(
        "HKLM:\SOFTWARE\ATLAS Airfare Allowance",
        "HKLM:\SOFTWARE\WOW6432Node\ATLAS Airfare Allowance"
    )) {
        try {
            if (Test-Path $path) {
                $value = (Get-ItemProperty -Path $path -Name $Name -ErrorAction SilentlyContinue).$Name
                if ($null -ne $value -and "$value" -ne "") { return "$value" }
            }
        } catch {
        }
    }
    return $CurrentValue
}

if (-not $InstallRoot) { throw "InstallRoot is required." }
$AppPort = Get-AtlasConfigValue -Name "ATLASPORT" -CurrentValue $AppPort
$DbServer = Get-AtlasConfigValue -Name "DB_SERVER" -CurrentValue $DbServer
$DbPort = Get-AtlasConfigValue -Name "DB_PORT" -CurrentValue $DbPort
$DbName = Get-AtlasConfigValue -Name "DB_NAME" -CurrentValue $DbName
$DbUser = Get-AtlasConfigValue -Name "DB_USER" -CurrentValue $DbUser
$DbPassword = Get-AtlasConfigValue -Name "DB_PASSWORD" -CurrentValue $DbPassword
$OdbcDriver = Get-AtlasConfigValue -Name "DB_ODBC_DRIVER" -CurrentValue $OdbcDriver
$AutoSetup = Get-AtlasConfigValue -Name "DB_AUTO_SETUP" -CurrentValue $AutoSetup

if (-not $AppPort) { $AppPort = "3355" }
if (-not $DbServer) { $DbServer = "localhost\ATLAS" }
if (-not $DbPort) { $DbPort = "1433" }
if (-not $DbName) { $DbName = "Atlasairfare3356" }
if (-not $DbUser) { $DbUser = "sa" }
if (-not $OdbcDriver) { $OdbcDriver = "ODBC Driver 18 for SQL Server" }
if (-not $AutoSetup) { $AutoSetup = "1" }

New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null
foreach ($folder in @("logs", "backups", "test-reports")) {
    New-Item -ItemType Directory -Path (Join-Path $InstallRoot $folder) -Force | Out-Null
}

$envContent = @"
PORT=$AppPort
DB_SERVER=$DbServer
DB_PORT=$DbPort
DB_NAME=$DbName
DB_USER=$DbUser
DB_PASSWORD=$DbPassword
DB_ODBC_DRIVER=$OdbcDriver
DB_AUTO_SETUP=$AutoSetup
DB_ENCRYPT=false
DB_TRUST_SERVER_CERTIFICATE=true
JWT_SECRET=$(New-RandomSecret)
JWT_EXPIRES_IN=8h
CORS_ORIGIN=*
MAX_LOGIN_ATTEMPTS=5
LOCKOUT_MINUTES=30
"@

Set-Content -Path (Join-Path $InstallRoot ".env") -Value $envContent -Encoding ASCII
