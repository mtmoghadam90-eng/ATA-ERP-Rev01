import { api } from "./client";
import { WebRfqSourceId } from "../utils/webRfq";

/**
 * The website's price-request feeds, from the settings screen.
 *
 * Every call names its **source** — there is one configuration, one line and
 * one report per plugin, and a call that could omit it would answer about
 * whichever card was not being looked at. The retry is the one exception, and
 * deliberately: the import row carries its own source, so naming one here
 * could only ever contradict it.
 *
 * The token is write-only: `config` answers a masked hint and never the value,
 * and saving with a blank one means «unchanged» — the rule every stored secret
 * in this application follows.
 */

export interface WebRfqConfig {
  source: WebRfqSourceId;
  feedUrl: string;
  tokenHint: string | null;
  active: boolean;
  ownerUserId: string | null;
  /** The line: nothing at or below it is imported. Null until it is drawn. */
  startAfterId: number | null;
  refusal: string | null;
}

export interface WebRfqReport {
  lastRunAt: number;
  lastOkAt: number;
  lastError: string | null;
  lastImported: number;
  /** What the last pass drew the line at, when it was a baseline pass. */
  baselineDrawnAt: number | null;
  running: boolean;
}

export interface WebRfqImportRow {
  id: string;
  source: string;
  rfqId: number;
  /** The plugin's own reference, where it issues one. */
  reference: string | null;
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
  config: (source: WebRfqSourceId) =>
    api.get<ConfigAnswer>(`/api/web-rfq/${source}/config`),

  save: (source: WebRfqSourceId, input: {
    feedUrl?: string; token?: string; active?: boolean;
    ownerUserId?: string | null;
    /** Null means «draw it again on the next poll»; zero means «everything». */
    startAfterId?: number | null;
  }) =>
    api.put<ConfigAnswer>(`/api/web-rfq/${source}/config`, input),

  sync: (source: WebRfqSourceId) =>
    api.post<{ imported: number; report: WebRfqReport }>(`/api/web-rfq/${source}/sync`, {}),

  imports: (source: WebRfqSourceId) =>
    api.get<{ imports: WebRfqImportRow[] }>(`/api/web-rfq/${source}/imports`),

  retry: (id: string) =>
    api.post<{ imported: number; report: WebRfqReport }>(`/api/web-rfq/imports/${id}/retry`, {}),
};
