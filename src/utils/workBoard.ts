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

import { FOLLOW_UP_KIND } from "./salesFollowUp";

/** The four columns, in the order they are drawn (RTL: right to left). */
export const BOARD_LANES = ["TODO", "WAITING", "DOING", "DONE"] as const;
export type BoardLane = (typeof BOARD_LANES)[number];

export const LANE_LABELS: Record<BoardLane, string> = {
  TODO: "برای انجام",
  WAITING: "در انتظار مشتری",
  DOING: "در حال انجام",
  DONE: "انجام شده",
};

/**
 * The columns a card can be **pushed** into, which is not all of them.
 *
 * «در انتظار مشتری» is derived from the chase's own next-contact date, so
 * there is nothing for a move to write: pushing a card there would mean
 * inventing a future date nobody agreed with the customer. A quotation is
 * parked by recording its follow-up result — «موکول به تاریخ دیگر» — which is
 * where that date comes from, and it leaves the column on its own the day it
 * arrives. Typed rather than merely documented, so `taskStatusForLane` and
 * `referralStatusForLane` cannot be handed a lane they have no answer for.
 */
export const MOVABLE_LANES = ["TODO", "DOING", "DONE"] as const;
export type MovableLane = (typeof MOVABLE_LANES)[number];

export function isMovableLane(lane: string): lane is MovableLane {
  return (MOVABLE_LANES as readonly string[]).includes(lane);
}

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
 * Which column a *chase* belongs in, where its status word cannot say.
 *
 * A sales follow-up is not «to do» and not «in progress»: it is a call agreed
 * for a day. Until that day comes there is nothing to do and nobody to chase —
 * the quotation is sitting with the customer — and on the day, it is the most
 * pressing thing on the desk. So a follow-up's column is its **due date**, and
 * the status word it carries is not consulted at all beyond «is it finished».
 *
 * That is what makes «در انتظار مشتری» need no sweep, no second status column
 * and no nightly job: a chase leaves it the moment its date arrives, because
 * nothing was ever stored saying it was there. It is also why the status the
 * task happens to carry is irrelevant here — the automations raise a follow-up
 * as «در انتظار», the completion flow as «برای انجام» and an old row may carry
 * «در حال انجام», and none of those three was ever a statement about whether
 * the customer had answered.
 *
 * An **undated** chase is due now, not parked for ever: a follow-up with no
 * date is the one nobody planned, which is exactly what the health check calls
 * «بدون اقدام بعدی» and ranks above what is merely upcoming.
 */
export function taskBoardLane(
  task: { status?: string | null; taskKind?: string | null; dueDate?: string | null },
  todayJalali: string,
): BoardLane {
  const lane = taskLane(task.status);
  if (lane === "DONE") return "DONE";
  if (String(task.taskKind ?? "") !== FOLLOW_UP_KIND) return lane;

  const due = String(task.dueDate ?? "").trim();
  return due && due > todayJalali ? "WAITING" : "DOING";
}

/**
 * The status to write when a task is moved into a column.
 *
 * Dropping into «انجام شده» never writes «کنسل شده» — cancelling is a decision
 * somebody makes explicitly on the card, not something a move can do by
 * accident — and a card already cancelled that is dropped back into the same
 * column keeps what it has, which is why the current status is an argument.
 *
 * Typed over `MovableLane`: «در انتظار مشتری» has no status to write, and a
 * function that quietly answered one for it would put a card in a column its
 * own date contradicts.
 */
/**
 * The query that finds one column.
 *
 * **The middle column is an exclusion, and that is the whole point.** Every
 * automation here raises its task as «در انتظار» — the workflow engine, the
 * milestone rules, the sales follow-up and the assistant — a fourth value no
 * screen has ever offered and `TASK_STATUSES` does not name. `taskLane` already
 * put it in the open column, but the status *filter* was an exact match on the
 * three the dropdown listed, so choosing «در حال انجام» asked for a string none
 * of those tasks carried and answered with nothing at all.
 *
 * Written as «not one of the other three» rather than as a list of the values
 * that mean in-progress, so it agrees with `taskLane`'s own fallback: a status
 * nobody anticipated is open work, and open work must never be unfindable.
 *
 * **The chases are separated by their date, exactly as `taskBoardLane` places
 * them**, because the dropdown and the board have to answer the same question.
 * That is also why this takes a date: the column is derived, so the query for
 * it is a date comparison and not a status word.
 *
 * `dueDate` is nullable, so the «not parked» half is spelled out as «no date or
 * a date that has come» rather than as `NOT (dueDate > today)` — SQL evaluates
 * that to unknown for a NULL and drops exactly the undated chases the rule
 * above says are due now.
 */
