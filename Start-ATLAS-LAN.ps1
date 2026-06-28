$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$frontend = Join-Path $root "atlas-hcm-next"
$node = Join-Path $env:ProgramFiles "nodejs\node.exe"
$npm = Join-Path $env:ProgramFiles "nodejs\npm.cmd"
$envFile = Join-Path $root ".env"
$dbServer = "localhost"
$dbPort = 1433
$apiPort = 3355

if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    if ($_ -match "^DB_SERVER=(.+)$") { $dbServer = $Matches[1].Trim() }
    if ($_ -match "^DB_PORT=(\d+)$") { $dbPort = [int]$Matches[1] }
    if ($_ -match "^PORT=(\d+)$") { $apiPort = [int]$Matches[1] }
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

$computerName = $env:COMPUTERNAME
if (-not $computerName) { $computerName = [System.Net.Dns]::GetHostName() }
if (-not $computerName) { $computerName = "localhost" }
$ip = Get-AtlasLanAddress

$apiUrl = "/api"
$localHealthUrl = "http://127.0.0.1:$apiPort/api/health"
$lanHealthUrl = "http://$ip`:$apiPort/api/health"

if (-not (Test-Path $node)) { throw "Node.js was not found at $node" }
if (-not (Test-Path $npm)) { throw "npm was not found at $npm" }

function Test-TcpPort {
  param([string]$Server, [int]$Port)
  try {
    $client = New-Object Net.Sockets.TcpClient
    $async = $client.BeginConnect($Server, $Port, $null, $null)
    $ready = $async.AsyncWaitHandle.WaitOne(1000, $false)
    if ($ready) { $client.EndConnect($async) }
    $client.Close()
    return $ready
  } catch {
    return $false
  }
}

Write-Host "Waiting for SQL Server ${dbServer}:$dbPort..."
for ($attempt = 1; $attempt -le 60) {
  if (Test-TcpPort -Server $dbServer -Port $dbPort) {
    Write-Host "SQL Server is ready."
    break
  }
  Start-Sleep -Seconds 5
}

if (-not (Get-NetTCPConnection -LocalPort $apiPort -State Listen -ErrorAction SilentlyContinue)) {
  Write-Host "Starting ATLAS API on port $apiPort..."
  Start-Process -FilePath $node -ArgumentList "server.js" -WorkingDirectory $root -WindowStyle Hidden
} else {
  Write-Host "ATLAS API is already running on port $apiPort. Checking health..."
}

$healthReady = $false
for ($attempt = 1; $attempt -le 30) {
  try {
    Invoke-RestMethod -Uri $localHealthUrl -TimeoutSec 2 | Out-Null
    Write-Host "ATLAS API health is ready."
    $healthReady = $true
    break
  } catch {
    if ($attempt -eq 1) {
      Write-Host "Waiting for ATLAS API health..."
    }
    Start-Sleep -Seconds 2
  }
}

if (-not $healthReady) {
  throw "ATLAS API is listening on port $apiPort, but health check did not respond at $localHealthUrl."
}

$env:NEXT_PUBLIC_ATLAS_API = $apiUrl

$buildPath = Join-Path $frontend "out"
if (-not (Test-Path $buildPath)) {
  Write-Host "Frontend build not found at $buildPath."
  Write-Host "Building frontend first..."
  Push-Location $frontend
  & $npm run build
  Pop-Location
}

Write-Host ""
Write-Host "ATLAS web:"
Write-Host "  Name URL:    http://$computerName/"
Write-Host "  Name direct: http://$computerName`:$apiPort/"
Write-Host "  IP fallback: http://$ip/"
Write-Host "  IP direct:   http://$ip`:$apiPort/"
Write-Host "  Local URL:   http://127.0.0.1:$apiPort/"
Write-Host ""
Write-Host "ATLAS API health:"
Write-Host "  Name IIS:    http://$computerName/api/health"
Write-Host "  Name direct: http://$computerName`:$apiPort/api/health"
Write-Host "  IP direct:   $lanHealthUrl"
Write-Host "  IP IIS:      http://$ip/api/health"
Write-Host ""
Write-Host "From other PCs on the same network:"
Write-Host "  http://$computerName/"
Write-Host "If name lookup is blocked on the network, use the current fallback: http://$ip/"
Write-Host "If another PC cannot open either address, check router/client isolation or firewall rules for ports 80 and $apiPort."
