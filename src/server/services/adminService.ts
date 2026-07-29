import { Prisma } from "@prisma/client";
import { getDb } from "../db";
import { ListQuery, ListResult, buildResult, paginationArgs, searchClause } from "../listing";
import { AuthUser, hasPermission } from "../auth";
import { expandDateFields, jalaliRangeFilter } from "../dates";
import { toNullableString, toNumber } from "../childSync";
import { invalidateSettingsCache, loadSettings } from "../settings";

/**
 * Settings, exchange rates and the audit log.
 *
 * All three are single small tables that every module leans on, so they live
 * together rather than in three near-empty files.
 */

/* ================================ settings =============================== */

/** Any authenticated user reads settings; only `settings` holders write them. */
export async function getSettings(): Promise<unknown> {
  return (await loadSettings()) ?? null;
}

export async function saveSettings(
  data: unknown,
  user: AuthUser,
): Promise<"forbidden" | "invalid" | "ok"> {
  if (!hasPermission(user, "settings")) return "forbidden";
  if (!data || typeof data !== "object" || Array.isArray(data)) return "invalid";

  const serialized = JSON.stringify(data);
  await getDb().appSetting.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", data: serialized },
    update: { data: serialized },
  });

  // Services cache the parsed document; drop it so the change is visible at once.
  invalidateSettingsCache();
  return "ok";
}

/* ============================= exchange rates ============================ */

export async function listExchangeRates() {
  return getDb().exchangeRate.findMany({ orderBy: { currency: "asc" } });
}

export interface RateInput {
  currency?: string;
  name?: string;
  rateToRial?: unknown;
}

/**
 * Writes a rate, keyed on the currency.
 *
 * Upsert rather than create: /api/rates refreshes these from tgju.org on a
 * schedule, and a second run must update the existing row rather than collide
 * with the unique index on currency.
 */
export async function upsertExchangeRate(
  input: RateInput,
  user: AuthUser,
): Promise<"forbidden" | "invalid" | { rate: unknown }> {
  if (!hasPermission(user, "settings")) return "forbidden";

  const currency = toNullableString(input.currency, 10);
  if (!currency) return "invalid";

  const rateToRial = toNumber(input.rateToRial, 0);
  if (rateToRial <= 0) return "invalid";

  const rate = await getDb().exchangeRate.upsert({
    where: { currency },
    create: {
      currency,
      name: toNullableString(input.name, 50) ?? currency,
      rateToRial,
    },
    update: {
      rateToRial,
      ...(input.name !== undefined ? { name: toNullableString(input.name, 50) ?? currency } : {}),
      lastUpdated: new Date(),
    },
  });
  return { rate };
}

/* =============================== audit log =============================== */

export const AUDIT_SORTABLE = ["occurredAt", "action", "module"] as const;
export const AUDIT_FILTERABLE = ["action", "module", "userId", "entityId"] as const;

const AUDIT_SEARCH = ["description", "userFullName", "module"] as const;

/** Reading the audit log is an administrative act, gated like settings. */
function canReadAudit(user: AuthUser): boolean {
  return hasPermission(user, "settings");
}

export function buildAuditWhere(
  q: ListQuery,
  extra: { dateFrom?: unknown; dateTo?: unknown } = {},
): Record<string, unknown> {
  const and: Record<string, unknown>[] = [];

  const search = searchClause(q.search, AUDIT_SEARCH);
  if (search) and.push(search);

  for (const [field, value] of Object.entries(q.filters)) {
    and.push({ [field]: value });
  }

  const range = jalaliRangeFilter(extra.dateFrom, extra.dateTo);
  if (range) and.push({ occurredAt: range });

  return and.length === 0 ? {} : { AND: and };
}

/**
 * Lists audit entries.
 *
 * The before/after snapshots are deliberately excluded from the list: they are
 * compressed JSON blobs of whole records, and returning fifty of them would make
 * the page far heavier than the history it is showing. They come with the single
 * entry instead.
 */
