import { TASK_CANCELLED, TASK_DONE } from "./workBoard";

/**
 * «صورتجلسات» — the pure half.
 *
 * A meeting is a record of what was said and, more importantly, of what was
 * agreed: each item is a **decision** (مصوبه), an **action** (اقدام) somebody
 * owes by a date, or an **information** item (اطلاع). Only an action owes
 * anything, so only an action becomes work — finalising the minutes raises one
 * task per assignee per action, and the item's own status is then *derived*
 * from those tasks rather than stored beside them. A status column on the item
 * would be a second copy of «is it done», and the two would disagree the first
 * time somebody ticked the task on the board.
 *
 * Why a task and not a referral: a referral belongs to a project's activity
 * feed, and half of all meetings here are internal and belong to no project.
 * A task already reaches its owner's board, earns the due-date reminder and the
 * staff notification, and is searchable — none of which would have to be
 * written a second time.
 */

export const MEETING_ITEM_KINDS = ["DECISION", "ACTION", "INFO"] as const;
export type MeetingItemKind = (typeof MEETING_ITEM_KINDS)[number];

export const MEETING_ITEM_KIND_LABELS: Record<MeetingItemKind, string> = {
  DECISION: "مصوبه",
  ACTION: "اقدام",
  INFO: "اطلاع",
};

/** An unknown stored value reads as a decision: it owes nothing and raises nothing. */
export function meetingItemKind(value: unknown): MeetingItemKind {
  const v = String(value ?? "").trim().toUpperCase();
  return (MEETING_ITEM_KINDS as readonly string[]).includes(v) ? (v as MeetingItemKind) : "DECISION";
}

export const MEETING_STATUSES = ["DRAFT", "FINAL"] as const;
export type MeetingStatus = (typeof MEETING_STATUSES)[number];
export const MEETING_STATUS_LABELS: Record<MeetingStatus, string> = {
  DRAFT: "پیش‌نویس",
  FINAL: "نهایی",
};
export function meetingStatus(value: unknown): MeetingStatus {
  return String(value ?? "") === "FINAL" ? "FINAL" : "DRAFT";
}

/* ------------------------------ participants ------------------------------ */

/**
 * Somebody at the meeting — or somebody who should have been.
 *
 * A colleague is named by **account id**, since that is what decides who may
 * see the minutes; a guest is somebody from the customer's side, picked from
 * the customers directory where they are in it (`customerId`) and typed in
 * where they are not.
 */
export interface MeetingParticipant {
  kind: "user" | "contact";
  userId?: string | null;
  customerId?: string | null;
  name: string;
  organization?: string | null;
}

