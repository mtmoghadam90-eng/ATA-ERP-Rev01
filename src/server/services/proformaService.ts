import { Prisma } from "@prisma/client";
import { getDb } from "../db";
import { formatMoney } from "../../numUtils";
import { ListQuery, ListResult, buildResult, paginationArgs, searchClause } from "../listing";
import { AuthUser, hasPermission } from "../auth";
import { expandDateFields, jalaliRangeFilter, jalaliToDate, normalizeJalali } from "../dates";
import { syncChildren, toJsonColumn, toNullableString, toNumber } from "../childSync";
import { scrubProductRefs } from "../refIntegrity";
import { afterCommit } from "../afterCommit";
import { closeFollowUpTasks } from "./followUpService";
import { isTerminalOutcome, versionRefusalReason } from "../../utils/salesFollowUp";
import { describeProformaChanges, proformaChangeSentence } from "./proformaChanges";
import {
  ProformaOutcome, deriveProjectStatus, getProformaOutcome, getWonItems, isWonStatus,
  outcomeWhere, statusWithoutProformas,
} from "../proformaStatus";
import { logAction } from "./auditService";
import { notifyModuleResponsible } from "./notificationService";
import { processWorkflowRules } from "./workflowService";
import { ACTIVITY_CATEGORY, logProjectFact, settleRecordHistory } from "./projectActivityLog";
import { applyStockDelta } from "./productService";
import { scheduleCustomerValueRecalculation } from "./customerValueRecalc";
import { ProformaTotals, computeProformaTotals } from "../../utils/proformaTotals";
import { COST_SOURCES, CostSource, LineCost, lineNeedsCost } from "../../utils/costOfGoods";
import { preserveLineCosts } from "../costs";
import { canSeeCosts } from "../auth";

/**
 * Proforma data access.
 *
 * The distinguishing feature of this module is that the outcome is *derived*
 * from the line items, and the parent project's status is derived in turn from
 * its proformas — see src/server/proformaStatus.ts. Writing a proforma therefore
 * also re-derives its project, inside the same transaction, so the two can never
 * be observed disagreeing.
 */

export const PROFORMA_SORTABLE = [
  "proformaNumber", "status", "issueDate", "expiryDate", "finalAmount",
  "createdAt", "updatedAt",
] as const;

export const PROFORMA_FILTERABLE = [
  "status", "customerId", "projectId", "currency", "proformaType", "creatorUserId",
] as const;

const SEARCH_FIELDS = ["proformaNumber", "notes", "contactPrefix"] as const;

export const PROFORMA_DATE_FIELDS = ["issueDate", "expiryDate", "deliveryDate", "sentDate"] as const;

/** The stored status that means the document has gone to the customer. */
const SENT_STATUS = "ارسال شده";

/**
 * Stamps the day a proforma was sent, on the transition into «ارسال شده».
 *
 * Nothing recorded *when* a quotation went out — the issue date is the day it
 * was written, and a document drafted on Sunday and sent on Wednesday counted
 * three days that had not happened. A follow-up scheduled "three days after it
 * was sent" needs the real day, so the transition writes it.
 *
 * The transition, not the state: re-saving a sent proforma must not move the
 * date forward, or the follow-up would be pushed back by every edit. Sending it
 * again after taking it back to a draft does re-stamp it, because that is a new
 * send.
 */
export function stampSentDate(
  data: Record<string, unknown>,
  previousStatus: string | null | undefined,
  todayJalali: string,
): void {
  const nextStatus = "status" in data ? String(data.status ?? "") : previousStatus ?? "";
  if (nextStatus !== SENT_STATUS || previousStatus === SENT_STATUS) return;
  // Only when the save did not set one itself.
  if (data.sentDateJalali) return;
  Object.assign(data, expandDateFields({ sentDate: todayJalali }, ["sentDate"]));
}

/**
 * Proformas have no `ownerUserId` of their own — they belong to a customer and a
 * project. A user without the module permission sees the ones they created,
 * which is the closest thing to ownership the record carries.
 */
export function visibilityClause(user: AuthUser): Record<string, unknown> | undefined {
  if (hasPermission(user, "proformas")) return undefined;
  return { creatorUserId: user.id };
}

export function buildProformaWhere(
  q: ListQuery,
  user: AuthUser,
  extra: { dateFrom?: unknown; dateTo?: unknown; isCancelled?: unknown } = {},
): Record<string, unknown> {
  const and: Record<string, unknown>[] = [];

  const visibility = visibilityClause(user);
  if (visibility) and.push(visibility);

  if (q.search) {
    // The grid's one search box also matches the customer's and the project's
    // name, neither of which is a column on the proforma.
    const own = searchClause(q.search, SEARCH_FIELDS);
    const byCustomer = searchClause(q.search, ["companyName"]);
    const byProject = searchClause(q.search, ["name", "code"]);

    const alternatives: Record<string, unknown>[] = [];
    if (own) alternatives.push(...own.OR);
    if (byCustomer) alternatives.push({ customer: byCustomer });
    if (byProject) alternatives.push({ project: byProject });
    if (alternatives.length > 0) and.push({ OR: alternatives });
  }

  for (const [field, value] of Object.entries(q.filters)) {
    /*
     * The status filter means the outcome, because the outcome is what the
     * grid prints. Sent at the column it only ever matched «پیش‌نویس» and
     * «ارسال شده»; the other options are derived from the lines and the
     * cancellation flag, so asking the column for one returned nothing at all.
     * `outcomeWhere` turns each into the query that finds it.
     */
    if (field === "status") {
      const byOutcome = outcomeWhere(String(value));
      and.push(byOutcome ?? { status: value });
      continue;
    }
    and.push({ [field]: value });
  }

  const range = jalaliRangeFilter(extra.dateFrom, extra.dateTo);
  if (range) and.push({ issueDate: range });

  // Cancelled proformas are hidden unless asked for, matching the UI default.
  if (extra.isCancelled === "true") and.push({ isCancelled: true });
  else if (extra.isCancelled === "false") and.push({ isCancelled: false });

  return and.length === 0 ? {} : { AND: and };
}

