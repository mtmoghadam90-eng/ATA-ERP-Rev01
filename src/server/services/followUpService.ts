import { Prisma } from "@prisma/client";
import { getDb } from "../db";
import { AuthUser, hasPermission } from "../auth";
import { ListQuery, ListResult, buildResult, paginationArgs, searchClause } from "../listing";
import { expandDateFields, jalaliToDate } from "../dates";
import { addDaysToShamsi, getTodayShamsi, jalaliToGregorian } from "../../dateUtils";
import { toNullableString } from "../childSync";
import { getProformaOutcome, outcomeWhere, type ProformaOutcome } from "../proformaStatus";
import { afterCommit } from "../afterCommit";
import { logAction } from "./auditService";
import { ACTIVITY_CATEGORY, logProjectFact } from "./projectActivityLog";
import {
  AUTO_CLOSE_NOTE, CHASEABLE_OUTCOMES, FINISHED_TASK_STATUSES, FollowUpCompletionInput,
  FollowUpHealth, completionRefusalReason, followUpActivityText, followUpHealthOf,
  healthRank, isTerminalOutcome, normalizeFollowUpState, stateAfterDecision,
} from "../../utils/salesFollowUp";

/**
 * Chasing quotations: the server half.
 *
 * ## Why the completion is one transaction and not three requests
 *
 * Finishing a follow-up means, in the same breath: closing the task in hand,
 * recording what the customer said, moving the proforma's follow-up state, and
 * — when the person chose "next action" — raising the task that replaces it.
 * Done as separate calls from the browser, any failure after the first leaves
 * the state this whole feature exists to prevent: a quotation marked as being
 * actively followed up, with the follow-up task completed and nothing to
 * replace it. Nobody is chasing it and nothing says so.
 *
 * So it is one operation, and the write of the next task sits inside the same
 * transaction as the completion of the old one.
 *
 * ## What this service does not do
 *
 * It does not create the *first* follow-up task. That is the workflow engine's
 * job, driven by a rule the user can edit, and putting it here would make the
 * timing, the assignee and the priority uneditable code. The only tasks this
 * file creates are the continuations of a follow-up somebody is completing, and
 * the one raised when a closed follow-up is deliberately reopened.
 */

const OPEN_TASK: Prisma.TaskWhereInput = { status: { notIn: [...FINISHED_TASK_STATUSES] } };

/**
 * The quotations a follow-up queue is about, as a query.
 *
 * A document whose result is known needs no next action — that is what settled
 * means — so a won, lost or cancelled one has no business here, and asking
 * somebody to plan a next step for one is nonsense. A draft is excluded for the
 * opposite reason: it has not been sent to anybody yet.
 *
 * The catch is that the outcome is **derived** from the line statuses and
 * `isCancelled`, not stored — a fully-won proforma still has `isCancelled:
 * false` and a stored status of «ارسال شده», so filtering on columns lets every
 * won and lost quotation straight through. This is the same problem the grid's
 * status filter has, and it gets the same answer: `outcomeWhere` turns each
 * outcome into the query that finds it, and the queue is the union of the ones
 * worth chasing. `test:rules` holds this clause against `getProformaOutcome`
 * over every combination of lines rather than against a second reading of the
 * rule.
 *
 * Filtering by outcome rather than by "the sweep has run" is also what makes
 * the screen right for documents written before any of this existed: their
 * follow-ups were never closed because there were none, and they must still not
 * appear.
 */
export function chaseableWhere(): Prisma.ProformaWhereInput {
  return {
    OR: CHASEABLE_OUTCOMES.map((outcome) => outcomeWhere(outcome)).filter(
      (w): w is Record<string, unknown> => w !== null,
    ) as Prisma.ProformaWhereInput[],
  };
}

/** A technical quotation quotes no prices and is not a sales opportunity. */
const NOT_TECHNICAL: Prisma.ProformaWhereInput = { proformaType: { not: "TECHNICAL" } };

/** The proforma's derived outcome, which decides whether the sale is over. */
async function outcomeOf(
  tx: Prisma.TransactionClient,
  proformaId: string,
): Promise<ProformaOutcome> {
  const pf = await tx.proforma.findUnique({
    where: { id: proformaId },
    select: { status: true, isCancelled: true, items: { select: { status: true } } },
  });
  return getProformaOutcome((pf ?? { status: "", items: [] }) as never);
}

