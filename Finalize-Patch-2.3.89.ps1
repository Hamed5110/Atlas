param(
    [string]$RepoRoot = "C:\Airfare_Allowance",
    [string]$Version = "2.3.89",
    [string]$TagName = "v2.3.89",
    [string]$CommitMessage = "fix(installer): build manifest-driven Patch 2.3.89 MSI and EXE artifacts",
    [string]$ReleaseTitle = "Patch 2.3.89 - Continuous Airfare Entitlement Phase 0-1",
    [string]$ReleaseNotes = "Patch 2.3.89 introduces continuous airfare entitlement Phase 0-1, additive DB migration, read-only entitlement APIs, feature flags, and admin-only reconciliation UI.",
    [string]$ReleaseTarget = "",
    [string]$RemoteUrl = "",
    [switch]$LocalOnly
)

$ErrorActionPreference = "Stop"

$script:Failures = New-Object System.Collections.Generic.List[string]

function Write-Ok {
    param([string]$Message)
    Write-Host "OK: $Message" -ForegroundColor Green
}

function Write-Info {
    param([string]$Message)
    Write-Host "INFO: $Message" -ForegroundColor Cyan
}

function Write-WarnLine {
    param([string]$Message)
    Write-Host "WARN: $Message" -ForegroundColor Yellow
}

function Write-FailLine {
    param([string]$Message)
    Write-Host "FAIL: $Message" -ForegroundColor Red
}

function Add-Failure {
    param([string]$Message)
    $script:Failures.Add($Message) | Out-Null
    Write-FailLine $Message
}

function Invoke-Required {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [string]$Step = $FilePath
    )
    Write-Info "$Step"
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Step failed with exit code $LASTEXITCODE."
    }
}

function Invoke-Capture {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $true)][string[]]$Arguments
    )
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $output = & $FilePath @Arguments 2>&1
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
    return [pscustomobject]@{
        ExitCode = $exitCode
        Output = @($output)
        Text = (@($output) -join "`n")
    }
}

function Assert-CommandAvailable {
    param([string]$Name)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command '$Name' was not found in PATH."
    }
    Write-Ok "command available: $Name"
}

function Assert-GitHubCliAuthenticated {
    $result = Invoke-Capture -FilePath "gh" -Arguments @("auth", "status")
    if ($result.ExitCode -ne 0) {
        throw @"
GitHub CLI is installed but not authenticated.

Run this once in an interactive PowerShell window:
  gh auth login --hostname github.com --git-protocol https --web

Then verify:
  gh auth status

After it shows you are logged in, re-run:
  powershell -ExecutionPolicy Bypass -File .\Finalize-Patch-2.3.89.ps1
"@
    }
    Write-Ok "GitHub CLI authenticated"
}

function Assert-RepoRoot {
    if (-not (Test-Path -LiteralPath $RepoRoot)) {
        throw "Repo root not found: $RepoRoot"
    }
    Set-Location $RepoRoot
    $inside = Invoke-Capture -FilePath "git" -Arguments @("rev-parse", "--is-inside-work-tree")
    if ($inside.ExitCode -ne 0 -or $inside.Text.Trim() -ne "true") {
        throw "$RepoRoot is not a Git worktree."
    }
    Write-Ok "repo ready: $RepoRoot"
}

function Ensure-OriginRemote {
    $origin = Invoke-Capture -FilePath "git" -Arguments @("remote", "get-url", "origin")
    if ($origin.ExitCode -eq 0 -and -not [string]::IsNullOrWhiteSpace($origin.Text)) {
        Write-Ok "origin remote configured: $($origin.Text.Trim())"
        return
    }

    if (-not [string]::IsNullOrWhiteSpace($RemoteUrl)) {
        Invoke-Required -FilePath "git" -Arguments @("remote", "add", "origin", $RemoteUrl) -Step "add missing origin remote"
        Write-Ok "origin remote added: $RemoteUrl"
        return
    }

    throw @"
Git remote 'origin' is missing. I cannot push the branch/tag or publish a GitHub Release without the repo URL.

Run the script again with your GitHub repo URL:
  powershell -ExecutionPolicy Bypass -File .\Finalize-Patch-2.3.89.ps1 -RemoteUrl "https://github.com/<account>/<repo>.git"

Or set it manually, then re-run:
  git remote add origin https://github.com/<account>/<repo>.git
  powershell -ExecutionPolicy Bypass -File .\Finalize-Patch-2.3.89.ps1
"@
}

