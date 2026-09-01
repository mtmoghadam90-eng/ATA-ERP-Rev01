import express from "express";
import { parseListQuery } from "../listing";
import { RouteDeps, sendError } from "./types";
import { getTodayShamsi } from "../../dateUtils";
import {
  FOLLOW_UP_FILTERABLE, FOLLOW_UP_SORTABLE,
  completeFollowUp, followUpRowForTask, followUpSummary, listFollowUpQueue, projectFollowUpReport,
  reactivateFollowUp, updateFollowUpResult,
} from "../services/followUpService";
import { SETTLE_OUTCOMES, type FollowUpCompletionInput } from "../../utils/salesFollowUp";

/**
 * The sales follow-up queue and the completion flow.
 *
 * Registered **before** the proforma routes' `/api/proformas/:id`, like every
 * static segment under a parameterised path, and mounted on the shared `app`
 * with full paths like the rest of this package — there is no router prefix
 * anywhere in this codebase.
 *
 * Two different gates on purpose. The queue is a sales screen, so it reads the
 * `proformas` permission. Completing one follow-up is gated inside the service
 * by the task's own assignment rule instead: the person the chase was given to
 * must be able to finish it whether or not they can open the proformas module,
 * which is exactly the support-engineer / sales-engineer split this feature is
 * built around.
 */

