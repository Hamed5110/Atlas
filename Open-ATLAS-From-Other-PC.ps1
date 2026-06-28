$ErrorActionPreference = "Continue"

$atlasHost = "FOCUSSERVER"
$atlasPort = 80
$directPort = 3355
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$desktop = [Environment]::GetFolderPath("Desktop")
$reportPath = Join-Path $desktop "ATLAS-Open-By-Name-Or-Find-$stamp.txt"

function Add-Line {
    param([string]$Line)
    $Line | Tee-Object -FilePath $reportPath -Append
}

function Test-AtlasHealth {
    param([string]$BaseUrl)
    try {
        $response = Invoke-WebRequest -Uri "$BaseUrl/api/health" -UseBasicParsing -TimeoutSec 2
        if ($response.StatusCode -eq 200 -and $response.Content -match '"status"\s*:\s*"healthy"') {
            return $true
        }
    } catch {
        return $false
    }
    return $false
}

function Test-TcpPort {
    param([string]$Server, [int]$Port, [int]$TimeoutMs = 250)
    try {
        $client = New-Object Net.Sockets.TcpClient
        $async = $client.BeginConnect($Server, $Port, $null, $null)
        $ready = $async.AsyncWaitHandle.WaitOne($TimeoutMs, $false)
        if ($ready) { $client.EndConnect($async) }
        $client.Close()
        return $ready
    } catch {
        return $false
    }
}

"ATLAS open by name or find" | Set-Content -Path $reportPath -Encoding UTF8
Add-Line "Date: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Add-Line "Preferred name: http://$atlasHost/"

Add-Line ""
Add-Line "=== Try computer name ==="
if (Test-AtlasHealth "http://$atlasHost") {
    Add-Line "Name works: http://$atlasHost/"
    Start-Process "http://$atlasHost/"
    Add-Line "Opened http://$atlasHost/"
    Add-Line "Report: $reportPath"
    exit 0
}

Add-Line "Name did not work. Scanning this PC's local subnet for ATLAS..."

$localIps = Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object {
        $_.IPAddress -notlike "169.254*" -and
        $_.IPAddress -ne "127.0.0.1" -and
        $_.PrefixLength -eq 24
    } |
    Select-Object -ExpandProperty IPAddress -Unique

$foundUrl = $null
foreach ($localIp in $localIps) {
    $prefix = ($localIp -split "\.")[0..2] -join "."
    Add-Line ""
    Add-Line "Scanning $prefix.1 to $prefix.254 on port 80..."

    foreach ($last in 1..254) {
        $candidate = "$prefix.$last"
        if ($candidate -eq $localIp) { continue }

        if (Test-TcpPort -Server $candidate -Port $atlasPort) {
            $url = "http://$candidate"
            if (Test-AtlasHealth $url) {
                $foundUrl = $url
                break
            }
        }
    }

    if ($foundUrl) { break }
}

if (-not $foundUrl) {
    foreach ($localIp in $localIps) {
        $prefix = ($localIp -split "\.")[0..2] -join "."
        Add-Line ""
        Add-Line "Scanning $prefix.1 to $prefix.254 on direct port 3355..."

        foreach ($last in 1..254) {
            $candidate = "$prefix.$last"
            if ($candidate -eq $localIp) { continue }

            if (Test-TcpPort -Server $candidate -Port $directPort) {
                $url = "http://$candidate`:$directPort"
                if (Test-AtlasHealth $url) {
                    $foundUrl = $url
                    break
                }
            }
        }

        if ($foundUrl) { break }
    }
}

Add-Line ""
Add-Line "=== Result ==="
if ($foundUrl) {
    Add-Line "Found ATLAS: $foundUrl/"
    Start-Process "$foundUrl/"
    Add-Line "Opened $foundUrl/"
} else {
    Add-Line "ATLAS was not found by name or scan."
    Add-Line "Confirm this PC is on the same network, then try the known working IP URL."
}

Add-Line "Report: $reportPath"
Write-Host "Report written to: $reportPath" -ForegroundColor Green
Read-Host "Press Enter to close"
