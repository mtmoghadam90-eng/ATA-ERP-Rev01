import { Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { getDb } from "../db";
import { ListQuery, ListResult, buildResult, paginationArgs, searchClause } from "../listing";
import { AuthUser, hasPermission } from "../auth";
import { toJsonColumn, toNullableString } from "../childSync";
import { normalizeLimit, workLimitRefusalReason } from "../../utils/workLimits";

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
  // Where a task or a referral reaches this person when the app is shut.
  // Deliberately absent from `DIRECTORY_SELECT`: a colleague's phone number is
  // not something every account may enumerate through the assignment pickers.
  mobile: true,
  // How much work this person may hold in «در حال انجام» at once. Null in both
  // is «no limit», which is every account written before the columns existed.
  minActiveTasks: true, maxActiveTasks: true,
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
  // signatureImage is here because printed documents carry the creator's
  // signature; it is a document asset, not an account detail.
  id: true, fullName: true, position: true, isActive: true, signatureImage: true,
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
  /** «موبایل» — where the staff notification is sent. See `staffNotifications`. */
  mobile?: string | null;
  /** «حداقل / حداکثر کار همزمان». Null or 0 means no limit — see `workLimits`. */
  minActiveTasks?: number | null;
  maxActiveTasks?: number | null;
}

function scalarData(input: UserInput): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const set = (key: string, value: unknown) => { if (value !== undefined) out[key] = value; };

  if ("username" in input) set("username", toNullableString(input.username, 100));
  if ("fullName" in input) set("fullName", toNullableString(input.fullName, 200));
  if ("role" in input) set("role", toNullableString(input.role, 30) ?? "user");
  if ("isSystemAdmin" in input) set("isSystemAdmin", !!input.isSystemAdmin);
  if ("position" in input) set("position", toNullableString(input.position, 150));
  /*
   * Stored as typed. `normalizeMobile` folds `+98`, the leading zero and the
   * spaces where the message is **sent**, so the users screen still shows the
   * number somebody entered rather than a rewritten one they did not.
   */
  if ("mobile" in input) set("mobile", toNullableString(input.mobile, 20));
  if ("signatureImage" in input) set("signatureImage", toNullableString(input.signatureImage, 500));
  if ("isActive" in input) set("isActive", !!input.isActive);
  if ("permissions" in input) set("permissions", toJsonColumn(input.permissions));
  /*
   * The two work-in-progress limits, normalised where they are written.
   *
   * `normalizeLimit` folds an empty box, a zero, a negative and the string a
   * JSON body arrives as into the same null — «no limit» — so the column can
   * only ever hold a real cap or nothing, and every reader is spared the
   * question. A maximum of zero would otherwise mean «may never work», which
   * is not what anybody types into an empty-looking box.
   */
  if ("minActiveTasks" in input) set("minActiveTasks", normalizeLimit(input.minActiveTasks));
  if ("maxActiveTasks" in input) set("maxActiveTasks", normalizeLimit(input.maxActiveTasks));

  return out;
}

