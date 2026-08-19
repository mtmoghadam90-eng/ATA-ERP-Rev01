import { Prisma } from "@prisma/client";
import { getDb } from "../db";
import { afterCommit } from "../afterCommit";
import { calculatePotentialScore } from "../../utils/customerValue";
import { loadCustomerValueSettings } from "./customerValueService";
import {
  ListQuery, ListResult, buildResult, paginationArgs, searchClause,
} from "../listing";
import { AuthUser, hasPermission } from "../auth";
import { logAction } from "./auditService";
import { notifyModuleResponsible } from "./notificationService";
import { processWorkflowRules } from "./workflowService";

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

/**
 * Sortable columns that live on the metrics table rather than the customer.
 *
 * Kept apart because Prisma needs `{ valueMetrics: { field } }` for these, and
 * an unchecked name would go straight into `orderBy` — so both lists stay
 * allowlists.
 */
export const CUSTOMER_METRIC_SORTABLE = [
  "customerValueIndex", "realizedValueScore", "potentialValueScore",
  "grossProfitRial", "purchaseFrequency", "lastPurchaseDate", "customerValueRank",
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
/**
 * The customer-value filters the grid offers.
 *
 * Separate from `CUSTOMER_FILTERABLE` because these are ranges and a relation,
 * not equality on a column of this table — but they are still an allowlist:
 * nothing here is built from a caller-supplied field name.
 */
export interface CustomerValueFilters {
  rank?: unknown;
  minRealized?: unknown;
  maxRealized?: unknown;
  minPotential?: unknown;
  maxPotential?: unknown;
  minGrossProfit?: unknown;
  maxGrossProfit?: unknown;
  /** Only customers whose last purchase is within this many months. */
  lastPurchaseWithinMonths?: unknown;
  paymentBehaviour?: unknown;
  costToServe?: unknown;
  /** "true" to show only customers whose potential has never been assessed. */
  notAssessed?: unknown;
}

const asNumber = (value: unknown): number | undefined => {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const text = String(value).trim();
  if (!text) return undefined;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const asText = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text && text !== "all" ? text : undefined;
};

/** Turns the value filters into a `where` fragment, or nothing. */
function valueClause(filters: CustomerValueFilters | undefined): Record<string, unknown>[] {
  if (!filters) return [];
  const and: Record<string, unknown>[] = [];
  const metrics: Record<string, unknown> = {};

  const rank = asText(filters.rank);
  if (rank) metrics.customerValueRank = rank;

  const range = (min: unknown, max: unknown) => {
    const lo = asNumber(min);
    const hi = asNumber(max);
    if (lo === undefined && hi === undefined) return undefined;
    return { ...(lo !== undefined ? { gte: lo } : {}), ...(hi !== undefined ? { lte: hi } : {}) };
  };

  const realized = range(filters.minRealized, filters.maxRealized);
  if (realized) metrics.realizedValueScore = realized;
  const potential = range(filters.minPotential, filters.maxPotential);
  if (potential) metrics.potentialValueScore = potential;
  const profit = range(filters.minGrossProfit, filters.maxGrossProfit);
  if (profit) metrics.grossProfitRial = profit;

  const months = asNumber(filters.lastPurchaseWithinMonths);
  if (months !== undefined && months > 0) {
    const since = new Date();
    since.setUTCMonth(since.getUTCMonth() - months);
    metrics.lastPurchaseDate = { gte: since };
  }

  if (Object.keys(metrics).length > 0) and.push({ valueMetrics: metrics });

  const payment = asText(filters.paymentBehaviour);
  if (payment) and.push({ paymentBehaviour: payment });
  const cost = asText(filters.costToServe);
  if (cost) and.push({ costToServe: cost });

  // "Never assessed" is any of the five parameters being blank — the same
  // all-or-nothing rule the score itself uses.
  if (asText(filters.notAssessed) === "true") {
    and.push({
      OR: [
        { potentialConsumption: null }, { potentialCompanySize: null },
        { potentialProjects: null }, { potentialPortfolioFit: null },
        { potentialRepeatPurchase: null },
      ],
    });
  }

  return and;
}

export function buildCustomerWhere(
  q: ListQuery,
  user: AuthUser,
  extra: { customField?: unknown; linkedTo?: unknown; value?: CustomerValueFilters } = {},
): Record<string, unknown> {
  const and: Record<string, unknown>[] = [...valueClause(extra.value)];

  const visibility = visibilityClause(user);
  if (visibility) and.push(visibility);

  const search = searchClause(q.search, SEARCH_FIELDS);
  if (search) and.push(search);

  for (const [field, value] of Object.entries(q.filters)) {
    and.push({ [field]: value });
  }

  // Only the customers linked to this one — the contacts of a company.
  //
  // Either direction. `setCustomerLinks` writes the pair both ways, so one side
  // would be enough for anything saved through this application; a link that
  // arrived from the old document store may exist only as it was first entered,
  // and asking for one direction would hide those contacts entirely.
  if (typeof extra.linkedTo === "string" && extra.linkedTo) {
    and.push({
      OR: [
        { linksFrom: { some: { toId: extra.linkedTo } } },
        { linksTo: { some: { fromId: extra.linkedTo } } },
      ],
    });
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
  // The proforma form derives the honorific from it, so it cannot wait for the
  // detail record — the form has only a row when the buyer is chosen.
  gender: true,
  position: true, // The grid's «سمت» column, and dropdown disambiguation
  keyPerson: true, // The grid's «شخص کلیدی» column
  ownerUserId: true,
  createdAt: true,
  customValues: true,
  // The grid shows who each customer is linked to. Joined here rather than
  // fetched per row, which would be one request per visible customer.
  linksFrom: {
    select: { to: { select: { id: true, companyName: true, customerType: true } } },
  },
  // The manual half of customer value, which the grid shows and the form edits.
  potentialValueScore: true,
  paymentBehaviour: true,
  paymentReviewed: true,
  costToServe: true,
  costToServeReviewed: true,
  // The computed half. A join rather than columns on this row: see the note on
  // CustomerValueMetrics in the schema.
  valueMetrics: {
    select: {
      customerValueRank: true, customerValueIndex: true,
      realizedValueScore: true, potentialValueScore: true,
      grossProfitRial: true, salesRevenueRial: true, grossMarginPercent: true,
      costCoveragePercent: true, purchaseFrequency: true,
      lastPurchaseDateJalali: true, daysSinceLastPurchase: true,
      grossProfitScore: true, frequencyScore: true, recencyScore: true,
      paymentScore: true, costToServeScore: true,
      calculatedAt: true,
    },
  },
} as const;

/** Sorting by a metrics column needs the relation, and is allowlisted apart. */
function customerOrderBy(q: ListQuery): Record<string, unknown> {
  if (!q.sort) return { createdAt: "desc" };
  if ((CUSTOMER_METRIC_SORTABLE as readonly string[]).includes(q.sort)) {
    return { valueMetrics: { [q.sort]: q.order } };
  }
  return { [q.sort]: q.order };
}

export async function listCustomers(
  q: ListQuery,
  user: AuthUser,
  extra: { customField?: unknown; linkedTo?: unknown; value?: CustomerValueFilters } = {},
): Promise<ListResult<Record<string, unknown>>> {
  const db = getDb();
  const where = buildCustomerWhere(q, user, extra);
  const orderBy = customerOrderBy(q);

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
    include: DETAIL_INCLUDE,
  });
  return customer;
}

