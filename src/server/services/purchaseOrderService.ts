import { Prisma } from "@prisma/client";
import { COST_SOURCES } from "../../utils/costOfGoods";
import { scheduleCustomerValueRecalculation } from "./customerValueRecalc";
import { getDb } from "../db";
import { ListQuery, ListResult, buildResult, paginationArgs, searchClause } from "../listing";
import { AuthUser, hasPermission } from "../auth";
import { redactPurchaseOrder, redactPurchaseOrders } from "../costs";
import { expandDateFields, jalaliRangeFilter } from "../dates";
import { syncChildren, toJsonColumn, toNullableString, toNumber } from "../childSync";
import { scrubProductRefs } from "../refIntegrity";
import { applyStockDelta } from "./productService";
import { logAction } from "./auditService";
import { notifyModuleResponsible } from "./notificationService";
import { processWorkflowRules } from "./workflowService";
import { ACTIVITY_CATEGORY, logProjectFact, settleRecordHistory } from "./projectActivityLog";

/**
 * Purchase order data access.
 *
 * The distinguishing feature is that a received order puts goods into stock, and
 * that has to survive editing: an order can be received, then corrected, then
 * un-received. See `reconcileStock` for how that is kept honest.
 */

/** The status at which goods have physically arrived and enter inventory. */
export const RECEIVED_STATUS = "تحویل شده (رسید انبار)";

/**
 * Replaces an estimated proforma-line cost with what the goods actually cost.
 *
 * A line quoted from the catalogue is costed with the product's *standard*
 * landed cost — an estimate, marked `PRICE_CALCULATOR`. When the real purchase
 * lands, that estimate is simply wrong, and nothing used to correct it: gross
 * profit, and every customer rank built on it, kept the guess for ever.
 *
 * Three rules make this safe to run automatically:
 *
 *  - **Only an estimate is overwritten.** A figure somebody typed (`MANUAL`) or
 *    an explicit «بدون بهای تمام‌شده» (`NONE`) is an answer a person gave, and
 *    is left alone. `PURCHASE_ORDER` is refreshed, because it came from here.
 *  - **Every received order counts, not just this one.** A line split across two
 *    purchases has one unit cost: the total landed across them over the total
 *    quantity. Reading them all is also what makes this idempotent — the same
 *    save twice writes the same figure.
 *  - **The proforma's own currency**, since that is what `unitCost` is in and
 *    what makes the margin beside it arithmetic between like units. A foreign
 *    proforma with no stored rate cannot be converted into, so it is skipped
 *    rather than given a rial figure in a euro column.
 *
 * Un-receiving does not put the estimate back. Once the real cost is known it
 * stays known; there is no earlier guess worth restoring.
 */
async function pushActualCostToProformaLines(
  tx: Prisma.TransactionClient,
  purchaseOrderId: string,
): Promise<void> {
  const touched = await tx.purchaseOrderItem.findMany({
    where: { purchaseOrderId, proformaItemId: { not: null } },
    select: { proformaItemId: true },
  });
  const itemIds = [...new Set(touched.map((r) => r.proformaItemId as string))];
  if (itemIds.length === 0) return;

  const lines = await tx.proformaItem.findMany({
    where: { id: { in: itemIds } },
    select: {
      id: true, costSource: true,
      proforma: { select: { currency: true, historicalExchangeRate: true } },
    },
  });

  // Every received purchase line pointing at any of them, from any order.
  const supplying = await tx.purchaseOrderItem.findMany({
    where: {
      proformaItemId: { in: itemIds },
      landedUnitCostRial: { not: null },
      purchaseOrder: { status: RECEIVED_STATUS },
    },
    select: { proformaItemId: true, quantity: true, landedUnitCostRial: true },
  });

  const totals = new Map<string, { cost: number; quantity: number }>();
  for (const row of supplying) {
    const key = row.proformaItemId as string;
    const quantity = Number(row.quantity ?? 0);
    if (quantity <= 0) continue;
    const current = totals.get(key) ?? { cost: 0, quantity: 0 };
    current.cost += Number(row.landedUnitCostRial ?? 0) * quantity;
    current.quantity += quantity;
    totals.set(key, current);
  }

  for (const line of lines) {
    const source = line.costSource;
    const replaceable = source === null
      || source === COST_SOURCES.PRICE_CALCULATOR
      || source === COST_SOURCES.BACKFILL
      || source === COST_SOURCES.PURCHASE_ORDER;
    if (!replaceable) continue;

    const total = totals.get(line.id);
    if (!total || total.quantity <= 0) continue;

    const perUnitRial = total.cost / total.quantity;
    const currency = line.proforma?.currency ?? "ریال";
    const rate = Number(line.proforma?.historicalExchangeRate ?? 0);

    let unitCost: number;
    if (currency === "ریال") {
      unitCost = perUnitRial;
    } else if (rate > 0) {
      unitCost = perUnitRial / rate;
    } else {
      // Unknown rate: the figure cannot be expressed in this document's
      // currency, and a rial number in a euro column is worse than the estimate.
      continue;
    }

    await tx.proformaItem.update({
      where: { id: line.id },
      data: {
        unitCost,
        costCurrency: currency,
        costSource: COST_SOURCES.PURCHASE_ORDER,
      },
    });
  }
}

