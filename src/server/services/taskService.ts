import { Prisma } from "@prisma/client";
import { getDb } from "../db";
import { ListQuery, ListResult, buildResult, paginationArgs, searchClause } from "../listing";
import { AuthUser, canSeeAllTasks } from "../auth";
import { taskRelationKind } from "../../utils/taskRelations";
import { resolveAssignee } from "./assigneeLookup";
import {
  BoardLane, LANE_FILTERS, MovableLane, TASK_CANCELLED, TASK_DOING, TASK_DONE, TASK_TODO,
  laneWhere, onPlateWhere, taskBoardLane, taskLane, taskStatusForLane,
  isParkedKind,
} from "../../utils/workBoard";
import { FOLLOW_UP_KIND, deferralAfterChaseMoved } from "../../utils/salesFollowUp";
import { capacityRefusalMessage } from "../../utils/workLimits";
import {
  ReminderFacts, dueReminderAt, normalizeRepeat,
} from "../../utils/reminderRepeat";
import { capacityByUser } from "./workLoadService";
import { expandDateFields, jalaliRangeFilter, jalaliToDate } from "../dates";
import { toJsonColumn, toNullableString } from "../childSync";
import { notifyModuleResponsible } from "./notificationService";
import { logAction } from "./auditService";
import { processWorkflowRules } from "./workflowService";
import { notifyStaffBySms } from "./staffNotifications";
import { afterCommit } from "../afterCommit";

/**
 * Task data access.
 *
 * Tasks are assigned to a person, so the record-level scope here is assignment:
 * a user without the module permission sees the tasks assigned to them, which is
 * the whole point of the module for that user.
 */

export const TASK_SORTABLE = ["title", "priority", "status", "dueDate", "createdAt", "updatedAt"] as const;
export const TASK_FILTERABLE = ["status", "priority", "assignedToUserId", "relatedToType"] as const;

const SEARCH_FIELDS = ["title", "description", "relatedToName", "assignedToName"] as const;

export const TASK_DATE_FIELDS = ["dueDate", "reminderDate"] as const;

/** Which half of the board is being asked for. */
export type TaskScope = "toMe" | "fromMe" | "all";

/**
 * What a board move did, and why the rest of it did not happen.
 *
 * The reasons are a **set of sentences**, not a count: three cards can be
 * refused for three different rules — a follow-up dragged into «انجام شده», a
 * chase pushed into «برای انجام», an assignee already at their limit — and one
 * hardcoded message on the screen could only ever describe the first of them,
 * which reads as the board being broken for the other two.
 */
export interface MoveOutcome {
  moved: number;
  refused: number;
  reasons: string[];
}

/**
 * The rows this user may see at all.
 *
 * It used to be «no restriction for anybody holding the `tasks` permission»,
 * and `hasPermission` reads an absent key as granted — so since every account
 * has the tasks module (everybody needs to see their own work), every account
 * saw every task in the company. The only way to get privacy was to be *denied*
 * the module, which is backwards: denying it was meant to hide the screen.
 *
 * A task now belongs to two people: the one it was given to, and the one who
 * gave it. Scoping to the assignee alone would be worse than the fault — a task
 * you raised for a colleague would vanish from your own board with no column to
 * find it by, which is why `createdByUserId` was added alongside this.
 *
 * `canSeeAllTasks` is read strictly, so nobody is quietly granted the whole
 * company by a permissions object written before the flag existed.
 */
export function visibilityClause(user: AuthUser): Record<string, unknown> | undefined {
  if (canSeeAllTasks(user)) return undefined;
  return { OR: [{ assignedToUserId: user.id }, { createdByUserId: user.id }] };
}

/**
 * The tab, narrowed within what the user may see.
 *
 * Deliberately *on top of* `visibilityClause` rather than instead of it: a tab
 * is a convenience and must never be the thing that enforces the scope, or a
 * client that omits it sees everything.
 */
export function scopeClause(
  user: AuthUser,
  scope: TaskScope | undefined,
): Record<string, unknown> | undefined {
  if (scope === "toMe") return { assignedToUserId: user.id };
  if (scope === "fromMe") return { createdByUserId: user.id };
  return undefined;
}

/**
 * How many related records one search term may pull in.
 *
 * A bound rather than a page: the ids go into an `IN (…)` list, and a term like
 * «ا» would otherwise name every project in the company. Generous enough that a
 * real search — a code, a customer, a few words of a job name — is never
 * truncated in practice.
 */
const RELATED_SCAN_LIMIT = 500;

/**
 * The records a search term names, for the polymorphic `relatedToId`.
 *
 * A task points at a project, a quotation or a customer through
 * `relatedToType`/`relatedToId`, which is not a relation — so Prisma cannot
 * filter through it and the ids have to be found first. Three cheap reads, and
 * only when there is something to search for.
 *
 * What this makes findable, and could not be before: a **project code**, a
 * project **name**, and the **customer** behind either — none of which is on
 * the task's own row. `relatedToName` is one string the browser resolved out of
 * a picker at save time, so searching a job code found a task only if somebody
 * happened to have typed the code into that field.
 *
 * A quotation is reached two ways, because both are what people type: its own
 * number, and the code or name of the job it belongs to.
 */
export async function relatedIdsForSearch(term: string): Promise<string[]> {
  const trimmed = String(term ?? "").trim();
  if (!trimmed) return [];

  const db = getDb();
  /*
   * Every match goes through `searchClause`, never a bare `contains`.
   *
   * SQL Server's collation treats ی/ي, ک/ك and the two digit sets as different
   * characters, so a hand-written `contains` silently misses rows a user can
   * see on the screen in front of them.
   */
  const projectMatch = searchClause(trimmed, ["code", "name"]);
  const customerMatch = searchClause(trimmed, ["companyName"]);
  const proformaMatch = searchClause(trimmed, ["proformaNumber"]);
  if (!projectMatch || !customerMatch || !proformaMatch) return [];

  const [customers, projects] = await Promise.all([
    db.customer.findMany({
      where: customerMatch, select: { id: true }, take: RELATED_SCAN_LIMIT,
    }),
    db.project.findMany({
      // The job itself, or the customer it belongs to — «تسک‌های پتروشیمی فلان»
      // is a search for the customer, and the project carries the foreign key.
      where: { OR: [projectMatch, { customer: customerMatch }] },
      select: { id: true },
      take: RELATED_SCAN_LIMIT,
    }),
  ]);

  const projectIds = projects.map((p) => p.id);
  const proformas = await db.proforma.findMany({
    where: {
      OR: [
        proformaMatch,
        ...(projectIds.length > 0 ? [{ projectId: { in: projectIds } }] : []),
      ],
    },
    select: { id: true },
    take: RELATED_SCAN_LIMIT,
  });

  return [...new Set([
    ...projectIds,
    ...proformas.map((p) => p.id),
    ...customers.map((c) => c.id),
  ])];
}

