import { Prisma } from "@prisma/client";
import { getDb } from "../db";
import { ListQuery, ListResult, buildResult, paginationArgs, searchClause } from "../listing";
import { AuthUser, hasPermission } from "../auth";
import { expandDateFields, jalaliRangeFilter } from "../dates";
import { syncChildren, toJsonColumn, toNullableString, toNumber } from "../childSync";
import { scrubProductRefs } from "../refIntegrity";
import { applyStockDelta } from "./productService";
import { getWonItems } from "../proformaStatus";
import { deriveServiceHeader } from "../afterSalesStatus";
import { getTodayShamsi } from "../../dateUtils";
import { notifyModuleResponsible } from "./notificationService";
import { logAction } from "./auditService";
import { processWorkflowRules } from "./workflowService";
import { ACTIVITY_CATEGORY, logProjectFact, settleRecordHistory } from "./projectActivityLog";

/**
 * Packaging and delivery (packing lists) plus after-sales service.
 *
 * Both are project-scoped documents with one line-item grid each, so they follow
 * the standard shape. They share a module permission in the existing model
 * (`packagingDelivery`), so they share this file rather than duplicating it.
 */

function allowed(user: AuthUser): boolean {
  return hasPermission(user, "packagingDelivery");
}

/* =============================== deliveries =============================== */

export const DELIVERY_SORTABLE = [
  "packingListNumber", "deliveryDate", "actualDeliveryDate", "createdAt", "updatedAt",
] as const;
export const DELIVERY_FILTERABLE = ["projectId", "proformaId", "shippingMethod"] as const;

const DELIVERY_SEARCH = [
  "packingListNumber", "shippingMethod", "preDeliveryTestNotes",
  // A shipment is most often looked up by its waybill or tracking code.
  "waybillNumber", "trackingCode", "driverName",
] as const;
export const DELIVERY_DATE_FIELDS = ["deliveryDate", "actualDeliveryDate"] as const;

export function buildDeliveryWhere(
  q: ListQuery,
  extra: { dateFrom?: unknown; dateTo?: unknown } = {},
): Record<string, unknown> {
  const and: Record<string, unknown>[] = [];

  // The grid's box has always matched the project's name too, which is a join
  // rather than a column on the packing list.
  if (q.search) {
    const own = searchClause(q.search, DELIVERY_SEARCH);
    const byProject = searchClause(q.search, ["name", "code"]);

    const alternatives: Record<string, unknown>[] = [];
    if (own) alternatives.push(...own.OR);
    if (byProject) alternatives.push({ project: byProject });
    if (alternatives.length > 0) and.push({ OR: alternatives });
  }

  for (const [field, value] of Object.entries(q.filters)) {
    and.push({ [field]: value });
  }

  const range = jalaliRangeFilter(extra.dateFrom, extra.dateTo);
  if (range) and.push({ deliveryDate: range });

  return and.length === 0 ? {} : { AND: and };
}

const DELIVERY_LIST_SELECT = {
  id: true, packingListNumber: true, projectId: true, proformaId: true,
  deliveryDate: true, deliveryDateJalali: true,
  actualDeliveryDate: true, actualDeliveryDateJalali: true,
  shippingMethod: true, createdAt: true,
  waybillNumber: true, trackingCode: true, driverName: true,
  // The grid draws a custom-fields column from this, as every other module does.
  customValues: true,
  project: { select: { id: true, code: true, name: true } },
  proforma: { select: { id: true, proformaNumber: true } },
  _count: { select: { items: true } },
} satisfies Prisma.PackagingDeliverySelect;

