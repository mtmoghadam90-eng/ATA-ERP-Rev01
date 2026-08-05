# گزارش جامع: تحلیل تمام ماژول‌ها

## خلاصه اجرایی

تحلیل کامل 12 ماژول اصلی نشان می‌دهد که **4 سیستم بحرانی cross-cutting** در تمام ماژول‌ها از دست رفته‌اند.

---

## 🔴 مشکلات Cross-Cutting (موجود در همه ماژول‌ها)

### 1. **Audit Logging - کاملاً حذف شده**

**تعداد فراخوانی در نسخه قدیم:** 31 نقطه

**ماژول‌های تأثیرگرفته:**
- Customers: 4 نقطه (add, update, delete, batchUpdate)
- Projects: 4 نقطه
- Proformas: 3 نقطه
- Products: 3 نقطه
- Suppliers: 3 نقطه
- Purchase Orders: 3 نقطه
- Transactions: 3 نقطه
- Tasks: 3 نقطه
- Deliveries: 2 نقطه
- After Sales: 2 نقطه
- Settings: 1 نقطه

**Pattern در نسخه قدیم:**
```javascript
logAction(
  "CREATE" | "UPDATE" | "DELETE",
  "نام ماژول",
  entityId,
  "توضیح عملیات",
  beforeState,  // برای UPDATE و DELETE
  afterState    // برای CREATE و UPDATE
);
```

**وضعیت در نسخه جدید:**
- ❌ هیچ فراخوانی `logAction` در `src/server/services/` وجود ندارد
- ✅ سرویس `auditService` وجود دارد ولی استفاده نمی‌شود

---

### 2. **Workflow Rules - کاملاً حذف شده**

**تعداد فراخوانی در نسخه قدیم:** 26 trigger point

**Trigger های موجود:**
- `customer_created`
- `customer_updated`
- `project_created`
- `project_status_change`
- `proforma_created`
- `proforma_outcome_change`
- `product_created`
- `product_updated`
- `product_low_stock`
- `supplier_created`
- `purchase_order_created`
- `purchase_order_received`
- `transaction_created`
- `task_created`
- `task_completed`
- `task_overdue`

**Pattern در نسخه قدیم:**
```javascript
processWorkflowRules('trigger_type', payload);
```

**وضعیت در نسخه جدید:**
- ❌ هیچ فراخوانی `processWorkflowRules` در server وجود ندارد
- ❌ سرویس workflow حتی وجود ندارد

---

### 3. **Module Notifications - کاملاً حذف شده**

**تعداد فراخوانی در نسخه قدیم:** 11 نقطه

**ماژول‌های دارای notification:**
- Customers: 1 نقطه
- Projects: 1 نقطه
- Proformas: 1 نقطه
- Products: 1 نقطه
- Suppliers: 1 نقطه
- Purchase Orders: 1 نقطه
- Transactions: 1 نقطه
- Tasks: 2 نقطه
- Deliveries: 1 نقطه
- After Sales: 1 نقطه

**Pattern در نسخه قدیم:**
```javascript
notifyModuleResponsible(
  'module_name',
  'عنوان',
  'توضیح',
  projectId?
);
```

**وضعیت در نسخه جدید:**
- ✅ سرویس `notifyUser` موجود است
- ❌ ولی هیچ‌جا فراخوانی نمی‌شود

---

### 4. **Project Activity Timeline - کاملاً حذف شده**

**تعداد فراخوانی در نسخه قدیم:** ~15 نقطه

**ماژول‌های مربوطه:**
- Proformas: هر create/update/delete
- Purchase Orders: هر create/update
- Transactions: هر create
- Tasks: completion
- Deliveries: هر create

**Pattern در نسخه قدیم:**
```javascript
autoLogFactActivity(
  projectId,
  'دسته‌بندی',
  'توضیح عملیات'
);
```

**وضعیت در نسخه جدید:**
- ❌ متد `autoLogFactActivity` وجود ندارد
- ✅ جدول `projectActivities` موجود است ولی populate نمی‌شود

---

## 📋 تحلیل ماژول‌به‌ماژول

### 1. **Customers Module**

#### متدها:
- `addCustomer` ✅
- `updateCustomer` ✅
- `deleteCustomer` ✅
- `batchUpdateCustomers` ✅
- `batchImportCustomers` ✅