export function buildTaskWhere(
  q: ListQuery,
  user: AuthUser,
  extra: {
    dateFrom?: unknown;
    dateTo?: unknown;
    overdue?: unknown;
    relatedToId?: unknown;
    scope?: TaskScope;
    /** «انجام‌شده‌ها را پنهان کن» — the board's declutter toggle. */
    hideCompleted?: unknown;
    /** One of `BOARD_LANES`, or «CANCELLED». See `laneWhere`. */
    lane?: unknown;
    /**
     * Today, in Shamsi.
     *
     * «در انتظار مشتری» is a date comparison rather than a status word — a
     * chase is parked until the day it is due — so the column filter cannot be
     * built without it. Absent, that column answers with nothing and «در حال
     * انجام» answers with every open chase, which is the safe direction: a
     * call that is due must never be the one that disappears.
     */
    today?: unknown;
    /**
     * Records whose own fields match the search term — a project by code, name
     * or customer, a proforma on such a project, a customer by name.
     *
     * Resolved by `relatedIdsForSearch` before the clause is built, because the
     * link they are matched against is polymorphic and Prisma has no relation
     * to filter through.
     */
    relatedIds?: string[];
  } = {},
): Record<string, unknown> {
  const and: Record<string, unknown>[] = [];

  const visibility = visibilityClause(user);
  if (visibility) and.push(visibility);

  const scoped = scopeClause(user, extra.scope);
  if (scoped) and.push(scoped);

  /*
   * The task's own columns, plus the records it points at.
   *
   * `relatedToName` is one string the browser resolved out of a picker at save
   * time, so searching «ATA-1404-012» found a task only if somebody happened to
   * have typed the code into that field — and the project's *customer* was not
   * reachable at all. `relatedToType`/`relatedToId` is a polymorphic link with
   * no relation for Prisma to filter through, so the ids are resolved first
   * (`relatedIdsForSearch`) and offered to the clause here.
   */
  const search = searchClause(q.search, SEARCH_FIELDS);
  const relatedIds = extra.relatedIds ?? [];
  if (search && relatedIds.length > 0) {
    and.push({ OR: [...search.OR, { relatedToId: { in: relatedIds } }] });
  } else if (search) {
    and.push(search);
  }

  for (const [field, value] of Object.entries(q.filters)) {
    and.push({ [field]: value });
  }

  if (typeof extra.relatedToId === "string" && extra.relatedToId) {
    and.push({ relatedToId: extra.relatedToId });
  }

  const range = jalaliRangeFilter(extra.dateFrom, extra.dateTo);
  if (range) and.push({ dueDate: range });

  // "Past due and still open" — a date comparison, so it belongs in the query;
  // filtering after the page is fetched would make the totals describe the page.
  if (typeof extra.overdue === "string" && extra.overdue) {
    const today = jalaliToDate(extra.overdue);
    if (today) and.push({ dueDate: { lt: today }, status: { not: "انجام شده" } });
  }

  /*
   * Which column, as a clause on the status.
   *
   * **Not an exact match on the status**, which is what this used to be. Every
   * automation raises its task as «در انتظار» — a fourth value no screen has
   * ever offered — so asking for the literal «در حال انجام» answered with
   * nothing at all for a board full of them. `laneWhere` writes the middle
   * column as an exclusion, agreeing with `taskLane`'s own fallback: a status
   * nobody anticipated is open work, and open work must never be unfindable.
   */
  /*
   * **Normalised, not merely read.** The screen sends the literal «all» when no
   * column is chosen, and this took any non-empty string as a choice — so
   * `Boolean("all")` was true, and the «hide completed» toggle below, which
   * stands down for an explicit choice, stood down permanently. Anything that
   * is not one of the four is no choice at all, which is also what an
   * integration sending a value nobody defined should get.
   */
  const requested = typeof extra.lane === "string" ? extra.lane : "";
  const lane = (LANE_FILTERS as readonly string[]).includes(requested) ? requested : "";

  if (lane === "CANCELLED") and.push({ status: TASK_CANCELLED });
  else if (lane) {
    const today = typeof extra.today === "string" ? jalaliToDate(extra.today) : null;
    and.push(laneWhere(lane as BoardLane, today));
  }

  /*
   * The board's «hide completed» toggle.
   *
   * A query filter and not a `.filter()` over the page: the list is paged on
   * the server, so hiding rows after they arrive would empty a page of twenty
   * done tasks and report the unfiltered total beside it.
   *
   * It hides the **whole last column**, cancelled work included: that column is
   * what «انجام‌شده‌ها» means on this screen, and leaving the cancelled ones
   * behind would be a button that half works.
   *
   * An explicit column choice wins. Somebody who has picked «انجام شده» is
   * asking for exactly the thing the toggle hides, and honouring both would
   * answer with nothing and explain nothing.
   */
  const hasExplicitLane = Boolean(lane) || Boolean(q.filters.status);
  if (extra.hideCompleted === true && !hasExplicitLane) {
    and.push({ status: { notIn: [TASK_DONE, TASK_CANCELLED] } });
  }

  /*
    The reminder filter used to live here as an exact `date = X AND time = Y`
    match, which is why a reminder was only ever seen inside its own minute.
    Reminders are read by `listDueReminders` now: a repeating one is derived from
    its anchor, which no SQL clause over a Shamsi calendar can express.
  */

  return and.length === 0 ? {} : { AND: and };
}

