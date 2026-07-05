param(
    [ValidateSet("Build", "Preflight", "Install", "Repair", "Troubleshoot", "Backup", "UpdateOnlyPrepare", "UpdateOnlyFinalize")]
    [string]$Mode = "Build",

    [int]$Port = 3355,
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
    [string]$AppMsi = "C:\Airfare_Allowance\artifacts\ATLAS-Airfare-Allowance-2.3.23-x64.msi",
    [string]$SqlExpressSetupExe = "C:\Airfare_Allowance\redist\SQLEXPR_x64_ENU.exe",
    [string]$Output = "C:\Airfare_Allowance\artifacts\ATLAS-Airfare-Allowance-Setup-2.3.23-x64.exe"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

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
    param([string]$DataPath)
    $path = Get-BootstrapConfigPath -DataPath $DataPath
    if (-not (Test-Path $path)) { return $null }
    try {
        return (Get-Content -LiteralPath $path -Raw | ConvertFrom-Json)
    } catch {
        return $null
    }
}

function Write-BootstrapConfig {
    param(
        [string]$DataPath,
        [int]$PortNumber,
        [int]$SqlPortNumber,
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

function Ensure-DataDirectories {
    param([string]$InstallPath, [string]$DataPath)
    foreach ($folder in @($InstallPath, $DataPath, (Join-Path $DataPath "logs"), (Join-Path $DataPath "database"), (Join-Path $DataPath "backups"))) {
        New-Item -ItemType Directory -Path $folder -Force | Out-Null
    }
}

function Stop-PreviousAtlasRuntime {
    param([string]$InstallPath)
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
        [int]$PortNumber,
        [string]$Password
    )
    $connectionString = "Server=tcp:127.0.0.1,$PortNumber;Database=master;User ID=sa;Password=$Password;Encrypt=False;TrustServerCertificate=True;Connection Timeout=10;"
    $connection = New-Object System.Data.SqlClient.SqlConnection($connectionString)
    try {
        $connection.Open()
        $command = $connection.CreateCommand()
        $command.CommandText = "SELECT @@SERVERNAME"
        [void]$command.ExecuteScalar()
        return $true
    } catch {
        Write-Step "SQL TCP login failed on 127.0.0.1:$PortNumber as sa: $($_.Exception.Message)"
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
    $candidates = Get-ChildItem -Path $PSScriptRoot -Recurse -File -Filter "SQLEXPR*.exe" -ErrorAction SilentlyContinue |
        Sort-Object Length -Descending
    return @($candidates | Select-Object -First 1)[0]
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
        throw "Bundled SQL Express installer was not found in bootstrapper cache."
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

    $selectedSetupAction = $SetupAction
    Write-Host "Choose setup action:" -ForegroundColor Cyan
    Write-Host "  1. Install / New"
    Write-Host "  2. Update existing"
    Write-Host "  3. Repair existing"
    Write-Host "  4. Troubleshoot only"
    $rawAction = Read-Host "Setup action [1]"
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
        Ensure-SqlService -InstanceName $selectedInstance
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
        [string]$SqlText
    )
    $connection = New-Object System.Data.SqlClient.SqlConnection($ConnectionString)
    try {
        $connection.Open()
        $batches = [regex]::Split($SqlText, "(?im)^\s*GO\s*(?:--.*)?$")
        foreach ($batch in $batches) {
            if (-not $batch.Trim()) { continue }
            $command = $connection.CreateCommand()
            $command.CommandTimeout = 180
            $command.CommandText = $batch
            [void]$command.ExecuteNonQuery()
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

    $oldPassword = $env:ATLAS_ADMIN_PASSWORD
    try {
        $env:ATLAS_ADMIN_PASSWORD = $Password
        $script = "const bcrypt=require('bcryptjs'); const p=process.env.ATLAS_ADMIN_PASSWORD || ''; if (!p) process.exit(2); process.stdout.write(bcrypt.hashSync(p, 12));"
        $hash = & $node -e $script 2>$null
        if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($hash)) {
            throw "Unable to generate application admin password hash."
        }
        return ([string]$hash).Trim()
    } finally {
        if ($null -eq $oldPassword) {
            Remove-Item Env:\ATLAS_ADMIN_PASSWORD -ErrorAction SilentlyContinue
        } else {
            $env:ATLAS_ADMIN_PASSWORD = $oldPassword
        }
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
        [string]$Password,
        [string]$InstallPath,
        [string]$CompanyCodeValue,
        [string]$CompanyNameValue,
        [string]$AdminUsernameValue,
        [string]$AdminPasswordValue
    )
    $server = Get-SqlServerName -InstanceName $InstanceName
    $master = "Server=$server;Database=master;User ID=sa;Password=$Password;Encrypt=False;TrustServerCertificate=True;Connection Timeout=15;"
    $appDb = "Atlasairfare010"

    $dbExists = [int](Invoke-SqlScalar -ConnectionString $master -SqlText "SELECT CASE WHEN DB_ID(N'$appDb') IS NULL THEN 0 ELSE 1 END;")
    Invoke-SqlBatch -ConnectionString $master -SqlText "IF DB_ID(N'$appDb') IS NULL CREATE DATABASE [$appDb];"
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
        Invoke-SqlBatch -ConnectionString $appConnection -SqlText $sql
    }

    $adminHash = New-AtlasPasswordHash -InstallPath $InstallPath -Password $AdminPasswordValue
    Ensure-AtlasFirstRunAdmin `
        -ConnectionString $appConnection `
        -DatabaseName $appDb `
        -CompanyCodeValue $CompanyCodeValue `
        -CompanyNameValue $CompanyNameValue `
        -AdminUsernameValue $AdminUsernameValue `
        -AdminPasswordHash $adminHash
}

function Write-AtlasConfig {
    param(
        [string]$InstallPath,
        [int]$PortNumber,
        [int]$SqlPortNumber,
        [string]$InstanceName,
        [string]$Password
    )
    $secretBytes = New-Object byte[] 48
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($secretBytes)
    $secret = [Convert]::ToBase64String($secretBytes)

    $content = @"
PORT=$PortNumber
HOST=0.0.0.0
DB_SERVER=127.0.0.1
DB_PORT=$SqlPortNumber
DB_NAME=Atlasairfare010
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
        DB_NAME = "Atlasairfare010"
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
    $effectiveSqlPort = $currentSqlPort
    if ($effectiveSqlPort -gt 0 -and (Test-TcpPort -Server "127.0.0.1" -PortNumber $effectiveSqlPort)) {
        Write-Step "Update patch kept existing reachable MSSQL port 127.0.0.1:$effectiveSqlPort."
    } else {
        $effectiveSqlInstance = Resolve-SqlInstance -RequestedInstance $SqlInstance
        Ensure-SqlService -InstanceName $effectiveSqlInstance
        $detectedSqlPort = Resolve-SqlTcpPort -InstanceName $effectiveSqlInstance -RequestedPort 0
        if ($detectedSqlPort -gt 0 -and (Test-TcpPort -Server "127.0.0.1" -PortNumber $detectedSqlPort)) {
            $effectiveSqlPort = $detectedSqlPort
            Write-Step "Update patch repaired MSSQL port to detected local SQL port 127.0.0.1:$effectiveSqlPort."
        } elseif ($currentSqlPort -gt 0) {
            Enable-SqlTcpPort -InstanceName $effectiveSqlInstance -PortNumber $currentSqlPort
            $effectiveSqlPort = $currentSqlPort
            Write-Step "Update patch restored SQL TCP/IP on existing configured port 127.0.0.1:$effectiveSqlPort."
        } else {
            $effectiveSqlPort = 1433
            Enable-SqlTcpPort -InstanceName $effectiveSqlInstance -PortNumber $effectiveSqlPort
            Write-Step "Update patch created missing MSSQL port configuration on 127.0.0.1:$effectiveSqlPort."
        }
    }

    if (-not $settings.Contains("DB_PORT") -or [string]$settings["DB_PORT"] -ne [string]$effectiveSqlPort) {
        $settings["DB_PORT"] = [string]$effectiveSqlPort
        $changed = $true
    }
    if ($settings.Contains("DB_SERVER") -and [string]$settings["DB_SERVER"] -match '\\') {
        $settings["DB_SERVER"] = "127.0.0.1"
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
    param([int]$PortNumber)
    try {
        $response = Invoke-RestMethod -Uri "http://127.0.0.1:$PortNumber/api/health" -TimeoutSec 10
        return ($response.status -eq "healthy" -and $response.database -eq "connected")
    } catch {
        return $false
    }
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
    try {
        Ensure-DataDirectories -InstallPath $InstallRoot -DataPath $DataRoot
    } catch {
        Write-Step "Warning: update prepare could not create/check folders yet: $($_.Exception.Message)"
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
    try {
        Assert-AtlasInstalledForPatch
        Ensure-DataDirectories -InstallPath $InstallRoot -DataPath $DataRoot
        $report = Join-Path $DataRoot ("logs\update-finalize-{0}.txt" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
        "ATLAS update finalize $(Get-Date -Format o)" | Set-Content -Path $report -Encoding UTF8
        "InstallRoot=$InstallRoot" | Add-Content $report
        "DataRoot=$DataRoot" | Add-Content $report

        $config = Repair-AtlasConfigForPatch -InstallPath $InstallRoot
        $effectivePort = [int]$config.AppPort
        "AppPort=$effectivePort" | Add-Content $report
        "SqlPort=$($config.SqlPort)" | Add-Content $report

        try {
            Start-Atlas -InstallPath $InstallRoot
            Start-Sleep -Seconds 8
        } catch {
            "StartWarning=$($_.Exception.Message)" | Add-Content $report
            Write-Step "Warning: ATLAS startup could not be completed automatically: $($_.Exception.Message)"
        }

        if (-not (Test-AtlasHealth -PortNumber $effectivePort)) {
            "Health=NotReady" | Add-Content $report
            Write-Step "Warning: ATLAS did not become healthy on http://127.0.0.1:$effectivePort/api/health yet. Patch files were installed; run Troubleshooter if needed."
            return
        }
        "Health=Healthy" | Add-Content $report
        Write-Step "Update-only patch completed. ATLAS is healthy on http://127.0.0.1:$effectivePort/."
    } catch {
        try {
            if (-not $report) {
                New-Item -ItemType Directory -Path (Join-Path $DataRoot "logs") -Force | Out-Null
                $report = Join-Path $DataRoot ("logs\update-finalize-{0}.txt" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
                "ATLAS update finalize $(Get-Date -Format o)" | Set-Content -Path $report -Encoding UTF8
            }
            "FinalizeWarning=$($_.Exception.Message)" | Add-Content $report
        } catch {}
        Write-Step "Warning: update finalize had a problem, but patch files remain installed: $($_.Exception.Message)"
        return
    }
}

function Invoke-Preflight {
    Prompt-AtlasInstallSettings
    $hostInfo = Get-AtlasHostInfo
    Write-Step "Host detected: $($hostInfo.HostName), loopback: $($hostInfo.Loopback), port: $Port"
}

function Invoke-InstallOrRepair {
    param([switch]$Repair)
    Assert-Admin
    Ensure-DataDirectories -InstallPath $InstallRoot -DataPath $DataRoot
    Stop-PreviousAtlasRuntime -InstallPath $InstallRoot
    New-Backup -InstallPath $InstallRoot -DataPath $DataRoot | Out-Null

    $saved = Read-BootstrapConfig -DataPath $DataRoot
    $SqlPort = 1433
    if ($saved) {
        if ($saved.Port) { $Port = [int]$saved.Port }
        if ($saved.SqlPort) { $SqlPort = [int]$saved.SqlPort }
        if ($saved.SqlInstance) { $SqlInstance = [string]$saved.SqlInstance }
        if ($saved.SqlSaPassword) { $SqlSaPassword = [string]$saved.SqlSaPassword }
        if ($saved.CompanyCode) { $CompanyCode = [string]$saved.CompanyCode }
        if ($saved.CompanyName) { $CompanyName = [string]$saved.CompanyName }
        if ($saved.AdminUsername) { $AdminUsername = [string]$saved.AdminUsername }
        if ($saved.AdminPassword) { $AdminPassword = [string]$saved.AdminPassword }
        if ($saved.SetupAction) { $SetupAction = [string]$saved.SetupAction }
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
    if (-not $AdminPassword) {
        throw "Application admin password was not collected. Re-run setup and complete the ATLAS setup configuration prompt."
    }

    Install-SqlExpressIfMissing -InstanceName $effectiveSqlInstance -Password $SqlSaPassword
    $effectiveSqlInstance = Resolve-SqlInstance -RequestedInstance $effectiveSqlInstance
    Ensure-SqlService -InstanceName $effectiveSqlInstance
    if (-not (Test-SqlLogin -InstanceName $effectiveSqlInstance -Password $SqlSaPassword)) {
        throw "MSSQL login verification failed during configuration."
    }
    $SqlPort = Resolve-SqlTcpPort -InstanceName $effectiveSqlInstance -RequestedPort $SqlPort
    if (-not (Test-TcpPort -Server "127.0.0.1" -PortNumber $SqlPort)) {
        throw "MSSQL TCP port 127.0.0.1:$SqlPort is not reachable after configuration. Enable SQL Server TCP/IP or choose the correct MSSQL port."
    }
    if (-not (Test-SqlLoginTcp -PortNumber $SqlPort -Password $SqlSaPassword)) {
        throw "MSSQL sa login over TCP failed on 127.0.0.1:$SqlPort. Re-run setup and enter the correct SQL port/password."
    }
    Write-Step "MSSQL TCP login confirmed on 127.0.0.1:$SqlPort."
    Write-AtlasConfig -InstallPath $InstallRoot -PortNumber $Port -SqlPortNumber $SqlPort -InstanceName $effectiveSqlInstance -Password $SqlSaPassword
    Ensure-AtlasDatabase `
        -InstanceName $effectiveSqlInstance `
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
        "/MEDIAPATH=`"$mediaDir`"",
        "/QUIET"
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
    if (-not (Test-Path $SqlExpressSetupExe)) {
        Write-Step "SQL Server Express redistributable is missing. Downloading from Microsoft..."
        Save-SqlExpressRedistributable -Destination $SqlExpressSetupExe
    }
    if (-not (Test-Path $SqlExpressSetupExe)) {
        throw "SQL Server Express redistributable is still missing: $SqlExpressSetupExe"
    }
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

if ($script:TranscriptStarted) {
    try { Stop-Transcript | Out-Null } catch {}
}
