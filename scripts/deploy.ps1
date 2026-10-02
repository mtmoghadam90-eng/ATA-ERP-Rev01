<#
.SYNOPSIS
    Deploys the latest committed version of ATA-ERP onto this server.

.DESCRIPTION
    Pulls from git, installs dependencies, type-checks, runs the rule checks,
    builds, and only then restarts the app. Steps the change cannot have
    affected are skipped (see "what this deploy has to redo"); -Full redoes all. If any stage fails the running
    application is left alone and the previous build is restored, so a bad
    commit cannot take the app down.

    Configuration (.env), the session secret and uploads are never touched.
    Before anything changes it backs the databases up through
    scripts\backup-db.ps1 (a verified .bak in E:\Backups\ATA-ERP) and stops if
    that fails; -SkipBackup skips it.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File E:\Apps\ATA-ERP-Rev01\scripts\deploy.ps1
#>
param(
    [string]$AppDir   = "E:\Apps\ATA-ERP-Rev01",
    [string]$NodeDir  = "E:\nodejs",
    [string]$TaskName = "ATA-ERP",
    [int]   $Port     = 3000,
    [switch]$SkipBackup,
    # Redo every step from scratch: reinstall, regenerate, full type-check,
    # rebuild. The default skips what the change since the last successful
    # deploy cannot have affected; -Full is for when something looks wrong.
    [switch]$Full
)

$ErrorActionPreference = "Stop"
$npm  = Join-Path $NodeDir "npm.cmd"
$node = Join-Path $NodeDir "node.exe"

# Prisma prints a boxed "Update available 7.9.1 -> 8.0.0-rc.x" banner on every
# `generate` and `migrate deploy`. It is an advertisement, not a diagnostic —
# the command still succeeds and this script only stops on a non-zero exit —
# but a red-and-yellow box in the middle of a deploy reads as a failure, and it
# was reported as one. It also advertises a *release candidate* across a major
# version, which is not something to follow on a live server: Prisma 7 is what
# this application is pinned to, and a major bump changes the SQL Server driver
# adapter it depends on. Silenced for this process only.
$env:PRISMA_HIDE_UPDATE_MESSAGE = "1"

# The exit code IS the step number that stopped the deploy, with no exceptions:
# step 8 exits 8. Two of them used to collide — the build and "the port is held
# by something that is not ours" both exited 7 — and those are the two failures
# needing the most different response, one a commit to fix and the other a
# process to go and find on a server shared with IIS, SQL Server and Report
# Server. Whoever reads ERRORLEVEL learns which step, and the message beside it
# says which failure within that step. 0 is a deploy that finished healthy.
function Step($n, $msg) { Write-Host "`n[$n] $msg" -ForegroundColor Cyan }
function Ok($msg)       { Write-Host "    OK - $msg" -ForegroundColor Green }
function Fail($msg)     { Write-Host "    FAILED - $msg" -ForegroundColor Red }

Set-Location $AppDir

