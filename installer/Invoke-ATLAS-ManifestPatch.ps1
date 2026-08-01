param(
    [Parameter(Mandatory = $true)]
    [string]$ArtifactRoot,

    [string]$InstallRoot = "C:\Program Files\ATLAS Airfare Allowance",
    [string]$DataRoot = "C:\ProgramData\ATLAS Airfare Allowance",
    [string]$RegistryPath = "HKLM:\SOFTWARE\ATLAS\AirfareAllowance",
    [switch]$Repair,
    [switch]$WhatIfOnly
)

$ErrorActionPreference = "Stop"

$ManifestPath = Join-Path $ArtifactRoot "atlas-release-manifest.json"
$InstallStatePath = Join-Path $DataRoot "install-state.json"
$PatchHistoryPath = Join-Path $DataRoot "patch-history.json"
$PendingPatchPath = Join-Path $DataRoot "rollback\pending-patch.json"
$RollbackRoot = Join-Path $DataRoot ("rollback\{0}" -f (Get-Date -Format "yyyyMMddHHmmss"))

function Write-Step { param([string]$Message) Write-Host "[ATLAS PATCH] $Message" -ForegroundColor Cyan }

function Read-JsonFile {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
}

function Write-JsonFile {
    param([object]$Value, [string]$Path, [int]$Depth = 20)
    New-Item -ItemType Directory -Path (Split-Path -Parent $Path) -Force | Out-Null
    $Value | ConvertTo-Json -Depth $Depth | Set-Content -LiteralPath $Path -Encoding UTF8
}

function Compare-VersionText {
    param([string]$Left, [string]$Right)
    try {
        $l = [version]$Left
        $r = [version]$Right
        return $l.CompareTo($r)
    } catch {
        return [string]::Compare($Left, $Right, $true)
    }
}

function Test-VersionRange {
    param([string]$Version, [string]$Expression)
    if ([string]::IsNullOrWhiteSpace($Expression)) { return $true }
    if ($Expression -match '^\s*<\s*([0-9][0-9A-Za-z\.\-]*)\s*$') { return (Compare-VersionText $Version $Matches[1]) -lt 0 }
    if ($Expression -match '^\s*<=\s*([0-9][0-9A-Za-z\.\-]*)\s*$') { return (Compare-VersionText $Version $Matches[1]) -le 0 }
    if ($Expression -match '^\s*>\s*([0-9][0-9A-Za-z\.\-]*)\s*$') { return (Compare-VersionText $Version $Matches[1]) -gt 0 }
    if ($Expression -match '^\s*>=\s*([0-9][0-9A-Za-z\.\-]*)\s*$') { return (Compare-VersionText $Version $Matches[1]) -ge 0 }
    if ($Expression -match '^\s*=\s*([0-9][0-9A-Za-z\.\-]*)\s*$') { return (Compare-VersionText $Version $Matches[1]) -eq 0 }
    throw "Unsupported migration version range expression: $Expression"
}

function Get-RegistryInstalledState {
    if (-not (Test-Path -LiteralPath $RegistryPath)) { return $null }
    $item = Get-ItemProperty -LiteralPath $RegistryPath
    if (-not $item.Version) { return $null }
    return [pscustomobject]@{
        installedVersion = [string]$item.Version
        gitCommit = [string]$item.GitCommit
        frontendBuildHash = [string]$item.FrontendBuildHash
        backendBuildHash = [string]$item.BackendBuildHash
        databaseSchemaVersion = [string]$item.DatabaseSchemaVersion
        installRoot = [string]$item.InstallRoot
        dataRoot = [string]$item.DataRoot
        source = "registry"
    }
}

function Get-HttpInstalledState {
    param([string]$Url)
    try {
        $version = Invoke-RestMethod -Uri $Url -TimeoutSec 5
        return [pscustomobject]@{
            installedVersion = [string]$version.version
            gitCommit = [string]$version.gitCommit
            frontendBuildHash = [string]$version.frontendBuildHash
            backendBuildHash = [string]$version.backendBuildHash
            databaseSchemaVersion = [string]$version.databaseSchemaVersion
            source = "http"
        }
    } catch {
        return $null
    }
}

