# Plan: Complete Migration to Standard Architecture

## Goal
Remove `database.json` dependency completely and establish a standard, scalable, multi-user architecture where all data flows through the SQL Server API.

## Current State Analysis

### ✅ Already Migrated (16/18 screens)
- All 18 modules have complete Prisma services + REST APIs
- All screens READ from API (pagination, search, filters)
- Login authenticates against SQL Server
- Project activity feed reads from API
- Sidebar badges read from API

### ❌ Still Using `database.json`
1. **`useERPStore` loads 16 collections via `/api/data/:key`** (lines 799-824)
   - customers, products, suppliers, projects, proformas, purchaseOrders, transactions, tasks, etc.
   
2. **Why?** Two reasons:
   - **Task reminders** (App.tsx lines 221-264): polls `store.tasks` every 10s to check reminder times
   - **Quick-add helper methods** (props): Some views accept `addCustomer`, `addProduct` as props for inline forms

3. **Store CRUD methods** still exist and are passed as props:
   - ProformasView: `addCustomer`, `updateCustomer`, `addProduct` (props)
   - ProjectsView: `addCustomer`, `addProduct` (props)
   - TransactionsView: `addCustomer`, `addSupplier`, `addProject`, `updateProforma` (props)
   - SettingsView: `updateSettings` (prop)

## The Pattern: Two Approaches Already Working

### Approach A: Local Methods (ProductsView, CustomersView)
```typescript
// Inside the view component
const addProduct = async (product: Partial<Product>) => {
  try {
    await productsApi.create(productToWriteInput(product));
    list.refresh();
  } catch (err) {
    reportError(err, 'ثبت کالا با خطا مواجه شد.');
  }
};
```
- Methods defined inside component
- Call API directly
- Refresh list after success

### Approach B: Props (ProformasView, ProjectsView, TransactionsView)
```typescript
// Passed from App.tsx
addCustomer={store.addCustomer}
addProduct={store.addProduct}
```
- Store methods passed as props
- Store methods update in-memory collections
- Collections loaded from `/api/data/:key`

## Migration Strategy

### Phase 1: Task Reminders (HIGH PRIORITY)
**Problem:** App.tsx polls `store.tasks` every 10s to check reminder times (lines 221-264)

**Solution:** Move to API-based polling
1. Create `/api/tasks/reminders` endpoint that returns tasks with `reminderEnabled=true` matching current date/time
2. Replace `store.tasks.find(...)` with API call
3. Remove `store.tasks` dependency from reminder logic

**Files:**
- `src/server/routes/tasks.ts` - add `/api/tasks/reminders` endpoint
- `src/App.tsx` - replace polling logic

### Phase 2: Remove Quick-Add Props (MEDIUM PRIORITY)
**Problem:** ProformasView, ProjectsView, TransactionsView receive store CRUD methods as props

**Solution:** Use local methods (like ProductsView does)
1. Each view defines its own `addCustomer`, `addProduct`, etc. that call the API
2. Remove props from view interfaces
3. Remove prop drilling from App.tsx

**Files per view:**
- ProformasView: add local `addCustomer`, `addProduct`, `updateCustomer`
- ProjectsView: add local `addCustomer`, `addProduct`  
- TransactionsView: add local `addCustomer`, `addSupplier`, `addProject`, `updateProforma`

### Phase 3: Settings Migration (LOW PRIORITY)
**Problem:** SettingsView receives `updateSettings` prop; store loads settings from `/api/data/erp_settings`

**Solution:** Settings already has API (`/api/settings`)
1. SettingsView calls `settingsApi.update()` directly
2. Remove `updateSettings` prop
3. Remove settings from store initialization

**Note:** Settings is already loaded via `settingsApi.load()` in useERPStore (line 831), so this is mostly cleanup

### Phase 4: Remove Store Collections & `/api/data/:key` (FINAL CLEANUP)
**Once Phases 1-3 are done:**

1. **Remove collection loading from useERPStore** (lines 799-824)
   - Delete all `fetchKey` calls
   - Remove state: `customers`, `products`, `suppliers`, `projects`, `proformas`, etc.

2. **Remove CRUD methods from useERPStore**
   - `addCustomer`, `updateCustomer`, `deleteCustomer`, `batchUpdateCustomers`
   - `addProduct`, `updateProduct`, `deleteProduct`, `batchImportProducts`
   - `addSupplier`, `updateSupplier`, `deleteSupplier`
   - `addProject`, `updateProject`, `deleteProject`
   - `addProforma`, `updateProforma`, `deleteProforma`
   - `addTransaction`, `updateTransaction`, `deleteTransaction`
   - `addTask`, `updateTask`, `deleteTask`
   - etc. (20+ methods)

3. **Remove `/api/data/:key` endpoints from server.ts**
   - `GET /api/data/:key`
   - `POST /api/data/:key`
   - `POST /api/data/:key/merge`
   - `GET /api/init-data`
   - `GET /api/versions`

4. **Remove legacy code**
   - `saveToServer`, `saveToServerMerged`, `saveToStorage`
   - `lastSyncedByKey`, `serverVersionByKey`, `computeDeltaOps`
   - Version polling logic
   - `collectionSetters` map

5. **Delete database.json** (no longer needed)

## Benefits of This Architecture

1. **Scalable**: Pagination means thousands of records don't slow the UI
2. **Multi-user safe**: No stale in-memory collections; always fresh from DB
3. **Standard pattern**: Every view calls API directly, easy to understand
4. **Maintainable**: CRUD logic lives in services, not scattered across store
5. **Testable**: API endpoints can be tested independently
6. **Commercial grade**: Real database, proper transactions, referential integrity

## Implementation Order

1. ✅ **Phase 0: Login** (DONE - just completed)
2. **Phase 1: Task Reminders** (blocks store removal)
3. **Phase 2: Quick-Add Props** (straightforward, follows ProductsView pattern)
4. **Phase 3: Settings** (minor cleanup)
5. **Phase 4: Store Cleanup** (remove all legacy code)

## Risk Assessment

**Low Risk:**
- Phase 1 (reminders): Self-contained, easy to test
- Phase 2 (props): Each view is independent, can test one at a time
- Phase 3 (settings): Settings API already exists and works

**Medium Risk:**
- Phase 4 (store cleanup): Large deletion, but nothing should depend on it by then

**Mitigation:**
- Test each phase in browser before committing
- Commit after each phase separately
- Can roll back to any phase if issues arise

## Success Criteria

- [ ] No component reads from `store.customers`, `store.products`, etc.
- [ ] No `/api/data/:key` endpoints exist
- [ ] `database.json` file deleted
- [ ] All screens work correctly with API-only data flow
- [ ] Login, create, edit, delete all work in browser
- [ ] Task reminders still trigger correctly
- [ ] No TypeScript errors
- [ ] Git committed and pushed

## Estimated Impact

- **Files to modify:** ~8 files (App.tsx, 3 view components, useERPStore.ts, server.ts, tasks routes)
- **Lines to add:** ~150 lines (new reminder endpoint, local methods in views)
- **Lines to delete:** ~1500 lines (store collections, CRUD methods, legacy sync code)
- **Net reduction:** ~1350 lines removed = simpler, cleaner codebase