/**
 * List columns.
 *
 * Item statuses are included because the outcome is derived from them and the
 * list has to show it; they are two small columns per line, not the whole line.
 */
const LIST_SELECT = {
  id: true,
  proformaNumber: true,
  proformaType: true,
  status: true,
  isCancelled: true,
  currency: true,
  customerId: true,
  projectId: true,
  issueDate: true,
  issueDateJalali: true,
  expiryDateJalali: true,
  totalAmount: true,
  finalAmount: true,
  // The rate the document was priced at. On the row because the transactions
  // screen fills a receipt's settlement rate from the proforma being paid, and
  // a picker only ever holds rows — reading it off one that did not carry the
  // column meant the box was filled with nothing, every time.
  historicalExchangeRate: true,
  creatorUserId: true,
  createdAt: true,
  customer: { select: { id: true, companyName: true, customerType: true } },
  // The grid groups by project and its header shows the project's own status,
  // so that comes down with the row rather than being looked up separately.
  // The grid groups by project and prints «کارفرما: …» under its name, so the
  // project's customer comes down with the row rather than being looked up.
  project: {
    select: {
      id: true, code: true, name: true, status: true,
      customer: { select: { id: true, companyName: true } },
    },
  },
  creator: { select: { id: true, fullName: true } },
  // The card prints all three: how the proforma was sent and to whom, the
  // reason a lost one was lost, and the custom-field column.
  sentMethod: true,
  sentRecipients: true,
  lossReason: true,
  customValues: true,
  // The day the quotation actually went out. The card prints it beside «ارسال
  // شده»: the issue date is when the document was written, which is a different
  // thing and routinely a different day.
  sentDateJalali: true,
  // The follow-up state, and both ends of the revision chain.
  //
  // The card prints «نسخه جدید از PF-A» and «نسخه بعدی: PF-B», and both are
  // relations rather than columns — read here so the grid does not have to
  // resolve a proforma number out of whatever page the picker happens to hold,
  // which is the mistake this codebase keeps having to undo.
  followUpState: true,
  deferredUntilJalali: true,
  previousVersionId: true,
  previousVersion: { select: { id: true, proformaNumber: true } },
  nextVersions: { select: { id: true, proformaNumber: true }, take: 1 },
  // The grid lists each line's name and quantity beside the customer, and
  // colours it by status — four small columns, not the whole line.
  items: {
    orderBy: { lineNo: "asc" },
    select: { id: true, productName: true, quantity: true, status: true, supplyMethod: true },
  },
  _count: { select: { items: true } },
} satisfies Prisma.ProformaSelect;

/** Attaches the derived outcome so callers never re-implement the rules. */
function withOutcome<T extends { items?: { status?: string | null; supplyMethod?: string | null }[]; status?: string | null; isCancelled?: boolean | null }>(
  row: T,
): T & { outcomeStatus: ProformaOutcome } {
  return { ...row, outcomeStatus: getProformaOutcome(row) };
}

export async function listProformas(
  q: ListQuery,
  user: AuthUser,
  extra: { dateFrom?: unknown; dateTo?: unknown; isCancelled?: unknown } = {},
): Promise<ListResult<Record<string, unknown>>> {
  const db = getDb();
  const where = buildProformaWhere(q, user, extra);
  const orderBy = q.sort ? { [q.sort]: q.order } : { createdAt: "desc" as const };

  const [rows, total] = await Promise.all([
    db.proforma.findMany({ where, orderBy, select: LIST_SELECT, ...paginationArgs(q) }),
    db.proforma.count({ where }),
  ]);

  return buildResult(
    rows.map((r) => withOutcome(r)) as unknown as Record<string, unknown>[],
    total,
    q,
  );
}

export async function getProforma(id: string, user: AuthUser) {
  const db = getDb();
  const visibility = visibilityClause(user);

  const proforma = await db.proforma.findFirst({
    where: visibility ? { AND: [{ id }, visibility] } : { id },
    include: {
      customer: { select: { id: true, companyName: true, customerType: true, economicCode: true, address: true, phone: true } },
      contact: { select: { id: true, companyName: true } },
      project: { select: { id: true, code: true, name: true, status: true } },
      creator: { select: { id: true, fullName: true, signatureImage: true } },
      items: { orderBy: { lineNo: "asc" } },
    },
  });
  if (!proforma) return null;

  return {
    ...withOutcome(proforma),
    // Which lines count as won, so the client does not re-derive it.
    wonItemIds: getWonItems(proforma, true).map((i) => i.id),
  };
}

/* --------------------------------- writes --------------------------------- */

export interface ProformaItemInput {
  /**
   * The id the client read this line under.
   *
   * A correlation key, not a stored value: `mapItem` leaves it out, and
   * `syncChildren` re-inserts every line with a fresh id on each save. It exists
   * so a save by a user who cannot see costs can be matched back to the stored
   * line and have its cost put back — see `preserveLineCosts`.
   */
  id?: string | null;
  productId?: string | null;
  variantId?: string | null;
  productName?: string;
  productCode?: string | null;
  brand?: string | null;
  tagNumber?: string | null;
  quantity?: unknown;
  unit?: string | null;
  unitPriceRial?: unknown;
  totalPriceRial?: unknown;
  unitCost?: unknown;
  costCurrency?: string | null;
  costSource?: string | null;
  supplyMethod?: string | null;
  status?: string | null;
  lossReason?: string | null;
  techSpecs?: string | null;
  deliveryRange?: string | null;
  deliveryUnit?: string | null;
  deliveryType?: string | null;
  deliveryPostfix?: string | null;
  selectedFeatures?: unknown;
  selectedImage?: string | null;
}

/**
 * Refuses a second revision of the same document.
 *
 * A chain is A → B → C, and it is a chain because "the current version" has to
 * mean something. Allowing a second revision straight off A forks it, and
 * neither branch is the live one; the person almost always meant to revise B,
 * so that is what the message says.
 *
 * Thrown rather than returned: the message is Persian, which is what `sendError`
 * turns into a 400 for the form to show. Checked inside the write transaction
 * because the answer is only worth anything at the moment of writing.
 */
