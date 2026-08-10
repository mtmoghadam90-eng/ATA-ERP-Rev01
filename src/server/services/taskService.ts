import { Prisma } from "@prisma/client";
import { getDb } from "../db";
import { ListQuery, ListResult, buildResult, paginationArgs, searchClause } from "../listing";
import { AuthUser, hasPermission } from "../auth";
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

export function visibilityClause(user: AuthUser): Record<string, unknown> | undefined {
  if (hasPermission(user, "tasks")) return undefined;
  return { assignedToUserId: user.id };
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
  } = {},
): Record<string, unknown> {
  const and: Record<string, unknown>[] = [];

  const visibility = visibilityClause(user);
  if (visibility) and.push(visibility);

  const search = searchClause(q.search, SEARCH_FIELDS);
  if (search) and.push(search);

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
  relatedToType: true, relatedToId: true, relatedToName: true,
  dueDate: true, dueDateJalali: true,
  assignedToUserId: true, assignedToName: true,
  reminderEnabled: true, reminderDateJalali: true, reminderTime: true,
  createdAt: true,
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
  } = {},
): Promise<ListResult<Record<string, unknown>>> {
  const db = getDb();
  const where = buildTaskWhere(q, user, extra);
  const orderBy = q.sort ? { [q.sort]: q.order } : [{ dueDate: "asc" as const }, { createdAt: "desc" as const }];

  const [rows, total] = await Promise.all([
    db.task.findMany({ where, orderBy, select: LIST_SELECT, ...paginationArgs(q) }),
    db.task.count({ where }),
  ]);

  return buildResult(rows as unknown as Record<string, unknown>[], total, q);
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
  if ("status" in input) set("status", toNullableString(input.status, 30) ?? "در حال انجام");
  if ("assignedToUserId" in input) set("assignedToUserId", toNullableString(input.assignedToUserId, 36));
  if ("assignedToName" in input) set("assignedToName", toNullableString(input.assignedToName, 200));
  if ("reminderEnabled" in input) set("reminderEnabled", !!input.reminderEnabled);
  if ("reminderTime" in input) set("reminderTime", toNullableString(input.reminderTime, 5));
  if ("customValues" in input) set("customValues", toJsonColumn(input.customValues));

  return { ...out, ...expandDateFields(input as Record<string, unknown>, TASK_DATE_FIELDS) };
}

export async function createTask(input: TaskInput, user: AuthUser, todayJalali: string) {
  const db = getDb();
  const task = await db.task.create({
    data: {
      ...scalarData(input),
      // An unassigned task belongs to whoever raised it, so it appears in
      // someone's list rather than nobody's.
      assignedToUserId: input.assignedToUserId ?? user.id,
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

  const task = await db.task.update({ where: { id }, data: scalarData(input) as Prisma.TaskUncheckedUpdateInput });

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