# ---------------------------------------------------------------- 1. backup
# A migration that fails half way leaves the statements before the failure
# applied, so the moment before `prisma migrate deploy` is the most dangerous
# one this script has - and the nightly backup can be most of a working day
# old by then. backup-db.ps1 writes a native .bak of every ATA-ERP database to
# E:\Backups\ATA-ERP and reads it back; if it cannot, nothing has changed yet
# and the deploy stops here rather than migrating with no way back.
if (-not $SkipBackup) {
    Step 1 "Backing up the databases before anything changes"
    $backupScript = Join-Path $AppDir "scripts\backup-db.ps1"
    & powershell -NoProfile -ExecutionPolicy Bypass -File $backupScript -AppDir $AppDir -Tag predeploy -KeepAtLeast 10
    if ($LASTEXITCODE -ne 0) {
        Fail "database backup failed - NOT deploying (nothing was changed). Fix the backup, or rerun with -SkipBackup if you have just taken one yourself."
        exit 1
    }
    Ok "databases backed up and verified"
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
    exit 3
}
#
# `$ErrorActionPreference = "Stop"` does NOT apply to a native command like
# `git`: a failing `git fetch` writes «fatal: unable to access ...» to stderr,
# throws nothing, and execution simply carries on. The next line then resets to
# the *stale local* `origin/main`, `$before -eq $after` is true, and the script
# reports «already up to date» — a deploy that fetched nothing, built the code
# that was already there, and announced success. That is not hypothetical: a
# server left on 329cd02 reported itself up to date for four releases, and the
# features in them were reported as broken rather than as undeployed, which is
# the worst shape a failure can take. So every native git call is checked on
# `$LASTEXITCODE`, and «already up to date» is only reachable after a fetch
# that really reached GitHub.
#
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $before = (git rev-parse --short HEAD).Trim()
    if ($LASTEXITCODE -ne 0) { Fail "git rev-parse failed - is this a git clone?"; exit 3 }

    git fetch origin --quiet
    if ($LASTEXITCODE -ne 0) {
        Fail "git fetch failed - this server could not reach GitHub. NOTHING was deployed."
        Write-Host "      The code on this server is unchanged (still $before)." -ForegroundColor Yellow
        Write-Host "      Check the network/proxy, then run this script again." -ForegroundColor Yellow
        exit 3
    }

    git reset --hard origin/main --quiet
    if ($LASTEXITCODE -ne 0) { Fail "git reset failed - the working tree was not updated."; exit 3 }

    $after = (git rev-parse --short HEAD).Trim()
    if ($LASTEXITCODE -ne 0) { Fail "git rev-parse failed after the reset."; exit 3 }

    if ($before -eq $after) { Ok "already up to date ($after)" }
    else {
        Ok "updated $before -> $after"
        git --no-pager log --oneline "$before..$after" | ForEach-Object { Write-Host "      $_" -ForegroundColor DarkGray }
    }
} catch {
    Fail "git failed: $($_.Exception.Message)"
    exit 3
}

# ------------------------------------------------ what this deploy has to redo
# Most deploys change code and nothing else, and reinstalling every package and
# regenerating the database client on each of them is most of the wait. What is
# compared is the last commit that deployed *successfully* - written into dist
# only after a build passes, and restored with dist when one fails - never the
# commit before this fetch: a deploy that failed half way has already reset the
# tree, and comparing against that would skip the very install it never ran.
# No marker, a marker git does not know, or -Full: everything runs, as before.
$marker = Join-Path $AppDir "dist\.deployed-commit"
$changed = $null
if (-not $Full -and (Test-Path $marker)) {
    $deployedFrom = (Get-Content $marker -Raw).Trim()
    $list = git diff --name-only $deployedFrom HEAD 2>$null
    if ($LASTEXITCODE -eq 0) { $changed = @($list | Where-Object { $_ }) }
}
function Changed($pattern) {
    if ($null -eq $changed) { return $true }
    return [bool]($changed | Where-Object { $_ -match $pattern })
}
if ($null -eq $changed) {
    Write-Host "    (full deploy - every step runs)" -ForegroundColor DarkGray
} else {
    Write-Host "    ($($changed.Count) file(s) changed since the last successful deploy)" -ForegroundColor DarkGray
}

# ------------------------------------------------------------ 4. dependencies
Step 4 "Installing dependencies"
$installed = $false
if ((Changed '^package(-lock)?\.json$') -or -not (Test-Path "node_modules")) {
    & $npm install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { Fail "npm install failed"; Restore-Dist; exit 4 }
    $installed = $true
    Ok "dependencies ready"
} else {
    Ok "skipped - package.json and package-lock.json are unchanged"
}

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

# The generated client is what gives TypeScript the model types, so it has to be
# rebuilt whenever the schema changes or the type-check below fails on columns
# that exist in the database but not yet in the types. npm cannot be relied on
# to do it: Prisma regenerates from an install script, and install scripts are
# blocked here.
Step 6 "Regenerating the database client"
if ($installed -or (Changed '^prisma/schema\.prisma$') -or -not (Test-Path "node_modules\.prisma\client")) {
    & $npx prisma generate
    if ($LASTEXITCODE -ne 0) {
        Fail "prisma generate failed - NOT deploying"
        Restore-Dist
        exit 6
    }
    Ok "database client matches the schema"
} else {
    Ok "skipped - prisma/schema.prisma is unchanged"
}