const LIST_SELECT = {
  id: true, title: true, description: true, priority: true, status: true,
  createdByUserId: true, createdByName: true,
  relatedToType: true, relatedToId: true, relatedToName: true,
  dueDate: true, dueDateJalali: true,
  assignedToUserId: true, assignedToName: true,
  reminderEnabled: true, reminderDateJalali: true, reminderTime: true,
  reminderRepeat: true, reminderAnchor: true,
  reminderRepeatUntilJalali: true, reminderAckedFor: true,
  createdAt: true,
  // What kind of work it is, and — for a sales follow-up — what came of it.
  // The card needs the kind to send the user to the follow-up flow rather than
  // offering the ordinary tick, which is refused for these.
  taskKind: true,
  followUpResult: true,
  completionNote: true,
  completedAtJalali: true,
  // When the work was picked up and when it closed — the board's own record,
  // printed on the card so a column can be read as a history and not only as a
  // pile.
  startedAtJalali: true,
  // The task card draws a custom-fields block from these.
  customValues: true,
} satisfies Prisma.TaskSelect;

export async function listTasks(
  q: ListQuery,
  user: AuthUser,
  extra: {
    dateFrom?: unknown;
    dateTo?: unknown;
    overdue?: unknown;
    relatedToId?: unknown;
    scope?: TaskScope;
    /** «انجام‌شده‌ها را پنهان کن» — the board's declutter toggle. */
    hideCompleted?: unknown;
    /** One of `BOARD_LANES`, or «CANCELLED». See `laneWhere`. */
    lane?: unknown;
    /** Today, in Shamsi — what «در انتظار مشتری» is measured against. */
    today?: unknown;
  } = {},
): Promise<ListResult<Record<string, unknown>>> {
  const db = getDb();
  // The projects, quotations and customers the term names, so a search for a
  // job code or a customer finds the tasks attached to them.
  const relatedIds = await relatedIdsForSearch(q.search);
  const where = buildTaskWhere(q, user, { ...extra, relatedIds });
  const orderBy = q.sort ? { [q.sort]: q.order } : [{ dueDate: "asc" as const }, { createdAt: "desc" as const }];

  const [rows, total] = await Promise.all([
    db.task.findMany({ where, orderBy, select: LIST_SELECT, ...paginationArgs(q) }),
    db.task.count({ where }),
  ]);

  return buildResult(
    await withProjectContext(rows) as unknown as Record<string, unknown>[], total, q);
}

/** The job a task belongs to, as the card prints it. */
export interface TaskProjectContext {
  id: string;
  code: string;
  name: string;
  customerName: string | null;
}

/**
 * The project behind each task on the page, and the customer behind that.
 *
 * `relatedToType`/`relatedToId` is a polymorphic link, so there is no relation
 * for Prisma to join — and `relatedToName` is a single string the *browser*
 * resolved out of a picker's current matches at save time, which is how a task
 * comes to be labelled with a name that has since changed or was never found.
 *
 * So the ids on the page are resolved here, in two bounded queries: a task on a
 * project reads that project, and a task on a proforma reads the proforma's
 * project — a sales follow-up names a quotation, and the person looking at
 * their list wants to know whose job it is.
 */
async function withProjectContext<T extends {
  relatedToType?: string | null;
  relatedToId?: string | null;
}>(rows: T[]): Promise<(T & { relatedProject: TaskProjectContext | null })[]> {
  const db = getDb();
  const projectIds = new Set<string>();
  const proformaIds = new Set<string>();

  const customerIds = new Set<string>();

  /*
   * `taskRelationKind` reads both spellings.
   *
   * This loop used to compare against the Persian words alone, and every
   * automated writer stores a Latin key — so each sales follow-up
   * (`"proforma"`), and everything the workflow engine, the milestone
   * automation and the assistant raise (`"project"`), came back with no project
   * and no customer on the card at all. That is most of what is on this board.
   */
  for (const row of rows) {
    if (!row.relatedToId) continue;
    const kind = taskRelationKind(row.relatedToType);
    if (kind === "project") projectIds.add(row.relatedToId);
    else if (kind === "proforma") proformaIds.add(row.relatedToId);
    else if (kind === "customer") customerIds.add(row.relatedToId);
  }
  if (projectIds.size === 0 && proformaIds.size === 0 && customerIds.size === 0) {
    return rows.map((row) => ({ ...row, relatedProject: null }));
  }

  const projectSelect = {
    id: true, code: true, name: true,
    customer: { select: { companyName: true } },
  };

  const [projects, proformas, customers] = await Promise.all([
    projectIds.size > 0
      ? db.project.findMany({ where: { id: { in: [...projectIds] } }, select: projectSelect })
      : Promise.resolve([]),
    proformaIds.size > 0
      ? db.proforma.findMany({
          where: { id: { in: [...proformaIds] } },
          select: { id: true, project: { select: projectSelect } },
        })
      : Promise.resolve([]),
    // A task on a customer has no project, but the name is exactly what the
    // person reading their list wants — so it is read and shown on its own.
    customerIds.size > 0
      ? db.customer.findMany({
          where: { id: { in: [...customerIds] } },
          select: { id: true, companyName: true },
        })
      : Promise.resolve([]),
  ]);

  const toContext = (p: {
    id: string; code: string; name: string; customer: { companyName: string } | null;
  }): TaskProjectContext => ({
    id: p.id, code: p.code, name: p.name,
    customerName: p.customer?.companyName ?? null,
  });

  const byProject = new Map(projects.map((p) => [p.id, toContext(p)]));
  const byProforma = new Map(
    proformas.filter((pf) => pf.project).map((pf) => [pf.id, toContext(pf.project!)]));
  /*
   * A customer with no project behind it. `code` and `name` are empty rather
   * than filled with the customer's own name: the card prints them as the
   * project, and a customer standing in for one would read as a project that
   * does not exist.
   */
  const byCustomer = new Map(customers.map((c) => [c.id, {
    id: c.id, code: "", name: "", customerName: c.companyName,
  } as TaskProjectContext]));

  return rows.map((row) => {
    const kind = row.relatedToId ? taskRelationKind(row.relatedToType) : null;
    const source = kind === "project" ? byProject
      : kind === "proforma" ? byProforma
        : kind === "customer" ? byCustomer
          : null;
    return {
      ...row,
      relatedProject: source?.get(row.relatedToId!) ?? null,
    };
  });
}

