<#
.SYNOPSIS
    Deploys the latest committed version of ATA-ERP onto this server.

.DESCRIPTION
    Pulls from git, installs dependencies, type-checks, builds, and only then
    restarts the app. If any stage fails the running application is left alone
    and the previous build is restored, so a bad commit cannot take the app down.

    Configuration (.env), the session secret and uploads are never touched.
    Business data lives in SQL Server and is NOT backed up by this script —
    back the ata_erp database up separately before a risky deploy.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File E:\Apps\ATA-ERP-Rev01\scripts\deploy.ps1
#>
param(
    [string]$AppDir   = "E:\Apps\ATA-ERP-Rev01",
    [string]$NodeDir  = "E:\nodejs",
    [string]$TaskName = "ATA-ERP",
    [int]   $Port     = 3000,
    [switch]$SkipBackup
)

$ErrorActionPreference = "Stop"
$npm  = Join-Path $NodeDir "npm.cmd"
$node = Join-Path $NodeDir "node.exe"

function Step($n, $msg) { Write-Host "`n[$n] $msg" -ForegroundColor Cyan }
function Ok($msg)       { Write-Host "    OK - $msg" -ForegroundColor Green }
function Fail($msg)     { Write-Host "    FAILED - $msg" -ForegroundColor Red }

Set-Location $AppDir

# ---------------------------------------------------------------- 1. backup
if (-not $SkipBackup) {
    Step 1 "Backing up application data"
    $backupDir = Join-Path $AppDir "backups"
    New-Item -ItemType Directory -Force $backupDir | Out-Null
    # The application's data is in SQL Server; this script cannot back that up.
    # What it can preserve is the leftover document store on a server upgraded
    # from an older build, so an upgrade never destroys the last copy of it.
    if (Test-Path "database.json") {
        $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
        Copy-Item "database.json" (Join-Path $backupDir "database-$stamp.json")
        Ok "legacy database.json copied to backups\database-$stamp.json"
        # Keep the 30 most recent backups
        Get-ChildItem $backupDir -Filter "database-*.json" |
            Sort-Object LastWriteTime -Descending | Select-Object -Skip 30 |
            Remove-Item -Force -ErrorAction SilentlyContinue
    } else {
        Write-Host "    (no legacy database.json - business data is in SQL Server)" -ForegroundColor DarkGray
    }
    Write-Host "    NOTE: SQL Server data is not backed up here - back up 'ata_erp' separately." -ForegroundColor Yellow
} else {
    Step 1 "Backup skipped (-SkipBackup)"
}

# ---------------------------------------------------------- 2. preserve dist
Step 2 "Snapshotting the current build (for rollback)"
$distBak = Join-Path $env:TEMP "ata-erp-dist-backup"
if (Test-Path $distBak) { Remove-Item $distBak -Recurse -Force }
if (Test-Path "dist") {
    Copy-Item "dist" $distBak -Recurse
    Ok "previous build saved"
} else {
    Write-Host "    (no previous build)" -ForegroundColor DarkGray
}

function Restore-Dist {
    if (Test-Path $distBak) {
        if (Test-Path "dist") { Remove-Item "dist" -Recurse -Force }
        Copy-Item $distBak "dist" -Recurse
        Write-Host "    Previous build restored - the running app is unaffected." -ForegroundColor Yellow
    }
}

# --------------------------------------------------------------- 3. git pull
Step 3 "Fetching the latest code"
if (-not (Test-Path ".git")) {
    Fail "This folder is not a git clone. Run the one-time setup first (see docs/deployment.md)."
    exit 2
}
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $before = (git rev-parse --short HEAD).Trim()
    git fetch origin --quiet
    git reset --hard origin/main --quiet
    $after = (git rev-parse --short HEAD).Trim()
    if ($before -eq $after) { Ok "already up to date ($after)" }
    else {
        Ok "updated $before -> $after"
        git --no-pager log --oneline "$before..$after" | ForEach-Object { Write-Host "      $_" -ForegroundColor DarkGray }
    }
} catch {
    Fail "git failed: $($_.Exception.Message)"
    exit 3
}

# ------------------------------------------------------------ 4. dependencies
Step 4 "Installing dependencies"
& $npm install --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { Fail "npm install failed"; Restore-Dist; exit 4 }
Ok "dependencies ready"

