import { ListResponse, api } from "./client";

/**
 * Customer endpoints.
 *
 * The shapes here are what the API returns, which is deliberately not the old
 * `Customer` type: list rows carry only the columns a grid shows, and the
 * reference counts come from a query rather than from the client holding every
 * project, proforma and transaction in order to count them itself.
 */

export interface CustomerRow {
  id: string;
  customerType: string;
  status: string;
  companyName: string;
  firstName: string | null;
  lastName: string | null;
  economicCode: string | null;
  industry: string | null;
  phone: string | null;
  mobile: string | null;
  email: string | null;
  province: string | null;
  city: string | null;
  tags: string | null;
  position: string | null;
  keyPerson: string | null;
  ownerUserId: string | null;
  createdAt: string;
  /** Serialized custom-field values, or null. */
  customValues: string | null;
  /** Joined in the list query so the grid does not fetch one per row. */
  linksFrom: { to: { id: string; companyName: string; customerType: string } }[];
  /** Drives the honorific the proforma form suggests. */
  gender: string | null;

  /* ---- customer value ---- */
  /** The manual half: what a person judged about this customer. */
  potentialValueScore: number | null;
  paymentBehaviour: string | null;
  paymentReviewed: boolean;
  costToServe: string | null;
  costToServeReviewed: boolean;
  /** The computed half. Null until the first recalculation has run. */
  valueMetrics: CustomerValueMetricsRow | null;
}

/** Everything a recalculation writes. Decimals arrive as strings. */
export interface CustomerValueMetricsRow {
  customerValueRank: string;
  customerValueIndex: number | null;
  realizedValueScore: number;
  potentialValueScore: number | null;
  grossProfitRial: string;
  salesRevenueRial: string;
  grossMarginPercent: number | null;
  costCoveragePercent: number;
  purchaseFrequency: number;
  lastPurchaseDateJalali: string | null;
  daysSinceLastPurchase: number | null;
  grossProfitScore: number;
  frequencyScore: number;
  recencyScore: number;
  paymentScore: number;
  costToServeScore: number;
  calculatedAt: string;
}

export interface CustomerValueDetailRow {
  rank: string;
  realizedValueScore: number;
  potentialValueScore: number | null;
  customerValueIndex: number | null;
  calculatedAt: string | null;
  components: {
    grossProfitScore: number; frequencyScore: number; recencyScore: number;
    paymentScore: number; costToServeScore: number;
  };
  raw: {
    salesRevenueRial: number; grossProfitRial: number; grossMarginPercent: number | null;
    costCoveragePercent: number; purchaseFrequency: number;
    lastPurchaseDateJalali: string | null; daysSinceLastPurchase: number | null;
  };
  potentialInputs: {
    consumption: number | null; companySize: number | null; projects: number | null;
    portfolioFit: number | null; repeatPurchase: number | null;
  };
}

export interface CustomerDetail extends CustomerRow {
  address: string | null;
  potentialConsumption: number | null;
  potentialCompanySize: number | null;
  potentialProjects: number | null;
  potentialPortfolioFit: number | null;
  potentialRepeatPurchase: number | null;
  notes: string | null;
  customValues: string | null;
  mobileNormalized: string | null;
  updatedAt: string;
  agreements: {
    id: string; moduleName: string; text: string; createdBy: string | null; createdAt: string;
  }[];
  linksFrom: {
    fromId: string; toId: string;
    to: { id: string; companyName: string; customerType: string };
  }[];
}

/** What deleting a customer would affect. Drives the migrate-or-cancel prompt. */
export interface CustomerReferences {
  projects: number;
  proformas: number;
  transactions: number;
  links: number;
  agreements: number;
  total: number;
}

export interface CustomerWriteInput {
  customerType: string;
  companyName: string;
  status?: string;
  firstName?: string | null;
  lastName?: string | null;
  gender?: string | null;
  position?: string | null;
  economicCode?: string | null;
  industry?: string | null;
  keyPerson?: string | null;
  phone?: string | null;
  mobile?: string | null;
  email?: string | null;
  province?: string | null;
  city?: string | null;
  address?: string | null;
  notes?: string | null;
  tags?: string | null;
  customValues?: string | null;

  /**
   * The manual half of customer value. The score, rank and every sales-derived
   * figure are computed server-side and are not writable.
   */
  potentialConsumption?: number | null;
  potentialCompanySize?: number | null;
  potentialProjects?: number | null;
  potentialPortfolioFit?: number | null;
  potentialRepeatPurchase?: number | null;
  paymentBehaviour?: string | null;
  costToServe?: string | null;
}

/** What the duplicate check is given: the record as the form has it so far. */
export interface DuplicateCandidate {
  /** Set when editing, so the record does not match itself. */
  id?: string;
  customerType: string;
  companyName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  mobile?: string | null;
  phone?: string | null;
  email?: string | null;
  province?: string | null;
  economicCode?: string | null;
}

