# تحلیل مشکلات Migration از JSON به SQL Server

## خلاصه اجرایی

در طی migration از `database.json` به SQL Server، **بخش‌های بحرانی از business logic سیستم حذف یا غیرفعال شده‌اند**. این تحلیل بر اساس مقایسه کامیت `8209323` (قبل از migration) با نسخه فعلی انجام شده است.

---

## 🔴 مشکلات Critical (عملکرد از دست رفته)

### 1. **Workflow Rules System - کاملاً از دست رفته**

**قبل از Migration:**
- ✅ سیستم automation با 26 trigger point در سراسر برنامه
- ✅ قابلیت تنظیم workflow های سفارشی توسط کاربر
- ✅ Trigger ها شامل: `customer_created`, `proforma_outcome_change`, `product_low_stock`, `project_status_change`, `supplier_created`, و غیره

**بعد از Migration:**
- ❌ هیچ فراخوانی `processWorkflowRules` در `src/server/` وجود ندارد
- ❌ تمام automation های تعریف شده توسط کاربر دیگر اجرا نمی‌شوند

**چرا این باعث باگ می‌شه:**
- هشدارهای خودکار موجودی کم دیگر ارسال نمی‌شن
- اعلان‌های تغییر وضعیت پروژه دیگر trigger نمی‌شن
- تمام automation های custom که کاربر تنظیم کرده بی‌اثر شده‌اند

**فایل‌های مرتبط:**
- قبل: `src/useERPStore.ts` - خطوط مربوط به `processWorkflowRules` (26 فراخوانی)
- بعد: `src/server/services/*.ts` - **هیچ فراخوانی وجود ندارد**

---

### 2. **Audit Logging - کاملاً از دست رفته**

**قبل از Migration:**
- ✅ 31 نقطه logging برای CREATE/UPDATE/DELETE در تمام modules
- ✅ ذخیره before/after state با LZW compression
- ✅ محدودیت 1000 لاگ آخر

**بعد از Migration:**
- ❌ هیچ فراخوانی `logAction` در services وجود ندارد
- ❌ تمام تغییرات کاربران بدون ثبت log انجام می‌شه

**چرا این باعث باگ می‌شه:**
- قابلیت audit و پیگیری تغییرات از دست رفته
- نمی‌شه فهمید چه کسی چه تغییری داده
- before/after comparison برای troubleshooting وجود نداره

**فایل‌های مرتبط:**
- قبل: `src/useERPStore.ts` - متد `logAction` (31 فراخوانی)
- بعد: `src/server/services/*.ts` - **هیچ فراخوانی وجود ندارد**

---

### 3. **Module Notifications - کاملاً از دست رفته**

**قبل از Migration:**
- ✅ 11 نقطه notification در عملیات مهم
- ✅ ارسال به module responsible و admin ها
- ✅ فیلتر بر اساس admin notification preferences

**بعد از Migration:**
- ❌ سرویس `notifyUser` موجود است ولی **هیچ‌جا فراخوانی نمی‌شه**
- ❌ تمام اعلان‌های سیستم silent شده‌اند

**چرا این باعث باگ می‌شه:**
- کاربران از رویدادهای مهم (پیش‌فاکتور جدید، سفارش جدید، وظیفه جدید) مطلع نمی‌شن
- مسئولین module ها از فعالیت‌های ماژول خودشون خبردار نمی‌شن

**فایل‌های مرتبط:**
- قبل: `src/useERPStore.ts` - متد `notifyModuleResponsible` (11 فراخوانی)
- بعد: `src/server/services/notificationService.ts` - موجود است ولی **استفاده نمی‌شه**

---

### 4. **Project Activity Auto-Logging - کاملاً از دست رفته**

**قبل از Migration:**
- ✅ لاگ خودکار فعالیت‌های پروژه (ثبت پیش‌فاکتور، سفارش خرید، تراکنش، و غیره)
- ✅ متد `autoLogFactActivity` برای ثبت timeline پروژه

**بعد از Migration:**
- ❌ هیچ فراخوانی `autoLogFactActivity` در server وجود ندارد
- ❌ timeline پروژه‌ها دیگر به‌روز نمی‌شه

**چرا این باعث باگ می‌شه:**
- تاریخچه فعالیت‌های پروژه خالی می‌مونه
- نمی‌شه ببینی که یک پروژه چه مراحلی رو طی کرده

**فایل‌های مرتبط:**
- قبل: `src/useERPStore.ts` - متد `autoLogFactActivity`
- بعد: `src/server/services/*.ts` - **وجود ندارد**

---

### 5. **Stock Reconciliation در Proforma Update - منطق تغییر کرده**