const AUDIT_LIST_SELECT = {
  id: true, action: true, module: true, entityId: true, description: true,
  userId: true, userFullName: true, occurredAt: true, occurredAtJalali: true,
} satisfies Prisma.AuditLogSelect;

export async function listAuditLogs(
  q: ListQuery,
  user: AuthUser,
  extra: { dateFrom?: unknown; dateTo?: unknown } = {},
): Promise<ListResult<Record<string, unknown>> | null> {
  if (!canReadAudit(user)) return null;

  const db = getDb();
  const where = buildAuditWhere(q, extra);
  const orderBy = q.sort ? { [q.sort]: q.order } : { occurredAt: "desc" as const };

  const [rows, total] = await Promise.all([
    db.auditLog.findMany({ where, orderBy, select: AUDIT_LIST_SELECT, ...paginationArgs(q) }),
    db.auditLog.count({ where }),
  ]);

  return buildResult(rows as unknown as Record<string, unknown>[], total, q);
}

export async function getAuditLog(id: string, user: AuthUser) {
  if (!canReadAudit(user)) return null;
  return getDb().auditLog.findUnique({ where: { id } });
}

export interface AuditInput {
  action?: string;
  module?: string;
  entityId?: string | null;
  description?: string;
  beforeState?: string | null;
  afterState?: string | null;
  occurredAt?: string | null;
}

/**
 * Records an entry.
 *
 * Takes the acting user from the session rather than the body — an audit trail
 * a caller can attribute to someone else is worse than none.
 */
export async function recordAudit(input: AuditInput, user: AuthUser, todayJalali: string) {
  const db = getDb();
  const actor = await db.user.findUnique({ where: { id: user.id }, select: { fullName: true } });

  return db.auditLog.create({
    data: {
      action: toNullableString(input.action, 20) ?? "UPDATE",
      module: toNullableString(input.module, 100) ?? "",
      entityId: toNullableString(input.entityId, 36),
      description: toNullableString(input.description) ?? "",
      beforeState: input.beforeState ?? null,
      afterState: input.afterState ?? null,
      userId: user.id,
      userFullName: actor?.fullName ?? null,
      ...expandDateFields({ occurredAt: input.occurredAt || todayJalali }, ["occurredAt"]),
    } as Prisma.AuditLogUncheckedCreateInput,
  });
}

/**
 * Clears audit history.
 *
 * Restricted to a system administrator, not merely to the settings permission:
 * erasing the record of who did what is the one action nobody else should be
 * able to take. `before` keeps entries newer than a Shamsi date, so old history
 * can be trimmed without discarding the recent trail.
 */
export async function purgeAuditLogs(
  user: AuthUser,
  before?: unknown,
): Promise<"forbidden" | { deleted: number }> {
  if (!user.isSystemAdmin) return "forbidden";

  const cutoff = jalaliRangeFilter(undefined, before);
  const result = await getDb().auditLog.deleteMany({
    where: cutoff ? { occurredAt: cutoff } : {},
  });
  return { deleted: result.count };
}

/**
 * Trims the log to its most recent `keep` entries.
 *
 * The JSON store capped this at 1000 by rewriting the array on every write. A
 * table has no such cap, so it is applied deliberately here instead of letting
 * the log grow without limit.
 */
export async function trimAuditLogs(keep = 1000): Promise<number> {
  const db = getDb();
  const total = await db.auditLog.count();
  if (total <= keep) return 0;

  // Find the cutoff row, then delete everything older in one statement rather
  // than loading the ids of what could be a very large tail.
  const boundary = await db.auditLog.findMany({
    orderBy: { occurredAt: "desc" },
    select: { occurredAt: true },
    skip: keep - 1,
    take: 1,
  });
  if (boundary.length === 0) return 0;

  const result = await db.auditLog.deleteMany({
    where: { occurredAt: { lt: boundary[0].occurredAt } },
  });
  return result.count;
}
