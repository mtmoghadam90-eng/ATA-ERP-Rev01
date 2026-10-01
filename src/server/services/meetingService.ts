import { Prisma } from "@prisma/client";
import { getDb } from "../db";
import { AuthUser, canSeeAllMeetings } from "../auth";
import { expandDateFields, jalaliRangeFilter } from "../dates";
import { toNullableString } from "../childSync";
import { ListQuery, buildResult, paginationArgs, searchClause } from "../listing";
import { nextDocumentNumber } from "../documentNumbers";
import { logAction } from "./auditService";
import { afterCommit } from "../afterCommit";
import { notifyStaff } from "./staffNotifications";
import { ACTIVITY_CATEGORY, logProjectFact } from "./projectActivityLog";
import { TASK_CANCELLED, TASK_DONE, TASK_TODO } from "../../utils/workBoard";
import { attachmentListColumn, parseAttachmentList, type ActivityAttachment } from "../../utils/attachments";
import {
  MeetingAssignee, MeetingItemDraft, MeetingItemKind, MeetingItemState, MeetingParticipant,
  MeetingStatus, StoredItem, isOpenItemState, meetingItemKind, meetingItemState, meetingRefusal,
  meetingStatus, meetingTaskDescription, meetingTaskTitle, memberIndexOf, parseAssignees,
  parseParticipants, parseTaskLinks, planTaskSync,
} from "../../utils/meetingMinutes";

/**
 * «صورتجلسات» — reading, writing and finalising minutes.
 *
 * The rules are in `src/utils/meetingMinutes.ts`; this file is the database
 * half. Three things decide its shape:
 *
 * - **Visibility is a clause inside the query**, never a filter afterwards:
 *   `memberIndex` holds `,id,id,` for the creator, every colleague at or absent
 *   from the meeting and every assignee, so «may this person see it» is one
 *   exact `contains` and the page totals cannot leak a meeting somebody may not
 *   see. `meetingsAll` (or a system administrator) removes the clause.
 * - **Items are reconciled by id**, never rebuilt — a finalised item is the
 *   thing its tasks point back to, and deleting and re-inserting it would leave
 *   every task on the board pointing at nothing.
 * - **Finalising, and every edit after it, keeps the board in step inside the
 *   same transaction** (`planTaskSync`): a new action raises its tasks, a
 *   removed one cancels them. The notifications go after the commit.
 */

export const MEETING_TASK_RELATION = "meeting";

/** How far the «دارای اقدام باز» filter and the carry-over list look. */
export const MEETING_SCAN_LIMIT = 2000;

const OPEN_TASK = { status: { notIn: [TASK_DONE, TASK_CANCELLED] } };

export function visibilityClause(user: AuthUser): Prisma.MeetingWhereInput | undefined {
  if (canSeeAllMeetings(user)) return undefined;
  return { memberIndex: { contains: `,${user.id},` } };
}

/** The creator, or somebody who sees every meeting, may change one. */
function mayEdit(user: AuthUser, meeting: { createdByUserId: string | null }): boolean {
  return canSeeAllMeetings(user) || (!!meeting.createdByUserId && meeting.createdByUserId === user.id);
}

/* ------------------------------- input shape ------------------------------ */

export interface MeetingInput {
  title?: unknown;
  meetingDate?: unknown;
  startTime?: unknown;
  endTime?: unknown;
  place?: unknown;
  summary?: unknown;
  projectId?: unknown;
  attendees?: unknown;
  absentees?: unknown;
  nextMeetingDate?: unknown;
  attachments?: unknown;
  items?: unknown;
  /** True when this save is the one that finalises the minutes. */
  finalize?: unknown;
}

const timeOf = (value: unknown): string | null => {
  const v = String(value ?? "").trim();
  return /^\d{1,2}:\d{2}$/.test(v) ? v.padStart(5, "0") : null;
};

function parseItems(raw: unknown): MeetingItemDraft[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => {
    const e = (entry ?? {}) as Record<string, unknown>;
    const kind = meetingItemKind(e.kind);
    return {
      id: e.id ? String(e.id) : null,
      text: String(e.text ?? "").trim(),
      kind,
      // Only an action owes anything, so only an action keeps assignees.
      assignees: kind === "ACTION" ? parseAssignees(e.assignees) : [],
      dueDateJalali: kind === "ACTION" ? toNullableString(e.dueDate ?? e.dueDateJalali, 10) : null,
    };
  });
}

