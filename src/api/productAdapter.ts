import type { Product, ProductVariant } from "../types";
import type { ProductDetail, ProductRow, ProductWriteInput, ProductVariantRow } from "./products";
import { assertComplete, markComplete, markPartial } from "./partial";
import { parseProductDocuments } from "../utils/productDocuments";

/**
 * Translation between the products API and the `Product` shape the view was
 * written against — the same temporary seam as the other adapters.
 *
 * The differences: money and stock arrive as decimal strings, and the several
 * configuration blobs (features, config rules, images, the price calculator's
 * inputs) are JSON columns rather than nested objects.
 */

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return (parsed ?? fallback) as T;
  } catch {
    // One malformed record must not take out the catalogue.
    return fallback;
  }
}

const num = (value: string | null | undefined): number => Number(value ?? 0);

/** A catalogue row, in the shape the existing table markup expects. */
export function rowToProduct(row: ProductRow): Product {
  return markPartial({
    id: row.id,
    code: row.code,
    name: row.name,
    displayName: row.displayName,
    category: row.category ?? "",
    brand: row.brand ?? "",
    modelNumber: row.modelNumber ?? "",
    unit: row.unit ?? "",
    supplyType: (row.supplyType ?? "INVENTORY") as Product["supplyType"],
    hasVariants: row.hasVariants,
    stockLevel: num(row.stockLevel),
    minStockLevel: num(row.minStockLevel),
    basePriceRIYAL: num(row.basePriceRial),
    priceForeign: row.priceForeign ? num(row.priceForeign) : undefined,
    currencyForeign: row.currencyForeign ?? undefined,
    images: parseJson(row.images, [] as string[]),
    features: parseJson(row.features, [] as Product["features"]),
    // The grid draws a custom-fields column from these.
    customValues: parseJson(row.customValues, {} as Record<string, unknown>),
    description: row.description ?? "",
    variants: (row.variants || []).map((v) => ({
      id: v.id,
      sku: v.sku,
      attributes: parseJson<Record<string, string>>(v.attributes, {}),
      stockLevel: num(v.stockLevel),
    } as ProductVariant)),
  } as Product);
}

/**
 * The last real purchase, on a product or a SKU.
 *
 * Arrives blanked for a user without the `costs` permission, so every field is
 * read defensively; a null here means "not shown to you" just as often as it
 * means "never bought".
 */
function lastPurchaseOf(row: {
  lastPurchaseCostRial: string | null;
  lastPurchaseQuantity: string | null;
  lastPurchaseDateJalali: string | null;
  lastPurchaseOrderNumber: string | null;
}) {
  return {
    lastPurchaseCostRial: row.lastPurchaseCostRial === null ? null : num(row.lastPurchaseCostRial),
    lastPurchaseQuantity: row.lastPurchaseQuantity === null ? null : num(row.lastPurchaseQuantity),
    lastPurchaseDate: row.lastPurchaseDateJalali,
    lastPurchaseOrderNumber: row.lastPurchaseOrderNumber,
  };
}

function variantToClient(v: ProductVariantRow): ProductVariant {
  return {
    id: v.id,
    sku: v.sku,
    attributes: parseJson<Record<string, string>>(v.attributes, {}),
    stockLevel: num(v.stockLevel),
    minStockLevel: num(v.minStockLevel),
    priceRIYAL: v.priceRial ? num(v.priceRial) : undefined,
    priceForeign: v.priceForeign ? num(v.priceForeign) : undefined,
    currencyForeign: v.currencyForeign ?? undefined,
    ...parseJson<Record<string, unknown>>(v.priceCalc, {}),
    ...lastPurchaseOf(v),
  } as unknown as ProductVariant;
}

/** The full record, for the detail and edit views. */
export function detailToProduct(detail: ProductDetail): Product {
  return markComplete({
    ...rowToProduct(detail),
    description: detail.description ?? "",
    features: parseJson(detail.features, [] as Product["features"]),
    configRules: parseJson(detail.configRules, [] as Product["configRules"]),
    images: parseJson(detail.images, [] as string[]),
    /*
      Read through the same pure rule the server writes with, so a row stored
      before the kinds existed — or one hand-edited in the database — cannot put
      an entry with no URL or an unknown kind onto the screen.
    */
    documents: parseProductDocuments(detail.documents),
    ...lastPurchaseOf(detail),
    variants: (detail.variants ?? []).map(variantToClient),
    // The price calculator's inputs are stored together as one blob and spread
    // back onto the record, which is where the form reads them from.
    ...parseJson<Record<string, unknown>>(detail.priceCalc, {}),
  } as Product);
}

