import express from "express";
import { RouteDeps, sendError } from "./types";
import { getTodayShamsi } from "../../dateUtils";
import {
  addPayout, deletePayout, listPayouts, referrerReport, setReferrerTerms,
} from "../services/referrerCommissionService";

/**
 * «معرف‌ها و پورسانت». Gated by `erp_referrer_commissions` → the strict
 * `referrerCommissions` flag, here and again inside the service.
 */
const KEY = "erp_referrer_commissions";
const DENIED = "این بخش فقط برای کاربرانی باز است که دسترسی «معرف‌ها و پورسانت» دارند.";

export function registerReferrerCommissionRoutes(app: express.Express, deps: RouteDeps): void {
  app.get("/api/referrer-commissions", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "read");
    if (!user) return;
    try {
      const result = await referrerReport(
        { from: req.query.from, to: req.query.to, referrerId: req.query.referrerId }, user);
      if (result === "forbidden") { res.status(403).json({ success: false, error: DENIED }); return; }
      res.json({ success: true, ...result });
    } catch (err) {
      sendError(res, err, "GET /api/referrer-commissions");
    }
  });

  app.put("/api/referrer-commissions/referrers/:customerId/terms", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "write");
    if (!user) return;
    try {
      const outcome = await setReferrerTerms(req.params.customerId, req.body ?? {}, user);
      if (outcome === "forbidden") { res.status(403).json({ success: false, error: DENIED }); return; }
      if (outcome === "not-found") { res.status(404).json({ success: false, error: "مخاطب یافت نشد." }); return; }
      if (outcome === "invalid") {
        res.status(400).json({ success: false, error: "مبنا و نرخ پورسانت را درست وارد کنید (درصد بین ۰ تا ۱۰۰، یا مبلغ ثابت)." });
        return;
      }
      res.json({ success: true });
    } catch (err) {
      sendError(res, err, "PUT /api/referrer-commissions/referrers/:customerId/terms");
    }
  });

  app.get("/api/referrer-commissions/projects/:projectId/payouts", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "read");
    if (!user) return;
    try {
      const rows = await listPayouts(req.params.projectId, user);
      if (rows === "forbidden") { res.status(403).json({ success: false, error: DENIED }); return; }
      res.json({ success: true, payouts: rows });
    } catch (err) {
      sendError(res, err, "GET /api/referrer-commissions/projects/:projectId/payouts");
    }
  });

  app.post("/api/referrer-commissions/projects/:projectId/payouts", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "write");
    if (!user) return;
    try {
      const outcome = await addPayout(req.params.projectId, req.body ?? {}, user, getTodayShamsi());
      if (outcome === "forbidden") { res.status(403).json({ success: false, error: DENIED }); return; }
      if (outcome === "not-found") { res.status(404).json({ success: false, error: "پروژه یافت نشد." }); return; }
      if (outcome === "invalid") { res.status(400).json({ success: false, error: "نوع و مبلغ را درست وارد کنید." }); return; }
      res.status(201).json({ success: true, id: outcome.id });
    } catch (err) {
      sendError(res, err, "POST /api/referrer-commissions/projects/:projectId/payouts");
    }
  });

  app.delete("/api/referrer-commissions/payouts/:id", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "write");
    if (!user) return;
    try {
      const outcome = await deletePayout(req.params.id, user, getTodayShamsi());
      if (outcome === "forbidden") { res.status(403).json({ success: false, error: DENIED }); return; }
      if (outcome === "not-found") { res.status(404).json({ success: false, error: "رکورد یافت نشد." }); return; }
      res.json({ success: true });
    } catch (err) {
      sendError(res, err, "DELETE /api/referrer-commissions/payouts/:id");
    }
  });
}
