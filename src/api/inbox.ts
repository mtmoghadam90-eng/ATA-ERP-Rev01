import { ListResponse, api } from "./client";

/**
 * The signed-in user's inbox: referrals, notices, and what has been seen.
 *
 * Everything here is scoped to the caller by the server — their id goes into
 * the query rather than filtering the result — so none of these calls take a
 * user. That is also the fix for two things the document store got wrong:
 * notices were addressed by display name, and "read" was one shared array for
 * the whole company.
 */

export interface ReferralMessageRow {
  id: string;
  text: string;
  responderUserId: string | null;
  responderName: string | null;
  attachmentName: string | null;
  attachmentSize: string | null;
  attachmentUrl: string | null;
  createdAt: string;
}

export interface ReferralRow {
  id: string;
  activityId: string;
  status: string;
  actionRequired: string | null;
  assignedToUserId: string | null;
  assignedToName: string | null;
  assignedByUserId: string | null;
  assignedByName: string | null;
  createdAt: string;
  messages: ReferralMessageRow[];
  activity: {
    id: string;
    text: string;
    createdAt: string;
    group: {
      id: string;
      categoryName: string;
      project: {
        id: string;
        code: string;
        name: string;
        customer: { id: string; companyName: string } | null;
      } | null;
    } | null;
  } | null;
}

export interface NotificationRow {
  id: string;
  module: string;
  title: string;
  description: string;
  projectId: string | null;
  isRead: boolean;
  createdAt: string;
}

export const inboxApi = {
  /** `scope` picks the tab: what was asked of me, or what I asked of others. */
  referrals: (
    query: Record<string, string | number | undefined>,
    signal?: AbortSignal,
  ) => api.get<ListResponse<ReferralRow>>("/api/referrals", query, signal),

  setReferralStatus: (id: string, status: string) =>
    api.put<Record<string, never>>(`/api/referrals/${id}/status`, { status }),

  /** Hands the thread to someone else and puts it back into "awaiting action". */
  reassignReferral: (id: string, assignedToUserId: string) =>
    api.put<Record<string, never>>(`/api/referrals/${id}/assignee`, { assignedToUserId }),

  replyToReferral: (
    id: string,
    body: { text: string; attachmentName?: string | null; attachmentSize?: string | null; attachmentUrl?: string | null },
  ) => api.post<{ message: ReferralMessageRow }>(`/api/referrals/${id}/messages`, body).then((r) => r.message),

  /** Notices, plus the unread total — which spans every notice, not the page. */
  notifications: (query: Record<string, string | number | undefined>, signal?: AbortSignal) =>
    api.get<ListResponse<NotificationRow> & { unread: number }>("/api/notifications", query, signal),

  markNotificationRead: (id: string) =>
    api.put<Record<string, never>>(`/api/notifications/${id}/read`, {}),

  markAllNotificationsRead: () =>
    api.post<{ marked: number }>("/api/notifications/read-all", {}),

  /** Which of these the caller has already seen. */
  readReceipts: (itemIds: string[], signal?: AbortSignal) =>
    itemIds.length === 0
      ? Promise.resolve([] as string[])
      : api.get<{ read: string[] }>("/api/read-receipts", { ids: itemIds.join(",") }, signal)
          .then((r) => r.read),

  markItemsRead: (itemIds: string[]) =>
    api.post<{ marked: number }>("/api/read-receipts", { itemIds }).then((r) => r.marked),
};
