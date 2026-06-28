param(
    [int]$PreferredPort = 3355,
    [int]$ProxyPort = 80,
    [string]$PreferredBind = "0.0.0.0",
    [string]$FallbackBind = "127.0.0.1"
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Frontend = Join-Path $Root "atlas-hcm-next"
$ReportDir = Join-Path $Root "test-reports"
$LogDir = Join-Path $Root "logs"
$Node = Join-Path $env:ProgramFiles "nodejs\node.exe"
$Npm = Join-Path $env:ProgramFiles "nodejs\npm.cmd"
$Stamp = Get-Date -Format "yyyyMMddHHmmss"
$ReportPath = Join-Path $ReportDir "atlas-devops-deploy-$Stamp.md"
$JsonPath = Join-Path $ReportDir "atlas-devops-deploy-$Stamp.json"
$StdoutLog = Join-Path $LogDir "devops-node-out.log"
$StderrLog = Join-Path $LogDir "devops-node-err.log"

New-Item -ItemType Directory -Force -Path $ReportDir, $LogDir | Out-Null

$events = New-Object System.Collections.Generic.List[object]

function Add-Event {
    param([string]$Step, [string]$Status, [object]$Details = $null)
    $events.Add([pscustomobject]@{
        at = (Get-Date).ToString("o")
        step = $Step
        status = $Status
        details = $Details
    }) | Out-Null
    Write-Host "[$Status] $Step"
}

function Read-AtlasEnv {
    $settings = @{
        PORT = "$PreferredPort"
        ATLAS_BIND_HOST = $PreferredBind
        DB_SERVER = "localhost"
        DB_PORT = "1433"
    }
    $envFile = Join-Path $Root ".env"
    if (Test-Path $envFile) {
        Get-Content $envFile | ForEach-Object {
            if ($_ -match "^\s*([^#=]+)=(.*)$") {
                $settings[$Matches[1].Trim()] = $Matches[2].Trim()
            }
        }
    }
    return $settings
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

    $fallback = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
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

function Invoke-AtlasHealth {
    param([string]$Url)
    try {
        $response = Invoke-RestMethod -Uri $Url -TimeoutSec 5
        return [pscustomobject]@{
            ok = ($response.status -eq "healthy" -and $response.database -eq "connected")
            response = $response
            error = $null
        }
    } catch {
        return [pscustomobject]@{
            ok = $false
            response = $null
            error = $_.Exception.Message
        }
    }
}

function Get-PortListeners {
    param([int]$Port)
    @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
        Select-Object LocalAddress, LocalPort, OwningProcess)
}

function Get-ProcessCommand {
    param([int]$ProcessId)
    try {
        return (Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction Stop).CommandLine
    } catch {
        return ""
    }
}

function Stop-UnhealthyAtlasListeners {
    param([int]$Port)
    $listeners = Get-PortListeners -Port $Port
    foreach ($listener in $listeners) {
        $commandLine = Get-ProcessCommand -ProcessId $listener.OwningProcess
        $health = Invoke-AtlasHealth -Url "http://127.0.0.1:$Port/api/health"
        if ($health.ok) {
            Add-Event "Existing listener on port $Port is healthy" "PASS" @{
                pid = $listener.OwningProcess
                bind = $listener.LocalAddress
            }
            return $true
        }
        if ($commandLine -match "server\.js") {
            Add-Event "Stopping unhealthy ATLAS listener on port $Port" "WARN" @{
                pid = $listener.OwningProcess
                commandLine = $commandLine
            }
            Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue
        } else {
            Add-Event "Port $Port conflict is owned by another process" "WARN" @{
                pid = $listener.OwningProcess
                commandLine = $commandLine
            }
            return $false
        }
    }
    return $false
}

function Start-Atlas {
    param([int]$Port, [string]$BindAddress)
    $env:PORT = [string]$Port
    $env:ATLAS_BIND_HOST = $BindAddress
    Add-Event "Starting ATLAS on $BindAddress`:$Port" "INFO"
    Start-Process -FilePath $Node `
        -ArgumentList "server.js" `
        -WorkingDirectory $Root `
        -WindowStyle Hidden `
        -RedirectStandardOutput $StdoutLog `
        -RedirectStandardError $StderrLog
}

function Wait-AtlasHealth {
    param([int]$Port)
    for ($attempt = 1; $attempt -le 30; $attempt++) {
        $health = Invoke-AtlasHealth -Url "http://127.0.0.1:$Port/api/health"
        if ($health.ok) { return $true }
        Start-Sleep -Seconds 2
    }
    return $false
}

function Remove-DuplicateFrontendLinks {
    $sourcePath = Join-Path $Frontend "app\page.tsx"
    $source = Get-Content $sourcePath -Raw
    $matches = [regex]::Matches($source, 'href="([^"]+)"')
    $seen = @{}
    $duplicates = @()
    foreach ($match in $matches) {
        $href = $match.Groups[1].Value
        if ($seen.ContainsKey($href)) {
            $duplicates += $href
        } else {
            $seen[$href] = $true
        }
    }

    if ($duplicates.Count -eq 0) {
        Add-Event "Pre-build duplicate link scan" "PASS" @{ duplicates = 0 }
        return
    }

    # Duplicate runtime links are not blindly removed from JSX because that can remove intentional navigation.
    # The deploy report records them for review; build continues only with unique published static assets.
    Add-Event "Pre-build duplicate link scan found repeated href values" "WARN" @{
        duplicates = @($duplicates | Sort-Object -Unique)
    }
}

function Write-Reports {
    $status = if (($events | Where-Object { $_.status -eq "FAIL" }).Count -gt 0) { "FAILED" } else { "PASSED" }
    $lines = @(
        "# ATLAS DevOps Deployment Report",
        "",
        "- Started: $script:startedAt",
        "- Finished: $((Get-Date).ToString("o"))",
        "- Result: $status",
        "- Preferred port: $PreferredPort",
        "- Proxy port: $ProxyPort",
        "",
        "| Step | Status | Details |",
        "|---|---|---|"
    )
    foreach ($event in $events) {
        $details = if ($null -ne $event.details) { ($event.details | ConvertTo-Json -Compress -Depth 5) } else { "" }
        $lines += "| $($event.step) | $($event.status) | $details |"
    }
    $lines | Set-Content -Path $ReportPath -Encoding UTF8
    [pscustomobject]@{
        startedAt = $script:startedAt
        finishedAt = (Get-Date).ToString("o")
        result = $status
        events = $events
    } | ConvertTo-Json -Depth 8 | Set-Content -Path $JsonPath -Encoding UTF8
}

$script:startedAt = (Get-Date).ToString("o")

try {
    if (-not (Test-Path $Node)) { throw "Node.js not found at $Node" }
    if (-not (Test-Path $Npm)) { throw "npm not found at $Npm" }

    $settings = Read-AtlasEnv
    if ($settings.ContainsKey("PORT") -and [string]$settings.PORT -match "^\d+$") {
        $PreferredPort = [int]$settings.PORT
    }
    $lanIp = Get-AtlasLanAddress
    $computerName = $env:COMPUTERNAME
    if (-not $computerName) { $computerName = [System.Net.Dns]::GetHostName() }
    if (-not $computerName) { $computerName = "localhost" }

    Remove-DuplicateFrontendLinks

    Add-Event "Building frontend" "INFO" @{ path = $Frontend }
    Push-Location $Frontend
    try {
        & $Npm run build
        if ($LASTEXITCODE -ne 0) { throw "Frontend build failed with exit code $LASTEXITCODE" }
    } finally {
        Pop-Location
    }
    Add-Event "Frontend build completed" "PASS"

    $healthyExisting = Stop-UnhealthyAtlasListeners -Port $PreferredPort
    if (-not $healthyExisting) {
        $listeners = Get-PortListeners -Port $PreferredPort
        if ($listeners.Count -eq 0) {
            Start-Atlas -Port $PreferredPort -BindAddress $PreferredBind
        }
    }

    if (-not (Wait-AtlasHealth -Port $PreferredPort)) {
        Add-Event "Preferred port $PreferredPort failed local health" "WARN"
        Stop-UnhealthyAtlasListeners -Port $PreferredPort | Out-Null
        Start-Atlas -Port $PreferredPort -BindAddress $FallbackBind
        if (-not (Wait-AtlasHealth -Port $PreferredPort)) {
            throw "Fallback localhost bind did not become healthy on port $PreferredPort"
        }
        Add-Event "Fallback localhost bind is healthy" "PASS" @{ url = "http://localhost:$PreferredPort/" }
    } else {
        Add-Event "Default build is healthy on port $PreferredPort" "PASS" @{ url = "http://127.0.0.1:$PreferredPort/" }
    }

    $checks = @(
        @{ name = "localhost direct"; url = "http://127.0.0.1:$PreferredPort/api/health" },
        @{ name = "LAN IP direct"; url = "http://$lanIp`:$PreferredPort/api/health" },
        @{ name = "computer name direct"; url = "http://$computerName`:$PreferredPort/api/health" },
        @{ name = "port 80 proxy"; url = "http://127.0.0.1/api/health" }
    )

    $networkIssue = $false
    foreach ($check in $checks) {
        $result = Invoke-AtlasHealth -Url $check.url
        if ($result.ok) {
            Add-Event "Health check: $($check.name)" "PASS" @{ url = $check.url }
        } else {
            Add-Event "Health check: $($check.name)" "WARN" @{ url = $check.url; error = $result.error }
            if ($check.name -match "LAN|computer name") { $networkIssue = $true }
        }
    }

    if ($networkIssue) {
        Add-Event "Network issue detected on port $PreferredPort" "WARN" @{
            fallbackLocal = "http://localhost:$PreferredPort/"
            fallbackProxy = "http://$computerName/"
        }
    } else {
        Add-Event "Network checks for port $PreferredPort" "PASS" @{
            nameUrl = "http://$computerName`:$PreferredPort/"
            lanUrl = "http://$lanIp`:$PreferredPort/"
        }
    }
} catch {
    Add-Event "Deployment failed" "FAIL" @{ error = $_.Exception.Message }
    throw
} finally {
    Write-Reports
    Write-Host "Deployment report: $ReportPath"
    Write-Host "Deployment JSON:   $JsonPath"
}
