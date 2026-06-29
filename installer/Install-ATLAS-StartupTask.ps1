param(
    [string]$InstallRoot = (Split-Path -Parent $MyInvocation.MyCommand.Path),
    [switch]$StartNow
)

$ErrorActionPreference = "Stop"

$taskName = "ATLAS Airfare Allowance"
$runner = Join-Path $InstallRoot "Run-ATLAS-Server.ps1"
$logDir = Join-Path $InstallRoot "logs"
New-Item -ItemType Directory -Path $logDir -Force | Out-Null

if (-not (Test-Path $runner)) {
    throw "ATLAS server task runner was not found: $runner"
}

$ps = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$runner`" -InstallRoot `"$InstallRoot`""
$action = New-ScheduledTaskAction -Execute $ps -Argument $arguments -WorkingDirectory $InstallRoot
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -RunLevel Highest -LogonType ServiceAccount
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -MultipleInstances IgnoreNew `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -StartWhenAvailable

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null

if ($StartNow) {
    Start-ScheduledTask -TaskName $taskName
}

Write-Host "ATLAS startup task installed: $taskName" -ForegroundColor Green
