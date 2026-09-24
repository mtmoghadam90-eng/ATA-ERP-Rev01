/**
 * The rules behind sending a customer a message.
 *
 * Everything here is pure — no database, no clock of its own, no network — so
 * `test:rules` can hold it. The parts that talk to a provider live in
 * `src/server/services/messaging/`, and the parts that decide *when* to fire
 * live in the workflow engine, which already existed: this module is only the
 * arithmetic and the guardrails between "a rule matched" and "a message went".
 */

/* ------------------------------- channels -------------------------------- */

export const CHANNELS = {
  SMS: "SMS",
  BALE: "BALE",
  EMAIL: "EMAIL",
  /**
   * The company's own WhatsApp line, as a linked device.
   *
   * A **channel** rather than a field of another one, which is the opposite of
   * the decision taken for Kavenegar: which SMS panel carries a text is an
   * implementation detail of «پیامک», so a second channel there would have
   * meant rewriting every template and losing the outbox history the day the
   * company changed panels. WhatsApp is a different medium — its own address,
   * its own templates, its own history, and messages written for it read
   * nothing like an SMS, which is charged by the character.
   *
   * See `src/utils/whatsapp.ts` for what it costs to use a personal line this
   * way, and why its pacing is not a setting.
   */
  WHATSAPP: "WHATSAPP",
  /**
   * The company's own Telegram account, as a logged-in session.
   *
   * The same decision as WhatsApp's and for the same reason — a medium with its
   * own address, its own history and its own register, not a field of another
   * channel — and, like it, deliberately **not** the bot API: a bot cannot write
   * to somebody who has not written to it first, which is every customer, and a
   * message from `@ata_bot` is not a message from the company. So this is the
   * account the sales desk already uses, logged in the way Telegram Desktop logs
   * in, and the socket is held on the same relay WhatsApp's is.
   *
   * See `src/utils/telegram.ts` for what that costs and why its pacing is not a
   * setting either.
   */
  TELEGRAM: "TELEGRAM",
} as const;

export type Channel = typeof CHANNELS[keyof typeof CHANNELS];

export const CHANNEL_LABELS: Record<Channel, string> = {
  SMS: "پیامک",
  BALE: "بله",
  EMAIL: "ایمیل",
  WHATSAPP: "واتس‌اپ",
  TELEGRAM: "تلگرام",
};

/** Every channel, in the order the screens list them. */
export const ALL_CHANNELS: Channel[] = [
  CHANNELS.SMS, CHANNELS.WHATSAPP, CHANNELS.TELEGRAM, CHANNELS.BALE, CHANNELS.EMAIL,
];

export const isChannel = (value: unknown): value is Channel =>
  typeof value === "string" && (ALL_CHANNELS as string[]).includes(value);

/* ------------------------------- statuses -------------------------------- */

export const MESSAGE_STATUS = {
  /** Waiting for its scheduled time, or for the next attempt. */
  QUEUED: "QUEUED",
  SENT: "SENT",
  /** Every attempt used up. Kept, so somebody can see what failed and why. */
  FAILED: "FAILED",
  /** A person stopped it before it went. */
  CANCELLED: "CANCELLED",
} as const;

export type MessageStatus = typeof MESSAGE_STATUS[keyof typeof MESSAGE_STATUS];

export const STATUS_LABELS: Record<MessageStatus, string> = {
  QUEUED: "در صف ارسال",
  SENT: "ارسال شده",
  FAILED: "ناموفق",
  CANCELLED: "لغو شده",
};

/* ------------------------------ SMS panels ------------------------------- */

/**
 * Which panel the SMS channel talks to.
 *
 * The **channel** is the medium — a text message, a Bale message, an email —
 * and it is the identity of a provider row, of a template and of a recipient's
 * address. The **panel** is who carries the text message for us, which is a
 * different question and one a company answers once and occasionally changes.
 * Folding the two together (a fourth channel called «کاوه‌نگار») would mean
 * every template written for SMS had to be written again, `resolveRecipient`
 * would have a fourth address to look for, and a company changing panels would
 * lose its outbox history under the old name.
 *
 * So the panel is a *field of the SMS configuration*, and **absent means
 * MeliPayamak** — every configuration stored before this existed is one, and
 * reading absent as anything else would silently stop a working installation.
 *
 * The two panels are not the same shape and cannot be reached by editing a URL:
 * MeliPayamak authenticates with a panel username and password in a JSON body
 * and answers with a numeric code, while Kavenegar authenticates with an API
 * key **in the path**, takes a form-encoded body and answers with a
 * `{ return: { status, message } }` envelope. That is why this is a catalogue
 * and not a setting.
 */

export const SMS_PROVIDERS = {
  MELIPAYAMAK: "MELIPAYAMAK",
  KAVENEGAR: "KAVENEGAR",
} as const;

export type SmsProvider = typeof SMS_PROVIDERS[keyof typeof SMS_PROVIDERS];

