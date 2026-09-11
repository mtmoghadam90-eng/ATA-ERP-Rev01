/**
 * Sending on the company's **own** WhatsApp line, as a linked device.
 *
 * Not the WhatsApp Business Cloud API: that needs a number registered with Meta,
 * a verified business and message templates approved in advance, and it cannot
 * send from the line the sales desk already uses and customers already have. So
 * this pairs the application to that account the way WhatsApp Web and the
 * desktop app do — a device on the account, authorised by scanning a code once —
 * and sends through it.
 *
 * Everything here is pure: the number arithmetic, the pacing and the words for
 * each connection state. The socket itself is
 * `src/server/services/messaging/whatsappClient.ts`, and the queue, the quiet
 * hours, the opt-outs and the retries are the messaging module's, unchanged —
 * this is a fourth channel on a path that already exists, not a second sender.
 *
 * **Two things about this are not software decisions and must stay written
 * down.** A linked device is an unofficial use of a personal account: WhatsApp
 * can and does block numbers that send machine-paced traffic, and the number at
 * risk is the company's own. That is why the pacing below is deliberately far
 * slower than the SMS batch and is not configurable from a screen — and why the
 * connection state is *reported* rather than assumed, since the other way this
 * fails is silently, with the line unlinked and the outbox filling up.
 */

import { digitsOf } from "./messaging";

/* ------------------------------- addressing ------------------------------- */

/** The server WhatsApp addresses an ordinary person's account on. */
export const WHATSAPP_USER_DOMAIN = "s.whatsapp.net";

/** Iran, for a number typed the way people here type one. */
const IRAN_CODE = "98";

/**
 * The account a message is addressed to, or **null**.
 *
 * Null is the important half. WhatsApp answers a malformed JID by delivering to
 * nobody without complaining — there is no bounce and no error code worth
 * reading — so a number this cannot make sense of must stop the message here and
 * be named, rather than being padded into something that looks like an address.
 * `98@s.whatsapp.net` is a perfectly well-formed JID for an account that does
 * not exist.
 *
 * Three shapes are accepted and the third is deliberate:
 *
 *  - an Iranian mobile however it is written — `0912…`, `912…`, `98912…`,
 *    `0098912…`, `+98 912 345 6789`, with Persian digits — which is what every
 *    customer record here holds;
 *  - an **international** number written with a leading `+`, because this company
 *    imports and a foreign supplier's number is a real case, and refusing it
 *    would mean the channel silently only worked for half the directory;
 *  - nothing else. A landline, a fragment, a number with too many digits: the
 *    caller is told, because the alternative is a message nobody receives.
 */
export function whatsappJid(raw: string | null | undefined): string | null {
  const text = String(raw ?? "").trim();
  const digits = digitsOf(text);
  if (!digits) return null;

  // Written as an international number: trusted as given, within reason. The
  // ITU caps a subscriber number at 15 digits, and fewer than 8 is not a number
  // anybody can be reached on.
  if (text.startsWith("+")) {
    return digits.length >= 8 && digits.length <= 15
      ? `${digits}@${WHATSAPP_USER_DOMAIN}`
      : null;
  }

  // Iranian mobile, in the four ways it arrives. Every one of them is the same
  // ten digits starting with 9, with a different prefix in front.
  const national = digits.startsWith(`00${IRAN_CODE}`) ? digits.slice(4)
    : digits.startsWith(IRAN_CODE) && digits.length === 12 ? digits.slice(2)
      : digits.startsWith("0") ? digits.slice(1)
        : digits;

  if (!/^9\d{9}$/.test(national)) return null;
  return `${IRAN_CODE}${national}@${WHATSAPP_USER_DOMAIN}`;
}

/** Whether a stored contact detail can be addressed on WhatsApp at all. */
export const isWhatsappAddressable = (raw: string | null | undefined): boolean =>
  whatsappJid(raw) !== null;

/* ------------------------------ connection ------------------------------- */

/**
 * Where the link stands.
 *
 * A fifth state — «it used to work and now it does not» — is deliberately not
 * here: that is `DISCONNECTED` plus the reason the socket gave, which the report
 * carries separately. A state that means two things is a state nothing can act
 * on.
 */
