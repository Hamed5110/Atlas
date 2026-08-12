param(
    [string]$SourceRoot = "C:\Airfare_Allowance\atlas-python-core-3388",
    [string]$InstallRoot = "C:\Atlas3388",
    [string]$DbServer = "localhost",
    [string]$DbPort = "1433",
    [string]$DbName = "AtlasPythonCore3388",
    [string]$DbUser = "sa",
    [string]$DbPassword = "Atlas@25",
    [string]$JwtSecret = "",
    [switch]$SkipFirewall,
    [switch]$SkipService,
    [switch]$SkipDependencyInstall
)

$ErrorActionPreference = "Stop"
$Port = "3388"
$LogRoot = Join-Path $InstallRoot "logs"
New-Item -ItemType Directory -Force -Path $LogRoot | Out-Null
$SetupLog = Join-Path $LogRoot ("ATLAS-Python-Core-3388-Setup-{0}.log" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
Start-Transcript -Path $SetupLog -Append | Out-Null

trap {
    Write-Host "FAIL: ATLAS Python Core 3388 setup failed. Log file: $SetupLog" -ForegroundColor Red
    try { Stop-Transcript | Out-Null } catch { }
    throw $_
}

function Assert-Admin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw "Administrator rights required for installer/bootstrapper."
    }
}

function Set-MachineEnvironment {
    param([string]$Name, [string]$Value)
    [Environment]::SetEnvironmentVariable($Name, $Value, "Machine")
    Set-Item -Path "Env:\$Name" -Value $Value
}

function Get-InstalledOdbcDriver {
    $drivers = Get-ItemProperty "HKLM:\SOFTWARE\ODBC\ODBCINST.INI\ODBC Drivers" -ErrorAction SilentlyContinue
    if (-not $drivers) { return "" }
    $has18 = ($drivers.PSObject.Properties.Name -contains "ODBC Driver 18 for SQL Server")
    $has17 = ($drivers.PSObject.Properties.Name -contains "ODBC Driver 17 for SQL Server")
    if ($has18) { return "ODBC Driver 18 for SQL Server" }
    if ($has17) { return "ODBC Driver 17 for SQL Server" }
    return ""
}

function Install-BundledOdbcDriverIfMissing {
    $existing = Get-InstalledOdbcDriver
    if (-not [string]::IsNullOrWhiteSpace($existing)) {
        Write-Host "OK: SQL Server ODBC dependency already present: $existing"
        return $existing
    }

    if ($SkipDependencyInstall) {
        throw "SQL Server ODBC Driver 17/18 is missing and dependency installation was disabled."
    }

    $candidatePaths = @(
        (Join-Path $InstallRoot "installer\dependencies\msodbcsql18_x64.msi"),
        (Join-Path $SourceRoot "installer\dependencies\msodbcsql18_x64.msi")
    )
    $odbcMsi = $candidatePaths | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $odbcMsi) {
        throw "SQL Server ODBC Driver 17/18 is missing and bundled dependency was not found: installer\dependencies\msodbcsql18_x64.msi"
    }

    Write-Host "INSTALL: SQL Server ODBC dependency missing. Installing bundled driver: $odbcMsi"
    $dependencyLog = Join-Path $LogRoot ("msodbcsql18-install-{0}.log" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
    $arguments = @(
        "/i", "`"$odbcMsi`"",
        "IACCEPTMSODBCSQLLICENSETERMS=YES",
        "ADDLOCAL=ALL",
        "/passive",
        "/norestart",
        "/l*v", "`"$dependencyLog`""
    )
    $process = Start-Process -FilePath "msiexec.exe" -ArgumentList $arguments -Wait -PassThru
    if ($process.ExitCode -notin @(0, 3010)) {
        throw "Bundled SQL Server ODBC Driver installation failed with exit code $($process.ExitCode). Log file: $dependencyLog"
    }

    $installed = Get-InstalledOdbcDriver
    if ([string]::IsNullOrWhiteSpace($installed)) {
        throw "Bundled SQL Server ODBC Driver installer completed, but driver is still not registered. Log file: $dependencyLog"
    }
    Write-Host "OK: SQL Server ODBC dependency installed: $installed"
    return $installed
}