export async function getTask(id: string, user: AuthUser) {
  const db = getDb();
  const visibility = visibilityClause(user);
  return db.task.findFirst({ where: visibility ? { AND: [{ id }, visibility] } : { id } });
}

/**
 * Open, overdue and due-today counts, aggregated in SQL.
 *
 * **`scope` is what separates «چقدر کار روی دستم مانده» from «چه چیزهایی به من
 * مربوط است».** `visibilityClause` alone answers the second: a task belongs to
 * two people, the one it was given to *and* the one who gave it, so counting
 * through it alone put every request this user had raised **for somebody else**
 * into their own badge. Reported as the inbox counting other people's work, and
 * it was. Passing `toMe` narrows it to the assignee, which is what a badge on
 * an inbox means.
 *
 * Narrowed *within* what the caller may see, never instead of it — an omitted
 * or invented scope widens nothing.
 */
export async function taskSummary(
  user: AuthUser,
  todayJalali: string,
  scope?: TaskScope,
) {
  const db = getDb();
  const visibility = visibilityClause(user);
  const scoped = scopeClause(user, scope);
  const clauses = [visibility, scoped].filter(Boolean) as Record<string, unknown>[];
  const base: Record<string, unknown> = clauses.length === 0 ? {}
    : clauses.length === 1 ? clauses[0] : { AND: clauses };
  const today = jalaliToDate(todayJalali);

  const [byStatus, open, overdue, dueToday] = await Promise.all([
    db.task.groupBy({ by: ["status"], where: base, _count: { _all: true } }),
    /*
     * What the inbox badge counts, answered here rather than folded out of
     * `byStatus` in the browser. «در انتظار مشتری» is not a status — it is
     * derived from the due date and the task kind — so no grouping by status
     * can subtract it, and a chase agreed for after Nowruz sat in the badge
     * from the day it was scheduled. `onPlateWhere` is the board's own rule.
     */
    db.task.count({ where: { AND: [base, onPlateWhere(today)] } }),
    today
      ? db.task.count({ where: { AND: [base, { dueDate: { lt: today } }, { status: { not: "انجام شده" } }] } })
      : Promise.resolve(0),
    today
      ? db.task.count({ where: { AND: [base, { dueDate: today }, { status: { not: "انجام شده" } }] } })
      : Promise.resolve(0),
  ]);

  return {
    byStatus: byStatus.map((s) => ({ status: s.status, count: s._count._all })),
    total: byStatus.reduce((sum, s) => sum + s._count._all, 0),
    /** Not finished **and** not parked — see `onPlateWhere`. */
    open,
    overdue,
    dueToday,
  };
}

/* --------------------------------- writes --------------------------------- */

export interface TaskInput {
  title?: string;
  /**
   * Settled at creation and never on an edit — see `createTask`.
   *
   * «SALES_FOLLOW_UP» is refused here (`creatableKindRefusal`); a chase is
   * raised through `reactivateFollowUp`, which owns the rules that make it one.
   */
  taskKind?: string | null;
  description?: string | null;
  relatedToType?: string | null;
  relatedToId?: string | null;
  relatedToName?: string | null;
  priority?: string;
  status?: string;
  dueDate?: string | null;
  assignedToUserId?: string | null;
  assignedToName?: string | null;
  reminderEnabled?: boolean;
  reminderDate?: string | null;
  reminderTime?: string | null;
  reminderRepeat?: string | null;
  reminderAnchor?: string | null;
  reminderRepeatUntilJalali?: string | null;
  customValues?: unknown;
}

function scalarData(input: TaskInput): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const set = (key: string, value: unknown) => { if (value !== undefined) out[key] = value; };

  if ("title" in input) set("title", toNullableString(input.title, 400));
  if ("description" in input) set("description", toNullableString(input.description));
  if ("relatedToType" in input) set("relatedToType", toNullableString(input.relatedToType, 50));
  if ("relatedToId" in input) set("relatedToId", toNullableString(input.relatedToId, 36));
  if ("relatedToName" in input) set("relatedToName", toNullableString(input.relatedToName, 400));
  if ("priority" in input) set("priority", toNullableString(input.priority, 20) ?? "متوسط");
  if ("status" in input) set("status", toNullableString(input.status, 30) ?? TASK_DOING);
  if ("assignedToUserId" in input) set("assignedToUserId", toNullableString(input.assignedToUserId, 36));
  if ("assignedToName" in input) set("assignedToName", toNullableString(input.assignedToName, 200));
  if ("reminderEnabled" in input) set("reminderEnabled", !!input.reminderEnabled);
  if ("reminderTime" in input) set("reminderTime", toNullableString(input.reminderTime, 5));
  /*
    The period is normalised rather than stored as typed, so a value this build
    does not know is written as «does not repeat» instead of as a rule nothing
    can read. `reminderAckedFor` is deliberately absent: `ackReminder` is its
    only writer, or a form posting a whole record would silence the very
    occurrence it was opened to answer.
  */
  if ("reminderRepeat" in input) set("reminderRepeat", normalizeRepeat(input.reminderRepeat));
  if ("reminderAnchor" in input) set("reminderAnchor", toNullableString(input.reminderAnchor, 20));
  if ("reminderRepeatUntilJalali" in input) {
    set("reminderRepeatUntilJalali", toNullableString(input.reminderRepeatUntilJalali, 10));
  }
  if ("customValues" in input) set("customValues", toJsonColumn(input.customValues));

  return { ...out, ...expandDateFields(input as Record<string, unknown>, TASK_DATE_FIELDS) };
}

