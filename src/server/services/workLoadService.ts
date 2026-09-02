import { getDb } from "../db";
import { AuthUser } from "../auth";
import { expandDateFields, jalaliToDate } from "../dates";
import {
  REFERRAL_DOING, TASK_DOING, laneWhere, rankForTopUp,
} from "../../utils/workBoard";
import {
  WorkLimits, readWorkLimits, remainingCapacity, topUpShortfall,
} from "../../utils/workLimits";

/**
 * How much work one person is holding, and what to do about it.
 *
 * The board has always been able to say what is in each column; it could not
 * say whether that was *too much*. «در حال انجام» with eleven cards in it is
 * not eleven things being done — it is one being done and ten being forgotten —
 * and an empty one beside a full «برای انجام» is somebody deciding what to
 * start from scratch every morning, which is how the thing at the top of the
 * screen gets started instead of the thing that is due.
 *
 * Both limits live on the account (`minActiveTasks` / `maxActiveTasks`) and
 * both are **null by default**, so nothing here reaches an account until
 * somebody types a number in. The pure arithmetic is `src/utils/workLimits.ts`.
 *
 * **A person's load is both kinds of card**, because it is one board: a
 * referral picked up is exactly as much of somebody's afternoon as a task
 * picked up, and counting only the tasks would let the cap be walked straight
 * past by anyone whose work arrives as referrals.
 */

/** Everything one person is holding in the middle column, both record types. */
export async function activeWorkCount(userId: string, todayJalali: string): Promise<number> {
  const db = getDb();
  const today = jalaliToDate(todayJalali);

  const [tasks, referrals] = await Promise.all([
    db.task.count({
      where: { AND: [{ assignedToUserId: userId }, laneWhere("DOING", today)] },
    }),
    db.projectReferral.count({
      where: { assignedToUserId: userId, status: REFERRAL_DOING },
    }),
  ]);
  return tasks + referrals;
}

export async function limitsFor(userId: string): Promise<WorkLimits> {
  const row = await getDb().user.findUnique({
    where: { id: userId },
    select: { minActiveTasks: true, maxActiveTasks: true },
  });
  return readWorkLimits(row);
}

/**
 * How many more cards each of these people may take into «در حال انجام».
 *
 * One read per person rather than one per card: a move is a batch, and the
 * whole point of doing it in a single request is that the column does not
 * rearrange itself an item at a time.
 */
export async function capacityByUser(
  userIds: string[],
  todayJalali: string,
): Promise<Map<string, { active: number; limits: WorkLimits; remaining: number }>> {
  const out = new Map<string, { active: number; limits: WorkLimits; remaining: number }>();
  for (const id of [...new Set(userIds.filter(Boolean))]) {
    const limits = await limitsFor(id);
    // Nothing to count when there is no cap: the answer cannot change what
    // happens, and this runs on every board move.
    const active = limits.max === null ? 0 : await activeWorkCount(id, todayJalali);
    out.set(id, { active, limits, remaining: remainingCapacity(active, limits.max) });
  }
  return out;
}

export interface TopUpResult {
  /** How many cards were pulled up. */
  promoted: number;
  /** What the middle column holds afterwards, and the limits it is held to. */
  active: number;
  min: number | null;
  max: number | null;
}

/**
 * Fills the middle column back up to the floor.
 *
 * Runs for **one person — the one asking** — and never across the company: an
 * automation that reorganised somebody else's day without them looking at it is
 * a different feature and a worse one.
 *
 * Two sources, ranked together by `rankForTopUp`: «برای انجام», and the chases
 * parked in «در انتظار مشتری». Promoting a parked chase means bringing its next
 * contact date **forward to today**, because that column is derived from that
 * date and nothing else — writing a status would leave the card exactly where
 * it was, which is a promotion that does nothing. It is also the honest
 * meaning: there is room today, so this is one to call today, and every other
 * screen that reads the follow-up date agrees with the board about it.
 *
 * **Only tasks are promoted**, though a referral still *counts* toward the load
 * and toward the cap. Two reasons, and the second is the real one: a referral
 * carries no due date, so it would rank behind every dated card and almost
 * never be reached; and picking one up notifies the colleague who asked for it
 * that somebody is on it, which is a thing a person does and not a thing a
 * capacity rule should say on their behalf.
 */
export async function topUpActiveWork(
  user: AuthUser,
  todayJalali: string,
): Promise<TopUpResult> {
  const db = getDb();
  const limits = await limitsFor(user.id);
  /*
   * An account with neither limit is the common case and costs one read.
   *
   * This runs on every board move and every completion, so counting a load
   * that nothing will be compared against is work done for nobody — and the
   * figure would not be drawn either, since the heading shows «۳ از ۵» only
   * where there is a maximum.
   */
  if (limits.min === null && limits.max === null) {
    return { promoted: 0, active: 0, min: null, max: null };
  }

  const active = await activeWorkCount(user.id, todayJalali);
  const wanted = topUpShortfall(active, limits);
  if (wanted === 0) {
    return { promoted: 0, active, min: limits.min, max: limits.max };
  }

  const today = jalaliToDate(todayJalali);
  const mine = { assignedToUserId: user.id };

  /*
   * The candidates, bounded. The floor is a handful of cards; reading the
   * whole of somebody's backlog to pick three of them is a scan nobody needs,
   * and the ranking below only ever looks at the front of the queue.
   */
  const SCAN = 200;
  const [todoTasks, waitingTasks] = await Promise.all([
    db.task.findMany({
      where: { AND: [mine, laneWhere("TODO", today)] },
      select: {
        id: true, priority: true, dueDateJalali: true, createdAt: true, startedAt: true,
      },
      orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
      take: SCAN,
    }),
    db.task.findMany({
      where: { AND: [mine, laneWhere("WAITING", today)] },
      select: {
        id: true, priority: true, dueDateJalali: true, createdAt: true, startedAt: true,
      },
      orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
      take: SCAN,
    }),
  ]);

  type Candidate = {
    id: string;
    what: "task" | "chase";
    priority?: string | null;
    dueDate?: string | null;
    createdAt: string;
    /** Already stamped, so the promotion does not re-date the day work began. */
    started?: Date | null;
  };

  const candidates: Candidate[] = [
    ...todoTasks.map((t) => ({
      id: t.id, what: "task" as const, priority: t.priority, started: t.startedAt,
      dueDate: t.dueDateJalali, createdAt: t.createdAt.toISOString(),
    })),
    ...waitingTasks.map((t) => ({
      id: t.id, what: "chase" as const, priority: t.priority, started: t.startedAt,
      dueDate: t.dueDateJalali, createdAt: t.createdAt.toISOString(),
    })),
  ];

  let promoted = 0;
  for (const card of rankForTopUp(candidates).slice(0, wanted)) {
    await db.task.update({
      where: { id: card.id },
      data: {
        status: TASK_DOING,
        // The chase's column *is* its date, so a promotion has to move it.
        ...(card.what === "chase" ? expandDateFields({ dueDate: todayJalali }, ["dueDate"]) : {}),
        /*
         * Stamped once and never cleared. The day work began on something is a
         * fact, and a card pushed back to the queue and picked up again did
         * not start twice — the same rule `laneTimestamps` holds for a move.
         */
        ...(card.started ? {} : expandDateFields({ startedAt: todayJalali }, ["startedAt"])),
      },
    });
    promoted++;
  }

  return { promoted, active: active + promoted, min: limits.min, max: limits.max };
}
