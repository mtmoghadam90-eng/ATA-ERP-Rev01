import { ListResponse, api, buildQuery } from "./client";

/**
 * The audit log.
 *
 * Paged and filtered by the server. The settings screen used to receive the
 * whole log and filter it in the browser, which is the same problem as the
 * grids but on the one collection that only ever grows.
 *
 * The before/after snapshots are deliberately absent from a list row — they are
 * the bulk of an entry and are fetched only when one is expanded.
 */

export interface AuditLogRow {
  id: string;
  action: string;
  module: string;
  entityId: string | null;
  description: string;
  userId: string | null;
  userFullName: string | null;
  occurredAtJalali: string | null;
  createdAt: string;
}

export interface AuditLogEntry extends AuditLogRow {
  beforeState: string | null;
  afterState: string | null;
}

export const auditLogsApi = {
  list: (query: Record<string, string | number | undefined>, signal?: AbortSignal) =>
    api.get<ListResponse<AuditLogRow>>("/api/audit-logs", query, signal),

  /** One entry with its snapshots, for an expanded row. */
  get: (id: string) =>
    api.get<{ entry: AuditLogEntry }>(`/api/audit-logs/${id}`).then((r) => r.entry),

  /**
   * System administrators only.
   *
   * Takes the same filters the list does, so clearing "the filtered entries"
   * clears every match rather than the page on screen. No filters clears all.
   */
  purge: (filters: { before?: string; module?: string; action?: string; search?: string } = {}) =>
    api.delete<{ deleted: number }>(`/api/audit-logs${buildQuery(filters)}`),
};
