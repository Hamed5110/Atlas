$ErrorActionPreference = "Continue"

$atlasHost = "FOCUSSERVER"
$atlasPort = 3355
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$desktop = [Environment]::GetFolderPath("Desktop")
$reportPath = Join-Path $desktop "ATLAS-LAN-Other-PC-Test-$stamp.txt"

function Add-Section {
    param([string]$Title)
    "`r`n=== $Title ===" | Tee-Object -FilePath $reportPath -Append
}

"ATLAS LAN test from this PC" | Set-Content -Path $reportPath -Encoding UTF8
"Date: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" | Tee-Object -FilePath $reportPath -Append
"Target by name: http://$atlasHost/" | Tee-Object -FilePath $reportPath -Append
"Direct fallback by name: http://$atlasHost`:$atlasPort/" | Tee-Object -FilePath $reportPath -Append

Add-Section "This PC IP"
Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.IPAddress -ne "127.0.0.1" -and $_.IPAddress -notlike "169.254*" } |
    Select-Object IPAddress, InterfaceAlias, PrefixLength |
    Format-Table -AutoSize |
    Out-String |
    Tee-Object -FilePath $reportPath -Append

Add-Section "Network Profile"
Get-NetConnectionProfile |
    Select-Object Name, InterfaceAlias, NetworkCategory, IPv4Connectivity |
    Format-Table -AutoSize |
    Out-String |
    Tee-Object -FilePath $reportPath -Append

Add-Section "Ping"
Test-Connection $atlasHost -Count 4 |
    Format-Table -AutoSize |
    Out-String |
    Tee-Object -FilePath $reportPath -Append

Add-Section "Resolve-DnsName"
try {
    Resolve-DnsName $atlasHost -ErrorAction Stop |
        Format-Table -AutoSize |
        Out-String |
        Tee-Object -FilePath $reportPath -Append
} catch {
    $_.Exception.Message | Tee-Object -FilePath $reportPath -Append
}

Add-Section "NetBIOS Name Lookup"
nbtstat -a $atlasHost |
    Out-String |
    Tee-Object -FilePath $reportPath -Append

Add-Section "TCP Port 80 by name"
Test-NetConnection $atlasHost -Port 80 -InformationLevel Detailed |
    Format-List |
    Out-String |
    Tee-Object -FilePath $reportPath -Append

Add-Section "TCP Port 3355 by name"
Test-NetConnection $atlasHost -Port $atlasPort -InformationLevel Detailed |
    Format-List |
    Out-String |
    Tee-Object -FilePath $reportPath -Append

Add-Section "HTTP Health by name through IIS"
try {
    Invoke-WebRequest -Uri "http://$atlasHost/api/health" -UseBasicParsing -TimeoutSec 10 |
        Select-Object StatusCode, Content |
        Format-List |
        Out-String |
        Tee-Object -FilePath $reportPath -Append
} catch {
    $_.Exception.Message | Tee-Object -FilePath $reportPath -Append
}

Add-Section "HTTP Page by name through IIS"
try {
    Invoke-WebRequest -Uri "http://$atlasHost/" -UseBasicParsing -TimeoutSec 10 |
        Select-Object StatusCode, StatusDescription |
        Format-List |
        Out-String |
        Tee-Object -FilePath $reportPath -Append
} catch {
    $_.Exception.Message | Tee-Object -FilePath $reportPath -Append
}

Add-Section "Interpretation"
@"
If Ping fails and TCP fails:
  The other PC cannot resolve or reach the ATLAS PC by name. Try the current IP fallback shown on the ATLAS PC, then check guest Wi-Fi, client/device isolation, VPN, VLAN, DNS/NetBIOS, or subnet mismatch.

If Ping works but port 80 TcpTestSucceeded is False:
  Name resolution works, but IIS port 80 is blocked. Re-run the ATLAS IIS setup script as Administrator and check third-party security software.

If TCP works but HTTP fails:
  The port is reachable, but browser/proxy/security software is interfering. Try another browser and disable proxy/VPN for this LAN address.

If HTTP health works:
  The API is reachable. Open http://$atlasHost/ in the browser.
"@ | Tee-Object -FilePath $reportPath -Append

Write-Host ""
Write-Host "Report written to: $reportPath" -ForegroundColor Green
Read-Host "Press Enter to close"