/**
 * The assignee columns a write should carry, resolved from the name.
 *
 * A task belongs to a person by **id**: `assignedToUserId` is what «به من
 * ارجاع شده» filters on and half of what `visibilityClause` shows at all. Every
 * form here hands over a *name* — the task form's picker sets `assignedTo` and
 * never recomputes the id, so every edit sent `assignedToUserId: null` beside a
 * perfectly good name and quietly detached the task from its owner: still
 * «مسئول: فلانی» on the card, belonging to nobody, and gone from that person's
 * own board. The same fault `resolveAssignee` was written for, on the one path
 * a person drives by hand.
 *
 * The rules, in order:
 *  - an explicit id wins — a caller that knows the account is not second-guessed;
 *  - a name with no id is looked up, folding the spellings SQL Server's
 *    collation treats as different characters (ی/ي, ک/ك, the half-space);
 *  - a name that matches nobody falls back, because a task with no id is
 *    invisible to everybody without «همه وظایف»;
 *  - and an **empty** name is a deliberate «شخصی (بدون ارجاع)», so the id is
 *    left alone rather than being invented from the fallback.
 */
async function assigneeColumns(
  input: TaskInput,
  fallbackUserId: string | null,
): Promise<Record<string, unknown>> {
  const explicitId = toNullableString(input.assignedToUserId, 36);
  if (explicitId) return { assignedToUserId: explicitId };

  const name = toNullableString(input.assignedToName, 200);
  if (!name) {
    // Nothing to resolve. On a create the caller still needs somebody, so the
    // fallback applies there; on an update, «not edited» must stay that way.
    return fallbackUserId ? { assignedToUserId: fallbackUserId } : {};
  }

  const resolved = await resolveAssignee(name, fallbackUserId);
  return {
    assignedToUserId: resolved.assignedToUserId,
    assignedToName: resolved.assignedToName || name,
  };
}

/**
 * The start and finish dates a status change implies.
 *
 * Two facts about a piece of work, recorded where the change happens rather
 * than left to whichever screen made it — the board, the ordinary edit form,
 * the follow-up flow and an integration all move a task's status, and a stamp
 * written in only one of them is a date that exists for some tasks and not
 * others.
 *
 * **Starting is stamped once and never cleared.** The day work began on
 * something is a fact; a task pushed back to the queue and picked up again has
 * not started twice, and blanking it would lose the only record of when it
 * first moved.
 *
 * **Finishing is cleared on reopening**, and that is the opposite rule for the
 * opposite reason: a task showing a completion date while it sits in «در حال
 * انجام» is claiming to be finished, which is exactly what moving it back said
 * it is not.
 */
export function laneTimestamps(
  before: { status: string; startedAt: Date | null },
  nextStatus: string | undefined,
  todayJalali: string,
): Record<string, unknown> {
  if (!nextStatus || nextStatus === before.status) return {};

  const from = taskLane(before.status);
  const to = taskLane(nextStatus);
  if (from === to) return {};

  const out: Record<string, unknown> = {};

  if (to !== "TODO" && !before.startedAt) {
    Object.assign(out, expandDateFields({ startedAt: todayJalali }, ["startedAt"]));
  }
  if (to === "DONE") {
    Object.assign(out, expandDateFields({ completedAt: todayJalali }, ["completedAt"]));
  } else {
    out.completedAt = null;
    out.completedAtJalali = null;
  }
  return out;
}

/**
 * Moves several tasks into one column at once.
 *
 * The board's whole point is picking three or four things out of «برای انجام»
 * and saying «these are what I am doing today», so it is one request rather
 * than one per card — four sequential round trips would show the column
 * rearranging itself a card at a time.
 *
 * Scoped through `visibilityClause` **inside the query**, so an id belonging to
 * somebody else's task moves nothing and is reported as such rather than
 * silently ignored; and the follow-up refusal is honoured here too, since a
 * sales follow-up dragged into «انجام شده» would close it with nothing
 * recorded about what the customer said.
 */
export async function moveTasksToLane(
  ids: string[],
  lane: MovableLane,
  user: AuthUser,
  todayJalali: string,
): Promise<MoveOutcome> {
  const db = getDb();
  const wanted = [...new Set(ids.filter((id) => typeof id === "string" && id))].slice(0, 200);
  if (wanted.length === 0) return { moved: 0, refused: 0, reasons: [] };

  const visibility = visibilityClause(user);
  const rows = await db.task.findMany({
    where: visibility ? { AND: [{ id: { in: wanted } }, visibility] } : { id: { in: wanted } },
    select: {
      id: true, status: true, taskKind: true, startedAt: true,
      dueDateJalali: true, assignedToUserId: true, assignedToName: true,
      // Pulling a parked chase forward moves the quotation's deferral with it,
      // and that needs to know which quotation.
      relatedToType: true, relatedToId: true,
    },
  });

  let moved = 0;
  let refused = wanted.length - rows.length;
  const reasons = new Set<string>();

  /*
   * How much room each assignee has left in «در حال انجام».
   *
   * Read once for the whole batch and decremented as cards are admitted, so
   * ticking six cards and pressing the column cannot slip past a cap of four —
   * which counting per card against a figure read at the start would.
   */
  const capacity = lane === "DOING"
    ? await capacityByUser(
      rows.map((r) => r.assignedToUserId).filter((id): id is string => !!id), todayJalali)
    : new Map();

  for (const row of rows) {
    /*
     * Where the card is **now**, by the board's own rule rather than by its
     * status word. A chase parked in «در انتظار مشتری» carries whatever status
     * the automation that raised it wrote, and comparing statuses would call
     * that a real move and write one that changed nothing on screen.
     */
    const from = taskBoardLane(
      { status: row.status, taskKind: row.taskKind, dueDate: row.dueDateJalali },
      todayJalali,
    );
    if (from === lane) continue;

    // The same rule the ordinary edit enforces: a follow-up is finished by
    // recording what the customer said, not by being dragged.
    if (row.taskKind === FOLLOW_UP_KIND && lane === "DONE") {
      refused++;
      reasons.add("پیگیری فروش با «ثبت نتیجه پیگیری» بسته می‌شود، نه با انتقال ستون.");
      continue;
    }

    /*
     * A chase has no «برای انجام».
     *
     * Its column is its next-contact date, so writing «برای انجام» onto one
     * would leave the card exactly where it was — a press that appears to work
     * and does nothing. Refused and named, rather than silently ignored.
     */
    if (row.taskKind === FOLLOW_UP_KIND && lane === "TODO") {
      refused++;
      reasons.add("ستون یک پیگیری از تاریخ اقدام بعدی آن می‌آید؛ برای موکول کردن،"
        + " نتیجه پیگیری را با «موکول به تاریخ دیگر» ثبت کنید.");
      continue;
    }

    if (lane === "DOING" && row.assignedToUserId) {
      const room = capacity.get(row.assignedToUserId);
      if (room && room.limits.max !== null && room.remaining <= 0) {
        refused++;
        reasons.add(capacityRefusalMessage(
          row.assignedToName, room.active, room.limits.max, 1,
        ));
        continue;
      }
      if (room && room.limits.max !== null) room.remaining -= 1;
    }

    const status = taskStatusForLane(lane, row.status);

    await db.task.update({
      where: { id: row.id },
      data: {
        status,
        /*
         * Pulling a **parked** card forward *is* moving its date.
         *
         * The column of a chase or a next action comes from the date, so a
         * status on its own would put the card back where it was on the next
         * render — a press that appears to work and undoes itself. Today is
         * also what it now means: somebody said they would do it today.
         *
         * Both parked kinds, and both destinations. A next action may be pulled
         * into «برای انجام» as well as into «در حال انجام» — «I will do this
         * today» and «I am doing it now» are both real answers — while a chase
         * is refused «برای انجام» above, so only «در حال انجام» reaches here.
         *
         * The queue does **not** read this date while the quotation is parked —
         * it reads `Proforma.deferredUntil` — which this used to claim it did.
         * The block below moves that half too, and the two agree because both
         * are written here rather than because they happen to say the same
         * thing.
         */
        ...(from === "WAITING" && isParkedKind(row.taskKind)
          ? expandDateFields({ dueDate: todayJalali }, ["dueDate"])
          : {}),
        ...laneTimestamps(row, status, todayJalali),
      } as Prisma.TaskUncheckedUpdateInput,
    });
    /*
     * And the quotation's own deferral with it. The comment above used to claim
     * the queue and the board agreed after this; they did not — the queue reads
     * `Proforma.deferredUntil`, which this never touched, so a card pulled
     * forward stayed hidden from the overdue list until the old date arrived.
     */
    if (row.taskKind === FOLLOW_UP_KIND && lane === "DOING" && from === "WAITING") {
      await syncDeferralToChase(
        db as unknown as Prisma.TransactionClient, row, todayJalali, todayJalali,
      );
    }
    moved++;
  }

  return { moved, refused, reasons: [...reasons] };
}


