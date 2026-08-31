import { Prisma } from "@prisma/client";
import { getDb } from "../db";
import { ListQuery, ListResult, buildResult, paginationArgs, searchClause } from "../listing";
import { AuthUser, canSeeCosts, hasPermission } from "../auth";
import { redactProduct, stripProductCostInput } from "../costs";
import { jalaliToDate, normalizeJalali } from "../dates";
import { toJsonColumn, toNullableString, toNumber } from "../childSync";
import { logAction } from "./auditService";
import { notifyModuleResponsible } from "./notificationService";
import { processWorkflowRules } from "./workflowService";
import { invalidateSettingsCache, loadSettings } from "../settings";
import {
  categoryKey, matchKnownCategory, mergeRefusalReason,
} from "../../utils/productCategories";

/**
 * Product and inventory data access.
 *
 * Two things make this module different from the others:
 *
 *  1. **Variants are entities, not line items.** A SKU carries its own stock,
 *     its own prices, and is referenced by proforma lines, purchase-order lines
 *     and inventory transactions. So `syncChildren` must not be used here — a
 *     delete-and-recreate would break those references and reset every SKU's
 *     stock to whatever the form happened to be showing. Variants are reconciled
 *     by identity instead.
 *
 *  2. **Stock only moves through `applyStockDelta`.** Every change writes an
 *     InventoryTransaction in the same transaction as the new level, so the
 *     ledger can never disagree with the balance. This is deliberate: editing a
 *     SKU's stock on the product form used to change the number without
 *     recording a movement, and the history simply lost it.
 */

export const PRODUCT_SORTABLE = [
  "code", "name", "displayName", "category", "brand", "stockLevel",
  "basePriceRial", "createdAt", "updatedAt",
] as const;

export const PRODUCT_FILTERABLE = ["category", "brand", "supplyType"] as const;

const SEARCH_FIELDS = [
  "code", "name", "displayName", "category", "brand", "modelNumber", "description",
] as const;

/**
 * Products are shared reference data, not owned records: a salesperson who can
 * quote must be able to read the catalogue. So there is no per-record scope —
 * the module permission is the whole gate.
 */
function requireProductPermission(user: AuthUser): boolean {
  return hasPermission(user, "products");
}

export function buildProductWhere(
  q: ListQuery,
  extra: { hasVariants?: unknown } = {},
): Record<string, unknown> {
  const and: Record<string, unknown>[] = [];

  const search = searchClause(q.search, SEARCH_FIELDS);
  if (search) and.push(search);

  for (const [field, value] of Object.entries(q.filters)) {
    and.push({ [field]: value });
  }

  if (extra.hasVariants === "true") and.push({ hasVariants: true });
  else if (extra.hasVariants === "false") and.push({ hasVariants: false });

  // Note: "at or below the reorder point" is deliberately NOT a filter here.
  // It compares two columns, which a Prisma `where` cannot express, and doing it
  // in JS after the page is fetched would make the totals describe the page
  // rather than the result. It is its own endpoint instead — see
  // lowStockProducts, where plain SQL is the natural fit.
  return and.length === 0 ? {} : { AND: and };
}

const LIST_SELECT = {
  id: true,
  code: true,
  name: true,
  displayName: true,
  category: true,
  brand: true,
  modelNumber: true,
  unit: true,
  supplyType: true,
  hasVariants: true,
  stockLevel: true,
  minStockLevel: true,
  basePriceRial: true,
  priceForeign: true,
  currencyForeign: true,
  images: true,
  features: true,
  description: true,
  createdAt: true,
  // The grid draws a custom-fields column from these.
  customValues: true,
  variants: { select: { id: true, sku: true, attributes: true, stockLevel: true } },
  _count: { select: { variants: true } },
} satisfies Prisma.ProductSelect;

export async function listProducts(
  q: ListQuery,
  user: AuthUser,
  extra: { hasVariants?: unknown } = {},
): Promise<ListResult<Record<string, unknown>> | null> {
  if (!requireProductPermission(user)) return null;

  const db = getDb();
  const where = buildProductWhere(q, extra);
  const orderBy = q.sort ? { [q.sort]: q.order } : { displayName: "asc" as const };

  const [rows, total] = await Promise.all([
    db.product.findMany({ where, orderBy, select: LIST_SELECT, ...paginationArgs(q) }),
    db.product.count({ where }),
  ]);

  return buildResult(rows as unknown as Record<string, unknown>[], total, q);
}

export async function getProduct(id: string, user: AuthUser) {
  if (!requireProductPermission(user)) return null;
  const db = getDb();
  const product = await db.product.findUnique({
    where: { id },
    include: { variants: { orderBy: { sku: "asc" } } },
  });
  // The list rows never carried the calculator, so this is the one read that
  // has to drop it. `LIST_SELECT` above must stay that way.
  return redactProduct(product, user);
}

