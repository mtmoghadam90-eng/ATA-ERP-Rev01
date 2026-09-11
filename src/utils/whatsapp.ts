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
