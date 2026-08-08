param(
    [string]$Server = "localhost",
    [int]$DbPort = 1433,
    [string]$Database = "Atlasairfare3356",
    [string]$SqlUser = "sa",
    [string]$SqlPassword = "Atlas@25",
    [switch]$DropExisting
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$databaseDir = Join-Path $repoRoot "database"

function Write-Step {
    param([string]$Message)
    Write-Host "[ATLAS-3356-DB] $Message" -ForegroundColor Cyan
}

function Get-SqlServerPart {
    param([string]$ServerName, [int]$Port)
    $name = ([string]$ServerName).Trim()
    if ([string]::IsNullOrWhiteSpace($name)) { $name = "localhost" }
    if ($name -match "^(.*),(\d+)$") { return "tcp:$name" }
    if ($Port -gt 0) {
        if ($name -match "\\") { $name = ($name -split "\\")[0].Trim() }
        return "tcp:$name,$Port"
    }
    return $name
}

function Escape-SqlName {
    param([string]$Name)
    return $Name.Replace("]", "]]")
}

function Split-SqlBatches {
    param([string]$SqlText)
    return [regex]::Split($SqlText, "(?im)^\s*GO\s*(?:--.*)?$")
}

function Invoke-SqlText {
    param(
        [string]$ServerPart,
        [string]$DatabaseName,
        [string]$SqlText
    )

    $connectionString = "Server=$ServerPart;Database=$DatabaseName;User ID=$SqlUser;Password=$SqlPassword;Encrypt=False;TrustServerCertificate=True;Connection Timeout=20;"
    $connection = New-Object System.Data.SqlClient.SqlConnection($connectionString)
    try {
        $connection.Open()
        $command = $connection.CreateCommand()
        $command.CommandTimeout = 240
        $command.CommandText = $SqlText
        [void]$command.ExecuteNonQuery()
    } finally {
        $connection.Dispose()
    }
}

function Invoke-SqlScalar {
    param(
        [string]$ServerPart,
        [string]$DatabaseName,
        [string]$SqlText
    )

    $connectionString = "Server=$ServerPart;Database=$DatabaseName;User ID=$SqlUser;Password=$SqlPassword;Encrypt=False;TrustServerCertificate=True;Connection Timeout=20;"
    $connection = New-Object System.Data.SqlClient.SqlConnection($connectionString)
    try {
        $connection.Open()
        $command = $connection.CreateCommand()
        $command.CommandTimeout = 120
        $command.CommandText = $SqlText
        return $command.ExecuteScalar()
    } finally {
        $connection.Dispose()
    }
}

$serverPart = Get-SqlServerPart -ServerName $Server -Port $DbPort
$safeDbName = Escape-SqlName -Name $Database
$quotedDbName = $Database.Replace("'", "''")

Write-Step "Connecting to $serverPart as $SqlUser..."
Invoke-SqlText -ServerPart $serverPart -DatabaseName "master" -SqlText "SELECT 1;"

if ($DropExisting) {
    Write-Step "Dropping existing database '$Database' for a true fresh 3356 rebuild..."
    Invoke-SqlText -ServerPart $serverPart -DatabaseName "master" -SqlText @"
IF DB_ID(N'$quotedDbName') IS NOT NULL
BEGIN
    ALTER DATABASE [$safeDbName] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
    DROP DATABASE [$safeDbName];
END;
"@
}

Write-Step "Creating database '$Database'..."
Invoke-SqlText -ServerPart $serverPart -DatabaseName "master" -SqlText "IF DB_ID(N'$quotedDbName') IS NULL EXEC(N'CREATE DATABASE [$safeDbName]');"

$scripts = @(
    "ATLAS_MSSQL_Schema.sql",
    "ATLAS_HCM_SQL_Objects.sql",
    "ATLAS_Phase1_PolicyRate_Repair.sql",
    "ATLAS_Company_Admin.sql",
    "ATLAS_Allocation_Attachments.sql",
    "ATLAS_Loan_SQL_Objects.sql",
    "UserPreferences_LayoutState.sql",
    "ContinuousAirfareEntitlement_Blueprint.sql",
    "migrations\2026.08.02_patch_2_3_89_continuous_entitlement_phase1.sql"
)

foreach ($scriptName in $scripts) {
    $scriptPath = Join-Path $databaseDir $scriptName
    if (-not (Test-Path -LiteralPath $scriptPath)) {
        Write-Step "Skipping missing script $scriptName"
        continue
    }

    Write-Step "Applying $scriptName..."
    $sqlText = Get-Content -LiteralPath $scriptPath -Raw
    $sqlText = $sqlText -replace "(?im)^\s*CREATE\s+DATABASE\s+\[?Atlasairfare010\]?\s*;?\s*$", "IF DB_ID(N'$quotedDbName') IS NULL EXEC(N'CREATE DATABASE [$safeDbName]');"
    $sqlText = $sqlText -replace "(?im)^\s*USE\s+\[?Atlasairfare010\]?\s*;?\s*$", "USE [$safeDbName];"
    $sqlText = $sqlText -replace "(?im)^\s*:\S+.*$", ""
    $sqlText = $sqlText.Replace('$' + '(CutoverDate)', "2026-01-01")
    $sqlText = $sqlText.Replace('$' + '(CreatedBy)', "0")

    foreach ($batch in (Split-SqlBatches -SqlText $sqlText)) {
        if (-not $batch.Trim()) { continue }
        Invoke-SqlText -ServerPart $serverPart -DatabaseName $Database -SqlText $batch
    }
}

$checks = [ordered]@{
    Database = $Database
    Users = Invoke-SqlScalar -ServerPart $serverPart -DatabaseName $Database -SqlText "SELECT COUNT(*) FROM dbo.Users;"
    Employees = Invoke-SqlScalar -ServerPart $serverPart -DatabaseName $Database -SqlText "SELECT CASE WHEN OBJECT_ID(N'dbo.Employees', N'U') IS NULL THEN -1 ELSE COUNT(*) END FROM dbo.Employees;"
    EntitlementPlans = Invoke-SqlScalar -ServerPart $serverPart -DatabaseName $Database -SqlText "SELECT CASE WHEN OBJECT_ID(N'dbo.EmployeeAirfareEntitlementPlans', N'U') IS NULL THEN -1 ELSE COUNT(*) END FROM dbo.EmployeeAirfareEntitlementPlans;"
    BalanceProc = Invoke-SqlScalar -ServerPart $serverPart -DatabaseName $Database -SqlText "SELECT CASE WHEN OBJECT_ID(N'dbo.sp_ATLAS_GetAirfareEntitlementBalance', N'P') IS NULL THEN 0 ELSE 1 END;"
}

Write-Step "Fresh database ready:"
$checks.GetEnumerator() | ForEach-Object {
    Write-Host ("  {0}: {1}" -f $_.Key, $_.Value)
}