/* --------------------------------- reading -------------------------------- */

export interface MeetingItemRow {
  id: string;
  lineNo: number;
  text: string;
  kind: MeetingItemKind;
  assignees: MeetingAssignee[];
  dueDateJalali: string | null;
  state: MeetingItemState;
  /** One per assignee who has a task, with where that task has got to. */
  tasks: { userId: string; taskId: string; assigneeName: string; status: string | null }[];
}

export interface MeetingRow {
  id: string;
  code: string;
  title: string;
  meetingDateJalali: string | null;
  startTime: string | null;
  endTime: string | null;
  place: string | null;
  summary: string | null;
  projectId: string | null;
  projectCode: string | null;
  projectName: string | null;
  customerName: string | null;
  status: MeetingStatus;
  attendees: MeetingParticipant[];
  absentees: MeetingParticipant[];
  nextMeetingDateJalali: string | null;
  attachments: ActivityAttachment[];
  createdByUserId: string | null;
  createdByName: string | null;
  finalizedByName: string | null;
  createdAt: Date;
  canEdit: boolean;
  itemCount: number;
  actionCount: number;
  openActionCount: number;
  items?: MeetingItemRow[];
}

const ROW_SELECT = {
  id: true, code: true, title: true, meetingDateJalali: true, startTime: true, endTime: true,
  place: true, summary: true, projectId: true, status: true, attendees: true, absentees: true,
  nextMeetingDateJalali: true, attachments: true, createdByUserId: true, createdByName: true,
  finalizedByName: true, createdAt: true,
  project: { select: { code: true, name: true, customer: { select: { companyName: true } } } },
  items: {
    select: {
      id: true, lineNo: true, text: true, kind: true, assignees: true,
      dueDateJalali: true, taskLinks: true,
    },
    orderBy: { lineNo: "asc" as const },
  },
} satisfies Prisma.MeetingSelect;

type RawMeeting = Prisma.MeetingGetPayload<{ select: typeof ROW_SELECT }>;

/** The tasks behind a set of meetings' items, in one read. */
async function taskStatuses(meetings: RawMeeting[]): Promise<Map<string, { status: string; name: string | null }>> {
  const ids = new Set<string>();
  for (const m of meetings) for (const item of m.items) {
    for (const link of parseTaskLinks(item.taskLinks)) ids.add(link.taskId);
  }
  if (ids.size === 0) return new Map();
  const tasks = await getDb().task.findMany({
    where: { id: { in: [...ids] } },
    select: { id: true, status: true, assignedToName: true },
  });
  return new Map(tasks.map((t) => [t.id, { status: t.status, name: t.assignedToName }]));
}

function toRow(
  m: RawMeeting,
  tasks: Map<string, { status: string; name: string | null }>,
  user: AuthUser,
  todayJalali: string,
  withItems: boolean,
): MeetingRow {
  const items: MeetingItemRow[] = m.items.map((item) => {
    const kind = meetingItemKind(item.kind);
    const assignees = parseAssignees(item.assignees);
    const links = parseTaskLinks(item.taskLinks);
    const linked = links.map((l) => ({
      userId: l.userId,
      taskId: l.taskId,
      assigneeName: tasks.get(l.taskId)?.name
        ?? assignees.find((a) => a.userId === l.userId)?.name ?? "",
      status: tasks.get(l.taskId)?.status ?? null,
    }));
    return {
      id: item.id,
      lineNo: item.lineNo,
      text: item.text,
      kind,
      assignees,
      dueDateJalali: item.dueDateJalali,
      state: meetingItemState(kind, linked.map((t) => t.status), item.dueDateJalali, todayJalali),
      tasks: linked,
    };
  });
  return {
    id: m.id,
    code: m.code,
    title: m.title,
    meetingDateJalali: m.meetingDateJalali,
    startTime: m.startTime,
    endTime: m.endTime,
    place: m.place,
    summary: m.summary,
    projectId: m.projectId,
    projectCode: m.project?.code ?? null,
    projectName: m.project?.name ?? null,
    customerName: m.project?.customer?.companyName ?? null,
    status: meetingStatus(m.status),
    attendees: parseParticipants(m.attendees),
    absentees: parseParticipants(m.absentees),
    nextMeetingDateJalali: m.nextMeetingDateJalali,
    attachments: parseAttachmentList(m.attachments),
    createdByUserId: m.createdByUserId,
    createdByName: m.createdByName,
    finalizedByName: m.finalizedByName,
    createdAt: m.createdAt,
    canEdit: mayEdit(user, m),
    itemCount: items.length,
    actionCount: items.filter((i) => i.kind === "ACTION").length,
    openActionCount: items.filter((i) => isOpenItemState(i.state)).length,
    ...(withItems ? { items } : {}),
  };
}