export async function createUser(
  input: UserInput,
  password: string,
  user: AuthUser,
): Promise<"forbidden" | { refusal: string } | { user: unknown }> {
  if (!canManage(user)) return "forbidden";

  const badLimits = workLimitRefusalReason({
    min: normalizeLimit(input.minActiveTasks),
    max: normalizeLimit(input.maxActiveTasks),
  });
  if (badLimits) return { refusal: badLimits };

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
 * Whether two serialized permission objects say the same thing.
 *
 * Key order is not meaning. The stored string was written by whichever client
 * last saved the account, so comparing the text would report a change every
 * time the order differed — and a reported change revokes the sessions.
 */
export function samePermissions(next: unknown, stored: unknown): boolean {
  const flatten = (value: unknown): string => {
    if (value == null) return "";
    let parsed: unknown = value;
    if (typeof value === "string") {
      try {
        parsed = JSON.parse(value);
      } catch {
        return value;
      }
    }
    if (!parsed || typeof parsed !== "object") return String(parsed);
    return Object.entries(parsed as Record<string, unknown>)
      .map(([k, v]) => `${k}=${v}`)
      .sort()
      .join("&");
  };
  return flatten(next) === flatten(stored);
}

/**
 * Updates an account.
 *
 * Changing permissions or deactivating someone bumps `sessionEpoch`, which
 * invalidates the cookies they already hold — otherwise a revoked permission
 * would not take effect until their session happened to expire.
 *
 * The bump follows a real change in value, not the mere presence of the field
 * in the request. The edit form posts the whole record, so every save of any
 * account used to revoke its sessions — including an administrator saving their
 * own, who was then signed out and told their session had expired over a change
 * that had in fact been written.
 *
 * Returns the new epoch when it moved, so the route can hand the caller a fresh
 * cookie if the account they just edited is their own.
 */
export async function updateUser(
  id: string,
  input: UserInput,
  user: AuthUser,
): Promise<
  "forbidden" | "not-found" | "last-admin" | { refusal: string }
  | { user: unknown; epoch?: number }
> {
  if (!canManage(user)) return "forbidden";
  const db = getDb();

  const existing = await db.user.findUnique({
    where: { id },
    select: {
      id: true, isSystemAdmin: true, isActive: true,
      permissions: true, sessionEpoch: true,
      minActiveTasks: true, maxActiveTasks: true,
    },
  });
  if (!existing) return "not-found";

  /*
   * The pair as it will stand, not the pair that was sent.
   *
   * A form may post one of the two, so checking the request alone would let a
   * minimum of 8 be saved beside a stored maximum of 5 — and the board would
   * then promote a card to reach the floor and refuse it for breaking the
   * ceiling, on the same press.
   */
  const badLimits = workLimitRefusalReason({
    min: "minActiveTasks" in input
      ? normalizeLimit(input.minActiveTasks) : normalizeLimit(existing.minActiveTasks),
    max: "maxActiveTasks" in input
      ? normalizeLimit(input.maxActiveTasks) : normalizeLimit(existing.maxActiveTasks),
  });
  if (badLimits) return { refusal: badLimits };

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

  // Compared, not merely present — and compared by meaning, not by text. Two
  // serializations of the same permissions differ whenever the keys were
  // written in a different order, and a false difference here signs the user
  // out on a save that changed nothing.
  const revoking =
    ("permissions" in input && !samePermissions(data.permissions, existing.permissions))
    || ("isActive" in input && input.isActive !== existing.isActive)
    || ("isSystemAdmin" in input && input.isSystemAdmin !== existing.isSystemAdmin);

  const epoch = (existing.sessionEpoch ?? 0) + 1;
  if (revoking) data.sessionEpoch = epoch;

  const updated = await db.user.update({
    where: { id },
    data: data as Prisma.UserUncheckedUpdateInput,
    select: SAFE_SELECT,
  });
  return { user: updated, ...(revoking ? { epoch } : {}) };
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
): Promise<"forbidden" | "not-found" | "wrong-password" | { epoch: number }> {
  const db = getDb();
  const isSelf = user.id === id;
  if (!isSelf && !canManage(user)) return "forbidden";

  const target = await db.user.findUnique({
    where: { id }, select: { id: true, passwordHash: true, sessionEpoch: true },
  });
  if (!target) return "not-found";

  if (isSelf && !canManage(user)) {
    if (!currentPassword || !bcrypt.compareSync(currentPassword, target.passwordHash)) {
      return "wrong-password";
    }
  }

  // Every session issued for this account ends here — that is the point of
  // changing a password. The browser doing the changing is handed a new cookie
  // by the route, so the person who just proved they know the old password is
  // not the one signed out.
  const epoch = (target.sessionEpoch ?? 0) + 1;
  await db.user.update({
    where: { id },
    data: { passwordHash: bcrypt.hashSync(newPassword, 10), sessionEpoch: epoch },
  });
  return { epoch };
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

/**
 * Authenticates a user by username and password.
 *
 * Returns the user record (without password hash) if credentials are valid,
 * or null if authentication fails.
 */
/**
 * The caller behind a session cookie.
 *
 * Every authenticated request resolves its user through this, so it is read
 * fresh each time: a permission change, a deactivation or a `sessionEpoch` bump
 * has to take effect at once rather than at next login.
 *
 * This used to read `erp_users` out of database.json while login authenticated
 * against SQL. The two only agreed because both were seeded from the same
 * constants — so any account created through the users screen could sign in and
 * then be refused by every request, and permissions edited in the UI were
 * enforced from a file nothing had updated since the migration.
 */
export async function findAuthUser(
  id: string,
): Promise<(AuthUser & { sessionEpoch: number }) | null> {
  const user = await getDb().user.findUnique({
    where: { id },
    select: {
      id: true, username: true, fullName: true, position: true, role: true,
      isSystemAdmin: true, isActive: true, permissions: true, sessionEpoch: true,
    },
  });
  if (!user || !user.isActive) return null;

  let permissions: Record<string, boolean> | undefined;
  if (user.permissions) {
    try {
      const parsed = JSON.parse(user.permissions);
      if (parsed && typeof parsed === "object") permissions = parsed;
    } catch {
      // A corrupt map must not grant access; treat it as "no overrides".
    }
  }

  return {
    id: user.id,
    username: user.username,
    // /api/me answers with this, and the sidebar prints the name and the
    // position; omitting them left the UI with a user it could not render.
    fullName: user.fullName,
    position: user.position ?? undefined,
    role: user.role,
    isSystemAdmin: user.isSystemAdmin,
    permissions,
    sessionEpoch: user.sessionEpoch,
  };
}

export async function authenticateUser(
  username: string,
  password: string,
): Promise<{
  user: Record<string, unknown>;
  isDefaultPassword: boolean;
  sessionEpoch: number;
} | null> {
  const db = getDb();

  // Find user by username
  // Note: SQL Server collation is case-insensitive by default
  const user = await db.user.findFirst({
    where: {
      username: username,
    },
    select: {
      ...SAFE_SELECT,
      passwordHash: true, // Need this to verify, but won't return it
      // The session token has to carry the current epoch, and SAFE_SELECT is
      // the client-facing projection, which has no reason to include it.
      sessionEpoch: true,
    },
  });

  if (!user) return null;
  if (!user.isActive) return null;

  // Double-check username match (case-insensitive)
  if (user.username.toLowerCase() !== username.toLowerCase()) return null;

  // Verify password
  const passwordMatch = bcrypt.compareSync(password, user.passwordHash);
  if (!passwordMatch) return null;

  // Check if using default password
  const isDefaultPassword = bcrypt.compareSync("123", user.passwordHash);

  // Neither the hash nor the epoch belongs in the response body; the epoch is
  // returned alongside, for signing.
  const { passwordHash: _hash, sessionEpoch, ...safeUser } = user;

  return { user: safeUser, isDefaultPassword, sessionEpoch };
}
