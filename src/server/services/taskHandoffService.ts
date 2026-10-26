/**
 * «ارسال به همکار» — the write behind `src/utils/taskHandoff.ts`.
 *
 * Called once the completion itself has landed: the tick is true on its own and
 * this is a second request, so a handoff that fails leaves the task finished
 * and says what went wrong rather than undoing the work.
 *
 * There is no new way to create anything here. A task goes through
 * `createTask` (the assignee, the board, the staff message, the workflow
 * trigger), a referral through `addActivity` naming the colleague with «@», a
 * notice through `notifyUser`; and on a project the feed line is an ordinary
 * `addActivity` under a category opened — or reopened — through
 * `upsertCategoryGroup`.
 */
import { getDb } from "../db";
import { AuthUser } from "../auth";
import { loadSettings } from "../settings";
import { createTask, projectOfTask, visibilityClause } from "./taskService";
import { addActivity, upsertCategoryGroup } from "./activityService";
import { notifyUser } from "./notificationService";
import { afterCommit } from "../afterCommit";
import { GROUP_CLOSED, GROUP_OPEN } from "../../utils/workBoard";
import { normalizeAttachments } from "../../utils/attachments";
import {
  HandoffEntry, HandoffMode, HandoffRequest, appendHandoff, continuationTitle,
  handoffCategoryId, handoffFeedText, handoffRefusal, isHandoffMode,
} from "../../utils/taskHandoff";

/**
 * Every key always present: `strict` is off here, so a discriminated union does
 * not narrow (the `RelayAnswer` note in CLAUDE.md).
 */
export interface HandoffResult {
  ok: boolean;
  status: number;
  error: string | null;
  mode: HandoffMode | null;
  taskId: string | null;
  activityId: string | null;
  categoryName: string | null;
}

const fail = (status: number, error: string): HandoffResult => ({
  ok: false, status, error, mode: null, taskId: null, activityId: null, categoryName: null,
});

/** The request as the route hands it over, read strictly. */
export function readHandoffRequest(body: unknown): Partial<HandoffRequest> {
  const b = (body ?? {}) as Record<string, unknown>;
  return {
    mode: isHandoffMode(b.mode) ? b.mode : undefined,
    recipientUserId: typeof b.recipientUserId === "string" ? b.recipientUserId.trim() : "",
    text: typeof b.text === "string" ? b.text : "",
    attachments: normalizeAttachments(b.attachments ?? []),
    dueDate: typeof b.dueDate === "string" && b.dueDate.trim() ? b.dueDate.trim() : null,
    priority: typeof b.priority === "string" && b.priority.trim() ? b.priority.trim() : null,
    categoryId: typeof b.categoryId === "string" && b.categoryId.trim() ? b.categoryId.trim() : null,
  };
}