/** Ledger tag for movements owned by a purchase order. */
const STOCK_REFERENCE = "PURCHASE_ORDER";

export const PO_SORTABLE = [
  "poNumber", "status", "orderDate", "expectedDeliveryDate", "landedCostRial",
  "createdAt", "updatedAt",
] as const;

export const PO_FILTERABLE = ["status", "supplierId", "projectId", "currency"] as const;

const SEARCH_FIELDS = ["poNumber", "notes"] as const;

export const PO_DATE_FIELDS = [
  "orderDate", "expectedDeliveryDate", "paymentDate", "goodsReadyDate",
  "shipmentDate", "clearanceDate", "receivedDate",
] as const;

function allowed(user: AuthUser): boolean {
  return hasPermission(user, "purchaseOrders");
}

export function buildPurchaseOrderWhere(
  q: ListQuery,
  extra: { dateFrom?: unknown; dateTo?: unknown } = {},
): Record<string, unknown> {
  const and: Record<string, unknown>[] = [];

  if (q.search) {
    // The grid's search box also matches the supplier's and the project's name,
    // neither of which is a column on the order.
    const own = searchClause(q.search, SEARCH_FIELDS);
    const bySupplier = searchClause(q.search, ["name"]);
    const byProject = searchClause(q.search, ["name", "code"]);

    const alternatives: Record<string, unknown>[] = [];
    if (own) alternatives.push(...own.OR);
    if (bySupplier) alternatives.push({ supplier: bySupplier });
    if (byProject) alternatives.push({ project: byProject });
    if (alternatives.length > 0) and.push({ OR: alternatives });
  }

  for (const [field, value] of Object.entries(q.filters)) {
    and.push({ [field]: value });
  }

  const range = jalaliRangeFilter(extra.dateFrom, extra.dateTo);
  if (range) and.push({ orderDate: range });

  return and.length === 0 ? {} : { AND: and };
}

const LIST_SELECT = {
  id: true, poNumber: true, status: true, currency: true, exchangeRate: true,
  supplierId: true, projectId: true, proformaId: true,
  orderDate: true, orderDateJalali: true,
  expectedDeliveryDate: true, expectedDeliveryDateJalali: true,
  receivedDateJalali: true,
  totalForeignAmount: true, landedCostRial: true, landedCostForeign: true,
  createdAt: true,
  // The grid draws a custom-fields column from these, and prints the number of
  // the proforma the order was raised against.
  customValues: true,
  supplier: { select: { id: true, name: true } },
  project: { select: { id: true, code: true, name: true } },
  proforma: { select: { id: true, proformaNumber: true } },
  _count: { select: { items: true } },
} satisfies Prisma.PurchaseOrderSelect;

export async function listPurchaseOrders(
  q: ListQuery,
  user: AuthUser,
  extra: { dateFrom?: unknown; dateTo?: unknown } = {},
): Promise<ListResult<Record<string, unknown>> | null> {
  if (!allowed(user)) return null;

  const db = getDb();
  const where = buildPurchaseOrderWhere(q, extra);
  const orderBy = q.sort ? { [q.sort]: q.order } : { createdAt: "desc" as const };

  const [rows, total] = await Promise.all([
    db.purchaseOrder.findMany({ where, orderBy, select: LIST_SELECT, ...paginationArgs(q) }),
    db.purchaseOrder.count({ where }),
  ]);

  return buildResult(
    redactPurchaseOrders(rows as unknown as Record<string, unknown>[], user),
    total,
    q,
  );
}

export async function getPurchaseOrder(id: string, user: AuthUser) {
  if (!allowed(user)) return null;
  const po = await getDb().purchaseOrder.findUnique({
    where: { id },
    include: {
      supplier: true,
      project: { select: { id: true, code: true, name: true } },
      proforma: { select: { id: true, proformaNumber: true } },
      items: { orderBy: { lineNo: "asc" } },
    },
  });
  return redactPurchaseOrder(po, user);
}