function Get-InstalledState {
    param([pscustomobject]$Manifest)
    $registry = Get-RegistryInstalledState
    if ($registry) { return $registry }
    $file = Read-JsonFile $InstallStatePath
    if ($file) { $file | Add-Member -NotePropertyName source -NotePropertyValue "install-state" -Force; return $file }
    $http = Get-HttpInstalledState -Url ([string]$Manifest.service.healthUrl)
    if ($http) { return $http }
    $runtimeVersionPath = Join-Path $InstallRoot "release\version.json"
    $runtime = Read-JsonFile $runtimeVersionPath
    if ($runtime) {
        return [pscustomobject]@{
            installedVersion = [string]$runtime.version
            gitCommit = [string]$runtime.gitCommit
            frontendBuildHash = [string]$runtime.frontendBuildHash
            backendBuildHash = [string]$runtime.backendBuildHash
            databaseSchemaVersion = [string]$runtime.databaseSchemaVersion
            source = "release-version-file"
        }
    }
    return $null
}

function Get-PatchDecision {
    param([object]$Installed, [pscustomobject]$Target, [bool]$RepairMode)
    if (-not $Installed -or [string]::IsNullOrWhiteSpace([string]$Installed.installedVersion)) { return "freshInstall" }
    if ((Compare-VersionText $Installed.installedVersion $Target.minimumUpgradeableVersion) -lt 0) { return "blockMinimumVersion" }
    $versionCompare = Compare-VersionText $Installed.installedVersion $Target.version
    if ($versionCompare -gt 0) { return "blockDowngrade" }
    if ($versionCompare -lt 0) { return "patch" }
    $hashMismatch = $Installed.gitCommit -ne $Target.gitCommit -or $Installed.frontendBuildHash -ne $Target.frontendBuildHash -or $Installed.backendBuildHash -ne $Target.backendBuildHash -or $Installed.databaseSchemaVersion -ne $Target.databaseSchemaVersion
    if ($hashMismatch -or $RepairMode) { return "repair" }
    return "noop"
}

function Select-Migrations {
    param([string]$InstalledVersion, [pscustomobject]$Target)
    if ([string]::IsNullOrWhiteSpace($InstalledVersion)) { $InstalledVersion = "0.0.0" }
    @($Target.migrationPlan) | Where-Object {
        (Test-VersionRange -Version $InstalledVersion -Expression ([string]$_.from)) -and
        (Test-VersionRange -Version ([string]$Target.version) -Expression ([string]$_.to))
    }
}

function Stop-AtlasRuntime {
    param([int]$Port)
    $connections = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    foreach ($connection in $connections) {
        Stop-Process -Id $connection.OwningProcess -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 2
    if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
        throw "Port $Port is still in use after stop attempt."
    }
}

function Copy-Tree {
    param([string]$Source, [string]$Destination)
    if (-not (Test-Path -LiteralPath $Source)) { throw "Missing source folder: $Source" }
    New-Item -ItemType Directory -Path $Destination -Force | Out-Null
    $args = @($Source, $Destination, "/E", "/NFL", "/NDL", "/NJH", "/NJS", "/NP")
    & robocopy @args | Out-Null
    if ($LASTEXITCODE -gt 7) { throw "Copy failed from $Source to $Destination with robocopy exit code $LASTEXITCODE." }
    $global:LASTEXITCODE = 0
}

function Backup-InstalledState {
    New-Item -ItemType Directory -Path $RollbackRoot -Force | Out-Null
    foreach ($relative in @(".env", "release\version.json", "release\atlas-release-manifest.json", "server.js", "package.json", "package-lock.json")) {
        $source = Join-Path $InstallRoot $relative
        if (Test-Path -LiteralPath $source) {
            $dest = Join-Path $RollbackRoot $relative
            New-Item -ItemType Directory -Path (Split-Path -Parent $dest) -Force | Out-Null
            Copy-Item -LiteralPath $source -Destination $dest -Force
        }
    }
    foreach ($relative in @("atlas-hcm-next", "database", "extensions", "installer")) {
        $source = Join-Path $InstallRoot $relative
        if (Test-Path -LiteralPath $source) {
            Copy-Tree -Source $source -Destination (Join-Path $RollbackRoot $relative)
        }
    }
    if (Test-Path -LiteralPath $InstallStatePath) {
        Copy-Item -LiteralPath $InstallStatePath -Destination (Join-Path $RollbackRoot "previous-install-state.json") -Force
    }
}

