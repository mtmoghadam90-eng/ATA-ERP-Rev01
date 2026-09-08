import express from "express";
import { RouteDeps, sendError } from "./types";
import { stuckWorkReport } from "../services/stuckWorkService";

/**
 * «کارهای متوقف» — what is sitting still, across the chain.
 *
 * Read-only, and needing **only a session**: every row comes through its own
 * module's permission inside the service, and a section the caller may not see
 * comes back marked withheld rather than empty. A separate permission key here
 * would be a second thing to keep in step with the three that already decide
 * what this person may look at — the shape `erp_users` takes, and for the same
 * reason.
 */
export function registerStuckWorkRoutes(app: express.Express, deps: RouteDeps): void {
  app.get("/api/stuck-work", async (req, res) => {
    const user = await deps.requireAuth(req, res);
    if (!user) return;
    try {
      const report = await stuckWorkReport(user, {
        // Absent means «show the amber too»: the use of this screen is seeing
        // what is about to go wrong while there is still time to make a call.
        includeWarning: req.query.includeWarning !== "false",
      });
      res.json({ success: true, ...report });
    } catch (err) {
      sendError(res, err, "GET /api/stuck-work");
    }
  });
}
