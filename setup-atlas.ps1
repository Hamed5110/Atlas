param(
    [string]$Server = "localhost",
    [string]$Database = "Atlasairfare010",
    [string]$AppUser = "sa",
    [string]$AppPassword,
    [switch]$UseSqlAdmin,
    [string]$SqlAdminUser = "sa",
    [string]$SqlAdminPassword
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function New-RandomSecret {
    $bytes = New-Object byte[] 48
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    [Convert]::ToBase64String($bytes)
}

function Invoke-AtlasSql {
    param(
        [string]$Query,
        [string]$InputFile,
        [string]$DatabaseName
    )

    $args = @("-S", $Server, "-b", "-W")
    if ($DatabaseName) {
        $args += @("-d", $DatabaseName)
    }

    if ($UseSqlAdmin) {
        if (-not $SqlAdminPassword) {
            $SqlAdminPassword = Read-Host "Enter SQL admin password for $SqlAdminUser"
        }
        $args += @("-U", $SqlAdminUser, "-P", $SqlAdminPassword)
    }
    else {
        $args += "-E"
    }

    if ($Query) { $args += @("-Q", $Query) }
    if ($InputFile) { $args += @("-i", $InputFile) }

    & sqlcmd @args
    if ($LASTEXITCODE -ne 0) {
        throw "sqlcmd failed with exit code $LASTEXITCODE."
    }
}

Write-Host "Checking required tools..."
foreach ($tool in @("node", "npm", "sqlcmd")) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
        throw "$tool is required but was not found in PATH."
    }
}

if (-not $AppPassword) {
    $securePassword = Read-Host "Enter password for SQL login '$AppUser'" -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
    $AppPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}

Write-Host "Installing Node packages..."
npm install

Write-Host "Checking SQL Server connection..."
$securityMode = Invoke-AtlasSql -Query "SET NOCOUNT ON; SELECT CAST(SERVERPROPERTY('IsIntegratedSecurityOnly') AS int);" | Where-Object { $_ -match "^\s*[01]\s*$" } | Select-Object -Last 1
if ($securityMode -and $securityMode.Trim() -eq "1") {
    Write-Host "Warning: SQL Server is Windows Authentication only. Enable Mixed Mode Authentication for the SQL login '$AppUser' to connect." -ForegroundColor Yellow
}

Write-Host "Creating database if needed..."
$dbExists = Invoke-AtlasSql -Query "SET NOCOUNT ON; SELECT CASE WHEN DB_ID(N'$Database') IS NULL THEN 0 ELSE 1 END;" | Where-Object { $_ -match "^\s*[01]\s*$" } | Select-Object -Last 1
if (-not $dbExists -or $dbExists.Trim() -eq "0") {
    Write-Host "Creating $Database with included schema (ATLAS_MSSQL_Schema.sql)..."
    Invoke-AtlasSql -InputFile ".\database\ATLAS_MSSQL_Schema.sql"
} else {
    Write-Host "Database already exists; schema creation skipped."
}

Write-Host "Applying SQL objects (tables/views/procedures/functions)..."
$dbScripts = @(
    ".\database\ATLAS_HCM_SQL_Objects.sql",
    ".\database\ATLAS_Loan_SQL_Objects.sql",
    ".\database\ATLAS_Allocation_Attachments.sql",
    ".\database\ATLAS_Company_Admin.sql"
)
foreach ($script in $dbScripts) {
    Invoke-AtlasSql -InputFile $script
}

Write-Host "Creating SQL login and DB permissions..."
$escapedPassword = $AppPassword.Replace("'", "''")
$escapedUser = $AppUser.Replace("'", "''")
if ($AppUser -ieq 'sa') {
    Write-Host "Skipping login/user recreation for special principal 'sa'; using SQL Server default mapping."
} else {
    $permissionSql = @"
USE master;
IF NOT EXISTS (SELECT 1 FROM sys.sql_logins WHERE name = N'$escapedUser')
BEGIN
    DECLARE @createLoginSql nvarchar(max) = N'CREATE LOGIN [$escapedUser] WITH PASSWORD = N''' + N'$escapedPassword' + N''', CHECK_POLICY = OFF, CHECK_EXPIRATION = OFF';
    EXEC (@createLoginSql);
END
ELSE
BEGIN
    DECLARE @alterLoginSql nvarchar(max) = N'ALTER LOGIN [$escapedUser] WITH PASSWORD = N''' + N'$escapedPassword' + N''', CHECK_POLICY = OFF, CHECK_EXPIRATION = OFF';
    EXEC (@alterLoginSql);
END

USE [$Database];
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'$escapedUser')
BEGIN
    CREATE USER [$escapedUser] FOR LOGIN [$escapedUser];
END
ALTER ROLE db_datareader ADD MEMBER [$escapedUser];
ALTER ROLE db_datawriter ADD MEMBER [$escapedUser];
GRANT EXECUTE TO [$escapedUser];
"@
    Invoke-AtlasSql -Query $permissionSql
}

Write-Host "Ensuring default admin account is available..."
$adminHash = '$2a$12$alD05qG4/7MmpjKlKJuqv.YFoTpNglaKdLcfc6xJXKtUpi.X83T8C'
$adminSql = @"
USE [$Database];
IF EXISTS (SELECT 1 FROM Users WHERE Username = N'admin')
BEGIN
    UPDATE Users
    SET PasswordHash = N'$adminHash',
        Email = COALESCE(NULLIF(Email, N''), N'admin@atlas.com'),
        FullName = COALESCE(NULLIF(FullName, N''), N'System Administrator'),
        Role = N'admin',
        IsActive = 1,
        LoginAttempts = 0,
        LockedUntil = NULL
    WHERE Username = N'admin';
END
ELSE
BEGIN
    INSERT INTO Users (Username, PasswordHash, Email, FullName, Role, IsActive)
    VALUES (N'admin', N'$adminHash', N'admin@atlas.com', N'System Administrator', N'admin', 1);
END
"@
Invoke-AtlasSql -Query $adminSql

Write-Host "Writing environment file..."
$jwtSecret = New-RandomSecret
$envContent = @"
PORT=3355
DB_SERVER=$Server
DB_PORT=1433
DB_NAME=$Database
DB_USER=$AppUser
DB_PASSWORD=$AppPassword
DB_ENCRYPT=false
DB_TRUST_SERVER_CERTIFICATE=true
JWT_SECRET=$jwtSecret
JWT_EXPIRES_IN=8h
CORS_ORIGIN=*
MAX_LOGIN_ATTEMPTS=5
LOCKOUT_MINUTES=30
"@
Set-Content -Path ".env" -Value $envContent -Encoding ASCII

if (-not (Test-Path "logs")) {
    New-Item -ItemType Directory -Path "logs" | Out-Null
}

Write-Host ""
Write-Host "Setup complete." -ForegroundColor Green
Write-Host "Start the system with: powershell -ExecutionPolicy Bypass -File .\\start-atlas.ps1"
Write-Host "Then open: http://localhost:3355"
Write-Host "Default login: admin / Admin@123"
Write-Host "Change the admin password after first login."
