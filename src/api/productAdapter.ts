import type { Product, ProductVariant } from "../types";
import type { ProductDetail, ProductRow, ProductWriteInput, ProductVariantRow } from "./products";

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
  return {
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
    description: "",
    variants: row.variants.map((v) => ({
      id: v.id,
      sku: v.sku,
      attributes: parseJson<Record<string, string>>(v.attributes, {}),
      stockLevel: num(v.stockLevel),
    } as ProductVariant)),
  } as Product;
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
  } as unknown as ProductVariant;
}

/** The full record, for the detail and edit views. */
export function detailToProduct(detail: ProductDetail): Product {
  return {
    ...rowToProduct(detail),
    description: detail.description ?? "",
    features: parseJson(detail.features, [] as Product["features"]),
    configRules: parseJson(detail.configRules, [] as Product["configRules"]),
    images: parseJson(detail.images, [] as string[]),
    customValues: parseJson(detail.customValues, {} as Record<string, unknown>),
    variants: detail.variants.map(variantToClient),
    // The price calculator's inputs are stored together as one blob and spread
    // back onto the record, which is where the form reads them from.
    ...parseJson<Record<string, unknown>>(detail.priceCalc, {}),
  } as Product;
}

/** The price-calculator fields, which travel together as one JSON column. */
const PRICE_CALC_KEYS = [
  "calcPriceForeign", "calcExchangeRate", "calcRemittanceFee", "calcRemittancePct",
  "calcShippingCost", "calcCustomsDutyRIYAL", "calcOtherCostsForeign",
  "calcOtherCostsRIYAL", "calcProfitPct",
] as const;

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
