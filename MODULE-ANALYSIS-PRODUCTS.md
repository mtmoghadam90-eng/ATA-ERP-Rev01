# تحلیل جامع: Products Module

## خلاصه اجرایی

Products Module در migration **بخشاً موفق** بوده ولی **6 مشکل بحرانی** داره که باعث باگ می‌شن.

---

## 📊 مقایسه متدها

### متدهای موجود:

| متد | نسخه قدیم | نسخه جدید | وضعیت |
|-----|-----------|-----------|--------|
| **addProduct** | ✅ | ✅ | ⚠️ ناقص |
| **updateProduct** | ✅ | ✅ | ⚠️ ناقص |
| **deleteProduct** | ✅ | ✅ | ✅ درست |
| **batchImportProducts** | ✅ | ❌ | ❌ حذف شده |
| **adjustStock** | بخشی از update | ✅ | ✅ بهتر شده |
| **copyProduct** | ❌ | ✅ | ✅ اضافه شده |

---

## 🔴 مشکلات Critical

### 1. **Audit Logging - کاملاً از دست رفته**

#### قبل از Migration:
```javascript
const addProduct = (product) => {
  // ... logic ...
  
  logAction(
    "CREATE",
    "کالاها",
    newProduct.id,
    `ایجاد کالای جدید: ${newProduct.name} (کد: ${newProduct.code})`,
    undefined,
    newProduct,
  );
  
  return newProduct;
};
```

#### بعد از Migration:
```typescript
export async function createProduct(input, user, todayJalali) {
  // ... logic ...
  
  return tx.product.findUnique({ where: { id: product.id }, include: { variants: true } });
  // ❌ هیچ audit logging وجود ندارد
}
```

**چرا باگ میشه:**
- نمی‌شه فهمید چه کسی چه کالایی رو ساخته
- تاریخچه تغییرات کالاها گم شده
- قابلیت troubleshooting از دست رفته

**راه‌حل:**
افزودن `logAction` در `createProduct`, `updateProduct`, `deleteProduct`

---

### 2. **Workflow Rules - کاملاً از دست رفته**

#### قبل از Migration:
```javascript
const addProduct = (product) => {
  // ... logic ...
  processWorkflowRules('product_created', newProduct);
  return newProduct;
};
```

#### بعد از Migration:
```typescript
export async function createProduct(...) {
  // ❌ هیچ workflow trigger وجود ندارد
}
```

**چرا باگ میشه:**
- اتوماسیون‌های مربوط به کالا (مثلاً اعلان به انبار) trigger نمی‌شن
- workflow های custom کاربر دیگه کار نمی‌کنن

**راه‌حل:**
افزودن `processWorkflowRules('product_created', product)` در createProduct

---

### 3. **Low Stock Workflow Trigger - از دست رفته**

#### قبل از Migration:
```javascript
const adjustMultipleProductsStock = (adjustments) => {
  // ... after stock change ...
  
  validAdjustments.forEach(adj => {
    const after = updated.find((p) => p.id === adj.productId);
    if (after.stockLevel < (after.minStockLevel || 0)) {
      processWorkflowRules('product_low_stock', after);
    }
  });
};
```

#### بعد از Migration:
```typescript
export async function applyStockDelta(tx, change) {
  // ... stock change logic ...
  
  // ❌ هیچ چک low stock وجود ندارد
}
```

**چرا باگ میشه:**
- هشدارهای موجودی کم trigger نمی‌شن
- کاربران از کالاهای رو به اتمام خبردار نمی‌شن

**راه‌حل:**
بعد از `applyStockDelta`، چک کنیم آیا `stockLevel <= minStockLevel` و trigger کنیم workflow

---

### 4. **SKU Auto-Generation برای Variants جدید - حذف شده**

#### قبل از Migration:
```javascript
const addProduct = (product) => {
  // Auto-generate SKUs for variants if missing
  if (newProduct.hasVariants && newProduct.variants) {
    newProduct.variants = newProduct.variants.map((v, i) => ({
      ...v,
      sku: v.sku || `${finalCode}-${i + 1}`,  // ✅ خودکار SKU می‌ساخت
      id: v.id || `var-${Date.now()}-${i}`,
    }));
  }
};

const updateProduct = (updatedProd) => {
  // همین منطق در update هم بود
  if (updatedProd.hasVariants && updatedProd.variants) {
    updatedProd.variants = updatedProd.variants.map((v, i) => ({
      ...v,
      sku: v.sku || `${updatedProd.code}-${i + 1}`,  // ✅ خودکار SKU می‌ساخت
      id: v.id || `var-${Date.now()}-${i}`,
    }));
  }
};
```

#### بعد از Migration:
```typescript
async function reconcileVariants(tx, productId, rows, todayJalali) {
  for (const row of rows ?? []) {
    const sku = toNullableString(row.sku, 120);
    if (!sku) continue; // ❌ اگر SKU خالی باشه، skip می‌شه نه auto-generate
    
    // ... rest of logic
  }
}
```

