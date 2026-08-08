import express from "express";
import { parseListQuery } from "../listing";
import { RouteDeps, sendError } from "./types";
import { getTodayShamsi } from "../../dateUtils";
import { RATE_NAMES, scrapeRates } from "../rateSource";
import {
  AUDIT_FILTERABLE, AUDIT_SORTABLE,
  getAuditLog, getSettings, listAuditLogs, listExchangeRates,
  purgeAuditLogs, purgeBusinessData, recordAudit, saveSettings, trimAuditLogs, upsertExchangeRate,
} from "../services/adminService";

/** Settings, exchange rates and the audit log. */

const denied = (res: express.Response, message: string) =>
  res.status(403).json({ success: false, error: message });

export function registerAdminRoutes(app: express.Express, deps: RouteDeps): void {
  /* ------------------------------ settings ------------------------------ */

  app.get("/api/settings", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, "erp_settings", "read");
    if (!user) return;
    try {
      res.json({ success: true, settings: await getSettings() });
    } catch (err) {
      sendError(res, err, "GET /api/settings");
    }
  });

  app.put("/api/settings", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, "erp_settings", "write");
    if (!user) return;
    try {
      const outcome = await saveSettings(
        (req.body as { settings?: unknown })?.settings ?? req.body,
        user,
        getTodayShamsi(),
      );
      if (outcome === "forbidden") return denied(res, "شما اجازه تغییر تنظیمات سامانه را ندارید.");
      if (outcome === "invalid") {
        res.status(400).json({ success: false, error: "ساختار تنظیمات نامعتبر است." });
        return;
      }
      res.json({ success: true });
    } catch (err) {
      sendError(res, err, "PUT /api/settings");
    }
  });

  /* --------------------------- exchange rates --------------------------- */

  app.get("/api/exchange-rates", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, "erp_exchange_rates", "read");
    if (!user) return;
    try {
      res.json({ success: true, rates: await listExchangeRates() });
    } catch (err) {
      sendError(res, err, "GET /api/exchange-rates");
    }
  });

  /**
   * Scrapes today's rates and stores them, in one call.
   *
   * Declared before `/:currency` so "refresh" is not read as a currency code.
   * The client used to scrape through one endpoint and write the answer back
   * through another, which meant every browser wrote its own copy of the same
   * numbers and two of them refreshing at once raced. A currency that could not
   * be read is reported and left alone rather than overwritten with a guess.
   */
  app.post("/api/exchange-rates/refresh", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, "erp_exchange_rates", "write");
    if (!user) return;
    try {
      const { rates, failedCurrencies } = await scrapeRates();

      for (const [currency, rateToRial] of Object.entries(rates)) {
        const outcome = await upsertExchangeRate(
          { currency, name: RATE_NAMES[currency], rateToRial }, user);
        if (outcome === "forbidden") return denied(res, "شما اجازه تغییر نرخ ارز را ندارید.");
      }

      res.json({
        success: true,
        updated: Object.keys(rates).length,
        failedCurrencies,
        rates: await listExchangeRates(),
      });
    } catch (err) {
      sendError(res, err, "POST /api/exchange-rates/refresh");
    }
  });

  app.put("/api/exchange-rates/:currency", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, "erp_exchange_rates", "write");
    if (!user) return;
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const outcome = await upsertExchangeRate({
        currency: req.params.currency,
        name: typeof body.name === "string" ? body.name : undefined,
        rateToRial: body.rateToRial,
      }, user);

      if (outcome === "forbidden") return denied(res, "شما اجازه تغییر نرخ ارز را ندارید.");
      if (outcome === "invalid") {
        res.status(400).json({ success: false, error: "نرخ ارز باید عددی بزرگ‌تر از صفر باشد." });
        return;
      }
      res.json({ success: true, rate: outcome.rate });
    } catch (err) {
      sendError(res, err, "PUT /api/exchange-rates/:currency");
    }
  });

  /* ------------------------------ audit log ----------------------------- */

  app.get("/api/audit-logs", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, "erp_audit_logs", "read");
    if (!user) return;
    try {
      const q = parseListQuery(req.query as Record<string, unknown>, AUDIT_SORTABLE, AUDIT_FILTERABLE);
      const result = await listAuditLogs(q, user, { dateFrom: req.query.dateFrom, dateTo: req.query.dateTo });
      if (!result) return denied(res, "شما اجازه مشاهده سابقه اقدامات را ندارید.");
      res.json({ success: true, ...result });
    } catch (err) {
      sendError(res, err, "GET /api/audit-logs");
    }
  });

  /** One entry, with its before/after snapshots — excluded from the list on purpose. */
  app.get("/api/audit-logs/:id", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, "erp_audit_logs", "read");
    if (!user) return;
    try {
      const entry = await getAuditLog(req.params.id, user);
      if (!entry) {
        res.status(404).json({ success: false, error: "رکورد سابقه یافت نشد." });
        return;
      }
      res.json({ success: true, entry });
    } catch (err) {
      sendError(res, err, "GET /api/audit-logs/:id");
    }
  });

  app.post("/api/audit-logs", async (req, res) => {
    const user = await deps.requireAuth(req, res);
    if (!user) return;
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      if (!body.module || !body.description) {
        res.status(400).json({ success: false, error: "ماژول و شرح اقدام الزامی است." });
        return;
      }

      const entry = await recordAudit({
        action: typeof body.action === "string" ? body.action : undefined,
        module: String(body.module),
        entityId: typeof body.entityId === "string" ? body.entityId : null,
        description: String(body.description),
        beforeState: typeof body.beforeState === "string" ? body.beforeState : null,
        afterState: typeof body.afterState === "string" ? body.afterState : null,
        occurredAt: typeof body.occurredAt === "string" ? body.occurredAt : undefined,
      }, user, getTodayShamsi());

      // Keep the table bounded, as the JSON store did by rewriting the array.
      await trimAuditLogs();

      res.status(201).json({ success: true, entry });
    } catch (err) {
      sendError(res, err, "POST /api/audit-logs");
    }
  });

  /** Clearing history is a system-administrator action, not merely a settings one. */
  /**
   * Erases every business record. System admins only, and the caller has to say
   * so explicitly — this is not something to reach by accident.
   */
  app.post("/api/admin/purge-business-data", async (req, res) => {
    const user = await deps.requireAuth(req, res);
    if (!user) return;
    try {
      if ((req.body ?? {}).confirm !== "DELETE-ALL-BUSINESS-DATA") {
        return res.status(400).json({
          success: false,
          message: "درخواست پاک‌سازی تأیید نشده است.",
        });
      }
      const outcome = await purgeBusinessData(user);
      if (outcome === "forbidden") {
        return denied(res, "پاک‌سازی داده‌ها فقط توسط مدیر سیستم انجام می‌شود.");
      }
      res.json({ success: true, deleted: outcome.deleted });
    } catch (err) {
      sendError(res, err, "POST /api/admin/purge-business-data");
    }
  });

  app.delete("/api/audit-logs", async (req, res) => {
    const user = await deps.requireAuth(req, res);
    if (!user) return;
    try {
      // The same filters the list takes, so clearing "what I am looking at"
      // clears every match rather than one page of it.
      const outcome = await purgeAuditLogs(user, req.query.before, {
        module: typeof req.query.module === "string" ? req.query.module : undefined,
        action: typeof req.query.action === "string" ? req.query.action : undefined,
        search: typeof req.query.search === "string" ? req.query.search : undefined,
      });
      if (outcome === "forbidden") {
        return denied(res, "پاک‌سازی سابقه اقدامات فقط توسط مدیر سیستم انجام می‌شود.");
      }
      res.json({ success: true, deleted: outcome.deleted });
    } catch (err) {
      sendError(res, err, "DELETE /api/audit-logs");
    }
  });
}
