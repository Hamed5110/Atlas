param(
    [string]$InstallRoot = (Split-Path -Parent $MyInvocation.MyCommand.Path),
    [switch]$Quiet
)

$ErrorActionPreference = "Stop"

function Write-Step {
    param([string]$Message)
    if (-not $Quiet) { Write-Host $Message -ForegroundColor Cyan }
}

function Read-AtlasEnv {
    param([string]$Path)
    $settings = @{}
    if (Test-Path $Path) {
        Get-Content $Path | ForEach-Object {
            if ($_ -match "^\s*([^#=]+)=(.*)$") {
                $settings[$Matches[1].Trim()] = $Matches[2].Trim()
            }
        }
    }
    return $settings
}

function Get-SqlServerPart {
    param([string]$Server, [int]$Port)
    $serverName = ([string]$Server).Trim()
    if ([string]::IsNullOrWhiteSpace($serverName)) { $serverName = "127.0.0.1" }

    if ($serverName -match "^(.*),(\d+)$") {
        return "tcp:$serverName"
    }

    if ($Port -gt 0) {
        if ($serverName -match "\\") {
            $serverName = ($serverName -split "\\")[0]
            if ([string]::IsNullOrWhiteSpace($serverName)) { $serverName = "127.0.0.1" }
        }
        return "tcp:$serverName,$Port"
    }

    return $serverName
}

function New-SqlConnection {
    param(
        [string]$ServerPart,
        [string]$Database,
        [string]$User,
        [string]$Password
    )
    $connectionString = "Server=$ServerPart;Database=$Database;User ID=$User;Password=$Password;Encrypt=False;TrustServerCertificate=True;Connection Timeout=15;"
    return New-Object System.Data.SqlClient.SqlConnection($connectionString)
}

function Invoke-SqlText {
    param(
        [string]$ServerPart,
        [string]$Database,
        [string]$User,
        [string]$Password,
        [string]$SqlText
    )
    $connection = New-SqlConnection -ServerPart $ServerPart -Database $Database -User $User -Password $Password
    try {
        $connection.Open()
        $command = $connection.CreateCommand()
        $command.CommandTimeout = 180
        $command.CommandText = $SqlText
        [void]$command.ExecuteNonQuery()
    } finally {
        $connection.Dispose()
    }
}

function Split-SqlBatches {
    param([string]$SqlText)
    return [regex]::Split($SqlText, "(?im)^\s*GO\s*(?:--.*)?$")
}

function Escape-SqlName {
    param([string]$Name)
    return $Name.Replace("]", "]]")
}

$envPath = Join-Path $InstallRoot ".env"
$settings = Read-AtlasEnv -Path $envPath

$dbServer = if ($settings.DB_SERVER) { [string]$settings.DB_SERVER } else { "localhost\ATLAS" }
$dbPort = if ($settings.DB_PORT) { [int]$settings.DB_PORT } else { 1433 }
$dbName = if ($settings.DB_NAME) { [string]$settings.DB_NAME } else { "Atlasairfare010" }
$dbUser = if ($settings.DB_USER) { [string]$settings.DB_USER } else { "sa" }
$dbPassword = if ($settings.ContainsKey("DB_PASSWORD")) { [string]$settings.DB_PASSWORD } else { "" }

if (-not $dbPassword) {
    throw "MSSQL password is empty. Run Configure-ATLAS.bat and enter the SQL login password."
}

$databaseDir = Join-Path $InstallRoot "database"
$schemaPath = Join-Path $databaseDir "ATLAS_MSSQL_Schema.sql"
if (-not (Test-Path $schemaPath)) {
    throw "Database schema file not found: $schemaPath"
}

$serverPart = Get-SqlServerPart -Server $dbServer -Port $dbPort
$safeDbName = Escape-SqlName -Name $dbName
$quotedDbName = $dbName.Replace("'", "''")

Write-Step "Checking SQL Server connection on $serverPart..."
Invoke-SqlText -ServerPart $serverPart -Database "master" -User $dbUser -Password $dbPassword -SqlText "SELECT 1;"

Write-Step "Creating database '$dbName' if missing..."
Invoke-SqlText -ServerPart $serverPart -Database "master" -User $dbUser -Password $dbPassword -SqlText "IF DB_ID(N'$quotedDbName') IS NULL BEGIN EXEC(N'CREATE DATABASE [$safeDbName]'); END;"

$scripts = @(
    "ATLAS_MSSQL_Schema.sql",
    "ATLAS_HCM_SQL_Objects.sql",
    "ATLAS_Company_Admin.sql",
    "ATLAS_Allocation_Attachments.sql",
    "ATLAS_Loan_SQL_Objects.sql"
)

foreach ($scriptName in $scripts) {
    $scriptPath = Join-Path $databaseDir $scriptName
    if (-not (Test-Path $scriptPath)) { continue }

    Write-Step "Applying $scriptName..."
    $sqlText = Get-Content -LiteralPath $scriptPath -Raw
    $sqlText = $sqlText -replace "(?im)^\s*CREATE\s+DATABASE\s+\[?Atlasairfare010\]?\s*;?\s*$", "IF DB_ID(N'$quotedDbName') IS NULL EXEC(N'CREATE DATABASE [$safeDbName]');"
    $sqlText = $sqlText -replace "(?im)^\s*USE\s+\[?Atlasairfare010\]?\s*;?\s*$", "USE [$safeDbName];"

    foreach ($batch in (Split-SqlBatches -SqlText $sqlText)) {
        if (-not $batch.Trim()) { continue }
        Invoke-SqlText -ServerPart $serverPart -Database $dbName -User $dbUser -Password $dbPassword -SqlText $batch
    }
}

Write-Step "Database configuration successful for '$dbName'."
