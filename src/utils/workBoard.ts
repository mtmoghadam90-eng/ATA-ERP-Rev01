/**
 * One board over two kinds of work.
 *
 * «کارتابل ارجاعات» and «وظایف و پیگیری» were two screens asking the same
 * question — what has been given to me to do — so a person had to look in two
 * places and remember which kind of thing they were looking for. They are one
 * screen now.
 *
 * **A referral is not copied into the tasks table.** It stays a
 * `project_referrals` row with its own conversation thread, and this module is
 * what lets both kinds sit in the same three columns: a pure mapping from each
 * record's own status onto a lane, and back again. Materialising a referral as
 * a Task row would mean two status columns that have to be kept in step, which
 * is the fault this codebase keeps having to repair; the merge was asked for as
 * a change of where things are shown, and that is all it is.
 */

/** The three columns, in the order they are drawn (RTL: right to left). */
export const BOARD_LANES = ["TODO", "DOING", "DONE"] as const;
export type BoardLane = (typeof BOARD_LANES)[number];

export const LANE_LABELS: Record<BoardLane, string> = {
  TODO: "برای انجام",
  DOING: "در حال انجام",
  DONE: "انجام شده",
};

/* ------------------------------- tasks ---------------------------------- */

/**
 * The four task statuses, three of which are older than this board.
 *
 * «برای انجام» is the new one and is the default for a task created from here
 * on. Everything already on disk carries «در حال انجام» and stays there — the
 * middle column — because that is what it has always meant and rewriting a
 * status nobody chose would also change how any workflow rule keyed on it
 * fires.
 */
export const TASK_TODO = "برای انجام";
export const TASK_DOING = "در حال انجام";
export const TASK_DONE = "انجام شده";
export const TASK_CANCELLED = "کنسل شده";

export const TASK_STATUSES = [TASK_TODO, TASK_DOING, TASK_DONE, TASK_CANCELLED] as const;

/**
 * Which column a task belongs in.
 *
 * **«کنسل شده» is closed work and lands in «انجام شده»**, marked as cancelled
 * rather than given a fourth column: a cancelled task is finished with, and a
 * column of its own would be a permanently empty one on most boards while
 * making the three the user asked for into four.
 *
 * An unrecognised status — one somebody typed into an integration, or a value
 * from a future version — falls to `DOING`, never to `DONE`: an open task
 * hidden among the finished ones is the failure that matters here.
 */
export function taskLane(status: string | null | undefined): BoardLane {
  const value = String(status ?? "").trim();
  if (value === TASK_TODO) return "TODO";
  if (value === TASK_DONE || value === TASK_CANCELLED) return "DONE";
  return "DOING";
}

/**
 * The status to write when a task is dragged into a column.
 *
 * Dropping into «انجام شده» never writes «کنسل شده» — cancelling is a decision
 * somebody makes explicitly on the card, not something a drag can do by
 * accident — and a card already cancelled that is dropped back into the same
 * column keeps what it has, which is why the current status is an argument.
 */
export function taskStatusForLane(lane: BoardLane, current?: string | null): string {
  if (lane === "TODO") return TASK_TODO;
  if (lane === "DOING") return TASK_DOING;
  return String(current ?? "").trim() === TASK_CANCELLED ? TASK_CANCELLED : TASK_DONE;
}

/* ----------------------------- referrals -------------------------------- */

/**
 * A referral's own statuses.
 *
 * The first and the last are older than this board and are what every existing
 * row carries; «در حال اقدام» is new, and exists because a referral had no way
 * to say «I have picked this up» — with two statuses the middle column could
 * not be expressed at all.
 */
export const REFERRAL_PENDING = "در انتظار اقدام";
export const REFERRAL_DOING = "در حال اقدام";
/*
 * «انجام شده», and deliberately not «اتمام کار».
 *
 * That second phrase is a *category group's* closing status and belongs to a
 * different table. `setReferralStatus` compared the incoming value against it
 * to decide which notice to send, so completing a referral has always told the
 * person who raised it that it had been **reopened** — the one branch that
 * could never fire. Naming the value once, here, is what stops that.
 */
export const REFERRAL_DONE = "انجام شده";

export const REFERRAL_STATUSES = [REFERRAL_PENDING, REFERRAL_DOING, REFERRAL_DONE] as const;

/**
 * Which column a referral belongs in.
 *
 * Same rule as a task and for the same reason: anything unrecognised is open
 * work, so it falls to `DOING` rather than being filed as finished.
 */
export function referralLane(status: string | null | undefined): BoardLane {
  const value = String(status ?? "").trim();
  if (value === REFERRAL_DONE) return "DONE";
  if (value === REFERRAL_DOING) return "DOING";
  return "TODO";
}

export function referralStatusForLane(lane: BoardLane): string {
  if (lane === "TODO") return REFERRAL_PENDING;
  if (lane === "DOING") return REFERRAL_DOING;
  return REFERRAL_DONE;
}

/**
 * Whether a referral counts as still needing action.
 *
 * The inbox badge counted «not done», and the middle status has to keep
 * counting or picking a referral up would make it vanish from the badge that
 * says how much is on your plate.
 */
export function referralIsOpen(status: string | null | undefined): boolean {
  return referralLane(status) !== "DONE";
}

/* ------------------------------ sorting --------------------------------- */

/** How the user asked to have a column ordered. */
export const BOARD_SORTS = ["date", "priority"] as const;
export type BoardSort = (typeof BOARD_SORTS)[number];

export const SORT_LABELS: Record<BoardSort, string> = {
  date: "تاریخ ارجاع",
  priority: "اهمیت",
};

/**
 * Priorities, most urgent first — the order «اهمیت» means.
 *
 * A **referral carries no priority at all**, so one sorts as «متوسط»: the
 * middle of the ladder rather than the bottom, because a colleague asking for
 * something by name is not inherently less urgent than a task somebody filed as
 * low, and putting every referral under every task would empty the top of the
 * column of exactly the things this merge exists to surface.
 */
export const PRIORITY_ORDER = ["فوری", "بالا", "متوسط", "پایین"] as const;
export const DEFAULT_PRIORITY = "متوسط";

export function priorityRank(priority: string | null | undefined): number {
  const index = (PRIORITY_ORDER as readonly string[]).indexOf(String(priority ?? "").trim());
  return index === -1 ? PRIORITY_ORDER.indexOf(DEFAULT_PRIORITY) : index;
}

/** The minimum a card must carry to be placed and ordered. */
export interface BoardCardOrder {
  /** ISO or comparable string. What «تاریخ ارجاع» sorts on. */
  createdAt: string;
  /** Absent on a referral — see `PRIORITY_ORDER`. */
  priority?: string | null;
}

/**
 * One column's order.
 *
 * Newest first by date, most urgent first by priority — and **priority ties
 * break by date**, because a column of nine «متوسط» cards in arbitrary order is
 * not sorted at all. Returns a new array; the input is never reordered in
 * place, since the caller is holding React state.
 */
export function sortBoardCards<T extends BoardCardOrder>(cards: T[], by: BoardSort): T[] {
  const byDate = (a: T, b: T) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();

  return [...cards].sort((a, b) => {
    if (by === "priority") {
      const rank = priorityRank(a.priority) - priorityRank(b.priority);
      if (rank !== 0) return rank;
    }
    return byDate(a, b);
  });
}
