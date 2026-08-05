import { getDb } from "../db";
import { AuthUser } from "../auth";
import { toNullableString } from "../childSync";
import { expandDateFields } from "../dates";
import { Prisma } from "@prisma/client";
import { compressLZW } from "../../utils/compress";

/**
 * Audit logging helper for all services.
 *
 * Records every CREATE/UPDATE/DELETE operation with before/after state compression.
 * Call this at the end of every mutation, after the database write succeeds.
 */

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
