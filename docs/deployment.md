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
| ۱ | پشتیبان‌گیری از `database.json` قدیمی، اگر مانده باشد. **داده‌های SQL Server بکاپ نمی‌شوند** | — |
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

## دیدن و ویرایش مستقیم داده‌ها

داده‌های کسب‌وکار در **SQL Server** هستند، نه در فایل. ابزارش SSMS است که روی همین
سرور نصب است.

### پیدا کردن دیتابیس درست

نام سرور و دیتابیس را از روی حدس برندارید — مرجعش `DATABASE_URL` در `.env` خود
سرور است. این دستور آدرس و نام دیتابیس و کاربر را نشان می‌دهد **بدون اینکه رمز را
چاپ کند**:

```powershell
$line = (Select-String -Path 'E:\Apps\ATA-ERP-Rev01\.env' -Pattern '^DATABASE_URL').Line
[regex]::Matches($line, 'sqlserver://[^;]+|database=[^;]+|user=[^;]+') | ForEach-Object { $_.Value }
```

اگر دیتابیس در Object Explorer دیده نمی‌شود، معمولاً یکی از این سه است — و این
کوئری هر سه را روشن می‌کند:

```sql
SELECT @@SERVERNAME AS instance, SERVERPROPERTY('InstanceName') AS named_instance;
SELECT name, state_desc FROM sys.databases ORDER BY name;
```

۱. **instance دیگری است.** یک سرور می‌تواند چند instance داشته باشد؛ برنامه ممکن
است به `192.168.1.104\SQLEXPRESS` وصل باشد در حالی که SSMS به instance پیش‌فرض
وصل شده. آنچه `DATABASE_URL` می‌گوید درست است.
۲. **نامش چیز دیگری است.** `ata_erp` فقط نمونه‌ی داخل `.env.example` است.
۳. **کاربر شما آن را نمی‌بیند.** Object Explorer فقط دیتابیس‌هایی را نشان می‌دهد که
لاگین جاری اجازه‌اش را دارد. با Windows Authentication به‌عنوان ادمین وصل شوید.

### قبل از هر تغییر دستی، بکاپ بگیرید

`deploy.ps1` از SQL Server بکاپ **نمی‌گیرد** — خودش هم همین را می‌گوید. تنها چیزی
که بکاپ می‌کند `database.json` قدیمی است، که دیگر هیچ داده‌ای در آن نیست.

```sql
BACKUP DATABASE [ata_erp] TO DISK = N'E:\Backups\ata_erp_manual.bak'
WITH INIT, COMPRESSION, NAME = N'manual before edit';
```

### بازگرداندن

برنامه باید متوقف باشد، وگرنه اتصال باز آن مانع بازگردانی می‌شود:

```powershell
Stop-ScheduledTask -TaskName "ATA-ERP"
```

```sql
ALTER DATABASE [ata_erp] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
RESTORE DATABASE [ata_erp] FROM DISK = N'E:\Backups\ata_erp_manual.bak' WITH REPLACE;
ALTER DATABASE [ata_erp] SET MULTI_USER;
```

```powershell
Start-ScheduledTask -TaskName "ATA-ERP"
```

### چه چیزی را دستی حذف نکنید

حذف مستقیم منطق برنامه را دور می‌زند. جاهایی که این واقعاً هزینه دارد:

| مورد | چرا |
|---|---|
| موجودی انبار | سطح موجودی و دفتر حرکات با هم نوشته می‌شوند؛ حذف یکی، آن دو را از هم جدا می‌کند |
| پیش‌فاکتور | وضعیت پروژه از خطوط آن محاسبه و **ذخیره** می‌شود و کهنه جا می‌ماند |
| شماره اسناد | از شماره‌های صادرشده شمرده می‌شوند؛ حذف یک سند شماره‌اش را دوباره قابل صدور می‌کند |
| رتبه ارزش مشتری | تا `POST /api/customers/recalculate-value` اجرا نشود به‌روز نمی‌شود |

پس تا جای ممکن از خود برنامه حذف کنید؛ حذف مستقیم برای موردی است که برنامه راهی
نمی‌دهد (مثلاً یک سطر یتیم). برای دیدن «چه اتفاقی افتاد» هم اول
**تنظیمات ← گزارش فعالیت‌ها** را ببینید: snapshot قبل و بعد هر تغییر آنجاست و
خواندنش بی‌خطر است.

---

## گردش کار روزمره

1. تو مشکل یا درخواستی را می‌گویی
2. من روی کامپیوتر توسعه تغییر می‌دهم، type-check و تست می‌کنم
3. کامیت و push می‌کنم و به تو می‌گویم
4. تو یک دستور `deploy.ps1` روی سرور می‌زنی
5. اسکریپت خودش سلامت برنامه را تأیید می‌کند

اگر خطایی دیدی، خروجی `deploy.ps1` را برایم بفرست — مرحله‌ای که شکسته را دقیق نشان می‌دهد.
