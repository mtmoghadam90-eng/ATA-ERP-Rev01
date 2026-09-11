import {
  WHATSAPP_STATES, WhatsappRelayConfig, relayConfigFrom, relayConfigRefusal,
} from "../../../utils/whatsapp";
import type { WhatsappReport } from "./whatsappClient";
import type { OutgoingMessage, SendResult } from "./drivers";

/**
 * The one door onto the WhatsApp line, wherever that line's socket is held.
 *
 * Two deployments, one interface. **Absent configuration means the socket runs
 * in this process**, which is every installation until somebody sets the two
 * variables — so nothing changes by default. With `WHATSAPP_RELAY_URL` and
 * `WHATSAPP_RELAY_TOKEN` set, the socket lives on a machine outside the filtered
 * network and this talks to it over HTTPS.
 *
 * **Why a relay rather than a proxy**, written down because the proxy is the
 * tempting answer: a linked device holds one connection open for days, so
 * proxying it means every minute of that connection crosses the filtered border
 * and every severance costs a fresh handshake — which is the machine-paced
 * traffic the whole channel is designed to avoid. A relay puts the socket
 * entirely on the far side; the link from here carries only short requests, and
 * the outbox queue already retries those. A failed POST is free.
 *
 * **The relay is deliberately dumb.** It holds the socket and nothing else: no
 * customers, no templates, no quiet hours, no opt-outs, no queue. All of that
 * stays here, where it already is — a second copy of any of it on another
 * machine is how the one nobody remembered (the opt-out) comes to be skipped.
 * Its endpoints answer exactly the shapes `whatsappClient` exposes, because that
 * file *is* what runs there: one implementation of the socket, two places it can
 * be deployed.
 *
 * Both halves are reached lazily. The relay path must not pull in `baileys` at
 * all — a server sending through a relay has no reason to load an ESM-only
 * protocol client — and the local path loads it the way it always did.
 */

/** How long the far side gets, per kind of request. */
const RELAY_TIMEOUT_MS = {
  /**
   * A send crosses a border that is flaky by nature. Generous, and a timeout is
   * an ordinary retryable failure rather than a verdict: the queue's own backoff
   * takes it, exactly as it does for an SMS panel that did not answer.
   */
  send: 30_000,
  /** Polled by a screen somebody is standing in front of, so short. */
  status: 8_000,
  /** Opens a socket on the far side; it answers once the attempt has resolved. */
  link: 30_000,
} as const;

/** The configuration in force, read from the environment on every call. */
export function whatsappRelay(): WhatsappRelayConfig | null {
  return relayConfigFrom(process.env.WHATSAPP_RELAY_URL, process.env.WHATSAPP_RELAY_TOKEN);
}

/**
 * Why the configuration cannot be used, or null.
 *
 * Exported so the status endpoint can *say* it. A half-configured relay that
 * quietly fell back to the local socket would send from the wrong place — or
 * from nowhere behind a filter — with nothing on any screen naming the reason,
 * which is the shape of fault this module exists to stop.
 */
export function whatsappRelayRefusal(): string | null {
  return relayConfigRefusal(process.env.WHATSAPP_RELAY_URL, process.env.WHATSAPP_RELAY_TOKEN);
}

/** Whether sending goes through a relay at all. Never exposes the address. */
export const whatsappUsesRelay = (): boolean => whatsappRelay() !== null;

/* --------------------------------- calling -------------------------------- */

/** A thrown value as a sentence worth storing. */
const describe = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

/**
 * One request to the relay.
 *
 * The token travels as a bearer header and appears nowhere else — not in the
 * path, not in a query string, not in any message this returns, because an
 * error is stored on an outbox row and read on a screen. A non-2xx answer is
 * relayed as *the relay's own* sentence where it gives one, since the far side
 * is the half that knows whether the line is linked.
 *
 * **Both keys are always present, rather than a `{ok: true} | {ok: false}`
 * union**, and that is forced rather than chosen: this project's `tsconfig` does
 * not set `strict`, so `strictNullChecks` is off and TypeScript **does not
 * narrow a discriminated union by a boolean literal** — `if (!answer.ok)` leaves
 * the type unnarrowed and every branch fails to compile. Written the obvious way
 * this does not build at all, which is the only reason it is worth a note.
 */
interface RelayAnswer<T> {
  /** The parsed body, or null when `error` says why there is none. */
  data: T | null;
  /** A sentence, or null when the call succeeded. */
  error: string | null;
}

