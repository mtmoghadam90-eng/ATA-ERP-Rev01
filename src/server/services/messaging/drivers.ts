import nodemailer from "nodemailer";
import { CHANNELS, Channel, isBaleChatId, looksLikeMobile } from "../../../utils/messaging";

/**
 * The three ways a message actually leaves this building.
 *
 * Each driver takes a configuration and an addressed message and either
 * succeeds with whatever the provider called it, or fails with a sentence a
 * person can act on. Nothing here knows about the queue, retries, quiet hours
 * or templates — those are decided before a driver is ever called, so a driver
 * can be reasoned about, replaced or added to on its own.
 *
 * **Errors are messages, not exceptions.** A provider being down is an ordinary
 * outcome for a queue that will try again, not an exceptional one, and the text
 * it returns is stored on the row and shown on the screen. So every driver
 * catches its own failure and answers `{ ok: false, error }`.
 */

export interface OutgoingMessage {
  recipient: string;
  subject?: string | null;
  body: string;
}

export interface SendResult {
  ok: boolean;
  /** The provider's own id for the message, when it gives one. */
  providerMessageId?: string | null;
  error?: string;
}

/** How long any one provider gets before we call it a failure and retry. */
const TIMEOUT_MS = 20_000;

/**
 * `fetch` with a deadline.
 *
 * A gateway that accepts the connection and then never answers would otherwise
 * hold a queue worker for as long as it liked. `AbortSignal.timeout` is not
 * used because the message it produces ("This operation was aborted") tells the
 * reader nothing about which provider stalled.
 */
async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** A thrown value, as a sentence worth storing. */
const describe = (err: unknown): string => {
  if (err instanceof Error) {
    // An abort is our own timeout, and saying so is more use than the DOM's word.
    if (err.name === "AbortError") return `پاسخی از سرویس دریافت نشد (بیش از ${TIMEOUT_MS / 1000} ثانیه).`;
    return err.message;
  }
  return String(err);
};

/* ---------------------------------- SMS ---------------------------------- */

export interface SmsConfig {
  /** Panel username. */
  username?: string;
  password?: string;
  /** The line the message is sent from. */
  senderNumber?: string;
  /**
   * The REST endpoint. Defaults to MeliPayamak's, and is configurable so the
   * other Iranian panels with the same shape can be used without a code change.
   */
  apiUrl?: string;
}

const MELIPAYAMAK_URL = "https://rest.payamak-panel.com/api/SendSMS/SendSMS";

/**
 * Normalises an Iranian mobile number to what a panel expects.
 *
 * People type numbers every way there is — `+98912…`, `0098912…`, `912…`, with
 * spaces or Persian digits. A panel given `+98…` typically answers with a
 * generic failure code that says nothing about the number being the problem.
 */
export function normalizeMobile(raw: string): string {
  const latin = String(raw ?? "")
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/\D/g, "");

  if (latin.startsWith("0098")) return `0${latin.slice(4)}`;
  if (latin.startsWith("98") && latin.length === 12) return `0${latin.slice(2)}`;
  if (latin.startsWith("9") && latin.length === 10) return `0${latin}`;
  return latin;
}

export async function sendSms(config: SmsConfig, message: OutgoingMessage): Promise<SendResult> {
  if (!config.username || !config.password || !config.senderNumber) {
    return { ok: false, error: "تنظیمات پنل پیامک کامل نیست (نام کاربری، رمز و شماره فرستنده)." };
  }

  const to = normalizeMobile(message.recipient);
  if (!/^09\d{9}$/.test(to)) {
    return { ok: false, error: `شماره موبایل «${message.recipient}» معتبر نیست.` };
  }

  try {
    const response = await fetchWithTimeout(config.apiUrl || MELIPAYAMAK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: config.username,
        password: config.password,
        to,
        from: config.senderNumber,
        text: message.body,
        isflash: false,
      }),
    });

    const text = await response.text();
    if (!response.ok) {
      return { ok: false, error: `سرویس پیامک پاسخ ${response.status} داد: ${text.slice(0, 300)}` };
    }

    /*
     * The panel answers with a numeric code, not an HTTP status.
     *
     * A long numeric `Value` is the message id and means it was accepted;
     * anything short is an error code, and HTTP 200 accompanies both. Treating
     * the 200 as success is how a system reports every message as sent while
     * the panel rejects them all.
     */
    let value = text.trim();
    try {
      const parsed = JSON.parse(text) as { Value?: unknown; RetStatus?: unknown; StrRetStatus?: unknown };
      if (parsed && typeof parsed === "object" && parsed.Value !== undefined) {
        value = String(parsed.Value);
        const status = String(parsed.StrRetStatus ?? "");
        if (status && status !== "Ok") {
          return { ok: false, error: `سرویس پیامک پیام را نپذیرفت: ${status} (کد ${value})` };
        }
      }
    } catch {
      // A bare body is the older shape: the value itself, nothing around it.
    }

    if (!/^\d{6,}$/.test(value)) {
      return { ok: false, error: `سرویس پیامک کد خطای ${value || "نامشخص"} برگرداند.` };
    }
    return { ok: true, providerMessageId: value };
  } catch (err) {
    return { ok: false, error: describe(err) };
  }
}