/**
 * Closes the unfinished sales follow-ups on one proforma.
 *
 * Used from two places that mean the same thing — the sale reached a terminal
 * outcome, or the document was superseded by a revision and cancelled — and
 * from neither of them does anybody want a task left on their list for a
 * quotation that is over.
 *
 * Scoped to `taskKind: SALES_FOLLOW_UP` on purpose: a person may well have
 * attached an ordinary task to the same proforma ("send the customer the
 * calibration certificates"), and that work does not stop being necessary
 * because the quotation was won.
 */
export async function closeFollowUpTasks(
  tx: Prisma.TransactionClient,
  proformaId: string,
  todayJalali: string,
  note: string = AUTO_CLOSE_NOTE,
): Promise<number> {
  const result = await tx.task.updateMany({
    where: {
      taskKind: "SALES_FOLLOW_UP",
      relatedToType: "proforma",
      relatedToId: proformaId,
      ...OPEN_TASK,
    },
    data: {
      status: "انجام شده",
      completionNote: note,
      ...expandDateFields({ completedAt: todayJalali }, ["completedAt"]),
    },
  });
  return result.count;
}

/* --------------------------- completing a follow-up ------------------------ */

export type CompleteOutcome =
  | { ok: true; taskId: string; nextTaskId: string | null; followUpState: string }
  | { ok: false; reason: string; code?: "not-found" | "forbidden" | "invalid" };

/**
 * Records the result of one follow-up and decides what happens next.
 *
 * The assignee of the *next* task defaults to the project's sales expert, not
 * to whoever pressed the button: a support engineer may complete a follow-up on
 * behalf of the desk, and the chase still belongs to the person selling the job.
 */
