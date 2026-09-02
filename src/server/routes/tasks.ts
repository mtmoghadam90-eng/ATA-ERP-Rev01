import express from "express";
import { parseListQuery } from "../listing";
import { LANE_LABELS, MOVABLE_LANES, MovableLane, isMovableLane } from "../../utils/workBoard";
import { moveReferralsToLane } from "../services/activityService";
import { RouteDeps, sendError } from "./types";
import { getTodayShamsi } from "../../dateUtils";
import {
  TASK_FILTERABLE, TASK_SORTABLE, TaskInput,
  createTask, deleteTask, getTask, listTasks, moveTasksToLane, taskSummary, updateTask,
} from "../services/taskService";
import { topUpActiveWork } from "../services/workLoadService";

const WRITABLE: (keyof TaskInput)[] = [
  "title", "description", "relatedToType", "relatedToId", "relatedToName",
  "priority", "status", "dueDate", "assignedToUserId", "assignedToName",
  "reminderEnabled", "reminderDate", "reminderTime", "customValues",
  /*
   * `taskKind` is deliberately **not** here.
   *
   * The form asks which kind of task is being raised, and a follow-up does not
   * become one by having a word written on it: it belongs to a quotation, it
   * moves that quotation's `followUpState`, it must not be the second open
   * chase on the same document, and it cannot exist on a settled sale. All of
   * that is `reactivateFollowUp`, which the form posts to instead — the same
   * endpoint the sales queue's «فعال‌سازی مجدد» uses. A second way to create
   * one would be a second set of those rules to keep in step, which is the
   * fault the five customer creation forms are the standing example of.
   */
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
        // «در انتظار مشتری» is a date comparison, not a status word, so the
        // column filter cannot be built without today.
        today: getTodayShamsi(),
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
      const lane = String(body.lane ?? "");
      /*
       * Only three of the four columns can be pushed into.
       *
       * «در انتظار مشتری» is derived from the chase's own next-contact date, so
       * there is nothing here to write: a card is parked by recording the
       * follow-up result — «موکول به تاریخ دیگر» — which is where that date
       * comes from. Named in the refusal rather than answered with «invalid»,
       * since a person pressing it is asking a reasonable question.
       */
      if (!isMovableLane(lane)) {
        res.status(400).json({
          success: false,
          error: (MOVABLE_LANES as readonly string[]).includes(lane)
            ? "ستون مقصد نامعتبر است."
            : `«${LANE_LABELS.WAITING}» از تاریخ اقدام بعدی پیگیری می‌آید و مقصد انتقال نیست؛`
              + " برای موکول کردن، نتیجه پیگیری را ثبت کنید.",
        });
        return;
      }
      const ids = (value: unknown) =>
        (Array.isArray(value) ? value : []).filter((v): v is string => typeof v === "string");

      const today = getTodayShamsi();
      const tasks = await moveTasksToLane(ids(body.taskIds), lane as MovableLane, user, today);
      const referrals = await moveReferralsToLane(
        ids(body.referralIds), lane as MovableLane, user, today);

      /*
       * Room made is room to fill.
       *
       * Finishing three cards is exactly when the floor is crossed, so the
       * top-up runs here rather than waiting for the next time somebody opens
       * the board — which is what would make the feature look like it only
       * worked in the morning.
       */
      const topUp = await topUpActiveWork(user, today);

      res.json({
        success: true,
        moved: tasks.moved + referrals.moved,
        // Reported rather than swallowed: a card that would not move is one the
        // person can see sitting where they left it, and silence there reads as
        // the board being broken. Each rule says its own sentence.
        refused: tasks.refused + referrals.refused,
        reasons: [...new Set([...tasks.reasons, ...referrals.reasons])],
        topUp,
      });
    } catch (err) {
      sendError(res, err, "POST /api/tasks/board/move");
    }
  });

  /**
   * Fills «در حال انجام» back up to this person's minimum.
   *
   * A write, so it is a POST and never a side effect of reading the board: the
   * screen asks for it when it opens and after anything is finished, which are
   * the two moments the floor can have been crossed.
   */
  app.post("/api/tasks/board/top-up", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "write");
    if (!user) return;
    try {
      res.json({ success: true, topUp: await topUpActiveWork(user, getTodayShamsi()) });
    } catch (err) {
      sendError(res, err, "POST /api/tasks/board/top-up");
    }
  });

  app.get("/api/tasks/summary", async (req, res) => {
    const user = await deps.requireKeyAccess(req, res, KEY, "read");
    if (!user) return;
    try {
      /*
       * The badge asks for `toMe`, and it is the reason this takes a scope at
       * all: a task belongs to its assignee **and** to whoever raised it, so
       * the unscoped count put every request this user had raised for a
       * colleague into their own inbox figure.
       */
      const scope = req.query.scope === "toMe" ? "toMe"
        : req.query.scope === "fromMe" ? "fromMe"
        : undefined;
      res.json({ success: true, summary: await taskSummary(user, getTodayShamsi(), scope) });
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
