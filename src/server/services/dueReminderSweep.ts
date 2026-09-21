import { getDb } from "../db";
import { getTodayShamsi } from "../../dateUtils";
import { jalaliToDate, normalizeJalali } from "../dates";
import { notifyUser } from "./notificationService";
import {
  DUE_NOTICE_MODULE, DueNotice, DueRecordKind, DueSubject,
  dueNoticeBody, dueNoticeRecipient, dueNoticeTitle, dueNoticesFor, dueScanRange,
} from "../../utils/dueReminders";
import {
  REFERRAL_DONE, openTaskWhere, referralIsOpen, taskLane,
} from "../../utils/workBoard";
import { FOLLOW_UP_KIND } from "../../utils/salesFollowUp";

/**
 * The daily pass that tells the two people on a record about its deadline.
 *
 * **Not a workflow rule, and that is the decision.** The engine can already say
 * «N days before a date this record carries», so the *mechanism* was there —
 * what it cannot say is who to tell, because the recipient here is not a module
 * owner or a named assignee token but the record's own two people: the one who
 * asked and the one who was asked. That is not configuration, it is what a
 * deadline means. `stuckWork` is the same shape one module along: the evidence
 * was on disk and what was missing was a reading of it, not a rule somebody has
 * to write first.
 *
 * It **writes no tasks and raises no messages** — three notices into the inbox
 * that already exists, and the markers that keep each of them to once.
 *
 * Bounded, and every failure is logged and skipped: a pass that stops on one
 * record leaves every record after it unreminded.
 */

/** A ceiling on one pass, not a page. */
const DUE_SCAN_LIMIT = 500;

/** What a pass did, for the manual button and the log. */
export interface DueReminderReport {
  soon: number;
  overdue: number;
  asked: number;
}

const blank = (): DueReminderReport => ({ soon: 0, overdue: 0, asked: 0 });

/* ------------------------------ the guard -------------------------------- */

let ranFor: string | null = null;
let running: Promise<DueReminderReport> | null = null;

/**
 * Runs the pass at most once per Shamsi day.
 *
 * Started, not awaited, at login — the same shape as the workflow sweep, and
 * for the same reason: this server has no cron, so the first person through the
 * door starts the day's pass, and a reminder must never hold up a sign-in.
 *
 * It is its **own** guard rather than a line inside `runDueWorkflows`, because
 * that function returns early when a company has written no scheduled rules —
 * which is most of them — and these reminders are not rules anybody wrote.
 */
export async function ensureDueRemindersRanToday(
  todayJalali = getTodayShamsi(),
): Promise<DueReminderReport> {
  if (ranFor === todayJalali) return blank();
  if (running) return running;

  running = runDueReminders(todayJalali)
    .then((report) => { ranFor = todayJalali; return report; })
    .catch((err) => {
      // `ranFor` is deliberately left alone: the next sign-in has another go.
      console.error("[due] reminder pass failed:", (err as Error)?.message || err);
      return blank();
    })
    .finally(() => { running = null; });

  return running;
}

/* ------------------------------- the pass -------------------------------- */

/**
 * Which column each notice stamps.
 *
 * The queries below cast their `where`, so a misspelling here would compile
 * cleanly and simply never claim anything — `test:rules` holds all three names
 * against `prisma/schema.prisma` for that reason.
 */
const MARKER_FIELD: Record<DueNotice, string> = {
  SOON: "dueSoonNoticeFor",
  OVERDUE: "dueOverdueNoticeFor",
  ASK: "dueAskedNoticeOn",
};

/**
 * What a claim writes into the marker.
 *
 * `SOON` and `OVERDUE` record the **deadline** they answered, so a date that
 * moves earns a fresh reminder. `ASK` has no deadline to record — that is the
 * whole state — so it records the day it went out, which reads as «already
 * asked» for ever after.
 */
function markerValue(kind: DueNotice, dueJalali: string, todayJalali: string): string {
  return kind === "ASK" ? todayJalali : dueJalali;
}

