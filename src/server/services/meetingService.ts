import { Prisma } from "@prisma/client";
import { MAX_TRAIL_TASKS, orderTrail, parseHandoffs } from "../../utils/taskHandoff";
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
  MeetingStatus, MeetingTopicDraft, StoredItem, isOpenItemState, meetingItemKind, meetingItemState, meetingRefusal,
  meetingStatus, meetingTaskDescription, meetingTaskTitle, memberIndexOf, parseAssignees,
  parseParticipants, parseTaskLinks, planTaskSync, topicProjects,
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
  /**
   * Only read when `topics` is absent: a caller written before topics existed
   * (n8n, an older tab) sends `projectId` and a flat `items`, and gets one
   * topic titled as the meeting — exactly what every stored meeting became.
   */
  projectId?: unknown;
  /** `[{id?, title, projectId?, discussion?, conclusion?, items: [...]}]` */
  topics?: unknown;
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

/**
 * The topics as posted, or — for a caller that sends none — the flat items
 * wrapped in one topic titled as the meeting.
 */
export function parseTopics(input: MeetingInput, meetingTitle: string | null): MeetingTopicDraft[] {
  if (Array.isArray(input.topics)) {
    return input.topics.map((entry) => {
      const e = (entry ?? {}) as Record<string, unknown>;
      return {
        id: e.id ? String(e.id) : null,
        title: String(e.title ?? "").trim().slice(0, 300),
        projectId: toNullableString(e.projectId, 36),
        discussion: toNullableString(e.discussion),
        conclusion: toNullableString(e.conclusion),
        items: parseItems(e.items),
      };
    });
  }
  const items = parseItems(input.items);
  const projectId = toNullableString(input.projectId, 36);
  if (items.length === 0 && !projectId) return [];
  return [{ id: null, title: meetingTitle ?? "", projectId, discussion: null, conclusion: null, items }];
}

/* --------------------------------- reading -------------------------------- */

export interface MeetingItemRow {
  id: string;
  topicId: string | null;
  lineNo: number;
  text: string;
  kind: MeetingItemKind;
  assignees: MeetingAssignee[];
  dueDateJalali: string | null;
  state: MeetingItemState;
  /** One per assignee who has a task, with where that task has got to. */
  tasks: { userId: string; taskId: string; assigneeName: string; status: string | null }[];
}

export interface MeetingTopicRow {
  /** Empty for the stand-in topic of a meeting stored with items and no topic. */
  id: string;
  lineNo: number;
  title: string;
  projectId: string | null;
  projectCode: string | null;
  projectName: string | null;
  customerName: string | null;
  discussion: string | null;
  conclusion: string | null;
  /** Present on a detail read and on every list row (the counts need them). */
  items: MeetingItemRow[];
}

export interface MeetingProjectRef {
  id: string;
  code: string | null;
  name: string | null;
  customerName: string | null;
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
  /** The distinct projects its topics name; empty for an internal meeting. */
  projects: MeetingProjectRef[];
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
  topicCount: number;
  topics: MeetingTopicRow[];
}

const TOPIC_PROJECT_SELECT = {
  select: { id: true, code: true, name: true, customer: { select: { companyName: true } } },
} as const;