/* --------------------------------- writes --------------------------------- */

export interface PurchaseOrderItemInput {
  productId?: string | null;
  variantId?: string | null;
  productName?: string;
  productCode?: string | null;
  brand?: string | null;
  tagNumber?: string | null;
  quantity?: unknown;
  unitPriceForeign?: unknown;
  proformaItemId?: string | null;
  proformaItemName?: string | null;
  supplierNotes?: string | null;
}

export interface PurchaseOrderInput {
  poNumber?: string;
  supplierId?: string;
  projectId?: string | null;
  proformaId?: string | null;
  status?: string;
  currency?: string;
  exchangeRate?: unknown;
  orderDate?: string | null;
  expectedDeliveryDate?: string | null;
  paymentDate?: string | null;
  goodsReadyDate?: string | null;
  shipmentDate?: string | null;
  clearanceDate?: string | null;
  receivedDate?: string | null;
  shippingCostRial?: unknown;
  customsDutyRial?: unknown;
  remittanceFeeRial?: unknown;
  shippingCostForeign?: unknown;
  remittanceFeeForeign?: unknown;
  notes?: string | null;
  customValues?: unknown;
  items?: PurchaseOrderItemInput[];
}

function mapItem(row: PurchaseOrderItemInput): Record<string, unknown> | null {
  const productName = toNullableString(row?.productName, 400);
  if (!productName) return null;

  const quantity = toNumber(row.quantity, 1);
  const unitPrice = toNumber(row.unitPriceForeign, 0);

  return {
    productId: toNullableString(row.productId, 36),
    variantId: toNullableString(row.variantId, 36),
    productName,
    productCode: toNullableString(row.productCode, 60),
    brand: toNullableString(row.brand, 150),
    tagNumber: toNullableString(row.tagNumber, 100),
    quantity,
    unitPriceForeign: unitPrice,
    // Recomputed, like proforma lines: the client's arithmetic is not the source
    // of truth for what the order is worth.
    totalPriceForeign: quantity * unitPrice,
    proformaItemId: toNullableString(row.proformaItemId, 36),
    proformaItemName: toNullableString(row.proformaItemName, 400),
    supplierNotes: toNullableString(row.supplierNotes),
  };
}

/**
 * Order value and landed cost, derived from the lines and the cost inputs.
 *
 * Landed cost is what the goods actually cost delivered — the supplier price
 * converted at the order's own exchange rate, plus freight, duty and remittance
 * fees. It is stored because the rate moves and a historical order must keep the
 * figure it was costed at.
 */
export function computeTotals(
  items: PurchaseOrderItemInput[],
  input: PurchaseOrderInput,
): Record<string, number> {
  const lines = (items ?? []).map(mapItem).filter(Boolean) as Record<string, unknown>[];
  const totalForeignAmount = lines.reduce((sum, l) => sum + Number(l.totalPriceForeign ?? 0), 0);

  const exchangeRate = toNumber(input.exchangeRate, 1) || 1;
  const shippingCostRial = toNumber(input.shippingCostRial, 0);
  const customsDutyRial = toNumber(input.customsDutyRial, 0);
  const remittanceFeeRial = toNumber(input.remittanceFeeRial, 0);
  const shippingCostForeign = toNumber(input.shippingCostForeign, 0);
  const remittanceFeeForeign = toNumber(input.remittanceFeeForeign, 0);

  /*
   * The landed cost, once, in two currencies.
   *
   * The rial figure is the real one — it is what the goods cost delivered, and
   * three of the six cost inputs are quoted in rial (customs above all). The
   * foreign figure is that same money divided by the order's own rate, not a
   * separate sum.
   *
   * It used to be a separate sum, and one that left customs duty out: so an
   * order's «بهای تمام‌شده ارزی» was goods plus freight plus remittance and
   * nothing else, while the same screen's cost-allocation sheet showed customs
   * included. Three places disagreed — the sheet inside the form, the "landed
   * details" popup and the row card — because two of them recomputed the figure
   * themselves when the stored one looked empty, using a third formula again.
   * Deriving one from the other makes the two figures the same money by
   * construction, and there is nothing left for a client to recompute.
   */
  const landedCostRial =
    (totalForeignAmount + shippingCostForeign + remittanceFeeForeign) * exchangeRate
    + shippingCostRial + customsDutyRial + remittanceFeeRial;

  const landedCostForeign = exchangeRate > 0
    ? Number((landedCostRial / exchangeRate).toFixed(2))
    // No rate to convert at — the rial-quoted costs cannot be expressed in the
    // order's currency, so the foreign figure carries only what was foreign.
    : totalForeignAmount + shippingCostForeign + remittanceFeeForeign;

  return {
    totalForeignAmount, exchangeRate,
    shippingCostRial, customsDutyRial, remittanceFeeRial,
    shippingCostForeign, remittanceFeeForeign,
    landedCostForeign, landedCostRial,
  };
}

