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

**دستی از خط فرمان:**

```bash
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
- **Arguments:** `/c cd /d D:\ATA-ERP-Rev01 && npm run sync:report >> logs\sync.log 2>&1`
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

**سرویس:** `_sync_log` — تعداد ردیف و زمان آخرین همگام‌سازی هر جدول (برای نمایش «آخرین به‌روزرسانی» در داشبورد)

### نکات مفیدی که در مدل تعبیه شده

- جدول‌های فرزند **کلیدهای والد را هم دارند** (مثلاً `proforma_items` ستون‌های `customer_id` و `project_id` را دارد) — پس بسیاری از گزارش‌ها بدون join اضافی کار می‌کنند.
- `inventory_transactions.signed_quantity` — ورودی مثبت، خروجی منفی. `SUM` روی آن مستقیماً موجودی خالص می‌دهد.
- `products.stock_level` موجودی واریانت‌ها را جمع می‌زند، و `is_below_minimum` آماده برای فیلتر کمبود موجودی.
- `supplier_inquiry_items.total_foreign` و `total_riyal` از پیش محاسبه شده‌اند.
- `custom_values` (فیلدهای سفارشی هر ماژول) به‌صورت متن JSON منتقل می‌شود؛ در صورت نیاز در Power Query بازش کنید.
- **رمز کاربران هرگز منتقل نمی‌شود** — جدول `users` فقط نام، نقش و سمت دارد.

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