const ROW_SELECT = {
  id: true, code: true, title: true, meetingDateJalali: true, startTime: true, endTime: true,
  place: true, summary: true, status: true, attendees: true, absentees: true,
  nextMeetingDateJalali: true, attachments: true, createdByUserId: true, createdByName: true,
  finalizedByName: true, createdAt: true,
  topics: {
    select: {
      id: true, lineNo: true, title: true, projectId: true, discussion: true, conclusion: true,
      project: TOPIC_PROJECT_SELECT,
    },
    orderBy: { lineNo: "asc" as const },
  },
  items: {
    select: {
      id: true, topicId: true, lineNo: true, text: true, kind: true, assignees: true,
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
      topicId: item.topicId,
      lineNo: item.lineNo,
      text: item.text,
      kind,
      assignees,
      dueDateJalali: item.dueDateJalali,
      state: meetingItemState(kind, linked.map((t) => t.status), item.dueDateJalali, todayJalali),
      tasks: linked,
    };
  });

  const topics: MeetingTopicRow[] = m.topics.map((t) => ({
    id: t.id,
    lineNo: t.lineNo,
    title: t.title,
    projectId: t.projectId,
    projectCode: t.project?.code ?? null,
    projectName: t.project?.name ?? null,
    customerName: t.project?.customer?.companyName ?? null,
    discussion: t.discussion,
    conclusion: t.conclusion,
    items: [],
  }));
  /*
   * An item whose topic is not among the meeting's — never written by this
   * build, but a row is not evidence of its own consistency — goes under the
   * first topic, or under a stand-in titled as the meeting, rather than
   * vanishing from minutes somebody is reading.
   */
  const byId = new Map(topics.map((t) => [t.id, t]));
  for (const item of items) {
    let home = item.topicId ? byId.get(item.topicId) : undefined;
    if (!home) {
      if (topics.length === 0) {
        topics.push({
          id: "", lineNo: 1, title: m.title, projectId: null, projectCode: null, projectName: null,
          customerName: null, discussion: null, conclusion: null, items: [],
        });
      }
      home = topics[0];
    }
    home.items.push(item);
  }

  const projects: MeetingProjectRef[] = topicProjects(topics).map((t) => ({
    id: t.projectId!, code: t.projectCode, name: t.projectName, customerName: t.customerName,
  }));

  return {
    id: m.id,
    code: m.code,
    title: m.title,
    meetingDateJalali: m.meetingDateJalali,
    startTime: m.startTime,
    endTime: m.endTime,
    place: m.place,
    summary: m.summary,
    projects,
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
    topicCount: topics.length,
    topics,
  };
}

