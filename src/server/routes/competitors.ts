import express from "express";
import { RouteDeps, sendError } from "./types";
import {
  CompetitorInput, competitorReport, createCompetitor, listCompetitors,
  retireCompetitor, updateCompetitor,
} from "../services/competitorService";

/**
 * The competitor catalogue and the standings against it.
 *
 * Two authorities in one file. Reading the list needs only a session — anybody
 * quoting has to be able to pick a competitor — and every write needs
 * `settings`, checked inside the service, because this is the list every figure
 * about competition groups by. The **report** is a different question and needs
 * the `proformas` permission: it is nothing but win rates and prices.
 */
const denied = (res: express.Response, message: string) =>
  res.status(403).json({ success: false, error: message });

export function registerCompetitorRoutes(app: express.Express, deps: RouteDeps): void {
  /**
   * The report is registered **before** `/api/competitors/:id`, or Express
   * answers 404 for a competitor whose id is the literal string «report».
   */
  app.get("/api/competitors/report", async (req, res) => {
    const user = await deps.requireAuth(req, res);
    if (!user) return;
    try {
      const result = await competitorReport(
        { from: req.query.from, to: req.query.to }, user,
      );
      if (result === "forbidden") {
        denied(res, "گزارش رقبا نیاز به دسترسی «پیش‌فاکتورها» دارد.");
        return;
      }
      res.json({ success: true, ...result });
    } catch (err) {
      sendError(res, err, "GET /api/competitors/report");
    }
  });

  app.get("/api/competitors", async (req, res) => {
    const user = await deps.requireAuth(req, res);
    if (!user) return;
    try {
      res.json({
        success: true,
        ...(await listCompetitors({ includeInactive: req.query.includeInactive === "true" })),
      });
    } catch (err) {
      sendError(res, err, "GET /api/competitors");
    }
  });

  app.post("/api/competitors", async (req, res) => {
    const user = await deps.requireAuth(req, res);
    if (!user) return;
    try {
      const outcome = await createCompetitor((req.body ?? {}) as CompetitorInput, user);
      if (outcome === "forbidden") {
        denied(res, "ویرایش فهرست رقبا نیاز به دسترسی «تنظیمات» دارد.");
        return;
      }
      if ("error" in outcome) {
        res.status(400).json({ success: false, error: outcome.error });
        return;
      }
      res.json({ success: true, ...outcome });
    } catch (err) {
      sendError(res, err, "POST /api/competitors");
    }
  });

  app.put("/api/competitors/:id", async (req, res) => {
    const user = await deps.requireAuth(req, res);
    if (!user) return;
    try {
      const outcome = await updateCompetitor(
        req.params.id, (req.body ?? {}) as CompetitorInput, user,
      );
      if (outcome === "forbidden") {
        denied(res, "ویرایش فهرست رقبا نیاز به دسترسی «تنظیمات» دارد.");
        return;
      }
      if (outcome === "not-found") {
        res.status(404).json({ success: false, error: "رقیب یافت نشد." });
        return;
      }
      if ("error" in outcome) {
        res.status(400).json({ success: false, error: outcome.error });
        return;
      }
      res.json({ success: true, ...outcome });
    } catch (err) {
      sendError(res, err, "PUT /api/competitors/:id");
    }
  });

  /**
   * Retires rather than deletes — see `retireCompetitor`. The quotations naming
   * a competitor are the whole reason for recording them.
   */
  app.delete("/api/competitors/:id", async (req, res) => {
    const user = await deps.requireAuth(req, res);
    if (!user) return;
    try {
      const outcome = await retireCompetitor(req.params.id, user);
      if (outcome === "forbidden") {
        denied(res, "ویرایش فهرست رقبا نیاز به دسترسی «تنظیمات» دارد.");
        return;
      }
      if (outcome === "not-found") {
        res.status(404).json({ success: false, error: "رقیب یافت نشد." });
        return;
      }
      res.json({ success: true });
    } catch (err) {
      sendError(res, err, "DELETE /api/competitors/:id");
    }
  });
}