function Get-CurrentBranch {
    $branch = Invoke-Capture -FilePath "git" -Arguments @("branch", "--show-current")
    if ($branch.ExitCode -ne 0 -or [string]::IsNullOrWhiteSpace($branch.Text)) {
        throw "Could not determine current Git branch."
    }
    return $branch.Text.Trim()
}

function Test-LocalTag {
    param([string]$Name)
    $result = Invoke-Capture -FilePath "git" -Arguments @("rev-parse", "-q", "--verify", "refs/tags/$Name")
    return $result.ExitCode -eq 0
}

function Test-RemoteTag {
    param([string]$Name)
    $result = Invoke-Capture -FilePath "git" -Arguments @("ls-remote", "--tags", "origin", "refs/tags/$Name")
    return $result.ExitCode -eq 0 -and -not [string]::IsNullOrWhiteSpace($result.Text)
}

function Get-RefSha {
    param([string]$Ref)
    $result = Invoke-Capture -FilePath "git" -Arguments @("rev-parse", $Ref)
    if ($result.ExitCode -ne 0) { return "" }
    return $result.Text.Trim()
}

function Stage-And-CommitReleaseFiles {
    $requiredFiles = @(
        ".gitignore",
        "installer\Build-ATLAS-Release.ps1",
        ".github\workflows\build-release.yml"
    )

    foreach ($file in $requiredFiles) {
        if (-not (Test-Path -LiteralPath (Join-Path $RepoRoot $file))) {
            throw "Required release-pipeline file is missing: $file"
        }
    }

    Invoke-Required -FilePath "git" -Arguments (@("add") + $requiredFiles) -Step "stage release-pipeline files only"

    & git diff --cached --quiet
    if ($LASTEXITCODE -eq 0) {
        Write-Ok "nothing to commit for release-pipeline files; continuing"
        return
    }

    Invoke-Required -FilePath "git" -Arguments @("commit", "-m", $CommitMessage) -Step "commit release-pipeline files"
    Write-Ok "release-pipeline commit complete"
}

function Ensure-TagAtHead {
    $head = Get-RefSha -Ref "HEAD"
    if ([string]::IsNullOrWhiteSpace($head)) {
        throw "Could not resolve HEAD."
    }

    $localExists = Test-LocalTag -Name $TagName
    $remoteExists = Test-RemoteTag -Name $TagName

    if ($localExists) {
        $tagSha = Get-RefSha -Ref "$TagName^{}"
        if ($tagSha -ne $head) {
            Write-WarnLine "$TagName exists locally but does not point to HEAD. Recreating tag so release artifacts bind to final commit."
            Invoke-Required -FilePath "git" -Arguments @("tag", "-d", $TagName) -Step "delete stale local tag $TagName"
            $localExists = $false
        } else {
            Write-Ok "$TagName already points to HEAD"
        }
    }

    if (-not $localExists) {
        Invoke-Required -FilePath "git" -Arguments @("tag", "-a", $TagName, "-m", "Patch $Version - Continuous Airfare Entitlement Phase 0-1") -Step "create tag $TagName"
        Write-Ok "created local tag $TagName"
    }

    if ($remoteExists) {
        $remoteText = (Invoke-Capture -FilePath "git" -Arguments @("ls-remote", "--tags", "origin", "refs/tags/$TagName^{}")).Text.Trim()
        if ([string]::IsNullOrWhiteSpace($remoteText)) {
            $remoteText = (Invoke-Capture -FilePath "git" -Arguments @("ls-remote", "--tags", "origin", "refs/tags/$TagName")).Text.Trim()
        }
        $remoteSha = ($remoteText -split "\s+")[0]
        $localSha = Get-RefSha -Ref "$TagName^{}"
        if ($remoteSha -and $remoteSha -ne $localSha) {
            Write-WarnLine "$TagName exists remotely but points to a different commit. Replacing remote tag to match final local tag."
            Invoke-Required -FilePath "git" -Arguments @("push", "origin", ":refs/tags/$TagName") -Step "delete stale remote tag $TagName"
        } else {
            Write-Ok "$TagName already exists remotely and matches local tag"
        }
    }
}

