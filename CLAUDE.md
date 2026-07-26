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

## Power BI reporting

The app is **not** migrated to SQL Server. Instead `src/reporting/flatten.ts` turns the document store into 23 flat tables (each nested array becomes a child table carrying its parent's keys denormalized), and `src/reporting/sqlSync.ts` loads them into a SQL Server `rpt` schema inside one transaction (replace-all; volumes are small). Power BI reads that with its native connector. Dates stay Shamsi **strings** by explicit user decision — they convert them in Power BI. `flattenUsers` deliberately omits `password`; credentials must never reach the reporting DB. Setup and suggested relationships: `docs/powerbi-setup.md`.

## Deployment

Live on a **shared** Windows server (`192.168.1.104`) alongside IIS, SQL Server, Power BI Report Server, MSMQ, Sentinel licence servers, VMware and VoIP — so changes there must be additive only. Never edit the server's folder directly: develop locally, push, then run `scripts/deploy.ps1` on the server, which backs up the data, pulls, installs, lints, builds, and **only restarts the app if lint and build both pass** (restoring the previous build otherwise). Full guide, including one-time setup and rollback: `docs/deployment.md`.

## Gotchas

- `server.ts` statically imports seed constants from `src/` — esbuild resolves these at bundle time, so those imports must stay statically analyzable (no dynamic paths).
- `database.json` is only seeded when the store is empty. To reseed, delete the file and restart. It is gitignored — **never commit it** (it holds real business data and password hashes).
- The server binds `0.0.0.0` and has no session/token auth beyond the login endpoint; it assumes a trusted LAN. Do not expose its port to the internet.
- **Shallow-copying arrays of records is a trap.** `const next = [...items]; next[i].field = x` mutates the objects the store still holds, which made before/after comparisons identical — that silently stopped SKU stock changes from being logged as inventory transactions and corrupted audit-log snapshots. Always replace the element: `next[i] = { ...next[i], field: x }`.
- Persian text in **console/CLI** output is mangled by the Windows console codepage, so `scripts/*.ts` print English. JSON API messages stay Persian (they render correctly over HTTP and are shown to users).
- Windows PowerShell 5.1 doesn't enable TLS 1.2, so GitHub downloads fail until `[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12` is set.