/**
 * Products at or below their reorder point.
 *
 * Compares two columns, so it is a raw query — and it must stay a query: the
 * client used to load the catalogue and filter it in the browser, which stops
 * working at exactly the size where reorder alerts start to matter.
 */
export async function lowStockProducts(user: AuthUser, limit = 100) {
  if (!requireProductPermission(user)) return null;
  const db = getDb();
  const take = Math.min(Math.max(1, limit), 200);

  return db.$queryRaw<{ id: string; code: string; displayName: string; stockLevel: number; minStockLevel: number }[]>`
    SELECT TOP (${take}) [id], [code], [displayName], [stockLevel], [minStockLevel]
    FROM [dbo].[products]
    WHERE [minStockLevel] > 0 AND [stockLevel] <= [minStockLevel]
    ORDER BY ([minStockLevel] - [stockLevel]) DESC
  `;
}

/* ------------------------------ stock movement ------------------------------ */

export interface StockChange {
  productId: string;
  variantId?: string | null;
  /** Signed: positive is a receipt, negative an issue. */
  delta: number;
  referenceType?: string | null;
  referenceId?: string | null;
  notes?: string | null;
  /** Shamsi date of the movement; defaults to today at the caller's clock. */
  occurredAtJalali: string;
  /**
   * Whether this movement changes what a salesperson may promise.
   *
   * True for ordinary warehouse stock: goods held against no particular order,
   * which anyone may quote. False for goods that only ever belonged to one job
   * — a foreign order bought against a won line arrives, sits in the warehouse
   * and leaves on that job's packing list. Physically it came and went, and the
   * ledger records both; it was never available to sell, because it was sold
   * before it was bought.
   *
   * So `stockLevel` means *free to sell*, not *physically present*, and the two
   * deliberately differ while job-specific goods are on the shelf. The ledger
   * is the physical record; the level is the promise.
   */
  affectsAvailable?: boolean;
}

/**
 * Applies a stock change and records it. The only function that writes a
 * stockLevel.
 *
 * Both halves happen in the caller's transaction, so a movement can never exist
 * without its ledger entry or vice versa. When the product has variants, its own
 * stockLevel is the sum of theirs and is recalculated here rather than tracked
 * separately — two independent counters would drift.
 */
export async function applyStockDelta(
  tx: Prisma.TransactionClient,
  change: StockChange,
): Promise<void> {
  if (!change.delta || !Number.isFinite(change.delta)) return;

  const occurredAt = jalaliToDate(change.occurredAtJalali) ?? new Date();

  await tx.inventoryTransaction.create({
    data: {
      productId: change.productId,
      variantId: change.variantId ?? null,
      occurredAt,
      occurredAtJalali: normalizeJalali(change.occurredAtJalali),
      type: change.delta > 0 ? "IN" : "OUT",
      quantity: Math.abs(change.delta),
      // Signed as well, so SUM() over the ledger is the net movement directly.
      signedQuantity: change.delta,
      referenceType: toNullableString(change.referenceType, 30),
      referenceId: toNullableString(change.referenceId, 36),
      notes: toNullableString(change.notes),
      // Recorded on the row, not merely acted on: correcting this entry by hand
      // later has to put back exactly what it took, and nothing else can tell
      // whether it moved the level or only the physical record.
      affectsAvailable: change.affectsAvailable !== false,
    },
  });

  // Ledger only: the goods moved, but nothing about what may be promised did.
  if (change.affectsAvailable === false) return;

  await moveLevel(tx, change.productId, change.variantId ?? null, change.delta);
}

/**
 * Moves the sellable level by a signed delta, without writing a ledger entry.
 *
 * Private on purpose: the only callers are `applyStockDelta`, which writes the
 * entry itself, and the two administrative corrections below, where the edited
 * or deleted row *is* the record and a second entry would double-count it.
 */
async function moveLevel(
  tx: Prisma.TransactionClient,
  productId: string,
  variantId: string | null,
  delta: number,
): Promise<void> {
  if (!delta || !Number.isFinite(delta)) return;

  if (variantId) {
    await tx.productVariant.update({
      where: { id: variantId },
      data: { stockLevel: { increment: delta } },
    });
    // Keep the parent's total consistent with its SKUs.
    const agg = await tx.productVariant.aggregate({
      where: { productId },
      _sum: { stockLevel: true },
    });
    await tx.product.update({
      where: { id: productId },
      data: { stockLevel: agg._sum.stockLevel ?? 0 },
    });
  } else {
    await tx.product.update({
      where: { id: productId },
      data: { stockLevel: { increment: delta } },
    });
  }
}