export interface MeetingFilters {
  /**
   * A project id (a meeting with at least one topic of that project),
   * «internal» (a meeting none of whose topics names a project), or absent.
   */
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
 * words, the words of its topics and items, the names of the people at it
 * (they are in the JSON as written, so a `contains` finds them), and the jobs
 * its topics were about.
 */
function searchWhere(term: string, scopeProjectId?: string | null): Prisma.MeetingWhereInput | undefined {
  /*
   * Seen from one project, a meeting is that project's piece of it: the
   * general summary and the other topics are not searched, or a row would be
   * listed under this project for words it cannot show.
   */
  const own = searchClause(term, scopeProjectId
    ? ["code", "title", "place", "attendees", "absentees"]
    : ["code", "title", "place", "summary", "attendees", "absentees"]);
  if (!own) return undefined;
  const items = scopeProjectId ? undefined : searchClause(term, ["text", "assignees"]);
  const topics = searchClause(term, ["title", "discussion", "conclusion"]);
  const project = searchClause(term, ["code", "name"]);
  const inScope = scopeProjectId ? { projectId: scopeProjectId } : {};
  return {
    OR: [
      ...(own.OR as Prisma.MeetingWhereInput[]),
      ...(items ? [{ items: { some: items as Prisma.MeetingItemWhereInput } }] : []),
      ...(topics ? [{ topics: { some: { AND: [inScope, topics as Prisma.MeetingTopicWhereInput] } } }] : []),
      ...(project ? [{ topics: { some: { ...inScope, project: project as Prisma.ProjectWhereInput } } }] : []),
    ],
  };
}

/** Item ids under a project's own topics whose words match — the item half of a scoped search. */
async function scopedItemMeetings(term: string, projectId: string): Promise<string[]> {
  const items = searchClause(term, ["text", "assignees"]);
  if (!items) return [];
  const db = getDb();
  const topics = await db.meetingTopic.findMany({ where: { projectId }, select: { id: true }, take: MEETING_SCAN_LIMIT });
  if (topics.length === 0) return [];
  const rows = await db.meetingItem.findMany({
    where: { AND: [{ topicId: { in: topics.map((t) => t.id) } }, items as Prisma.MeetingItemWhereInput] },
    select: { meetingId: true },
    take: MEETING_SCAN_LIMIT,
  });
  return [...new Set(rows.map((r) => r.meetingId))];
}

/** A project filter as a topic clause: «internal», a project id, or nothing. */
function projectFilterOf(value: unknown): string | null {
  const v = String(value ?? "").trim();
  return v && v !== "all" ? v : null;
}

/** Does this topic answer the project filter? The item-level twin of the clause below. */
export function topicMatchesProject(topicProjectId: string | null, filter: string | null): boolean {
  if (!filter) return true;
  if (filter === "internal") return !topicProjectId;
  return topicProjectId === filter;
}

export function buildMeetingWhere(
  q: { search?: string },
  filters: MeetingFilters,
  user: AuthUser,
  scopedItemIds?: string[],
): Prisma.MeetingWhereInput {
  const and: Prisma.MeetingWhereInput[] = [];
  const visibility = visibilityClause(user);
  if (visibility) and.push(visibility);

  /*
   * A meeting walks through several jobs, so «this project's meetings» is any
   * meeting with a topic of it; «internal» is one none of whose topics names a
   * project. `{ not: null }` is the plain IS NOT NULL here, not a comparison
   * against a value — there is no NULL branch to lose.
   */
  const project = projectFilterOf(filters.project);
  if (project === "internal") and.push({ topics: { none: { projectId: { not: null } } } });
  else if (project) and.push({ topics: { some: { projectId: project } } });

  const range = jalaliRangeFilter(filters.from, filters.to);
  if (range) and.push({ meetingDate: range });

  const status = String(filters.status ?? "").trim();
  if (status === "DRAFT" || status === "FINAL") and.push({ status });

  const scope = project && project !== "internal" ? project : null;
  const search = q.search ? searchWhere(q.search, scope) : undefined;
  if (search) {
    // A scoped search's item half is resolved beforehand (an item has no
    // relation to its topic for SQL to walk) and arrives as meeting ids.
    and.push(scopedItemIds && scopedItemIds.length > 0
      ? { OR: [search, { id: { in: scopedItemIds } }] }
      : search);
  }

  return and.length === 0 ? {} : and.length === 1 ? and[0] : { AND: and };
}

export async function listMeetings(
  q: ListQuery,
  filters: MeetingFilters,
  user: AuthUser,
  todayJalali: string,
) {
  const db = getDb();
  const scope = projectFilterOf(filters.project);
  const projectScope = scope && scope !== "internal" ? scope : null;
  const scopedItems = projectScope && q.search ? await scopedItemMeetings(q.search, projectScope) : undefined;
  let where = buildMeetingWhere(q, filters, user, scopedItems);

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
      .map((m) => toRow(m, tasks, user, todayJalali))
      // From a project, only its own piece's actions count.
      .filter((r) => r.topics.some((t) => topicMatchesProject(t.projectId, projectScope)
        && t.items.some((i) => isOpenItemState(i.state))))
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
  return buildResult(rows.map((m) => toRow(m, tasks, user, todayJalali)), total, q);
}

export async function getMeeting(id: string, user: AuthUser, todayJalali: string): Promise<MeetingRow | null> {
  const visibility = visibilityClause(user);
  const meeting = await getDb().meeting.findFirst({
    where: visibility ? { AND: [{ id }, visibility] } : { id },
    select: ROW_SELECT,
  });
  if (!meeting) return null;
  return toRow(meeting, await taskStatuses([meeting]), user, todayJalali);
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
        { status: "FINAL" },
        { topics: { some: { projectId } } },
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
    topicTitle: string;
    itemId: string; text: string; dueDateJalali: string | null; state: MeetingItemState;
    assignees: string[];
  }[] = [];
  for (const m of meetings) {
    const row = toRow(m, tasks, user, todayJalali);
    // Only this project's topics: an action from the internal half of the same
    // meeting is not something this project's next meeting has to ask about.
    for (const topic of row.topics) {
      if (topic.projectId !== projectId) continue;
      for (const item of topic.items) {
      if (!isOpenItemState(item.state)) continue;
      out.push({
        meetingId: row.id,
        meetingCode: row.code,
        meetingTitle: row.title,
        meetingDateJalali: row.meetingDateJalali,
        topicTitle: topic.title,
        itemId: item.id,
        text: item.text,
        dueDateJalali: item.dueDateJalali,
        state: item.state,
        assignees: item.assignees.map((a) => a.name),
      });
      }
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
  /** The topic it was raised under, and that topic's project (null: internal). */
  topicTitle: string;
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
  /*
   * The project clause is this list's own: «internal» here means an internal
   * *topic*, wherever it sits — a mixed meeting's internal actions are exactly
   * as internal as a purely internal meeting's — while the meeting list's
   * «internal» means a meeting with no project at all.
   */
  const project = projectFilterOf(filters.project);
  const where = buildMeetingWhere(q, { ...filters, project: undefined, openActions: undefined }, user);
  const topicClause: Prisma.MeetingWhereInput | null = project === "internal"
    ? { topics: { some: { projectId: null } } }
    : project ? { topics: { some: { projectId: project } } } : null;
  const meetings = await getDb().meeting.findMany({
    where: { AND: [where, { items: { some: { kind: "ACTION" } } }, ...(topicClause ? [topicClause] : [])] },
    select: ROW_SELECT,
    orderBy: [{ meetingDate: "desc" }, { createdAt: "desc" }],
    take: MEETING_SCAN_LIMIT,
  });
  const tasks = await taskStatuses(meetings);
  const stateFilter = String(filters.state ?? "open") || "open";
  const assignee = String(filters.assignee ?? "").trim();
  // The meeting clause found meetings with a topic of the project; the items
  // are narrowed to that topic too, or the internal half of a mixed meeting
  // would be listed under a project it has nothing to do with.

  const all: MeetingActionRow[] = [];
  for (const m of meetings) {
    const row = toRow(m, tasks, user, todayJalali);
    for (const topic of row.topics) {
      if (!topicMatchesProject(topic.projectId, project)) continue;
      for (const item of topic.items) {
        if (item.kind !== "ACTION") continue;
        if (!actionMatchesState(item.state, stateFilter)) continue;
        if (assignee && assignee !== "all" && !item.assignees.some((a) => a.userId === assignee)) continue;
        all.push({
          itemId: item.id, lineNo: item.lineNo, text: item.text, dueDateJalali: item.dueDateJalali,
          state: item.state, assignees: item.assignees, tasks: item.tasks,
          meetingId: row.id, meetingCode: row.code, meetingTitle: row.title,
          meetingDateJalali: row.meetingDateJalali, meetingStatus: row.status,
          topicTitle: topic.title,
          projectId: topic.projectId, projectCode: topic.projectCode, projectName: topic.projectName,
        });
      }
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

interface CreatedTask {
  id: string; userId: string; name: string; title: string; dueDateJalali: string | null;
  /** The project of the topic it was raised under — what the notice names. */
  projectId: string | null;
}

/** An item as it will stand, with the topic it sits under. */
type NextItem = StoredItem & {
  text: string;
  dueDateJalali: string | null;
  topicTitle: string;
  projectId: string | null;
};

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
  next: NextItem[],
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
        description: meetingTaskDescription(meeting, item.text, item.topicTitle),
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
        description: meetingTaskDescription(meeting, item.text, item.topicTitle),
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
      dueDateJalali: item.dueDateJalali, projectId: item.projectId,
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
  const topics = parseTopics(input, title);
  const refusal = meetingRefusal({ title, meetingDateJalali: meetingDate, topics }, finalizing);
  if (refusal) return refused(refusal, 400);

  // Each project must exist; an id from a browser is not evidence that it does.
  const projectIds = [...new Set(topics.map((t) => t.projectId).filter((v): v is string => !!v))];
  if (projectIds.length > 0) {
    const found = await db.project.count({ where: { id: { in: projectIds } } });
    if (found !== projectIds.length) return refused("یکی از پروژه‌های انتخاب‌شده یافت نشد.", 400);
  }

  const author = await db.user.findUnique({ where: { id: user.id }, select: { fullName: true } });
  const authorName = author?.fullName ?? null;
  const code = existing?.code ?? await nextMeetingCode();
  const creatorId = existing ? existing.createdByUserId : user.id;
  const allItems = topics.flatMap((t) => t.items);
  const memberIndex = memberIndexOf(
    creatorId,
    [...attendees, ...absentees],
    allItems.flatMap((i) => i.assignees.map((a) => a.userId)),
  );

  const scalars = {
    title: title!,
    ...expandDateFields({ meetingDate, nextMeetingDate: toNullableString(input.nextMeetingDate, 10) },
      ["meetingDate", "nextMeetingDate"]),
    startTime: timeOf(input.startTime),
    endTime: timeOf(input.endTime),
    place: toNullableString(input.place, 200),
    summary: toNullableString(input.summary),
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
     * Topics by id, then items by id under them. An id the meeting never had
     * is a new record, not somebody else's — so a topic or item id posted from
     * another meeting cannot be pulled into this one.
     */
    const prevTopicIds = new Set((existing?.topics ?? []).map((t) => t.id));
    const keptTopicIds = new Set<string>();
    const previous: StoredItem[] = (existing?.items ?? []).map((i) => ({
      id: i.id,
      kind: meetingItemKind(i.kind),
      assignees: parseAssignees(i.assignees),
      taskLinks: parseTaskLinks(i.taskLinks),
    }));
    const prevItemIds = new Set(previous.map((p) => p.id));
    const next: NextItem[] = [];
    let line = 0;
    for (let t = 0; t < topics.length; t++) {
      const topic = topics[t];
      const topicData = {
        lineNo: t + 1,
        title: topic.title,
        projectId: topic.projectId ?? null,
        discussion: topic.discussion ?? null,
        conclusion: topic.conclusion ?? null,
      };
      let topicId: string;
      if (topic.id && prevTopicIds.has(topic.id)) {
        await tx.meetingTopic.update({ where: { id: topic.id }, data: topicData });
        topicId = topic.id;
      } else {
        topicId = (await tx.meetingTopic.create({ data: { ...topicData, meetingId: meeting.id } })).id;
      }
      keptTopicIds.add(topicId);

      for (const item of topic.items) {
        line += 1;
        const data = {
          topicId,
          lineNo: line,
          text: item.text,
          kind: item.kind,
          assignees: item.assignees.length > 0 ? JSON.stringify(item.assignees) : null,
          ...expandDateFields({ dueDate: item.dueDateJalali ?? null }, ["dueDate"]),
        };
        let itemId: string;
        if (item.id && prevItemIds.has(item.id)) {
          await tx.meetingItem.update({ where: { id: item.id }, data });
          itemId = item.id;
        } else {
          itemId = (await tx.meetingItem.create({ data: { ...data, meetingId: meeting.id } })).id;
        }
        next.push({
          id: itemId, kind: item.kind, assignees: item.assignees,
          taskLinks: previous.find((p) => p.id === itemId)?.taskLinks ?? [],
          text: item.text, dueDateJalali: item.dueDateJalali ?? null,
          topicTitle: topic.title, projectId: topic.projectId ?? null,
        });
      }
    }
    const keptIds = new Set(next.map((n) => n.id));
    const removed = previous.filter((p) => !keptIds.has(p.id)).map((p) => p.id);
    if (removed.length > 0) await tx.meetingItem.deleteMany({ where: { id: { in: removed } } });
    // The items first: a topic is only removed once nothing sits under it.
    const removedTopics = [...prevTopicIds].filter((tid) => !keptTopicIds.has(tid));
    if (removedTopics.length > 0) {
      await tx.meetingItem.deleteMany({ where: { meetingId: meeting.id, topicId: { in: removedTopics } } });
      await tx.meetingTopic.deleteMany({ where: { id: { in: removedTopics } } });
    }

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
        projectId: task.projectId,
        entityType: "task",
        entityId: task.id,
      });
    });
  }