function Apply-PayloadAtomically {
    $sourcePayload = Join-Path $ArtifactRoot "payload"
    if (-not (Test-Path -LiteralPath $sourcePayload)) {
        $sourcePayload = $ArtifactRoot
    }
    $staging = Join-Path $InstallRoot ".staging"
    $previous = Join-Path $InstallRoot ".previous"
    if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
    Copy-Tree -Source $sourcePayload -Destination $staging
    if (Test-Path -LiteralPath $previous) { Remove-Item -LiteralPath $previous -Recurse -Force }
    foreach ($name in @("server.js", "package.json", "package-lock.json", "atlas-hcm-next", "database", "extensions", "release", "installer")) {
        $target = Join-Path $InstallRoot $name
        if (Test-Path -LiteralPath $target) {
            New-Item -ItemType Directory -Path $previous -Force | Out-Null
            Move-Item -LiteralPath $target -Destination (Join-Path $previous $name) -Force
        }
        $replacement = Join-Path $staging $name
        if (Test-Path -LiteralPath $replacement) {
            Move-Item -LiteralPath $replacement -Destination $target -Force
        }
    }
    Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
}

function Invoke-SqlText {
    param([string]$SqlText)
    $envPath = Join-Path $InstallRoot ".env"
    $settings = @{}
    if (Test-Path -LiteralPath $envPath) {
        Get-Content -LiteralPath $envPath | ForEach-Object {
            if ($_ -match '^\s*([^#=]+)\s*=\s*(.*)\s*$') { $settings[$Matches[1].Trim()] = $Matches[2].Trim() }
        }
    }
    $server = $settings.DB_SERVER
    if ([string]::IsNullOrWhiteSpace($server)) { $server = "localhost" }
    $database = $settings.DB_NAME
    if ([string]::IsNullOrWhiteSpace($database)) { $database = "Atlasairfare010" }
    $user = $settings.DB_USER
    $password = $settings.DB_PASSWORD
    $port = $settings.DB_PORT
    if ($port) { $server = "$server,$port" }
    $tmp = Join-Path $env:TEMP ("atlas-migration-{0}.sql" -f ([guid]::NewGuid()))
    $SqlText | Set-Content -LiteralPath $tmp -Encoding UTF8
    try {
        if ($user -and $password) {
            & sqlcmd -S $server -d $database -U $user -P $password -b -i $tmp
        } else {
            & sqlcmd -S $server -d $database -E -b -i $tmp
        }
        if ($LASTEXITCODE -ne 0) { throw "sqlcmd migration failed with exit code $LASTEXITCODE." }
    } finally {
        Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
    }
}

function Invoke-Migration {
    param([pscustomobject]$Migration)
    Write-Step "Running migration $($Migration.id): $($Migration.description)"
    if ($Migration.type -eq "sql") {
        $scriptPath = Join-Path $InstallRoot ([string]$Migration.script)
        if (-not (Test-Path -LiteralPath $scriptPath)) { $scriptPath = Join-Path $ArtifactRoot ([string]$Migration.script) }
        if (-not (Test-Path -LiteralPath $scriptPath)) { throw "Migration SQL script missing: $($Migration.script)" }
        Invoke-SqlText -SqlText (Get-Content -LiteralPath $scriptPath -Raw)
    } elseif ($Migration.type -eq "config") {
        $envPath = Join-Path $InstallRoot ".env"
        $lines = if (Test-Path -LiteralPath $envPath) { @(Get-Content -LiteralPath $envPath) } else { @() }
        foreach ($prop in $Migration.writeEnv.PSObject.Properties) {
            $pattern = "^\s*$([regex]::Escape($prop.Name))\s*="
            $replacement = "$($prop.Name)=$($prop.Value)"
            if ($lines -match $pattern) {
                $lines = $lines | ForEach-Object { if ($_ -match $pattern) { $replacement } else { $_ } }
            } else {
                $lines += $replacement
            }
        }
        $lines | Set-Content -LiteralPath $envPath -Encoding UTF8
    } elseif ($Migration.type -eq "fileAndHttp") {
        return
    } else {
        throw "Unsupported migration type: $($Migration.type)"
    }
}

function Test-MigrationVerify {
    param([pscustomobject]$Migration)
    $verify = $Migration.verify
    if ($verify.kind -eq "sqlObjectExists") {
        $objectName = [string]$verify.object
        $objectType = [string]$verify.objectType
        $sqlText = "IF OBJECT_ID(N'$objectName', N'$objectType') IS NULL THROW 51090, 'Migration verify failed: $objectName missing.', 1;"
        Invoke-SqlText -SqlText $sqlText
        return $true
    }
    if ($verify.kind -eq "sqlColumnExists") {
        $tableName = [string]$verify.table
        $columnName = [string]$verify.column
        $sqlText = "IF COL_LENGTH(N'$tableName', N'$columnName') IS NULL THROW 51091, 'Migration verify failed: $tableName.$columnName missing.', 1;"
        Invoke-SqlText -SqlText $sqlText
        return $true
    }
    if ($verify.kind -eq "httpHeader") {
        $response = Invoke-WebRequest -Uri ([string]$verify.url) -TimeoutSec 10 -UseBasicParsing
        return ([string]$response.Headers[[string]$verify.header]) -eq [string]$verify.expected
    }
    if ($verify.kind -eq "httpJsonEqualsManifest") {
        $runtime = Invoke-RestMethod -Uri ([string]$verify.url) -TimeoutSec 10
        foreach ($field in @($verify.fields)) {
            $expected = Get-NestedValue -Object $script:TargetManifest -Path ([string]$field)
            $actual = Get-NestedValue -Object $runtime -Path ([string]$field)
            if ([string]$expected -ne [string]$actual) { throw "Runtime field mismatch $field expected '$expected' actual '$actual'." }
        }
        return $true
    }
    throw "Unsupported verify kind: $($verify.kind)"
}

