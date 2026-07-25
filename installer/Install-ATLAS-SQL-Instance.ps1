param(
    [string]$InstallRoot = (Split-Path -Parent $MyInvocation.MyCommand.Path)
)

$ErrorActionPreference = "Stop"

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

function Get-LocalSqlExpressSetup {
    param([string]$Root)
    $candidates = @(
        (Join-Path $Root "redist\SQLEXPR_x64_ENU.exe"),
        (Join-Path $Root "redist\SQL2022-SSEI-Expr.exe"),
        (Join-Path $Root "redist\SQL2019-SSEI-Expr.exe")
    )
    return @($candidates | Where-Object { Test-Path $_ } | Select-Object -First 1)[0]
}

function Restart-SqlServiceIfPresent {
    param([string]$InstanceName)
    $serviceName = if ($InstanceName -eq "MSSQLSERVER") { "MSSQLSERVER" } else { "MSSQL`$$InstanceName" }
    $service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
    if ($service) {
        Restart-Service -Name $serviceName -Force -ErrorAction SilentlyContinue
        try { (Get-Service -Name $serviceName).WaitForStatus("Running", "00:01:00") } catch {}
    }
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
    if ($PortNumber -le 0) { return }
    $instanceId = Get-SqlInstanceRegistryId -InstanceName $InstanceName
    if (-not $instanceId) {
        Write-Host "SQL registry instance id was not found for '$InstanceName'; TCP port repair skipped." -ForegroundColor Yellow
        return
    }

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
        Write-Host "SQL TCP/IP pinned to port $PortNumber for instance '$InstanceName'. Restarting SQL service..."
        Restart-SqlServiceIfPresent -InstanceName $InstanceName
        Start-Sleep -Seconds 5
    } else {
        Write-Host "SQL TCP/IP registry path was not found for instance '$InstanceName'." -ForegroundColor Yellow
    }
}

$settings = Read-AtlasEnv -Path (Join-Path $InstallRoot ".env")
$autoSetup = if ($settings.DB_AUTO_SETUP) { [string]$settings.DB_AUTO_SETUP } else { "1" }
if ($autoSetup -notin @("1", "true", "yes", "on")) {
    Write-Host "Automatic local SQL setup is disabled."
    exit 0
}

$dbServer = if ($settings.DB_SERVER) { [string]$settings.DB_SERVER } else { "localhost\ATLAS" }
$dbPort = if ($settings.DB_PORT) { [int]$settings.DB_PORT } else { 1433 }
$dbPassword = if ($settings.ContainsKey("DB_PASSWORD")) { [string]$settings.DB_PASSWORD } else { "" }

if (-not $dbPassword) {
    Write-Host "SQL auto-setup skipped because the MSSQL password is empty." -ForegroundColor Yellow
    exit 0
}

$localServerNames = @("localhost", ".", $env:COMPUTERNAME, [System.Net.Dns]::GetHostName()) | Where-Object { $_ } | Sort-Object -Unique
$serverBase = ($dbServer -split "\\")[0]
$isLocal = $localServerNames -contains $serverBase
if (-not $isLocal) {
    Write-Host "SQL auto-setup skipped because DB_SERVER is remote: $dbServer"
    exit 0
}

if ($dbServer -match "\\(.+)$") { $instanceName = $Matches[1] } else { $instanceName = "ATLAS" }
if (-not $instanceName) { $instanceName = "ATLAS" }

if (Test-TcpPort -Server "127.0.0.1" -Port $dbPort) {
    Write-Host "SQL TCP port $dbPort is already reachable."
    exit 0
}

$setupExe = Get-LocalSqlExpressSetup -Root $InstallRoot
if (-not $setupExe) {
    Write-Host "SQL Server Express setup was not found in '$InstallRoot\redist'." -ForegroundColor Yellow
    Write-Host "Place the offline SQL Express installer there, or install SQL Server manually, then run Configure-ATLAS.bat."
    exit 0
}

Write-Host "Installing local SQL Server Express instance '$instanceName'..."
$arguments = @(
    "/Q",
    "/ACTION=Install",
    "/FEATURES=SQLENGINE",
    "/INSTANCENAME=$instanceName",
    "/SECURITYMODE=SQL",
    "/SAPWD=`"$dbPassword`"",
    "/SQLSYSADMINACCOUNTS=`"BUILTIN\Administrators`"",
    "/TCPENABLED=1",
    "/IACCEPTSQLSERVERLICENSETERMS"
)

$process = Start-Process -FilePath $setupExe -ArgumentList $arguments -Wait -PassThru
if ($process.ExitCode -ne 0 -and $process.ExitCode -ne 3010) {
    throw "SQL Server Express setup failed with exit code $($process.ExitCode)."
}

Restart-SqlServiceIfPresent -InstanceName $instanceName
Enable-SqlTcpPort -InstanceName $instanceName -PortNumber $dbPort

if (-not (Test-TcpPort -Server "127.0.0.1" -Port $dbPort -TimeoutMs 8000)) {
    throw "SQL Server Express setup completed, but TCP port 127.0.0.1:$dbPort is not reachable. Open SQL Server Configuration Manager and confirm TCP/IP is enabled for '$instanceName'."
}

Write-Host "SQL Server Express setup completed for instance '$instanceName' on TCP port $dbPort."
