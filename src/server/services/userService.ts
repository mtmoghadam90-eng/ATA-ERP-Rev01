import { Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { getDb } from "../db";
import { ListQuery, ListResult, buildResult, paginationArgs, searchClause } from "../listing";
import { AuthUser, hasPermission } from "../auth";
import { toJsonColumn, toNullableString } from "../childSync";

/**
 * User account data access.
 *
 * The rule that governs this whole file: a password hash never leaves the
 * server, and nothing here ever returns one. Every read goes through an explicit
 * `select` rather than returning the row, so adding a column later cannot leak
 * it by default.
 */

export const USER_SORTABLE = ["username", "fullName", "role", "isActive", "createdAt"] as const;
export const USER_FILTERABLE = ["role", "isActive"] as const;

const SEARCH_FIELDS = ["username", "fullName", "position"] as const;

/** Columns that are safe to return. Note the absence of passwordHash. */
const SAFE_SELECT = {
  id: true, username: true, fullName: true, role: true, isSystemAdmin: true,
  position: true, signatureImage: true, isActive: true, permissions: true,
  createdAt: true, updatedAt: true,
} satisfies Prisma.UserSelect;

/**
 * The colleague directory every user may read.
 *
 * Assigning a task or a referral needs a name and an id; it does not need
 * anyone's permission map, and a restricted user must not be able to enumerate
 * who holds which access.
 */
const DIRECTORY_SELECT = {
  id: true, fullName: true, position: true, isActive: true,
} satisfies Prisma.UserSelect;

function canManage(user: AuthUser): boolean {
  return hasPermission(user, "users");
}

export function buildUserWhere(q: ListQuery): Record<string, unknown> {
  const and: Record<string, unknown>[] = [];

  const search = searchClause(q.search, SEARCH_FIELDS);
  if (search) and.push(search);

  for (const [field, value] of Object.entries(q.filters)) {
    // isActive arrives as a string from the query, but the column is a boolean.
    if (field === "isActive") and.push({ isActive: value === "true" });
    else and.push({ [field]: value });
  }

  return and.length === 0 ? {} : { AND: and };
}

/**
 * Lists users. Without the `users` permission this returns the directory
 * projection instead of refusing — the pickers throughout the app depend on it,
 * and a name is not a secret while a permission map is.
 */
export async function listUsers(q: ListQuery, user: AuthUser): Promise<ListResult<Record<string, unknown>>> {
  const db = getDb();
  const where = buildUserWhere(q);
  const orderBy = q.sort ? { [q.sort]: q.order } : { fullName: "asc" as const };
  const select = canManage(user) ? SAFE_SELECT : DIRECTORY_SELECT;

  const [rows, total] = await Promise.all([
    db.user.findMany({ where, orderBy, select, ...paginationArgs(q) }),
    db.user.count({ where }),
  ]);

  return buildResult(rows as unknown as Record<string, unknown>[], total, q);
}

export async function getUser(id: string, user: AuthUser) {
  const db = getDb();
  return db.user.findUnique({
    where: { id },
    select: canManage(user) ? SAFE_SELECT : DIRECTORY_SELECT,
  });
}

export interface UserInput {
  username?: string;
  fullName?: string;
  role?: string;
  isSystemAdmin?: boolean;
  position?: string | null;
  signatureImage?: string | null;
  isActive?: boolean;
  permissions?: unknown;
}

function scalarData(input: UserInput): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const set = (key: string, value: unknown) => { if (value !== undefined) out[key] = value; };

  if ("username" in input) set("username", toNullableString(input.username, 100));
  if ("fullName" in input) set("fullName", toNullableString(input.fullName, 200));
  if ("role" in input) set("role", toNullableString(input.role, 30) ?? "user");
  if ("isSystemAdmin" in input) set("isSystemAdmin", !!input.isSystemAdmin);
  if ("position" in input) set("position", toNullableString(input.position, 150));
  if ("signatureImage" in input) set("signatureImage", toNullableString(input.signatureImage, 500));
  if ("isActive" in input) set("isActive", !!input.isActive);
  if ("permissions" in input) set("permissions", toJsonColumn(input.permissions));

  return out;
}

export async function createUser(
  input: UserInput,
  password: string,
  user: AuthUser,
): Promise<"forbidden" | { user: unknown }> {
  if (!canManage(user)) return "forbidden";

  const created = await getDb().user.create({
    data: {
      ...scalarData(input),
      // Hashed here and nowhere else; the plaintext never reaches a column.
      passwordHash: bcrypt.hashSync(password, 10),
    } as Prisma.UserUncheckedCreateInput,
    select: SAFE_SELECT,
  });
  return { user: created };
}

