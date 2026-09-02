/**
 * Texting a colleague the work that has just been handed to them.
 *
 * The board tells somebody what is on their plate the next time they open it,
 * and the inbox badge counts it — both of which require them to be looking. A
 * request raised at four in the afternoon for a colleague who is at a customer
 * site reaches them the next morning, which is exactly the case a notification
 * exists for. Web Push is not available here (the app is served over plain HTTP
 * on a LAN, and Push needs HTTPS), and the SMS channel is already built, paid
 * for and driving customer messages — so the notification is an SMS through the
 * same outbox, with the same quiet hours, the same dry-run switch and the same
 * retries.
 *
 * ## What is deliberately not sent
 *
 * **A sales follow-up is never texted.** It is not work somebody handed you: it
 * is a call you agreed to make, it sits in «در انتظار مشتری» until its own day
 * and arrives in «در حال انجام» on the morning it is due, on the board that
 * person is already looking at. A text for every chase would be several a day
 * per salesperson, all of them about things they scheduled themselves, and the
 * cost of that is that the ones about a colleague's request stop being read.
 *
 * **The category notices are never texted either.** «بار از گمرک ترخیص شد» is
 * worth knowing and is not a request to anybody — that is the whole reason
 * `activityRecipients` exists as a separate, quieter path — so it stays in the
 * inbox where it was put.
 *
 * That leaves exactly two events, and both have the same shape: somebody has
 * been *given* something to do, by a person, by name.
 */

import { looksLikeMobile } from "./messaging";
import { FOLLOW_UP_KIND } from "./salesFollowUp";

/** The two events worth interrupting somebody's afternoon for. */
export const STAFF_NOTIFICATION_KINDS = ["TASK_ASSIGNED", "REFERRAL_RAISED"] as const;
export type StaffNotificationKind = (typeof STAFF_NOTIFICATION_KINDS)[number];

export const STAFF_NOTIFICATION_LABELS: Record<StaffNotificationKind, string> = {
  TASK_ASSIGNED: "ارجاع وظیفه به همکار",
  REFERRAL_RAISED: "ارجاع کار در فید پروژه",
};

/* ------------------------------- the wording ------------------------------ */

/**
 * The placeholders a staff message may use.
 *
 * The same shape as `MESSAGE_VARIABLES` and for the same reason: the palette on
 * the settings screen and the preview beside it both render from this one list,
 * and `test:rules` holds it against the keys the service actually fills in —
 * both ways, since a name offered here that nothing supplies renders as a
 * placeholder in a real text message, and one supplied but not offered is a
 * variable nobody can discover.
 *
 * Deliberately **not** the customer-facing list: a colleague is not addressed
 * as «جناب آقای مهندس», and none of `customerName`, `contactName` or
 * `namePrefix` means anything here.
 */
export interface StaffVariable {
  key: string;
  label: string;
  sample: string;
}

export const STAFF_VARIABLES: StaffVariable[] = [
  { key: "assigneeName", label: "نام همکار (گیرنده)", sample: "علی رضایی" },
  { key: "actorName", label: "نام ارجاع‌دهنده", sample: "مهندس احمدی" },
  { key: "title", label: "عنوان کار یا متن ارجاع", sample: "ارسال دیتاشیت فلومتر به مشتری" },
  { key: "dueDate", label: "تاریخ سررسید", sample: "1405/06/12" },
  { key: "priority", label: "اولویت", sample: "بالا" },
  { key: "projectCode", label: "کد پروژه", sample: "ATA-1405-018" },
  { key: "projectName", label: "نام پروژه", sample: "تامین ابزار دقیق واحد ۳" },
  { key: "companyName", label: "نام شرکت ما", sample: "ابزار تامین آرشیا" },
];

export const STAFF_SAMPLE_VALUES: Record<string, string> =
  Object.fromEntries(STAFF_VARIABLES.map((v) => [v.key, v.sample]));

/**
 * The wording, before anybody edits it.
 *
 * Short on purpose. Persian SMS is UCS-2, so a message is 70 characters and
 * then 67 per part — this is money, not decoration — and the text has one job:
 * say who asked, for what, and by when, well enough that the reader knows
 * whether to open the application now or after lunch.
 *
 * A blank line is deliberately avoided: some gateways normalise it away and the
 * part count then differs between the preview and what arrives.
 */
export const DEFAULT_STAFF_TEMPLATES: Record<StaffNotificationKind, string> = {
  TASK_ASSIGNED: "{actorName} وظیفه‌ای به شما ارجاع داد: {title} | سررسید: {dueDate} | اولویت: {priority}",
  REFERRAL_RAISED: "{actorName} در پروژه {projectCode} از شما درخواست کرد: {title}",
};

/* -------------------------------- the rules ------------------------------- */

export interface StaffSmsSettings {
  /**
   * Absent is **on**.
   *
   * `settings` is one JSON row seeded once, so a default added to `seedData`
   * reaches a fresh installation and no other — and this feature was asked for,
   * so a live database that has never heard of the key must behave as though it
   * is switched on. `settingsPatches` writes the key in explicitly the first
   * time it runs, which is what makes a later, deliberate `false` stick.
   */
  enabled?: boolean;
  templates?: Partial<Record<StaffNotificationKind, string>>;
}

