# نقشه مهاجرت پایگاه‌داده به SQL Server 2017

> **سند تاریخی — این مهاجرت مدت‌هاست تکمیل شده.** فایل تخت `database.json` و هر چیزی که در این سند توصیفش می‌کند (کلیدهای KV، `store` در حافظه، POST کردن کل آرایه) از کد حذف شده؛ همه‌ی ۱۸ ماژول اکنون روی Prisma/SQL Server کار می‌کنند (نگاه کنید به بخش «SQL Server» در `CLAUDE.md`). این فایل فقط به‌عنوان مرجع تاریخیِ نقشه‌ی اولیه نگه داشته شده، نه راهنمای وضعیت فعلی.
>
> سند مرجع اصلی برای مهاجرت ذخیره‌سازی برنامه ATA-ERP از فایل تخت `database.json` به Microsoft SQL Server 2017.
> این مهاجرت باید به‌عنوان یک **فاز مستقل بعد از تکمیل توسعه‌ی قابلیت‌ها** اجرا شود.

آخرین به‌روزرسانی: ۱۴۰۵/۰۵/۰۱ (2026-07-23) — پیش از تکمیل مهاجرت

---

## ۱. وضعیت فعلی و مقصد

**اکنون:** [`server.ts`](../server.ts) کل داده را در یک شیء در حافظه (`store`) نگه می‌دارد و روی هر نوشتن، کل آن را به‌صورت JSON در فایل `database.json` می‌نویسد (`fs.writeFileSync`). ساختار KV است: هر کلید (`erp_customers`, `erp_proformas`, ...) مقدارش یک بلاب JSON از کل آن collection است. کلاینت‌ها در [`useERPStore.ts`](../src/useERPStore.ts) کل آرایه را در state ری‌اکت دارند و هنگام ذخیره **کل آرایه** را POST می‌کنند.

**مقصد:** Microsoft SQL Server 2017 (نمونه پیش‌فرض `MSSQLSERVER` / `MSSQL14`) که هم‌اکنون روی سرور `192.168.1.104` نصب و رانینگ است.

## ۲. سه مسئله‌ی مستقل (مهم)

عوض کردن موتور به‌تنهایی همه‌چیز را حل نمی‌کند. سه کار جدا داریم:

| # | مسئله | محل حل | اجباری برای چه هدفی |
|---|-------|--------|--------------------|
| A | موتور ذخیره‌سازی | `server.ts` | دوام، بکاپ، اتصال هم‌زمان |
| B | باگ clobbering (بازنویسی کل آرایه) | `server.ts` + `useERPStore.ts` | چند کاربر هم‌زمان بدون از دست رفتن داده |
| C | مدل گزارش‌گیری رابطه‌ای | View های SQL | اتصال Power BI و گزارش چندوجهی |

---

## فاز ۰ — آماده‌سازی زیرساخت SQL Server (روی سرور)

1. **فعال‌سازی TCP/IP:** SQL Server Configuration Manager → SQL Server Network Configuration → Protocols for MSSQLSERVER → `TCP/IP` = Enabled → ری‌استارت سرویس `MSSQLSERVER`.
2. **پورت فایروال:** پورت `1433/TCP` را در Windows Defender Firewall (Inbound Rule) باز کن.
3. **حالت احراز هویت:** SQL Server را روی **Mixed Mode** (SQL + Windows) بگذار (SSMS → Server Properties → Security). ری‌استارت لازم است.
4. **ساخت دیتابیس و کاربر برنامه:**
   ```sql
   CREATE DATABASE ata_erp;
   GO
   CREATE LOGIN ata_app WITH PASSWORD = 'یک‌رمز‌قوی‌این‌جا';
   GO
   USE ata_erp;
   CREATE USER ata_app FOR LOGIN ata_app;
   ALTER ROLE db_owner ADD MEMBER ata_app;   -- در فاز اول؛ بعداً محدودتر می‌کنیم
   GO
   ```
5. **کاربر فقط‌خواندنی برای Power BI** (اصل کمترین دسترسی):
   ```sql
   CREATE LOGIN powerbi_ro WITH PASSWORD = 'یک‌رمز‌دیگر';
   CREATE USER powerbi_ro FOR LOGIN powerbi_ro;
   ALTER ROLE db_datareader ADD MEMBER powerbi_ro;
   ```

