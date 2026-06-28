$ErrorActionPreference = "Stop"

$logDir = "C:\Airfare_Allowance\logs"
if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}
$logFile = Join-Path $logDir "name-discovery-repair.log"
Start-Transcript -Path $logFile -Append | Out-Null

$atlasHost = $env:COMPUTERNAME
if (-not $atlasHost) { $atlasHost = [System.Net.Dns]::GetHostName() }
if (-not $atlasHost) { $atlasHost = "FOCUSSERVER" }

function Write-Step {
    param([string]$Message)
    Write-Host $Message -ForegroundColor Cyan
}

function Assert-Admin {
    $isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator
    )
    if (-not $isAdmin) {
        throw "Run this script as Administrator."
    }
}

function Get-AtlasLanAddress {
    $preferredRoute = Get-NetRoute -DestinationPrefix "0.0.0.0/0" -ErrorAction SilentlyContinue |
        Sort-Object RouteMetric, InterfaceMetric |
        Select-Object -First 1

    if ($preferredRoute) {
        $routeIp = Get-NetIPAddress -AddressFamily IPv4 -InterfaceIndex $preferredRoute.InterfaceIndex -ErrorAction SilentlyContinue |
            Where-Object { $_.IPAddress -notlike "169.254*" -and $_.IPAddress -ne "127.0.0.1" } |
            Select-Object -First 1 -ExpandProperty IPAddress
        if ($routeIp) { return $routeIp }
    }

    $preferred = Get-NetIPConfiguration |
        Where-Object { $_.IPv4Address -and $_.IPv4DefaultGateway } |
        Sort-Object { $_.InterfaceMetric } |
        Select-Object -First 1

    if ($preferred -and $preferred.IPv4Address.IPAddress) {
        return $preferred.IPv4Address.IPAddress
    }

    $fallback = Get-NetIPAddress -AddressFamily IPv4 |
        Where-Object {
            $_.IPAddress -notlike "169.254*" -and
            $_.IPAddress -ne "127.0.0.1" -and
            $_.InterfaceAlias -notmatch "vEthernet|Loopback|Virtual|Bluetooth"
        } |
        Sort-Object InterfaceMetric |
        Select-Object -First 1 -ExpandProperty IPAddress

    if ($fallback) { return $fallback }
    return "localhost"
}

Assert-Admin

Write-Step "Setting active LAN network profile to Private."
Get-NetConnectionProfile |
    Where-Object { $_.IPv4Connectivity -ne "Disconnected" } |
    ForEach-Object {
        try {
            Set-NetConnectionProfile -InterfaceIndex $_.InterfaceIndex -NetworkCategory Private
        } catch {
            Write-Host "Could not set $($_.InterfaceAlias) to Private: $($_.Exception.Message)" -ForegroundColor Yellow
        }
    }

Write-Step "Starting Windows name discovery services."
$services = @(
    "Dnscache",
    "FDPHost",
    "FDResPub",
    "SSDPSRV",
    "upnphost",
    "lanmanserver",
    "lanmanworkstation"
)