export function staffTemplateFor(
  kind: StaffNotificationKind,
  settings: StaffSmsSettings | null | undefined,
): string {
  const stored = settings?.templates?.[kind];
  return typeof stored === "string" && stored.trim()
    ? stored
    : DEFAULT_STAFF_TEMPLATES[kind];
}

export function staffSmsEnabled(settings: StaffSmsSettings | null | undefined): boolean {
  return settings?.enabled !== false;
}

/**
 * Why nobody is being texted, or null when somebody is.
 *
 * A named reason rather than a boolean, because every one of these is a
 * different thing to say to whoever asks why a colleague was not told — and
 * two of them ("no mobile on the account", "the number is not a mobile") are
 * the ones that will actually happen and are fixed on the users screen.
 */
export type StaffSkipReason =
  | "DISABLED"
  | "NO_RECIPIENT"
  | "SELF"
  | "FOLLOW_UP"
  | "INACTIVE"
  | "NO_MOBILE"
  | "BAD_MOBILE";

export const STAFF_SKIP_LABELS: Record<StaffSkipReason, string> = {
  DISABLED: "ارسال پیامک به همکاران خاموش است.",
  NO_RECIPIENT: "این کار به حساب کاربری مشخصی ارجاع نشده است.",
  SELF: "کاری که خود شخص برای خودش ثبت کرده پیامک ندارد.",
  FOLLOW_UP: "پیگیری فروش پیامک ندارد؛ در روز سررسید روی تخته کار می‌آید.",
  INACTIVE: "حساب کاربری گیرنده غیرفعال است.",
  NO_MOBILE: "شماره موبایلی برای این کاربر ثبت نشده است.",
  BAD_MOBILE: "شماره ثبت‌شده برای این کاربر یک موبایل معتبر نیست.",
};

export interface StaffSmsSubject {
  kind: StaffNotificationKind;
  /** The account the work was given to. */
  assigneeUserId: string | null | undefined;
  /** Whoever handed it over. Null when an automation did. */
  actorUserId: string | null | undefined;
  /** GENERAL or SALES_FOLLOW_UP — only meaningful for a task. */
  taskKind?: string | null;
}

/** What the account itself says, once it has been read. */
export interface StaffRecipient {
  isActive: boolean;
  mobile: string | null;
}

/**
 * The refusals that need no account, so the account is not read for them.
 *
 * Split from the recipient's own checks deliberately: `completeFollowUp` raises
 * a chase several times a day per salesperson, and every one of them would
 * otherwise cost a user lookup for a message that is never sent.
 */
export function staffSmsRefusal(
  subject: StaffSmsSubject,
  settings: StaffSmsSettings | null | undefined,
): StaffSkipReason | null {
  if (!staffSmsEnabled(settings)) return "DISABLED";

  /*
   * A chase is not work somebody handed you. It is a call you agreed to make,
   * it sits in «در انتظار مشتری» until its day, and it arrives in «در حال
   * انجام» on the morning it is due — on the board that person already has
   * open. Texting every one of them is several a day about things they
   * scheduled themselves, and that is how the ones that matter stop being read.
   */
  if (subject.kind === "TASK_ASSIGNED" && String(subject.taskKind ?? "") === FOLLOW_UP_KIND) {
    return "FOLLOW_UP";
  }

  if (!subject.assigneeUserId) return "NO_RECIPIENT";
  /*
   * Never to the person who did it. Half the tasks on this system are things
   * people log for themselves, and `notifyUser` already makes the same
   * exception for the same reason.
   */
  if (subject.assigneeUserId === subject.actorUserId) return "SELF";

  return null;
}

/**
 * What the recipient's own account says.
 *
 * A stored assignee is not rewritten when somebody leaves, so «is this account
 * still active» is asked on the way out and not only when the work was
 * assigned — the same rule `activityRecipients` follows for the same reason.
 */
export function staffRecipientRefusal(
  account: StaffRecipient | null | undefined,
): StaffSkipReason | null {
  if (!account) return "NO_RECIPIENT";
  if (!account.isActive) return "INACTIVE";

  const mobile = String(account.mobile ?? "").trim();
  if (!mobile) return "NO_MOBILE";
  if (!looksLikeMobile(mobile)) return "BAD_MOBILE";

  return null;
}

/** Both halves, for a caller that already holds the account — and for the tests. */
export function staffSmsSkipReason(
  subject: StaffSmsSubject,
  account: StaffRecipient | null | undefined,
  settings: StaffSmsSettings | null | undefined,
): StaffSkipReason | null {
  return staffSmsRefusal(subject, settings) ?? staffRecipientRefusal(account);
}

/**
 * The number as a gateway wants it: 09121234567.
 *
 * People type `+98 912 123 4567`, `0912-1234567` and `9121234567`, and all
 * three are the same phone. Normalised where it is *sent* rather than where it
 * is stored, so what somebody typed is still what the users screen shows them.
 */
export function normalizeMobile(value: string | null | undefined): string | null {
  const digits = String(value ?? "").replace(/[\s()-]/g, "");
  const match = /^(?:\+?98|0)?(9\d{9})$/.exec(digits);
  return match ? `0${match[1]}` : null;
}
