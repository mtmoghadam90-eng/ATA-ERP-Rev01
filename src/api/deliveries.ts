import { ListResponse, api } from "./client";
import type { DeliveryChecklistItem, PackagingDelivery, PackingItem } from "../types";

/**
 * Packing list endpoints.
 *
 * The screen's central question — how much of each won item is still unshipped —
 * is answered by `remaining`, not by the client. It used to be derived by
 * scanning every proforma and every delivery the browser held, which a paged
 * list cannot do; getting it wrong means over-shipping, or refusing a shipment
 * that is genuinely owed.
 */

export interface PackingItemRow {
  id: string;
  lineNo: number;
  itemOrDocName: string;
  productId: string | null;
  tagNumber: string | null;
  quantity: string;
  packageType: string | null;
  dimensions: string | null;
  weight: string;
  boxNumber: string | null;
  actualDeliveryDateJalali: string | null;
}

export interface DeliveryRow {
  id: string;
  packingListNumber: string;
  projectId: string;
  proformaId: string | null;
  deliveryDateJalali: string | null;
  actualDeliveryDateJalali: string | null;
  shippingMethod: string | null;
  /** Shown on the card; the rest arrive with the record. */
  waybillNumber: string | null;
  trackingCode: string | null;
  driverName: string | null;
  createdAt: string;
  project: { id: string; code: string; name: string } | null;
  proforma: { id: string; proformaNumber: string } | null;
  _count: { items: number };
  /** Units across the list's lines, summed in SQL. */
  totalQuantity: number;
}

export interface DeliveryDetail extends Omit<DeliveryRow, "_count"> {
  preDeliveryTestNotes: string | null;
  driverPhone: string | null;
  vehiclePlate: string | null;
  checklist: string | null;
  photos: string | null;
  items: PackingItemRow[];
}

export interface DeliveryWriteInput {
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
  items?: Record<string, unknown>[];
}

/** One item's promise-versus-shipped position on a project. */
export interface RemainingLine {
  key: string;
  productId: string | null;
  productName: string;
  tagNumber: string | null;
  promised: number;
  shipped: number;
  remaining: number;
}

export const deliveriesApi = {
  list: (query: Record<string, string | number | undefined>, signal?: AbortSignal) =>
    api.get<ListResponse<DeliveryRow>>("/api/deliveries", query, signal),

  get: (id: string) =>
    api.get<{ delivery: DeliveryDetail }>(`/api/deliveries/${id}`).then((r) => r.delivery),

  /**
   * What the project still owes, per item.
   *
   * `excludeDeliveryId` is what makes editing work: without it a list counts its
   * own quantities against itself, and every line looks over-shipped.
   */
  remaining: (params: { projectId: string; proformaId?: string; excludeDeliveryId?: string }) =>
    api.get<{ lines: RemainingLine[] }>("/api/deliveries/remaining", params).then((r) => r.lines),

  create: (input: DeliveryWriteInput) =>
    api.post<{ delivery: DeliveryDetail }>("/api/deliveries", input).then((r) => r.delivery),

  update: (id: string, input: DeliveryWriteInput) =>
    api.put<{ delivery: DeliveryDetail }>(`/api/deliveries/${id}`, input).then((r) => r.delivery),

  remove: (id: string) => api.delete<Record<string, never>>(`/api/deliveries/${id}`),

  /** Every match, for export only. Several round trips at the server's 200 cap. */
  listAll: async (
    query: Record<string, string | number | undefined>,
    options: { limit?: number } = {},
  ): Promise<DeliveryRow[]> => {
    const { limit = 20_000 } = options;
    const rows: DeliveryRow[] = [];
    let page = 1;

    for (;;) {
      const batch = await api.get<ListResponse<DeliveryRow>>("/api/deliveries", {
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

/** A row, in the shape the existing table markup expects. */
export function rowToDelivery(row: DeliveryRow): PackagingDelivery {
  return {
    id: row.id,
    projectId: row.projectId,
    // The grid reads these directly; on the server they are joins, not columns.
    projectName: row.project?.name ?? "",
    proformaId: row.proformaId ?? undefined,
    proformaNumber: row.proforma?.proformaNumber ?? undefined,
    packingListNumber: row.packingListNumber,
    deliveryDate: row.deliveryDateJalali ?? "",
    actualDeliveryDate: row.actualDeliveryDateJalali ?? undefined,
    shippingMethod: row.shippingMethod ?? "",
    waybillNumber: row.waybillNumber ?? undefined,
    trackingCode: row.trackingCode ?? undefined,
    driverName: row.driverName ?? undefined,
    preDeliveryTestNotes: "",
    checklist: [],
    // A row carries no lines — only how many there are, and how many units they
    // come to. The card prints both and used to read them off this empty array,
    // so every list showed as holding nothing.
    items: [],
    itemCount: row._count?.items ?? 0,
    totalQuantity: row.totalQuantity ?? 0,
    photos: [],
    createdAt: row.createdAt,
  };
}

export function detailToDelivery(detail: DeliveryDetail): PackagingDelivery {
  return {
    ...rowToDelivery({ ...detail, _count: { items: (detail.items ?? []).length } }),
    preDeliveryTestNotes: detail.preDeliveryTestNotes ?? "",
    driverPhone: detail.driverPhone ?? undefined,
    vehiclePlate: detail.vehiclePlate ?? undefined,
    checklist: parseJson<DeliveryChecklistItem[]>(detail.checklist, []),
    photos: parseJson<string[]>(detail.photos, []),
    itemCount: (detail.items ?? []).length,
    totalQuantity: (detail.items ?? []).reduce((sum, i) => sum + Number(i.quantity ?? 0), 0),
    items: (detail.items ?? []).map((item): PackingItem => ({
      id: item.id,
      itemOrDocName: item.itemOrDocName,
      productId: item.productId ?? undefined,
      tagNumber: item.tagNumber ?? undefined,
      quantity: Number(item.quantity),
      packageType: item.packageType ?? "",
      dimensions: item.dimensions ?? "",
      weight: Number(item.weight),
      boxNumber: item.boxNumber ?? undefined,
      actualDeliveryDate: item.actualDeliveryDateJalali ?? undefined,
    })),
  };
}

export function deliveryToWriteInput(delivery: Partial<PackagingDelivery>): DeliveryWriteInput {
  return {
    packingListNumber: delivery.packingListNumber,
    projectId: delivery.projectId,
    proformaId: delivery.proformaId || null,
    deliveryDate: delivery.deliveryDate || null,
    actualDeliveryDate: delivery.actualDeliveryDate || null,
    shippingMethod: delivery.shippingMethod ?? null,
    preDeliveryTestNotes: delivery.preDeliveryTestNotes ?? null,
    waybillNumber: delivery.waybillNumber ?? null,
    driverName: delivery.driverName ?? null,
    driverPhone: delivery.driverPhone ?? null,
    vehiclePlate: delivery.vehiclePlate ?? null,
    trackingCode: delivery.trackingCode ?? null,
    checklist: delivery.checklist,
    photos: delivery.photos,
    items: (delivery.items ?? []).map((item) => ({
      itemOrDocName: item.itemOrDocName,
      productId: item.productId || null,
      tagNumber: item.tagNumber || null,
      quantity: item.quantity,
      packageType: item.packageType || null,
      dimensions: item.dimensions || null,
      weight: item.weight,
      boxNumber: item.boxNumber || null,
      actualDeliveryDate: item.actualDeliveryDate || null,
    })),
  };
}