export async function listDeliveries(
  q: ListQuery,
  user: AuthUser,
  extra: { dateFrom?: unknown; dateTo?: unknown } = {},
): Promise<(ListResult<Record<string, unknown>> & { totalItems: number }) | null> {
  if (!allowed(user)) return null;

  const db = getDb();
  const where = buildDeliveryWhere(q, extra);
  const orderBy = q.sort ? { [q.sort]: q.order } : { createdAt: "desc" as const };

  // The screen shows how many packages exist across every matching list, not
  // just the page on screen — so it is counted in SQL rather than summed from
  // the rows that happen to have been sent.
  const [rows, total, totalItems] = await Promise.all([
    db.packagingDelivery.findMany({ where, orderBy, select: DELIVERY_LIST_SELECT, ...paginationArgs(q) }),
    db.packagingDelivery.count({ where }),
    db.packingItem.count({ where: { delivery: where } }),
  ]);

  /*
   * How many units each list holds, alongside how many lines.
   *
   * The card prints both, and had neither: `_count.items` never reached the
   * client record, so every card read «0 قلم کالا» however full the list was.
   * Summed in SQL for the page's lists in one query, rather than by sending
   * every packing line down so the browser can add them up.
   */
  const quantities = rows.length === 0 ? [] : await db.packingItem.groupBy({
    by: ["deliveryId"],
    where: { deliveryId: { in: rows.map((row) => row.id) } },
    _sum: { quantity: true },
  });
  const unitsById = new Map(quantities.map((g) => [g.deliveryId, Number(g._sum.quantity ?? 0)]));

  const withCounts = rows.map((row) => ({
    ...row,
    totalQuantity: unitsById.get(row.id) ?? 0,
  }));

  return { ...buildResult(withCounts as unknown as Record<string, unknown>[], total, q), totalItems };
}

export async function getDelivery(id: string, user: AuthUser) {
  if (!allowed(user)) return null;
  return getDb().packagingDelivery.findUnique({
    where: { id },
    include: {
      project: { select: { id: true, code: true, name: true } },
      proforma: { select: { id: true, proformaNumber: true } },
      items: { orderBy: { lineNo: "asc" } },
    },
  });
}

export interface PackingItemInput {
  itemOrDocName?: string;
  productId?: string | null;
  variantId?: string | null;
  tagNumber?: string | null;
  quantity?: unknown;
  unit?: string | null;
  packageType?: string | null;
  dimensions?: string | null;
  weight?: unknown;
  boxNumber?: string | null;
  actualDeliveryDate?: string | null;
}

export interface DeliveryInput {
  packingListNumber?: string;
  projectId?: string;
  proformaId?: string | null;
  deliveryDate?: string | null;
  actualDeliveryDate?: string | null;
  shippingMethod?: string | null;
  preDeliveryTestNotes?: string | null;
  waybillNumber?: string | null;
  driverName?: string | null;
  driverPhone?: string | null;
  vehiclePlate?: string | null;
  trackingCode?: string | null;
  checklist?: unknown;
  photos?: unknown;
  customValues?: unknown;
  items?: PackingItemInput[];
}

function mapPackingItem(row: PackingItemInput): Record<string, unknown> | null {
  const name = toNullableString(row?.itemOrDocName, 400);
  if (!name) return null;
  return {
    itemOrDocName: name,
    productId: toNullableString(row.productId, 36),
    // Which SKU, when the product has variants. The ledger issues against it.
    variantId: toNullableString(row.variantId, 36),
    tagNumber: toNullableString(row.tagNumber, 100),
    quantity: toNumber(row.quantity, 1),
    // Held on the line, like the proforma's: a packing list is a historical
    // document and must keep the unit it was written in.
    unit: toNullableString(row.unit, 30),
    packageType: toNullableString(row.packageType, 100),
    dimensions: toNullableString(row.dimensions, 100),
    weight: toNumber(row.weight, 0),
    boxNumber: toNullableString(row.boxNumber, 50),
    ...expandDateFields(row as Record<string, unknown>, ["actualDeliveryDate"]),
  };
}

function deliveryScalarData(input: DeliveryInput): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const set = (key: string, value: unknown) => { if (value !== undefined) out[key] = value; };

  if ("packingListNumber" in input) set("packingListNumber", toNullableString(input.packingListNumber, 60));
  if ("projectId" in input) set("projectId", input.projectId);
  if ("proformaId" in input) set("proformaId", toNullableString(input.proformaId, 36));
  if ("shippingMethod" in input) set("shippingMethod", toNullableString(input.shippingMethod, 100));
  if ("preDeliveryTestNotes" in input) set("preDeliveryTestNotes", toNullableString(input.preDeliveryTestNotes));
  if ("waybillNumber" in input) set("waybillNumber", toNullableString(input.waybillNumber, 100));
  if ("driverName" in input) set("driverName", toNullableString(input.driverName, 200));
  if ("driverPhone" in input) set("driverPhone", toNullableString(input.driverPhone, 30));
  if ("vehiclePlate" in input) set("vehiclePlate", toNullableString(input.vehiclePlate, 50));
  if ("trackingCode" in input) set("trackingCode", toNullableString(input.trackingCode, 100));
  // The checklist is a snapshot of how it was ticked for this shipment, so it
  // travels with the record rather than referring to the current template.
  if ("checklist" in input) set("checklist", toJsonColumn(input.checklist));
  if ("photos" in input) set("photos", toJsonColumn(input.photos));
  if ("customValues" in input) set("customValues", toJsonColumn(input.customValues));

  return { ...out, ...expandDateFields(input as Record<string, unknown>, DELIVERY_DATE_FIELDS) };
}

