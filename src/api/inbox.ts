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

/**
 * One gesture in the referral thread, which is three operations on the server.
 *
 * A reply, a status change and a reassignment each have their own rule about
 * who may do them, so they stay three routes — but they are always issued in
 * this order and with these arguments, and the referrals screen and the
 * project's activity feed both need exactly that. A second copy of the order is
 * how one screen comes to reopen a referral without saying why.
 *
 * `silent` on the status change, because the reply already told the other party
 * and told them the part that matters. `andForwarded` for the same reason: the
 * forwarding is what puts the thread in the next person's inbox.
 */
export interface ReferralReply {
  text: string;
  attachment?: { name: string; size: string; content?: string } | null;
  outcome?: "none" | "done" | "reopen";
  forwardToUserId?: string;
}

export async function submitReferralReply(
  referralId: string,
  body: ReferralReply,
): Promise<"sent" | "status-only" | "nothing"> {
  const forwardTo = body.forwardToUserId || undefined;
  const attachment = body.attachment ?? null;
  const outcome = body.outcome ?? "none";
  let text = body.text.trim();

  if (!text && !attachment && !forwardTo) {
    // A bare «done» or «reopen» is a legitimate thing to press; anything else
    // with nothing in it is not.
    if (outcome === "none") return "nothing";
    await inboxApi.setReferralStatus(
      referralId, outcome === "done" ? "انجام شده" : "در انتظار اقدام");
    return "status-only";
  }

  if (forwardTo && !text) text = "ارجاع به همکار";

  await inboxApi.replyToReferral(referralId, {
    text,
    attachmentName: attachment?.name ?? null,
    attachmentSize: attachment?.size ?? null,
    attachmentUrl: attachment?.content ?? null,
    andForwarded: !!forwardTo,
  });

  // Forwarding sets its own status, so an outcome only applies without it.
  if (outcome === "done" && !forwardTo) {
    await inboxApi.setReferralStatus(referralId, "انجام شده", true);
  } else if (outcome === "reopen" && !forwardTo) {
    await inboxApi.setReferralStatus(referralId, "در انتظار اقدام", true);
  }
  if (forwardTo) await inboxApi.reassignReferral(referralId, forwardTo);

  return "sent";
}

export const inboxApi = {
  /** `scope` picks the tab: what was asked of me, or what I asked of others. */
  referrals: (
    query: Record<string, string | number | undefined>,
    signal?: AbortSignal,
  ) => api.get<ListResponse<ReferralRow>>("/api/referrals", query, signal),

  /**
   * Moves a referral between "awaiting action" and "done".
   *
   * `silent` suppresses the status notice, for when a reply was posted in the
   * same action — that reply notifies the other party already, and with the
   * message in it rather than just the fact of a change.
   */
  setReferralStatus: (id: string, status: string, silent = false) =>
    api.put<Record<string, never>>(`/api/referrals/${id}/status`, { status, silent }),

  /**
   * Corrects what the referral asks for.
   *
   * Refused for anyone but the person who raised it — the assignee rewriting
   * their own instructions is how a referral comes to be marked done against a
   * request nobody made.
   */
  updateReferralAction: (id: string, actionRequired: string) =>
    api.put<Record<string, never>>(`/api/referrals/${id}/action`, { actionRequired }),

  /** Hands the thread to someone else and puts it back into "awaiting action". */
  reassignReferral: (id: string, assignedToUserId: string) =>
    api.put<Record<string, never>>(`/api/referrals/${id}/assignee`, { assignedToUserId }),

  replyToReferral: (
    id: string,
    body: {
      text: string;
      attachmentName?: string | null;
      attachmentSize?: string | null;
      attachmentUrl?: string | null;
      /** True when the same action hands the referral on, so no notice is raised. */
      andForwarded?: boolean;
    },
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
