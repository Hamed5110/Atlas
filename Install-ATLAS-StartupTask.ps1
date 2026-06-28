$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$TaskName = "ATLAS-Airfare-3355"
$Launcher = Join-Path $Root "Start-ATLAS-Service.ps1"
$EnvFile = Join-Path $Root ".env"
$Port = 3355

if (Test-Path $EnvFile) {
    $rawPort = (Select-String -Path $EnvFile -Pattern "^PORT=(\d+)" | Select-Object -First 1).Matches.Groups[1].Value
    if ($rawPort) { $Port = [int]$rawPort }
}

if (-not (Test-Path $Launcher)) {
    throw "Missing launcher script: $Launcher"
}

$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -RunLevel Highest
$trigger = New-ScheduledTaskTrigger -AtStartup
$trigger.Delay = "PT30S"
$action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$Launcher`"" `
    -WorkingDirectory $Root
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 5) `
    -MultipleInstances IgnoreNew `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -StartWhenAvailable

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Principal $principal `
    -Settings $settings `
    -Description "Starts ATLAS Airfare HCM on port $Port after Windows startup." `
    -Force | Out-Null

$ruleName = "ATLAS Airfare HCM Port $Port"
if (-not (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule `
        -DisplayName $ruleName `
        -Direction Inbound `
        -Action Allow `
        -Protocol TCP `
        -LocalPort $Port `
        -Profile Any | Out-Null
}

Write-Host "Installed startup task: $TaskName"
Write-Host "Allowed firewall port: $Port"
