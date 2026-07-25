param(
    [string]$InstallRoot = (Split-Path -Parent $MyInvocation.MyCommand.Path),
    [switch]$Quiet
)

$ErrorActionPreference = "Stop"

function Write-Step {
    param([string]$Message)
    if (-not $Quiet) { Write-Host $Message -ForegroundColor Cyan }
}

function Write-DbSetupLog {
    param(
        [string]$InstallRootPath,
        [string]$Step,
        [string]$Status,
        [string]$Message
    )
    try {
        $logDir = Join-Path $InstallRootPath "logs"
        New-Item -ItemType Directory -Path $logDir -Force | Out-Null
        [pscustomobject]@{
            at = (Get-Date).ToString("o")
            step = $Step
            status = $Status
            message = $Message
        } | ConvertTo-Json -Compress | Add-Content -LiteralPath (Join-Path $logDir "database_setup_debug.log") -Encoding UTF8
    } catch {}
}

function Test-IsAdministrator {
    try {
        $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
        $principal = [Security.Principal.WindowsPrincipal]$identity
        return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    } catch {
        return $false
    }
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

function Get-SqlInstanceNameFromServer {
    param([string]$Server)
    $raw = ([string]$Server).Trim()
    if ($raw -match "\\([^\\,]+)") { return $Matches[1] }
    return "MSSQLSERVER"
}

function Get-SqlServiceName {
    param([string]$InstanceName)
    if ($InstanceName -eq "MSSQLSERVER") { return "MSSQLSERVER" }
    return "MSSQL`$$InstanceName"
}

function Get-SqlInstanceRegistryId {
    param([string]$InstanceName)
    foreach ($path in @(
        "HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\Instance Names\SQL",
        "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Microsoft SQL Server\Instance Names\SQL"
    )) {
        if (Test-Path $path) {
            $value = (Get-ItemProperty -Path $path -Name $InstanceName -ErrorAction SilentlyContinue).$InstanceName
            if ($value) { return [string]$value }
        }
    }
    return $null
}

function Enable-SqlTcpPort {
    param(
        [string]$InstanceName,
        [int]$PortNumber
    )
    if ($PortNumber -le 0) { return $false }
    if (-not (Test-IsAdministrator)) {
        Write-DbSetupLog -InstallRootPath $InstallRoot -Step "SQL TCP repair" -Status "SKIPPED" -Message "Administrator rights are required to change SQL TCP/IP settings and restart SQL Server."
        return $false
    }
    $instanceId = Get-SqlInstanceRegistryId -InstanceName $InstanceName
    if (-not $instanceId) { return $false }

    $changed = $false
    foreach ($tcpRoot in @(
        "HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\$instanceId\MSSQLServer\SuperSocketNetLib\Tcp",
        "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Microsoft SQL Server\$instanceId\MSSQLServer\SuperSocketNetLib\Tcp"
    )) {
        if (-not (Test-Path $tcpRoot)) { continue }
        Set-ItemProperty -Path $tcpRoot -Name "Enabled" -Value 1 -ErrorAction SilentlyContinue
        $ipAll = Join-Path $tcpRoot "IPAll"
        if (Test-Path $ipAll) {
            Set-ItemProperty -Path $ipAll -Name "TcpDynamicPorts" -Value "" -ErrorAction SilentlyContinue
            Set-ItemProperty -Path $ipAll -Name "TcpPort" -Value ([string]$PortNumber) -ErrorAction SilentlyContinue
            $changed = $true
        }
    }

    if ($changed) {
        $serviceName = Get-SqlServiceName -InstanceName $InstanceName
        try {
            Restart-Service -Name $serviceName -Force -ErrorAction Stop
            (Get-Service -Name $serviceName).WaitForStatus("Running", "00:01:00")
            Start-Sleep -Seconds 5
        } catch {
            Write-DbSetupLog -InstallRootPath $InstallRoot -Step "SQL TCP repair" -Status "FAILED" -Message $_.Exception.Message
            return $false
        }
    }
    return $changed
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

function Invoke-SqlTextWithTcpRepair {
    param(
        [string]$ServerPart,
        [string]$Database,
        [string]$User,
        [string]$Password,
        [string]$SqlText,
        [string]$OriginalServer,
        [int]$Port,
        [string]$StepName
    )
    try {
        Invoke-SqlText -ServerPart $ServerPart -Database $Database -User $User -Password $Password -SqlText $SqlText
    } catch {
        Write-DbSetupLog -InstallRootPath $InstallRoot -Step $StepName -Status "RETRY" -Message $_.Exception.Message
        $instanceName = Get-SqlInstanceNameFromServer -Server $OriginalServer
        if (-not (Enable-SqlTcpPort -InstanceName $instanceName -PortNumber $Port)) { throw }
        Invoke-SqlText -ServerPart $ServerPart -Database $Database -User $User -Password $Password -SqlText $SqlText
    }
}

function Invoke-SqlScalar {
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
        $command.CommandTimeout = 60
        $command.CommandText = $SqlText
        return $command.ExecuteScalar()
    } finally {
        $connection.Dispose()
    }
}

function Test-AtlasBaseSchemaExists {
    param(
        [string]$ServerPart,
        [string]$Database,
        [string]$User,
        [string]$Password
    )
    $exists = Invoke-SqlScalar -ServerPart $ServerPart -Database $Database -User $User -Password $Password -SqlText @"
SELECT CASE
    WHEN OBJECT_ID(N'dbo.Users', N'U') IS NOT NULL
      OR OBJECT_ID(N'dbo.Employees', N'U') IS NOT NULL
      OR OBJECT_ID(N'dbo.Allocations', N'U') IS NOT NULL
    THEN 1 ELSE 0 END;
"@
    return ([int]$exists -eq 1)
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
Invoke-SqlTextWithTcpRepair -ServerPart $serverPart -Database "master" -User $dbUser -Password $dbPassword -SqlText "SELECT 1;" -OriginalServer $dbServer -Port $dbPort -StepName "master connection"

Write-Step "Creating database '$dbName' if missing..."
Invoke-SqlTextWithTcpRepair -ServerPart $serverPart -Database "master" -User $dbUser -Password $dbPassword -SqlText "IF DB_ID(N'$quotedDbName') IS NULL BEGIN EXEC(N'CREATE DATABASE [$safeDbName]'); END;" -OriginalServer $dbServer -Port $dbPort -StepName "create database"

$baseSchemaExists = Test-AtlasBaseSchemaExists -ServerPart $serverPart -Database $dbName -User $dbUser -Password $dbPassword

$scripts = @(
    "ATLAS_MSSQL_Schema.sql",
    "ATLAS_HCM_SQL_Objects.sql",
    "ATLAS_Phase1_PolicyRate_Repair.sql",
    "ATLAS_Company_Admin.sql",
    "ATLAS_Allocation_Attachments.sql",
    "ATLAS_Loan_SQL_Objects.sql",
    "ATLAS_YearEnd_Safety.sql"
)

foreach ($scriptName in $scripts) {
    $scriptPath = Join-Path $databaseDir $scriptName
    if (-not (Test-Path $scriptPath)) { continue }
    if ($scriptName -eq "ATLAS_MSSQL_Schema.sql" -and $baseSchemaExists) {
        Write-Step "Base schema already exists; skipping create-only schema and continuing repair scripts..."
        continue
    }

    Write-Step "Applying $scriptName..."
    $sqlText = Get-Content -LiteralPath $scriptPath -Raw
    $sqlText = $sqlText -replace "(?im)^\s*CREATE\s+DATABASE\s+\[?Atlasairfare010\]?\s*;?\s*$", "IF DB_ID(N'$quotedDbName') IS NULL EXEC(N'CREATE DATABASE [$safeDbName]');"
    $sqlText = $sqlText -replace "(?im)^\s*USE\s+\[?Atlasairfare010\]?\s*;?\s*$", "USE [$safeDbName];"

    foreach ($batch in (Split-SqlBatches -SqlText $sqlText)) {
        if (-not $batch.Trim()) { continue }
        Invoke-SqlTextWithTcpRepair -ServerPart $serverPart -Database $dbName -User $dbUser -Password $dbPassword -SqlText $batch -OriginalServer $dbServer -Port $dbPort -StepName "apply $scriptName"
    }
}

Write-DbSetupLog -InstallRootPath $InstallRoot -Step "database configuration" -Status "OK" -Message "Database configuration successful for '$dbName' on $serverPart."
Write-Step "Database configuration successful for '$dbName'."
