param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("Install", "Uninstall", "Start", "Stop", "Restart", "Status")]
    [string]$Action,

    [string]$InstallRoot = "C:\Airfare_Allowance\atlas-python-core",
    [string]$Python = ""
)

$ErrorActionPreference = "Stop"
$ServiceName = "AtlasPythonCore3356"
$DisplayName = "ATLAS Python Core Service (Port 3356)"
$Root = Resolve-Path $InstallRoot
Set-Location $Root

if ([string]::IsNullOrWhiteSpace($Python)) {
    $Python = Join-Path $Root ".venv\Scripts\python.exe"
}

function Assert-Admin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw "Administrator rights required for service action: $Action"
    }
}

function Assert-Python {
    if (-not (Test-Path $Python)) {
        throw "Python runtime not found: $Python"
    }
}

function Get-ServiceSafe {
    Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
}

switch ($Action) {
    "Install" {
        Assert-Admin
        Assert-Python
        if (Get-ServiceSafe) {
            Write-Host "OK: service already installed: $ServiceName"
        } else {
            & $Python -m pip install -r requirements.txt
            if ($LASTEXITCODE -ne 0) { throw "pip install failed." }
            & $Python app\service.py install --startup auto
            if ($LASTEXITCODE -ne 0) { throw "service install failed." }
            sc.exe description $ServiceName "Greenfield ATLAS Python + MSSQL FastAPI service isolated on port 3356." | Out-Null
            Write-Host "OK: installed $DisplayName"
        }
    }
    "Uninstall" {
        Assert-Admin
        if (Get-ServiceSafe) {
            if ((Get-ServiceSafe).Status -ne "Stopped") {
                Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
                Start-Sleep -Seconds 2
            }
            & $Python app\service.py remove
            if ($LASTEXITCODE -ne 0) { throw "service remove failed." }
            Write-Host "OK: uninstalled $ServiceName"
        } else {
            Write-Host "OK: service not installed: $ServiceName"
        }
    }
    "Start" {
        Assert-Admin
        if (-not (Get-ServiceSafe)) { throw "Service not installed: $ServiceName" }
        Start-Service -Name $ServiceName
        Write-Host "OK: started $ServiceName"
    }
    "Stop" {
        Assert-Admin
        if (Get-ServiceSafe) {
            Stop-Service -Name $ServiceName -Force
            Write-Host "OK: stopped $ServiceName"
        } else {
            Write-Host "OK: service not installed: $ServiceName"
        }
    }
    "Restart" {
        Assert-Admin
        if (-not (Get-ServiceSafe)) { throw "Service not installed: $ServiceName" }
        Restart-Service -Name $ServiceName -Force
        Write-Host "OK: restarted $ServiceName"
    }
    "Status" {
        $svc = Get-ServiceSafe
        if ($svc) {
            $svc | Select-Object Name, DisplayName, Status, StartType | Format-List
        } else {
            Write-Host "NOT_INSTALLED: $ServiceName"
        }
    }
}
