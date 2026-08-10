import { ListResponse, api } from "./client";
import type { PurchaseOrder } from "../types";
import { assertComplete, markComplete, markPartial } from "./partial";

/**
 * Purchase order endpoints.
 *
 * Two things are computed by the server rather than sent: the landed cost —
 * supplier price at the order's own stored exchange rate plus freight, duty and
 * remittance fees — and the stock receipt, which reconciles against the ledger
 * when the order reaches the received status.
 */

export interface PurchaseOrderItemRow {
  id: string;
  lineNo: number;
  productId: string | null;
  variantId: string | null;
  productName: string;
  productCode: string | null;
  brand: string | null;
  tagNumber: string | null;
  quantity: string;
  unitPriceForeign: string;
  totalPriceForeign: string;
  proformaItemId: string | null;
  proformaItemName: string | null;
  supplierNotes: string | null;
}

export interface PurchaseOrderRow {
  id: string;
  poNumber: string;
  status: string;
  currency: string;
  exchangeRate: string;
  supplierId: string;
  projectId: string | null;
  proformaId: string | null;
  orderDate: string | null;
  orderDateJalali: string | null;
  expectedDeliveryDateJalali: string | null;
  receivedDateJalali: string | null;
  totalForeignAmount: string;
  landedCostRial: string;
  landedCostForeign: string;
  createdAt: string;
  supplier: { id: string; name: string } | null;
  project: { id: string; code: string; name: string } | null;
  _count: { items: number };
  /** The grid draws a custom-fields column from these. */
  customValues: string | null;
  /** Joined, so a row can print the proforma it was raised against. */
  proforma: { id: string; proformaNumber: string } | null;
}

export interface PurchaseOrderDetail extends Omit<PurchaseOrderRow, "_count"> {
  paymentDateJalali: string | null;
  goodsReadyDateJalali: string | null;
  shipmentDateJalali: string | null;
  clearanceDateJalali: string | null;
  shippingCostRial: string;
  customsDutyRial: string;
  remittanceFeeRial: string;
  shippingCostForeign: string;
  remittanceFeeForeign: string;
  notes: string | null;
  items: PurchaseOrderItemRow[];
}

export interface PurchaseOrderReferences {
  transactions: number;
  total: number;
}

export interface PurchaseOrderWriteInput {
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
  items?: Record<string, unknown>[];
}

export const purchaseOrdersApi = {
  list: (query: Record<string, string | number | undefined>, signal?: AbortSignal) =>
    api.get<ListResponse<PurchaseOrderRow>>("/api/purchase-orders", query, signal),

  get: (id: string) =>
    api.get<{ purchaseOrder: PurchaseOrderDetail }>(`/api/purchase-orders/${id}`)
      .then((r) => r.purchaseOrder),

  references: (id: string) =>
    api.get<{ references: PurchaseOrderReferences }>(`/api/purchase-orders/${id}/references`)
      .then((r) => r.references),

  create: (input: PurchaseOrderWriteInput) =>
    api.post<{ purchaseOrder: PurchaseOrderDetail }>("/api/purchase-orders", input)
      .then((r) => r.purchaseOrder),

  update: (id: string, input: PurchaseOrderWriteInput) =>
    api.put<{ purchaseOrder: PurchaseOrderDetail }>(`/api/purchase-orders/${id}`, input)
      .then((r) => r.purchaseOrder),

  remove: (id: string) => api.delete<Record<string, never>>(`/api/purchase-orders/${id}`),

  /** Every match, for export only. Several round trips at the server's 200 cap. */
  listAll: async (
    query: Record<string, string | number | undefined>,
    options: { limit?: number } = {},
  ): Promise<PurchaseOrderRow[]> => {
    const { limit = 20_000 } = options;
    const rows: PurchaseOrderRow[] = [];
    let page = 1;

    for (;;) {
      const batch = await api.get<ListResponse<PurchaseOrderRow>>("/api/purchase-orders", {
        ...query, page, pageSize: 200,
      });
      rows.push(...batch.rows);
      if (rows.length >= Math.min(batch.total, limit)) break;
      if (batch.rows.length === 0 || page >= batch.totalPages) break;
      page++;
    }
    return rows.slice(0, limit);
  },
};

/* ------------------------------- adapter ------------------------------- */

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}

const money = (value: string | null | undefined): number => Number(value ?? 0);

/** A row, in the shape the existing markup expects. */
export function rowToPurchaseOrder(row: PurchaseOrderRow): PurchaseOrder {
  return markPartial({
    id: row.id,
    poNumber: row.poNumber,
    status: row.status,
    currency: row.currency,
    exchangeRate: money(row.exchangeRate),
    supplierId: row.supplierId,
    supplierName: row.supplier?.name ?? "",
    projectId: row.projectId ?? undefined,
    projectName: row.project?.name ?? undefined,
    projectCode: row.project?.code ?? undefined,
    proformaId: row.proformaId ?? undefined,
    orderDate: row.orderDateJalali ?? "",
    expectedDeliveryDate: row.expectedDeliveryDateJalali ?? undefined,
    receivedDate: row.receivedDateJalali ?? undefined,
    totalForeignAmount: money(row.totalForeignAmount),
    // Both landed-cost figures are computed by the server. The view has a
    // fallback that re-derives them from the cost inputs, but those only come
    // with the detail record — so a list row must carry the computed values
    // under the names the view reads, or the fallback divides an undefined.
    calculatedLandedCostRIYAL: money(row.landedCostRial),
    calculatedLandedCostForeign: money(row.landedCostForeign),
    // The card prints both of these, and neither reached it: the custom-field
    // column was empty on every order, and «پیش‌فاکتور مرتبط» never appeared.
    customValues: parseJson<Record<string, unknown>>(row.customValues, {}),
    proformaNumber: row.proforma?.proformaNumber,
    createdAt: row.createdAt,
    items: [],
  } as unknown as PurchaseOrder);
}

