import { TELEGRAM_STATES } from "../../../utils/telegram";
import { relayConfigFrom, relayConfigRefusal } from "../../../utils/whatsapp";
import type { TelegramReport } from "./telegramClient";
import type { OutgoingMessage, SendResult } from "./drivers";
import { relayEnv } from "./relayConfig";

/**
 * The one door onto the Telegram account, wherever its session is held.
 *
 * `whatsappTransport.ts`'s twin, and the same two deployments: **absent
 * configuration means the session runs in this process**, and with the relay
 * variables set it lives on a machine outside the filtered network. Nothing
 * changes by default.
 *
 * The relay's *address rules* are `relayConfigFrom`/`relayConfigRefusal` from
 * the WhatsApp module, read rather than copied — https is required, loopback
 * excepted, a token is required, and a half-configured pair is refused loudly
 * rather than falling back to the local session. Those are facts about the
 * relay, not about WhatsApp, and a second copy of them here is how one channel
 * comes to accept a plain-http relay the other refuses. Their sentences still
 * say «رله واتس‌اپ», which is the one honest wrinkle: it is the same host and
 * the same pair of variables, so a person reading either message is being sent
 * to the same line of the same env file.
 */

/** How long the far side gets, per kind of request. */
const RELAY_TIMEOUT_MS = {
  /** A send crosses a flaky border; a timeout is an ordinary retryable failure. */
  send: 30_000,
  /** Polled by a screen somebody is standing in front of, so short. */
  status: 8_000,
  /**
   * Opens a session on the far side. It answers as soon as there is a login code
   * to show rather than when the sign-in completes — a QR waits on a person
   * finding their phone, which no HTTP timeout should be sized for.
   */
  link: 30_000,
} as const;

/** The configuration in force, read from the environment on every call. */
export function telegramRelay() {
  const { url, token } = relayEnv();
  return relayConfigFrom(url, token);
}

/** Why the configuration cannot be used, or null. */
export function telegramRelayRefusal(): string | null {
  const { url, token } = relayEnv();
  return relayConfigRefusal(url, token);
}

/** Whether sending goes through a relay at all. Never exposes the address. */
export const telegramUsesRelay = (): boolean => telegramRelay() !== null;

/* --------------------------------- calling -------------------------------- */

const describe = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

/**
 * Both keys always present rather than a discriminated union — see the note in
 * `whatsappTransport.ts`: `strictNullChecks` is off in this project's tsconfig,
 * so TypeScript does not narrow one by its boolean literal and the obvious
 * shape does not compile at all.
 */
interface RelayAnswer<T> {
  data: T | null;
  error: string | null;
}

