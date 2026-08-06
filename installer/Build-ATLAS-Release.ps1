param(
    [Parameter(Mandatory = $true)]
    [string]$Version,

    [string]$ManifestPath = "",
    [string]$OutputRoot = "",
    [switch]$SkipVerify,
    [switch]$SkipExe,
    [switch]$SkipToolingCheck,
    [switch]$UpdateOnlyExe
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
$MsiStagePayloadDir = Join-Path $Root "installer\stage\payload"

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

function Assert-ReleaseTooling {
    if ($SkipToolingCheck) { return }
    $wixCommand = Get-Command wix.exe -ErrorAction SilentlyContinue
    if (-not $wixCommand) {
        throw "WiX Toolset CLI was not found. Install WiX v7 with 'dotnet tool install --global wix --version 7.*', then run 'wix extension add WixToolset.UI.wixext WixToolset.BootstrapperApplications.wixext WixToolset.Util.wixext', or push tag v$Version and use .github/workflows/build-release.yml."
    }
    $wixVersionText = (& $wixCommand.Source --version 2>$null)
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($wixVersionText)) {
        throw "WiX Toolset CLI is installed but did not return a version. Repair WiX or use the GitHub Actions release workflow."
    }
    if ($wixVersionText -notmatch "^7\.") {
        throw "WiX Toolset v7 is required for this release builder. Current wix.exe reports '$wixVersionText'. Use WiX v7 or build with the GitHub Actions workflow."
    }

    $requiredExtensions = @(
        "WixToolset.UI.wixext",
        "WixToolset.BootstrapperApplications.wixext",
        "WixToolset.Util.wixext"
    )
    $extensionList = (& $wixCommand.Source extension list 2>$null) -join "`n"
    foreach ($extension in $requiredExtensions) {
        if ($extensionList -notmatch [regex]::Escape($extension)) {
            throw "Missing WiX extension '$extension'. Run: wix extension add WixToolset.UI.wixext WixToolset.BootstrapperApplications.wixext WixToolset.Util.wixext"
        }
    }
}

function Copy-DirectoryMirror {
    param(
        [Parameter(Mandatory = $true)][string]$Source,
        [Parameter(Mandatory = $true)][string]$Destination
    )
    if (-not (Test-Path -LiteralPath $Source)) { throw "Copy source does not exist: $Source" }
    if (Test-Path -LiteralPath $Destination) {
        Remove-Item -LiteralPath $Destination -Recurse -Force
    }
    New-Item -ItemType Directory -Path $Destination -Force | Out-Null
    $args = @($Source, $Destination, "/MIR", "/NFL", "/NDL", "/NJH", "/NJS", "/NP")
    & robocopy @args | Out-Null
    if ($LASTEXITCODE -gt 7) {
        throw "Copy failed from $Source to $Destination with robocopy exit code $LASTEXITCODE."
    }
    $global:LASTEXITCODE = 0
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
                Where-Object { $_.FullName -notmatch '\\stage\\|\\logs\\|\\node_modules\\' -and $_.Name -ne 'AtlasBootstrapperRunner.exe' } |
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
    $json = $Value | ConvertTo-Json -Depth $Depth
    $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
    [System.IO.File]::WriteAllText($Path, $json + [Environment]::NewLine, $utf8NoBom)
}

function Write-Utf8NoBomText {
    param([string[]]$Lines, [string]$Path)
    New-Item -ItemType Directory -Path (Split-Path -Parent $Path) -Force | Out-Null
    $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
    [System.IO.File]::WriteAllText($Path, (($Lines -join [Environment]::NewLine) + [Environment]::NewLine), $utf8NoBom)
}

if (-not (Test-Path -LiteralPath $ManifestPath)) {
    throw "Release manifest not found: $ManifestPath"
}

