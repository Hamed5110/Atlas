$ErrorActionPreference = "Stop"

$atlasHost = $env:COMPUTERNAME
if (-not $atlasHost) { $atlasHost = [System.Net.Dns]::GetHostName() }
if (-not $atlasHost) { $atlasHost = "localhost" }
$atlasPort = 3355
$portRuleName = "ATLAS Airfare HCM Port 3355"
$nodeRuleName = "ATLAS Node.js Runtime"
$icmpRuleName = "ATLAS Allow Ping IPv4"
$nodePath = "C:\Program Files\nodejs\node.exe"

Write-Host "Applying deeper ATLAS LAN access rules..." -ForegroundColor Cyan

$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator
)

if (-not $isAdmin) {
    Write-Host "This repair must be run as Administrator to change Windows Firewall and network profile." -ForegroundColor Yellow
    Write-Host "Close this window, then run: C:\Airfare_Allowance\Fix-ATLAS-LAN-Run-As-Admin.bat" -ForegroundColor Yellow
    Write-Host ""
}

Get-NetConnectionProfile | Where-Object { $_.IPv4Connectivity -ne "Disconnected" } | ForEach-Object {
    try {
        Set-NetConnectionProfile -InterfaceIndex $_.InterfaceIndex -NetworkCategory Private
    } catch {
        Write-Host "Could not change network profile for $($_.InterfaceAlias): $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

try {
    if (Get-NetFirewallRule -DisplayName $portRuleName -ErrorAction SilentlyContinue) {
        Set-NetFirewallRule -DisplayName $portRuleName -Enabled True -Direction Inbound -Action Allow -Profile Any
    } else {
        New-NetFirewallRule -DisplayName $portRuleName -Direction Inbound -Action Allow -Protocol TCP -LocalPort $atlasPort -Profile Any | Out-Null
    }
} catch {
    Write-Host "Could not update port firewall rule: $($_.Exception.Message)" -ForegroundColor Yellow
}

if (Test-Path $nodePath) {
    try {
        if (Get-NetFirewallRule -DisplayName $nodeRuleName -ErrorAction SilentlyContinue) {
            Set-NetFirewallRule -DisplayName $nodeRuleName -Enabled True -Direction Inbound -Action Allow -Profile Any
        } else {
            New-NetFirewallRule -DisplayName $nodeRuleName -Direction Inbound -Action Allow -Program $nodePath -Profile Any | Out-Null
        }
    } catch {
        Write-Host "Could not update Node firewall rule: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

try {
    if (Get-NetFirewallRule -DisplayName $icmpRuleName -ErrorAction SilentlyContinue) {
        Set-NetFirewallRule -DisplayName $icmpRuleName -Enabled True -Direction Inbound -Action Allow -Profile Any
    } else {
        New-NetFirewallRule -DisplayName $icmpRuleName -Protocol ICMPv4 -IcmpType 8 -Direction Inbound -Action Allow -Profile Any | Out-Null
    }
} catch {
    Write-Host "Could not update ping firewall rule: $($_.Exception.Message)" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "ATLAS PC network profile:" -ForegroundColor Cyan
Get-NetConnectionProfile | Select-Object Name, InterfaceAlias, NetworkCategory, IPv4Connectivity | Format-Table -AutoSize

Write-Host ""
Write-Host "ATLAS firewall rules:" -ForegroundColor Cyan
Get-NetFirewallRule -DisplayName $portRuleName, $nodeRuleName, $icmpRuleName -ErrorAction SilentlyContinue |
    Select-Object DisplayName, Enabled, Direction, Action, Profile |
    Format-Table -AutoSize

Write-Host ""
Write-Host "Local health check:" -ForegroundColor Cyan
Invoke-RestMethod -Uri "http://127.0.0.1:$atlasPort/api/health" -TimeoutSec 10 | ConvertTo-Json

Write-Host ""
Write-Host "Now test from OTHER PC:" -ForegroundColor Yellow
Write-Host "1) ping $atlasHost"
Write-Host "2) powershell: Test-NetConnection $atlasHost -Port 80"
Write-Host "3) browser: http://$atlasHost/"
Write-Host ""
Write-Host "If ping and Test-NetConnection fail from other PC, name lookup, router/Wi-Fi isolation, or another network is blocking access."
Read-Host "Press Enter to close"
