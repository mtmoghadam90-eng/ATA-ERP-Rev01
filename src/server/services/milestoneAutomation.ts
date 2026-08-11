import { Prisma } from "@prisma/client";
import { getDb } from "../db";
import { AuthUser } from "../auth";
import { expandDateFields } from "../dates";
import { toNullableString } from "../childSync";
import { addDaysToShamsi } from "../../dateUtils";
import { sameCategory } from "../../utils/activityCategories";
import { notifyModuleResponsible, notifyUser } from "./notificationService";

/**
 * The project's own milestones and their automation rules.
 *
 * This is the "نقاط حیاتی و اتوماسیون" panel: per-project checkpoints, each of
 * which can fire rules when it is completed — raise a task for someone, or send
 * them a notification. It is separate from `settings.workflows`, which is the
 * company-wide engine keyed on record events; this one is keyed on a checkpoint
 * a person defined for one job.
 *
 * The panel stored all of this and executed none of it: ticking a milestone
 * wrote `isCompleted` and nothing else ever read `milestoneRules`. The screen
 * meanwhile promised that tasks and notifications "به صورت خودکار صادر گردد",
 * and the tick's own tooltip said "کلیک برای فعالسازی اتوماسیون". So the rules
 * accumulated and nothing was ever raised.
 *
 * Two rules about where this runs:
 *
 *  - **Server-side, from the write that completed the milestone.** A browser
 *    that fires the rule instead would raise the task twice when two people
 *    tick at once, and not at all when the tick came from a category closing.
 *  - **Outside the project's transaction.** A task or a notification is a
 *    separate record; failing to create one must not roll back the completion
 *    the user just made. Each rule is attempted on its own for the same reason.
 */

export interface MilestoneRule {
  id: string;
  triggerMilestoneId: string;
  actionType: "create_task" | "send_notification";
  taskTitle: string;
  taskDesc: string;
  assignedTo: string;
  priority: string;
  dueDaysOffset?: number;
}