$SourceManifestOriginal = [System.IO.File]::ReadAllText($ManifestPath)
$RuntimeVersionOriginalExists = Test-Path -LiteralPath $RuntimeVersionPath
$RuntimeVersionOriginal = if ($RuntimeVersionOriginalExists) { [System.IO.File]::ReadAllText($RuntimeVersionPath) } else { $null }

function Restore-SourceReleaseFiles {
    $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
    if ($null -ne $SourceManifestOriginal) {
        [System.IO.File]::WriteAllText($ManifestPath, $SourceManifestOriginal, $utf8NoBom)
    }
    if ($RuntimeVersionOriginalExists) {
        [System.IO.File]::WriteAllText($RuntimeVersionPath, $RuntimeVersionOriginal, $utf8NoBom)
    } elseif (Test-Path -LiteralPath $RuntimeVersionPath) {
        Remove-Item -LiteralPath $RuntimeVersionPath -Force
    }
}

trap {
    Restore-SourceReleaseFiles
    throw $_
}

$manifest = $SourceManifestOriginal | ConvertFrom-Json
Assert-ReleaseManifestCore -Manifest $manifest

if ([string]$manifest.version -ne $Version) {
    throw "Manifest version '$($manifest.version)' does not match requested version '$Version'."
}

$expectedMsi = "ATLAS-Airfare-Allowance-$Version-x64.msi"
$expectedExe = "ATLAS-Airfare-Allowance-Setup-$Version-x64.exe"
if ([string]$manifest.artifacts.msi.file -ne $expectedMsi) { throw "Manifest MSI filename must be $expectedMsi." }
if ([string]$manifest.artifacts.exe.file -ne $expectedExe) { throw "Manifest EXE filename must be $expectedExe." }

Assert-ReleaseTooling

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
$servicePort = 3356
if ($manifest.service -and $manifest.service.port) {
    $servicePort = [int]$manifest.service.port
}
if (-not $manifest.service) {
    $manifest | Add-Member -NotePropertyName service -NotePropertyValue ([pscustomobject]@{})
}
$manifest.service.port = $servicePort
$manifest.service.healthUrl = "http://127.0.0.1:$servicePort/api/version"
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
if (-not (Test-Path -LiteralPath $MsiStagePayloadDir)) { throw "MSI stage payload was not created: $MsiStagePayloadDir" }

if (-not $SkipExe) {
    $bootstrapperArgs = @{
        Mode = "Build"
        AppMsi = $MsiPath
        Output = $ExePath
        ProductVersion = $Version
    }
    if ($UpdateOnlyExe) {
        $bootstrapperArgs.UpdateOnly = $true
    }
    & (Join-Path $PSScriptRoot "bootstrapper\deploy.ps1") @bootstrapperArgs
    if ($LASTEXITCODE -ne 0) { throw "EXE bootstrapper build failed." }
    if (-not (Test-Path -LiteralPath $ExePath)) { throw "EXE was not created: $ExePath" }
}

$manifest.artifacts.msi.sha256 = "sha256:" + (Get-FileHash -Algorithm SHA256 -LiteralPath $MsiPath).Hash
if (Test-Path -LiteralPath $ExePath) {
    $manifest.artifacts.exe.sha256 = "sha256:" + (Get-FileHash -Algorithm SHA256 -LiteralPath $ExePath).Hash
}

$PatchRuntimeVersionPath = Join-Path $PatchDir "release\version.json"
Write-Json -Value $manifest -Path $FinalManifestPath
Write-Json -Value $runtimeIdentity -Path $PatchRuntimeVersionPath

if (([string]$manifest.artifacts.msi.file) -ne (Split-Path -Leaf $MsiPath)) { throw "Final manifest MSI filename mismatch." }
if ((Test-Path -LiteralPath $ExePath) -and ([string]$manifest.artifacts.exe.file) -ne (Split-Path -Leaf $ExePath)) { throw "Final manifest EXE filename mismatch." }
if ($manifest.gitCommit -ne (Get-GitCommit)) { throw "Git commit changed during release build. Rebuild from a stable checkout." }
if ($manifest.frontendBuildHash -ne (Get-DirectoryHash -Path (Join-Path $Root "atlas-hcm-next\out"))) { throw "Frontend hash mismatch after build." }
if ($manifest.backendBuildHash -ne (Get-BackendHash)) { throw "Backend hash mismatch after build." }

