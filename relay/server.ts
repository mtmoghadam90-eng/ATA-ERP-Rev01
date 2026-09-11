import http from "http";
import { timingSafeEqual } from "crypto";
import { WHATSAPP_GAP_MS } from "../src/utils/whatsapp";
import {
  connectWhatsapp, ensureWhatsappLinkRestored, sendWhatsapp, unlinkWhatsapp,
  whatsappIsLinked, whatsappReport,
} from "../src/server/services/messaging/whatsappClient";

/**
 * The WhatsApp relay: the linked-device socket, on a machine that can reach
 * WhatsApp, with four endpoints in front of it.
 *
 * This exists because of one fact and one consequence. Where WhatsApp is
 * unreachable from the ERP's own server the socket is reset before its handshake
 * completes — and **WhatsApp sends the pairing code during that handshake**, so
 * no code ever arrives and there is nothing in the application to fix. A proxy
 * would be the wrong answer: a linked device holds one connection open for days,
 * so proxying it puts every minute of it across the filtered border and makes
 * every severance a fresh handshake, which is the machine-paced traffic the
 * whole channel is designed to avoid. Here the socket never crosses that border
 * at all, and the link from the ERP carries only short requests its outbox
 * already retries.
 *
 * **It is deliberately dumb, and that is the design rather than a stage.** It
 * holds the socket and answers four questions. It has no customers, no
 * templates, no quiet hours, no opt-outs, no queue and no database — every one
 * of those stays in the ERP where it already is, because a second copy of any of
 * them on this machine is how the one nobody remembered (the opt-out) comes to
 * be skipped. If a feature is tempting to add here, it belongs there.
 *
 * **The socket implementation is not copied either**: this imports
 * `whatsappClient.ts` out of the ERP's own tree, so the pairing, the reconnect
 * policy, the `loggedOut` rule and the session handling are the same code in
 * both deployments. That is why the relay lives in this repository rather than
 * in one of its own.
 *
 * No framework: four endpoints over `node:http`. A relay's whole value is being
 * small and boring on a machine that holds the company's WhatsApp credentials,
 * and every dependency here is one more thing to keep patched on it.
 */

/* -------------------------------- settings -------------------------------- */

const PORT = Number(process.env.RELAY_PORT ?? 8787);

/**
 * Loopback by default, which is a real safety property rather than a default
 * nobody thought about: TLS is terminated by a reverse proxy in front (see
 * `docs/whatsapp-relay.md`), so the relay itself is unreachable from the
 * internet. Set `RELAY_HOST=0.0.0.0` only if something else is doing that job.
 */
const HOST = process.env.RELAY_HOST ?? "127.0.0.1";

const TOKEN = String(process.env.RELAY_TOKEN ?? "").trim();

/** A body big enough for any message and far too small to be worth abusing. */
const MAX_BODY_BYTES = 64 * 1024;

/**
 * The floor between two sends, whatever the caller asks for.
 *
 * **An interlock, not a second copy of the pacing policy.** The ERP's outbox
 * decides *when* to send and how many per pass; this only guarantees that
 * nothing — a misconfigured queue, a retry storm, anybody holding the token —
 * can make this line send faster than a person types. It reads the same
 * `WHATSAPP_GAP_MS.min` the ERP paces by, so there is still one number.
 */
const SEND_FLOOR_MS = WHATSAPP_GAP_MS.min;
let lastSendAt = 0;

/* --------------------------------- helpers -------------------------------- */

const json = (res: http.ServerResponse, status: number, body: unknown): void => {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(text);
};

/**
 * Whether the request carries the shared secret.
 *
 * Compared in constant time and only after the lengths match, because
 * `timingSafeEqual` throws on a length mismatch — and the length of a token is
 * not worth leaking through an exception either, so the mismatch answers false
 * the same way a wrong value does.
 */
function authorised(req: http.IncomingMessage): boolean {
  const header = String(req.headers.authorization ?? "");
  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) return false;
  const given = Buffer.from(header.slice(prefix.length));
  const want = Buffer.from(TOKEN);
  if (given.length !== want.length) return false;
  return timingSafeEqual(given, want);
}

/** Reads a JSON body, bounded. Answers null for anything it cannot parse. */
function readJson(req: http.IncomingMessage): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) { req.destroy(); resolve(null); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text.trim()) { resolve({}); return; }
      try { resolve(JSON.parse(text) as Record<string, unknown>); } catch { resolve(null); }
    });
    req.on("error", () => resolve(null));
  });
}