/** Ledger tag for movements owned by a packing list. */
const STOCK_REFERENCE = "DELIVERY";

const positionKey = (productId: string, variantId: string | null | undefined) =>
  `${productId}|${variantId ?? ""}`;

/**
 * Takes what this packing list ships out of the stock ledger.
 *
 * Written the same way a purchase order's receipt is: not by reverting and
 * reapplying, but by comparing what this list has already issued against what
 * its lines now say and writing only the difference. So it is idempotent, it
 * survives the list being edited, and deleting the list returns everything by
 * targeting zero.
 *
 * The movement is ledger-only. The level a salesperson sees was already reduced
 * when the proforma line was won — for goods that came from the warehouse — and
 * for goods bought against the job it was never increased. Reducing it again
 * here would take the same units out twice.
 */
async function reconcileDeliveryStock(
  tx: Prisma.TransactionClient,
  deliveryId: string,
  todayJalali: string,
): Promise<void> {
  const delivery = await tx.packagingDelivery.findUnique({
    where: { id: deliveryId },
    select: {
      id: true, packingListNumber: true,
      items: { select: { productId: true, variantId: true, quantity: true } },
    },
  });

  const issued = new Map<string, number>();
  const ledger = await tx.inventoryTransaction.findMany({
    where: { referenceType: STOCK_REFERENCE, referenceId: deliveryId },
    select: { productId: true, variantId: true, signedQuantity: true },
  });
  for (const row of ledger) {
    const key = positionKey(row.productId, row.variantId);
    issued.set(key, (issued.get(key) ?? 0) + Number(row.signedQuantity));
  }

  // Negative: goods leaving. A line naming no product is a document or a
  // free-text entry and moves nothing.
  const target = new Map<string, number>();
  for (const item of delivery?.items ?? []) {
    if (!item.productId) continue;
    const key = positionKey(item.productId, item.variantId);
    target.set(key, (target.get(key) ?? 0) - Number(item.quantity));
  }

  for (const key of new Set([...issued.keys(), ...target.keys()])) {
    const delta = (target.get(key) ?? 0) - (issued.get(key) ?? 0);
    if (delta === 0) continue;

    const [productId, variantPart] = key.split("|");
    const variantId = variantPart || null;

    // The product or SKU may have been retired since the list was written.
    if (variantId && (await tx.productVariant.count({ where: { id: variantId } })) === 0) continue;
    if ((await tx.product.count({ where: { id: productId } })) === 0) continue;

    await applyStockDelta(tx, {
      productId, variantId, delta,
      referenceType: STOCK_REFERENCE,
      referenceId: deliveryId,
      notes: delivery
        ? `خروج انبار طبق پکینگ لیست ${delivery.packingListNumber}`
        : `بازگشت به دلیل حذف پکینگ لیست`,
      occurredAtJalali: todayJalali,
      affectsAvailable: false,
    });
  }
}

