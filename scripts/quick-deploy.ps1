<#
.SYNOPSIS
    Quick deployment script for ATA-ERP
#>

param(
    [string]$AppDir   = "E:\Apps\ATA-ERP-Rev01",
    [string]$NodeDir  = "E:\nodejs",
    [string]$TaskName = "ATA-ERP",
    [int]   $Port     = 3000
)

$ErrorActionPreference = "Stop"
$npm  = Join-Path $NodeDir "npm.cmd"
$node = Join-Path $NodeDir "node.exe"

Write-Host "`n[1] Fetching latest code from git..." -ForegroundColor Cyan
Set-Location $AppDir
git fetch origin --quiet
git reset --hard origin/main --quiet
Write-Host "    OK - code updated" -ForegroundColor Green

Write-Host "`n[2] Installing dependencies..." -ForegroundColor Cyan
& $npm install --no-audit --no-fund
if ($LASTEXITCODE -ne 0) {
    Write-Host "    FAILED - npm install failed" -ForegroundColor Red
    exit 1
}
Write-Host "    OK - dependencies installed" -ForegroundColor Green

Write-Host "`n[3] Type-checking..." -ForegroundColor Cyan
& $npm run lint
if ($LASTEXITCODE -ne 0) {
    Write-Host "    FAILED - type-check failed" -ForegroundColor Red
    exit 1
}
Write-Host "    OK - no type errors" -ForegroundColor Green

Write-Host "`n[4] Building..." -ForegroundColor Cyan
& $npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "    FAILED - build failed" -ForegroundColor Red
    exit 1
}
Write-Host "    OK - build completed" -ForegroundColor Green

Write-Host "`n[5] Restarting application..." -ForegroundColor Cyan
Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3
Start-ScheduledTask -TaskName $TaskName
Write-Host "    OK - application restarted" -ForegroundColor Green

Write-Host "`n============================================" -ForegroundColor Green
Write-Host "  DEPLOY SUCCEEDED" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host "`nApplication URL: http://localhost:$Port" -ForegroundColor Cyan