/**
 * Refuses the one `taskKind` this endpoint may not write.
 *
 * A sales follow-up is not a task with a word on it: it belongs to a quotation,
 * it moves that quotation's `followUpState`, it must not be the second open
 * chase on one document and it cannot exist on a settled sale. `reactivateFollowUp`
 * owns all of that, and a second way in would be a second copy of every rule.
 *
 * Everything else goes through — «NEXT_ACTION» because that is what
 * «ذخیره و اقدام بعدی» raises, and a kind this build does not know because
 * refusing an unfamiliar value would break an integration to guard against
 * nothing: the board files any kind it does not recognise as an ordinary task.
 */
export function creatableKindRefusal(kind: unknown): string | null {
  return String(kind ?? "").trim() === FOLLOW_UP_KIND
    ? "پیگیری فروش از این مسیر ساخته نمی‌شود؛ از «فعال‌سازی مجدد پیگیری» روی همان پیش‌فاکتور استفاده کنید."
    : null;
}

export async function createTask(input: TaskInput, user: AuthUser, todayJalali: string) {
  const refusal = creatableKindRefusal(input.taskKind);
  if (refusal) throw new Error(refusal);

  const db = getDb();
  const author = await db.user.findUnique({
    where: { id: user.id }, select: { fullName: true },
  });

  const task = await db.task.create({
    data: {
      /*
       * A task starts in the first column.
       *
       * The database default is still «در حال انجام» — every row written before
       * the board existed carries it and changing the default would not move
       * them — so «برای انجام» is written here, where a task is created. An
       * automation that names its own status still gets what it asked for.
       */
      status: TASK_TODO,
      ...scalarData(input),
      /*
       * Written here and **not** in `scalarData`, which the update path shares.
       *
       * A task's kind decides which column it is drawn in, so an edit that
       * could rewrite it could park an ordinary task in «در انتظار» for ever,
       * or un-park a next action by making it «GENERAL» — neither of which is
       * anything a person means by correcting a title. It is a fact about how
       * the record was raised, settled once, at creation. Absent leaves the
       * column default («GENERAL»).
       */
      ...(input.taskKind === undefined
        ? {}
        : { taskKind: toNullableString(input.taskKind, 30) ?? "GENERAL" }),
      /*
       * The account behind the name, and the creator only as a last resort.
       *
       * A task belongs to a person by **id** — that is what «به من ارجاع شده»
       * filters on and half of what `visibilityClause` shows at all — while
       * every form and every integration hands over a *name*. Falling straight
       * back to `user.id` put a task raised for a colleague on the raiser's own
       * board and nowhere else; `resolveAssignee` folds the spellings SQL
       * Server's collation treats as different characters, and only an
       * unmatched name lands on whoever raised it.
       */
      ...(await assigneeColumns(input, user.id)),
      /*
       * Taken from the session, never from the body.
       *
       * This is half of who may *see* the task, so a client that could set it
       * could put a task on somebody else's board — or take one off its own.
       * `WRITABLE` in the route leaves it out for the same reason.
       *
       * The name is kept beside the id so the history stays readable when an
       * account is deactivated, exactly as `assignedToName` is.
       */
      createdByUserId: user.id,
      createdByName: author?.fullName ?? null,
    } as Prisma.TaskUncheckedCreateInput,
  });

  // Notification
  await notifyModuleResponsible(
    "tasks",
    "ثبت وظیفه جدید",
    `وظیفه جدید ثبت شد: ${task.title}`,
    user,
    task.relatedToType === "project" ? task.relatedToId : null,
  );

  // Audit log
  await logAction(
    {
      action: "CREATE",
      module: "وظایف",
      entityId: task.id,
      description: `ایجاد وظیفه جدید: ${task.title || task.id}`,
      afterState: task,
    },
    user,
    todayJalali,
  );

  // Workflow trigger
  await processWorkflowRules(
    "task_created",
    {
      taskId: task.id,
      title: task.title,
      assignedTo: task.assignedToUserId,
      priority: task.priority,
      /*
       * Which kind of task this is, so a rule can fire on the ones people
       * raise and not on the follow-ups the engine raises itself — which is
       * also what keeps a «when a task is created, create a task» rule from
       * feeding itself.
       */
      taskKind: task.taskKind,
      dueDate: task.dueDateJalali,
      projectId: task.relatedToType === "project" ? task.relatedToId : undefined,
    },
    user,
  );

  /*
   * And the person it was given to, on their phone.
   *
   * The board tells them the next time they open it, which is no use for
   * something raised while they are at a customer site. `notifyStaffBySms`
   * decides the rest — never a sales follow-up, never to whoever raised it,
   * never to an account with no mobile — and `afterCommit` means a gateway
   * being down cannot fail a save that has already happened.
   */
  await afterCommit("task assignment SMS", async () => {
    await notifyStaffBySms({
      kind: "TASK_ASSIGNED",
      assigneeUserId: task.assignedToUserId,
      actorUserId: user.id,
      actorName: author?.fullName ?? null,
      title: task.title,
      taskKind: task.taskKind,
      dueDate: task.dueDateJalali,
      priority: task.priority,
      projectId: task.relatedToType === "project" ? task.relatedToId : null,
      entityType: "task",
      entityId: task.id,
    });
  });

  return task;
}