foreach ($serviceName in $services) {
    try {
        Set-Service -Name $serviceName -StartupType Automatic
        Start-Service -Name $serviceName -ErrorAction SilentlyContinue
    } catch {
        Write-Host "Could not update service ${serviceName}: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

Write-Step "Opening Windows Firewall for Network Discovery."
try {
    Get-NetFirewallRule -DisplayGroup "Network Discovery" -ErrorAction Stop |
        Set-NetFirewallRule -Enabled True -Action Allow -Profile Any
} catch {
    Write-Host "Could not update Network Discovery firewall group: $($_.Exception.Message)" -ForegroundColor Yellow
}

Write-Step "Opening Windows Firewall for File and Printer Sharing name support."
try {
    Get-NetFirewallRule -DisplayGroup "File and Printer Sharing" -ErrorAction Stop |
        Set-NetFirewallRule -Enabled True -Action Allow -Profile Any
} catch {
    Write-Host "Could not update File and Printer Sharing firewall group: $($_.Exception.Message)" -ForegroundColor Yellow
}

Write-Step "Ensuring NetBIOS over TCP/IP is enabled on active IPv4 adapters."
try {
    $realLanAliases = @(Get-NetIPConfiguration |
        Where-Object { $_.IPv4Address -and $_.IPv4DefaultGateway } |
        Select-Object -ExpandProperty InterfaceAlias)

    Get-CimInstance -ClassName Win32_NetworkAdapterConfiguration -Filter "IPEnabled = True" |
        ForEach-Object {
            try {
                $isRealLan = $realLanAliases -contains $_.Description -or $realLanAliases -contains $_.NetConnectionID
                $isVirtual = $_.Description -match "Hyper-V|Virtual|Bluetooth|Loopback" -or $_.NetConnectionID -match "vEthernet|Virtual|Bluetooth|Loopback"
                if ($isVirtual -and -not $isRealLan) {
                    Invoke-CimMethod -InputObject $_ -MethodName SetTcpipNetbios -Arguments @{ TcpipNetbiosOptions = 2 } | Out-Null
                } else {
                    Invoke-CimMethod -InputObject $_ -MethodName SetTcpipNetbios -Arguments @{ TcpipNetbiosOptions = 1 } | Out-Null
                }
            } catch {
                Write-Host "Could not update NetBIOS for $($_.Description): $($_.Exception.Message)" -ForegroundColor Yellow
            }
        }
} catch {
    Write-Host "Could not inspect NetBIOS adapter settings: $($_.Exception.Message)" -ForegroundColor Yellow
}

Write-Step "Publishing the ATLAS name only on the real LAN adapter."
Get-DnsClient |
    Where-Object { $_.InterfaceAlias -match "vEthernet|Virtual|Bluetooth|Loopback" } |
    ForEach-Object {
        try {
            Set-DnsClient -InterfaceIndex $_.InterfaceIndex -RegisterThisConnectionsAddress $false
        } catch {
            Write-Host "Could not disable DNS registration for $($_.InterfaceAlias): $($_.Exception.Message)" -ForegroundColor Yellow
        }
    }

Get-NetIPConfiguration |
    Where-Object { $_.IPv4Address -and $_.IPv4DefaultGateway } |
    ForEach-Object {
        try {
            Set-DnsClient -InterfaceIndex $_.InterfaceIndex -RegisterThisConnectionsAddress $true
        } catch {
            Write-Host "Could not enable DNS registration for $($_.InterfaceAlias): $($_.Exception.Message)" -ForegroundColor Yellow
        }
    }

Write-Step "Refreshing this PC name registration."
ipconfig /flushdns | Out-Null
nbtstat -R | Out-Null
nbtstat -RR | Out-Null

$lanIp = Get-AtlasLanAddress

Write-Host ""
Write-Host "Current ATLAS name and address:" -ForegroundColor Green
Write-Host "  Name URL:    http://$atlasHost/"
Write-Host "  Name direct: http://$atlasHost`:3355/"
Write-Host "  IP fallback: http://$lanIp/"

Write-Host ""
Write-Host "Local verification:" -ForegroundColor Cyan
Resolve-DnsName $atlasHost -ErrorAction SilentlyContinue | Format-Table -AutoSize
nbtstat -n
Invoke-WebRequest -Uri "http://$atlasHost/api/health" -UseBasicParsing -TimeoutSec 10 |
    Select-Object StatusCode, Content |
    Format-List

Write-Host ""
Write-Host "On the other PC, test:" -ForegroundColor Yellow
Write-Host "  ping $atlasHost"
Write-Host "  nbtstat -a $atlasHost"
Write-Host "  powershell: Test-NetConnection $atlasHost -Port 80"
Write-Host "  browser: http://$atlasHost/"
Write-Host ""
Read-Host "Press Enter to close"
Stop-Transcript | Out-Null
