param(
    [int]$ExpectedPort = 3355,
    [int]$ProxyPort = 80
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$ReportDir = Join-Path $Root "test-reports"
$Stamp = Get-Date -Format "yyyyMMddHHmmss"
$ReportPath = Join-Path $ReportDir "atlas-environment-verification-$Stamp.md"
$JsonPath = Join-Path $ReportDir "atlas-environment-verification-$Stamp.json"

New-Item -ItemType Directory -Force -Path $ReportDir | Out-Null

$checks = New-Object System.Collections.Generic.List[object]

function Add-Check {
    param([string]$Name, [string]$Status, [object]$Details = $null)
    $checks.Add([pscustomobject]@{
        at = (Get-Date).ToString("o")
        name = $Name
        status = $Status
        details = $Details
    }) | Out-Null
    Write-Host "[$Status] $Name"
}

function Get-ProcessCommand {
    param([int]$ProcessId)
    try {
        return (Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction Stop).CommandLine
    } catch {
        return ""
    }
}

function Invoke-Health {
    param([string]$Url)
    try {
        $response = Invoke-RestMethod -Uri $Url -TimeoutSec 5
        return [pscustomobject]@{
            ok = ($response.status -eq "healthy" -and $response.database -eq "connected")
            error = $null
            response = $response
        }
    } catch {
        return [pscustomobject]@{
            ok = $false
            error = $_.Exception.Message
            response = $null
        }
    }
}

function Get-LanIp {
    $preferredRoute = Get-NetRoute -DestinationPrefix "0.0.0.0/0" -ErrorAction SilentlyContinue |
        Sort-Object RouteMetric, InterfaceMetric |
        Select-Object -First 1
    if ($preferredRoute) {
        $routeIp = Get-NetIPAddress -AddressFamily IPv4 -InterfaceIndex $preferredRoute.InterfaceIndex -ErrorAction SilentlyContinue |
            Where-Object { $_.IPAddress -notlike "169.254*" -and $_.IPAddress -ne "127.0.0.1" } |
            Select-Object -First 1 -ExpandProperty IPAddress
        if ($routeIp) { return $routeIp }
    }
    return "localhost"
}

$startedAt = (Get-Date).ToString("o")
$computerName = $env:COMPUTERNAME
if (-not $computerName) { $computerName = [System.Net.Dns]::GetHostName() }
if (-not $computerName) { $computerName = "localhost" }
$lanIp = Get-LanIp

$listeners = @(Get-NetTCPConnection -LocalPort $ExpectedPort -State Listen -ErrorAction SilentlyContinue)
if ($listeners.Count -eq 0) {
    Add-Check "Verify current active port $ExpectedPort" "FAIL" @{ message = "No listener found." }
} else {
    foreach ($listener in $listeners) {
        Add-Check "Verify current active port $ExpectedPort" "PASS" @{
            localAddress = $listener.LocalAddress
            localPort = $listener.LocalPort
            pid = $listener.OwningProcess
            commandLine = Get-ProcessCommand -ProcessId $listener.OwningProcess
        }
    }
}

$proxyListeners = @(Get-NetTCPConnection -LocalPort $ProxyPort -State Listen -ErrorAction SilentlyContinue)
if ($proxyListeners.Count -gt 0) {
    foreach ($listener in $proxyListeners) {
        Add-Check "Verify proxy fallback port $ProxyPort" "PASS" @{
            localAddress = $listener.LocalAddress
            pid = $listener.OwningProcess
            commandLine = Get-ProcessCommand -ProcessId $listener.OwningProcess
        }
    }
} else {
    Add-Check "Verify proxy fallback port $ProxyPort" "WARN" @{ message = "No listener on proxy port." }
}

$requiredFiles = @(
    "server.js",
    "package.json",
    ".env",
    "atlas-hcm-next\package.json",
    "atlas-hcm-next\next.config.mjs",
    "tools\Deploy-ATLAS-DevOps.ps1",
    "tools\Verify-ATLAS-Environment.ps1"
)

$missing = @()
foreach ($file in $requiredFiles) {
    if (-not (Test-Path (Join-Path $Root $file))) { $missing += $file }
}

if ($missing.Count -eq 0) {
    Add-Check "Consolidate development environment" "PASS" @{
        root = $Root
        command = "npm run deploy:devops"
        verifyCommand = "npm run verify:env"
    }
} else {
    Add-Check "Consolidate development environment" "FAIL" @{ missing = $missing }
}

$sourcePath = Join-Path $Root "atlas-hcm-next\app\page.tsx"
$source = Get-Content $sourcePath -Raw
$hrefMatches = [regex]::Matches($source, 'href="([^"]+)"')
$seen = @{}
$duplicates = @()
foreach ($match in $hrefMatches) {
    $href = $match.Groups[1].Value
    if ($seen.ContainsKey($href)) { $duplicates += $href } else { $seen[$href] = $true }
}
if ($duplicates.Count -eq 0) {
    Add-Check "Enforce pre-build duplicate-link cleanliness" "PASS" @{ duplicateLinks = 0 }
} else {
    Add-Check "Enforce pre-build duplicate-link cleanliness" "WARN" @{ duplicateLinks = @($duplicates | Sort-Object -Unique) }
}

$urls = @(
    @{ name = "localhost direct"; url = "http://127.0.0.1:$ExpectedPort/api/health" },
    @{ name = "computer name direct"; url = "http://$computerName`:$ExpectedPort/api/health" },
    @{ name = "LAN IP direct"; url = "http://$lanIp`:$ExpectedPort/api/health" },
    @{ name = "localhost proxy"; url = "http://127.0.0.1/api/health" },
    @{ name = "computer name proxy"; url = "http://$computerName/api/health" }
)

foreach ($item in $urls) {
    $health = Invoke-Health -Url $item.url
    if ($health.ok) {
        Add-Check "Validate network fallback: $($item.name)" "PASS" @{ url = $item.url }
    } else {
        Add-Check "Validate network fallback: $($item.name)" "WARN" @{ url = $item.url; error = $health.error }
    }
}

$result = if (($checks | Where-Object { $_.status -eq "FAIL" }).Count -gt 0) { "FAILED" } else { "PASSED" }
$finishedAt = (Get-Date).ToString("o")

$lines = @(
    "# ATLAS Environment Verification",
    "",
    "- Started: $startedAt",
    "- Finished: $finishedAt",
    "- Result: $result",
    "- Active app port: $ExpectedPort",
    "- Proxy fallback port: $ProxyPort",
    "- Root: $Root",
    "",
    "| Check | Status | Details |",
    "|---|---|---|"
)

foreach ($check in $checks) {
    $details = if ($null -ne $check.details) { ($check.details | ConvertTo-Json -Depth 5 -Compress) } else { "" }
    $lines += "| $($check.name) | $($check.status) | $details |"
}

$lines | Set-Content -Path $ReportPath -Encoding UTF8
[pscustomobject]@{
    startedAt = $startedAt
    finishedAt = $finishedAt
    result = $result
    checks = $checks
} | ConvertTo-Json -Depth 8 | Set-Content -Path $JsonPath -Encoding UTF8

Write-Host "Verification report: $ReportPath"
Write-Host "Verification JSON:   $JsonPath"

if ($result -eq "FAILED") { exit 1 }