/* ---------------------------------- Bale --------------------------------- */

export interface BaleConfig {
  /** The bot token from BotFather on Bale. */
  botToken?: string;
}

/**
 * Bale's own words, turned into something the reader can act on.
 *
 * The API answers in English with the terse `description` Telegram uses, and
 * relaying it puts a sentence on the screen that names no remedy: "no such
 * group or user" is true, but what it means here is that nobody has ever
 * started this conversation, and only the customer can.
 */
function baleFailure(description: string, status: number): string {
  const text = description.toLowerCase();

  if (text.includes("no such group or user") || text.includes("chat not found")) {
    return "بله این گفتگو را نمی‌شناسد. شناسه گفتگو باید عدد باشد و مخاطب باید یک بار به ربات شرکت در بله پیام داده باشد؛ شماره موبایل در بله کار نمی‌کند.";
  }
  if (text.includes("bot can't initiate conversation") || text.includes("bot was blocked")) {
    return "ربات اجازه پیام دادن به این مخاطب را ندارد. مخاطب باید ابتدا گفتگو با ربات را شروع کند یا ربات را از حالت مسدود خارج کند.";
  }
  if (status === 401 || text.includes("unauthorized")) {
    return "توکن ربات بله پذیرفته نشد. توکن را دوباره از BotFather بگیرید و ثبت کنید.";
  }
  if (text.includes("too many requests")) {
    return "بله فعلاً پیام بیشتری نمی‌پذیرد (محدودیت تعداد). کمی بعد دوباره تلاش می‌شود.";
  }
  return `ارسال در بله ناموفق بود: ${description || `پاسخ ${status}`}`;
}

/**
 * Bale's bot API mirrors Telegram's, down to the method names, so this is a
 * `sendMessage` call with a chat id. The customer has to have started a
 * conversation with the bot first — that is what produces the chat id stored
 * against them, and there is no way around it from this side.
 */