export async function completeFollowUp(
  taskId: string,
  input: FollowUpCompletionInput,
  user: AuthUser,
  todayJalali: string,
): Promise<CompleteOutcome> {
  const db = getDb();

  const task = await db.task.findUnique({ where: { id: taskId } });
  if (!task) return { ok: false, reason: "وظیفه یافت نشد.", code: "not-found" };

  // The assignee may always finish their own follow-up; anyone else needs the
  // module. Same rule the task module already applies to editing.
  if (!hasPermission(user, "tasks") && task.assignedToUserId !== user.id) {
    return { ok: false, reason: "شما اجازه دسترسی به این بخش را ندارید.", code: "forbidden" };
  }
  if (task.taskKind !== "SALES_FOLLOW_UP" || task.relatedToType !== "proforma" || !task.relatedToId) {
    return { ok: false, reason: "این وظیفه یک پیگیری فروش مرتبط با پیش‌فاکتور نیست.", code: "invalid" };
  }
  if ((FINISHED_TASK_STATUSES as readonly string[]).includes(task.status)) {
    return { ok: false, reason: "این پیگیری قبلاً بسته شده است.", code: "invalid" };
  }

  const proformaId = task.relatedToId;
  const outcome = await outcomeOf(db as unknown as Prisma.TransactionClient, proformaId);

  // The same rule the modal runs, re-run here: the form must not be able to
  // submit what the server would refuse, and the server must not trust that it
  // did not.
  const refusal = completionRefusalReason(input, {
    todayJalali,
    outcomeIsTerminal: isTerminalOutcome(outcome),
  });
  if (refusal) return { ok: false, reason: refusal, code: "invalid" };

  const proforma = await db.proforma.findUnique({
    where: { id: proformaId },
    select: {
      id: true, proformaNumber: true, projectId: true,
      project: { select: { salesExpert: true } },
    },
  });
  if (!proforma) return { ok: false, reason: "پیش‌فاکتور یافت نشد.", code: "not-found" };

  const decision = input.decision;
  const nextState = stateAfterDecision(decision);
  const followUpResult = toNullableString(input.followUpResult, 200);
  const completionNote = toNullableString(input.completionNote);

  const result = await db.$transaction(async (tx) => {
    /*
     * A conditional close, so a double-clicked button completes once.
     *
     * `updateMany` with the open-status condition is the same claim the
     * assistant's proposals use: the second attempt matches no rows and the
     * transaction below it never runs, rather than completing the task twice
     * and raising two "next actions".
     */
    const claimed = await tx.task.updateMany({
      where: { id: taskId, ...OPEN_TASK },
      data: {
        status: "انجام شده",
        followUpResult,
        completionNote,
        ...expandDateFields({ completedAt: todayJalali }, ["completedAt"]),
      },
    });
    if (claimed.count === 0) return null;

    let nextTaskId: string | null = null;

    if (decision === "NEXT_ACTION" || decision === "DEFER") {
      /*
       * The replacement, written inside the same transaction as the close.
       *
       * This is the invariant the whole operation exists for: it must be
       * impossible to end up with the old task completed, the proforma still
       * OPEN, and nothing to chase it with.
       */
      const dueDate = decision === "DEFER" ? input.deferredUntil! : input.nextDueDate!;
      const title = decision === "DEFER"
        ? `پیگیری مجدد پیش‌فاکتور ${proforma.proformaNumber}`
        : String(input.nextTitle);

      // The sales engineer of the job, not the person completing this.
      const assigneeName = toNullableString(input.nextAssignedToName, 200)
        ?? proforma.project?.salesExpert
        ?? task.assignedToName;
      const assignee = assigneeName
        ? await tx.user.findFirst({
            where: { OR: [{ fullName: assigneeName }, { username: assigneeName }] },
            select: { id: true, fullName: true },
          })
        : null;

      const next = await tx.task.create({
        data: {
          title,
          description: completionNote ?? "",
          taskKind: "SALES_FOLLOW_UP",
          relatedToType: "proforma",
          relatedToId: proformaId,
          relatedToName: proforma.proformaNumber,
          priority: task.priority,
          status: "در انتظار",
          ...expandDateFields({ dueDate }, ["dueDate"]),
          assignedToUserId: assignee?.id ?? task.assignedToUserId,
          assignedToName: assignee?.fullName ?? assigneeName ?? task.assignedToName,
        } as Prisma.TaskUncheckedCreateInput,
      });
      nextTaskId = next.id;
    }

    await tx.proforma.update({
      where: { id: proformaId },
      data: {
        followUpState: nextState,
        // Cleared unless this decision *is* the deferral: a quotation that is
        // being actively chased again must not keep a date saying it is parked.
        ...(decision === "DEFER"
          ? expandDateFields({ deferredUntil: input.deferredUntil }, ["deferredUntil"])
          : { deferredUntil: null, deferredUntilJalali: null }),
      },
    });

    return { nextTaskId };
  });

  if (!result) {
    return { ok: false, reason: "این پیگیری هم‌زمان توسط کاربر دیگری بسته شد.", code: "invalid" };
  }

  const nextDueJalali = decision === "NEXT_ACTION" ? input.nextDueDate ?? null : null;

  // The timeline and the audit entry are after-commit work: neither may fail a
  // completion that has already happened.
  await afterCommit("sales follow-up completion", async () => {
    await logAction(
      {
        action: "UPDATE",
        module: "وظایف",
        entityId: taskId,
        description: `ثبت نتیجه پیگیری پیش‌فاکتور ${proforma.proformaNumber}: ${followUpResult ?? "-"}`,
        beforeState: task,
      },
      user,
      todayJalali,
    );

    await logProjectFact(
      {
        projectId: proforma.projectId,
        categoryName: ACTIVITY_CATEGORY.PROFORMAS,
        sourceType: "PROFORMA",
        sourceId: proforma.id,
        text: followUpActivityText({
          proformaNumber: proforma.proformaNumber,
          followUpResult,
          completionNote,
          nextTitle: decision === "NEXT_ACTION" ? input.nextTitle : null,
          nextDueDateJalali: nextDueJalali,
          deferredUntilJalali: decision === "DEFER" ? input.deferredUntil ?? null : null,
          decision,
        }),
      },
      user,
      todayJalali,
    );
  });

  return {
    ok: true,
    taskId,
    nextTaskId: result.nextTaskId,
    followUpState: nextState,
  };
}

/* ------------------------------- reactivation ------------------------------ */

export interface ReactivateInput {
  title?: string | null;
  dueDate?: string | null;
  assignedToName?: string | null;
}

/**
 * Puts an abandoned quotation back on somebody's list.
 *
 * Deliberately requires a task. Flipping the state back to OPEN on its own
 * would produce exactly the situation the health check counts as a fault —
 * actively followed up, with nothing planned — so reactivation *is* the
 * creation of the next follow-up, and the state follows from it.
 */
