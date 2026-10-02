<#
.SYNOPSIS
    Backs the ATA-ERP databases up to files on E:, verifies each one, and keeps
    a rolling history.

.DESCRIPTION
    The databases live under C:\Program Files\Microsoft SQL Server\...\DATA,
    and the nightly Windows Server Backup covers D: and E: only - so the
    application's data was in no backup at all. This script has SQL Server
    write a native backup (.bak) onto E:, which the 8 PM Windows backup then
    carries to the separate backup disk with everything else on E:.

    A native backup rather than a copy of the .mdf: a data file copied while
    SQL Server is running is not a database anybody can restore, and a .bak is
    restorable on any SQL Server of the same or a newer version.

    Each file is written WITH CHECKSUM and then read back with
    RESTORE VERIFYONLY, because a backup nobody has read is a hope, not a
    backup. The script exits non-zero on any failure, writes a log beside the
    files, and records the last result in last-backup.json.

    Old files are removed only after a new one has verified, and never below
    -KeepAtLeast per database and tag, so a run of failures can never delete
    the last good copy.

.PARAMETER Tag
    "nightly" for the scheduled run, "predeploy" when deploy.ps1 calls it.
    Each tag keeps its own history.

.PARAMETER Register
    Registers the nightly run in Task Scheduler (daily at -At, default 19:30,
    half an hour before the Windows backup). Asks for the password of the
    account that runs it, which must be able to sign in to SQL Server as an
    administrator - the account you open SSMS with.

.EXAMPLE
    # one backup now
    powershell -ExecutionPolicy Bypass -File E:\Apps\ATA-ERP-Rev01\scripts\backup-db.ps1

.EXAMPLE
    # schedule it every evening
    powershell -ExecutionPolicy Bypass -File E:\Apps\ATA-ERP-Rev01\scripts\backup-db.ps1 -Register
#>
param(
    [string]  $AppDir      = "E:\Apps\ATA-ERP-Rev01",
    [string]  $BackupDir   = "E:\Backups\ATA-ERP",
    # Default: the database DATABASE_URL names, plus ERP_SQL_DATABASE (the
    # Power BI copy) when .env names one.
    [string[]]$Databases,
    # Default: the host and port DATABASE_URL names.
    [string]  $Server,
    # Default: Windows authentication as whoever runs the script. A SQL login
    # instead, for an account that is not a SQL Server administrator.
    [pscredential]$SqlCredential,
    [ValidateSet("nightly", "predeploy", "manual")]
    [string]  $Tag         = "nightly",
    [int]     $KeepDays    = 30,
    [int]     $KeepAtLeast = 7,
    [switch]  $Register,
    [string]  $At          = "19:30"
)

$ErrorActionPreference = "Stop"

function Info($msg) { Write-Host "    $msg"; Log "INFO  $msg" }
function Ok($msg)   { Write-Host "    OK - $msg" -ForegroundColor Green; Log "OK    $msg" }
function Bad($msg)  { Write-Host "    FAILED - $msg" -ForegroundColor Red; Log "FAIL  $msg" }
function Log($msg) {
    try {
        $line = "{0}  [{1}]  {2}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Tag, $msg
        Add-Content -Path (Join-Path $BackupDir "backup.log") -Value $line -Encoding UTF8
    } catch { }
}

# ------------------------------------------------------------- scheduling
if ($Register) {
    $taskName = "ATA-ERP-DB-Backup"
    $script   = $MyInvocation.MyCommand.Path
    $cred     = Get-Credential -UserName "$env:USERDOMAIN\$env:USERNAME" `
                    -Message "Account that runs the nightly database backup (must be a SQL Server administrator)"
    $action   = New-ScheduledTaskAction -Execute "powershell.exe" `
                    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$script`" -AppDir `"$AppDir`" -BackupDir `"$BackupDir`" -Tag nightly"
    $trigger  = New-ScheduledTaskTrigger -Daily -At $At
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 3)
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings `
        -User $cred.UserName -Password $cred.GetNetworkCredential().Password -RunLevel Highest -Force | Out-Null
    Write-Host "Registered '$taskName': every day at $At. Run it once now with:" -ForegroundColor Green
    Write-Host "    Start-ScheduledTask -TaskName $taskName"
    exit 0
}

New-Item -ItemType Directory -Force $BackupDir | Out-Null
Write-Host "`n[backup] Backing up the ATA-ERP databases to $BackupDir" -ForegroundColor Cyan

# ------------------------------------------------------- what to back up
$envFile = Join-Path $AppDir ".env"
$envText = if (Test-Path $envFile) { Get-Content $envFile -Raw } else { "" }

