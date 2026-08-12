param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("Install", "Uninstall", "Start", "Stop", "Restart", "Status")]
    [string]$Action,

    [string]$InstallRoot = "C:\Atlas3388"
)

$ErrorActionPreference = "Stop"
$ServiceName = "AtlasPythonCore3388"
$DisplayName = "ATLAS Python Core Service (Port 3388)"
$Description = "ATLAS Python Core clean-room FastAPI service isolated on port 3388."
$Root = (Resolve-Path $InstallRoot).Path
$RuntimeExe = Join-Path $Root "atlas-python-core-3388.exe"
$LogRoot = Join-Path $Root "logs"
New-Item -ItemType Directory -Force -Path $LogRoot | Out-Null

function Assert-Admin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw "Administrator rights required for service action: $Action"
    }
}

function Assert-Runtime {
    if (-not (Test-Path $RuntimeExe)) {
        throw "Bundled runtime executable not found: $RuntimeExe"
    }
}

function Get-ServiceSafe {
    Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
}

function Wait-ServiceStopped {
    $svc = Get-ServiceSafe
    if ($svc -and $svc.Status -ne "Stopped") {
        $svc.WaitForStatus("Stopped", [TimeSpan]::FromSeconds(20))
    }
}

function Wait-ServiceRunning {
    $svc = Get-ServiceSafe
    if (-not $svc) { throw "Service not installed: $ServiceName" }
    $svc.WaitForStatus("Running", [TimeSpan]::FromSeconds(30))
}

switch ($Action) {
    "Install" {
        Assert-Admin
        Assert-Runtime
        $existing = Get-ServiceSafe
        if ($existing) {
            Write-Host "OK: service already installed: $ServiceName"
        } else {
            $binPath = "`"$RuntimeExe`""
            sc.exe create $ServiceName binPath= $binPath start= auto DisplayName= "`"$DisplayName`"" | Out-Null
            if ($LASTEXITCODE -ne 0) { throw "service create failed with exit code $LASTEXITCODE" }
            sc.exe description $ServiceName $Description | Out-Null
            sc.exe failure $ServiceName reset= 86400 actions= restart/60000/restart/60000/restart/60000 | Out-Null
            Write-Host "OK: installed $DisplayName using bundled runtime."
        }
    }
    "Uninstall" {
        Assert-Admin
        $svc = Get-ServiceSafe
        if ($svc) {
            if ($svc.Status -ne "Stopped") {
                Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
                Wait-ServiceStopped
            }
            sc.exe delete $ServiceName | Out-Null
            if ($LASTEXITCODE -ne 0) { throw "service delete failed with exit code $LASTEXITCODE" }
            Write-Host "OK: uninstalled $ServiceName"
        } else {
            Write-Host "OK: service not installed: $ServiceName"
        }
    }
    "Start" {
        Assert-Admin
        Assert-Runtime
        if (-not (Get-ServiceSafe)) { throw "Service not installed: $ServiceName" }
        Start-Service -Name $ServiceName
        Wait-ServiceRunning
        Write-Host "OK: started $ServiceName"
    }
    "Stop" {
        Assert-Admin
        $svc = Get-ServiceSafe
        if ($svc) {
            if ($svc.Status -ne "Stopped") {
                Stop-Service -Name $ServiceName -Force
                Wait-ServiceStopped
            }
            Write-Host "OK: stopped $ServiceName"
        } else {
            Write-Host "OK: service not installed: $ServiceName"
        }
    }
    "Restart" {
        Assert-Admin
        Assert-Runtime
        if (-not (Get-ServiceSafe)) { throw "Service not installed: $ServiceName" }
        $svc = Get-ServiceSafe
        if ($svc.Status -ne "Stopped") {
            Stop-Service -Name $ServiceName -Force
            Wait-ServiceStopped
        }
        Start-Service -Name $ServiceName
        Wait-ServiceRunning
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