/**
 * Updates an account.
 *
 * Changing permissions or deactivating someone bumps `sessionEpoch`, which
 * invalidates the cookies they already hold — otherwise a revoked permission
 * would not take effect until their session happened to expire.
 */
export async function updateUser(
  id: string,
  input: UserInput,
  user: AuthUser,
): Promise<"forbidden" | "not-found" | "last-admin" | { user: unknown }> {
  if (!canManage(user)) return "forbidden";
  const db = getDb();

  const existing = await db.user.findUnique({
    where: { id },
    select: { id: true, isSystemAdmin: true, isActive: true },
  });
  if (!existing) return "not-found";

  // Removing the last administrator would leave nobody able to restore access.
  const losingAdmin =
    (existing.isSystemAdmin && input.isSystemAdmin === false) ||
    (existing.isSystemAdmin && input.isActive === false);
  if (losingAdmin) {
    const remaining = await db.user.count({
      where: { isSystemAdmin: true, isActive: true, id: { not: id } },
    });
    if (remaining === 0) return "last-admin";
  }

  const data = scalarData(input);
  const revoking = "permissions" in input || "isActive" in input || "isSystemAdmin" in input;
  if (revoking) data.sessionEpoch = { increment: 1 };

  const updated = await db.user.update({
    where: { id },
    data: data as Prisma.UserUncheckedUpdateInput,
    select: SAFE_SELECT,
  });
  return { user: updated };
}

/**
 * Sets a password.
 *
 * An administrator may reset anyone's; a user may change their own only by
 * proving the current one. Either way every existing session for that account is
 * invalidated, so a password change actually ends access gained with the old one.
 */
export async function setPassword(
  id: string,
  newPassword: string,
  user: AuthUser,
  currentPassword?: string,
): Promise<"forbidden" | "not-found" | "wrong-password" | "ok"> {
  const db = getDb();
  const isSelf = user.id === id;
  if (!isSelf && !canManage(user)) return "forbidden";

  const target = await db.user.findUnique({ where: { id }, select: { id: true, passwordHash: true } });
  if (!target) return "not-found";

  if (isSelf && !canManage(user)) {
    if (!currentPassword || !bcrypt.compareSync(currentPassword, target.passwordHash)) {
      return "wrong-password";
    }
  }

  await db.user.update({
    where: { id },
    data: {
      passwordHash: bcrypt.hashSync(newPassword, 10),
      sessionEpoch: { increment: 1 },
    },
  });
  return "ok";
}

export async function countUserReferences(id: string) {
  const db = getDb();
  const [customers, projects, proformas, tasks, activities, referrals] = await Promise.all([
    db.customer.count({ where: { ownerUserId: id } }),
    db.project.count({ where: { ownerUserId: id } }),
    db.proforma.count({ where: { creatorUserId: id } }),
    db.task.count({ where: { assignedToUserId: id } }),
    db.projectActivity.count({ where: { authorUserId: id } }),
    db.projectReferral.count({ where: { assignedToUserId: id } }),
  ]);
  return {
    customers, projects, proformas, tasks, activities, referrals,
    total: customers + projects + proformas + tasks + activities + referrals,
  };
}

/**
 * Deactivates or deletes an account.
 *
 * An account that owns records is deactivated rather than removed: deleting it
 * would either break those references or, worse, silently detach the record of
 * who did the work. Deactivation ends their access immediately, which is the
 * actual requirement.
 */
export async function removeUser(
  id: string,
  user: AuthUser,
): Promise<"forbidden" | "not-found" | "last-admin" | "self" | "deactivated" | "deleted"> {
  if (!canManage(user)) return "forbidden";
  if (user.id === id) return "self";

  const db = getDb();
  const existing = await db.user.findUnique({
    where: { id },
    select: { id: true, isSystemAdmin: true },
  });
  if (!existing) return "not-found";

  if (existing.isSystemAdmin) {
    const remaining = await db.user.count({
      where: { isSystemAdmin: true, isActive: true, id: { not: id } },
    });
    if (remaining === 0) return "last-admin";
  }

  const refs = await countUserReferences(id);
  if (refs.total > 0) {
    await db.user.update({
      where: { id },
      data: { isActive: false, sessionEpoch: { increment: 1 } },
    });
    return "deactivated";
  }

  await db.user.delete({ where: { id } });
  return "deleted";
}