/**
 * A number with its middle removed, for the log.
 *
 * **A message body is never logged.** It is a customer's own words sitting on a
 * rented machine, and a log is the one place they would accumulate; the
 * recipient is masked for the same reason, kept only far enough to tell two
 * sends apart while somebody is watching `journalctl`.
 */
const mask = (raw: string): string => {
  const digits = String(raw ?? "").replace(/\D/g, "");
  return digits.length < 7 ? "***" : `${digits.slice(0, 4)}***${digits.slice(-3)}`;
};

const log = (...parts: unknown[]): void =>
  console.log(new Date().toISOString(), "[relay]", ...parts);

/* --------------------------------- routing -------------------------------- */

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const path = (req.url ?? "").split("?")[0].replace(/\/+$/, "") || "/";

  /*
   * Open, and says nothing. A proxy and an uptime check need to know the process
   * is alive; neither needs to know whether a line is linked, which is exactly
   * the kind of thing an unauthenticated endpoint should not answer.
   */
  if (path === "/health") { json(res, 200, { ok: true }); return; }

  if (!authorised(req)) { json(res, 401, { error: "unauthorized" }); return; }

  if (path === "/status" && req.method === "GET") {
    json(res, 200, { ...whatsappReport(), linked: whatsappIsLinked() });
    return;
  }

  if (path === "/link" && req.method === "POST") {
    log("link requested");
    json(res, 200, await connectWhatsapp({ force: true }));
    return;
  }

  if (path === "/unlink" && req.method === "POST") {
    log("unlink requested");
    json(res, 200, await unlinkWhatsapp());
    return;
  }

  if (path === "/send" && req.method === "POST") {
    const body = await readJson(req);
    if (!body) { json(res, 400, { ok: false, error: "بدنه درخواست خوانده نشد." }); return; }

    const recipient = String(body.recipient ?? "").trim();
    const text = String(body.body ?? "");
    if (!recipient || !text.trim()) {
      json(res, 400, { ok: false, error: "گیرنده یا متن پیام خالی است." });
      return;
    }

    // The interlock. Waited out rather than refused: the caller's message is
    // due and nothing is wrong with it — it simply may not go any sooner.
    const since = Date.now() - lastSendAt;
    if (lastSendAt && since < SEND_FLOOR_MS) {
      await new Promise((r) => setTimeout(r, SEND_FLOOR_MS - since));
    }
    lastSendAt = Date.now();

    const result = await sendWhatsapp({ recipient, body: text });
    log("send", mask(recipient), result.ok ? "ok" : `failed: ${result.error ?? ""}`);
    /*
     * 200 with `ok: false` for a refusal the socket itself made — an unreachable
     * number, an unlinked line. The ERP reads `ok` and stores the sentence; a
     * 5xx here would make it read as a transport fault and be retried against a
     * number that will refuse it again.
     */
    json(res, 200, result);
    return;
  }

  json(res, 404, { error: "not found" });
}

/* --------------------------------- startup -------------------------------- */

const major = Number(process.versions.node.split(".")[0]);
if (major < 20) {
  console.error(`[relay] Node ${process.versions.node} is too old; baileys needs 20 or newer.`);
  process.exit(1);
}

/*
 * **No token, no relay.** Starting open would put a machine on the internet that
 * anybody can send from as the company's own WhatsApp line, and it would look
 * perfectly healthy while doing it. Refusing at startup is the only moment this
 * is visible to whoever is setting it up.
 */
if (!TOKEN) {
  console.error("[relay] RELAY_TOKEN is not set. Refusing to start: an open relay can send as your own WhatsApp line.");
  process.exit(1);
}
if (TOKEN.length < 24) {
  console.error("[relay] RELAY_TOKEN is too short. Use at least 24 random characters.");
  process.exit(1);
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    // Never the stack, never the body: this answer crosses a network.
    log("unhandled", err instanceof Error ? err.message : String(err));
    if (!res.headersSent) json(res, 500, { error: "relay error" });
  });
});

server.listen(PORT, HOST, () => {
  log(`listening on ${HOST}:${PORT}`);
  log(`session ${whatsappIsLinked() ? "found — reconnecting" : "not linked — waiting for /link"}`);
  /*
   * This *is* the process that holds the socket, so restoring it here is right —
   * and it still opens only when a device is genuinely paired, because a pairing
   * code nobody is watching is itself traffic WhatsApp counts against the number.
   */
  ensureWhatsappLinkRestored();
});

/** Closes the socket on the way out, so systemd's restart is not a second one. */
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    log(`${signal} — shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5_000).unref();
  });
}
