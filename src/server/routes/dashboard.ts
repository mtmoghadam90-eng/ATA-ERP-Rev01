import express from "express";
import { RouteDeps, sendError } from "./types";
import { dashboardSummary } from "../services/dashboardService";

/**
 * The front page's figures, in one request.
 *
 * Only `requireAuth`: every signed-in user has a dashboard, and the service
 * narrows what it counts to what that user may see rather than refusing.
 */
export function registerDashboardRoutes(app: express.Express, deps: RouteDeps): void {
  app.get("/api/dashboard", async (req, res) => {
    const user = await deps.requireAuth(req, res);
    if (!user) return;
    try {
      res.json({ success: true, summary: await dashboardSummary(user) });
    } catch (err) {
      sendError(res, err, "GET /api/dashboard");
    }
  });
}