export async function reactivateFollowUp(
  proformaId: string,
  input: ReactivateInput,
  user: AuthUser,
  todayJalali: string,
): Promise<CompleteOutcome> {
  if (!hasPermission(user, "proformas")) {
    return { ok: false, reason: "شما اجازه دسترسی به این بخش را ندارید.", code: "forbidden" };
  }

  const db = getDb();
  const proforma = await db.proforma.findUnique({
    where: { id: proformaId },
    select: {
      id: true, proformaNumber: true, projectId: true,
      // Both halves of the outcome rule: a settled quotation gets no next action.
      status: true, isCancelled: true, items: { select: { status: true } },
      project: { select: { salesExpert: true } },
    },
  });
  if (!proforma) return { ok: false, reason: "پیش‌فاکتور یافت نشد.", code: "not-found" };

  /*
   * A quotation whose result is known needs nobody chasing it.
   *
   * The screen does not offer the button for these — they are filtered out of
   * the queue entirely — but the endpoint is the authority: a page left open
   * while somebody else marked the document won must not be able to raise a
   * follow-up on a finished sale.
   */
  if (isTerminalOutcome(getProformaOutcome(proforma as never))) {
    return {
      ok: false,
      code: "invalid",
      reason: "تکلیف این پیش‌فاکتور مشخص شده است و نیازی به اقدام بعدی ندارد.",
    };
  }

  const dueDate = toNullableString(input.dueDate, 10);
  if (!dueDate) return { ok: false, reason: "تاریخ اقدام بعدی الزامی است.", code: "invalid" };

  const title = toNullableString(input.title, 400)
    ?? `پیگیری مجدد پیش‌فاکتور ${proforma.proformaNumber}`;
  const assigneeName = toNullableString(input.assignedToName, 200)
    ?? proforma.project?.salesExpert
    ?? null;

  const created = await db.$transaction(async (tx) => {
    // Nothing to reactivate if somebody already did: the queue would then show
    // two open follow-ups on one quotation.
    const open = await tx.task.findFirst({
      where: {
        taskKind: "SALES_FOLLOW_UP", relatedToType: "proforma",
        relatedToId: proformaId, ...OPEN_TASK,
      },
      select: { id: true },
    });
    if (open) return null;

    const assignee = assigneeName
      ? await tx.user.findFirst({
          where: { OR: [{ fullName: assigneeName }, { username: assigneeName }] },
          select: { id: true, fullName: true },
        })
      : null;

    const task = await tx.task.create({
      data: {
        title,
        taskKind: "SALES_FOLLOW_UP",
        relatedToType: "proforma",
        relatedToId: proformaId,
        relatedToName: proforma.proformaNumber,
        priority: "متوسط",
        status: "در انتظار",
        ...expandDateFields({ dueDate }, ["dueDate"]),
        assignedToUserId: assignee?.id ?? null,
        assignedToName: assignee?.fullName ?? assigneeName,
      } as Prisma.TaskUncheckedCreateInput,
    });

    await tx.proforma.update({
      where: { id: proformaId },
      data: { followUpState: "OPEN", deferredUntil: null, deferredUntilJalali: null },
    });

    return task;
  });

  if (!created) {
    return { ok: false, reason: "برای این پیش‌فاکتور یک پیگیری باز وجود دارد.", code: "invalid" };
  }

  await afterCommit("sales follow-up reactivation", async () => {
    await logProjectFact(
      {
        projectId: proforma.projectId,
        categoryName: ACTIVITY_CATEGORY.PROFORMAS,
        sourceType: "PROFORMA",
        sourceId: proforma.id,
        text: `پیگیری پیش‌فاکتور ${proforma.proformaNumber} دوباره فعال شد؛ اقدام بعدی: ${title} در ${dueDate}`,
      },
      user,
      todayJalali,
    );
  });

  return { ok: true, taskId: created.id, nextTaskId: created.id, followUpState: "OPEN" };
}

/* --------------------------------- the queue ------------------------------- */

/**
 * How much of the queue the ranking is computed over.
 *
 * The rank comes from the open follow-up task, so it cannot be an `orderBy` —
 * the whole matched set has to be read to order it. Bounded because "read
 * everything" is how a screen becomes slow silently, and flagged because a
 * silently dropped row is worse than a slow one.
 */
const QUEUE_SCAN_LIMIT = 500;

export const FOLLOW_UP_SORTABLE = ["sentDate", "issueDate", "finalAmount"] as const;
export const FOLLOW_UP_FILTERABLE = ["followUpState", "projectId", "customerId"] as const;