/**
 * Writes each line's share of the order's landed cost onto the line.
 *
 * Freight, customs and the remittance fee are entered once for the whole
 * order, so `unitPriceForeign` is only what the supplier charged — never what
 * the goods actually cost us. The difference is material on an import: customs
 * alone routinely moves a line by a fifth.
 *
 * Apportioned by value, which is the assumption already baked into every other
 * figure on this screen.
 *
 * Reads the order back from the database rather than taking the caller's word,
 * and runs after **every** write. That is not belt-and-braces: the costs arrive
 * over weeks, and customs keyed in a fortnight after the order was placed
 * changes no line but changes what every line cost. An allocation that only ran
 * when the lines themselves were edited would leave those figures stale
 * forever, which is precisely the bug this column exists to end. Same shape as
 * `reconcileStock` above, and self-correcting for the same reason.
 *
 * Lines are left null, not zero, when the order carries no landed cost or no
 * value to apportion by: zero would read as "these goods were free".
 */
async function allocateLandedCost(
  tx: Prisma.TransactionClient,
  purchaseOrderId: string,
): Promise<void> {
  const po = await tx.purchaseOrder.findUnique({
    where: { id: purchaseOrderId },
    select: {
      landedCostRial: true, totalForeignAmount: true, exchangeRate: true,
      items: { select: { id: true, quantity: true, totalPriceForeign: true } },
    },
  });
  if (!po) return;

  const orderValue = Number(po.totalForeignAmount ?? 0);
  const landedRial = Number(po.landedCostRial ?? 0);
  const rate = Number(po.exchangeRate ?? 0);
  const costable = orderValue > 0 && landedRial > 0;

  for (const line of po.items) {
    const quantity = Number(line.quantity ?? 0);
    if (!costable || quantity <= 0) {
      await tx.purchaseOrderItem.update({
        where: { id: line.id },
        data: { landedUnitCostRial: null, landedUnitCostForeign: null },
      });
      continue;
    }

    const unitRial = (landedRial * (Number(line.totalPriceForeign ?? 0) / orderValue)) / quantity;
    await tx.purchaseOrderItem.update({
      where: { id: line.id },
      data: {
        landedUnitCostRial: unitRial,
        landedUnitCostForeign: rate > 0 ? unitRial / rate : null,
      },
    });
  }
}

function scalarData(input: PurchaseOrderInput): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const set = (key: string, value: unknown) => { if (value !== undefined) out[key] = value; };

  if ("poNumber" in input) set("poNumber", toNullableString(input.poNumber, 60));
  if ("supplierId" in input) set("supplierId", input.supplierId);
  if ("projectId" in input) set("projectId", toNullableString(input.projectId, 36));
  if ("proformaId" in input) set("proformaId", toNullableString(input.proformaId, 36));
  if ("status" in input) set("status", toNullableString(input.status, 60));
  if ("currency" in input) set("currency", toNullableString(input.currency, 20) ?? "دلار");
  if ("notes" in input) set("notes", toNullableString(input.notes));
  if ("customValues" in input) set("customValues", toJsonColumn(input.customValues));

  return { ...out, ...expandDateFields(input as Record<string, unknown>, PO_DATE_FIELDS) };
}

/**
 * A warehouse-arrival date means the order arrived.
 *
 * Everything downstream keys on the *status*: stock is credited by
 * `reconcileStock` when it reads RECEIVED_STATUS, and the screen offers to
 * close the project's purchase-order category on the same transition. The form,
 * meanwhile, offers the arrival date and the status as two separate fields — so
 * someone filling in the whole timeline at once, arrival date included, ended
 * up with an order that had arrived on paper and had not arrived as far as the
 * system was concerned. Nothing entered stock and no prompt appeared, and the
 * only way through was to save without the date and then use the status button.
 *
 * That is one fact with two switches, and the date is the one people fill in.
 * So the date promotes the status, here, where every client goes through it.
 *
 * Deliberately one-directional: clearing the date does not un-receive an order.
 * Removing a date is a correction to the record of what happened, and taking
 * goods back out of stock is a decision, made with the status.
 */
