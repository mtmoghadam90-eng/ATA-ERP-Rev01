import nodemailer from "nodemailer";
import { CHANNELS, Channel } from "../../../utils/messaging";

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
      const reason = payload?.description || `پاسخ ${response.status}`;
      return { ok: false, error: `ارسال در بله ناموفق بود: ${reason}` };
    }

    return { ok: true, providerMessageId: String(payload.result?.message_id ?? "") || null };
  } catch (err) {
    return { ok: false, error: describe(err) };
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
  /** Self-signed certificates are common on in-house mail servers. */
  allowSelfSigned?: boolean;
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
      // 465 is implicit TLS; everything else starts plain and upgrades.
      secure: config.secure ?? (config.port === 465),
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
    return { ok: false, error: describe(err) };
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