export const WHATSAPP_STATES = {
  /** No device linked, or the link was removed. Nothing will send. */
  UNLINKED: "UNLINKED",
  /** Linked, and the socket is opening. Ordinary, and brief. */
  CONNECTING: "CONNECTING",
  /** A code is on the screen, waiting to be scanned by the phone. */
  AWAITING_SCAN: "AWAITING_SCAN",
  /** Linked and open. The only state that sends. */
  CONNECTED: "CONNECTED",
  /**
   * Linked, not open, and it is not waiting for anybody — the network went, or
   * WhatsApp closed the socket. It retries on its own; the reason is reported.
   */
  DISCONNECTED: "DISCONNECTED",
} as const;

export type WhatsappState = typeof WHATSAPP_STATES[keyof typeof WHATSAPP_STATES];

export const WHATSAPP_STATE_LABELS: Record<WhatsappState, string> = {
  UNLINKED: "دستگاهی متصل نیست",
  CONNECTING: "در حال اتصال…",
  AWAITING_SCAN: "در انتظار اسکن کد",
  CONNECTED: "متصل",
  DISCONNECTED: "قطع شده",
};

/**
 * What the screen should tell somebody standing in front of this state.
 *
 * The wording matters more than it looks: three of the five states need a
 * *different* action from the person, and a panel that says «قطع شده» and
 * nothing else invites the one thing that makes this worse — pressing link
 * again and again, which is itself traffic WhatsApp counts against the number.
 */
export const WHATSAPP_STATE_ADVICE: Record<WhatsappState, string> = {
  UNLINKED:
    "برای ارسال از خط خودتان، «اتصال دستگاه» را بزنید و کد را با واتس‌اپ گوشی اسکن کنید.",
  CONNECTING: "چند لحظه صبر کنید؛ اتصال در حال برقراری است.",
  AWAITING_SCAN:
    "در واتس‌اپ گوشی: تنظیمات ← دستگاه‌های متصل ← اتصال دستگاه، و این کد را اسکن کنید.",
  CONNECTED: "پیام‌ها از خط شما ارسال می‌شوند.",
  DISCONNECTED:
    "اتصال خودش دوباره تلاش می‌کند. اگر برنگشت، یک‌بار «قطع اتصال» و سپس اتصال دوباره.",
};

/** Whether a message may be handed to the socket in this state. */
export const whatsappCanSend = (state: WhatsappState): boolean =>
  state === WHATSAPP_STATES.CONNECTED;

/* -------------------------------- pacing --------------------------------- */

/**
 * How many WhatsApp messages one pass of the outbox worker may send.
 *
 * The worker ticks once a minute and its overall ceiling is 25 — right for an
 * SMS panel, which is a paid service expecting exactly this, and wrong here in a
 * way that costs the company its number rather than its money. Three a minute is
 * faster than a person types and far slower than anything that looks like a
 * broadcast; a campaign of two hundred then takes about an hour, which is the
 * honest shape of sending two hundred messages from one personal line.
 *
 * It is **not** a setting. Everything else about this channel is configurable
 * because the cost of getting it wrong is a message that does not arrive; the
 * cost of raising this is the line itself, and a box on a screen is an invitation
 * to raise it the first afternoon somebody is in a hurry.
 */
export const WHATSAPP_PER_PASS = 3;

/** The gap between two WhatsApp sends, in milliseconds, as a range. */
export const WHATSAPP_GAP_MS = { min: 4_000, max: 10_000 } as const;

/**
 * A gap to wait before the next WhatsApp send.
 *
 * `random` is an argument rather than a call to `Math.random`, so the rule is
 * deterministic and `test:rules` can hold its bounds — the same reason every
 * other rule in this codebase takes its clock rather than reading one.
 *
 * The jitter is the point: a fixed interval is a signature, and three messages
 * exactly eight seconds apart is more obviously a machine than three messages
 * four, nine and six seconds apart. Out-of-range input is clamped rather than
 * trusted, because a caller handing this a number outside 0..1 would otherwise
 * produce a negative delay and send the batch as a burst.
 */
