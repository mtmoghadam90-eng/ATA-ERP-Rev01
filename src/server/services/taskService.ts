import { Prisma } from "@prisma/client";
import { getDb } from "../db";
import { ListQuery, ListResult, buildResult, paginationArgs, searchClause } from "../listing";
import { AuthUser, canSeeAllTasks } from "../auth";
import { taskRelationKind } from "../../utils/taskRelations";
import { resolveAssignee } from "./assigneeLookup";
import {
  BoardLane, LANE_FILTERS, MovableLane, TASK_CANCELLED, TASK_DOING, TASK_DONE, TASK_TODO,
  laneWhere, taskBoardLane, taskLane, taskStatusForLane,
} from "../../utils/workBoard";
import { FOLLOW_UP_KIND } from "../../utils/salesFollowUp";
import { capacityRefusalMessage } from "../../utils/workLimits";
import { capacityByUser } from "./workLoadService";
import { expandDateFields, jalaliRangeFilter, jalaliToDate } from "../dates";
import { toJsonColumn, toNullableString } from "../childSync";
import { notifyModuleResponsible } from "./notificationService";
import { logAction } from "./auditService";
import { processWorkflowRules } from "./workflowService";

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
    reminderDate?: unknown;
    reminderTime?: unknown;
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

  // Filter for reminder notifications — exact date and time match
  if (typeof extra.reminderDate === "string" && extra.reminderDate) {
    and.push({ reminderEnabled: true, reminderDateJalali: extra.reminderDate });
  }
  if (typeof extra.reminderTime === "string" && extra.reminderTime) {
    and.push({ reminderTime: extra.reminderTime });
  }

  return and.length === 0 ? {} : { AND: and };
}

const LIST_SELECT = {
  id: true, title: true, description: true, priority: true, status: true,
  createdByUserId: true, createdByName: true,
  relatedToType: true, relatedToId: true, relatedToName: true,
  dueDate: true, dueDateJalali: true,
  assignedToUserId: true, assignedToName: true,
  reminderEnabled: true, reminderDateJalali: true, reminderTime: true,
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
    reminderDate?: unknown;
    reminderTime?: unknown;
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

/** Open, overdue and due-today counts for the dashboard, aggregated in SQL. */
export async function taskSummary(user: AuthUser, todayJalali: string) {
  const db = getDb();
  const visibility = visibilityClause(user);
  const base = visibility ?? {};
  const today = jalaliToDate(todayJalali);

  const [byStatus, overdue, dueToday] = await Promise.all([
    db.task.groupBy({ by: ["status"], where: base, _count: { _all: true } }),
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
    overdue,
    dueToday,
  };
}

/* --------------------------------- writes --------------------------------- */

export interface TaskInput {
  title?: string;
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
         * Pulling a parked chase forward *is* moving its date.
         *
         * The column comes from the date and nothing else, so a status on its
         * own would put the card back where it was on the next render. Today
         * is also what it now means: somebody said they would call today, and
         * the queue, the health badge and the project's own tab all read that
         * same date and now agree with the board.
         */
        ...(row.taskKind === FOLLOW_UP_KIND && lane === "DOING" && from === "WAITING"
          ? expandDateFields({ dueDate: todayJalali }, ["dueDate"])
          : {}),
        ...laneTimestamps(row, status, todayJalali),
      } as Prisma.TaskUncheckedUpdateInput,
    });
    moved++;
  }

  return { moved, refused, reasons: [...reasons] };
}

export async function createTask(input: TaskInput, user: AuthUser, todayJalali: string) {
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

  return task;
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

  const task = await db.task.update({ where: { id }, data: data as Prisma.TaskUncheckedUpdateInput });

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