export async function createDelivery(input: DeliveryInput, user: AuthUser, todayJalali: string) {
  if (!allowed(user)) return null;
  const db = getDb();

  const delivery = await db.$transaction(async (tx) => {
    const delivery = await tx.packagingDelivery.create({
      data: deliveryScalarData(input) as Prisma.PackagingDeliveryUncheckedCreateInput,
    });
    await syncChildren({
      delegate: tx.packingItem, parentWhere: { deliveryId: delivery.id },
      rows: (await scrubProductRefs(tx, input.items)) ?? [], map: mapPackingItem,
    });
    // Issuing the list is what takes the goods out of the warehouse.
    await reconcileDeliveryStock(tx, delivery.id, todayJalali);
    return tx.packagingDelivery.findUnique({
      where: { id: delivery.id },
      include: { items: { orderBy: { lineNo: "asc" } } },
    });
  });

  if (delivery) {
    // Notification
    await notifyModuleResponsible(
      "deliveries",
      "ثبت بسته جدید",
      `بسته جدید ثبت شد: ${delivery.packingListNumber || delivery.id}`,
      user,
      delivery.projectId,
    );

    // Audit log
    await logAction(
      {
        action: "CREATE",
        module: "بسته‌بندی و ارسال",
        entityId: delivery.id,
        description: `ایجاد بسته‌بندی جدید: ${delivery.packingListNumber || delivery.id}`,
        afterState: delivery,
      },
      user,
      todayJalali,
    );

    // Workflow rules
    await processWorkflowRules(
      "packaging_delivery_created",
      {
        deliveryId: delivery.id,
        packingListNumber: delivery.packingListNumber,
        projectId: delivery.projectId,
        proformaId: delivery.proformaId,
        // The editor offers `action` here with a single value, "ایجاد" — on a
        // "created" trigger the condition is a formality, but it has to be
        // satisfiable or the rule never matches.
        action: "ایجاد",
      },
      user,
    );

    // The packing list's own wording dropped the packaging/shipping split: the
    // `type` column did not survive the move to SQL, so the entry names the
    // operation generically and leans on the derived status instead.
    await logProjectFact(
      {
        projectId: delivery.projectId,
        categoryName: ACTIVITY_CATEGORY.DELIVERIES,
        sourceType: "DELIVERY",
        sourceId: delivery.id,
        text:
          `پکینگ‌لیست شماره ${delivery.packingListNumber} برای خروج ${(input.items ?? []).length} قلم کالا` +
          ` از انبار توسط {actor} صادر شد` +
          (delivery.deliveryDateJalali ? ` (تاریخ سند: ${delivery.deliveryDateJalali})` : "") +
          `. وضعیت فعلی محموله: ` +
          (delivery.actualDeliveryDateJalali
            ? `تحویل‌شده به کارفرما در تاریخ ${delivery.actualDeliveryDateJalali}.`
            : "در حال آماده‌سازی و بسته‌بندی؛ هنوز به کارفرما تحویل نشده است.")
      },
      user,
      todayJalali,
    );
  }

  return delivery;
}

export async function updateDelivery(id: string, input: DeliveryInput, user: AuthUser, todayJalali: string) {
  if (!allowed(user)) return null;
  const db = getDb();

  // Get before state for audit log
  const before = await db.packagingDelivery.findUnique({ where: { id } });
  if (!before) return null;

  const delivery = await db.$transaction(async (tx) => {
    const existing = await tx.packagingDelivery.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return null;

    await tx.packagingDelivery.update({
      where: { id },
      data: deliveryScalarData(input) as Prisma.PackagingDeliveryUncheckedUpdateInput,
    });

    if (input.items !== undefined) {
      await syncChildren({
        delegate: tx.packingItem, parentWhere: { deliveryId: id },
        rows: (await scrubProductRefs(tx, input.items)) ?? [], map: mapPackingItem,
      });
    }

    // Only the difference between what this list has already issued and what it
    // now says, so an edit corrects the ledger rather than doubling it.
    await reconcileDeliveryStock(tx, id, todayJalali);

    return tx.packagingDelivery.findUnique({
      where: { id },
      include: { items: { orderBy: { lineNo: "asc" } } },
    });
  });

  // Audit log
  if (delivery) {
    await logAction(
      {
        action: "UPDATE",
        module: "بسته‌بندی و ارسال",
        entityId: id,
        description: `ویرایش بسته‌بندی: ${delivery.packingListNumber || id}`,
        beforeState: before,
        afterState: delivery,
      },
      user,
      todayJalali,
    );

    // Workflow rules for status change
    const getDeliveryStatus = (d: any) => (d?.actualDeliveryDate ? 'تحویل شده' : 'در حال آماده‌سازی');
    const oldStatus = getDeliveryStatus(before);
    const newStatus = getDeliveryStatus(delivery);

    if (oldStatus !== newStatus) {
      await processWorkflowRules(
        "packaging_delivery_status_change",
        {
          deliveryId: delivery.id,
          packingListNumber: delivery.packingListNumber,
          projectId: delivery.projectId,
          proformaId: delivery.proformaId,
          oldStatus,
          newStatus,
          status: newStatus,
        },
        user,
      );
    }

    await logProjectFact(
      {
        projectId: delivery.projectId,
        categoryName: ACTIVITY_CATEGORY.DELIVERIES,
        sourceType: "DELIVERY",
        sourceId: delivery.id,
        text:
          `وضعیت پکینگ‌لیست شماره ${delivery.packingListNumber} به «${newStatus}» تغییر کرد` +
          (delivery.actualDeliveryDateJalali
            ? `؛ تاریخ تحویل قطعی به کارفرما: ${delivery.actualDeliveryDateJalali}.`
            : "؛ محموله هنوز تحویل کارفرما نشده است.")
      },
      user,
      todayJalali,
    );
  }

  return delivery;
}

