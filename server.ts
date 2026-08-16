// Loads .env before anything reads process.env (PORT, DATABASE_URL, ERP_SQL_*).
import "dotenv/config";
import { startFileLogging } from "./src/server/logFile";
import { checkSchema, reportSchemaState } from "./src/server/schemaCheck";
import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import fs from "fs";
import multer from "multer";
import sharp from "sharp";

// Power BI reporting sync (one-way export into SQL Server)
import { syncToSqlServer, testConnection, readConfigFromEnv } from "./src/reporting/sqlSync";
import { buildReportingTables } from "./src/reporting/flatten";
import { readSqlCollections } from "./src/reporting/loadFromSql";
// Server-side authentication and authorization
import {
  signSession, verifySession, checkKeyAccess, hasPermission,
  parseCookies, buildSessionCookie, buildClearCookie, resolveSessionSecret,
  SESSION_COOKIE, AuthUser, AccessMode,
} from "./src/server/auth";
// Relational data access (SQL Server via Prisma). Every list is paginated; the
// document store these replaced, and its /api/data/:key routes, are gone.
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
import { registerNotificationRoutes } from "./src/server/routes/notifications";
import { registerDashboardRoutes } from "./src/server/routes/dashboard";
import { scrapeRates } from "./src/server/rateSource";
import { ensureRatesFresh } from "./src/server/services/rateRefresh";
import { ensureWorkflowSweepRanToday, runDueWorkflows } from "./src/server/services/workflowSweep";
import { isDbConfigured, pingDb, disconnectDb } from "./src/server/db";
import { authenticateUser, findAuthUser } from "./src/server/services/userService";

/**
 * Where the session-signing secret is kept.
 *
 * It used to live inside database.json, which was also the application's data
 * store; that store is gone, but the secret still has to survive a restart or
 * every open session would be invalidated on every deploy. So it gets a file of
 * its own — a single opaque string, no business data.
 *
 * Setting ERP_SESSION_SECRET in the environment takes precedence and skips the
 * file entirely, which is the better arrangement for a real deployment.
 */
const SECRET_PATH = process.env.ERP_SECRET_PATH
  ? path.resolve(process.env.ERP_SECRET_PATH)
  : path.join(process.cwd(), ".session-secret");

function readStoredSecret(): string | undefined {
  try {
    if (fs.existsSync(SECRET_PATH)) {
      const raw = fs.readFileSync(SECRET_PATH, "utf-8").trim();
      return raw || undefined;
    }
  } catch (err) {
    console.error("Failed to read the session secret:", err);
  }
  return undefined;
}

/** Atomic write, so a crash mid-write cannot leave a truncated secret. */
function writeStoredSecret(secret: string): void {
  const tmpPath = `${SECRET_PATH}.tmp`;
  fs.writeFileSync(tmpPath, secret, "utf-8");
  fs.renameSync(tmpPath, SECRET_PATH);
}

