/**
 * «ساخت وظیفهٔ تماس گروهی» — the write behind `src/utils/bulkCallTasks.ts`.
 *
 * One ordinary NEXT_ACTION task per selected customer, related to that
 * customer in the spelling the task form writes («مشتری»), so the tick asks
 * «نتیجهٔ تماس» and the «نتایج تماس» report counts it — there is no second
 * kind of task to keep in step.
 *
 * Four decisions:
 * - **One transaction**: all of them or none, so a refused write never leaves
 *   half a list assigned and the person guessing which half.
 * - **A customer already being called is skipped, and named**: an open
 *   NEXT_ACTION on that customer means somebody already has the call, and a
 *   second card is two people ringing one prospect.
 * - **Customer visibility is the customers module's own rule**, inside the
 *   query: somebody who may see only their own customers cannot raise tasks
 *   on anybody else's by sending ids.
 * - **One notice per press, not one per task**: ten texts in a row about ten
 *   calls teaches the reader to ignore the eleventh, so the assignee gets one
 *   in-app notice and one staff message naming the count and the first date.
 */
import { Prisma } from "@prisma/client";
import { getDb } from "../db";
import { AuthUser } from "../auth";
import { expandDateFields } from "../dates";
import { afterCommit } from "../afterCommit";
import { visibilityClause as customerVisibility } from "./customerService";
import { notifyUser } from "./notificationService";
import { notifyStaff } from "./staffNotifications";
import { logAction } from "./auditService";
import { processWorkflowRules } from "./workflowService";
import { addDaysToShamsi, isOfficialHoliday } from "../../dateUtils";
import { relationSpellings } from "../../utils/taskRelations";
import { NEXT_ACTION_KIND } from "../../utils/nextAction";
import { TASK_CANCELLED, TASK_DONE, TASK_TODO } from "../../utils/workBoard";
import {
  bulkCallRefusal, bulkCallTitle, spreadDueDates,
} from "../../utils/bulkCallTasks";

export interface BulkCallInput {
  customerIds: string[];
  kind: string;
  description?: string | null;
  /** Absent means whoever pressed the button. */
  assignedToUserId?: string | null;
  startDate: string;
  /** Tasks per working day; absent or 0 puts them all on the start date. */
  perDay?: number | null;
  priority?: string | null;
}

export interface BulkCallResult {
  created: number;
  firstDate: string | null;
  lastDate: string | null;
  assignedToName: string;
  /** Customers already carrying an open next action, by name. */
  skippedOpen: string[];
  /** Ids that named no customer this person may see. */
  skippedMissing: number;
}

