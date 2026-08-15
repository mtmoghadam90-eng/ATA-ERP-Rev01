import { Prisma } from "@prisma/client";
import { getDb } from "../db";
import { formatMoney } from "../../numUtils";
import { ListQuery, ListResult, buildResult, paginationArgs, searchClause } from "../listing";
import { AuthUser, hasPermission } from "../auth";
import { expandDateFields, jalaliRangeFilter, jalaliToDate, normalizeJalali } from "../dates";
import { syncChildren, toJsonColumn, toNullableString, toNumber } from "../childSync";
import { scrubProductRefs } from "../refIntegrity";
import { afterCommit } from "../afterCommit";
import { describeProformaChanges, proformaChangeSentence } from "./proformaChanges";
import {
  ProformaOutcome, deriveProjectStatus, getProformaOutcome, getWonItems, isWonStatus,
  statusWithoutProformas,
} from "../proformaStatus";
import { logAction } from "./auditService";
import { notifyModuleResponsible } from "./notificationService";
import { processWorkflowRules } from "./workflowService";
import { ACTIVITY_CATEGORY, logProjectFact, settleRecordHistory } from "./projectActivityLog";
import { applyStockDelta } from "./productService";

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

export const PROFORMA_DATE_FIELDS = ["issueDate", "expiryDate", "deliveryDate"] as const;

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
  productId?: string | null;
  variantId?: string | null;
  productName?: string;
  productCode?: string | null;
  brand?: string | null;
  tagNumber?: string | null;
  quantity?: unknown;
  unitPriceRial?: unknown;
  totalPriceRial?: unknown;
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
  items?: ProformaItemInput[];
}

function mapItem(row: ProformaItemInput): Record<string, unknown> | null {
  const productName = toNullableString(row?.productName, 400);
  if (!productName) return null;

  const quantity = toNumber(row.quantity, 1);
  const unitPrice = toNumber(row.unitPriceRial, 0);
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
    unitPriceRial: unitPrice,
    totalPriceRial: totalPrice,
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
): Record<string, number> {
  const lines = (items ?? []).map((r) => mapItem(r)).filter(Boolean) as Record<string, unknown>[];
  const totalAmount = lines.reduce((sum, l) => sum + Number(l.totalPriceRial ?? 0), 0);

  const discountPercent = toNumber(input.discountPercent, 0);
  // A percentage takes precedence; an explicit amount is the manual override.
  const discountAmount = discountPercent > 0
    ? (totalAmount * discountPercent) / 100
    : toNumber(input.discountAmount, 0);

  const afterDiscount = totalAmount - discountAmount;
  const taxPercent = toNumber(input.taxPercent, 0);
  const taxAmount = taxPercent > 0
    ? (afterDiscount * taxPercent) / 100
    : toNumber(input.taxAmount, 0);

  const extraCosts = toNumber(input.extraCosts, 0);

  return {
    totalAmount,
    discountPercent,
    discountAmount,
    taxPercent,
    taxAmount,
    extraCosts,
    finalAmount: afterDiscount + taxAmount + extraCosts,
  };
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
    const items = (await scrubProductRefs(tx, input.items)) ?? [];

    const proforma = await tx.proforma.create({
      data: {
        ...scalarData(input),
        ...computeTotals(items, input),
        creatorUserId: input.creatorUserId ?? user.id,
      } as Prisma.ProformaUncheckedCreateInput,
    });

    await syncChildren({
      delegate: tx.proformaItem, parentWhere: { proformaId: proforma.id },
      rows: items, map: mapItem,
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
      select: { id: true, projectId: true, proformaNumber: true },
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

    const items = await scrubProductRefs(tx, input.items);

    // Totals depend on the lines, so they can only be recomputed when the lines
    // are part of this request. Otherwise the stored totals already match the
    // stored lines and must be left alone.
    if (items !== undefined) {
      Object.assign(data, computeTotals(items, input));
    }

    const proforma = await tx.proforma.update({
      where: { id },
      data: data as Prisma.ProformaUncheckedUpdateInput,
    });

    if (items !== undefined) {
      await syncChildren({
        delegate: tx.proformaItem, parentWhere: { proformaId: id },
        rows: items, map: mapItem,
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

    // Re-derive both projects when the proforma was moved between them, or the
    // old project keeps a status derived from a proforma it no longer has.
    await syncProjectStatus(tx, proforma.projectId, todayJalali);
    if (existing.projectId && existing.projectId !== proforma.projectId) {
      await syncProjectStatus(tx, existing.projectId, todayJalali);
    }

    const afterLabels = await readLabels(tx, proforma.customerId, proforma.projectId);

    return { proforma, before, after, beforeLabels, afterLabels };
  });

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
  const [purchaseOrders, transactions, deliveries] = await Promise.all([
    db.purchaseOrder.count({ where: { proformaId: id } }),
    db.transaction.count({ where: { proformaId: id } }),
    db.packagingDelivery.count({ where: { proformaId: id } }),
  ]);
  return { purchaseOrders, transactions, deliveries, total: purchaseOrders + transactions + deliveries };
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
    select: { id: true, projectId: true, proformaNumber: true },
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
export async function setItemOutcomes(
  id: string,
  outcomes: { itemId: string; status: string; lossReason?: string | null }[],
  user: AuthUser,
  todayJalali: string,
): Promise<"ok" | "forbidden" | "not-found"> {
  const db = getDb();
  const visibility = visibilityClause(user);

  return db.$transaction(async (tx) => {
    const existing = await tx.proforma.findFirst({
      where: visibility ? { AND: [{ id }, visibility] } : { id },
      select: { id: true, projectId: true },
    });
    if (!existing) return "forbidden";

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
    return "ok";
  });
}
