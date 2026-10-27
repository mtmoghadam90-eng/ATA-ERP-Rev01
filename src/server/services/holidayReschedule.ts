import { Prisma } from "@prisma/client";
import { getDb } from "../db";
import { AuthUser } from "../auth";
import { expandDateFields, jalaliToDate } from "../dates";
import { addDaysToShamsi, isOfficialHoliday } from "../../dateUtils";
import { planHolidayReschedule } from "../../utils/holidays";
import { openTaskWhere } from "../../utils/workBoard";
import { notifyUser } from "./notificationService";
import { syncDeferralToChase } from "./taskService";
import { afterCommit } from "../afterCommit";

/**
 * Moving open work off a day that has just become a day off.
 *
 * Run after the calendar changes — Thursdays closed, a day typed in as a
 * holiday, a year imported, the lunar days moved — and **only** then. Not
 * daily: a task somebody deliberately puts on a Thursday after the fact is
 * their decision, and the date picker already paints that day red.
 *
 * Reads the calendar this process holds (`isOfficialHoliday`), so the caller
 * must have refreshed it first; every caller here does so on the line above.
 *
 * Bounded (`RESCHEDULE_SCAN_LIMIT`, nearest due date first) and every failure
 * on one task is logged and skipped, so one bad row cannot leave the rest on a
 * closed day.
 */

export const RESCHEDULE_SCAN_LIMIT = 2000;

export interface RescheduleReport {
  moved: number;
}

export async function rescheduleTasksOffHolidays(
  todayJalali: string,
  actor: AuthUser | null,
): Promise<RescheduleReport> {
  const db = getDb();
  const from = jalaliToDate(todayJalali);
  if (!from) return { moved: 0 };

  const tasks = await db.task.findMany({
    where: { AND: [openTaskWhere(), { dueDate: { gte: from } }] },
    orderBy: { dueDate: "asc" },
    take: RESCHEDULE_SCAN_LIMIT,
    select: {
      id: true, title: true, dueDateJalali: true, assignedToUserId: true,
      taskKind: true, relatedToType: true, relatedToId: true,
    },
  });

  const moves = planHolidayReschedule(tasks, todayJalali, isOfficialHoliday, addDaysToShamsi);
  if (!moves.length) return { moved: 0 };

  const byId = new Map(tasks.map((t) => [t.id, t]));
  const perAssignee = new Map<string, string[]>();
  let moved = 0;

  for (const move of moves) {
    const task = byId.get(move.id);
    if (!task) continue;
    try {
      await db.$transaction(async (tx) => {
        await tx.task.update({
          where: { id: task.id },
          data: expandDateFields({ dueDate: move.to }, ["dueDate"]) as Prisma.TaskUncheckedUpdateInput,
        });
        // A parked chase carries its date on the quotation too; move both or
        // the queue reports the old day.
        await syncDeferralToChase(tx, task, move.to, todayJalali);
      });
      moved++;
      if (task.assignedToUserId) {
        const list = perAssignee.get(task.assignedToUserId) ?? [];
        list.push(`«${task.title}»: ${move.from} ← ${move.to}`);
        perAssignee.set(task.assignedToUserId, list);
      }
    } catch (err) {
      console.warn("[holidays] task could not be moved:", task.id, (err as Error)?.message ?? err);
    }
  }

  // One notice per person, never one per task.
  await afterCommit("holiday reschedule notices", async () => {
    for (const [userId, lines] of perAssignee) {
      await notifyUser({
        userId,
        actorUserId: actor?.id ?? null,
        module: "وظایف و پیگیری",
        title: `موعد ${lines.length} وظیفه به روز کاری بعد منتقل شد`,
        description: `به دلیل تغییر تقویم تعطیلات، موعد این وظایف روی روز تعطیل افتاده بود و`
          + ` به اولین روز کاری بعد منتقل شد:\n${lines.slice(0, 30).join("\n")}`
          + (lines.length > 30 ? `\nو ${lines.length - 30} وظیفهٔ دیگر.` : ""),
      });
    }
  });

  return { moved };
}