export async function sendBale(config: BaleConfig, message: OutgoingMessage): Promise<SendResult> {
  if (!config.botToken) {
    return { ok: false, error: "توکن ربات بله ثبت نشده است." };
  }

  const chatId = String(message.recipient ?? "").trim();
  if (!chatId) return { ok: false, error: "شناسه گفتگوی بله برای این مخاطب ثبت نشده است." };

  /*
   * Refused here rather than sent and refused there, because the answer that
   * comes back names the value as unknown instead of naming it as the wrong
   * kind of thing — and a phone number is the mistake everybody makes first.
   */
  if (!isBaleChatId(chatId)) {
    return {
      ok: false,
      error: looksLikeMobile(chatId)
        ? `«${chatId}» شماره موبایل است و بله با شماره پیام نمی‌فرستد. شناسه عددی گفتگو لازم است؛ آن را از فهرست «گفتگوهای اخیر» در تنظیمات بله بردارید.`
        : `شناسه گفتگوی بله «${chatId}» معتبر نیست. یک شناسه عددی (مانند 1234567890) یا نام کانال با @ لازم است.`,
    };
  }

  try {
    const response = await fetchWithTimeout(
      `https://tapi.bale.ai/bot${config.botToken}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: message.body }),
      },
    );

    const payload = await response.json().catch(() => null) as
      | { ok?: boolean; description?: string; result?: { message_id?: unknown } }
      | null;

    if (!response.ok || !payload?.ok) {
      return { ok: false, error: baleFailure(String(payload?.description ?? ""), response.status) };
    }

    return { ok: true, providerMessageId: String(payload.result?.message_id ?? "") || null };
  } catch (err) {
    return { ok: false, error: describe(err) };
  }
}

/** One chat the bot has heard from, as the settings screen lists it. */
export interface BaleChat {
  id: string;
  name: string;
  /** "private", "group", "channel" — Bale's own word for it. */
  type: string;
}

/**
 * The same shape every driver answers in: an outcome and a sentence, never a
 * throw. A bot token that has been revoked is an ordinary thing for this to
 * find, and the person who typed it in is the one who needs to read about it.
 */
export interface BaleChatsResult {
  ok: boolean;
  chats: BaleChat[];
  error?: string;
}

/**
 * The chats the bot has recently heard from, with their numeric ids.
 *
 * This exists because the id is otherwise unobtainable: it is not the person's
 * phone number, they cannot read it off their own screen, and the bot cannot
 * write to them until somebody has typed it in here. `getUpdates` is the one
 * place Bale hands it over, so the person setting this up asks the customer to
 * message the bot and then picks them out of this list.
 *
 * No `offset` is sent, so the updates are read and not consumed — the same
 * chat keeps appearing until Bale ages it out, which is what makes the list
 * useful more than once.
 */
export async function baleRecentChats(config: BaleConfig): Promise<BaleChatsResult> {
  if (!config.botToken) return { ok: false, chats: [], error: "توکن ربات بله ثبت نشده است." };

  try {
    const response = await fetchWithTimeout(
      `https://tapi.bale.ai/bot${config.botToken}/getUpdates?limit=100`,
      { method: "GET" },
    );

    const payload = await response.json().catch(() => null) as
      | { ok?: boolean; description?: string; result?: unknown }
      | null;

    if (!response.ok || !payload?.ok) {
      return {
        ok: false,
        chats: [],
        error: baleFailure(String(payload?.description ?? ""), response.status),
      };
    }

    const updates = Array.isArray(payload.result) ? payload.result : [];
    // Newest first, and one row per chat however many messages it sent.
    const seen = new Map<string, BaleChat>();
    for (const update of [...updates].reverse()) {
      const chat = (update as { message?: { chat?: Record<string, unknown> } })?.message?.chat;
      const id = chat?.id;
      if (id === undefined || id === null) continue;
      const key = String(id);
      if (seen.has(key)) continue;

      const name = [chat?.title, chat?.first_name, chat?.last_name]
        .map((part) => String(part ?? "").trim())
        .filter(Boolean)
        .join(" ")
        || String(chat?.username ?? "").trim()
        || "بدون نام";

      seen.set(key, { id: key, name, type: String(chat?.type ?? "private") });
    }

    return { ok: true, chats: [...seen.values()] };
  } catch (err) {
    return { ok: false, chats: [], error: describe(err) };
  }
}

/* --------------------------------- Email --------------------------------- */

export interface EmailConfig {
  host?: string;
  port?: number;
  secure?: boolean;
  user?: string;
  password?: string;
  fromAddress?: string;
  fromName?: string;
  /**
   * Send anyway when the server's TLS certificate cannot be trusted.
   *
   * Named for the in-house case it was written for, but it covers the one that
   * actually turns up here: shared hosting, where the mail server answers on
   * the company's own domain while the certificate was issued to the *host's*
   * domain. The name is kept because it is what is already stored.
   */
  allowSelfSigned?: boolean;
}

/**
 * An SMTP failure, as a sentence that names the remedy.
 *
 * Node reports these accurately and uselessly: "Hostname/IP does not match
 * certificate's altnames" is exactly what happened and tells the person who
 * typed the server address in nothing about what to do — and there are only
 * ever two answers, so this says both. Same reasoning as `baleFailure`.
 */