**چرا باگ میشه:**
- اگر کاربر variant اضافه کنه ولی SKU نده، variant ساخته نمی‌شه
- کاربر مجبوره manually SKU بده (نسخه قدیم خودکار بود)

**راه‌حل:**
```typescript
for (const row of rows ?? []) {
  let sku = toNullableString(row.sku, 120);
  
  // Auto-generate SKU if missing
  if (!sku) {
    const product = await tx.product.findUnique({ where: { id: productId }, select: { code: true } });
    const existingCount = await tx.productVariant.count({ where: { productId } });
    sku = `${product.code}-${existingCount + 1}`;
  }
  
  // ... rest of logic
}
```

---

### 5. **Product Code Auto-Generation - منطق متفاوت**

#### قبل از Migration:
```javascript
const addProduct = (product) => {
  let finalCode = cleanCode(product.code);
  if (!finalCode) {
    const seqNum = (settings.documentFormats.productStartSeq || 1) + products.length;
    finalCode = formatERPNumber(
      settings.documentFormats.productFormat || "EQ-{RAND:5}",
      { seq: seqNum, category: product.category }
    );
  }
  // ✅ اگر کاربر code نداده، خودکار generate می‌کرد
};
```

#### بعد از Migration:
```typescript
export async function createProduct(input, user, todayJalali) {
  return db.$transaction(async (tx) => {
    const product = await tx.product.create({
      data: {
        ...scalarData(input),  // ❌ code باید از قبل موجود باشه
        stockLevel: 0,
      }
    });
  });
}
```

**وضعیت:** این منطق باید در **route** یا **client** باشه.

**بررسی route:**

بذار چک کنم:
```
src/server/routes/products.ts
```

⚠️ **نیاز به بررسی:** باید ببینیم آیا در route این منطق هست یا نه.

---

### 6. **Document Number Format Settings - وابستگی به Settings**

#### قبل از Migration:
```javascript
const addProduct = (product) => {
  const seqNum = (settings.documentFormats.productStartSeq || 1) + products.length;
  finalCode = formatERPNumber(
    settings.documentFormats.productFormat || "EQ-{RAND:5}",
    { seq: seqNum, category: product.category }
  );
};
```

#### بعد از Migration:
- ❌ هیچ استفاده‌ای از `settings.documentFormats` در product service نیست

**چرا می‌تونه باگ بشه:**
- اگر کاربر format code کالا رو تغییر بده، تأثیری نداره
- کالاهای جدید با format دلخواه کاربر ساخته نمی‌شن

---

## 🟡 مشکلات با احتمال متوسط

### 7. **Batch Import Products - کاملاً حذف شده**

#### قبل از Migration:
```javascript
const batchImportProducts = (items: any[]) => {
  let successCount = 0;
  setProducts((prev) => {
    let currentProducts = [...prev];
    items.forEach((item) => {
      // ... validation & creation logic ...
      currentProducts = [newProd, ...currentProducts];
      successCount++;
    });
    saveToStorage("erp_products", currentProducts, setProducts);
    return currentProducts;
  });
  return { successCount, createCount: successCount };
};
```

#### بعد از Migration:
- ❌ هیچ متد batch import وجود ندارد

**چرا باگ میشه:**
- کاربر نمی‌تونه از Excel کالا import کنه
- feature موجود در UI کار نمی‌کنه

**راه‌حل:**
افزودن endpoint `/api/products/batch-import` که آرایه‌ای از products بگیره

---

## ✅ موارد درست Migrate شده

### 1. **Stock Movement Ledger** - بهبود یافته ✅

نسخه جدید **بهتر** از نسخه قدیمه:

```typescript
// نسخه جدید: همیشه transaction + stock update در یک تراکنش
export async function applyStockDelta(tx, change) {
  // 1. ثبت transaction
  await tx.inventoryTransaction.create({ ... });
  
  // 2. update stock
  if (change.variantId) {
    await tx.productVariant.update({ ... });
    // 3. update parent sum
    await tx.product.update({ ... });
  } else {
    await tx.product.update({ ... });
  }
}
```

**مزایا:**
- Atomic: هر stock change حتماً transaction داره
- نمی‌تونه desync بشه
- Parent stock همیشه sum of variants هست

---

### 2. **Variant Reconciliation** - بهبود یافته ✅

نسخه جدید **امن‌تر** هست:

```typescript
async function reconcileVariants(tx, productId, rows, todayJalali) {
  // ✅ Variants با ID match می‌شن، delete نمی‌شن
  // ✅ اگر variant stock داره، safe نگه داشته می‌شه
  // ✅ اگر در document استفاده شده، safe نگه داشته می‌شه
  
  for (const v of existing) {
    if (seen.has(v.id)) continue;
    
    if (current && Number(current.stockLevel) !== 0) { 
      kept++; 
      continue; 
    }
    
    const onDocuments = await tx.proformaItem.count({ where: { variantId: v.id } })
      + await tx.purchaseOrderItem.count({ where: { variantId: v.id } });
    if (onDocuments > 0) { 
      kept++; 
      continue; 
    }
    
    // فقط safe variants حذف می‌شن
    await tx.productVariant.delete({ where: { id: v.id } });
  }
}
```