**قبل از Migration:**
```javascript
// نسخه قدیم: revert then reapply (self-healing)
const oldWon = getWonItemsOfProforma(oldPf);
oldWon.forEach(item => {
  adjustments.push({
    amount: (item.quantity || 1),  // بازگشت موجودی قدیم
    notes: `بازگشت موجودی پیش‌فاکتور ${oldPf.proformaNumber}`
  });
});

const newWon = getWonItemsOfProforma(finalUpdatedPf);
newWon.forEach(item => {
  adjustments.push({
    amount: -(item.quantity || 1),  // کسر موجودی جدید
    notes: `خروج به دلیل پیش‌فاکتور ${finalUpdatedPf.proformaNumber}`
  });
});
```

**بعد از Migration:**
```typescript
// نسخه جدید: فقط update می‌کنه، revert نمی‌کنه
await tx.proforma.update({ where: { id }, data });
if (input.items !== undefined) {
  await syncChildren({ /* ... */ });
}
// هیچ stock reconciliation وجود ندارد!
```

**چرا این باعث باگ می‌شه:**
- وقتی یک proforma رو edit می‌کنی و status اقلامش رو تغییر می‌دی، موجودی به درستی adjust نمی‌شه
- مثال: اگر item از "برنده" به "بازنده" تغییر کنه، موجودی که قبلاً کسر شده بود برنمی‌گرده

**فایل‌های مرتبط:**
- قبل: `src/useERPStore.ts:updateProforma` - خطوط مربوط به stock reconciliation
- بعد: `src/server/services/proformaService.ts:updateProforma` - **reconciliation وجود ندارد**

---

### 6. **Project Status Auto-Update Trigger - از دست رفته**

**قبل از Migration:**
```javascript
if (outcomeChanged && (newOutcome === 'تأیید شده (برنده)' || newOutcome === 'نیمه برنده')) {
  setCompletionPrompt({
    projectId: finalUpdatedPf.projectId,
    categoryName: 'پیش‌فاکتورها و مهندسی فروش',
    message: `پیش‌فاکتور ${finalUpdatedPf.proformaNumber} تایید شد...`
  });
}
```

**بعد از Migration:**
- ❌ هیچ completion prompt در updateProforma وجود ندارد
- ❌ کاربر prompt نمی‌بینه که آیا می‌خواد وضعیت category رو به "اتمام کار" تغییر بده

**چرا این باعث باگ می‌شه:**
- وقتی پیش‌فاکتور برنده می‌شه، category پروژه automatic به "اتمام کار" نمی‌ره
- کاربر باید manually یادش باشه که وضعیت رو عوض کنه

**فایل‌های مرتبط:**
- قبل: `src/useERPStore.ts:updateProforma` - setCompletionPrompt logic
- بعد: `src/server/services/proformaService.ts:updateProforma` - **وجود ندارد**

---

## 🟡 مشکلات با احتمال بالا (منطق ناقص)

### 7. **Product Variant SKU Auto-Generation - حذف شده**

**قبل از Migration:**
```javascript
if (updatedProd.hasVariants && updatedProd.variants) {
  updatedProd.variants = updatedProd.variants.map((v, i) => ({
    ...v,
    sku: v.sku || `${updatedProd.code}-${i + 1}`,
    id: v.id || `var-${Date.now()}-${i}`,
  }));
}
```

**بعد از Migration:**
- ❌ SKU برای variant های بدون SKU automatic generate نمی‌شه

**چرا این باعث باگ می‌شه:**
- variant های بدون SKU ممکنه باعث مشکل در گزارش‌گیری و inventory tracking بشن

**فایل‌های مرتبط:**
- قبل: `src/useERPStore.ts:updateProduct`
- بعد: `src/server/services/productService.ts` - **این منطق حذف شده**

---

### 8. **Stock Change Inventory Transaction Logging - از دست رفته**

**قبل از Migration:**
```javascript
// هر تغییر stock یک inventory transaction می‌سازه
const diff = newStock - oldStock;
if (diff !== 0) {
  stockTransactions.push({
    id: `inv-tr-${Date.now()}-...`,
    type: diff > 0 ? "IN" : "OUT",
    quantity: Math.abs(diff),
    referenceType: "MANUAL",
    notes: `تغییر موجودی از ${oldStock} به ${newStock} (ویرایش کالا)`,
  });
}
```

**بعد از Migration:**
- ❌ وقتی کاربر از UI صفحه products موجودی رو edit می‌کنه، transaction log نمی‌شه

**چرا این باعث باگ می‌شه:**
- تاریخچه تغییرات موجودی ناقص می‌شه
- نمی‌شه فهمید چرا موجودی یک کالا تغییر کرده

**فایل‌های مرتبط:**
- قبل: `src/useERPStore.ts:updateProduct` - stock change detection
- بعد: `src/server/services/productService.ts:updateProduct` - **این منطق وجود ندارد**

---

### 9. **Low Stock Workflow Trigger - حذف شده**

**قبل از Migration:**
```javascript
if (after.stockLevel < (after.minStockLevel || 0)) {
  processWorkflowRules('product_low_stock', after);
}
```

