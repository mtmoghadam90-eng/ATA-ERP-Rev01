import { api } from "./client";

/**
 * The website's price-request feed, from the settings screen.
 *
 * The token is write-only: `config` answers a masked hint and never the value,
 * and saving with a blank one means «unchanged» — the rule every stored secret
 * in this application follows.
 */

export interface WebRfqConfig {
  feedUrl: string;
  tokenHint: string | null;
  active: boolean;
  ownerUserId: string | null;
  refusal: string | null;
}

export interface WebRfqReport {
  lastRunAt: number;
  lastOkAt: number;
  lastError: string | null;
  lastImported: number;
  running: boolean;
}

export interface WebRfqImportRow {
  id: string;
  rfqId: number;
  status: string;
  attempts: number;
  projectId: string | null;
  projectCode: string | null;
  customerId: string | null;
  productName: string | null;
  fullName: string | null;
  error: string | null;
  createdAt: string;
  importedAt: string | null;
}

type ConfigAnswer = { config: WebRfqConfig; report: WebRfqReport };

export const webRfqApi = {
  config: () => api.get<ConfigAnswer>("/api/web-rfq/config"),

  save: (input: { feedUrl?: string; token?: string; active?: boolean; ownerUserId?: string | null }) =>
    api.put<ConfigAnswer>("/api/web-rfq/config", input),

  sync: () => api.post<{ imported: number; report: WebRfqReport }>("/api/web-rfq/sync", {}),

  imports: () => api.get<{ imports: WebRfqImportRow[] }>("/api/web-rfq/imports"),

  retry: (id: string) =>
    api.post<{ imported: number; report: WebRfqReport }>(`/api/web-rfq/imports/${id}/retry`, {}),
};