export function parseParticipants(json: unknown): MeetingParticipant[] {
  let raw: unknown = json;
  if (typeof json === "string") {
    try { raw = JSON.parse(json); } catch { return []; }
  }
  if (!Array.isArray(raw)) return [];
  const out: MeetingParticipant[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const name = String(e.name ?? "").trim();
    const userId = e.userId ? String(e.userId) : null;
    const customerId = e.customerId ? String(e.customerId) : null;
    if (!name && !userId) continue;
    const kind = userId ? "user" : "contact";
    // The same colleague ticked twice is one attendee, and so is one guest.
    const key = userId ? `u:${userId}` : customerId ? `c:${customerId}` : `n:${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      kind,
      userId,
      customerId,
      name: name.slice(0, 200),
      organization: e.organization ? String(e.organization).slice(0, 200) : null,
    });
  }
  return out;
}

export interface MeetingAssignee { userId: string; name: string }

export function parseAssignees(json: unknown): MeetingAssignee[] {
  let raw: unknown = json;
  if (typeof json === "string") {
    try { raw = JSON.parse(json); } catch { return []; }
  }
  if (!Array.isArray(raw)) return [];
  const out: MeetingAssignee[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const e = (entry ?? {}) as Record<string, unknown>;
    const userId = String(e.userId ?? "").trim();
    if (!userId || seen.has(userId)) continue;
    seen.add(userId);
    out.push({ userId, name: String(e.name ?? "").trim().slice(0, 200) });
  }
  return out;
}

export interface MeetingTaskLink { userId: string; taskId: string }

export function parseTaskLinks(json: unknown): MeetingTaskLink[] {
  let raw: unknown = json;
  if (typeof json === "string") {
    try { raw = JSON.parse(json); } catch { return []; }
  }
  if (!Array.isArray(raw)) return [];
  return raw
    .map((e) => (e ?? {}) as Record<string, unknown>)
    .filter((e) => e.userId && e.taskId)
    .map((e) => ({ userId: String(e.userId), taskId: String(e.taskId) }));
}

/**
 * Everybody the minutes concern, as `,id,id,` — the creator, every colleague at
 * the meeting or absent from it, and every assignee.
 *
 * Absentees are in it on purpose: «you missed this, here is what was decided»
 * is half of why minutes are written down. The leading and trailing commas are
 * what make `contains: ",<id>,"` an exact match rather than a substring of a
 * longer id.
 */
export function memberIndexOf(
  creatorId: string | null | undefined,
  people: MeetingParticipant[],
  assigneeIds: string[],
): string {
  const ids = new Set<string>();
  if (creatorId) ids.add(creatorId);
  for (const p of people) if (p.userId) ids.add(p.userId);
  for (const id of assigneeIds) if (id) ids.add(id);
  return ids.size === 0 ? "" : `,${[...ids].join(",")},`;
}

/* ------------------------------ an item's state ---------------------------- */

export const MEETING_ITEM_STATES = ["NONE", "PENDING", "OPEN", "OVERDUE", "DONE", "CANCELLED"] as const;
export type MeetingItemState = (typeof MEETING_ITEM_STATES)[number];

export const MEETING_ITEM_STATE_LABELS: Record<MeetingItemState, string> = {
  NONE: "",
  PENDING: "در انتظار نهایی شدن",
  OPEN: "باز",
  OVERDUE: "عقب‌افتاده",
  DONE: "انجام شده",
  CANCELLED: "لغو شده",
};

/**
 * Where an item has got to, read off its tasks.
 *
 * A decision and an information item owe nothing (`NONE`). An action whose
 * tasks do not exist yet is `PENDING` — the minutes are a draft, nothing has
 * been handed out. Otherwise: done when **every** assignee's task is done (an
 * action shared by two people is finished when both are), cancelled when every
 * one was cancelled, and open — overdue once its date has passed — while any
 * is still in hand. A task that cannot be found (deleted from the board) is
 * not evidence of anything and is left out; if none are left, it is pending.
 *
 * Shamsi dates compare as strings because they are zero-padded `YYYY/MM/DD`.
 */
export function meetingItemState(
  kind: MeetingItemKind,
  taskStatuses: (string | null | undefined)[],
  dueDateJalali: string | null | undefined,
  todayJalali: string,
): MeetingItemState {
  if (kind !== "ACTION") return "NONE";
  const known = taskStatuses.filter((s): s is string => typeof s === "string");
  if (known.length === 0) return "PENDING";
  if (known.every((s) => s === TASK_CANCELLED)) return "CANCELLED";
  const live = known.filter((s) => s !== TASK_CANCELLED);
  if (live.every((s) => s === TASK_DONE)) return "DONE";
  if (dueDateJalali && dueDateJalali < todayJalali) return "OVERDUE";
  return "OPEN";
}

export const isOpenItemState = (state: MeetingItemState): boolean =>
  state === "OPEN" || state === "OVERDUE";

/* ------------------------------- validation ------------------------------- */

export interface MeetingItemDraft {
  id?: string | null;
  text: string;
  kind: MeetingItemKind;
  assignees: MeetingAssignee[];
  dueDateJalali?: string | null;
}

/**
 * Why these minutes cannot be saved, or null.
 *
 * A draft may be half-written — it is a draft — so only the title, the date
 * and non-empty items are asked of it. Finalising asks more: an action with
 * nobody on it or no date is a promise made to nobody, and raising a task for
 * it would put a card on no board or an undated card at the bottom of one,
 * which is exactly the work that goes missing.
 */
export function meetingRefusal(
  input: { title?: string | null; meetingDateJalali?: string | null; items: MeetingItemDraft[] },
  finalizing: boolean,
): string | null {
  if (!String(input.title ?? "").trim()) return "عنوان جلسه را وارد کنید.";
  if (!String(input.meetingDateJalali ?? "").trim()) return "تاریخ جلسه را وارد کنید.";
  for (let i = 0; i < input.items.length; i++) {
    const item = input.items[i];
    const row = i + 1;
    if (!String(item.text ?? "").trim()) return `متن بند ${row} خالی است.`;
    if (!finalizing || item.kind !== "ACTION") continue;
    if (item.assignees.length === 0) return `برای اقدام بند ${row} مسئولی انتخاب نشده است.`;
    if (!String(item.dueDateJalali ?? "").trim()) return `برای اقدام بند ${row} مهلت انجام تعیین نشده است.`;
  }
  return null;
}

/* --------------------------- keeping tasks in step ------------------------- */

export interface StoredItem {
  id: string;
  kind: MeetingItemKind;
  assignees: MeetingAssignee[];
  taskLinks: MeetingTaskLink[];
}

export interface TaskSyncPlan {
  /** Raise a task for this assignee of this item. */
  create: { itemId: string; userId: string; name: string }[];
  /** These tasks are no longer owed by anybody: cancel them, never delete. */
  cancel: string[];
  /** These stay, and follow the item's text and date. */
  keep: { itemId: string; userId: string; taskId: string }[];
}

/**
 * What finalising — or editing finalised minutes — has to do to the board.
 *
 * Compared against the links **as stored**, so it is idempotent: run twice it
 * plans nothing the second time. A task whose item was removed, whose item is
 * no longer an action, or whose assignee was taken off is **cancelled rather
 * than deleted** — it may have been half done, and the board's own history of
 * that is worth more than a tidy list. An assignee added later gets a task of
 * their own; one who stays keeps theirs.
 *
 * `next` lists the items as they will stand, with the id each was stored under
 * (a new item has its id assigned before this is asked). Items in `previous`
 * absent from `next` were removed.
 */
export function planTaskSync(previous: StoredItem[], next: StoredItem[]): TaskSyncPlan {
  const plan: TaskSyncPlan = { create: [], cancel: [], keep: [] };
  const nextById = new Map(next.map((i) => [i.id, i]));

  for (const old of previous) {
    const now = nextById.get(old.id);
    for (const link of old.taskLinks) {
      const stillOwed = now
        && now.kind === "ACTION"
        && now.assignees.some((a) => a.userId === link.userId);
      if (!stillOwed) plan.cancel.push(link.taskId);
    }
  }

  const prevById = new Map(previous.map((i) => [i.id, i]));
  for (const item of next) {
    if (item.kind !== "ACTION") continue;
    const links = prevById.get(item.id)?.taskLinks ?? item.taskLinks;
    for (const a of item.assignees) {
      const link = links.find((l) => l.userId === a.userId);
      if (link) plan.keep.push({ itemId: item.id, userId: a.userId, taskId: link.taskId });
      else plan.create.push({ itemId: item.id, userId: a.userId, name: a.name });
    }
  }
  return plan;
}

/** The title a raised task carries: the item itself, which is the work. */
export function meetingTaskTitle(itemText: string): string {
  const oneLine = String(itemText ?? "").replace(/\s+/g, " ").trim();
  return oneLine.length > 180 ? `${oneLine.slice(0, 177)}…` : oneLine;
}

/** And what it says about where it came from. */
export function meetingTaskDescription(
  meeting: { code: string; title: string; meetingDateJalali?: string | null },
  itemText: string,
): string {
  const when = meeting.meetingDateJalali ? ` (${meeting.meetingDateJalali})` : "";
  return `${String(itemText ?? "").trim()}\n\nمصوبه صورتجلسه ${meeting.code} — ${meeting.title}${when}`;
}
