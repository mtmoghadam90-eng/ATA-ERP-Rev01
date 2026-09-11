/**
 * Telling a colleague about the work that has just been handed to them.
 *
 * The board tells somebody what is on their plate the next time they open it,
 * and the inbox badge counts it — both of which require them to be looking. A
 * request raised at four in the afternoon for a colleague who is at a customer
 * site reaches them the next morning, which is exactly the case a notification
 * exists for. Web Push is not available here (the app is served over plain HTTP
 * on a LAN, and Push needs HTTPS), so the notification goes out through the
 * messaging module that already exists — the same outbox, the same quiet hours,
 * the same dry-run switch and the same retries. There is one sending path and
 * there must not be a second.
 *
 * **Which medium carries it is a choice, and the two are a real trade.** SMS is
 * immediate, costs money by the character and does not care whether the reader
 * has internet; WhatsApp costs nothing per message and travels on the company's
 * own line, which is paced at three a minute on purpose — so a batch of
 * handovers takes a few minutes to reach everybody. `planStaffChannel` is the
 * rule, and the half worth reading is the fallback: a notification that
 * silently evaporates is worse than one that cost a text.
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

import { type Channel, looksLikeMobile } from "./messaging";
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
 * Deliberately **not** the customer-facing list: none of `customerName`,
 * `contactName` or `namePrefix` means anything here, and `namePrefix`
 * especially — «جناب آقای مهندس» is the register of a document that leaves the
 * building and is absurd in a text saying a colleague has handed you a job.
 *
 * That was first read as «a colleague gets no honorific at all», which left
 * `User.gender` with no reader anywhere once the dashboard's greeting dropped
 * to a first name — a field on both user forms writing a column nothing
 * consulted. The register was the thing that was wrong, not the honorific:
 * `assigneePrefix`/`assigneeAddressee` carry the **staff** one («آقای»,
 * «خانم», `STAFF_HONORIFICS`), which is what a person here actually writes to
 * a person. `assigneeName` is untouched beside them, so every template already
 * saved keeps its wording exactly.
 */
export interface StaffVariable {
  key: string;
  label: string;
  sample: string;
}