export function registerFollowUpRoutes(app: express.Express, deps: RouteDeps): void {
  const KEY = "erp_proformas";

  app.get("/api/sales-follow-up", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "read");
    if (!user) return;
    try {
      const q = parseListQuery(
        req.query as Record<string, unknown>,
        FOLLOW_UP_SORTABLE,
        FOLLOW_UP_FILTERABLE,
      );
      const result = await listFollowUpQueue(q, user, { health: req.query.health });
      if (!result) {
        res.status(403).json({ success: false, error: "شما اجازه دسترسی به این بخش را ندارید." });
        return;
      }
      res.json({ success: true, ...result });
    } catch (err) {
      sendError(res, err, "GET /api/sales-follow-up");
    }
  });

  /*
   * One project's whole follow-up story.
   *
   * Registered **before** `/:proformaId/reactivate` would be, and above every
   * parameterised path here, so «project» is never read as an id — the same
   * trap the supplier price-history route exists to avoid.
   *
   * Unlike the queue, this includes the settled quotations: somebody opening a
   * project is asking what happened, and a won document with three recorded
   * chases behind it is exactly that.
   */
  app.get("/api/sales-follow-up/project/:projectId", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "read");
    if (!user) return;
    try {
      const report = await projectFollowUpReport(req.params.projectId, user);
      if (!report) {
        res.status(403).json({ success: false, error: "شما اجازه دسترسی به این بخش را ندارید." });
        return;
      }
      res.json({ success: true, ...report });
    } catch (err) {
      sendError(res, err, "GET /api/sales-follow-up/project/:projectId");
    }
  });

  /** The KPI cards alone, for the dashboard, without a page of rows behind them. */
  app.get("/api/sales-follow-up/summary", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "read");
    if (!user) return;
    try {
      res.json({ success: true, summary: await followUpSummary(user, getTodayShamsi()) });
    } catch (err) {
      sendError(res, err, "GET /api/sales-follow-up/summary");
    }
  });

  /**
   * One follow-up finished, and whatever it decided about the next one.
   *
   * Deliberately a single call: closing the task, recording the result, moving
   * the proforma's follow-up state and raising the replacement are one
   * transaction in the service. Three requests from the browser could stop half
   * way and leave a quotation marked as actively followed up with nobody on it.
   */
  /*
   * The queue row behind one follow-up task.
   *
   * The merged board opens the same completion modal the follow-up screen does,
   * and that modal takes a derived row — so it is built on the server rather
   * than assembled in the browser out of whatever a task card happens to carry,
   * which is how two screens come to disagree about a quotation's next action.
   *
   * Registered before `/api/sales-follow-up/:proformaId/reactivate` for the
   * usual reason, and gated like the completion it precedes: `requireAuth`
   * here, with the service checking that the task is yours.
   */
  app.get("/api/sales-follow-up/tasks/:taskId", async (req, res) => {
    const user = await deps.requireAuth(req, res);
    if (!user) return;
    try {
      const row = await followUpRowForTask(req.params.taskId, user);
      if (row === "forbidden") {
        res.status(403).json({ success: false, error: "این پیگیری به شما ارجاع نشده است." });
        return;
      }
      if (row === "not-found") {
        res.status(404).json({ success: false, error: "پیگیری فروش یافت نشد." });
        return;
      }
      res.json({ success: true, row });
    } catch (err) {
      sendError(res, err, "GET /api/sales-follow-up/tasks/:taskId");
    }
  });

  app.post("/api/sales-follow-up/tasks/:taskId/complete", async (req, res) => {
    const user = await deps.requireAuth(req, res);
    if (!user) return;
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const input: FollowUpCompletionInput = {
        decision: String(body.decision ?? "") as FollowUpCompletionInput["decision"],
        followUpResult: typeof body.followUpResult === "string" ? body.followUpResult : null,
        completionNote: typeof body.completionNote === "string" ? body.completionNote : null,
        nextTitle: typeof body.nextTitle === "string" ? body.nextTitle : null,
        /*
         * Undefined when the caller did not send the field at all, which is
         * not the same as an empty one — see `FollowUpCompletionInput`.
         */
        nextDescription:
          typeof body.nextDescription === "string" ? body.nextDescription : undefined,
        nextDueDate: typeof body.nextDueDate === "string" ? body.nextDueDate : null,
        nextAssignedToName:
          typeof body.nextAssignedToName === "string" ? body.nextAssignedToName : null,
        deferredUntil: typeof body.deferredUntil === "string" ? body.deferredUntil : null,
        /*
         * The commercial outcome, when the person answered yes to being asked.
         *
         * Only ever what the body actually carries: a result string never
         * decides this on the server's own initiative, because «تأیید نهایی
         * خرید» on the phone can still mean two lines out of five.
         */
        settleOutcome: (SETTLE_OUTCOMES as readonly string[]).includes(String(body.settleOutcome))
          ? (body.settleOutcome as FollowUpCompletionInput["settleOutcome"])
          : null,
        settleLossReason:
          typeof body.settleLossReason === "string" ? body.settleLossReason : null,
      };

      const outcome = await completeFollowUp(req.params.taskId, input, user, getTodayShamsi());
      if (outcome.ok === false) {
        const status = outcome.code === "not-found" ? 404 : outcome.code === "forbidden" ? 403 : 400;
        res.status(status).json({ success: false, error: outcome.reason });
        return;
      }
      res.json({ success: true, ...outcome });
    } catch (err) {
      sendError(res, err, "POST /api/sales-follow-up/tasks/:taskId/complete");
    }
  });

  /**
   * Corrects the result recorded on a chase that is already closed.
   *
   * Two columns and nothing else — see `updateFollowUpResult`. It is a PUT
   * rather than a second POST to `/complete` precisely because none of the
   * completion's other work may run again.
   */
  app.put("/api/sales-follow-up/tasks/:taskId/result", async (req, res) => {
    const user = await deps.requireAuth(req, res);
    if (!user) return;
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const outcome = await updateFollowUpResult(
        req.params.taskId,
        {
          followUpResult: typeof body.followUpResult === "string" ? body.followUpResult : null,
          completionNote: typeof body.completionNote === "string" ? body.completionNote : null,
        },
        user,
      );
      if (outcome.ok === false) {
        const status = outcome.code === "not-found" ? 404 : outcome.code === "forbidden" ? 403 : 400;
        res.status(status).json({ success: false, error: outcome.reason });
        return;
      }
      res.json({ success: true, ...outcome });
    } catch (err) {
      sendError(res, err, "PUT /api/sales-follow-up/tasks/:taskId/result");
    }
  });

  /**
   * Puts an abandoned quotation back on somebody's list.
   *
   * The new task is the point: flipping the state back to OPEN on its own would
   * produce precisely what «بدون اقدام بعدی» counts as a fault.
   */
  app.post("/api/sales-follow-up/:proformaId/reactivate", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "write");
    if (!user) return;
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const outcome = await reactivateFollowUp(
        req.params.proformaId,
        {
          title: typeof body.title === "string" ? body.title : null,
          dueDate: typeof body.dueDate === "string" ? body.dueDate : null,
          assignedToName: typeof body.assignedToName === "string" ? body.assignedToName : null,
        },
        user,
        getTodayShamsi(),
      );
      if (outcome.ok === false) {
        const status = outcome.code === "not-found" ? 404 : outcome.code === "forbidden" ? 403 : 400;
        res.status(status).json({ success: false, error: outcome.reason });
        return;
      }
      res.json({ success: true, ...outcome });
    } catch (err) {
      sendError(res, err, "POST /api/sales-follow-up/:proformaId/reactivate");
    }
  });
}