function Copy-ProductionFiles {
    param([string]$From, [string]$To)
    $resolvedFrom = (Resolve-Path $From).Path
    $resolvedTo = Resolve-Path $To -ErrorAction SilentlyContinue
    if ($resolvedTo -and $resolvedFrom.TrimEnd("\") -ieq $resolvedTo.Path.TrimEnd("\")) {
        Write-Host "OK: SourceRoot and InstallRoot are the same; skipping file copy."
        New-Item -ItemType Directory -Force -Path (Join-Path $To "logs") | Out-Null
        New-Item -ItemType Directory -Force -Path (Join-Path $To "backups") | Out-Null
        return
    }

    New-Item -ItemType Directory -Force -Path $To | Out-Null
    foreach ($folder in @("schema", "scripts", "web", "installer")) {
        $source = Join-Path $From $folder
        $target = Join-Path $To $folder
        if (Test-Path $source) {
            if (Test-Path $target) { Remove-Item -LiteralPath $target -Recurse -Force }
            Copy-Item -Path $source -Destination $target -Recurse -Force
        }
    }
    foreach ($file in @("atlas-python-core-3388.exe", "python-core-manifest.json", "SHA256SUMS.txt", "README.md")) {
        $source = Join-Path $From $file
        if (Test-Path $source) {
            Copy-Item -Path $source -Destination (Join-Path $To $file) -Force
        }
    }
    New-Item -ItemType Directory -Force -Path (Join-Path $To "logs") | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $To "backups") | Out-Null
}

function Assert-BundledRuntime {
    $exe = Join-Path $InstallRoot "atlas-python-core-3388.exe"
    if (-not (Test-Path $exe)) {
        throw "Bundled ATLAS runtime is missing: $exe"
    }
    Write-Host "OK: bundled ATLAS runtime found: $exe"
    return $exe
}

function Wait-Health {
    param([int]$Attempts = 45)
    for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
        try {
            $health = Invoke-RestMethod -Uri "http://127.0.0.1:3388/api/v1/health" -TimeoutSec 3
            if ($health.status -eq "ok" -and $health.port -eq 3388 -and $health.runtimeIsolated -eq $true -and $health.continuousModelOnly -eq $true) {
                Write-Host "OK: health endpoint confirmed on port 3388."
                return
            }
        } catch {
            Start-Sleep -Seconds 2
        }
    }
    throw "Service installed but health endpoint did not become ready. Check logs under $LogRoot."
}

Assert-Admin
if ([string]::IsNullOrWhiteSpace($JwtSecret)) {
    $bytes = New-Object byte[] 32
    [Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
    $JwtSecret = [Convert]::ToBase64String($bytes)
}

Copy-ProductionFiles -From $SourceRoot -To $InstallRoot
Set-Location $InstallRoot

$runtimeExe = Assert-BundledRuntime
$odbcDriver = Install-BundledOdbcDriverIfMissing

Set-MachineEnvironment "PORT" $Port
Set-MachineEnvironment "ATLAS_PYTHON_PORT" $Port
Set-MachineEnvironment "ATLAS_PYTHON_HOST" "0.0.0.0"
Set-MachineEnvironment "ATLAS_PYTHON_DB_SERVER" $DbServer
Set-MachineEnvironment "ATLAS_PYTHON_DB_PORT" $DbPort
Set-MachineEnvironment "ATLAS_PYTHON_DB_NAME" $DbName
Set-MachineEnvironment "ATLAS_PYTHON_DB_USER" $DbUser
Set-MachineEnvironment "ATLAS_PYTHON_DB_PASSWORD" $DbPassword
Set-MachineEnvironment "ATLAS_PYTHON_ODBC_DRIVER" $odbcDriver
Set-MachineEnvironment "ATLAS_PYTHON_ENCRYPT" "yes"
Set-MachineEnvironment "ATLAS_PYTHON_TRUST_CERT" "yes"
Set-MachineEnvironment "ATLAS_PYTHON_DB_ENCRYPT" "yes"
Set-MachineEnvironment "ATLAS_PYTHON_DB_TRUST_CERT" "yes"
Set-MachineEnvironment "JWT_SECRET" $JwtSecret
Set-MachineEnvironment "ATLAS_UVICORN_WORKERS" "1"
Set-MachineEnvironment "ATLAS_PYTHON_CORE_VERSION" "0.3.0"

if (-not $SkipFirewall) {
    $rule = Get-NetFirewallRule -DisplayName "ATLAS Python Core 3388" -ErrorAction SilentlyContinue
    if (-not $rule) {
        New-NetFirewallRule -DisplayName "ATLAS Python Core 3388" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3388 | Out-Null
        Write-Host "OK: firewall rule created for port 3388."
    } else {
        Write-Host "OK: firewall rule already exists for port 3388."
    }
}

if (-not $SkipService) {
    powershell -ExecutionPolicy Bypass -File .\scripts\service_control.ps1 -Action Install -InstallRoot $InstallRoot
    powershell -ExecutionPolicy Bypass -File .\scripts\service_control.ps1 -Action Restart -InstallRoot $InstallRoot
    Wait-Health
} else {
    Write-Host "SKIP: Windows service installation skipped. Runtime is available at: $runtimeExe"
}

Write-Host "PASS: ATLAS Python Core 3388 installed with dependency preflight."
Write-Host "Log file: $SetupLog"
Stop-Transcript | Out-Null