/**
 * The relations a detail record carries.
 *
 * Shared with the write paths on purpose: the client's `detailToCustomer` reads
 * `linksFrom` and `agreements` unguarded, so a create or an update that answered
 * with the bare row threw in the browser *after* the record had been written —
 * the customer existed, and the form reported a failure and dropped it.
 */
const DETAIL_INCLUDE = {
  agreements: { orderBy: { createdAt: "desc" } },
  linksFrom: { include: { to: { select: { id: true, companyName: true, customerType: true } } } },
} as const;

/** Re-reads a just-written record in the shape a detail response has. */
async function readDetail(id: string) {
  return getDb().customer.findUnique({ where: { id }, include: DETAIL_INCLUDE });
}

/**
 * What a customer is attached to, for the delete flow.
 *
 * `total` counts only **business history** — the records that would lose their
 * meaning if the customer vanished, and so must be moved to a replacement
 * instead. Links and agreements are reported for the confirmation dialog but
 * deliberately excluded: a link is a relationship, not a document, and an
 * agreement is a note the customer owns. Demanding a replacement customer merely
 * because someone is linked to a company would make ordinary deletion
 * impossible, so both are simply removed with the customer.
 */
export async function countCustomerReferences(id: string) {
  const db = getDb();
  const [projects, proformas, transactions, links, agreements] = await Promise.all([
    db.project.count({ where: { customerId: id } }),
    db.proforma.count({ where: { customerId: id } }),
    db.transaction.count({ where: { customerId: id } }),
    db.customerLink.count({ where: { OR: [{ fromId: id }, { toId: id }] } }),
    db.customerAgreement.count({ where: { customerId: id } }),
  ]);
  return {
    projects, proformas, transactions, links, agreements,
    total: projects + proformas + transactions,
  };
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

  /**
   * The manual half of customer value. The computed half is never writable —
   * a client that could set its own rank could set it to A.
   */
  potentialConsumption?: unknown;
  potentialCompanySize?: unknown;
  potentialProjects?: unknown;
  potentialPortfolioFit?: unknown;
  potentialRepeatPurchase?: unknown;
  paymentBehaviour?: string | null;
  costToServe?: string | null;
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

/**
 * Existing customers that might be the same entity as `candidate`.
 *
 * Duplicate detection used to run over every customer the browser had loaded,
 * which pagination makes impossible — the check would silently only see the
 * current page and stop catching anything.
 *
 * The rules themselves stay in `src/utils/customerDuplicates.ts` and are not
 * reimplemented here; two copies would drift and the weaker one would be the one
 * making the decision. Instead this narrows the table to the handful of rows that
 * could possibly match — same type, and sharing at least one identifying field —
 * and the caller runs the real rules over that. The narrowing is deliberately
 * looser than the rules (name OR phone, rather than name AND phone), so it can
 * only ever return a superset.
 */
export async function findDuplicateCandidates(
  candidate: {
    id?: string;
    customerType: string;
    companyName?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    mobile?: string | null;
    phone?: string | null;
    email?: string | null;
    province?: string | null;
    economicCode?: string | null;
  },
  user: AuthUser,
) {
  const db = getDb();
  const or: Record<string, unknown>[] = [];

  const economicCode = (candidate.economicCode ?? "").trim();
  if (economicCode) or.push({ economicCode });

  const mobileNormalized = normalizeMobile(candidate.mobile);
  if (mobileNormalized) or.push({ mobileNormalized });

  const email = (candidate.email ?? "").trim().toLowerCase();
  if (email) or.push({ email });

  const phone = (candidate.phone ?? "").trim();
  if (phone) or.push({ phone });

  const province = (candidate.province ?? "").trim();
  if (province) or.push({ province });

  // The name is what makes a phone or province match meaningful, so it has to be
  // in the net too — searched across both the company name and the person's.
  const name = (candidate.companyName ?? "").trim()
    || `${candidate.firstName ?? ""} ${candidate.lastName ?? ""}`.trim();
  if (name) {
    or.push({ companyName: { contains: name } });
    if (candidate.lastName) or.push({ lastName: { contains: candidate.lastName.trim() } });
  }

  // Nothing identifying was supplied, so nothing can be matched against.
  if (or.length === 0) return [];

  const and: Record<string, unknown>[] = [
    // A حقیقی and a حقوقی are never the same entity.
    { customerType: candidate.customerType },
    { OR: or },
  ];
  // A record being edited must not match itself.
  if (candidate.id) and.push({ id: { not: candidate.id } });

  const visibility = visibilityClause(user);
  if (visibility) and.push(visibility);

  return db.customer.findMany({
    where: { AND: and },
    // A generous ceiling: the rules only need to describe the matches, and a
    // candidate sharing a province with thousands of records is not a signal.
    take: 50,
    select: {
      id: true, customerType: true, companyName: true, firstName: true, lastName: true,
      mobile: true, phone: true, email: true, province: true, economicCode: true,
      industry: true, city: true, createdAt: true,
    },
  });
}


/* ------------------------- the manual value fields ----------------------- */

const POTENTIAL_COLUMNS = [
  "potentialConsumption", "potentialCompanySize", "potentialProjects",
  "potentialPortfolioFit", "potentialRepeatPurchase",
] as const;

/** A potential answer is 1..5, or nothing. Anything else is nothing. */
function potentialAnswer(value: unknown): number | null {
  if (value === null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n);
  return rounded >= 1 && rounded <= 5 ? rounded : null;
}

/**
 * Normalizes the manual customer-value fields a write carries.
 *
 * The five potential answers are coerced to 1..5, the score is **recomputed
 * here** rather than taken from the request — a client that could post its own
 * potential score could post 100 — and choosing a payment or cost-to-serve
 * value marks it reviewed, which is what separates a judgement from the
 * placeholder the migration wrote.
 */
async function applyValueFields(
  data: Record<string, unknown>,
  input: Partial<CustomerInput>,
  before: { [k: string]: unknown } | null,
  user: AuthUser,
): Promise<{ potentialChanged: boolean; previousScore: number | null; nextScore: number | null }> {
  const touched = POTENTIAL_COLUMNS.some((key) => key in input);

  const answers: Record<string, number | null> = {};
  for (const key of POTENTIAL_COLUMNS) {
    answers[key] = key in input
      ? potentialAnswer((input as Record<string, unknown>)[key])
      : potentialAnswer(before?.[key]);
    if (key in input) data[key] = answers[key];
  }

  const settings = await loadCustomerValueSettings();
  const nextScore = calculatePotentialScore({
    consumption: answers.potentialConsumption,
    companySize: answers.potentialCompanySize,
    projects: answers.potentialProjects,
    portfolioFit: answers.potentialPortfolioFit,
    repeatPurchase: answers.potentialRepeatPurchase,
  }, settings);

  const previousScore = (before?.potentialValueScore as number | null | undefined) ?? null;

  if (touched) {
    data.potentialValueScore = nextScore;
    data.potentialAssessedAt = new Date();
    data.potentialAssessedBy = user.id;
  }

  if ("paymentBehaviour" in input) data.paymentReviewed = true;
  if ("costToServe" in input) data.costToServeReviewed = true;

  return { potentialChanged: touched && previousScore !== nextScore, previousScore, nextScore };
}

/** Appends one entry to the potential-assessment log. Never fails the write. */
async function logPotentialChange(
  customerId: string,
  previousScore: number | null,
  nextScore: number | null,
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
  user: AuthUser,
): Promise<void> {
  const pick = (source: Record<string, unknown> | null) => {
    if (!source) return null;
    const out: Record<string, unknown> = {};
    for (const key of POTENTIAL_COLUMNS) out[key] = source[key] ?? null;
    return JSON.stringify(out);
  };

  await getDb().customerPotentialHistory.create({
    data: {
      customerId,
      previousScore,
      newScore: nextScore,
      previousParams: pick(before),
      newParams: pick(after),
      changedBy: user.id,
      changedByName: user.fullName ?? null,
    },
  });
}

export async function createCustomer(input: CustomerInput, user: AuthUser, todayJalali: string) {
  const db = getDb();
  const data: Record<string, unknown> = { ...input };
  const potential = await applyValueFields(data, input, null, user);

  const customer = await db.customer.create({
    data: {
      ...(data as Prisma.CustomerUncheckedCreateInput),
      status: input.status || "فعال",
      mobileNormalized: normalizeMobile(input.mobile),
      // Unassigned records default to their creator, so ownership rules have
      // something to work with from the start.
      ownerUserId: input.ownerUserId ?? user.id,
    },
  });

  // The first assessment is a change of view like any other, and belongs in the
  // log — otherwise the history starts only at the second opinion.
  if (potential.potentialChanged) {
    await afterCommit("customer potential history", () =>
      logPotentialChange(customer.id, potential.previousScore, potential.nextScore,
        null, customer as unknown as Record<string, unknown>, user));
  }

  // Audit log
  const label = customer.companyName || `${customer.firstName || ""} ${customer.lastName || ""}`.trim();
  await logAction(
    {
      action: "CREATE",
      module: "مشتریان",
      entityId: customer.id,
      description: `ایجاد مشتری جدید: ${label}`,
      afterState: customer,
    },
    user,
    todayJalali,
  );

  // Notification
  await notifyModuleResponsible(
    "customers",
    "ثبت مشتری جدید",
    `مشتری جدید ثبت شد: ${label}`,
    user,
    null,
  );

  // Workflow rules
  await processWorkflowRules(
    "customer_created",
    {
      customerId: customer.id,
      customerName: label,
      // `type` and `city` are the names the rule editor offers as condition
      // fields; customerType and province are kept for rules written against
      // them. A field the editor offers and the payload omits is a rule that
      // silently never matches.
      type: customer.customerType,
      customerType: customer.customerType,
      city: customer.city,
      province: customer.province,
      industry: customer.industry,
    },
    user,
  );

  return readDetail(customer.id);
}

export async function updateCustomer(id: string, input: Partial<CustomerInput>, user: AuthUser, todayJalali: string) {
  const db = getDb();
  const visibility = visibilityClause(user);
  if (visibility) {
    const allowed = await db.customer.findFirst({ where: { AND: [{ id }, visibility] }, select: { id: true } });
    if (!allowed) return null;
  }

  // Get before state for audit log
  const before = await db.customer.findUnique({ where: { id } });
  if (!before) return null;

  const data: Record<string, unknown> = { ...input };
  if ("mobile" in input) data.mobileNormalized = normalizeMobile(input.mobile);
  const potential = await applyValueFields(data, input, before as unknown as Record<string, unknown>, user);

  const customer = await db.customer.update({ where: { id }, data });

  if (potential.potentialChanged) {
    await afterCommit("customer potential history", () =>
      logPotentialChange(id, potential.previousScore, potential.nextScore,
        before as unknown as Record<string, unknown>,
        customer as unknown as Record<string, unknown>, user));
  }

  // Audit log
  const label = customer.companyName || `${customer.firstName || ""} ${customer.lastName || ""}`.trim();
  await logAction(
    {
      action: "UPDATE",
      module: "مشتریان",
      entityId: customer.id,
      description: `ویرایش اطلاعات مشتری: ${label}`,
      beforeState: before,
      afterState: customer,
    },
    user,
    todayJalali,
  );

  // Workflow rules
  await processWorkflowRules(
    "customer_updated",
    {
      customerId: customer.id,
      customerName: label,
      type: customer.customerType,
      customerType: customer.customerType,
      oldType: before.customerType,
      city: customer.city,
      province: customer.province,
      industry: customer.industry,
      oldProvince: before.province,
      oldIndustry: before.industry,
    },
    user,
  );

  return readDetail(customer.id);
}

/**
 * Replaces a customer's links.
 *
 * The UI treats a link as symmetric — linking a person to a company shows on
 * both — while the table stores a directed pair. The client used to keep the two
 * sides in step by rewriting every customer's `linkedCustomerIds` array on every
 * save, which is exactly the whole-collection write this migration removes.
 *
 * Here both directions are written together, inside one transaction, so the pair
 * can never be observed half-linked. Passing an empty list clears them.
 */
export async function setCustomerLinks(
  id: string,
  linkedIds: string[],
  user: AuthUser,
): Promise<"ok" | "forbidden" | "not-found"> {
  const db = getDb();
  const visibility = visibilityClause(user);

  const existing = await db.customer.findFirst({
    where: visibility ? { AND: [{ id }, visibility] } : { id },
    select: { id: true },
  });
  if (!existing) return visibility ? "forbidden" : "not-found";

  // A customer linked to itself is meaningless, and duplicates would collide on
  // the composite key.
  const wanted = [...new Set(linkedIds.filter((other) => other && other !== id))];

  return db.$transaction(async (tx) => {
    // Only link to customers that exist — a stale id from an open form would
    // otherwise fail the whole save on a foreign key.
    const real = await tx.customer.findMany({
      where: { id: { in: wanted } },
      select: { id: true },
    });
    const valid = new Set(real.map((r) => r.id));

    await tx.customerLink.deleteMany({ where: { OR: [{ fromId: id }, { toId: id }] } });

    for (const other of wanted) {
      if (!valid.has(other)) continue;
      // Both directions, so either customer's detail view shows the link.
      await tx.customerLink.create({ data: { fromId: id, toId: other } });
      await tx.customerLink.create({ data: { fromId: other, toId: id } });
    }
    return "ok" as const;
  });
}

/**
 * Replaces a customer's per-module agreement texts.
 *
 * These are notes owned by the customer and referenced by nothing, so rebuilding
 * them with the parent is safe — unlike the links above, which are shared.
 */
export async function setCustomerAgreements(
  id: string,
  agreements: { moduleName?: string; text?: string; createdBy?: string | null }[],
  user: AuthUser,
): Promise<"ok" | "forbidden" | "not-found"> {
  const db = getDb();
  const visibility = visibilityClause(user);

  const existing = await db.customer.findFirst({
    where: visibility ? { AND: [{ id }, visibility] } : { id },
    select: { id: true },
  });
  if (!existing) return visibility ? "forbidden" : "not-found";

  return db.$transaction(async (tx) => {
    await tx.customerAgreement.deleteMany({ where: { customerId: id } });

    for (const row of agreements ?? []) {
      const text = (row?.text ?? "").trim();
      const moduleName = (row?.moduleName ?? "").trim();
      if (!text || !moduleName) continue; // a blank row in the form
      await tx.customerAgreement.create({
        data: {
          customerId: id,
          moduleName: moduleName.slice(0, 100),
          text,
          createdBy: row.createdBy ? String(row.createdBy).slice(0, 200) : null,
        },
      });
    }
    return "ok" as const;
  });
}

export async function deleteCustomer(id: string, user: AuthUser, todayJalali: string): Promise<boolean> {
  const db = getDb();
  const visibility = visibilityClause(user);
  if (visibility) {
    const allowed = await db.customer.findFirst({ where: { AND: [{ id }, visibility] }, select: { id: true } });
    if (!allowed) return false;
  }

  // Get customer info for audit log before deletion
  const customer = await db.customer.findUnique({ where: { id } });
  if (!customer) return false;

  await db.$transaction(async (tx) => {
    // Links pointing *at* this customer are onDelete: NoAction, so they would
    // block the delete on a foreign key. They are relationships rather than
    // history and go with the customer.
    await tx.customerLink.deleteMany({ where: { OR: [{ fromId: id }, { toId: id }] } });
    await tx.customer.delete({ where: { id } });
  });

  // Audit log
  const label = customer.companyName || `${customer.firstName || ""} ${customer.lastName || ""}`.trim();
  await logAction(
    {
      action: "DELETE",
      module: "مشتریان",
      entityId: id,
      description: `حذف مشتری: ${label}`,
      beforeState: customer,
    },
    user,
    todayJalali,
  );

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