async function call<T>(
  path: string,
  init: { method: "GET" | "POST"; body?: unknown; timeoutMs: number },
): Promise<RelayAnswer<T>> {
  const relay = whatsappRelay();
  if (!relay) return { data: null, error: "رله واتس‌اپ تنظیم نشده است." };

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

    if (!response.ok) {
      const said = (parsed as { error?: unknown } | null)?.error;
      return {
        data: null,
        error: typeof said === "string" && said.trim()
          ? said
          : `رله واتس‌اپ پاسخ ${response.status} داد.`,
      };
    }
    return { data: parsed as T, error: null };
  } catch (err) {
    // A timeout arrives here as an AbortError; it is a network fault like any
    // other and `whatsappFailureKind` reads it as one.
    return { data: null, error: `ارتباط با رله واتس‌اپ برقرار نشد: ${describe(err)}` };
  }
}

/* ------------------------------ the four doors ---------------------------- */

/** Sends one message, through the relay or through the local socket. */
export async function sendWhatsappMessage(message: OutgoingMessage): Promise<SendResult> {
  const refusal = whatsappRelayRefusal();
  if (refusal) return { ok: false, error: refusal };

  if (whatsappUsesRelay()) {
    const answer = await call<SendResult>("/send", {
      method: "POST",
      body: { recipient: message.recipient, body: message.body },
      timeoutMs: RELAY_TIMEOUT_MS.send,
    });
    if (answer.error) return { ok: false, error: answer.error };
    /*
     * The relay's own answer, taken as given — it ran `whatsappJid`, the
     * connection check and the send, and re-deciding any of that from here would
     * be a second copy of rules that live on the machine holding the socket.
     * A malformed answer is a failure rather than a silent success, because the
     * queue marks a row SENT on `ok` alone.
     */
    const data = answer.data;
    if (!data || typeof data.ok !== "boolean") {
      return { ok: false, error: "پاسخ رله واتس‌اپ قابل خواندن نبود." };
    }
    return data;
  }

  const { sendWhatsapp } = await import("./whatsappClient");
  return sendWhatsapp(message);
}

/** A report with nothing that could be a fault of this side's configuration. */
const refusedReport = (error: string): WhatsappReport => ({
  state: WHATSAPP_STATES.UNLINKED,
  qr: null,
  linkedNumber: null,
  lastError: error,
  since: new Date().toISOString(),
});

/** Where the link stands. Opens no socket and raises no pairing code. */
export async function whatsappStatus(): Promise<WhatsappReport & { linked: boolean }> {
  const refusal = whatsappRelayRefusal();
  if (refusal) return { ...refusedReport(refusal), linked: false };

  if (whatsappUsesRelay()) {
    const answer = await call<WhatsappReport & { linked?: boolean }>("/status", {
      method: "GET", timeoutMs: RELAY_TIMEOUT_MS.status,
    });
    if (answer.error || !answer.data) {
      return { ...refusedReport(answer.error ?? "پاسخ رله واتس‌اپ خالی بود."), linked: false };
    }
    return { ...answer.data, linked: answer.data.linked === true };
  }

  const { whatsappReport, whatsappIsLinked } = await import("./whatsappClient");
  return { ...whatsappReport(), linked: whatsappIsLinked() };
}

/** Opens the link, raising a pairing code when no device is linked yet. */
export async function whatsappLink(): Promise<WhatsappReport> {
  const refusal = whatsappRelayRefusal();
  if (refusal) return refusedReport(refusal);

  if (whatsappUsesRelay()) {
    const answer = await call<WhatsappReport>("/link", {
      method: "POST", body: {}, timeoutMs: RELAY_TIMEOUT_MS.link,
    });
    return answer.data ?? refusedReport(answer.error ?? "پاسخ رله واتس‌اپ خالی بود.");
  }

  const { connectWhatsapp } = await import("./whatsappClient");
  return connectWhatsapp({ force: true });
}

/** Removes the device from the account and forgets its credentials. */
export async function whatsappUnlink(): Promise<WhatsappReport> {
  const refusal = whatsappRelayRefusal();
  if (refusal) return refusedReport(refusal);

  if (whatsappUsesRelay()) {
    const answer = await call<WhatsappReport>("/unlink", {
      method: "POST", body: {}, timeoutMs: RELAY_TIMEOUT_MS.link,
    });
    return answer.data ?? refusedReport(answer.error ?? "پاسخ رله واتس‌اپ خالی بود.");
  }

  const { unlinkWhatsapp } = await import("./whatsappClient");
  return unlinkWhatsapp();
}

/**
 * Reopens a link this process holds, after a restart.
 *
 * **A relay deployment does nothing here**, which is the point rather than an
 * omission: the socket is not this process's to restore, and the relay restores
 * its own on its own boot. Opening one from here would be a second socket on the
 * same credentials, which is how a device gets itself logged out.
 */
export function ensureWhatsappRestored(): void {
  if (whatsappUsesRelay() || whatsappRelayRefusal()) return;
  void import("./whatsappClient").then((m) => m.ensureWhatsappLinkRestored()).catch(() => {});
}
