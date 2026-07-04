param(
    [string]$Server = "localhost\ATLAS",
    [int]$DbPort = 1433,
    [string]$Database = "Atlasairfare010",
    [string]$AppUser = "sa",
    [string]$AppPassword,
    [int]$Port = 3355,
    [string]$OdbcDriver,
    [switch]$UseSqlAdmin,
    [string]$SqlAdminUser = "sa",
    [string]$SqlAdminPassword,
    [switch]$Repair,
    [switch]$Troubleshoot,
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function New-RandomSecret {
    $bytes = New-Object byte[] 48
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    [Convert]::ToBase64String($bytes)
}

function Get-SqlEndpoint {
    if ($Server -match ",\d+$" -or $Server -match "\\") {
        return $Server
    }
    if ($DbPort -and $DbPort -ne 1433) {
        return "$Server,$DbPort"
    }
    return $Server
}

function Read-DefaultedValue {
    param(
        [string]$Prompt,
        [string]$Default
    )
    $value = Read-Host "$Prompt [$Default]"
    if ([string]::IsNullOrWhiteSpace($value)) { return $Default }
    return $value.Trim()
}

function Read-DefaultedInt {
    param(
        [string]$Prompt,
        [int]$Default
    )
    $raw = Read-DefaultedValue -Prompt $Prompt -Default ([string]$Default)
    $parsed = 0
    if (-not [int]::TryParse($raw, [ref]$parsed) -or $parsed -lt 1 -or $parsed -gt 65535) {
        throw "$Prompt must be a TCP port number from 1 to 65535."
    }
    return $parsed
}

function Get-InstalledOdbcDrivers {
    $drivers = @()
    $paths = @(
        "HKLM:\SOFTWARE\ODBC\ODBCINST.INI\ODBC Drivers",
        "HKLM:\SOFTWARE\WOW6432Node\ODBC\ODBCINST.INI\ODBC Drivers"
    )
    foreach ($path in $paths) {
        if (Test-Path $path) {
            $props = Get-ItemProperty -Path $path
            $drivers += $props.PSObject.Properties |
                Where-Object { $_.Name -notmatch "^PS" -and $_.Value -eq "Installed" } |
                ForEach-Object { $_.Name }
        }
    }
    return @($drivers | Sort-Object -Unique)
}

function Write-SetupReport {
    param([string]$Mode, [object[]]$Checks)
    $reportDir = Join-Path $PSScriptRoot "test-reports"
    New-Item -ItemType Directory -Path $reportDir -Force | Out-Null
    $stamp = Get-Date -Format "yyyyMMddHHmmss"
    $reportPath = Join-Path $reportDir "atlas-setup-$Mode-$stamp.md"
    $jsonPath = Join-Path $reportDir "atlas-setup-$Mode-$stamp.json"
    $result = if (($Checks | Where-Object { $_.status -eq "FAIL" }).Count -gt 0) { "FAILED" } else { "PASSED" }
    $lines = @(
        "# ATLAS Setup $Mode Report",
        "",
        "- Created: $((Get-Date).ToString("o"))",
        "- Result: $result",
        "- Root: $PSScriptRoot",
        "",
        "| Check | Status | Details |",
        "|---|---|---|"
    )
    foreach ($check in $Checks) {
        $details = if ($null -ne $check.details) { ($check.details | ConvertTo-Json -Depth 5 -Compress) } else { "" }
        $lines += "| $($check.name) | $($check.status) | $details |"
    }
    $lines | Set-Content -Path $reportPath -Encoding UTF8
    [pscustomobject]@{
        createdAt = (Get-Date).ToString("o")
        result = $result
        checks = $Checks
    } | ConvertTo-Json -Depth 8 | Set-Content -Path $jsonPath -Encoding UTF8
    Write-Host "Setup report: $reportPath"
    Write-Host "Setup JSON:   $jsonPath"
    return $result
}

function Invoke-InstallTroubleshooter {
    $checks = New-Object System.Collections.Generic.List[object]
    function Add-SetupCheck {
        param([string]$Name, [string]$Status, [object]$Details = $null)
        $checks.Add([pscustomobject]@{ name = $Name; status = $Status; details = $Details }) | Out-Null
        Write-Host "[$Status] $Name"
    }

    foreach ($tool in @("node", "npm", "sqlcmd")) {
        $command = Get-Command $tool -ErrorAction SilentlyContinue
        if ($command) {
            Add-SetupCheck "Required tool: $tool" "PASS" @{ path = $command.Source }
        } else {
            Add-SetupCheck "Required tool: $tool" "FAIL" @{ message = "$tool was not found in PATH." }
        }
    }

    $drivers = Get-InstalledOdbcDrivers
    if ($drivers.Count -gt 0) {
        Add-SetupCheck "ODBC SQL Server driver availability" "PASS" @{ drivers = $drivers }
    } else {
        Add-SetupCheck "ODBC SQL Server driver availability" "WARN" @{ message = "No installed ODBC drivers were found in registry." }
    }

    foreach ($folder in @("database", "atlas-hcm-next", "tests", "tools")) {
        $path = Join-Path $PSScriptRoot $folder
        Add-SetupCheck "Required folder: $folder" ($(if (Test-Path $path) { "PASS" } else { "FAIL" })) @{ path = $path }
    }

    foreach ($file in @("server.js", "package.json", "atlas-hcm-next\package.json", "database\ATLAS_MSSQL_Schema.sql")) {
        $path = Join-Path $PSScriptRoot $file
        Add-SetupCheck "Required file: $file" ($(if (Test-Path $path) { "PASS" } else { "FAIL" })) @{ path = $path }
    }

    try {
        npm cache verify | Out-Null
        Add-SetupCheck "NPM cache health" "PASS"
    } catch {
        Add-SetupCheck "NPM cache health" "WARN" @{ error = $_.Exception.Message }
    }

    try {
        $connection = Test-NetConnection -ComputerName $Server -Port $DbPort -WarningAction SilentlyContinue
        if ($connection.TcpTestSucceeded) {
            Add-SetupCheck "SQL TCP connection $Server`:$DbPort" "PASS"
        } else {
            Add-SetupCheck "SQL TCP connection $Server`:$DbPort" "WARN" @{ message = "TCP connection did not succeed. SQL setup may still work through local named pipes or a named instance." }
        }
    } catch {
        Add-SetupCheck "SQL TCP connection $Server`:$DbPort" "WARN" @{ error = $_.Exception.Message }
    }

    return Write-SetupReport -Mode "troubleshooter" -Checks $checks
}

function Install-AtlasNodePackages {
    Write-Host "Installing backend Node packages..."
    npm install
    if ($LASTEXITCODE -ne 0) { throw "Backend npm install failed with exit code $LASTEXITCODE." }

    Write-Host "Installing frontend Node packages..."
    Push-Location ".\atlas-hcm-next"
    try {
        npm install
        if ($LASTEXITCODE -ne 0) { throw "Frontend npm install failed with exit code $LASTEXITCODE." }
    } finally {
        Pop-Location
    }
}

function Build-AtlasFrontendExport {
    if ($SkipBuild) {
        Write-Host "Frontend build skipped by -SkipBuild."
        return
    }
    Write-Host "Building frontend export for full Windows/server bundle..."
    Push-Location ".\atlas-hcm-next"
    try {
        npm run build
        if ($LASTEXITCODE -ne 0) { throw "Frontend build failed with exit code $LASTEXITCODE." }
    } finally {
        Pop-Location
    }
}

function Repair-AtlasInstall {
    Write-Host "Running ATLAS install troubleshooter..."
    Invoke-InstallTroubleshooter | Out-Null
    Install-AtlasNodePackages
    foreach ($folder in @("logs", "backups", "test-reports", "tmp")) {
        New-Item -ItemType Directory -Path (Join-Path $PSScriptRoot $folder) -Force | Out-Null
    }
    Build-AtlasFrontendExport
    Write-Host "Repair complete. Run setup again if SQL credentials or database objects must be recreated." -ForegroundColor Green
}

function Invoke-AtlasSql {
    param(
        [string]$Query,
        [string]$InputFile,
        [string]$DatabaseName
    )

    $args = @("-S", (Get-SqlEndpoint), "-b", "-W")
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

if ($Troubleshoot) {
    $troubleshootResult = Invoke-InstallTroubleshooter
    if ($troubleshootResult -eq "FAILED") { exit 1 }
    exit 0
}

if ($Repair) {
    Repair-AtlasInstall
    exit 0
}

$Server = Read-DefaultedValue -Prompt "SQL Server host or instance" -Default $Server
$DbPort = Read-DefaultedInt -Prompt "SQL Server TCP port" -Default $DbPort
$Database = Read-DefaultedValue -Prompt "ATLAS database name" -Default $Database
$AppUser = Read-DefaultedValue -Prompt "ATLAS SQL login" -Default $AppUser
$Port = Read-DefaultedInt -Prompt "ATLAS application port" -Default $Port

if (-not $OdbcDriver) {
    $drivers = Get-InstalledOdbcDrivers
    $recommendedDriver = @($drivers | Where-Object { $_ -match "ODBC Driver (18|17) for SQL Server" } | Select-Object -First 1)[0]
    if (-not $recommendedDriver) { $recommendedDriver = "ODBC Driver 18 for SQL Server" }
    $OdbcDriver = Read-DefaultedValue -Prompt "ODBC driver name for MSSQL reporting/repair tools" -Default $recommendedDriver
}

$installedDrivers = Get-InstalledOdbcDrivers
if ($installedDrivers.Count -gt 0 -and -not ($installedDrivers -contains $OdbcDriver)) {
    Write-Host "Warning: ODBC driver '$OdbcDriver' was not found in installed ODBC drivers." -ForegroundColor Yellow
    Write-Host "Installed drivers: $($installedDrivers -join ', ')" -ForegroundColor Yellow
}

if (-not $AppPassword) {
    $securePassword = Read-Host "Enter password for SQL login '$AppUser'" -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
    $AppPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}

Install-AtlasNodePackages
Build-AtlasFrontendExport

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
PORT=$Port
DB_SERVER=$Server
DB_PORT=$DbPort
DB_NAME=$Database
DB_USER=$AppUser
DB_PASSWORD=$AppPassword
DB_ODBC_DRIVER=$OdbcDriver
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
Write-Host "Repair mode: powershell -ExecutionPolicy Bypass -File .\setup-atlas.ps1 -Repair"
Write-Host "Troubleshooter: powershell -ExecutionPolicy Bypass -File .\setup-atlas.ps1 -Troubleshoot"
Write-Host "Start the system with: powershell -ExecutionPolicy Bypass -File .\\start-atlas.ps1"
Write-Host "Then open: http://localhost:$Port"
Write-Host "Default login: admin / Admin@123"
Write-Host "Change the admin password after first login."
