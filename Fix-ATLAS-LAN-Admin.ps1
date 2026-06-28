$ErrorActionPreference = "Stop"

$port = 3355
$atlasHost = $env:COMPUTERNAME
if (-not $atlasHost) { $atlasHost = [System.Net.Dns]::GetHostName() }
if (-not $atlasHost) { $atlasHost = "localhost" }
$ruleName = "ATLAS Airfare HCM Port 3355"
$appRoot = "C:\Airfare_Allowance"
$nodePath = "C:\Program Files\nodejs\node.exe"

Write-Host "ATLAS LAN permanent fix starting..." -ForegroundColor Cyan

$profiles = Get-NetConnectionProfile | Where-Object { $_.IPv4Connectivity -ne "Disconnected" }
foreach ($profile in $profiles) {
    if ($profile.NetworkCategory -ne "Private") {
        Write-Host "Setting network '$($profile.Name)' / '$($profile.InterfaceAlias)' to Private..."
        Set-NetConnectionProfile -InterfaceIndex $profile.InterfaceIndex -NetworkCategory Private
    }
}

if (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue) {
    Set-NetFirewallRule -DisplayName $ruleName -Enabled True -Direction Inbound -Action Allow -Profile Any
} else {
    New-NetFirewallRule `
        -DisplayName $ruleName `
        -Direction Inbound `
        -Action Allow `
        -Protocol TCP `
        -LocalPort $port `
        -Profile Any | Out-Null
}

if (Test-Path $nodePath) {
    $nodeRuleName = "ATLAS Node.js Runtime"
    if (Get-NetFirewallRule -DisplayName $nodeRuleName -ErrorAction SilentlyContinue) {
        Set-NetFirewallRule -DisplayName $nodeRuleName -Enabled True -Direction Inbound -Action Allow -Profile Any
    } else {
        New-NetFirewallRule `
            -DisplayName $nodeRuleName `
            -Direction Inbound `
            -Action Allow `
            -Program $nodePath `
            -Profile Any | Out-Null
    }
}

Write-Host ""
Write-Host "Current IP addresses:" -ForegroundColor Cyan
Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.IPAddress -notlike "169.254*" -and $_.IPAddress -ne "127.0.0.1" } |
    Select-Object IPAddress, InterfaceAlias, PrefixLength |
    Format-Table -AutoSize

Write-Host ""
Write-Host "Firewall rules:" -ForegroundColor Cyan
Get-NetFirewallRule -DisplayName $ruleName, "ATLAS Node.js Runtime" -ErrorAction SilentlyContinue |
    Select-Object DisplayName, Enabled, Direction, Action, Profile |
    Format-Table -AutoSize

Write-Host ""
Write-Host "Testing local ATLAS health..." -ForegroundColor Cyan
Invoke-RestMethod -Uri "http://localhost:$port/api/health" -TimeoutSec 10 | ConvertTo-Json

Write-Host ""
Write-Host "ATLAS LAN should now open from another PC:" -ForegroundColor Green
Write-Host "http://$atlasHost/"
Write-Host "Direct fallback: http://$atlasHost`:$port/"
Write-Host ""
Read-Host "Press Enter to close"