export interface MeetingFilters {
  /** A project id, «internal» for meetings belonging to none, or absent. */
  project?: unknown;
  from?: unknown;
  to?: unknown;
  /** «true» keeps only meetings with an action still open. */
  openActions?: unknown;
  status?: unknown;
}

export const MEETING_SORTABLE = ["meetingDate", "createdAt", "code", "title"] as const;

/**
 * The search, written once for the list and the carry-over: the meeting's own
 * words, the words of its items, the names of the people at it (they are in
 * the JSON as written, so a `contains` finds them), and the job it was about.
 */
function searchWhere(term: string): Prisma.MeetingWhereInput | undefined {
  const own = searchClause(term, ["code", "title", "place", "summary", "attendees", "absentees"]);
  if (!own) return undefined;
  const items = searchClause(term, ["text", "assignees"]);
  const project = searchClause(term, ["code", "name"]);
  return {
    OR: [
      ...(own.OR as Prisma.MeetingWhereInput[]),
      ...(items ? [{ items: { some: items as Prisma.MeetingItemWhereInput } }] : []),
      ...(project ? [{ project: project as Prisma.ProjectWhereInput }] : []),
    ],
  };
}

export function buildMeetingWhere(q: { search?: string }, filters: MeetingFilters, user: AuthUser): Prisma.MeetingWhereInput {
  const and: Prisma.MeetingWhereInput[] = [];
  const visibility = visibilityClause(user);
  if (visibility) and.push(visibility);

  const project = String(filters.project ?? "").trim();
  if (project === "internal") and.push({ projectId: null });
  else if (project && project !== "all") and.push({ projectId: project });

  const range = jalaliRangeFilter(filters.from, filters.to);
  if (range) and.push({ meetingDate: range });

  const status = String(filters.status ?? "").trim();
  if (status === "DRAFT" || status === "FINAL") and.push({ status });

  const search = q.search ? searchWhere(q.search) : undefined;
  if (search) and.push(search);

  return and.length === 0 ? {} : and.length === 1 ? and[0] : { AND: and };
}

export async function listMeetings(
  q: ListQuery,
  filters: MeetingFilters,
  user: AuthUser,
  todayJalali: string,
) {
  const db = getDb();
  let where = buildMeetingWhere(q, filters, user);

  /*
   * «دارای اقدام باز» is derived from the tasks, which are not a relation SQL
   * can see through, so it narrows the set *before* paging rather than the
   * page after it — filtering a page would print the unfiltered total beside a
   * short list. A bounded scan of the finalised meetings with actions, then an
   * ordinary paged query over the ids that qualify.
   */
  if (String(filters.openActions ?? "") === "true") {
    const candidates = await db.meeting.findMany({
      where: { AND: [where, { status: "FINAL" }, { items: { some: { kind: "ACTION" } } }] },
      select: ROW_SELECT,
      take: MEETING_SCAN_LIMIT,
      orderBy: { meetingDate: "desc" },
    });
    const tasks = await taskStatuses(candidates);
    const open = candidates
      .map((m) => toRow(m, tasks, user, todayJalali, false))
      .filter((r) => r.openActionCount > 0)
      .map((r) => r.id);
    where = { id: { in: open } };
  }

  const sortField = q.sort ?? "meetingDate";
  const orderBy: Prisma.MeetingOrderByWithRelationInput[] = [
    { [sortField]: q.order } as Prisma.MeetingOrderByWithRelationInput,
    { createdAt: "desc" },
  ];

  const [rows, total] = await Promise.all([
    db.meeting.findMany({ where, select: ROW_SELECT, orderBy, ...paginationArgs(q) }),
    db.meeting.count({ where }),
  ]);
  const tasks = await taskStatuses(rows);
  return buildResult(rows.map((m) => toRow(m, tasks, user, todayJalali, true)), total, q);
}

