import express from "express";
import { parseListQuery } from "../listing";
import { RouteDeps, sendError } from "./types";
import { hasPermission } from "../auth";
import { getDb } from "../db";
import {
  ACTIVITY_SORTABLE, REFERRAL_FILTERABLE, REFERRAL_SORTABLE, categoryUsage, renameCategory,
  addActivity, addModuleNote, addReferralMessage, deleteActivity, deleteCategoryGroup,
  deleteModuleNote,
  listActivities, listActivityReaders, listCategoryGroups, listModuleNotes, listReferrals,
  markActivitiesRead, toggleActivityReaction,
  reassignReferral,
  updateReferralAction,
  setReferralStatus, updateActivity, upsertCategoryGroup,
} from "../services/activityService";
import { normalizeAttachments } from "../../utils/attachments";

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
  /*
   * The referral endpoints are gated as **tasks**, not as projects.
   *
   * They live in this file because they sit on the activity feed, and they
   * inherited its key — so a user with the referrals module and without the
   * projects module got 403 on their own inbox. Merged into the tasks board
   * that would have been every account. See `KEY_PERMISSION` in `auth.ts`.
   */
  const REFERRAL_KEY = "erp_referrals";

  /* --------------------------- category groups --------------------------- */

  /**
   * How many projects currently use an activity category.
   *
   * The settings screen refuses to delete a category that is in use, and used
   * to answer that by scanning every category group it held — which is not
   * something the browser has any more.
   */
  /**
   * The same question for every category at once.
   *
   * Registered before the `:categoryId` route below so "usage" is not matched
   * as a category id. The settings screen draws a column from this; asking per
   * row would be one request per category on every render.
   */
  app.get("/api/activity-categories/usage", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "read");
    if (!user) return;
    try {
      res.json({ success: true, usage: await categoryUsage() });
    } catch (err) {
      sendError(res, err, "GET /api/activity-categories/usage");
    }
  });

  /**
   * Renames a category, including everywhere it has already been used.
   *
   * Administration, so `settings` — the same flag that guards editing the
   * category list in the first place.
   */
  app.put("/api/activity-categories/:categoryId", async (req, res) => {
    const user = await deps.requireAuth(req, res);
    if (!user) return;
    if (!hasPermission(user, "settings")) return denied(res);
    try {
      const name = (req.body as { name?: unknown })?.name;
      if (typeof name !== "string" || !name.trim()) {
        res.status(400).json({ success: false, error: "نام دسته‌بندی الزامی است." });
        return;
      }
      res.json({ success: true, ...(await renameCategory(req.params.categoryId, name)) });
    } catch (err) {
      sendError(res, err, "PUT /api/activity-categories/:categoryId");
    }
  });

  app.get("/api/activity-categories/:categoryId/usage", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "read");
    if (!user) return;
    try {
      const projects = await getDb().projectCategoryGroup.count({
        where: { categoryId: req.params.categoryId },
      });
      res.json({ success: true, projects });
    } catch (err) {
      sendError(res, err, "GET /api/activity-categories/:categoryId/usage");
    }
  });

  app.get("/api/projects/:projectId/category-groups", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "read");
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
    const user = await deps.requireKeyAccess(req, res, KEY, "write");
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
        /*
         * Absent stays absent.
         *
         * The date editors and the close/reopen buttons all post to this same
         * route and send no member list; turning an absent key into `[]` here
         * would empty the membership every time somebody closed a category.
         * The service validates the ids it is given.
         */
        memberUserIds: Array.isArray(body.memberUserIds)
          ? body.memberUserIds.filter((v): v is string => typeof v === "string")
          : undefined,
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

  app.delete("/api/category-groups/:id", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "write");
    if (!user) return;
    try {
      const outcome = await deleteCategoryGroup(req.params.id, user);
      if (outcome === "forbidden") return denied(res);
      if (outcome === "not-found") {
        res.status(404).json({ success: false, error: "دسته‌بندی پروژه یافت نشد." });
        return;
      }
      res.json({ success: true });
    } catch (err) {
      sendError(res, err, "DELETE /api/category-groups/:id");
    }
  });

  /* ------------------------------ activities ----------------------------- */

  app.get("/api/activities", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "read");
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
    const user = await deps.requireKeyAccess(req, res, KEY, "write");
    if (!user) return;
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const referral = body.referral as Record<string, unknown> | undefined;

      const outcome = await addActivity({
        groupId: typeof body.groupId === "string" ? body.groupId : undefined,
        text: typeof body.text === "string" ? body.text : undefined,
        // Normalised in the service, not here: an entry with no URL points at
        // nothing and must not reach the database whichever route sent it.
        attachments: normalizeAttachments(body.attachments),
        attachmentName: typeof body.attachmentName === "string" ? body.attachmentName : null,
        attachmentSize: typeof body.attachmentSize === "string" ? body.attachmentSize : null,
        attachmentUrl: typeof body.attachmentUrl === "string" ? body.attachmentUrl : null,
        // Checked against the same category group in the service: the id comes
        // from a browser, and a reply hung under a message on another project
        // would quote a job the reader cannot see.
        replyToId: typeof body.replyToId === "string" ? body.replyToId : null,
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

  app.put("/api/activities/:id", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "write");
    if (!user) return;
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const text = body.text;
      /*
       * Absent means "not edited", present means "this is the whole list".
       *
       * The same rule the line-item grids follow: conflating the two is how a
       * partial save wipes what it never sent, and here it would silently
       * detach every file from an entry whose text somebody corrected.
       */
      const outcome = await updateActivity(
        req.params.id,
        typeof text === "string" ? text : "",
        user,
        "attachments" in body ? normalizeAttachments(body.attachments) : undefined,
      );
      if (outcome === "forbidden") return denied(res, "فقط نویسنده می‌تواند این فعالیت را ویرایش کند.");
      if (outcome === "not-found") {
        res.status(404).json({ success: false, error: "فعالیت یافت نشد." });
        return;
      }
      if (outcome === "invalid") {
        res.status(400).json({ success: false, error: "متن فعالیت الزامی است." });
        return;
      }
      res.json({ success: true, activity: outcome.activity });
    } catch (err) {
      sendError(res, err, "PUT /api/activities/:id");
    }
  });

  app.delete("/api/activities/:id", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "write");
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

  /* ------------------- reactions and read receipts ----------------------- */

  /*
   * Registered before `/api/activities/:id/...` for the usual reason: with the
   * order reversed, «read» is matched as an activity id and the request 404s on
   * a record whose id is the literal string.
   */
  app.post("/api/activities/read", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "read");
    if (!user) return;
    try {
      const raw = (req.body as { activityIds?: unknown })?.activityIds;
      const ids = Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : [];
      // Reading is a read: a receipt is recorded for anybody who may see the
      // message, which is the whole point of the eye.
      res.json({ success: true, ...(await markActivitiesRead(ids, user)) });
    } catch (err) {
      sendError(res, err, "POST /api/activities/read");
    }
  });

  app.get("/api/activities/:id/reads", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "read");
    if (!user) return;
    try {
      const outcome = await listActivityReaders(req.params.id, user);
      if (outcome === "forbidden") return denied(res);
      res.json({ success: true, ...outcome });
    } catch (err) {
      sendError(res, err, "GET /api/activities/:id/reads");
    }
  });

  app.post("/api/activities/:id/reactions", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "write");
    if (!user) return;
    try {
      const emoji = (req.body as { emoji?: unknown })?.emoji;
      const outcome = await toggleActivityReaction(
        req.params.id, typeof emoji === "string" ? emoji : "", user);

      if (outcome === "forbidden") return denied(res);
      if (outcome === "not-found") {
        res.status(404).json({ success: false, error: "فعالیت یافت نشد." });
        return;
      }
      if (outcome === "invalid") {
        res.status(400).json({ success: false, error: "این واکنش در فهرست مجاز نیست." });
        return;
      }
      res.json({ success: true, ...outcome });
    } catch (err) {
      sendError(res, err, "POST /api/activities/:id/reactions");
    }
  });

  /* ------------------------------ referrals ------------------------------ */

  app.get("/api/referrals", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, REFERRAL_KEY, "read");
    if (!user) return;
    try {
      const q = parseListQuery(req.query as Record<string, unknown>, REFERRAL_SORTABLE, REFERRAL_FILTERABLE);
      // Default is "mine"; only an explicit all=true widens it, and the service
      // still refuses that for a user without the projects permission. `scope`
      // picks between the two inbox tabs and always stays self-scoped.
      const scope = req.query.scope === "fromMe" ? "fromMe"
        : req.query.scope === "toMe" ? "toMe"
        // «mine» is both directions at once, which is what the sidebar badge
        // counts: a referral belongs to two people, exactly as a task does.
        : req.query.scope === "mine" ? "mine" : undefined;
      const result = await listReferrals(q, user, {
        mine: req.query.all !== "true",
        scope,
        // «still needs action» — an exclusion, not the exact «در انتظار اقدام»
        // the badge used to ask for, which the middle column would have hidden.
        open: req.query.open === "true",
      });
      res.json({ success: true, ...result });
    } catch (err) {
      sendError(res, err, "GET /api/referrals");
    }
  });

  app.put("/api/referrals/:id/status", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, REFERRAL_KEY, "write");
    if (!user) return;
    try {
      const status = (req.body as { status?: unknown })?.status;
      if (typeof status !== "string" || !status.trim()) {
        res.status(400).json({ success: false, error: "وضعیت ارجاع الزامی است." });
        return;
      }
      // `silent` when the caller has just posted a reply in the same action:
      // that reply already carries the notice, and with the message in it.
      const silent = (req.body as { silent?: unknown })?.silent === true;
      const outcome = await setReferralStatus(req.params.id, status, user, { silent });
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
    const user = await deps.requireKeyAccess(req, res, REFERRAL_KEY, "write");
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

  /**
   * Corrects what the referral asks for.
   *
   * Only the person who raised it, enforced in the service: the assignee
   * rewriting their own instructions is how a referral comes to be marked done
   * against a request nobody made.
   */
  app.put("/api/referrals/:id/action", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, REFERRAL_KEY, "write");
    if (!user) return;
    try {
      const actionRequired = (req.body as { actionRequired?: unknown })?.actionRequired;
      if (typeof actionRequired !== "string") {
        res.status(400).json({ success: false, error: "متن ارجاع الزامی است." });
        return;
      }
      const outcome = await updateReferralAction(req.params.id, actionRequired, user);
      if (outcome === "forbidden") {
        return denied(res, "فقط ارجاع‌دهنده می‌تواند متن ارجاع را ویرایش کند.");
      }
      if (outcome === "not-found") {
        res.status(404).json({ success: false, error: "ارجاع یافت نشد." });
        return;
      }
      if (outcome === "invalid") {
        res.status(400).json({ success: false, error: "متن ارجاع الزامی است." });
        return;
      }
      res.json({ success: true });
    } catch (err) {
      sendError(res, err, "PUT /api/referrals/:id/action");
    }
  });

  app.post("/api/referrals/:id/messages", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, REFERRAL_KEY, "write");
    if (!user) return;
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const outcome = await addReferralMessage(req.params.id, {
        text: typeof body.text === "string" ? body.text : undefined,
        attachmentName: typeof body.attachmentName === "string" ? body.attachmentName : null,
        attachmentSize: typeof body.attachmentSize === "string" ? body.attachmentSize : null,
        attachmentUrl: typeof body.attachmentUrl === "string" ? body.attachmentUrl : null,
        // The client sends this when the same action also hands the referral on.
        andForwarded: body.andForwarded === true,
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
      /*
       * `reopened` travels so the screen can say the category came back to
       * «جاری». A closed heading quietly reopening under somebody is a change
       * they should be told about rather than discover.
       */
      res.status(201).json({
        success: true, message: outcome.message, reopened: outcome.reopened,
      });
    } catch (err) {
      sendError(res, err, "POST /api/referrals/:id/messages");
    }
  });

  /* ---------------------------- module notes ----------------------------- */

  app.get("/api/notes/:entityType/:entityId", async (req, res) => {
    const user = await deps.requireAuth(req, res);
    if (!user) return;
    try {
      res.json({ success: true, notes: await listModuleNotes(req.params.entityType, req.params.entityId) });
    } catch (err) {
      sendError(res, err, "GET /api/notes/:entityType/:entityId");
    }
  });

  app.post("/api/notes/:entityType/:entityId", async (req, res) => {
    const user = await deps.requireAuth(req, res);
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
    const user = await deps.requireAuth(req, res);
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
