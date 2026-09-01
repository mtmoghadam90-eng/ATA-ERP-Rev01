import express from "express";
import { parseListQuery } from "../listing";
import { BOARD_LANES, BoardLane } from "../../utils/workBoard";
import { moveReferralsToLane } from "../services/activityService";
import { RouteDeps, sendError } from "./types";
import { getTodayShamsi } from "../../dateUtils";
import {
  TASK_FILTERABLE, TASK_SORTABLE, TaskInput,
  createTask, deleteTask, getTask, listTasks, moveTasksToLane, taskSummary, updateTask,
} from "../services/taskService";

const WRITABLE: (keyof TaskInput)[] = [
  "title", "description", "relatedToType", "relatedToId", "relatedToName",
  "priority", "status", "dueDate", "assignedToUserId", "assignedToName",
  "reminderEnabled", "reminderDate", "reminderTime", "customValues",
];

function pickInput(body: unknown): TaskInput {
  const src = (body ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of WRITABLE) {
    if (key in src) out[key] = src[key];
  }
  return out as TaskInput;
}

export function registerTaskRoutes(app: express.Express, deps: RouteDeps): void {
  const KEY = "erp_tasks";

  app.get("/api/tasks", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "read");
    if (!user) return;
    try {
      const q = parseListQuery(req.query as Record<string, unknown>, TASK_SORTABLE, TASK_FILTERABLE);
      const result = await listTasks(q, user, {
        dateFrom: req.query.dateFrom,
        dateTo: req.query.dateTo,
        relatedToId: req.query.relatedToId,
        // The client's clock decides what "overdue" means, since the app runs on
        // the Persian calendar and the user's today is the relevant one.
        overdue: req.query.overdue === "true" ? getTodayShamsi() : undefined,
        // Which column, not which status word: every automation raises its task
        // as «در انتظار», which no dropdown has ever listed. See `laneWhere`.
        lane: req.query.lane,
        // Which half of the board. Narrowed *within* what the caller may see —
        // `visibilityClause` still applies, so an omitted or invented scope
        // widens nothing.
        scope: req.query.scope === "toMe" ? "toMe"
          : req.query.scope === "fromMe" ? "fromMe"
          : undefined,
        // The board's «hide completed» toggle. Read strictly, so a caller that
        // omits it — every integration written before the button existed —
        // still gets the whole list.
        hideCompleted: req.query.hideCompleted === "true",
      });
      res.json({ success: true, ...result });
    } catch (err) {
      sendError(res, err, "GET /api/tasks");
    }
  });

  /*
   * Moving several cards into one column.
   *
   * Registered before `/api/tasks/:id` so «board» is not read as a task id.
   *
   * One request rather than one per card: the board's whole point is picking
   * three or four things out of «برای انجام» and saying «these are today», and
   * four sequential round trips would show the column rearranging itself a card
   * at a time. Tasks and referrals move in the same call because the board does
   * not distinguish them — a person drags a card, not a record type.
   */
  app.post("/api/tasks/board/move", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "write");
    if (!user) return;
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const lane = body.lane;
      if (!(BOARD_LANES as readonly string[]).includes(String(lane))) {
        res.status(400).json({ success: false, error: "ستون مقصد نامعتبر است." });
        return;
      }
      const ids = (value: unknown) =>
        (Array.isArray(value) ? value : []).filter((v): v is string => typeof v === "string");

      const today = getTodayShamsi();
      const tasks = await moveTasksToLane(ids(body.taskIds), lane as BoardLane, user, today);
      const referrals = await moveReferralsToLane(ids(body.referralIds), lane as BoardLane, user);

      res.json({
        success: true,
        moved: tasks.moved + referrals.moved,
        // Reported rather than swallowed: a card that would not move is one the
        // person can see sitting where they left it, and silence there reads as
        // the board being broken.
        refused: tasks.refused + referrals.refused,
      });
    } catch (err) {
      sendError(res, err, "POST /api/tasks/board/move");
    }
  });

  app.get("/api/tasks/summary", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "read");
    if (!user) return;
    try {
      res.json({ success: true, summary: await taskSummary(user, getTodayShamsi()) });
    } catch (err) {
      sendError(res, err, "GET /api/tasks/summary");
    }
  });

  app.get("/api/tasks/:id", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "read");
    if (!user) return;
    try {
      const task = await getTask(req.params.id, user);
      if (!task) {
        res.status(404).json({ success: false, error: "وظیفه یافت نشد." });
        return;
      }
      res.json({ success: true, task });
    } catch (err) {
      sendError(res, err, "GET /api/tasks/:id");
    }
  });

  app.post("/api/tasks", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "write");
    if (!user) return;
    try {
      const input = pickInput(req.body);
      if (!input.title || !String(input.title).trim()) {
        res.status(400).json({ success: false, error: "عنوان وظیفه الزامی است." });
        return;
      }
      res.status(201).json({ success: true, task: await createTask(input, user, getTodayShamsi()) });
    } catch (err) {
      sendError(res, err, "POST /api/tasks");
    }
  });

  app.put("/api/tasks/:id", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "write");
    if (!user) return;
    try {
      const task = await updateTask(req.params.id, pickInput(req.body), user, getTodayShamsi());
      if (!task) {
        res.status(404).json({ success: false, error: "وظیفه یافت نشد یا اجازه تغییر آن را ندارید." });
        return;
      }
      res.json({ success: true, task });
    } catch (err) {
      sendError(res, err, "PUT /api/tasks/:id");
    }
  });

  app.delete("/api/tasks/:id", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "write");
    if (!user) return;
    try {
      const outcome = await deleteTask(req.params.id, user, getTodayShamsi());
      if (outcome === "forbidden") {
        res.status(403).json({ success: false, error: "شما اجازه حذف این وظیفه را ندارید." });
        return;
      }
      if (outcome === "not-found") {
        res.status(404).json({ success: false, error: "وظیفه یافت نشد." });
        return;
      }
      res.json({ success: true });
    } catch (err) {
      sendError(res, err, "DELETE /api/tasks/:id");
    }
  });

  /**
   * Returns tasks with reminders enabled that match the current date and time.
   * Used by App.tsx for real-time reminder notifications.
   */
  app.get("/api/tasks/reminders", async (req, res) => {
    const user = await deps.requireAuth(req, res);
    if (!user) return;
    try {
      const { date, time } = req.query as { date?: string; time?: string };
      if (!date || !time) {
        res.status(400).json({ success: false, error: "date و time الزامی هستند." });
        return;
      }
      const result = await listTasks(
        {
          page: 1,
          pageSize: 100,
          search: "",
          order: "asc",
          filters: {}
        },
        user,
        { reminderDate: date, reminderTime: time }
      );
      res.json({ success: true, tasks: result.rows });
    } catch (err) {
      sendError(res, err, "GET /api/tasks/reminders");
    }
  });
}