/**
 * What the project still owes the customer, per item.
 *
 * The screen needs two numbers before it can build a packing list: how much of
 * each item the won proformas promised, and how much has already gone out on
 * other packing lists. It used to derive both in the browser by scanning every
 * proforma and every delivery it held — which is exactly what a paged list
 * stops being able to do, and getting it wrong means either over-shipping or
 * refusing a legitimate shipment.
 *
 * Items are matched the way the screen matches them: by product id when there
 * is one, otherwise by trimmed name. A line typed by hand and a catalogued
 * product with the same name are therefore the same item here, which is what
 * makes a hand-typed line count against the promise it fulfils.
 */
export interface RemainingLine {
  key: string;
  productId: string | null;
  /** The SKU promised, when the product has variants. */
  variantId: string | null;
  productName: string;
  /** The unit the proforma quoted it in, carried onto the packing line. */
  unit: string | null;
  tagNumber: string | null;
  promised: number;
  shipped: number;
  remaining: number;
}

export async function getDeliveryRemaining(
  params: { projectId: string; proformaId?: string | null; excludeDeliveryId?: string | null },
  user: AuthUser,
): Promise<RemainingLine[] | null> {
  if (!allowed(user)) return null;
  const db = getDb();

  const proformas = await db.proforma.findMany({
    where: {
      projectId: params.projectId,
      ...(params.proformaId ? { id: params.proformaId } : {}),
    },
    select: {
      status: true, isCancelled: true,
      items: {
        orderBy: { lineNo: "asc" },
        select: {
          productId: true, variantId: true, productName: true, tagNumber: true,
          quantity: true, unit: true, supplyMethod: true, status: true,
        },
      },
    },
  });

  const lines = new Map<string, RemainingLine>();
  /*
   * Two lines are the same line when they are the same SKU.
   *
   * The key was the product alone, so a proforma promising one variant and a
   * packing list shipping a different one of the same product counted against
   * each other — the wrong SKU came off the outstanding list, and the ledger
   * entry the packing line produced named whichever variant happened to be
   * attached.
   */
  const keyOf = (productId: string | null, variantId: string | null, name: string) =>
    productId ? `${productId}|${variantId ?? ""}` : name.trim();

  for (const pf of proformas) {
    // `true` keeps lines that will be purchased as well as those from stock:
    // both are delivered to the customer, and both belong on a packing list.
    for (const item of getWonItems(pf, true)) {
      const key = keyOf(item.productId, item.variantId ?? null, item.productName);
      const existing = lines.get(key);
      if (existing) {
        existing.promised += Number(item.quantity);
        existing.tagNumber ??= item.tagNumber;
        existing.unit ??= item.unit;
      } else {
        lines.set(key, {
          key,
          productId: item.productId,
          variantId: item.variantId ?? null,
          productName: item.productName,
          unit: item.unit,
          tagNumber: item.tagNumber,
          promised: Number(item.quantity),
          shipped: 0,
          remaining: 0,
        });
      }
    }
  }

  const shippedRows = await db.packingItem.findMany({
    where: {
      delivery: {
        projectId: params.projectId,
        ...(params.excludeDeliveryId ? { id: { not: params.excludeDeliveryId } } : {}),
      },
    },
    select: { productId: true, variantId: true, itemOrDocName: true, quantity: true, unit: true },
  });

  for (const row of shippedRows) {
    const key = keyOf(row.productId, row.variantId, row.itemOrDocName);
    const line = lines.get(key);
    // Something shipped that no won line promised is still shipped, so it is
    // reported rather than dropped — otherwise it silently frees up quota.
    if (line) line.shipped += Number(row.quantity);
    else {
      lines.set(key, {
        key, productId: row.productId, variantId: row.variantId,
        productName: row.itemOrDocName,
        unit: row.unit,
        tagNumber: null, promised: 0, shipped: Number(row.quantity), remaining: 0,
      });
    }
  }

  for (const line of lines.values()) {
    line.remaining = Math.max(0, line.promised - line.shipped);
  }

  return [...lines.values()];
}

/**
 * `removeActivities` takes the automatic timeline entries about this record
 * with it — matched on the link each entry stores, never on its wording — and
 * drops a category group that is left empty. The default keeps them, and the
 * entry recording the deletion joins them, so the project's history stays
 * whole.
 */