/**
 * The price-calculator fields, which travel together as one JSON column.
 *
 * This list is the whole contract: a field missing from it is dropped on save
 * and comes back undefined. `calcProfitRIYAL` and `calcMarginType` were missing,
 * which is worse than losing two inputs — the modal defaults an absent
 * `calcMarginType` to "PERCENT", so a product priced on a fixed profit amount
 * silently became a percentage-margin product the next time it was opened, and
 * the proforma lines built from it quoted a different price.
 *
 * Keep it in step with the `calc…` fields on `Product` and `ProductVariant` in
 * types.ts; nothing type-checks the two against each other.
 */
const PRICE_CALC_KEYS = [
  "calcPriceForeign", "calcExchangeRate", "calcRemittanceFee", "calcRemittancePct",
  "calcShippingCost", "calcCustomsDutyRIYAL", "calcOtherCostsForeign",
  "calcOtherCostsRIYAL", "calcProfitPct", "calcProfitRIYAL", "calcMarginType",
  "calcMode", "calcManualLandedForeign", "calcManualSellingForeign",
] as const;

/**
 * Fails the build if a `calc…` field is added to `Product` and not listed above.
 *
 * The list is the only thing that decides what gets persisted, and nothing else
 * relates it to the type — which is how two fields stayed declared but unsaved.
 * `AssertNever` resolves only when nothing is unlisted, so the drift now shows
 * up as a type error naming the missing field.
 */
type UnlistedCalcKey = Exclude<
  Extract<keyof Product, `calc${string}`>,
  (typeof PRICE_CALC_KEYS)[number]
>;
type AssertNever<T extends never> = T;
export type _EveryCalcFieldIsPersisted = AssertNever<UnlistedCalcKey>;

/**
 * The calculator's own inputs, read off a product or a SKU.
 *
 * The price-calculator modal seeds itself from this. It goes through the same
 * `PRICE_CALC_KEYS` list that decides what gets *saved*, so a new calculator
 * field cannot end up persisted but never seeded back — which is how a screen
 * comes to show a manual price as a computed one the second time it is opened.
 */
export function calcSeedOf(
  source: Partial<Product> | Partial<ProductVariant> | null | undefined,
): Partial<ProductVariant> {
  const out: Record<string, unknown> = {};
  for (const key of PRICE_CALC_KEYS) {
    const value = (source as Record<string, unknown> | null | undefined)?.[key];
    if (value !== undefined && value !== null && value !== "") out[key] = value;
  }
  return out as Partial<ProductVariant>;
}

function priceCalcOf(product: Partial<Product>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of PRICE_CALC_KEYS) {
    const value = (product as Record<string, unknown>)[key];
    if (value !== undefined && value !== null && value !== "") out[key] = value;
  }
  return out;
}

/**
 * A form's state, as the write endpoint wants it.
 *
 * `stockLevel` is sent only on create, as an opening balance. On an edit the
 * server treats a difference as a movement and records it, so the field is
 * carried through rather than suppressed — but the level is never simply
 * assigned.
 */
export function productToWriteInput(product: Partial<Product>): ProductWriteInput {
  assertComplete(product, "کالا");
  return {
    code: product.code,
    name: product.name,
    displayName: product.displayName || product.name,
    category: product.category ?? null,
    brand: product.brand ?? null,
    modelNumber: product.modelNumber ?? null,
    unit: product.unit ?? null,
    description: product.description ?? null,
    supplyType: product.supplyType,
    hasVariants: product.hasVariants,
    stockLevel: product.stockLevel,
    minStockLevel: product.minStockLevel,
    basePriceRial: product.basePriceRIYAL,
    priceForeign: product.priceForeign,
    currencyForeign: product.currencyForeign ?? null,
    features: product.features,
    configRules: product.configRules,
    images: product.images,
    documents: product.documents,
    priceCalc: priceCalcOf(product),
    customValues: product.customValues,
    variants: (product.variants ?? []).map((v) => {
      const variant = v as unknown as Record<string, unknown>;
      return {
        id: v.id,
        sku: v.sku,
        attributes: variant.attributes,
        stockLevel: v.stockLevel,
        minStockLevel: v.minStockLevel,
        priceRial: variant.priceRIYAL,
        priceForeign: variant.priceForeign,
        currencyForeign: variant.currencyForeign ?? null,
        priceCalc: priceCalcOf(variant as Partial<Product>),
      };
    }),
  };
}