export async function assertVersionChain(
  tx: Prisma.TransactionClient,
  previousVersionId: string | null | undefined,
  selfId?: string,
): Promise<void> {
  if (!previousVersionId) return;

  const base = await tx.proforma.findUnique({
    where: { id: previousVersionId },
    select: { id: true, proformaNumber: true },
  });
  if (!base) return; // A dangling id is the reference checker's problem, not this one.

  const existing = await tx.proforma.findFirst({
    where: {
      previousVersionId,
      ...(selfId ? { id: { not: selfId } } : {}),
    },
    select: { proformaNumber: true },
  });

  const refusal = versionRefusalReason({
    proformaNumber: base.proformaNumber,
    nextVersionNumber: existing?.proformaNumber ?? null,
  });
  if (refusal) throw new Error(refusal);
}

export interface ProformaInput {
  proformaNumber?: string;
  proformaType?: string;
  customerId?: string;
  contactCustomerId?: string | null;
  contactPrefix?: string | null;
  projectId?: string | null;
  status?: string;
  isCancelled?: boolean;
  lossReason?: string | null;
  currency?: string;
  issueDate?: string | null;
  expiryDate?: string | null;
  deliveryDate?: string | null;
  discountPercent?: unknown;
  discountAmount?: unknown;
  taxPercent?: unknown;
  taxAmount?: unknown;
  extraCosts?: unknown;
  historicalExchangeRate?: unknown;
  notes?: string | null;
  sentMethod?: string | null;
  sentRecipients?: unknown;
  customValues?: unknown;
  creatorUserId?: string | null;
  /**
   * The proforma this one revises, when it is explicitly a revision.
   *
   * Never inferred. A project may carry several open quotations at once — the
   * temperature instruments, the pressure instruments, the flow meters — so
   * sharing a project says nothing about one superseding another.
   */
  previousVersionId?: string | null;
  items?: ProformaItemInput[];
}

/**
 * What a line's cost column should hold, given what the client sent.
 *
 * Cost is the one figure on a line that the server cannot recompute — there is
 * no formula for what a thing cost us — so unlike the totals beside it, this is
 * taken from the request. What is *not* taken from the request is the shape:
 * an unrecognised source, a negative figure or a currency that disagrees with
 * the document would all corrupt a margin quietly, so each is normalized here.
 *
 * A `NONE` line stores a real zero rather than a null. That is the difference
 * between "this line costs nothing" — a service, or goods the customer supplies
 * — and "nobody has said yet", and the enforcement at save depends on being
 * able to tell them apart.
 */
export function normalizeLineCost(row: ProformaItemInput, currency: string): LineCost {
  const source = String(row.costSource ?? "").trim().toUpperCase();
  const known = (Object.values(COST_SOURCES) as string[]).includes(source)
    ? (source as CostSource)
    : null;

  if (known === COST_SOURCES.NONE) {
    return { unitCost: 0, costCurrency: currency, costSource: COST_SOURCES.NONE };
  }

  const raw = Number(toNumber(row.unitCost, NaN));
  if (!Number.isFinite(raw) || raw < 0) {
    return { unitCost: null, costCurrency: null, costSource: null };
  }

  return {
    unitCost: raw,
    // Always the document's currency, never the client's claim about it: the
    // figure sits next to a price in that currency, and a line labelled
    // otherwise would make the margin beside it arithmetic between two
    // different units.
    costCurrency: currency,
    costSource: known ?? COST_SOURCES.MANUAL,
  };
}

/**
 * Refuses a document any of whose lines has no cost.
 *
 * The rule the whole feature exists for: a sale with an uncosted line produces
 * a gross profit that is wrong in a direction nobody notices, because the
 * missing cost reads as pure margin — and that figure feeds the customer's
 * rank. Enforcing it here rather than only in the form means it holds for every
 * caller, including the outcome screen that marks lines won.
 *
 * "No cost" means nobody has said. A line explicitly marked `NONE` — a service,
 * or goods the customer supplies — has been answered and passes.
 */
export function assertLinesCosted(
  items: ProformaItemInput[],
  currency: string,
  proformaType: string | null | undefined,
): void {
  // A technical proforma quotes specifications, not prices — its lines carry no
  // money at all, so there is no cost for them to be missing and nowhere in its
  // form to enter one.
  if (proformaType === "TECHNICAL") return;

  const missing = items
    .map((row, index) => ({ row, index }))
    // Lines without a name are dropped by the mapper and never stored, so
    // demanding a cost for one would block a save over a row that does not
    // exist.
    .filter(({ row }) => toNullableString(row?.productName, 400))
    .filter(({ row }) => lineNeedsCost(normalizeLineCost(row, currency)))
    .map(({ row, index }) => toNullableString(row.productName, 400) ?? `ردیف ${index + 1}`);

  if (missing.length === 0) return;

  throw new Error(
    "بهای تمام‌شده برای این ردیف‌ها مشخص نشده است: "
    + missing.join("، ")
    + ". برای هر ردیف بهای تمام‌شده را وارد کنید یا گزینه «بدون بهای تمام‌شده» را انتخاب کنید.",
  );
}

/**
 * Builds the line mapper for one document.
 *
 * It takes the document's currency because a line's cost is recorded in that
 * currency, the same one its price is in — so a line that names no currency of
 * its own inherits the document's rather than being guessed at later.
 */
function itemMapper(currency: string) {
  return (row: ProformaItemInput) => mapItem(row, currency);
}

