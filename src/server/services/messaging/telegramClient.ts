import fs from "fs";
import path from "path";
import {
  TELEGRAM_STATES, TelegramState, floodWaitSeconds, telegramApiFrom, telegramApiRefusal,
  telegramCanSend, telegramPeer, telegramSendRefusal,
} from "../../../utils/telegram";
import { retryDelayMs } from "../../../utils/messaging";
import type { OutgoingMessage, SendResult } from "./drivers";

/**
 * The company's Telegram account, as a logged-in session.
 *
 * The same shape as `whatsappClient.ts` and deliberately so: one process holds
 * one session, the state is *reported* rather than assumed, and the module is
 * imported by `telegramTransport.ts` — which is the only thing that should
 * import it — because this same file is what runs on the relay when the socket
 * cannot be held here. One implementation, two places to deploy it.
 *
 * **What a session file means, and the trap avoided by construction.** The
 * WhatsApp client once read «a credentials file exists» as «a device is linked»,
 * and the library writes that file during the *first connection attempt*, before
 * anybody has scanned anything — so one failed attempt made every later reader
 * believe the line was paired, and two guards written to keep the channel off
 * WhatsApp's radar both inverted. The library here has the same shape:
 * `StringSession.save()` answers a perfectly well-formed string as soon as the
 * client has connected to a data centre, signed in or not. So **the file is
 * written only after the sign-in has succeeded** — there is no flag to read
 * wrongly, because a session that was never authorised is never on disk.
 */

/* -------------------------------- session --------------------------------- */

/**
 * Where the session string lives.
 *
 * A directory with one file rather than a bare file, so it can be gitignored the
 * way `whatsapp-session/` is and for the same reason: whoever holds this string
 * can read and send as the company's Telegram account. It is this installation's
 * state rather than code, and `deploy.ps1` resets the tree to `origin/main` on
 * every deploy — a tracked file would need re-linking after every release.
 *
 * It is deliberately **not** in the database either. That one is shared with
 * Report Server, and a credential that reaches every backup and every report
 * connection is a credential with a much wider blast radius than a file.
 */
export const TELEGRAM_SESSION_DIR = path.join(process.cwd(), "telegram-session");
const SESSION_FILE = path.join(TELEGRAM_SESSION_DIR, "session.txt");

/** The stored session string, or null. */
function readSession(): string | null {
  try {
    const raw = fs.readFileSync(SESSION_FILE, "utf8").trim();
    return raw || null;
  } catch {
    return null;
  }
}

/**
 * Whether an account is signed in.
 *
 * True only when a session was written, and a session is written only once the
 * sign-in resolved — see the note at the top. An unreadable file answers
 * **false**, the safe direction: false costs somebody a button press, while true
 * opens connections nobody asked for.
 */
export const telegramIsLinked = (): boolean => readSession() !== null;

function writeSession(value: string): void {
  fs.mkdirSync(TELEGRAM_SESSION_DIR, { recursive: true });
  fs.writeFileSync(SESSION_FILE, value, { encoding: "utf8", mode: 0o600 });
}

function wipeSession(): void {
  try {
    fs.rmSync(TELEGRAM_SESSION_DIR, { recursive: true, force: true });
  } catch {
    // A locked file on Windows is not worth failing the request over: the next
    // sign-in overwrites it, which is what `telegramIsLinked` reads.
  }
}

/* ------------------------------- credentials ------------------------------ */

/** The pair, and why it cannot be used, as one answer. */
export interface TelegramCredentials {
  api: { apiId: number; apiHash: string } | null;
  problem: string | null;
  /**
   * The standing two-step password, when one is configured on this host.
   *
   * **From the environment only, and never from any stored row.** A cloud
   * password is full control of the account rather than the identity of an
   * application, so the pair above may live in a database the settings screen
   * writes to and this may not. The ordinary path does not use it at all: the
   * person pressing «اتصال حساب» types it into a box that keeps it for the
   * length of one sign-in, and this exists for the one case that has nobody
   * standing there — the relay reopening its own session after a reboot.
   */
  password: string;
}

/** Where the credentials come from when nothing has said otherwise. */
export function envTelegramCredentials(): TelegramCredentials {
  return telegramCredentialsFrom(
    process.env.TELEGRAM_API_ID,
    process.env.TELEGRAM_API_HASH,
    process.env.TELEGRAM_2FA_PASSWORD,
  );
}

/**
 * The pure fold from two raw values to an answer, shared by every source.
 *
 * Both are `unknown` because that is what they honestly are: one home is
 * `process.env` and the other a JSON column, and neither promises a string. The
 * two pure rules below already read through `String(v ?? "")`, so the narrowing
 * happens once, here, rather than at each source guessing its own cast.
 */
