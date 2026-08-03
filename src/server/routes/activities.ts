import express from "express";
import { parseListQuery } from "../listing";
import { RouteDeps, sendError } from "./types";
import {
  ACTIVITY_SORTABLE, REFERRAL_FILTERABLE, REFERRAL_SORTABLE,
  addActivity, addModuleNote, addReferralMessage, deleteActivity, deleteModuleNote,
  listActivities, listCategoryGroups, listModuleNotes, listReferrals,
  reassignReferral,
  setReferralStatus, upsertCategoryGroup,
} from "../services/activityService";

/**
 * Project activity, referrals and module notes.
 *
 * All append-only: entries are added one at a time and there is no bulk write,
 * because a conversation cannot be re-sent as an array without destroying it.
 */

const denied = (res: express.Response, message = "شما اجازه دسترسی به این بخش را ندارید.") =>
  res.status(403).json({ success: false, error: message });

export function registerActivityRoutes(app: express.Express, deps: RouteDeps): void {
  const KEY = "erp_project_category_groups";

  /* --------------------------- category groups --------------------------- */

  app.get("/api/projects/:projectId/category-groups", async (req, res) => {
    const user = deps.requireKeyAccess(req, res, KEY, "read");
    if (!user) return;
    try {
      const groups = await listCategoryGroups(req.params.projectId, user);
      if (!groups) return denied(res);
      res.json({ success: true, groups });
    } catch (err) {
      sendError(res, err, "GET /api/projects/:projectId/category-groups");
    }
  });

  app.put("/api/projects/:projectId/category-groups", async (req, res) => {
    const user = deps.requireKeyAccess(req, res, KEY, "write");
    if (!user) return;
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const outcome = await upsertCategoryGroup({
        projectId: req.params.projectId,
        categoryId: typeof body.categoryId === "string" ? body.categoryId : undefined,
        categoryName: typeof body.categoryName === "string" ? body.categoryName : undefined,
        status: typeof body.status === "string" ? body.status : undefined,
        startDate: typeof body.startDate === "string" ? body.startDate : undefined,
        endDate: typeof body.endDate === "string" ? body.endDate : undefined,
      }, user);

      if (outcome === "forbidden") return denied(res);
      if (outcome === "invalid") {
        res.status(400).json({ success: false, error: "شناسه و نام دسته‌بندی الزامی است." });
        return;
      }
      res.json({ success: true, group: outcome.group });
    } catch (err) {
      sendError(res, err, "PUT /api/projects/:projectId/category-groups");
    }
  });

  /* ------------------------------ activities ----------------------------- */

  app.get("/api/activities", async (req, res) => {
    const user = deps.requireKeyAccess(req, res, KEY, "read");
    if (!user) return;
    try {
      const q = parseListQuery(req.query as Record<string, unknown>, ACTIVITY_SORTABLE);
      const result = await listActivities(q, user, {
        projectId: typeof req.query.projectId === "string" ? req.query.projectId : undefined,
        groupId: typeof req.query.groupId === "string" ? req.query.groupId : undefined,
      });
      res.json({ success: true, ...result });
    } catch (err) {
      sendError(res, err, "GET /api/activities");
    }
  });

  app.post("/api/activities", async (req, res) => {
    const user = deps.requireKeyAccess(req, res, KEY, "write");
    if (!user) return;
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const referral = body.referral as Record<string, unknown> | undefined;

      const outcome = await addActivity({
        groupId: typeof body.groupId === "string" ? body.groupId : undefined,
        text: typeof body.text === "string" ? body.text : undefined,
        attachmentName: typeof body.attachmentName === "string" ? body.attachmentName : null,
        attachmentSize: typeof body.attachmentSize === "string" ? body.attachmentSize : null,
        attachmentUrl: typeof body.attachmentUrl === "string" ? body.attachmentUrl : null,
        referral: referral
          ? {
              assignedToUserId: typeof referral.assignedToUserId === "string" ? referral.assignedToUserId : null,
              assignedToName: typeof referral.assignedToName === "string" ? referral.assignedToName : null,
              actionRequired: typeof referral.actionRequired === "string" ? referral.actionRequired : undefined,
            }
          : undefined,
      }, user);

      if (outcome === "forbidden") return denied(res);
      if (outcome === "not-found") {
        res.status(404).json({ success: false, error: "دسته‌بندی پروژه یافت نشد." });
        return;
      }
      if (outcome === "invalid") {
        res.status(400).json({ success: false, error: "متن فعالیت و دسته‌بندی الزامی است." });
        return;
      }
      res.status(201).json({ success: true, activity: outcome.activity });
    } catch (err) {
      sendError(res, err, "POST /api/activities");
    }
  });

  app.delete("/api/activities/:id", async (req, res) => {
    const user = deps.requireKeyAccess(req, res, KEY, "write");
    if (!user) return;
    try {
      const outcome = await deleteActivity(req.params.id, user);
      if (outcome === "forbidden") return denied(res, "فقط نویسنده می‌تواند این فعالیت را حذف کند.");
      if (outcome === "not-found") {
        res.status(404).json({ success: false, error: "فعالیت یافت نشد." });
        return;
      }
      if (outcome === "has-replies") {
        res.status(409).json({
          success: false,
          code: "HAS_REPLIES",
          error: "به این ارجاع پاسخ داده شده است و حذف آن گفتگو را ناقص می‌کند.",
        });
        return;
      }
      res.json({ success: true });
    } catch (err) {
      sendError(res, err, "DELETE /api/activities/:id");
    }
  });

  /* ------------------------------ referrals ------------------------------ */

  app.get("/api/referrals", async (req, res) => {
    const user = deps.requireKeyAccess(req, res, KEY, "read");
    if (!user) return;
    try {
      const q = parseListQuery(req.query as Record<string, unknown>, REFERRAL_SORTABLE, REFERRAL_FILTERABLE);
      // Default is "mine"; only an explicit all=true widens it, and the service
      // still refuses that for a user without the projects permission. `scope`
      // picks between the two inbox tabs and always stays self-scoped.
      const scope = req.query.scope === "fromMe" ? "fromMe"
        : req.query.scope === "toMe" ? "toMe" : undefined;
      const result = await listReferrals(q, user, { mine: req.query.all !== "true", scope });
      res.json({ success: true, ...result });
    } catch (err) {
      sendError(res, err, "GET /api/referrals");
    }
  });

  app.put("/api/referrals/:id/status", async (req, res) => {
    const user = deps.requireKeyAccess(req, res, KEY, "write");
    if (!user) return;
    try {
      const status = (req.body as { status?: unknown })?.status;
      if (typeof status !== "string" || !status.trim()) {
        res.status(400).json({ success: false, error: "وضعیت ارجاع الزامی است." });
        return;
      }
      const outcome = await setReferralStatus(req.params.id, status, user);
      if (outcome === "forbidden") return denied(res, "شما در این ارجاع نقشی ندارید.");
      if (outcome === "not-found") {
        res.status(404).json({ success: false, error: "ارجاع یافت نشد." });
        return;
      }
      res.json({ success: true });
    } catch (err) {
      sendError(res, err, "PUT /api/referrals/:id/status");
    }
  });

  app.put("/api/referrals/:id/assignee", async (req, res) => {
    const user = deps.requireKeyAccess(req, res, KEY, "write");
    if (!user) return;
    try {
      const assignedToUserId = (req.body as { assignedToUserId?: unknown })?.assignedToUserId;
      if (typeof assignedToUserId !== "string" || !assignedToUserId.trim()) {
        res.status(400).json({ success: false, error: "انتخاب همکار الزامی است." });
        return;
      }
      const outcome = await reassignReferral(req.params.id, assignedToUserId, user);
      if (outcome === "forbidden") return denied(res, "شما در این ارجاع نقشی ندارید.");
      if (outcome === "not-found") {
        res.status(404).json({ success: false, error: "ارجاع یافت نشد." });
        return;
      }
      if (outcome === "no-such-user") {
        res.status(400).json({ success: false, error: "همکار انتخاب‌شده یافت نشد یا غیرفعال است." });
        return;
      }
      res.json({ success: true });
    } catch (err) {
      sendError(res, err, "PUT /api/referrals/:id/assignee");
    }
  });

  app.post("/api/referrals/:id/messages", async (req, res) => {
    const user = deps.requireKeyAccess(req, res, KEY, "write");
    if (!user) return;
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const outcome = await addReferralMessage(req.params.id, {
        text: typeof body.text === "string" ? body.text : undefined,
        attachmentName: typeof body.attachmentName === "string" ? body.attachmentName : null,
        attachmentSize: typeof body.attachmentSize === "string" ? body.attachmentSize : null,
        attachmentUrl: typeof body.attachmentUrl === "string" ? body.attachmentUrl : null,
      }, user);

      if (outcome === "forbidden") return denied(res, "شما در این ارجاع نقشی ندارید.");
      if (outcome === "not-found") {
        res.status(404).json({ success: false, error: "ارجاع یافت نشد." });
        return;
      }
      if (outcome === "invalid") {
        res.status(400).json({ success: false, error: "متن پاسخ الزامی است." });
        return;
      }
      res.status(201).json({ success: true, message: outcome.message });
    } catch (err) {
      sendError(res, err, "POST /api/referrals/:id/messages");
    }
  });

  /* ---------------------------- module notes ----------------------------- */

  app.get("/api/notes/:entityType/:entityId", async (req, res) => {
    const user = deps.requireAuth(req, res);
    if (!user) return;
    try {
      res.json({ success: true, notes: await listModuleNotes(req.params.entityType, req.params.entityId) });
    } catch (err) {
      sendError(res, err, "GET /api/notes/:entityType/:entityId");
    }
  });

  app.post("/api/notes/:entityType/:entityId", async (req, res) => {
    const user = deps.requireAuth(req, res);
    if (!user) return;
    try {
      const text = (req.body as { text?: unknown })?.text;
      const outcome = await addModuleNote(
        req.params.entityType, req.params.entityId,
        typeof text === "string" ? text : "", user);
      if (outcome === "invalid") {
        res.status(400).json({ success: false, error: "متن یادداشت الزامی است." });
        return;
      }
      res.status(201).json({ success: true, note: outcome.note });
    } catch (err) {
      sendError(res, err, "POST /api/notes/:entityType/:entityId");
    }
  });

  app.delete("/api/notes/:id", async (req, res) => {
    const user = deps.requireAuth(req, res);
    if (!user) return;
    try {
      const outcome = await deleteModuleNote(req.params.id, user);
      if (outcome === "forbidden") return denied(res, "فقط نویسنده می‌تواند این یادداشت را حذف کند.");
      if (outcome === "not-found") {
        res.status(404).json({ success: false, error: "یادداشت یافت نشد." });
        return;
      }
      res.json({ success: true });
    } catch (err) {
      sendError(res, err, "DELETE /api/notes/:id");
    }
  });
}
