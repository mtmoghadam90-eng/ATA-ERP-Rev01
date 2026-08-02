import { ListResponse, api } from "./client";

/** Supplier endpoints. Shared reference data — no per-record scope. */

export interface SupplierRow {
  id: string;
  name: string;
  country: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  paymentTerms: string | null;
  status: string;
  /** Serialized string[] of the categories this supplier can provide. */
  providedCategories: string | null;
  createdAt: string;
  _count: { purchaseOrders: number; inquiries: number };
}

export interface SupplierDetail extends Omit<SupplierRow, "_count"> {
  description: string | null;
  customValues: string | null;
  updatedAt: string;
}

export interface SupplierReferences {
  purchaseOrders: number;
  inquiries: number;
  transactions: number;
  total: number;
}

export interface SupplierWriteInput {
  name?: string;
  country?: string | null;
  contactName?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  paymentTerms?: string | null;
  status?: string;
  description?: string | null;
  providedCategories?: unknown;
  customValues?: unknown;
}

export const suppliersApi = {
  list: (query: Record<string, string | number | undefined>, signal?: AbortSignal) =>
    api.get<ListResponse<SupplierRow>>("/api/suppliers", query, signal),

  get: (id: string) =>
    api.get<{ supplier: SupplierDetail }>(`/api/suppliers/${id}`).then((r) => r.supplier),

  references: (id: string) =>
    api.get<{ references: SupplierReferences }>(`/api/suppliers/${id}/references`)
      .then((r) => r.references),

  create: (input: SupplierWriteInput) =>
    api.post<{ supplier: SupplierDetail }>("/api/suppliers", input).then((r) => r.supplier),

  update: (id: string, input: SupplierWriteInput) =>
    api.put<{ supplier: SupplierDetail }>(`/api/suppliers/${id}`, input).then((r) => r.supplier),

  remove: (id: string) => api.delete<Record<string, never>>(`/api/suppliers/${id}`),

  /** Every match, for export only. Several round trips at the server's 200 cap. */
  listAll: async (
    query: Record<string, string | number | undefined>,
    options: { limit?: number } = {},
  ): Promise<SupplierRow[]> => {
    const { limit = 20_000 } = options;
    const rows: SupplierRow[] = [];
    let page = 1;

    for (;;) {
      const batch = await api.get<ListResponse<SupplierRow>>("/api/suppliers", {
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

import type { Supplier } from "../types";

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
export function rowToSupplier(row: SupplierRow): Supplier {
  return {
    id: row.id,
    name: row.name,
    country: row.country ?? "",
    contactName: row.contactName ?? "",
    phone: row.phone ?? "",
    email: row.email ?? "",
    website: row.website ?? "",
    paymentTerms: row.paymentTerms ?? "",
    status: row.status as Supplier["status"],
    providedCategories: parseJson<string[]>(row.providedCategories, []),
    createdAt: row.createdAt,
    description: "",
  } as Supplier;
}

export function detailToSupplier(detail: SupplierDetail): Supplier {
  return {
    ...rowToSupplier({ ...detail, _count: { purchaseOrders: 0, inquiries: 0 } }),
    description: detail.description ?? "",
    customValues: parseJson<Record<string, unknown>>(detail.customValues, {}),
  } as Supplier;
}

export function supplierToWriteInput(supplier: Partial<Supplier>): SupplierWriteInput {
  return {
    name: supplier.name,
    country: supplier.country ?? null,
    contactName: supplier.contactName ?? null,
    phone: supplier.phone ?? null,
    email: supplier.email ?? null,
    website: supplier.website ?? null,
    paymentTerms: supplier.paymentTerms ?? null,
    status: supplier.status,
    description: supplier.description ?? null,
    providedCategories: supplier.providedCategories,
    customValues: supplier.customValues,
  };
}