export function telegramCredentialsFrom(
  apiId: unknown,
  apiHash: unknown,
  password?: string | null,
): TelegramCredentials {
  const id = String(apiId ?? "");
  const hash = String(apiHash ?? "");
  const api = telegramApiFrom(id, hash);
  const refusal = telegramApiRefusal(id, hash);
  return {
    api,
    problem: refusal
      ?? (api ? null : "API ID و API Hash تلگرام ثبت نشده‌اند؛ کانال تلگرام پیکربندی نشده است."),
    password: String(password ?? ""),
  };
}

/**
 * Where the credentials are read from.
 *
 * A **seam**, exactly as `setTelegramLoader` is, and for the same fact about
 * this file: it is the one socket implementation and it runs in two places. On
 * the ERP the pair is a row on the messaging provider — a form somebody fills
 * in on the settings screen, which is where every other channel's credentials
 * are typed — and on the relay there is no database at all, so the environment
 * is the only answer there is. Injecting it is what lets both be true without
 * this module importing Prisma, which the relay would then have to install.
 *
 * It is a module-level setter rather than an argument on `connectTelegram`
 * because the retry timer and `ensureTelegramRestored` open the session too, and
 * a value threaded through three call sites is one that will be missing from
 * one of them.
 */
export type TelegramCredentialSource = () => Promise<TelegramCredentials> | TelegramCredentials;

let credentialSource: TelegramCredentialSource = envTelegramCredentials;

export function setTelegramCredentialSource(source: TelegramCredentialSource): void {
  credentialSource = source;
}

/**
 * The credentials in force.
 *
 * A source that throws — a database that is down — is reported as a
 * configuration problem rather than propagated: the panel then says the channel
 * could not be configured, which is true, instead of the whole status endpoint
 * answering 500 for a screen whose other half is about WhatsApp.
 */
export async function telegramCredentials(): Promise<TelegramCredentials> {
  try {
    return await credentialSource();
  } catch (err) {
    return {
      api: null,
      problem: `خواندن تنظیمات تلگرام ممکن نشد: ${describe(err)}`,
      password: "",
    };
  }
}

/** Why the credentials cannot be used, or null. */
export const telegramApiProblem = async (): Promise<string | null> =>
  (await telegramCredentials()).problem;

/* -------------------------------- reporting ------------------------------- */

export interface TelegramReport {
  state: TelegramState;
  /**
   * The login code, as the `tg://login?token=…` string Telegram encodes.
   *
   * Kept as the string rather than as an image because that is what the library
   * actually said; the route turns it into a data URI. The division is the
   * WhatsApp panel's and is what lets the code be scanned from the ERP's own
   * screen with no QR library in the browser bundle.
   */
  qr: string | null;
  /** The account this is signed in as, once Telegram says who it is. */
  linkedAccount: string | null;
  /** The last reason the session failed, kept so the screen can say why. */
  lastError: string | null;
  /** When the state last changed, for «قطع شده از ۱۰ دقیقه پیش». */
  since: string;
}

interface State {
  value: TelegramState;
  qr: string | null;
  linkedAccount: string | null;
  lastError: string | null;
  since: Date;
}

const state: State = {
  value: telegramIsLinked() ? TELEGRAM_STATES.DISCONNECTED : TELEGRAM_STATES.UNLINKED,
  qr: null,
  linkedAccount: null,
  lastError: null,
  since: new Date(),
};

function setState(value: TelegramState, extra: Partial<Omit<State, "value" | "since">> = {}): void {
  // Only a real move restamps the clock, the rule `statusChangeColumns` follows:
  // stamped on every update it would mean «last polled».
  if (state.value !== value) {
    state.value = value;
    state.since = new Date();
  }
  if ("qr" in extra) state.qr = extra.qr ?? null;
  if ("linkedAccount" in extra) state.linkedAccount = extra.linkedAccount ?? null;
  if ("lastError" in extra) state.lastError = extra.lastError ?? null;
}

export function telegramReport(): TelegramReport {
  return {
    state: state.value,
    qr: state.qr,
    linkedAccount: state.linkedAccount,
    lastError: state.lastError,
    since: state.since.toISOString(),
  };
}

/* -------------------------------- the library ----------------------------- */

/** A thrown value, as a sentence worth storing. */
const describe = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

type GramModule = typeof import("telegram");

