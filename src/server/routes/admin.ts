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
import { ensureRatesFresh, rateRefreshReport } from "../services/rateRefresh";
import {
  deleteHoliday, importHolidayYear, listHolidays, shiftHijriHolidays, upsertHoliday,
} from "../services/holidayService";

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

  /* ------------------------------ holidays ------------------------------ */

  /*
   * The official calendar.
   *
   * Read by **any** authenticated user, not by a settings holder: every screen
   * that counts a working day needs it, and a salesperson who could not read it
   * would be quoting delivery dates off a different calendar from everybody
   * else. Writing it needs `settings`, which the service enforces.
   *
   * Not paged. The browser holds the whole list to answer «is this a holiday»
   * while somebody types a delivery term, and a page of it would answer that
   * wrongly for the dates it did not happen to carry.
   */
  app.get("/api/holidays", async (req, res) => {
    const user = await deps.requireAuth(req, res);
    if (!user) return;
    try {
      res.json({ success: true, holidays: await listHolidays() });
    } catch (err) {
      sendError(res, err, "GET /api/holidays");
    }
  });

  app.put("/api/holidays", async (req, res) => {
    const user = await deps.requireAuth(req, res);
    if (!user) return;
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const outcome = await upsertHoliday(
        {
          dateJalali: typeof body.dateJalali === "string" ? body.dateJalali : undefined,
          title: typeof body.title === "string" ? body.title : undefined,
          isHoliday: body.isHoliday !== false,
        },
        user,
        getTodayShamsi(),
      );
      if (outcome === "forbidden") return denied(res, "شما اجازه تغییر تقویم را ندارید.");
      if (outcome === "invalid") {
        res.status(400).json({ success: false, error: "تاریخ شمسی معتبر نیست." });
        return;
      }
      res.json({ success: true, holiday: outcome.holiday });
    } catch (err) {
      sendError(res, err, "PUT /api/holidays");
    }
  });

  app.delete("/api/holidays/:dateJalali", async (req, res) => {
    const user = await deps.requireAuth(req, res);
    if (!user) return;
    try {
      // The date arrives with its slashes encoded; Express hands it back decoded.
      const outcome = await deleteHoliday(req.params.dateJalali, user, getTodayShamsi());
      if (outcome === "forbidden") return denied(res, "شما اجازه تغییر تقویم را ندارید.");
      if (outcome === "not-found") {
        res.status(404).json({ success: false, error: "این روز در تقویم ثبت نشده است." });
        return;
      }
      res.json({ success: true });
    } catch (err) {
      sendError(res, err, "DELETE /api/holidays/:dateJalali");
    }
  });

  /**
   * Imports one Jalali year from the configured calendar source.
   *
   * Answers 200 with the reason when the source could not be read or returned
   * something that is not a year — a failed import is an ordinary outcome the
   * screen has to explain, not a server error. Nothing is written in that case.
   */
  app.post("/api/holidays/import", async (req, res) => {
    const user = await deps.requireAuth(req, res);
    if (!user) return;
    try {
      const year = Number((req.body as { year?: unknown })?.year);
      const outcome = await importHolidayYear(year, user, getTodayShamsi());
      if (outcome === "forbidden") return denied(res, "شما اجازه تغییر تقویم را ندارید.");
      if ("error" in outcome) {
        res.json({ success: false, error: outcome.error });
        return;
      }
      res.json({ success: true, ...outcome });
    } catch (err) {
      sendError(res, err, "POST /api/holidays/import");
    }
  });

  /**
   * Moves a year's lunar holidays by a whole number of days.
   *
   * The correction no better source can supply: Iran announces the start of
   * each hijri month by sighting, and every calendar reachable from a server
   * computes it. Solar holidays are untouched — they are fixed dates and are
   * right, which is exactly the reported shape of the error.
   *
   * Answers 200 with the reason when the offset is refused, like the import.
   */
  app.post("/api/holidays/shift", async (req, res) => {
    const user = await deps.requireAuth(req, res);
    if (!user) return;
    try {
      const body = (req.body ?? {}) as { year?: unknown; offset?: unknown };
      const outcome = await shiftHijriHolidays(
        Number(body.year), Number(body.offset), user, getTodayShamsi(),
      );
      if (outcome === "forbidden") return denied(res, "شما اجازه تغییر تقویم را ندارید.");
      if ("error" in outcome) {
        res.json({ success: false, error: outcome.error });
        return;
      }
      res.json({ success: true, ...outcome });
    } catch (err) {
      sendError(res, err, "POST /api/holidays/shift");
    }
  });

  /* --------------------------- exchange rates --------------------------- */

  app.get("/api/exchange-rates", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, "erp_exchange_rates", "read");
    if (!user) return;
    try {
      /*
       * The first read of the day brings the rates up to date first, so the
       * numbers this answer carries are today's.
       *
       * Waited on here — unlike at login, where it is only started — because
       * this is the call a pricing screen makes and its answer is what a
       * document will be valued at. The wait is bounded; see
       * `ensureRatesFresh`. It never throws: older rates are still
       * usable, and a scrape that fails must not take the screen with it.
       */
      await ensureRatesFresh();
      /*
       * The state of the automatic refresh travels with the rates.
       *
       * When the scrape stops working — a markup change at the source, an
       * outbound request the server's network will not make — nothing on any
       * screen says so. The rates just stop moving, and the only symptom is
       * somebody pressing the manual button every morning. The screen shows
       * this so a stale figure can say why it is stale.
       */
      res.json({
        success: true,
        rates: await listExchangeRates(),
        refresh: rateRefreshReport(),
      });
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