export async function createBulkCallTasks(
  input: BulkCallInput,
  user: AuthUser,
  todayJalali: string,
): Promise<BulkCallResult> {
  const ids = [...new Set((input.customerIds ?? []).map((id) => String(id ?? "").trim()).filter(Boolean))];
  const refusal = bulkCallRefusal({
    customerIds: ids, startDate: input.startDate, perDay: input.perDay, kind: input.kind,
  });
  if (refusal) throw new Error(refusal);

  const db = getDb();
  const assigneeId = String(input.assignedToUserId ?? "").trim() || user.id;
  const [assignee, author] = await Promise.all([
    db.user.findUnique({ where: { id: assigneeId }, select: { id: true, fullName: true, isActive: true } }),
    db.user.findUnique({ where: { id: user.id }, select: { fullName: true } }),
  ]);
  if (!assignee || assignee.isActive === false) throw new Error("مسئول انتخاب‌شده پیدا نشد یا غیرفعال است.");

  const visibility = customerVisibility(user);
  const customers = await db.customer.findMany({
    where: { AND: [{ id: { in: ids } }, ...(visibility ? [visibility] : [])] },
    select: { id: true, companyName: true },
  });
  const byId = new Map(customers.map((c) => [c.id, c]));

  const open = await db.task.findMany({
    where: {
      taskKind: NEXT_ACTION_KIND,
      relatedToType: { in: relationSpellings("customer") },
      relatedToId: { in: customers.map((c) => c.id) },
      status: { notIn: [TASK_DONE, TASK_CANCELLED] },
    },
    select: { relatedToId: true },
  });
  const busy = new Set(open.map((t) => t.relatedToId));

  // In the order the person ticked them, so the spread follows their list.
  const targets = ids.map((id) => byId.get(id)).filter((c): c is NonNullable<typeof c> => !!c && !busy.has(c.id));
  const skippedOpen = ids.map((id) => byId.get(id)).filter((c) => c && busy.has(c.id)).map((c) => c!.companyName);
  const skippedMissing = ids.length - customers.length;

  const dates = spreadDueDates(targets.length, input.startDate.trim(), input.perDay ?? null, {
    nextDay: (d) => addDaysToShamsi(d, 1),
    isOff: (d) => isOfficialHoliday(d),
  });

  const kind = input.kind.trim();
  const description = String(input.description ?? "").trim() || null;
  const priority = String(input.priority ?? "").trim() || "متوسط";

  const created = targets.length === 0 ? [] : await db.$transaction(async (tx) => {
    const rows = [];
    for (let i = 0; i < targets.length; i += 1) {
      const c = targets[i];
      rows.push(await tx.task.create({
        data: {
          title: bulkCallTitle(kind, c.companyName),
          description,
          status: TASK_TODO,
          taskKind: NEXT_ACTION_KIND,
          priority: priority.slice(0, 20),
          relatedToType: "مشتری",
          relatedToId: c.id,
          relatedToName: c.companyName,
          assignedToUserId: assignee.id,
          assignedToName: assignee.fullName,
          createdByUserId: user.id,
          createdByName: author?.fullName ?? null,
          ...expandDateFields({ dueDate: dates[i] }, ["dueDate"]),
        } as Prisma.TaskUncheckedCreateInput,
      }));
    }
    return rows;
  });

  const firstDate = dates[0] ?? null;
  const lastDate = dates[dates.length - 1] ?? null;

  if (created.length > 0) {
    await afterCommit("bulk call tasks audit", () => logAction({
      action: "CREATE",
      module: "وظایف",
      entityId: created[0].id,
      description: `ایجاد گروهی ${created.length} وظیفه «${kind}» برای ${assignee.fullName}`,
      afterState: { count: created.length, ids: created.map((t) => t.id), firstDate, lastDate },
    }, user, todayJalali));

    const summary = `${created.length.toLocaleString("fa-IR")} وظیفهٔ «${kind}» با مشتریان`;
    await afterCommit("bulk call tasks notice", () => notifyUser({
      userId: assignee.id,
      module: "وظایف",
      title: "وظایف جدید",
      description: `${author?.fullName ?? "یک همکار"} ${summary} را به شما سپرد`
        + (firstDate ? ` (از ${firstDate}${lastDate && lastDate !== firstDate ? ` تا ${lastDate}` : ""})` : "") + ".",
      actorUserId: user.id,
    }));
    await afterCommit("bulk call tasks staff message", async () => {
      await notifyStaff({
        kind: "TASK_ASSIGNED",
        assigneeUserId: assignee.id,
        actorUserId: user.id,
        actorName: author?.fullName ?? null,
        title: summary,
        taskKind: NEXT_ACTION_KIND,
        dueDate: firstDate,
        priority,
        entityType: "task",
        entityId: created[0].id,
      });
    });
    // Each is a task a rule may care about, exactly as one raised by hand.
    for (const task of created) {
      await afterCommit("bulk call tasks workflow", () => processWorkflowRules("task_created", {
        taskId: task.id,
        title: task.title,
        assignedTo: task.assignedToUserId,
        priority: task.priority,
        taskKind: task.taskKind,
        dueDate: task.dueDateJalali,
      }, user));
    }
  }

  return {
    created: created.length,
    firstDate,
    lastDate,
    assignedToName: assignee.fullName,
    skippedOpen,
    skippedMissing,
  };
}