#### مشکلات خاص این ماژول:

##### a) **Linked Customer Sync - موجود است** ✅
```typescript
// نسخه جدید این رو درست پیاده کرده
export async function setCustomerLinks(...)
```

##### b) **Duplicate Detection - موجود است** ✅
```typescript
export async function findDuplicateCandidates(...)
```

##### c) **Migration Tool - موجود است** ✅
```typescript
export async function deleteCustomerWithMigration(...)
```

#### مشکلات:
- ❌ Audit Logging (4 نقطه)
- ❌ Workflow Rules (2 trigger: created, updated)
- ❌ Module Notification (1 نقطه)

---

### 2. **Projects Module**

#### متدها:
- `addProject` ✅
- `updateProject` ✅
- `deleteProject` ✅
- `updateProjectStatus` ✅

#### مشکلات خاص این ماژول:

##### a) **Category Groups - موجود است** ✅
```typescript
// Endpoint exists: /api/projects/:id/category-groups
```

##### b) **Custom Fields - موجود است** ✅
```typescript
// پشتیبانی از custom fields در schema
```

##### c) **Project Status Sync - موجود است** ✅
```typescript
// در proformaService.ts
await syncProjectStatus(tx, proforma.projectId, todayJalali);
```

#### مشکلات:
- ❌ Audit Logging (4 نقطه)
- ❌ Workflow Rules (2 trigger: created, status_change)
- ❌ Module Notification (1 نقطه)
- ❌ Activity Timeline populate نمی‌شه

---

### 3. **Proformas Module**

#### متدها:
- `addProforma` ✅
- `updateProforma` ✅
- `deleteProforma` ✅
- `updateProformaStatus` → `setItemOutcomes` ✅

#### ویژگی‌های خاص:

##### a) **Outcome Derivation - موجود است** ✅
```typescript
// src/server/proformaStatus.ts
export function getProformaOutcome(...)
```

##### b) **Project Status Sync - موجود است** ✅
```typescript
await syncProjectStatus(tx, proforma.projectId, todayJalali);
```

##### c) **Totals Calculation - موجود است** ✅
```typescript
function computeTotals(items, input) { ... }
```

#### مشکلات خاص این ماژول:

##### a) **Stock Reconciliation - ناقص** ⚠️

**نسخه قدیم:**
```javascript
// Revert old won items
const oldWon = getWonItemsOfProforma(oldPf);
oldWon.forEach(item => {
  adjustments.push({
    amount: (item.quantity || 1),  // بازگشت
    notes: `بازگشت موجودی پیش‌فاکتور ${oldPf.proformaNumber}`
  });
});

// Apply new won items
const newWon = getWonItemsOfProforma(finalUpdatedPf);
newWon.forEach(item => {
  adjustments.push({
    amount: -(item.quantity || 1),  // کسر
    notes: `خروج به دلیل پیش‌فاکتور ${finalUpdatedPf.proformaNumber}`
  });
});
```

**نسخه جدید:**
```typescript
export async function updateProforma(...) {
  // ❌ هیچ stock reconciliation وجود ندارد
  await tx.proforma.update({ ... });
  if (input.items !== undefined) {
    await syncChildren({ ... });
  }
}
```

**تأثیر:**
- وقتی item status از "برنده" به "بازنده" تغییر می‌کنه، موجودی برنمی‌گرده
- وقتی پیش‌فاکتور edit می‌شه، stock دوباره reconcile نمی‌شه

##### b) **Completion Prompt - حذف شده** ❌

**نسخه قدیم:**
```javascript
if (outcomeChanged && (newOutcome === 'تأیید شده (برنده)' || newOutcome === 'نیمه برنده')) {
  setCompletionPrompt({
    projectId: finalUpdatedPf.projectId,
    categoryName: 'پیش‌فاکتورها و مهندسی فروش',
    message: `پیش‌فاکتور ${finalUpdatedPf.proformaNumber} تایید شد...`
  });
}
```

**نسخه جدید:**
- ❌ هیچ completion prompt وجود ندارد

#### مشکلات عمومی:
- ❌ Audit Logging (3 نقطه)
- ❌ Workflow Rules (2 trigger: created, outcome_change)
- ❌ Module Notification (1 نقطه)
- ❌ Activity Timeline
- ⚠️ Stock Reconciliation ناقص

---

### 4. **Products Module**