/**
 * Keeps a parked quotation's deferral on the same day as its open chase.
 *
 * The date lives in two places by design — `Proforma.deferredUntil`, which the
 * sales queue and the health badge read, and the chase's own due date, which
 * puts the card in «در انتظار مشتری» — and **two** paths move the task alone:
 * the edit form and the board's «کشیدن به جلو». So a chase pulled onto
 * somebody's plate today sat in «در حال انجام» while the queue went on
 * reporting the quotation as parked and hid it from the overdue list until the
 * old date came round.
 *
 * `deferralAfterChaseMoved` is the rule and it answers `null` for everything
 * that is not a parked quotation, so the ordinary task edit costs one indexed
 * read and stops. It is written here rather than in `followUpService` because
 * this is where the task's date is written, and a second writer is how the two
 * halves came to disagree in the first place.
 */
async function syncDeferralToChase(
  tx: Prisma.TransactionClient,
  task: { taskKind: string | null; relatedToType: string | null; relatedToId: string | null },
  newDueDateJalali: string | null | undefined,
  todayJalali: string,
): Promise<void> {
  if (task.taskKind !== FOLLOW_UP_KIND || task.relatedToType !== "proforma") return;
  if (!task.relatedToId || !newDueDateJalali) return;

  const proforma = await tx.proforma.findUnique({
    where: { id: task.relatedToId },
    select: { followUpState: true, deferredUntilJalali: true },
  });
  const next = deferralAfterChaseMoved(proforma?.followUpState, newDueDateJalali, todayJalali);
  if (!next) return;
  // Nothing to write when the pause already says what the chase does.
  if (
    proforma?.followUpState === next.followUpState
    && (proforma?.deferredUntilJalali ?? null) === next.deferredUntil
  ) return;

  await tx.proforma.update({
    where: { id: task.relatedToId },
    data: {
      followUpState: next.followUpState,
      ...(next.deferredUntil
        ? expandDateFields({ deferredUntil: next.deferredUntil }, ["deferredUntil"])
        : { deferredUntil: null, deferredUntilJalali: null }),
    },
  });
}

export async function updateTask(id: string, input: TaskInput, user: AuthUser, todayJalali: string) {
  const db = getDb();
  const visibility = visibilityClause(user);
  if (visibility) {
    const allowed = await db.task.findFirst({ where: { AND: [{ id }, visibility] }, select: { id: true } });
    if (!allowed) return null;
  }

  // Get before state for audit log
  const before = await db.task.findUnique({ where: { id } });
  if (!before) return null;

  /*
   * A sales follow-up is not finished with a tick.
   *
   * Ticking one closes the task and leaves the quotation with nobody on it and
   * nothing recorded about what the customer said — which is the exact failure
   * the follow-up flow exists to prevent. So the generic path refuses the
   * completion. Every other edit of the task goes through unchanged, and the
   * automatic closing (a won quotation, a superseded revision) writes with
   * `updateMany` and is not affected.
   *
   * The message names the button, not another module: the completion form is
   * on the tasks screen now — the tick opens it — as well as on the sales
   * follow-up queue. It used to send the reader to «پیش‌فاکتورها» to press a
   * second button, which is the round trip the merged board removed.
   */
  if (
    before.taskKind === "SALES_FOLLOW_UP"
    && input.status === "انجام شده"
    && before.status !== "انجام شده"
  ) {
    throw new Error(
      "پیگیری فروش با «ثبت نتیجه پیگیری» بسته می‌شود، نه با تیک ساده؛ روی همین کارت آن را باز کنید.",
    );
  }

  const data = scalarData(input);
  /*
   * The account behind the name, so an edit does not detach the task.
   *
   * The task form's picker sets a *name* and never recomputes the id, so every
   * save sent `assignedToUserId: null` next to a perfectly good name: the card
   * still read «مسئول: فلانی» and the task belonged to nobody — invisible on
   * that person's own board and in every tab but «همه وظایف». No fallback here:
   * an update that names nobody is «not edited», and inventing an owner would
   * quietly reassign a task somebody deliberately left personal.
   */
  Object.assign(data, await assigneeColumns(input, null));
  Object.assign(data, laneTimestamps(before, data.status as string | undefined, todayJalali));

  const task = await db.$transaction(async (tx) => {
    const saved = await tx.task.update({
      where: { id }, data: data as Prisma.TaskUncheckedUpdateInput,
    });
    /*
      Moving a parked chase's date *is* moving the deferral. Inside the same
      transaction, or a failure here leaves the board on one date and the sales
      queue on another — which is exactly the state this closes.
    */
    await syncDeferralToChase(tx, saved, saved.dueDateJalali, todayJalali);
    return saved;
  });

  // Audit log
  await logAction(
    {
      action: "UPDATE",
      module: "وظایف",
      entityId: id,
      description: `ویرایش وظیفه: ${task.title || id}`,
      beforeState: before,
      afterState: task,
    },
    user,
    todayJalali,
  );

  // Any status change. The rule editor offers `task_status_change`, and
  // nothing fired it — only the narrower completion trigger below — so a rule
  // built on it never ran.
  if (before.status !== task.status) {
    await processWorkflowRules(
      "task_status_change",
      {
        taskId: task.id,
        title: task.title,
        assignedTo: task.assignedToUserId,
        oldStatus: before.status,
        newStatus: task.status,
        status: task.status,
        priority: task.priority,
        projectId: task.relatedToType === "project" ? task.relatedToId : undefined,
      },
      user,
    );
  }

  /*
   * Handed to somebody else: the new owner is told, and nobody else is.
   *
   * Compared against what was stored, not against the mere presence of the
   * field — the form posts the whole record, so reading «assignedToUserId was
   * sent» as «reassigned» would text the same person on every edit of a task
   * that was already theirs.
   */
  if (task.assignedToUserId && task.assignedToUserId !== before.assignedToUserId) {
    await afterCommit("task reassignment SMS", async () => {
      await notifyStaffBySms({
        kind: "TASK_ASSIGNED",
        assigneeUserId: task.assignedToUserId,
        actorUserId: user.id,
        actorName: user.fullName ?? null,
        title: task.title,
        taskKind: task.taskKind,
        dueDate: task.dueDateJalali,
        priority: task.priority,
        projectId: task.relatedToType === "project" ? task.relatedToId : null,
        entityType: "task",
        entityId: task.id,
      });
    });
  }

  // Workflow trigger for task completion
  if (before.status !== task.status && task.status === "انجام شده") {
    await processWorkflowRules(
      "task_completed",
      {
        taskId: task.id,
        title: task.title,
        assignedTo: task.assignedToUserId,
        oldStatus: before.status,
        newStatus: task.status,
        projectId: task.relatedToType === "project" ? task.relatedToId : undefined,
      },
      user,
    );
  }

  return task;
}

