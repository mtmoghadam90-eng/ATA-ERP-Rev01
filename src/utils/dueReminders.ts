import { addDaysToShamsi } from "../dateUtils";
import { normalizeJalali } from "../server/dates";

/**
 * «مهلت گذشت و هنوز انجام نشده» — the two notices a deadline is for, and the
 * one that makes an unset deadline answerable.
 *
 * A task and a referral both belong to two people: the one who asked and the
 * one who was asked. A due date is a promise between them, and until now it was
 * a date on a card and nothing more — nobody was told when it was about to
 * arrive, and nobody was told when it had passed. So the person who handed the
 * work over had to remember to go and look, which is exactly the thing they
 * handed over to stop doing.
 *
 * Three notices, and **each goes to the person who can act on it**:
 *
 * - `SOON` reaches the **assignee** a day before, because they are the one who
 *   can still finish it. «فردا مهلت این کار تمام می‌شود» is a reminder; the
 *   same sentence to the person who asked is an anxiety they can do nothing
 *   about.
 * - `OVERDUE` reaches the **person who asked**, because the deadline has gone
 *   and the decision now is theirs — chase it, move it, or let it go. The
 *   assignee already had their reminder the day before and the card is on their
 *   own board; telling them again is the notice people learn to dismiss.
 * - `ASK` reaches the assignee when the deadline was left to them and they have
 *   not set one. Without it «مهلت را ارجاع‌شونده تعیین کند» is a switch that
 *   does nothing: the record ends up with no date, so neither of the other two
 *   notices can ever fire and the person who asked never learns that nothing
 *   was promised.
 *
 * Pure and clock-free, so `test:rules` can hold every branch and the server and
 * the screens read one copy.
 */

/** How many days before the deadline the assignee is reminded. */
export const DUE_SOON_DAYS = 1;

/**
 * How long a passed deadline is still worth a notice.
 *
 * A deadline a month gone is history: the card is still on the board with its
 * date on it, and raising a notice about it now is the board noise this whole
 * file exists to avoid — the same reasoning as `SWEEP_WINDOW_DAYS`. It also
 * bounds what happens on the day this ships, since nothing is backfilled: the
 * first pass speaks about the work that has just gone past its date, not about
 * every deadline the company has ever missed.
 */
export const OVERDUE_WINDOW_DAYS = 30;

export const DUE_NOTICES = ["SOON", "OVERDUE", "ASK"] as const;
export type DueNotice = (typeof DUE_NOTICES)[number];

/** What a record has to say about itself for this rule to answer. */
export interface DueSubject {
  /** `YYYY/MM/DD`, or nothing — a deadline is optional and always was. */
  dueDateJalali?: string | null;
  /** «مهلت را ارجاع‌شونده تعیین کند». */
  dueDateByAssignee?: boolean | null;
  /** The deadline each notice last answered, so it is sent once per deadline. */
  dueSoonNoticeFor?: string | null;
  dueOverdueNoticeFor?: string | null;
  /** The day the «مهلت را تعیین کنید» notice went out. */
  dueAskedNoticeOn?: string | null;
  /**
   * Whether there is still work to do.
   *
   * Computed by the caller from its own vocabulary — a task's statuses and a
   * referral's are different words on different tables, and this rule must not
   * grow a second reading of either.
   */
  open: boolean;
  /** Who would be reminded, and who would be told it is late. */
  assigneeUserId?: string | null;
  creatorUserId?: string | null;
}

/*
 * Every date this rule compares, in the one shape that compares correctly.
 *
 * Shamsi dates are text here, and text comparison is calendar comparison only
 * while the parts are zero-padded — «1405/7/9» sorts after «1405/12/01». The
 * same fold `dueDay` puts every side of its own comparison through.
 */
const day = (value: string | null | undefined): string =>
  normalizeJalali(value) ?? "";

/**
 * Which notices this record owes today.
 *
 * Shamsi dates are `YYYY/MM/DD` with fixed-width parts, so comparing them as
 * text is comparing them as dates — the rule `isDue` already relies on.
 *
 * At most one of the three ever fires on a given day: `SOON` and `OVERDUE` are
 * separated by whether the deadline has passed, and `ASK` only exists where
 * there is no deadline at all.
 */
