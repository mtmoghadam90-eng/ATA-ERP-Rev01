import path from "path";
import fs from "fs";
import {
  WHATSAPP_STATES, WhatsappState, whatsappCanSend, whatsappJid, whatsappSendRefusal,
} from "../../../utils/whatsapp";
import type { OutgoingMessage, SendResult } from "./drivers";

/**
 * The company's own WhatsApp line, held open as a linked device.
 *
 * One socket per process, the shape `rateRefresh` already takes: there is one
 * line, the application is one process, and a second socket on the same
 * credentials is how a device gets itself logged out.
 *
 * **The library is loaded through a dynamic `import()` at call time**, and that
 * is not a style choice. `@whiskeysockets/baileys` is ESM-only, the deploy
 * bundles `server.ts` to **CJS**, and a top-level `import` of it would become a
 * `require()` that throws `ERR_REQUIRE_ESM` on the server — a failure that
 * appears at run time, on the production box, with a green build behind it.
 * Verified by bundling exactly as `npm run build` does and running the result:
 * esbuild leaves an external dynamic import as a real `import()`, so this works
 * in both `tsx` (dev) and the CJS bundle. `pdf-parse` is loaded at call time for
 * a different reason and is the precedent for the shape.
 *
 * Nothing here decides *whether* to send. The queue, the quiet hours, the
 * opt-outs, the dry-run switch and the retries are the messaging module's, and
 * this is one more driver behind `sendThrough`.
 */

/* ------------------------------ where it lives ---------------------------- */

/**
 * The folder baileys keeps its credentials and signal keys in.
 *
 * Beside `uploads/` and gitignored for the same reason: it is *this
 * installation's* state, not code, and `deploy.ps1` resets the tree to
 * `origin/main` on every deploy — an untracked folder survives that, a tracked
 * one would be overwritten and the line would need re-linking after every
 * release. It is deliberately **not** in the database: the key state is
 * rewritten on almost every message, and putting that write on a SQL Server
 * shared with Report Server would be the busiest table in the system.
 */
export const WHATSAPP_SESSION_DIR = path.join(process.cwd(), "whatsapp-session");

/**
 * Whether a device is really **paired**, which the file's existence does not say.
 *
 * This read `fs.existsSync("creds.json")` and that was wrong in the direction
 * that costs the number. `useMultiFileAuthState` seeds the credentials from
 * `initAuthCreds()` — which sets `registered: false` — and `saveCreds` writes the
 * file during the very first connection attempt, before anybody has scanned
 * anything. So one failed attempt made every later reader believe a device was
 * linked, and two guards written precisely to prevent machine-paced traffic
 * stopped guarding:
 *
 *  - the reconnect after a close calls `connectWhatsapp()` **unforced**, which is
 *    supposed to refuse when nothing is linked — instead it reopened the socket,
 *    failed, and looped for ever;
 *  - `ensureWhatsappLinkRestored()` opened a socket on **every server boot**,
 *    which is a pairing code nobody is watching, raised on a schedule.
 *
 * Reported from behind Iran's filtering, where the socket is reset before the
 * handshake completes (`read ECONNRESET`) and therefore no pairing code ever
 * arrives: the panel sat on «قطع شده» and did not move, which is the loop.
 *
 * `creds.registered` is the flag baileys sets after a successful pairing (in
 * `Socket/messages-recv`), so that is what «linked» means. An unreadable or
 * half-written file answers **false** — the safe direction here, since false
 * only means somebody has to press the button again, while true opens sockets
 * nobody asked for.
 */
export function whatsappIsLinked(): boolean {
  try {
    const raw = fs.readFileSync(path.join(WHATSAPP_SESSION_DIR, "creds.json"), "utf8");
    return (JSON.parse(raw) as { registered?: unknown }).registered === true;
  } catch {
    return false;
  }
}

/* -------------------------------- reporting ------------------------------- */

