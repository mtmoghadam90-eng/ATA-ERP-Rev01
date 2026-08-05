# Quick migration script
Write-Host "Running database migration..." -ForegroundColor Cyan
npx prisma migrate deploy
Write-Host "Regenerating Prisma client..." -ForegroundColor Cyan
npx prisma generate
Write-Host "Done!" -ForegroundColor Green