export interface SmsProviderField {
  key: string;
  label: string;
  /** Never returned to a client; a blank box on save means «unchanged». */
  secret?: boolean;
  /** Without this, nothing can be sent and the driver refuses before the call. */
  required?: boolean;
  hint?: string;
}

export interface SmsProviderSpec {
  id: SmsProvider;
  label: string;
  /** Every configuration key this panel reads, in the order the form draws them. */
  fields: SmsProviderField[];
  /**
   * What `apiUrl` is left blank for.
   *
   * Note the two are not the same **kind** of address, which is the one trap
   * here: MeliPayamak's is the complete endpoint a request is posted to, while
   * Kavenegar's is a *base* the key and the method are appended to
   * (`…/v1/{apiKey}/sms/send.json`). `kavenegarSendUrl` is what closes that.
   */
  defaultUrl: string;
}

export const SMS_PROVIDER_SPECS: Record<SmsProvider, SmsProviderSpec> = {
  MELIPAYAMAK: {
    id: "MELIPAYAMAK",
    label: "ملی پیامک (و پنل‌های هم‌شکل)",
    fields: [
      { key: "username", label: "نام کاربری پنل", required: true },
      { key: "password", label: "رمز عبور پنل", secret: true, required: true },
      { key: "senderNumber", label: "شماره فرستنده", required: true },
      {
        key: "apiUrl",
        label: "آدرس سرویس (اختیاری)",
        hint: "آدرس کامل متد ارسال. خالی بگذارید تا از آدرس ملی پیامک استفاده شود.",
      },
    ],
    defaultUrl: "https://rest.payamak-panel.com/api/SendSMS/SendSMS",
  },
  KAVENEGAR: {
    id: "KAVENEGAR",
    label: "کاوه‌نگار",
    fields: [
      {
        key: "apiKey",
        label: "کلید API",
        secret: true,
        required: true,
        hint: "از پنل کاوه‌نگار، بخش «تنظیمات ← حساب کاربری» برداشته می‌شود.",
      },
      {
        key: "senderNumber",
        label: "شماره خط فرستنده (اختیاری)",
        hint: "خالی بگذارید تا خط پیش‌فرض حساب کاوه‌نگار استفاده شود.",
      },
      {
        key: "apiUrl",
        label: "آدرس سرویس (اختیاری)",
        hint: "فقط آدرس پایه، بدون کلید و متد. خالی بگذارید تا https://api.kavenegar.com/v1 استفاده شود.",
      },
    ],
    defaultUrl: "https://api.kavenegar.com/v1",
  },
};

/** Every panel, in the order the settings screen offers them. */
export const ALL_SMS_PROVIDERS: SmsProvider[] = [
  SMS_PROVIDERS.MELIPAYAMAK,
  SMS_PROVIDERS.KAVENEGAR,
];

/**
 * Every configuration key any panel reads.
 *
 * The stored configuration is one JSON document per channel, so switching
 * panels leaves the other panel's fields in it — deliberately, because
 * switching back must not mean typing the credentials in again.
 */
export const ALL_SMS_CONFIG_FIELDS: string[] = [
  "provider",
  ...[...new Set(ALL_SMS_PROVIDERS.flatMap((p) => SMS_PROVIDER_SPECS[p].fields.map((f) => f.key)))],
];

/** Every key that must never be returned to a client, across all panels. */
export const ALL_SMS_SECRET_FIELDS: string[] = [
  ...new Set(
    ALL_SMS_PROVIDERS.flatMap((p) =>
      SMS_PROVIDER_SPECS[p].fields.filter((f) => f.secret).map((f) => f.key)),
  ),
];

export const isSmsProvider = (value: unknown): value is SmsProvider =>
  typeof value === "string" && (ALL_SMS_PROVIDERS as string[]).includes(value);

/**
 * The panel a stored configuration names. Absent — or unknown — is MeliPayamak.
 *
 * The argument is `unknown` because that is what it honestly is: one JSON
 * document read back out of the provider row, whose shape this build cannot
 * promise. A value from an older or newer build falls back rather than throwing.
 */
export function smsProviderOf(config: unknown): SmsProvider {
  const stored = (config as { provider?: unknown } | null | undefined)?.provider;
  return isSmsProvider(stored) ? stored : SMS_PROVIDERS.MELIPAYAMAK;
}

export function smsProviderSpec(config: unknown): SmsProviderSpec {
  return SMS_PROVIDER_SPECS[smsProviderOf(config)];
}

/**
 * Why this panel cannot send anything yet, or null.
 *
 * Names the field rather than saying «تنظیمات کامل نیست», because the two
 * panels want different things and somebody who has just switched panels is
 * looking at a form where the box they filled in yesterday is no longer there.
 */
