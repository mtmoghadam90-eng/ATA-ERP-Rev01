import express from "express";
import { RouteDeps, sendError } from "./types";
import { getTodayShamsi } from "../../dateUtils";
import { parseListQuery } from "../listing";
import {
  MEETING_SORTABLE, MeetingInput, deleteMeeting, getMeeting, listMeetings,
  openActionsForProject, saveMeeting,
} from "../services/meetingService";

/**
 * «صورتجلسات». Gated by `erp_meetings` → the `meetings` module flag; which
 * meetings answer is decided inside the service (`visibilityClause`).
 */
const WRITABLE: (keyof MeetingInput)[] = [
  "title", "meetingDate", "startTime", "endTime", "place", "summary", "projectId",
  "attendees", "absentees", "nextMeetingDate", "attachments", "items", "finalize",
];

const pick = (body: unknown): MeetingInput => {
  const src = (body ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of WRITABLE) if (key in src) out[key] = src[key];
  return out as MeetingInput;
};

export function registerMeetingRoutes(app: express.Express, deps: RouteDeps): void {
  app.get("/api/meetings", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, "erp_meetings", "read");
    if (!user) return;
    try {
      const q = parseListQuery(req.query as Record<string, unknown>, MEETING_SORTABLE);
      const result = await listMeetings(q, {
        project: req.query.project,
        from: req.query.from,
        to: req.query.to,
        openActions: req.query.openActions,
        status: req.query.status,
      }, user, getTodayShamsi());
      res.json({ success: true, ...result });
    } catch (err) {
      sendError(res, err, "GET /api/meetings");
    }
  });

  // Registered before `/:id` so «open-actions» is not read as a meeting id.
  app.get("/api/meetings/open-actions", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, "erp_meetings", "read");
    if (!user) return;
    try {
      const projectId = String(req.query.projectId ?? "").trim();
      if (!projectId) { res.json({ success: true, items: [] }); return; }
      const exclude = String(req.query.exclude ?? "").trim() || null;
      res.json({
        success: true,
        items: await openActionsForProject(projectId, user, getTodayShamsi(), exclude),
      });
    } catch (err) {
      sendError(res, err, "GET /api/meetings/open-actions");
    }
  });

  app.get("/api/meetings/:id", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, "erp_meetings", "read");
    if (!user) return;
    try {
      const meeting = await getMeeting(req.params.id, user, getTodayShamsi());
      if (!meeting) { res.status(404).json({ success: false, error: "صورتجلسه یافت نشد." }); return; }
      res.json({ success: true, meeting });
    } catch (err) {
      sendError(res, err, "GET /api/meetings/:id");
    }
  });

  const write = (id: (req: express.Request) => string | null, label: string) =>
    async (req: express.Request, res: express.Response) => {
      const user = await deps.requireKeyAccess(req, res, "erp_meetings", "write");
      if (!user) return;
      try {
        const outcome = await saveMeeting(id(req), pick(req.body), user, getTodayShamsi());
        if (!outcome.ok) { res.status(outcome.status).json({ success: false, error: outcome.error }); return; }
        res.json({
          success: true,
          meeting: outcome.meeting,
          createdTasks: outcome.createdTasks,
          cancelledTasks: outcome.cancelledTasks,
        });
      } catch (err) {
        sendError(res, err, label);
      }
    };

  app.post("/api/meetings", write(() => null, "POST /api/meetings"));
  app.put("/api/meetings/:id", write((req) => req.params.id, "PUT /api/meetings/:id"));

  app.delete("/api/meetings/:id", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, "erp_meetings", "write");
    if (!user) return;
    try {
      const outcome = await deleteMeeting(req.params.id, user, getTodayShamsi());
      if (outcome === "not-found") { res.status(404).json({ success: false, error: "صورتجلسه یافت نشد." }); return; }
      if (outcome === "forbidden") {
        res.status(403).json({ success: false, error: "فقط ثبت‌کننده صورتجلسه یا مدیر می‌تواند آن را حذف کند." });
        return;
      }
      res.json({ success: true });
    } catch (err) {
      sendError(res, err, "DELETE /api/meetings/:id");
    }
  });
}
