import { getDb } from "../db";
import { loadSettings } from "../settings";
import { CHANNELS, renderTemplate } from "../../utils/messaging";
import {
  StaffNotificationKind, StaffSkipReason, StaffSmsSettings,
  normalizeMobile, staffRecipientRefusal, staffSmsRefusal, staffTemplateFor,
} from "../../utils/staffNotifications";
import { queueMessage } from "./messaging/messageService";

/**
 * Texting a colleague the work that has just been handed to them.
 *
 * Two events, both of which mean «a person gave this to you by name»: a task
 * assigned to somebody, and a referral raised for them in a project's feed. A
 * sales follow-up is not one of them and neither are the category notices —
 * `staffSmsRefusal` is the rule and says why for each.
 *
 * Sent through `queueMessage`, which is the only way anything leaves this
 * application: the same outbox, the same quiet hours (a task assigned at
 * midnight arrives at eight, rather than waking somebody or being dropped), the
 * same dry-run switch to try it without spending anything, and the same
 * retries. There is no second sending path here and there must not be one.
 *
 * **Every caller is inside `afterCommit`.** A gateway that is down, a provider
 * row nobody has filled in, a number that turns out not to be a number — none
 * of those may fail the save that assigned the work. The task exists, the board
 * shows it, and the text is the part that can be missing.
 */

export interface StaffNotificationInput {
  kind: StaffNotificationKind;
  assigneeUserId: string | null | undefined;
  /** Whoever handed it over; null when an automation did and nobody acted. */
  actorUserId: string | null | undefined;
  actorName?: string | null;
  /** The task's title, or the message that named somebody. */
  title: string;
  taskKind?: string | null;
  dueDate?: string | null;
  priority?: string | null;
  projectId?: string | null;
  projectCode?: string | null;
  projectName?: string | null;
  /** `task` or `referral`, and its id — so the outbox row says what it was about. */
  entityType: string;
  entityId: string;
}

export interface StaffNotificationOutcome {
  queued: boolean;
  skipped?: StaffSkipReason;
}

/**
 * Queues one staff notification, or explains why it did not.
 *
 * Reports the reason rather than throwing: «this person has no mobile on their
 * account» is an ordinary answer and is fixed on the users screen, not a fault
 * in the save that triggered it.
 */
export async function notifyStaffBySms(
  input: StaffNotificationInput,
): Promise<StaffNotificationOutcome> {
  const db = getDb();
  const settings = await loadSettings() as {
    messaging?: { staffSms?: StaffSmsSettings };
    companyInfo?: { name?: string };
  } | undefined;
  const staff = settings?.messaging?.staffSms;

  /*
   * The refusals that need no account, before the account is read.
   *
   * The follow-up exclusion in particular: `completeFollowUp` raises a chase
   * several times a day per salesperson, and every one would otherwise cost a
   * user lookup for a message that is never sent.
   */
  const refusal = staffSmsRefusal(
    {
      kind: input.kind,
      assigneeUserId: input.assigneeUserId,
      actorUserId: input.actorUserId,
      taskKind: input.taskKind,
    },
    staff,
  );
  if (refusal) return { queued: false, skipped: refusal };

  const assignee = await db.user.findUnique({
    where: { id: String(input.assigneeUserId) },
    select: { id: true, fullName: true, isActive: true, mobile: true },
  });
  const recipientRefusal = staffRecipientRefusal(assignee);
  if (recipientRefusal) return { queued: false, skipped: recipientRefusal };

  const recipient = normalizeMobile(assignee?.mobile);
  /*
   * `staffRecipientRefusal` already refused anything this cannot fold, so a
   * null here would mean the two rules disagree rather than that the number is
   * bad — guarded so that disagreement is a silent skip and never a crash
   * inside the save that assigned the work.
   */
  if (!recipient) return { queued: false, skipped: "BAD_MOBILE" };

  /*
   * Presence, not truthiness — `renderTemplate` leaves a placeholder it has no
   * key for exactly as written, so a typo in an edited template is obvious,
   * while a key that is there and empty is substituted. Every variable the
   * palette offers is supplied, empty or not, so a text can never reach a
   * colleague with «{dueDate}» printed in it.
   */
  const body = renderTemplate(staffTemplateFor(input.kind, staff), {
    assigneeName: assignee?.fullName ?? "",
    actorName: input.actorName ?? "یک همکار",
    title: input.title ?? "",
    dueDate: input.dueDate ?? "—",
    priority: input.priority ?? "",
    projectCode: input.projectCode ?? "",
    projectName: input.projectName ?? "",
    companyName: settings?.companyInfo?.name ?? "",
  });

  await queueMessage({
    channel: CHANNELS.SMS,
    recipient,
    recipientName: assignee?.fullName ?? null,
    body,
    projectId: input.projectId ?? null,
    entityType: input.entityType,
    entityId: input.entityId,
    createdByUserId: input.actorUserId ?? null,
    createdByName: input.actorName ?? null,
  });

  return { queued: true };
}