export function whatsappGapMs(random: number): number {
  const r = Math.min(1, Math.max(0, Number.isFinite(random) ? random : 0));
  const { min, max } = WHATSAPP_GAP_MS;
  return Math.round(min + r * (max - min));
}

/**
 * Why a pass is not sending this message, or null.
 *
 * Separate from the state labels because the *queue* needs a sentence to store
 * on the row, and «در انتظار اسکن کد» on a failed message would read as the
 * message's own fault rather than as the line's.
 */
export function whatsappSendRefusal(state: WhatsappState): string | null {
  if (whatsappCanSend(state)) return null;
  if (state === WHATSAPP_STATES.UNLINKED) {
    return "خط واتس‌اپ متصل نیست. در تنظیمات پیام‌ها دستگاه را متصل کنید.";
  }
  if (state === WHATSAPP_STATES.AWAITING_SCAN) {
    return "کد اتصال واتس‌اپ هنوز اسکن نشده است.";
  }
  return "اتصال واتس‌اپ در دسترس نیست؛ پیام در صف می‌ماند.";
}

/* --------------------------- where it is sent from ------------------------ */

/**
 * Where the socket lives: in this process, or on a relay outside the country.
 *
 * Behind Iran's filtering the socket cannot complete its handshake at all, and a
 * proxy is the wrong shape for it: a linked device holds one connection open for
 * days, so every minute of that connection crosses the filtered border and every
 * severance is a fresh handshake — which is the machine-paced traffic this whole
 * channel is built to avoid. A **relay** puts the socket on the far side
 * entirely, and the link from here carries only short requests that the outbox
 * queue already retries. A failed POST is free; a severed WebSocket is not.
 *
 * Absent means the socket runs here, which is what every installation does until
 * somebody configures otherwise — so no behaviour changes by default.
 */
export interface WhatsappRelayConfig {
  /** The relay's base address, without a trailing slash. */
  url: string;
  /** The shared secret. Never logged, never sent to a browser. */
  token: string;
}

/**
 * Why this pair cannot be used, or null.
 *
 * **A relay with no token is a machine anybody can send as the company's line
 * from**, so an address without one is refused rather than run open — and it is
 * refused *loudly* rather than falling back to the local socket, because a
 * silent fallback would send from the wrong place, or from nowhere, with nothing
 * on any screen saying which.
 *
 * Plain HTTP is refused for the same reason in a quieter disguise: the token
 * would cross the border in the clear on every send. Loopback is the one
 * exception, since nothing leaves the machine — that is what makes a relay
 * testable on one box without weakening the rule for the real one.
 */
export function relayConfigRefusal(
  url: string | null | undefined,
  token: string | null | undefined,
): string | null {
  const address = String(url ?? "").trim();
  if (!address) return null; // Not configured at all: the local socket, as before.

  let parsed: URL;
  try {
    parsed = new URL(address);
  } catch {
    return "آدرس رله واتس‌اپ معتبر نیست.";
  }

  const loopback = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1"
    || parsed.hostname === "[::1]" || parsed.hostname === "::1";
  if (parsed.protocol !== "https:" && !loopback) {
    return "آدرس رله واتس‌اپ باید https باشد؛ توکن نباید روی اتصال رمزنشده برود.";
  }
  if (!String(token ?? "").trim()) {
    return "توکن رله واتس‌اپ تنظیم نشده است. بدون توکن، هر کسی می‌تواند از خط شرکت پیام بفرستد.";
  }
  return null;
}

/** The pair as a usable configuration, or null when nothing is configured. */
export function relayConfigFrom(
  url: string | null | undefined,
  token: string | null | undefined,
): WhatsappRelayConfig | null {
  const address = String(url ?? "").trim().replace(/\/+$/, "");
  const secret = String(token ?? "").trim();
  if (!address || !secret) return null;
  return { url: address, token: secret };
}

/* ---------------------------- what went wrong ----------------------------- */

/**
 * Which half of the system a failure belongs to.
 *
 * The panel said «قطع شده» for every one of these and the three need three
 * different people: a filtered or broken route is the network, a removed device
 * is the WhatsApp account, and a missing token is this application's own
 * configuration. Telling them apart is the whole reason the reason is stored.
 */
