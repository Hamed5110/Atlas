$ErrorActionPreference = "Stop"

$ruleName = "ATLAS Airfare HCM Port 3355"
$port = 3355
$atlasHost = $env:COMPUTERNAME
if (-not $atlasHost) { $atlasHost = [System.Net.Dns]::GetHostName() }
if (-not $atlasHost) { $atlasHost = "localhost" }

if (-not (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule `
        -DisplayName $ruleName `
        -Direction Inbound `
        -Action Allow `
        -Protocol TCP `
        -LocalPort $port `
        -Profile Any | Out-Null
}

Get-NetFirewallRule -DisplayName $ruleName |
    Select-Object DisplayName, Enabled, Direction, Action, Profile |
    Format-Table -AutoSize

Write-Host ""
Write-Host "ATLAS LAN firewall rule is ready for port $port."
Write-Host "Open from another PC: http://$atlasHost/"
Write-Host "Direct fallback: http://$atlasHost`:$port/"
