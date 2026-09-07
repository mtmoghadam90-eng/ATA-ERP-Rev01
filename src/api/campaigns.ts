import { ListResponse, api } from "./client";
import type { CampaignCounts, SegmentQuery, SkipReason } from "../utils/campaigns";

/**
 * Segments and campaigns.
 *
 * A segment travels as the customers grid's own query parameters, which is what
 * lets the screen build one out of the filters somebody has already set rather
 * than offering a second, parallel filter form.
 */

export interface SegmentRow {
  id: string;
  name: string;
  description: string | null;
  query: SegmentQuery;
  campaignCount: number;
  createdByName: string | null;
  createdAt: string;
}

export interface SegmentPreview {
  total: number;
  sample: { id: string; name: string; mobile: string | null; doNotContact: boolean }[];
  overLimit: boolean;
  limit: number;
}

export interface CampaignRow {
  id: string;
  name: string;
  segmentId: string | null;
  segmentName: string | null;
  channel: string;
  templateId: string | null;
  subject: string | null;
  body: string;
  status: string;
  scheduledAtJalali: string | null;
  matchedCount: number | null;
  sentAt: string | null;
  createdByName: string | null;
  createdAt: string;
  counts: CampaignCounts;
}

export interface SendCampaignResult {
  queued: number;
  matched: number;
  skipped: Record<SkipReason, number>;
  otherReasons: string[];
  truncated: boolean;
  /** Recipients this press did not reach. Press again to continue. */
  remaining: number;
}

export interface SegmentInput {
  name?: string;
  description?: string | null;
  query?: SegmentQuery;
}

export interface CampaignInput {
  name?: string;
  segmentId?: string;
  channel?: string;
  templateId?: string | null;
  subject?: string | null;
  body?: string;
  scheduledDate?: string | null;
  scheduledTime?: string | null;
}

export const campaignsApi = {
  segments: () =>
    api.get<{ segments: SegmentRow[] }>("/api/messaging/segments").then((r) => r.segments),

  /**
   * How many customers a query matches. Either an unsaved query, or a saved
   * segment by id — the second so the campaign form can show the count without
   * holding a copy of the segment's filters.
   */
  previewSegment: (input: { query?: SegmentQuery; segmentId?: string }) =>
    api.post<{ preview: SegmentPreview }>("/api/messaging/segments/preview", input)
      .then((r) => r.preview),

  createSegment: (input: SegmentInput) =>
    api.post<{ segment: SegmentRow }>("/api/messaging/segments", input).then((r) => r.segment),

  updateSegment: (id: string, input: SegmentInput) =>
    api.put<{ segment: SegmentRow }>(`/api/messaging/segments/${id}`, input).then((r) => r.segment),

  deleteSegment: (id: string) =>
    api.delete<Record<string, never>>(`/api/messaging/segments/${id}`),

  campaigns: (query: Record<string, string | number | undefined> = {}) =>
    api.get<ListResponse<CampaignRow>>("/api/messaging/campaigns", query),

  createCampaign: (input: CampaignInput) =>
    api.post<{ campaign: CampaignRow }>("/api/messaging/campaigns", input).then((r) => r.campaign),

  updateCampaign: (id: string, input: CampaignInput) =>
    api.put<{ campaign: CampaignRow }>(`/api/messaging/campaigns/${id}`, input)
      .then((r) => r.campaign),

  /** Queues the messages. Safe to call twice; the second pass skips what exists. */
  send: (id: string) =>
    api.post<{ result: SendCampaignResult }>(`/api/messaging/campaigns/${id}/send`, {})
      .then((r) => r.result),

  cancel: (id: string) =>
    api.post<{ cancelled: number }>(`/api/messaging/campaigns/${id}/cancel`, {}),

  deleteCampaign: (id: string) =>
    api.delete<Record<string, never>>(`/api/messaging/campaigns/${id}`),
};