export function smsConfigRefusal(
  config: Record<string, unknown> | null | undefined,
): string | null {
  const spec = smsProviderSpec(config);
  const missing = spec.fields
    .filter((f) => f.required && !String(config?.[f.key] ?? "").trim())
    .map((f) => f.label);
  if (missing.length === 0) return null;
  return `تنظیمات پنل «${spec.label}» کامل نیست: ${missing.join("، ")}.`;
}

/**
 * The sender line, as the panel wants to read it back.
 *
 * The number is copied off the panel's own «مدیریت خطوط» page, which prints it
 * in **Persian digits** — and a panel handed «۰۰۱۸۰۱۸۹۴۹۱۶۱» does not recognise
 * its own line, refusing it as an invalid sender. That refusal names the
 * sender, so it reads as the line not belonging to the account rather than as
 * the digits being the wrong alphabet, and there is nothing on either screen to
 * suggest otherwise.
 *
 * Only the digits and the spacing are touched. Leading zeros are kept, because
 * an international line genuinely begins `00`, and nothing else is stripped
 * because some accounts send from an alphabetic sender id rather than a number.
 */
export function normalizeSenderLine(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/\s+/g, "")
    .trim();
}

/**
 * Where a Kavenegar send is posted.
 *
 * The key is part of the **path**, not a header and not a body field, so the
 * address cannot simply be stored whole — and the field beside it is labelled
 * «آدرس پایه», which somebody will inevitably paste a complete URL into. A URL
 * that already ends in `.json` is taken as it stands: the person pasted the
 * finished thing, key and all, and rewriting it would be this function
 * outsmarting them.
 */
export function kavenegarSendUrl(base: string | null | undefined, apiKey: string): string {
  const trimmed = String(base ?? "").trim().replace(/\/+$/, "")
    || SMS_PROVIDER_SPECS.KAVENEGAR.defaultUrl;
  if (/\.json$/i.test(trimmed)) return trimmed;
  return `${trimmed}/${encodeURIComponent(apiKey)}/sms/send.json`;
}
/* ----------------------------- SMS length -------------------------------- */

/**
 * How many parts a text message will be billed as.
 *
 * Persian is outside GSM-7, so a Persian SMS is sent as UCS-2: **70**
 * characters in one part, and **67** each once it splits, because a multipart
 * message spends the rest of that space on the header that reassembles it.
 * Latin-only text gets the GSM-7 allowance of 160 and 153 instead.
 *
 * This is on the screen because it is money: a template that runs three
 * characters over the limit costs twice as much to send, every time, and
 * nothing else in the form would ever say so.
 */
export interface SmsLength {
  characters: number;
  parts: number;
  /**
   * How many more characters fit before the next part starts.
   *
   * Named for what it counts. `remaining` alone reads as an unpaid balance
   * everywhere else in this codebase, and the fa-IR digit guard in `test:rules`
   * correctly flagged it as an amount being formatted in Persian digits.
   */
  charactersLeft: number;
  /** True when the text needs the 70/67 allowance rather than 160/153. */
  unicode: boolean;
}

export function smsLength(text: string | null | undefined): SmsLength {
  const body = String(text ?? "");
  // Any character outside Latin-1 forces UCS-2 for the whole message — one
  // Persian letter in an otherwise English template is enough.
  const unicode = /[^ -ÿ]/.test(body);
  const single = unicode ? 70 : 160;
  const multi = unicode ? 67 : 153;

  const characters = [...body].length;
  if (characters === 0) return { characters: 0, parts: 0, charactersLeft: single, unicode };

  if (characters <= single) {
    return { characters, parts: 1, charactersLeft: single - characters, unicode };
  }

  const parts = Math.ceil(characters / multi);
  return { characters, parts, charactersLeft: parts * multi - characters, unicode };
}

/* ------------------------------- variables ------------------------------- */

/**
 * Every value a template may refer to, in one list.
 *
 * The screen's palette used to be a hand-written line of names, so a variable
 * the server started providing was invisible to the people writing templates —
 * `namePrefix` was added and nothing said so. `test:rules` reads
 * `messageVariables` in the service and fails when the two sides disagree in
 * either direction: a name offered here that nothing fills in would render as
 * blank, and one filled in there but missing here would never be used.
 *
 * The samples are what the preview renders against. They are deliberately
 * believable rather than «مقدار نمونه» — the point of the preview is to see the
 * message the customer will see, spacing and length included.
 */
export interface MessageVariable {
  key: string;
  label: string;
  sample: string;
}