**بعد از Migration:**
- ❌ هیچ چک low stock در `applyStockDelta` یا `updateProduct` وجود ندارد

**چرا این باعث باگ می‌شه:**
- هشدارهای موجودی کم دیگه trigger نمی‌شن
- کاربر باید manually چک کنه که کدوم کالاها موجودیشون کمه

---

### 10. **Document Number Uniqueness Check - ضعیف شده**

**قبل از Migration:**
```javascript
// در همون transaction چک می‌شد که proformaNumber تکراری نباشه
const computedNumber = formatERPNumber(formatStr, {...});
const newProforma = {
  proformaNumber: cleanCode(proforma.proformaNumber) || computedNumber,
  // ...
};
```

**بعد از Migration:**
- ⚠️ فقط unique constraint در database است
- ⚠️ error message از database می‌آد نه یک validation دوستانه

**چرا این می‌تونه باعث باگ بشه:**
- اگر کاربر document number تکراری بده، error message friendly نیست
- validation در client ضعیف‌تر شده

---

## 🟢 موارد درست Migrate شده

این موارد **به درستی** migrate شده‌اند:

1. ✅ **Proforma Outcome Derivation** - منطق محاسبه outcome از items حفظ شده (`src/server/proformaStatus.ts`)
2. ✅ **Project Status Sync** - وقتی proforma تغییر می‌کنه، project status هم update می‌شه
3. ✅ **Stock Delta Application** - `applyStockDelta` به درستی موجودی و ledger رو sync نگه می‌داره
4. ✅ **Pagination** - تمام list ها صفحه‌بندی شدن و دیگه whole table load نمی‌شه
5. ✅ **Permission Checks** - record-level visibility به درستی پیاده شده
6. ✅ **Date Handling** - Jalali dates با DATE columns sync می‌مونن

---

## 📋 لیست اقدامات پیشنهادی (به ترتیب اولویت)

### Priority 1: Critical Business Logic

1. **بازگردانی Audit Logging**
   - افزودن `logAction` call در تمام CRUD operations در services
   - استفاده از همون LZW compression برای before/after state

2. **بازگردانی Workflow Rules**
   - افزودن `processWorkflowRules` در نقاط trigger (26 نقطه)
   - اطمینان از enrichment payload برای resolve کردن ID ها

3. **بازگردانی Module Notifications**
   - فراخوانی `notifyUser` در 11 نقطه که قبلاً `notifyModuleResponsible` بود
   - پیاده‌سازی module responsible resolution

4. **بازگردانی Project Activity Logging**
   - افزودن `autoLogFactActivity` در operations مربوط به پروژه

### Priority 2: Stock Management

5. **Stock Reconciliation در Proforma Update**
   - پیاده‌سازی revert-then-reapply logic در `updateProforma`

6. **Inventory Transaction از Product Edit**
   - تشخیص stock changes در `updateProduct` و ثبت transaction

7. **Low Stock Trigger**
   - چک کردن `stockLevel < minStockLevel` بعد از هر stock change

### Priority 3: UX Improvements

8. **Completion Prompt بعد از Proforma Win**
   - نمایش prompt برای update کردن project category status

9. **Variant SKU Auto-Generation**
   - generate کردن SKU برای variant های جدید بدون SKU

10. **Document Number Friendly Validation**
    - چک کردن uniqueness قبل از insert و نمایش پیام دوستانه

---

## 📊 آمار Migration

| مورد | قبل از Migration | بعد از Migration | وضعیت |
|------|------------------|------------------|--------|
| Workflow Rules Triggers | 26 فراخوانی | 0 فراخوانی | ❌ حذف شده |
| Audit Log Calls | 31 فراخوانی | 0 فراخوانی | ❌ حذف شده |
| Module Notifications | 11 فراخوانی | 0 فراخوانی | ❌ حذف شده |
| Project Activity Logs | چندین فراخوانی | 0 فراخوانی | ❌ حذف شده |
| Stock Reconciliation | Self-healing | ساده شده | ⚠️ ضعیف شده |
| Derived Status Logic | ✅ | ✅ | ✅ حفظ شده |
| Pagination | ❌ | ✅ | ✅ اضافه شده |

---

## نتیجه‌گیری

Migration از نظر **data persistence** و **pagination** موفق بوده، ولی **4 سیستم بحرانی business logic** در این فرآیند **کاملاً از دست رفته**:

1. ❌ Workflow Automation
2. ❌ Audit Logging  
3. ❌ User Notifications
4. ❌ Project Activity Timeline

این موارد باعث می‌شن که:
- کاربران از رویدادهای مهم مطلع نشن
- هیچ audit trail برای تغییرات وجود نداشته باشه
- automation های تنظیم شده کار نکنن
- تاریخچه پروژه‌ها خالی بمونه

**توصیه: قبل از production deployment، حداقل Priority 1 items باید پیاده بشن.**
