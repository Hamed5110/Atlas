# Setup & verify local Ollama for Atlas HCM AI Insights
# Research basis: https://ollama.com/  + Ollama /api/chat docs
#
# Local checklist (Windows):
#   1. Install Ollama from https://ollama.com/download
#   2. Ensure service listens on http://127.0.0.1:11434
#   3. Pull an instruct model (recommended for support answers):
#        ollama pull qwen2.5:3b-instruct
#   4. Optional env (system or user):
#        OLLAMA_HOST=127.0.0.1:11434
#        OLLAMA_KEEP_ALIVE=10m
#   5. HCM .env:
#        AIRFARE_AI_LLM_PROVIDER=auto
#        AIRFARE_AI_OLLAMA_ENABLED=true
#        AIRFARE_AI_OLLAMA_BASE_URL=http://127.0.0.1:11434
#        AIRFARE_AI_OLLAMA_MODEL=qwen2.5:3b-instruct
#
# Usage:
#   powershell -File scripts\Setup-LocalOllama.ps1
#   powershell -File scripts\Setup-LocalOllama.ps1 -SkipPull

param(
    [switch]$SkipPull,
    [string]$Model = "qwen2.5:3b-instruct",
    [string]$BaseUrl = "http://127.0.0.1:11434"
)

$ErrorActionPreference = "Stop"
$OllamaExe = Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama.exe"
if (-not (Test-Path $OllamaExe)) {
    $OllamaExe = Join-Path $env:ProgramFiles "Ollama\ollama.exe"
}
if (-not (Test-Path $OllamaExe)) {
    throw "Ollama not found. Install from https://ollama.com/download then re-run."
}

Write-Host "== Ollama binary ==" $OllamaExe -ForegroundColor Cyan
& $OllamaExe --version

Write-Host "== Health $BaseUrl ==" -ForegroundColor Cyan
try {
    $tags = Invoke-RestMethod -Uri "$BaseUrl/api/tags" -TimeoutSec 5
    Write-Host "Online. Models:" (($tags.models | ForEach-Object { $_.name }) -join ", ")
} catch {
    throw "Ollama API not reachable at $BaseUrl. Start Ollama (system tray / ollama serve)."
}

$names = @($tags.models | ForEach-Object { $_.name })
if (-not $SkipPull -and ($names -notcontains $Model)) {
    Write-Host "== Pulling $Model (free local, from ollama.com library) ==" -ForegroundColor Cyan
    & $OllamaExe pull $Model
}

Write-Host "== Smoke /api/chat (Think→Logic→Answer) ==" -ForegroundColor Cyan
$body = @{
    model = $Model
    stream = $false
    keep_alive = "10m"
    options = @{ temperature = 0.2; num_predict = 256 }
    messages = @(
        @{
            role = "system"
            content = "You are a concise assistant. Format: ### Think / ### Logic / ### Answer / ### Next"
        },
        @{
            role = "user"
            content = "Question: what is 2+2? facts: arithmetic. Reply Think→Logic→Answer→Next."
        }
    )
} | ConvertTo-Json -Depth 6

$chat = Invoke-RestMethod -Uri "$BaseUrl/api/chat" -Method Post -Body $body -ContentType "application/json" -TimeoutSec 120
$reply = $chat.message.content
if (-not $reply) { throw "Empty Ollama chat reply" }
Write-Host $reply
Write-Host ""
Write-Host "OK - local Ollama chat works. Use AI Insights: Ask for support / Teach me everything." -ForegroundColor Green