---

## فاز ۱ — سوییچ موتور با کمترین تغییر (مسئله A)

هدف: بدون بازنویسی منطق برنامه، فقط لایه‌ی دیسک را عوض کنیم. ساختار KV حفظ می‌شود.

1. **نصب درایور:**
   ```bash
   npm install mssql
   ```
2. **جدول KV در SQL Server:**
   ```sql
   CREATE TABLE dbo.store (
     [key]      NVARCHAR(100)   NOT NULL PRIMARY KEY,
     [value]    NVARCHAR(MAX)   NOT NULL,   -- بلاب JSON
     [version]  ROWVERSION,                 -- برای فاز B
     updated_at DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME()
   );
   ```
3. **بازنویسی shim در `server.ts`:** توابع `loadStore`/`saveStore` و `insertStmt`/`getStmt` که الان روی فایل کار می‌کنند، به کوئری‌های `mssql` تبدیل شوند:
   - `getStmt.get(key)` → `SELECT value FROM dbo.store WHERE [key] = @key`
   - `insertStmt.run(key, value)` → `MERGE` (UPSERT) روی `dbo.store`.
   - منطق seeding و whitelist `ALLOWED_KEYS` بدون تغییر باقی می‌ماند.
4. **اسکریپت مهاجرت داده‌ی یک‌باره:** `database.json` فعلی را بخوان و هر کلید/مقدار را در `dbo.store` درج کن.
5. **کانکشن:** رشته اتصال از env (نه هاردکد):
   ```
   MSSQL_SERVER=192.168.1.104
   MSSQL_DATABASE=ata_erp
   MSSQL_USER=ata_app
   MSSQL_PASSWORD=...
   ```
   (از `dotenv` که already در deps هست استفاده کن.)

✅ بعد از این فاز: دوام، بکاپ استاندارد، و اتصال هم‌زمان چند کلاینت به سرور برقرار است. اما باگ clobbering هنوز هست.

---

## فاز ۲ — رفع باگ هم‌زمانی / clobbering (مسئله B)

**مشکل:** کاربر A و B هر دو لیست را باز دارند؛ B رکوردی اضافه می‌کند؛ A ذخیره می‌کند و state قدیمی A کل collection را بازنویسی می‌کند → رکورد B پاک می‌شود.

**راه‌حل — حرکت از نوشتن «کل آرایه» به نوشتن «تک‌رکورد»:**

1. **APIهای سطح‌رکورد در `server.ts`** به‌جای فقط `POST /api/data/:key`:
   - `POST   /api/:collection`        → افزودن یک رکورد
   - `PUT    /api/:collection/:id`    → به‌روزرسانی یک رکورد (با بررسی version)
   - `DELETE /api/:collection/:id`    → حذف یک رکورد
   - این‌ها فقط همان آیتم را در بلاب JSON دستکاری می‌کنند (با `OPENJSON`/`JSON_MODIFY`) یا در ساختار رابطه‌ای فاز ۳ روی سطر عمل می‌کنند.
2. **کنترل هم‌زمانی خوش‌بینانه (Optimistic):** هر رکورد یک `updatedAt`/`version` دارد. هنگام PUT، اگر version کلاینت با سرور فرق کند → پاسخ `409 Conflict` و کلاینت رکورد تازه را می‌گیرد.
3. **بازآرایی الگوی نوشتن در `useERPStore.ts`:** تابع `saveToStorage(key, wholeArray, setter)` جای خودش را به فراخوان‌های تک‌رکوردی می‌دهد. این بزرگ‌ترین بخش کار سمت کلاینت است (چون همه‌ی mutationها از این الگو استفاده می‌کنند).
4. **تازه‌سازی (اختیاری ولی توصیه‌شده):** یک polling سبک یا SignalR/WebSocket تا کلاینت‌ها تغییرات همدیگر را ببینند (الان اصلاً refetch وجود ندارد).

> نکته: می‌توان فاز ۲ را تدریجی و ماژول‌به‌ماژول انجام داد؛ لازم نیست یک‌جا همه‌ی ۱۵ ماژول تبدیل شوند.