export async function getMeeting(id: string, user: AuthUser, todayJalali: string): Promise<MeetingRow | null> {
  const visibility = visibilityClause(user);
  const meeting = await getDb().meeting.findFirst({
    where: visibility ? { AND: [{ id }, visibility] } : { id },
    select: ROW_SELECT,
  });
  if (!meeting) return null;
  return toRow(meeting, await taskStatuses([meeting]), user, todayJalali, true);
}

/**
 * The actions still open from this project's earlier meetings — what the next
 * meeting has to ask about.
 *
 * Read through the same visibility as everything else: somebody who could not
 * open the earlier minutes is not shown their items either.
 */
export async function openActionsForProject(
  projectId: string,
  user: AuthUser,
  todayJalali: string,
  excludeMeetingId?: string | null,
) {
  const visibility = visibilityClause(user);
  const meetings = await getDb().meeting.findMany({
    where: {
      AND: [
        { projectId, status: "FINAL" },
        { items: { some: { kind: "ACTION" } } },
        ...(excludeMeetingId ? [{ id: { not: excludeMeetingId } }] : []),
        ...(visibility ? [visibility] : []),
      ],
    },
    select: ROW_SELECT,
    orderBy: { meetingDate: "desc" },
    take: MEETING_SCAN_LIMIT,
  });
  const tasks = await taskStatuses(meetings);
  const out: {
    meetingId: string; meetingCode: string; meetingTitle: string; meetingDateJalali: string | null;
    itemId: string; text: string; dueDateJalali: string | null; state: MeetingItemState;
    assignees: string[];
  }[] = [];
  for (const m of meetings) {
    const row = toRow(m, tasks, user, todayJalali, true);
    for (const item of row.items ?? []) {
      if (!isOpenItemState(item.state)) continue;
      out.push({
        meetingId: row.id,
        meetingCode: row.code,
        meetingTitle: row.title,
        meetingDateJalali: row.meetingDateJalali,
        itemId: item.id,
        text: item.text,
        dueDateJalali: item.dueDateJalali,
        state: item.state,
        assignees: item.assignees.map((a) => a.name),
      });
    }
  }
  return out;
}

/**
 * Every action item across the meetings this person may see — «what did all
 * our meetings hand out, and where has each got to».
 *
 * The state is derived from the tasks, which SQL cannot see, so this is the
 * rank-then-page shape: a bounded scan of the meetings (narrowed by the same
 * project, date and search clauses as the meeting list), the states computed,
 * the filters applied to the whole set, and only then a page cut — paging
 * first would answer «open» from one page and print the unfiltered total
 * beside it. Drafts are included as «در انتظار نهایی شدن», because an action
 * written down and never handed out is exactly what somebody looking at this
 * list needs to find.
 */
export const ACTION_STATE_FILTERS = ["open", "overdue", "done", "cancelled", "pending", "all"] as const;
export type ActionStateFilter = (typeof ACTION_STATE_FILTERS)[number];

export function actionMatchesState(state: MeetingItemState, filter: string): boolean {
  switch (filter) {
    case "all": return true;
    case "open": return isOpenItemState(state);
    case "overdue": return state === "OVERDUE";
    case "done": return state === "DONE";
    case "cancelled": return state === "CANCELLED";
    case "pending": return state === "PENDING";
    // An unknown value is read as the default rather than as «everything».
    default: return isOpenItemState(state);
  }
}

export interface MeetingActionRow {
  itemId: string;
  lineNo: number;
  text: string;
  dueDateJalali: string | null;
  state: MeetingItemState;
  assignees: MeetingAssignee[];
  tasks: MeetingItemRow["tasks"];
  meetingId: string;
  meetingCode: string;
  meetingTitle: string;
  meetingDateJalali: string | null;
  meetingStatus: MeetingStatus;
  projectId: string | null;
  projectCode: string | null;
  projectName: string | null;
}

