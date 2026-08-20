[CmdletBinding()]
param(
    [string]$Server = "127.0.0.1",
    [string]$Database = "HCM_Airfare_Management",
    [string]$BackupDirectory = "C:\MSSQL\Backup",
    [int]$RetentionDays = 14
)

$ErrorActionPreference = "Stop"
if (-not $env:AIRFARE_DB_USER -or -not $env:AIRFARE_DB_PASSWORD) {
    throw "Set AIRFARE_DB_USER and AIRFARE_DB_PASSWORD before running a backup."
}

$timestamp = (Get-Date).ToUniversalTime().ToString("yyyyMMdd-HHmmss")
$backupFile = Join-Path $BackupDirectory "$Database-$timestamp.bak"
$escapedFile = $backupFile.Replace("'", "''")
$query = @"
BACKUP DATABASE [$Database]
TO DISK = N'$escapedFile'
WITH COPY_ONLY, COMPRESSION, CHECKSUM, INIT, STATS = 10;
RESTORE VERIFYONLY FROM DISK = N'$escapedFile' WITH CHECKSUM;
"@

& sqlcmd -S $Server -U $env:AIRFARE_DB_USER -P $env:AIRFARE_DB_PASSWORD -C -b -Q $query
if ($LASTEXITCODE -ne 0) {
    throw "MSSQL backup or verification failed."
}

Get-ChildItem -LiteralPath $BackupDirectory -Filter "$Database-*.bak" -File |
    Where-Object LastWriteTimeUtc -lt (Get-Date).ToUniversalTime().AddDays(-$RetentionDays) |
    Remove-Item -Force

Write-Output "Verified backup created: $backupFile"