export const MESSAGE_VARIABLES: MessageVariable[] = [
  { key: "namePrefix", label: "پیشوند نام بر اساس جنسیت", sample: "جناب آقای مهندس" },
  { key: "addressee", label: "پیشوند به همراه نام مخاطب", sample: "جناب آقای مهندس رضایی" },
  { key: "customerName", label: "نام مشتری", sample: "شرکت پتروشیمی نمونه" },
  { key: "contactName", label: "نام مخاطب پیام", sample: "علی رضایی" },
  { key: "projectCode", label: "کد پروژه", sample: "PRJ-1405-018" },
  { key: "projectName", label: "نام پروژه", sample: "تامین شیرآلات واحد ۳" },
  { key: "projectStatus", label: "وضعیت پروژه", sample: "برنده" },
  /*
   * The quotation the message is about, and it is **named or absent** — never
   * inferred from the project.
   *
   * A job here legitimately carries several live proformas at once (the
   * temperature instruments, the pressure instruments, the flow meters) and
   * several revisions of each, so «the project's proforma» is not a thing that
   * exists: picking the latest would print one document's number in a message
   * about another, to the customer, with nothing on any screen saying so. So
   * `messageVariables` fills it in only when a proforma is actually named, and
   * a template using it in a context with none prints the token as written —
   * the same rule `projectCode` already follows for a message with no project,
   * and the same reason `renderTemplate` leaves an absent key standing.
   */
  { key: "proformaNumber", label: "شماره پیش‌فاکتور", sample: "ATA-05-38-P1" },
  { key: "companyName", label: "نام شرکت ما", sample: "ابزار تامین آرشیا" },
  { key: "today", label: "تاریخ امروز", sample: "1405/06/01" },
];

/** The samples as `renderTemplate` wants them. */
export const SAMPLE_VARIABLE_VALUES: Record<string, string> =
  Object.fromEntries(MESSAGE_VARIABLES.map((v) => [v.key, v.sample]));

/* ------------------------------- templates ------------------------------- */

/**
 * Fills `{{name}}` (or `{name}`) from the values a trigger carries.
 *
 * A placeholder the values **do not have a key for** is left exactly as
 * written rather than blanked. A message reading «سلام {{customerNam}}» is
 * obviously a broken template; one reading «سلام » looks like a customer with
 * no name and gets sent.
 *
 * A key that *is* present and empty is a different thing and is substituted:
 * the honorific of a company, or of a person whose gender was never recorded,
 * is legitimately nothing, and leaving `{namePrefix}` standing in the text
 * would put the placeholder itself in front of a customer. Presence, not
 * truthiness, is what separates "nobody filled this in" from "there is nothing
 * to say here".
 */
export function renderTemplate(
  template: string | null | undefined,
  values: Record<string, unknown> | null | undefined,
): string {
  if (!template) return "";
  const data = values ?? {};
  return String(template).replace(/\{{1,2}([^{}]+)\}{1,2}/g, (whole, key) => {
    const name = String(key).trim();
    if (!(name in data)) return whole;
    const value = data[name];
    return value === undefined || value === null ? "" : String(value);
  });
}

/** Placeholders a template uses, so the editor can show what it needs. */
export function templateVariables(template: string | null | undefined): string[] {
  if (!template) return [];
  const found = new Set<string>();
  for (const match of String(template).matchAll(/\{{1,2}([^{}]+)\}{1,2}/g)) {
    found.add(String(match[1]).trim());
  }
  return [...found];
}

/* ------------------------------ quiet hours ------------------------------ */

/**
 * Holds a message until the company is willing to have it arrive.
 *
 * A rule that fires at 02:00 — a nightly sweep, a status changed by somebody
 * working late — must not wake a customer up. The message is not dropped; it
 * waits for the window to open, which is why this returns a time rather than a
 * yes or no.
 *
 * `from`/`to` are "HH:MM" and the window is allowed to wrap midnight (22:00 to
 * 08:00 is the useful case, and a naive comparison gets it backwards).
 * Anything unparseable means no quiet hours are configured, and the message
 * goes when it was going to.
 */
export interface QuietHours {
  from?: string | null;
  to?: string | null;
}

const parseHhMm = (value: string | null | undefined): number | null => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? "").trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
};

export function isWithinQuietHours(when: Date, quiet: QuietHours | null | undefined): boolean {
  const from = parseHhMm(quiet?.from);
  const to = parseHhMm(quiet?.to);
  if (from === null || to === null || from === to) return false;

  const minutes = when.getHours() * 60 + when.getMinutes();
  // A window that wraps midnight is two ranges, not one.
  return from < to ? minutes >= from && minutes < to : minutes >= from || minutes < to;
}

/**
 * The moment a message may actually be sent, given the quiet window.
 *
 * Returns `when` untouched outside quiet hours. Inside them it returns the
 * start of the next allowed minute — today if the window has not wrapped past
 * it, tomorrow if it has.
 */
export function nextAllowedSendTime(when: Date, quiet: QuietHours | null | undefined): Date {
  if (!isWithinQuietHours(when, quiet)) return when;

  const to = parseHhMm(quiet?.to);
  if (to === null) return when;

  const opensAt = new Date(when);
  opensAt.setHours(Math.floor(to / 60), to % 60, 0, 0);
  // Already past today's opening means we are in the small hours of a window
  // that started yesterday evening — the next opening is still ahead of us.
  if (opensAt <= when) opensAt.setDate(opensAt.getDate() + 1);
  return opensAt;
}