export interface MeetingActionFilters extends MeetingFilters {
  state?: unknown;
  assignee?: unknown;
}

export async function listMeetingActions(
  q: ListQuery,
  filters: MeetingActionFilters,
  user: AuthUser,
  todayJalali: string,
) {
  const where = buildMeetingWhere(q, { ...filters, openActions: undefined }, user);
  const meetings = await getDb().meeting.findMany({
    where: { AND: [where, { items: { some: { kind: "ACTION" } } }] },
    select: ROW_SELECT,
    orderBy: [{ meetingDate: "desc" }, { createdAt: "desc" }],
    take: MEETING_SCAN_LIMIT,
  });
  const tasks = await taskStatuses(meetings);
  const stateFilter = String(filters.state ?? "open") || "open";
  const assignee = String(filters.assignee ?? "").trim();

  const all: MeetingActionRow[] = [];
  for (const m of meetings) {
    const row = toRow(m, tasks, user, todayJalali, true);
    for (const item of row.items ?? []) {
      if (item.kind !== "ACTION") continue;
      if (!actionMatchesState(item.state, stateFilter)) continue;
      if (assignee && assignee !== "all" && !item.assignees.some((a) => a.userId === assignee)) continue;
      all.push({
        itemId: item.id, lineNo: item.lineNo, text: item.text, dueDateJalali: item.dueDateJalali,
        state: item.state, assignees: item.assignees, tasks: item.tasks,
        meetingId: row.id, meetingCode: row.code, meetingTitle: row.title,
        meetingDateJalali: row.meetingDateJalali, meetingStatus: row.status,
        projectId: row.projectId, projectCode: row.projectCode, projectName: row.projectName,
      });
    }
  }

  /*
   * Overdue first, then the nearest deadline; an undated action last, never
   * first — an empty Shamsi string sorts before every real date.
   */
  const rank = (r: MeetingActionRow) => (r.state === "OVERDUE" ? 0 : isOpenItemState(r.state) ? 1 : r.state === "PENDING" ? 2 : 3);
  all.sort((a, b) =>
    rank(a) - rank(b)
    || (a.dueDateJalali ? 0 : 1) - (b.dueDateJalali ? 0 : 1)
    || String(a.dueDateJalali ?? "").localeCompare(String(b.dueDateJalali ?? ""))
    || String(b.meetingDateJalali ?? "").localeCompare(String(a.meetingDateJalali ?? ""))
    || a.lineNo - b.lineNo);

  const { skip, take } = paginationArgs(q);
  return {
    ...buildResult(all.slice(skip, skip + take), all.length, q),
    truncated: meetings.length >= MEETING_SCAN_LIMIT,
  };
}

/* --------------------------------- writing -------------------------------- */

type Tx = Prisma.TransactionClient;

interface CreatedTask { id: string; userId: string; name: string; title: string; dueDateJalali: string | null }

/**
 * Brings the board into step with the items as they now stand.
 *
 * Only ever called on finalised minutes. Cancels what is no longer owed (a
 * conditional `updateMany`, so a task somebody already finished is left
 * finished), raises what is newly owed, and carries an edited item's words and
 * date onto the tasks still open for it. Returns what it raised, so the
 * notifications can go after the commit.
 */