export function detailToPurchaseOrder(detail: PurchaseOrderDetail): PurchaseOrder {
  return markComplete({
    ...rowToPurchaseOrder({ ...detail, _count: { items: (detail.items ?? []).length } }),
    paymentDate: detail.paymentDateJalali ?? undefined,
    goodsReadyDate: detail.goodsReadyDateJalali ?? undefined,
    shipmentDate: detail.shipmentDateJalali ?? undefined,
    clearanceDate: detail.clearanceDateJalali ?? undefined,
    shippingCostRIYAL: money(detail.shippingCostRial),
    customsDutyRIYAL: money(detail.customsDutyRial),
    remittanceFeeRIYAL: money(detail.remittanceFeeRial),
    shippingCostForeign: money(detail.shippingCostForeign),
    remittanceFeeForeign: money(detail.remittanceFeeForeign),
    notes: detail.notes ?? "",
    items: (detail.items ?? []).map((item) => ({
      id: item.id,
      productId: item.productId ?? "",
      variantId: item.variantId ?? undefined,
      productName: item.productName,
      productCode: item.productCode ?? "",
      brand: item.brand ?? "",
      tagNumber: item.tagNumber ?? undefined,
      quantity: Number(item.quantity),
      /*
       * The names the client type actually declares.
       *
       * These read `unitPriceForeign`/`totalPriceForeign` — the column names —
       * while `PurchaseOrderItem` calls them `…ForeignCurrency`, and the whole
       * screen reads the latter. The `as unknown as PurchaseOrder` cast at the
       * end of this function hid it: every line price in an opened order was
       * undefined and rendered as zero, and the write mapper below read the
       * same wrong name back, so saving stored zeros — and with them a landed
       * cost of zero.
       */
      unitPriceForeignCurrency: money(item.unitPriceForeign),
      totalPriceForeignCurrency: money(item.totalPriceForeign),
      proformaItemId: item.proformaItemId ?? undefined,
      proformaItemName: item.proformaItemName ?? undefined,
      supplierNotes: item.supplierNotes ?? undefined,
    })),
  } as unknown as PurchaseOrder);
}

/**
 * A form's state, as the write endpoint wants it.
 *
 * Landed cost is deliberately absent: the server recomputes it from the lines
 * and the cost inputs, so sending it would only invite the two to disagree.
 */
export function purchaseOrderToWriteInput(po: Partial<PurchaseOrder>): PurchaseOrderWriteInput {
  assertComplete(po, "سفارش خرید");
  const p = po as unknown as Record<string, unknown>;
  return {
    poNumber: po.poNumber,
    supplierId: po.supplierId,
    projectId: po.projectId ?? null,
    proformaId: (p.proformaId as string) ?? null,
    status: po.status,
    currency: po.currency,
    exchangeRate: p.exchangeRate,
    orderDate: (p.orderDate as string) ?? null,
    expectedDeliveryDate: (p.expectedDeliveryDate as string) ?? null,
    paymentDate: (p.paymentDate as string) ?? null,
    goodsReadyDate: (p.goodsReadyDate as string) ?? null,
    shipmentDate: (p.shipmentDate as string) ?? null,
    clearanceDate: (p.clearanceDate as string) ?? null,
    receivedDate: (p.receivedDate as string) ?? null,
    shippingCostRial: p.shippingCostRIYAL,
    customsDutyRial: p.customsDutyRIYAL,
    remittanceFeeRial: p.remittanceFeeRIYAL,
    shippingCostForeign: p.shippingCostForeign,
    remittanceFeeForeign: p.remittanceFeeForeign,
    notes: po.notes ?? null,
    customValues: p.customValues,
    items: ((po.items ?? []) as unknown as Record<string, unknown>[]).map((item) => ({
      // "generic" marks a line typed by hand rather than chosen from the
      // catalogue — the inquiry autofill sets it on every line it builds. It is
      // not a product id, and sending it as one fails the foreign key.
      productId: item.productId && item.productId !== "generic" ? item.productId : null,
      variantId: item.variantId || null,
      productName: item.productName,
      productCode: item.productCode || null,
      brand: item.brand || null,
      tagNumber: item.tagNumber || null,
      quantity: item.quantity,
      unitPriceForeign: item.unitPriceForeignCurrency,
      proformaItemId: item.proformaItemId || null,
      proformaItemName: item.proformaItemName || null,
      supplierNotes: item.supplierNotes || null,
    })),
  };
}
