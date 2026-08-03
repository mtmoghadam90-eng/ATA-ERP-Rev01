import { Prisma } from "@prisma/client";
import { getDb } from "../db";
import { ListQuery, ListResult, buildResult, paginationArgs } from "../listing";
import { AuthUser } from "../auth";
import { toNullableString } from "../childSync";

/**
 * The inbox: notices addressed to one user, and what that user has already
 * seen.
 *
 * Both are strictly per-user, which is the point of moving them. In the
 * document store notifications were addressed by display name and read receipts
 * were one shared array for the whole company, so opening something marked it
 * read for everybody. Neither is filtered here after the fact — the user's id
 * is part of the query, so a caller cannot read or clear someone else's inbox.
 */

export const NOTIFICATION_SORTABLE = ["createdAt", "isRead"] as const;

const NOTIFICATION_SELECT = {
  id: true, module: true, title: true, description: true,
  projectId: true, isRead: true, createdAt: true,
} satisfies Prisma.ModuleNotificationSelect;

export async function listNotifications(
  q: ListQuery,
  user: AuthUser,
  extra: { unreadOnly?: boolean } = {},
): Promise<ListResult<Record<string, unknown>> & { unread: number }> {
  const db = getDb();
  const where: Prisma.ModuleNotificationWhereInput = {
    userId: user.id,
    ...(extra.unreadOnly ? { isRead: false } : {}),
  };

  const [rows, total, unread] = await Promise.all([
    db.moduleNotification.findMany({
      where,
      orderBy: q.sort ? { [q.sort]: q.order } : { createdAt: "desc" },
      select: NOTIFICATION_SELECT,
      ...paginationArgs(q),
    }),
    db.moduleNotification.count({ where }),
    // Always the unread total, not the page's — it is a badge.
    db.moduleNotification.count({ where: { userId: user.id, isRead: false } }),
  ]);

  return { ...buildResult(rows as unknown as Record<string, unknown>[], total, q), unread };
}

/** Marks one notice read. Scoped to the caller, so it cannot touch another inbox. */
export async function markNotificationRead(
  id: string,
  user: AuthUser,
): Promise<"ok" | "not-found"> {
  const result = await getDb().moduleNotification.updateMany({
    where: { id, userId: user.id },
    data: { isRead: true },
  });
  return result.count > 0 ? "ok" : "not-found";
}

export async function markAllNotificationsRead(user: AuthUser): Promise<number> {
  const result = await getDb().moduleNotification.updateMany({
    where: { userId: user.id, isRead: false },
    data: { isRead: true },
  });
  return result.count;
}

/**
 * Raises a notice for a user.
 *
 * Never for the person who caused it — being told about your own action is
 * noise, and the document store already made that exception.
 */
export async function notifyUser(input: {
  userId: string;
  module: string;
  title: string;
  description: string;
  projectId?: string | null;
  actorUserId?: string | null;
}): Promise<void> {
  if (!input.userId || input.userId === input.actorUserId) return;

  await getDb().moduleNotification.create({
    data: {
      userId: input.userId,
      module: toNullableString(input.module, 100) ?? "عمومی",
      title: toNullableString(input.title, 300) ?? "",
      description: toNullableString(input.description) ?? "",
      projectId: toNullableString(input.projectId, 36),
    },
  });
}

/* ----------------------------- read receipts ----------------------------- */

/** Which of these items the caller has already seen. */
export async function readItemsFor(itemIds: string[], user: AuthUser): Promise<string[]> {
  if (itemIds.length === 0) return [];
  const rows = await getDb().readReceipt.findMany({
    where: { userId: user.id, itemId: { in: itemIds } },
    select: { itemId: true },
  });
  return rows.map((r) => r.itemId);
}

/**
 * Records that the caller has seen these items.
 *
 * Opening the same thread twice has to be a no-op. `createMany`'s
 * `skipDuplicates` is not available on SQL Server, so the ones already recorded
 * are read first and a duplicate-key error is swallowed for the narrow race
 * where two tabs mark the same item at once — the unique index is the authority
 * either way.
 */
export async function markItemsRead(itemIds: string[], user: AuthUser): Promise<number> {
  const ids = [...new Set(itemIds.filter((id) => typeof id === "string" && id.trim()))]
    .map((id) => id.trim().slice(0, 36));
  if (ids.length === 0) return 0;

  const already = new Set(await readItemsFor(ids, user));
  const fresh = ids.filter((id) => !already.has(id));
  if (fresh.length === 0) return 0;

  try {
    const result = await getDb().readReceipt.createMany({
      data: fresh.map((itemId) => ({ userId: user.id, itemId })),
    });
    return result.count;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return 0;
    throw err;
  }
}
