param(
    [string]$Server = "localhost\ATLAS",
    [string]$Database = "Atlasairfare010",
    [string]$Username = "admin",
    [string]$NewPassword = "Admin123!",
    [string]$SqlUser = "",
    [string]$SqlPassword = "",
    [switch]$Execute
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$bcryptModule = Join-Path $repoRoot "node_modules\bcryptjs"

if (-not (Test-Path $bcryptModule)) {
    throw "bcryptjs was not found at $bcryptModule. Run npm install in $repoRoot first."
}

$nodeScript = Join-Path ([System.IO.Path]::GetTempPath()) ("atlas-reset-admin-hash-" + [Guid]::NewGuid().ToString("N") + ".js")
$sqlScript = Join-Path ([System.IO.Path]::GetTempPath()) ("atlas-reset-admin-password-" + [Guid]::NewGuid().ToString("N") + ".sql")

try {
    @"
const bcrypt = require(process.argv[2]);
const password = process.env.ATLAS_LOCAL_RESET_PASSWORD || "";
if (!password || password.length < 8) {
  console.error("Password must be at least 8 characters.");
  process.exit(2);
}
process.stdout.write(bcrypt.hashSync(password, 12));
"@ | Set-Content -LiteralPath $nodeScript -Encoding UTF8

    $env:ATLAS_LOCAL_RESET_PASSWORD = $NewPassword
    $hash = (& node $nodeScript $bcryptModule)
    if ($LASTEXITCODE -ne 0 -or -not $hash) {
        throw "bcrypt hash generation failed."
    }
    $env:ATLAS_LOCAL_RESET_PASSWORD = $null

    $escapedUsername = $Username.Replace("'", "''")
    $escapedHash = $hash.Replace("'", "''")

    @"
SET NOCOUNT ON;

IF OBJECT_ID(N'dbo.Users', N'U') IS NULL
    THROW 50901, 'dbo.Users table was not found in the selected ATLAS database.', 1;

IF COL_LENGTH(N'dbo.Users', N'UserID') IS NULL
    THROW 50902, 'dbo.Users.UserID column was not found.', 1;
IF COL_LENGTH(N'dbo.Users', N'Username') IS NULL
    THROW 50903, 'dbo.Users.Username column was not found.', 1;
IF COL_LENGTH(N'dbo.Users', N'PasswordHash') IS NULL
    THROW 50904, 'dbo.Users.PasswordHash column was not found.', 1;
IF COL_LENGTH(N'dbo.Users', N'Role') IS NULL
    THROW 50905, 'dbo.Users.Role column was not found.', 1;
IF COL_LENGTH(N'dbo.Users', N'IsActive') IS NULL
    THROW 50906, 'dbo.Users.IsActive column was not found.', 1;

DECLARE @Username NVARCHAR(50) = N'$escapedUsername';
DECLARE @PasswordHash NVARCHAR(255) = N'$escapedHash';
DECLARE @UserID INT;

SELECT TOP (1) @UserID = UserID
FROM dbo.Users
WHERE Username = @Username;

IF @UserID IS NULL
BEGIN
    SELECT TOP (1) @UserID = UserID
    FROM dbo.Users
    WHERE Role = N'admin'
    ORDER BY IsActive DESC, UserID;
END;

IF @UserID IS NULL
    THROW 50907, 'No admin/user record was found to reset.', 1;

SELECT
    'BEFORE' AS Stage,
    UserID,
    Username,
    Role,
    IsActive,
    LoginAttempts,
    LockedUntil,
    LastLogin
FROM dbo.Users
WHERE UserID = @UserID;

UPDATE dbo.Users
SET PasswordHash = @PasswordHash,
    IsActive = 1,
    LoginAttempts = 0,
    LockedUntil = NULL,
    PasswordChangedAt = CASE WHEN COL_LENGTH(N'dbo.Users', N'PasswordChangedAt') IS NOT NULL THEN SYSUTCDATETIME() ELSE PasswordChangedAt END,
    UpdatedAt = CASE WHEN COL_LENGTH(N'dbo.Users', N'UpdatedAt') IS NOT NULL THEN SYSUTCDATETIME() ELSE UpdatedAt END
WHERE UserID = @UserID;

SELECT
    'AFTER' AS Stage,
    UserID,
    Username,
    Role,
    IsActive,
    LoginAttempts,
    LockedUntil,
    LastLogin
FROM dbo.Users
WHERE UserID = @UserID;
"@ | Set-Content -LiteralPath $sqlScript -Encoding UTF8

    $authArgs = @()
    if ($SqlUser -and $SqlPassword) {
        $authArgs = @("-U", $SqlUser, "-P", $SqlPassword)
    } else {
        $authArgs = @("-E")
    }

    Write-Host "Target: $Server / $Database / user lookup '$Username'"
    Write-Host "Password hash generated with bcrypt cost 12 using local bcryptjs."

    if (-not $Execute) {
        Write-Host "DRY RUN ONLY. No database update was executed."
        Write-Host "To reset the password, rerun with -Execute."
        Write-Host "Example:"
        Write-Host "  powershell -ExecutionPolicy Bypass -File .\tools\Reset-ATLAS-LocalAdminPassword.ps1 -Username admin -NewPassword 'Admin123!' -Execute"
        exit 0
    }

    & sqlcmd -S $Server -d $Database @authArgs -b -i $sqlScript
    if ($LASTEXITCODE -ne 0) {
        throw "sqlcmd failed with exit code $LASTEXITCODE."
    }

    Write-Host "Local ATLAS admin password reset completed."
} finally {
    $env:ATLAS_LOCAL_RESET_PASSWORD = $null
    Remove-Item -LiteralPath $nodeScript -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $sqlScript -Force -ErrorAction SilentlyContinue
}
