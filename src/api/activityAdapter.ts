import type {
  ProjectActivity,
  ProjectCategoryGroup,
  ProjectReferral,
  ProjectReferralResponse,
} from "../types";
import type {
  ActivityReferralMessageRow,
  ActivityReferralRow,
  ActivityRow,
  CategoryGroupRow,
} from "./projects";
import { parseAttachments } from "../utils/attachments";

/**
 * Translation between the activity/referral API and the `ProjectCategoryGroup`
 * shape the projects feed was written against — the same kind of seam as
 * `projectAdapter`, and equally temporary.
 *
 * The differences are all deliberate on the server side: dates are a DATE plus a
 * Jalali string (the view reads the string), attachments are three columns and a
 * hosted URL rather than an inline data URL, and the referral's parties are
 * foreign keys with the display name carried alongside.
 */

/** A file column trio -> the `{ name, size, content }` the markup renders. */
function toAttachment(
  name: string | null,
  size: string | null,
  url: string | null,
): { name: string; size: string; content?: string } | null {
  if (!name) return null;
  return { name, size: size ?? "", content: url ?? undefined };
}

function messageToView(msg: ActivityReferralMessageRow): ProjectReferralResponse {
  return {
    id: msg.id,
    text: msg.text,
    responder: msg.responderName ?? "",
    responderUserId: msg.responderUserId,
    createdAt: msg.createdAt,
    attachment: toAttachment(msg.attachmentName, msg.attachmentSize, msg.attachmentUrl),
  };
}

function referralToView(ref: ActivityReferralRow): ProjectReferral {
  const messages = ref.messages.map(messageToView);
  return {
    id: ref.id,
    assignedTo: ref.assignedToName ?? "",
    assignedBy: ref.assignedByName ?? "",
    // The identities, so the activity feed can offer the same reply, close and
    // reopen the referrals screen does — decided by account, never by name.
    assignedToUserId: ref.assignedToUserId,
    assignedByUserId: ref.assignedByUserId,
    actionRequired: ref.actionRequired ?? "",
    createdAt: ref.createdAt,
    status: (ref.status as ProjectReferral["status"]) ?? "در انتظار اقدام",
    // The view prefers `messages`; `response` is only the empty-list fallback.
    response: messages.length ? messages[messages.length - 1] : null,
    messages,
  };
}

function activityToView(act: ActivityRow): ProjectActivity {
  /*
   * The JSON column when it has anything, the three original columns
   * otherwise — never both, since the first entry of the list *is* what those
   * columns hold and reading both would show the first file twice.
   */
  const attachments = parseAttachments(act.attachments, {
    name: act.attachmentName, size: act.attachmentSize, url: act.attachmentUrl,
  });
  return {
    id: act.id,
    text: act.text,
    createdAt: act.createdAt,
    createdBy: act.authorName ?? undefined,
    attachment: toAttachment(act.attachmentName, act.attachmentSize, act.attachmentUrl),
    attachments,
    referral: act.referral ? referralToView(act.referral) : null,
  };
}

/** A category group with its feed, in the shape the modal's markup expects. */
export function groupToView(row: CategoryGroupRow): ProjectCategoryGroup {
  return {
    id: row.id,
    projectId: row.projectId,
    categoryId: row.categoryId,
    categoryName: row.categoryName,
    status: (row.status as ProjectCategoryGroup["status"]) ?? "جاری",
    startDate: row.startDateJalali ?? "",
    endDate: row.endDateJalali ?? null,
    activities: (row.activities ?? []).map(activityToView),
  };
}
