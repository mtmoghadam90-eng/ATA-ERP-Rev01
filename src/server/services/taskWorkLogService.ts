import { getDb } from "../db";
import type { AuthUser } from "../auth";
import { visibilityClause } from "./taskService";
import { attachmentListColumn, normalizeAttachments, parseAttachmentList } from "../../utils/attachments";
import { TASK_CANCELLED, TASK_DONE } from "../../utils/workBoard";

// A task's existing visibility is also the conversation's visibility. No
// client-supplied author, timestamp, kind or status is accepted on this path.
export async function listTaskWorkLogs(id: string, user: AuthUser, page = 1, db = getDb()) {
  const visibility = visibilityClause(user);
  const task = await db.task.findFirst({ where: visibility ? { AND: [{ id }, visibility] } : { id }, select: { id: true } });
  if (!task) return null;
  const currentPage = Number.isSafeInteger(page) && page > 0 ? page : 1;
  const rows = await db.taskWorkLog.findMany({
    where: { taskId: id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (currentPage - 1) * 50, take: 51,
  });
  return {
    rows: rows.slice(0, 50).map((row) => ({ ...row, attachments: parseAttachmentList(row.attachments) })),
    hasMore: rows.length > 50,
  };
}

export async function addTaskWorkLog(id: string, body: { text?: unknown; attachments?: unknown }, user: AuthUser, db = getDb()) {
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const files = normalizeAttachments(body.attachments);
  if (!text && files.length === 0) throw new Error("شرح کار یا فایل پیوست را وارد کنید.");
  if (text.length > 20000) throw new Error("شرح کار نباید بیشتر از ۲۰۰۰۰ نویسه باشد.");
  if (files.some((f) => !/^\/uploads\/[a-zA-Z0-9_./%-]+$/.test(f.url) || f.url.includes(".."))) {
    throw new Error("فایل پیوست باید در سامانه بارگذاری شده باشد.");
  }
  const visibility = visibilityClause(user);
  // Serializable keeps a simultaneous completion from slipping between the
  // open-task check and the append. Neither task status nor completion fields
  // are written here, and concurrent reports never replace one another.
  return db.$transaction(async (tx) => {
    const task = await tx.task.findFirst({ where: visibility ? { AND: [{ id }, visibility] } : { id } });
    if (!task) return null;
    if (task.status === TASK_DONE || task.status === TASK_CANCELLED) {
      throw new Error("برای وظیفهٔ بسته‌شده نمی‌توان شرح کار جدید ثبت کرد.");
    }
    const row = await tx.taskWorkLog.create({ data: {
      taskId: id, text: text || null, attachments: attachmentListColumn(files),
      authorUserId: user.id, authorName: user.fullName || "کاربر", createdAt: new Date(),
    } });
    return { ...row, attachments: files };
  }, { isolationLevel: "Serializable" });
}