function mapItem(row: ProformaItemInput, currency: string): Record<string, unknown> | null {
  const productName = toNullableString(row?.productName, 400);
  if (!productName) return null;

  const quantity = toNumber(row.quantity, 1);
  const unitPrice = toNumber(row.unitPriceRial, 0);
  const cost = normalizeLineCost(row, currency);
  // Recompute rather than trust the client's arithmetic: a stale or tampered
  // line total would flow straight into the invoice total.
  const totalPrice = quantity * unitPrice;

  return {
    productId: toNullableString(row.productId, 36),
    variantId: toNullableString(row.variantId, 36),
    productName,
    productCode: toNullableString(row.productCode, 60),
    brand: toNullableString(row.brand, 150),
    tagNumber: toNullableString(row.tagNumber, 100),
    quantity,
    // The unit the line is counted in. Held on the line, not read from the
    // catalogue at print time: a document says what was quoted, and the
    // product's unit may be changed afterwards — or the line may not come from
    // the catalogue at all.
    unit: toNullableString(row.unit, 30),
    unitPriceRial: unitPrice,
    totalPriceRial: totalPrice,
    unitCost: cost.unitCost,
    costCurrency: cost.costCurrency,
    costSource: cost.costSource,
    supplyMethod: toNullableString(row.supplyMethod, 20),
    status: toNullableString(row.status, 30),
    lossReason: toNullableString(row.lossReason, 300),
    techSpecs: toNullableString(row.techSpecs),
    deliveryRange: toNullableString(row.deliveryRange, 50),
    deliveryUnit: toNullableString(row.deliveryUnit, 20),
    deliveryType: toNullableString(row.deliveryType, 20),
    deliveryPostfix: toNullableString(row.deliveryPostfix, 100),
    selectedFeatures: toJsonColumn(row.selectedFeatures),
    selectedImage: toNullableString(row.selectedImage, 500),
  };
}

/**
 * Money totals, computed from the lines rather than taken from the request.
 *
 * The client shows these live, but it must not be the authority: whatever it
 * sends, the stored total has to equal the sum of the stored lines or the
 * printed document contradicts itself.
 */
function computeTotals(
  items: ProformaItemInput[],
  input: ProformaInput,
): ProformaTotals {
  const lines = (items ?? [])
    .map((r) => mapItem(r, String(input.currency ?? "ریال")))
    .filter(Boolean) as Record<string, unknown>[];

  /*
   * The same arithmetic the form ran before the user pressed save.
   *
   * It used to be a second copy that did not round, so a document approved on
   * screen as «۹۶۸ دلار» was stored — and printed, and settled against — as
   * 968.22. See `src/utils/proformaTotals.ts`.
   */
  return computeProformaTotals({
    lineTotals: lines.map((l) => Number(l.totalPriceRial ?? 0)),
    discountPercent: input.discountPercent,
    discountAmount: input.discountAmount,
    taxPercent: input.taxPercent,
    taxAmount: input.taxAmount,
    extraCosts: input.extraCosts,
  });
}

function scalarData(input: ProformaInput): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const set = (key: string, value: unknown) => { if (value !== undefined) out[key] = value; };

  if ("proformaNumber" in input) set("proformaNumber", toNullableString(input.proformaNumber, 60));
  if ("proformaType" in input) set("proformaType", toNullableString(input.proformaType, 20) ?? "FINANCIAL");
  if ("customerId" in input) set("customerId", input.customerId);
  if ("contactCustomerId" in input) set("contactCustomerId", toNullableString(input.contactCustomerId, 36));
  if ("contactPrefix" in input) set("contactPrefix", toNullableString(input.contactPrefix, 100));
  if ("projectId" in input) set("projectId", toNullableString(input.projectId, 36));
  if ("status" in input) set("status", toNullableString(input.status, 50));
  if ("isCancelled" in input) set("isCancelled", !!input.isCancelled);
  if ("lossReason" in input) set("lossReason", toNullableString(input.lossReason, 300));
  if ("currency" in input) set("currency", toNullableString(input.currency, 20) ?? "ریال");
  if ("notes" in input) set("notes", toNullableString(input.notes));
  if ("sentMethod" in input) set("sentMethod", toNullableString(input.sentMethod, 100));
  if ("sentRecipients" in input) set("sentRecipients", toJsonColumn(input.sentRecipients));
  if ("customValues" in input) set("customValues", toJsonColumn(input.customValues));
  if ("creatorUserId" in input) set("creatorUserId", toNullableString(input.creatorUserId, 36));
  if ("previousVersionId" in input) set("previousVersionId", toNullableString(input.previousVersionId, 36));
  if ("historicalExchangeRate" in input) {
    set("historicalExchangeRate",
      input.historicalExchangeRate == null || input.historicalExchangeRate === ""
        ? null : toNumber(input.historicalExchangeRate));
  }

  return { ...out, ...expandDateFields(input as Record<string, unknown>, PROFORMA_DATE_FIELDS) };
}

/**
 * Re-derives the parent project's status from all its proformas.
 *
 * Called inside the writing transaction, so the project can never be seen
 * disagreeing with the proformas it was derived from. Also stamps the winning
 * and closing dates the first time a project becomes won — those are recorded
 * when it happens, and must not be overwritten on a later save.
 */
async function syncProjectStatus(
  tx: Prisma.TransactionClient,
  projectId: string | null | undefined,
  todayJalali: string,
): Promise<void> {
  if (!projectId) return;

  const proformas = await tx.proforma.findMany({
    where: { projectId },
    select: {
      id: true, status: true, isCancelled: true, createdAt: true,
      items: { select: { status: true, supplyMethod: true } },
    },
  });

  const project = await tx.project.findUnique({
    where: { id: projectId },
    select: { status: true, winningDate: true, closingDate: true },
  });
  if (!project) return;

  // No proformas left — the last one was deleted or moved to another project.
  // Its derived status has to go with it, or the project reports an outcome for
  // a document it no longer has.
  const nextStatus = proformas.length === 0
    ? statusWithoutProformas(project.status)
    : deriveProjectStatus(proformas);
  if (!nextStatus) return;

  const data: Record<string, unknown> = { status: nextStatus };

  if (isWonStatus(nextStatus)) {
    if (!project.winningDate) {
      data.winningDate = jalaliToDate(todayJalali);
      data.winningDateJalali = normalizeJalali(todayJalali);
    }
    if (!project.closingDate) {
      data.closingDate = jalaliToDate(todayJalali);
      data.closingDateJalali = normalizeJalali(todayJalali);
    }
  }

  await tx.project.update({ where: { id: projectId }, data });
}

