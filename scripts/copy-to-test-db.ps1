<#
.SYNOPSIS
    Copies the live ATA-ERP database into a test database on the same server.

.DESCRIPTION
    BACKUP to a file, then RESTORE under a new name with the data files moved —
    which is how SQL Server copies a database onto the same instance, since two
    databases cannot share one .mdf. The live database is only ever read from:
    a COPY_ONLY backup does not disturb the real backup chain, and nothing here
    writes to it.

    It does NOT make the copy safe to open. A restored copy is the live database
    under another name: its message outbox is real, its customers' numbers are
    real, and the application drains that outbox every minute. Run
    `npm run db:prepare-test` against the copy before anybody signs in — see
    docs/test-database.md.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File E:\Apps\ATA-ERP-Rev01\scripts\copy-to-test-db.ps1

.EXAMPLE
    # A second copy, for a different experiment
    ... \copy-to-test-db.ps1 -TestDatabase ata_erp_test2
#>
param(
    [string]$SqlServer    = "localhost",
    [string]$LiveDatabase = "ata_erp",
    [string]$TestDatabase = "ata_erp_test",
    # Where the backup file is written. It is deleted afterwards unless -KeepBackup.
    [string]$BackupDir    = $env:TEMP,
    # SQL authentication. Omit both to use the Windows account running this.
    [string]$SqlUser      = "",
    [string]$SqlPassword  = "",
    [switch]$KeepBackup
)

$ErrorActionPreference = "Stop"

function Step($n, $msg) { Write-Host "`n[$n] $msg" -ForegroundColor Cyan }
function Ok($msg)       { Write-Host "    OK - $msg" -ForegroundColor Green }
function Fail($msg)     { Write-Host "    FAILED - $msg" -ForegroundColor Red }

# The whole point of the script is that the copy is not the original. A typo
# here would restore over the live database, so it is refused rather than
# trusted — the one check that cannot be left to whoever is typing at 2am.
if ($TestDatabase -eq $LiveDatabase) {
    Fail "TestDatabase and LiveDatabase are both '$LiveDatabase'. That would overwrite the live data."
    exit 1
}
if ($TestDatabase -notmatch "test") {
    Fail "TestDatabase '$TestDatabase' has no 'test' in its name. `npm run db:prepare-test` refuses such a name too, so the copy could not be made safe afterwards."
    exit 1
}

# `sqlcmd` connects with QUOTED_IDENTIFIER OFF, which SQL Server refuses for a
# filtered index — this repository's own note. Nothing here creates one, but -I
# costs nothing and keeps the invocation the same as everywhere else.
$auth = if ($SqlUser) { @("-U", $SqlUser, "-P", $SqlPassword) } else { @("-E") }
function Sql([string]$query) {
    $out = & sqlcmd -S $SqlServer @auth -I -b -Q $query 2>&1
    if ($LASTEXITCODE -ne 0) { throw ($out | Out-String) }
    return $out
}

$stamp  = Get-Date -Format "yyyyMMdd-HHmmss"
$backup = Join-Path $BackupDir "$LiveDatabase-$stamp.bak"

try {
    Step 1 "Reading the live database's file layout"
    <#
        Two databases on one instance cannot share a data file, so every logical
        file in the backup has to be given a new path. The layout is read from
        the live database rather than assumed: this application's file names and
        their folder are whatever SQL Server chose when it was created, and a
        hardcoded path is the kind of guess that works on one server and fails
        on the next.
    #>
    $filesCsv = & sqlcmd -S $SqlServer @auth -I -b -h -1 -W -s "|" -Q @"
SET NOCOUNT ON;
SELECT f.name, f.physical_name, f.type_desc
FROM sys.master_files f
JOIN sys.databases d ON d.database_id = f.database_id
WHERE d.name = '$LiveDatabase';
"@
    if ($LASTEXITCODE -ne 0) { throw ($filesCsv | Out-String) }

    $moves = @()
    foreach ($line in $filesCsv) {
        $parts = "$line".Split("|")
        if ($parts.Count -lt 3) { continue }
        $logical  = $parts[0].Trim()
        $physical = $parts[1].Trim()
        if (-not $logical -or $physical -notmatch "\.") { continue }
        $dir = [System.IO.Path]::GetDirectoryName($physical)
        $ext = [System.IO.Path]::GetExtension($physical)
        $target = Join-Path $dir "$TestDatabase`_$logical$ext"
        $moves += "MOVE N'$logical' TO N'$target'"
    }
    if ($moves.Count -eq 0) { throw "No files found for '$LiveDatabase'. Is the name right?" }
    Ok "$($moves.Count) file(s)"

    Step 2 "Backing up $LiveDatabase (COPY_ONLY, the real chain is untouched)"
    Sql "BACKUP DATABASE [$LiveDatabase] TO DISK = N'$backup' WITH COPY_ONLY, INIT, COMPRESSION;" | Out-Null
    Ok $backup

    Step 3 "Restoring as $TestDatabase"
    # Anybody still connected to a previous copy would block the restore, so the
    # old one is put into single-user mode first. This is the copy, never the
    # live database — the guard above is what makes that safe to say.
    Sql @"
IF DB_ID('$TestDatabase') IS NOT NULL
    ALTER DATABASE [$TestDatabase] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
"@ | Out-Null
    Sql "RESTORE DATABASE [$TestDatabase] FROM DISK = N'$backup' WITH REPLACE, RECOVERY, $($moves -join ', ');" | Out-Null
    Sql "ALTER DATABASE [$TestDatabase] SET MULTI_USER;" | Out-Null
    Ok "$TestDatabase restored"

    Step 4 "Granting the application's login access to the copy"
    <#
        The restored database carries the *live* database's users, and a database
        user is orphaned from its server login by a restore — same name, different
        SID — so the application would authenticate to the server and then be
        refused the database. Re-mapping it is what makes the copy openable at
        all, and it is the step that is always forgotten.
    #>
    $appUser = if ($SqlUser) { $SqlUser } else { "" }
    if ($appUser) {
        Sql "USE [$TestDatabase]; ALTER USER [$appUser] WITH LOGIN = [$appUser];" | Out-Null
        Ok "re-mapped $appUser"
    } else {
        Write-Host "    ! Windows auth in use here. If the app signs in with a SQL login," -ForegroundColor Yellow
        Write-Host "      run:  USE [$TestDatabase]; ALTER USER [ata_app] WITH LOGIN = [ata_app];" -ForegroundColor Yellow
    }

    Write-Host "`nDone. The copy is NOT safe to open yet." -ForegroundColor Yellow
    Write-Host "Next, in the test checkout with its own .env pointing at $TestDatabase :" -ForegroundColor Yellow
    Write-Host "    npm run db:prepare-test" -ForegroundColor White
    Write-Host "That switches message sending off. Until it is run, this copy will text" -ForegroundColor Yellow
    Write-Host "real customers from its outbox within a minute of the app starting.`n" -ForegroundColor Yellow
}
catch {
    Fail $_
    exit 1
}
finally {
    if (-not $KeepBackup -and (Test-Path $backup)) {
        Remove-Item $backup -Force -ErrorAction SilentlyContinue
    }
}