async function syncTasks(
  tx: Tx,
  meeting: { id: string; code: string; title: string; meetingDateJalali: string | null },
  previous: StoredItem[],
  next: (StoredItem & { text: string; dueDateJalali: string | null })[],
  user: AuthUser,
  authorName: string | null,
  todayJalali: string,
): Promise<{ created: CreatedTask[]; cancelled: number }> {
  const plan = planTaskSync(previous, next);

  if (plan.cancel.length > 0) {
    await tx.task.updateMany({
      where: { id: { in: plan.cancel }, ...OPEN_TASK },
      data: {
        status: TASK_CANCELLED,
        ...expandDateFields({ completedAt: todayJalali }, ["completedAt"]),
      },
    });
  }

  const byItem = new Map(next.map((i) => [i.id, i]));
  for (const keep of plan.keep) {
    const item = byItem.get(keep.itemId)!;
    await tx.task.updateMany({
      where: { id: keep.taskId, ...OPEN_TASK },
      data: {
        title: meetingTaskTitle(item.text),
        description: meetingTaskDescription(meeting, item.text),
        ...expandDateFields({ dueDate: item.dueDateJalali }, ["dueDate"]),
      },
    });
  }

  const created: CreatedTask[] = [];
  const newLinks = new Map<string, { userId: string; taskId: string }[]>();
  for (const want of plan.create) {
    const item = byItem.get(want.itemId)!;
    const task = await tx.task.create({
      data: {
        title: meetingTaskTitle(item.text),
        description: meetingTaskDescription(meeting, item.text),
        relatedToType: MEETING_TASK_RELATION,
        relatedToId: meeting.id,
        relatedToName: `${meeting.code} — ${meeting.title}`.slice(0, 400),
        priority: "متوسط",
        status: TASK_TODO,
        ...expandDateFields({ dueDate: item.dueDateJalali }, ["dueDate"]),
        assignedToUserId: want.userId,
        assignedToName: want.name || null,
        createdByUserId: user.id,
        createdByName: authorName,
      } as Prisma.TaskUncheckedCreateInput,
    });
    const list = newLinks.get(want.itemId) ?? [];
    list.push({ userId: want.userId, taskId: task.id });
    newLinks.set(want.itemId, list);
    created.push({
      id: task.id, userId: want.userId, name: want.name, title: task.title,
      dueDateJalali: item.dueDateJalali,
    });
  }

  // Each item's links: the ones kept, plus the ones just raised.
  const keptByItem = new Map<string, { userId: string; taskId: string }[]>();
  for (const k of plan.keep) {
    const list = keptByItem.get(k.itemId) ?? [];
    list.push({ userId: k.userId, taskId: k.taskId });
    keptByItem.set(k.itemId, list);
  }
  for (const item of next) {
    const links = [...(keptByItem.get(item.id) ?? []), ...(newLinks.get(item.id) ?? [])];
    await tx.meetingItem.update({
      where: { id: item.id },
      data: { taskLinks: links.length > 0 ? JSON.stringify(links) : null },
    });
  }
  return { created, cancelled: plan.cancel.length };
}

/**
 * Both keys always present, rather than a discriminated union: `strict` is off
 * in this tsconfig, so a union on `ok` does not narrow (see CLAUDE.md).
 */
export interface MeetingWriteOutcome {
  ok: boolean;
  meeting: MeetingRow | null;
  createdTasks: number;
  cancelledTasks: number;
  error: string | null;
  status: 200 | 400 | 403 | 404;
}

const refused = (error: string, status: 400 | 403 | 404): MeetingWriteOutcome =>
  ({ ok: false, meeting: null, createdTasks: 0, cancelledTasks: 0, error, status });

async function nextMeetingCode(): Promise<string> {
  const db = getDb();
  return nextDocumentNumber({
    formatKey: "meetingFormat", startSeqKey: "meetingStartSeq",
    fallbackFormat: "MOM-{YY}{MM}-{SEQ:3}",
    existing: async (prefix) => (await db.meeting.findMany({
      where: { code: { startsWith: prefix } }, select: { code: true },
    })).map((r) => r.code),
    taken: async (v) => !!(await db.meeting.findUnique({ where: { code: v }, select: { id: true } })),
  });
}

/**
 * Creates (`id` absent) or updates minutes, finalising them when asked.
 *
 * Once final, minutes stay final: un-finalising would have to decide what
 * becomes of tasks people have already started, and «remove the item» already
 * answers that one item at a time.
 */