export function dueNoticesFor(subject: DueSubject, todayJalali: string): DueNotice[] {
  const today = day(todayJalali);
  if (!today) return [];

  // Finished work owes nobody a reminder. A notice that goes on speaking about
  // something already done is what makes people stop reading notices.
  if (!subject.open) return [];

  const due = day(subject.dueDateJalali);
  const out: DueNotice[] = [];

  if (!due) {
    /*
     * No deadline, and one was expected of the assignee.
     *
     * Sent once ever rather than once per day: the switch is a request, and a
     * request repeated every morning is a request nobody answers. If they set a
     * date afterwards the other two notices take over; if they do not, the card
     * is still on their board saying so.
     */
    if (subject.dueDateByAssignee && subject.assigneeUserId && !day(subject.dueAskedNoticeOn)) {
      out.push("ASK");
    }
    return out;
  }

  if (today > due) {
    /*
     * Past the deadline, and not so far past that it is history.
     *
     * The window is inclusive of its last day, so a record whose date went by
     * exactly `OVERDUE_WINDOW_DAYS` ago is still spoken about once.
     */
    const horizon = addDaysToShamsi(due, OVERDUE_WINDOW_DAYS);
    if (today <= day(horizon)
      && subject.creatorUserId
      && day(subject.dueOverdueNoticeFor) !== due) {
      out.push("OVERDUE");
    }
    return out;
  }

  /*
   * The deadline is today or tomorrow.
   *
   * The window reaches back to the deadline itself rather than firing only on
   * `due − 1`, because the pass runs once a day and a server that was off — or
   * a record created the morning before its own deadline — would otherwise miss
   * the one day this notice exists for. Once is once: the marker names the
   * deadline it answered, so a date that is moved earns a fresh reminder and a
   * date that is not never earns a second.
   */
  const opens = day(addDaysToShamsi(due, -DUE_SOON_DAYS));
  if (today >= opens
    && subject.assigneeUserId
    && day(subject.dueSoonNoticeFor) !== due) {
    out.push("SOON");
  }
  return out;
}

/**
 * The band of deadlines a pass has to read.
 *
 * Everything outside it is either too far ahead to be reminded about or too far
 * behind to be worth mentioning, so the query narrows to it rather than reading
 * every open record in the company and deciding in memory.
 */
export function dueScanRange(todayJalali: string): { from: string; to: string } {
  const today = day(todayJalali);
  return {
    from: day(addDaysToShamsi(today, -OVERDUE_WINDOW_DAYS)),
    to: day(addDaysToShamsi(today, DUE_SOON_DAYS)),
  };
}

/** Which of the two people a notice is addressed to. */
export function dueNoticeRecipient(
  kind: DueNotice,
  subject: DueSubject,
): string | null {
  if (kind === "OVERDUE") return subject.creatorUserId ?? null;
  return subject.assigneeUserId ?? null;
}

/* ------------------------------ the wording ------------------------------ */

/** Both kinds of record, because the sentence names which one it is about. */
export type DueRecordKind = "task" | "referral";

const WHAT: Record<DueRecordKind, string> = {
  task: "وظیفه",
  referral: "ارجاع",
};

/** The inbox heading these notices are filed under. */
export const DUE_NOTICE_MODULE = "وظایف و پیگیری";

export function dueNoticeTitle(kind: DueNotice, record: DueRecordKind): string {
  const what = WHAT[record] ?? WHAT.task;
  if (kind === "SOON") return `یادآوری مهلت ${what}`;
  if (kind === "OVERDUE") return `${what} انجام‌نشده پس از مهلت`;
  return `تعیین مهلت ${what}`;
}

export interface DueNoticeSubjectText {
  /** The task's title, or the referral's own request. */
  headline?: string | null;
  /** Whoever the notice is *about* — the other party. */
  counterpart?: string | null;
  dueDateJalali?: string | null;
  /** «ATA-05-38 — پتروشیمی نمونه», where the record names a job. */
  project?: string | null;
}

const clip = (text: string, limit = 90): string =>
  text.length > limit ? `${text.slice(0, limit - 1)}…` : text;

/**
 * What the notice says, which has to name the record.
 *
 * The same rule `workflowNotice` was written for: a notice nobody can place is
 * a notice nobody can act on. The headline is the request itself for a referral
 * — there is no separate «what should they do» box — so it is clipped rather
 * than printed whole into an inbox row.
 */
export function dueNoticeBody(
  kind: DueNotice,
  record: DueRecordKind,
  subject: DueNoticeSubjectText,
): string {
  const what = WHAT[record] ?? WHAT.task;
  const lines: string[] = [];

  const headline = clip(String(subject.headline ?? "").trim());
  const who = String(subject.counterpart ?? "").trim();
  const due = day(subject.dueDateJalali);

  if (kind === "SOON") {
    lines.push(due
      ? `مهلت انجام این ${what} در تاریخ ${due} به پایان می‌رسد.`
      : `مهلت انجام این ${what} نزدیک است.`);
    if (who) lines.push(`ارجاع‌دهنده: ${who}`);
  } else if (kind === "OVERDUE") {
    lines.push(due
      ? `مهلت این ${what} در تاریخ ${due} گذشته و هنوز انجام نشده است.`
      : `مهلت این ${what} گذشته و هنوز انجام نشده است.`);
    if (who) lines.push(`مسئول: ${who}`);
  } else {
    lines.push(`تعیین مهلت این ${what} بر عهدهٔ شماست و هنوز ثبت نشده است.`);
    if (who) lines.push(`ارجاع‌دهنده: ${who}`);
  }

  if (headline) lines.push(headline);
  const project = String(subject.project ?? "").trim();
  if (project) lines.push(project);

  return lines.join("\n");
}
