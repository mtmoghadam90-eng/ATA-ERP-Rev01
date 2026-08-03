import express from "express";
import { parseListQuery } from "../listing";
import { RouteDeps, sendError } from "./types";
import {
  NOTIFICATION_SORTABLE,
  listNotifications, markAllNotificationsRead, markItemsRead,
  markNotificationRead, readItemsFor,
} from "../services/notificationService";

/**
 * The signed-in user's inbox.
 *
 * Only `requireAuth` — there is no module permission, because everyone has an
 * inbox and nobody has anyone else's. The caller's id is part of every query
 * rather than a filter applied to the results, so there is no route here that
 * can be pointed at another user.
 */
export function registerNotificationRoutes(app: express.Express, deps: RouteDeps): void {
  app.get("/api/notifications", async (req, res) => {
    const user = deps.requireAuth(req, res);
    if (!user) return;
    try {
      const q = parseListQuery(req.query as Record<string, unknown>, NOTIFICATION_SORTABLE);
      const result = await listNotifications(q, user, { unreadOnly: req.query.unread === "true" });
      res.json({ success: true, ...result });
    } catch (err) {
      sendError(res, err, "GET /api/notifications");
    }
  });

  app.put("/api/notifications/:id/read", async (req, res) => {
    const user = deps.requireAuth(req, res);
    if (!user) return;
    try {
      const outcome = await markNotificationRead(req.params.id, user);
      if (outcome === "not-found") {
        // Also the answer when the notice belongs to someone else: whether it
        // exists is not this caller's business.
        res.status(404).json({ success: false, error: "اعلان یافت نشد." });
        return;
      }
      res.json({ success: true });
    } catch (err) {
      sendError(res, err, "PUT /api/notifications/:id/read");
    }
  });

  app.post("/api/notifications/read-all", async (req, res) => {
    const user = deps.requireAuth(req, res);
    if (!user) return;
    try {
      res.json({ success: true, marked: await markAllNotificationsRead(user) });
    } catch (err) {
      sendError(res, err, "POST /api/notifications/read-all");
    }
  });

  /* --------------------------- read receipts ---------------------------- */

  /** Which of the given ids the caller has already seen. `ids` is comma-separated. */
  app.get("/api/read-receipts", async (req, res) => {
    const user = deps.requireAuth(req, res);
    if (!user) return;
    try {
      const raw = typeof req.query.ids === "string" ? req.query.ids : "";
      const ids = raw.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 500);
      res.json({ success: true, read: await readItemsFor(ids, user) });
    } catch (err) {
      sendError(res, err, "GET /api/read-receipts");
    }
  });

  app.post("/api/read-receipts", async (req, res) => {
    const user = deps.requireAuth(req, res);
    if (!user) return;
    try {
      const body = (req.body ?? {}) as { itemIds?: unknown };
      const ids = Array.isArray(body.itemIds) ? body.itemIds.filter((x): x is string => typeof x === "string") : [];
      res.json({ success: true, marked: await markItemsRead(ids, user) });
    } catch (err) {
      sendError(res, err, "POST /api/read-receipts");
    }
  });
}
