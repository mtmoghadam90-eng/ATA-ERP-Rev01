import { ListResponse, api } from "./client";

/**
 * Product and inventory endpoints.
 *
 * Stock is never set directly — it moves by a signed delta, and every movement
 * writes a ledger entry alongside the new level. That is why there is no
 * `stockLevel` on the update input: a screen that could assign a level could
 * lose the history of how it got there.
 */

export interface ProductVariantRow {
  id: string;
  sku: string;
  attributes: string | null;
  stockLevel: string;
  minStockLevel: string;
  priceRial: string | null;
  priceForeign: string | null;
  currencyForeign: string | null;
  priceCalc: string | null;
}

export interface ProductRow {
  id: string;
  code: string;
  name: string;
  displayName: string;
  category: string | null;
  brand: string | null;
  modelNumber: string | null;
  unit: string | null;
  supplyType: string;
  hasVariants: boolean;
  stockLevel: string;
  minStockLevel: string;
  basePriceRial: string | null;
  priceForeign: string | null;
  currencyForeign: string | null;
  images: string | null;
  features: string | null;
  createdAt: string;
  variants: Array<{ id: string; sku: string; attributes: string; stockLevel: string }>;
  _count: { variants: number };
}

export interface ProductDetail extends ProductRow {
  description: string | null;
  features: string | null;
  configRules: string | null;
  images: string | null;
  priceCalc: string | null;
  customValues: string | null;
  updatedAt: string;
  variants: ProductVariantRow[];
}

export interface ProductReferences {
  proformaItems: number;
  purchaseOrderItems: number;
  projectItems: number;
  movements: number;
  total: number;
}

export interface InventoryMovementRow {
  id: string;
  productId: string;
  variantId: string | null;
  occurredAt: string;
  occurredAtJalali: string | null;
  type: "IN" | "OUT";
  quantity: string;
  signedQuantity: string;
  referenceType: string | null;
  referenceId: string | null;
  notes: string | null;
  createdAt: string;
  product: { id: string; code: string; displayName: string } | null;
  variant: { id: string; sku: string } | null;
}

export interface ProductWriteInput {
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
  /** Only honoured on create, as an opening balance; it becomes a movement. */
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
  variants?: Record<string, unknown>[];
}

export const productsApi = {
  list: (query: Record<string, string | number | undefined>, signal?: AbortSignal) =>
    api.get<ListResponse<ProductRow>>("/api/products", query, signal),

  get: (id: string) =>
    api.get<{ product: ProductDetail }>(`/api/products/${id}`).then((r) => r.product),

  references: (id: string) =>
    api.get<{ references: ProductReferences }>(`/api/products/${id}/references`)
      .then((r) => r.references),

  /** Products at or below their reorder point — a two-column comparison in SQL. */
  lowStock: (limit = 100) =>
    api.get<{ rows: { id: string; code: string; displayName: string; stockLevel: number; minStockLevel: number }[] }>(
      "/api/products/low-stock", { limit }).then((r) => r.rows),

  create: (input: ProductWriteInput) =>
    api.post<{ product: ProductDetail }>("/api/products", input).then((r) => r.product),

  update: (id: string, input: ProductWriteInput) =>
    api.put<{ product: ProductDetail }>(`/api/products/${id}`, input).then((r) => r.product),

  /**
   * Moves stock by a signed delta.
   *
   * Never a new level: two people adjusting at once would otherwise overwrite
   * each other, where deltas simply add up.
   */
  adjustStock: (
    id: string,
    body: { delta: number; variantId?: string | null; notes?: string | null; occurredAt?: string },
  ) => api.post<{ product: ProductDetail }>(`/api/products/${id}/stock`, body).then((r) => r.product),

  /**
   * Copies a product's definition, not its stock.
   *
   * Omitting `code` lets the server derive the next free `{code}-C{n}` — the
   * uniqueness question belongs where the unique index is, not in a scan of
   * whatever the browser happens to have loaded.
   */
  copy: (id: string, body: { code?: string; name?: string; displayName?: string } = {}) =>
    api.post<{ product: ProductDetail }>(`/api/products/${id}/copy`, body).then((r) => r.product),

  remove: (id: string) => api.delete<Record<string, never>>(`/api/products/${id}`),

  /** The stock ledger, optionally scoped to one product or one SKU. */
  movements: (query: Record<string, string | number | undefined>, signal?: AbortSignal) =>
    api.get<ListResponse<InventoryMovementRow>>("/api/inventory-transactions", query, signal),

  /** Every match, for export only. Several round trips at the server's 200 cap. */
  listAll: async (
    query: Record<string, string | number | undefined>,
    options: { limit?: number; onProgress?: (loaded: number, total: number) => void } = {},
  ): Promise<ProductRow[]> => {
    const { limit = 20_000, onProgress } = options;
    const rows: ProductRow[] = [];
    let page = 1;

    for (;;) {
      const batch = await api.get<ListResponse<ProductRow>>("/api/products", {
        ...query, page, pageSize: 200,
      });
      rows.push(...batch.rows);
      onProgress?.(rows.length, batch.total);

      if (rows.length >= Math.min(batch.total, limit)) break;
      if (batch.rows.length === 0 || page >= batch.totalPages) break;
      page++;
    }
    return rows.slice(0, limit);
  },
};
