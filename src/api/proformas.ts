import { ListResponse, api } from "./client";

/**
 * Proforma endpoints.
 *
 * Two things arrive derived rather than stored: `outcomeStatus`, which comes
 * from the line statuses, and the money totals, which are recomputed from the
 * stored lines on every write. Neither is ever sent by the client — a form's
 * arithmetic is a preview, not the record.
 */

export interface ProformaItemRow {
  id: string;
  lineNo: number;
  productId: string | null;
  variantId: string | null;
  productName: string;
  productCode: string | null;
  brand: string | null;
  tagNumber: string | null;
  quantity: string;
  unit: string | null;
  unitPriceRial: string;
  totalPriceRial: string;
  /** Per unit, in the proforma's currency. Null when nobody has said. */
  unitCost: string | null;
  costCurrency: string | null;
  costSource: string | null;
  supplyMethod: string | null;
  status: string | null;
  lossReason: string | null;
  techSpecs: string | null;
  deliveryRange: string | null;
  deliveryUnit: string | null;
  deliveryType: string | null;
  deliveryPostfix: string | null;
  selectedFeatures: string | null;
  selectedImage: string | null;
}

export interface ProformaRow {
  id: string;
  proformaNumber: string;
  proformaType: string;
  /** The stored workflow status — not the derived outcome. */
  status: string;
  isCancelled: boolean;
  currency: string;
  customerId: string;
  projectId: string | null;
  issueDate: string | null;
  issueDateJalali: string | null;
  expiryDateJalali: string | null;
  totalAmount: string;
  finalAmount: string;
  /** The rate the document was priced at; a receipt's settlement rate starts here. */
  historicalExchangeRate: string | null;
  creatorUserId: string | null;
  createdAt: string;
  customer: { id: string; companyName: string; customerType: string } | null;
  project: {
    id: string; code: string; name: string; status: string;
    customer: { id: string; companyName: string } | null;
  } | null;
  creator: { id: string; fullName: string } | null;
  /** Enough of each line for the grid: its name, quantity and status. */
  items: { id: string; productName: string; quantity: string; status: string | null; supplyMethod: string | null }[];
  _count: { items: number };
  /** Derived from the line statuses; the grid shows this, not `status`. */
  outcomeStatus: string;
  /** Printed on the card: how it was sent, to whom, and why it was lost. */
  sentMethod: string | null;
  sentRecipients: string | null;
  lossReason: string | null;
  /** The grid draws a custom-fields column from these. */
  customValues: string | null;
}

export interface ProformaDetail extends Omit<ProformaRow, "items"> {
  contactCustomerId: string | null;
  contactPrefix: string | null;
  deliveryDateJalali: string | null;
  discountPercent: string;
  discountAmount: string;
  taxPercent: string;
  taxAmount: string;
  extraCosts: string;
  historicalExchangeRate: string | null;
  notes: string | null;
  contact: { id: string; companyName: string } | null;
  items: ProformaItemRow[];
  /** Which lines count as won — derived, so the client need not re-derive it. */
  wonItemIds: string[];
}

export interface ProformaReferences {
  purchaseOrders: number;
  transactions: number;
  deliveries: number;
  total: number;
}

export interface ProformaWriteInput {
  proformaNumber?: string;
  proformaType?: string;
  customerId?: string;
  contactCustomerId?: string | null;
  contactPrefix?: string | null;
  projectId?: string | null;
  status?: string;
  isCancelled?: boolean;
  lossReason?: string | null;
  currency?: string;
  issueDate?: string | null;
  expiryDate?: string | null;
  deliveryDate?: string | null;
  discountPercent?: unknown;
  discountAmount?: unknown;
  taxPercent?: unknown;
  taxAmount?: unknown;
  extraCosts?: unknown;
  historicalExchangeRate?: unknown;
  notes?: string | null;
  sentMethod?: string | null;
  sentRecipients?: unknown;
  customValues?: unknown;
  items?: Record<string, unknown>[];
}

export const proformasApi = {
  list: (query: Record<string, string | number | undefined>, signal?: AbortSignal) =>
    api.get<ListResponse<ProformaRow>>("/api/proformas", query, signal),

  get: (id: string) =>
    api.get<{ proforma: ProformaDetail }>(`/api/proformas/${id}`).then((r) => r.proforma),

  references: (id: string) =>
    api.get<{ references: ProformaReferences }>(`/api/proformas/${id}/references`)
      .then((r) => r.references),

  create: (input: ProformaWriteInput) =>
    api.post<{ proforma: ProformaDetail }>("/api/proformas", input).then((r) => r.proforma),

  update: (id: string, input: ProformaWriteInput) =>
    api.put<{ proforma: ProformaDetail }>(`/api/proformas/${id}`, input).then((r) => r.proforma),

  /**
   * Sets per-line outcomes. This is the operation that decides a deal, so it has
   * its own endpoint: it re-derives the parent project's status in the same
   * transaction, and item ids are scoped to this proforma.
   */
  setItemOutcomes: (
    id: string,
    outcomes: { itemId: string; status: string; lossReason?: string | null }[],
  ) => api.post<{ proforma: ProformaDetail }>(`/api/proformas/${id}/item-outcomes`, { outcomes })
    .then((r) => r.proforma),

  /**
   * `removeActivities` also deletes the automatic project-timeline entries this
   * record produced, and any category group they leave empty. Omitted, the
   * entries stay and one more records the deletion.
   */
  remove: (id: string, removeActivities = false) =>
    api.delete<Record<string, never>>(
      `/api/proformas/${id}`,
      removeActivities ? { removeActivities: "true" } : undefined,
    ),

  /** Every match, for export only. Several round trips at the server's 200 cap. */
  listAll: async (
    query: Record<string, string | number | undefined>,
    options: { limit?: number; onProgress?: (loaded: number, total: number) => void } = {},
  ): Promise<ProformaRow[]> => {
    const { limit = 20_000, onProgress } = options;
    const rows: ProformaRow[] = [];
    let page = 1;

    for (;;) {
      const batch = await api.get<ListResponse<ProformaRow>>("/api/proformas", {
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
