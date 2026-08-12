param(
    [string]$SourceRoot = "C:\Airfare_Allowance\atlas-python-core",
    [string]$InstallRoot = "C:\Airfare_Allowance\atlas-python-core",
    [string]$DbServer = "localhost",
    [string]$DbPort = "1433",
    [string]$DbName = "AtlasPythonCore3388",
    [string]$DbUser = "sa",
    [string]$DbPassword = "Atlas@25",
    [string]$JwtSecret = "",
    [switch]$SkipFirewall,
    [switch]$SkipService
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

function Find-Python {
    $cmd = Get-Command py -ErrorAction SilentlyContinue
    if ($cmd) {
        $version = & py -3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>$null
        if ($LASTEXITCODE -eq 0 -and [version]$version -ge [version]"3.10") { return "py -3" }
    }
    $python = Get-Command python -ErrorAction SilentlyContinue
    if ($python) {
        $version = & python -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>$null
        if ($LASTEXITCODE -eq 0 -and [version]$version -ge [version]"3.10") { return "python" }
    }
    throw "Python 3.10+ is required."
}

function Assert-OdbcDriver {
    $drivers = Get-ItemProperty "HKLM:\SOFTWARE\ODBC\ODBCINST.INI\ODBC Drivers" -ErrorAction SilentlyContinue
    if (-not $drivers) { throw "ODBC Driver 17 or 18 for SQL Server is required." }
    $has18 = ($drivers.PSObject.Properties.Name -contains "ODBC Driver 18 for SQL Server")
    $has17 = ($drivers.PSObject.Properties.Name -contains "ODBC Driver 17 for SQL Server")
    if (-not ($has18 -or $has17)) {
        throw "ODBC Driver 17 or 18 for SQL Server is required."
    }
    if ($has18) { return "ODBC Driver 18 for SQL Server" }
    return "ODBC Driver 17 for SQL Server"
}

function Set-MachineEnvironment {
    param([string]$Name, [string]$Value)
    [Environment]::SetEnvironmentVariable($Name, $Value, "Machine")
    Set-Item -Path "Env:\$Name" -Value $Value
}

function Copy-ProductionFiles {
    param([string]$From, [string]$To)
    $resolvedFrom = (Resolve-Path $From).Path
    $resolvedTo = (Resolve-Path $To -ErrorAction SilentlyContinue)
    if ($resolvedTo) {
        if ($resolvedFrom.TrimEnd("\") -ieq $resolvedTo.Path.TrimEnd("\")) {
            Write-Host "OK: SourceRoot and InstallRoot are the same; skipping file copy."
            New-Item -ItemType Directory -Force -Path (Join-Path $To "logs") | Out-Null
            New-Item -ItemType Directory -Force -Path (Join-Path $To "backups") | Out-Null
            return
        }
    }
    New-Item -ItemType Directory -Force -Path $To | Out-Null
    foreach ($folder in @("app", "schema", "scripts", "web")) {
        $source = Join-Path $From $folder
        $target = Join-Path $To $folder
        if (Test-Path $source) {
            if (Test-Path $target) { Remove-Item -LiteralPath $target -Recurse -Force }
            Copy-Item -Path $source -Destination $target -Recurse -Force
        }
    }
    foreach ($file in @("requirements.txt", "AtlasPythonCore3388.spec", "build_spec.py")) {
        $source = Join-Path $From $file
        if (Test-Path $source) {
            Copy-Item -Path $source -Destination (Join-Path $To $file) -Force
        }
    }
    New-Item -ItemType Directory -Force -Path (Join-Path $To "logs") | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $To "backups") | Out-Null
}

Assert-Admin
$pythonCommand = Find-Python
$odbcDriver = Assert-OdbcDriver
if ([string]::IsNullOrWhiteSpace($JwtSecret)) {
    $bytes = New-Object byte[] 32
    [Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
    $JwtSecret = [Convert]::ToBase64String($bytes)
}

Copy-ProductionFiles -From $SourceRoot -To $InstallRoot
Set-Location $InstallRoot

if (-not (Test-Path ".\.venv\Scripts\python.exe")) {
    Invoke-Expression "$pythonCommand -m venv .venv"
}

.\.venv\Scripts\python.exe -m pip install -r requirements.txt
if ($LASTEXITCODE -ne 0) { throw "Dependency installation failed." }

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

.\.venv\Scripts\python.exe scripts\migrate_and_seed.py
if ($LASTEXITCODE -ne 0) { throw "Migration and seed failed." }

if (-not $SkipFirewall) {
    $rule = Get-NetFirewallRule -DisplayName "ATLAS Python Core 3388" -ErrorAction SilentlyContinue
    if (-not $rule) {
        New-NetFirewallRule -DisplayName "ATLAS Python Core 3388" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3388 | Out-Null
    }
}

if (-not $SkipService) {
    powershell -ExecutionPolicy Bypass -File .\scripts\service_control.ps1 -Action Install -InstallRoot $InstallRoot
    powershell -ExecutionPolicy Bypass -File .\scripts\service_control.ps1 -Action Restart -InstallRoot $InstallRoot
}

powershell -ExecutionPolicy Bypass -File .\scripts\validate_live_3388.ps1
Write-Host "PASS: ATLAS Python Core 3388 installed and validated."
Write-Host "Log file: $SetupLog"
Stop-Transcript | Out-Null