function emailFailure(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const code = String((err as { code?: unknown })?.code ?? "");
  const text = raw.toLowerCase();

  if (text.includes("altnames") || code === "ERR_TLS_CERT_ALTNAME_INVALID") {
    const host = /host:\s*(\S+?)\.?\s+is not/i.exec(raw)?.[1];
    // "altnames:" appears twice in Node's message — the list follows the last
    // one, so the greedy prefix is what picks the right occurrence.
    const names = /.*altnames:\s*(.+)$/i.exec(raw)?.[1]
      ?.split(",")
      .map((n) => n.trim().replace(/^(DNS|IP Address):/i, ""))
      .filter(Boolean)
      .join("، ");
    return [
      `گواهی امنیتی سرور ایمیل به نام${host ? ` «${host}»` : "ی که وارد کرده‌اید"} صادر نشده است`,
      names ? ` (گواهی متعلق به ${names} است).` : ".",
      " یا همان نامی را که روی گواهی هست به عنوان آدرس سرور وارد کنید (معمولاً نام سرور شرکت میزبان)،",
      " یا گزینه «پذیرش گواهی نامعتبر سرور» را در همین صفحه فعال کنید.",
    ].join("");
  }

  if (text.includes("self signed") || text.includes("self-signed")
    || text.includes("unable to verify the first certificate")
    || text.includes("unable to verify leaf signature")) {
    return "گواهی امنیتی سرور ایمیل قابل تایید نیست (خودامضا یا بدون مرجع معتبر). اگر سرور داخلی شرکت است، گزینه «پذیرش گواهی نامعتبر سرور» را فعال کنید.";
  }

  if (text.includes("certificate has expired") || code === "CERT_HAS_EXPIRED") {
    return "گواهی امنیتی سرور ایمیل منقضی شده است. آن را تمدید کنید یا گزینه «پذیرش گواهی نامعتبر سرور» را فعال کنید.";
  }

  if (code === "EAUTH" || text.includes("authentication failed")
    || text.includes("invalid login") || text.includes("535")) {
    return "نام کاربری یا رمز عبور ایمیل پذیرفته نشد.";
  }

  if (text.includes("wrong version number") || text.includes("ssl routines")) {
    return "ارتباط امن با این پورت برقرار نشد. برای پورت ۴۶۵ باید «اتصال امن مستقیم (SSL)» فعال باشد و برای پورت ۵۸۷ غیرفعال.";
  }

  if (code === "ECONNREFUSED" || text.includes("econnrefused")) {
    return "سرور ایمیل اتصال را نپذیرفت. آدرس سرور و پورت را بررسی کنید.";
  }

  if (code === "ETIMEDOUT" || text.includes("timeout") || text.includes("etimedout")) {
    return "سرور ایمیل در مهلت مقرر پاسخ نداد. ممکن است پورت روی شبکه بسته باشد.";
  }

  if (code === "EDNS" || text.includes("getaddrinfo") || text.includes("enotfound")) {
    return "آدرس سرور ایمیل پیدا نشد. املای آن را بررسی کنید.";
  }

  if (code === "EENVELOPE") {
    return "سرور ایمیل آدرس فرستنده یا گیرنده را نپذیرفت.";
  }

  return describe(err);
}

export async function sendEmail(config: EmailConfig, message: OutgoingMessage): Promise<SendResult> {
  if (!config.host || !config.fromAddress) {
    return { ok: false, error: "تنظیمات ایمیل کامل نیست (آدرس سرور و فرستنده)." };
  }

  const to = String(message.recipient ?? "").trim();
  if (!to.includes("@")) {
    return { ok: false, error: `آدرس ایمیل «${message.recipient}» معتبر نیست.` };
  }

  try {
    const transport = nodemailer.createTransport({
      host: config.host,
      port: config.port || 587,
      /*
       * 465 is implicit TLS; everything else starts plain and upgrades.
       *
       * An explicit `false` does not switch that off, deliberately: the switch
       * on the settings screen stores one, and a port of 465 with implicit TLS
       * turned off is not a configuration anybody wants — it is somebody having
       * ticked the box and unticked it again.
       */
      secure: config.secure === true || Number(config.port) === 465,
      auth: config.user ? { user: config.user, pass: config.password || "" } : undefined,
      connectionTimeout: TIMEOUT_MS,
      greetingTimeout: TIMEOUT_MS,
      socketTimeout: TIMEOUT_MS,
      ...(config.allowSelfSigned ? { tls: { rejectUnauthorized: false } } : {}),
    });

    const info = await transport.sendMail({
      from: config.fromName
        ? { name: config.fromName, address: config.fromAddress }
        : config.fromAddress,
      to,
      subject: message.subject || "",
      text: message.body,
    });

    return { ok: true, providerMessageId: info.messageId ?? null };
  } catch (err) {
    return { ok: false, error: emailFailure(err) };
  }
}

/* -------------------------------- dispatch -------------------------------- */

export async function sendThrough(
  channel: Channel,
  config: Record<string, unknown>,
  message: OutgoingMessage,
): Promise<SendResult> {
  if (channel === CHANNELS.SMS) return sendSms(config as SmsConfig, message);
  if (channel === CHANNELS.BALE) return sendBale(config as BaleConfig, message);
  if (channel === CHANNELS.EMAIL) return sendEmail(config as EmailConfig, message);
  return { ok: false, error: `روش ارسال «${channel}» پشتیبانی نمی‌شود.` };
}