export interface FollowUpQueueRow {
  id: string;
  proformaNumber: string;
  customerId: string;
  customerName: string | null;
  projectId: string | null;
  projectCode: string | null;
  projectName: string | null;
  salesExpert: string | null;
  expectedCloseDateJalali: string | null;
  finalAmount: string;
  currency: string;
  status: string;
  outcome: ProformaOutcome;
  sentDateJalali: string | null;
  issueDateJalali: string | null;
  /** Days since the quotation went out — the age of the quote. */
  ageDays: number | null;
  followUpState: string;
  deferredUntilJalali: string | null;
  /** From the open follow-up task, which is the only source of these. */
  nextAction: string | null;
  nextActionDueDateJalali: string | null;
  nextActionAssignee: string | null;
  nextActionTaskId: string | null;
  lastFollowUpDateJalali: string | null;
  lastFollowUpResult: string | null;
  followUpHealth: FollowUpHealth;
}

export interface FollowUpSummary {
  dueToday: number;
  overdue: number;
  openWithoutNextAction: number;
  deferred: number;
  noResponse: number;
  openTotal: number;
  /** Optional health signal: sent more than a fortnight ago and still open. */
  olderThan14Days: number;
}

/**
 * Which quotations are in the queue at all.
 *
 * A document still in draft has not been sent to anybody, so there is nothing
 * to chase; a cancelled one, and one whose sale is over, are handled by the
 * outcome machinery and their follow-ups are closed automatically. What remains
 * is the set a sales desk actually works: sent, not cancelled, not finished.
 */
function queueWhere(q: ListQuery): Prisma.ProformaWhereInput {
  const and: Prisma.ProformaWhereInput[] = [chaseableWhere(), NOT_TECHNICAL];

  // The number, the customer and the job — which is how a salesperson refers to
  // a quotation. The document's own columns carry none of the last two.
  if (q.search) {
    const byNumber = (searchClause(q.search, ["proformaNumber"])?.OR ?? []) as Prisma.ProformaWhereInput[];
    and.push({
      OR: [
        ...byNumber,
        { customer: { is: { companyName: { contains: q.search } } } },
        { project: { is: { name: { contains: q.search } } } },
        { project: { is: { code: { contains: q.search } } } },
      ],
    });
  }

  if (q.filters.followUpState) and.push({ followUpState: q.filters.followUpState });
  if (q.filters.projectId) and.push({ projectId: q.filters.projectId });
  if (q.filters.customerId) and.push({ customerId: q.filters.customerId });

  return { AND: and };
}

const QUEUE_SELECT = {
  id: true, proformaNumber: true, status: true, isCancelled: true, currency: true,
  finalAmount: true, followUpState: true, deferredUntilJalali: true,
  issueDateJalali: true, sentDateJalali: true, customerId: true, projectId: true,
  customer: { select: { companyName: true } },
  project: { select: { code: true, name: true, salesExpert: true, expectedCloseDateJalali: true } },
  items: { select: { status: true } },
} satisfies Prisma.ProformaSelect;

/**
 * The queue, assembled on the server.
 *
 * Two reads, never one per row: the page of quotations, then **one** query for
 * every follow-up task belonging to that page. Joining these in the browser
 * would mean fetching every proforma and every task to answer a question about
 * twenty-five rows, which is the shape this codebase has spent the whole
 * migration removing.
 *
 * Nothing derived here is stored. `ageDays`, the next action and its date, the
 * last result and the health are all read back from the task and the proforma
 * every time, because a stored copy is a copy to keep in step.
 */
export async function listFollowUpQueue(
  q: ListQuery,
  user: AuthUser,
  extra: { health?: unknown } = {},
): Promise<
  | (ListResult<FollowUpQueueRow> & { summary: FollowUpSummary; truncated: boolean })
  | null