export async function saveMeeting(
  id: string | null,
  input: MeetingInput,
  user: AuthUser,
  todayJalali: string,
): Promise<MeetingWriteOutcome> {
  const db = getDb();
  const items = parseItems(input.items);
  const attendees = parseParticipants(input.attendees);
  const absentees = parseParticipants(input.absentees);

  let existing: RawMeeting | null = null;
  if (id) {
    const visibility = visibilityClause(user);
    existing = await db.meeting.findFirst({
      where: visibility ? { AND: [{ id }, visibility] } : { id },
      select: ROW_SELECT,
    });
    if (!existing) return refused("صورتجلسه یافت نشد.", 404);
    if (!mayEdit(user, existing)) {
      return refused("فقط ثبت‌کننده صورتجلسه یا مدیر می‌تواند آن را ویرایش کند.", 403);
    }
  }

  const wasFinal = existing ? meetingStatus(existing.status) === "FINAL" : false;
  const finalizing = wasFinal || input.finalize === true || input.finalize === "true";
  const meetingDate = toNullableString(input.meetingDate, 10);
  const title = toNullableString(input.title, 300);
  const refusal = meetingRefusal({ title, meetingDateJalali: meetingDate, items }, finalizing);
  if (refusal) return refused(refusal, 400);

  // The project must exist; an id from a browser is not evidence that it does.
  const projectId = toNullableString(input.projectId, 36);
  if (projectId) {
    const found = await db.project.findUnique({ where: { id: projectId }, select: { id: true } });
    if (!found) return refused("پروژه انتخاب‌شده یافت نشد.", 400);
  }

  const author = await db.user.findUnique({ where: { id: user.id }, select: { fullName: true } });
  const authorName = author?.fullName ?? null;
  const code = existing?.code ?? await nextMeetingCode();
  const creatorId = existing ? existing.createdByUserId : user.id;
  const memberIndex = memberIndexOf(
    creatorId,
    [...attendees, ...absentees],
    items.flatMap((i) => i.assignees.map((a) => a.userId)),
  );

  const scalars = {
    title: title!,
    ...expandDateFields({ meetingDate, nextMeetingDate: toNullableString(input.nextMeetingDate, 10) },
      ["meetingDate", "nextMeetingDate"]),
    startTime: timeOf(input.startTime),
    endTime: timeOf(input.endTime),
    place: toNullableString(input.place, 200),
    summary: toNullableString(input.summary),
    projectId,
    attendees: attendees.length > 0 ? JSON.stringify(attendees) : null,
    absentees: absentees.length > 0 ? JSON.stringify(absentees) : null,
    memberIndex: memberIndex || null,
    attachments: attachmentListColumn(
      Array.isArray(input.attachments) ? (input.attachments as ActivityAttachment[]) : []),
  };

  const result = await db.$transaction(async (tx) => {
    const meeting = existing
      ? await tx.meeting.update({
          where: { id: existing.id },
          data: {
            ...scalars,
            ...(finalizing && !wasFinal
              ? { status: "FINAL", finalizedAt: new Date(), finalizedByName: authorName }
              : {}),
          } as Prisma.MeetingUncheckedUpdateInput,
        })
      : await tx.meeting.create({
          data: {
            ...scalars,
            code,
            status: finalizing ? "FINAL" : "DRAFT",
            createdByUserId: user.id,
            createdByName: authorName,
            ...(finalizing ? { finalizedAt: new Date(), finalizedByName: authorName } : {}),
          } as Prisma.MeetingUncheckedCreateInput,
        });

    /*
     * Items by id. A stored item the request no longer names was removed —
     * its row goes (the cascade would take it with the meeting anyway), and
     * the plan below cancels whatever it had raised.
     */
    const previous: StoredItem[] = (existing?.items ?? []).map((i) => ({
      id: i.id,
      kind: meetingItemKind(i.kind),
      assignees: parseAssignees(i.assignees),
      taskLinks: parseTaskLinks(i.taskLinks),
    }));
    const prevIds = new Set(previous.map((p) => p.id));
    const next: (StoredItem & { text: string; dueDateJalali: string | null })[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const data = {
        lineNo: i + 1,
        text: item.text,
        kind: item.kind,
        assignees: item.assignees.length > 0 ? JSON.stringify(item.assignees) : null,
        ...expandDateFields({ dueDate: item.dueDateJalali ?? null }, ["dueDate"]),
      };
      let itemId: string;
      if (item.id && prevIds.has(item.id)) {
        await tx.meetingItem.update({ where: { id: item.id }, data });
        itemId = item.id;
      } else {
        // An id the meeting never had is a new item, not somebody else's.
        const created = await tx.meetingItem.create({ data: { ...data, meetingId: meeting.id } });
        itemId = created.id;
      }
      next.push({
        id: itemId, kind: item.kind, assignees: item.assignees,
        taskLinks: previous.find((p) => p.id === itemId)?.taskLinks ?? [],
        text: item.text, dueDateJalali: item.dueDateJalali ?? null,
      });
    }
    const keptIds = new Set(next.map((n) => n.id));
    const removed = previous.filter((p) => !keptIds.has(p.id)).map((p) => p.id);
    if (removed.length > 0) await tx.meetingItem.deleteMany({ where: { id: { in: removed } } });

    if (!finalizing) return { meetingId: meeting.id, created: [] as CreatedTask[], cancelled: 0 };
    const synced = await syncTasks(
      tx,
      { id: meeting.id, code, title: title!, meetingDateJalali: meetingDate },
      previous, next, user, authorName, todayJalali,
    );
    return { meetingId: meeting.id, ...synced };
  });

  await afterCommit("meeting audit", () => logAction(
    {
      action: existing ? "UPDATE" : "CREATE",
      module: "صورتجلسات",
      entityId: result.meetingId,
      description: `${existing ? "ویرایش" : "ثبت"} صورتجلسه ${code}: ${title}`,
    },
    user,
    todayJalali,
  ));

  for (const task of result.created) {
    await afterCommit("meeting action SMS", async () => {
      await notifyStaff({
        kind: "TASK_ASSIGNED",
        assigneeUserId: task.userId,
        actorUserId: user.id,
        actorName: authorName,
        title: task.title,
        taskKind: "GENERAL",
        dueDate: task.dueDateJalali,
        priority: "متوسط",
        projectId,
        entityType: "task",
        entityId: task.id,
      });
    });
  }

  // The project's own history, once — when the minutes become final.
  if (finalizing && !wasFinal && projectId) {
    await afterCommit("meeting finalised fact", async () => {
      const actions = items.filter((i) => i.kind === "ACTION").length;
      const decisions = items.filter((i) => i.kind === "DECISION").length;
      await logProjectFact({
        projectId,
        categoryName: ACTIVITY_CATEGORY.MEETINGS,
        text: `صورتجلسه ${code} «${title}» (${meetingDate}) توسط ${authorName ?? "کاربر"} نهایی شد`
          + ` — ${decisions} مصوبه و ${actions} اقدام`
          + (result.created.length > 0 ? `؛ ${result.created.length} وظیفه ارجاع شد.` : "."),
        sourceType: "meeting",
        sourceId: result.meetingId,
      }, user, todayJalali);
    });
  }

  const meeting = await getMeeting(result.meetingId, user, todayJalali);
  return {
    ok: true, meeting, createdTasks: result.created.length, cancelledTasks: result.cancelled,
    error: null, status: 200,
  };
}