/**
 * How far ahead the search for a sendable day may go.
 *
 * `MAX_WORKING_DAY_SPAN`'s rule: a loop over «is this day quiet» has to stop.
 * A holiday calendar imported wrong — or a company that has marked every day —
 * would otherwise spin on the server's event loop for ever with no error. Two
 * weeks is past Nowruz, which is the longest run of non-working days in the
 * year, so no real answer reaches it.
 */
export const MAX_QUIET_DAY_SPAN = 30;

/**
 * The moment a message may actually be sent, given the quiet window **and the
 * quiet days**.
 *
 * «جمعه و روزهای تعطیل رسمی نباید به مشتری پیام زد» — and a day is not a
 * second kind of quiet hour: an hour moves a message by hours, a day moves it
 * past a date, and the two compose. Thursday at 22:00 with quiet hours of
 * 21:00–08:00 is first pushed to Friday at 08:00 by the hours, and Friday is a
 * quiet day, so it goes on to Saturday at 08:00. Applying either rule alone
 * gets that wrong, which is why this is a loop rather than two steps.
 *
 * `isQuietDay` is **injected** rather than read here: the holiday calendar
 * lives in a process cache that this module deliberately knows nothing about,
 * and a predicate is what lets `test:rules` hold the composition without one.
 * Absent means no day is quiet, which is every installation until somebody
 * switches it on.
 *
 * A quiet day is left at **midnight** before the hours are re-applied, so the
 * message lands at the opening hour of the first day that allows it rather
 * than at the hour it happened to be queued.
 */
export function nextSendableTime(
  when: Date,
  quiet: QuietHours | null | undefined,
  isQuietDay?: ((day: Date) => boolean) | null,
): Date {
  let at = nextAllowedSendTime(when, quiet);
  if (!isQuietDay) return at;

  for (let guard = 0; guard < MAX_QUIET_DAY_SPAN; guard += 1) {
    if (!isQuietDay(at)) return at;
    const nextDay = new Date(at);
    nextDay.setDate(nextDay.getDate() + 1);
    nextDay.setHours(0, 0, 0, 0);
    at = nextAllowedSendTime(nextDay, quiet);
  }
  /*
   * Every day inside the horizon was quiet, which is a calendar somebody has
   * to look at rather than a message to hold for ever. Answering with the last
   * moment considered sends it, late, and leaves the row visible in the outbox.
   */
  return at;
}

/**
 * Who a message is addressed to, for the one rule that reads it.
 *
 * Absent means the customer, because that is the reading a forgotten key must
 * fall to: a quotation follow-up slipping out on Ashura — or reaching nobody at
 * all because a dry run was left on — is the fault those switches exist to
 * prevent, while a handover notice held back is only late.
 */
export const MESSAGE_AUDIENCES = ["CUSTOMER", "STAFF"] as const;
export type MessageAudience = (typeof MESSAGE_AUDIENCES)[number];

/**
 * Whether the company-wide sending holds apply to a message.
 *
 * **One fact, two consequences**, which is why this is named for the fact. The
 * quiet **days** and the **dry-run** switch are both company-wide «do not send»
 * rules written about the people outside the company, and a colleague being
 * handed a job is not one of them:
 *
 * - «جمعه و تعطیل رسمی نباید به مشتری پیام زد» is a courtesy, and holding a
 *   handover until Saturday morning is how a request raised from a customer's
 *   site arrives after the visit it was about.
 * - «حالت آزمایشی» exists to try a rule out *without writing to a customer*, so
 *   a notice telling a colleague their plate has changed should still arrive —
 *   otherwise somebody who forgets to switch it off has a week of handovers
 *   evaporating while the board looks perfectly correct, which is the «feature
 *   that silently does nothing» fault in its most expensive form.
 *
 * Two predicates with one body would be the `digitsOf` fault in miniature: the
 * next audience value, or a third hold, would be added to one and not the
 * other. If the two ever genuinely need to disagree, that is the moment to
 * split this — and the type-checker names both call sites when it happens.
 *
 * The quiet **hours** are deliberately *not* one of these holds and apply to
 * both audiences: a task assigned at 03:00 reaching a phone at 08:00 is exactly
 * what that window was written for, and nobody wants to be woken by the board.
 *
 * These are rules rather than two more switches on the settings document: a
 * company that wanted its colleagues silenced on a holiday would be asking for
 * the board to go quiet too, which no screen here offers.
 */
export function isCustomerFacing(audience: MessageAudience | null | undefined): boolean {
  return audience !== "STAFF";
}

/* -------------------------------- retries -------------------------------- */

/** Attempts before a message is given up on and marked failed. */
export const MAX_SEND_ATTEMPTS = 4;