export async function deleteDelivery(
  id: string,
  user: AuthUser,
  todayJalali: string,
  removeActivities = false,
): Promise<"ok" | "forbidden" | "not-found"> {
  if (!allowed(user)) return "forbidden";
  const db = getDb();
  const existing = await db.packagingDelivery.findUnique({ where: { id } });
  if (!existing) return "not-found";

  await db.$transaction(async (tx) => {
    /*
     * Put back what this list took out, then remove it.
     *
     * The lines cascade with the delivery, so the reconciliation has to run
     * while they still exist — it targets zero once they are gone, and the
     * ledger entries it writes carry a reference to a list that no longer
     * exists, which is exactly right: the history says the goods left and came
     * back.
     */
    await tx.packingItem.deleteMany({ where: { deliveryId: id } });
    await reconcileDeliveryStock(tx, id, todayJalali);
    await tx.packagingDelivery.delete({ where: { id } });
  });

  // Audit log
  await logAction(
    {
      action: "DELETE",
      module: "بسته‌بندی و ارسال",
      entityId: id,
      description: `حذف بسته‌بندی: ${existing.packingListNumber || id}`,
      beforeState: existing,
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
      categoryName: ACTIVITY_CATEGORY.DELIVERIES,
      text:
        `پکینگ‌لیست شماره ${existing.packingListNumber} توسط {actor} حذف شد؛` +
        ` اقلام آن دیگر به عنوان تحویل‌شده به کارفرما محسوب نمی‌شوند.`,
    },
    user,
    todayJalali,
  );

  return "ok";
}

/* ============================== after sales ============================== */

export const SERVICE_SORTABLE = ["itemName", "status", "startDate", "endDate", "createdAt"] as const;
export const SERVICE_FILTERABLE = ["projectId", "status"] as const;

const SERVICE_SEARCH = ["itemName", "proformaNumber", "proformaItemName", "issueDescription", "actionsTaken"] as const;
export const SERVICE_DATE_FIELDS = ["startDate", "endDate", "returnDate"] as const;

export function buildServiceWhere(
  q: ListQuery,
  extra: { dateFrom?: unknown; dateTo?: unknown } = {},
): Record<string, unknown> {
  const and: Record<string, unknown>[] = [];

  const search = searchClause(q.search, SERVICE_SEARCH);
  if (search) and.push(search);

  for (const [field, value] of Object.entries(q.filters)) {
    and.push({ [field]: value });
  }

  const range = jalaliRangeFilter(extra.dateFrom, extra.dateTo);
  if (range) and.push({ startDate: range });

  return and.length === 0 ? {} : { AND: and };
}

const SERVICE_LIST_SELECT = {
  id: true, projectId: true, itemName: true, status: true,
  proformaNumber: true, proformaItemName: true,
  startDate: true, startDateJalali: true, endDateJalali: true, returnDateJalali: true,
  createdBy: true, createdAt: true,
  customValues: true,
  project: { select: { id: true, code: true, name: true } },
  _count: { select: { items: true } },
} satisfies Prisma.AfterSalesServiceSelect;

export async function listServices(
  q: ListQuery,
  user: AuthUser,
  extra: { dateFrom?: unknown; dateTo?: unknown } = {},
): Promise<ListResult<Record<string, unknown>> | null> {
  if (!allowed(user)) return null;

  const db = getDb();
  const where = buildServiceWhere(q, extra);
  const orderBy = q.sort ? { [q.sort]: q.order } : { createdAt: "desc" as const };

  const [rows, total] = await Promise.all([
    db.afterSalesService.findMany({ where, orderBy, select: SERVICE_LIST_SELECT, ...paginationArgs(q) }),
    db.afterSalesService.count({ where }),
  ]);

  return buildResult(rows as unknown as Record<string, unknown>[], total, q);
}

export async function getService(id: string, user: AuthUser) {
  if (!allowed(user)) return null;
  return getDb().afterSalesService.findUnique({
    where: { id },
    include: {
      project: { select: { id: true, code: true, name: true } },
      items: { orderBy: { lineNo: "asc" } },
    },
  });
}

export interface ServiceItemInput {
  productId?: string | null;
  productName?: string;
  status?: string;
  issueDescription?: string | null;
  actionsTaken?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  returnDate?: string | null;
}