/** A manual stock adjustment from the inventory screen. */
export async function adjustStock(
  change: Omit<StockChange, "referenceType">,
  user: AuthUser,
): Promise<"ok" | "forbidden" | "not-found"> {
  if (!requireProductPermission(user)) return "forbidden";
  const db = getDb();

  return db.$transaction(async (tx) => {
    const product = await tx.product.findUnique({
      where: { id: change.productId },
      select: { id: true, hasVariants: true },
    });
    if (!product) return "not-found";

    if (change.variantId) {
      const variant = await tx.productVariant.findFirst({
        where: { id: change.variantId, productId: change.productId },
        select: { id: true },
      });
      if (!variant) return "not-found";
    } else if (product.hasVariants) {
      // Product-level stock is the sum of its SKUs, so adjusting it directly
      // would be overwritten by the next recalculation.
      return "not-found";
    }

    await applyStockDelta(tx, { ...change, referenceType: "MANUAL" });
    return "ok";
  });
}

export async function listInventoryTransactions(
  q: ListQuery,
  user: AuthUser,
  filters: { productId?: string; variantId?: string } = {},
): Promise<ListResult<Record<string, unknown>> | null> {
  if (!requireProductPermission(user)) return null;
  const db = getDb();

  const where: Record<string, unknown> = {};
  if (filters.productId) where.productId = filters.productId;
  if (filters.variantId) where.variantId = filters.variantId;

  const [rows, total] = await Promise.all([
    db.inventoryTransaction.findMany({
      where,
      orderBy: q.sort ? { [q.sort]: q.order } : [{ occurredAt: "desc" }, { createdAt: "desc" }],
      include: {
        product: { select: { id: true, code: true, displayName: true } },
        variant: { select: { id: true, sku: true } },
      },
      ...paginationArgs(q),
    }),
    db.inventoryTransaction.count({ where }),
  ]);

  return buildResult(rows as unknown as Record<string, unknown>[], total, q);
}

export const INVENTORY_SORTABLE = ["occurredAt", "createdAt", "quantity", "type"] as const;

/* ------------------------- correcting a ledger row ------------------------ */

/**
 * Editing and deleting a single ledger row.
 *
 * The ledger is otherwise append-only, and deliberately so: it is the record of
 * what physically happened, and a business that can rewrite it has no record at
 * all. But a wrong entry does get made — a receipt counted twice, a quantity
 * mistyped, an adjustment dated to the wrong month — and until now the only way
 * to answer that was another adjustment, which leaves both the mistake and the
 * correction in the history and neither of them true.
 *
 * So the row can be corrected, by a system administrator and nobody else. Not
 * the products permission, not a warehouse role: the same rule the audit-log
 * purge already follows, for the same reason.
 *
 * Three things make the correction safe:
 *
 *  - The level is corrected by the *difference*, inside the same transaction.
 *    An edit that halves a receipt takes half back; a delete takes all of it.
 *  - A row that never moved the level does not move it now. That is what the
 *    stored `affectsAvailable` is for — a purchase-order receipt sits in the
 *    ledger without ever having been sellable, and "putting it back" would
 *    invent stock that was never promised.
 *  - What changed is written to the audit log with both states, by the caller.
 *
 * What a correction cannot do is move a row to a different product or SKU. That
 * is not a typo being fixed, it is two corrections wearing one coat, and it is
 * better done as a delete and a fresh adjustment where both halves are visible.
 */
export interface InventoryTransactionEdit {
  quantity?: unknown;
  type?: string;
  occurredAtJalali?: string | null;
  notes?: string | null;
}

const inventoryDetail = {
  include: {
    product: { select: { id: true, code: true, displayName: true } },
    variant: { select: { id: true, sku: true } },
  },
} satisfies { include: Prisma.InventoryTransactionInclude };

/**
 * Rewrites one ledger row and corrects the level by the difference.
 *
 * Returns `"reference-changed"` never — the product and SKU are not writable —
 * and `"forbidden"` for anyone who is not a system administrator, including a
 * user with full products access.
 */
