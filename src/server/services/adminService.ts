import { Prisma } from "@prisma/client";
import { getDb } from "../db";
import { ListQuery, ListResult, buildResult, paginationArgs, searchClause } from "../listing";
import { AuthUser, hasPermission } from "../auth";
import { logAction } from "./auditService";
import { expandDateFields, jalaliRangeFilter } from "../dates";
import { toNullableString, toNumber } from "../childSync";
import { ensureSettingsPatches, invalidateSettingsCache, loadSettings } from "../settings";

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
  todayJalali: string,
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

  /*
   * And re-apply the named additions, because the browser sent a whole document
   * it may have read before they were made. `appliedPatches` travels with it, so
   * a document that already carries them is untouched and an entry somebody
   * deliberately removed stays removed.
   */
  await ensureSettingsPatches();

  // The client used to record this, into an audit log that lived in the
  // document store. Nothing read that log any more, so a settings change went
  // unrecorded; it belongs with the write.
  await logAction(
    {
      action: "UPDATE",
      module: "سیستم",
      entityId: "settings",
      description: "تنظیمات نرم‌افزار بروزرسانی شد.",
    },
    user,
    todayJalali,
  );

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
/**
 * Clears history.
 *
 * Takes the same filters the list does, so "delete what I am looking at" means
 * every entry that matches — not the page that happens to be on screen, which
 * is what an id list would have meant once the log was paged.
 */
/**
 * Erases every business record, keeping the accounts and the configuration.
 *
 * This is what the "clear all data" button in settings was always meant to do.
 * It used to POST empty arrays to /api/data/:key, which emptied collections in
 * database.json — a store nothing reads any more — so it reported success and
 * cleared nothing.
 *
 * Kept: users, settings, exchange rates and the audit log. The audit log
 * survives on purpose; it is the record that this happened, and the audit
 * screen has its own purge for when that is wanted too.
 *
 * The order matters and is not arbitrary. Cascades take the children of
 * customers, products, projects, proformas and purchase orders, but the
 * references *between* those roots are NoAction and will refuse the delete:
 * transactions point at five of them, purchase orders point at proformas, and
 * the per-project records point at proformas as well. So the pointers are
 * removed before the things they point at, ending with the three catalogues.
 */
export async function purgeBusinessData(
  user: AuthUser,
): Promise<"forbidden" | { deleted: Record<string, number> }> {
  if (!user.isSystemAdmin) return "forbidden";

  const db = getDb();
  const deleted: Record<string, number> = {};

  await db.$transaction(async (tx) => {
    const drop = async (name: string, run: () => Promise<{ count: number }>) => {
      deleted[name] = (await run()).count;
    };

    // Things that point at the roots.
    await drop("transactions", () => tx.transaction.deleteMany({}));
    await drop("purchaseOrders", () => tx.purchaseOrder.deleteMany({}));
    await drop("deliveries", () => tx.packagingDelivery.deleteMany({}));
    await drop("afterSalesServices", () => tx.afterSalesService.deleteMany({}));
    await drop("supplierInquiries", () => tx.supplierInquiry.deleteMany({}));
    await drop("categoryGroups", () => tx.projectCategoryGroup.deleteMany({}));
    await drop("proformas", () => tx.proforma.deleteMany({}));

    // Free-standing records with no dependants.
    await drop("tasks", () => tx.task.deleteMany({}));
    await drop("moduleNotes", () => tx.moduleNote.deleteMany({}));
    await drop("notifications", () => tx.moduleNotification.deleteMany({}));
    // Read marks refer to activities that have just gone.
    await drop("readReceipts", () => tx.readReceipt.deleteMany({}));
    await drop("stockLedger", () => tx.inventoryTransaction.deleteMany({}));

    // The roots themselves, each taking its own children with it.
    await drop("projects", () => tx.project.deleteMany({}));
    await drop("products", () => tx.product.deleteMany({}));
    await drop("suppliers", () => tx.supplier.deleteMany({}));
    await drop("customers", () => tx.customer.deleteMany({}));
  });

  return { deleted };
}

export async function purgeAuditLogs(
  user: AuthUser,
  before?: unknown,
  filters: { module?: string; action?: string; search?: string } = {},
): Promise<"forbidden" | { deleted: number }> {
  if (!user.isSystemAdmin) return "forbidden";

  const and: Record<string, unknown>[] = [];

  const cutoff = jalaliRangeFilter(undefined, before);
  if (cutoff) and.push({ occurredAt: cutoff });
  if (filters.module) and.push({ module: filters.module });
  if (filters.action) and.push({ action: filters.action });

  const search = searchClause(filters.search, AUDIT_SEARCH);
  if (search) and.push(search);

  const result = await getDb().auditLog.deleteMany({
    where: and.length === 0 ? {} : { AND: and },
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