export function laneWhere(lane: BoardLane, today: Date | null): Record<string, unknown> {
  const finished = { status: { in: [TASK_DONE, TASK_CANCELLED] } };
  if (lane === "DONE") return finished;

  const chase = { taskKind: FOLLOW_UP_KIND };
  const notChase = { taskKind: { not: FOLLOW_UP_KIND } };
  const open = { status: { notIn: [TASK_DONE, TASK_CANCELLED] } };

  if (lane === "WAITING") {
    // With no date to compare against nothing can be parked. Answering «every
    // chase» here would empty «در حال انجام» of the calls due today, which is
    // the one thing this column must never do.
    if (!today) return { id: { in: [] as string[] } };
    return { AND: [chase, open, { dueDate: { gt: today } }] };
  }

  if (lane === "TODO") {
    // Ordinary work waiting to be picked up. A chase is never here: its column
    // is its date, and a date is not a thing to be picked up.
    return { AND: [notChase, { status: TASK_TODO }] };
  }

  const dueNow = today
    ? { OR: [{ dueDate: null }, { dueDate: { lte: today } }] }
    : {};
  return {
    OR: [
      { AND: [notChase, { status: { notIn: [TASK_TODO, TASK_DONE, TASK_CANCELLED] } }] },
      { AND: [chase, open, dueNow] },
    ],
  };
}