export async function updateInventoryTransaction(
  id: string,
  input: InventoryTransactionEdit,
  user: AuthUser,
  todayJalali: string,
): Promise<"forbidden" | "not-found" | "invalid" | { before: Record<string, unknown>; after: Record<string, unknown> }> {
  if (!user.isSystemAdmin) return "forbidden";
  const db = getDb();

  const outcome = await db.$transaction(async (tx) => {
    const before = await tx.inventoryTransaction.findUnique({ where: { id }, ...inventoryDetail });
    if (!before) return "not-found" as const;

    const type = input.type === "IN" || input.type === "OUT" ? input.type : before.type;
    const quantity = "quantity" in input
      ? Math.abs(toNumber(input.quantity, Number(before.quantity)))
      : Math.abs(Number(before.quantity));

    // Zero would be a row recording that nothing happened. Deleting is the way
    // to say that, and it corrects the level too.
    if (!Number.isFinite(quantity) || quantity <= 0) return "invalid" as const;

    const signed = type === "OUT" ? -quantity : quantity;
    const jalali = "occurredAtJalali" in input && input.occurredAtJalali
      ? normalizeJalali(input.occurredAtJalali)
      : before.occurredAtJalali;

    const after = await tx.inventoryTransaction.update({
      where: { id },
      data: {
        type,
        quantity,
        signedQuantity: signed,
        occurredAtJalali: jalali,
        occurredAt: jalaliToDate(jalali ?? "") ?? before.occurredAt,
        ...("notes" in input ? { notes: toNullableString(input.notes) } : {}),
      },
      ...inventoryDetail,
    });

    if (before.affectsAvailable) {
      await moveLevel(tx, before.productId, before.variantId, signed - Number(before.signedQuantity));
    }

    return { before, after } as unknown as { before: Record<string, unknown>; after: Record<string, unknown> };
  });

  if (typeof outcome !== "string") {
    await logAction(
      {
        action: "UPDATE",
        module: "تاریخچه انبار",
        entityId: id,
        description: `اصلاح دستی ردیف تاریخچه انبار: ${describeMovement(outcome.after)}`,
        beforeState: outcome.before,
        afterState: outcome.after,
      },
      user,
      todayJalali,
    );
  }
  return outcome;
}

/** A ledger row in one sentence, for the audit description. */
function describeMovement(row: Record<string, unknown>): string {
  const product = row.product as { displayName?: string } | null;
  const variant = row.variant as { sku?: string } | null;
  const name = product?.displayName ?? "کالای حذف شده";
  const sku = variant?.sku ? ` / ${variant.sku}` : "";
  const direction = row.type === "OUT" ? "خروج" : "ورود";
  return `${name}${sku} — ${direction} ${String(row.quantity)} در تاریخ ${String(row.occurredAtJalali ?? "")}`;
}

/** Removes one ledger row, taking back whatever level it had moved. */
export async function deleteInventoryTransaction(
  id: string,
  user: AuthUser,
  todayJalali: string,
): Promise<"forbidden" | "not-found" | { before: Record<string, unknown> }> {
  if (!user.isSystemAdmin) return "forbidden";
  const db = getDb();

  const outcome = await db.$transaction(async (tx) => {
    const before = await tx.inventoryTransaction.findUnique({ where: { id }, ...inventoryDetail });
    if (!before) return "not-found" as const;

    await tx.inventoryTransaction.delete({ where: { id } });

    if (before.affectsAvailable) {
      await moveLevel(tx, before.productId, before.variantId, -Number(before.signedQuantity));
    }

    return { before } as unknown as { before: Record<string, unknown> };
  });

  if (typeof outcome !== "string") {
    await logAction(
      {
        action: "DELETE",
        module: "تاریخچه انبار",
        entityId: id,
        description: `حذف ردیف تاریخچه انبار: ${describeMovement(outcome.before)}`,
        beforeState: outcome.before,
      },
      user,
      todayJalali,
    );
  }
  return outcome;
}

/* --------------------------------- writes --------------------------------- */

export interface ProductVariantInput {
  id?: string | null;
  sku?: string;
  attributes?: unknown;
  stockLevel?: unknown;
  minStockLevel?: unknown;
  priceRial?: unknown;
  priceForeign?: unknown;
  currencyForeign?: string | null;
  priceCalc?: unknown;
}

export interface ProductInput {
  code?: string;
  name?: string;
  displayName?: string;
  category?: string | null;
  brand?: string | null;
  modelNumber?: string | null;
  unit?: string | null;
  description?: string | null;
  supplyType?: string;
  hasVariants?: boolean;
  stockLevel?: unknown;
  minStockLevel?: unknown;
  basePriceRial?: unknown;
  priceForeign?: unknown;
  currencyForeign?: string | null;
  features?: unknown;
  configRules?: unknown;
  images?: unknown;
  priceCalc?: unknown;
  customValues?: unknown;
  variants?: ProductVariantInput[];
}