export const STAFF_VARIABLES: StaffVariable[] = [
  { key: "assigneeName", label: "نام همکار (گیرنده)", sample: "علی رضایی" },
  { key: "assigneePrefix", label: "پیشوند همکار (آقای/خانم)", sample: "آقای" },
  {
    key: "assigneeAddressee",
    label: "خطاب همکار (پیشوند + نام)",
    sample: "آقای علی رضایی",
  },
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
/**
 * The wording the templates carried before the honorific was wired in.
 *
 * Frozen historical values, deliberately written out rather than derived: the
 * `staff-sms-1` patch **copies** the defaults into `settings.messaging.staffSms`
 * the first time it runs, so on every database that has restarted since that
 * shipped the stored wording is what a later edit of `DEFAULT_STAFF_TEMPLATES`
 * can never reach — «a default reaches only a fresh installation», arriving
 * through the door the patch mechanism opened rather than the one it closed.
 *
 * `staff-sms-addressee-1` replaces a stored template **only when it is
 * character-for-character one of these**, which is the same rule
 * `isGeneratedPaymentBody` follows in the proforma notes: a mechanism that
 * manages a piece of text may take back exactly what it put there, and nothing
 * else. Anything anybody has edited stays theirs.
 */
export const SUPERSEDED_STAFF_TEMPLATES: Record<StaffNotificationKind, string[]> = {
  TASK_ASSIGNED: [
    "{actorName} وظیفه‌ای به شما ارجاع داد: {title} | سررسید: {dueDate} | اولویت: {priority}",
  ],
  REFERRAL_RAISED: [
    "{actorName} در پروژه {projectCode} از شما درخواست کرد: {title}",
  ],
};

export const DEFAULT_STAFF_TEMPLATES: Record<StaffNotificationKind, string> = {
  TASK_ASSIGNED: "{assigneeAddressee} عزیز، {actorName} وظیفه‌ای به شما ارجاع داد: {title} | سررسید: {dueDate} | اولویت: {priority}",
  REFERRAL_RAISED: "{assigneeAddressee} عزیز، {actorName} در پروژه {projectCode} از شما درخواست کرد: {title}",
};

/* -------------------------------- the rules ------------------------------- */

export interface StaffNotifySettings {
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
  /**
   * Which medium carries it. **Absent is `SMS`**, which is what every database
   * written before this key existed was doing, so no patch is needed and
   * nothing changes until somebody chooses.
   */
  channel?: StaffChannel;
  /**
   * Whether SMS carries it when WhatsApp cannot. **Absent is on** — see
   * `planStaffChannel` for why that direction.
   */
  fallbackToSms?: boolean;
  templates?: Partial<Record<StaffNotificationKind, string>>;
}

/* ------------------------------- the channel ------------------------------ */

/**
 * The two media a staff notification may travel on.
 *
 * Not the four the customer messaging module has. Email is not a notification —
 * nobody here watches an inbox for a task — and Bale addresses a person by a
 * numeric chat id that has to be obtained from the bot's own updates and typed
 * in per account, which reaches a handful of people. Both of these read the
 * **mobile** that is already on the account, which is what makes offering the
 * choice at all a question of one dropdown rather than a second address book.
 */
export const STAFF_CHANNELS = ["SMS", "WHATSAPP"] as const;
export type StaffChannel = (typeof STAFF_CHANNELS)[number];

export const STAFF_CHANNEL_LABELS: Record<StaffChannel, string> = {
  SMS: "پیامک",
  WHATSAPP: "واتس‌اپ",
};

/**
 * What choosing each one costs, in the panel's own words.
 *
 * The WhatsApp line is paced at three messages a minute by `WHATSAPP_PER_PASS`
 * and `whatsappGapMs`, and that is not a setting — it is what keeps the
 * company's own number off WhatsApp's radar. For a *notification* that pacing
 * is the trade being made, because the whole point of this feature is reaching
 * somebody who is not looking at the board: hand out eight tasks in a batch and
 * the last colleague hears about it two or three minutes later. Worth saying on
 * the screen rather than leaving somebody to discover it.
 */
export const STAFF_CHANNEL_HINTS: Record<StaffChannel, string> = {
  SMS: "فوری و مستقل از اینترنت گیرنده، ولی هر پیام هزینه دارد (فارسی: ۷۰ کاراکتر، بعد هر ۶۷ کاراکتر یک بخش).",
  WHATSAPP: "بدون هزینه پیامک، ولی از خط خودمان و با سرعت عمدی حداکثر ۳ پیام در دقیقه — ارجاع دسته‌جمعی چند دقیقه طول می‌کشد.",
};

/*
 * A staff channel is one of the messaging module's own, never a fifth name.
 *
 * `planStaffChannel`'s answer is handed straight to `queueMessage`, so a value
 * this union carried and `CHANNELS` did not would be an outbox row the
 * dispatcher answers «روش ارسال پشتیبانی نمی‌شود» to — the `PROFORMA_STORED_STATUSES`
 * rule, pinned the same way: at compile time, in the direction that can drift.
 */
type _EveryStaffChannelIsAChannel =
  Exclude<StaffChannel, Channel> extends never ? true
    : ["staff channel the messaging module does not have", Exclude<StaffChannel, Channel>];
const _staffChannelsAreChannels: _EveryStaffChannelIsAChannel = true;
void _staffChannelsAreChannels;

export function staffChannelChoice(
  settings: StaffNotifySettings | null | undefined,
): StaffChannel {
  const stored = settings?.channel;
  return (STAFF_CHANNELS as readonly string[]).includes(String(stored ?? ""))
    ? (stored as StaffChannel)
    : "SMS";
}

export function staffFallsBackToSms(
  settings: StaffNotifySettings | null | undefined,
): boolean {
  return settings?.fallbackToSms !== false;
}

/**
 * Which channel actually carries this one, and whether anything carries it.
 *
 * Written as one object with every key present rather than as a discriminated
 * union, for the reason `RelayAnswer` is: `strictNullChecks` is off in this
 * tsconfig, so TypeScript does not narrow a union by its literal discriminant
 * and the obvious shape simply does not compile here.
 */
export interface StaffChannelPlan {
  /** The channel to queue on, or null when nothing is being sent. */
  channel: StaffChannel | null;
  /** True when WhatsApp was asked for and SMS is carrying it instead. */
  fellBack: boolean;
  /** Why nothing is being sent, or null. */
  skipped: StaffSkipReason | null;
}

/**
 * The chosen channel, or what stands in for it.
 *
 * **The fallback is the half that matters.** This whole feature exists so that
 * somebody at a customer site learns a job was handed to them — so a WhatsApp
 * notification that silently evaporates because nobody ever switched that
 * channel on, or because the line is unlinked, is worse than the feature not
 * existing: the board still shows the task, and everyone involved believes the
 * colleague was told. So `fallbackToSms` is **absent = on**: the cost of the
 * fallback is one text message in the rare case the line is down, and the cost
 * of not having it is a handover nobody knows about.
 *
 * It is a switch rather than a law, because a company that chose WhatsApp
 * precisely to stop paying for texts is entitled to say «then send nothing» —
 * and when they do, the refusal is **named** (`WHATSAPP_OFF`) rather than being
 * a silent nothing, which is the same distinction every other skip reason here
 * draws.
 *
 * `whatsappReady` is the provider row's own `active` flag and deliberately
 * **not** the socket's liveness: asking whether a device is linked is an HTTP
 * round trip to the relay for every task anybody assigns, inside `afterCommit`,
 * and a line that is momentarily down is a transient the outbox already retries
 * like any other failed send. What this catches is the configuration-shaped
 * failure — the channel was never set up, or somebody switched it off — which
 * is the one that lasts.
 */
export function planStaffChannel(
  settings: StaffNotifySettings | null | undefined,
  whatsappReady: boolean,
): StaffChannelPlan {
  if (staffChannelChoice(settings) === "SMS") {
    return { channel: "SMS", fellBack: false, skipped: null };
  }
  if (whatsappReady) return { channel: "WHATSAPP", fellBack: false, skipped: null };
  if (staffFallsBackToSms(settings)) {
    return { channel: "SMS", fellBack: true, skipped: null };
  }
  return { channel: null, fellBack: false, skipped: "WHATSAPP_OFF" };
}

export function staffTemplateFor(
  kind: StaffNotificationKind,
  settings: StaffNotifySettings | null | undefined,
): string {
  const stored = settings?.templates?.[kind];
  return typeof stored === "string" && stored.trim()
    ? stored
    : DEFAULT_STAFF_TEMPLATES[kind];
}

export function staffNotifyEnabled(settings: StaffNotifySettings | null | undefined): boolean {
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
  | "BAD_MOBILE"
  | "WHATSAPP_OFF";

export const STAFF_SKIP_LABELS: Record<StaffSkipReason, string> = {
  DISABLED: "اعلان ارجاع کار به همکاران خاموش است.",
  NO_RECIPIENT: "این کار به حساب کاربری مشخصی ارجاع نشده است.",
  SELF: "کاری که خود شخص برای خودش ثبت کرده اعلان ندارد.",
  FOLLOW_UP: "پیگیری فروش اعلان ندارد؛ در روز سررسید روی تخته کار می‌آید.",
  INACTIVE: "حساب کاربری گیرنده غیرفعال است.",
  /*
   * Both channels are addressed by the mobile on the account, which is why
   * these two say «موبایل» and not «پیامک»: switching to WhatsApp does not
   * make a missing number reachable, and the fix is the same users screen.
   */
  NO_MOBILE: "شماره موبایلی برای این کاربر ثبت نشده است.",
  BAD_MOBILE: "شماره ثبت‌شده برای این کاربر یک موبایل معتبر نیست.",
  WHATSAPP_OFF: "کانال واتس‌اپ فعال نیست و جایگزینی با پیامک خاموش است.",
};

export interface StaffNotifySubject {
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
 * What the message is written to, as opposed to whether it may be sent.
 *
 * Separate from `StaffRecipient` on purpose: that one is the refusal rules, and
 * a missing gender is not a refusal — an account that has not said is addressed
 * by its bare name and the text goes out exactly as before.
 */
export interface StaffAddressee {
  fullName: string | null;
  gender: string | null;
}

/**
 * The refusals that need no account, so the account is not read for them.
 *
 * Split from the recipient's own checks deliberately: `completeFollowUp` raises
 * a chase several times a day per salesperson, and every one of them would
 * otherwise cost a user lookup for a message that is never sent.
 */
export function staffNotifyRefusal(
  subject: StaffNotifySubject,
  settings: StaffNotifySettings | null | undefined,
): StaffSkipReason | null {
  if (!staffNotifyEnabled(settings)) return "DISABLED";

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
export function staffNotifySkipReason(
  subject: StaffNotifySubject,
  account: StaffRecipient | null | undefined,
  settings: StaffNotifySettings | null | undefined,
): StaffSkipReason | null {
  return staffNotifyRefusal(subject, settings) ?? staffRecipientRefusal(account);
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
