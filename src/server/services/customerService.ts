import { getDb } from "../db";
import {
  ListQuery, ListResult, buildResult, paginationArgs, searchClause,
} from "../listing";
import { AuthUser, hasPermission } from "../auth";

/**
 * Customer data access.
 *
 * All reads are paginated and filtered in SQL — nothing here ever returns a
 * whole table. Record-level visibility is applied inside the query rather than
 * after the fact, so a user cannot page past their own scope.
 */

/** Sortable columns, allowlisted so a caller cannot name an arbitrary field. */
export const CUSTOMER_SORTABLE = [
  "companyName", "customerType", "status", "province", "createdAt", "updatedAt",
] as const;

export const CUSTOMER_FILTERABLE = [
  "status", "customerType", "province", "industry", "city",
] as const;

const SEARCH_FIELDS = [
  "companyName", "firstName", "lastName", "mobile", "phone",
  "email", "economicCode", "province", "tags", "industry", "keyPerson", "position",
] as const;

/**
 * Restricts a query to what `user` may see.
 *
 * A user with the customers permission sees everything; otherwise they see only
 * customers they own. Returning a clause (rather than filtering afterwards)
 * keeps the pagination totals honest.
 */
export function visibilityClause(user: AuthUser): Record<string, unknown> | undefined {
  if (hasPermission(user, "customers")) return undefined;
  return { ownerUserId: user.id };
}

/**
 * Filter clause for a user-defined custom field.
 *
 * Custom fields live together in the `customValues` JSON column, so there is no
 * column to compare against. This matches the serialized `"fieldId":value`
 * fragment instead, which is exact for the value types that are actually
 * filtered — select lists and booleans, where the stored value is a whole token.
 *
 * It is a substring match, so it would also match a *longer* string value
 * starting with the same text. That is why only equality-style fields expose a
 * filter in the UI; free text is reached through search instead. If a field ever
 * needs real indexed comparison, `prisma/sql/extra-indexes.sql` shows how to
 * promote one to a persisted computed column.
 *
 * Input is `fieldId:value`; the id is restricted to the characters a generated
 * field id can contain, so nothing arbitrary reaches the query.
 */
export function customFieldClause(spec: unknown): Record<string, unknown> | undefined {
  if (typeof spec !== "string") return undefined;
  const separator = spec.indexOf(":");
  if (separator <= 0) return undefined;

  const fieldId = spec.slice(0, separator);
  const value = spec.slice(separator + 1);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(fieldId) || !value) return undefined;

  // Booleans serialize unquoted; everything else is a quoted string.
  const fragment = value === "true" || value === "false"
    ? `"${fieldId}":${value}`
    : `"${fieldId}":"${value}"`;

  return { customValues: { contains: fragment } };
}

/** Exported so the visibility rules can be asserted without a database. */
export function buildCustomerWhere(
  q: ListQuery,
  user: AuthUser,
  extra: { customField?: unknown } = {},
): Record<string, unknown> {
  const and: Record<string, unknown>[] = [];

  const visibility = visibilityClause(user);
  if (visibility) and.push(visibility);

  const search = searchClause(q.search, SEARCH_FIELDS);
  if (search) and.push(search);

  for (const [field, value] of Object.entries(q.filters)) {
    and.push({ [field]: value });
  }

  // Several custom fields can be filtered at once. Express gives an array when
  // the key repeats; the client instead sends one "|"-joined value, because a
  // plain object cannot express a repeated key. Both are accepted.
  const raw = Array.isArray(extra.customField) ? extra.customField : [extra.customField];
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    for (const spec of entry.split("|")) {
      const clause = customFieldClause(spec);
      if (clause) and.push(clause);
    }
  }

  return and.length === 0 ? {} : { AND: and };
}

/** The columns a list screen needs — deliberately not `select *`. */
const LIST_SELECT = {
  id: true,
  customerType: true,
  status: true,
  companyName: true,
  firstName: true,
  lastName: true,
  economicCode: true,
  industry: true,
  phone: true,
  mobile: true,
  email: true,
  province: true,
  city: true,
  tags: true,
  ownerUserId: true,
  createdAt: true,
  customValues: true,
  // The grid shows who each customer is linked to. Joined here rather than
  // fetched per row, which would be one request per visible customer.
  linksFrom: {
    select: { to: { select: { id: true, companyName: true, customerType: true } } },
  },
} as const;

export async function listCustomers(
  q: ListQuery,
  user: AuthUser,
  extra: { customField?: unknown } = {},
): Promise<ListResult<Record<string, unknown>>> {
  const db = getDb();
  const where = buildCustomerWhere(q, user, extra);
  const orderBy = q.sort ? { [q.sort]: q.order } : { createdAt: "desc" as const };

  // One round trip for the page, one for the count.
  const [rows, total] = await Promise.all([
    db.customer.findMany({ where, orderBy, select: LIST_SELECT, ...paginationArgs(q) }),
    db.customer.count({ where }),
  ]);

  return buildResult(rows as Record<string, unknown>[], total, q);
}

/** Full record including relations, for a detail view. Null when not visible. */
export async function getCustomer(id: string, user: AuthUser) {
  const db = getDb();
  const visibility = visibilityClause(user);

  const customer = await db.customer.findFirst({
    where: visibility ? { AND: [{ id }, visibility] } : { id },
    include: {
      agreements: { orderBy: { createdAt: "desc" } },
      linksFrom: { include: { to: { select: { id: true, companyName: true, customerType: true } } } },
    },
  });
  return customer;
}