/**
 * Reconcile inventory for proforma changes.
 *
 * Compares won items before and after, and adjusts stock accordingly:
 * - Old won items get added back (positive delta)
 * - New won items get deducted (negative delta)
 *
 * This is idempotent: calling it multiple times with the same before/after
 * produces the same net stock change.
 */
async function reconcileProformaStock(
  tx: Prisma.TransactionClient,
  before: { id: string; proformaNumber: string; items?: any[] } | null,
  after: { id: string; proformaNumber: string; items?: any[] },
  todayJalali: string,
) {
  // Cast to include the fields we need for stock adjustment
  type ItemWithStock = { productId?: string | null; variantId?: string | null; quantity?: number; status?: string | null; supplyMethod?: string | null };

  const oldWon = before ? getWonItems(before as any, false) as ItemWithStock[] : [];
  const newWon = getWonItems(after as any, false) as ItemWithStock[];

  // Revert old won items (add back to stock)
  for (const item of oldWon) {
    if (!item.productId) continue;
    await applyStockDelta(tx, {
      productId: item.productId,
      variantId: item.variantId ?? undefined,
      delta: item.quantity || 1,
      referenceType: "PROFORMA",
      referenceId: before!.id,
      notes: `بازگشت موجودی پیش‌فاکتور ${before!.proformaNumber}`,
      occurredAtJalali: todayJalali,
    });
  }

  // Deduct new won items (remove from stock)
  for (const item of newWon) {
    if (!item.productId) continue;
    await applyStockDelta(tx, {
      productId: item.productId,
      variantId: item.variantId ?? undefined,
      delta: -(item.quantity || 1),
      referenceType: "PROFORMA",
      referenceId: after.id,
      notes: `خروج به دلیل پیش‌فاکتور ${after.proformaNumber}`,
      occurredAtJalali: todayJalali,
    });
  }
}

export async function createProforma(input: ProformaInput, user: AuthUser, todayJalali: string) {
  const db = getDb();

  const proforma = await db.$transaction(async (tx) => {
    // A line may name a product or SKU that is no longer there — see
    // scrubProductRefs. The link goes, the document is still saved.
    // A user who cannot see costs sends none — their form has no cost field —
    // and there is nothing stored yet to put back, so the lines are created
    // blank. That is honest: this user could not have known the figure. The
    // check below is skipped for the same reason; demanding a cost from
    // somebody with no way to enter one would simply lock them out of the
    // screen.
    const items = preserveLineCosts(
      (await scrubProductRefs(tx, input.items)) ?? [], user, [],
    ) as ProformaItemInput[];

    const createCurrency = String(input.currency ?? "ریال");
    if (canSeeCosts(user)) assertLinesCosted(items, createCurrency, input.proformaType);
    // A revision names the document it revises, and a document may have one.
    await assertVersionChain(tx, input.previousVersionId);

    const createData: Record<string, unknown> = {
      ...scalarData(input),
      ...computeTotals(items, input),
      creatorUserId: input.creatorUserId ?? user.id,
    };
    stampSentDate(createData, null, todayJalali);

    const proforma = await tx.proforma.create({
      data: createData as Prisma.ProformaUncheckedCreateInput,
    });

    await syncChildren({
      delegate: tx.proformaItem, parentWhere: { proformaId: proforma.id },
      rows: items, map: itemMapper(createCurrency),
    });

    // Load full proforma with items to reconcile stock
    const fullProforma = await tx.proforma.findUnique({
      where: { id: proforma.id },
      include: { items: true },
    });

    if (fullProforma) {
      await reconcileProformaStock(tx, null, fullProforma, todayJalali);
    }

    await syncProjectStatus(tx, proforma.projectId, todayJalali);
    return proforma;
  });

  // A sale changes what every customer's percentile is measured against, so the
  // whole ranking is refreshed — coalesced, and never in the way of the save.
  scheduleCustomerValueRecalculation();

  // Audit log
  await afterCommit("proforma create", async () => {
    await logAction(
      {
        action: "CREATE",
        module: "پیش‌فاکتورها",
        entityId: proforma.id,
        description: `ایجاد پیش‌فاکتور جدید شماره ${proforma.proformaNumber} به مبلغ کل ${formatMoney(Number(proforma.finalAmount ?? 0))} ${proforma.currency || 'ریال'}`,
        afterState: proforma,
      },
      user,
      todayJalali,
    );

    // Notification
    await notifyModuleResponsible(
      "proformas",
      "صدور پیش‌فاکتور جدید",
      `پیش‌فاکتور جدید شماره ${proforma.proformaNumber} ثبت شد`,
      user,
      proforma.projectId,
    );

    // Workflow rules
    await processWorkflowRules(
      "proforma_created",
      {
        proformaId: proforma.id,
        proformaNumber: proforma.proformaNumber,
        projectId: proforma.projectId,
        customerId: proforma.customerId,
        finalAmount: proforma.finalAmount,
        totalAmount: proforma.totalAmount,
        currency: proforma.currency,
      },
      user,
    );

    /*
     * A document that arrives already sent has reached that status too.
     *
     * The status trigger otherwise only fires on an edit, and «صدور و ارسال در
     * یک ذخیره» is an ordinary way to work here — a rule reading "when the
     * status becomes ارسال شده" would simply not run for those, and the
     * quotation would go out with nobody assigned to chase it. A document
     * created as a draft has not changed status and does not fire.
     */
    if (proforma.status && proforma.status !== "پیش‌نویس") {
      await processWorkflowRules(
        "proforma_status_change",
        {
          proformaId: proforma.id,
          proformaNumber: proforma.proformaNumber,
          projectId: proforma.projectId,
          customerId: proforma.customerId,
          oldStatus: null,
          newStatus: proforma.status,
          status: proforma.status,
          sentDateJalali: proforma.sentDateJalali,
          proformaAmount: proforma.finalAmount,
        },
        user,
      );
    }

    await logProjectFact(
      {
        projectId: proforma.projectId,
        categoryName: ACTIVITY_CATEGORY.PROFORMAS,
        sourceType: "PROFORMA",
        sourceId: proforma.id,
        text:
          `پیش‌فاکتور شماره ${proforma.proformaNumber} شامل ${(input.items ?? []).length} قلم کالا` +
          ` توسط {actor} صادر شد` +
          (proforma.issueDateJalali ? ` (تاریخ صدور: ${proforma.issueDateJalali}` : " (")
          + (proforma.expiryDateJalali ? `، اعتبار تا ${proforma.expiryDateJalali}` : "")
          + `، وضعیت سند: ${proforma.status}).`,
      },
      user,
      todayJalali,
    );
  });

  // With the derived outcome attached, as the list and the detail read both do.
  // The write endpoints answered without it, so a caller that used what a write
  // returned — the adapter does — had `outcomeStatus` undefined until it read
  // the record back.
  return withOutcomeFor(proforma.id);
}