function EnvValue($name) {
    $m = [regex]::Match($envText, "(?m)^\s*$name\s*=\s*`"?([^`"\r\n]*)`"?")
    if ($m.Success) { return $m.Groups[1].Value.Trim() } else { return $null }
}

$url = EnvValue "DATABASE_URL"
if (-not $Server) {
    $m = [regex]::Match([string]$url, "sqlserver://([^;:/]+)(?::(\d+))?")
    if (-not $m.Success) { Bad "no -Server given and DATABASE_URL in $envFile names none"; exit 1 }
    $Server = $m.Groups[1].Value
    if ($m.Groups[2].Success) { $Server = "$Server,$($m.Groups[2].Value)" }
}
if (-not $Databases) {
    $Databases = @()
    $m = [regex]::Match([string]$url, "(?i)database=([^;]+)")
    if ($m.Success) { $Databases += $m.Groups[1].Value.Trim() }
    $reporting = EnvValue "ERP_SQL_DATABASE"
    if ($reporting) { $Databases += $reporting }
    $Databases = $Databases | Select-Object -Unique
}
if (-not $Databases -or $Databases.Count -eq 0) { Bad "no database named in -Databases or in .env"; exit 1 }
Info ("server {0}, databases: {1}" -f $Server, ($Databases -join ", "))

# ---------------------------------------------------------- connection
Add-Type -AssemblyName System.Data
$cs = "Server=$Server;Database=master;TrustServerCertificate=True;Connect Timeout=15;Application Name=ATA-ERP backup"
if ($SqlCredential) {
    $b = New-Object System.Data.SqlClient.SqlConnectionStringBuilder $cs
    $b["User ID"]  = $SqlCredential.UserName
    $b["Password"] = $SqlCredential.GetNetworkCredential().Password
    $cs = $b.ConnectionString
} else {
    $cs = "$cs;Integrated Security=SSPI"
}
$conn = New-Object System.Data.SqlClient.SqlConnection $cs
try { $conn.Open() } catch { Bad "cannot connect to SQL Server '$Server' as $(if ($SqlCredential) { $SqlCredential.UserName } else { "$env:USERDOMAIN\$env:USERNAME" }) - $($_.Exception.Message)"; exit 1 }

function Scalar($sql, $params = @{}) {
    $cmd = $conn.CreateCommand(); $cmd.CommandText = $sql; $cmd.CommandTimeout = 0
    foreach ($k in $params.Keys) { [void]$cmd.Parameters.AddWithValue($k, $params[$k]) }
    return $cmd.ExecuteScalar()
}
function Exec($sql, $params = @{}) {
    $cmd = $conn.CreateCommand(); $cmd.CommandText = $sql; $cmd.CommandTimeout = 0
    foreach ($k in $params.Keys) { [void]$cmd.Parameters.AddWithValue($k, $params[$k]) }
    [void]$cmd.ExecuteNonQuery()
}

# Express has no backup compression and refuses the option outright.
$isExpress  = [int](Scalar "SELECT CAST(SERVERPROPERTY('EngineEdition') AS int)") -eq 4
$withOpts   = if ($isExpress) { "INIT, CHECKSUM" } else { "INIT, CHECKSUM, COMPRESSION" }

# BACKUP writes as the SQL Server service account, not as whoever runs this
# script, so that account needs write access to the folder.
try {
    $svc = Scalar "SELECT TOP 1 service_account FROM sys.dm_server_services WHERE servicename LIKE 'SQL Server (%'"
    if ($svc -and $svc -notmatch '^(LocalSystem|NT AUTHORITY\\SYSTEM)$') {
        & icacls $BackupDir /grant "${svc}:(OI)(CI)M" /T /Q | Out-Null
    }
} catch { Info "could not read the SQL Server service account ($($_.Exception.Message)); assuming it can write to $BackupDir" }

# ------------------------------------------------------------- the backups
$failed  = 0
$results = @()
foreach ($db in $Databases) {
    $exists = Scalar "SELECT COUNT(*) FROM sys.databases WHERE name = @db" @{ "@db" = $db }
    if ([int]$exists -eq 0) { Bad "database '$db' does not exist on $Server"; $failed++; continue }

    # Do not start a backup the disk cannot hold: the old files are only removed
    # after a new one verifies, so a full disk is never fixed by deleting them.
    $sizeBytes = [int64](Scalar "SELECT SUM(CAST(size AS bigint)) * 8192 FROM sys.master_files WHERE database_id = DB_ID(@db)" @{ "@db" = $db })
    $drive = (Get-Item $BackupDir).PSDrive
    if ($drive.Free -lt $sizeBytes) {
        Bad ("{0}: needs up to {1:N0} MB and {2} has {3:N0} MB free" -f $db, ($sizeBytes / 1MB), $drive.Name, ($drive.Free / 1MB))
        $failed++; continue
    }

    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $file  = Join-Path $BackupDir ("{0}_{1}_{2}.bak" -f $db, $Tag, $stamp)
    try {
        Exec "BACKUP DATABASE @db TO DISK = @file WITH $withOpts, NAME = @name" @{
            "@db" = $db; "@file" = $file; "@name" = "ATA-ERP $Tag $stamp"
        }
        Exec "RESTORE VERIFYONLY FROM DISK = @file WITH CHECKSUM" @{ "@file" = $file }
        $mb = (Get-Item $file).Length / 1MB
        Ok ("{0} -> {1} ({2:N1} MB, verified)" -f $db, (Split-Path $file -Leaf), $mb)
        $results += [pscustomobject]@{ database = $db; file = $file; sizeMB = [math]::Round($mb, 1) }
    } catch {
        Bad "${db}: $($_.Exception.Message)"
        if (Test-Path $file) { Remove-Item $file -Force -ErrorAction SilentlyContinue }
        $failed++
        continue
    }

    # Retention, per database and tag, and only after this one verified.
    $all = Get-ChildItem $BackupDir -Filter ("{0}_{1}_*.bak" -f $db, $Tag) | Sort-Object LastWriteTime -Descending
    $old = $all | Select-Object -Skip $KeepAtLeast | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$KeepDays) }
    foreach ($f in $old) { Remove-Item $f.FullName -Force; Info "removed old backup $($f.Name)" }
}
$conn.Close()

# A small record of the last run, for whoever checks on it (and for the
# application to read later).
$status = [pscustomobject]@{
    finishedAt = (Get-Date).ToString("s")
    tag        = $Tag
    ok         = ($failed -eq 0)
    failed     = $failed
    backups    = $results
}
$status | ConvertTo-Json -Depth 4 | Set-Content -Path (Join-Path $BackupDir "last-backup.json") -Encoding UTF8

if ($failed -gt 0) { Bad "$failed database(s) were NOT backed up"; exit 1 }
Ok "all backups written and verified"
exit 0
