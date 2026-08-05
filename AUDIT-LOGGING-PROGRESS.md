# Audit Logging Implementation Progress

## ✅ Completed

### 1. Core Service Created
- ✅ `src/server/services/auditService.ts` - Helper function با LZW compression

### 2. Services Updated
- ✅ **customerService.ts** - createCustomer, updateCustomer, deleteCustomer
- ✅ **productService.ts** - createProduct, updateProduct, deleteProduct

### 3. Routes Updated
- ✅ **customers.ts** - Added `getTodayShamsi()` to all mutation routes

---

## 🔄 Remaining Services to Update

### Priority 1 (High Traffic):
1. **proformaService.ts**
   - createProforma
   - updateProforma
   - deleteProforma
   - setItemOutcomes

2. **projectService.ts**
   - createProject
   - updateProject
   - deleteProject

3. **transactionService.ts**
   - createTransaction
   - reverseTransaction

### Priority 2 (Medium Traffic):
4. **purchaseOrderService.ts**
   - createPurchaseOrder
   - updatePurchaseOrder
   - deletePurchaseOrder

5. **supplierService.ts**
   - createSupplier
   - updateSupplier
   - deleteSupplier

6. **taskService.ts**
   - createTask
   - updateTask
   - deleteTask

### Priority 3 (Lower Traffic):
7. **deliveryService.ts**
   - createDelivery
   - updateDelivery
   - deleteDelivery

8. **inquiryService.ts**
   - createInquiry
   - updateInquiry
   - deleteInquiry

9. **afterSalesService.ts** (if applicable)

10. **userService.ts**
    - createUser
    - updateUser
    - deleteUser

---

## Pattern to Follow

### 1. Import auditService
```typescript
import { logAction } from "./auditService";
```

### 2. Add `todayJalali` parameter to service functions
```typescript
// Before:
export async function createX(input: XInput, user: AuthUser)

// After:
export async function createX(input: XInput, user: AuthUser, todayJalali: string)
```

### 3. Add audit log after successful operation
```typescript
await logAction(
  {
    action: "CREATE" | "UPDATE" | "DELETE",
    module: "نام ماژول",
    entityId: entity.id,
    description: "توضیح عملیات",
    beforeState: before, // for UPDATE/DELETE
    afterState: entity,  // for CREATE/UPDATE
  },
  user,
  todayJalali,
);
```

### 4. Update routes to pass `getTodayShamsi()`
```typescript
import { getTodayShamsi } from "../../dateUtils";

// In route handler:
await createX(input, user, getTodayShamsi());
```

---

## Next Steps

1. Use bulk find/replace to add audit logging to all remaining services
2. Update all corresponding routes
3. Test one complete flow (e.g., create/update/delete proforma)
4. Verify audit logs appear in the UI

---

## Notes

- LZW compression is applied automatically by `auditService.logAction()`
- `beforeState` is optional for CREATE, required for UPDATE/DELETE
- `afterState` is optional for DELETE, required for CREATE/UPDATE
- All text descriptions should be in Persian