export async function updateProforma(
  id: string,
  input: ProformaInput,
  user: AuthUser,
  todayJalali: string,
) {
  const db = getDb();
  const visibility = visibilityClause(user);

  const result = await db.$transaction(async (tx) => {
    const existing = await tx.proforma.findFirst({
      where: visibility ? { AND: [{ id }, visibility] } : { id },
      select: { id: true, projectId: true, customerId: true, proformaNumber: true },
    });
    if (!existing) return null;

    // Get before state for audit and stock reconciliation
    const before = await tx.proforma.findUnique({
      where: { id },
      include: { items: true },
    });
    // Read while the previous values are still current: the timeline entry has
    // to name what the customer, the project and its status *were*.
    const beforeLabels = await readLabels(tx, before?.customerId, before?.projectId);

    const data: Record<string, unknown> = scalarData(input);

    // A partial save need not resend the currency, and a line's cost is
    // recorded in it — so fall back to what the document already is rather than
    // to rial, which would relabel every line on this document.
    const documentCurrency = String(input.currency ?? before?.currency ?? "ریال");

    // Their copy of this document arrived with the costs blanked, and the lines
    // are replaced wholesale on save — so without putting the stored figures
    // back, one edit by a warehouse account would erase the cost of every line
    // and, through it, the customer's gross profit.
    const items = preserveLineCosts(
      await scrubProductRefs(tx, input.items),
      user,
      before?.items ?? [],
    );
    if (items !== undefined && canSeeCosts(user)) {
      assertLinesCosted(items, documentCurrency, input.proformaType ?? before?.proformaType);
    }

    // Totals depend on the lines, so they can only be recomputed when the lines
    // are part of this request. Otherwise the stored totals already match the
    // stored lines and must be left alone.
    if (items !== undefined) {
      Object.assign(data, computeTotals(items, input));
    }

    stampSentDate(data, before?.status, todayJalali);

    const proforma = await tx.proforma.update({
      where: { id },
      data: data as Prisma.ProformaUncheckedUpdateInput,
    });

    if (items !== undefined) {
      await syncChildren({
        delegate: tx.proformaItem, parentWhere: { proformaId: id },
        rows: items, map: itemMapper(documentCurrency),
      });
    }

    // Load full updated proforma with items for stock reconciliation
    const after = await tx.proforma.findUnique({
      where: { id },
      include: { items: true },
    });

    if (after) {
      await reconcileProformaStock(tx, before, after, todayJalali);
    }

    if ("previousVersionId" in input) {
      await assertVersionChain(tx, input.previousVersionId, id);
    }

    /*
     * The sale ended, so the chase ends with it.
     *
     * Won, lost or cancelled: nobody should be left holding a follow-up on a
     * quotation whose result is known, and the person who set that result is
     * not going to go and tidy up somebody else's task list. Inside the
     * transaction on purpose — an outcome that stuck with a follow-up still
     * open is precisely the inconsistency the queue would then report for ever.
     *
     * Only when it *becomes* terminal, and only for follow-ups: an ordinary
     * task somebody attached to the same proforma ("send the calibration
     * certificates") does not stop being necessary because the quotation was
     * won.
     */
    const wasTerminal = before ? isTerminalOutcome(getProformaOutcome(before as never)) : false;
    const nowTerminal = isTerminalOutcome(
      getProformaOutcome((after ?? proforma) as never),
    );
    if (nowTerminal && !wasTerminal) {
      await closeFollowUpTasks(tx, id, todayJalali);
    }

    // Re-derive both projects when the proforma was moved between them, or the
    // old project keeps a status derived from a proforma it no longer has.
    await syncProjectStatus(tx, proforma.projectId, todayJalali);
    if (existing.projectId && existing.projectId !== proforma.projectId) {
      await syncProjectStatus(tx, existing.projectId, todayJalali);
    }

    const afterLabels = await readLabels(tx, proforma.customerId, proforma.projectId);

    return { proforma, before, after, beforeLabels, afterLabels };
  });

  scheduleCustomerValueRecalculation();

  if (result) {
    // Both sides carry their lines: the outcome is derived from them, and the
    // row an update returns has none — so this comparison used to see only the
    // send status and called that "the result of the items".
    const oldOutcome = result.before ? getProformaOutcome(result.before as any) : null;
    const newOutcome = getProformaOutcome((result.after ?? result.proforma) as any);

    // Audit log
    await afterCommit("proforma update", async () => {
      await logAction(
        {
          action: "UPDATE",
          module: "پیش‌فاکتورها",
          entityId: id,
          description: `ویرایش پیش‌فاکتور (شماره: ${result.proforma.proformaNumber})`,
          beforeState: result.before,
          afterState: result.proforma,
        },
        user,
        todayJalali,
      );

      /*
       * The stored status moved — which is a different event from the outcome.
       *
       * «پیش‌نویس» → «ارسال شده» is the moment a quotation goes out, and the
       * derived outcome does not change at all when it does: the lines are
       * still «جاری» either way. So the rule that raises a follow-up two days
       * after a quotation is sent has nothing to hang on unless this fires
       * separately.
       *
       * Only on a real change. A re-save that leaves the column where it was is
       * not an event, and firing on it would raise a follow-up every time
       * somebody corrected a typo — which is exactly what the duplicate check
       * on the action exists to survive, but the engine should not be relying
       * on it for something this easy to get right here.
       */
      if (result.before && result.before.status !== result.proforma.status) {
        await processWorkflowRules(
          "proforma_status_change",
          {
            proformaId: result.proforma.id,
            proformaNumber: result.proforma.proformaNumber,
            projectId: result.proforma.projectId,
            customerId: result.proforma.customerId,
            oldStatus: result.before.status,
            newStatus: result.proforma.status,
            status: result.proforma.status,
            sentDateJalali: result.proforma.sentDateJalali,
            proformaAmount: result.proforma.finalAmount,
          },
          user,
        );
      }

      // Workflow rules for outcome change
      if (oldOutcome !== newOutcome) {
        await processWorkflowRules(
          "proforma_outcome_change",
          {
            proformaId: result.proforma.id,
            proformaNumber: result.proforma.proformaNumber,
            projectId: result.proforma.projectId,
            customerId: result.proforma.customerId,
            oldOutcome,
            newOutcome,
            outcome: newOutcome,
            proformaAmount: result.proforma.finalAmount,
          },
          user,
        );
      }

      // What the edit actually did, spelled out — see proformaChanges.ts.
      await logProjectFact(
        {
          projectId: result.proforma.projectId,
          categoryName: ACTIVITY_CATEGORY.PROFORMAS,
          sourceType: "PROFORMA",
          sourceId: result.proforma.id,
          text: proformaChangeSentence(
            result.proforma.proformaNumber,
            describeProformaChanges(
              result.before as never,
              (result.after ?? result.proforma) as never,
              {
                customerBefore: result.beforeLabels.customerName,
                customerAfter: result.afterLabels.customerName,
                projectBefore: result.beforeLabels.projectName,
                projectAfter: result.afterLabels.projectName,
                projectStatusBefore: result.beforeLabels.projectStatus,
                projectStatusAfter: result.afterLabels.projectStatus,
              },
            ),
          ),
        },
        user,
        todayJalali,
      );
    });

    return withOutcomeFor(result.proforma.id);
  }

  return null;
}

