import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { getDb } from "../db";
import { AuthUser } from "../auth";
import { logAction } from "./auditService";
import { findAuthUser } from "./userService";
import {
  TOKEN_BYTES, TOKEN_PREFIX, TokenScope, normalizeScope, tokenRefusalReason,
  visiblePrefix,
} from "../../utils/apiTokens";

/**
 * Issuing, listing, revoking and checking API tokens.
 *
 * A token is a user's credential in another program's hands: it authenticates
 * as that user and is checked by the same `checkKeyAccess` every request goes
 * through. Nothing here grants anything — it only answers "who is this", which
 * is why the whole integration story fits in one table and one branch in
 * `getAuthUser`.
 */

/** The one place a token is turned into what gets stored. */
function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export interface IssuedToken {
  id: string;
  /** The only time the token itself exists outside the caller's clipboard. */
  token: string;
}

export interface TokenSummary {
  id: string;
  name: string;
  prefix: string;
  userId: string;
  userName: string | null;
  scope: TokenScope;
  isActive: boolean;
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

function toSummary(row: {
  id: string; name: string; prefix: string; userId: string; scope: string;
  isActive: boolean; expiresAt: Date | null; lastUsedAt: Date | null; createdAt: Date;
}, userName: string | null): TokenSummary {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    userId: row.userId,
    userName,
    scope: normalizeScope(row.scope),
    isActive: row.isActive,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listTokens(): Promise<TokenSummary[]> {
  const db = getDb();
  const rows = await db.apiToken.findMany({ orderBy: { createdAt: "desc" } });
  if (rows.length === 0) return [];

  const users = await db.user.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.userId))] } },
    select: { id: true, fullName: true },
  });
  const names = new Map(users.map((u) => [u.id, u.fullName]));
  return rows.map((row) => toSummary(row, names.get(row.userId) ?? null));
}

export interface CreateTokenInput {
  name?: string;
  /** Whose permissions the token carries. Defaults to the issuer. */
  userId?: string | null;
  scope?: unknown;
  /** Days from now, or null for a token that does not expire. */
  expiresInDays?: unknown;
}

export async function createToken(
  input: CreateTokenInput,
  issuer: AuthUser,
  todayJalali: string,
): Promise<{ error: string } | { issued: IssuedToken; summary: TokenSummary }> {
  const db = getDb();
  const name = String(input.name ?? "").trim().slice(0, 200);
  if (!name) return { error: "برای توکن یک نام بگذارید تا بعداً بشناسیدش." };

  const userId = String(input.userId ?? "").trim() || issuer.id;
  const owner = await db.user.findUnique({
    where: { id: userId }, select: { id: true, fullName: true, isActive: true },
  });
  if (!owner) return { error: "کاربر انتخاب‌شده پیدا نشد." };
  if (!owner.isActive) return { error: "برای یک حساب غیرفعال نمی‌توان توکن صادر کرد." };

  const days = Number(input.expiresInDays);
  const expiresAt = Number.isFinite(days) && days > 0
    ? new Date(Date.now() + days * 86_400_000)
    : null;

  /*
   * The token exists in this function and nowhere else afterwards.
   *
   * Only its hash is stored, so a token that is lost is regenerated rather than
   * recovered — including by whoever runs the database.
   */
  const token = `${TOKEN_PREFIX}${randomBytes(TOKEN_BYTES).toString("hex")}`;
  const row = await db.apiToken.create({
    data: {
      id: randomUUID(),
      name,
      prefix: visiblePrefix(token),
      tokenHash: hashToken(token),
      userId: owner.id,
      scope: normalizeScope(input.scope),
      expiresAt,
      createdByUserId: issuer.id,
    },
  });

  await logAction(
    {
      action: "CREATE",
      module: "دسترسی API",
      entityId: row.id,
      description: `صدور توکن API «${name}» برای ${owner.fullName}`
        + ` با دسترسی ${normalizeScope(input.scope) === "full" ? "خواندن و نوشتن" : "فقط خواندن"}`,
      // Deliberately no token and no hash: an audit entry is read by people.
      afterState: { name, userId: owner.id, scope: normalizeScope(input.scope), expiresAt },
    },
    issuer,
    todayJalali,
  );

  return {
    issued: { id: row.id, token },
    summary: toSummary(row, owner.fullName),
  };
}