> {
  if (!hasPermission(user, "proformas")) return null;

  const db = getDb();
  const where = queueWhere(q);
  const todayJalali = getTodayShamsi();

  /*
   * The whole chaseable set, then sorted, then paged — in that order.
   *
   * It used to page first and sort the page afterwards, which quietly defeated
   * the screen: the rank is «عقب‌افتاده» before «امروز» before «بدون اقدام
   * بعدی», and that ordering only held *within* whichever twenty-five documents
   * happened to be the most recent. An overdue quotation from six months ago
   * sat on page three of a list whose entire purpose is to put it first. Worse,
   * filtering by a KPI card filtered the page while the counter still reported
   * the unfiltered total, so the header said one number and the table showed
   * another — which reads exactly like a missing record.
   *
   * The rank is derived from the open follow-up task, so no database can sort
   * by it. Bounded and flagged rather than unbounded, the same shape as the
   * supplier price history: the work happens on the server, with a limit, and
   * says when it hit it.
   */
  const candidates = await db.proforma.findMany({
    where,
    orderBy: { sentDate: "desc" },
    take: QUEUE_SCAN_LIMIT,
    select: QUEUE_SELECT,
  });
  const truncated = candidates.length === QUEUE_SCAN_LIMIT;

  const rows = candidates;
  const ids = rows.map((r) => r.id);
  const tasks = ids.length
    ? await db.task.findMany({
        where: { taskKind: "SALES_FOLLOW_UP", relatedToType: "proforma", relatedToId: { in: ids } },
        select: {
          id: true, relatedToId: true, title: true, status: true,
          dueDateJalali: true, assignedToName: true,
          followUpResult: true, completedAtJalali: true,
        },
        orderBy: { createdAt: "asc" },
      })
    : [];

  const open = new Map<string, (typeof tasks)[number]>();
  const last = new Map<string, (typeof tasks)[number]>();
  for (const t of tasks) {
    const key = t.relatedToId!;
    if ((FINISHED_TASK_STATUSES as readonly string[]).includes(t.status)) {
      // The most recent completion wins; the list is in creation order.
      last.set(key, t);
    } else if (!open.has(key)) {
      open.set(key, t);
    }
  }

  const built = rows.map((row) => {
    const openTask = open.get(row.id) ?? null;
    const lastTask = last.get(row.id) ?? null;
    const followUpState = normalizeFollowUpState(row.followUpState);
    const health = followUpHealthOf(
      {
        followUpState,
        nextActionDueDateJalali: openTask?.dueDateJalali ?? null,
        hasOpenFollowUpTask: !!openTask,
        deferredUntilJalali: row.deferredUntilJalali,
      },
      todayJalali,
    );

    return {
      id: row.id,
      proformaNumber: row.proformaNumber,
      customerId: row.customerId,
      customerName: row.customer?.companyName ?? null,
      projectId: row.projectId,
      projectCode: row.project?.code ?? null,
      projectName: row.project?.name ?? null,
      salesExpert: row.project?.salesExpert ?? null,
      expectedCloseDateJalali: row.project?.expectedCloseDateJalali ?? null,
      finalAmount: String(row.finalAmount),
      currency: row.currency,
      status: row.status,
      outcome: getProformaOutcome(row as never),
      sentDateJalali: row.sentDateJalali,
      issueDateJalali: row.issueDateJalali,
      ageDays: quoteAgeDays(row.sentDateJalali ?? row.issueDateJalali, todayJalali),
      followUpState,
      deferredUntilJalali: row.deferredUntilJalali,
      nextAction: openTask?.title ?? null,
      nextActionDueDateJalali: openTask?.dueDateJalali ?? null,
      nextActionAssignee: openTask?.assignedToName ?? row.project?.salesExpert ?? null,
      nextActionTaskId: openTask?.id ?? null,
      lastFollowUpDateJalali: lastTask?.completedAtJalali ?? null,
      lastFollowUpResult: lastTask?.followUpResult ?? null,
      followUpHealth: health,
    } satisfies FollowUpQueueRow;
  });

  /*
   * Operational order, not date order.
   *
   * The person opening this screen wants to know what to do now, so the rank is
   * the health: overdue, then due today, then the ones with no next step at
   * all, then what is coming, then what has been parked. Within a band the
   * earliest due date leads.
   */
  const filtered = typeof extra.health === "string" && extra.health && extra.health !== "all"
    ? built.filter((r) => r.followUpHealth === extra.health)
    : built;

  filtered.sort((a, b) => {
    const rank = healthRank(a.followUpHealth) - healthRank(b.followUpHealth);
    if (rank !== 0) return rank;
    const da = a.nextActionDueDateJalali ?? "9999/99/99";
    const dbb = b.nextActionDueDateJalali ?? "9999/99/99";
    if (da !== dbb) return da < dbb ? -1 : 1;
    return (a.sentDateJalali ?? "") < (b.sentDateJalali ?? "") ? -1 : 1;
  });

  // Paged after the ranking, and counted after the filter, so the header and
  // the table are describing the same set.
  const { skip, take } = paginationArgs(q);
  const page = filtered.slice(skip, skip + take);

  return {
    ...buildResult(page, filtered.length, q),
    truncated,
    summary: await followUpSummary(user, todayJalali),
  };
}