export interface DuplicateMatchRow {
  customer: {
    id: string; customerType: string; companyName: string;
    firstName: string | null; lastName: string | null;
    mobile: string | null; phone: string | null; email: string | null;
    province: string | null; economicCode: string | null;
  };
  /** `hard` is a colliding economic code; everything else is a warning. */
  severity: "hard" | "soft";
  primaryField: string;
  /** Persian explanation of what matched. */
  reason: string;
}

export const customersApi = {
  list: (query: Record<string, string | number | undefined>, signal?: AbortSignal) =>
    api.get<ListResponse<CustomerRow>>("/api/customers", query, signal),

  /**
   * Every row matching a query, fetched a page at a time.
   *
   * Only for export. A screen must never call this — it is the exact thing this
   * migration removed. The server caps a page at 200, so exporting a large
   * result is necessarily several round trips; `onProgress` lets the caller show
   * that rather than appearing frozen, and `limit` stops an accidental
   * unfiltered export from pulling an unbounded number of rows.
   */
  listAll: async (
    query: Record<string, string | number | undefined>,
    options: { limit?: number; onProgress?: (loaded: number, total: number) => void } = {},
  ): Promise<CustomerRow[]> => {
    const { limit = 20_000, onProgress } = options;
    const rows: CustomerRow[] = [];
    let page = 1;

    for (;;) {
      const batch = await api.get<ListResponse<CustomerRow>>("/api/customers", {
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

  get: (id: string) =>
    api.get<{ customer: CustomerDetail }>(`/api/customers/${id}`).then((r) => r.customer),

  references: (id: string) =>
    api.get<{ references: CustomerReferences }>(`/api/customers/${id}/references`)
      .then((r) => r.references),

  /**
   * Existing customers that look like this one.
   *
   * Replaces scanning every loaded customer in the browser, which pagination
   * made impossible — the check would have silently seen only the current page.
   */
  checkDuplicates: (candidate: DuplicateCandidate) =>
    api.post<{ matches: DuplicateMatchRow[]; hasHardDuplicate: boolean }>(
      "/api/customers/check-duplicates", candidate),

  create: (input: CustomerWriteInput) =>
    api.post<{ customer: CustomerDetail }>("/api/customers", input).then((r) => r.customer),

  update: (id: string, input: Partial<CustomerWriteInput>) =>
    api.put<{ customer: CustomerDetail }>(`/api/customers/${id}`, input).then((r) => r.customer),

  /** Replaces this customer's links. Symmetric — both directions are written. */
  setLinks: (id: string, linkedIds: string[]) =>
    api.put<{ customer: CustomerDetail }>(`/api/customers/${id}/links`, { linkedIds })
      .then((r) => r.customer),

  /** Replaces this customer's per-module agreement texts. */
  setAgreements: (
    id: string,
    agreements: { moduleName: string; text: string; createdBy?: string | null }[],
  ) =>
    api.put<{ customer: CustomerDetail }>(`/api/customers/${id}/agreements`, { agreements })
      .then((r) => r.customer),

  /** Deletes outright. Throws with code HAS_HISTORY when the customer has records. */
  remove: (id: string) => api.delete<Record<string, never>>(`/api/customers/${id}`),

  /** Moves every dependent record to `replacementId`, then deletes. */
  removeWithMigration: (id: string, replacementId: string) =>
    api.delete<{ movedTo: string }>(`/api/customers/${id}`, { replaceWith: replacementId }),

  /** Everything behind one customer's rank, for the value card. */
  value: (id: string) =>
    api.get<{ value: CustomerValueDetailRow }>(`/api/customers/${id}/value`).then((r) => r.value),

  /** How the company's view of this customer's potential has moved. */
  potentialHistory: (id: string) =>
    api.get<{ history: PotentialHistoryRow[] }>(`/api/customers/${id}/potential-history`)
      .then((r) => r.history),

  /** Rank counts and totals for the value dashboard. */
  valueSummary: () =>
    api.get<{ summary: CustomerValueSummary }>("/api/customers/value-summary").then((r) => r.summary),

  /**
   * Re-ranks every customer.
   *
   * Whole-population because the percentile scores are relative; there is no
   * correct way to recalculate one customer alone.
   */
  recalculateValue: () =>
    api.post<{ customers: number; ranked: number; pending: number }>(
      "/api/customers/recalculate-value", {}),
};

export interface PotentialHistoryRow {
  id: string;
  previousScore: number | null;
  newScore: number | null;
  previousParams: string | null;
  newParams: string | null;
  changedByName: string | null;
  changedAt: string;
}

export interface CustomerValueSummary {
  byRank: { rank: string; count: number; grossProfitRial: number }[];
  averageRealized: number;
  averagePotential: number;
}