export interface ServiceInput {
  projectId?: string;
  proformaNumber?: string | null;
  proformaItemName?: string | null;
  itemName?: string;
  status?: string;
  issueDescription?: string | null;
  actionsTaken?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  returnDate?: string | null;
  createdBy?: string | null;
  customValues?: unknown;
  items?: ServiceItemInput[];
}

function mapServiceItem(row: ServiceItemInput): Record<string, unknown> | null {
  const productName = toNullableString(row?.productName, 400);
  if (!productName) return null;
  return {
    productId: toNullableString(row.productId, 36),
    productName,
    status: toNullableString(row.status, 50) ?? "در حال بررسی",
    issueDescription: toNullableString(row.issueDescription),
    actionsTaken: toNullableString(row.actionsTaken),
    ...expandDateFields(row as Record<string, unknown>, SERVICE_DATE_FIELDS),
  };
}

function serviceScalarData(input: ServiceInput): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const set = (key: string, value: unknown) => { if (value !== undefined) out[key] = value; };

  if ("projectId" in input) set("projectId", input.projectId);
  if ("proformaNumber" in input) set("proformaNumber", toNullableString(input.proformaNumber, 60));
  if ("proformaItemName" in input) set("proformaItemName", toNullableString(input.proformaItemName, 400));
  if ("itemName" in input) set("itemName", toNullableString(input.itemName, 400));
  if ("status" in input) set("status", toNullableString(input.status, 50));
  if ("issueDescription" in input) set("issueDescription", toNullableString(input.issueDescription));
  if ("actionsTaken" in input) set("actionsTaken", toNullableString(input.actionsTaken));
  if ("createdBy" in input) set("createdBy", toNullableString(input.createdBy, 200));
  if ("customValues" in input) set("customValues", toJsonColumn(input.customValues));

  return { ...out, ...expandDateFields(input as Record<string, unknown>, SERVICE_DATE_FIELDS) };
}

/**
 * Rewrites the record's own name, dates and status from the rows just written.
 *
 * Read back from the database rather than from the request, so the roll-up
 * describes what was actually stored.
 */
async function applyServiceHeader(tx: Prisma.TransactionClient, serviceId: string): Promise<void> {
  const rows = await tx.afterSalesServiceItem.findMany({
    where: { serviceId },
    orderBy: { lineNo: "asc" },
    select: {
      productName: true, status: true, issueDescription: true, actionsTaken: true,
      startDateJalali: true, endDateJalali: true, returnDateJalali: true,
    },
  });

  const header = deriveServiceHeader(rows);
  if (!header) return;

  await tx.afterSalesService.update({
    where: { id: serviceId },
    data: {
      itemName: header.itemName,
      issueDescription: header.issueDescription,
      actionsTaken: header.actionsTaken,
      status: header.status,
      ...expandDateFields(
        { startDate: header.startDate, endDate: header.endDate, returnDate: header.returnDate },
        SERVICE_DATE_FIELDS,
      ),
    } as Prisma.AfterSalesServiceUncheckedUpdateInput,
  });
}

export async function createService(input: ServiceInput, user: AuthUser, todayJalali: string) {
  if (!allowed(user)) return null;
  const db = getDb();

  const service = await db.$transaction(async (tx) => {
    const service = await tx.afterSalesService.create({
      data: {
        // Placeholders for the NOT NULL columns. Every one of them is rolled up
        // from the rows a moment later, but the row has to exist first.
        itemName: "—",
        status: "در حال بررسی",
        ...expandDateFields({ startDate: getTodayShamsi() }, ["startDate"]),
        ...serviceScalarData(input),
      } as Prisma.AfterSalesServiceUncheckedCreateInput,
    });
    await syncChildren({
      delegate: tx.afterSalesServiceItem, parentWhere: { serviceId: service.id },
      rows: (await scrubProductRefs(tx, input.items)) ?? [], map: mapServiceItem,
    });
    await applyServiceHeader(tx, service.id);

    return tx.afterSalesService.findUnique({
      where: { id: service.id },
      include: { items: { orderBy: { lineNo: "asc" } } },
    });
  });

  // Audit log
  if (service) {
    await logAction(
      {
        action: "CREATE",
        module: "خدمات پس از فروش",
        entityId: service.id,
        description: `ایجاد خدمات پس از فروش جدید: ${service.itemName || service.id}`,
        afterState: service,
      },
      user,
      todayJalali,
    );

    // Workflow rules
    await processWorkflowRules(
      "after_sales_service_created",
      {
        serviceId: service.id,
        itemName: service.itemName,
        projectId: service.projectId,
        status: service.status,
      },
      user,
    );

    await logProjectFact(
      {
        projectId: service.projectId,
        categoryName: ACTIVITY_CATEGORY.AFTER_SALES,
        sourceType: "AFTER_SALES",
        sourceId: service.id,
        text:
          `درخواست خدمات پس از فروش برای کالای «${service.itemName || "نامشخص"}» توسط {actor} ثبت شد.` +
          ` شرح ایراد اعلام‌شده: ${service.issueDescription || "ثبت نشده"}.` +
          (service.startDateJalali ? ` تاریخ شروع رسیدگی: ${service.startDateJalali}.` : "") +
          ` وضعیت فعلی رسیدگی: ${service.status}.`,
      },
      user,
      todayJalali,
    );
  }

  return service;
}