async function call<T>(
  path: string,
  init: { method: "GET" | "POST"; body?: unknown; timeoutMs: number },
): Promise<RelayAnswer<T>> {
  const relay = telegramRelay();
  if (!relay) return { data: null, error: "رله پیام‌رسان تنظیم نشده است." };

  try {
    const response = await fetch(`${relay.url}${path}`, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${relay.token}`,
        ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(init.timeoutMs),
    });

    const text = await response.text();
    let parsed: unknown = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { /* not JSON */ }

    /*
     * A refused credential is **this side's** configuration, not Telegram's.
     * Relayed verbatim, the relay's bare «unauthorized» reads as the Telegram
     * account having rejected us and sends somebody to sign out of a working
     * session when the fix is one line in an env file; `telegramFailureKind`
     * reads the word «توکن» as CONFIG and asks that question first.
     */
    if (response.status === 401 || response.status === 403) {
      return { data: null, error: "توکن رله پذیرفته نشد؛ مقدار آن در دو طرف باید یکسان باشد." };
    }

    if (!response.ok) {
      const said = (parsed as { error?: unknown } | null)?.error;
      return {
        data: null,
        error: typeof said === "string" && said.trim()
          ? said
          : `رله پاسخ ${response.status} داد.`,
      };
    }
    return { data: parsed as T, error: null };
  } catch (err) {
    return { data: null, error: `ارتباط با رله برقرار نشد: ${describe(err)}` };
  }
}

/* ------------------------------ the four doors ---------------------------- */

/** A report with nothing that could be a fault of the account's. */
const refusedReport = (error: string): TelegramReport => ({
  state: TELEGRAM_STATES.UNLINKED,
  qr: null,
  linkedAccount: null,
  lastError: error,
  since: new Date().toISOString(),
});

/** Sends one message, through the relay or through the local session. */
export async function sendTelegramMessage(message: OutgoingMessage): Promise<SendResult> {
  const refusal = telegramRelayRefusal();
  if (refusal) return { ok: false, error: refusal };

  if (telegramUsesRelay()) {
    const answer = await call<SendResult>("/tg/send", {
      method: "POST",
      body: { recipient: message.recipient, body: message.body },
      timeoutMs: RELAY_TIMEOUT_MS.send,
    });
    if (answer.error) return { ok: false, error: answer.error };
    /*
     * The relay's own answer, taken as given — it resolved the peer, checked the
     * session and sent, and re-deciding any of that from here would be a second
     * copy of rules that live on the machine holding the session. A malformed
     * answer is a failure rather than a silent success, because the queue marks
     * a row SENT on `ok` alone.
     *
     * `retryAfterMs` travels with it, so a flood wait the relay met is the same
     * flood wait the queue honours: dropped here, the row would be retried on
     * the ordinary backoff into a restriction that may last a day.
     */
    const data = answer.data;
    if (!data || typeof data.ok !== "boolean") {
      return { ok: false, error: "پاسخ رله قابل خواندن نبود." };
    }
    return data;
  }

  const { sendTelegram } = await import("./telegramClient");
  return sendTelegram(message);
}

/** Where the session stands. Opens nothing and raises no login code. */
export async function telegramStatus(): Promise<TelegramReport & { linked: boolean }> {
  const refusal = telegramRelayRefusal();
  if (refusal) return { ...refusedReport(refusal), linked: false };

  if (telegramUsesRelay()) {
    const answer = await call<TelegramReport & { linked?: boolean }>("/tg/status", {
      method: "GET", timeoutMs: RELAY_TIMEOUT_MS.status,
    });
    if (answer.error || !answer.data) {
      return { ...refusedReport(answer.error ?? "پاسخ رله خالی بود."), linked: false };
    }
    return { ...answer.data, linked: answer.data.linked === true };
  }

  const { telegramReport, telegramIsLinked } = await import("./telegramClient");
  return { ...telegramReport(), linked: telegramIsLinked() };
}

/**
 * Opens the session, raising a login code when no account is signed in yet.
 *
 * `password` is the account's two-step secret when it has one. It travels from
 * the box on the panel to whichever machine holds the session and is **stored
 * on neither** — the relay hands it to the library and drops it with the
 * request, exactly as this process does. It crosses the wire inside the same
 * https body the bearer token authenticates, which is the one place it was ever
 * going to have to go: the sign-in happens where the session is.
 */
export async function telegramLink(password?: string): Promise<TelegramReport> {
  const refusal = telegramRelayRefusal();
  if (refusal) return refusedReport(refusal);

  if (telegramUsesRelay()) {
    const answer = await call<TelegramReport>("/tg/link", {
      method: "POST",
      body: password ? { password } : {},
      timeoutMs: RELAY_TIMEOUT_MS.link,
    });
    return answer.data ?? refusedReport(answer.error ?? "پاسخ رله خالی بود.");
  }

  const { connectTelegram } = await import("./telegramClient");
  return connectTelegram({ force: true, password });
}

/**
 * Signs the account out and forgets the session.
 *
 * It answers whether that really happened — `unlinked` — because the *channel*
 * has to be switched off with it, and that is a write this file must not make:
 * everything here is the session-or-relay abstraction and nothing in it touches
 * the database, which is what lets the rule checks drive the whole relay path
 * without one. The route owns that half.
 *
 * A relay that could not be reached has told us nothing about the session, so it
 * answers false — switching the channel off on the strength of a network fault
 * would silence an account that is still perfectly signed in.
 */
export async function telegramUnlink(): Promise<TelegramReport & { unlinked: boolean }> {
  const refusal = telegramRelayRefusal();
  if (refusal) return { ...refusedReport(refusal), unlinked: false };

  if (telegramUsesRelay()) {
    const answer = await call<TelegramReport>("/tg/unlink", {
      method: "POST", body: {}, timeoutMs: RELAY_TIMEOUT_MS.link,
    });
    if (!answer.data) {
      return { ...refusedReport(answer.error ?? "پاسخ رله خالی بود."), unlinked: false };
    }
    return { ...answer.data, unlinked: true };
  }

  const { unlinkTelegram } = await import("./telegramClient");
  return { ...(await unlinkTelegram()), unlinked: true };
}

/**
 * Reopens a session this process holds, after a restart.
 *
 * **A relay deployment does nothing here**, which is the point rather than an
 * omission: the session is not this process's to restore, and the relay restores
 * its own on its own boot. Opening one from here would be a second client on the
 * same session string, which Telegram answers by revoking it.
 */
export function ensureTelegramSessionRestored(): void {
  if (telegramUsesRelay() || telegramRelayRefusal()) return;
  void import("./telegramClient").then((m) => m.ensureTelegramRestored()).catch(() => {});
}