/**
 * Claims one notice, then raises it.
 *
 * The claim is a **conditional `updateMany`** and it happens first: two
 * overlapping passes then notify once between them, which is the same
 * guarantee `resolveFinishedTasks` takes from its own conditional close and
 * the campaign sender takes from its unique index. The marker is compared
 * without `not` on a nullable column — spelled out as «never, or a different
 * deadline», since SQL evaluates the negation to unknown for a NULL and would
 * drop exactly the rows that have never been reminded.
 *
 * A notice that fails after the claim is lost rather than repeated, and that is
 * the right way round: a reminder nobody reads once is a smaller fault than the
 * same reminder every morning for ever.
 */
async function claim(
  table: "task" | "projectReferral",
  id: string,
  kind: DueNotice,
  value: string,
): Promise<boolean> {
  const field = MARKER_FIELD[kind];
  const where = {
    id,
    OR: [{ [field]: null }, { [field]: { not: value } }],
  } as Record<string, unknown>;
  const data = { [field]: value } as Record<string, unknown>;

  const db = getDb();
  const result = table === "task"
    ? await db.task.updateMany({ where: where as never, data: data as never })
    : await db.projectReferral.updateMany({ where: where as never, data: data as never });
  return result.count > 0;
}

function projectLabel(
  project: { code?: string | null; name?: string | null } | null | undefined,
): string {
  const code = String(project?.code ?? "").trim();
  const name = String(project?.name ?? "").trim();
  if (code && name) return `${code} — ${name}`;
  return code || name;
}

/**
 * Fires every reminder that has come due.
 *
 * Exported so it can be driven on demand, and so `test:rules` can read it.
 */
export async function runDueReminders(
  todayJalali = getTodayShamsi(),
): Promise<DueReminderReport> {
  const today = normalizeJalali(todayJalali) ?? todayJalali;
  const report = blank();
  const band = dueScanRange(today);
  const from = jalaliToDate(band.from);
  const to = jalaliToDate(band.to);
  if (!from || !to) return report;

  const db = getDb();

  /*
   * The band, or a record still owing a deadline.
   *
   * Two shapes in one query rather than two passes: a record whose deadline the
   * assignee has not set has no date to narrow on at all, and it is exactly the
   * case the `ASK` notice exists for. The `dueAskedNoticeOn` clause keeps that
   * arm from re-reading every such record for ever once it has been asked.
   */
  const dueBand = { dueDate: { gte: from, lte: to } };
  const owesDeadline = {
    AND: [{ dueDateByAssignee: true }, { dueDate: null }, { dueAskedNoticeOn: null }],
  };

  /* --------------------------------- tasks -------------------------------- */

  /*
   * **A sales chase is never reminded about, and that is deliberate.**
   *
   * Its due date is not a promise to a colleague — it is the day to ring the
   * customer, and it is the column the board parks the card in. The card
   * arrives in «در حال انجام» on that morning by itself, the follow-up queue
   * ranks it and draws «عقب‌افتاده» on it, and the project's own tab lists it.
   * A notice beside all that would be a second, weaker copy of the health badge
   * — and several a day per salesperson about their own diary is exactly how
   * the notices that matter stop being read, the same reason a chase is never
   * texted either.
   */
  const tasks = await db.task.findMany({
    where: {
      AND: [
        openTaskWhere(),
        { taskKind: { not: FOLLOW_UP_KIND } },
        { OR: [dueBand, owesDeadline] },
      ],
    },
    orderBy: { dueDate: "asc" },
    take: DUE_SCAN_LIMIT,
    select: {
      id: true, title: true, status: true, dueDateJalali: true,
      dueDateByAssignee: true, dueSoonNoticeFor: true, dueOverdueNoticeFor: true,
      dueAskedNoticeOn: true,
      assignedToUserId: true, assignedToName: true,
      createdByUserId: true, createdByName: true,
      relatedToName: true,
    },
  });

  for (const task of tasks) {
    const subject: DueSubject = {
      dueDateJalali: task.dueDateJalali,
      dueDateByAssignee: task.dueDateByAssignee,
      dueSoonNoticeFor: task.dueSoonNoticeFor,
      dueOverdueNoticeFor: task.dueOverdueNoticeFor,
      dueAskedNoticeOn: task.dueAskedNoticeOn,
      open: taskLane(task.status) !== "DONE",
      assigneeUserId: task.assignedToUserId,
      creatorUserId: task.createdByUserId,
    };
    await raise("task", "task", task.id, subject, today, report, {
      headline: task.title,
      dueDateJalali: task.dueDateJalali,
      counterpartFor: (kind) =>
        kind === "OVERDUE" ? task.assignedToName : task.createdByName,
      // What the card already prints it is about — the job, the quotation, the
      // customer. Resolving the relation properly would be a query per task;
      // the stored label is what the person reading the notice recognises.
      project: String(task.relatedToName ?? "").trim(),
    });
  }

  /* ------------------------------- referrals ------------------------------ */

  const referrals = await db.projectReferral.findMany({
    where: {
      AND: [
        { status: { not: REFERRAL_DONE } },
        { OR: [dueBand, owesDeadline] },
      ],
    },
    orderBy: { dueDate: "asc" },
    take: DUE_SCAN_LIMIT,
    select: {
      id: true, status: true, actionRequired: true, dueDateJalali: true,
      dueDateByAssignee: true, dueSoonNoticeFor: true, dueOverdueNoticeFor: true,
      dueAskedNoticeOn: true,
      assignedToUserId: true, assignedToName: true,
      assignedByUserId: true, assignedByName: true,
      activity: {
        select: {
          group: { select: { project: { select: { code: true, name: true } } } },
        },
      },
    },
  });

  for (const referral of referrals) {
    const subject: DueSubject = {
      dueDateJalali: referral.dueDateJalali,
      dueDateByAssignee: referral.dueDateByAssignee,
      dueSoonNoticeFor: referral.dueSoonNoticeFor,
      dueOverdueNoticeFor: referral.dueOverdueNoticeFor,
      dueAskedNoticeOn: referral.dueAskedNoticeOn,
      open: referralIsOpen(referral.status),
      assigneeUserId: referral.assignedToUserId,
      creatorUserId: referral.assignedByUserId,
    };
    await raise("projectReferral", "referral", referral.id, subject, today, report, {
      headline: referral.actionRequired,
      dueDateJalali: referral.dueDateJalali,
      counterpartFor: (kind) =>
        kind === "OVERDUE" ? referral.assignedToName : referral.assignedByName,
      project: projectLabel(referral.activity?.group?.project),
    });
  }

  return report;
}

