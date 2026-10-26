/**
 * «ارسال به همکار» — handing work on as a task is ticked off.
 *
 * Asked for as «آقای فلانی لیست قیمت را تهیه می‌کند، در شرح اقدام می‌نویسد
 * "آقای بهمانی لیست قیمت به پیوست خدمت شما" و بسته به انتخابش برای بهمانی
 * وظیفه می‌رود یا اعلان». So the words and the files of «شرح اقدام» are the
 * message, and the person ticking the task off chooses what it becomes:
 *
 * - **TASK** — work the colleague has to do. It lands on their board,
 *   continuing this one (`previousTaskId`), related to what this task was about.
 * - **REFERRAL** — a request in the project's feed, naming the colleague, with a
 *   conversation of its own. Only where the work belongs to a project, since a
 *   referral *is* a feed message.
 * - **NOTICE** — «فقط اطلاع»: the colleague should know and owes nothing.
 *
 * Where it is recorded: on a project, every one of the three also writes into
 * the project's activity feed, under the category the work belongs to (opened,
 * or reopened, automatically). With no project there is no feed, so the trail is
 * the task itself — the new task names the one it continues, and the completed
 * task keeps a list of what it handed on (`HandoffEntry`), which is also what a
 * meeting's «اقدامات انجام شده» reads.
 *
 * Pure: the server and the modal both run it.
 */
import { ACTIVITY_CATEGORY, sameCategory } from "./activityCategories";
import { normalizeAttachments, type ActivityAttachment } from "./attachments";
import { taskRelationKind } from "./taskRelations";

export const HANDOFF_MODES = ["TASK", "REFERRAL", "NOTICE"] as const;
export type HandoffMode = (typeof HANDOFF_MODES)[number];

export const HANDOFF_MODE_LABELS: Record<HandoffMode, string> = {
  TASK: "وظیفه برای همکار",
  REFERRAL: "ارجاع در فعالیت‌های پروژه",
  NOTICE: "فقط اطلاع",
};

export function isHandoffMode(value: unknown): value is HandoffMode {
  return typeof value === "string" && (HANDOFF_MODES as readonly string[]).includes(value);
}

/** What the person asked for, as the modal sends it. */
export interface HandoffRequest {
  mode: HandoffMode;
  recipientUserId: string;
  /** The words: «شرح اقدام» as typed. */
  text: string;
  attachments: ActivityAttachment[];
  /** A new task's or referral's deadline, Shamsi. Optional. */
  dueDate?: string | null;
  /** A new task's priority. */
  priority?: string | null;
  /** A category id the person picked; absent means «خودکار». */
  categoryId?: string | null;
}

/**
 * Why a handoff cannot be sent, or null.
 *
 * A referral needs a project because it is a message in a project's feed; the
 * other two do not. Sending work to yourself is refused — a task for oneself is
 * «ثبت و اقدام بعدی», and a notice to oneself is nothing.
 */
export function handoffRefusal(
  req: Partial<HandoffRequest> | null | undefined,
  ctx: { hasProject: boolean; selfUserId?: string | null },
): string | null {
  if (!req) return "درخواست ارسال خالی است.";
  if (!isHandoffMode(req.mode)) return "نوع ارسال (وظیفه، ارجاع یا اطلاع) مشخص نیست.";
  if (!String(req.recipientUserId ?? "").trim()) return "همکاری که باید به او ارسال شود انتخاب نشده است.";
  if (ctx.selfUserId && req.recipientUserId === ctx.selfUserId) {
    return "ارسال به خودتان معنا ندارد؛ برای کار بعدی خودتان «ثبت و اقدام بعدی» را بزنید.";
  }
  if (req.mode === "REFERRAL" && !ctx.hasProject) {
    return "ارجاع فقط برای کاری ممکن است که به یک پروژه مربوط باشد؛ «وظیفه» یا «فقط اطلاع» را انتخاب کنید.";
  }
  const text = String(req.text ?? "").trim();
  const files = normalizeAttachments(req.attachments ?? []);
  if (!text && files.length === 0) return "برای ارسال به همکار، شرح اقدام یا یک فایل لازم است.";
  return null;
}

/**
 * The category a project-bound handoff is recorded under.
 *
 * In order: the one the person picked; the category of the feed message the
 * task was raised from; «صورتجلسات» for a meeting's task and the quotations'
 * category for a task on a proforma; a category the project already has open;
 * and finally the first category the company lists. Answers a category id from
 * `categories`, or null when the company lists none.
 */
