param(
    [Parameter(Mandatory = $true)]
    [string]$Version,

    [string]$ManifestPath = "",
    [string]$OutputRoot = "",
    [switch]$SkipVerify,
    [switch]$SkipExe
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($ManifestPath)) { $ManifestPath = Join-Path $Root "release\atlas-release-manifest.json" }
if ([string]::IsNullOrWhiteSpace($OutputRoot)) { $OutputRoot = Join-Path $Root "artifacts" }
$PatchDir = Join-Path $OutputRoot "patch-$Version"
$PayloadDir = Join-Path $PatchDir "payload"
$ReportsDir = Join-Path $PatchDir "reports"
$FinalManifestPath = Join-Path $PatchDir "atlas-release-manifest.json"
$RuntimeVersionPath = Join-Path $Root "release\version.json"
$MsiFile = "ATLAS-Airfare-Allowance-$Version-x64.msi"
$ExeFile = "ATLAS-Airfare-Allowance-Setup-$Version-x64.exe"
$MsiPath = Join-Path $PatchDir $MsiFile
$ExePath = Join-Path $PatchDir $ExeFile

function Invoke-Checked {
    param([string]$FilePath, [string[]]$Arguments, [string]$WorkingDirectory = $Root)
    Push-Location $WorkingDirectory
    try {
        & $FilePath @Arguments
        if ($LASTEXITCODE -ne 0) {
            throw "$FilePath $($Arguments -join ' ') failed with exit code $LASTEXITCODE."
        }
    } finally {
        Pop-Location
    }
}

function Get-GitCommit {
    Push-Location $Root
    try {
        $commit = (& git rev-parse --short HEAD 2>$null)
        if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($commit)) { return "unknown" }
        return [string]$commit
    } finally {
        Pop-Location
    }
}

function Get-RelativePathCompat {
    param(
        [Parameter(Mandatory = $true)][string]$BasePath,
        [Parameter(Mandatory = $true)][string]$TargetPath
    )
    $baseFull = [System.IO.Path]::GetFullPath($BasePath)
    $targetFull = [System.IO.Path]::GetFullPath($TargetPath)
    if (-not $baseFull.EndsWith([System.IO.Path]::DirectorySeparatorChar)) {
        $baseFull += [System.IO.Path]::DirectorySeparatorChar
    }
    $baseUri = [System.Uri]::new($baseFull)
    $targetUri = [System.Uri]::new($targetFull)
    return [System.Uri]::UnescapeDataString($baseUri.MakeRelativeUri($targetUri).ToString()).Replace('/', '\')
}

function Get-DirectoryHash {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [string[]]$ExcludeRelative = @()
    )
    if (-not (Test-Path -LiteralPath $Path)) { throw "Hash source does not exist: $Path" }
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $builder = [System.Text.StringBuilder]::new()
    $exclude = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($item in $ExcludeRelative) { [void]$exclude.Add($item.TrimStart('\', '/').Replace('/', '\')) }
    Get-ChildItem -LiteralPath $Path -Recurse -File -Force |
        Sort-Object FullName |
        ForEach-Object {
            $relative = Get-RelativePathCompat -BasePath $Path -TargetPath $_.FullName
            if ($exclude.Contains($relative)) { return }
            $fileHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash
            [void]$builder.AppendLine("$relative|$($_.Length)|$fileHash")
        }
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($builder.ToString())
    return "sha256:" + (($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString("x2") }) -join "").ToUpperInvariant()
}

function Get-BackendHash {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $builder = [System.Text.StringBuilder]::new()
    $include = @(
        "server.js",
        "package.json",
        "package-lock.json",
        "database",
        "extensions",
        "installer"
    )
    foreach ($relativeRoot in $include) {
        $target = Join-Path $Root $relativeRoot
        if (-not (Test-Path -LiteralPath $target)) { continue }
        if ((Get-Item -LiteralPath $target).PSIsContainer) {
            Get-ChildItem -LiteralPath $target -Recurse -File -Force |
                Where-Object { $_.FullName -notmatch '\\stage\\|\\logs\\|\\node_modules\\' } |
                Sort-Object FullName |
                ForEach-Object {
                    $relative = Get-RelativePathCompat -BasePath $Root -TargetPath $_.FullName
                    $fileHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash
                    [void]$builder.AppendLine("$relative|$($_.Length)|$fileHash")
                }
        } else {
            $file = Get-Item -LiteralPath $target
            $fileHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $file.FullName).Hash
            [void]$builder.AppendLine("$relativeRoot|$($file.Length)|$fileHash")
        }
    }
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($builder.ToString())
    return "sha256:" + (($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString("x2") }) -join "").ToUpperInvariant()
}

