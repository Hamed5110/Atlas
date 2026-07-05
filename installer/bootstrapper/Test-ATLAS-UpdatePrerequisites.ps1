param(
    [string]$InstallRoot = "",
    [string]$DataRoot = "",
    [int]$ExpectedAppPort = 0
)

$ErrorActionPreference = "Continue"
$results = New-Object System.Collections.Generic.List[object]

function Add-Result {
    param([string]$Name, [string]$Status, [string]$Detail)
    $results.Add([pscustomobject]@{ Check = $Name; Status = $Status; Detail = $Detail }) | Out-Null
}

function Get-RegValue {
    param([string]$Name)
    foreach ($path in @("HKLM:\SOFTWARE\ATLAS Airfare Allowance", "HKLM:\SOFTWARE\WOW6432Node\ATLAS Airfare Allowance")) {
        if (-not (Test-Path $path)) { continue }
        $value = (Get-ItemProperty -Path $path -Name $Name -ErrorAction SilentlyContinue).$Name
        if (-not [string]::IsNullOrWhiteSpace([string]$value)) { return [string]$value }
    }
    return $null
}

function Read-EnvFile {
    param([string]$Path)
    $settings = @{}
    if (-not (Test-Path -LiteralPath $Path)) { return $settings }
    Get-Content -LiteralPath $Path -ErrorAction SilentlyContinue | ForEach-Object {
        if ($_ -match '^\s*([^#=]+)\s*=(.*)$') {
            $settings[$Matches[1].Trim()] = $Matches[2].Trim()
        }
    }
    return $settings
}

function Find-AtlasInstallRoot {
    param([string]$PreferredRoot)
    $candidates = New-Object System.Collections.Generic.List[string]
    foreach ($candidate in @(
        $PreferredRoot,
        (Get-RegValue -Name "INSTALLROOT"),
        (Join-Path $env:ProgramFiles "ATLAS Airfare Allowance"),
        "C:\Airfare_Allowance",
        (Get-Location).Path
    )) {
        if (-not [string]::IsNullOrWhiteSpace([string]$candidate)) {
            $candidates.Add(([string]$candidate).TrimEnd('\')) | Out-Null
        }
    }
    foreach ($candidate in $candidates | Select-Object -Unique) {
        if (Test-Path -LiteralPath (Join-Path $candidate "server.js")) {
            return $candidate
        }
    }
    return $PreferredRoot
}

function Test-Tcp {
    param([string]$HostName, [int]$Port)
    try {
        $client = New-Object Net.Sockets.TcpClient
        $async = $client.BeginConnect($HostName, $Port, $null, $null)
        $ok = $async.AsyncWaitHandle.WaitOne(1500, $false)
        if ($ok) { $client.EndConnect($async) }
        $client.Close()
        return $ok
    } catch {
        return $false
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

if (-not $InstallRoot) { $InstallRoot = Get-RegValue -Name "INSTALLROOT" }
if (-not $InstallRoot) { $InstallRoot = Join-Path $env:ProgramFiles "ATLAS Airfare Allowance" }
$InstallRoot = Find-AtlasInstallRoot -PreferredRoot $InstallRoot
if (-not $DataRoot) { $DataRoot = Get-RegValue -Name "DATAROOT" }
if (-not $DataRoot) { $DataRoot = Join-Path $env:ProgramData "ATLAS Airfare Allowance" }

$envPath = Join-Path $InstallRoot ".env"
$settings = Read-EnvFile -Path $envPath
$appPort = $ExpectedAppPort
if ($settings.ContainsKey("PORT")) { [void][int]::TryParse([string]$settings.PORT, [ref]$appPort) }
if ($appPort -le 0) {
    $registeredPort = Get-RegValue -Name "ATLASPORT"
    [void][int]::TryParse([string]$registeredPort, [ref]$appPort)
}
if ($appPort -le 0) { $appPort = 3355 }

$dbPort = 1433
if ($settings.ContainsKey("DB_PORT")) { [void][int]::TryParse([string]$settings.DB_PORT, [ref]$dbPort) }
$dbServer = "127.0.0.1"
if ($settings.ContainsKey("DB_SERVER") -and $settings.DB_SERVER) { $dbServer = [string]$settings.DB_SERVER }
$dbTcpHost = Get-SqlTcpHost -Server $dbServer

if (Test-Path -LiteralPath (Join-Path $InstallRoot "server.js")) {
    Add-Result "Installed application files" "PASS" $InstallRoot
} else {
    Add-Result "Installed application files" "FAIL" "server.js not found under $InstallRoot"
}

if (Test-Path -LiteralPath $envPath) {
    Add-Result "Application configuration" "PASS" $envPath
} else {
    Add-Result "Application configuration" "WARN" ".env not found at $envPath"
}

if (Test-Path -LiteralPath $DataRoot) {
    Add-Result "Data folder" "PASS" $DataRoot
} else {
    Add-Result "Data folder" "WARN" "$DataRoot does not exist yet"
}

if (Test-Tcp -HostName "127.0.0.1" -Port $appPort) {
    Add-Result "ATLAS application port" "PASS" "127.0.0.1:$appPort is listening"
} else {
    Add-Result "ATLAS application port" "WARN" "127.0.0.1:$appPort is not listening; patch can still update files"
}

if (Test-Tcp -HostName $dbTcpHost -Port $dbPort) {
    Add-Result "MSSQL TCP port" "PASS" "${dbTcpHost}:$dbPort is reachable"
} else {
    Add-Result "MSSQL TCP port" "WARN" "${dbTcpHost}:$dbPort is not reachable"
}

$reportDir = Join-Path $DataRoot "logs"
New-Item -ItemType Directory -Path $reportDir -Force -ErrorAction SilentlyContinue | Out-Null
$report = Join-Path $reportDir ("update-prerequisites-{0}.txt" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
$results | Format-Table -AutoSize | Tee-Object -FilePath $report
Write-Host ""
Write-Host "Report: $report"

if ($results | Where-Object { $_.Status -eq "FAIL" }) { exit 1 }
exit 0