export async function revokeToken(
  id: string,
  user: AuthUser,
  todayJalali: string,
): Promise<{ error: string } | TokenSummary> {
  const db = getDb();
  const row = await db.apiToken.findUnique({ where: { id } });
  if (!row) return { error: "این توکن پیدا نشد." };
  if (!row.isActive) return toSummary(row, null);

  const updated = await db.apiToken.update({ where: { id }, data: { isActive: false } });
  await logAction(
    {
      action: "UPDATE",
      module: "دسترسی API",
      entityId: id,
      description: `ابطال توکن API «${row.name}»`,
      beforeState: { isActive: true },
      afterState: { isActive: false },
    },
    user,
    todayJalali,
  );
  return toSummary(updated, null);
}

export async function deleteToken(
  id: string,
  user: AuthUser,
  todayJalali: string,
): Promise<{ error: string } | { ok: true }> {
  const db = getDb();
  const row = await db.apiToken.findUnique({ where: { id } });
  if (!row) return { error: "این توکن پیدا نشد." };

  await db.apiToken.delete({ where: { id } });
  await logAction(
    {
      action: "DELETE",
      module: "دسترسی API",
      entityId: id,
      description: `حذف توکن API «${row.name}»`,
      beforeState: { name: row.name, userId: row.userId, scope: row.scope },
    },
    user,
    todayJalali,
  );
  return { ok: true };
}

/* ------------------------------ authenticate ----------------------------- */

export interface TokenIdentity {
  user: AuthUser;
  tokenId: string;
  tokenName: string;
  scope: TokenScope;
}

/**
 * `lastUsedAt`, written rarely.
 *
 * It answers "is this integration still running", which is a question about
 * days, not seconds — and an integration polling every minute would otherwise
 * turn every read into a write on a database shared with Report Server.
 */
const TOUCH_AFTER_MS = 5 * 60_000;

function touch(id: string, lastUsedAt: Date | null): void {
  if (lastUsedAt && Date.now() - lastUsedAt.getTime() < TOUCH_AFTER_MS) return;
  // Not awaited, and its failure is not the request's problem.
  getDb().apiToken.update({ where: { id }, data: { lastUsedAt: new Date() } })
    .catch((err) => console.error("[api] touching api token failed", err));
}

/**
 * Who a token belongs to, or why it is refused.
 *
 * The user record is re-read on every request, exactly as the cookie path does,
 * so a permission change or a deactivation reaches an integration immediately
 * rather than whenever it next reconnects.
 */
export async function authenticateToken(
  raw: string,
): Promise<{ error: string } | TokenIdentity> {
  const digest = hashToken(raw);
  const row = await getDb().apiToken.findUnique({ where: { tokenHash: digest } });
  if (!row) return { error: "توکن معتبر نیست." };

  /*
   * Compared again in constant time.
   *
   * The index lookup already proved the digests match, so this changes nothing
   * about the answer — it is here so the code does not read as an invitation to
   * replace the unique-index lookup with a scan-and-compare later on.
   */
  const stored = Buffer.from(row.tokenHash, "hex");
  const given = Buffer.from(digest, "hex");
  if (stored.length !== given.length || !timingSafeEqual(stored, given)) {
    return { error: "توکن معتبر نیست." };
  }

  const user = await findAuthUser(row.userId);
  const refusal = tokenRefusalReason(
    { isActive: row.isActive, expiresAt: row.expiresAt, userActive: !!user },
    Date.now(),
  );
  if (refusal || !user) return { error: refusal ?? "توکن معتبر نیست." };

  touch(row.id, row.lastUsedAt);

  const { sessionEpoch: _epoch, ...safe } = user;
  return {
    user: safe as AuthUser,
    tokenId: row.id,
    tokenName: row.name,
    scope: normalizeScope(row.scope),
  };
}