/**
 * Deletes minutes. The tasks they raised are **cancelled**, never deleted —
 * somebody may be half way through one, and the board's record of that
 * outlives the minutes.
 */
export async function deleteMeeting(
  id: string,
  user: AuthUser,
  todayJalali: string,
): Promise<"ok" | "not-found" | "forbidden"> {
  const db = getDb();
  const visibility = visibilityClause(user);
  const meeting = await db.meeting.findFirst({
    where: visibility ? { AND: [{ id }, visibility] } : { id },
    select: ROW_SELECT,
  });
  if (!meeting) return "not-found";
  if (!mayEdit(user, meeting)) return "forbidden";

  const taskIds = meeting.items.flatMap((i) => parseTaskLinks(i.taskLinks).map((l) => l.taskId));
  await db.$transaction(async (tx) => {
    if (taskIds.length > 0) {
      await tx.task.updateMany({
        where: { id: { in: taskIds }, ...OPEN_TASK },
        data: {
          status: TASK_CANCELLED,
          ...expandDateFields({ completedAt: todayJalali }, ["completedAt"]),
        },
      });
    }
    await tx.meeting.delete({ where: { id } });
  });

  await afterCommit("meeting audit", () => logAction(
    {
      action: "DELETE",
      module: "صورتجلسات",
      entityId: id,
      description: `حذف صورتجلسه ${meeting.code}: ${meeting.title}`,
      beforeState: meeting,
    },
    user,
    todayJalali,
  ));
  return "ok";
}
