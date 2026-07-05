param(
    [string]$InstallRoot = (Split-Path -Parent $MyInvocation.MyCommand.Path),
    [switch]$SkipAppHealth,
    [switch]$Quiet
)

$ErrorActionPreference = "Stop"

function Add-Result {
    param([string]$Name, [string]$Status, [string]$Detail = "")
    $script:Results += [pscustomobject]@{
        Name = $Name
        Status = $Status
        Detail = $Detail
    }
    if (-not $Quiet) {
        $color = if ($Status -eq "PASS") { "Green" } elseif ($Status -eq "WARN") { "Yellow" } else { "Red" }
        Write-Host "[$Status] $Name $Detail" -ForegroundColor $color
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

function Test-TcpPort {
    param([string]$Server, [int]$Port, [int]$TimeoutMs = 2500)
    try {
        $client = New-Object Net.Sockets.TcpClient
        $async = $client.BeginConnect($Server, $Port, $null, $null)
        $ready = $async.AsyncWaitHandle.WaitOne($TimeoutMs, $false)
        if ($ready) { $client.EndConnect($async) }
        $client.Close()
        return $ready
    } catch {
        return $false
    }
}

function Test-OdbcSqlLogin {
    param(
        [string]$Driver,
        [string]$Server,
        [int]$Port,
        [string]$Database,
        [string]$User,
        [string]$Password
    )
    $serverPart = Get-SqlServerPart -Server $Server -Port $Port
    $connectionString = "Driver={$Driver};Server=$serverPart;Database=$Database;Uid=$User;Pwd=$Password;Encrypt=no;TrustServerCertificate=yes;Connection Timeout=5;"
    $connection = New-Object System.Data.Odbc.OdbcConnection($connectionString)
    try {
        $connection.Open()
        $command = $connection.CreateCommand()
        $command.CommandText = "SELECT DB_NAME()"
        $connectedDb = [string]$command.ExecuteScalar()
        return [pscustomobject]@{ Ok = $true; Database = $connectedDb; Error = "" }
    } catch {
        return [pscustomobject]@{ Ok = $false; Database = ""; Error = $_.Exception.Message }
    } finally {
        $connection.Dispose()
    }
}

function Get-SqlTcpHost {
    param([string]$Server)
    $serverName = ([string]$Server).Trim()
    if ([string]::IsNullOrWhiteSpace($serverName)) { return "127.0.0.1" }
    if ($serverName -match "^(.*),\d+$") { $serverName = $Matches[1].Trim() }
    if ($serverName -match "\\") { $serverName = ($serverName -split "\\")[0].Trim() }
    if ([string]::IsNullOrWhiteSpace($serverName) -or $serverName -eq "." -or $serverName -eq "(local)") { return "127.0.0.1" }
    return $serverName
}

function Get-SqlServerPart {
    param([string]$Server, [int]$Port)
    $serverName = ([string]$Server).Trim()
    if ([string]::IsNullOrWhiteSpace($serverName)) { $serverName = "127.0.0.1" }
    if ($serverName -match "^(.*),(\d+)$") { return "tcp:$serverName" }
    if ($Port -gt 0) {
        if ($serverName -match "\\") { $serverName = ($serverName -split "\\")[0].Trim() }
        if ([string]::IsNullOrWhiteSpace($serverName)) { $serverName = "127.0.0.1" }
        return "tcp:$serverName,$Port"
    }
    return $serverName
}

function Test-AtlasHealth {
    param([int]$Port)
    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 5
        return [pscustomobject]@{
            Ok = ($health.status -eq "healthy" -and $health.database -eq "connected")
            Detail = "status=$($health.status), database=$($health.database)"
            Error = ""
        }
    } catch {
        return [pscustomobject]@{ Ok = $false; Detail = ""; Error = $_.Exception.Message }
    }
}

$script:Results = @()
$envPath = Join-Path $InstallRoot ".env"
$settings = Read-AtlasEnv -Path $envPath

$appPort = 3355
if ($settings.ContainsKey("PORT") -and $settings.PORT) { $appPort = [int]$settings.PORT }
$dbServer = "localhost\ATLAS"
if ($settings.ContainsKey("DB_SERVER") -and $settings.DB_SERVER) { $dbServer = [string]$settings.DB_SERVER }
$dbPort = 1433
if ($settings.ContainsKey("DB_PORT") -and $settings.DB_PORT) { $dbPort = [int]$settings.DB_PORT }
$dbName = "Atlasairfare010"
if ($settings.ContainsKey("DB_NAME") -and $settings.DB_NAME) { $dbName = [string]$settings.DB_NAME }
$dbUser = "sa"
if ($settings.ContainsKey("DB_USER") -and $settings.DB_USER) { $dbUser = [string]$settings.DB_USER }
$dbPassword = ""
if ($settings.ContainsKey("DB_PASSWORD")) { $dbPassword = [string]$settings.DB_PASSWORD }
$odbcDriver = "ODBC Driver 18 for SQL Server"
if ($settings.ContainsKey("DB_ODBC_DRIVER") -and $settings.DB_ODBC_DRIVER) { $odbcDriver = [string]$settings.DB_ODBC_DRIVER }

if (Test-Path $envPath) {
    Add-Result "Configuration file" "PASS" $envPath
} else {
    Add-Result "Configuration file" "FAIL" "Missing .env"
}

$drivers = Get-InstalledOdbcDrivers
if ($drivers -contains $odbcDriver) {
    Add-Result "ODBC driver" "PASS" $odbcDriver
} else {
    Add-Result "ODBC driver" "FAIL" "Missing '$odbcDriver'. Installed: $($drivers -join ', ')"
}

$dbTcpHost = Get-SqlTcpHost -Server $dbServer
if (Test-TcpPort -Server $dbTcpHost -Port $dbPort) {
    Add-Result "MSSQL TCP port" "PASS" "${dbTcpHost}:$dbPort reachable"
} else {
    Add-Result "MSSQL TCP port" "WARN" "${dbTcpHost}:$dbPort not reachable by TCP; confirm DB_SERVER and DB_PORT"
}

$login = Test-OdbcSqlLogin -Driver $odbcDriver -Server $dbServer -Port $dbPort -Database $dbName -User $dbUser -Password $dbPassword
if ($login.Ok) {
    Add-Result "MSSQL login" "PASS" "User '$dbUser' connected to '$($login.Database)'"
} else {
    Add-Result "MSSQL login" "FAIL" $login.Error
}

$listeners = @(Get-NetTCPConnection -LocalPort $appPort -State Listen -ErrorAction SilentlyContinue)
if ($listeners.Count -gt 0) {
    Add-Result "ATLAS app port" "PASS" "Port $appPort already has a listener"
} else {
    Add-Result "ATLAS app port" "PASS" "Port $appPort is available for ATLAS"
}

$task = Get-ScheduledTask -TaskName "ATLAS Airfare Allowance" -ErrorAction SilentlyContinue
if ($task) {
    Add-Result "ATLAS startup task" "PASS" "State=$($task.State)"
} else {
    Add-Result "ATLAS startup task" "WARN" "Startup task is not installed yet"
}

if (-not $SkipAppHealth) {
    $health = Test-AtlasHealth -Port $appPort
    if ($health.Ok) {
        Add-Result "ATLAS application status" "PASS" $health.Detail
    } else {
        Add-Result "ATLAS application status" "FAIL" $health.Error
    }
}

$reportDir = Join-Path $InstallRoot "test-reports"
New-Item -ItemType Directory -Path $reportDir -Force | Out-Null
$stamp = Get-Date -Format "yyyyMMddHHmmss"
$reportPath = Join-Path $reportDir "atlas-installed-verification-$stamp.md"
$result = if (($Results | Where-Object { $_.Status -eq "FAIL" }).Count -gt 0) { "FAILED" } else { "PASSED" }

$lines = @(
    "# ATLAS Installed Verification",
    "",
    "- Created: $((Get-Date).ToString("o"))",
    "- Result: $result",
    "- Install root: $InstallRoot",
    "- Application URL: http://localhost:$appPort",
    "",
    "| Check | Status | Detail |",
    "|---|---|---|"
)
foreach ($item in $Results) {
    $lines += "| $($item.Name) | $($item.Status) | $($item.Detail -replace '\|','/') |"
}
$lines | Set-Content -Path $reportPath -Encoding UTF8

if (-not $Quiet) {
    Write-Host ""
    Write-Host "Verification report: $reportPath"
    Write-Host "Installed verification result: $result"
}

if ($result -eq "FAILED") { exit 1 }
