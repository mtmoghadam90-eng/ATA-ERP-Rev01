# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Persian (RTL) ERP/CRM web app for "Abzar Tamin Arshia" — a single-company internal tool covering customers, projects (sales opportunities), proformas, products/inventory, suppliers, purchase orders, transactions, tasks, packaging/delivery, and after-sales service. UI text and enum values are in Persian throughout; comparisons and status logic frequently key off Persian string literals (e.g. `'برنده'` = won, `'باخته'` = lost).

## Commands

```bash
npm run dev      # tsx server.ts — Express + Vite middleware on http://localhost:3000 (frontend + API together)
npm run build    # vite build (client) + esbuild bundle of server.ts -> dist/server.cjs
npm run start    # node dist/server.cjs (production; set NODE_ENV=production to serve dist/ instead of Vite)
npm run lint     # tsc --noEmit — the only check; there is no test suite
```

There are no tests and no ESLint. `npm run lint` (type-check) is the sole automated gate — run it after changes. Note `clean` uses `rm -rf` (won't work in PowerShell; use the Bash tool or delete manually on Windows).

## Architecture

**Single full-stack process.** `server.ts` runs Express and mounts Vite as middleware in dev, so one `npm run dev` serves both the React SPA and the JSON API. In production the same file serves the built `dist/`.

**Persistence is a JSON key-value store, not a relational schema.** `database.sqlite` (better-sqlite3) has one table `store (key TEXT, value TEXT)` where each value is a JSON blob of an entire collection. Keys are whitelisted in `ALLOWED_KEYS` in `server.ts` (`erp_customers`, `erp_products`, `erp_proformas`, etc.). Adding a new persisted collection means adding its key to `ALLOWED_KEYS` **and** the seeding block **and** the load logic in `useERPStore.ts`. The API is generic CRUD over keys:
- `GET /api/init-data` — batch-loads every allowed key in one request (primary load path)
- `GET/POST /api/data/:key` — read/write a single collection (403 on non-whitelisted keys)
- `POST /api/upload` — multer + sharp image resize/compress to `uploads/`, with path-traversal guarding
- `POST /api/login`, `/api/change-password` — bcrypt auth with in-memory per-IP/per-user rate limiting

**All app state lives in one giant hook: `src/useERPStore.ts` (~3250 lines).** `App.tsx` calls `useERPStore()` once and threads `store` down to view components as props. The hook holds every collection in `useState`, loads them on mount from `/api/init-data` (falling back to per-key fetches), and exposes CRUD methods that follow a strict pattern: **compute the new array → call `saveToStorage(key, data, setter)`**, which optimistically sets React state and fires a POST to the server (`erp_current_user` is the exception — it goes to `localStorage`). There is no cache invalidation or refetch; the client state IS the source of truth after load. When adding a mutation, always route writes through `saveToStorage`/`saveToServer` rather than calling `fetch` or `setState` directly.

**Passwords never round-trip in the clear.** The server hashes on save (detecting existing `$2b$` hashes to avoid double-hashing) and strips the hash from login responses. Seed users default to password `123`, which triggers `mustChangePassword`.

### Cross-cutting systems

- **Derived status logic** — Proforma and project statuses are computed, not stored raw. `getProformaOutcomeStatus()` and `getWonItemsOfProforma()` (in `useERPStore.ts`) derive outcome from per-item statuses; `syncProjectStatus()` propagates proforma outcomes up to the parent project. Changing status semantics means editing these functions, not scattered call sites.
- **Workflow rules engine** — `settings.workflows` (`WorkflowRule[]`) is a user-configurable automation system. Mutations fire `processWorkflowRules(triggerType, payload)` (e.g. `'customer_created'`, `'proforma_outcome_change'`, `'product_low_stock'`). When adding a mutation that should be automatable, emit the matching trigger.
- **Configurable required fields** — `settings.requiredFields[module][fieldKey]` (boolean) drives dynamic validation. `src/utils/requiredFields.tsx` holds `REQUIRED_FIELDS_METADATA` (the master list of validatable fields per module) and the validation helpers. Product variant filtering uses `configRules` (`ProductConfigRule[]`) on products.
- **Audit log** — `logAction()` records CREATE/UPDATE/DELETE/LOGIN/LOGOUT with before/after snapshots LZW-compressed via `src/utils/compress.ts`, capped at the most recent 1000 entries.
- **Jalali/Shamsi dates** — the app runs on the Persian calendar. Use the helpers in `src/dateUtils.ts` (`getTodayShamsi`, `toShamsiStr`, `addWorkingDaysToShamsi`, etc.); dates are stored as Shamsi strings, not ISO. Persian/Arabic digits are normalized with a `faToEnDigits`-style helper before parsing.
- **Live exchange rates** — `GET /api/rates` scrapes tgju.org HTML for USD/EUR/AED/CNY with hardcoded fallbacks; used to price items in multiple currencies.

### Frontend conventions

- One view component per module under `src/components/` (`CustomersView.tsx`, `ProformasView.tsx`, etc.), switched by `activeView` string state in `App.tsx` — there is no router. A `?printModule=&printId=` URL opens a document directly for printing.
- Tailwind v4 (via `@tailwindcss/vite`), dark mode through a `dark` class on `<html>` persisted to `localStorage`.
- Types are centralized in `src/types.ts`; seed data in `src/seedData.ts` (but `SEED_USERS` and `SEED_PROJECT_CATEGORY_GROUPS` live in `useERPStore.ts` and are imported by `server.ts` for seeding).
- Excel import/export via `exceljs`/`xlsx` in `src/excelUtils.ts`; financial math in `src/utils/finance.ts`.

## Gotchas

- `server.ts` statically imports seed constants from `src/` — esbuild resolves these at bundle time, so those imports must stay statically analyzable (no dynamic paths).
- `database.sqlite` is only seeded when the `store` table is empty. To reseed, delete the file and restart. It is gitignored-in-practice (untracked) — don't commit it.
- The server binds `0.0.0.0` and has no session/token auth beyond the login endpoint; it assumes a trusted LAN.
