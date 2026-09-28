import { api } from "./client";

/**
 * «اثربخشی تبلیغات». The list is read whole (bounded, with a flag) because
 * every report on the screen weights its ratios over the filtered set.
 */

export interface AdCampaignRow {
  id: string;
  code: string;
  runDateJalali: string | null;
  channel: string;
  topic: string;
  audience: string | null;
  audienceSize: number;
  directCost: number;
  responses: number | null;
  leads: number | null;
  sales: number | null;
  revenue: number | null;
  quality: number | null;
  notes: string | null;
  createdByName: string | null;
}

export interface AdCampaignInput {
  code?: string | null;
  runDate?: string | null;
  channel?: string;
  topic?: string;
  audience?: string | null;
  audienceSize?: number;
  directCost?: number;
  responses?: number | null;
  leads?: number | null;
  sales?: number | null;
  revenue?: number | null;
  quality?: number | null;
  notes?: string | null;
}

export interface AdCampaignFilters {
  from?: string;
  to?: string;
  channel?: string;
  audience?: string;
}

export interface AdImportResult {
  created: number;
  updated: number;
  skipped: { row: number; reason: string }[];
}

const clean = (f: AdCampaignFilters) =>
  Object.fromEntries(Object.entries(f).filter(([, v]) => v)) as Record<string, string>;

export const adCampaignsApi = {
  list: (filters: AdCampaignFilters = {}) =>
    api.get<{ campaigns: AdCampaignRow[]; truncated: boolean }>("/api/ad-campaigns", clean(filters)),
  create: (input: AdCampaignInput) =>
    api.post<{ campaign: AdCampaignRow }>("/api/ad-campaigns", input),
  update: (id: string, input: AdCampaignInput) =>
    api.put<{ campaign: AdCampaignRow }>(`/api/ad-campaigns/${id}`, input),
  remove: (id: string) => api.delete<Record<string, never>>(`/api/ad-campaigns/${id}`),
  importRows: (rows: AdCampaignInput[]) =>
    api.post<AdImportResult>("/api/ad-campaigns/import", { rows }),
};