function scalarData(input: ProductInput): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const set = (key: string, value: unknown) => { if (value !== undefined) out[key] = value; };

  if ("code" in input) set("code", toNullableString(input.code, 60));
  if ("name" in input) set("name", toNullableString(input.name, 300));
  if ("displayName" in input) set("displayName", toNullableString(input.displayName, 300));
  if ("category" in input) set("category", toNullableString(input.category, 150));
  if ("brand" in input) set("brand", toNullableString(input.brand, 150));
  if ("modelNumber" in input) set("modelNumber", toNullableString(input.modelNumber, 150));
  if ("unit" in input) set("unit", toNullableString(input.unit, 50));
  if ("description" in input) set("description", toNullableString(input.description));
  if ("supplyType" in input) set("supplyType", toNullableString(input.supplyType, 20) ?? "INVENTORY");
  if ("hasVariants" in input) set("hasVariants", !!input.hasVariants);
  if ("minStockLevel" in input) set("minStockLevel", toNumber(input.minStockLevel, 0));
  if ("basePriceRial" in input) {
    set("basePriceRial", input.basePriceRial == null || input.basePriceRial === ""
      ? null : toNumber(input.basePriceRial));
  }
  if ("priceForeign" in input) {
    set("priceForeign", input.priceForeign == null || input.priceForeign === ""
      ? null : toNumber(input.priceForeign));
  }
  if ("currencyForeign" in input) set("currencyForeign", toNullableString(input.currencyForeign, 20));
  if ("features" in input) set("features", toJsonColumn(input.features));
  if ("configRules" in input) set("configRules", toJsonColumn(input.configRules));
  if ("images" in input) set("images", toJsonColumn(input.images));
  if ("priceCalc" in input) set("priceCalc", toJsonColumn(input.priceCalc));
  if ("customValues" in input) set("customValues", toJsonColumn(input.customValues));

  // Note: stockLevel is deliberately absent. It moves only through
  // applyStockDelta, so that every change leaves a ledger entry.
  return out;
}

function variantScalarData(row: ProductVariantInput): Record<string, unknown> {
  return {
    sku: toNullableString(row.sku, 120),
    attributes: toJsonColumn(row.attributes),
    minStockLevel: toNumber(row.minStockLevel, 0),
    priceRial: row.priceRial == null || row.priceRial === "" ? null : toNumber(row.priceRial),
    priceForeign: row.priceForeign == null || row.priceForeign === "" ? null : toNumber(row.priceForeign),
    currencyForeign: toNullableString(row.currencyForeign, 20),
    priceCalc: toJsonColumn(row.priceCalc),
  };
}

/**
 * Reconciles the variant list by identity, and records every resulting stock
 * change.
 *
 * Matching is by id first, then by SKU — the SKU is what the user actually
 * edits, and a client that regenerated the list without ids would otherwise
 * duplicate every SKU.
 *
 * A variant missing from the incoming list is removed only when it is safe:
 *
 *  - **On a business document** (proforma or purchase-order line) → kept. The
 *    document's history would otherwise lose what was actually quoted or bought.
 *  - **Holding stock** → kept. Removing it would silently write off physical
 *    inventory, which no edit to a configuration list should ever do.
 *  - Otherwise removed, together with its ledger rows. Those necessarily net to
 *    zero (the stored level always equals the ledger sum), so they record only
 *    that a SKU was created and emptied — nothing that survives the SKU itself.
 *
 * Deleting the rows is required, not incidental: `inventoryTransaction.variantId`
 * is `onDelete: NoAction`, so the variant delete would fail on the foreign key.
 * Every SKU gets an opening movement, so "has ledger rows" would have meant no
 * SKU could ever be removed.
 */