export function receivedDateImpliesStatus(
  data: Record<string, unknown>,
  existingStatus?: string | null,
): void {
  const arrived = data.receivedDateJalali ?? data.receivedDate;
  if (!arrived) return;
  const status = (data.status as string | undefined) ?? existingStatus ?? undefined;
  if (status === RECEIVED_STATUS) return;
  data.status = RECEIVED_STATUS;
}

/* ------------------------------ stock receipt ------------------------------ */

/** Key identifying one stock position: a product, optionally a specific SKU. */
const positionKey = (productId: string, variantId: string | null) => `${productId}|${variantId ?? ""}`;

/**
 * Brings the stock this order has credited into line with what it should credit.
 *
 * Rather than reverting the old lines and re-applying the new ones — which
 * double-counts if anything goes wrong in between, and depends on the caller
 * knowing the previous state — this asks the ledger what this order has already
 * put into stock, compares it with what its current lines and status say it
 * should have, and writes only the difference.
 *
 * That makes it idempotent and self-correcting: running it twice changes nothing
 * the second time, and it repairs a position that drifted for any reason.
 * Un-receiving an order simply targets zero and the goods come back out.
 */
async function reconcileStock(
  tx: Prisma.TransactionClient,
  purchaseOrderId: string,
  todayJalali: string,
): Promise<{ movements: number }> {
  const po = await tx.purchaseOrder.findUnique({
    where: { id: purchaseOrderId },
    select: {
      id: true, poNumber: true, status: true, projectId: true,
      items: { select: { productId: true, variantId: true, quantity: true } },
    },
  });
  if (!po) return { movements: 0 };

  // What this order has already put into stock.
  const credited = new Map<string, number>();
  const ledger = await tx.inventoryTransaction.findMany({
    where: { referenceType: STOCK_REFERENCE, referenceId: purchaseOrderId },
    select: { productId: true, variantId: true, signedQuantity: true },
  });
  for (const row of ledger) {
    const key = positionKey(row.productId, row.variantId);
    credited.set(key, (credited.get(key) ?? 0) + Number(row.signedQuantity));
  }

  // What it should have, given its current lines and status. A line with no
  // product is a free-text requirement and moves nothing.
  const target = new Map<string, number>();
  if (po.status === RECEIVED_STATUS) {
    for (const item of po.items) {
      if (!item.productId) continue;
      const key = positionKey(item.productId, item.variantId);
      target.set(key, (target.get(key) ?? 0) + Number(item.quantity));
    }
  }

  let movements = 0;
  for (const key of new Set([...credited.keys(), ...target.keys()])) {
    const delta = (target.get(key) ?? 0) - (credited.get(key) ?? 0);
    if (delta === 0) continue;

    const [productId, variantPart] = key.split("|");
    const variantId = variantPart || null;

    // The SKU may have been removed from the product since the order was placed.
    if (variantId) {
      const exists = await tx.productVariant.count({ where: { id: variantId } });
      if (exists === 0) continue;
    }
    const productExists = await tx.product.count({ where: { id: productId } });
    if (productExists === 0) continue;

    await applyStockDelta(tx, {
      productId, variantId, delta,
      referenceType: STOCK_REFERENCE,
      referenceId: purchaseOrderId,
      notes: `رسید انبار سفارش خرید ${po.poNumber}`,
      occurredAtJalali: todayJalali,
      /*
       * The ledger, but not always what may be sold.
       *
       * An order placed against a project is against work that has already
       * been won, so those goods were sold before they were bought — they
       * arrive, sit in the warehouse and leave on that job's packing list,
       * and at no point were they free for anyone to quote. A salesperson
       * who saw them as available would promise the same units twice, so
       * project orders leave the available level untouched.
       *
       * An order with no project is a general/warehouse purchase — nothing
       * has claimed these units, so receiving them should make them
       * quotable like any other stock.
       */
      affectsAvailable: !po.projectId,
    });
    movements++;
  }

  return { movements };
}

/** The supplier's name, for the timeline entries that quote it. */
async function supplierNameOf(supplierId: string | null | undefined): Promise<string> {
  if (!supplierId) return "نامشخص";
  const supplier = await getDb().supplier.findUnique({
    where: { id: supplierId },
    select: { name: true },
  });
  return supplier?.name || "نامشخص";
}