/**
 * How the MTProto library is loaded.
 *
 * A **call-time dynamic import**, for the reason baileys is one: `server.ts` is
 * bundled to CJS by esbuild, and a top-level import of a package this size would
 * be paid for by every server that never uses the channel.
 *
 * The **seam** exists for the relay, and it is the same fault that cost a day
 * there: Node resolves a bare specifier from the directory of the *importing
 * file*, and `relay/package.json` declares the dependency so the install lands
 * in `relay/node_modules` — two directories below this file, where there is no
 * `node_modules` at all. Written here, the import resolves for the ERP and
 * rejects on the relay. So the relay hands over an `import()` written beside the
 * package.json that declares it.
 *
 * A module-level setter rather than an argument on `connectTelegram`, because
 * the reconnect timer and `ensureTelegramRestored` open the session too, and a
 * value threaded through three call sites is one that will be missing from one
 * of them.
 */
let loadGram: () => Promise<GramModule> =
  () => import("telegram") as Promise<GramModule>;

export function setTelegramLoader(load: () => Promise<unknown>): void {
  loadGram = load as () => Promise<GramModule>;
}

/* -------------------------------- connection ------------------------------ */

/** The live client, or null. One per process, like the WhatsApp socket. */
let client: any = null;
let connecting: Promise<void> | null = null;
let retryTimer: NodeJS.Timeout | null = null;
let failures = 0;

/**
 * Until when Telegram has asked this account to stop, as a timestamp.
 *
 * An in-process floor beside the queue's own `retryAfterMs`: the queue holds the
 * *row* back, and this holds the *account* back, so a second message that was
 * already in flight when the first was refused does not walk straight into the
 * same restriction. Both are needed — one row's answer must not decide the pass,
 * and the pass must not ignore what one row learned.
 */
let floodUntil = 0;

function clearRetry(): void {
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
}

/**
 * Opens the session, or does nothing because it is already open or opening.
 *
 * `force` is what the «اتصال حساب» button passes: without a stored session this
 * refuses by default, because connecting with no session raises a login code,
 * and a code nobody is looking at — re-requested every minute by a worker — is
 * exactly the machine-paced traffic that gets an account restricted.
 */
export async function connectTelegram(
  opts: { force?: boolean; password?: string } = {},
): Promise<TelegramReport> {
  const credentials = await telegramCredentials();
  if (!credentials.api) {
    setState(TELEGRAM_STATES.UNLINKED, {
      qr: null,
      lastError: credentials.problem ?? "کانال تلگرام پیکربندی نشده است.",
    });
    return telegramReport();
  }

  if (client) return telegramReport();
  if (connecting) {
    await connecting.catch(() => {});
    return telegramReport();
  }
  if (!opts.force && !telegramIsLinked()) {
    setState(TELEGRAM_STATES.UNLINKED);
    return telegramReport();
  }

  /*
   * The two-step password travels **down** rather than being read again inside
   * the sign-in: it is typed into a box on the panel and kept for the length of
   * one attempt, so there is nothing to read back later. `openSession` holds it
   * for as long as the library may ask for it and nothing writes it anywhere.
   */
  connecting = openSession(credentials, opts.password)
    .finally(() => { connecting = null; });
  await connecting.catch((err: unknown) => {
    /*
     * **A failed open is reported**, the lesson `connectWhatsapp` was corrected
     * for: swallowed, a session that never existed is drawn as one waiting to be
     * scanned and the panel promises a code for as long as anybody watches.
     *
     * The handling is the WhatsApp client's clause for clause — an unlinked
     * account answers `UNLINKED` with no retry, since only a person scanning can
     * get anywhere, and a linked one answers `DISCONNECTED` and backs off, which
     * is what that state's own advice promises.
     */
    client = null;
    const reason = describe(err);
    clearRetry();
    if (!telegramIsLinked()) {
      failures = 0;
      setState(TELEGRAM_STATES.UNLINKED, { qr: null, linkedAccount: null, lastError: reason });
      return;
    }
    failures += 1;
    setState(TELEGRAM_STATES.DISCONNECTED, { qr: null, lastError: reason });
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void connectTelegram();
    }, retryDelayMs(failures));
  });
  return telegramReport();
}

/**
 * Brings the client up, and signs in when there is no session yet.
 *
 * **It resolves as soon as there is something to report, not when the sign-in
 * finishes.** A QR sign-in waits on a person finding their phone, which is
 * minutes; the route that opened it has a timeout measured in seconds, and the
 * panel polls for the rest. So the login runs on in the background and this
 * answers at the first of two moments: a code is on the screen, or the sign-in
 * completed (which is the case where a stored session simply reconnected).
 */