# ------------------------------------------------------------ 5. database migration
Step 5 "Applying database migrations"
$npx = Join-Path $NodeDir "npx.cmd"
& $npx prisma migrate deploy
if ($LASTEXITCODE -ne 0) {
    Fail "database migration failed - NOT deploying"
    Restore-Dist
    exit 5
}
Ok "database schema is up to date"

# ------------------------------------------------------------- 6. type-check
Step 6 "Type-checking"
& $npm run lint
if ($LASTEXITCODE -ne 0) { Fail "type-check failed - NOT deploying"; Restore-Dist; exit 6 }
Ok "no type errors"

# ------------------------------------------------------------------ 7. build
Step 7 "Building production bundle"
& $npm run build
if ($LASTEXITCODE -ne 0) { Fail "build failed - NOT deploying"; Restore-Dist; exit 7 }
if (-not (Test-Path "dist\server.cjs")) { Fail "dist\server.cjs missing"; Restore-Dist; exit 7 }
Ok "build produced dist\server.cjs"

# ---------------------------------------------------------------- 8. restart
Step 8 "Restarting the application"
# The task is registered with -MultipleInstances IgnoreNew: if the old process is
# still alive, Start-ScheduledTask is silently ignored and the deploy has NO
# effect while appearing to succeed. So confirm the port is actually free before
# starting, and force-kill whatever still holds it.
function Get-PortOwner {
    param([int]$P)
    try {
        return (Get-NetTCPConnection -State Listen -LocalPort $P -ErrorAction Stop |
                Select-Object -First 1 -ExpandProperty OwningProcess)
    } catch { return $null }
}

try {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue

    $freed = $false
    foreach ($i in 1..15) {
        Start-Sleep -Seconds 1
        if (-not (Get-PortOwner -P $Port)) { $freed = $true; break }
    }

    if (-not $freed) {
        $owner = Get-PortOwner -P $Port
        if ($owner) {
            $proc = Get-Process -Id $owner -ErrorAction SilentlyContinue
            # Only ever kill our own runtime, never a neighbouring service.
            if ($proc -and $proc.ProcessName -eq "node") {
                Write-Host "    Port $Port still held by node (PID $owner) - stopping it." -ForegroundColor Yellow
                Stop-Process -Id $owner -Force -ErrorAction SilentlyContinue
                Start-Sleep -Seconds 3
            } else {
                Fail "port $Port is held by '$($proc.ProcessName)' (PID $owner), which is not ours - not touching it"
                exit 7
            }
        }
    }

    if (Get-PortOwner -P $Port) {
        Fail "port $Port is still in use; refusing to start a second instance"
        exit 7
    }

    Start-ScheduledTask -TaskName $TaskName
    Ok "task '$TaskName' restarted on a free port"
} catch {
    Fail "could not restart task: $($_.Exception.Message)"
    exit 8
}

# ------------------------------------------------------------ 9. health check
Step 9 "Health check"
$healthy = $false
foreach ($i in 1..20) {
    Start-Sleep -Seconds 2
    try {
        # /api/health is intentionally unauthenticated. Do not point this at a
        # protected endpoint: Invoke-WebRequest throws on 401, which would report
        # a perfectly healthy application as down.
        $r = Invoke-WebRequest "http://localhost:$Port/api/health" -UseBasicParsing -TimeoutSec 5
        if ($r.StatusCode -eq 200) {
            # A low uptime proves this is the process we just started, not an old
            # one that survived and is still serving the previous build.
            $uptime = ($r.Content | ConvertFrom-Json).uptimeSec
            if ($uptime -ne $null -and $uptime -lt 120) {
                $healthy = $true
                Write-Host "    (fresh process, uptime ${uptime}s)" -ForegroundColor DarkGray
                break
            }
            Write-Host "    Responding, but uptime is ${uptime}s - that is not the build we just deployed." -ForegroundColor Yellow
        }
    } catch { }
}
if ($healthy) {
    Ok "application is responding on port $Port"
    Write-Host "`nDEPLOY SUCCEEDED" -ForegroundColor Green
    exit 0
} else {
    Fail "application did not respond on port $Port after 40s"
    Write-Host "Check the task history in Task Scheduler, then run:" -ForegroundColor Yellow
    Write-Host "  cd $AppDir; `$env:NODE_ENV='production'; & '$node' dist\server.cjs" -ForegroundColor Yellow
    exit 9
}