# ------------------------------------------------------------- 7. type-check
Step 7 "Type-checking"
#   Incremental: `npm run lint` keeps what it learned in node_modules\.cache and
#   re-checks only what changed, which is the same full check done once. -Full
#   throws that cache away, for the rare time the cache itself is the suspect.
if ($Full) { Remove-Item "node_modules\.cache\tsc-lint.tsbuildinfo" -Force -ErrorAction SilentlyContinue }
& $npm run lint
if ($LASTEXITCODE -ne 0) { Fail "type-check failed - NOT deploying"; Restore-Dist; exit 7 }
Ok "no type errors"

# ------------------------------------------------------------- 8. rule checks
#   The type-checker cannot see any of what this suite holds: a hook below an
#   early return, a route registered after the id route that swallows it, a
#   migration carrying a bare GO, two copies of one rule that have drifted. It
#   needs no database and no browser, so it is the one suite that can stand
#   between a commit and this server. About two seconds.
#
#   It was reverted out of this script once, and the reason was never the idea:
#   there is no .gitattributes in the repository and Git for Windows checks out
#   CRLF, so five of the checks - the ones whose pattern spans a line break -
#   failed here on a tree that was character-for-character the commit that had
#   passed on the developer's machine. The suite folds the line ending where it
#   reads a file now, so this server and that one answer the same. If this step
#   ever fails again, it is naming a real fault: read what it printed.
Step 8 "Running the rule checks"
& $npm run test:rules
if ($LASTEXITCODE -ne 0) { Fail "rule checks failed - NOT deploying"; Restore-Dist; exit 8 }
Ok "rule checks passed"

# ------------------------------------------------------------------ 9. build
Step 9 "Building production bundle"
& $npm run build
if ($LASTEXITCODE -ne 0) { Fail "build failed - NOT deploying"; Restore-Dist; exit 9 }
if (-not (Test-Path "dist\server.cjs")) { Fail "dist\server.cjs missing"; Restore-Dist; exit 9 }
# What the next deploy compares against - see "what this deploy has to redo".
# Written only here, after everything that can fail the build has passed.
$deployedCommit = (git rev-parse HEAD).Trim()
if ($LASTEXITCODE -eq 0) { Set-Content -Path $marker -Value $deployedCommit -Encoding ASCII }
Ok "build produced dist\server.cjs"

# --------------------------------------------------------------- 10. restart
Step 10 "Restarting the application"
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
                exit 10
            }
        }
    }

    if (Get-PortOwner -P $Port) {
        Fail "port $Port is still in use; refusing to start a second instance"
        exit 10
    }

    Start-ScheduledTask -TaskName $TaskName
    Ok "task '$TaskName' restarted on a free port"
} catch {
    Fail "could not restart task: $($_.Exception.Message)"
    exit 10
}

# ----------------------------------------------------------- 11. health check
Step 11 "Health check"
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

    # The application checks its own migrations at startup and writes the answer
    # to the log. Surfaced here because a database missing a migration is
    # invisible otherwise: the app starts, answers every health check, and one
    # module 500s on everything it does.
    $schemaLine = $null
    try {
        $schemaLine = Get-ChildItem "$AppDir\logs\app-*.log" -ErrorAction Stop |
            Sort-Object LastWriteTime | Select-Object -Last 1 |
            Get-Content -Tail 200 | Select-String -Pattern '\[schema\]' |
            Select-Object -Last 1
    } catch { }

    if ($schemaLine) {
        $text = ($schemaLine.Line -replace '^.*\[schema\]\s*', '')
        if ($schemaLine.Line -match 'NOT applied') {
            Fail "database schema: $text"
            Write-Host "  The application is running, but the modules those migrations" -ForegroundColor Yellow
            Write-Host "  change will fail on every read and write. Run: npm run db:deploy" -ForegroundColor Yellow
        } else {
            Ok "database schema: $text"
        }
    }

    Write-Host "`nDEPLOY SUCCEEDED" -ForegroundColor Green
    exit 0
} else {
    Fail "application did not respond on port $Port after 40s"
    Write-Host "Check the task history in Task Scheduler, then run:" -ForegroundColor Yellow
    Write-Host "  cd $AppDir; `$env:NODE_ENV='production'; & '$node' dist\server.cjs" -ForegroundColor Yellow
    exit 11
}
