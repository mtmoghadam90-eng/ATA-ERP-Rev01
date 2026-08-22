import type { Product, ProductVariant } from "../types";
import { detailToProduct, productToWriteInput } from "./productAdapter";
import { productsApi } from "./products";
import { findVariantByAttributes, generateSku, getCombinedFeaturePrice } from "../utils/skuUtils";

/**
 * Changing a catalogue item from a screen that only holds a search row.
 *
 * The rows the pickers hand out are a projection: `variants`, `features`,
 * `configRules` and `images` are hardcoded empty and there are no
 * price-calculator inputs. Writing one back erased all of it and replaced the
 * product's variants with whichever single one was on screen. So the caller
 * says what to change and this loads the real record to change it on.
 *
 * Throws rather than swallowing, so each screen shows its own message.
 */
export async function updateProductById(
  productId: string,
  mutate: (full: Product) => Product,
): Promise<Product> {
  const full = detailToProduct(await productsApi.get(productId));
  const saved = await productsApi.update(productId, productToWriteInput(mutate(full)));
  /*
   * Returned, because ids belong to the database.
   *
   * A variant created here has its id assigned on insert, and a caller that
   * used one it made up would put a reference to nothing on a document line —
   * which is a real foreign key, so the whole document then fails to save with
   * a message about a record that cannot be deleted.
   */
  return detailToProduct(saved);
}

export interface EnsuredVariant {
  /** The catalogue item as stored, reloaded when a SKU had to be created. */
  product: Product;
  /** The SKU's real id, or null when none could be identified or stored. */
  variantId: string | null;
}

/**
 * Finds the SKU for a set of attributes, creating it when the catalogue has
 * none.
 *
 * The single home of "pick a SKU or make one", shared by the proforma form and
 * the supplier-inquiry form. A failure to store is not fatal: the caller's line
 * keeps its specification text and its price and simply carries no SKU link,
 * which is better than refusing the user's work over a catalogue write.
 */
export async function ensureVariantForAttributes(
  product: Product,
  attributes: Record<string, string> | null,
): Promise<EnsuredVariant> {
  if (!attributes) return { product, variantId: null };

  const existing = product.hasVariants && product.variants
    ? findVariantByAttributes(product.variants, attributes)
    : undefined;
  if (existing) return { product, variantId: existing.id };

  const sku = generateSku(product.code || "SKU", product.features || [], attributes);
  const fob = getCombinedFeaturePrice(product.features || [], attributes);
  const variant: ProductVariant = {
    // Provisional only. The id the database assigns is the one that is used.
    id: "",
    sku,
    attributes,
    stockLevel: 0,
    minStockLevel: 0,
    priceForeign: fob > 0 ? fob : undefined,
    // A catalogue item has one currency and every SKU under it follows.
    currencyForeign: product.currencyForeign || "یورو",
  };

  const saved = await updateProductById(product.id, (full) => ({
    ...full,
    hasVariants: true,
    variants: [...(full.variants || []), variant],
  }));
  const stored = saved.variants?.find((v) => v.sku === sku);
  return stored
    ? { product: saved, variantId: stored.id }
    : { product: saved, variantId: null };
}