/**
 * The names and the project status behind a proforma's ids.
 *
 * Read twice, on both sides of a write, so an entry can say what changed rather
 * than printing an id or claiming a recalculation that did not happen.
 */
async function readLabels(
  tx: Prisma.TransactionClient,
  customerId: string | null | undefined,
  projectId: string | null | undefined,
): Promise<{ customerName: string | null; projectName: string | null; projectStatus: string | null }> {
  const [customer, project] = await Promise.all([
    customerId
      ? tx.customer.findUnique({ where: { id: customerId }, select: { companyName: true } })
      : Promise.resolve(null),
    projectId
      ? tx.project.findUnique({ where: { id: projectId }, select: { name: true, status: true } })
      : Promise.resolve(null),
  ]);
  return {
    customerName: customer?.companyName ?? null,
    projectName: project?.name ?? null,
    projectStatus: project?.status ?? null,
  };
}

/**
 * Re-reads a proforma with its lines and its derived outcome.
 *
 * The outcome comes from the line statuses, so it can only be attached to a
 * record that carries them — which the row a write returns does not.
 */
async function withOutcomeFor(id: string) {
  const full = await getDb().proforma.findUnique({
    where: { id },
    include: { items: { orderBy: { lineNo: "asc" } } },
  });
  return full ? withOutcome(full) : null;
}

export async function countProformaReferences(id: string) {
  const db = getDb();
  const [purchaseOrders, transactions, deliveries, nextVersions] = await Promise.all([
    db.purchaseOrder.count({ where: { proformaId: id } }),
    db.transaction.count({ where: { proformaId: id } }),
    db.packagingDelivery.count({ where: { proformaId: id } }),
    // A revision points back at the document it revises. Deleting that document
    // would break the chain, and a revision history with a hole in it is worse
    // than one nobody can delete: the answer is to cancel the old one, which is
    // what the message says.
    db.proforma.count({ where: { previousVersionId: id } }),
  ]);
  return {
    purchaseOrders, transactions, deliveries, nextVersions,
    total: purchaseOrders + transactions + deliveries + nextVersions,
  };
}

/**
 * `removeActivities` takes the automatic timeline entries about this record
 * with it — matched on the link each entry stores, never on its wording — and
 * drops a category group that is left empty. The default keeps them, and the
 * entry recording the deletion joins them, so the project's history stays
 * whole.
 */
export async function deleteProforma(
  id: string,
  user: AuthUser,
  todayJalali: string,
  removeActivities = false,
): Promise<"ok" | "forbidden" | "in-use"> {
  const db = getDb();
  const visibility = visibilityClause(user);

  const existing = await db.proforma.findFirst({
    where: visibility ? { AND: [{ id }, visibility] } : { id },
    select: { id: true, projectId: true, customerId: true, proformaNumber: true },
  });
  if (!existing) return "forbidden";

  const refs = await countProformaReferences(id);
  if (refs.total > 0) return "in-use";

  // Get full data for audit and stock reconciliation before deletion
  const proforma = await db.proforma.findUnique({
    where: { id },
    include: { items: true },
  });

  await db.$transaction(async (tx) => {
    // Revert stock for any won items before deleting
    if (proforma) {
      type ItemWithStock = { productId?: string | null; variantId?: string | null; quantity?: number; status?: string | null; supplyMethod?: string | null };
      const wonItems = getWonItems(proforma as any, false) as ItemWithStock[];
      for (const item of wonItems) {
        if (!item.productId) continue;
        await applyStockDelta(tx, {
          productId: item.productId,
          variantId: item.variantId ?? undefined,
          delta: item.quantity || 1,
          referenceType: "PROFORMA",
          referenceId: proforma.id,
          notes: `بازگشت موجودی به دلیل حذف پیش‌فاکتور ${proforma.proformaNumber}`,
          occurredAtJalali: todayJalali,
        });
      }
    }

    await tx.proforma.delete({ where: { id } });
    // The project's status was derived partly from this proforma.
    await syncProjectStatus(tx, existing.projectId, todayJalali);
  });

  scheduleCustomerValueRecalculation();

  // Audit log
  if (proforma) {
    await logAction(
      {
        action: "DELETE",
        module: "پیش‌فاکتورها",
        entityId: id,
        description: `حذف پیش‌فاکتور (شماره: ${existing.proformaNumber})`,
        beforeState: proforma,
      },
      user,
      todayJalali,
    );

    await settleRecordHistory(
      removeActivities,
      existing.projectId,
      id,
      {
        projectId: existing.projectId,
        categoryName: ACTIVITY_CATEGORY.PROFORMAS,
        text:
          `پیش‌فاکتور شماره ${existing.proformaNumber} توسط {actor} از سیستم حذف شد؛` +
          ` اقلام آن دیگر جزو تعهدات پروژه محسوب نمی‌شوند و وضعیت پروژه بازمحاسبه گردید.`,
      },
      user,
      todayJalali,
    );
  }

  return "ok";
}