export interface WhatsappReport {
  state: WhatsappState;
  /**
   * The pairing code, as the raw string WhatsApp encodes.
   *
   * Kept as the string rather than as an image because that is what the socket
   * actually said; the route turns it into a data URI for the screen. The
   * division is the usual one — this module holds protocol state and the route
   * shapes it for a reader — and it is what lets the panel draw the code without
   * a QR library in the browser bundle.
   */
  qr: string | null;
  /** The line this is linked to, once WhatsApp says who it is. */
  linkedNumber: string | null;
  /** The last reason the socket closed, kept so the screen can say why. */
  lastError: string | null;
  /** When the state last changed, for «قطع شده از ۱۰ دقیقه پیش». */
  since: string;
}

interface State {
  value: WhatsappState;
  qr: string | null;
  linkedNumber: string | null;
  lastError: string | null;
  since: Date;
}

const state: State = {
  value: whatsappIsLinked() ? WHATSAPP_STATES.DISCONNECTED : WHATSAPP_STATES.UNLINKED,
  qr: null,
  linkedNumber: null,
  lastError: null,
  since: new Date(),
};

function setState(value: WhatsappState, extra: Partial<Omit<State, "value" | "since">> = {}): void {
  // Only a real move restamps the clock, the rule `statusChangeColumns` follows:
  // stamped on every update it would mean «last polled» and «قطع شده از ۱۰ دقیقه
  // پیش» would always read «از چند ثانیه پیش».
  if (state.value !== value) {
    state.value = value;
    state.since = new Date();
  }
  if ("qr" in extra) state.qr = extra.qr ?? null;
  if ("linkedNumber" in extra) state.linkedNumber = extra.linkedNumber ?? null;
  if ("lastError" in extra) state.lastError = extra.lastError ?? null;
}

export function whatsappReport(): WhatsappReport {
  return {
    state: state.value,
    qr: state.qr,
    linkedNumber: state.linkedNumber,
    lastError: state.lastError,
    since: state.since.toISOString(),
  };
}

/* --------------------------------- socket --------------------------------- */

/** A thrown value, as a sentence worth storing. */
const describe = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

/**
 * A logger shaped like the one baileys asks for, that says nothing.
 *
 * Its own default is a pino instance at `info`, which would write the whole
 * protocol handshake to this server's console on every reconnect. Supplying this
 * rather than adding pino as a dependency keeps the dependency list honest: the
 * interface is seven methods.
 */
const silentLogger = {
  level: "silent",
  child: () => silentLogger,
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
} as const;

/** The live socket, or null. `unknown` because its type comes from the import. */
let sock: { ev: any; sendMessage: any; onWhatsApp: any; logout: any; end: any; user?: any } | null = null;
/** In-flight connect, so two callers do not open two sockets on one identity. */
let connecting: Promise<void> | null = null;
/** The reconnect timer, so unlinking can cancel a retry already scheduled. */
let retryTimer: NodeJS.Timeout | null = null;
/** How many times in a row the socket has closed without opening. */
let failures = 0;

/** Backoff between reconnects: a minute at the outside, never a tight loop. */
const retryDelayMs = (n: number): number => Math.min(60_000, 2_000 * 2 ** Math.min(n, 5));

