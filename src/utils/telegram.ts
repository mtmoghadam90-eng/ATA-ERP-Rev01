/**
 * Sending on the company's **own** Telegram account, as a logged-in session.
 *
 * Not a bot. A bot cannot write to somebody who has not written to it first —
 * which is every customer in the directory — so a bot channel would reach
 * nobody this company needs to reach, and a message from `@ata_bot` is not a
 * message from the company in any case. So this logs in to the account the sales
 * desk already uses, exactly the way Telegram Desktop does: one QR code scanned
 * once from the phone, and thereafter a session this application holds.
 *
 * Everything here is pure — the addressing, the pacing, the words for each
 * connection state, and what a failure means. The session itself is
 * `src/server/services/messaging/telegramClient.ts`, it is reached through
 * `telegramTransport.ts` because it may be held on the relay outside the
 * network, and the queue, the quiet hours, the opt-outs and the retries are the
 * messaging module's, unchanged: this is a fifth channel on a path that already
 * exists, not a second sender.
 *
 * **Three things about this are not software decisions and must stay written
 * down.**
 *
 * A logged-in session is the account itself rather than a bot beside it, so
 * Telegram's limits fall on the company's own number: sending machine-paced
 * messages to people who are not contacts is what earns `PEER_FLOOD`, and that
 * is a restriction on the account, not on this application. That is why the
 * pacing below is far slower than the SMS batch and is not configurable from a
 * screen.
 *
 * `api_id`/`api_hash` are **credentials and live in the environment**, never in
 * `settings` — that document is loaded whole by every browser. A channel that
 * has none is reported as *unconfigured* rather than as disconnected, because
 * those are two different problems for two different people.
 *
 * And **not everyone with a phone number is reachable on Telegram.** A person
 * may not have an account at all, and one who does can forbid being found by
 * their number. Both are named refusals here rather than messages that vanish.
 */

import { internationalDigits } from "./messaging";

/* ------------------------------- addressing ------------------------------- */

/**
 * Who a message is addressed to, or **null**.
 *
 * Null is the important half, for the reason `whatsappJid`'s is: a peer Telegram
 * cannot resolve is not an error the sender sees on their phone — it is a
 * message that was never sent — so a contact detail this cannot make sense of
 * stops the message here and is named.
 *
 * Two shapes, because Telegram genuinely has two addresses:
 *
 *  - a **phone number**, which is what every customer record here already
 *    carries, resolved against Telegram's directory at send time. Telegram's own
 *    default lets anybody find an account this way, so this is the ordinary
 *    case — but it is the account holder's setting and they may close it, which
 *    is the one refusal this channel has that WhatsApp does not;
 *  - a **`@username`**, which is how somebody who has closed that setting, or
 *    who has no number worth writing down, is still reachable. It is accepted in
 *    the same field rather than being given a column of its own: a second
 *    address book is the Bale lesson — a channel that reaches only the handful
 *    of people somebody has filled a box in for.
 *
 * The numbers are `internationalDigits`, which is also what WhatsApp addresses
 * by. Two copies of that fold is how a customer comes to be reachable on one
 * messenger and not the other.
 */
export type TelegramPeer =
  | { kind: "phone"; value: string }
  | { kind: "username"; value: string };

/**
 * Telegram's own shape for a username: five to thirty-two characters, letters,
 * digits and underscores, beginning with a letter. Written out rather than
 * guessed loosely because the cost of accepting one Telegram will not resolve is
 * a message reported as sent that reached nobody.
 */
const USERNAME_RE = /^@?([A-Za-z][A-Za-z0-9_]{3,31})$/;

export function telegramPeer(raw: string | null | undefined): TelegramPeer | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;

  /*
   * A username is recognised **first**, and only when it carries a letter — an
   * all-digit string can never be one, so this cannot swallow a phone number
   * typed without its `+`.
   */
  const named = USERNAME_RE.exec(text);
  if (named) return { kind: "username", value: named[1] };

  const digits = internationalDigits(text);
  return digits ? { kind: "phone", value: `+${digits}` } : null;
}

/** Whether a stored contact detail can be addressed on Telegram at all. */
export const isTelegramAddressable = (raw: string | null | undefined): boolean =>
  telegramPeer(raw) !== null;

/* ------------------------------ configuration ----------------------------- */

/**
 * Why the account credentials cannot be used, or null.
 *
 * `api_id` and `api_hash` come from my.telegram.org and identify the
 * *application*, not the account — but they are still secrets, and a channel
 * without them cannot open a session at all. Reporting that as «قطع شده» would
 * send somebody to check a network that is fine and to re-scan a code that will
 * never appear; it is a configuration fault and is named as one, which is the
 * same distinction `relayConfigRefusal` draws for the relay.
 *
 * Both blank is «this company has not set Telegram up», which is not a fault and
 * is not a refusal — it is what every installation looks like until somebody
 * wants the channel.
 */
