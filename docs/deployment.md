# استقرار و به‌روزرسانی روی سرور

## معماری کار

```
کامپیوتر توسعه (D:\ATA-ERP-Rev01)          سرور 192.168.1.104
  ویرایش + تست + type-check                  E:\Apps\ATA-ERP-Rev01
            │                                          ▲
            └────── git push ──▶ GitHub ──── deploy.ps1 ┘
```

توسعه **همیشه** روی کامپیوتر توسعه انجام می‌شود. سرور فقط مقصد استقرار است و هیچ‌وقت مستقیماً روی آن کد ویرایش نمی‌شود. دلیلش: هر تغییر قبل از رسیدن به کاربران type-check و تست می‌شود، و برگشت با یک `git revert` انجام می‌شود.

---

## آماده‌سازی یک‌باره روی سرور

این مراحل فقط **یک بار** لازم است.

### ۱. نصب git (پرتابل — بدون Installer)

```powershell
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$rel = Invoke-RestMethod "https://api.github.com/repos/git-for-windows/git/releases/latest"
$asset = $rel.assets | Where-Object { $_.name -like "MinGit-*-64-bit.zip" } | Select-Object -First 1
$zip = "$env:TEMP\mingit.zip"
Invoke-WebRequest $asset.browser_download_url -OutFile $zip -UseBasicParsing
Expand-Archive $zip -DestinationPath "E:\git" -Force
Remove-Item $zip -Force
& "E:\git\cmd\git.exe" --version
```

سپس به PATH کاربر اضافه کن:

```powershell
$p = [Environment]::GetEnvironmentVariable("Path","User")
if ($p -notlike "*E:\git\cmd*") {
    [Environment]::SetEnvironmentVariable("Path", $p.TrimEnd(';') + ";E:\git\cmd", "User")
}
$env:Path = "E:\git\cmd;" + $env:Path
git --version
```

### ۲. تبدیل فولدر برنامه به یک git clone

فولدر فعلی از ZIP ساخته شده و تاریخچه‌ی git ندارد. این کار آن را وصل می‌کند **بدون آنکه داده یا تنظیمات از بین برود**:

```powershell
Set-Location "E:\Apps\ATA-ERP-Rev01"

# Safety copy of the two files that must never be lost
Copy-Item ".env" "$env:TEMP\env-safety.txt" -ErrorAction SilentlyContinue
Copy-Item "database.json" "$env:TEMP\database-safety.json" -ErrorAction SilentlyContinue

git init
git remote add origin https://github.com/mtmoghadam90-eng/ATA-ERP-Rev01.git
git fetch origin
git reset --hard origin/main
git branch -M main
git branch --set-upstream-to=origin/main main

Write-Host "--- .env and database.json still present? ---" -ForegroundColor Cyan
Test-Path ".env"; Test-Path "database.json"
```

> `git reset --hard` فقط فایل‌های **تحت کنترل git** را بازنویسی می‌کند. `.env`، `database.json`، `node_modules` و `uploads` در `.gitignore` هستند و دست‌نخورده می‌مانند. کپی امن هم در `%TEMP%` گرفته شد.

### ۳. اجازه‌ی اجرای اسکریپت

```powershell
Unblock-File "E:\Apps\ATA-ERP-Rev01\scripts\deploy.ps1"
```

---

## به‌روزرسانی برنامه (از این به بعد)

هر بار که تغییری روی GitHub رفت، فقط این را روی سرور اجرا کن:

```powershell
powershell -ExecutionPolicy Bypass -File E:\Apps\ATA-ERP-Rev01\scripts\deploy.ps1
```

اسکریپت ۸ مرحله را انجام می‌دهد و در هر خطایی **متوقف می‌شود بدون اینکه برنامه‌ی در حال اجرا را بشکند**:

| مرحله | کار | در صورت خطا |
|---|---|---|
| ۱ | پشتیبان‌گیری از `database.json` (۳۰ نسخه‌ی آخر نگه داشته می‌شود) | — |
| ۲ | نگه‌داشتن build فعلی برای بازگشت | — |
| ۳ | `git fetch` + `reset --hard origin/main` | توقف |
| ۴ | `npm install` | build قبلی برگردانده می‌شود |
| ۵ | `npm run lint` (type-check) | **استقرار انجام نمی‌شود** |
| ۶ | `npm run build` | **استقرار انجام نمی‌شود** |
| ۷ | ری‌استارت سرویس | توقف با پیام |
| ۸ | بررسی سلامت روی پورت ۳۰۰۰ | راهنمای عیب‌یابی |

نکته‌ی کلیدی: تا وقتی type-check و build سبز نشوند، سرویس **ری‌استارت نمی‌شود** — پس یک کامیت خراب نمی‌تواند برنامه را از کار بیندازد.

### خروجی موفق

```
[8] Health check
    OK - application is responding on port 3000

DEPLOY SUCCEEDED
```

---

## بازگشت به نسخه‌ی قبل

اگر تغییری مشکل داشت:

```powershell
Set-Location "E:\Apps\ATA-ERP-Rev01"
git log --oneline -5          # پیدا کردن کامیت سالم
git reset --hard <commit-id>
& "E:\nodejs\npm.cmd" run build
Restart-ScheduledTask -TaskName "ATA-ERP"
```

یا بهتر: روی کامپیوتر توسعه `git revert` بزن، push کن، و دوباره `deploy.ps1` را اجرا کن — تا تاریخچه تمیز بماند.

## بازگرداندن داده از پشتیبان

```powershell
Stop-ScheduledTask -TaskName "ATA-ERP"
Get-ChildItem "E:\Apps\ATA-ERP-Rev01\backups" | Sort-Object LastWriteTime -Descending | Select-Object -First 10 Name, LastWriteTime
Copy-Item "E:\Apps\ATA-ERP-Rev01\backups\database-YYYYMMDD-HHMMSS.json" "E:\Apps\ATA-ERP-Rev01\database.json" -Force
Start-ScheduledTask -TaskName "ATA-ERP"
```

---

## گردش کار روزمره

1. تو مشکل یا درخواستی را می‌گویی
2. من روی کامپیوتر توسعه تغییر می‌دهم، type-check و تست می‌کنم
3. کامیت و push می‌کنم و به تو می‌گویم
4. تو یک دستور `deploy.ps1` روی سرور می‌زنی
5. اسکریپت خودش سلامت برنامه را تأیید می‌کند

اگر خطایی دیدی، خروجی `deploy.ps1` را برایم بفرست — مرحله‌ای که شکسته را دقیق نشان می‌دهد.
