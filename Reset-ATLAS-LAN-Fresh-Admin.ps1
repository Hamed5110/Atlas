$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = 3355
$envFile = Join-Path $root ".env"
$nodePath = Join-Path $env:ProgramFiles "nodejs\node.exe"
$serverFile = Join-Path $root "server.js"
$reportDir = Join-Path $root "test-reports"
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$reportPath = Join-Path $reportDir "atlas-lan-fresh-reset-$stamp.md"

if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match "^PORT=(\d+)$") { $port = [int]$Matches[1] }
    }
}

function Write-Step {
    param([string]$Message)
    Write-Host $Message -ForegroundColor Cyan
}

function Test-Http {
    param([string]$Url)
    try {
        $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 10
        return [pscustomobject]@{
            Url = $Url
            Ok = $true
            StatusCode = $response.StatusCode
            Detail = "OK"
        }
    } catch {
        return [pscustomobject]@{
            Url = $Url
            Ok = $false
            StatusCode = ""
            Detail = $_.Exception.Message
        }
    }
}

$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator
)

if (-not $isAdmin) {
    throw "Run this script as Administrator. Use Reset-ATLAS-LAN-Fresh-Run-As-Admin.bat."
}

if (-not (Test-Path $nodePath)) { throw "Node.js was not found at $nodePath" }
if (-not (Test-Path $serverFile)) { throw "server.js was not found at $serverFile" }
if (-not (Test-Path $reportDir)) { New-Item -ItemType Directory -Path $reportDir | Out-Null }

Write-Step "Resetting ATLAS firewall rules..."
Get-NetFirewallRule -DisplayName "ATLAS*" -ErrorAction SilentlyContinue | Remove-NetFirewallRule

New-NetFirewallRule -DisplayName "ATLAS LAN TCP $port" -Direction Inbound -Action Allow -Protocol TCP -LocalPort $port -Profile Any | Out-Null
New-NetFirewallRule -DisplayName "ATLAS Node.js Runtime" -Direction Inbound -Action Allow -Program $nodePath -Profile Any | Out-Null
New-NetFirewallRule -DisplayName "ATLAS Allow Ping IPv4" -Protocol ICMPv4 -IcmpType 8 -Direction Inbound -Action Allow -Profile Any | Out-Null

Write-Step "Setting active network profiles to Private..."
Get-NetConnectionProfile |
    Where-Object { $_.IPv4Connectivity -ne "Disconnected" } |
    ForEach-Object {
        if ($_.NetworkCategory -ne "Private") {
            Set-NetConnectionProfile -InterfaceIndex $_.InterfaceIndex -NetworkCategory Private
        }
    }

Write-Step "Restarting ATLAS listener on port $port..."
$listeners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
foreach ($listener in $listeners) {
    $proc = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
    if ($proc -and $proc.Path -eq $nodePath) {
        Stop-Process -Id $proc.Id -Force
    }
}

Start-Sleep -Seconds 2
Start-Process -FilePath $nodePath -ArgumentList "server.js" -WorkingDirectory $root -WindowStyle Hidden

$ready = $false
for ($attempt = 1; $attempt -le 30; $attempt++) {
    Start-Sleep -Seconds 2
    $localHealth = Test-Http "http://127.0.0.1:$port/api/health"
    if ($localHealth.Ok) {
        $ready = $true
        break
    }
}

if (-not $ready) {
    throw "ATLAS did not become healthy at http://127.0.0.1:$port/api/health."
}

$lanIps = Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object {
        $_.IPAddress -ne "127.0.0.1" -and
        $_.IPAddress -notlike "169.254*" -and
        ($_.IPAddress -like "192.168.*" -or $_.IPAddress -like "10.*" -or $_.IPAddress -like "172.*")
    } |
    Sort-Object InterfaceMetric |
    Select-Object IPAddress, InterfaceAlias, PrefixLength, InterfaceMetric

$primaryIp = $lanIps | Select-Object -First 1 -ExpandProperty IPAddress
if (-not $primaryIp) { throw "No LAN IPv4 address was found." }

$checks = @(
    (Test-Http "http://127.0.0.1:$port/api/health"),
    (Test-Http "http://$primaryIp`:$port/api/health"),
    (Test-Http "http://$primaryIp`:$port/")
)

$profiles = Get-NetConnectionProfile | Select-Object Name, InterfaceAlias, NetworkCategory, IPv4Connectivity
$rules = Get-NetFirewallRule -DisplayName "ATLAS*" -ErrorAction SilentlyContinue |
    Select-Object DisplayName, Enabled, Direction, Action, Profile
$listening = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
    Select-Object LocalAddress, LocalPort, OwningProcess

$report = @"
# ATLAS LAN Fresh Reset

Date: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
Port: $port
Primary LAN URL: http://$primaryIp`:$port/
Health URL: http://$primaryIp`:$port/api/health

## Result

$($checks | ForEach-Object { "- $($_.Url): $($_.StatusCode) $($_.Detail)" } | Out-String)

## Listener

$($listening | Format-Table -AutoSize | Out-String)

## Network Profiles

$($profiles | Format-Table -AutoSize | Out-String)

## LAN IPs

$($lanIps | Format-Table -AutoSize | Out-String)

## Firewall Rules

$($rules | Format-Table -AutoSize | Out-String)

## Other PC Test

From another PC on the same Wi-Fi/LAN:

1. Open http://$primaryIp`:$port/
2. Run: Test-NetConnection $primaryIp -Port $port
3. If both fail while local checks pass, check router/client isolation, guest Wi-Fi, VPN, or a different subnet on the other PC.
"@

$report | Set-Content -Path $reportPath -Encoding UTF8

Write-Host ""
Write-Host "ATLAS LAN reset completed." -ForegroundColor Green
Write-Host "Open from other PCs: http://$primaryIp`:$port/" -ForegroundColor Green
Write-Host "Report written to: $reportPath" -ForegroundColor Green
Write-Host ""
Write-Host "If another PC still cannot connect, the app and Windows host are passing local LAN checks; the remaining block is usually router/client isolation, guest Wi-Fi, VPN, or a different subnet."
