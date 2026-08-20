# اتصال Power BI به داده‌های ATA-ERP

برنامه یک **کپی گزارش‌گیری** از داده‌ها را در جدول‌های تخت SQL Server می‌نویسد و Power BI به همان وصل می‌شود. خودِ برنامه روی داده‌ی عملیاتی خودش کار می‌کند و دست‌نخورده می‌ماند.

```
برنامه (SQL Server: ata_erp)  ──[ همگام‌سازی یک‌طرفه ]──▶  SQL Server: ata_erp_reporting / schema rpt  ◀──  Power BI
```

چرا این معماری: گزارش‌گیری هیچ‌وقت روی سرعت یا پایداری برنامه اثر نمی‌گذارد، و Power BI کانکتور بومی SQL Server را می‌گیرد (رابطه‌ها، DAX، refresh زمان‌بندی‌شده).

---

## گام ۱ — آماده‌سازی SQL Server (یک‌بار)

روی سرور (`192.168.1.104`) در SSMS اجرا کنید:

```sql
CREATE DATABASE ata_erp_reporting;
GO

USE ata_erp_reporting;
GO

-- کاربر برنامه: فقط برای نوشتن جدول‌های گزارش
CREATE LOGIN ata_report WITH PASSWORD = 'یک‌رمز‌قوی';
CREATE USER ata_report FOR LOGIN ata_report;
ALTER ROLE db_owner ADD MEMBER ata_report;   -- برای ساخت/به‌روزرسانی جدول‌ها لازم است
GO

-- کاربر Power BI: فقط‌خواندنی (اصل کمترین دسترسی)
CREATE LOGIN powerbi_ro WITH PASSWORD = 'یک‌رمز‌دیگر';
CREATE USER powerbi_ro FOR LOGIN powerbi_ro;
ALTER ROLE db_datareader ADD MEMBER powerbi_ro;
GO
```

**تنظیمات شبکه (اگر برنامه و SQL Server روی یک ماشین نیستند):**
- SQL Server Configuration Manager → Protocols for MSSQLSERVER → **TCP/IP = Enabled** → ری‌استارت سرویس
- پورت **1433/TCP** را در فایروال ویندوز باز کنید
- SSMS → Server Properties → Security → **SQL Server and Windows Authentication mode** → ری‌استارت

---

## گام ۲ — تنظیم برنامه

فایل `.env.example` را به `.env` کپی و مقادیر را پر کنید:

```
ERP_SQL_SERVER=192.168.1.104
ERP_SQL_PORT=1433
ERP_SQL_DATABASE=ata_erp_reporting
ERP_SQL_USER=ata_report
ERP_SQL_PASSWORD=رمزی که بالا ساختید
```

> `.env` در `.gitignore` است و روی گیت‌هاب نمی‌رود.

بررسی اتصال (این سه مسیر احراز هویت‌شده‌اند و دسترسی «تنظیمات» می‌خواهند؛ از مرورگرِ لاگین‌کرده بازشان کنید، نه با curl خالی):

```
http://localhost:3000/api/report/sql-test
```

---

## گام ۳ — اجرای همگام‌سازی

**دستی از خط فرمان** (روی سرور):

```
cd /d E:\Apps\ATA-ERP-Rev01
npm run sync:report
```

**یا از طریق API** (نیازمند نشست کاربر با دسترسی «تنظیمات»):

```
POST http://localhost:3000/api/report/sql-sync
```

**پیش‌نمایش بدون اتصال به دیتابیس گزارش‌گیری** (برای دیدن مدل و تعداد ردیف‌ها):

```
http://localhost:3000/api/report/preview
```

### زمان‌بندی خودکار (Windows Task Scheduler)

یک Basic Task بسازید:
- **Program:** `cmd.exe`
- **Arguments:** `/c cd /d E:\Apps\ATA-ERP-Rev01 && npm run sync:report >> logs\sync.log 2>&1`
- **Start in:** `E:\Apps\ATA-ERP-Rev01` — بدون این، اسکریپت فایل `.env` را پیدا نمی‌کند