function Get-NestedValue {
    param([object]$Object, [string]$Path)
    $current = $Object
    foreach ($part in $Path.Split('.')) {
        if ($null -eq $current) { return $null }
        $current = $current.$part
    }
    return $current
}

function Start-AtlasRuntime {
    $startScript = Join-Path $InstallRoot "Start-ATLAS-Bundled.ps1"
    if (Test-Path -LiteralPath $startScript) {
        Start-Process -FilePath "powershell.exe" -ArgumentList @("-ExecutionPolicy", "Bypass", "-File", $startScript) -WorkingDirectory $InstallRoot -WindowStyle Hidden
    } else {
        Start-Process -FilePath "node.exe" -ArgumentList (Join-Path $InstallRoot "server.js") -WorkingDirectory $InstallRoot -WindowStyle Hidden
    }
}

function Wait-VersionEndpoint {
    param([string]$Url, [int]$TimeoutSeconds = 60)
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        try { return Invoke-RestMethod -Uri $Url -TimeoutSec 5 } catch { Start-Sleep -Seconds 3 }
    } while ((Get-Date) -lt $deadline)
    throw "ATLAS did not respond on $Url within $TimeoutSeconds seconds."
}

function Assert-RuntimeMatchesManifest {
    param([pscustomobject]$Manifest, [pscustomobject]$Runtime)
    foreach ($field in @("productCode", "version", "gitCommit", "frontendBuildHash", "backendBuildHash", "databaseSchemaVersion")) {
        if ([string]$Manifest.$field -ne [string]$Runtime.$field) {
            throw "Runtime mismatch $field expected '$($Manifest.$field)' actual '$($Runtime.$field)'."
        }
    }
    if ([string]$Runtime.artifact.manifestVersion -ne [string]$Manifest.version) {
        throw "Runtime mismatch artifact.manifestVersion expected '$($Manifest.version)' actual '$($Runtime.artifact.manifestVersion)'."
    }
}

function Restore-RollbackFiles {
    Write-Step "Restoring rollback files from $RollbackRoot"
    foreach ($name in @("server.js", "package.json", "package-lock.json", "atlas-hcm-next", "database", "extensions", "release", "installer")) {
        $backup = Join-Path $RollbackRoot $name
        if (Test-Path -LiteralPath $backup) {
            $target = Join-Path $InstallRoot $name
            if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
            Move-Item -LiteralPath $backup -Destination $target -Force
        }
    }
}

function Update-RegistryAndState {
    param([pscustomobject]$Manifest, [string]$Status)
    New-Item -Path $RegistryPath -Force | Out-Null
    New-ItemProperty -Path $RegistryPath -Name Version -Value $Manifest.version -PropertyType String -Force | Out-Null
    New-ItemProperty -Path $RegistryPath -Name GitCommit -Value $Manifest.gitCommit -PropertyType String -Force | Out-Null
    New-ItemProperty -Path $RegistryPath -Name FrontendBuildHash -Value $Manifest.frontendBuildHash -PropertyType String -Force | Out-Null
    New-ItemProperty -Path $RegistryPath -Name BackendBuildHash -Value $Manifest.backendBuildHash -PropertyType String -Force | Out-Null
    New-ItemProperty -Path $RegistryPath -Name DatabaseSchemaVersion -Value $Manifest.databaseSchemaVersion -PropertyType String -Force | Out-Null
    New-ItemProperty -Path $RegistryPath -Name InstallRoot -Value $InstallRoot -PropertyType String -Force | Out-Null
    New-ItemProperty -Path $RegistryPath -Name DataRoot -Value $DataRoot -PropertyType String -Force | Out-Null
    New-ItemProperty -Path $RegistryPath -Name LastPatchStatus -Value $Status -PropertyType String -Force | Out-Null

    Write-JsonFile -Path $InstallStatePath -Value ([ordered]@{
        installedVersion = $Manifest.version
        gitCommit = $Manifest.gitCommit
        frontendBuildHash = $Manifest.frontendBuildHash
        backendBuildHash = $Manifest.backendBuildHash
        databaseSchemaVersion = $Manifest.databaseSchemaVersion
        installRoot = $InstallRoot
        dataRoot = $DataRoot
        installedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
        lastPatchStatus = $Status
    })
}

