import { Prisma } from "@prisma/client";
import { getDb } from "../db";
import { ListQuery, ListResult, buildResult, paginationArgs, searchClause } from "../listing";
import { AuthUser, hasPermission } from "../auth";
import { expandDateFields, jalaliRangeFilter } from "../dates";
import { syncChildren, toJsonColumn, toNullableString, toNumber } from "../childSync";
import { applyStockDelta } from "./productService";
import { logAction } from "./auditService";
import { notifyModuleResponsible } from "./notificationService";
import { processWorkflowRules } from "./workflowService";
import { ACTIVITY_CATEGORY, logProjectFact } from "./projectActivityLog";

/**
 * Purchase order data access.
 *
 * The distinguishing feature is that a received order puts goods into stock, and
 * that has to survive editing: an order can be received, then corrected, then
 * un-received. See `reconcileStock` for how that is kept honest.
 */

/** The status at which goods have physically arrived and enter inventory. */
export const RECEIVED_STATUS = "تحویل شده (رسید انبار)";

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
  supplier: { select: { id: true, name: true } },
  project: { select: { id: true, code: true, name: true } },
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

  return buildResult(rows as unknown as Record<string, unknown>[], total, q);
}

export async function getPurchaseOrder(id: string, user: AuthUser) {
  if (!allowed(user)) return null;
  return getDb().purchaseOrder.findUnique({
    where: { id },
    include: {
      supplier: true,
      project: { select: { id: true, code: true, name: true } },
      proforma: { select: { id: true, proformaNumber: true } },
      items: { orderBy: { lineNo: "asc" } },
    },
  });
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
function computeTotals(
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

  const landedCostForeign = totalForeignAmount + shippingCostForeign + remittanceFeeForeign;
  const landedCostRial =
    landedCostForeign * exchangeRate + shippingCostRial + customsDutyRial + remittanceFeeRial;

  return {
    totalForeignAmount, exchangeRate,
    shippingCostRial, customsDutyRial, remittanceFeeRial,
    shippingCostForeign, remittanceFeeForeign,
    landedCostForeign, landedCostRial,
  };
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
      id: true, poNumber: true, status: true,
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
    const po = await tx.purchaseOrder.create({
      data: {
        ...scalarData(input),
        ...computeTotals(input.items ?? [], input),
      } as Prisma.PurchaseOrderUncheckedCreateInput,
    });

    await syncChildren({
      delegate: tx.purchaseOrderItem, parentWhere: { purchaseOrderId: po.id },
      rows: input.items ?? [], map: mapItem,
    });

    // An order can be entered already received, e.g. when recording history.
    await reconcileStock(tx, po.id, todayJalali);

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
        text:
          `صدور سفارش خرید (شماره: ${po.poNumber}) برای تأمین‌کننده` +
          ` «${await supplierNameOf(po.supplierId)}» جهت تأمین اقلام پروژه.`,
      },
      user,
      todayJalali,
    );
  }

  return po;
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

    await tx.purchaseOrder.update({
      where: { id },
      data: data as Prisma.PurchaseOrderUncheckedUpdateInput,
    });

    if (input.items !== undefined) {
      await syncChildren({
        delegate: tx.purchaseOrderItem, parentWhere: { purchaseOrderId: id },
        rows: input.items, map: mapItem,
      });
    }

    // Runs on every update: the status may have changed, the lines may have
    // changed, or both, and this settles whichever it was.
    await reconcileStock(tx, id, todayJalali);

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
          text:
            `تغییر وضعیت سفارش خرید (شماره: ${po.poNumber}) مرتبط با تأمین‌کننده` +
            ` «${await supplierNameOf(po.supplierId)}» به «${po.status}».`,
        },
        user,
        todayJalali,
      );
    }
  }

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
export async function deletePurchaseOrder(
  id: string,
  user: AuthUser,
  todayJalali: string,
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

    await logProjectFact(
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