function clearRetry(): void {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

/**
 * Opens the link, or does nothing because it is already open or opening.
 *
 * `force` is what the «اتصال دستگاه» button passes: without a linked device this
 * refuses by default, because creating a socket with no credentials produces a
 * pairing code, and a code nobody is looking at — re-requested every minute by a
 * worker — is exactly the machine-paced traffic that gets a number blocked.
 */
export async function connectWhatsapp(opts: { force?: boolean } = {}): Promise<WhatsappReport> {
  if (sock) return whatsappReport();
  if (connecting) {
    await connecting.catch(() => {});
    return whatsappReport();
  }
  if (!opts.force && !whatsappIsLinked()) {
    setState(WHATSAPP_STATES.UNLINKED);
    return whatsappReport();
  }

  connecting = openSocket().finally(() => { connecting = null; });
  await connecting.catch(() => {});
  return whatsappReport();
}

async function openSocket(): Promise<void> {
  clearRetry();
  setState(whatsappIsLinked() ? WHATSAPP_STATES.CONNECTING : WHATSAPP_STATES.AWAITING_SCAN);

  /*
   * See the note at the top: ESM-only package, CJS bundle.
   *
   * The symbols are read straight off the namespace and **not** through a
   * `.default ??` fallback, which was checked rather than assumed: this package
   * puts all five of them on the namespace and `default` carries none, so the
   * fallback would be dead code reading a path that does not exist.
   */
  const baileys = await import("@whiskeysockets/baileys");
  const {
    makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason, Browsers,
  } = baileys as unknown as Record<string, any>;

  fs.mkdirSync(WHATSAPP_SESSION_DIR, { recursive: true });
  const { state: auth, saveCreds } = await useMultiFileAuthState(WHATSAPP_SESSION_DIR);

  /*
   * The WhatsApp Web build to claim to be.
   *
   * Asked of the library rather than pinned here: WhatsApp refuses a client
   * claiming a version it has retired, and a hardcoded one would work until the
   * morning it silently stopped. A failure to reach it is not fatal — the
   * library's own bundled default is the fallback.
   */
  let version: unknown;
  try {
    version = (await fetchLatestBaileysVersion())?.version;
  } catch {
    version = undefined;
  }

  const socket = makeWASocket({
    auth,
    logger: silentLogger,
    ...(version ? { version } : {}),
    // How the device is named in «دستگاه‌های متصل» on the phone. A person
    // looking at that list has to be able to tell what this is.
    browser: Browsers?.ubuntu?.("ATA ERP") ?? ["ATA ERP", "Chrome", "1.0.0"],
    // Nothing here reads messages; marking them online would make the phone
    // stop showing notifications for chats this device has "seen".
    markOnlineOnConnect: false,
    syncFullHistory: false,
  });
  sock = socket;

  socket.ev.on("creds.update", saveCreds);

  socket.ev.on("connection.update", (update: Record<string, any>) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) setState(WHATSAPP_STATES.AWAITING_SCAN, { qr, lastError: null });

    if (connection === "open") {
      failures = 0;
      setState(WHATSAPP_STATES.CONNECTED, {
        qr: null,
        lastError: null,
        linkedNumber: String(socket.user?.id ?? "").split(":")[0] || null,
      });
      return;
    }

    if (connection === "close") {
      const code = Number(lastDisconnect?.error?.output?.statusCode ?? 0);
      const loggedOut = code === Number(DisconnectReason?.loggedOut ?? 401);
      sock = null;

      /*
       * Logged out is the one close that must not be retried.
       *
       * It means the device was removed — from the phone, or by WhatsApp — so
       * the stored credentials are dead and every reconnect with them is a
       * refused handshake. Retrying forever would be traffic with no possible
       * outcome, which is the thing this whole channel has to avoid; the
       * credentials are cleared so the next link starts a fresh pairing.
       */
      if (loggedOut) {
        wipeSession();
        setState(WHATSAPP_STATES.UNLINKED, {
          qr: null,
          linkedNumber: null,
          lastError: "دستگاه از حساب واتس‌اپ حذف شده است. برای ارسال، دوباره متصل شوید.",
        });
        return;
      }

      const reason = describe(lastDisconnect?.error ?? "اتصال بسته شد.");

      /*
       * A pairing that never completed is not a dropped connection.
       *
       * With nothing registered there is no session to restore, so retrying is
       * traffic with no possible outcome — which is exactly what happens behind
       * a filter that resets the socket before the handshake: no pairing code
       * ever arrives, and a reconnect loop just keeps knocking. It is also what
       * the panel must say: `DISCONNECTED` promises «اتصال خودش دوباره تلاش
       * می‌کند», and for an unpaired device that promise is false.
       *
       * So the close is reported as `UNLINKED` with the reason beside it, and
       * the next attempt is a person pressing the button — which is the only
       * thing that can succeed anyway, since somebody has to scan the code.
       */
      if (!whatsappIsLinked()) {
        failures = 0;
        clearRetry();
        setState(WHATSAPP_STATES.UNLINKED, { qr: null, linkedNumber: null, lastError: reason });
        return;
      }

      failures += 1;
      setState(WHATSAPP_STATES.DISCONNECTED, { qr: null, lastError: reason });
      clearRetry();
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void connectWhatsapp();
      }, retryDelayMs(failures));
    }
  });
}