/** The rules stored on the project, as a list — whatever the column holds. */
export function parseMilestoneRules(stored: unknown): MilestoneRule[] {
  if (!stored) return [];
  let value: unknown = stored;
  if (typeof stored === "string") {
    try {
      value = JSON.parse(stored);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];

  return value
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .map<MilestoneRule>((r) => ({
      id: String(r.id ?? ""),
      triggerMilestoneId: String(r.triggerMilestoneId ?? ""),
      actionType: r.actionType === "send_notification" ? "send_notification" : "create_task",
      taskTitle: String(r.taskTitle ?? ""),
      taskDesc: String(r.taskDesc ?? ""),
      assignedTo: String(r.assignedTo ?? ""),
      priority: String(r.priority ?? "متوسط"),
      dueDaysOffset: Number(r.dueDaysOffset ?? 0) || 0,
    }))
    .filter((r) => !!r.triggerMilestoneId);
}

/**
 * Resolves the rule's assignee to an account.
 *
 * The panel stores a `fullName`, because its picker is a list of names. So the
 * name is matched against `fullName` and `username`, and when nothing matches
 * the task still gets created — carrying the name as written, unassigned rather
 * than silently dropped. A rule that names someone who has left should show up
 * in a task list as needing a new owner, not vanish.
 */
async function resolveAssignee(
  name: string,
): Promise<{ assignedToUserId: string | null; assignedToName: string }> {
  const trimmed = (name || "").trim();
  if (!trimmed) return { assignedToUserId: null, assignedToName: "" };

  const match = await getDb().user.findFirst({
    where: { OR: [{ fullName: trimmed }, { username: trimmed }] },
    select: { id: true, fullName: true },
  });
  return { assignedToUserId: match?.id ?? null, assignedToName: match?.fullName || trimmed };
}

/**
 * Runs every rule bound to the milestones that have just been completed.
 *
 * `completed` is the set of milestone ids that changed from open to done in
 * this write — not every completed milestone on the project. Passing the whole
 * completed set would re-raise every task on every save, which is the reason
 * milestone identity has to survive a save (see `syncMilestones`).
 */
export async function runMilestoneRules(
  projectId: string,
  completed: { id: string; name: string }[],
  user: AuthUser,
  todayJalali: string,
): Promise<number> {
  if (completed.length === 0) return 0;
  const db = getDb();

  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, code: true, milestoneRules: true },
  });
  if (!project) return 0;

  const rules = parseMilestoneRules(project.milestoneRules);
  if (rules.length === 0) return 0;

  const byId = new Map(completed.map((m) => [m.id, m]));
  let fired = 0;

  for (const rule of rules) {
    const milestone = byId.get(rule.triggerMilestoneId);
    if (!milestone) continue;

    // The description the user wrote, with the checkpoint that raised it named
    // underneath — otherwise an automatic task arrives with no clue why.
    const provenance = `نقطه حیاتی «${milestone.name}» در پروژه «${project.name || project.code}» تکمیل شد.`;
    const title = rule.taskTitle.trim() || `اقدام خودکار پس از «${milestone.name}»`;
    const body = [rule.taskDesc.trim(), provenance].filter(Boolean).join("\n\n");

    try {
      if (rule.actionType === "create_task") {
        const assignee = await resolveAssignee(rule.assignedTo);
        await db.task.create({
          data: {
            title: toNullableString(title, 400)!,
            description: body,
            // Both date columns, through the one place that maps the calendars:
            // a Jalali-only due date falls out of every due-date sort and filter.
            ...expandDateFields(
              { dueDate: addDaysToShamsi(todayJalali, rule.dueDaysOffset || 0) },
              ["dueDate"],
            ),
            priority: toNullableString(rule.priority, 20) ?? "متوسط",
            status: "در انتظار",
            assignedToUserId: assignee.assignedToUserId,
            assignedToName: assignee.assignedToName,
            relatedToType: "project",
            relatedToId: project.id,
            relatedToName: project.name,
          } as Prisma.TaskUncheckedCreateInput,
        });
      } else if (rule.actionType === "send_notification") {
        const assignee = await resolveAssignee(rule.assignedTo);
        if (assignee.assignedToUserId) {
          await notifyUser({
            userId: assignee.assignedToUserId,
            module: "پروژه‌ها",
            title,
            description: body,
            projectId: project.id,
            // Deliberately not the actor: `notifyUser` drops a notice a user
            // sends to themselves, and someone who sets a rule to notify
            // themselves at a checkpoint means it.
            actorUserId: null,
          });
        } else {
          // Nobody matched the name. Rather than dropping it, it goes to the
          // module's responsible — the same fallback every other notice uses.
          await notifyModuleResponsible("پروژه‌ها", title, body, user, project.id);
        }
      }
      fired++;
    } catch (err) {
      // One rule that cannot be carried out must not stop the others, and must
      // not undo the completion that triggered them.
      console.error(`[milestone] rule ${rule.id} on project ${projectId} failed`, err);
    }
  }
  return fired;
}

/**
 * Completes the milestones a category's start or finish is meant to tick, and
 * runs their rules.
 *
 * This is what "تریگر هوشمند" on a milestone means: a checkpoint bound to an
 * activity category, completed by the category rather than by hand. Matching is
 * through `sameCategory`, not string equality — the purchase-order category has
 * been renamed, and milestones saved under the old name must keep working.
 *
 * Only ever moves a milestone from open to done. A category reopened and closed
 * again does not re-raise the tasks, because the second close finds nothing to
 * complete.
 */
export async function applyCategoryMilestoneTriggers(
  projectId: string,
  categoryName: string,
  event: "category_start" | "category_complete",
  user: AuthUser,
  todayJalali: string,
): Promise<{ completed: number; fired: number }> {
  const db = getDb();

  const candidates = await db.projectMilestone.findMany({
    where: { projectId, isCompleted: false, triggerType: event },
    select: { id: true, name: true, triggerCategoryName: true },
  });

  const matched = candidates.filter(
    (m) => !!m.triggerCategoryName && sameCategory(m.triggerCategoryName, categoryName),
  );
  if (matched.length === 0) return { completed: 0, fired: 0 };

  await db.projectMilestone.updateMany({
    where: { id: { in: matched.map((m) => m.id) } },
    data: {
      isCompleted: true,
      ...expandDateFields({ completedAt: todayJalali }, ["completedAt"]),
    },
  });

  const fired = await runMilestoneRules(
    projectId,
    matched.map((m) => ({ id: m.id, name: m.name })),
    user,
    todayJalali,
  );
  return { completed: matched.length, fired };
}