export const WHATSAPP_FAILURE_KINDS = {
  /** The route out: filtering, a dead relay, DNS, a timeout. */
  NETWORK: "NETWORK",
  /** The WhatsApp account: the device was removed, or the credentials are dead. */
  ACCOUNT: "ACCOUNT",
  /** This application: the relay is half-configured. */
  CONFIG: "CONFIG",
  /** Something this build has not seen. */
  UNKNOWN: "UNKNOWN",
} as const;

export type WhatsappFailureKind =
  typeof WHATSAPP_FAILURE_KINDS[keyof typeof WHATSAPP_FAILURE_KINDS];

export const WHATSAPP_FAILURE_LABELS: Record<WhatsappFailureKind, string> = {
  NETWORK: "مشکل مسیر شبکه",
  ACCOUNT: "مشکل حساب واتس‌اپ",
  CONFIG: "مشکل تنظیمات",
  UNKNOWN: "خطای نامشخص",
};

export const WHATSAPP_FAILURE_ADVICE: Record<WhatsappFailureKind, string> = {
  NETWORK:
    "اتصال به واتس‌اپ از این سرور برقرار نشد. اگر واتس‌اپ در دسترس نیست، ارسال باید از رله خارج از کشور انجام شود.",
  ACCOUNT:
    "دستگاه از حساب واتس‌اپ حذف شده یا اعتبارش باطل است. یک‌بار «قطع اتصال» و سپس اتصال دوباره با اسکن کد.",
  CONFIG:
    "تنظیمات رله کامل نیست. آدرس و توکن رله را در متغیرهای محیطی سرور بررسی کنید.",
  UNKNOWN: "متن خطا را به پشتیبانی بدهید.",
};

/**
 * The tokens each kind is recognised by.
 *
 * Written out rather than matched loosely because the strings come from three
 * different places — Node's own socket errors, baileys, and the relay relaying
 * one of those — and a rule broad enough to catch all of them by feel would
 * classify the next unfamiliar message wrongly rather than admitting it.
 */
const NETWORK_TOKENS = [
  "econnreset", "econnrefused", "etimedout", "enotfound", "eai_again", "ehostunreach",
  "enetunreach", "epipe", "socket hang up", "network", "timeout", "aborted",
  "fetch failed", "certificate", "tls",
];

const ACCOUNT_TOKENS = [
  "loggedout", "logged out", "logged-out", "unauthorized", "unauthorised",
  "401", "403", "device_removed", "device removed", "حذف شده", "باطل",
];

/**
 * Which half a failure message belongs to.
 *
 * **UNKNOWN is an honest answer and not a gap.** Reading an unrecognised message
 * as a network fault would tell somebody to go and check a route that is fine,
 * and reading it as an account fault would tell them to unlink a perfectly good
 * device — so a message this build cannot place is reported as itself, with the
 * text beside it, which is the one thing that is always true.
 */
export function whatsappFailureKind(
  message: string | null | undefined,
): WhatsappFailureKind {
  const text = String(message ?? "").toLowerCase();
  if (!text.trim()) return WHATSAPP_FAILURE_KINDS.UNKNOWN;
  /*
   * The relay's own credential is asked about **first**, and the order is the
   * decision: a refused token comes back carrying the word «توکن» beside an
   * unauthorised status, and every other reading of that pair is wrong in a way
   * that costs somebody an afternoon — «unauthorized» read as the account tells
   * them to unlink a working device, when the fix is one line in an env file.
   */
  if (text.includes("توکن")) return WHATSAPP_FAILURE_KINDS.CONFIG;
  // Then the account: a device removed from it is the sharper reading and the
  // one that needs a person, while a network fault retries itself.
  if (ACCOUNT_TOKENS.some((t) => text.includes(t))) return WHATSAPP_FAILURE_KINDS.ACCOUNT;
  if (NETWORK_TOKENS.some((t) => text.includes(t))) return WHATSAPP_FAILURE_KINDS.NETWORK;
  if (text.includes("رله")) return WHATSAPP_FAILURE_KINDS.CONFIG;
  return WHATSAPP_FAILURE_KINDS.UNKNOWN;
}