function Push-Branch-And-Tag {
    $branch = Get-CurrentBranch
    if ([string]::IsNullOrWhiteSpace($ReleaseTarget)) {
        $script:ReleaseTarget = $branch
    }

    Invoke-Required -FilePath "git" -Arguments @("push", "origin", "HEAD") -Step "push current branch $branch"
    Invoke-Required -FilePath "git" -Arguments @("push", "origin", $TagName) -Step "push tag $TagName"
    Write-Ok "branch and tag pushed"
}

function Build-ReleaseArtifacts {
    $builder = Join-Path $RepoRoot "installer\Build-ATLAS-Release.ps1"
    if (-not (Test-Path -LiteralPath $builder)) {
        throw "Release builder missing: $builder"
    }
    Invoke-Required -FilePath "powershell" -Arguments @("-ExecutionPolicy", "Bypass", "-File", $builder, "-Version", $Version, "-SkipVerify") -Step "rebuild MSI/EXE/manifest artifacts after tagging"
}

function Get-ExpectedArtifactPaths {
    $patchDir = Join-Path $RepoRoot "artifacts\patch-$Version"
    return [ordered]@{
        Msi = Join-Path $patchDir "ATLAS-Airfare-Allowance-$Version-x64.msi"
        Exe = Join-Path $patchDir "ATLAS-Airfare-Allowance-Setup-$Version-x64.exe"
        Manifest = Join-Path $patchDir "atlas-release-manifest.json"
        ArtifactIndex = Join-Path $patchDir "release-artifacts.json"
        Checksums = Join-Path $patchDir "SHA256SUMS.txt"
    }
}

function Assert-LocalArtifacts {
    $paths = Get-ExpectedArtifactPaths
    $missing = New-Object System.Collections.Generic.List[string]
    foreach ($key in $paths.Keys) {
        if (-not (Test-Path -LiteralPath $paths[$key])) {
            $missing.Add($paths[$key]) | Out-Null
        }
    }

    if ($missing.Count -gt 0) {
        Write-WarnLine "missing local artifacts; rebuilding once"
        Build-ReleaseArtifacts
        $missing.Clear()
        foreach ($key in $paths.Keys) {
            if (-not (Test-Path -LiteralPath $paths[$key])) {
                $missing.Add($paths[$key]) | Out-Null
            }
        }
    }

    if ($missing.Count -gt 0) {
        throw "Local artifacts are still missing after rebuild: $($missing -join ', ')"
    }

    Write-Ok "all local artifacts exist"
}

function Publish-GitHubRelease {
    $paths = Get-ExpectedArtifactPaths
    $patchDir = Join-Path $RepoRoot "artifacts\patch-$Version"
    Set-Location $patchDir

    $assets = @(
        $paths.Msi,
        $paths.Exe,
        $paths.Manifest,
        $paths.ArtifactIndex,
        $paths.Checksums
    )

    $releaseView = Invoke-Capture -FilePath "gh" -Arguments @("release", "view", $TagName)
    if ($releaseView.ExitCode -eq 0) {
        Write-Ok "GitHub Release $TagName exists; replacing assets with --clobber"
        Invoke-Required -FilePath "gh" -Arguments (@("release", "upload", $TagName) + $assets + @("--clobber")) -Step "upload/replace release assets"
    } else {
        Write-Info "GitHub Release $TagName does not exist; creating it"
        Invoke-Required -FilePath "gh" -Arguments (@(
            "release", "create", $TagName,
            "--title", $ReleaseTitle,
            "--notes", $ReleaseNotes,
            "--target", $ReleaseTarget
        ) + $assets) -Step "create GitHub Release with assets"
    }

    Set-Location $RepoRoot
}

function Get-GitHubReleaseJson {
    $result = Invoke-Capture -FilePath "gh" -Arguments @("release", "view", $TagName, "--json", "tagName,assets")
    if ($result.ExitCode -ne 0) { return $null }
    try {
        return ($result.Text | ConvertFrom-Json)
    } catch {
        return $null
    }
}

function Test-GitHubTag {
    $result = Invoke-Capture -FilePath "git" -Arguments @("ls-remote", "--tags", "origin", "refs/tags/$TagName")
    return $result.ExitCode -eq 0 -and -not [string]::IsNullOrWhiteSpace($result.Text)
}