export function handoffCategoryId(input: {
  picked?: string | null;
  sourceCategoryId?: string | null;
  relatedToType?: string | null;
  openGroupCategoryIds?: readonly string[];
  categories: readonly { id: string; name: string }[];
}): string | null {
  const ids = new Set(input.categories.map((c) => c.id));
  if (input.picked && ids.has(input.picked)) return input.picked;
  if (input.sourceCategoryId && ids.has(input.sourceCategoryId)) return input.sourceCategoryId;
  const kind = taskRelationKind(input.relatedToType);
  const named = kind === "meeting" ? ACTIVITY_CATEGORY.MEETINGS
    : kind === "proforma" ? ACTIVITY_CATEGORY.PROFORMAS
      : null;
  if (named) {
    const hit = input.categories.find((c) => sameCategory(c.name, named));
    if (hit) return hit.id;
  }
  const open = (input.openGroupCategoryIds ?? []).find((id) => ids.has(id));
  if (open) return open;
  return input.categories[0]?.id ?? null;
}

/** One thing a completed task handed on, kept on that task. */
export interface HandoffEntry {
  mode: HandoffMode;
  toUserId: string;
  toName: string;
  /** ISO instant. */
  at: string;
  text: string;
  attachments: ActivityAttachment[];
  /** The task raised, for TASK. */
  taskId?: string | null;
  /** The feed message written, on a project. */
  activityId?: string | null;
}

export const MAX_HANDOFFS_PER_TASK = 50;

export function parseHandoffs(json: unknown): HandoffEntry[] {
  let raw: unknown = json;
  if (typeof json === "string") {
    try { raw = JSON.parse(json); } catch { return []; }
  }
  if (!Array.isArray(raw)) return [];
  const out: HandoffEntry[] = [];
  for (const e of raw) {
    const r = (e ?? {}) as Record<string, unknown>;
    if (!isHandoffMode(r.mode) || !r.toUserId) continue;
    out.push({
      mode: r.mode,
      toUserId: String(r.toUserId),
      toName: String(r.toName ?? ""),
      at: String(r.at ?? ""),
      text: String(r.text ?? ""),
      attachments: normalizeAttachments(r.attachments ?? []),
      taskId: r.taskId ? String(r.taskId) : null,
      activityId: r.activityId ? String(r.activityId) : null,
    });
  }
  return out;
}

/** The list with one more entry, as the column stores it (newest last). */
export function appendHandoff(stored: unknown, entry: HandoffEntry): string {
  const list = [...parseHandoffs(stored), entry].slice(-MAX_HANDOFFS_PER_TASK);
  return JSON.stringify(list);
}

/**
 * The sentence written into the project's feed for a task or a notice.
 *
 * No «@» in it on purpose: a name after «@» raises a referral, which is the
 * third mode and not what was chosen.
 */
export function handoffFeedText(mode: HandoffMode, input: {
  toName: string; taskTitle: string; text: string;
}): string {
  const head = mode === "TASK"
    ? `وظیفه برای ${input.toName} (در ادامهٔ «${input.taskTitle}»)`
    : `اطلاع به ${input.toName} (از انجام «${input.taskTitle}»)`;
  return input.text.trim() ? `${head}:\n${input.text.trim()}` : head;
}

/** A new task's title, when it continues another. */
export function continuationTitle(taskTitle: string, text: string): string {
  const firstLine = text.trim().split(/\r?\n/)[0]?.trim() ?? "";
  const base = firstLine || `در ادامهٔ: ${taskTitle}`;
  return base.length > 200 ? `${base.slice(0, 199)}…` : base;
}

/* ----------------------- a meeting action's trail ------------------------ */

export interface TrailTask {
  id: string;
  previousTaskId?: string | null;
}

/** How far down a trail is followed. A chain is a handful; this is a bound, not a design. */
export const MAX_TRAIL_TASKS = 200;

/**
 * The tasks under each root, depth-first, each with its depth.
 *
 * `roots` are the meeting item's own tasks (one per assignee); everything
 * continuing them hangs underneath. A task appearing twice — a cycle nobody
 * could create through the screen, but a bad import could — is drawn once.
 */
export function orderTrail<T extends TrailTask>(roots: readonly string[], tasks: readonly T[]): { task: T; depth: number }[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const children = new Map<string, T[]>();
  for (const t of tasks) {
    if (!t.previousTaskId) continue;
    const list = children.get(t.previousTaskId) ?? [];
    list.push(t);
    children.set(t.previousTaskId, list);
  }
  const out: { task: T; depth: number }[] = [];
  const seen = new Set<string>();
  const walk = (id: string, depth: number) => {
    const t = byId.get(id);
    if (!t || seen.has(id) || out.length >= MAX_TRAIL_TASKS) return;
    seen.add(id);
    out.push({ task: t, depth });
    for (const c of children.get(id) ?? []) walk(c.id, depth + 1);
  };
  for (const r of roots) walk(r, 0);
  return out;
}