async function openSession(
  credentials: TelegramCredentials,
  oneTimePassword?: string,
): Promise<void> {
  clearRetry();
  const api = credentials.api;
  if (!api) throw new Error(credentials.problem ?? "API ID/API Hash تلگرام");

  const stored = readSession();
  setState(stored ? TELEGRAM_STATES.CONNECTING : TELEGRAM_STATES.AWAITING_SCAN);

  const gram = await loadGram();
  const { TelegramClient, sessions } = gram;
  const session = new sessions.StringSession(stored ?? "");

  const created = new TelegramClient(session, api.apiId, api.apiHash, {
    /*
     * The library retries a dropped connection itself. Bounded rather than
     * infinite, so a filtered route surfaces as a reported failure instead of a
     * client reconnecting in a loop nobody can see — the outer backoff above is
     * what should be retrying, because it is the one with a state to report.
     */
    connectionRetries: 3,
    /** Quiet: this library logs to the console at `info` by default. */
    baseLogger: undefined,
  } as any);

  await created.connect();

  const already = await created.checkAuthorization().catch(() => false);
  if (already) {
    client = created;
    failures = 0;
    setState(TELEGRAM_STATES.CONNECTED, { qr: null, lastError: null });
    void describeAccount(created);
    // A reconnect of a stored session: the string can change (the library
    // migrates data centres), so it is written back.
    try { writeSession(String(session.save())); } catch { /* not fatal */ }
    return;
  }

  /*
   * No session: sign in by QR, exactly as Telegram Desktop does.
   *
   * The phone-and-code flow is deliberately not used. It needs a phone box, a
   * code box and a pending login held across two HTTP requests, and it fails in
   * ways the person cannot act on (an expired code, a flood wait on the code
   * itself). The QR is one button and one scan, it is the shape the WhatsApp
   * panel beside it already has, and the account holder is the person standing
   * there with the phone in any case.
   */
  let announced: (() => void) | null = null;
  const firstCode = new Promise<void>((resolve) => { announced = resolve; });

  const signIn = created.signInUserWithQrCode(
    { apiId: api.apiId, apiHash: api.apiHash },
    {
      qrCode: async (code: { token: Buffer }) => {
        setState(TELEGRAM_STATES.AWAITING_SCAN, {
          qr: `tg://login?token=${code.token.toString("base64url")}`,
          lastError: null,
        });
        announced?.();
      },
      /**
       * The cloud password, when the account has two-step verification on.
       *
       * **Never stored, anywhere.** It is full control of the account rather
       * than the identity of an application, so unlike the api pair it does not
       * go in the provider row the settings screen writes — it is typed into a
       * box on the link panel, held in memory for the length of this one attempt
       * and then gone. The environment is the fallback and exists for the one
       * sign-in nobody is standing in front of: the relay reopening its own
       * session after a reboot.
       *
       * An account that asks for one neither can supply fails with a sentence
       * saying where to type it, rather than hanging on a prompt nobody will
       * ever answer.
       */
      password: async () => {
        const secret = String(oneTimePassword ?? "") || credentials.password;
        if (!secret) {
          throw new Error(
            "این حساب رمز دومرحله‌ای دارد؛ رمز را در کادر «رمز دومرحله‌ای» وارد کنید"
            + " و دوباره «اتصال حساب» را بزنید.",
          );
        }
        return secret;
      },
      onError: async (err: Error) => {
        setState(TELEGRAM_STATES.UNLINKED, { qr: null, lastError: describe(err) });
        announced?.();
        return true; // stop the attempt: a person has to start it again
      },
    },
  );

  void signIn
    .then(async () => {
      /*
       * **Written only now.** The string was already savable the moment
       * `connect()` returned, and storing it there is precisely the fault the
       * WhatsApp client was corrected for: every later reader would believe an
       * account was linked because one attempt had been made.
       */
      writeSession(String(session.save()));
      client = created;
      failures = 0;
      setState(TELEGRAM_STATES.CONNECTED, { qr: null, lastError: null });
      void describeAccount(created);
    })
    .catch((err: unknown) => {
      setState(TELEGRAM_STATES.UNLINKED, { qr: null, lastError: describe(err) });
    })
    .finally(() => announced?.());

  await Promise.race([firstCode, signIn.catch(() => {})]);
}

/** Who the session belongs to, for the panel. Never fatal. */
async function describeAccount(active: any): Promise<void> {
  try {
    const me = await active.getMe();
    const name = me?.username ? `@${me.username}`
      : [me?.firstName, me?.lastName].filter(Boolean).join(" ")
        || (me?.phone ? `+${me.phone}` : null);
    if (name) setState(state.value, { linkedAccount: String(name) });
  } catch {
    // The panel shows the state without it; a name is a courtesy.
  }
}

