param(
    [ValidateSet("Build", "Preflight", "Install", "Repair", "Troubleshoot", "Backup", "UpdateOnlyPrepare", "UpdateOnlyFinalize")]
    [string]$Mode = "Build",

    [int]$Port = 3356,
    [int]$SqlPort = 1433,
    [string]$DbServer = "127.0.0.1",
    [string]$SqlInstance = "ATLAS",
    [string]$SqlSaPassword = "",
    [string]$CompanyCode = "ATLAS",
    [string]$CompanyName = "ATLAS Airfare HCM",
    [string]$AdminUsername = "admin",
    [string]$AdminPassword = "",
    [ValidateSet("Install", "Update", "Repair", "Troubleshoot")]
    [string]$SetupAction = "Install",
    [string]$InstallRoot = "C:\Program Files\ATLAS Airfare Allowance",
    [string]$DataRoot = "C:\ProgramData\ATLAS Airfare Allowance",

    [switch]$UpdateOnly,
    [string]$AppMsi = "C:\Airfare_Allowance\artifacts\fresh-2.3.40\ATLAS-Airfare-Allowance-2.3.40-x64.msi",
    [string]$SqlExpressSetupExe = "C:\Airfare_Allowance\redist\SQLEXPR_x64_ENU.exe",
    [string]$Output = "C:\Airfare_Allowance\artifacts\fresh-2.3.40\ATLAS-Airfare-Allowance-Setup-2.3.40-x64.exe",
    [string]$ProductVersion = "2.3.40",
    [string]$UpdateManifest = "",
    [string]$ConfigPath = ""
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Normalize-AtlasPathArgument {
    param(
        [string]$Value,
        [string]$Fallback
    )
    $cleaned = [string]$Value
    if ([string]::IsNullOrWhiteSpace($cleaned)) { $cleaned = $Fallback }
    $cleaned = $cleaned.Replace("&amp;quot;", "").Replace("&quot;", "").Replace("&#34;", "").Replace('"', '').Trim()
    if ([string]::IsNullOrWhiteSpace($cleaned)) { $cleaned = $Fallback }
    foreach ($invalidChar in [System.IO.Path]::GetInvalidPathChars()) {
        $cleaned = $cleaned.Replace([string]$invalidChar, "")
    }
    return $cleaned.TrimEnd('\', '/')
}

$InstallRoot = Normalize-AtlasPathArgument -Value $InstallRoot -Fallback "C:\Program Files\ATLAS Airfare Allowance"
$DataRoot = Normalize-AtlasPathArgument -Value $DataRoot -Fallback "C:\ProgramData\ATLAS Airfare Allowance"
if (-not [string]::IsNullOrWhiteSpace($ConfigPath)) {
    $ConfigPath = Normalize-AtlasPathArgument -Value $ConfigPath -Fallback ""
}

$script:TranscriptStarted = $false
if ($Mode -ne "Build") {
    try {
        $logDir = Join-Path $DataRoot "logs"
        New-Item -ItemType Directory -Path $logDir -Force | Out-Null
        $logPath = Join-Path $logDir ("bootstrapper-{0}-{1}.log" -f $Mode, (Get-Date -Format "yyyyMMddHHmmss"))
        Start-Transcript -Path $logPath -Append | Out-Null
        $script:TranscriptStarted = $true
        Write-Host "[ATLAS] Detailed bootstrapper log: $logPath"
    } catch {
        Write-Host "[ATLAS] Warning: could not start transcript: $($_.Exception.Message)"
    }
}

function Write-Step {
    param([string]$Message)
    Write-Host "[ATLAS] $Message" -ForegroundColor Cyan
}

function Write-AtlasFailure {
    param(
        [string]$CurrentStep,
        [string]$Message,
        [string]$RemediationSuggestion = "Open the latest bootstrapper log under C:\ProgramData\ATLAS Airfare Allowance\logs and retry after correcting the reported item."
    )
    try {
        Write-InstallDebugEvent `
            -CurrentStep $CurrentStep `
            -Status "FAILED" `
            -Message $Message `
            -ErrorCode "ATLAS_BOOTSTRAPPER_CONFIGURE_FAILED" `
            -RemediationSuggestion $RemediationSuggestion `
            -DataPath $DataRoot
    } catch {}
    Write-Host "[ATLAS] FAILED: $Message" -ForegroundColor Red
}

function Write-InstallDebugEvent {
    param(
        [string]$CurrentStep,
        [string]$Status = "INFO",
        [string]$Message = "",
        [string]$ErrorCode = "",
        [string]$RemediationSuggestion = "",
        [string]$DataPath = $script:DataRoot
    )
    try {
        $logDir = Join-Path $DataPath "logs"
        New-Item -ItemType Directory -Path $logDir -Force | Out-Null
        $debugPath = Join-Path $logDir "install_debug.log"
        [pscustomobject]@{
            timestamp = (Get-Date).ToString("o")
            current_step = $CurrentStep
            status = $Status
            message = $Message
            error_code = $ErrorCode
            remediation_suggestion = $RemediationSuggestion
        } | ConvertTo-Json -Compress | Add-Content -LiteralPath $debugPath -Encoding UTF8
    } catch {
        Write-Host "[ATLAS] Warning: could not write install_debug.log: $($_.Exception.Message)"
    }
}

function Compare-VersionText {
    param([string]$Left, [string]$Right)
    try {
        $leftVersion = [version]$Left
        $rightVersion = [version]$Right
        return $leftVersion.CompareTo($rightVersion)
    } catch {
        return [string]::Compare([string]$Left, [string]$Right, $true)
    }
}

function Test-AtlasUpdateManifest {
    param(
        [string]$Manifest,
        [string]$CurrentVersion,
        [string]$DataPath
    )
    $reportDir = Join-Path $DataPath "logs"
    New-Item -ItemType Directory -Path $reportDir -Force -ErrorAction SilentlyContinue | Out-Null
    $report = Join-Path $reportDir ("update-check-{0}.json" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
    $result = [ordered]@{
        checkedAt = (Get-Date).ToString("o")
        currentVersion = $CurrentVersion
        manifest = $Manifest
        status = "skipped"
        latestVersion = $null
        packageUrl = $null
        message = "No update manifest configured."
    }

    if ([string]::IsNullOrWhiteSpace($Manifest)) {
        $localManifest = Join-Path $DataPath "update-manifest.json"
        if (Test-Path -LiteralPath $localManifest) { $Manifest = $localManifest }
    }

    if (-not [string]::IsNullOrWhiteSpace($Manifest)) {
        try {
            if ($Manifest -match '^https?://') {
                [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
                $manifestJson = Invoke-WebRequest -Uri $Manifest -UseBasicParsing -TimeoutSec 15 | Select-Object -ExpandProperty Content
            } else {
                $manifestJson = Get-Content -LiteralPath $Manifest -Raw
            }
            $manifestObject = $manifestJson | ConvertFrom-Json
            $latestVersion = [string]$manifestObject.latestVersion
            if ([string]::IsNullOrWhiteSpace($latestVersion)) { $latestVersion = [string]$manifestObject.version }
            $packageUrl = [string]$manifestObject.packageUrl
            if ([string]::IsNullOrWhiteSpace($packageUrl)) { $packageUrl = [string]$manifestObject.url }
            $result.status = if ((Compare-VersionText -Left $latestVersion -Right $CurrentVersion) -gt 0) { "update_available" } else { "current" }
            $result.latestVersion = $latestVersion
            $result.packageUrl = $packageUrl
            $result.message = if ($result.status -eq "update_available") { "Update $latestVersion is available." } else { "Current package is up to date." }
        } catch {
            $result.status = "warning"
            $result.message = "Update manifest check failed: $($_.Exception.Message)"
        }
    }

    $result | ConvertTo-Json -Depth 5 | Set-Content -Path $report -Encoding UTF8
    Write-Step "Update manifest check: $($result.message)"
    return [pscustomobject]$result
}

function Invoke-ChecksumDiagnostic {
    param([string]$InstallPath, [string]$DataPath)
    $reportDir = Join-Path $DataPath "logs"
    New-Item -ItemType Directory -Path $reportDir -Force -ErrorAction SilentlyContinue | Out-Null
    $report = Join-Path $reportDir ("checksum-diagnostic-{0}.json" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
    $manifestPath = Join-Path $InstallPath "atlas-payload-manifest.json"
    $manifestRows = @()
    if (Test-Path -LiteralPath $manifestPath) {
        try {
            $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
            $manifestRows = @($manifest.files)
        } catch {
            $manifestRows = @()
        }
    }
    if ($manifestRows.Count -gt 0) {
        $targets = $manifestRows | ForEach-Object {
            [pscustomobject]@{
                path = Join-Path $InstallPath ([string]$_.path)
                expectedSha256 = [string]$_.sha256
                expectedLength = [int64]$_.length
            }
        }
    } else {
        $targets = @(
            "server.js",
            "package.json",
            "package-lock.json",
            ".env",
            "atlas-hcm-next\package.json",
            "database\ATLAS_HCM_SQL_Objects.sql"
        ) | ForEach-Object {
            [pscustomobject]@{ path = Join-Path $InstallPath $_; expectedSha256 = $null; expectedLength = $null }
        }
    }
    $rows = foreach ($targetSpec in $targets) {
        $target = [string]$targetSpec.path
        if (Test-Path -LiteralPath $target) {
            $item = Get-Item -LiteralPath $target
            $hash = Get-FileHash -Algorithm SHA256 -LiteralPath $target
            $matchesHash = if ($targetSpec.expectedSha256) { $hash.Hash -eq $targetSpec.expectedSha256 } else { $null }
            $matchesLength = if ($targetSpec.expectedLength) { $item.Length -eq $targetSpec.expectedLength } else { $null }
            [pscustomobject]@{ path = $target; exists = $true; length = $item.Length; sha256 = $hash.Hash; expectedSha256 = $targetSpec.expectedSha256; expectedLength = $targetSpec.expectedLength; matchesHash = $matchesHash; matchesLength = $matchesLength }
        } else {
            [pscustomobject]@{ path = $target; exists = $false; length = 0; sha256 = $null; expectedSha256 = $targetSpec.expectedSha256; expectedLength = $targetSpec.expectedLength; matchesHash = $false; matchesLength = $false }
        }
    }
    [pscustomobject]@{
        checkedAt = (Get-Date).ToString("o")
        installPath = $InstallPath
        manifestPath = if (Test-Path -LiteralPath $manifestPath) { $manifestPath } else { $null }
        files = @($rows)
    } | ConvertTo-Json -Depth 6 | Set-Content -Path $report -Encoding UTF8
    Write-Step "Checksum diagnostic report: $report"
    return $report
}

function New-AtlasPatchDependencyReport {
    param(
        [string]$InstallPath,
        [string]$DataPath,
        [string]$Version,
        [int]$PortNumber
    )
    $reportDir = Join-Path $DataPath "logs"
    New-Item -ItemType Directory -Path $reportDir -Force -ErrorAction SilentlyContinue | Out-Null
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $jsonPath = Join-Path $reportDir "patch-dependency-map-$stamp.json"
    $mdPath = Join-Path $reportDir "patch-dependency-map-$stamp.md"
    $relationships = @(
        [pscustomobject]@{ element = "ATLAS update EXE"; dependsOn = "WiX Burn chain"; reason = "Runs preflight, MSI file replacement, and finalize verification in order."; verification = "Burn chain exit code and update-finalize log" },
        [pscustomobject]@{ element = "Patched application files"; dependsOn = "ATLAS application MSI"; reason = "MSI owns overwrite/repair semantics for installed payload files."; verification = "atlas-payload-manifest.json SHA256 audit" },
        [pscustomobject]@{ element = "Backend service"; dependsOn = "server.js, package.json, node_modules, runtime node.exe"; reason = "Node process needs the packaged runtime and dependencies to serve APIs on the configured port."; verification = "http://127.0.0.1:$PortNumber/api/health" },
        [pscustomobject]@{ element = "Frontend UI"; dependsOn = "atlas-hcm-next build output and static assets"; reason = "Express serves the built frontend through the existing port and route configuration."; verification = "root page 200 plus static CSS/JS asset checks" },
        [pscustomobject]@{ element = "Database repair"; dependsOn = "existing .env, registry MSSQL settings, database SQL scripts"; reason = "Patch must preserve the installed database connection and apply only repair-safe objects."; verification = "database object repair log and health database=connected" },
        [pscustomobject]@{ element = "Startup task"; dependsOn = "Install-ATLAS-StartupTask.ps1 and preserved install root"; reason = "Patch restarts ATLAS without changing ports or customer data."; verification = "startup task refresh and health endpoint" },
        [pscustomobject]@{ element = "Rollback evidence"; dependsOn = "Backup folder and install_debug.log"; reason = "Support needs exact copied/replaced file evidence if a machine differs."; verification = "Backup path, checksum diagnostic, and payload audit CSV" }
    )
    [pscustomobject]@{
        product = "ATLAS Airfare Allowance"
        patchVersion = $Version
        createdAt = (Get-Date).ToString("o")
        installRoot = $InstallPath
        dataRoot = $DataPath
        port = $PortNumber
        relationships = $relationships
    } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $jsonPath -Encoding UTF8

    $lines = New-Object System.Collections.Generic.List[string]
    $lines.Add("# ATLAS Patch Dependency Map") | Out-Null
    $lines.Add("") | Out-Null
    $lines.Add("- Version: $Version") | Out-Null
    $lines.Add("- Install root: $InstallPath") | Out-Null
    $lines.Add("- Data root: $DataPath") | Out-Null
    $lines.Add("- Port: $PortNumber") | Out-Null
    $lines.Add("- Created: $((Get-Date).ToString("o"))") | Out-Null
    $lines.Add("") | Out-Null
    $lines.Add("| Element | Depends on | Relationship | Verification |") | Out-Null
    $lines.Add("| --- | --- | --- | --- |") | Out-Null
    foreach ($row in $relationships) {
        $lines.Add("| $($row.element) | $($row.dependsOn) | $($row.reason) | $($row.verification) |") | Out-Null
    }
    $lines | Set-Content -LiteralPath $mdPath -Encoding UTF8
    Write-Step "Dependency relationship report created: $mdPath"
    return [pscustomobject]@{ MarkdownPath = $mdPath; JsonPath = $jsonPath; Count = @($relationships).Count }
}

function Invoke-PatchPayloadReplacementAudit {
    param(
        [string]$InstallPath,
        [string]$DataPath,
        [string]$ReportPath
    )
    $reportDir = Join-Path $DataPath "logs"
    New-Item -ItemType Directory -Path $reportDir -Force -ErrorAction SilentlyContinue | Out-Null
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $csvPath = Join-Path $reportDir "patch-file-replacement-audit-$stamp.csv"
    $jsonPath = Join-Path $reportDir "patch-file-replacement-audit-$stamp.json"
    $manifestPath = Join-Path $InstallPath "atlas-payload-manifest.json"
    if (-not (Test-Path -LiteralPath $manifestPath)) {
        "PatchPayloadAudit=Skipped; missing $manifestPath" | Add-Content -LiteralPath $ReportPath
        Write-Step "Patch payload audit skipped because atlas-payload-manifest.json was not found."
        return [pscustomobject]@{ CsvPath = $null; JsonPath = $null; Verified = 0; Missing = 0; Mismatch = 0; Total = 0 }
    }

    Write-Step "Auditing copied/replaced patch files against payload manifest."
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    $rows = foreach ($file in @($manifest.files)) {
        $relativePath = [string]$file.path
        $target = Join-Path $InstallPath $relativePath
        if (Test-Path -LiteralPath $target) {
            $item = Get-Item -LiteralPath $target
            $hash = Get-FileHash -Algorithm SHA256 -LiteralPath $target
            $matchesHash = $hash.Hash -eq [string]$file.sha256
            $matchesLength = $item.Length -eq [int64]$file.length
            $status = if ($matchesHash -and $matchesLength) { "verified_after_copy_or_replace" } else { "hash_or_length_mismatch" }
            [pscustomobject]@{
                action = "copy_replace_verify"
                relativePath = $relativePath
                targetPath = $target
                status = $status
                expectedLength = [int64]$file.length
                actualLength = $item.Length
                expectedSha256 = [string]$file.sha256
                actualSha256 = $hash.Hash
            }
        } else {
            [pscustomobject]@{
                action = "copy_replace_verify"
                relativePath = $relativePath
                targetPath = $target
                status = "missing_after_patch"
                expectedLength = [int64]$file.length
                actualLength = 0
                expectedSha256 = [string]$file.sha256
                actualSha256 = ""
            }
        }
    }
    $rows | Export-Csv -LiteralPath $csvPath -NoTypeInformation -Encoding UTF8
    $verified = @($rows | Where-Object { $_.status -eq "verified_after_copy_or_replace" }).Count
    $missing = @($rows | Where-Object { $_.status -eq "missing_after_patch" }).Count
    $mismatch = @($rows | Where-Object { $_.status -eq "hash_or_length_mismatch" }).Count
    [pscustomobject]@{
        createdAt = (Get-Date).ToString("o")
        installRoot = $InstallPath
        manifestPath = $manifestPath
        csvPath = $csvPath
        total = @($rows).Count
        verified = $verified
        missing = $missing
        mismatch = $mismatch
    } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $jsonPath -Encoding UTF8

    "PatchPayloadAuditCsv=$csvPath" | Add-Content -LiteralPath $ReportPath
    "PatchPayloadAuditJson=$jsonPath" | Add-Content -LiteralPath $ReportPath
    "PatchPayloadFilesTotal=$(@($rows).Count)" | Add-Content -LiteralPath $ReportPath
    "PatchPayloadFilesVerified=$verified" | Add-Content -LiteralPath $ReportPath
    "PatchPayloadFilesMissing=$missing" | Add-Content -LiteralPath $ReportPath
    "PatchPayloadFilesMismatch=$mismatch" | Add-Content -LiteralPath $ReportPath
    Write-Step "Patch file replacement audit: $verified verified, $missing missing, $mismatch mismatched. Details: $csvPath"
    return [pscustomobject]@{ CsvPath = $csvPath; JsonPath = $jsonPath; Verified = $verified; Missing = $missing; Mismatch = $mismatch; Total = @($rows).Count }
}

function Assert-Admin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]$identity
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw "Run this installer or script as Administrator."
    }
}

function Assert-PortAvailable {
    param([int]$PortNumber)
    if ($PortNumber -lt 1 -or $PortNumber -gt 65535) {
        throw "Port must be between 1 and 65535."
    }
    $listeners = @(Get-NetTCPConnection -LocalPort $PortNumber -State Listen -ErrorAction SilentlyContinue)
    if ($listeners.Count -gt 0) {
        $owners = $listeners | Select-Object -ExpandProperty OwningProcess -Unique
        throw "Port $PortNumber is already in use by process id(s): $($owners -join ', '). Choose another port."
    }
}

function Get-BootstrapConfigPath {
    param([string]$DataPath)
    return (Join-Path $DataPath "bootstrapper-config.json")
}

function Read-BootstrapConfig {
    param(
        [string]$DataPath,
        [string]$Path = ""
    )
    $path = if (-not [string]::IsNullOrWhiteSpace($Path)) { Normalize-AtlasPathArgument -Value $Path -Fallback "" } else { Get-BootstrapConfigPath -DataPath $DataPath }
    if (-not (Test-Path -LiteralPath $path)) { return $null }
    try {
        return (Get-Content -LiteralPath $path -Raw | ConvertFrom-Json)
    } catch {
        return $null
    }
}

function Read-RequiredBootstrapConfig {
    param(
        [string]$DataPath,
        [string]$Path = "",
        [string]$Context = "ATLAS setup"
    )
    $resolvedPath = if (-not [string]::IsNullOrWhiteSpace($Path)) { Normalize-AtlasPathArgument -Value $Path -Fallback "" } else { Get-BootstrapConfigPath -DataPath $DataPath }
    $config = Read-BootstrapConfig -DataPath $DataPath -Path $resolvedPath
    if (-not $config) {
        throw "$Context could not read bootstrapper configuration at '$resolvedPath'. Re-run setup and complete the pre-installation check. The installer will not continue with default SQL settings."
    }
    return $config
}

function Write-BootstrapConfig {
    param(
        [string]$DataPath,
        [int]$PortNumber,
        [int]$SqlPortNumber,
        [string]$DbServerName,
        [string]$InstanceName,
        [string]$Password,
        [string]$CompanyCodeValue,
        [string]$CompanyNameValue,
        [string]$AdminUsernameValue,
        [string]$AdminPasswordValue,
        [string]$SetupActionValue
    )
    New-Item -ItemType Directory -Path $DataPath -Force | Out-Null
    $path = Get-BootstrapConfigPath -DataPath $DataPath
    [pscustomobject]@{
        Port = $PortNumber
        SqlPort = $SqlPortNumber
        DbServer = $DbServerName
        SqlInstance = $InstanceName
        SqlSaPassword = $Password
        CompanyCode = $CompanyCodeValue
        CompanyName = $CompanyNameValue
        AdminUsername = $AdminUsernameValue
        AdminPassword = $AdminPasswordValue
        SetupAction = $SetupActionValue
        CreatedAt = (Get-Date).ToString("o")
    } | ConvertTo-Json | Set-Content -Path $path -Encoding UTF8
    try {
        $acl = Get-Acl -LiteralPath $path
        $acl.SetAccessRuleProtection($true, $false)
        foreach ($rule in @($acl.Access)) { [void]$acl.RemoveAccessRule($rule) }
        foreach ($identity in @("BUILTIN\Administrators", "NT AUTHORITY\SYSTEM")) {
            $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($identity, "FullControl", "Allow")
            $acl.AddAccessRule($rule)
        }
        Set-Acl -LiteralPath $path -AclObject $acl
    } catch {
        Write-Step "Warning: could not restrict bootstrap config ACL: $($_.Exception.Message)"
    }
}

function Remove-BootstrapConfig {
    param([string]$DataPath)
    $path = Get-BootstrapConfigPath -DataPath $DataPath
    Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
}

function Get-UpdatePreservedConfigPath {
    param([string]$DataPath)
    return (Join-Path $DataPath "update-preserved-config.json")
}

function Save-UpdatePreservedConfig {
    param(
        [string]$InstallPath,
        [string]$DataPath
    )
    $settings = Read-AtlasEnvConfig -InstallPath $InstallPath
    $saved = Read-BootstrapConfig -DataPath $DataPath
    $registryDefaults = @{
        DB_SERVER = Get-AtlasRegistryValue -Name "DB_SERVER"
        DB_PORT = Get-AtlasRegistryValue -Name "DB_PORT"
        DB_NAME = Get-AtlasRegistryValue -Name "DB_NAME"
        DB_USER = Get-AtlasRegistryValue -Name "DB_USER"
        DB_PASSWORD = Get-AtlasRegistryValue -Name "DB_PASSWORD"
        DB_ODBC_DRIVER = Get-AtlasRegistryValue -Name "DB_ODBC_DRIVER"
        DB_AUTO_SETUP = Get-AtlasRegistryValue -Name "DB_AUTO_SETUP"
    }
    $changed = $false

    if ($saved) {
        if ($saved.Port) {
            $settings["PORT"] = [string][int]$saved.Port
            $script:Port = [int]$saved.Port
            $changed = $true
        }
        if ($saved.SqlPort -and [int]$saved.SqlPort -gt 0) {
            $settings["DB_PORT"] = [string][int]$saved.SqlPort
            $changed = $true
        }
        if ($saved.SqlSaPassword) {
            $settings["DB_PASSWORD"] = [string]$saved.SqlSaPassword
            $changed = $true
        }
    }

    foreach ($entry in $registryDefaults.GetEnumerator()) {
        if (-not [string]::IsNullOrWhiteSpace([string]$entry.Value) -and (-not $settings.Contains($entry.Key) -or [string]::IsNullOrWhiteSpace([string]$settings[$entry.Key]))) {
            $settings[$entry.Key] = [string]$entry.Value
            $changed = $true
        }
    }

    if (-not $settings.Contains("PORT")) { $settings["PORT"] = [string]$Port; $changed = $true }
    if (-not $settings.Contains("DB_SERVER") -or [string]::IsNullOrWhiteSpace([string]$settings["DB_SERVER"])) { $settings["DB_SERVER"] = "127.0.0.1"; $changed = $true }
    if (-not $settings.Contains("DB_PORT") -or [string]::IsNullOrWhiteSpace([string]$settings["DB_PORT"])) { $settings["DB_PORT"] = "1433"; $changed = $true }
    if (-not $settings.Contains("DB_NAME") -or [string]::IsNullOrWhiteSpace([string]$settings["DB_NAME"])) { $settings["DB_NAME"] = "Atlasairfare3356"; $changed = $true }
    if (-not $settings.Contains("DB_USER") -or [string]::IsNullOrWhiteSpace([string]$settings["DB_USER"])) { $settings["DB_USER"] = "sa"; $changed = $true }

    if ($changed) {
        Write-AtlasEnvConfig -InstallPath $InstallPath -Settings $settings
    }

    New-Item -ItemType Directory -Path $DataPath -Force | Out-Null
    $preservePath = Get-UpdatePreservedConfigPath -DataPath $DataPath
    [pscustomobject]@{
        preservedAt = (Get-Date).ToString("o")
        installPath = $InstallPath
        appPort = [string]$settings["PORT"]
        dbServer = [string]$settings["DB_SERVER"]
        dbPort = [string]$settings["DB_PORT"]
        dbName = [string]$settings["DB_NAME"]
        dbUser = [string]$settings["DB_USER"]
        dbPassword = if ($settings.Contains("DB_PASSWORD")) { [string]$settings["DB_PASSWORD"] } else { "" }
        settings = $settings
    } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $preservePath -Encoding UTF8

    Write-Step "Update patch preserved ATLAS ports and MSSQL settings: app port $($settings["PORT"]), SQL $($settings["DB_SERVER"]):$($settings["DB_PORT"])."
    return $preservePath
}

function Restore-UpdatePreservedConfig {
    param(
        [string]$InstallPath,
        [string]$DataPath
    )
    $preservePath = Get-UpdatePreservedConfigPath -DataPath $DataPath
    if (-not (Test-Path -LiteralPath $preservePath)) {
        Write-Step "No preserved update config was found. Existing .env will be used."
        return
    }
    $preserved = Get-Content -LiteralPath $preservePath -Raw | ConvertFrom-Json
    $settings = [ordered]@{}
    foreach ($property in $preserved.settings.PSObject.Properties) {
        $settings[$property.Name] = [string]$property.Value
    }
    if ($settings.Count -eq 0) { return }
    Write-AtlasEnvConfig -InstallPath $InstallPath -Settings $settings
    Set-AtlasRegistryValue -Name "ATLASPORT" -Value ([string]$settings["PORT"])
    Set-AtlasRegistryValue -Name "DB_SERVER" -Value ([string]$settings["DB_SERVER"])
    Set-AtlasRegistryValue -Name "DB_PORT" -Value ([string]$settings["DB_PORT"])
    Set-AtlasRegistryValue -Name "DB_NAME" -Value ([string]$settings["DB_NAME"])
    Set-AtlasRegistryValue -Name "DB_USER" -Value ([string]$settings["DB_USER"])
    if ($settings.Contains("DB_PASSWORD")) { Set-AtlasRegistryValue -Name "DB_PASSWORD" -Value ([string]$settings["DB_PASSWORD"]) }
    Write-Step "Update patch restored preserved MSSQL configuration before database repair: $($settings["DB_SERVER"]):$($settings["DB_PORT"])."
}

function Convert-SecureStringToPlain {
    param([Security.SecureString]$Secure)
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
}

function Get-AtlasHostInfo {
    $hostName = $env:COMPUTERNAME
    if (-not $hostName) { $hostName = [System.Net.Dns]::GetHostName() }
    if (-not $hostName) { $hostName = "localhost" }
    [pscustomobject]@{
        HostName = $hostName
        Loopback = "127.0.0.1"
    }
}

function New-Backup {
    param(
        [string]$InstallPath,
        [string]$DataPath
    )
    $stamp = Get-Date -Format "yyyyMMdd_HHmmss"
    $backupRoot = Join-Path $DataPath "Backup_$stamp"
    New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null

    $items = @(
        (Join-Path $InstallPath ".env"),
        (Join-Path $InstallPath ".env.local"),
        (Join-Path $InstallPath "logs"),
        (Join-Path $InstallPath "backups"),
        (Join-Path $DataPath "*.mdf"),
        (Join-Path $DataPath "*.ldf"),
        (Join-Path $DataPath "*.json"),
        (Join-Path $DataPath "*.config")
    )

    foreach ($item in $items) {
        foreach ($path in (Get-ChildItem -Path $item -Force -ErrorAction SilentlyContinue)) {
            $target = Join-Path $backupRoot $path.Name
            if ($path.PSIsContainer) {
                Copy-Item -LiteralPath $path.FullName -Destination $target -Recurse -Force
            } else {
                Copy-Item -LiteralPath $path.FullName -Destination $target -Force
            }
        }
    }
    Write-Step "Backup complete: $backupRoot"
    return $backupRoot
}

function Get-BootstrapConfigBool {
    param(
        $Config,
        [string]$Name
    )
    if (-not $Config) { return $false }
    $prop = $Config.PSObject.Properties[$Name]
    if (-not $prop) { return $false }
    $raw = [string]$prop.Value
    return ($raw -match "^(?i:true|1|yes)$")
}

function Test-AtlasInstallFootprint {
    param([string]$InstallPath)
    if (-not (Test-Path -LiteralPath $InstallPath)) { return $false }
    foreach ($relative in @(".env", "server.js", "package.json", "Start-ATLAS.bat", "Start-ATLAS-Bundled.ps1", "atlas-payload-manifest.json")) {
        if (Test-Path -LiteralPath (Join-Path $InstallPath $relative)) { return $true }
    }
    return $false
}

function Test-AtlasExistingInstallEvidence {
    param([string]$InstallPath)
    if (Test-AtlasInstallFootprint -InstallPath $InstallPath) { return $true }
    if (Test-Path "HKLM:\SOFTWARE\ATLAS Airfare Allowance") { return $true }
    if (Test-Path "HKLM:\SOFTWARE\WOW6432Node\ATLAS Airfare Allowance") { return $true }
    return $false
}

function Remove-AtlasInstallFootprint {
    param([string]$InstallPath)
    $resolved = [System.IO.Path]::GetFullPath($InstallPath)
    if ([string]::IsNullOrWhiteSpace($resolved) -or (Split-Path -Leaf $resolved) -ne "ATLAS Airfare Allowance") {
        throw "Refusing to remove unexpected install path '$InstallPath'."
    }
    if (Test-Path -LiteralPath $resolved) {
        Remove-Item -LiteralPath $resolved -Recurse -Force
        Write-Step "Existing ATLAS application files removed for fresh install: $resolved"
    }
}

function Backup-AtlasDatabaseIfPresent {
    param(
        [int]$SqlPortNumber,
        [string]$Password,
        [string]$DataPath,
        [string]$DatabaseName = "Atlasairfare3356"
    )
    $backupDir = Join-Path $DataPath "db-backups"
    New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
    $safeNameForFile = ($DatabaseName -replace '[^A-Za-z0-9_.-]', '_')
    $backupPath = Join-Path $backupDir ("{0}_copyonly_{1}.bak" -f $safeNameForFile, (Get-Date -Format "yyyyMMdd_HHmmss"))
    $safeBackupPath = Escape-SqlLiteral -Value $backupPath
    $safeDatabaseName = Escape-SqlLiteral -Value $DatabaseName
    $quotedDatabaseName = "[" + ($DatabaseName -replace "]", "]]") + "]"
    $connectionString = "Server=tcp:127.0.0.1,$SqlPortNumber;Database=master;User ID=sa;Password=$Password;Encrypt=False;TrustServerCertificate=True;Connection Timeout=15;"
    $exists = [int](Invoke-SqlScalar -ConnectionString $connectionString -SqlText "SELECT CASE WHEN DB_ID(N'$safeDatabaseName') IS NULL THEN 0 ELSE 1 END;")
    if ($exists -ne 1) {
        Write-Step "Database $DatabaseName was not found; database backup skipped."
        return $null
    }
    Invoke-SqlBatch -ConnectionString $connectionString -SqlText "BACKUP DATABASE $quotedDatabaseName TO DISK = N'$safeBackupPath' WITH COPY_ONLY, INIT;"
    Write-Step "Database backup created: $backupPath"
    return $backupPath
}

function Ensure-DataDirectories {
    param([string]$InstallPath, [string]$DataPath)
    foreach ($folder in @($InstallPath, $DataPath, (Join-Path $DataPath "logs"), (Join-Path $DataPath "database"), (Join-Path $DataPath "backups"))) {
        New-Item -ItemType Directory -Path $folder -Force | Out-Null
    }
}

function Stop-PreviousAtlasRuntime {
    param(
        [string]$InstallPath,
        [int]$PortNumber = 0
    )
    Write-Step "Checking previous ATLAS runtime and startup task."
    $taskName = "ATLAS Airfare Allowance"
    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($task) {
        try { Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue } catch {}
        try { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue } catch {}
        Write-Step "Previous ATLAS startup task removed."
    }

    $normalizedInstall = $InstallPath.TrimEnd("\")
    $nodeProcesses = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -and $_.CommandLine -like "*$normalizedInstall*" }
    foreach ($process in $nodeProcesses) {
        try {
            Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
            Write-Step "Stopped previous ATLAS node process $($process.ProcessId)."
        } catch {}
    }
    if ($PortNumber -gt 0) {
        Stop-AtlasPortOwner -PortNumber $PortNumber -InstallPath $InstallPath
    }
}

function Stop-AtlasPortOwner {
    param(
        [int]$PortNumber,
        [string]$InstallPath
    )
    $normalizedInstall = ([string]$InstallPath).TrimEnd("\")
    $listeners = @(Get-NetTCPConnection -LocalPort $PortNumber -State Listen -ErrorAction SilentlyContinue)
    foreach ($listener in $listeners) {
        $pid = [int]$listener.OwningProcess
        if ($pid -le 0 -or $pid -eq $PID) { continue }
        $process = Get-CimInstance Win32_Process -Filter "ProcessId = $pid" -ErrorAction SilentlyContinue
        $commandLine = [string]$process.CommandLine
        $processName = [string]$process.Name
        $looksLikeAtlas = $commandLine -like "*$normalizedInstall*" -or $commandLine -match "(^|\\s)server\.js(\\s|$)" -or $processName -ieq "node.exe"
        if (-not $looksLikeAtlas) {
            throw "Port $PortNumber is already in use by process $pid ($processName), but it does not look like ATLAS. Stop that process or choose another ATLAS port."
        }
        Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
        Write-Step "Stopped ATLAS process $pid holding port $PortNumber."
    }
}

function Get-SqlServiceName {
    param([string]$InstanceName)
    if ($InstanceName -eq "MSSQLSERVER") { return "MSSQLSERVER" }
    return "MSSQL`$$InstanceName"
}

function Get-InstalledSqlInstances {
    $instances = @()
    foreach ($path in @(
        "HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\Instance Names\SQL",
        "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Microsoft SQL Server\Instance Names\SQL"
    )) {
        if (Test-Path $path) {
            $props = Get-ItemProperty -Path $path
            $instances += $props.PSObject.Properties |
                Where-Object { $_.Name -notmatch "^PS" } |
                ForEach-Object { $_.Name }
        }
    }

    $services = Get-Service -Name "MSSQL*" -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -eq "MSSQLSERVER" -or $_.Name -like "MSSQL`$*" } |
        ForEach-Object {
            if ($_.Name -eq "MSSQLSERVER") { "MSSQLSERVER" } else { $_.Name.Substring(6) }
        }

    return @($instances + $services | Where-Object { $_ } | Sort-Object -Unique)
}

function Resolve-SqlInstance {
    param([string]$RequestedInstance)
    $instances = @(Get-InstalledSqlInstances)
    if ($instances.Count -eq 0) {
        return $RequestedInstance
    }
    if ($instances -contains $RequestedInstance) {
        Write-Step "Using requested SQL Server instance '$RequestedInstance'."
        return $RequestedInstance
    }
    if ($instances -contains "MSSQLSERVER") {
        Write-Step "SQL Server is already installed. Using default instance MSSQLSERVER."
        return "MSSQLSERVER"
    }
    if ($instances -contains "SQLEXPRESS") {
        Write-Step "SQL Server is already installed. Using instance SQLEXPRESS."
        return "SQLEXPRESS"
    }
    $selected = $instances[0]
    Write-Step "SQL Server is already installed. Using instance '$selected'."
    return $selected
}

function Get-SqlServerName {
    param([string]$InstanceName)
    if ($InstanceName -eq "MSSQLSERVER") { return "localhost" }
    return "localhost\$InstanceName"
}

function Test-SqlLogin {
    param(
        [string]$InstanceName,
        [string]$Password
    )
    $server = Get-SqlServerName -InstanceName $InstanceName
    $connectionString = "Server=$server;Database=master;User ID=sa;Password=$Password;Encrypt=False;TrustServerCertificate=True;Connection Timeout=10;"
    $connection = New-Object System.Data.SqlClient.SqlConnection($connectionString)
    try {
        $connection.Open()
        $command = $connection.CreateCommand()
        $command.CommandText = "SELECT @@SERVERNAME"
        [void]$command.ExecuteScalar()
        return $true
    } catch {
        Write-Step "SQL login failed for '$server' as sa: $($_.Exception.Message)"
        return $false
    } finally {
        $connection.Dispose()
    }
}

function Test-TcpPort {
    param([string]$Server, [int]$PortNumber, [int]$TimeoutMs = 5000)
    try {
        $client = New-Object Net.Sockets.TcpClient
        $async = $client.BeginConnect($Server, $PortNumber, $null, $null)
        $ready = $async.AsyncWaitHandle.WaitOne($TimeoutMs, $false)
        if ($ready) { $client.EndConnect($async) }
        $client.Close()
        return $ready
    } catch {
        return $false
    }
}

function Test-SqlLoginTcp {
    param(
        [string]$Server = "127.0.0.1",
        [int]$PortNumber,
        [string]$Password
    )
    $hostName = Get-AtlasSqlTcpHost -Server $Server
    $connectionString = "Server=tcp:$hostName,$PortNumber;Database=master;User ID=sa;Password=$Password;Encrypt=False;TrustServerCertificate=True;Connection Timeout=10;"
    $connection = New-Object System.Data.SqlClient.SqlConnection($connectionString)
    try {
        $connection.Open()
        $command = $connection.CreateCommand()
        $command.CommandText = "SELECT @@SERVERNAME"
        [void]$command.ExecuteScalar()
        return $true
    } catch {
        Write-Step "SQL TCP login failed on ${hostName}:$PortNumber as sa: $($_.Exception.Message)"
        return $false
    } finally {
        $connection.Dispose()
    }
}

function Test-StrongSqlPassword {
    param([string]$Password)
    return ($Password.Length -ge 8 -and
        $Password -match "[A-Z]" -and
        $Password -match "[a-z]" -and
        $Password -match "\d" -and
        $Password -match "[^a-zA-Z0-9]")
}

function Get-SqlExpressPayload {
    $candidates = @()
    $searchRoots = @(
        $PSScriptRoot,
        (Join-Path $DataRoot "downloads"),
        (Split-Path -Parent $SqlExpressSetupExe)
    ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Sort-Object -Unique

    foreach ($root in $searchRoots) {
        if (Test-Path -LiteralPath $root) {
            $candidates += Get-ChildItem -Path $root -Recurse -File -Filter "SQLEXPR*.exe" -ErrorAction SilentlyContinue
        }
    }

    return @($candidates |
        Sort-Object Length -Descending
        Select-Object -First 1)[0]
}

function Install-SqlExpressIfMissing {
    param(
        [string]$InstanceName,
        [string]$Password
    )
    if (@(Get-InstalledSqlInstances).Count -gt 0) {
        Write-Step "Existing SQL Server instance detected. SQL Express install skipped."
        return
    }

    $payload = Get-SqlExpressPayload
    if (-not $payload) {
        $downloadDestination = Join-Path (Join-Path $DataRoot "downloads") "SQLEXPR_x64_ENU.exe"
        Write-Step "SQL Express setup file was not found locally. Downloading from Microsoft."
        Save-SqlExpressRedistributable -Destination $downloadDestination
        $payload = Get-SqlExpressPayload
    }
    if (-not $payload) {
        throw "SQL Express setup file was not found and online retrieval failed. Download SQL Server Express from https://www.microsoft.com/sql-server/sql-server-downloads and re-run setup."
    }

    Write-Step "No local SQL Server detected. Installing SQL Express instance '$InstanceName'."
    $arguments = @(
        "/Q",
        "/ACTION=Install",
        "/FEATURES=SQLENGINE",
        "/INSTANCENAME=$InstanceName",
        "/SECURITYMODE=SQL",
        "/SAPWD=`"$Password`"",
        "/SQLSYSADMINACCOUNTS=`"BUILTIN\Administrators`"",
        "/TCPENABLED=1",
        "/IACCEPTSQLSERVERLICENSETERMS"
    )
    $process = Start-Process -FilePath $payload.FullName -ArgumentList $arguments -Wait -PassThru
    if ($process.ExitCode -ne 0 -and $process.ExitCode -ne 3010) {
        throw "SQL Express install failed with exit code $($process.ExitCode)."
    }
}

function Get-SqlInstanceRegistryId {
    param([string]$InstanceName)
    foreach ($path in @(
        "HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\Instance Names\SQL",
        "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Microsoft SQL Server\Instance Names\SQL"
    )) {
        if (Test-Path $path) {
            $value = (Get-ItemProperty -Path $path -Name $InstanceName -ErrorAction SilentlyContinue).$InstanceName
            if ($value) { return [string]$value }
        }
    }
    return $null
}

function Enable-SqlTcpPort {
    param(
        [string]$InstanceName,
        [int]$PortNumber
    )
    $serviceName = Get-SqlServiceName -InstanceName $InstanceName
    $service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
    if (-not $service) {
        Write-Step "SQL service '$serviceName' not found; cannot force TCP port."
        return
    }

    $instanceId = Get-SqlInstanceRegistryId -InstanceName $InstanceName
    if (-not $instanceId) {
        Write-Step "SQL registry instance id was not found for '$InstanceName'; cannot force TCP port."
        return
    }

    $tcpRoots = @(
        "HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\$instanceId\MSSQLServer\SuperSocketNetLib\Tcp",
        "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Microsoft SQL Server\$instanceId\MSSQLServer\SuperSocketNetLib\Tcp"
    )

    $changed = $false
    foreach ($tcpRoot in $tcpRoots) {
        if (-not (Test-Path $tcpRoot)) { continue }
        Set-ItemProperty -Path $tcpRoot -Name "Enabled" -Value 1 -ErrorAction SilentlyContinue
        $ipAll = Join-Path $tcpRoot "IPAll"
        if (Test-Path $ipAll) {
            Set-ItemProperty -Path $ipAll -Name "TcpDynamicPorts" -Value "" -ErrorAction SilentlyContinue
            Set-ItemProperty -Path $ipAll -Name "TcpPort" -Value ([string]$PortNumber) -ErrorAction SilentlyContinue
            $changed = $true
        }
    }

    if ($changed) {
        Write-Step "SQL TCP/IP configured for instance '$InstanceName' on port $PortNumber. Restarting SQL service."
        Restart-Service -Name $serviceName -Force -ErrorAction Stop
        (Get-Service -Name $serviceName).WaitForStatus("Running", "00:01:00")
        Start-Sleep -Seconds 5
    } else {
        Write-Step "SQL TCP/IP registry path was not found for instance '$InstanceName'."
    }
}

function Get-SqlConfiguredTcpPort {
    param([string]$InstanceName)
    $instanceId = Get-SqlInstanceRegistryId -InstanceName $InstanceName
    if (-not $instanceId) { return 0 }

    foreach ($tcpRoot in @(
        "HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\$instanceId\MSSQLServer\SuperSocketNetLib\Tcp",
        "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Microsoft SQL Server\$instanceId\MSSQLServer\SuperSocketNetLib\Tcp"
    )) {
        $ipAll = Join-Path $tcpRoot "IPAll"
        if (-not (Test-Path $ipAll)) { continue }
        $props = Get-ItemProperty -Path $ipAll -ErrorAction SilentlyContinue
        foreach ($name in @("TcpPort", "TcpDynamicPorts")) {
            $raw = [string]$props.$name
            $portValue = 0
            if (-not [string]::IsNullOrWhiteSpace($raw) -and [int]::TryParse($raw.Trim(), [ref]$portValue) -and $portValue -gt 0) {
                return $portValue
            }
        }
    }
    return 0
}

function Resolve-SqlTcpPort {
    param(
        [string]$InstanceName,
        [int]$RequestedPort
    )

    if ($RequestedPort -gt 0) {
        if (Test-TcpPort -Server "127.0.0.1" -PortNumber $RequestedPort) {
            Write-Step "Using requested reachable SQL TCP port $RequestedPort for instance '$InstanceName'."
            return $RequestedPort
        }
        $configured = Get-SqlConfiguredTcpPort -InstanceName $InstanceName
        if ($configured -gt 0 -and $configured -ne $RequestedPort -and (Test-TcpPort -Server "127.0.0.1" -PortNumber $configured)) {
            Write-Step "Requested SQL TCP port $RequestedPort was not reachable. Using detected current SQL port $configured for instance '$InstanceName'."
            return $configured
        }
        Enable-SqlTcpPort -InstanceName $InstanceName -PortNumber $RequestedPort
        return $RequestedPort
    }

    $configured = Get-SqlConfiguredTcpPort -InstanceName $InstanceName
    if ($configured -gt 0) {
        Write-Step "Using SQL Server configured/default TCP port $configured for instance '$InstanceName'."
        return $configured
    }

    Write-Step "SQL Server configured/default TCP port was not detected. Falling back to static port 1433."
    Enable-SqlTcpPort -InstanceName $InstanceName -PortNumber 1433
    return 1433
}

function Prompt-AtlasInstallSettings {
    Assert-Admin
    Ensure-DataDirectories -InstallPath $InstallRoot -DataPath $DataRoot

    Write-Host ""
    Write-Host "ATLAS setup configuration" -ForegroundColor Cyan
    Write-Host ""

    $existingInstallEvidence = Test-AtlasExistingInstallEvidence -InstallPath $InstallRoot
    $selectedSetupAction = if ($existingInstallEvidence -and $SetupAction -eq "Install") { "Update" } else { $SetupAction }
    Write-Host "Choose setup action:" -ForegroundColor Cyan
    Write-Host "  1. Install / New"
    Write-Host "  2. Update existing"
    Write-Host "  3. Repair existing"
    Write-Host "  4. Troubleshoot only"
    $defaultActionNumber = if ($existingInstallEvidence) { "2" } else { "1" }
    if ($existingInstallEvidence) {
        Write-Host "Existing ATLAS installation evidence was detected. Update is the default action." -ForegroundColor Green
    }
    $rawAction = Read-Host "Setup action [$defaultActionNumber]"
    if ([string]::IsNullOrWhiteSpace($rawAction)) { $rawAction = $defaultActionNumber }
    switch ($rawAction) {
        "2" { $selectedSetupAction = "Update" }
        "3" { $selectedSetupAction = "Repair" }
        "4" { $selectedSetupAction = "Troubleshoot" }
        default { $selectedSetupAction = "Install" }
    }

    $selectedPort = $Port
    while ($true) {
        $rawPort = Read-Host "ATLAS application port [$selectedPort]"
        if (-not [string]::IsNullOrWhiteSpace($rawPort)) {
            if (-not [int]::TryParse($rawPort, [ref]$selectedPort)) {
                Write-Host "Enter a valid TCP port number." -ForegroundColor Yellow
                continue
            }
        }
        if ($selectedSetupAction -eq "Install") {
            try {
                Assert-PortAvailable -PortNumber $selectedPort
                Write-Host "Port $selectedPort is available." -ForegroundColor Green
                break
            } catch {
                Write-Host "$($_.Exception.Message) For an existing ATLAS installation, choose Update or Repair." -ForegroundColor Yellow
            }
        } else {
            Write-Host "Port $selectedPort will be reused for $selectedSetupAction." -ForegroundColor Green
            break
        }
    }

    $selectedSqlPort = 1433
    $selectedDbServer = if ([string]::IsNullOrWhiteSpace($DbServer)) { "127.0.0.1" } else { $DbServer }
    $rawDbServer = Read-Host "MSSQL server / host [$selectedDbServer]"
    if (-not [string]::IsNullOrWhiteSpace($rawDbServer)) { $selectedDbServer = $rawDbServer.Trim() }

    while ($true) {
        $rawSqlPort = Read-Host "MSSQL TCP port [$selectedSqlPort, enter 0 for SQL Server default/current port]"
        if (-not [string]::IsNullOrWhiteSpace($rawSqlPort)) {
            if (-not [int]::TryParse($rawSqlPort, [ref]$selectedSqlPort) -or $selectedSqlPort -lt 0 -or $selectedSqlPort -gt 65535) {
                Write-Host "Enter 0 for SQL Server default/current port, or a TCP port number from 1 to 65535." -ForegroundColor Yellow
                continue
            }
        }
        if ($selectedSqlPort -ne 0 -and $selectedSqlPort -eq $selectedPort) {
            Write-Host "MSSQL TCP port must be different from the ATLAS application port." -ForegroundColor Yellow
            continue
        }
        break
    }

    $instances = @(Get-InstalledSqlInstances)
    if ($instances.Count -gt 0) {
        Write-Step "Existing SQL Server detected: $($instances -join ', '). SQL Express install will be skipped."
    } else {
        Write-Step "No local SQL Server detected. Bundled SQL Express will be installed."
    }

    $selectedInstance = Resolve-SqlInstance -RequestedInstance $SqlInstance
    if ($instances.Count -gt 0) {
        $rawInstance = Read-Host "MSSQL instance to use [$selectedInstance]"
        if (-not [string]::IsNullOrWhiteSpace($rawInstance)) { $selectedInstance = $rawInstance.Trim() }
        if (Test-AtlasLocalSqlHost -Server $selectedDbServer) {
            Ensure-SqlService -InstanceName $selectedInstance
        } else {
            Write-Step "Remote MSSQL server selected; skipping local SQL service control for '$selectedDbServer'."
        }
    }

    while ($true) {
        $securePassword = Read-Host "MSSQL sa password" -AsSecureString
        $plainPassword = Convert-SecureStringToPlain -Secure $securePassword
        if (-not $plainPassword) {
            Write-Host "Password cannot be empty." -ForegroundColor Yellow
            continue
        }
        if ($instances.Count -eq 0 -and -not (Test-StrongSqlPassword -Password $plainPassword)) {
            Write-Host "For new SQL Express install, use at least 8 chars with upper, lower, number, and symbol." -ForegroundColor Yellow
            continue
        }
        if ($instances.Count -gt 0) {
            if (-not (Test-SqlLogin -InstanceName $selectedInstance -Password $plainPassword)) {
                Write-Host "Please enter the correct sa password for the selected SQL instance." -ForegroundColor Yellow
                continue
            }
            Write-Host "MSSQL login confirmed for $(Get-SqlServerName -InstanceName $selectedInstance)." -ForegroundColor Green
        } else {
            Write-Host "MSSQL password accepted for new SQL Express instance '$selectedInstance'." -ForegroundColor Green
        }
        break
    }

    $selectedCompanyCode = $CompanyCode
    $rawCompanyCode = Read-Host "Company code [$selectedCompanyCode]"
    if (-not [string]::IsNullOrWhiteSpace($rawCompanyCode)) { $selectedCompanyCode = $rawCompanyCode.Trim() }
    if ([string]::IsNullOrWhiteSpace($selectedCompanyCode)) { throw "Company code cannot be empty." }

    $selectedCompanyName = $CompanyName
    $rawCompanyName = Read-Host "Company name [$selectedCompanyName]"
    if (-not [string]::IsNullOrWhiteSpace($rawCompanyName)) { $selectedCompanyName = $rawCompanyName.Trim() }
    if ([string]::IsNullOrWhiteSpace($selectedCompanyName)) { throw "Company name cannot be empty." }

    $selectedAdminUsername = $AdminUsername
    $rawAdminUsername = Read-Host "Application admin login [$selectedAdminUsername]"
    if (-not [string]::IsNullOrWhiteSpace($rawAdminUsername)) { $selectedAdminUsername = $rawAdminUsername.Trim() }
    if ([string]::IsNullOrWhiteSpace($selectedAdminUsername)) { throw "Application admin login cannot be empty." }

    while ($true) {
        $secureAdminPassword = Read-Host "Application admin password" -AsSecureString
        $plainAdminPassword = Convert-SecureStringToPlain -Secure $secureAdminPassword
        if (-not $plainAdminPassword) {
            Write-Host "Application admin password cannot be empty." -ForegroundColor Yellow
            continue
        }
        if ($plainAdminPassword.Length -lt 8) {
            Write-Host "Use at least 8 characters for the application admin password." -ForegroundColor Yellow
            continue
        }
        break
    }

    Write-BootstrapConfig `
        -DataPath $DataRoot `
        -PortNumber $selectedPort `
        -SqlPortNumber $selectedSqlPort `
        -DbServerName $selectedDbServer `
        -InstanceName $selectedInstance `
        -Password $plainPassword `
        -CompanyCodeValue $selectedCompanyCode `
        -CompanyNameValue $selectedCompanyName `
        -AdminUsernameValue $selectedAdminUsername `
        -AdminPasswordValue $plainAdminPassword `
        -SetupActionValue $selectedSetupAction
    Write-Step "Configuration confirmed. Setup will continue."
}

function Ensure-SqlService {
    param([string]$InstanceName)
    $serviceName = Get-SqlServiceName -InstanceName $InstanceName
    $service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
    if (-not $service) {
        Write-Step "SQL service '$serviceName' not found. LocalDB may be used instead."
        return
    }
    if ($service.Status -ne "Running") {
        Write-Step "Starting SQL service '$serviceName'."
        Start-Service -Name $serviceName
        $service.WaitForStatus("Running", "00:00:30")
    }
}

function Test-SqlLocalDb {
    $exe = Join-Path ${env:ProgramFiles} "Microsoft SQL Server\160\Tools\Binn\SqlLocalDB.exe"
    if (-not (Test-Path $exe)) {
        $exe = Join-Path ${env:ProgramFiles} "Microsoft SQL Server\150\Tools\Binn\SqlLocalDB.exe"
    }
    if (-not (Test-Path $exe)) { return $false }
    & $exe info | Out-Null
    return ($LASTEXITCODE -eq 0)
}

function Invoke-SqlBatch {
    param(
        [string]$ConnectionString,
        [string]$SqlText,
        [string]$StepName = "SQL batch"
    )
    $connection = New-Object System.Data.SqlClient.SqlConnection($ConnectionString)
    try {
        $connection.Open()
        $batches = [regex]::Split($SqlText, "(?im)^\s*GO\s*(?:--.*)?$")
        $batchNumber = 0
        foreach ($batch in $batches) {
            if (-not $batch.Trim()) { continue }
            $batchNumber++
            Write-Step "$StepName batch $batchNumber started."
            $command = $connection.CreateCommand()
            $command.CommandTimeout = 180
            $command.CommandText = $batch
            [void]$command.ExecuteNonQuery()
            Write-Step "$StepName batch $batchNumber completed."
        }
    } finally {
        $connection.Dispose()
    }
}

function Invoke-SqlScalar {
    param(
        [string]$ConnectionString,
        [string]$SqlText
    )
    $connection = New-Object System.Data.SqlClient.SqlConnection($ConnectionString)
    try {
        $connection.Open()
        $command = $connection.CreateCommand()
        $command.CommandTimeout = 60
        $command.CommandText = $SqlText
        return $command.ExecuteScalar()
    } finally {
        $connection.Dispose()
    }
}

function Escape-SqlLiteral {
    param([string]$Value)
    if ($null -eq $Value) { return "" }
    return $Value.Replace("'", "''")
}

function New-AtlasPasswordHash {
    param(
        [string]$InstallPath,
        [string]$Password
    )
    $node = Join-Path $InstallPath "runtime\nodejs\node.exe"
    if (-not (Test-Path $node)) {
        $node = "node.exe"
    }

    $workingPath = [System.IO.Path]::GetFullPath($InstallPath)
    $modulePath = Join-Path $workingPath "node_modules"
    $logPath = Join-Path $DataRoot "logs"
    New-Item -ItemType Directory -Path $logPath -Force | Out-Null
    $hashScript = Join-Path $logPath ("atlas-password-hash-{0}.js" -f ([guid]::NewGuid().ToString("N")))
    $stdoutPath = Join-Path $logPath ("atlas-password-hash-{0}.out" -f ([guid]::NewGuid().ToString("N")))
    $stderrPath = Join-Path $logPath ("atlas-password-hash-{0}.err" -f ([guid]::NewGuid().ToString("N")))
    $script = @"
const path = require('path');
const installPath = process.env.ATLAS_INSTALL_PATH || process.cwd();
const candidates = [
  path.join(installPath, 'node_modules', 'bcryptjs'),
  'bcryptjs'
];
const errors = [];
let bcrypt = null;
for (const candidate of candidates) {
  try {
    bcrypt = require(candidate);
    break;
  } catch (err) {
    errors.push(candidate + ': ' + err.message);
  }
}
if (!bcrypt) {
  console.error('ATLAS bcryptjs load failed. ' + errors.join(' | '));
  process.exit(3);
}
const password = process.env.ATLAS_ADMIN_PASSWORD || '';
if (!password) {
  console.error('ATLAS admin password was empty.');
  process.exit(2);
}
process.stdout.write(bcrypt.hashSync(password, 12));
"@

    $oldPassword = $env:ATLAS_ADMIN_PASSWORD
    $oldInstallPath = $env:ATLAS_INSTALL_PATH
    $oldNodePath = $env:NODE_PATH
    try {
        Set-Content -LiteralPath $hashScript -Value $script -Encoding UTF8
        $env:ATLAS_ADMIN_PASSWORD = $Password
        $env:ATLAS_INSTALL_PATH = $workingPath
        if (Test-Path -LiteralPath $modulePath) {
            $env:NODE_PATH = $modulePath
        }
        $startInfo = New-Object System.Diagnostics.ProcessStartInfo
        $startInfo.FileName = $node
        $startInfo.Arguments = '"' + ($hashScript -replace '"', '\"') + '"'
        $startInfo.WorkingDirectory = $workingPath
        $startInfo.UseShellExecute = $false
        $startInfo.CreateNoWindow = $true
        $startInfo.RedirectStandardOutput = $true
        $startInfo.RedirectStandardError = $true
        $process = New-Object System.Diagnostics.Process
        $process.StartInfo = $startInfo
        [void]$process.Start()
        $hash = $process.StandardOutput.ReadToEnd()
        $errorText = $process.StandardError.ReadToEnd().Trim()
        $process.WaitForExit()
        Set-Content -LiteralPath $stdoutPath -Value $hash -Encoding UTF8
        Set-Content -LiteralPath $stderrPath -Value $errorText -Encoding UTF8
        if ($process.ExitCode -ne 0 -or [string]::IsNullOrWhiteSpace($hash)) {
            if ([string]::IsNullOrWhiteSpace($errorText)) { $errorText = "node.exe exited with code $($process.ExitCode)." }
            throw "Unable to generate application admin password hash. $errorText"
        }
        if (-not [string]::IsNullOrWhiteSpace($errorText)) {
            Write-Step "Password hash helper warning: $errorText"
        }
        return ([string]$hash).Trim()
    } finally {
        if ($null -eq $oldPassword) {
            Remove-Item Env:\ATLAS_ADMIN_PASSWORD -ErrorAction SilentlyContinue
        } else {
            $env:ATLAS_ADMIN_PASSWORD = $oldPassword
        }
        if ($null -eq $oldInstallPath) {
            Remove-Item Env:\ATLAS_INSTALL_PATH -ErrorAction SilentlyContinue
        } else {
            $env:ATLAS_INSTALL_PATH = $oldInstallPath
        }
        if ($null -eq $oldNodePath) {
            Remove-Item Env:\NODE_PATH -ErrorAction SilentlyContinue
        } else {
            $env:NODE_PATH = $oldNodePath
        }
        Remove-Item -LiteralPath $hashScript, $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue
    }
}

function Ensure-AtlasFirstRunAdmin {
    param(
        [string]$ConnectionString,
        [string]$DatabaseName,
        [string]$CompanyCodeValue,
        [string]$CompanyNameValue,
        [string]$AdminUsernameValue,
        [string]$AdminPasswordHash
    )

    $safeCompanyCode = Escape-SqlLiteral -Value $CompanyCodeValue.Trim()
    $safeCompanyName = Escape-SqlLiteral -Value $CompanyNameValue.Trim()
    $safeAdminUsername = Escape-SqlLiteral -Value $AdminUsernameValue.Trim()
    $safeAdminHash = Escape-SqlLiteral -Value $AdminPasswordHash
    $safeDatabaseName = Escape-SqlLiteral -Value $DatabaseName
    $safeAdminEmail = Escape-SqlLiteral -Value ((($AdminUsernameValue.Trim() -replace '[^A-Za-z0-9._-]', '_') + "@atlas.local"))

    $sqlText = @"
IF OBJECT_ID(N'dbo.Companies', N'U') IS NOT NULL
BEGIN
    IF EXISTS (SELECT 1 FROM dbo.Companies WHERE UPPER(CompanyCode) = UPPER(N'$safeCompanyCode'))
    BEGIN
        UPDATE dbo.Companies
        SET CompanyName = N'$safeCompanyName',
            DatabaseName = N'$safeDatabaseName',
            IsActive = 1,
            UpdatedAt = SYSUTCDATETIME()
        WHERE UPPER(CompanyCode) = UPPER(N'$safeCompanyCode');
    END
    ELSE
    BEGIN
        INSERT INTO dbo.Companies (CompanyCode, CompanyName, DatabaseName, Address, IsActive)
        VALUES (N'$safeCompanyCode', N'$safeCompanyName', N'$safeDatabaseName', N'', 1);
    END
END;

IF OBJECT_ID(N'dbo.Users', N'U') IS NOT NULL
BEGIN
    IF EXISTS (SELECT 1 FROM dbo.Users WHERE Username = N'$safeAdminUsername')
    BEGIN
        UPDATE dbo.Users
        SET PasswordHash = N'$safeAdminHash',
            Email = COALESCE(NULLIF(Email, N''), LEFT(N'$safeAdminEmail', 100)),
            FullName = COALESCE(NULLIF(FullName, N''), N'System Administrator'),
            Role = N'admin',
            IsActive = 1,
            LoginAttempts = 0,
            LockedUntil = NULL,
            PasswordChangedAt = GETDATE(),
            UpdatedAt = GETDATE()
        WHERE Username = N'$safeAdminUsername';
    END
    ELSE
    BEGIN
        INSERT INTO dbo.Users (Username, PasswordHash, Email, FullName, Role, IsActive, LoginAttempts, LockedUntil)
        VALUES (N'$safeAdminUsername', N'$safeAdminHash', LEFT(N'$safeAdminEmail', 100), N'System Administrator', N'admin', 1, 0, NULL);
    END

    UPDATE dbo.Users
    SET LoginAttempts = 0,
        LockedUntil = NULL,
        IsActive = 1
    WHERE Username = N'$safeAdminUsername'
       OR (Username = N'admin' AND N'$safeAdminUsername' = N'admin');
END;
"@
    Invoke-SqlBatch -ConnectionString $ConnectionString -SqlText $sqlText
    Write-Step "Application admin '$($AdminUsernameValue.Trim())' is active and unlocked for company '$($CompanyCodeValue.Trim())'."
}

function Ensure-AtlasDatabase {
    param(
        [string]$InstanceName,
        [int]$SqlPortNumber,
        [string]$DbServerName = "127.0.0.1",
        [string]$Password,
        [string]$InstallPath,
        [string]$CompanyCodeValue,
        [string]$CompanyNameValue,
        [string]$AdminUsernameValue,
        [string]$AdminPasswordValue
    )
    $dbHost = Get-AtlasSqlTcpHost -Server $DbServerName
    $server = if ($SqlPortNumber -gt 0) { "tcp:$dbHost,$SqlPortNumber" } else { Get-SqlServerName -InstanceName $InstanceName }
    $master = "Server=$server;Database=master;User ID=sa;Password=$Password;Encrypt=False;TrustServerCertificate=True;Connection Timeout=15;"
    $appDb = "Atlasairfare3356"

    Write-InstallDebugEvent -CurrentStep "Configure ATLAS database" -Status "STARTED" -Message "Using SQL endpoint $server and database $appDb." -DataPath $DataRoot
    Write-Step "Database configuration using SQL endpoint $server."
    $dbExists = [int](Invoke-SqlScalar -ConnectionString $master -SqlText "SELECT CASE WHEN DB_ID(N'$appDb') IS NULL THEN 0 ELSE 1 END;")
    Invoke-SqlBatch -ConnectionString $master -SqlText "IF DB_ID(N'$appDb') IS NULL CREATE DATABASE [$appDb];" -StepName "Create database $appDb"
    Write-Step "Database $appDb is present."
    $appConnection = "Server=$server;Database=$appDb;User ID=sa;Password=$Password;Encrypt=False;TrustServerCertificate=True;Connection Timeout=15;"
    $baseSchemaExists = [int](Invoke-SqlScalar -ConnectionString $appConnection -SqlText "SELECT CASE WHEN OBJECT_ID(N'dbo.Users', N'U') IS NULL THEN 0 ELSE 1 END;")

    $schemaFiles = @(
        "ATLAS_MSSQL_Schema.sql",
        "ATLAS_HCM_SQL_Objects.sql",
        "ATLAS_Company_Admin.sql",
        "ATLAS_Allocation_Attachments.sql",
        "ATLAS_Loan_SQL_Objects.sql"
    )
    foreach ($file in $schemaFiles) {
        $path = Join-Path $InstallPath "database\$file"
        if (-not (Test-Path $path)) { continue }

        if ($file -eq "ATLAS_MSSQL_Schema.sql" -and $dbExists -eq 1 -and $baseSchemaExists -eq 1) {
            Write-Step "Base schema already exists in '$appDb'. Skipping ATLAS_MSSQL_Schema.sql."
            continue
        }

        Write-Step "Applying database script $file."
        $sql = Get-Content -LiteralPath $path -Raw
        $sql = $sql -replace "(?im)^\s*CREATE\s+DATABASE\s+\[?Atlasairfare010\]?\s*;?\s*$", "IF DB_ID(N'$appDb') IS NULL CREATE DATABASE [$appDb];"
        $sql = $sql -replace "(?im)^\s*USE\s+\[?Atlasairfare010\]?\s*;?\s*$", "USE [$appDb];"
        Invoke-SqlBatch -ConnectionString $appConnection -SqlText $sql -StepName "Database script $file"
        Write-Step "Database script $file completed."
    }

    if (-not [string]::IsNullOrWhiteSpace($AdminPasswordValue)) {
        $adminHash = New-AtlasPasswordHash -InstallPath $InstallPath -Password $AdminPasswordValue
        Ensure-AtlasFirstRunAdmin `
            -ConnectionString $appConnection `
            -DatabaseName $appDb `
            -CompanyCodeValue $CompanyCodeValue `
            -CompanyNameValue $CompanyNameValue `
            -AdminUsernameValue $AdminUsernameValue `
            -AdminPasswordHash $adminHash
        Write-InstallDebugEvent -CurrentStep "Configure ATLAS database" -Status "OK" -Message "Database $appDb and application admin were configured successfully." -DataPath $DataRoot
    } else {
        Write-Step "No application admin password supplied for update; existing admin credentials were preserved."
        Write-InstallDebugEvent -CurrentStep "Configure ATLAS database" -Status "OK" -Message "Database $appDb was configured successfully; existing application admin credentials were preserved." -DataPath $DataRoot
    }
}

function Write-AtlasConfig {
    param(
        [string]$InstallPath,
        [int]$PortNumber,
        [int]$SqlPortNumber,
        [string]$DbServerName,
        [string]$InstanceName,
        [string]$Password
    )
    $secretBytes = New-Object byte[] 48
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($secretBytes)
    $secret = [Convert]::ToBase64String($secretBytes)

    $content = @"
PORT=$PortNumber
HOST=0.0.0.0
DB_SERVER=$DbServerName
DB_PORT=$SqlPortNumber
DB_NAME=Atlasairfare3356
DB_USER=sa
DB_PASSWORD=$Password
DB_ODBC_DRIVER=ODBC Driver 18 for SQL Server
DB_AUTO_SETUP=1
DB_ENCRYPT=false
DB_TRUST_SERVER_CERTIFICATE=true
JWT_SECRET=$secret
JWT_EXPIRES_IN=8h
CORS_ORIGIN=*
MAX_LOGIN_ATTEMPTS=5
LOCKOUT_MINUTES=30
"@
    Set-Content -Path (Join-Path $InstallPath ".env") -Value $content -Encoding ASCII
}

function Read-AtlasEnvConfig {
    param([string]$InstallPath)
    $settings = [ordered]@{}
    $envPath = Join-Path $InstallPath ".env"
    if (-not (Test-Path -LiteralPath $envPath)) {
        return $settings
    }

    Get-Content -LiteralPath $envPath -ErrorAction SilentlyContinue | ForEach-Object {
        if ($_ -match '^\s*([^#=]+)\s*=(.*)$') {
            $settings[$Matches[1].Trim()] = $Matches[2].Trim()
        }
    }
    return $settings
}

function Write-AtlasEnvConfig {
    param(
        [string]$InstallPath,
        [System.Collections.IDictionary]$Settings
    )
    $envPath = Join-Path $InstallPath ".env"
    $lines = foreach ($key in $Settings.Keys) {
        "$key=$($Settings[$key])"
    }
    Set-Content -LiteralPath $envPath -Value $lines -Encoding ASCII
}

function Get-AtlasEnvInt {
    param(
        [System.Collections.IDictionary]$Settings,
        [string]$Name,
        [int]$Fallback
    )
    $parsed = 0
    if ($Settings.Contains($Name) -and [int]::TryParse(([string]$Settings[$Name]).Trim(), [ref]$parsed) -and $parsed -gt 0 -and $parsed -le 65535) {
        return $parsed
    }
    return $Fallback
}

function Get-AtlasSqlTcpHost {
    param([string]$Server)
    $hostName = ([string]$Server).Trim()
    if ([string]::IsNullOrWhiteSpace($hostName)) { return "127.0.0.1" }
    if ($hostName -match "^(.*),\d+$") { $hostName = $Matches[1].Trim() }
    if ($hostName -match "\\") { $hostName = ($hostName -split "\\")[0].Trim() }
    if ([string]::IsNullOrWhiteSpace($hostName) -or $hostName -eq "." -or $hostName -eq "(local)") { return "127.0.0.1" }
    return $hostName
}

function Test-AtlasLocalSqlHost {
    param([string]$Server)
    $hostName = (Get-AtlasSqlTcpHost -Server $Server).ToLowerInvariant()
    return @("127.0.0.1", "localhost", $env:COMPUTERNAME.ToLowerInvariant()) -contains $hostName
}

function Repair-AtlasConfigForPatch {
    param([string]$InstallPath)

    $settings = Read-AtlasEnvConfig -InstallPath $InstallPath
    $changed = $false

    $appPort = Get-AtlasEnvInt -Settings $settings -Name "PORT" -Fallback $Port
    if (-not $settings.Contains("PORT") -or [string]$settings["PORT"] -ne [string]$appPort) {
        $settings["PORT"] = [string]$appPort
        $changed = $true
    }
    $defaultSettings = [ordered]@{
        HOST = "0.0.0.0"
        DB_SERVER = "127.0.0.1"
        DB_NAME = "Atlasairfare3356"
        DB_USER = "sa"
        DB_ODBC_DRIVER = "ODBC Driver 18 for SQL Server"
        DB_AUTO_SETUP = "1"
        DB_ENCRYPT = "false"
        DB_TRUST_SERVER_CERTIFICATE = "true"
        CORS_ORIGIN = "*"
        JWT_EXPIRES_IN = "8h"
        MAX_LOGIN_ATTEMPTS = "5"
        LOCKOUT_MINUTES = "30"
    }
    foreach ($pair in $defaultSettings.GetEnumerator()) {
        if (-not $settings.Contains($pair.Key) -or [string]::IsNullOrWhiteSpace([string]$settings[$pair.Key])) {
            $settings[$pair.Key] = $pair.Value
            $changed = $true
        }
    }
    if (-not $settings.Contains("JWT_SECRET") -or [string]::IsNullOrWhiteSpace([string]$settings["JWT_SECRET"])) {
        $secretBytes = New-Object byte[] 48
        [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($secretBytes)
        $settings["JWT_SECRET"] = [Convert]::ToBase64String($secretBytes)
        $changed = $true
    }

    $currentSqlPort = Get-AtlasEnvInt -Settings $settings -Name "DB_PORT" -Fallback 0
    $configuredDbServer = if ($settings.Contains("DB_SERVER")) { [string]$settings["DB_SERVER"] } else { "127.0.0.1" }
    $configuredSqlHost = Get-AtlasSqlTcpHost -Server $configuredDbServer
    $effectiveSqlPort = $currentSqlPort
    if ($effectiveSqlPort -gt 0 -and (Test-TcpPort -Server $configuredSqlHost -PortNumber $effectiveSqlPort)) {
        Write-Step "Update patch kept existing reachable MSSQL endpoint ${configuredSqlHost}:$effectiveSqlPort."
    } else {
        if (-not (Test-AtlasLocalSqlHost -Server $configuredDbServer)) {
            throw "Configured MSSQL endpoint ${configuredSqlHost}:$effectiveSqlPort is not reachable. Confirm DB_SERVER and DB_PORT in $(Join-Path $InstallPath ".env")."
        }

        $effectiveSqlInstance = Resolve-SqlInstance -RequestedInstance $SqlInstance
        Ensure-SqlService -InstanceName $effectiveSqlInstance
        $detectedSqlPort = Resolve-SqlTcpPort -InstanceName $effectiveSqlInstance -RequestedPort 0
        if ($detectedSqlPort -gt 0 -and (Test-TcpPort -Server $configuredSqlHost -PortNumber $detectedSqlPort)) {
            $effectiveSqlPort = $detectedSqlPort
            Write-Step "Update patch repaired MSSQL port to detected local SQL port ${configuredSqlHost}:$effectiveSqlPort."
        } elseif ($currentSqlPort -gt 0) {
            Enable-SqlTcpPort -InstanceName $effectiveSqlInstance -PortNumber $currentSqlPort
            $effectiveSqlPort = $currentSqlPort
            Write-Step "Update patch restored SQL TCP/IP on existing configured port ${configuredSqlHost}:$effectiveSqlPort."
        } else {
            $effectiveSqlPort = 1433
            Enable-SqlTcpPort -InstanceName $effectiveSqlInstance -PortNumber $effectiveSqlPort
            Write-Step "Update patch created missing MSSQL port configuration on ${configuredSqlHost}:$effectiveSqlPort."
        }
    }

    if (-not $settings.Contains("DB_PORT") -or [string]$settings["DB_PORT"] -ne [string]$effectiveSqlPort) {
        $settings["DB_PORT"] = [string]$effectiveSqlPort
        $changed = $true
    }
    if ($changed) {
        Write-AtlasEnvConfig -InstallPath $InstallPath -Settings $settings
        Write-Step "Update patch refreshed ATLAS runtime config at $(Join-Path $InstallPath ".env")."
    }

    return @{
        AppPort = $appPort
        SqlPort = $effectiveSqlPort
    }
}

function Start-Atlas {
    param([string]$InstallPath)
    $taskInstaller = Join-Path $InstallPath "Install-ATLAS-StartupTask.ps1"
    if (-not (Test-Path $taskInstaller)) {
        throw "ATLAS startup task installer was not found: $taskInstaller"
    }
    $taskOutLog = Join-Path $InstallPath "logs\atlas-startup-task-install-out.log"
    $taskErrLog = Join-Path $InstallPath "logs\atlas-startup-task-install-err.log"
    $arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$taskInstaller`" -InstallRoot `"$InstallPath`" -StartNow"
    $process = Start-Process -FilePath "powershell.exe" `
        -ArgumentList $arguments `
        -WorkingDirectory $InstallPath `
        -Wait `
        -PassThru `
        -WindowStyle Hidden `
        -RedirectStandardOutput $taskOutLog `
        -RedirectStandardError $taskErrLog
    if ($process.ExitCode -ne 0) {
        throw "ATLAS startup task failed with exit code $($process.ExitCode)."
    }
}

function Test-AtlasHealth {
    param(
        [int]$PortNumber,
        [switch]$RequirePayableReportPatch,
        [switch]$RequireSelfServicePatch
    )
    try {
        $response = Invoke-RestMethod -Uri "http://127.0.0.1:$PortNumber/api/health" -TimeoutSec 10
        if ($response.status -ne "healthy" -or $response.database -ne "connected") { return $false }
        if ($RequirePayableReportPatch -and $response.payableReportSource -ne "mssql-procedure-payable-bhd") { return $false }
        if ($RequireSelfServicePatch -and $response.selfServiceWorkflowSource -ne "phase2-same-port-allocation-link") { return $false }
        return $true
    } catch {
        return $false
    }
}

function Assert-PayableReportPatchInstalled {
    param(
        [string]$InstallPath,
        [int]$PortNumber
    )
    $serverPath = Join-Path $InstallPath "server.js"
    if (-not (Test-Path -LiteralPath $serverPath)) {
        throw "Patched backend verification failed: server.js is missing from $InstallPath."
    }
    $serverText = Get-Content -LiteralPath $serverPath -Raw
    if ($serverText -notmatch '(?s)payableReportSource\s*:\s*.*?mssql-procedure-payable-bhd') {
        throw "Patched backend verification failed: installed server.js does not expose the payable-report health contract."
    }
    if (-not (Test-AtlasHealth -PortNumber $PortNumber -RequirePayableReportPatch -RequireSelfServicePatch)) {
        throw "Patched runtime verification failed: ATLAS is healthy but the running backend is not the Payable Amount patched build. Restart ATLAS or close old node.exe processes and retry the patch."
    }
}

function Assert-SelfServicePatchInstalled {
    param(
        [string]$InstallPath,
        [int]$PortNumber
    )
    $serverPath = Join-Path $InstallPath "server.js"
    $frontendPath = Join-Path $InstallPath "atlas-hcm-next\out"
    if (-not (Test-Path -LiteralPath $serverPath)) {
        throw "Self-service patch verification failed: server.js is missing from $InstallPath."
    }
    $serverText = Get-Content -LiteralPath $serverPath -Raw
    if ($serverText -notmatch "phase2-same-port-allocation-link" -or $serverText -notmatch "createAllocationFromSelfServiceRequest") {
        throw "Self-service patch verification failed: installed backend does not contain the same-port request-to-allocation workflow."
    }
    if (-not (Test-Path -LiteralPath $frontendPath)) {
        throw "Self-service patch verification failed: frontend export is missing from $frontendPath."
    }
    $frontendFiles = Get-ChildItem -LiteralPath $frontendPath -Recurse -File -ErrorAction Stop |
        Where-Object { $_.Extension -in @(".html", ".js", ".txt") }
    $hasRequestWorkflow = $false
    $hasRequestEntry = $false
    foreach ($file in $frontendFiles) {
        if (-not $hasRequestWorkflow -and (Select-String -LiteralPath $file.FullName -Pattern "My Airfare Requests" -SimpleMatch -Quiet -ErrorAction SilentlyContinue)) {
            $hasRequestWorkflow = $true
        }
        if (-not $hasRequestEntry -and (Select-String -LiteralPath $file.FullName -Pattern "New Ticket" -SimpleMatch -Quiet -ErrorAction SilentlyContinue)) {
            $hasRequestEntry = $true
        }
        if ($hasRequestWorkflow -and $hasRequestEntry) { break }
    }
    if (-not $hasRequestWorkflow -or -not $hasRequestEntry) {
        throw "Self-service patch verification failed: installed frontend does not contain the updated self-service screen."
    }
    if (-not (Test-AtlasHealth -PortNumber $PortNumber -RequirePayableReportPatch -RequireSelfServicePatch)) {
        throw "Self-service runtime verification failed: ATLAS is healthy but the running backend is not the self-service allocation-link build. Stop old node.exe processes and rerun the patch as Administrator."
    }
}

function Restart-AtlasForPatch {
    param(
        [string]$InstallPath,
        [int]$PortNumber
    )
    Stop-PreviousAtlasRuntime -InstallPath $InstallPath -PortNumber $PortNumber
    Start-Sleep -Seconds 2
    Start-Atlas -InstallPath $InstallPath
    Start-Sleep -Seconds 8
    if (-not (Test-AtlasHealth -PortNumber $PortNumber -RequirePayableReportPatch -RequireSelfServicePatch)) {
        Stop-AtlasPortOwner -PortNumber $PortNumber -InstallPath $InstallPath
        Start-Sleep -Seconds 2
        Start-Atlas -InstallPath $InstallPath
        Start-Sleep -Seconds 8
    }
}

function Invoke-AtlasDatabaseObjectRepair {
    param(
        [string]$InstallPath,
        [string]$DataPath,
        [string]$ReportPath = $null
    )

    $initializer = Join-Path $InstallPath "Initialize-ATLAS-Database.ps1"
    if (-not (Test-Path $initializer)) {
        throw "ATLAS database initializer was not found: $initializer"
    }

    $logDir = Join-Path $DataPath "logs"
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $outLog = Join-Path $logDir "database-object-repair-$stamp.out.log"
    $errLog = Join-Path $logDir "database-object-repair-$stamp.err.log"

    if ($ReportPath) {
        "DatabaseObjectRepairOut=$outLog" | Add-Content $ReportPath
        "DatabaseObjectRepairErr=$errLog" | Add-Content $ReportPath
    }

    $arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$initializer`" -InstallRoot `"$InstallPath`" -Quiet"
    $process = Start-Process -FilePath "powershell.exe" `
        -ArgumentList $arguments `
        -WorkingDirectory $InstallPath `
        -Wait `
        -PassThru `
        -WindowStyle Hidden `
        -RedirectStandardOutput $outLog `
        -RedirectStandardError $errLog

    if ($process.ExitCode -ne 0) {
        $errorText = ""
        if (Test-Path $errLog) {
            $errorText = (Get-Content -LiteralPath $errLog -Raw -ErrorAction SilentlyContinue).Trim()
        }
        if ([string]::IsNullOrWhiteSpace($errorText) -and (Test-Path $outLog)) {
            $errorText = (Get-Content -LiteralPath $outLog -Raw -ErrorAction SilentlyContinue).Trim()
        }
        if ([string]::IsNullOrWhiteSpace($errorText)) {
            $errorText = "exit code $($process.ExitCode)"
        }
        throw "ATLAS database object repair failed: $errorText"
    }

    $phase1Runner = Join-Path $InstallPath "tools\atlas_phase1_patch_repair.py"
    if (Test-Path -LiteralPath $phase1Runner) {
        $python = (Get-Command "python.exe" -ErrorAction SilentlyContinue)
        if ($python) {
            $phase1OutLog = Join-Path $logDir "phase1-policy-rate-repair-$stamp.out.log"
            $phase1ErrLog = Join-Path $logDir "phase1-policy-rate-repair-$stamp.err.log"
            if ($ReportPath) {
                "Phase1PolicyRateRepairOut=$phase1OutLog" | Add-Content $ReportPath
                "Phase1PolicyRateRepairErr=$phase1ErrLog" | Add-Content $ReportPath
            }
            $phase1Args = "`"$phase1Runner`" --install-root `"$InstallPath`" --data-root `"$DataPath`""
            $phase1Process = Start-Process -FilePath $python.Source `
                -ArgumentList $phase1Args `
                -WorkingDirectory $InstallPath `
                -Wait `
                -PassThru `
                -WindowStyle Hidden `
                -RedirectStandardOutput $phase1OutLog `
                -RedirectStandardError $phase1ErrLog
            if ($phase1Process.ExitCode -ne 0) {
                $errorText = ""
                if (Test-Path $phase1ErrLog) {
                    $errorText = (Get-Content -LiteralPath $phase1ErrLog -Raw -ErrorAction SilentlyContinue).Trim()
                }
                if ([string]::IsNullOrWhiteSpace($errorText) -and (Test-Path $phase1OutLog)) {
                    $errorText = (Get-Content -LiteralPath $phase1OutLog -Raw -ErrorAction SilentlyContinue).Trim()
                }
                if ([string]::IsNullOrWhiteSpace($errorText)) {
                    $errorText = "exit code $($phase1Process.ExitCode)"
                }
                throw "ATLAS Phase-1 policy-rate repair failed: $errorText"
            }
        } else {
            Write-Step "Python runtime was not found; Phase-1 repair SQL already applied through Initialize-ATLAS-Database.ps1."
        }
    }

    Write-Step "ATLAS database objects and Phase-1 policy-rate repair verified."
}

function Get-AtlasConfiguredPort {
    param([string]$InstallPath, [int]$FallbackPort)
    $envPath = Join-Path $InstallPath ".env"
    if (Test-Path $envPath) {
        $line = Get-Content -LiteralPath $envPath -ErrorAction SilentlyContinue | Where-Object { $_ -match '^\s*PORT\s*=' } | Select-Object -First 1
        if ($line) {
            $raw = ($line -replace '^\s*PORT\s*=\s*', '').Trim()
            $parsed = 0
            if ([int]::TryParse($raw, [ref]$parsed) -and $parsed -gt 0 -and $parsed -le 65535) {
                return $parsed
            }
        }
    }
    return $FallbackPort
}

function Get-AtlasRegistryValue {
    param([string]$Name)
    foreach ($path in @(
        "HKLM:\SOFTWARE\ATLAS Airfare Allowance",
        "HKLM:\SOFTWARE\WOW6432Node\ATLAS Airfare Allowance"
    )) {
        if (-not (Test-Path $path)) { continue }
        $value = (Get-ItemProperty -Path $path -Name $Name -ErrorAction SilentlyContinue).$Name
        if (-not [string]::IsNullOrWhiteSpace([string]$value)) {
            return [string]$value
        }
    }
    return $null
}

function Set-AtlasRegistryValue {
    param(
        [string]$Name,
        [string]$Value
    )
    foreach ($path in @("HKLM:\SOFTWARE\ATLAS Airfare Allowance", "HKLM:\SOFTWARE\WOW6432Node\ATLAS Airfare Allowance")) {
        try {
            if (-not (Test-Path $path)) { New-Item -Path $path -Force | Out-Null }
            New-ItemProperty -Path $path -Name $Name -Value $Value -PropertyType String -Force -ErrorAction Stop | Out-Null
        } catch {
            Write-Step "Warning: could not update registry value $Name at $path`: $($_.Exception.Message)"
        }
    }
}

function Get-AtlasUninstallInstallLocation {
    foreach ($root in @(
        "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
        "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"
    )) {
        if (-not (Test-Path $root)) { continue }
        foreach ($item in Get-ChildItem -Path $root -ErrorAction SilentlyContinue) {
            $props = Get-ItemProperty -Path $item.PSPath -ErrorAction SilentlyContinue
            if ([string]$props.DisplayName -notlike "ATLAS Airfare Allowance*") { continue }
            if (-not [string]::IsNullOrWhiteSpace([string]$props.InstallLocation)) {
                return [string]$props.InstallLocation
            }
        }
    }
    return $null
}

function Find-AtlasInstallRoot {
    $candidates = New-Object System.Collections.Generic.List[string]
    $programFilesX86 = [Environment]::GetEnvironmentVariable("ProgramFiles(x86)")
    foreach ($candidate in @(
        $InstallRoot,
        (Get-AtlasRegistryValue -Name "INSTALLROOT"),
        (Get-AtlasUninstallInstallLocation),
        (Join-Path $env:ProgramFiles "ATLAS Airfare Allowance"),
        $(if ($programFilesX86) { Join-Path $programFilesX86 "ATLAS Airfare Allowance" })
    )) {
        if (-not [string]::IsNullOrWhiteSpace([string]$candidate)) {
            $candidates.Add(([string]$candidate).TrimEnd('\')) | Out-Null
        }
    }

    foreach ($candidate in $candidates | Select-Object -Unique) {
        if (Test-Path -LiteralPath (Join-Path $candidate "server.js")) {
            return $candidate
        }
    }
    return $InstallRoot
}

function Initialize-ExistingAtlasPatchContext {
    $resolvedInstallRoot = Find-AtlasInstallRoot
    if ($resolvedInstallRoot -and $resolvedInstallRoot -ne $InstallRoot) {
        Write-Step "Existing ATLAS install location detected: $resolvedInstallRoot"
        $script:InstallRoot = $resolvedInstallRoot
    }

    $registeredDataRoot = Get-AtlasRegistryValue -Name "DATAROOT"
    if (-not [string]::IsNullOrWhiteSpace($registeredDataRoot)) {
        $script:DataRoot = $registeredDataRoot.TrimEnd('\')
    }

    $settings = Read-AtlasEnvConfig -InstallPath $script:InstallRoot
    $registeredAppPort = Get-AtlasRegistryValue -Name "ATLASPORT"
    $registeredDbPort = Get-AtlasRegistryValue -Name "DB_PORT"

    $script:Port = Get-AtlasEnvInt -Settings $settings -Name "PORT" -Fallback $script:Port
    $parsed = 0
    if ($registeredAppPort -and [int]::TryParse($registeredAppPort, [ref]$parsed) -and $parsed -gt 0 -and $parsed -le 65535) {
        $script:Port = $parsed
    }

    if (-not $settings.Contains("DB_PORT") -and $registeredDbPort) {
        $settings["DB_PORT"] = $registeredDbPort
        Write-AtlasEnvConfig -InstallPath $script:InstallRoot -Settings $settings
        Write-Step "Existing ATLAS SQL port copied from registry: $registeredDbPort"
    }

    Write-Step "Existing ATLAS patch context: install='$script:InstallRoot', data='$script:DataRoot', app port=$script:Port."
}

function Assert-AtlasInstalledForPatch {
    Initialize-ExistingAtlasPatchContext
    if (Test-Path (Join-Path $script:InstallRoot "server.js")) { return }
    if (Test-Path "HKLM:\SOFTWARE\ATLAS Airfare Allowance") { return }
    throw "ATLAS Airfare Allowance is not installed. Use the full installer on new machines."
}

function Invoke-UpdateOnlyPrepare {
    Assert-AtlasInstalledForPatch
    Test-AtlasUpdateManifest -Manifest $UpdateManifest -CurrentVersion $ProductVersion -DataPath $DataRoot | Out-Null
    try {
        Ensure-DataDirectories -InstallPath $InstallRoot -DataPath $DataRoot
    } catch {
        Write-Step "Warning: update prepare could not create/check folders yet: $($_.Exception.Message)"
    }
    try {
        Save-UpdatePreservedConfig -InstallPath $InstallRoot -DataPath $DataRoot | Out-Null
    } catch {
        Write-Step "Warning: update prepare could not preserve existing config yet: $($_.Exception.Message)"
    }
    try {
        New-Backup -InstallPath $InstallRoot -DataPath $DataRoot | Out-Null
    } catch {
        Write-Step "Warning: update prepare backup was skipped: $($_.Exception.Message)"
    }
    try {
        Stop-PreviousAtlasRuntime -InstallPath $InstallRoot
    } catch {
        Write-Step "Warning: update prepare could not stop existing runtime yet: $($_.Exception.Message)"
    }
    Write-Step "Update-only patch prepared existing ATLAS installation. No SQL, company, or admin configuration was requested."
}

function Invoke-UpdateOnlyFinalize {
    $report = $null
    $warnings = New-Object System.Collections.Generic.List[string]
    try {
        Assert-AtlasInstalledForPatch
        Ensure-DataDirectories -InstallPath $InstallRoot -DataPath $DataRoot
        $report = Join-Path $DataRoot ("logs\update-finalize-{0}.txt" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
        "ATLAS update finalize $(Get-Date -Format o)" | Set-Content -Path $report -Encoding UTF8
        "InstallRoot=$InstallRoot" | Add-Content $report
        "DataRoot=$DataRoot" | Add-Content $report
        "PatchVersion=$ProductVersion" | Add-Content $report
        "PatchSource=verified codex/atlas-installer-2.2.8 history" | Add-Content $report
        "Step=Review existing installation and configuration" | Add-Content $report

        Write-InstallDebugEvent -CurrentStep "Preserve existing application and MSSQL configuration" -Status "STARTED" -Message "Reading installed .env, registry, and confirmed bootstrapper values." -DataPath $DataRoot
        Save-UpdatePreservedConfig -InstallPath $InstallRoot -DataPath $DataRoot | Out-Null
        Restore-UpdatePreservedConfig -InstallPath $InstallRoot -DataPath $DataRoot
        $config = Repair-AtlasConfigForPatch -InstallPath $InstallRoot
        Write-InstallDebugEvent -CurrentStep "Preserve existing application and MSSQL configuration" -Status "OK" -Message "Existing ports and database company name preserved." -DataPath $DataRoot
        $effectivePort = [int]$config.AppPort
        "AppPort=$effectivePort" | Add-Content $report
        "SqlPort=$($config.SqlPort)" | Add-Content $report
        "Step=Build dependency relationship map" | Add-Content $report
        Write-InstallDebugEvent -CurrentStep "Build dependency relationship map" -Status "STARTED" -Message "Writing dependency/support relationships for the installed patch." -DataPath $DataRoot
        $dependencyReport = New-AtlasPatchDependencyReport -InstallPath $InstallRoot -DataPath $DataRoot -Version $ProductVersion -PortNumber $effectivePort
        "DependencyReportMarkdown=$($dependencyReport.MarkdownPath)" | Add-Content $report
        "DependencyReportJson=$($dependencyReport.JsonPath)" | Add-Content $report
        Write-InstallDebugEvent -CurrentStep "Build dependency relationship map" -Status "OK" -Message "Dependency map contains $($dependencyReport.Count) relationships." -DataPath $DataRoot
        "Step=Review patched files and payload manifest" | Add-Content $report
        $checksumReport = Invoke-ChecksumDiagnostic -InstallPath $InstallRoot -DataPath $DataRoot
        "ChecksumReport=$checksumReport" | Add-Content $report
        $replacementAudit = Invoke-PatchPayloadReplacementAudit -InstallPath $InstallRoot -DataPath $DataRoot -ReportPath $report
        Write-InstallDebugEvent -CurrentStep "Verify copied and replaced files" -Status "OK" -Message "Payload audit verified $($replacementAudit.Verified) of $($replacementAudit.Total) files; missing=$($replacementAudit.Missing), mismatch=$($replacementAudit.Mismatch)." -DataPath $DataRoot
        if ($replacementAudit.Missing -gt 0 -or $replacementAudit.Mismatch -gt 0) {
            $warning = "PayloadAuditWarning=Patched files did not match manifest. Missing=$($replacementAudit.Missing); Mismatch=$($replacementAudit.Mismatch)."
            $warnings.Add($warning) | Out-Null
            $warning | Add-Content $report
        }

        "Step=Repair database stored procedures and functions" | Add-Content $report
        Write-InstallDebugEvent -CurrentStep "Repair database stored procedures and functions" -Status "STARTED" -Message "Applying missing stored procedures, functions, and indexes using existing MSSQL settings." -DataPath $DataRoot
        try {
            Invoke-AtlasDatabaseObjectRepair -InstallPath $InstallRoot -DataPath $DataRoot -ReportPath $report
            Write-InstallDebugEvent -CurrentStep "Repair database stored procedures and functions" -Status "OK" -Message "Database objects verified." -DataPath $DataRoot
        } catch {
            $warning = "DatabaseRepairWarning=$($_.Exception.Message)"
            $warnings.Add($warning) | Out-Null
            $warning | Add-Content $report
            Write-InstallDebugEvent -CurrentStep "Repair database stored procedures and functions" -Status "WARNING" -Message $_.Exception.Message -ErrorCode "DATABASE_OBJECT_REPAIR" -RemediationSuggestion "Confirm SQL Server TCP/IP port, sa password, and database permissions, then run Repair/Troubleshoot." -DataPath $DataRoot
            Write-Step "Warning: database object repair could not finish during update: $($_.Exception.Message)"
        }

        try {
            "Step=Restart ATLAS service task" | Add-Content $report
            Write-InstallDebugEvent -CurrentStep "Restart ATLAS service task" -Status "STARTED" -Message "Refreshing scheduled task and starting ATLAS." -DataPath $DataRoot
            Restart-AtlasForPatch -InstallPath $InstallRoot -PortNumber $effectivePort
            Write-InstallDebugEvent -CurrentStep "Restart ATLAS service task" -Status "OK" -Message "ATLAS startup task completed." -DataPath $DataRoot
        } catch {
            $warning = "StartWarning=$($_.Exception.Message)"
            $warnings.Add($warning) | Out-Null
            $warning | Add-Content $report
            Write-InstallDebugEvent -CurrentStep "Restart ATLAS service task" -Status "WARNING" -Message $_.Exception.Message -ErrorCode "ATLAS_STARTUP" -RemediationSuggestion "Run Repair/Troubleshoot or start ATLAS from the desktop shortcut after confirming ports are open." -DataPath $DataRoot
            Write-Step "Warning: ATLAS startup could not be completed automatically: $($_.Exception.Message)"
        }

        "Step=Verify ATLAS health endpoint" | Add-Content $report
        Write-InstallDebugEvent -CurrentStep "Verify ATLAS health endpoint" -Status "STARTED" -Message "Checking http://127.0.0.1:$effectivePort/api/health." -DataPath $DataRoot
        if (-not (Test-AtlasHealth -PortNumber $effectivePort -RequirePayableReportPatch -RequireSelfServicePatch)) {
            "Health=NotReady" | Add-Content $report
            $warning = "HealthWarning=ATLAS did not become healthy with the Payable Amount and Employee Self-Service patched backend on http://127.0.0.1:$effectivePort/api/health."
            $warnings.Add($warning) | Out-Null
            $warning | Add-Content $report
            Write-InstallDebugEvent -CurrentStep "Verify ATLAS health endpoint" -Status "WARNING" -Message "ATLAS did not become healthy with the Payable Amount and Employee Self-Service patched backend on http://127.0.0.1:$effectivePort/api/health." -ErrorCode "ATLAS_PATCH_NOT_ACTIVE" -RemediationSuggestion "Open Task Manager, stop old node.exe ATLAS processes, then run the update patch again as Administrator." -DataPath $DataRoot
        } else {
            "Health=Healthy" | Add-Content $report
            "PayableReportPatch=Active" | Add-Content $report
            "SelfServicePatch=Active" | Add-Content $report
            Write-InstallDebugEvent -CurrentStep "Verify ATLAS health endpoint" -Status "OK" -Message "ATLAS health endpoint is healthy and running the Payable Amount plus Employee Self-Service patched backend." -DataPath $DataRoot
            Assert-PayableReportPatchInstalled -InstallPath $InstallRoot -PortNumber $effectivePort
            Assert-SelfServicePatchInstalled -InstallPath $InstallRoot -PortNumber $effectivePort
        }
        if ($warnings.Count -gt 0) {
            "PatchStatus=FAILED" | Add-Content $report
            "WarningCount=$($warnings.Count)" | Add-Content $report
            $message = "Update-only patch did not activate the patched backend. Report: $report"
            Write-InstallDebugEvent -CurrentStep "Finalize ATLAS update patch" -Status "FAILED" -Message $message -ErrorCode "PATCH_NOT_ACTIVE" -RemediationSuggestion "Stop old ATLAS node.exe processes, confirm port $effectivePort, then rerun the update patch as Administrator." -DataPath $DataRoot
            throw $message
        }
        "PatchStatus=SUCCESS" | Add-Content $report
        Write-InstallDebugEvent -CurrentStep "Finalize ATLAS update patch" -Status "OK" -Message "Patch finished successfully." -DataPath $DataRoot
        Write-Step "Update-only patch completed. ATLAS is healthy on http://127.0.0.1:$effectivePort/."
    } catch {
        try {
            if (-not $report) {
                New-Item -ItemType Directory -Path (Join-Path $DataRoot "logs") -Force | Out-Null
                $report = Join-Path $DataRoot ("logs\update-finalize-{0}.txt" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
                "ATLAS update finalize $(Get-Date -Format o)" | Set-Content -Path $report -Encoding UTF8
            }
            "FinalizeWarning=$($_.Exception.Message)" | Add-Content $report
            "PatchStatus=FAILED" | Add-Content $report
            Write-InstallDebugEvent -CurrentStep "Finalize ATLAS update patch" -Status "FAILED" -Message $_.Exception.Message -ErrorCode "UPDATE_FINALIZE" -RemediationSuggestion "Send the latest update-finalize log and install_debug.log for support." -DataPath $DataRoot
        } catch {}
        throw "Update finalize failed: $($_.Exception.Message). Review log: $report"
    }
}

function Invoke-Preflight {
    Test-AtlasUpdateManifest -Manifest $UpdateManifest -CurrentVersion $ProductVersion -DataPath $DataRoot | Out-Null
    Prompt-AtlasInstallSettings
    Assert-AtlasPreInstallGate
    $hostInfo = Get-AtlasHostInfo
    Write-Step "Host detected: $($hostInfo.HostName), loopback: $($hostInfo.Loopback), port: $Port"
}

function Assert-AtlasPreInstallGate {
    $saved = Read-RequiredBootstrapConfig -DataPath $DataRoot -Context "ATLAS pre-installation check"
    $selectedPort = if ($saved.Port) { [int]$saved.Port } else { $Port }
    $selectedSqlPort = if ($saved.SqlPort) { [int]$saved.SqlPort } else { [int]$script:SqlPort }
    $selectedDbServer = if ($saved.DbServer) { [string]$saved.DbServer } elseif ($saved.DB_SERVER) { [string]$saved.DB_SERVER } else { $DbServer }
    $selectedDbName = if ($saved.DbName) { [string]$saved.DbName } elseif ($saved.DB_NAME) { [string]$saved.DB_NAME } else { "Atlasairfare3356" }
    $selectedInstance = if ($saved.SqlInstance) { [string]$saved.SqlInstance } else { $SqlInstance }
    $selectedPassword = if ($saved.SqlSaPassword) { [string]$saved.SqlSaPassword } else { $SqlSaPassword }
    $selectedAction = if ($saved.SetupAction) { [string]$saved.SetupAction } else { $SetupAction }
    if ($selectedAction -eq "Install" -and (Test-AtlasExistingInstallEvidence -InstallPath $InstallRoot) -and -not (Get-BootstrapConfigBool -Config $saved -Name "FreshInstallReplaceConfirmed")) {
        $selectedAction = "Update"
        Write-Step "Existing ATLAS installation detected during preflight. Auto-switching setup action to Update; fresh replacement was not confirmed."
    }

    if ($selectedAction -eq "Install" -and (Test-AtlasInstallFootprint -InstallPath $InstallRoot)) {
        Write-Step "Existing ATLAS application footprint detected during fresh install. Backing up and preparing replacement."
        $null = New-Backup -InstallPath $InstallRoot -DataPath $DataRoot
    }

    $instances = @(Get-InstalledSqlInstances)
    if ($instances.Count -gt 0) {
        if (-not $selectedPassword) {
            throw "MSSQL sa password is required for the pre-installation database check."
        }
        $effectiveSqlInstance = Resolve-SqlInstance -RequestedInstance $selectedInstance
        Ensure-SqlService -InstanceName $effectiveSqlInstance
        $effectiveSqlPort = Resolve-SqlTcpPort -InstanceName $effectiveSqlInstance -RequestedPort $selectedSqlPort
        $selectedSqlHost = Get-AtlasSqlTcpHost -Server $selectedDbServer
        if (-not (Test-TcpPort -Server $selectedSqlHost -PortNumber $effectiveSqlPort)) {
            throw "Pre-installation check failed: MSSQL TCP port ${selectedSqlHost}:$effectiveSqlPort is not reachable. Confirm SQL TCP/IP and the custom SQL server/port before installing ATLAS."
        }
        if (-not (Test-SqlLoginTcp -Server $selectedDbServer -PortNumber $effectiveSqlPort -Password $selectedPassword)) {
            throw "Pre-installation check failed: MSSQL sa login over TCP failed on ${selectedSqlHost}:$effectiveSqlPort. Correct the SQL server, SQL password, or custom SQL port before installing ATLAS."
        }
        Write-Step "Pre-installation MSSQL TCP check passed on ${selectedSqlHost}:$effectiveSqlPort."
        if ($selectedAction -eq "Install" -and (Get-BootstrapConfigBool -Config $saved -Name "BackupDatabaseBeforeFresh")) {
            $null = Backup-AtlasDatabaseIfPresent -SqlPortNumber $effectiveSqlPort -Password $selectedPassword -DataPath $DataRoot -DatabaseName $selectedDbName
        }
    } else {
        Write-Step "Pre-installation check found no local SQL Server. SQL Express will be downloaded from Microsoft if needed."
    }

    if ($selectedAction -eq "Install" -and (Test-AtlasInstallFootprint -InstallPath $InstallRoot)) {
        Remove-AtlasInstallFootprint -InstallPath $InstallRoot
    }
    Write-Step "Pre-installation gate passed for action '$selectedAction', ATLAS port $selectedPort, SQL server '$selectedDbServer', SQL instance '$selectedInstance', SQL port $selectedSqlPort."
}

function Invoke-InstallOrRepair {
    param([switch]$Repair)
    Assert-Admin
    Ensure-DataDirectories -InstallPath $InstallRoot -DataPath $DataRoot
    Test-AtlasUpdateManifest -Manifest $UpdateManifest -CurrentVersion $ProductVersion -DataPath $DataRoot | Out-Null
    if ($Repair -or $SetupAction -eq "Repair") {
        Invoke-ChecksumDiagnostic -InstallPath $InstallRoot -DataPath $DataRoot | Out-Null
    }
    Stop-PreviousAtlasRuntime -InstallPath $InstallRoot
    New-Backup -InstallPath $InstallRoot -DataPath $DataRoot | Out-Null

    $saved = if (-not [string]::IsNullOrWhiteSpace($ConfigPath)) {
        Read-RequiredBootstrapConfig -DataPath $DataRoot -Path $ConfigPath -Context "ATLAS configure"
    } else {
        Read-BootstrapConfig -DataPath $DataRoot
    }
    $SqlPort = [int]$script:SqlPort
    if ($saved) {
        if ($saved.Port) { $Port = [int]$saved.Port }
        if ($saved.SqlPort) { $SqlPort = [int]$saved.SqlPort }
        if ($saved.DbServer) { $DbServer = [string]$saved.DbServer }
        if ($saved.DB_SERVER) { $DbServer = [string]$saved.DB_SERVER }
        if ($saved.SqlInstance) { $SqlInstance = [string]$saved.SqlInstance }
        if ($saved.SqlSaPassword) { $SqlSaPassword = [string]$saved.SqlSaPassword }
        if ($saved.CompanyCode) { $CompanyCode = [string]$saved.CompanyCode }
        if ($saved.CompanyName) { $CompanyName = [string]$saved.CompanyName }
        if ($saved.AdminUsername) { $AdminUsername = [string]$saved.AdminUsername }
        if ($saved.AdminPassword) { $AdminPassword = [string]$saved.AdminPassword }
        if ($saved.SetupAction) { $SetupAction = [string]$saved.SetupAction }
    }

    if ($SetupAction -eq "Install" -and (Test-AtlasExistingInstallEvidence -InstallPath $InstallRoot) -and -not (Get-BootstrapConfigBool -Config $saved -Name "FreshInstallReplaceConfirmed")) {
        $SetupAction = "Update"
        Write-Step "Existing ATLAS installation detected during configure. Auto-update selected; fresh replacement was not confirmed."
    }

    if ($SetupAction -eq "Troubleshoot") {
        Invoke-Troubleshoot
        Remove-BootstrapConfig -DataPath $DataRoot
        return
    }
    if ($SetupAction -eq "Repair") {
        $Repair = $true
    }

    $effectiveSqlInstance = Resolve-SqlInstance -RequestedInstance $SqlInstance

    if (-not $SqlSaPassword) {
        throw "MSSQL sa password was not collected. Re-run setup and complete the ATLAS setup configuration prompt."
    }
    if (($SetupAction -eq "Install" -or $SetupAction -eq "Repair") -and -not $AdminPassword) {
        throw "Application admin password was not collected. Re-run setup and complete the ATLAS setup configuration prompt."
    }

    Install-SqlExpressIfMissing -InstanceName $effectiveSqlInstance -Password $SqlSaPassword
    $effectiveSqlInstance = Resolve-SqlInstance -RequestedInstance $effectiveSqlInstance
    if (Test-AtlasLocalSqlHost -Server $DbServer) {
        Ensure-SqlService -InstanceName $effectiveSqlInstance
    } else {
        Write-Step "Remote MSSQL server selected; skipping local SQL service control for '$DbServer'."
    }
    $SqlPort = Resolve-SqlTcpPort -InstanceName $effectiveSqlInstance -RequestedPort $SqlPort
    $dbHost = Get-AtlasSqlTcpHost -Server $DbServer
    if (-not (Test-TcpPort -Server $dbHost -PortNumber $SqlPort)) {
        throw "MSSQL TCP port ${dbHost}:$SqlPort is not reachable after configuration. Enable SQL Server TCP/IP or choose the correct MSSQL server/port."
    }
    if (-not (Test-SqlLoginTcp -Server $DbServer -PortNumber $SqlPort -Password $SqlSaPassword)) {
        throw "MSSQL sa login over TCP failed on ${dbHost}:$SqlPort. Re-run setup and enter the correct SQL server/port/password."
    }
    Write-Step "MSSQL TCP login confirmed on ${dbHost}:$SqlPort."
    if (-not (Test-SqlLogin -InstanceName $effectiveSqlInstance -Password $SqlSaPassword)) {
        Write-Step "Warning: MSSQL instance-name login check failed after TCP verification; continuing with verified TCP endpoint 127.0.0.1:$SqlPort."
    }
    Write-AtlasConfig -InstallPath $InstallRoot -PortNumber $Port -SqlPortNumber $SqlPort -DbServerName $DbServer -InstanceName $effectiveSqlInstance -Password $SqlSaPassword
    Ensure-AtlasDatabase `
        -InstanceName $effectiveSqlInstance `
        -SqlPortNumber $SqlPort `
        -DbServerName $DbServer `
        -Password $SqlSaPassword `
        -InstallPath $InstallRoot `
        -CompanyCodeValue $CompanyCode `
        -CompanyNameValue $CompanyName `
        -AdminUsernameValue $AdminUsername `
        -AdminPasswordValue $AdminPassword
    Remove-BootstrapConfig -DataPath $DataRoot

    if ($Repair) {
        Write-Step "Repair checks complete. Restarting ATLAS."
    } else {
        Write-Step "Install checks complete. Starting ATLAS."
    }

    Start-Atlas -InstallPath $InstallRoot
    Start-Sleep -Seconds 8
    if (-not (Test-AtlasHealth -PortNumber $Port)) {
        Write-Step "Warning: ATLAS did not become healthy on http://127.0.0.1:$Port/api/health yet. Setup will finish; run Start-ATLAS.bat or Troubleshooter if needed."
        return
    }
    Write-Step "ATLAS is healthy on http://127.0.0.1:$Port/"
}

function Invoke-Troubleshoot {
    Assert-Admin
    Ensure-DataDirectories -InstallPath $InstallRoot -DataPath $DataRoot
    Test-AtlasUpdateManifest -Manifest $UpdateManifest -CurrentVersion $ProductVersion -DataPath $DataRoot | Out-Null
    Invoke-ChecksumDiagnostic -InstallPath $InstallRoot -DataPath $DataRoot | Out-Null
    $report = Join-Path $DataRoot ("troubleshoot_{0}.txt" -f (Get-Date -Format "yyyyMMdd_HHmmss"))
    "ATLAS Troubleshooter $(Get-Date -Format o)" | Set-Content -Path $report -Encoding UTF8
    "InstallRoot=$InstallRoot" | Add-Content $report
    "DataRoot=$DataRoot" | Add-Content $report
    "Port=$Port" | Add-Content $report
    "Host=$((Get-AtlasHostInfo).HostName)" | Add-Content $report
    "Loopback=127.0.0.1" | Add-Content $report
    "LocalDB installed=$(Test-SqlLocalDb)" | Add-Content $report
    "SQL service=$(Get-SqlServiceName -InstanceName $SqlInstance)" | Add-Content $report
    "ATLAS health=$(Test-AtlasHealth -PortNumber $Port)" | Add-Content $report
    Get-Service -Name (Get-SqlServiceName -InstanceName $SqlInstance) -ErrorAction SilentlyContinue | Out-String | Add-Content $report
    Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue | Out-String | Add-Content $report
    Write-Step "Troubleshooter report: $report"
}

function Save-SqlExpressRedistributable {
    param([string]$Destination)

    $downloadUrl = "https://download.microsoft.com/download/5/1/4/5145fe04-4d30-4b85-b0d1-39533663a2f1/SQL2022-SSEI-Expr.exe"
    $destinationDir = Split-Path -Parent $Destination
    $mediaDir = Join-Path $destinationDir "sql-express-media"
    $webInstaller = Join-Path $destinationDir "SQL2022-SSEI-Expr.exe"
    New-Item -ItemType Directory -Path $destinationDir -Force | Out-Null
    New-Item -ItemType Directory -Path $mediaDir -Force | Out-Null

    $tempFile = "$webInstaller.download"
    if (Test-Path $tempFile) { Remove-Item -LiteralPath $tempFile -Force }

    Write-Step "Downloading SQL Server 2022 Express web installer from Microsoft."
    Write-Step "Source: $downloadUrl"
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $downloadUrl -OutFile $tempFile -UseBasicParsing

    if (-not (Test-Path $tempFile)) {
        throw "SQL Server Express download did not create a file."
    }
    $size = (Get-Item -LiteralPath $tempFile).Length
    if ($size -lt 1000000) {
        Remove-Item -LiteralPath $tempFile -Force -ErrorAction SilentlyContinue
        throw "Downloaded SQL Server Express file is unexpectedly small ($size bytes)."
    }

    Move-Item -LiteralPath $tempFile -Destination $webInstaller -Force

    Write-Step "Downloading SQL Server Express Core offline media. This can take several minutes."
    $downloadArgs = @(
        "/ACTION=Download",
        "/MEDIATYPE=Core",
        "/MEDIAPATH=`"$mediaDir`""
    )
    $process = Start-Process -FilePath $webInstaller -ArgumentList $downloadArgs -Wait -PassThru
    if ($process.ExitCode -ne 0 -and $process.ExitCode -ne 3010) {
        throw "SQL Server Express media download failed with exit code $($process.ExitCode)."
    }

    $fullInstaller = Get-ChildItem -Path $mediaDir -Recurse -File -Filter "SQLEXPR*_x64_ENU.exe" -ErrorAction SilentlyContinue |
        Sort-Object Length -Descending |
        Select-Object -First 1
    if (-not $fullInstaller) {
        $fullInstaller = Get-ChildItem -Path $mediaDir -Recurse -File -Filter "SQLEXPR*.exe" -ErrorAction SilentlyContinue |
            Sort-Object Length -Descending |
            Select-Object -First 1
    }
    if (-not $fullInstaller) {
        throw "SQL Express Core media download completed, but SQLEXPR_x64_ENU.exe was not found under $mediaDir."
    }

    Copy-Item -LiteralPath $fullInstaller.FullName -Destination $Destination -Force
    Write-Step "SQL Server Express offline redistributable saved: $Destination"
}

function Build-AtlasRunner {
    $source = Join-Path $PSScriptRoot "runner\AtlasBootstrapperRunner.cs"
    $output = Join-Path $PSScriptRoot "runner\AtlasBootstrapperRunner.exe"
    if (-not (Test-Path $source)) {
        throw "Missing bootstrapper runner source: $source"
    }

    $csc = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
    if (-not (Test-Path $csc)) {
        $csc = Join-Path $env:WINDIR "Microsoft.NET\Framework\v4.0.30319\csc.exe"
    }
    if (-not (Test-Path $csc)) {
        throw ".NET Framework C# compiler was not found. Install/enable .NET Framework 4.x developer tools or provide runner\AtlasBootstrapperRunner.exe."
    }

    $needsBuild = -not (Test-Path $output)
    if (-not $needsBuild) {
        $needsBuild = (Get-Item $source).LastWriteTimeUtc -gt (Get-Item $output).LastWriteTimeUtc
    }

    if ($needsBuild) {
        Write-Step "Compiling ATLAS bootstrapper runner."
        & $csc /nologo /target:winexe /optimize+ /platform:anycpu /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Data.dll /reference:System.ServiceProcess.dll /out:$output $source
        if ($LASTEXITCODE -ne 0) {
            throw "ATLAS bootstrapper runner compile failed with exit code $LASTEXITCODE."
        }
    }
    return $output
}

function Invoke-Build {
    $bundle = Join-Path $PSScriptRoot "Bundle.wxs"
    $deploy = Join-Path $PSScriptRoot "deploy.ps1"
    if (-not (Test-Path $AppMsi)) { throw "Missing app MSI: $AppMsi" }
    $runnerExe = Build-AtlasRunner

    $wixVersionText = (& wix --version)
    if ($LASTEXITCODE -ne 0 -or -not $wixVersionText) {
        throw "WiX Toolset CLI was not found. Install WiX Toolset v5 before building the bootstrapper."
    }
    if ($wixVersionText -notmatch "^7\.") {
        throw "This bootstrapper is pinned to WiX Toolset v7. Current wix.exe reports '$wixVersionText'. Install/use WiX v7 for the release build."
    }

    New-Item -ItemType Directory -Path (Split-Path -Parent $Output) -Force | Out-Null
    $args = @(
        "build", $bundle,
        "-ext", "WixToolset.BootstrapperApplications.wixext",
        "-ext", "WixToolset.Util.wixext",
        "-arch", "x64",
        "-d", "AppMsi=$AppMsi",
        "-d", "DeployScript=$deploy",
        "-d", "RunnerExe=$runnerExe",
        "-d", "SqlExpressSetupExe=$SqlExpressSetupExe",
        "-d", "ProductVersion=$ProductVersion",
        "-o", $Output
    )
    if ($UpdateOnly) {
        $args = $args[0..($args.Count - 3)] + @("-d", "UpdateOnly=1") + $args[($args.Count - 2)..($args.Count - 1)]
    }
    Write-Step "Building bootstrapper EXE..."
    & wix @args
    if ($LASTEXITCODE -ne 0) { throw "WiX build failed with exit code $LASTEXITCODE." }
    Get-FileHash -Algorithm SHA256 -Path $Output | Format-List
}

try {
    switch ($Mode) {
        "Build" { Invoke-Build }
        "Preflight" { Invoke-Preflight }
        "Install" { Invoke-InstallOrRepair }
        "Repair" { Invoke-InstallOrRepair -Repair }
        "Troubleshoot" { Invoke-Troubleshoot }
        "UpdateOnlyPrepare" { Invoke-UpdateOnlyPrepare }
        "UpdateOnlyFinalize" { Invoke-UpdateOnlyFinalize }
        "Backup" {
            Assert-Admin
            Ensure-DataDirectories -InstallPath $InstallRoot -DataPath $DataRoot
            New-Backup -InstallPath $InstallRoot -DataPath $DataRoot | Out-Null
        }
    }
} catch {
    $message = $_.Exception.Message
    if ($_.ScriptStackTrace) {
        Write-Host $_.ScriptStackTrace
    }
    Write-AtlasFailure -CurrentStep "ATLAS bootstrapper $Mode" -Message $message
    exit 1
} finally {
    if ($script:TranscriptStarted) {
        try { Stop-Transcript | Out-Null } catch {}
    }
}