/**
 * Sets per-line outcomes in one call.
 *
 * This is the operation that actually decides a deal, and doing it by resending
 * the whole proforma would mean recomputing totals and rewriting every line for
 * what is a status change on a few rows.
 */
/**
 * Cancels the document a revision replaced.
 *
 * Offered after a revision is saved, and only offered — a revision is not a
 * lost sale and the previous version is not automatically anything. Two
 * quotations may legitimately stay open; superseding one is a decision.
 *
 * What it deliberately does not do: assign a loss reason. `settings.lossReasons`
 * is about losing to a competitor or a price, and «نسخه جدید صادر شد» is not
 * one of those — it would poison every report built on why sales are lost. The
 * cancellation is the ERP's ordinary one (`isCancelled`), which the derived
 * outcome already reads as «لغو شده».
 */
export async function cancelSupersededVersion(
  newVersionId: string,
  user: AuthUser,
  todayJalali: string,
): Promise<"ok" | "forbidden" | "not-found" | "no-previous" | "already-closed"> {
  const db = getDb();
  const visibility = visibilityClause(user);

  const revision = await db.proforma.findFirst({
    where: visibility ? { AND: [{ id: newVersionId }, visibility] } : { id: newVersionId },
    select: { id: true, proformaNumber: true, projectId: true, previousVersionId: true },
  });
  if (!revision) return "forbidden";
  if (!revision.previousVersionId) return "no-previous";

  const previous = await db.proforma.findUnique({
    where: { id: revision.previousVersionId },
    select: {
      id: true, proformaNumber: true, projectId: true,
      status: true, isCancelled: true, items: { select: { status: true } },
    },
  });
  if (!previous) return "not-found";

  // An outcome that is already settled is not overwritten. A previous version
  // that was won is a fact about money; a revision issued afterwards does not
  // undo it, and the question should not have been asked in the first place.
  if (isTerminalOutcome(getProformaOutcome(previous as never))) return "already-closed";

  await db.$transaction(async (tx) => {
    await tx.proforma.update({
      where: { id: previous.id },
      data: { isCancelled: true },
    });
    await syncProjectStatus(tx, previous.projectId, todayJalali);
    // Nobody should be chasing a quotation that has been replaced.
    await closeFollowUpTasks(
      tx,
      previous.id,
      todayJalali,
      `پیگیری بسته شد؛ نسخه جدید ${revision.proformaNumber} صادر شد.`,
    );
  });

  await afterCommit("cancel superseded proforma", async () => {
    await logAction(
      {
        action: "UPDATE",
        module: "پیش‌فاکتورها",
        entityId: previous.id,
        description: `لغو پیش‌فاکتور ${previous.proformaNumber} به دلیل صدور نسخه جدید ${revision.proformaNumber}`,
        beforeState: previous,
      },
      user,
      todayJalali,
    );
    await logProjectFact(
      {
        projectId: previous.projectId,
        categoryName: ACTIVITY_CATEGORY.PROFORMAS,
        sourceType: "PROFORMA",
        sourceId: previous.id,
        text: `نسخه قبلی پیش‌فاکتور ${previous.proformaNumber} به علت صدور نسخه جدید ${revision.proformaNumber} لغو شد.`,
      },
      user,
      todayJalali,
    );
  });

  scheduleCustomerValueRecalculation();
  return "ok";
}

export async function setItemOutcomes(
  id: string,
  outcomes: { itemId: string; status: string; lossReason?: string | null }[],
  user: AuthUser,
  todayJalali: string,
): Promise<"ok" | "forbidden" | "not-found"> {
  const db = getDb();
  const visibility = visibilityClause(user);

  const outcome = await db.$transaction(async (tx) => {
    const existing = await tx.proforma.findFirst({
      where: visibility ? { AND: [{ id }, visibility] } : { id },
      select: {
        id: true, projectId: true, customerId: true,
        // Both halves of the outcome rule, so "did the sale end just now" can
        // be answered on the way out.
        status: true, isCancelled: true, items: { select: { status: true } },
      },
    });
    if (!existing) return "forbidden";
    const wasTerminal = isTerminalOutcome(getProformaOutcome(existing as never));

    for (const o of outcomes) {
      // Scoped to this proforma, so an id from another one cannot be touched.
      const updated = await tx.proformaItem.updateMany({
        where: { id: o.itemId, proformaId: id },
        data: {
          status: toNullableString(o.status, 30),
          lossReason: toNullableString(o.lossReason, 300),
        },
      });
      if (updated.count === 0) return "not-found";
    }

    await syncProjectStatus(tx, existing.projectId, todayJalali);

    /*
     * This is the screen where a quotation is actually won or lost.
     *
     * The same rule as the ordinary save: the moment the outcome becomes
     * terminal, the follow-ups on that document close. Both paths need it
     * because both can set it — the outcome modal marks the lines, and an
     * ordinary edit can cancel the document.
     */
    const after = await tx.proforma.findUnique({
      where: { id },
      select: { status: true, isCancelled: true, items: { select: { status: true } } },
    });
    if (after && isTerminalOutcome(getProformaOutcome(after as never)) && !wasTerminal) {
      await closeFollowUpTasks(tx, id, todayJalali);
    }

    return "ok";
  });

  // Marking lines won or lost is exactly what turns a quotation into a sale.
  scheduleCustomerValueRecalculation();
  return outcome;
}