/**
 * Signs the session out of the account and forgets it.
 *
 * The `logOut` call is attempted and its failure ignored on purpose — the point
 * of pressing this is to stop being signed in, and a client that is already
 * disconnected cannot say goodbye. Forgetting the session is the part that must
 * happen, because a stored session Telegram has already revoked is what produces
 * an endless reconnect.
 */
export async function unlinkTelegram(): Promise<TelegramReport> {
  clearRetry();
  failures = 0;
  floodUntil = 0;
  const open = client;
  client = null;
  try {
    await open?.invoke?.(new (await loadGram()).Api.auth.LogOut());
  } catch {
    try { await open?.disconnect?.(); } catch { /* already gone */ }
  }
  try { await open?.disconnect?.(); } catch { /* already gone */ }
  wipeSession();
  setState(TELEGRAM_STATES.UNLINKED, { qr: null, linkedAccount: null, lastError: null });
  return telegramReport();
}

/* ------------------------------- the driver ------------------------------- */

/**
 * The account a message is addressed to, as something the library can send to.
 *
 * A phone number goes through `contacts.resolvePhone`, which is what the
 * Telegram app itself does when you type a number into the search box — and it
 * answers nothing for a number whose owner has closed «who can find me by my
 * phone number», which is the one refusal this channel has that WhatsApp does
 * not. That is reported by name, because the remedy is a person's: write their
 * `@username` into the same field.
 */
async function resolvePeer(active: any, gram: GramModule, raw: string): Promise<unknown> {
  const peer = telegramPeer(raw);
  if (!peer) throw new Error("PEER_ID_INVALID");

  if (peer.kind === "username") return active.getEntity(peer.value);

  const answer = await active.invoke(
    new gram.Api.contacts.ResolvePhone({ phone: peer.value.replace(/^\+/, "") }),
  );
  const found = (answer as { users?: unknown[] }).users?.[0];
  if (!found) throw new Error("PHONE_NOT_OCCUPIED");
  return found;
}

/**
 * Sends one message from the account, or says why not.
 *
 * Two refusals before the client is touched and both are failures of the
 * *message* rather than of the account, so the queue should stop rather than
 * retry: a contact detail Telegram cannot be addressed by, and an account that
 * cannot be found at it.
 *
 * **A flood wait is neither.** It is the account being asked to stop, so it
 * answers `retryAfterMs` and the queue leaves the row QUEUED with its attempts
 * unspent — see `floodWaitSeconds`. Retrying it on the ordinary backoff would
 * spend every attempt inside the first two minutes of a wait that may be a day,
 * mark a perfectly good message FAILED, and make the restriction worse on the
 * way.
 */
export async function sendTelegram(message: OutgoingMessage): Promise<SendResult> {
  if (!telegramPeer(message.recipient)) {
    return {
      ok: false,
      error: "گیرنده برای تلگرام معتبر نیست (شماره موبایل با کد کشور، یا @username).",
    };
  }

  const waiting = floodUntil - Date.now();
  if (waiting > 0) {
    return {
      ok: false,
      retryAfterMs: waiting,
      error: `تلگرام ارسال از این حساب را موقتاً محدود کرده است؛ ${Math.ceil(waiting / 1000)} ثانیه دیگر.`,
    };
  }

  if (!client || !telegramCanSend(state.value)) {
    // One attempt to bring it back, but only if an account is signed in: an
    // unlinked one has nothing to reconnect to and must not raise a code here.
    if (telegramIsLinked()) await connectTelegram();
    if (!client || !telegramCanSend(state.value)) {
      return { ok: false, error: telegramSendRefusal(state.value) ?? "اتصال تلگرام برقرار نیست." };
    }
  }

  try {
    const gram = await loadGram();
    const entity = await resolvePeer(client, gram, message.recipient);
    const sent = await client.sendMessage(entity, { message: message.body });
    return { ok: true, providerMessageId: sent?.id != null ? String(sent.id) : null };
  } catch (err) {
    const reason = describe(err);
    const wait = floodWaitSeconds(reason);
    if (wait !== null) {
      floodUntil = Date.now() + wait * 1000;
      return { ok: false, retryAfterMs: wait * 1000, error: reason };
    }
    return { ok: false, error: reason };
  }
}

/**
 * Brings the session up at startup, if there is one.
 *
 * Started and never awaited, exactly as the rate refresh is: a Telegram session
 * that will not open must not hold up the server coming up, and an installation
 * that has never signed in must not have a login code raised for it by a process
 * nobody is watching.
 */
export function ensureTelegramRestored(): void {
  if (!telegramIsLinked()) return;
  void connectTelegram().catch(() => {});
}