  /*
   * Each project's own history, once — when the minutes become final — and
   * only about its own topics: the line written on project A's feed names what
   * was concluded for A, never the internal strategy discussed after it.
   */
  if (finalizing && !wasFinal) {
    for (const projectId of projectIds) {
      const own = topics.filter((t) => t.projectId === projectId);
      await afterCommit("meeting finalised fact", async () => {
        await logProjectFact({
          projectId,
          categoryName: ACTIVITY_CATEGORY.MEETINGS,
          text: meetingFactText({ code, title: title!, meetingDateJalali: meetingDate }, authorName, own,
            result.created.filter((c) => c.projectId === projectId).length),
          sourceType: "meeting",
          sourceId: result.meetingId,
        }, user, todayJalali);
      });
    }
  }

  const meeting = await getMeeting(result.meetingId, user, todayJalali);
  return {
    ok: true, meeting, createdTasks: result.created.length, cancelledTasks: result.cancelled,
    error: null, status: 200,
  };
}

/** The line a project's feed gets when minutes discussing it are finalised. */
export function meetingFactText(
  meeting: { code: string; title: string; meetingDateJalali: string | null },
  authorName: string | null,
  topics: MeetingTopicDraft[],
  raisedTasks: number,
): string {
  const items = topics.flatMap((t) => t.items);
  const actions = items.filter((i) => i.kind === "ACTION").length;
  const decisions = items.filter((i) => i.kind === "DECISION").length;
  const lines = topics.map((t) => `• ${t.title}${t.conclusion ? ` — نتیجه: ${t.conclusion}` : ""}`);
  return `صورتجلسه ${meeting.code} «${meeting.title}» (${meeting.meetingDateJalali}) توسط ${authorName ?? "کاربر"} نهایی شد`
    + ` — ${decisions} مصوبه و ${actions} اقدام`
    + (raisedTasks > 0 ? `؛ ${raisedTasks} وظیفه ارجاع شد.` : ".")
    + (lines.length > 0 ? `\n${lines.join("\n")}` : "");
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

/* ------------------------- an action item's trail ------------------------ */

/** One task in the trail of a meeting action, as «اقدامات انجام شده» draws it. */
export interface MeetingTrailTask {
  id: string;
  previousTaskId: string | null;
  depth: number;
  title: string;
  description: string | null;
  status: string;
  assignedToName: string | null;
  createdByName: string | null;
  dueDateJalali: string | null;
  completedAtJalali: string | null;
  completionNote: string | null;
  attachments: ReturnType<typeof parseAttachmentList>;
  completionAttachments: ReturnType<typeof parseAttachmentList>;
  handoffs: ReturnType<typeof parseHandoffs>;
}

/**
 * Everything done on one action row: each assignee's own task, and every task
 * colleagues raised in continuing it (`previousTaskId`), with what each
 * recorded and handed on.
 *
 * Read through the meeting's own visibility — somebody who may open the
 * minutes may read what was done on them — and bounded (`MAX_TRAIL_TASKS`).
 * Answers null when the meeting or the item cannot be seen.
 */
export async function meetingItemTrail(
  meetingId: string,
  itemId: string,
  user: AuthUser,
): Promise<MeetingTrailTask[] | null> {
  const db = getDb();
  const visibility = visibilityClause(user);
  const meeting = await db.meeting.findFirst({
    where: visibility ? { AND: [{ id: meetingId }, visibility] } : { id: meetingId },
    select: { id: true, items: { where: { id: itemId }, select: { id: true, taskLinks: true } } },
  });
  const item = meeting?.items[0];
  if (!item) return null;
  const roots = parseTaskLinks(item.taskLinks).map((l) => l.taskId);
  if (roots.length === 0) return [];

  const select = {
    id: true, previousTaskId: true, title: true, description: true, status: true,
    assignedToName: true, createdByName: true, dueDateJalali: true, completedAtJalali: true,
    completionNote: true, attachments: true, completionAttachments: true, handoffs: true,
  } as const;
  const found = await db.task.findMany({ where: { id: { in: roots } }, select });
  // Down the chain one generation at a time — a chain is a handful of tasks.
  let frontier = found.map((t) => t.id);
  while (frontier.length > 0 && found.length < MAX_TRAIL_TASKS) {
    const next = await db.task.findMany({
      where: { previousTaskId: { in: frontier }, id: { notIn: found.map((t) => t.id) } },
      select,
      take: MAX_TRAIL_TASKS - found.length,
    });
    found.push(...next);
    frontier = next.map((t) => t.id);
  }

  return orderTrail(roots, found).map(({ task, depth }) => ({
    id: task.id,
    previousTaskId: task.previousTaskId,
    depth,
    title: task.title,
    description: task.description,
    status: task.status,
    assignedToName: task.assignedToName,
    createdByName: task.createdByName,
    dueDateJalali: task.dueDateJalali,
    completedAtJalali: task.completedAtJalali,
    completionNote: task.completionNote,
    attachments: parseAttachmentList(task.attachments),
    completionAttachments: parseAttachmentList(task.completionAttachments),
    handoffs: parseHandoffs(task.handoffs),
  }));
}