export async function createPurchaseOrder(
  input: PurchaseOrderInput,
  user: AuthUser,
  todayJalali: string,
) {
  if (!allowed(user)) return null;
  const db = getDb();

  const po = await db.$transaction(async (tx) => {
    // A line naming a product or SKU that is gone loses the link, not the order.
    const items = (await scrubProductRefs(tx, input.items)) ?? [];
    const data = { ...scalarData(input), ...computeTotals(items, input) };
    // An order can be entered already arrived, e.g. when recording history.
    receivedDateImpliesStatus(data);

    const po = await tx.purchaseOrder.create({
      data: data as Prisma.PurchaseOrderUncheckedCreateInput,
    });

    await syncChildren({
      delegate: tx.purchaseOrderItem, parentWhere: { purchaseOrderId: po.id },
      rows: items, map: mapItem,
    });

    // What each line actually cost, landed — read back from what was just
    // written rather than recomputed from the request.
    await allocateLandedCost(tx, po.id);

    // An order can be entered already received, e.g. when recording history.
    await reconcileStock(tx, po.id, todayJalali);

    // What the goods really cost, onto the sale lines that were estimated.
    await pushActualCostToProformaLines(tx, po.id);

    return tx.purchaseOrder.findUnique({ where: { id: po.id }, include: { items: { orderBy: { lineNo: "asc" } } } });
  });

  // Audit log
  if (po) {
    await logAction(
      {
        action: "CREATE",
        module: "سفارش خرید",
        entityId: po.id,
        description: `ایجاد سفارش خرید جدید: ${po.poNumber || po.id}`,
        afterState: po,
      },
      user,
      todayJalali,
    );

    // Notification
    await notifyModuleResponsible(
      "purchaseOrders",
      "ثبت سفارش خرید جدید",
      `سفارش خرید جدید ثبت شد: ${po.poNumber || po.id}`,
      user,
      po.projectId,
    );

    // Workflow trigger
    await processWorkflowRules(
      "purchase_order_created",
      {
        purchaseOrderId: po.id,
        poNumber: po.poNumber,
        supplierId: po.supplierId,
        projectId: po.projectId,
        totalAmount: po.landedCostRial?.toString(),
      },
      user,
    );

    await logProjectFact(
      {
        projectId: po.projectId,
        categoryName: ACTIVITY_CATEGORY.PURCHASE_ORDERS,
        sourceType: "PURCHASE_ORDER",
        sourceId: po.id,
        text:
          `صدور سفارش خرید شماره ${po.poNumber} به تأمین‌کننده` +
          ` «${await supplierNameOf(po.supplierId)}»` +
          ` برای تأمین ${po.items?.length ?? 0} قلم کالای پروژه.`,
      },
      user,
      todayJalali,
    );

    // Dates entered on the form the first time it was opened are milestones
    // too. Only an update used to be examined, so an order created with its
    // payment and ready dates already filled in recorded none of them.
    await logPurchaseOrderMilestones(po as unknown as Record<string, unknown>, null, user, todayJalali);
  }

  // Receiving an order rewrites the cost of the sale lines it supplied, so the
  // gross profit behind every affected customer's rank has moved.
  scheduleCustomerValueRecalculation();

  return po;
}


/* ------------------------- the import timeline ------------------------- */

/**
 * What each milestone date on a purchase order means, as a sentence.
 *
 * The timeline used to record only two things about an order: that it was
 * issued, and that its *status* changed. The dates are the milestones people
 * actually fill in — payment sent, goods ready, shipped, cleared, received —
 * and filling them in produced nothing at all. Entering them while first
 * creating the order produced nothing either, because only an update was
 * examined and a creation has nothing to compare against.
 *
 * The sentences name the order, the supplier and the date, because the feed is
 * read by people who were not part of the purchase and have only this to go on.
 */
