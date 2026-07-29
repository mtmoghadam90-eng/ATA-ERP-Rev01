// Loads .env before anything reads process.env (PORT, ERP_DB_PATH, ERP_SQL_*).
import "dotenv/config";
import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import bcrypt from "bcryptjs";
import fs from "fs";
import multer from "multer";
import sharp from "sharp";

// We need to import seed data. 
// Since esbuild bundles server.ts, we can import from src/seedData.ts
// Wait, we can't easily import from .ts dynamically without esbuild knowing. 
// But esbuild will statically resolve it!
import { 
  SEED_CUSTOMERS, SEED_PRODUCTS, SEED_PROJECTS, SEED_PROFORMAS, 
  SEED_SUPPLIERS, SEED_PURCHASE_ORDERS, SEED_TRANSACTIONS, 
  SEED_TASKS, DEFAULT_SETTINGS, SEED_EXCHANGE_RATES 
} from "./src/seedData";
// We need SEED_USERS and SEED_PROJECT_CATEGORY_GROUPS from useERPStore
import { SEED_USERS, SEED_PROJECT_CATEGORY_GROUPS } from "./src/useERPStore";
// Power BI reporting sync (one-way export into SQL Server)
import { syncToSqlServer, testConnection, readConfigFromEnv } from "./src/reporting/sqlSync";
import { buildReportingTables, StoreCollections } from "./src/reporting/flatten";
// Server-side authentication and authorization
import {
  signSession, verifySession, sanitizeUsers, checkKeyAccess, hasPermission,
  parseCookies, buildSessionCookie, buildClearCookie, resolveSessionSecret,
  canSeeFullUsers, toUserDirectory,
  SESSION_COOKIE, AuthUser, AccessMode,
} from "./src/server/auth";
// Relational data access (SQL Server via Prisma). These endpoints are paginated
// and coexist with the legacy /api/data/:key routes during the migration.
import { registerCustomerRoutes } from "./src/server/routes/customers";
import { registerProjectRoutes } from "./src/server/routes/projects";
import { registerProformaRoutes } from "./src/server/routes/proformas";
import { registerProductRoutes } from "./src/server/routes/products";
import { registerSupplierRoutes } from "./src/server/routes/suppliers";
import { registerPurchaseOrderRoutes } from "./src/server/routes/purchaseOrders";
import { registerTransactionRoutes } from "./src/server/routes/transactions";
import { registerTaskRoutes } from "./src/server/routes/tasks";
import { registerInquiryRoutes } from "./src/server/routes/inquiries";
import { registerDeliveryRoutes } from "./src/server/routes/deliveries";
import { registerUserRoutes } from "./src/server/routes/users";
import { registerAdminRoutes } from "./src/server/routes/admin";
import { registerActivityRoutes } from "./src/server/routes/activities";
import { isDbConfigured, pingDb, disconnectDb } from "./src/server/db";

// Overridable so a second instance can be started against a scratch database
// (useful for testing, and for pointing a deployment at a specific data file).
const DB_PATH = process.env.ERP_DB_PATH
  ? path.resolve(process.env.ERP_DB_PATH)
  : path.join(process.cwd(), "database.json");

function loadStore(): Record<string, string> {
  try {
    if (fs.existsSync(DB_PATH)) {
      const raw = fs.readFileSync(DB_PATH, "utf-8");
      return JSON.parse(raw);
    }
  } catch (err) {
    console.error("Failed to load database.json, starting fresh:", err);
  }
  return {};
}

/**
 * Atomic write: serialize to a temp file, then rename over the real one.
 * A crash mid-write can no longer leave a truncated/corrupt database.json.
 */