---

## فاز ۳ — لایه‌ی گزارش‌گیری برای Power BI (مسئله C)

Power BI نباید به بلاب‌های خام JSON وصل شود. به‌جایش **View های مسطح رابطه‌ای** می‌سازیم که با `OPENJSON` بلاب‌ها را به سطر و ستون می‌شکنند.

**نمونه — شکستن آیتم‌های پیش‌فاکتور:**
```sql
CREATE OR ALTER VIEW dbo.v_proforma_items AS
SELECT
    p.proformaNumber,
    p.customerName,
    p.currency,
    p.[status],
    i.productName,
    i.brand,
    TRY_CAST(i.quantity        AS INT)     AS quantity,
    TRY_CAST(i.unitPriceRIYAL  AS DECIMAL(18,2)) AS unitPrice,
    TRY_CAST(i.totalPriceRIYAL AS DECIMAL(18,2)) AS totalPrice,
    i.[status] AS itemStatus
FROM dbo.store s
CROSS APPLY OPENJSON(s.[value])
    WITH (
        proformaNumber NVARCHAR(100),
        customerName   NVARCHAR(200),
        currency       NVARCHAR(20),
        [status]       NVARCHAR(50),
        items          NVARCHAR(MAX) AS JSON
    ) p
CROSS APPLY OPENJSON(p.items)
    WITH (
        productName    NVARCHAR(300),
        brand          NVARCHAR(100),
        quantity       NVARCHAR(50),
        unitPriceRIYAL NVARCHAR(50),
        totalPriceRIYAL NVARCHAR(50),
        [status]       NVARCHAR(50)
    ) i
WHERE s.[key] = 'erp_proformas';
```

**View های پیشنهادی برای شروع:**
- `v_customers` — مشتریان (تخت)
- `v_projects` — پروژه‌ها/فرصت‌ها + وضعیت
- `v_proforma_items` — ردیف‌های پیش‌فاکتور (نمونه بالا)
- `v_transactions` — دریافت/پرداخت‌ها
- `v_purchase_order_items` — ردیف‌های سفارش خرید
- `v_project_finance` — خلاصه‌ی مالی پروژه (اگر لازم شد، منطق `finance.ts` را در SQL بازتولید یا از یک جدول snapshot استفاده کن)

**اتصال Power BI:**
- Get Data → **SQL Server database** → Server: `192.168.1.104` → Database: `ata_erp`.
- حالت **Import** (توصیه‌شده برای گزارش چندوجهی و سرعت DAX) یا DirectQuery.
- با کاربر `powerbi_ro` (فقط‌خواندنی) وصل شو.
- روابط (relationships) بین view ها را در Power BI بساز → star schema → measure های DAX.

> اگر `OPENJSON` روی حجم بالا کند شد: View ها را به **Materialized (Indexed View)** یا جدول‌های snapshot که شبانه با یک Job پر می‌شوند تبدیل کن.

---

## ترتیب اجرا و ریسک

| فاز | خروجی | ریسک | وابستگی |
|-----|-------|------|---------|
| ۰ | زیرساخت SQL آماده | کم | — |
| ۱ | برنامه روی SQL Server (KV) | کم | فاز ۰ |
| ۳ | گزارش‌های Power BI | کم | فاز ۱ |
| ۲ | چند کاربر هم‌زمان امن | متوسط‌–زیاد | فاز ۱ |

**نکته‌ی مهم:** فاز ۳ (Power BI) به فاز ۲ وابسته نیست — به‌محض تمام شدن فاز ۱ می‌توان گزارش‌ها را ساخت. فاز ۲ سنگین‌ترین بخش است و می‌تواند تدریجی جلو برود.

## چک‌لیست قبل از شروع مهاجرت

- [ ] توسعه‌ی قابلیت‌ها feature-complete شده باشد
- [ ] از `database.json` فعلی بکاپ گرفته شده باشد
- [ ] TCP/IP و پورت 1433 و Mixed Mode فعال باشند
- [ ] دیتابیس `ata_erp` و کاربران `ata_app` / `powerbi_ro` ساخته شده باشند
- [ ] رشته‌های اتصال در env تنظیم شده باشند (نه هاردکد در کد)
