import type { BoardLane } from "../utils/workBoard";
import { ListResponse, api } from "./client";
import type { Task } from "../types";

/**
 * Task endpoints.
 *
 * Scoped by assignment: a user without the tasks permission sees the tasks
 * assigned to them, which is the whole module for that user. "Overdue" is a
 * date comparison in the query, not a filter applied after the page arrives.
 */

export interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  priority: string;
  status: string;
  relatedToType: string | null;
  relatedToId: string | null;
  relatedToName: string | null;
  /** Who raised it. Half of who may see it; null on rows written before it. */
  createdByUserId: string | null;
  createdByName: string | null;
  /** When the work was picked up. Null until it leaves «برای انجام». */
  startedAtJalali?: string | null;
  /** When it closed. Cleared if the card is moved back out of «انجام شده». */
  completedAtJalali?: string | null;
  /** GENERAL | SALES_FOLLOW_UP — what pressing the card on the board does. */
  taskKind?: string | null;
  /** What the customer said, and the note about the call that closed this. */
  followUpResult?: string | null;
  completionNote?: string | null;
  /**
   * The job behind the task, resolved on the server.
   *
   * `relatedToName` is one string the browser looked up in a picker's current
   * matches when the task was saved; this is the project as it is now, with the
   * customer behind it, and it is there for a task on a proforma too — a sales
   * follow-up names a quotation, and the person reading their list wants to
   * know whose job it is.
   */
  relatedProject: {
    id: string; code: string; name: string; customerName: string | null;
  } | null;
  dueDate: string | null;
  dueDateJalali: string | null;
  assignedToUserId: string | null;
  assignedToName: string | null;
  reminderEnabled: boolean;
  reminderDateJalali: string | null;
  reminderTime: string | null;
  createdAt: string;
  /** The task card draws a custom-fields block from these. */
  customValues: string | null;
}

export interface TaskSummary {
  byStatus: { status: string; count: number }[];
  total: number;
  overdue: number;
  dueToday: number;
}

export interface TaskWriteInput {
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

export const tasksApi = {
  list: (query: Record<string, string | number | boolean | undefined>, signal?: AbortSignal) =>
    api.get<ListResponse<TaskRow>>("/api/tasks", query, signal),

  get: (id: string) => api.get<{ task: TaskRow }>(`/api/tasks/${id}`).then((r) => r.task),

  /** Open, overdue and due-today counts, aggregated in SQL. */
  summary: () => api.get<{ summary: TaskSummary }>("/api/tasks/summary").then((r) => r.summary),

  /**
   * Moves several cards into one column.
   *
   * Tasks and referrals travel in the same call because the board does not
   * distinguish them — a person drags a card, not a record type — and one
   * request keeps a column from rearranging itself an item at a time.
   *
   * `refused` is reported rather than swallowed: a card that would not move is
   * one the person can see sitting where they left it, and silence there reads
   * as the board being broken.
   */
  moveToLane: (lane: BoardLane, ids: { taskIds?: string[]; referralIds?: string[] }) =>
    api.post<{ moved: number; refused: number }>("/api/tasks/board/move", { lane, ...ids }),

  create: (input: TaskWriteInput) =>
    api.post<{ task: TaskRow }>("/api/tasks", input).then((r) => r.task),

  update: (id: string, input: TaskWriteInput) =>
    api.put<{ task: TaskRow }>(`/api/tasks/${id}`, input).then((r) => r.task),

  remove: (id: string) => api.delete<Record<string, never>>(`/api/tasks/${id}`),
};

/* ------------------------------- adapter ------------------------------- */

function parseTaskJson(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    return (JSON.parse(raw) ?? {}) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** A row, in the shape the existing markup expects. */
export function rowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? "",
    relatedToType: (row.relatedToType ?? undefined) as Task["relatedToType"],
    relatedToId: row.relatedToId ?? undefined,
    relatedToName: row.relatedToName ?? undefined,
    createdByName: row.createdByName ?? undefined,
    // The board's own three: when work started, when it closed, and what kind
    // of work it is — the last of which decides what pressing the card does.
    startedAt: row.startedAtJalali ?? undefined,
    completedAt: row.completedAtJalali ?? undefined,
    taskKind: row.taskKind ?? undefined,
    /*
      What came of the chase, printed on the card.

      A follow-up's two halves are on two different rows — the note belongs to
      the call that ended, the description to the one being asked for — and the
      card had neither, so a completed follow-up said only «انجام شده».
    */
    followUpResult: row.followUpResult ?? undefined,
    completionNote: row.completionNote ?? undefined,
    createdAt: row.createdAt,
    relatedProject: row.relatedProject ?? undefined,
    priority: row.priority as Task["priority"],
    status: row.status as Task["status"],
    dueDate: row.dueDateJalali ?? "",
    assignedTo: row.assignedToName ?? "",
    // Carried so a save from the board or the calendar writes the assignee
    // back as it found them. Without it every edit sent a null id and detached
    // the task from its owner, leaving only the name behind.
    assignedToUserId: row.assignedToUserId ?? undefined,
    reminderEnabled: row.reminderEnabled,
    reminderDate: row.reminderDateJalali ?? undefined,
    reminderTime: row.reminderTime ?? undefined,
    // The card draws a custom-fields block from these. Tasks have no detail
    // endpoint at all — the row *is* the record here, so a field the adapter
    // drops is gone for good.
    customValues: parseTaskJson(row.customValues),
  } as Task;
}

/**
 * A form's state, as the write endpoint wants it.
 *
 * The assignee is carried as both an id and a name: the id is what the server
 * scopes visibility by, the name is what stays readable if the account is later
 * removed.
 */
export function taskToWriteInput(
  task: Partial<Task> & { assignedToUserId?: string | null },
): TaskWriteInput {
  return {
    title: task.title,
    description: task.description ?? null,
    relatedToType: task.relatedToType ?? null,
    relatedToId: task.relatedToId ?? null,
    relatedToName: task.relatedToName ?? null,
    priority: task.priority,
    status: task.status,
    dueDate: task.dueDate ?? null,
    assignedToUserId: task.assignedToUserId ?? null,
    assignedToName: task.assignedTo ?? null,
    reminderEnabled: task.reminderEnabled,
    reminderDate: task.reminderDate ?? null,
    reminderTime: task.reminderTime ?? null,
  };
}
