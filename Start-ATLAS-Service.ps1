$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$LogDir = Join-Path $Root "logs"
$Node = Join-Path $env:ProgramFiles "nodejs\node.exe"
$Npm = Join-Path $env:ProgramFiles "nodejs\npm.cmd"
$EnvFile = Join-Path $Root ".env"
$Frontend = Join-Path $Root "atlas-hcm-next"
$FrontendOut = Join-Path $Frontend "out"
$StartupLog = Join-Path $LogDir "startup-service.log"
$StdoutLog = Join-Path $LogDir "service-node-out.log"
$StderrLog = Join-Path $LogDir "service-node-err.log"

if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}

function Write-StartupLog {
    param([string]$Message)
    $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
    Add-Content -Path $StartupLog -Value $line -Encoding ASCII
}

function Read-AtlasEnv {
    $settings = @{
        PORT = "3355"
        DB_SERVER = "localhost"
        DB_PORT = "1433"
    }

    if (Test-Path $EnvFile) {
        Get-Content $EnvFile | ForEach-Object {
            if ($_ -match "^\s*([^#=]+)=(.*)$") {
                $settings[$Matches[1].Trim()] = $Matches[2].Trim()
            }
        }
    }

    return $settings
}

function Test-TcpPort {
    param([string]$Server, [int]$Port, [int]$TimeoutMs = 1500)
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

function Test-AtlasHealth {
    param([int]$Port)
    try {
        $health = Invoke-RestMethod -Uri "http://localhost:$Port/api/health" -TimeoutSec 3
        return ($health.status -eq "healthy" -and $health.database -eq "connected")
    } catch {
        return $false
    }
}

try {
    Write-StartupLog "ATLAS startup requested."
    $envSettings = Read-AtlasEnv
    $Port = [int]$envSettings.PORT
    $DbServer = [string]$envSettings.DB_SERVER
    $DbPort = [int]$envSettings.DB_PORT

    if (-not (Test-Path $Node)) {
        throw "Node.js was not found at $Node"
    }

    if (-not (Test-Path $EnvFile)) {
        throw "Missing .env file at $EnvFile"
    }

    Write-StartupLog "Waiting for SQL Server $DbServer`:$DbPort."
    $sqlReady = $false
    for ($attempt = 1; $attempt -le 90; $attempt++) {
        if (Test-TcpPort -Server $DbServer -Port $DbPort) {
            $sqlReady = $true
            break
        }
        Start-Sleep -Seconds 2
    }
    if (-not $sqlReady) {
        throw "SQL Server $DbServer`:$DbPort was not reachable after startup wait."
    }
    Write-StartupLog "SQL Server is reachable."

    if (-not (Test-Path (Join-Path $FrontendOut "index.html"))) {
        if (-not (Test-Path $Npm)) {
            throw "Frontend export missing and npm was not found at $Npm"
        }
        Write-StartupLog "Frontend export missing. Building frontend."
        Push-Location $Frontend
        try {
            & $Npm run build *>> $StartupLog
            if ($LASTEXITCODE -ne 0) { throw "Frontend build failed with exit code $LASTEXITCODE." }
        } finally {
            Pop-Location
        }
    }

    if (Test-AtlasHealth -Port $Port) {
        Write-StartupLog "ATLAS is already healthy on port $Port."
        exit 0
    }

    $listeners = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    foreach ($listener in $listeners) {
        Write-StartupLog "Stopping unhealthy listener PID $($listener.OwningProcess) on port $Port."
        Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue
    }

    Write-StartupLog "Starting node server on port $Port."
    Start-Process -FilePath $Node `
        -ArgumentList "server.js" `
        -WorkingDirectory $Root `
        -WindowStyle Hidden `
        -RedirectStandardOutput $StdoutLog `
        -RedirectStandardError $StderrLog

    for ($attempt = 1; $attempt -le 45; $attempt++) {
        if (Test-AtlasHealth -Port $Port) {
            Write-StartupLog "ATLAS health is ready on port $Port."
            exit 0
        }
        Start-Sleep -Seconds 2
    }

    throw "ATLAS did not become healthy on port $Port after launch."
} catch {
    Write-StartupLog "ERROR: $($_.Exception.Message)"
    exit 1
}