function wipeSession(): void {
  try {
    fs.rmSync(WHATSAPP_SESSION_DIR, { recursive: true, force: true });
  } catch {
    // A locked file on Windows is not worth failing the request over: the next
    // pairing overwrites `creds.json`, which is what `whatsappIsLinked` reads.
  }
}

/**
 * Removes the link: tells WhatsApp to drop this device, then forgets it.
 *
 * The logout call is attempted and its failure ignored on purpose — the point of
 * pressing this is to stop being linked, and a socket that is already closed
 * cannot say goodbye. Clearing the credentials is the part that must happen,
 * because a stored session the phone has already revoked is what produces an
 * endless reconnect.
 */
export async function unlinkWhatsapp(): Promise<WhatsappReport> {
  clearRetry();
  failures = 0;
  const open = sock;
  sock = null;
  try {
    await open?.logout?.();
  } catch {
    try { open?.end?.(undefined); } catch { /* already gone */ }
  }
  wipeSession();
  setState(WHATSAPP_STATES.UNLINKED, { qr: null, linkedNumber: null, lastError: null });
  return whatsappReport();
}

/* ------------------------------- the driver ------------------------------- */

/**
 * Sends one message on the line, or says why not.
 *
 * Two refusals before the socket is touched, and both are failures of the
 * *message* rather than of the line, so the queue should stop rather than retry:
 * a number WhatsApp cannot be addressed by, and a number that has no WhatsApp
 * account. The second is a real check (`onWhatsApp`) because the alternative is
 * the worst outcome this channel has — WhatsApp accepts a message to a
 * non-existent account, reports success, and delivers it to nobody. A check that
 * itself fails is **ignored**: it is a diagnostic, and refusing to send because
 * a diagnostic was unavailable would turn a working line into a silent one.
 */
export async function sendWhatsapp(message: OutgoingMessage): Promise<SendResult> {
  const jid = whatsappJid(message.recipient);
  if (!jid) {
    return {
      ok: false,
      error: "شماره گیرنده برای واتس‌اپ معتبر نیست (شماره موبایل با کد کشور لازم است).",
    };
  }

  if (!sock || !whatsappCanSend(state.value)) {
    // One attempt to bring it back, but only if a device is linked: an unlinked
    // line has nothing to reconnect to and must not raise a pairing code here.
    if (whatsappIsLinked()) await connectWhatsapp();
    if (!sock || !whatsappCanSend(state.value)) {
      return { ok: false, error: whatsappSendRefusal(state.value) ?? "اتصال واتس‌اپ برقرار نیست." };
    }
  }

  try {
    const bare = jid.split("@")[0];
    let registered: string | null = null;
    try {
      const found = await sock.onWhatsApp(bare);
      const hit = Array.isArray(found) ? found[0] : null;
      if (hit && hit.exists === false) {
        return { ok: false, error: "این شماره حساب واتس‌اپ ندارد." };
      }
      // WhatsApp answers with the id it actually knows the account by, which on
      // a number ported between accounts is not always the one asked about.
      registered = hit?.jid ? String(hit.jid) : null;
    } catch {
      registered = null;
    }

    const sent = await sock.sendMessage(registered ?? jid, { text: message.body });
    return { ok: true, providerMessageId: sent?.key?.id ? String(sent.key.id) : null };
  } catch (err) {
    return { ok: false, error: describe(err) };
  }
}

/**
 * Brings the link up at startup, if there is one.
 *
 * Started and never awaited, exactly as the rate refresh is: a WhatsApp socket
 * that will not open must not hold up the server coming up, and an installation
 * that has never linked a device must not have a pairing code raised for it by a
 * process nobody is watching.
 */
export function ensureWhatsappLinkRestored(): void {
  if (!whatsappIsLinked()) return;
  void connectWhatsapp().catch(() => {});
}
