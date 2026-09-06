# Proxy: setup/verify local Ollama for Airfare_Allowance UI workspace
param(
    [switch]$SkipPull,
    [string]$Model = "qwen2.5:3b-instruct"
)
$script = "C:\HCM Airfare\scripts\Setup-LocalOllama.ps1"
if (-not (Test-Path $script)) { throw "Missing $script" }
$argsList = @()
if ($SkipPull) { $argsList += "-SkipPull" }
$argsList += "-Model"; $argsList += $Model
& powershell -NoProfile -ExecutionPolicy Bypass -File $script @argsList
exit $LASTEXITCODE