function Add-PatchHistory {
    param([object]$Entry)
    $history = @(Read-JsonFile $PatchHistoryPath)
    if ($history.Count -eq 1 -and $null -eq $history[0]) { $history = @() }
    $history += $Entry
    Write-JsonFile -Path $PatchHistoryPath -Value $history
}

if (-not (Test-Path -LiteralPath $ManifestPath)) { throw "Target release manifest missing: $ManifestPath" }
$script:TargetManifest = Read-JsonFile $ManifestPath
$installed = Get-InstalledState -Manifest $script:TargetManifest
$decision = Get-PatchDecision -Installed $installed -Target $script:TargetManifest -RepairMode ([bool]$Repair)
$installedVersion = if ($installed) { [string]$installed.installedVersion } else { "none" }
$migrations = Select-Migrations -InstalledVersion $installedVersion -Target $script:TargetManifest

Write-Step "Installed=$installedVersion Target=$($script:TargetManifest.version) Decision=$decision Migrations=$(@($migrations).Count)"
if ($decision -eq "noop") { return }
if ($decision -like "block*") { throw "Patch blocked: $decision. Installed=$installedVersion Target=$($script:TargetManifest.version)" }

$pending = [ordered]@{
    status = "Pending"
    startedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
    fromVersion = $installedVersion
    toVersion = $script:TargetManifest.version
    backupRoot = $RollbackRoot
    plannedMigrations = @($migrations | ForEach-Object { $_.id })
}
Write-JsonFile -Path $PendingPatchPath -Value $pending

$historyEntry = [ordered]@{
    fromVersion = $installedVersion
    toVersion = $script:TargetManifest.version
    startedAtUtc = $pending.startedAtUtc
    status = "Started"
    decision = $decision
    migrations = @()
}

try {
    if (-not $WhatIfOnly) {
        Backup-InstalledState
        Stop-AtlasRuntime -Port ([int]$script:TargetManifest.service.port)
        Apply-PayloadAtomically
        foreach ($migration in @($migrations)) {
            $migrationResult = [ordered]@{ id = $migration.id; status = "Started"; verified = $false }
            try {
                Invoke-Migration -Migration $migration
                $migrationResult.verified = Test-MigrationVerify -Migration $migration
                $migrationResult.status = "Success"
            } catch {
                $migrationResult.status = "Failed"
                $migrationResult.error = $_.Exception.Message
                $historyEntry.migrations += $migrationResult
                throw
            }
            $historyEntry.migrations += $migrationResult
        }
        Start-AtlasRuntime
        $runtime = Wait-VersionEndpoint -Url ([string]$script:TargetManifest.service.healthUrl)
        Assert-RuntimeMatchesManifest -Manifest $script:TargetManifest -Runtime $runtime
        Update-RegistryAndState -Manifest $script:TargetManifest -Status "Success"
        Remove-Item -LiteralPath $PendingPatchPath -Force -ErrorAction SilentlyContinue
    }
    $historyEntry.status = if ($WhatIfOnly) { "WhatIf" } else { "Success" }
    $historyEntry.finishedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
    Add-PatchHistory -Entry $historyEntry
    Write-Step "Patch completed: $($historyEntry.status)"
} catch {
    $historyEntry.status = "Failed"
    $historyEntry.error = $_.Exception.Message
    $historyEntry.finishedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
    Add-PatchHistory -Entry $historyEntry
    try {
        Stop-AtlasRuntime -Port ([int]$script:TargetManifest.service.port)
        Restore-RollbackFiles
        Start-AtlasRuntime
        Update-RegistryAndState -Manifest ([pscustomobject]@{
            version = $installed.installedVersion
            gitCommit = $installed.gitCommit
            frontendBuildHash = $installed.frontendBuildHash
            backendBuildHash = $installed.backendBuildHash
            databaseSchemaVersion = $installed.databaseSchemaVersion
        }) -Status "RolledBack"
    } catch {
        Write-Warning "Rollback attempt failed: $($_.Exception.Message)"
    }
    throw
}
