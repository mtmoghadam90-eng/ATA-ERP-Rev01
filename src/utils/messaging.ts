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
} as const;

export type Channel = typeof CHANNELS[keyof typeof CHANNELS];

export const CHANNEL_LABELS: Record<Channel, string> = {
  SMS: "پیامک",
  BALE: "بله",
  EMAIL: "ایمیل",
};

/** Every channel, in the order the screens list them. */
export const ALL_CHANNELS: Channel[] = [CHANNELS.SMS, CHANNELS.BALE, CHANNELS.EMAIL];

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

/** What each channel needs from a contact. */
export function addressFor(
  candidate: RecipientCandidate | null | undefined,
  channel: Channel,
): string | null {
  if (!candidate) return null;
  const value = channel === CHANNELS.SMS ? candidate.mobile
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

/** True for something typed in as an Iranian mobile number. */
export const looksLikeMobile = (value: string | null | undefined): boolean =>
  /^(\+?98|0)?9\d{9}$/.test(String(value ?? "").replace(/[\s-]/g, ""));

export function resolveRecipient(
  candidates: (RecipientCandidate | null | undefined)[],
  channel: Channel | null | undefined,
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
    const address = addressFor(person, channel);
    if (address) {
      return {
        recipient: { channel, address, name: person.name?.trim() || null },
        problem: null,
      };
    }
  }

  return { recipient: null, problem: "NO_ADDRESS" };
}