/**
 * How long to wait before trying again, in milliseconds.
 *
 * Backs off — 1, 5, 15 minutes — because the failures worth retrying are
 * transient: a timeout, a gateway restart, a provider rate limit. Hammering a
 * provider that is refusing us is how an account gets blocked.
 */
export function retryDelayMs(attempts: number): number {
  const minutes = [1, 5, 15];
  const index = Math.max(0, Math.min(attempts - 1, minutes.length - 1));
  return minutes[index] * 60 * 1000;
}

export function shouldRetry(attempts: number, maxAttempts = MAX_SEND_ATTEMPTS): boolean {
  return attempts < maxAttempts;
}

/* ------------------------------- recipients ------------------------------ */

/**
 * Who a message goes to, and on which channel.
 *
 * The project names a contact and a preferred channel; the customer is the
 * fallback for anything the project does not answer. Both are checked against
 * what the chosen channel actually needs — a preferred channel of SMS is no use
 * without a mobile number, and silently sending nothing is worse than saying
 * so.
 */
export interface RecipientCandidate {
  name?: string | null;
  mobile?: string | null;
  email?: string | null;
  baleChatId?: string | null;
  /** True when this person has asked not to be contacted. */
  doNotContact?: boolean | null;
}

export interface ResolvedRecipient {
  channel: Channel;
  address: string;
  name: string | null;
}

export type RecipientProblem =
  | "NO_CONTACT"
  | "OPTED_OUT"
  | "NO_ADDRESS"
  | "NO_CHANNEL";

export interface RecipientResult {
  recipient: ResolvedRecipient | null;
  problem: RecipientProblem | null;
}

export const RECIPIENT_PROBLEM_LABELS: Record<RecipientProblem, string> = {
  NO_CONTACT: "گیرنده‌ای برای این پیام مشخص نشده است.",
  OPTED_OUT: "این مخاطب دریافت پیام را لغو کرده است.",
  NO_ADDRESS: "اطلاعات تماس لازم برای این روش ارسال ثبت نشده است.",
  NO_CHANNEL: "روش ارسال مشخص نشده است.",
};

/* ------------------- communication method → send channel ------------------ */

/**
 * The send channel a project's «روش ارتباط اصلی» implies, or "" for the default.
 *
 * The communication method is how the customer talks to us, and a customer who
 * talks to us on WhatsApp, Bale, Telegram or email is best written to there — so a new project
 * picks its «روش ارسال ترجیحی» from it rather than leaving the default a person
 * then has to remember to change. Anything else answers "" (the SMS default),
 * which is what the field has always meant when nobody chose.
 *
 * The list is the company's own editable one, so it is read by its **words**,
 * folded for ی/ي, ک/ك, the half-space and case: «واتس اپ», «واتساپ» and
 * «WhatsApp» are one answer. «بله» is matched as a whole word only, because it
 * is also an ordinary Persian word that can sit inside a longer one.
 */
export function channelForCommunicationMethod(method: string | null | undefined): Channel | "" {
  const text = String(method ?? "")
    .replace(/ي/g, "ی").replace(/ك/g, "ک")
    // A half-space separates two words, so it becomes a boundary rather than
    // nothing: «پیام‌رسان‌بله» folded to one run would hide «بله» inside it.
    .replace(/\u200c/g, " ")
    .toLowerCase().trim();
  if (!text) return "";
  if (/واتس|whats\s*app/.test(text.replace(/\s+/g, ""))) return CHANNELS.WHATSAPP;
  if (/(^|[^\p{L}])(بله|bale)($|[^\p{L}])/u.test(text)) return CHANNELS.BALE;
  if (/تلگرام|telegram/.test(text)) return CHANNELS.TELEGRAM;
  if (/ایمیل|email|e-mail|پست\s*الکترونیک/.test(text)) return CHANNELS.EMAIL;
  return "";
}

/* ------------------------------ Bale: two doors ---------------------------- */

/**
 * How Bale is reached, and the two answers are different addresses.
 *
 * `BOT` is the bot API (`tapi.bale.ai`): it writes only to somebody who has
 * started the bot, by a numeric chat id nobody can read off their own screen —
 * so it reaches the handful of people somebody typed an id in for. `SAFIR` is
 * Bale's business messaging service («سفیر»): it writes to a **mobile number**,
 * which every customer record already carries, so it addresses the directory as
 * it stands. A mode of the one channel rather than a sixth channel, for the
 * reason Kavenegar is a field of «پیامک»: the templates, the outbox history and
 * the medium the customer reads it in are Bale's either way.
 *
 * **Absent — or unknown — is BOT**, which is what every configuration stored
 * before this existed means, so nothing moves until somebody picks Safir.
 */
export const BALE_MODES = { BOT: "BOT", SAFIR: "SAFIR" } as const;
export type BaleMode = typeof BALE_MODES[keyof typeof BALE_MODES];