export function taskStatusForLane(lane: MovableLane, current?: string | null): string {
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

export function referralStatusForLane(lane: MovableLane): string {
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
export const BOARD_SORTS = ["date", "due", "priority"] as const;
export type BoardSort = (typeof BOARD_SORTS)[number];

export const SORT_LABELS: Record<BoardSort, string> = {
  date: "تاریخ ارجاع",
  due: "تاریخ سررسید",
  priority: "اهمیت",
};

/**
 * Priorities, most urgent first — the order «اهمیت» means.
 *
 * A **referral carries no priority at all**, so one counts as «متوسط»: the
 * middle of the ladder rather than the bottom, because a colleague asking for
 * something by name is not inherently less urgent than a task somebody filed as
 * low, and putting every referral under every task would empty the top of the
 * column of exactly the things this merge exists to surface.
 *
 * The same value answers the priority **filter**, which is the point of naming
 * it once: a record is filtered on the value it effectively has, so choosing
 * «متوسط» includes the referrals and choosing «فوری» does not — rather than a
 * referral either vanishing from every priority or surviving all of them.
 */
export const PRIORITY_ORDER = ["فوری", "بالا", "متوسط", "پایین"] as const;
export const DEFAULT_PRIORITY = "متوسط";

export function priorityRank(priority: string | null | undefined): number {
  const index = (PRIORITY_ORDER as readonly string[]).indexOf(String(priority ?? "").trim());
  return index === -1 ? PRIORITY_ORDER.indexOf(DEFAULT_PRIORITY) : index;
}

/** The priority a record is sorted and filtered on, absent or not. */
export function effectivePriority(priority: string | null | undefined): string {
  const value = String(priority ?? "").trim();
  return (PRIORITY_ORDER as readonly string[]).includes(value) ? value : DEFAULT_PRIORITY;
}

/** The minimum a card must carry to be placed and ordered. */
export interface BoardCardOrder {
  /** ISO or comparable string. What «تاریخ ارجاع» sorts on. */
  createdAt: string;
  /** Absent on a referral — see `PRIORITY_ORDER`. */
  priority?: string | null;
  /** Shamsi, `YYYY/MM/DD`. Absent on a referral, which has no due date. */
  dueDate?: string | null;
}

/**
 * One column's order.
 *
 * Newest first by date, soonest first by due date, most urgent first by
 * priority — and **every one of them breaks its ties by date**, because a
 * column of nine «متوسط» cards in arbitrary order is not sorted at all.
 *
 * **A card with no due date sorts last, never first.** Shamsi dates compare as
 * strings, so an empty one would come before every real date and put everything
 * undated at the top of a column somebody opened to see what is due soonest —
 * which is the opposite of the question. A referral has no due date at all.
 *
 * Returns a new array; the input is never reordered in place, since the caller
 * is holding React state.
 */
export function sortBoardCards<T extends BoardCardOrder>(cards: T[], by: BoardSort): T[] {
  const byDate = (a: T, b: T) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();

  return [...cards].sort((a, b) => {
    if (by === "priority") {
      const rank = priorityRank(a.priority) - priorityRank(b.priority);
      if (rank !== 0) return rank;
    }
    if (by === "due") {
      // The sentinel sorts after every real Shamsi date, which is four digits.
      const da = (a.dueDate ?? "").trim() || "9999/99/99";
      const db = (b.dueDate ?? "").trim() || "9999/99/99";
      if (da !== db) return da < db ? -1 : 1;
    }
    return byDate(a, b);
  });
}

/**
 * The order work is picked up in when there is room for more.
 *
 * The opposite question from `sortBoardCards`, and deliberately a different
 * function: that one answers «how should this column be displayed», this one
 * answers «which of these should somebody start next», and the two disagree on
 * every tie — a column is shown newest-first, while the thing to pick up next
 * out of two equally urgent cards is the one that has been waiting longest.
 *
 * Due date leads because that is what a promise is, priority breaks its ties,
 * and age breaks priority's. **An undated card sorts last**: Shamsi dates
 * compare as strings, so an empty one would come before every real date and
 * put the unplanned work in front of what was actually promised for today.
 */
export function rankForTopUp<T extends BoardCardOrder>(cards: T[]): T[] {
  return [...cards].sort((a, b) => {
    const da = (a.dueDate ?? "").trim() || "9999/99/99";
    const db = (b.dueDate ?? "").trim() || "9999/99/99";
    if (da !== db) return da < db ? -1 : 1;

    const rank = priorityRank(a.priority) - priorityRank(b.priority);
    if (rank !== 0) return rank;

    // Oldest first — the card that has been waiting longest.
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });
}

/* --------------------- one filter bar, two record types ------------------ */

/**
 * The task filters, as far as a referral can answer them.
 *
 * The board and the list draw both kinds of record, so one filter bar has to
 * mean something for both. The rule is the same throughout: **a record is
 * filtered on the value it effectively has.** Where it has none, the honest
 * answer is that the question does not describe it, so it drops out — a person
 * asking «what is due this week» is not asking to be shown things with no due
 * date, and a person asking for «فوری» is not asking for everything else too.
 *
 * The one exception is priority, and only because there is a real default: the
 * ladder already treats an absent priority as «متوسط» for ordering
 * (`effectivePriority`), so it answers the filter with the same value rather
 * than disappearing from every choice.
 */
export interface TaskFilterState {
  /** A column, or «all» — never a raw status. See `laneWhere`. */
  lane?: string;
  priority?: string;
  assignedToUserId?: string;
  /** «پروژه», «پیش‌فاکتور», … or «all». A referral is always about a project. */
  relatedToType?: string;
  overdue?: boolean;
  dateFrom?: string;
  dateTo?: string;
  hideCompleted?: boolean;
}

export interface ReferralFilterSubject {
  status: string;
  assignedToUserId?: string | null;
  /** Whether the referral is attached to a project at all. */
  hasProject?: boolean;
}

/** The choices the status filter offers, as the columns they select. */
export const LANE_FILTERS = ["TODO", "WAITING", "DOING", "DONE", "CANCELLED"] as const;
export type LaneFilter = (typeof LANE_FILTERS)[number];

export const LANE_FILTER_LABELS: Record<LaneFilter, string> = {
  TODO: "برای انجام",
  WAITING: "در انتظار مشتری",
  DOING: "در حال انجام",
  DONE: "انجام شده",
  CANCELLED: "کنسل شده",
};

const ANY = (value: string | undefined) => !value || value === "all";

export function referralPassesTaskFilters(
  referral: ReferralFilterSubject,
  filters: TaskFilterState,
): boolean {
  const lane = referralLane(referral.status);

  /*
   * The filter names a **column**, which is the thing the two kinds share —
   * their own status words are different. So choosing «انجام شده» shows the
   * closed referrals too, and «کنسل شده» shows none, because a referral cannot
   * be cancelled.
   */
  if (!ANY(filters.lane)) {
    if (filters.lane === "CANCELLED") return false;
    if (filters.lane !== lane) return false;
  }

  // «انجام‌شده‌ها را پنهان کن» hides the finished column's referrals too.
  if (filters.hideCompleted && lane === "DONE") return false;

  // A referral has no priority, and counts as the one the ladder defaults to.
  if (!ANY(filters.priority) && filters.priority !== DEFAULT_PRIORITY) return false;

  if (!ANY(filters.assignedToUserId)
    && referral.assignedToUserId !== filters.assignedToUserId) return false;

  // Every referral is raised from a message on a project, so it answers that
  // and nothing else.
  if (!ANY(filters.relatedToType) && filters.relatedToType !== "پروژه") return false;

  /*
   * Both of these are questions about a **due date**, which a referral does not
   * have — so it is not late, and it is not inside any window.
   */
  if (filters.overdue) return false;
  if (filters.dateFrom || filters.dateTo) return false;

  return true;
}

/**
 * The server-side ordering a board sort implies, or null when there is none.
 *
 * The page has to be the right page before it is ordered: the sort runs over
 * the two hundred rows in hand, so if the server handed back the wrong two
 * hundred, the top of the column is a slice of the middle — the same fault the
 * sales follow-up queue was corrected for.
 *
 * **Priority deliberately returns null.** SQL orders «فوری», «بالا», «متوسط»
 * and «پایین» by collation, which is alphabetical and has nothing to do with
 * urgency; only `PRIORITY_ORDER` knows that, and it is not a thing a database
 * can be asked. The due-date order stands in, which at least puts the pressing
 * work on the first page.
 */
export function serverOrderFor(by: BoardSort): { sort: string; order: "asc" | "desc" } {
  if (by === "date") return { sort: "createdAt", order: "desc" };
  // Soonest first, and the page sort moves the undated to the end afterwards.
  return { sort: "dueDate", order: "asc" };
}