> مسیر برنامه **روی سرور** `E:\Apps\ATA-ERP-Rev01` است (کامپیوتر توسعه `D:\ATA-ERP-Rev01` است — این دو را با هم اشتباه نگیرید).
> روی این سرور از قبل تسکی به نام `ATA-ERP-ReportSync` وجود دارد که همین کار را با صدا زدن مستقیم Node انجام می‌دهد
> (`E:\nodejs\node.exe node_modules\tsx\dist\cli.mjs scripts\sync-reporting.ts`) — که به PATH وابسته نیست و شکل بهتری است.
> تسک دومی نسازید.
- **Trigger:** روزانه، یا هر ۱ ساعت

هر اجرا محتوای جدول‌ها را **کامل جایگزین** می‌کند و همه در یک تراکنش انجام می‌شود؛ پس اجرای ناموفق هیچ‌وقت داده‌ی نیمه‌کاره باقی نمی‌گذارد.

---

## گام ۴ — اتصال Power BI

1. **Get Data → SQL Server database**
2. Server: `192.168.1.104` — Database: `ata_erp_reporting`
3. با کاربر `powerbi_ro` وصل شوید
4. حالت **Import** را انتخاب کنید (برای گزارش چندوجهی و سرعت DAX بهتر از DirectQuery است)
5. جدول‌های schema `rpt` را انتخاب کنید

### روابط پیشنهادی (Model view)

روابط **یک‌به‌چند** بسازید (سمت «یک» جدول اصلی است):

| از (یک) | به (چند) | کلید |
|---|---|---|
| `customers.id` | `projects.customer_id` | مشتری → پروژه |
| `customers.id` | `proformas.customer_id` | مشتری → پیش‌فاکتور |
| `customers.id` | `transactions.customer_id` | مشتری → تراکنش |
| `projects.id` | `proformas.project_id` | پروژه → پیش‌فاکتور |
| `projects.id` | `project_items.project_id` | پروژه → اقلام درخواستی |
| `projects.id` | `purchase_orders.project_id` | پروژه → سفارش خرید |
| `projects.id` | `supplier_inquiries.project_id` | پروژه → استعلام |
| `projects.id` | `packaging_deliveries.project_id` | پروژه → تحویل |
| `projects.id` | `after_sales_services.project_id` | پروژه → خدمات |
| `projects.id` | `project_activities.project_id` | پروژه → اقدامات |
| `proformas.id` | `proforma_items.proforma_id` | پیش‌فاکتور → ردیف |
| `purchase_orders.id` | `purchase_order_items.purchase_order_id` | سفارش → ردیف |
| `suppliers.id` | `purchase_orders.supplier_id` | تأمین‌کننده → سفارش |
| `suppliers.id` | `supplier_inquiries.supplier_id` | تأمین‌کننده → استعلام |
| `supplier_inquiries.id` | `supplier_inquiry_items.inquiry_id` | استعلام → ردیف |
| `supplier_inquiries.id` | `supplier_inquiry_steps.inquiry_id` | استعلام → مراحل |
| `products.id` | `product_variants.product_id` | کالا → واریانت |
| `products.id` | `inventory_transactions.product_id` | کالا → گردش انبار |

### تاریخ‌ها

تاریخ‌ها **به‌صورت متن شمسی** (`1405/04/14`) منتقل می‌شوند. برای Time Intelligence، در Power Query یک ستون تاریخ میلادی بسازید و یک جدول تاریخ (Date table) اضافه کنید.

---

## مدل داده (۲۳ جدول)

**اصلی:** `customers`, `suppliers`, `users`, `products`, `projects`, `proformas`, `purchase_orders`, `transactions`, `supplier_inquiries`, `tasks`, `packaging_deliveries`, `after_sales_services`

**ردیف‌ها (فرزند):** `project_items`, `project_milestones`, `project_activities`, `proforma_items`, `purchase_order_items`, `supplier_inquiry_items`, `supplier_inquiry_steps`, `product_variants`, `inventory_transactions`, `packaging_delivery_items`, `after_sales_service_items`