async function reconcileVariants(
  tx: Prisma.TransactionClient,
  productId: string,
  rows: ProductVariantInput[],
  todayJalali: string,
): Promise<{ created: number; updated: number; removed: number; kept: number }> {
  const existing = await tx.productVariant.findMany({
    where: { productId },
    select: { id: true, sku: true, stockLevel: true },
  });

  const byId = new Map(existing.map((v) => [v.id, v]));
  const bySku = new Map(existing.map((v) => [v.sku, v]));
  const seen = new Set<string>();
  let created = 0, updated = 0;

  for (const row of rows ?? []) {
    const sku = toNullableString(row.sku, 120);
    if (!sku) continue; // a blank row in the grid

    const match = (row.id ? byId.get(row.id) : undefined) ?? bySku.get(sku);
    const wantedStock = toNumber(row.stockLevel, 0);

    if (match) {
      seen.add(match.id);
      await tx.productVariant.update({ where: { id: match.id }, data: variantScalarData(row) });
      updated++;

      // The form shows stock as an editable number, so a difference here is a
      // stock movement the user just made and it has to be recorded as one.
      const delta = wantedStock - Number(match.stockLevel);
      if (delta !== 0) {
        await applyStockDelta(tx, {
          productId, variantId: match.id, delta,
          referenceType: "EDIT", notes: `اصلاح موجودی از فرم کالا (${sku})`,
          occurredAtJalali: todayJalali,
        });
      }
    } else {
      const fresh = await tx.productVariant.create({
        data: { productId, ...variantScalarData(row), sku } as Prisma.ProductVariantUncheckedCreateInput,
      });
      seen.add(fresh.id);
      created++;

      // Opening stock is a receipt, not a starting value with no origin.
      if (wantedStock !== 0) {
        await applyStockDelta(tx, {
          productId, variantId: fresh.id, delta: wantedStock,
          referenceType: "OPENING", notes: `موجودی اولیه (${sku})`,
          occurredAtJalali: todayJalali,
        });
      }
    }
  }

  let removed = 0, kept = 0;
  for (const v of existing) {
    if (seen.has(v.id)) continue;

    // Current stock is read fresh: a movement earlier in this same call may have
    // changed it since `existing` was loaded.
    const current = await tx.productVariant.findUnique({
      where: { id: v.id }, select: { stockLevel: true },
    });
    if (current && Number(current.stockLevel) !== 0) { kept++; continue; }

    const onDocuments = await tx.proformaItem.count({ where: { variantId: v.id } })
      + await tx.purchaseOrderItem.count({ where: { variantId: v.id } });
    if (onDocuments > 0) { kept++; continue; }

    await tx.inventoryTransaction.deleteMany({ where: { variantId: v.id } });
    await tx.productVariant.delete({ where: { id: v.id } });
    removed++;
  }

  if (removed > 0) {
    // The parent total is the sum of its SKUs, and it just lost some.
    const agg = await tx.productVariant.aggregate({
      where: { productId }, _sum: { stockLevel: true },
    });
    await tx.product.update({ where: { id: productId }, data: { stockLevel: agg._sum.stockLevel ?? 0 } });
  }

  return { created, updated, removed, kept };
}

export async function createProduct(
  input: ProductInput,
  user: AuthUser,
  todayJalali: string,
) {
  if (!requireProductPermission(user)) return null;
  const db = getDb();

  // A user who may not see the price calculator may still add a product; the
  // calculator is simply not theirs to fill in.
  input = stripProductCostInput(input, user);

  const product = await db.$transaction(async (tx) => {
    const product = await tx.product.create({
      data: {
        ...scalarData(input),
        // Starts at zero; opening stock is applied below as a real movement.
        stockLevel: 0,
      } as Prisma.ProductUncheckedCreateInput,
    });

    if (input.hasVariants) {
      await reconcileVariants(tx, product.id, input.variants ?? [], todayJalali);
    } else {
      const opening = toNumber(input.stockLevel, 0);
      if (opening !== 0) {
        await applyStockDelta(tx, {
          productId: product.id, delta: opening,
          referenceType: "OPENING", notes: "موجودی اولیه",
          occurredAtJalali: todayJalali,
        });
      }
    }

    return tx.product.findUnique({ where: { id: product.id }, include: { variants: true } });
  });

  if (product) {
    // Audit log
    await logAction(
      {
        action: "CREATE",
        module: "کالاها",
        entityId: product.id,
        description: `ایجاد کالای جدید: ${product.name} (کد: ${product.code})`,
        afterState: product,
      },
      user,
      todayJalali,
    );

    // Notification
    await notifyModuleResponsible(
      "products",
      "ثبت کالای جدید",
      `کالای جدید ثبت شد: ${product.name} (کد: ${product.code})`,
      user,
      null,
    );

    // Workflow rules
    await processWorkflowRules(
      "product_created",
      {
        productId: product.id,
        productName: product.name,
        productCode: product.code,
        category: product.category,
        brand: product.brand,
        stockLevel: product.stockLevel,
      },
      user,
    );
  }

  // The audit snapshot above keeps the whole record on purpose — the log is
  // read through the settings permission, not this one. Only the reply is cut.
  return redactProduct(product, user);
}