export async function deleteTask(id: string, user: AuthUser, todayJalali: string): Promise<"ok" | "forbidden" | "not-found"> {
  const db = getDb();
  const visibility = visibilityClause(user);

  const existing = await db.task.findFirst({
    where: visibility ? { AND: [{ id }, visibility] } : { id },
  });
  if (!existing) {
    // Distinguish "not yours" from "does not exist" only when it is safe to:
    // a scoped user must not learn that someone else's task exists.
    if (visibility) return "forbidden";
    return "not-found";
  }

  await db.task.delete({ where: { id } });

  // Audit log
  await logAction(
    {
      action: "DELETE",
      module: "وظایف",
      entityId: id,
      description: `حذف وظیفه: ${existing.title || id}`,
      beforeState: existing,
    },
    user,
    todayJalali,
  );

  return "ok";
}

/* ------------------------------- reminders -------------------------------- */

/**
 * The reminders this person is owed right now.
 *
 * Two things make this its own reader rather than an extra on `listTasks`.
 *
 * **A repeating reminder cannot be found by a `where`.** Its occurrences are
 * derived from an anchor across the Shamsi calendar — months of 31, 30 and 29
 * days, and a leap Esfand — which no clause over a date column can express. So
 * the query narrows to *candidates* and `dueReminderAt` decides, the same
 * rank-then-page shape the follow-up queue and the stuck-work report already
 * take.
 *
 * **The candidate set is small by construction**: `reminderEnabled` is false for
 * almost every task, and the two arms are «a one-off dated today» and «a
 * repeating one still running». `visibilityClause` is applied like everywhere
 * else, so a reminder only ever reaches the two people its task belongs to.
 *
 * A finished task is excluded: a reminder that goes on speaking about work
 * already done is the thing that makes people stop reading reminders, and for a
 * repeating one it would do so for ever.
 */
export async function listDueReminders(
  user: AuthUser,
  todayJalali: string,
  nowTime: string,
): Promise<Array<Record<string, unknown> & { reminderOccurrence: string }>> {
  const db = getDb();
  const visible = visibilityClause(user);

  const rows = await db.task.findMany({
    where: {
      AND: [
        ...(visible ? [visible] : []),
        { reminderEnabled: true },
        { status: { notIn: [TASK_DONE, TASK_CANCELLED] } },
        {
          OR: [
            { reminderDateJalali: todayJalali },
            {
              reminderRepeat: { not: null },
              OR: [
                { reminderRepeatUntilJalali: null },
                { reminderRepeatUntilJalali: { gte: todayJalali } },
              ],
            },
          ],
        },
      ],
    },
    select: LIST_SELECT,
    take: REMINDER_SCAN_LIMIT,
  });

  const due: Array<Record<string, unknown> & { reminderOccurrence: string }> = [];
  for (const row of rows) {
    const occurrence = dueReminderAt(row as ReminderFacts, todayJalali, nowTime);
    if (occurrence) due.push({ ...(row as Record<string, unknown>), reminderOccurrence: occurrence });
  }
  return due;
}

/**
 * A bound on the candidate scan, for the same reason every other scan here has
 * one: a query with no `take` is one that gets slower for ever.
 */
const REMINDER_SCAN_LIMIT = 500;

/**
 * Records that somebody has answered one occurrence.
 *
 * **The occurrence is named, not merely flagged**, so acknowledging today says
 * nothing about next Monday — a boolean would silence the series after its first
 * appearance, which is the whole feature. It is written as a conditional
 * `updateMany` so it can never reach a task this person may not see, and so two
 * tabs answering at once write it once.
 */
export async function ackReminder(
  id: string,
  occurrence: string,
  user: AuthUser,
): Promise<boolean> {
  const db = getDb();
  const visible = visibilityClause(user);
  const result = await db.task.updateMany({
    where: { AND: [{ id }, ...(visible ? [visible] : [])] },
    data: { reminderAckedFor: occurrence.slice(0, 20) },
  });
  return result.count > 0;
}