export function telegramApiRefusal(
  apiId: string | number | null | undefined,
  apiHash: string | null | undefined,
): string | null {
  const id = String(apiId ?? "").trim();
  const hash = String(apiHash ?? "").trim();
  if (!id && !hash) return null;

  if (!id) {
    return "TELEGRAM_API_ID تنظیم نشده است؛ بدون آن نشست تلگرام باز نمی‌شود.";
  }
  if (!/^\d+$/.test(id)) {
    return "TELEGRAM_API_ID باید عدد باشد؛ مقدار فعلی عدد نیست.";
  }
  if (!hash) {
    return "TELEGRAM_API_HASH تنظیم نشده است؛ بدون آن نشست تلگرام باز نمی‌شود.";
  }
  return null;
}

/** The pair as a usable configuration, or null when nothing is configured. */
export function telegramApiFrom(
  apiId: string | number | null | undefined,
  apiHash: string | null | undefined,
): { apiId: number; apiHash: string } | null {
  if (telegramApiRefusal(apiId, apiHash)) return null;
  const id = Number(String(apiId ?? "").trim());
  const hash = String(apiHash ?? "").trim();
  if (!id || !hash) return null;
  return { apiId: id, apiHash: hash };
}

/* ------------------------------- connection ------------------------------- */

/**
 * Where the session stands.
 *
 * The same five WhatsApp has, deliberately: the two channels are the same shape
 * of thing — a personal account this application borrows — and a person reading
 * the settings screen should not have to learn two vocabularies for one idea.
 * «it used to work and now it does not» is `DISCONNECTED` plus the reason, which
 * the report carries separately.
 */
export const TELEGRAM_STATES = {
  /** No session, or it was signed out. Nothing will send. */
  UNLINKED: "UNLINKED",
  /** A session exists and is connecting. Ordinary, and brief. */
  CONNECTING: "CONNECTING",
  /** A login code is on the screen, waiting to be scanned by the phone. */
  AWAITING_SCAN: "AWAITING_SCAN",
  /** Signed in and connected. The only state that sends. */
  CONNECTED: "CONNECTED",
  /** A session exists, the connection does not, and nobody is being waited on. */
  DISCONNECTED: "DISCONNECTED",
} as const;

export type TelegramState = typeof TELEGRAM_STATES[keyof typeof TELEGRAM_STATES];

export const TELEGRAM_STATE_LABELS: Record<TelegramState, string> = {
  UNLINKED: "حسابی متصل نیست",
  CONNECTING: "در حال اتصال…",
  AWAITING_SCAN: "در انتظار اسکن کد",
  CONNECTED: "متصل",
  DISCONNECTED: "قطع شده",
};

/**
 * What the screen should tell somebody standing in front of this state.
 *
 * The path through the Telegram app is spelled out because it is **not** where
 * anybody looks first: «دستگاه‌ها» rather than anything with the word «اسکن» in
 * it, and the code is scanned from inside that screen rather than by the phone's
 * camera app. A panel that says «در انتظار اسکن کد» and leaves the rest to
 * somebody invites the one thing that makes this worse — pressing «اتصال» again
 * and again, which is itself traffic counted against the account.
 */
export const TELEGRAM_STATE_ADVICE: Record<TelegramState, string> = {
  UNLINKED:
    "برای ارسال از حساب خودتان، «اتصال حساب» را بزنید و کد را با تلگرام گوشی اسکن کنید.",
  CONNECTING: "چند لحظه صبر کنید؛ اتصال در حال برقراری است.",
  AWAITING_SCAN:
    "در تلگرام گوشی: تنظیمات ← دستگاه‌ها ← «اتصال دستگاه دسکتاپ»، و این کد را اسکن کنید.",
  CONNECTED: "پیام‌ها از حساب شما ارسال می‌شوند.",
  DISCONNECTED:
    "اتصال خودش دوباره تلاش می‌کند. اگر برنگشت، یک‌بار «خروج از حساب» و سپس اتصال دوباره.",
};

/** Whether a message may be handed to the session in this state. */
export const telegramCanSend = (state: TelegramState): boolean =>
  state === TELEGRAM_STATES.CONNECTED;

/* --------------------------------- pacing --------------------------------- */