export const BALE_MODE_LABELS: Record<BaleMode, string> = {
  BOT: "ربات بله (شناسه گفتگو)",
  SAFIR: "سفیر بله (شماره موبایل)",
};

export function baleModeOf(config: unknown): BaleMode {
  const stored = (config as { mode?: unknown } | null | undefined)?.mode;
  return stored === BALE_MODES.SAFIR ? BALE_MODES.SAFIR : BALE_MODES.BOT;
}

/** Safir's send endpoint, as the dashboard prints it. */
export const SAFIR_SEND_URL = "https://safir.bale.ai/api/v3/send_message";

/**
 * The request Safir is posted, or a refusal naming what is missing.
 *
 * Pure, so `test:rules` can hold the exact wire shape the dashboard documents —
 * `bot_id` as a **number**, the phone as `98…` digits with no `+`, the text
 * under `message_data.message.text` — without a network. The phone goes through
 * `internationalDigits`, the one reading every messenger here uses, so a number
 * written `0912…`, `+98 912…` or in Persian digits reaches Safir as the same
 * twelve digits, and one that is not a mobile is refused here rather than sent
 * to be refused there.
 */
/**
 * Both keys always present, because `strict` is off here and a discriminated
 * union does not narrow (see `RelayAnswer` in `whatsappTransport.ts`).
 */
export interface SafirRequest {
  error: string | null;
  apiKey: string;
  body: {
    request_id?: string;
    bot_id: number;
    phone_number: string;
    message_data: { message: { text: string } };
  } | null;
}

export function safirRequest(
  config: { safirBotId?: unknown; safirApiKey?: unknown } | null | undefined,
  recipient: string | null | undefined,
  text: string,
  /** The outbox row id — Safir sends a repeated `request_id` once. */
  requestId?: string | null,
): SafirRequest {
  const apiKey = String(config?.safirApiKey ?? "").trim();
  const botIdText = digitsOf(String(config?.safirBotId ?? ""));
  if (!apiKey || !botIdText) {
    const missing = [!botIdText && "شناسه بازو (Bot_id)", !apiKey && "کلید دسترسی (api-access-key)"]
      .filter(Boolean).join(" و ");
    return { error: `تنظیمات سفیر بله کامل نیست: ${missing}.`, apiKey: "", body: null };
  }
  const phone = internationalDigits(recipient);
  // Safir takes only Iranian numbers: 98 and ten digits, nothing else.
  if (!phone || !/^989\d{9}$/.test(phone)) {
    return {
      error: `«${String(recipient ?? "").trim() || "—"}» شماره موبایل معتبری نیست؛ سفیر بله با شماره موبایل پیام می‌فرستد.`,
      apiKey: "",
      body: null,
    };
  }
  return {
    error: null,
    apiKey,
    body: {
      ...(requestId ? { request_id: String(requestId) } : {}),
      bot_id: Number(botIdText),
      phone_number: phone,
      message_data: { message: { text } },
    },
  };
}

/** What each channel needs from a contact. */
export function addressFor(
  candidate: RecipientCandidate | null | undefined,
  channel: Channel,
  /**
   * Bale through Safir is addressed by the mobile, not the chat id. Told by the
   * caller rather than read here, because the mode lives on the provider row
   * and this function is pure.
   */
  options: { baleByPhone?: boolean } = {},
): string | null {
  if (!candidate) return null;
  /*
   * WhatsApp reads the **mobile number**, which is the whole practical
   * difference between it and Bale: a Bale chat id has to be obtained from the
   * bot's own updates and typed in per contact, so that channel reaches only
   * the handful of people somebody has done that for. Every customer record
   * here already carries a mobile, so WhatsApp can address the directory as it
   * stands — and `whatsappJid` is what decides whether a particular one is
   * really addressable, rather than this returning a number the socket cannot
   * use.
   */
  const value = channel === CHANNELS.SMS || channel === CHANNELS.WHATSAPP
    || channel === CHANNELS.TELEGRAM
    || (channel === CHANNELS.BALE && options.baleByPhone) ? candidate.mobile
    : channel === CHANNELS.EMAIL ? candidate.email
      : candidate.baleChatId;
  const text = String(value ?? "").trim();
  return text || null;
}

/**
 * Whether a value is something Bale will actually deliver to.
 *
 * Bale's bot API mirrors Telegram's: `chat_id` is either the **numeric** id of
 * a chat the bot is already part of, or `@name` for a public channel. A phone
 * number is neither, and never resolves to one — the API answers "no such group
 * or user", which reads as a fault in this system rather than as the wrong kind
 * of value. So the mobile number is recognised here and named, because it is the
 * mistake everybody makes first: a customer has a phone number, the field asks
 * for a way to reach them, and nothing on either screen says the two are
 * unrelated.
 */
