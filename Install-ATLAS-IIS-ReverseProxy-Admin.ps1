$ErrorActionPreference = "Stop"

$root = "C:\Airfare_Allowance"
$siteName = "ATLAS Airfare HCM"
$sitePath = Join-Path $root "iis-site"
$webConfig = Join-Path $sitePath "web.config"
$logDir = Join-Path $root "logs"
$logFile = Join-Path $logDir "iis-reverse-proxy-install.log"
$appcmd = Join-Path $env:windir "system32\inetsrv\appcmd.exe"
$atlasHost = $env:COMPUTERNAME
if (-not $atlasHost) { $atlasHost = [System.Net.Dns]::GetHostName() }
if (-not $atlasHost) { $atlasHost = "localhost" }

if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}

function Write-Step {
    param([string]$Message)
    $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
    Write-Host $Message -ForegroundColor Cyan
    Add-Content -Path $logFile -Value $line -Encoding ASCII
}

function Assert-Admin {
    $isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator
    )
    if (-not $isAdmin) {
        throw "Run this script as Administrator."
    }
}

function Test-HttpOk {
    param([string]$Url)
    try {
        $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 15
        return ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500)
    } catch {
        return $false
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
Write-Step "Starting ATLAS IIS reverse proxy setup."

Write-Step "Verifying ATLAS app is healthy on internal port 3355."
$health = Invoke-RestMethod -Uri "http://127.0.0.1:3355/api/health" -TimeoutSec 15
if ($health.status -ne "healthy") {
    throw "ATLAS app on 3355 is not healthy."
}

Write-Step "Installing Microsoft IIS URL Rewrite module if missing."
if (-not (Test-Path "C:\Program Files\IIS\URL Rewrite\rewrite.dll")) {
    winget install --id Microsoft.IIS.URLRewrite -e --silent --accept-source-agreements --accept-package-agreements
}

Write-Step "Installing Microsoft IIS Application Request Routing module if missing."
if (-not (Test-Path "C:\Program Files\IIS\Application Request Routing\requestRouter.dll")) {
    winget install --id Microsoft.IIS.ApplicationRequestRouting -e --silent --accept-source-agreements --accept-package-agreements
}

Write-Step "Creating IIS proxy site folder."
if (-not (Test-Path $sitePath)) {
    New-Item -ItemType Directory -Path $sitePath -Force | Out-Null
}

@"
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
  <system.webServer>
    <rewrite>
      <rules>
        <rule name="ATLAS reverse proxy to Node 3355" stopProcessing="true">
          <match url="(.*)" />
          <action type="Rewrite" url="http://127.0.0.1:3355/{R:1}" logRewrittenUrl="true" />
        </rule>
      </rules>
    </rewrite>
  </system.webServer>
</configuration>
"@ | Set-Content -Path $webConfig -Encoding UTF8

Write-Step "Enabling ARR reverse proxy mode."
& $appcmd set config -section:system.webServer/proxy /enabled:"True" /preserveHostHeader:"True" /commit:apphost | Out-Null

Write-Step "Creating or updating IIS site on port 80."
$existingSite = & $appcmd list site /name:"$siteName" 2>$null
if ($existingSite) {
    & $appcmd set site /site.name:"$siteName" /[path='/'].physicalPath:"$sitePath" | Out-Null
} else {
    & $appcmd add site /name:"$siteName" /bindings:"http/*:80:" /physicalPath:"$sitePath" | Out-Null
}

Write-Step "Stopping other IIS sites that also bind to port 80 to avoid conflict."
$sites = & $appcmd list site
$sites | Where-Object { $_ -match 'bindings:http/\*:80:' -and $_ -notmatch [regex]::Escape($siteName) } | ForEach-Object {
    if ($_ -match 'SITE "([^"]+)"') {
        & $appcmd stop site /site.name:"$($Matches[1])" | Out-Null
    }
}

Write-Step "Starting ATLAS IIS site."
& $appcmd start site /site.name:"$siteName" | Out-Null

Write-Step "Opening Windows Firewall for IIS port 80."
if (Get-NetFirewallRule -DisplayName "ATLAS IIS Port 80" -ErrorAction SilentlyContinue) {
    Set-NetFirewallRule -DisplayName "ATLAS IIS Port 80" -Enabled True -Direction Inbound -Action Allow -Profile Any
} else {
    New-NetFirewallRule -DisplayName "ATLAS IIS Port 80" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 80 -Profile Any | Out-Null
}

Write-Step "Restarting IIS."
iisreset /restart | Out-Null

Start-Sleep -Seconds 3
Write-Step "Testing IIS local proxy health."
if (-not (Test-HttpOk -Url "http://127.0.0.1/api/health")) {
    throw "IIS proxy did not return a health response on http://127.0.0.1/api/health"
}

Write-Step "Testing IIS LAN proxy health."
$lanIp = Get-AtlasLanAddress
if (-not (Test-HttpOk -Url "http://$lanIp/api/health")) {
    throw "IIS proxy did not return a health response on http://$lanIp/api/health"
}

Write-Step "Testing IIS computer-name proxy health."
if (-not (Test-HttpOk -Url "http://$atlasHost/api/health")) {
    throw "IIS proxy did not return a health response on http://$atlasHost/api/health"
}

Write-Step "ATLAS IIS reverse proxy setup completed successfully."
Write-Host ""
Write-Host "Use this URL from other systems:" -ForegroundColor Green
Write-Host "http://$atlasHost/" -ForegroundColor Green
Write-Host ""
Write-Host "IP fallback if the network blocks name lookup:"
Write-Host "http://$lanIp/"
Write-Host ""
Read-Host "Press Enter to close"
