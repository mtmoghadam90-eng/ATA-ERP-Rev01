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
  dueDate: string | null;
  dueDateJalali: string | null;
  assignedToUserId: string | null;
  assignedToName: string | null;
  reminderEnabled: boolean;
  reminderDateJalali: string | null;
  reminderTime: string | null;
  createdAt: string;
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

  create: (input: TaskWriteInput) =>
    api.post<{ task: TaskRow }>("/api/tasks", input).then((r) => r.task),

  update: (id: string, input: TaskWriteInput) =>
    api.put<{ task: TaskRow }>(`/api/tasks/${id}`, input).then((r) => r.task),

  remove: (id: string) => api.delete<Record<string, never>>(`/api/tasks/${id}`),
};

/* ------------------------------- adapter ------------------------------- */

/** A row, in the shape the existing markup expects. */
export function rowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? "",
    relatedToType: (row.relatedToType ?? undefined) as Task["relatedToType"],
    relatedToId: row.relatedToId ?? undefined,
    relatedToName: row.relatedToName ?? undefined,
    priority: row.priority as Task["priority"],
    status: row.status as Task["status"],
    dueDate: row.dueDateJalali ?? "",
    assignedTo: row.assignedToName ?? "",
    reminderEnabled: row.reminderEnabled,
    reminderDate: row.reminderDateJalali ?? undefined,
    reminderTime: row.reminderTime ?? undefined,
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