export const isBaleChatId = (value: string | null | undefined): boolean => {
  const text = String(value ?? "").trim();
  /*
   * No leading zero, and that is what separates the two cases rather than a
   * length rule: an account id is a counter and never starts with one, while
   * every Iranian mobile written the way people write it does. `9121234567` —
   * the same number with the zero left off — is genuinely ambiguous and is
   * allowed through, because it is also a perfectly ordinary account id;
   * Bale answers for that one, and its answer is translated where it is read.
   */
  return /^-?[1-9]\d*$/.test(text) || /^@[A-Za-z0-9_]{3,}$/.test(text);
};

/**
 * A typed number folded to Latin digits — Persian and Arabic included.
 *
 * **One fold for the whole module**, which is the only thing that keeps two
 * channels agreeing about who is reachable. It was written twice — once inside
 * the SMS driver's `normalizeMobile` and once for WhatsApp's JID rule — and two
 * copies of this is how a customer comes to be reachable by text and not on
 * WhatsApp, or the reverse: a number with Persian digits arrives at one channel
 * as `09…` and at the other as nothing, and nobody goes looking because the
 * other message arrived.
 *
 * Only digits survive, so a `+`, a space, a bracket or a dash is dropped rather
 * than being rejected — the callers decide what the resulting digits mean, and
 * `whatsappJid` reads the `+` off the *original* text for precisely that reason.
 */
/** Iran, for a number typed the way people here type one. */
export const IRAN_DIALLING_CODE = "98";

export function digitsOf(raw: string | null | undefined): string {
  return String(raw ?? "")
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/\D/g, "");
}

/**
 * A typed number as the digits a messenger addresses an account by, or null.
 *
 * **One reading of «which numbers this application can write to», for every
 * channel that addresses a person by their phone.** It was `whatsappJid`'s
 * alone, and a second copy inside the Telegram rule would be the `digitsOf`
 * fault one level up: the two would answer differently for a number written
 * `0098912…` or with Persian digits, and a customer would be reachable on one
 * messenger and not the other with nobody going looking, because the other
 * message arrived.
 *
 * Three shapes are accepted and the third is deliberate:
 *
 *  - an Iranian mobile however it is written — `0912…`, `912…`, `98912…`,
 *    `0098912…`, `+98 912 345 6789`, with Persian digits — which is what every
 *    customer record here holds;
 *  - an **international** number written with a leading `+`, because this company
 *    imports and a foreign supplier's number is a real case, and refusing it
 *    would mean a channel silently only worked for half the directory;
 *  - nothing else. A landline, a fragment, a number with too many digits: the
 *    caller is told, because the alternative is a message nobody receives.
 *
 * The answer carries no `+` and no domain — it is the digits, and what to wrap
 * them in is the channel's own question.
 */
export function internationalDigits(raw: string | null | undefined): string | null {
  const text = String(raw ?? "").trim();
  const digits = digitsOf(text);
  if (!digits) return null;

  // Written as an international number: trusted as given, within reason. The
  // ITU caps a subscriber number at 15 digits, and fewer than 8 is not a number
  // anybody can be reached on.
  if (text.startsWith("+")) {
    return digits.length >= 8 && digits.length <= 15 ? digits : null;
  }

  // Iranian mobile, in the four ways it arrives. Every one of them is the same
  // ten digits starting with 9, with a different prefix in front.
  const national = digits.startsWith(`00${IRAN_DIALLING_CODE}`) ? digits.slice(4)
    : digits.startsWith(IRAN_DIALLING_CODE) && digits.length === 12 ? digits.slice(2)
      : digits.startsWith("0") ? digits.slice(1)
        : digits;

  if (!/^9\d{9}$/.test(national)) return null;
  return `${IRAN_DIALLING_CODE}${national}`;
}

/** True for something typed in as an Iranian mobile number. */
export const looksLikeMobile = (value: string | null | undefined): boolean =>
  /^(\+?98|0)?9\d{9}$/.test(String(value ?? "").replace(/[\s-]/g, ""));

export function resolveRecipient(
  candidates: (RecipientCandidate | null | undefined)[],
  channel: Channel | null | undefined,
  options: { baleByPhone?: boolean } = {},
): RecipientResult {
  if (!isChannel(channel)) return { recipient: null, problem: "NO_CHANNEL" };

  const people = candidates.filter(Boolean) as RecipientCandidate[];
  if (people.length === 0) return { recipient: null, problem: "NO_CONTACT" };

  /*
   * An opt-out on the *first* named contact stops the message.
   *
   * Not "try the next one": falling through to the customer's own number when
   * the person you meant to write to has opted out is how a company keeps
   * texting somebody who asked it to stop, through a different door.
   */
  if (people[0].doNotContact) return { recipient: null, problem: "OPTED_OUT" };

  for (const person of people) {
    if (person.doNotContact) continue;
    const address = addressFor(person, channel, options);
    if (address) {
      return {
        recipient: { channel, address, name: person.name?.trim() || null },
        problem: null,
      };
    }
  }

  return { recipient: null, problem: "NO_ADDRESS" };
}