**فیلدهای سفارشی:** `custom_fields`, `custom_field_values` — ↓ بخش جداگانه پایین‌تر

**سرویس:** `_sync_log` — تعداد ردیف و زمان آخرین همگام‌سازی هر جدول (برای نمایش «آخرین به‌روزرسانی» در داشبورد)

### نکات مفیدی که در مدل تعبیه شده

- جدول‌های فرزند **کلیدهای والد را هم دارند** (مثلاً `proforma_items` ستون‌های `customer_id` و `project_id` را دارد) — پس بسیاری از گزارش‌ها بدون join اضافی کار می‌کنند.
- `inventory_transactions.signed_quantity` — ورودی مثبت، خروجی منفی. `SUM` روی آن مستقیماً موجودی خالص می‌دهد.
- `products.stock_level` موجودی واریانت‌ها را جمع می‌زند، و `is_below_minimum` آماده برای فیلتر کمبود موجودی.
- `supplier_inquiry_items.total_foreign` و `total_riyal` از پیش محاسبه شده‌اند.
- `custom_values` (فیلدهای سفارشی هر ماژول) به‌صورت متن JSON منتقل می‌شود. **برای گزارش از این ستون استفاده نکنید** — کلیدهایش شناسه‌ی فیلد است و معنایی ندارد؛ به‌جایش دو جدول `custom_fields` و `custom_field_values` را به کار ببرید (بخش پایین). این ستون فقط برای سازگاری با گزارش‌های قدیمی باقی مانده است.
- **رمز کاربران هرگز منتقل نمی‌شود** — جدول `users` فقط نام، نقش و سمت دارد.
- `proformas.sent_date` روزی است که پیش‌فاکتور برای کارفرما ارسال شده (نه تاریخ صدور)؛ برای گزارش «زمان پاسخ مشتری» و «پیش‌فاکتورهای بی‌پیگیری» از همین ستون بشمارید.
- `proforma_items.unit_of_measure` و `packaging_delivery_items.unit_of_measure` واحد شمارش هر ردیف‌اند («عدد»، «متر»، «ست»)؛ کنارشان `unit_price_riyal` بهای واحد است، نه واحد شمارش.

---

## فیلدهای سفارشی

فیلدهایی که خودتان در «تنظیمات ← فیلدهای سفارشی» تعریف می‌کنید، در دو جدول منتقل می‌شوند. دلیل جدا بودنشان این است که برنامه مقدارِ هر فیلد را با **شناسه‌ی** فیلد ذخیره می‌کند (`cf-1755689000000`) و نامی که شما تایپ کرده‌اید جای دیگری نگهداری می‌شود؛ بدون این دو جدول، در Power BI فقط یک مشت شناسه‌ی بی‌معنا می‌دیدید.

### `custom_fields` — فرهنگ فیلدها

| ستون | معنی |
|---|---|
| `id` | شناسه‌ی فیلد (`cf-…`) |
| `module` | کلید ماژول (`products`، `customers`، …) |
| `module_label` | نام فارسی ماژول — برای Slicer |
| `name` | همان عنوانی که در تنظیمات نوشته‌اید |
| `field_type` | `text` \| `textarea` \| `number` \| `select` \| `date` \| `file` \| `boolean` |
| `options` | گزینه‌های فیلد انتخابی، با ` | ` جدا شده |
| `is_required` | اجباری بودن فیلد |

### `custom_field_values` — مقدار هر رکورد

هر ردیف یک پاسخ است: یک رکورد، یک فیلد.

