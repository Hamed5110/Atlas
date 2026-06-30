param(
    [string]$Version = "2.3.10",
    [string]$OutputDir = (Join-Path (Split-Path -Parent $PSScriptRoot) "artifacts"),
    [switch]$SkipVerify
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$StageRoot = Join-Path $Root "installer\stage"
$Payload = Join-Path $StageRoot "payload"
$Runtime = Join-Path $Payload "runtime\nodejs"
$WxsPath = Join-Path $StageRoot "ATLAS-Airfare-Allowance.wxs"
$MsiPath = Join-Path $OutputDir "ATLAS-Airfare-Allowance-$Version-x64.msi"
$UpgradeCode = "c71a0483-2ff0-4aa9-98ad-4584cb380e9a"

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

function Copy-Tree {
    param([string]$Source, [string]$Destination, [string[]]$ExcludeDirs = @(), [string[]]$ExcludeFiles = @())
    if (-not (Test-Path $Source)) { return }
    New-Item -ItemType Directory -Path $Destination -Force | Out-Null
    $args = @($Source, $Destination, "/E", "/NFL", "/NDL", "/NJH", "/NJS", "/NP")
    foreach ($dir in $ExcludeDirs) { $args += @("/XD", (Join-Path $Source $dir)) }
    foreach ($file in $ExcludeFiles) { $args += @("/XF", $file) }
    & robocopy @args | Out-Null
    if ($LASTEXITCODE -gt 7) {
        throw "Copy failed from $Source to $Destination with robocopy exit code $LASTEXITCODE."
    }
    $global:LASTEXITCODE = 0
}

function Convert-ToWixPath {
    param([string]$Path)
    return $Path.Replace("\", "\\")
}

function New-WixId {
    param([string]$Prefix, [string]$Value)
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Value.ToLowerInvariant())
    $hash = [System.Security.Cryptography.SHA1]::Create().ComputeHash($bytes)
    $hex = -join ($hash | ForEach-Object { $_.ToString("x2") })
    return "$Prefix$($hex.Substring(0, 32))"
}

function Get-RelativePath {
    param([string]$Base, [string]$Path)
    $baseUri = [Uri]($Base.TrimEnd("\") + "\")
    $pathUri = [Uri]$Path
    return [Uri]::UnescapeDataString($baseUri.MakeRelativeUri($pathUri).ToString()).Replace("/", "\")
}

function Add-DirectoryXml {
    param(
        [System.Text.StringBuilder]$Builder,
        [System.Collections.Generic.List[string]]$ComponentIds,
        [string]$DirectoryPath,
        [string]$DirectoryId,
        [int]$Indent
    )

    $indentText = " " * $Indent
    $name = [System.Security.SecurityElement]::Escape((Split-Path -Leaf $DirectoryPath))
    [void]$Builder.AppendLine("$indentText<Directory Id=`"$DirectoryId`" Name=`"$name`">")

    $files = Get-ChildItem -LiteralPath $DirectoryPath -File -Force | Sort-Object Name
    foreach ($file in $files) {
        $relative = Get-RelativePath -Base $Payload -Path $file.FullName
        $componentId = New-WixId -Prefix "cmp" -Value $relative
        $ComponentIds.Add($componentId) | Out-Null
        $fileId = New-WixId -Prefix "fil" -Value $relative
        $source = [System.Security.SecurityElement]::Escape($file.FullName)
        $fileName = [System.Security.SecurityElement]::Escape($file.Name)
        [void]$Builder.AppendLine("$indentText  <Component Id=`"$componentId`" Guid=`"*`">")
        [void]$Builder.AppendLine("$indentText    <File Id=`"$fileId`" Source=`"$source`" Name=`"$fileName`" KeyPath=`"yes`" />")
        [void]$Builder.AppendLine("$indentText  </Component>")
    }

    $directories = Get-ChildItem -LiteralPath $DirectoryPath -Directory -Force | Sort-Object Name
    foreach ($directory in $directories) {
        $relative = Get-RelativePath -Base $Payload -Path $directory.FullName
        $childId = New-WixId -Prefix "dir" -Value $relative
        Add-DirectoryXml -Builder $Builder -ComponentIds $ComponentIds -DirectoryPath $directory.FullName -DirectoryId $childId -Indent ($Indent + 2)
    }

    [void]$Builder.AppendLine("$indentText</Directory>")
}

if (-not $SkipVerify) {
    Write-Host "Verifying logic, algorithms, import/export, and setup before MSI packaging..."
    Invoke-Checked -FilePath "npm.cmd" -Arguments @("run", "check")
    Invoke-Checked -FilePath "npm.cmd" -Arguments @("run", "test:full")
    Invoke-Checked -FilePath "npm.cmd" -Arguments @("test") -WorkingDirectory (Join-Path $Root "atlas-hcm-next")
    Invoke-Checked -FilePath "npm.cmd" -Arguments @("run", "build") -WorkingDirectory (Join-Path $Root "atlas-hcm-next")
    Invoke-Checked -FilePath "npm.cmd" -Arguments @("run", "setup:troubleshoot")
}

if (Test-Path $StageRoot) {
    Remove-Item -LiteralPath $StageRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $Payload, $Runtime, $OutputDir -Force | Out-Null

Write-Host "Copying application files into MSI payload..."
Copy-Tree -Source $Root -Destination $Payload -ExcludeDirs @(
    ".git",
    "artifacts",
    "backups",
    "docs",
    "installer",
    "logs",
    "redist",
    "tests",
    "test-reports",
    "tmp",
    "atlas-hcm-next\.next",
    "atlas-hcm-next\logs",
    "atlas-hcm-next\node_modules",
    "atlas-hcm-next\tests"
) -ExcludeFiles @(
    ".env",
    ".env.*",
    "*.bak",
    "*.log",
    "*.tmp"
)

Copy-Tree -Source $PSScriptRoot -Destination $Payload -ExcludeDirs @("stage") -ExcludeFiles @("Build-ATLAS-MSI.ps1")

$nodeSource = Split-Path -Parent (Get-Command node.exe -ErrorAction Stop).Source
Copy-Tree -Source $nodeSource -Destination $Runtime

foreach ($folder in @("logs", "backups", "test-reports")) {
    New-Item -ItemType Directory -Path (Join-Path $Payload $folder) -Force | Out-Null
}

Write-Host "Generating WiX package source..."
$builder = [System.Text.StringBuilder]::new()
$componentIds = [System.Collections.Generic.List[string]]::new()
[void]$builder.AppendLine('<?xml version="1.0" encoding="UTF-8"?>')
[void]$builder.AppendLine('<Wix xmlns="http://wixtoolset.org/schemas/v4/wxs" xmlns:ui="http://wixtoolset.org/schemas/v4/wxs/ui">')
[void]$builder.AppendLine("  <Package Name=`"ATLAS Airfare Allowance`" Manufacturer=`"ATLAS`" Version=`"$Version`" UpgradeCode=`"$UpgradeCode`" Scope=`"perMachine`">")
    [void]$builder.AppendLine('    <Launch Condition="Privileged" Message="ATLAS Airfare Allowance must be installed with administrator rights. Right-click the MSI and choose Run as administrator, or install from an elevated Command Prompt." />')
[void]$builder.AppendLine('    <MajorUpgrade DowngradeErrorMessage="A newer version of ATLAS Airfare Allowance is already installed." />')
[void]$builder.AppendLine('    <MediaTemplate EmbedCab="yes" CompressionLevel="high" />')
[void]$builder.AppendLine('    <Property Id="ATLASPORT" Value="3355" />')
[void]$builder.AppendLine('    <Property Id="DB_SERVER" Value="localhost\ATLAS" />')
[void]$builder.AppendLine('    <Property Id="DB_PORT" Value="1433" />')
[void]$builder.AppendLine('    <Property Id="DB_NAME" Value="Atlasairfare010" />')
[void]$builder.AppendLine('    <Property Id="DB_USER" Value="sa" />')
[void]$builder.AppendLine('    <Property Id="DB_PASSWORD" Hidden="yes" />')
[void]$builder.AppendLine('    <Property Id="DB_ODBC_DRIVER" Value="ODBC Driver 18 for SQL Server" />')
[void]$builder.AppendLine('    <Property Id="DB_AUTO_SETUP" Value="1" />')
[void]$builder.AppendLine('    <StandardDirectory Id="ProgramFiles64Folder">')
[void]$builder.AppendLine('      <Directory Id="INSTALLFOLDER" Name="ATLAS Airfare Allowance">')

$rootFiles = Get-ChildItem -LiteralPath $Payload -File -Force | Sort-Object Name
foreach ($file in $rootFiles) {
    $relative = Get-RelativePath -Base $Payload -Path $file.FullName
    $componentId = New-WixId -Prefix "cmp" -Value $relative
    $componentIds.Add($componentId) | Out-Null
    $fileId = New-WixId -Prefix "fil" -Value $relative
    $source = [System.Security.SecurityElement]::Escape($file.FullName)
    $fileName = [System.Security.SecurityElement]::Escape($file.Name)
    [void]$builder.AppendLine("        <Component Id=`"$componentId`" Guid=`"*`">")
    [void]$builder.AppendLine("          <File Id=`"$fileId`" Source=`"$source`" Name=`"$fileName`" KeyPath=`"yes`" />")
    [void]$builder.AppendLine('        </Component>')
}

$registryComponentId = "cmpAtlasInstallConfigurationRegistry"
$componentIds.Add($registryComponentId) | Out-Null
[void]$builder.AppendLine("        <Component Id=`"$registryComponentId`" Guid=`"*`">")
[void]$builder.AppendLine('          <RegistryKey Root="HKLM" Key="SOFTWARE\ATLAS Airfare Allowance">')
[void]$builder.AppendLine('            <RegistryValue Name="ATLASPORT" Type="string" Value="[ATLASPORT]" KeyPath="yes" />')
[void]$builder.AppendLine('            <RegistryValue Name="DB_SERVER" Type="string" Value="[DB_SERVER]" />')
[void]$builder.AppendLine('            <RegistryValue Name="DB_PORT" Type="string" Value="[DB_PORT]" />')
[void]$builder.AppendLine('            <RegistryValue Name="DB_NAME" Type="string" Value="[DB_NAME]" />')
[void]$builder.AppendLine('            <RegistryValue Name="DB_USER" Type="string" Value="[DB_USER]" />')
[void]$builder.AppendLine('            <RegistryValue Name="DB_PASSWORD" Type="string" Value="[DB_PASSWORD]" />')
[void]$builder.AppendLine('            <RegistryValue Name="DB_ODBC_DRIVER" Type="string" Value="[DB_ODBC_DRIVER]" />')
[void]$builder.AppendLine('            <RegistryValue Name="DB_AUTO_SETUP" Type="string" Value="[DB_AUTO_SETUP]" />')
[void]$builder.AppendLine('          </RegistryKey>')
[void]$builder.AppendLine('        </Component>')

$rootDirs = Get-ChildItem -LiteralPath $Payload -Directory -Force | Sort-Object Name
foreach ($directory in $rootDirs) {
    $relative = Get-RelativePath -Base $Payload -Path $directory.FullName
    $directoryId = New-WixId -Prefix "dir" -Value $relative
    Add-DirectoryXml -Builder $builder -ComponentIds $componentIds -DirectoryPath $directory.FullName -DirectoryId $directoryId -Indent 8
}

[void]$builder.AppendLine('      </Directory>')
[void]$builder.AppendLine('    </StandardDirectory>')
[void]$builder.AppendLine('    <Feature Id="MainFeature" Title="ATLAS Airfare Allowance" Level="1">')
foreach ($componentId in $componentIds) {
    [void]$builder.AppendLine("      <ComponentRef Id=`"$componentId`" />")
}
[void]$builder.AppendLine('    </Feature>')
[void]$builder.AppendLine('    <CustomAction Id="LaunchAtlasTroubleshooter" Directory="INSTALLFOLDER" ExeCommand="cmd.exe /c &quot;[INSTALLFOLDER]ATLAS-Troubleshooter.bat&quot;" Return="asyncNoWait" />')
[void]$builder.AppendLine('    <ui:WixUI Id="WixUI_Minimal" />')
[void]$builder.AppendLine('    <UI>')
[void]$builder.AppendLine('      <Dialog Id="AtlasWelcomeDlg" Width="370" Height="270" Title="[ProductName] Setup">')
[void]$builder.AppendLine('        <Control Id="Title" Type="Text" X="20" Y="18" Width="330" Height="24" Transparent="yes" NoPrefix="yes" Text="{\WixUI_Font_Title}ATLAS Airfare Allowance" />')
[void]$builder.AppendLine('        <Control Id="Body" Type="Text" X="20" Y="55" Width="330" Height="90" Text="Install ATLAS with a bundled Node runtime, frontend, backend, database scripts, and Windows Server tools. The next screen asks for MSSQL, ODBC, and local SQL auto-setup settings before installation starts." />')
[void]$builder.AppendLine('        <Control Id="AdminNote" Type="Text" X="20" Y="150" Width="330" Height="36" Text="Administrator rights are required on Windows Server 2019." />')
[void]$builder.AppendLine('        <Control Id="Install" Type="PushButton" X="166" Y="243" Width="62" Height="17" Default="yes" Text="Install">')
[void]$builder.AppendLine('          <Publish Event="NewDialog" Value="AtlasConfigDlg" />')
[void]$builder.AppendLine('        </Control>')
[void]$builder.AppendLine('        <Control Id="Repair" Type="PushButton" X="232" Y="243" Width="62" Height="17" Text="Repair">')
[void]$builder.AppendLine('          <Publish Property="REINSTALL" Value="ALL" />')
[void]$builder.AppendLine('          <Publish Property="REINSTALLMODE" Value="amus" />')
[void]$builder.AppendLine('          <Publish Event="EndDialog" Value="Return" />')
[void]$builder.AppendLine('        </Control>')
[void]$builder.AppendLine('        <Control Id="Cancel" Type="PushButton" X="298" Y="243" Width="62" Height="17" Cancel="yes" Text="Cancel">')
[void]$builder.AppendLine('          <Publish Event="EndDialog" Value="Exit" />')
[void]$builder.AppendLine('        </Control>')
[void]$builder.AppendLine('      </Dialog>')
[void]$builder.AppendLine('      <Dialog Id="AtlasMaintenanceDlg" Width="370" Height="270" Title="[ProductName] Maintenance">')
[void]$builder.AppendLine('        <Control Id="Title" Type="Text" X="20" Y="18" Width="330" Height="24" Transparent="yes" NoPrefix="yes" Text="{\WixUI_Font_Title}Repair or troubleshoot ATLAS" />')
[void]$builder.AppendLine('        <Control Id="Body" Type="Text" X="20" Y="55" Width="330" Height="90" Text="Choose Repair to reinstall missing files, or Troubleshooter to run ATLAS setup diagnostics." />')
[void]$builder.AppendLine('        <Control Id="Repair" Type="PushButton" X="118" Y="243" Width="74" Height="17" Default="yes" Text="Repair">')
[void]$builder.AppendLine('          <Publish Property="REINSTALL" Value="ALL" />')
[void]$builder.AppendLine('          <Publish Property="REINSTALLMODE" Value="amus" />')
[void]$builder.AppendLine('          <Publish Event="EndDialog" Value="Return" />')
[void]$builder.AppendLine('        </Control>')
[void]$builder.AppendLine('        <Control Id="Troubleshooter" Type="PushButton" X="196" Y="243" Width="86" Height="17" Text="Troubleshooter">')
[void]$builder.AppendLine('          <Publish Event="DoAction" Value="LaunchAtlasTroubleshooter" />')
[void]$builder.AppendLine('        </Control>')
[void]$builder.AppendLine('        <Control Id="Cancel" Type="PushButton" X="286" Y="243" Width="74" Height="17" Cancel="yes" Text="Cancel">')
[void]$builder.AppendLine('          <Publish Event="EndDialog" Value="Exit" />')
[void]$builder.AppendLine('        </Control>')
[void]$builder.AppendLine('      </Dialog>')
[void]$builder.AppendLine('      <Dialog Id="AtlasConfigDlg" Width="370" Height="286" Title="[ProductName] MSSQL and ODBC Setup">')
[void]$builder.AppendLine('        <Control Id="Title" Type="Text" X="20" Y="12" Width="330" Height="20" Transparent="yes" NoPrefix="yes" Text="{\WixUI_Font_Title}MSSQL and ODBC configuration" />')
[void]$builder.AppendLine('        <Control Id="Intro" Type="Text" X="20" Y="36" Width="330" Height="22" Text="Enter the Windows Server 2019 SQL connection settings." />')
[void]$builder.AppendLine('        <Control Id="AppPortLabel" Type="Text" X="20" Y="65" Width="105" Height="14" Text="ATLAS app port" />')
[void]$builder.AppendLine('        <Control Id="AppPortEdit" Type="Edit" X="132" Y="62" Width="210" Height="16" Property="ATLASPORT" />')
[void]$builder.AppendLine('        <Control Id="DbServerLabel" Type="Text" X="20" Y="88" Width="105" Height="14" Text="MSSQL server/instance" />')
[void]$builder.AppendLine('        <Control Id="DbServerEdit" Type="Edit" X="132" Y="85" Width="210" Height="16" Property="DB_SERVER" />')
[void]$builder.AppendLine('        <Control Id="DbPortLabel" Type="Text" X="20" Y="111" Width="105" Height="14" Text="MSSQL TCP port" />')
[void]$builder.AppendLine('        <Control Id="DbPortEdit" Type="Edit" X="132" Y="108" Width="210" Height="16" Property="DB_PORT" />')
[void]$builder.AppendLine('        <Control Id="DbNameLabel" Type="Text" X="20" Y="134" Width="105" Height="14" Text="Database name" />')
[void]$builder.AppendLine('        <Control Id="DbNameEdit" Type="Edit" X="132" Y="131" Width="210" Height="16" Property="DB_NAME" />')
[void]$builder.AppendLine('        <Control Id="DbUserLabel" Type="Text" X="20" Y="157" Width="105" Height="14" Text="MSSQL login" />')
[void]$builder.AppendLine('        <Control Id="DbUserEdit" Type="Edit" X="132" Y="154" Width="210" Height="16" Property="DB_USER" />')
[void]$builder.AppendLine('        <Control Id="DbPasswordLabel" Type="Text" X="20" Y="180" Width="105" Height="14" Text="MSSQL password" />')
[void]$builder.AppendLine('        <Control Id="DbPasswordEdit" Type="Edit" X="132" Y="177" Width="210" Height="16" Property="DB_PASSWORD" Password="yes" />')
[void]$builder.AppendLine('        <Control Id="OdbcLabel" Type="Text" X="20" Y="203" Width="105" Height="14" Text="ODBC driver name" />')
[void]$builder.AppendLine('        <Control Id="OdbcEdit" Type="Edit" X="132" Y="200" Width="210" Height="16" Property="DB_ODBC_DRIVER" />')
[void]$builder.AppendLine('        <Control Id="AutoSql" Type="CheckBox" X="132" Y="222" Width="210" Height="14" Property="DB_AUTO_SETUP" CheckBoxValue="1" Text="Auto setup local SQL Express if missing" />')
[void]$builder.AppendLine('        <Control Id="Back" Type="PushButton" X="166" Y="259" Width="62" Height="17" Text="Back">')
[void]$builder.AppendLine('          <Publish Event="NewDialog" Value="AtlasWelcomeDlg" />')
[void]$builder.AppendLine('        </Control>')
[void]$builder.AppendLine('        <Control Id="Install" Type="PushButton" X="232" Y="259" Width="62" Height="17" Default="yes" Text="Install">')
[void]$builder.AppendLine('          <Publish Event="EndDialog" Value="Return" />')
[void]$builder.AppendLine('        </Control>')
[void]$builder.AppendLine('        <Control Id="Cancel" Type="PushButton" X="298" Y="259" Width="62" Height="17" Cancel="yes" Text="Cancel">')
[void]$builder.AppendLine('          <Publish Event="EndDialog" Value="Exit" />')
[void]$builder.AppendLine('        </Control>')
[void]$builder.AppendLine('      </Dialog>')
[void]$builder.AppendLine('      <InstallUISequence>')
[void]$builder.AppendLine('        <Show Dialog="AtlasWelcomeDlg" Before="ExecuteAction" Condition="NOT Installed" />')
[void]$builder.AppendLine('        <Show Dialog="AtlasMaintenanceDlg" Before="ExecuteAction" Condition="Installed" />')
[void]$builder.AppendLine('      </InstallUISequence>')
[void]$builder.AppendLine('    </UI>')
[void]$builder.AppendLine('  </Package>')
[void]$builder.AppendLine('</Wix>')

$builder.ToString() | Set-Content -Path $WxsPath -Encoding UTF8

Write-Host "Building MSI with WiX..."
Invoke-Checked -FilePath "wix.exe" -Arguments @("build", $WxsPath, "-ext", "WixToolset.UI.wixext", "-arch", "x64", "-o", $MsiPath)

$hash = Get-FileHash -Algorithm SHA256 -Path $MsiPath
$reportPath = Join-Path $OutputDir "ATLAS-Airfare-Allowance-$Version-x64-msi-report.md"
@(
    "# ATLAS MSI Build Report",
    "",
    "- MSI: $MsiPath",
    "- SHA256: $($hash.Hash)",
    "- Version: $Version",
    "- Built: $((Get-Date).ToString("o"))",
    "- Bundle: production app files, backend node_modules, frontend static export, database scripts, installer tools, bundled Node runtime",
    "- First-run configuration: prompts for MSSQL server, MSSQL port, app port, database, SQL login/password, ODBC driver, and local SQL auto-setup",
    "- SQL preparation: includes optional local SQL Express setup handoff, database creation, and bundled schema/object application",
    "- Repair/troubleshooter launchers: included in installed folder",
    "- Hostname policy: no hardcoded customer/server network names"
) | Set-Content -Path $reportPath -Encoding UTF8

Write-Host "MSI created: $MsiPath" -ForegroundColor Green
Write-Host "SHA256: $($hash.Hash)"
Write-Host "Report: $reportPath"