export async function updateProduct(
  id: string,
  input: ProductInput,
  user: AuthUser,
  todayJalali: string,
) {
  if (!requireProductPermission(user)) return null;
  const db = getDb();

  const result = await db.$transaction(async (tx) => {
    const before = await tx.product.findUnique({
      where: { id },
      select: { id: true, hasVariants: true, stockLevel: true, name: true, code: true },
    });
    if (!before) return null;

    // Their form was served with the calculator blanked, so what comes back
    // carries nulls where the costs were. Dropping the product's own field
    // leaves it unchanged; the variants need their stored values handed back,
    // because a variant is written whole and a null would be written too.
    if (!canSeeCosts(user)) {
      const stored = await tx.productVariant.findMany({
        where: { productId: id },
        select: { id: true, priceCalc: true },
      });
      input = stripProductCostInput(input, user, stored);
    }

    await tx.product.update({ where: { id }, data: scalarData(input) as Prisma.ProductUncheckedUpdateInput });

    const hasVariants = input.hasVariants ?? before.hasVariants;

    if (input.variants !== undefined && hasVariants) {
      await reconcileVariants(tx, id, input.variants, todayJalali);
    } else if (!hasVariants && input.stockLevel !== undefined) {
      // Same rule as variants: an edited number is a movement, and it is logged.
      const delta = toNumber(input.stockLevel, 0) - Number(before.stockLevel);
      if (delta !== 0) {
        await applyStockDelta(tx, {
          productId: id, delta,
          referenceType: "EDIT", notes: "اصلاح موجودی از فرم کالا",
          occurredAtJalali: todayJalali,
        });
      }
    }

    return tx.product.findUnique({ where: { id }, include: { variants: true } });
  });

  if (result) {
    // Audit log
    await logAction(
      {
        action: "UPDATE",
        module: "کالاها",
        entityId: id,
        description: `ویرایش اطلاعات کالا: ${result.name} (کد: ${result.code})`,
        afterState: result,
      },
      user,
      todayJalali,
    );

    // Workflow rules for low stock
    if (result.stockLevel <= result.minStockLevel) {
      await processWorkflowRules(
        "product_low_stock",
        {
          productId: result.id,
          productName: result.name,
          productCode: result.code,
          stockLevel: result.stockLevel,
          minStockLevel: result.minStockLevel,
        },
        user,
      );
    }
  }

  return redactProduct(result, user);
}

export async function countProductReferences(id: string) {
  const db = getDb();
  const [proformaItems, purchaseOrderItems, projectItems, movements] = await Promise.all([
    db.proformaItem.count({ where: { productId: id } }),
    db.purchaseOrderItem.count({ where: { productId: id } }),
    db.projectItem.count({ where: { productId: id } }),
    db.inventoryTransaction.count({ where: { productId: id } }),
  ]);
  return {
    proformaItems, purchaseOrderItems, projectItems, movements,
    // Movements alone do not block a delete: they cascade with the product, and
    // a product that only ever had an opening balance is safe to remove.
    total: proformaItems + purchaseOrderItems + projectItems,
  };
}

export async function deleteProduct(
  id: string,
  user: AuthUser,
  todayJalali: string,
): Promise<"ok" | "forbidden" | "in-use" | "not-found"> {
  if (!requireProductPermission(user)) return "forbidden";
  const db = getDb();

  const existing = await db.product.findUnique({
    where: { id },
    select: { id: true, name: true, code: true }
  });
  if (!existing) return "not-found";

  const refs = await countProductReferences(id);
  if (refs.total > 0) return "in-use";

  await db.product.delete({ where: { id } });

  // Audit log
  await logAction(
    {
      action: "DELETE",
      module: "کالاها",
      entityId: id,
      description: `حذف کالا: ${existing.name} (کد: ${existing.code})`,
      beforeState: existing,
    },
    user,
    todayJalali,
  );

  return "ok";
}

/**
 * Copies a product, including its variant definitions but not their stock.
 *
 * Stock belongs to the physical item, not the definition — a copy starts empty,
 * and any opening balance is then a movement someone records deliberately.
 */
/**
 * The first free `{base}-C{n}` code.
 *
 * The client used to find this by scanning every product it had loaded, which
 * pagination reduces to "every product on this page" — so a copy would keep
 * proposing a code that already exists further down the table. The uniqueness
 * question belongs where the unique index is.
 */
export async function suggestCopyCode(baseCode: string): Promise<string> {
  const db = getDb();
  // One query for the whole family, rather than one probe per candidate.
  const taken = new Set(
    (await db.product.findMany({
      where: { code: { startsWith: `${baseCode}-C` } },
      select: { code: true },
    })).map((row) => row.code),
  );

  let n = 1;
  while (taken.has(`${baseCode}-C${n}`)) n++;
  return `${baseCode}-C${n}`;
}

export async function copyProduct(
  id: string,
  overrides: { code?: string; name?: string; displayName?: string },
  user: AuthUser,
) {
  if (!requireProductPermission(user)) return null;
  const db = getDb();

  return db.$transaction(async (tx) => {
    const source = await tx.product.findUnique({ where: { id }, include: { variants: true } });
    if (!source) return null;

    // No code given: derive the next free one from the source's.
    const code = overrides.code || await suggestCopyCode(source.code);

    const { id: _id, createdAt: _c, updatedAt: _u, variants, ...rest } = source;

    const copy = await tx.product.create({
      data: {
        ...rest,
        code,
        name: overrides.name ?? source.name,
        displayName: overrides.displayName ?? source.displayName,
        stockLevel: 0,
      } as Prisma.ProductUncheckedCreateInput,
    });

    for (const v of variants) {
      await tx.productVariant.create({
        data: {
          productId: copy.id,
          // The SKU embeds the product code, so it has to be re-derived from the
          // new one; a duplicate would hit the unique index.
          sku: v.sku.replace(source.code, code),
          attributes: v.attributes,
          minStockLevel: v.minStockLevel,
          priceRial: v.priceRial,
          priceForeign: v.priceForeign,
          currencyForeign: v.currencyForeign,
          priceCalc: v.priceCalc,
          stockLevel: 0,
        },
      });
    }

    const created = await tx.product.findUnique({
      where: { id: copy.id }, include: { variants: true },
    });
    // The copy keeps the source's calculator in the database — copying a
    // product is not editing its costs — but this user still may not read it.
    return redactProduct(created, user);
  });
}


