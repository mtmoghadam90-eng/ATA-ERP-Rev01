import { ListResponse, api } from "./client";
import type { AfterSalesService, AfterSalesServiceItem } from "../types";

/**
 * After-sales service endpoints.
 *
 * A record is a folder of items, each with its own progress, and the name,
 * dates and status on the record itself are rolled up from those rows by the
 * server. They are sent nonetheless — the columns exist and older callers still
 * fill them — but whatever arrives is overwritten by the roll-up, because the
 * grid filters and sorts on them.
 */

export interface ServiceItemRow {
  id: string;
  lineNo: number;
  productId: string | null;
  productName: string;
  status: string;
  issueDescription: string | null;
  actionsTaken: string | null;
  startDateJalali: string | null;
  endDateJalali: string | null;
  returnDateJalali: string | null;
}

export interface ServiceRow {
  id: string;
  projectId: string;
  itemName: string;
  status: string;
  proformaNumber: string | null;
  proformaItemName: string | null;
  /*
   * On the row, because the card draws them. They were selected by neither the
   * server nor this adapter, so «دلیل برگشت» was blank on every card in the
   * module — the `rowToTask`/`completionNote` fault, one module along.
   */
  issueDescription: string | null;
  actionsTaken: string | null;
  customerRequest: string | null;
  requestDateJalali: string | null;
  startDateJalali: string | null;
  endDateJalali: string | null;
  returnDateJalali: string | null;
  createdBy: string | null;
  createdAt: string;
  project: { id: string; code: string; name: string } | null;
  _count: { items: number };
  /** The grid draws a custom-fields column from these. */
  customValues: string | null;
}

export interface ServiceDetail extends Omit<ServiceRow, "_count"> {
  items: ServiceItemRow[];
}

export interface ServiceWriteInput {
  projectId?: string;
  proformaNumber?: string | null;
  proformaItemName?: string | null;
  /** Neither is rolled up from the rows, so both are sent. */
  customerRequest?: string | null;
  requestDate?: string | null;
  createdBy?: string | null;
  customValues?: unknown;
  items?: Record<string, unknown>[];
}

export const afterSalesApi = {
  list: (query: Record<string, string | number | undefined>, signal?: AbortSignal) =>
    api.get<ListResponse<ServiceRow>>("/api/after-sales", query, signal),

  get: (id: string) =>
    api.get<{ service: ServiceDetail }>(`/api/after-sales/${id}`).then((r) => r.service),

  create: (input: ServiceWriteInput) =>
    api.post<{ service: ServiceDetail }>("/api/after-sales", input).then((r) => r.service),

  update: (id: string, input: ServiceWriteInput) =>
    api.put<{ service: ServiceDetail }>(`/api/after-sales/${id}`, input).then((r) => r.service),

  /**
   * `removeActivities` also deletes the automatic project-timeline entries this
   * record produced, and any category group they leave empty. Omitted, the
   * entries stay and one more records the deletion.
   */
  remove: (id: string, removeActivities = false) =>
    api.delete<Record<string, never>>(
      `/api/after-sales/${id}`,
      removeActivities ? { removeActivities: "true" } : undefined,
    ),

  /** Every match, for export only. Several round trips at the server's 200 cap. */
  listAll: async (
    query: Record<string, string | number | undefined>,
    options: { limit?: number } = {},
  ): Promise<ServiceRow[]> => {
    const { limit = 20_000 } = options;
    const rows: ServiceRow[] = [];
    let page = 1;

    for (;;) {
      const batch = await api.get<ListResponse<ServiceRow>>("/api/after-sales", {
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

/** A row, in the shape the existing table markup expects. */
/** A JSON text column, back to the value it holds. */
function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}

export function rowToService(row: ServiceRow): AfterSalesService {
  return {
    id: row.id,
    projectId: row.projectId,
    // The grid reads this directly; on the server it is a join, not a column.
    projectName: row.project?.name ?? "",
    proformaNumber: row.proformaNumber ?? undefined,
    proformaItemName: row.proformaItemName ?? undefined,
    itemName: row.itemName,
    // Read from the row rather than blanked. Written as `""` here, the card
    // drew an empty «دلیل برگشت» on every record and nothing said why.
    issueDescription: row.issueDescription ?? "",
    actionsTaken: row.actionsTaken ?? "",
    customerRequest: row.customerRequest ?? undefined,
    requestDate: row.requestDateJalali ?? undefined,
    startDate: row.startDateJalali ?? "",
    endDate: row.endDateJalali ?? undefined,
    returnDate: row.returnDateJalali ?? undefined,
    status: row.status as AfterSalesService["status"],
    createdAt: row.createdAt,
    createdBy: row.createdBy ?? "",
    customValues: parseJson<Record<string, any>>(row.customValues, {}),
    // The rows are not on a list row; their number is, and the summary line
    // draws it. Reading `items.length` there would answer 0 for every record.
    itemCount: row._count?.items ?? 0,
    items: [],
  };
}

export function detailToService(detail: ServiceDetail): AfterSalesService {
  return {
    // The header fields come down through `rowToService` now — the detail
    // carries exactly the same columns, and restating them here is how the two
    // adapters come to disagree about which of them is authoritative.
    ...rowToService({ ...detail, _count: { items: (detail.items ?? []).length } }),
    items: (detail.items ?? []).map((item): AfterSalesServiceItem => ({
      id: item.id,
      productId: item.productId ?? undefined,
      productName: item.productName,
      issueDescription: item.issueDescription ?? "",
      actionsTaken: item.actionsTaken ?? undefined,
      startDate: item.startDateJalali ?? "",
      endDate: item.endDateJalali ?? undefined,
      returnDate: item.returnDateJalali ?? undefined,
      status: item.status as AfterSalesServiceItem["status"],
    })),
  };
}

/**
 * A form's state, as the write endpoint wants it.
 *
 * The rolled-up header is deliberately absent: the server recomputes it from
 * the rows, so sending it would only invite the two to disagree.
 */
export function serviceToWriteInput(service: Partial<AfterSalesService>): ServiceWriteInput {
  return {
    projectId: service.projectId,
    proformaNumber: service.proformaNumber || null,
    proformaItemName: service.proformaItemName || null,
    customerRequest: service.customerRequest || null,
    requestDate: service.requestDate || null,
    createdBy: service.createdBy || null,
    customValues: service.customValues,
    items: (service.items ?? []).map((item) => ({
      productId: item.productId || null,
      productName: item.productName,
      status: item.status,
      issueDescription: item.issueDescription || null,
      actionsTaken: item.actionsTaken || null,
      startDate: item.startDate || null,
      endDate: item.endDate || null,
      returnDate: item.returnDate || null,
    })),
  };
}