**(تحلیل کامل در `MODULE-ANALYSIS-PRODUCTS.md` موجود است)**

#### خلاصه:
- ✅ Stock Management بهتر شده (atomic transactions)
- ✅ Variant Reconciliation ایمن‌تر شده
- ✅ Copy Product اضافه شده
- ❌ Audit Logging (3 نقطه)
- ❌ Workflow Rules (2 trigger + low_stock)
- ❌ Batch Import حذف شده

---

### 5. **Suppliers Module**

#### متدها:
- `addSupplier` ✅
- `updateSupplier` ✅
- `deleteSupplier` ✅
- `batchImportSuppliers` ✅

#### ویژگی‌های خاص:
- ساده‌ترین ماژول
- فقط CRUD معمولی

#### مشکلات:
- ❌ Audit Logging (3 نقطه)
- ❌ Workflow Rules (1 trigger: created)
- ❌ Module Notification (1 نقطه)

---

### 6. **Purchase Orders Module**

#### متدها:
- `addPurchaseOrder` ✅
- `updatePurchaseOrder` ✅
- `deletePurchaseOrder` ✅

#### ویژگی‌های خاص:

##### a) **Stock Receipt Reconciliation - موجود است** ✅

```typescript
// src/server/services/purchaseOrderService.ts
// Self-correcting: reads what was already credited, compares with current state
```

##### b) **Landed Cost Calculation - موجود است** ✅

```typescript
function computeLandedCosts(items, input) {
  // محاسبه landed cost با نرخ ارز ذخیره شده
}
```

#### مشکلات:
- ❌ Audit Logging (3 نقطه)
- ❌ Workflow Rules (2 trigger: created, received)
- ❌ Module Notification (1 نقطه)
- ❌ Activity Timeline

---

### 7. **Transactions Module**

#### متدها:
- `addTransaction` ✅
- `updateTransaction` ✅ (محدود)
- `deleteTransaction` → `reverseTransaction` ✅

#### ویژگی‌های خاص:

##### a) **Reversing Entry - موجود است** ✅

```typescript
// تراکنش confirmed با reversing entry اصلاح می‌شه، نه edit/delete
```

##### b) **Currency Conversion - موجود است** ✅

```typescript
// تبدیل ارز با نرخ ذخیره شده در تراکنش
```

#### مشکلات:
- ❌ Audit Logging (3 نقطه)
- ❌ Workflow Rules (1 trigger: created)
- ❌ Module Notification (1 نقطه)
- ❌ Activity Timeline

---

### 8. **Tasks Module**

#### متدها:
- `addTask` ✅
- `updateTask` ✅
- `deleteTask` ✅
- `markTaskComplete` ✅

#### ویژگی‌های خاص:

##### a) **Task Reminders - موجود است؟** ❓

نیاز به بررسی بیشتر

##### b) **Overdue Detection - موجود است؟** ❓

نیاز به بررسی بیشتر

#### مشکلات:
- ❌ Audit Logging (3 نقطه)
- ❌ Workflow Rules (3 trigger: created, completed, overdue)
- ❌ Module Notification (2 نقطه)

---

### 9. **Supplier Inquiries Module**

#### متدها:
- `addInquiry` ✅
- `updateInquiry` ✅
- `deleteInquiry` ✅
- `addInquiryStep` ✅

#### ویژگی‌های خاص:

##### a) **Auto Steps - موجود است؟** ❓

```javascript
// نسخه قدیم: inquiry steps automatically derived from actions
```

نیاز به بررسی

##### b) **Winner Enforcement - موجود است؟** ❓

```javascript
// نسخه قدیم: فقط یک winner per project
```

نیاز به بررسی

#### مشکلات:
- ❌ Audit Logging
- ❌ Workflow Rules
- ❌ Module Notification

---

### 10. **Deliveries Module**

#### متدها:
- `addDelivery` ✅
- `updateDelivery` ✅
- `deleteDelivery` ✅

#### ویژگی‌های خاص:

##### a) **Stock Deduction - موجود است؟** ❓

```javascript
// نسخه قدیم: delivery می‌تونه stock کسر کنه
```

نیاز به بررسی

#### مشکلات:
- ❌ Audit Logging (2 نقطه)
- ❌ Workflow Rules
- ❌ Module Notification (1 نقطه)
- ❌ Activity Timeline