**مزایا:**
- تاریخچه documents خراب نمی‌شه
- موجودی از دست نمی‌ره
- ایمن‌تر از نسخه قدیم

---

### 3. **Copy Product** - Feature جدید ✅

```typescript
export async function copyProduct(id, overrides, user) {
  // ✅ کپی کالا با variants (بدون stock)
  // ✅ SKU ها از code جدید derive می‌شن
  // ✅ code تکراری automatic resolve می‌شه
}
```

این feature در نسخه قدیم وجود نداشت.

---

### 4. **Low Stock Query** - بهبود یافته ✅

```typescript
export async function lowStockProducts(user, limit = 100) {
  return db.$queryRaw`
    SELECT TOP (${take}) ...
    WHERE [minStockLevel] > 0 AND [stockLevel] <= [minStockLevel]
    ORDER BY ([minStockLevel] - [stockLevel]) DESC
  `;
}
```

**مزایا:**
- سرعت بالا (direct SQL)
- Sort شده به ترتیب بحرانی‌ترین
- در نسخه قدیم باید کل لیست رو filter می‌کرد

---

### 5. **Permission Check** - سازگار ✅

هر دو نسخه permission check دارن.

---

### 6. **Stock Level در Simple Products** - درست ✅

```typescript
export async function updateProduct(id, input, user, todayJalali) {
  // ...
  if (!hasVariants && input.stockLevel !== undefined) {
    const delta = toNumber(input.stockLevel, 0) - Number(before.stockLevel);
    if (delta !== 0) {
      await applyStockDelta(tx, {
        productId: id, delta,
        referenceType: "EDIT", 
        notes: "اصلاح موجودی از فرم کالا",
        occurredAtJalali: todayJalali,
      });
    }
  }
}
```

این منطق درسته و با نسخه قدیم سازگاره.

---

## 🔍 نکات کشف شده

### ✅ بهبودهای معماری:

1. **Atomic Transactions**: همه stock changes در transaction هستن
2. **Ledger Integrity**: موجودی همیشه با ledger sync هست
3. **Safe Variant Deletion**: variants referenced حذف نمی‌شن
4. **Pagination**: performance بهتر برای کاتالوگ بزرگ

### ❌ Business Logic از دست رفته:

1. Audit Logging (3 نقطه)
2. Workflow Rules (2 trigger)
3. Low Stock Alert Trigger
4. SKU Auto-Generation
5. Batch Import
6. Document Format Settings

---

## 📋 پلان رفع (به ترتیب اولویت)

### Priority 1: Critical Business Logic (1 روز)

1. ✅ **Audit Logging** (2-3 ساعت)
   - افزودن `logAction` در createProduct
   - افزودن `logAction` در updateProduct (با before/after)
   - افزودن `logAction` در deleteProduct

2. ✅ **Workflow Rules** (2-3 ساعت)
   - افزودن `processWorkflowRules('product_created', ...)` در createProduct
   - افزودن `processWorkflowRules('product_updated', ...)` در updateProduct

3. ✅ **Low Stock Trigger** (1-2 ساعت)
   - بعد از هر `applyStockDelta`، چک کردن stockLevel vs minStockLevel
   - trigger کردن `processWorkflowRules('product_low_stock', ...)`

### Priority 2: UX Fixes (نیم روز)

4. ✅ **SKU Auto-Generation** (2-3 ساعت)
   - در `reconcileVariants`، اگر SKU خالی بود، generate کن

5. ⚠️ **Product Code Auto-Generation** (نیاز به بررسی route)
   - چک کن آیا در route این منطق هست یا نه
   - اگر نیست، اضافه کن

### Priority 3: Missing Features (نیم روز)

6. ✅ **Batch Import** (3-4 ساعت)
   - افزودن `/api/products/batch-import` endpoint
   - loop روی items و createProduct صدا بزن

---

## 🎯 نتیجه‌گیری

### خلاصه وضعیت:

| مورد | وضعیت |
|------|--------|
| **Core Functionality** | ✅ 80% درست |
| **Audit & Logging** | ❌ 0% (حذف شده) |
| **Workflow Automation** | ❌ 0% (حذف شده) |
| **Stock Management** | ✅ 90% (بهتر شده) |
| **UX Features** | ⚠️ 60% (ناقص) |

### توصیه:

Products Module از نظر **persistence** و **data integrity** عالیه، ولی **business logic** و **automation** کاملاً از دست رفته.

**قبل از production باید Priority 1 items رو fix کنیم.**

---

## آیتم‌های نیاز به بررسی بیشتر:

1. ❓ **Product Code Generation**: آیا در route یا client این منطق هست؟
2. ❓ **Document Format Settings**: آیا از settings استفاده می‌شه؟
3. ❓ **SKU Decode**: آیا `decodeSku` در کد جدید هست و کار می‌کنه؟

---

**مرحله بعد:** تحلیل **Proformas Module** (پیچیده‌ترین ماژول با stock reconciliation و project sync)