const PO_MILESTONE_TEXT: Record<string, (c: MilestoneContext) => string> = {
  orderDate: (c) =>
    `سفارش خرید شماره ${c.poNumber} به تأمین‌کننده «${c.supplier}» در تاریخ ${c.date} ثبت و به سازنده ابلاغ شد.`,
  paymentDate: (c) =>
    `وجه سفارش خرید شماره ${c.poNumber} در تاریخ ${c.date}` +
    ` به تأمین‌کننده «${c.supplier}» حواله شد.`,
  goodsReadyDate: (c) =>
    `کالای سفارش خرید شماره ${c.poNumber} نزد تأمین‌کننده «${c.supplier}» در تاریخ ${c.date}` +
    ` آماده حمل اعلام شد.`,
  shipmentDate: (c) =>
    `محموله سفارش خرید شماره ${c.poNumber} (تأمین‌کننده «${c.supplier}») در تاریخ ${c.date}` +
    ` از مبدأ حمل شد.`,
  clearanceDate: (c) =>
    `محموله سفارش خرید شماره ${c.poNumber} در تاریخ ${c.date} از گمرک ترخیص شد.`,
  receivedDate: (c) =>
    `کالای سفارش خرید شماره ${c.poNumber} (تأمین‌کننده «${c.supplier}») در تاریخ ${c.date}` +
    ` تحویل گرفته شد و به انبار وارد گردید.`,
  expectedDeliveryDate: (c) =>
    `زمان تحویل پیش‌بینی‌شده سفارش خرید شماره ${c.poNumber} تاریخ ${c.date} تعیین شد.`,
};

interface MilestoneContext {
  poNumber: string;
  supplier: string;
  date: string;
}

/** The Jalali column that carries each milestone. */
const jalaliColumn = (field: string) => `${field}Jalali`;

/**
 * Records every milestone date that has just been filled in or moved.
 *
 * `before` is null for a newly created order, in which case every date it
 * carries is new. A date that is cleared is not reported: removing a date is a
 * correction, and the feed is a record of what happened.
 */
async function logPurchaseOrderMilestones(
  po: Record<string, unknown>,
  before: Record<string, unknown> | null,
  user: AuthUser,
  todayJalali: string,
): Promise<void> {
  const projectId = po.projectId as string | null;
  if (!projectId) return;

  const context: MilestoneContext = {
    poNumber: String(po.poNumber ?? ""),
    supplier: await supplierNameOf(po.supplierId as string),
    date: "",
  };

  for (const field of PO_DATE_FIELDS) {
    const column = jalaliColumn(field);
    const now = (po[column] as string | null) ?? null;
    if (!now) continue;

    const was = before ? ((before[column] as string | null) ?? null) : null;
    if (was === now) continue;

    const write = PO_MILESTONE_TEXT[field];
    if (!write) continue;

    const text = write({ ...context, date: now });
    await logProjectFact(
      {
        projectId,
        categoryName: ACTIVITY_CATEGORY.PURCHASE_ORDERS,
        sourceType: "PURCHASE_ORDER",
        sourceId: String(po.id ?? ""),
        // A date that moved says so, rather than reading as if it had just
        // happened for the first time.
        text: was ? `${text} (تاریخ پیشین: ${was} — اصلاح شد)` : text,
      },
      user,
      todayJalali,
    );
  }
}