/**
 * How many Telegram messages one pass of the outbox worker may send.
 *
 * The same three a minute WhatsApp is paced at, and the number is the same
 * because the constraint is: a personal account, and traffic that looks
 * machine-made is what costs it. The *failure* differs — Telegram answers
 * `PEER_FLOOD` and stops the account writing to strangers at all, rather than
 * blocking the number outright — which is worse in one way, since it arrives
 * without warning and a screen full of queued messages is the only symptom.
 *
 * It is **not** a setting, for the reason the WhatsApp one is not: everything
 * else about this channel is configurable because the cost of getting it wrong
 * is a message that does not arrive, while the cost of raising this is the
 * account, and a box on a screen is an invitation to raise it the first
 * afternoon somebody is in a hurry.
 */
export const TELEGRAM_PER_PASS = 3;

/** The gap between two Telegram sends, in milliseconds, as a range. */
export const TELEGRAM_GAP_MS = { min: 4_000, max: 10_000 } as const;

/**
 * A gap to wait before the next Telegram send.
 *
 * `random` is an argument rather than a call to `Math.random`, so the rule is
 * deterministic and `test:rules` can hold its bounds. The jitter is the point: a
 * fixed interval is itself a signature.
 */
export function telegramGapMs(random: number): number {
  const r = Math.min(1, Math.max(0, Number.isFinite(random) ? random : 0));
  const { min, max } = TELEGRAM_GAP_MS;
  return Math.round(min + r * (max - min));
}

/**
 * How long Telegram said to wait, in seconds, or null.
 *
 * **This is the one thing Telegram tells you that no other channel here does**,
 * and throwing it away would be the expensive mistake: `FLOOD_WAIT_86400` means
 * a day, and retrying it on the queue's own thirty-second backoff spends every
 * attempt inside the first two minutes and marks a perfectly good message
 * FAILED — then does it again for the next one, and the account's standing gets
 * worse each time. Read, it becomes a `retryAfterMs` the queue honours: the row
 * stays QUEUED, its attempts are not spent, and it goes when the wait is over.
 *
 * Two spellings, because two layers produce it: the wire error is
 * `FLOOD_WAIT_42`, and the library rewrites it as prose.
 */
export function floodWaitSeconds(message: string | null | undefined): number | null {
  const text = String(message ?? "");
  const wire = /FLOOD_WAIT_(\d+)/i.exec(text);
  if (wire) return Number(wire[1]);
  const prose = /wait of (\d+) seconds/i.exec(text);
  if (prose) return Number(prose[1]);
  return null;
}

/**
 * Why a pass is not sending this message, or null.
 *
 * Separate from the state labels because the *queue* stores this on the row and
 * somebody reads it there: «در انتظار اسکن کد» printed against a failed message
 * would read as that message's own fault rather than as the account's.
 */
export function telegramSendRefusal(state: TelegramState): string | null {
  if (telegramCanSend(state)) return null;
  if (state === TELEGRAM_STATES.UNLINKED) {
    return "حساب تلگرام متصل نیست. در تنظیمات پیام‌ها حساب را متصل کنید.";
  }
  if (state === TELEGRAM_STATES.AWAITING_SCAN) {
    return "کد ورود تلگرام هنوز اسکن نشده است.";
  }
  return "اتصال تلگرام در دسترس نیست؛ پیام در صف می‌ماند.";
}

/* ---------------------------- what went wrong ----------------------------- */

/**
 * Which half of the system a failure belongs to.
 *
 * WhatsApp's four plus one that is genuinely Telegram's: being **rate-limited**
 * is not a network fault, not an account fault and not a configuration fault,
 * and it is the only one of the five where the right action is to do nothing.
 * Folding it into any of the others would send somebody to unlink a working
 * session or to check a route that is fine, and both of those make it worse.
 */
export const TELEGRAM_FAILURE_KINDS = {
  /** The route out: filtering, a dead relay, DNS, a timeout. */
  NETWORK: "NETWORK",
  /** The Telegram account: signed out elsewhere, or the session is dead. */
  ACCOUNT: "ACCOUNT",
  /** This application: no api credentials, or a half-configured relay. */
  CONFIG: "CONFIG",
  /** Telegram is holding the account back. Waiting is the whole remedy. */
  FLOOD: "FLOOD",
  /** Nobody could be found at that address. */
  RECIPIENT: "RECIPIENT",
  /** Something this build has not seen. */
  UNKNOWN: "UNKNOWN",
} as const;

export type TelegramFailureKind =
  typeof TELEGRAM_FAILURE_KINDS[keyof typeof TELEGRAM_FAILURE_KINDS];

export const TELEGRAM_FAILURE_LABELS: Record<TelegramFailureKind, string> = {
  NETWORK: "مشکل مسیر شبکه",
  ACCOUNT: "مشکل حساب تلگرام",
  CONFIG: "مشکل تنظیمات",
  FLOOD: "محدودیت موقت تلگرام",
  RECIPIENT: "گیرنده در تلگرام پیدا نشد",
  UNKNOWN: "خطای نامشخص",
};

