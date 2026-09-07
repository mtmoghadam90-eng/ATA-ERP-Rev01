import { api } from "./client";

/**
 * The competitor catalogue, and how the company stands against it.
 *
 * A short reference list read whole rather than paged — a company meets a few
 * dozen competitors and the picker needs all of them at once. The server
 * bounds it anyway and says so, because "we assumed it was short" is how a
 * screen silently drops rows.
 */

export interface CompetitorRow {
  id: string;
  name: string;
  website: string | null;
  country: string | null;
  notes: string | null;
  isActive: boolean;
}

export interface CompetitorStandingRow {
  competitorId: string;
  name: string;
  encounters: number;
  won: number;
  lost: number;
  open: number;
  /** Of the decided ones only; null when nothing has been decided yet. */
  winRatePercent: number | null;
  /** The **median** gap, and the count it was taken over. */
  medianGapPercent: number | null;
  pricedEncounters: number;
}

export interface CompetitorInput {
  name?: string;
  website?: string | null;
  country?: string | null;
  notes?: string | null;
  isActive?: boolean;
}

export const competitorsApi = {
  list: (includeInactive = false) =>
    api.get<{ competitors: CompetitorRow[]; truncated: boolean }>(
      "/api/competitors",
      includeInactive ? { includeInactive: "true" } : undefined,
    ),

  create: (input: CompetitorInput) =>
    api.post<{ competitor: CompetitorRow }>("/api/competitors", input),

  update: (id: string, input: CompetitorInput) =>
    api.put<{ competitor: CompetitorRow }>(`/api/competitors/${id}`, input),

  /** Retires rather than deletes: the quotations naming it keep their history. */
  retire: (id: string) => api.delete<Record<string, never>>(`/api/competitors/${id}`),

  report: (range: { from?: string; to?: string } = {}) =>
    api.get<{ rows: CompetitorStandingRow[]; truncated: boolean }>(
      "/api/competitors/report", range,
    ),
};