export async function updatePurchaseOrder(
  id: string,
  input: PurchaseOrderInput,
  user: AuthUser,
  todayJalali: string,
) {
  if (!allowed(user)) return null;
  const db = getDb();

  // Get before state for audit log
  const before = await db.purchaseOrder.findUnique({ where: { id } });
  if (!before) return null;

  const po = await db.$transaction(async (tx) => {
    const existing = await tx.purchaseOrder.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return null;

    const data: Record<string, unknown> = scalarData(input);
    if (input.items !== undefined) {
      Object.assign(data, computeTotals(input.items, input));
    } else if (
      // The cost inputs feed the landed cost even when the lines are untouched.
      ["exchangeRate", "shippingCostRial", "customsDutyRial", "remittanceFeeRial",
        "shippingCostForeign", "remittanceFeeForeign"].some((k) => k in input)
    ) {
      const current = await tx.purchaseOrderItem.findMany({
        where: { purchaseOrderId: id },
        select: { quantity: true, unitPriceForeign: true },
      });
      const asInput = current.map((l) => ({
        productName: "x",
        quantity: Number(l.quantity),
        unitPriceForeign: Number(l.unitPriceForeign),
      }));
      Object.assign(data, computeTotals(asInput, input));
    }

    // Filling in the arrival date is how people say the goods came in; the
    // status is what stock and the category prompt read.
    receivedDateImpliesStatus(data, before.status);

    await tx.purchaseOrder.update({
      where: { id },
      data: data as Prisma.PurchaseOrderUncheckedUpdateInput,
    });

    if (input.items !== undefined) {
      await syncChildren({
        delegate: tx.purchaseOrderItem, parentWhere: { purchaseOrderId: id },
        rows: (await scrubProductRefs(tx, input.items)) ?? [], map: mapItem,
      });
    }

    // Unconditional: entering customs a fortnight later changes no line and
    // changes every line's cost.
    await allocateLandedCost(tx, id);

    // Runs on every update: the status may have changed, the lines may have
    // changed, or both, and this settles whichever it was.
    await reconcileStock(tx, id, todayJalali);

    await pushActualCostToProformaLines(tx, id);

    return tx.purchaseOrder.findUnique({ where: { id }, include: { items: { orderBy: { lineNo: "asc" } } } });
  });

  // Audit log
  if (po) {
    await logAction(
      {
        action: "UPDATE",
        module: "سفارش خرید",
        entityId: id,
        description: `ویرایش سفارش خرید: ${po.poNumber || id}`,
        beforeState: before,
        afterState: po,
      },
      user,
      todayJalali,
    );

    // Workflow rules for status change
    if (before.status !== po.status) {
      await processWorkflowRules(
        "purchase_order_status_change",
        {
          purchaseOrderId: po.id,
          poNumber: po.poNumber,
          supplierId: po.supplierId,
          projectId: po.projectId,
          oldStatus: before.status,
          newStatus: po.status,
          status: po.status,
        },
        user,
      );

      // Only a status change reaches the timeline. A plain edit did not in the
      // document store either — the feed tracks where an order got to, not
      // every field touched along the way.
      await logProjectFact(
        {
          projectId: po.projectId,
          categoryName: ACTIVITY_CATEGORY.PURCHASE_ORDERS,
          sourceType: "PURCHASE_ORDER",
          sourceId: po.id,
          text:
            `وضعیت سفارش خرید شماره ${po.poNumber} (تأمین‌کننده` +
            ` «${await supplierNameOf(po.supplierId)}») از «${before.status}»` +
            ` به «${po.status}» تغییر کرد.`,
        },
        user,
        todayJalali,
      );
    }

    await logPurchaseOrderMilestones(
      po as unknown as Record<string, unknown>,
      before as unknown as Record<string, unknown>,
      user,
      todayJalali,
    );
  }

  scheduleCustomerValueRecalculation();

  return po;
}

export async function countPurchaseOrderReferences(id: string) {
  const db = getDb();
  const transactions = await db.transaction.count({ where: { purchaseOrderId: id } });
  return { transactions, total: transactions };
}

/**
 * Deletes an order, taking its stock receipt back out first.
 *
 * Leaving the goods in stock would credit inventory to an order that no longer
 * exists, and the ledger entries would block the delete on their foreign key
 * anyway.
 */
/**
 * `removeActivities` takes the automatic timeline entries about this record
 * with it — matched on the link each entry stores, never on its wording — and
 * drops a category group that is left empty. The default keeps them, and the
 * entry recording the deletion joins them, so the project's history stays
 * whole.
 */
export async function deletePurchaseOrder(
  id: string,
  user: AuthUser,
  todayJalali: string,
  removeActivities = false,
): Promise<"ok" | "forbidden" | "in-use" | "not-found"> {
  if (!allowed(user)) return "forbidden";
  const db = getDb();

  const existing = await db.purchaseOrder.findUnique({ where: { id }, select: { id: true, poNumber: true } });
  if (!existing) return "not-found";

  const refs = await countPurchaseOrderReferences(id);
  if (refs.total > 0) return "in-use";

  // Get purchase order info for audit log before deletion
  const po = await db.purchaseOrder.findUnique({ where: { id } });

  await db.$transaction(async (tx) => {
    // Target zero by clearing the status, then reverse whatever was credited.
    await tx.purchaseOrder.update({ where: { id }, data: { status: "لغو شده" } });
    await reconcileStock(tx, id, todayJalali);

    // The reversal rows still point at this order; detach them so the delete can
    // proceed while the movements stay in the product's history.
    await tx.inventoryTransaction.updateMany({
      where: { referenceType: STOCK_REFERENCE, referenceId: id },
      data: { referenceId: null },
    });

    await tx.purchaseOrder.delete({ where: { id } });
  });

  // Audit log
  if (po) {
    await logAction(
      {
        action: "DELETE",
        module: "سفارش خرید",
        entityId: id,
        description: `حذف سفارش خرید: ${po.poNumber || id}`,
        beforeState: po,
      },
      user,
      todayJalali,
    );

    await settleRecordHistory(
      removeActivities,
      po.projectId,
      id,
      {
        projectId: po.projectId,
        categoryName: ACTIVITY_CATEGORY.PURCHASE_ORDERS,
        text: `سفارش خرید شماره ${po.poNumber} از سیستم حذف شد.`,
      },
      user,
      todayJalali,
    );
  }

  return "ok";
}