function Assert-ReleaseManifestCore {
    param([pscustomobject]$Manifest)
    $required = @("manifestSchemaVersion", "product", "productCode", "version", "gitCommit", "frontendBuildHash", "backendBuildHash", "databaseSchemaVersion", "artifacts", "minimumUpgradeableVersion", "migrationPlan")
    foreach ($name in $required) {
        if ($null -eq $Manifest.$name) {
            throw "Release manifest is missing required field '$name'."
        }
    }
    if (-not @($Manifest.migrationPlan).Count) {
        throw "Release manifest is missing required field 'migrationPlan'."
    }
    foreach ($migration in @($Manifest.migrationPlan)) {
        foreach ($name in @("id", "from", "to", "type", "description", "verify", "rollback")) {
            if ($null -eq $migration.$name -or [string]::IsNullOrWhiteSpace([string]$migration.$name)) {
                throw "Migration '$($migration.id)' is missing required field '$name'."
            }
        }
    }
}

function Write-Json {
    param([object]$Value, [string]$Path, [int]$Depth = 20)
    New-Item -ItemType Directory -Path (Split-Path -Parent $Path) -Force | Out-Null
    $Value | ConvertTo-Json -Depth $Depth | Set-Content -LiteralPath $Path -Encoding UTF8
}

if (-not (Test-Path -LiteralPath $ManifestPath)) {
    throw "Release manifest not found: $ManifestPath"
}

$manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
Assert-ReleaseManifestCore -Manifest $manifest

if ([string]$manifest.version -ne $Version) {
    throw "Manifest version '$($manifest.version)' does not match requested version '$Version'."
}

$expectedMsi = "ATLAS-Airfare-Allowance-$Version-x64.msi"
$expectedExe = "ATLAS-Airfare-Allowance-Setup-$Version-x64.exe"
if ([string]$manifest.artifacts.msi.file -ne $expectedMsi) { throw "Manifest MSI filename must be $expectedMsi." }
if ([string]$manifest.artifacts.exe.file -ne $expectedExe) { throw "Manifest EXE filename must be $expectedExe." }

if (Test-Path -LiteralPath $PatchDir) {
    Remove-Item -LiteralPath $PatchDir -Recurse -Force
}
New-Item -ItemType Directory -Path $PatchDir, $PayloadDir, $ReportsDir -Force | Out-Null

if (-not $SkipVerify) {
    Invoke-Checked -FilePath "npm.cmd" -Arguments @("run", "check")
    Invoke-Checked -FilePath "npm.cmd" -Arguments @("run", "test:full")
    Invoke-Checked -FilePath "npm.cmd" -Arguments @("test") -WorkingDirectory (Join-Path $Root "atlas-hcm-next")
}

Invoke-Checked -FilePath "npm.cmd" -Arguments @("run", "build") -WorkingDirectory (Join-Path $Root "atlas-hcm-next")

$manifest.gitCommit = Get-GitCommit
$manifest.buildTimestampUtc = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$manifest.frontendBuildHash = Get-DirectoryHash -Path (Join-Path $Root "atlas-hcm-next\out")
$manifest.backendBuildHash = Get-BackendHash
$manifest.service.port = 3355
$manifest.service.healthUrl = "http://127.0.0.1:3355/api/version"
$manifest.artifacts.msi.file = $MsiFile
$manifest.artifacts.exe.file = $ExeFile
$manifest.artifacts.msi.sha256 = "sha256:computed-after-package"
$manifest.artifacts.exe.sha256 = "sha256:computed-after-package"

