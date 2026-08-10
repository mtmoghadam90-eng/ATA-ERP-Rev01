# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Persian (RTL) ERP/CRM web app for "Abzar Tamin Arshia" — a single-company internal tool covering customers, projects (sales opportunities), proformas, products/inventory, suppliers, purchase orders, transactions, tasks, packaging/delivery, and after-sales service. UI text and enum values are in Persian throughout; comparisons and status logic frequently key off Persian string literals (e.g. `'برنده'` = won, `'باخته'` = lost).

## Commands

```bash
npm run dev          # tsx server.ts — Express + Vite middleware on http://localhost:3000 (frontend + API together)
npm run build        # vite build (client) + esbuild bundle of server.ts -> dist/server.cjs
npm run start        # node dist/server.cjs (production; NODE_ENV=production serves dist/ instead of Vite)
npm run lint         # tsc --noEmit — the only standing check; there is no test suite
npm run sync:report  # push a flattened copy of the data into the SQL Server reporting tables
```

There are no committed tests and no ESLint. `npm run lint` (type-check) is the sole standing gate — run it after changes. Note `clean` uses `rm -rf` (won't work in PowerShell; use the Bash tool or delete manually on Windows).

**Verifying non-trivial logic.** Since there is no test suite, the working practice is to write a throwaway `__something.ts` script at the repo root, run it with `npx tsx`, and delete it once green — this has repeatedly caught real bugs (the SKU decoder round-trip, the delta-merge lost-update case, the `extractNameAndCode` regex). Never leave those files behind. Server endpoints are verified by launching a second instance against a scratch database: `PORT=3100 ERP_DB_PATH=<scratch>/test.json npx tsx server.ts` — **never test against the real `database.json`.**

## Architecture

**Single full-stack process.** `server.ts` runs Express and mounts Vite as middleware in dev, so one `npm run dev` serves both the React SPA and the JSON API. In production the same file serves the built `dist/`.

**Persistence is a flat JSON key-value file, not a relational schema.** `database.json` is a single object where each value is a JSON **string** holding an entire collection (double-encoded). `server.ts` keeps it in memory and rewrites it atomically (temp file + rename) on every write; `insertStmt`/`getStmt` are hand-rolled shims that merely look like a SQLite API — there is no SQLite (despite the leftover `database.sqlite` name in some places). Keys are whitelisted in `ALLOWED_KEYS`. Adding a new persisted collection means adding its key to `ALLOWED_KEYS` **and** the seeding block **and** the load logic in `useERPStore.ts` **and** `collectionSetters` (for live refresh). Path is overridable with `ERP_DB_PATH`; port with `PORT`. The API:
- `GET /api/init-data` — batch-loads every allowed key plus `__versions` (the change-polling baseline)
- `GET/POST /api/data/:key` — read/write a whole collection (403 on non-whitelisted keys)
- `POST /api/data/:key/merge` — **record-level delta merge; this is the normal write path** (see concurrency below)
- `GET /api/versions` — per-collection version stamps, polled every 8s by clients
- `GET /api/report/preview` · `GET /api/report/sql-test` · `POST /api/report/sql-sync` — Power BI reporting sync
- `POST /api/upload` — multer + sharp image resize/compress to `uploads/`, with path-traversal guarding
- `POST /api/login`, `/api/change-password` — bcrypt auth with in-memory per-IP/per-user rate limiting

**All app state lives in one giant hook: `src/useERPStore.ts` (~3400 lines).** `App.tsx` calls `useERPStore()` once and threads `store` down to view components as props. The hook holds every collection in `useState`, loads them on mount from `/api/init-data` (falling back to per-key fetches), and exposes CRUD methods that follow a strict pattern: **compute the new array → call `saveToStorage(key, data, setter)`**. Always route writes through `saveToStorage`/`saveToServerMerged` rather than calling `fetch` or `setState` directly — the concurrency machinery lives there. (`erp_current_user` is the exception; it goes to `localStorage`.)

**Multi-user concurrency (do not regress this).** Clients used to POST whole collections, so a stale client silently destroyed another user's concurrent additions. Now `saveToServerMerged` keeps a deep snapshot of what the server last had (`lastSyncedByKey`), diffs it by record `id`, and sends **only the changed records** to `/api/data/:key/merge`, which the server applies to its *current* copy. It falls back to a whole-blob POST for object-shaped keys (`erp_settings`) or arrays whose items lack `id`. Clients poll `/api/versions` every 8s and refetch only changed collections via `collectionSetters`. Concurrent edits to the same record are last-write-wins **plus a warning** surfaced through `onEditConflict()`.

**Passwords never round-trip in the clear.** The server hashes on save and strips the hash from login responses. Use `isBcryptHash()` to detect an existing hash — **not** `startsWith('$2b$')`: bcryptjs emits `$2a$`, and that mismatch used to re-hash stored hashes on every users save, permanently breaking that user's login. Seed users default to password `123`, which triggers `mustChangePassword`.

### Cross-cutting systems

- **Derived status logic** — Proforma and project statuses are computed, not stored raw. `getProformaOutcomeStatus()` and `getWonItemsOfProforma()` (in `useERPStore.ts`) derive outcome from per-item statuses; `syncProjectStatus()` propagates proforma outcomes up to the parent project. Changing status semantics means editing these functions, not scattered call sites.
- **Workflow rules engine** — `settings.workflows` (`WorkflowRule[]`) is a user-configurable automation system. Mutations fire `processWorkflowRules(triggerType, payload)` (e.g. `'customer_created'`, `'proforma_outcome_change'`, `'product_low_stock'`). When adding a mutation that should be automatable, emit the matching trigger.
- **Configurable required fields** — `settings.requiredFields[module][fieldKey]` (boolean) drives dynamic validation. `src/utils/requiredFields.tsx` holds `REQUIRED_FIELDS_METADATA` (the master list of validatable fields per module) and the validation helpers. **Invariant: every metadata entry must correspond to a form field that actually calls `isFieldRequired`/`renderFieldLabelWithAsterisk`, and vice versa** — drift in either direction silently breaks the toggles (a field that can't be toggled, or a toggle that does nothing). `isFieldRequired` falls back to `DEFAULT_REQUIRED_FIELDS` per field, so a field that was previously hard-coded `required` must have its default set to `true`.
- **Customers have five separate creation forms** — four call `addCustomer` (`CustomersView`'s inline linked-customer form, the shared `QuickAddModal`, and *separate* inline modals inside `ProformasView` and `TransactionsView`), while the `CustomersView` **main form builds records itself and calls `batchUpdateCustomers`** — so grepping for `addCustomer` alone misses it. Any customer-level rule must be applied to all five or it is trivially bypassed. Supporting utils: `customerValidation.ts` (at least one of mobile/phone/email/province), `iranProvinces.ts` (31 provinces + `canonicalizeProvince` so one province can't be stored two ways), `customerDuplicates.ts` (soft warnings; hard block only on economic-code collision), `customerLabel.ts` (adaptive homonym disambiguation in dropdowns), `customerMigration.ts` (reassign history to a replacement customer before deletion).
- **SKU generation and decoding** — `src/utils/skuUtils.ts`. `generateSku` builds `{productCode}-{featureCode}{optionToken}-…` where the option token is the option's own `code`, falling back to its 1-based serial (`getOptionToken`). `decodeSku` is the inverse and **must stay in sync with it**; it first tries an exact stored-variant SKU match, then parses structurally. Excel import accepts the same `name(code)` convention for options.
- **Supplier-inquiry workflow steps** — `src/utils/inquirySteps.ts` derives steps automatically from user actions (price entered → initial offer, price changed → revision, offer confirmed → final offer, winner set → winner), keyed by `autoKey` for idempotency. Step titles resolve against the user-editable `settings.dropdownItems.supplierInquirySteps` by keyword, not hardcoded strings.
- Product variant filtering uses `configRules` (`ProductConfigRule[]`) on products.
- **Audit log** — `logAction()` records CREATE/UPDATE/DELETE/LOGIN/LOGOUT with before/after snapshots LZW-compressed via `src/utils/compress.ts`, capped at the most recent 1000 entries.
- **Jalali/Shamsi dates** — the app runs on the Persian calendar. Use the helpers in `src/dateUtils.ts` (`getTodayShamsi`, `toShamsiStr`, `addWorkingDaysToShamsi`, etc.); dates are stored as Shamsi strings, not ISO. Persian/Arabic digits are normalized with a `faToEnDigits`-style helper before parsing.
- **Live exchange rates** — `GET /api/rates` scrapes tgju.org HTML for USD/EUR/AED/CNY with hardcoded fallbacks; used to price items in multiple currencies.

### Frontend conventions

- One view component per module under `src/components/` (`CustomersView.tsx`, `ProformasView.tsx`, etc.), switched by `activeView` string state in `App.tsx` — there is no router. A `?printModule=&printId=` URL opens a document directly for printing.
- Tailwind v4 (via `@tailwindcss/vite`), dark mode through a `dark` class on `<html>` persisted to `localStorage`.
- Types are centralized in `src/types.ts`; seed data in `src/seedData.ts` (but `SEED_USERS` and `SEED_PROJECT_CATEGORY_GROUPS` live in `useERPStore.ts` and are imported by `server.ts` for seeding).
- Excel import/export via `exceljs`/`xlsx` in `src/excelUtils.ts`; financial math in `src/utils/finance.ts`.

## SQL Server migration (server complete; client 16 of 18 screens)

The app is being moved off `database.json` onto SQL Server. **All 18 modules have a Prisma-backed service + REST API**, verified against the real `ata_erp`, and **16 of 18 screens now read and write through it**: customers, projects, proformas, products, suppliers, tasks, transactions, purchase orders, supplier inquiries, packing lists, after-sales, referrals, users, exchange rates, the dashboard, and settings + the audit log.

**Both paths still exist at once.** The store (`useERPStore.ts`) continues to load `database.json` through `/api/data/:key`, because two things still depend on it:

1. **The project activity/referral feed in `ProjectsView.tsx`** — `projectCategoryGroups` plus nine mutation callbacks. Every endpoint it needs already exists (`/api/projects/:id/category-groups`, `/api/activities`, the referral routes). Note the badge in the projects grid that flags rows with an active category: that is a per-project figure across the whole page, so it belongs on the project list row rather than being derived client-side.
2. **The sidebar badges in `App.tsx`** — open tasks, low stock, pending referrals, all still counted from whole collections. The server already returns each (`/api/dashboard`, `/api/tasks/summary`, `/api/referrals`).

Once those land, `/api/data/:key` and `database.json` can go. **Login is the exception to watch**: `/api/login` in `server.ts` still authenticates against `erp_users` in `database.json` while every API route resolves the user from SQL by the cookie's id — so a user must exist in *both*, with the *same id*, or they log in successfully and then see nothing.

### What the client migration is for

The recurring pattern, worth expecting in the two screens that remain: a screen holds every record so it can compute something across all of them, and that computation silently breaks once the list is paged. Each one moved to the server, where the whole set is still visible:

- **the winning supplier inquiries of a project** — found by walking every inquiry in memory (a project may have several: one supplier per part of the scope)
- **how much of a won item is still unshipped** — promised minus already shipped, across every proforma and delivery
- **document numbers** — `startSeq + collection.length`, which under paging is one page
- **an after-sales record's status** — rolled up from its rows, and the column the grid filters on
- **dashboard revenue** — eight collections reduced to a dozen numbers

- **Schema** — `prisma/schema.prisma`, 32 models, deployed via `prisma/migrations/0_init`. Things Prisma can't express (the filtered unique index on `customers.economicCode`) live in `prisma/sql/extra-indexes.sql` and must be re-run after any migration that rebuilds those tables.
- **Client** — `src/server/db.ts` exposes a single `getDb()`. **Prisma 7 has no built-in SQL Server connector**: it connects through `@prisma/adapter-mssql`, and without the adapter the first query throws "requires a driver adapter". One client per process — the adapter owns the connection pool (`mssql` default max 10), and a client per request would exhaust SQL Server.
- **Lists are paginated, always** — `src/server/listing.ts` (`parseListQuery` → `paginationArgs`/`buildResult`). `MAX_PAGE_SIZE` is 200, so no caller can pull a whole table. Sort and filter field names are **allowlisted per endpoint**; an unchecked value would go straight into Prisma's `orderBy`. `searchClause` expands a term into its Persian variants (ی/ي, ک/ك, fa/ar digits) because SQL Server's collation treats them as different characters and a search would silently miss rows.
- **Module pattern** — one service under `src/server/services/` (queries + record-level visibility) plus one route file under `src/server/routes/` (HTTP, validation, permission gate). `src/server/services/customerService.ts` and `src/server/routes/customers.ts` are the reference implementation; follow their shape. Routes take `RouteDeps` (`src/server/routes/types.ts`) so they reuse `server.ts`'s single definition of `requireAuth`/`requireKeyAccess`; `sendError` maps Prisma error codes to Persian messages without leaking table names.
- **Append-only collections never go through `syncChildren`** — inquiry steps, project activities, referrals and their messages, module notes, and the stock ledger. Each has its own add-one endpoint. Removal is restricted: a derived (`isAuto`) inquiry step cannot be deleted at all, and an activity cannot be deleted once its referral has replies.
- **Money and stock are computed, never accepted.** Proforma and purchase-order line totals are recomputed from quantity × price; a PO's landed cost from its own stored exchange rate. Transactions convert foreign amounts at the document's rate. A confirmed transaction is corrected by a **reversing entry**, never edited or deleted — and both halves stay in the balance totals so the pair cancels (dropping the reversed original while keeping its reversal applies the correction twice).
- **A received purchase order reconciles stock against the ledger**, not by revert-then-reapply: it reads what it has already credited (`referenceType`/`referenceId`), compares with what its lines and status now say, and writes only the difference. Idempotent and self-correcting; un-receiving targets zero.
- **Passwords are write-only.** Every user read goes through an explicit `select` that omits `passwordHash`, so a new column cannot leak by default. Callers without the `users` permission get a name-only directory projection rather than a refusal, because the assignment pickers need it. Changing permissions, deactivating an account, or setting a password bumps `sessionEpoch`, which invalidates cookies already issued.
- **`toNumber` translates Persian punctuation, not just digits** — `٫` (U+066B) is the decimal separator; leaving it in place turned `"۱۲٫۵"` into NaN and then into the fallback, silently storing 12.5 as 0.
- **All 18 modules converted**: customers, projects, proformas, products/inventory, suppliers, purchase orders, transactions, tasks, supplier inquiries, deliveries, after-sales, users, settings, exchange rates, audit log, project activities, referrals, module notes.
- **Dates are two columns** (`xDate` DATE + `xDateJalali` string) and `src/server/dates.ts` is the only place that maps between them. Use `expandDateFields` in a service, `jalaliRangeFilter` for a range. Two traps it exists to close: a JS `Date` built from local midnight serializes as 20:30 the *previous* day on this UTC+03:30 host (everything here is `Date.UTC`, read back with UTC getters), and both calendars are written `YYYY/MM/DD` — so `"2026-07-28"` parsed as Shamsi becomes 2647 CE. The year selects the calendar (1200–1600 ⇒ Jalali).
- **Line-item grids** use `syncChildren` (`src/server/childSync.ts`): delete and re-insert inside the parent's transaction, with `lineNo` recording the user's order. Absent means "not edited"; `[]` means "the user removed them all" — conflating those wipes a grid on any partial save. **Never use it for entities that are referenced or append-only** (product variants, activities, referrals, inquiry steps, the stock ledger); rebuilding those breaks foreign keys and destroys history. Variants are reconciled by identity in `productService.ts` instead.
- **Money and derived status are computed server-side, never taken from the request.** `src/server/proformaStatus.ts` holds the outcome rules (a proforma's outcome derives from its line statuses; a project's status derives from its proformas) and writing a proforma re-derives its project in the same transaction. Proforma totals are recomputed from the stored lines.
- **Stock moves only through `applyStockDelta`**, which writes the ledger entry and the new level together — so a movement can't exist without its history. An edited stock field is diffed into a movement; manual adjustments take a signed delta, not a new level, so concurrent adjustments add up. For a product with variants the parent level is the sum of its SKUs.
- **Record-level access is applied inside the query**, never as a post-filter — otherwise the pagination totals leak the existence of records the user can't see. `visibilityClause` returns `undefined` for a user with the module permission and `{ ownerUserId: user.id }` otherwise, and writes re-check it before touching the row.
- **Bodies are picked, not spread** — routes copy only an allowlist of writable fields, so a client can't set `id`, `createdAt`, `ownerUserId`, or a derived column like `mobileNormalized`.
- **Seeding** — `npm run seed:db` (users, settings, exchange rates only; no demo business data). Idempotent: users upsert on `username` and never have their password overwritten, settings and rates are create-only so live values aren't reset.
- `npm run db:deploy` / `db:generate` wrap the Prisma CLI. `GET /api/db-health` reports connectivity (authenticated — the error text names the server and database).

## Power BI reporting

Reporting is a **separate, one-way export** and is unaffected by the migration above — it targets its own `ata_erp_reporting` database. `src/reporting/flatten.ts` turns the document store into 23 flat tables (each nested array becomes a child table carrying its parent's keys denormalized), and `src/reporting/sqlSync.ts` loads them into a SQL Server `rpt` schema inside one transaction (replace-all; volumes are small). Power BI reads that with its native connector. Dates stay Shamsi **strings** by explicit user decision — they convert them in Power BI. `flattenUsers` deliberately omits `password`; credentials must never reach the reporting DB. Setup and suggested relationships: `docs/powerbi-setup.md`.

## Deployment

Live on a **shared** Windows server (`192.168.1.104`) alongside IIS, SQL Server, Power BI Report Server, MSMQ, Sentinel licence servers, VMware and VoIP — so changes there must be additive only. Never edit the server's folder directly: develop locally, push, then run `scripts/deploy.ps1` on the server, which backs up the data, pulls, installs, lints, builds, and **only restarts the app if lint and build both pass** (restoring the previous build otherwise). Full guide, including one-time setup and rollback: `docs/deployment.md`.

## Gotchas

- `server.ts` statically imports seed constants from `src/` — esbuild resolves these at bundle time, so those imports must stay statically analyzable (no dynamic paths).
- `database.json` is only seeded when the store is empty. To reseed, delete the file and restart. It is gitignored — **never commit it** (it holds real business data and password hashes).
- The server binds `0.0.0.0` and has no session/token auth beyond the login endpoint; it assumes a trusted LAN. Do not expose its port to the internet.
- **Shallow-copying arrays of records is a trap.** `const next = [...items]; next[i].field = x` mutates the objects the store still holds, which made before/after comparisons identical — that silently stopped SKU stock changes from being logged as inventory transactions and corrupted audit-log snapshots. Always replace the element: `next[i] = { ...next[i], field: x }`.
- Persian text in **console/CLI** output is mangled by the Windows console codepage, so `scripts/*.ts` print English. JSON API messages stay Persian (they render correctly over HTTP and are shown to users).
- Windows PowerShell 5.1 doesn't enable TLS 1.2, so GitHub downloads fail until `[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12` is set.
- **`DATABASE_URL` is a JDBC-style string, not a URL.** `sqlserver://host:1433;database=…;user=…;password=…` — do **not** percent-encode the password: `%40` is read literally and fails with `P1000`. Only `; = { }` need escaping, by wrapping the value in braces.
- **`sqlcmd` connects with `QUOTED_IDENTIFIER OFF`**, and SQL Server refuses to create filtered or computed-column indexes in that state (`Msg 1934`). `prisma/sql/extra-indexes.sql` sets it explicitly; pass `-I` as well when running SQL by hand.
- **A scratch instance isolates the JSON store but not SQL Server.** `PORT=3100 ERP_DB_PATH=<scratch>/test.json` still reads `DATABASE_URL` from `.env`, so any Prisma-backed endpoint you exercise writes to the **real** database. Point `DATABASE_URL` at a scratch database too, or clean up what the test created and assert the counts back to zero.
- **Git Bash mangles Persian in `curl -d`** — the UTF-8 arrives as `?????`, which then looks like an application bug (e.g. `mobileNormalized` coming back `null`). Drive HTTP tests from a Node script using `fetch` instead of composing them in the shell.
- npm blocks package install scripts by default here. That was harmless for `esbuild` (its binary arrives via optionalDependencies) but **not** for Prisma, whose engines come from its install script — approve with `npm approve-scripts` and `npm rebuild` if Prisma commands fail.
- **A migration that has shipped is history — never edit it.** Prisma records a migration by *name* and never runs it again, so amending an applied one reaches every repository and no database. This is not hypothetical: `discountAmount` was added to `20260808000000_inquiry_discount` after that migration had run, so `discountPercent` existed and `discountAmount` did not, and the whole supplier-inquiry module answered P2022 — "The column `discountAmount` does not exist in the current database" — on every read and write, while `_prisma_migrations` listed every migration as applied. Add a new migration instead, guarded with `IF COL_LENGTH(...) IS NULL` so it is safe on databases built after the amendment. `src/server/schemaCheck.ts` now verifies the *columns* the migrations create, not just their names, because names alone cannot see this.
- **`npx prisma migrate dev` cannot run here** — the SQL login has no `CREATE DATABASE` right, so the shadow database fails with `P3014`. Write the migration SQL by hand (see `prisma/migrations/20260803000000_*`) and apply it with `npm run db:deploy`. `migrate diff` is also unhelpful: it wants to re-create ~18 DEFAULT constraints that introspection does not report, burying the real change.
- **A cast is not a check.** The client adapters end in `as unknown as Product` and friends, because the client types carry fields a list row does not. That means a wrong field name inside the object literal compiles cleanly and fails at runtime — three separate bugs reached the browser this way (`calculatedLandedCostRIYAL`, `calculatedLandedCostForeign`, and `useUserDirectory()` returning `{ users }` rather than an array). Open the screen; a green type-check proves less here than usual.
- **Module notes are their own table** (`/api/notes/:entityType/:entityId`), never a column. Folding a note into the record and saving the record discards it silently — which is exactly what happened on two screens.
- **`compressLZW` output format changed.** It now emits `[alphabet, codes]`. The old encoder seeded its dictionary with char codes 0–255, so every Persian character produced `undefined` → `null`, and every audit snapshot ever taken was unrecoverable. Old entries decode to empty rather than to garbage.
- **A scratch browser login needs the user in both stores with the same id.** `/api/login` reads `database.json`; the API routes resolve the cookie's id against SQL. A stale duplicate in `erp_users` will log you in as an account that owns nothing — the symptom is an empty screen with a working session.