/**
 * The half both record types share: decide, claim, notify, count.
 *
 * One function rather than the block written out twice, because the two differ
 * only in which table the marker lives on and which name goes into the
 * sentence — and two copies of «claim before you notify» is how one of them
 * comes to notify first.
 */
async function raise(
  table: "task" | "projectReferral",
  record: DueRecordKind,
  id: string,
  subject: DueSubject,
  todayJalali: string,
  report: DueReminderReport,
  text: {
    headline?: string | null;
    dueDateJalali?: string | null;
    counterpartFor: (kind: DueNotice) => string | null | undefined;
    project?: string;
  },
): Promise<void> {
  for (const kind of dueNoticesFor(subject, todayJalali)) {
    const userId = dueNoticeRecipient(kind, subject);
    if (!userId) continue;
    try {
      const value = markerValue(
        kind, normalizeJalali(subject.dueDateJalali) ?? "", todayJalali,
      );
      if (!(await claim(table, id, kind, value))) continue;

      await notifyUser({
        userId,
        module: DUE_NOTICE_MODULE,
        title: dueNoticeTitle(kind, record),
        description: dueNoticeBody(kind, record, {
          headline: text.headline,
          counterpart: text.counterpartFor(kind),
          dueDateJalali: text.dueDateJalali,
          project: text.project,
        }),
      });

      if (kind === "SOON") report.soon++;
      else if (kind === "OVERDUE") report.overdue++;
      else report.asked++;
    } catch (err) {
      console.error(
        `[due] ${record} ${id} (${kind}) failed:`, (err as Error)?.message || err,
      );
    }
  }
}