/** Whole days between two Jalali dates, counted through the Gregorian pair. */
function quoteAgeDays(fromJalali: string | null, todayJalali: string): number | null {
  const parse = (s: string | null) => {
    const [y, m, d] = String(s ?? "").split("/").map(Number);
    if (!y || !m || !d) return null;
    const [gy, gm, gd] = jalaliToGregorian(y, m, d);
    // UTC throughout: a Date built from local midnight serialises as the
    // previous day on this UTC+03:30 host — see src/server/dates.ts.
    return Date.UTC(gy, gm - 1, gd);
  };
  const from = parse(fromJalali);
  const today = parse(todayJalali);
  if (from === null || today === null) return null;
  return Math.max(0, Math.round((today - from) / 86_400_000));
}

/**
 * The KPI counts, over every match rather than the page.
 *
 * Counted with `count` queries rather than by summing the page: a figure that
 * changes when you turn the page is not a figure anybody can act on. The two
 * that need the task table are expressed as relation filters so they stay one
 * round trip each.
 */
export async function followUpSummary(
  user: AuthUser,
  todayJalali: string,
): Promise<FollowUpSummary> {
  if (!hasPermission(user, "proformas")) {
    return {
      dueToday: 0, overdue: 0, openWithoutNextAction: 0,
      deferred: 0, noResponse: 0, openTotal: 0, olderThan14Days: 0,
    };
  }

  const db = getDb();
  const today = jalaliToDate(todayJalali);
  const fortnightAgo = jalaliToDate(addDaysToShamsi(todayJalali, -14));

  // The same set the list shows, or the cards count quotations the table below
  // them does not contain — and «بدون اقدام بعدی» would report every settled
  // document in the database as neglected.
  const active: Prisma.ProformaWhereInput = { AND: [chaseableWhere(), NOT_TECHNICAL] };

  /*
   * The task side is asked of the task table, not through a relation.
   *
   * `Task.relatedToId` is a plain column rather than a foreign key — the table
   * serves five kinds of record — so there is no Prisma relation to filter
   * through and no join to lean on. The ids of the quotations currently being
   * chased are read once and the task questions are asked against that set.
   */
  const openProformas = await db.proforma.findMany({
    where: { ...active, followUpState: "OPEN" },
    select: { id: true },
  });
  const openIds = openProformas.map((r) => r.id);

  const openFollowUp = {
    taskKind: "SALES_FOLLOW_UP",
    relatedToType: "proforma",
    status: { notIn: [...FINISHED_TASK_STATUSES] },
  } satisfies Prisma.TaskWhereInput;
  const inOpenQueue = { relatedToId: { in: openIds } };

  const [dueToday, overdue, deferred, noResponse, olderThan14Days, chased] = await Promise.all([
    openIds.length
      ? db.task.count({ where: { ...openFollowUp, ...inOpenQueue, dueDate: today } })
      : Promise.resolve(0),
    openIds.length
      ? db.task.count({ where: { ...openFollowUp, ...inOpenQueue, dueDate: { lt: today } } })
      : Promise.resolve(0),
    db.proforma.count({ where: { ...active, followUpState: "DEFERRED" } }),
    db.proforma.count({ where: { ...active, followUpState: "NO_RESPONSE" } }),
    db.proforma.count({
      where: { ...active, followUpState: "OPEN", sentDate: { lt: fortnightAgo } },
    }),
    // Distinct quotations that have somebody on them: one row per proforma,
    // however many follow-ups it has collected.
    openIds.length
      ? db.task.findMany({
          where: { ...openFollowUp, ...inOpenQueue },
          select: { relatedToId: true },
          distinct: ["relatedToId"],
        })
      : Promise.resolve([] as { relatedToId: string | null }[]),
  ]);

  return {
    dueToday,
    overdue,
    // The health check with a target of zero: actively followed up, nothing
    // planned. Deferred and abandoned quotations are excluded because both are
    // decisions somebody made, and counting them as neglect would make the
    // figure impossible to drive to zero and therefore worth ignoring.
    openWithoutNextAction: Math.max(0, openIds.length - chased.length),
    deferred,
    noResponse,
    openTotal: openIds.length,
    olderThan14Days,
  };
}
