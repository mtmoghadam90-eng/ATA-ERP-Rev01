import { getDb } from "../db";
import { loadSettings } from "../settings";
import { CHANNELS, renderTemplate } from "../../utils/messaging";
import { staffAddresseeOf, staffPrefixFor } from "../../utils/honorific";
import {
  StaffChannel, StaffNotificationKind, StaffSkipReason, StaffNotifySettings,
  normalizeMobile, planStaffChannel, staffChannelChoice, staffRecipientRefusal,
  staffNotifyRefusal, staffTemplateFor,
} from "../../utils/staffNotifications";
import { channelIsActive, queueMessage } from "./messaging/messageService";

/**
 * Texting a colleague the work that has just been handed to them.
 *
 * Two events, both of which mean «a person gave this to you by name»: a task
 * assigned to somebody, and a referral raised for them in a project's feed. A
 * sales follow-up is not one of them and neither are the category notices —
 * `staffNotifyRefusal` is the rule and says why for each.
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
  /** Which medium carried it, so a caller and the tests can see the fallback. */
  channel?: StaffChannel;
  /** True when WhatsApp was chosen and SMS carried it instead. */
  fellBack?: boolean;
}

/**
 * Queues one staff notification, or explains why it did not.
 *
 * Reports the reason rather than throwing: «this person has no mobile on their
 * account» is an ordinary answer and is fixed on the users screen, not a fault
 * in the save that triggered it.
 */
export async function notifyStaff(
  input: StaffNotificationInput,
): Promise<StaffNotificationOutcome> {
  const db = getDb();
  const settings = await loadSettings() as {
    messaging?: { staffSms?: StaffNotifySettings };
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
  const refusal = staffNotifyRefusal(
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
    /*
     * `gender` is here for the honorific and nowhere else. It is deliberately
     * out of `DIRECTORY_SELECT` — a colleague's gender is not something every
     * account may enumerate through the assignment pickers, the same rule
     * `mobile` beside it follows — so this projection asks for it by name.
     */
    select: { id: true, fullName: true, isActive: true, mobile: true, gender: true },
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
   * Which medium, and whether anything at all.
   *
   * The provider row is read **only when WhatsApp is the choice**, because the
   * default is SMS and this runs on every task anybody assigns; asking a
   * question whose answer cannot change the outcome is a query per save for
   * nothing. `channelIsActive` is the worker's own reading of that flag, so
   * «is this channel on» has one answer rather than two.
   */
  const choice = staffChannelChoice(staff);
  const plan = planStaffChannel(
    staff,
    choice === "WHATSAPP" ? await channelIsActive(CHANNELS.WHATSAPP) : false,
  );
  if (!plan.channel) return { queued: false, skipped: plan.skipped ?? "DISABLED" };

  /*
   * Presence, not truthiness — `renderTemplate` leaves a placeholder it has no
   * key for exactly as written, so a typo in an edited template is obvious,
   * while a key that is there and empty is substituted. Every variable the
   * palette offers is supplied, empty or not, so a text can never reach a
   * colleague with «{dueDate}» printed in it.
   */
  const body = renderTemplate(staffTemplateFor(input.kind, staff), {
    assigneeName: assignee?.fullName ?? "",
    /*
     * The staff register, never the customer one: «آقای رضایی» and not «جناب
     * آقای مهندس رضایی», which is what a proforma says and is absurd in a text
     * about a task. An account whose gender nobody filled in resolves to the
     * bare name, so the message reads exactly as it did before this existed.
     */
    assigneePrefix: staffPrefixFor(assignee?.gender),
    assigneeAddressee: staffAddresseeOf(assignee?.gender, assignee?.fullName),
    actorName: input.actorName ?? "یک همکار",
    title: input.title ?? "",
    dueDate: input.dueDate ?? "—",
    priority: input.priority ?? "",
    projectCode: input.projectCode ?? "",
    projectName: input.projectName ?? "",
    companyName: settings?.companyInfo?.name ?? "",
  });

  /*
   * One address for both. `whatsappJid` folds «09121234567» exactly as the SMS
   * gateway wants it, so the normalised number is what each of them is handed —
   * there is no second address book and nothing per-channel to keep in step.
   */
  await queueMessage({
    channel: plan.channel,
    recipient,
    recipientName: assignee?.fullName ?? null,
    body,
    projectId: input.projectId ?? null,
    entityType: input.entityType,
    entityId: input.entityId,
    createdByUserId: input.actorUserId ?? null,
    createdByName: input.actorName ?? null,
  });

  return { queued: true, channel: plan.channel, fellBack: plan.fellBack };
}