export const TELEGRAM_FAILURE_ADVICE: Record<TelegramFailureKind, string> = {
  NETWORK:
    "اتصال به تلگرام از این سرور برقرار نشد. اگر تلگرام در دسترس نیست، ارسال باید از رله خارج از کشور انجام شود.",
  ACCOUNT:
    "نشست تلگرام باطل شده یا از «دستگاه‌ها» حذف شده است. یک‌بار «خروج از حساب» و سپس اتصال دوباره با اسکن کد.",
  CONFIG:
    "تنظیمات کامل نیست. TELEGRAM_API_ID و TELEGRAM_API_HASH و در صورت استفاده از رله، آدرس و توکن آن را بررسی کنید.",
  FLOOD:
    "تلگرام ارسال از این حساب را موقتاً محدود کرده است. پیام‌ها در صف می‌مانند و خودشان ارسال می‌شوند؛ دوباره تلاش نکنید و تعداد پیام‌ها را بالا نبرید.",
  RECIPIENT:
    "این شماره در تلگرام حساب ندارد، یا صاحب حساب اجازهٔ پیدا شدن با شماره را بسته است. نام کاربری (@username) او را در همان فیلد بنویسید.",
  UNKNOWN: "متن خطا را به پشتیبانی بدهید.",
};

/**
 * The tokens each kind is recognised by.
 *
 * Written out rather than matched loosely because the strings come from three
 * different places — Node's own socket errors, the MTProto library, and the
 * relay relaying one of those — and a rule broad enough to catch all of them by
 * feel would classify the next unfamiliar message wrongly rather than admitting
 * it.
 */
const NETWORK_TOKENS = [
  "econnreset", "econnrefused", "etimedout", "enotfound", "eai_again", "ehostunreach",
  "enetunreach", "epipe", "socket hang up", "network", "timeout", "aborted",
  "fetch failed", "certificate", "tls", "disconnected",
];

const ACCOUNT_TOKENS = [
  "auth_key_unregistered", "session_revoked", "session_expired", "user_deactivated",
  "auth_key_duplicated", "unauthorized", "unauthorised", "401", "403", "باطل",
];

/** Telegram's own words for «there is nobody at that address». */
const RECIPIENT_TOKENS = [
  "phone_not_occupied", "username_not_occupied", "username_invalid",
  "peer_id_invalid", "user_id_invalid", "contact_id_invalid",
  "no such user", "cannot find any entity",
];

/**
 * Which half a failure message belongs to.
 *
 * **UNKNOWN is an honest answer and not a gap.** Reading an unrecognised message
 * as a network fault would tell somebody to go and check a route that is fine,
 * and reading it as an account fault would tell them to sign out of a perfectly
 * good session — so a message this build cannot place is reported as itself,
 * with the text beside it, which is the one thing that is always true.
 */
export function telegramFailureKind(
  message: string | null | undefined,
): TelegramFailureKind {
  const text = String(message ?? "").toLowerCase();
  if (!text.trim()) return TELEGRAM_FAILURE_KINDS.UNKNOWN;

  /*
   * The flood is asked about **first**, and the order is the decision: a
   * `FLOOD_WAIT` arrives as prose carrying the word «wait», and every other
   * reading of it is wrong in a way that makes the restriction worse — read as
   * the network it invites a retry, read as the account it invites a re-login,
   * and both are more traffic from an account Telegram has just asked to stop.
   */
  if (floodWaitSeconds(text) !== null) return TELEGRAM_FAILURE_KINDS.FLOOD;
  if (text.includes("peer_flood")) return TELEGRAM_FAILURE_KINDS.FLOOD;

  // Then the relay's own credential, for the reason `whatsappFailureKind` asks
  // it early: «unauthorized» read as the account sends somebody to sign out of
  // a working session when the fix is one line in an env file.
  if (text.includes("توکن")) return TELEGRAM_FAILURE_KINDS.CONFIG;
  if (text.includes("telegram_api_id") || text.includes("telegram_api_hash")) {
    return TELEGRAM_FAILURE_KINDS.CONFIG;
  }

  if (RECIPIENT_TOKENS.some((t) => text.includes(t))) return TELEGRAM_FAILURE_KINDS.RECIPIENT;
  if (ACCOUNT_TOKENS.some((t) => text.includes(t))) return TELEGRAM_FAILURE_KINDS.ACCOUNT;
  if (NETWORK_TOKENS.some((t) => text.includes(t))) return TELEGRAM_FAILURE_KINDS.NETWORK;
  if (text.includes("رله")) return TELEGRAM_FAILURE_KINDS.CONFIG;
  return TELEGRAM_FAILURE_KINDS.UNKNOWN;
}
