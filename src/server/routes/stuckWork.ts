import express from "express";
import { RouteDeps, sendError } from "./types";
import { stuckWorkReport } from "../services/stuckWorkService";

/**
 * «کارهای متوقف» — what is sitting still, across the chain.
 *
 * Read-only, and gated **twice**, which is not one gate too many.
 *
 * `erp_stuck_work` → the `stuckWork` module decides whether this screen may be
 * opened at all. It was session-only at first, on the reasoning that the three
 * section permissions inside the service already decide everything — and that
 * was wrong in one respect that mattered: the module is in `APP_MODULES`, so
 * the sidebar and the route guard were already reading `permissions.stuckWork`
 * and hiding the screen for an account denied it, while this endpoint went on
 * answering. A screen hidden in the browser whose API still replies is a gate
 * that is not one.
 *
 * Inside the service each **section** is still gated by its own module's
 * permission, and one the caller may not see comes back marked withheld rather
 * than empty. So this answers «may you open it» and that answers «what is in it
 * for you», which are two different questions.
 */
export function registerStuckWorkRoutes(app: express.Express, deps: RouteDeps): void {
  app.get("/api/stuck-work", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, "erp_stuck_work", "read");
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