$runtimeIdentity = [ordered]@{
    product = $manifest.product
    productCode = $manifest.productCode
    version = $manifest.version
    channel = $manifest.channel
    gitCommit = $manifest.gitCommit
    buildTimestampUtc = $manifest.buildTimestampUtc
    frontendBuildHash = $manifest.frontendBuildHash
    backendBuildHash = $manifest.backendBuildHash
    databaseSchemaVersion = $manifest.databaseSchemaVersion
    installedBy = "pending-installer"
}

Write-Json -Value $manifest -Path $ManifestPath
Write-Json -Value $runtimeIdentity -Path $RuntimeVersionPath

& (Join-Path $PSScriptRoot "Build-ATLAS-MSI.ps1") -Version $Version -OutputDir $PatchDir -SkipVerify
if ($LASTEXITCODE -ne 0) { throw "MSI build failed." }

if (-not (Test-Path -LiteralPath $MsiPath)) { throw "MSI was not created: $MsiPath" }

if (-not $SkipExe) {
    & (Join-Path $PSScriptRoot "bootstrapper\deploy.ps1") -Mode Build -UpdateOnly -AppMsi $MsiPath -Output $ExePath -ProductVersion $Version
    if ($LASTEXITCODE -ne 0) { throw "EXE bootstrapper build failed." }
    if (-not (Test-Path -LiteralPath $ExePath)) { throw "EXE was not created: $ExePath" }
}

$manifest.artifacts.msi.sha256 = "sha256:" + (Get-FileHash -Algorithm SHA256 -LiteralPath $MsiPath).Hash
if (Test-Path -LiteralPath $ExePath) {
    $manifest.artifacts.exe.sha256 = "sha256:" + (Get-FileHash -Algorithm SHA256 -LiteralPath $ExePath).Hash
}

Write-Json -Value $manifest -Path $FinalManifestPath
Write-Json -Value $runtimeIdentity -Path (Join-Path $PatchDir "release\version.json")

if (([string]$manifest.artifacts.msi.file) -ne (Split-Path -Leaf $MsiPath)) { throw "Final manifest MSI filename mismatch." }
if ((Test-Path -LiteralPath $ExePath) -and ([string]$manifest.artifacts.exe.file) -ne (Split-Path -Leaf $ExePath)) { throw "Final manifest EXE filename mismatch." }
if ($manifest.gitCommit -ne (Get-GitCommit)) { throw "Git commit changed during release build. Rebuild from a stable checkout." }
if ($manifest.frontendBuildHash -ne (Get-DirectoryHash -Path (Join-Path $Root "atlas-hcm-next\out"))) { throw "Frontend hash mismatch after build." }
if ($manifest.backendBuildHash -ne (Get-BackendHash)) { throw "Backend hash mismatch after build." }

Copy-Item -LiteralPath $FinalManifestPath -Destination (Join-Path $PayloadDir "atlas-release-manifest.json") -Force
Copy-Item -LiteralPath $RuntimeVersionPath -Destination (Join-Path $PayloadDir "release\version.json") -Force

@(
    "# ATLAS Release Build Report",
    "",
    "- Version: $Version",
    "- Git commit: $($manifest.gitCommit)",
    "- Frontend hash: $($manifest.frontendBuildHash)",
    "- Backend hash: $($manifest.backendBuildHash)",
    "- MSI: $MsiPath",
    "- MSI SHA256: $($manifest.artifacts.msi.sha256)",
    "- EXE: $ExePath",
    "- EXE SHA256: $($manifest.artifacts.exe.sha256)",
    "- Manifest: $FinalManifestPath",
    "- Built: $($manifest.buildTimestampUtc)",
    "",
    "Build validation requires MSI and EXE to share this manifest identity. Artifact hashes are final outer-package hashes and are stored in the adjacent release manifest."
) | Set-Content -LiteralPath (Join-Path $ReportsDir "build-report.md") -Encoding UTF8

Write-Host "ATLAS release created: $PatchDir" -ForegroundColor Green
Write-Host "Manifest: $FinalManifestPath"
Write-Host "MSI: $MsiPath"
if (Test-Path -LiteralPath $ExePath) { Write-Host "EXE: $ExePath" }
