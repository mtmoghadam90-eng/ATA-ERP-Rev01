import { getDb } from "../db";
import { AuthUser } from "../auth";
import { toNullableString } from "../childSync";
import { expandDateFields } from "../dates";
import { Prisma } from "@prisma/client";
import { compressLZW } from "../../utils/compress";

/**
 * Audit logging helper for all services.
 *
 * Records changes to existing records, with before/after state compression.
 * Call this at the end of every mutation, after the database write succeeds.
 *
 * **Creations are not recorded.** The log is read to answer "who changed this,
 * and what did it say before" — a question a creation cannot answer, since
 * there is no before. Every new record already carries its author and its
 * date, and logging them buried the edits and deletions among them. Sign-ins
 * are kept: they are not creations of business data, and they are the only
 * record of who was in the system.
 */

/** What the log keeps. See the note above for why creations are not here. */
const RECORDED_ACTIONS = new Set<AuditLogInput["action"]>([
  "UPDATE", "DELETE", "LOGIN", "LOGOUT",
]);

export interface AuditLogInput {
  action: "CREATE" | "UPDATE" | "DELETE" | "LOGIN" | "LOGOUT";
  module: string;
  entityId: string;
  description: string;
  beforeState?: unknown;
  afterState?: unknown;
}

/**
 * Logs an action with LZW-compressed state snapshots.
 *
 * @param input - The action details
 * @param user - The authenticated user who performed the action
 * @param todayJalali - Today's Shamsi date (YYYY/MM/DD format)
 */
export async function logAction(
  input: AuditLogInput,
  user: AuthUser,
  todayJalali: string,
): Promise<void> {
  if (!RECORDED_ACTIONS.has(input.action)) return;

  const db = getDb();

  // Get user's full name
  const actor = await db.user.findUnique({
    where: { id: user.id },
    select: { fullName: true },
  });

  // Compress state snapshots with LZW
  const beforeState = input.beforeState
    ? compressLZW(JSON.stringify(input.beforeState))
    : null;

  const afterState = input.afterState
    ? compressLZW(JSON.stringify(input.afterState))
    : null;

  await db.auditLog.create({
    data: {
      action: input.action,
      module: toNullableString(input.module, 100) ?? "",
      entityId: toNullableString(input.entityId, 36) ?? "",
      description: toNullableString(input.description) ?? "",
      beforeState,
      afterState,
      userId: user.id,
      userFullName: actor?.fullName ?? null,
      ...expandDateFields({ occurredAt: todayJalali }, ["occurredAt"]),
    } as Prisma.AuditLogUncheckedCreateInput,
  });
}