export async function handoffFromTask(
  taskId: string,
  req: Partial<HandoffRequest>,
  user: AuthUser,
  todayJalali: string,
): Promise<HandoffResult> {
  const db = getDb();
  const visibility = visibilityClause(user);
  const task = await db.task.findFirst({
    where: visibility ? { AND: [{ id: taskId }, visibility] } : { id: taskId },
    select: {
      id: true, title: true, priority: true, handoffs: true, sourceActivityId: true,
      relatedToType: true, relatedToId: true, relatedToName: true,
    },
  });
  if (!task) return fail(404, "وظیفه پیدا نشد.");

  const project = await projectOfTask(task);
  const refusal = handoffRefusal(req, { hasProject: !!project, selfUserId: user.id });
  if (refusal) return fail(400, refusal);
  const request = req as HandoffRequest;

  const recipient = await db.user.findFirst({
    where: { id: request.recipientUserId, isActive: true },
    select: { id: true, fullName: true },
  });
  if (!recipient) return fail(400, "همکار انتخاب‌شده پیدا نشد یا غیرفعال است.");

  const me = await db.user.findUnique({ where: { id: user.id }, select: { fullName: true } });
  const fromName = me?.fullName ?? "";
  const text = request.text.trim();
  const files = normalizeAttachments(request.attachments);

  /* ---- the project's feed: which category, opened or reopened ---- */
  let groupId: string | null = null;
  let categoryName: string | null = null;
  if (project) {
    const settings = await loadSettings();
    const categories = (settings?.activityCategories ?? []).filter((c) => c?.id && c?.name);
    const groups = await db.projectCategoryGroup.findMany({
      where: { projectId: project.id },
      select: { id: true, categoryId: true, categoryName: true, status: true },
      orderBy: { createdAt: "desc" },
    });
    let sourceCategoryId: string | null = null;
    if (task.sourceActivityId) {
      const source = await db.projectActivity.findUnique({
        where: { id: task.sourceActivityId },
        select: { group: { select: { categoryId: true, projectId: true } } },
      });
      if (source?.group?.projectId === project.id) sourceCategoryId = source.group.categoryId;
    }
    const categoryId = handoffCategoryId({
      picked: request.categoryId,
      sourceCategoryId,
      relatedToType: task.relatedToType,
      openGroupCategoryIds: groups.filter((g) => g.status !== GROUP_CLOSED).map((g) => g.categoryId),
      categories,
    });
    const category = categories.find((c) => c.id === categoryId);
    if (category) {
      const existing = groups.find((g) => g.categoryId === category.id);
      categoryName = existing?.categoryName ?? category.name;
      if (!existing || existing.status === GROUP_CLOSED) {
        // Opened if the project has not used it yet, reopened if it was closed
        // — the person asked for this to be recorded here, and a closed
        // category holding a message dated after its end contradicts itself.
        const opened = await upsertCategoryGroup({
          projectId: project.id,
          categoryId: category.id,
          categoryName,
          status: GROUP_OPEN,
          ...(existing ? { endDate: null } : {}),
        }, user);
        if (opened === "forbidden" || opened === "invalid") {
          return fail(403, "ثبت در فعالیت‌های این پروژه برای شما مجاز نیست.");
        }
        groupId = (opened.group as { id: string }).id;
      } else {
        groupId = existing.id;
      }
    } else if (request.mode === "REFERRAL") {
      return fail(400, "هیچ دسته‌بندی فعالیتی در تنظیمات تعریف نشده است؛ ارجاع جایی برای ثبت ندارد.");
    }
  }

  /* ---- the thing itself ---- */
  let newTaskId: string | null = null;
  let activityId: string | null = null;

  if (request.mode === "TASK") {
    const created = await createTask({
      title: continuationTitle(task.title, text),
      description: text || null,
      attachments: files,
      priority: request.priority ?? task.priority,
      dueDate: request.dueDate ?? null,
      assignedToUserId: recipient.id,
      assignedToName: recipient.fullName,
      relatedToType: task.relatedToType,
      relatedToId: task.relatedToId,
      relatedToName: task.relatedToName,
    }, user, todayJalali, { previousTaskId: task.id });
    newTaskId = (created as { id: string }).id;
  }

  if (groupId) {
    const written = await addActivity({
      groupId,
      text: request.mode === "REFERRAL"
        // The name after «@» is what raises the referral (`mentionedColleagues`).
        ? `@${recipient.fullName} ${text || `(در ادامهٔ «${task.title}»)`}`
        : handoffFeedText(request.mode, { toName: recipient.fullName, taskTitle: task.title, text }),
      attachments: files,
      ...(request.mode === "REFERRAL" && request.dueDate ? { dueDate: request.dueDate } : {}),
    }, user);
    if (written === "forbidden") return fail(403, "ثبت در فعالیت‌های این پروژه برای شما مجاز نیست.");
    if (written === "not-found" || written === "invalid") return fail(400, "ثبت در فعالیت‌های پروژه ممکن نشد.");
    activityId = (written.activity as { id?: string }).id ?? null;
  }

  /* ---- the colleague is told ---- */
  if (request.mode !== "REFERRAL") {
    // A referral announces itself (`announceReferrals`); a task and a notice
    // are told here, with the words and the files.
    await afterCommit("task handoff notice", async () => {
      await notifyUser({
          userId: recipient.id,
          actorUserId: user.id,
          module: "وظایف و پیگیری",
          title: request.mode === "TASK"
            ? `وظیفهٔ جدید از ${fromName}`
            : `اطلاع از ${fromName}`,
          description: [
            text,
            `در ارتباط با: ${task.title}`,
            project ? `پروژه: ${project.code} — ${project.name}` : "",
          ].filter(Boolean).join("\n"),
          projectId: project?.id ?? null,
          activityId,
          attachments: files,
      });
    });
  }

  /* ---- and the completed task remembers what it handed on ---- */
  const entry: HandoffEntry = {
    mode: request.mode,
    toUserId: recipient.id,
    toName: recipient.fullName,
    at: new Date().toISOString(),
    text,
    attachments: files,
    taskId: newTaskId,
    activityId,
  };
  await db.task.update({ where: { id: task.id }, data: { handoffs: appendHandoff(task.handoffs, entry) } });

  return { ok: true, status: 200, error: null, mode: request.mode, taskId: newTaskId, activityId, categoryName };
}