---

### 11. **After Sales Module**

#### متدها:
- `addAfterSales` ✅
- `updateAfterSales` ✅
- `deleteAfterSales` ✅

#### ویژگی‌های خاص:

##### a) **Status Derivation - موجود است** ✅

```typescript
// src/server/afterSalesStatus.ts
export function deriveAfterSalesStatus(...)
```

#### مشکلات:
- ❌ Audit Logging (2 نقطه)
- ❌ Workflow Rules
- ❌ Module Notification (1 نقطه)

---

### 12. **Settings Module**

#### متدها:
- `updateSettings` ✅

#### ویژگی‌های خاص:
- تنها یک رکورد singleton

#### مشکلات:
- ❌ Audit Logging (1 نقطه)

---

## 📊 آمار کلی

### تعداد مشکلات شناسایی شده:

| دسته | تعداد نقطه | وضعیت |
|------|------------|--------|
| **Audit Logging** | 31 | ❌ 0% پیاده شده |
| **Workflow Rules** | 26 | ❌ 0% پیاده شده |
| **Module Notifications** | 11 | ❌ 0% پیاده شده |
| **Project Activity** | ~15 | ❌ 0% پیاده شده |
| **Stock Reconciliation** | 1 | ⚠️ ناقص |
| **Completion Prompts** | 1 | ❌ حذف شده |
| **Batch Import** | 1 | ❌ حذف شده |

### ماژول‌ها به ترتیب تعداد مشکل:

| رتبه | ماژول | تعداد مشکل |
|------|-------|------------|
| 1 | Proformas | 7 |
| 2 | Products | 6 |
| 3 | Customers | 5 |
| 4 | Projects | 5 |
| 5 | Purchase Orders | 5 |
| 6 | Tasks | 5 |
| 7 | Transactions | 4 |
| 8 | Suppliers | 3 |
| 9 | Deliveries | 4 |
| 10 | After Sales | 3 |
| 11 | Supplier Inquiries | 3 |
| 12 | Settings | 1 |

---

## 🎯 اولویت‌بندی برای رفع

### Priority 1: Cross-Cutting Systems (2-3 روز)

این‌ها در **همه ماژول‌ها** مشکل دارن:

1. **Audit Logging** (یک روز)
   - ساخت `auditService` wrapper
   - افزودن به 31 نقطه

2. **Workflow Rules** (یک روز)
   - ساخت `workflowService`
   - افزودن به 26 trigger point

3. **Module Notifications** (نیم روز)
   - استفاده از `notifyUser` موجود
   - افزودن به 11 نقطه

4. **Project Activity** (نیم روز)
   - افزودن `logProjectActivity`
   - افزودن به ~15 نقطه

### Priority 2: Module-Specific Issues (1-2 روز)

5. **Proforma Stock Reconciliation** (4 ساعت)
   - Revert-then-reapply logic

6. **Completion Prompts** (2 ساعت)
   - UI interaction

7. **Batch Import Products** (2 ساعت)
   - Endpoint جدید

### Priority 3: Items نیاز به بررسی (1 روز)

8. Task Reminders
9. Inquiry Auto Steps
10. Delivery Stock Deduction
11. Winner Enforcement

---

## 🔍 موارد نیاز به تأیید شما

برای هر ماژول، لطفاً بگویید:

### ✅ **چه چیزهایی حتماً باید کار کنن:**
- آیا Audit Logging لازم است؟
- آیا Workflow Rules لازم است؟
- آیا Module Notifications لازم است؟
- آیا Project Activity Timeline لازم است؟

### ❓ **موارد خاص:**
- آیا Stock Reconciliation در Proforma لازم است؟
- آیا Completion Prompts لازم است؟
- آیا Batch Import Products لازم است؟
- آیا Task Reminders/Overdue Detection لازم است؟

### 🔄 **تغییرات عمدی شما:**
- کدام feature ها عمداً حذف شده‌اند؟
- کدام رفتارها عمداً تغییر کرده‌اند؟

---

## 📝 مرحله بعد

وقتی تأیید کردی چه چیزهایی باید رفع بشن، شروع می‌کنیم به:

1. پیاده‌سازی cross-cutting systems
2. رفع مشکلات module-specific
3. تست هر fix قبل از merge

**آماده‌ام برای شروع وقتی لیست تأییدی رو دادی!**