async function startServer() {
  // Before anything else, so a failure during startup is on record too.
  const logFile = startFileLogging();

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
    if (!await requireAuth(req, res)) return;
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
  /**
   * Today's rates, scraped and returned without being stored.
   *
   * Kept for callers that want to look without writing; the screen that
   * refreshes the stored rates uses POST /api/exchange-rates/refresh, which
   * scrapes and saves in the one call.
   */
  app.get("/api/rates", async (req, res) => {
    if (!await requireAuth(req, res)) return;
    const { rates, failedCurrencies } = await scrapeRates();
    res.json({
      success: true,
      rates,
      failedCurrencies,
      timestamp: new Date().toISOString()
    });
  });

  /* ------------------------- authentication ------------------------- */

  const SESSION_SECRET = resolveSessionSecret(readStoredSecret, writeStoredSecret);

  /**
   * Resolves the caller from their session cookie. The user record is re-read on
   * every request so permission changes, deletions and `sessionEpoch` bumps take
   * effect immediately rather than at next login.
   */
  const getAuthUser = async (req: express.Request): Promise<AuthUser | null> => {
    const cookies = parseCookies(req.headers.cookie);
    const payload = verifySession(cookies[SESSION_COOKIE], SESSION_SECRET);
    if (!payload) return null;

    // From SQL, which is where accounts, permissions and sessionEpoch live.
    // This read erp_users out of the document store while login authenticated
    // against SQL: the two agreed only because both were seeded from the same
    // constants, so an account created in the users screen could sign in and
    // then be refused by every request, and a permission change or a
    // deactivation made in the UI had no effect on what anyone could reach.
    const user = await findAuthUser(payload.uid);
    if (!user) return null;
    if ((user.sessionEpoch || 0) !== (payload.epoch || 0)) return null;

    const { sessionEpoch: _epoch, ...safe } = user;
    return safe as AuthUser;
  };

  /** Rejects unauthenticated callers. */
  const requireAuth = async (
    req: express.Request,
    res: express.Response,
  ): Promise<AuthUser | null> => {
    const user = await getAuthUser(req);
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
  const requireKeyAccess = async (
    req: express.Request,
    res: express.Response,
    key: string,
    mode: AccessMode,
  ): Promise<AuthUser | null> => {
    const user = await requireAuth(req, res);
    if (!user) return null;
    const denial = checkKeyAccess(user, key, mode);
    if (denial) {
      res.status(403).json({ success: false, error: denial, code: "FORBIDDEN" });
      return null;
    }
    return user;
  };




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
    if (!await requireAuth(req, res)) return;
    if (!isDbConfigured()) {
      return res.json({ ok: false, configured: false, error: "DATABASE_URL تنظیم نشده است." });
    }
    const result = await pingDb();
    // Reachable is not the same as correct. A database missing a migration
    // answers every ping happily while one module 500s on everything.
    const schema = await checkSchema();
    res.status(result.ok ? 200 : 503).json({
      configured: true,
      ...result,
      migrations: {
        applied: schema.applied.length,
        expected: schema.expected.length,
        missing: schema.missing,
        ...(schema.error ? { error: schema.error } : {}),
      },
    });
  });

  // Relational endpoints. Registered after the auth helpers exist, since they
  // close over the session secret and the user store.
  /**
   * Replaces the caller's cookie after their own `sessionEpoch` moved.
   *
   * The epoch is bumped to invalidate sessions already issued — the point of a
   * password change. But it invalidates the browser doing the changing too, so
   * without this the user was thrown out mid-operation and told their session
   * had expired, over a change that had already been saved.
   */
  const reissueSession = (res: express.Response, userId: string, epoch: number): void => {
    const token = signSession({ uid: userId, iat: Date.now(), epoch }, SESSION_SECRET);
    res.setHeader("Set-Cookie", buildSessionCookie(token));
  };

  const routeDeps = { requireAuth, requireKeyAccess, reissueSession };
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
  registerNotificationRoutes(app, routeDeps);
  registerDashboardRoutes(app, routeDeps);

  /** Who am I? Lets the client restore its session on reload. */
  app.get("/api/me", async (req, res) => {
    const user = await getAuthUser(req);
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


  /** Verifies the SQL Server connection without writing anything. */
  app.get("/api/report/sql-test", async (req, res) => {
    const u = await requireAuth(req, res);
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

  /**
   * Runs the day's time-based workflow rules now.
   *
   * The sweep runs itself once a day at the first sign-in; this is the button
   * beside the rule editor, so somebody who has just written a rule can see it
   * work rather than waiting for tomorrow. Firing stays once-per-record either
   * way — see services/workflowSweep.ts.
   */
  app.post("/api/workflows/run-due", async (req, res) => {
    const u = await requireAuth(req, res);
    if (!u) return;
    if (!hasPermission(u, "settings")) {
      return res.status(403).json({ success: false, error: "اجرای قوانین زمان‌بندی‌شده مجاز نیست." });
    }
    try {
      const fired = await runDueWorkflows();
      res.json({ success: true, fired });
    } catch (err) {
      console.error("[api] POST /api/workflows/run-due:", (err as Error)?.message || err);
      res.status(500).json({ success: false, error: "اجرای قوانین زمان‌بندی‌شده با خطا مواجه شد." });
    }
  });

  /** Runs the one-way sync into the SQL Server reporting schema. */
  app.post("/api/report/sql-sync", async (req, res) => {
    const u = await requireAuth(req, res);
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
      const result = await syncToSqlServer(await readSqlCollections(), cfg);
      res.status(result.ok ? 200 : 500).json(result);
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || String(err) });
    }
  });

  /**
   * Preview of what the sync produces — table names and row counts.
   * Handy for checking the model without a database round-trip.
   */
  app.get("/api/report/preview", async (req, res) => {
    const u = await requireAuth(req, res);
    if (!u) return;
    if (!hasPermission(u, "settings")) {
      return res.status(403).json({ ok: false, error: "دسترسی به پیش‌نمایش گزارش‌گیری مجاز نیست." });
    }
    try {
      const datasets = buildReportingTables(await readSqlCollections());
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



  // Login attempt trackers for rate-limiting
  const userLoginAttempts = new Map<string, { count: number; lastAttempt: number }>();
  const ipLoginAttempts = new Map<string, { count: number; lastAttempt: number }>();

  // Login API
  app.post("/api/login", async (req, res) => {
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

    try {
      // Authenticate using SQL Server via Prisma
      const authResult = await authenticateUser(username, password);

      if (authResult) {
        // Clear rate-limiting records on success
        userLoginAttempts.delete(userKey);
        ipLoginAttempts.delete(ipKey);

        // Issue the session cookie — this is what authorizes every later request.
        const token = signSession(
          // The epoch comes from authenticateUser, not from the user body: it
          // is deliberately absent there, and reading it off that object signed
          // every token with 0 while the database held the real value — so any
          // account whose epoch had ever been bumped was refused by the very
          // next request and bounced straight back to the login screen.
          { uid: authResult.user.id as string, iat: Date.now(), epoch: authResult.sessionEpoch || 0 },
          SESSION_SECRET,
        );
        res.setHeader("Set-Cookie", buildSessionCookie(token));

        res.json({
          success: true,
          user: authResult.user,
          mustChangePassword: authResult.isDefaultPassword
        });

        /*
         * Somebody has opened the app: if today's currency rates have not been
         * fetched yet, start fetching them.
         *
         * Started, not waited on — the answer has already been sent, and a
         * login must never sit behind two web pages that may be slow. By the
         * time any screen that prices something asks for the rates, this has
         * normally finished; that request waits on the same run rather than
         * beginning a second one. It swallows its own failures.
         */
        void ensureRatesFresh();
        /*
         * And the day's scheduled workflow rules, on the same principle: this
         * server has no cron, so the first person through the door starts the
         * sweep. Not awaited — a follow-up task must never hold up a login.
         */
        void ensureWorkflowSweepRanToday();
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
    } catch (err) {
      console.error("Login error:", err);
      res.status(500).json({ success: false, message: "خطا در ورود به سیستم" });
    }
  });

  // Change Password API (legacy endpoint - redirects to new API)
  app.post("/api/change-password", async (req, res) => {
    const { username, oldPassword, newPassword } = req.body;
    if (!username || !oldPassword || !newPassword) {
      return res.status(400).json({ success: false, message: "اطلاعات ارسالی برای تغییر رمز عبور ناقص است" });
    }

    if (newPassword.length < 4) {
      return res.status(400).json({ success: false, message: "رمز عبور جدید باید حداقل ۴ کاراکتر باشد" });
    }

    if (newPassword === '123') {
      return res.status(400).json({ success: false, message: "نمی‌توانید از رمز عبور ساده و پیش‌فرض استفاده کنید" });
    }

    try {
      // First, authenticate to get the user
      const authResult = await authenticateUser(username, oldPassword);
      if (!authResult) {
        return res.status(401).json({ success: false, message: "رمز عبور فعلی نادرست است" });
      }

      const userId = authResult.user.id as string;

      // Now use the userService to change password
      const { setPassword } = await import("./src/server/services/userService");

      // setPassword expects an AuthUser, so we construct a minimal one
      const authUser = { id: userId, isSystemAdmin: true } as AuthUser;
      const outcome = await setPassword(userId, newPassword, authUser, oldPassword);

      if (outcome === "not-found") {
        return res.status(404).json({ success: false, message: "کاربر یافت نشد" });
      }
      if (outcome === "wrong-password") {
        return res.status(401).json({ success: false, message: "رمز عبور فعلی نادرست است" });
      }

      // Password changed successfully - re-authenticate to get fresh user data
      const freshAuth = await authenticateUser(username, newPassword);
      if (!freshAuth) {
        // This shouldn't happen but handle gracefully
        return res.status(500).json({ success: false, message: "خطا در تغییر رمز عبور" });
      }

      // Issue a fresh session so the user stays logged in on this device only
      const token = signSession(
        // Setting a password bumps the epoch, so this one matters most: signed
        // with 0, the fresh session was invalid the moment it was issued.
        { uid: userId, iat: Date.now(), epoch: freshAuth.sessionEpoch || 0 },
        SESSION_SECRET,
      );
      res.setHeader("Set-Cookie", buildSessionCookie(token));

      res.json({ success: true, user: freshAuth.user, message: "رمز عبور با موفقیت تغییر یافت" });
    } catch (err) {
      console.error("Change password error:", err);
      res.status(500).json({ success: false, message: "خطا در تغییر رمز عبور" });
    }
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
    if (logFile) console.log(`Logging to ${logFile}`);
    // After binding, so a slow or unreachable database delays the report rather
    // than the port.
    void reportSchemaState();
  });

  /*
   * The rates, on a clock of their own.
   *
   * A sign-in and a read of the rates screen both ask for a refresh, but an
   * afternoon in which nobody does either would leave every document priced at
   * whatever the morning said. The tick is more frequent than the two-hour
   * freshness window on purpose: `ensureRatesFresh` is a no-op until the window
   * is up, so a restart at any point in the day still lands on the schedule
   * rather than starting a new one.
   */
  const RATE_TICK_MS = 30 * 60 * 1000;
  const rateTimer = setInterval(() => { void ensureRatesFresh(); }, RATE_TICK_MS);
  // Nothing here should hold the process open on its own.
  rateTimer.unref?.();
  void ensureRatesFresh();

  // Close the SQL Server pool on shutdown. A deploy restart kills this process
  // while connections are open; releasing them lets the new process bind them
  // immediately instead of waiting for the server to time them out.
  const shutdown = (signal: string) => {
    console.log(`${signal} received, shutting down.`);
    clearInterval(rateTimer);
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