function Test-ManifestContent {
    $manifestPath = (Get-ExpectedArtifactPaths).Manifest
    if (-not (Test-Path -LiteralPath $manifestPath)) {
        Add-Failure "local manifest missing: $manifestPath"
        return
    }
    try {
        $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
        if ([string]$manifest.version -ne $Version) {
            Add-Failure "manifest version is '$($manifest.version)', expected '$Version'"
        }
        $migration = @($manifest.migrationPlan) | Where-Object { $_.id -eq "20260802-continuous-airfare-entitlement-phase1" } | Select-Object -First 1
        if (-not $migration) {
            Add-Failure "manifest missing migration: 20260802-continuous-airfare-entitlement-phase1"
        }
    } catch {
        Add-Failure "manifest is not valid JSON: $($_.Exception.Message)"
    }
}

function Final-Verification {
    $script:Failures.Clear()
    $paths = Get-ExpectedArtifactPaths
    $expectedAssets = @(
        "ATLAS-Airfare-Allowance-$Version-x64.msi",
        "ATLAS-Airfare-Allowance-Setup-$Version-x64.exe",
        "atlas-release-manifest.json",
        "release-artifacts.json",
        "SHA256SUMS.txt"
    )

    foreach ($path in $paths.Values) {
        if (-not (Test-Path -LiteralPath $path)) {
            Add-Failure "local artifact missing: $path"
        }
    }

    if (Test-GitHubTag) {
        Write-Ok "GitHub tag exists: $TagName"
    } else {
        Add-Failure "GitHub tag missing: $TagName"
    }

    $release = Get-GitHubReleaseJson
    if ($null -eq $release) {
        Add-Failure "GitHub Release missing or unreadable: $TagName"
    } else {
        Write-Ok "GitHub Release exists: $TagName"
        $assetNames = @($release.assets | ForEach-Object { [string]$_.name })
        foreach ($asset in $expectedAssets) {
            if ($assetNames -notcontains $asset) {
                Add-Failure "GitHub Release asset missing: $asset"
            } else {
                Write-Ok "GitHub Release asset attached: $asset"
            }
        }
    }

    Test-ManifestContent

    if ($script:Failures.Count -eq 0) {
        Write-Host ""
        Write-Host "PASS: Patch $Version is release-ready" -ForegroundColor Green
        return $true
    }

    Write-Host ""
    Write-Host "FAIL: not done - missing/failing items:" -ForegroundColor Red
    foreach ($failure in $script:Failures) {
        Write-Host " - $failure" -ForegroundColor Red
    }
    return $false
}

function Final-LocalVerification {
    $script:Failures.Clear()
    $paths = Get-ExpectedArtifactPaths

    foreach ($path in $paths.Values) {
        if (-not (Test-Path -LiteralPath $path)) {
            Add-Failure "local artifact missing: $path"
        } else {
            Write-Ok "local artifact exists: $path"
        }
    }

    if (Test-LocalTag -Name $TagName) {
        Write-Ok "local Git tag exists: $TagName"
    } else {
        Add-Failure "local Git tag missing: $TagName"
    }

    Test-ManifestContent

    if ($script:Failures.Count -eq 0) {
        Write-Host ""
        Write-Host "PASS: Patch $Version local build/test artifacts are ready" -ForegroundColor Green
        return $true
    }

    Write-Host ""
    Write-Host "FAIL: local build not done - missing/failing items:" -ForegroundColor Red
    foreach ($failure in $script:Failures) {
        Write-Host " - $failure" -ForegroundColor Red
    }
    return $false
}

try {
    Assert-CommandAvailable -Name "git"
    Assert-CommandAvailable -Name "powershell"
    if (-not $LocalOnly) {
        Assert-CommandAvailable -Name "gh"
    }
    Assert-RepoRoot
    if (-not $LocalOnly) {
        Ensure-OriginRemote
    }

    Write-Info "Current status before release:"
    git status --short

    Stage-And-CommitReleaseFiles
    Ensure-TagAtHead
    if (-not $LocalOnly) {
        Push-Branch-And-Tag
    } else {
        Write-Ok "local-only mode: skipping Git remote push"
    }
    Build-ReleaseArtifacts
    Assert-LocalArtifacts
    if (-not $LocalOnly) {
        Assert-GitHubCliAuthenticated
        Publish-GitHubRelease

        if (-not (Final-Verification)) {
            exit 1
        }
    } else {
        if (-not (Final-LocalVerification)) {
            exit 1
        }
    }

    exit 0
} catch {
    Write-FailLine $_.Exception.Message
    exit 1
}