export async function updateService(id: string, input: ServiceInput, user: AuthUser, todayJalali: string) {
  if (!allowed(user)) return null;
  const db = getDb();

  // Get before state for audit log
  const before = await db.afterSalesService.findUnique({ where: { id } });
  if (!before) return null;

  const service = await db.$transaction(async (tx) => {
    const existing = await tx.afterSalesService.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return null;

    await tx.afterSalesService.update({
      where: { id },
      data: serviceScalarData(input) as Prisma.AfterSalesServiceUncheckedUpdateInput,
    });

    if (input.items !== undefined) {
      await syncChildren({
        delegate: tx.afterSalesServiceItem, parentWhere: { serviceId: id },
        rows: (await scrubProductRefs(tx, input.items)) ?? [], map: mapServiceItem,
      });
    }
    // Also on a save that sent no rows: the header still has to agree with what
    // is stored, and a caller may have edited only the record itself.
    await applyServiceHeader(tx, id);

    return tx.afterSalesService.findUnique({
      where: { id },
      include: { items: { orderBy: { lineNo: "asc" } } },
    });
  });

  // Audit log
  if (service) {
    await logAction(
      {
        action: "UPDATE",
        module: "خدمات پس از فروش",
        entityId: id,
        description: `ویرایش خدمات پس از فروش: ${service.itemName || id}`,
        beforeState: before,
        afterState: service,
      },
      user,
      todayJalali,
    );

    // Workflow rules for status change
    if (before.status !== service.status) {
      await processWorkflowRules(
        "after_sales_service_status_change",
        {
          serviceId: service.id,
          itemName: service.itemName,
          projectId: service.projectId,
          oldStatus: before.status,
          newStatus: service.status,
          status: service.status,
        },
        user,
      );
    }

    await logProjectFact(
      {
        projectId: service.projectId,
        categoryName: ACTIVITY_CATEGORY.AFTER_SALES,
        sourceType: "AFTER_SALES",
        sourceId: service.id,
        text:
          `وضعیت رسیدگی به درخواست خدمات پس از فروش کالای «${service.itemName || "نامشخص"}»` +
          ` به «${service.status}» تغییر کرد.` +
          ` اقدامات انجام‌شده: ${service.actionsTaken || "تاکنون اقدامی ثبت نشده است"}.`,
      },
      user,
      todayJalali,
    );
  }

  return service;
}

/**
 * `removeActivities` takes the automatic timeline entries about this record
 * with it — matched on the link each entry stores, never on its wording — and
 * drops a category group that is left empty. The default keeps them, and the
 * entry recording the deletion joins them, so the project's history stays
 * whole.
 */
export async function deleteService(
  id: string,
  user: AuthUser,
  todayJalali: string,
  removeActivities = false,
): Promise<"ok" | "forbidden" | "not-found"> {
  if (!allowed(user)) return "forbidden";
  const db = getDb();
  const existing = await db.afterSalesService.findUnique({ where: { id } });
  if (!existing) return "not-found";

  await db.afterSalesService.delete({ where: { id } });

  // Audit log
  await logAction(
    {
      action: "DELETE",
      module: "خدمات پس از فروش",
      entityId: id,
      description: `حذف خدمات پس از فروش: ${existing.itemName || id}`,
      beforeState: existing,
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
      categoryName: ACTIVITY_CATEGORY.AFTER_SALES,
      text: `درخواست خدمات پس از فروش مربوط به کالای ${existing.itemName} حذف گردید.`,
    },
    user,
    todayJalali,
  );

  return "ok";
}