function saveStore(data: Record<string, string>) {
  const tmpPath = `${DB_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data), "utf-8");
  fs.renameSync(tmpPath, DB_PATH);
}

/**
 * True when a value is already a bcrypt hash.
 * bcryptjs emits the `$2a$` prefix (not `$2b$`), so checking only for `$2b$`
 * treated stored hashes as plaintext and re-hashed them on every save — which
 * silently broke the affected user's login.
 */
const BCRYPT_HASH_RE = /^\$2[aby]\$\d{2}\$/;
function isBcryptHash(value: unknown): boolean {
  return typeof value === "string" && BCRYPT_HASH_RE.test(value);
}

const store: Record<string, string> = loadStore();

/**
 * Monotonic version per key, bumped on every write. Clients poll these to learn
 * which collections changed (so they can refetch just those), and send the version
 * they based their edit on so stale writes can be detected.
 */
const versions: Record<string, number> = {};
function bumpVersion(key: string): number {
  versions[key] = (versions[key] || 0) + 1;
  return versions[key];
}
function getVersion(key: string): number {
  return versions[key] || 0;
}

const insertStmt = {
  run: (key: string, value: string) => {
    store[key] = value;
    bumpVersion(key);
    saveStore(store);
  }
};
const getStmt = {
  get: (key: string) => {
    const val = store[key];
    return val !== undefined ? { value: val } : undefined;
  }
};

// Seed data if empty
if (Object.keys(store).length === 0) {
  console.log("Database is empty, seeding data...");
  
  const seedUsers = SEED_USERS.map(u => ({
    ...u,
    password: bcrypt.hashSync(u.password || '123', 10)
  }));

  const initialData = {
    'erp_settings': DEFAULT_SETTINGS,
    'erp_exchange_rates': SEED_EXCHANGE_RATES,
    'erp_customers': SEED_CUSTOMERS,
    'erp_products': SEED_PRODUCTS,
    'erp_suppliers': SEED_SUPPLIERS,
    'erp_projects': SEED_PROJECTS,
    'erp_proformas': SEED_PROFORMAS,
    'erp_purchase_orders': SEED_PURCHASE_ORDERS,
    'erp_transactions': SEED_TRANSACTIONS,
    'erp_tasks': SEED_TASKS,
    'erp_project_category_groups': SEED_PROJECT_CATEGORY_GROUPS,
    'erp_users': seedUsers,
    'erp_supplier_inquiries': [],
    'erp_packaging_deliveries': [],
    'erp_after_sales_services': []
  };

  for (const [key, value] of Object.entries(initialData)) {
    store[key] = JSON.stringify(value);
  }
  saveStore(store);
  console.log("Database seeded successfully.");
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  const UPLOADS_DIR = path.join(process.cwd(), "uploads");
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }

  // Serve static files from uploads folder
  app.use("/uploads", express.static(UPLOADS_DIR));

  // Parse JSON bodies
  app.use(express.json({ limit: "50mb" }));

  // Multer config for file upload
  const storage = multer.memoryStorage();
  const upload = multer({
    storage: storage,
    limits: {
      fileSize: 20 * 1024 * 1024 // 20 MB max overall limit
    }
  });

  app.post("/api/upload", upload.single("file"), async (req, res) => {
    if (!requireAuth(req, res)) return;
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, error: "فایلی بارگذاری نشده است." });
      }

      const { originalname, mimetype, buffer } = req.file;
      const ext = path.extname(originalname).toLowerCase();
      const uniqueName = `${Date.now()}-${Math.random().toString(36).substring(2, 11)}${ext}`;
      
      const subfolder = req.query.folder ? String(req.query.folder) : "";
      let finalDir = UPLOADS_DIR;
      if (subfolder) {
        // Prevent path traversal
        const safeSubfolder = subfolder.replace(/[^a-zA-Z0-9_-]/g, "");
        finalDir = path.join(UPLOADS_DIR, safeSubfolder);
        if (!fs.existsSync(finalDir)) {
          fs.mkdirSync(finalDir, { recursive: true });
        }
      }

      const targetPath = path.join(finalDir, uniqueName);

      if (mimetype.startsWith("image/")) {
        if (buffer.length > 10 * 1024 * 1024) {
          return res.status(400).json({ success: false, error: "حجم عکس نباید بیشتر از ۱۰ مگابایت باشد." });
        }

        try {
          let pipeline = sharp(buffer);
          const metadata = await pipeline.metadata();

          if (metadata.width && metadata.height && (metadata.width > 1200 || metadata.height > 1200)) {
            pipeline = pipeline.resize({
              width: metadata.width > metadata.height ? 1200 : undefined,
              height: metadata.height >= metadata.width ? 1200 : undefined,
              fit: "inside",
              withoutEnlargement: true
            });
          }

          if (metadata.format === "png") {
            pipeline = pipeline.png({ quality: 80, compressionLevel: 8 });
          } else {
            pipeline = pipeline.jpeg({ quality: 80, progressive: true });
          }

          await pipeline.toFile(targetPath);
        } catch (sharpErr) {
          console.error("Sharp processing failed, falling back to raw write:", sharpErr);
          await fs.promises.writeFile(targetPath, buffer);
        }
      } else {
        if (buffer.length > 20 * 1024 * 1024) {
          return res.status(400).json({ success: false, error: "حجم فایل نباید بیشتر از ۲۰ مگابایت باشد." });
        }
        await fs.promises.writeFile(targetPath, buffer);
      }

      const fileUrl = subfolder ? `/uploads/${subfolder}/${uniqueName}` : `/uploads/${uniqueName}`;
      res.json({ success: true, url: fileUrl });
    } catch (err: any) {
      console.error("Upload error:", err);
      res.status(500).json({ success: false, error: "خطا در بارگذاری فایل در سرور" });
    }
  });

  // Existing rates API
  app.get("/api/rates", async (req, res) => {
    if (!requireAuth(req, res)) return;
    const fallbacks = {
      USD: 625000,
      EUR: 678000,
      AED: 171000,
      CNY: 86000
    };
    const urls = {
      USD: 'https://www.tgju.org/profile/price_dollar_rl',
      EUR: 'https://www.tgju.org/profile/price_eur',
      AED: 'https://www.tgju.org/profile/price_aed',
      CNY: 'https://www.tgju.org/profile/price_cny'
    };

    const rates: Record<string, number> = {};
    const failedCurrencies: string[] = [];

    await Promise.all(
      Object.entries(urls).map(async ([key, url]) => {
        try {
          const response = await fetch(url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            signal: AbortSignal.timeout(10000)
          });
          if (!response.ok) {
            throw new Error(`HTTP error ${response.status}`);
          }
          const html = await response.text();
          
          const regex = /data-col="info\.last_trade\.PDrCotVal"[^>]*>([\d,]+)<\/span>/;
          const match = html.match(regex);
          if (match && match[1]) {
            const val = parseInt(match[1].replace(/,/g, ''), 10);
            if (!isNaN(val) && val > 0) {
              rates[key] = val;
              return;
            }
          }
          
          const altRegex = /class="price"[^>]*>([\d,]+)<\/span>/;
          const altMatch = html.match(altRegex);
          if (altMatch && altMatch[1]) {
            const val = parseInt(altMatch[1].replace(/,/g, ''), 10);
            if (!isNaN(val) && val > 0) {
              rates[key] = val;
              return;
            }
          }
          throw new Error("Could not parse price from HTML");
        } catch (err: any) {
          console.warn(`Failed to fetch rate for ${key}:`, err.message || err);
          failedCurrencies.push(key);
        }
      })
    );

    res.json({
      success: true,
      rates,
      failedCurrencies,
      timestamp: new Date().toISOString()
    });
  });

  // Whitelist of valid database keys to prevent access/tamper with unauthorized keys
  const ALLOWED_KEYS = new Set([
    'erp_settings',
    'erp_exchange_rates',
    'erp_customers',
    'erp_products',
    'erp_suppliers',
    'erp_projects',
    'erp_proformas',
    'erp_purchase_orders',
    'erp_transactions',
    'erp_inventory_transactions',
    'erp_tasks',
    'erp_project_category_groups',
    'erp_supplier_inquiries',
    'erp_packaging_deliveries',
    'erp_after_sales_services',
    'erp_users',
    'erp_audit_logs'
  ]);

  /* ------------------------- authentication ------------------------- */

  // Persisted outside ALLOWED_KEYS so it is never reachable through the data API.
  const SESSION_SECRET = resolveSessionSecret(
    () => {
      const row = getStmt.get("__session_secret") as { value: string } | undefined;
      return row?.value;
    },
    (secret) => {
      store["__session_secret"] = secret;
      saveStore(store);
    },
  );

  const readUsers = (): any[] => {
    const row = getStmt.get("erp_users") as { value: string } | undefined;
    if (!row) return [];
    try {
      const parsed = JSON.parse(row.value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  /**
   * Resolves the caller from their session cookie. The user record is re-read on
   * every request so permission changes, deletions and `sessionEpoch` bumps take
   * effect immediately rather than at next login.
   */
  const getAuthUser = (req: express.Request): AuthUser | null => {
    const cookies = parseCookies(req.headers.cookie);
    const payload = verifySession(cookies[SESSION_COOKIE], SESSION_SECRET);
    if (!payload) return null;
    const user = readUsers().find((u) => u && u.id === payload.uid);
    if (!user) return null;
    if ((user.sessionEpoch || 0) !== (payload.epoch || 0)) return null;
    const { password: _pw, ...safe } = user;
    return safe as AuthUser;
  };

  /** Rejects unauthenticated callers. */
  const requireAuth = (
    req: express.Request,
    res: express.Response,
  ): AuthUser | null => {
    const user = getAuthUser(req);
    if (!user) {
      res.status(401).json({
        success: false,
        error: "برای دسترسی به این بخش باید وارد سامانه شوید.",
        code: "UNAUTHENTICATED",
      });
      return null;
    }
    return user;
  };

  /** Rejects callers without permission on a collection. */
  const requireKeyAccess = (
    req: express.Request,
    res: express.Response,
    key: string,
    mode: AccessMode,
  ): AuthUser | null => {
    const user = requireAuth(req, res);
    if (!user) return null;
    const denial = checkKeyAccess(user, key, mode);
    if (denial) {
      res.status(403).json({ success: false, error: denial, code: "FORBIDDEN" });
      return null;
    }
    return user;
  };

  // Batch GET API for initial data to optimize performance and prevent connection limits/drops
  app.get("/api/init-data", (req, res) => {
    try {
      const user = requireAuth(req, res);
      if (!user) return;

      const responseData: Record<string, any> = {};
      const versionData: Record<string, number> = {};
      for (const key of ALLOWED_KEYS) {
        // Only ship collections this user is allowed to see.
        if (checkKeyAccess(user, key, "read")) {
          responseData[key] = null;
          versionData[key] = getVersion(key);
          continue;
        }
        const row = getStmt.get(key) as {value: string} | undefined;
        let value = row ? JSON.parse(row.value) : null;
        // Credentials never leave the server; users without the `users` permission
        // get only a name directory, not other accounts' permission maps.
        if (key === "erp_users" && Array.isArray(value)) {
          value = canSeeFullUsers(user) ? sanitizeUsers(value) : toUserDirectory(value);
        }
        responseData[key] = value;
        versionData[key] = getVersion(key);
      }
      // `__versions` is the baseline for change polling; it is not a stored key.
      responseData.__versions = versionData;
      res.json(responseData);
    } catch (err: any) {
      console.error("Error in GET /api/init-data:", err);
      res.status(500).json({ error: err.message || String(err) });
    }
  });

  // KV Store APIs
  app.get("/api/data/:key", (req, res) => {
    const key = req.params.key;
    if (!ALLOWED_KEYS.has(key)) {
      return res.status(403).json({ error: "Access denied: Unauthorized key" });
    }
    const reader = requireKeyAccess(req, res, key, "read");
    if (!reader) return;

    try {
      const row = getStmt.get(key) as {value: string} | undefined;
      if (row) {
        const parsed = JSON.parse(row.value);
        if (key === "erp_users" && Array.isArray(parsed)) {
          res.json(canSeeFullUsers(reader) ? sanitizeUsers(parsed) : toUserDirectory(parsed));
        } else {
          res.json(parsed);
        }
      } else {
        res.json(null);
      }
    } catch (err: any) {
      console.error(`Error in GET /api/data/${key}:`, err);
      res.status(500).json({ error: err.message || String(err) });
    }
  });

  app.post("/api/data/:key", (req, res) => {
    const key = req.params.key;
    if (!ALLOWED_KEYS.has(key)) {
      return res.status(403).json({ error: "Access denied: Unauthorized key" });
    }
    if (!requireKeyAccess(req, res, key, "write")) return;

    try {
      let data = req.body;
      
      // If saving users, ensure passwords are hashed if they changed
      if (key === 'erp_users') {
        const existingRow = getStmt.get(key) as {value: string} | undefined;
        const existingUsers = existingRow ? JSON.parse(existingRow.value) : [];
        
        data = data.map((user: any) => {
          const existingUser = existingUsers.find((u: any) => u.id === user.id);
          // Hash only genuinely new/changed passwords; never re-hash a stored hash.
          if (user.password && !isBcryptHash(user.password)) {
            user.password = bcrypt.hashSync(user.password, 10);
          } else if (!user.password && existingUser) {
            user.password = existingUser.password;
          }
          return user;
        });
      }

      insertStmt.run(key, JSON.stringify(data));
      res.json({ success: true, version: getVersion(key) });
    } catch (err: any) {
      console.error(`Error in POST /api/data/${key}:`, err);
      res.status(500).json({ success: false, error: err.message || String(err) });
    }
  });

  /**
   * Liveness probe for deployment scripts and monitoring.
   * Deliberately unauthenticated and free of any data — it only reports that the
   * process is up and serving, so a health check never needs a session.
   */
  app.get("/api/health", (req, res) => {
    res.json({ ok: true, uptimeSec: Math.round(process.uptime()) });
  });

  /**
   * Database connectivity, for diagnosing a bad DATABASE_URL after deployment.
   * Gated: the error text names the server and database.
   */
  app.get("/api/db-health", async (req, res) => {
    if (!requireAuth(req, res)) return;
    if (!isDbConfigured()) {
      return res.json({ ok: false, configured: false, error: "DATABASE_URL تنظیم نشده است." });
    }
    const result = await pingDb();
    res.status(result.ok ? 200 : 503).json({ configured: true, ...result });
  });

  // Relational endpoints. Registered after the auth helpers exist, since they
  // close over the session secret and the user store.
  const routeDeps = { requireAuth, requireKeyAccess };
  registerCustomerRoutes(app, routeDeps);
  registerProjectRoutes(app, routeDeps);
  registerProformaRoutes(app, routeDeps);
  registerProductRoutes(app, routeDeps);
  registerSupplierRoutes(app, routeDeps);
  registerPurchaseOrderRoutes(app, routeDeps);
  registerTransactionRoutes(app, routeDeps);
  registerTaskRoutes(app, routeDeps);
  registerInquiryRoutes(app, routeDeps);
  registerDeliveryRoutes(app, routeDeps);
  registerUserRoutes(app, routeDeps);
  registerAdminRoutes(app, routeDeps);
  registerActivityRoutes(app, routeDeps);

  /** Who am I? Lets the client restore its session on reload. */
  app.get("/api/me", (req, res) => {
    const user = getAuthUser(req);
    if (!user) {
      return res.status(401).json({ success: false, code: "UNAUTHENTICATED" });
    }
    res.json({ success: true, user });
  });

  /** Ends the session. */
  app.post("/api/logout", (req, res) => {
    res.setHeader("Set-Cookie", buildClearCookie());
    res.json({ success: true });
  });

  /* ------------------ Power BI reporting sync ------------------ */

  /** Reads and parses every collection out of the store for reporting. */
  const readStoreCollections = (): StoreCollections => {
    const out: Record<string, any[]> = {};
    for (const key of ALLOWED_KEYS) {
      if (key === "erp_settings") continue; // not tabular
      const row = getStmt.get(key) as { value: string } | undefined;
      if (!row) continue;
      try {
        const parsed = JSON.parse(row.value);
        if (Array.isArray(parsed)) out[key] = parsed;
      } catch {
        /* skip unparsable */
      }
    }
    return out as StoreCollections;
  };

  /** Verifies the SQL Server connection without writing anything. */
  app.get("/api/report/sql-test", async (req, res) => {
    const u = requireAuth(req, res);
    if (!u) return;
    if (!hasPermission(u, "settings")) {
      return res.status(403).json({ ok: false, error: "دسترسی به تنظیمات گزارش‌گیری مجاز نیست." });
    }
    const cfg = readConfigFromEnv();
    if (!cfg) {
      return res.status(400).json({
        ok: false,
        error:
          "اتصال SQL Server تنظیم نشده است. متغیرهای ERP_SQL_SERVER و ERP_SQL_DATABASE را در فایل .env مقدار دهید.",
      });
    }
    res.json(await testConnection(cfg));
  });

  /** Runs the one-way sync into the SQL Server reporting schema. */
  app.post("/api/report/sql-sync", async (req, res) => {
    const u = requireAuth(req, res);
    if (!u) return;
    if (!hasPermission(u, "settings")) {
      return res.status(403).json({ ok: false, error: "اجرای همگام‌سازی گزارش‌گیری مجاز نیست." });
    }
    const cfg = readConfigFromEnv();
    if (!cfg) {
      return res.status(400).json({
        ok: false,
        error:
          "اتصال SQL Server تنظیم نشده است. متغیرهای ERP_SQL_SERVER و ERP_SQL_DATABASE را در فایل .env مقدار دهید.",
      });
    }
    try {
      const result = await syncToSqlServer(readStoreCollections(), cfg);
      res.status(result.ok ? 200 : 500).json(result);
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || String(err) });
    }
  });

  /**
   * Preview of what the sync produces — table names and row counts.
   * Handy for checking the model without a database round-trip.
   */
  app.get("/api/report/preview", (req, res) => {
    const u = requireAuth(req, res);
    if (!u) return;
    if (!hasPermission(u, "settings")) {
      return res.status(403).json({ ok: false, error: "دسترسی به پیش‌نمایش گزارش‌گیری مجاز نیست." });
    }
    try {
      const datasets = buildReportingTables(readStoreCollections());
      res.json({
        ok: true,
        tables: datasets.map((d) => ({
          table: d.table,
          rows: d.rows.length,
          columns: d.rows.length > 0 ? Object.keys(d.rows[0]) : [],
        })),
        totalRows: datasets.reduce((a, d) => a + d.rows.length, 0),
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || String(err) });
    }
  });

  /** Current version of every collection — clients poll this to detect changes. */
  app.get("/api/versions", (req, res) => {
    if (!requireAuth(req, res)) return;
    const out: Record<string, number> = {};
    for (const key of ALLOWED_KEYS) out[key] = getVersion(key);
    res.json({ versions: out });
  });

  /**
   * Record-level merge. The client sends only what it changed, so two users editing
   * different records no longer overwrite each other (the whole-array POST above
   * loses the other user's concurrent edits).
   *
   * Body: { ops: [{ op: 'upsert'|'delete', id, record? }], baseVersion?: number }
   *
   * IMPORTANT: this handler is intentionally fully synchronous. Node will not
   * interleave another request inside it, which makes the read-modify-write atomic.
   * Do not introduce `await` here without adding an explicit write lock.
   */
  app.post("/api/data/:key/merge", (req, res) => {
    const key = req.params.key;
    if (!ALLOWED_KEYS.has(key)) {
      return res.status(403).json({ error: "Access denied: Unauthorized key" });
    }
    if (!requireKeyAccess(req, res, key, "write")) return;

    try {
      const { ops, baseVersion } = req.body || {};
      if (!Array.isArray(ops)) {
        return res.status(400).json({ success: false, error: "ops must be an array" });
      }

      const row = getStmt.get(key) as { value: string } | undefined;
      const current = row ? JSON.parse(row.value) : [];
      if (!Array.isArray(current)) {
        // Object-shaped keys (e.g. erp_settings) cannot be merged by record id.
        return res.status(409).json({
          success: false,
          error: "Merge is only supported for array collections",
        });
      }

      // Index by id for O(1) upserts while preserving order.
      const list: any[] = [...current];
      const indexById = new Map<string, number>();
      list.forEach((item, i) => {
        if (item && item.id !== undefined) indexById.set(String(item.id), i);
      });

      let applied = 0;
      const conflicts: string[] = [];
      const removedIds: string[] = [];

      for (const op of ops) {
        if (!op || op.id === undefined) continue;
        const id = String(op.id);

        if (op.op === "delete") {
          const idx = indexById.get(id);
          if (idx !== undefined) {
            list[idx] = undefined;
            indexById.delete(id);
            removedIds.push(id);
            applied++;
          }
          continue;
        }

        if (op.op === "upsert" && op.record) {
          let record = op.record;

          // Never persist a plaintext password.
          if (key === "erp_users") {
            const idx = indexById.get(id);
            const existing = idx !== undefined ? list[idx] : undefined;
            if (record.password && !isBcryptHash(record.password)) {
              record = { ...record, password: bcrypt.hashSync(record.password, 10) };
            } else if (!record.password && existing) {
              record = { ...record, password: existing.password };
            }
          }

          const idx = indexById.get(id);
          if (idx !== undefined) {
            // Concurrent-edit detection: if the server's copy no longer matches
            // what the client based its edit on, someone else changed it first.
            if (op.baseRecord !== undefined) {
              const serverCopy = JSON.stringify(list[idx]);
              const clientBase = JSON.stringify(op.baseRecord);
              if (serverCopy !== clientBase) conflicts.push(id);
            }
            list[idx] = record;
          } else {
            // Match the app's newest-first convention for new records.
            list.unshift(record);
            // Rebuild indices after the shift.
            indexById.clear();
            list.forEach((item, i) => {
              if (item && item.id !== undefined) indexById.set(String(item.id), i);
            });
          }
          applied++;
        }
      }

      const merged = list.filter((x) => x !== undefined);
      insertStmt.run(key, JSON.stringify(merged));

      res.json({
        success: true,
        applied,
        removedIds,
        conflicts,
        version: getVersion(key),
        // Tells the client whether it was working from stale data, so it can refresh.
        staleBase: baseVersion !== undefined && baseVersion !== getVersion(key) - 1,
      });
    } catch (err: any) {
      console.error(`Error in POST /api/data/${key}/merge:`, err);
      res.status(500).json({ success: false, error: err.message || String(err) });
    }
  });

  // Login attempt trackers for rate-limiting
  const userLoginAttempts = new Map<string, { count: number; lastAttempt: number }>();
  const ipLoginAttempts = new Map<string, { count: number; lastAttempt: number }>();

  // Login API
  app.post("/api/login", (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, message: "لطفا نام کاربری و رمز ورود را وارد کنید" });
    }
    const ip = req.ip || (req.headers['x-forwarded-for'] as string) || 'unknown';
    const now = Date.now();
    
    const userKey = `${ip}:${username.toLowerCase()}`;
    const ipKey = ip;

    // Check user-specific block (e.g. 5 failed attempts from this IP for this user)
    const userAttempt = userLoginAttempts.get(userKey);
    if (userAttempt && userAttempt.count >= 5 && now - userAttempt.lastAttempt < 5 * 60 * 1000) {
      const remainingTime = Math.ceil((5 * 60 * 1000 - (now - userAttempt.lastAttempt)) / 1000);
      return res.status(429).json({
        success: false,
        message: `تعداد تلاش‌های ناموفق برای این حساب از سیستم شما بیش از حد مجاز است. لطفا ${remainingTime} ثانیه دیگر دوباره تلاش کنید.`
      });
    }

    // Check IP-specific block (e.g. 20 failed attempts total across any accounts from this IP)
    const ipAttempt = ipLoginAttempts.get(ipKey);
    if (ipAttempt && ipAttempt.count >= 20 && now - ipAttempt.lastAttempt < 10 * 60 * 1000) {
      const remainingTime = Math.ceil((10 * 60 * 1000 - (now - ipAttempt.lastAttempt)) / 1000);
      return res.status(429).json({
        success: false,
        message: `تعداد تلاش‌های ناموفق از شبکه شما بیش از حد مجاز است. لطفا ${remainingTime} ثانیه دیگر دوباره تلاش کنید.`
      });
    }

    const row = getStmt.get('erp_users') as {value: string} | undefined;
    if (!row) {
      return res.status(401).json({ success: false, message: "کاربری یافت نشد" });
    }
    const users = JSON.parse(row.value);
    const foundUser = users.find((u: any) => u.username.toLowerCase() === username.toLowerCase());
    
    if (foundUser && bcrypt.compareSync(password, foundUser.password)) {
      // Clear rate-limiting records on success
      userLoginAttempts.delete(userKey);
      ipLoginAttempts.delete(ipKey);
      
      const isDefaultPassword = bcrypt.compareSync('123', foundUser.password);

      // Issue the session cookie — this is what authorizes every later request.
      const token = signSession(
        { uid: foundUser.id, iat: Date.now(), epoch: foundUser.sessionEpoch || 0 },
        SESSION_SECRET,
      );
      res.setHeader("Set-Cookie", buildSessionCookie(token));

      // Don't send the password hash back to the client
      const { password: _, ...safeUser } = foundUser;
      res.json({
        success: true,
        user: safeUser,
        mustChangePassword: isDefaultPassword
      });
    } else {
      // Increment failed attempts
      const currentU = userLoginAttempts.get(userKey) || { count: 0, lastAttempt: 0 };
      userLoginAttempts.set(userKey, {
        count: currentU.count + 1,
        lastAttempt: now
      });

      const currentIP = ipLoginAttempts.get(ipKey) || { count: 0, lastAttempt: 0 };
      ipLoginAttempts.set(ipKey, {
        count: currentIP.count + 1,
        lastAttempt: now
      });
      
      res.status(401).json({ success: false, message: "نام کاربری یا رمز عبور اشتباه است" });
    }
  });

  // Change Password API
  app.post("/api/change-password", (req, res) => {
    const { username, oldPassword, newPassword } = req.body;
    if (!username || !oldPassword || !newPassword) {
      return res.status(400).json({ success: false, message: "اطلاعات ارسالی برای تغییر رمز عبور ناقص است" });
    }
    
    const row = getStmt.get('erp_users') as {value: string} | undefined;
    if (!row) {
      return res.status(404).json({ success: false, message: "کاربری یافت نشد" });
    }
    const users = JSON.parse(row.value);
    const foundUserIndex = users.findIndex((u: any) => u.username.toLowerCase() === username.toLowerCase());
    if (foundUserIndex === -1) {
      return res.status(404).json({ success: false, message: "کاربر یافت نشد" });
    }
    
    const foundUser = users[foundUserIndex];
    if (!bcrypt.compareSync(oldPassword, foundUser.password)) {
      return res.status(401).json({ success: false, message: "رمز عبور فعلی نادرست است" });
    }
    
    if (newPassword.length < 4) {
      return res.status(400).json({ success: false, message: "رمز عبور جدید باید حداقل ۴ کاراکتر باشد" });
    }
    
    if (newPassword === '123') {
      return res.status(400).json({ success: false, message: "نمی‌توانید از رمز عبور ساده و پیش‌فرض استفاده کنید" });
    }
    
    // Update password and invalidate any sessions issued before the change.
    foundUser.password = bcrypt.hashSync(newPassword, 10);
    foundUser.sessionEpoch = (foundUser.sessionEpoch || 0) + 1;
    users[foundUserIndex] = foundUser;

    // Save to DB
    insertStmt.run('erp_users', JSON.stringify(users));

    // Issue a fresh session so the user stays logged in on this device only.
    const token = signSession(
      { uid: foundUser.id, iat: Date.now(), epoch: foundUser.sessionEpoch },
      SESSION_SECRET,
    );
    res.setHeader("Set-Cookie", buildSessionCookie(token));

    // Don't send the password hash back to the client
    const { password: _, ...safeUser } = foundUser;
    res.json({ success: true, user: safeUser, message: "رمز عبور با موفقیت تغییر یافت" });
  });

  // Vite middleware for development, serving index.html / dist in production
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  // Close the SQL Server pool on shutdown. A deploy restart kills this process
  // while connections are open; releasing them lets the new process bind them
  // immediately instead of waiting for the server to time them out.
  const shutdown = (signal: string) => {
    console.log(`${signal} received, shutting down.`);
    server.close(() => {
      disconnectDb().finally(() => process.exit(0));
    });
    // Do not hang forever on a stuck connection.
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

startServer();