Copy-DirectoryMirror -Source $MsiStagePayloadDir -Destination $PayloadDir
Copy-Item -LiteralPath $FinalManifestPath -Destination (Join-Path $PayloadDir "atlas-release-manifest.json") -Force
New-Item -ItemType Directory -Path (Join-Path $PayloadDir "release") -Force | Out-Null
Copy-Item -LiteralPath $PatchRuntimeVersionPath -Destination (Join-Path $PayloadDir "release\version.json") -Force

$artifactRows = @(
    [pscustomobject]@{
        type = "msi"
        file = $MsiFile
        path = $MsiPath
        sha256 = $manifest.artifacts.msi.sha256
        exists = Test-Path -LiteralPath $MsiPath
    },
    [pscustomobject]@{
        type = "exe"
        file = $ExeFile
        path = $ExePath
        sha256 = $manifest.artifacts.exe.sha256
        exists = Test-Path -LiteralPath $ExePath
    },
    [pscustomobject]@{
        type = "manifest"
        file = "atlas-release-manifest.json"
        path = $FinalManifestPath
        sha256 = "sha256:" + (Get-FileHash -Algorithm SHA256 -LiteralPath $FinalManifestPath).Hash
        exists = Test-Path -LiteralPath $FinalManifestPath
    }
)

$releaseArtifactsJson = $artifactRows |
    Select-Object type, file, sha256, path, exists |
    ConvertTo-Json -Depth 4
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText((Join-Path $PatchDir "release-artifacts.json"), ($releaseArtifactsJson + [Environment]::NewLine), $utf8NoBom)

$shaLines = $artifactRows |
    ForEach-Object { "$($_.sha256)  $($_.file)" } |
    ForEach-Object { $_ }
Write-Utf8NoBomText -Lines $shaLines -Path (Join-Path $PatchDir "SHA256SUMS.txt")

$buildReportLines = @(
    "# ATLAS Release Build Report",
    "",
    "- Version: $Version",
    "- Git commit: $($manifest.gitCommit)",
    "- Frontend hash: $($manifest.frontendBuildHash)",
    "- Backend hash: $($manifest.backendBuildHash)",
    "- MSI: $MsiPath",
    "- MSI SHA256: $($manifest.artifacts.msi.sha256)",
    "- EXE: $ExePath",
    "- EXE mode: $(if ($UpdateOnlyExe) { "Update-only patch" } else { "Full setup / install / repair / update" })",
    "- EXE SHA256: $($manifest.artifacts.exe.sha256)",
    "- Payload: $PayloadDir",
    "- Artifact index: $(Join-Path $PatchDir "release-artifacts.json")",
    "- Checksums: $(Join-Path $PatchDir "SHA256SUMS.txt")",
    "- Manifest: $FinalManifestPath",
    "- Built: $($manifest.buildTimestampUtc)",
    "",
    "Build validation requires MSI and EXE to share this manifest identity. Artifact hashes are final outer-package hashes and are stored in the adjacent release manifest."
)
Write-Utf8NoBomText -Lines $buildReportLines -Path (Join-Path $ReportsDir "build-report.md")

Write-Host "ATLAS release created: $PatchDir" -ForegroundColor Green
Write-Host "Manifest: $FinalManifestPath"
Write-Host "MSI: $MsiPath"
if (Test-Path -LiteralPath $ExePath) { Write-Host "EXE: $ExePath" }
Write-Host "Payload: $PayloadDir"
Write-Host "Artifact index: $(Join-Path $PatchDir "release-artifacts.json")"

Restore-SourceReleaseFiles
