$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $Root

$LogDir = Join-Path $Root "logs"
$StartupLog = Join-Path $LogDir "service-startup.log"
$StdoutLog = Join-Path $LogDir "service-api-out.log"
$StderrLog = Join-Path $LogDir "service-api-err.log"
$Python = Join-Path $Root ".venv\Scripts\python.exe"
$EnvFile = Join-Path $Root ".env"

if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}

function Write-ServiceLog {
    param([string]$Message)
    $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
    Add-Content -Path $StartupLog -Value $line -Encoding ASCII
}

function Read-DotEnv {
    param([string]$Path)
    $settings = @{}
    if (Test-Path -LiteralPath $Path) {
        Get-Content -LiteralPath $Path | ForEach-Object {
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

function Test-ApiLive {
    param([string]$BaseUrl)
    try {
        Invoke-RestMethod -Uri "$BaseUrl/health/live" -TimeoutSec 3 | Out-Null
        return $true
    } catch {
        return $false
    }
}

function Invoke-Native {
    param([string]$FilePath, [string[]]$Arguments)
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $output = & $FilePath @Arguments 2>&1 | Out-String
        return @{ Output = $output; ExitCode = $LASTEXITCODE }
    } finally {
        $ErrorActionPreference = $prevEap
    }
}

$startupMutex = New-Object System.Threading.Mutex($false, "Global\HcmAirfareServiceStartup")
$mutexHeld = $false
try {
    Write-ServiceLog "HCM Airfare service startup requested."

    if (-not $startupMutex.WaitOne([TimeSpan]::FromMinutes(3))) {
        Write-ServiceLog "Another startup instance is already running; exiting."
        exit 0
    }
    $mutexHeld = $true

    if (-not (Test-Path -LiteralPath $Python)) {
        throw "Missing virtual environment python at $Python. Run start-api.ps1 once interactively."
    }
    if (-not (Test-Path -LiteralPath $EnvFile)) {
        throw "Missing .env file at $EnvFile."
    }

    $envSettings = Read-DotEnv -Path $EnvFile
    $hostAddr = if ($envSettings["AIRFARE_HOST"]) { $envSettings["AIRFARE_HOST"] } else { "0.0.0.0" }
    $port = if ($envSettings["AIRFARE_PORT"]) { [int]$envSettings["AIRFARE_PORT"] } else { 3389 }
    $baseUrl = "http://127.0.0.1:$port"

    $dbHost = "127.0.0.1"
    $dbPort = 1433
    $dbUrl = [string]$envSettings["AIRFARE_DATABASE_URL"]
    if ($dbUrl -match "@([^:/]+)(:(\d+))?") {
        $dbHost = $Matches[1]
        if ($Matches[3]) { $dbPort = [int]$Matches[3] }
    }

    Write-ServiceLog "Waiting for SQL Server $dbHost`:$dbPort."
    $sqlReady = $false
    for ($attempt = 1; $attempt -le 90; $attempt++) {
        if (Test-TcpPort -Server $dbHost -Port $dbPort) {
            $sqlReady = $true
            break
        }
        Start-Sleep -Seconds 2
    }
    if (-not $sqlReady) {
        throw "SQL Server $dbHost`:$dbPort was not reachable after startup wait."
    }
    Write-ServiceLog "SQL Server is reachable."

    if (Test-ApiLive -BaseUrl $baseUrl) {
        # Prefer a clean restart when an unexpected process owns the port.
        $listeners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
        $ownedByVenv = $false
        foreach ($listener in $listeners) {
            $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)" -ErrorAction SilentlyContinue
            if ($proc -and $proc.ExecutablePath -and ($proc.ExecutablePath -like "*\.venv\Scripts\python.exe*" -or $proc.CommandLine -like "*\.venv\Scripts\python.exe*")) {
                $ownedByVenv = $true
            }
            # uvicorn may re-exec into base python; accept parent chain from our Start-Process
            if ($proc -and $proc.CommandLine -and ($proc.CommandLine -match "airfare_management\.api\.main")) {
                $ownedByVenv = $true
            }
        }
        if ($ownedByVenv) {
            Write-ServiceLog "HCM Airfare API is already live on port $port."
            exit 0
        }
        Write-ServiceLog "Port $port is live but not from expected uvicorn app; recycling."
        foreach ($listener in $listeners) {
            Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue
        }
        Start-Sleep -Seconds 2
    }

    $listeners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    foreach ($listener in $listeners) {
        Write-ServiceLog "Stopping unhealthy listener PID $($listener.OwningProcess) on port $port."
        Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue
    }

    $env:PYTHONPATH = Join-Path $Root "src"

    Write-ServiceLog "Applying Alembic migrations."
    $migrate = Invoke-Native -FilePath $Python -Arguments @("-m", "alembic", "upgrade", "head")
    if ($migrate.ExitCode -ne 0) {
        Write-ServiceLog "Alembic migration failed: $($migrate.Output)"
        throw "Alembic migration failed. See service-startup.log."
    }

    Write-ServiceLog "Ensuring reporting SQL."
    $reporting = Invoke-Native -FilePath $Python -Arguments @("scripts\apply_reporting_sql.py")
    if ($reporting.ExitCode -ne 0) {
        Write-ServiceLog "Reporting SQL apply failed (continuing): $($reporting.Output)"
    }

    Write-ServiceLog "Ensuring entitlement SQL."
    $entitlement = Invoke-Native -FilePath $Python -Arguments @("scripts\apply_entitlement_sql.py")
    if ($entitlement.ExitCode -ne 0) {
        Write-ServiceLog "Entitlement SQL apply failed (continuing): $($entitlement.Output)"
    }

    Write-ServiceLog "Starting uvicorn on $hostAddr`:$port."
    Start-Process -FilePath $Python `
        -ArgumentList "-m", "uvicorn", "airfare_management.api.main:app", "--host", $hostAddr, "--port", "$port" `
        -WorkingDirectory $Root `
        -WindowStyle Hidden `
        -RedirectStandardOutput $StdoutLog `
        -RedirectStandardError $StderrLog

    for ($attempt = 1; $attempt -le 60; $attempt++) {
        if (Test-ApiLive -BaseUrl $baseUrl) {
            Write-ServiceLog "HCM Airfare API is live on port $port."
            exit 0
        }
        Start-Sleep -Seconds 2
    }

    throw "HCM Airfare API did not become live on port $port after launch."
} catch {
    Write-ServiceLog "ERROR: $($_.Exception.Message)"
    exit 1
} finally {
    if ($mutexHeld) {
        $startupMutex.ReleaseMutex()
    }
    $startupMutex.Dispose()
}