/** Counts of the records that reference a customer, for the delete flow. */
export async function countCustomerReferences(id: string) {
  const db = getDb();
  const [projects, proformas, transactions, links, agreements] = await Promise.all([
    db.project.count({ where: { customerId: id } }),
    db.proforma.count({ where: { customerId: id } }),
    db.transaction.count({ where: { customerId: id } }),
    db.customerLink.count({ where: { OR: [{ fromId: id }, { toId: id }] } }),
    db.customerAgreement.count({ where: { customerId: id } }),
  ]);
  const total = projects + proformas + transactions + links + agreements;
  return { projects, proformas, transactions, links, agreements, total };
}

export interface CustomerInput {
  customerType: string;
  status?: string;
  companyName: string;
  firstName?: string | null;
  lastName?: string | null;
  gender?: string | null;
  position?: string | null;
  economicCode?: string | null;
  industry?: string | null;
  keyPerson?: string | null;
  phone?: string | null;
  mobile?: string | null;
  email?: string | null;
  province?: string | null;
  city?: string | null;
  address?: string | null;
  notes?: string | null;
  tags?: string | null;
  customValues?: string | null;
  ownerUserId?: string | null;
}

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";

/** Canonical mobile for duplicate detection: ascii digits, no +98/0 prefix. */
export function normalizeMobile(value: string | null | undefined): string | null {
  let d = String(value ?? "")
    .replace(/[۰-۹]/g, (c) => String(FA_DIGITS.indexOf(c)))
    .replace(/[٠-٩]/g, (c) => String(AR_DIGITS.indexOf(c)))
    .replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("0098")) d = d.slice(4);
  else if (d.startsWith("98") && d.length === 12) d = d.slice(2);
  d = d.replace(/^0+/, "");
  return d || null;
}

export async function createCustomer(input: CustomerInput, user: AuthUser) {
  const db = getDb();
  return db.customer.create({
    data: {
      ...input,
      status: input.status || "فعال",
      mobileNormalized: normalizeMobile(input.mobile),
      // Unassigned records default to their creator, so ownership rules have
      // something to work with from the start.
      ownerUserId: input.ownerUserId ?? user.id,
    },
  });
}

export async function updateCustomer(id: string, input: Partial<CustomerInput>, user: AuthUser) {
  const db = getDb();
  const visibility = visibilityClause(user);
  if (visibility) {
    const allowed = await db.customer.findFirst({ where: { AND: [{ id }, visibility] }, select: { id: true } });
    if (!allowed) return null;
  }

  const data: Record<string, unknown> = { ...input };
  if ("mobile" in input) data.mobileNormalized = normalizeMobile(input.mobile);

  return db.customer.update({ where: { id }, data });
}

export async function deleteCustomer(id: string, user: AuthUser): Promise<boolean> {
  const db = getDb();
  const visibility = visibilityClause(user);
  if (visibility) {
    const allowed = await db.customer.findFirst({ where: { AND: [{ id }, visibility] }, select: { id: true } });
    if (!allowed) return false;
  }
  await db.customer.delete({ where: { id } });
  return true;
}

/**
 * Reassigns everything pointing at `fromId` to `toId`, then deletes it — all in
 * one transaction, so a failure cannot leave records half-moved.
 */
export async function deleteCustomerWithMigration(fromId: string, toId: string) {
  if (fromId === toId) throw new Error("مشتری جانشین نمی‌تواند خود همان مشتری باشد.");
  const db = getDb();

  return db.$transaction(async (tx) => {
    const replacement = await tx.customer.findUnique({ where: { id: toId } });
    if (!replacement) throw new Error("مشتری جانشین یافت نشد.");

    await tx.project.updateMany({ where: { customerId: fromId }, data: { customerId: toId } });
    await tx.project.updateMany({ where: { endUserCustomerId: fromId }, data: { endUserCustomerId: toId } });
    await tx.project.updateMany({ where: { financialContactId: fromId }, data: { financialContactId: toId } });
    await tx.project.updateMany({ where: { technicalContactId: fromId }, data: { technicalContactId: toId } });
    await tx.proforma.updateMany({ where: { customerId: fromId }, data: { customerId: toId } });
    await tx.proforma.updateMany({ where: { contactCustomerId: fromId }, data: { contactCustomerId: toId } });
    await tx.transaction.updateMany({ where: { customerId: fromId }, data: { customerId: toId } });
    await tx.customerAgreement.updateMany({ where: { customerId: fromId }, data: { customerId: toId } });

    // Links are a composite key, so a blind update could collide with an existing
    // row or create a self-link. Rebuild them instead.
    const links = await tx.customerLink.findMany({
      where: { OR: [{ fromId }, { toId: fromId }] },
    });
    await tx.customerLink.deleteMany({ where: { OR: [{ fromId }, { toId: fromId }] } });
    for (const link of links) {
      const nextFrom = link.fromId === fromId ? toId : link.fromId;
      const nextTo = link.toId === fromId ? toId : link.toId;
      if (nextFrom === nextTo) continue; // would be a self-link
      await tx.customerLink.upsert({
        where: { fromId_toId: { fromId: nextFrom, toId: nextTo } },
        create: { fromId: nextFrom, toId: nextTo },
        update: {},
      });
    }

    await tx.customer.delete({ where: { id: fromId } });
    return { movedTo: toId };
  });
}