| ستون | معنی |
|---|---|
| `module` / `module_label` | ماژولی که رکورد در آن است |
| `record_id` | شناسه‌ی رکورد در جدول همان ماژول |
| `field_id` | شناسه‌ی فیلد |
| `field_name` | **نام فیلد، از قبل کنارش گذاشته شده** — برای گزارش نیازی به join با `custom_fields` ندارید |
| `field_type` | نوع فیلد |
| `value_text` | مقدار به‌صورت متن — **همیشه پر است**، هر نوعی که فیلد باشد |
| `value_number` | فقط برای فیلدهای عددی. ارقام فارسی و جداکننده‌ی `٫` تبدیل شده‌اند |
| `value_bool` | فقط برای فیلدهای بله/خیر |
| `is_defined` | اگر `false` باشد یعنی فیلد از تنظیمات حذف شده ولی پاسخش روی رکورد مانده |

**تاریخ‌ها** مثل بقیه‌ی گزارش، رشته‌ی شمسی‌اند و در `value_text` می‌آیند.

### چطور در Power BI وصلش کنیم

جدول `custom_field_values` برای همه‌ی ماژول‌ها یکی است، و رابطه در Power BI تک‌ستونی است. پس برای هر ماژول یک رابطه بسازید و با `module` فیلترش کنید:

| از | به | فیلتر لازم |
|---|---|---|
| `products.id` | `custom_field_values.record_id` | `module = "products"` |
| `customers.id` | `custom_field_values.record_id` | `module = "customers"` |
| `projects.id` | `custom_field_values.record_id` | `module = "projects"` |

اگر فقط یک ماژول برایتان مهم است (مثلاً کالا)، ساده‌ترین راه این است که در Power Query یک کپی از جدول بگیرید، روی `module = "products"` فیلتر کنید، و با Pivot روی `field_name` هر فیلد را به یک ستون تبدیل کنید. آن‌وقت ستون‌هایی با نام فارسی خودتان دارید و **فیلد جدیدی که بعداً تعریف کنید، خودکار به‌عنوان ستون جدید ظاهر می‌شود**.

نمونه‌ی اندازه‌گیری:

```dax
تقاضای بازار =
CALCULATE(
    SELECTEDVALUE(custom_field_values[value_text]),
    custom_field_values[field_name] = "تقاضای بازار"
)

فروش برآوردی سالانه =
CALCULATE(
    SUM(custom_field_values[value_number]),
    custom_field_values[field_name] = "فروش برآوردی سالانه"
)
```

> **دو ماژول استثنا:** صفحه‌ی تنظیمات اجازه می‌دهد برای «بسته‌بندی و تحویل کالا» و «خدمات پس از فروش» هم فیلد سفارشی بسازید، ولی این دو ماژول ستونی برای نگهداری مقدار ندارند — پس تعریفشان در `custom_fields` می‌آید و هیچ مقداری در `custom_field_values` نخواهند داشت.

---

## چند اندازه‌گیری نمونه (DAX)

```dax
جمع فروش برنده =
CALCULATE(SUM(proforma_items[total_price_riyal]), proforma_items[item_status] = "برنده")

نرخ برد پروژه‌ها =
DIVIDE(
    CALCULATE(COUNTROWS(projects), projects[status] = "برنده (موفق)"),
    COUNTROWS(projects)
)

مانده حساب مشتری =
SUMX(transactions, IF(transactions[type] = "دریافت", transactions[amount_riyal], -transactions[amount_riyal]))

موجودی خالص کالا = SUM(inventory_transactions[signed_quantity])

آخرین به‌روزرسانی داده = MAX('_sync_log'[synced_at])
```

---

## عیب‌یابی

| نشانه | علت احتمالی |
|---|---|
| `Failed to connect ... 1433` | TCP/IP فعال نیست یا فایروال بسته است |
| `Login failed for user` | حالت احراز هویت Mixed نیست، یا رمز اشتباه است |
| `اتصال SQL Server تنظیم نشده` | `.env` ساخته نشده یا `ERP_SQL_SERVER`/`ERP_SQL_DATABASE` خالی است |
| جدول‌ها خالی‌اند | همگام‌سازی اجرا نشده — `npm run sync:report` |
| ستون جدیدی در Power BI نیست | بعد از ارتقای برنامه یک‌بار sync و بعد Refresh در Power BI |