/* ========================= the product taxonomy ========================== */

export interface CategoryUsage {
  category: string;
  products: number;
  /** False for a category products carry that the dropdown list does not have. */
  known: boolean;
}

/**
 * Every category products are actually filed under, beside the list.
 *
 * The two are not the same set, which is the whole point of showing them
 * together: the Excel import wrote categories the form could never have
 * offered, and until they are counted nobody can see that «Flow» and «فلو» are
 * two piles of the same equipment.
 */
export async function listCategoryUsage(user: AuthUser): Promise<CategoryUsage[] | "forbidden"> {
  if (!hasPermission(user, "products")) return "forbidden";

  const [rows, settings] = await Promise.all([
    getDb().product.groupBy({ by: ["category"], _count: { _all: true } }),
    loadSettings(),
  ]);
  const known = settings?.dropdownItems?.categories ?? [];

  const used = rows
    .map((r) => ({
      category: r.category ?? "",
      products: r._count._all,
      known: matchKnownCategory(r.category, known) !== null,
    }))
    .filter((r) => r.category);

  // A list entry nothing is filed under is still a category somebody may pick,
  // so it belongs in the picker the merge screen draws.
  for (const entry of known) {
    if (!used.some((u) => categoryKey(u.category) === categoryKey(entry))) {
      used.push({ category: entry, products: 0, known: true });
    }
  }

  return used.sort((a, b) => b.products - a.products || a.category.localeCompare(b.category));
}

export interface MergeOutcome {
  from: string;
  to: string;
  /** Products moved. */
  moved: number;
  /** True when the source was also removed from the dropdown list. */
  listEntryRemoved: boolean;
}

/**
 * Files every product under one category onto another.
 *
 * The repair for a taxonomy that split. It is a real write over the products
 * table rather than a display-time alias, because the category is what every
 * report groups by — an alias would have to be applied in the dashboard, the
 * grid, the filter, the Excel export and the Power BI flattener, and the first
 * one anybody forgot would show the old split again.
 *
 * The move and the list edit are one transaction: leaving the source in the
 * dropdown after its products have gone would let somebody pick it again the
 * same afternoon and recreate exactly what was just merged.
 */
export async function mergeCategory(
  from: string,
  to: string,
  user: AuthUser,
  todayJalali: string,
): Promise<"forbidden" | { error: string } | MergeOutcome> {
  // The taxonomy is edited in Settings, so changing it needs that permission —
  // not `products`, which every warehouse account has.
  if (!hasPermission(user, "settings")) return "forbidden";

  const settings = await loadSettings();
  const known = settings?.dropdownItems?.categories ?? [];

  const refusal = mergeRefusalReason(from, to, known);
  if (refusal) return { error: refusal };

  // The target is stored in the list's own spelling, never the caller's.
  const target = matchKnownCategory(to, known)!;

  const db = getDb();
  let moved = 0;
  let listEntryRemoved = false;

  await db.$transaction(async (tx) => {
    const result = await tx.product.updateMany({
      where: { category: from },
      data: { category: target },
    });
    moved = result.count;

    const remaining = known.filter((entry) => categoryKey(entry) !== categoryKey(from));
    if (remaining.length !== known.length && remaining.length > 0) {
      const next = {
        ...(settings ?? {}),
        dropdownItems: { ...(settings?.dropdownItems ?? {}), categories: remaining },
      };
      await tx.appSetting.upsert({
        where: { id: "singleton" },
        create: { id: "singleton", data: JSON.stringify(next) },
        update: { data: JSON.stringify(next) },
      });
      listEntryRemoved = true;
    }
  });

  if (listEntryRemoved) invalidateSettingsCache();

  await logAction(
    {
      action: "UPDATE",
      module: "محصولات",
      entityId: `category-merge`,
      description: `ادغام دسته‌بندی «${from}» در «${target}» — ${moved} محصول منتقل شد`,
      afterState: { from, to: target, moved, listEntryRemoved },
    },
    user,
    todayJalali,
  );

  return { from, to: target, moved, listEntryRemoved };
}
