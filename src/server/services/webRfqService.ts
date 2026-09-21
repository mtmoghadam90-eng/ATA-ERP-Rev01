import { randomUUID } from "crypto";
import { getDb } from "../db";
import { AuthUser } from "../auth";
import { getTodayShamsi } from "../../dateUtils";
import { afterCommit } from "../afterCommit";
import { CustomerInput, createCustomer, normalizeMobile } from "./customerService";
import { ProjectInput, createProject } from "./projectService";
import { loadSettings } from "../settings";
import { nextProjectCode } from "../documentNumberSpecs";
import {
  BASELINE_PROBE_LIMIT, MAX_IMPORT_ATTEMPTS, WEB_RFQ_MARKETING_CHANNEL, WebRfq, WebRfqFeed,
  customerFor, feedConfigRefusal, feedRequestUrl, inquiryKeyFor, isBeforeLine,
  parseFeed, parseFeedRow, projectDescriptionFor, projectItemFor, projectNameFor, syncWindow,
} from "../../utils/webRfq";

/**
 * Pulling the website's price requests in, on a timer.
 *
 * The advisor plugin on the public site records every «استعلام قیمت» as a
 * structured row and emails it. This turns that row into the two records
 * somebody can actually work from — the customer, and a project carrying the
 * confirmed specification — so the enquiry arrives on a board rather than in an
 * inbox.
 *
 * **It pulls and is never pushed to.** The site is public and this server is on
 * a private LAN which must not be exposed, so an inbound webhook is unavailable
 * in principle. That is also why the site's endpoint is a plain read with no
 * state of its own: nothing there records what has been taken, and the unique
 * index on `web_rfq_imports.rfqId` is the whole of the once-only guarantee —
 * which holds whether the last poll finished, crashed, or ran twice.
 *
 * The shape is `rateRefresh`'s: one in-process promise so overlapping ticks do
 * not poll four ways at once, and a report the settings panel draws, because
 * **the failure mode of a poller is silence** — a feed that stopped answering
 * looks exactly like a week in which nobody asked for a price.
 */

const CONFIG_ID = "default";

/** One poll every five minutes. Fast enough that an enquiry is on the board
 *  before anybody could have read the email it arrived with. */
export const WEB_RFQ_TICK_MS = 5 * 60 * 1000;

/** How long a single feed request is given before it is abandoned. */
const FETCH_TIMEOUT_MS = 20000;

export interface WebRfqConfigView {
  feedUrl: string;
  /** A hint, never the token. Null when nothing is stored. */
  tokenHint: string | null;
  active: boolean;
  ownerUserId: string | null;
  /**
   * The line: nothing numbered at or below it is imported. Null until the
   * first poll draws it — which is not the same as zero, and the panel says
   * which of the two it is looking at.
   */
  startAfterId: number | null;
  /** Why the stored pair cannot be used, or null. */
  refusal: string | null;
}

export interface WebRfqReport {
  lastRunAt: number;
  lastOkAt: number;
  lastError: string | null;
  /** How many were newly imported on the last successful poll. */
  lastImported: number;
  /**
   * The number the last pass drew the line at, or null.
   *
   * A baseline pass imports nothing on purpose, and «۰ استعلام منتقل شد» with
   * no explanation reads as a feature that does not work — which is exactly
   * how a correct-but-unconfigured thing gets reported as broken. This is what
   * lets the panel say what really happened.
   */
  baselineDrawnAt: number | null;
  running: boolean;
}

let lastRunAt = 0;
let lastOkAt = 0;
let lastError: string | null = null;
let lastImported = 0;
let baselineDrawnAt: number | null = null;
let inFlight: Promise<number> | null = null;

export function webRfqReport(): WebRfqReport {
  return { lastRunAt, lastOkAt, lastError, lastImported, baselineDrawnAt, running: inFlight !== null };
}

/* ------------------------------ configuration ----------------------------- */

const mask = (value: string | null | undefined): string | null => {
  const text = String(value ?? "");
  if (!text) return null;
  return text.length <= 4 ? "••••" : `••••${text.slice(-4)}`;
};

async function readConfig() {
  return getDb().webRfqConfig.findUnique({ where: { id: CONFIG_ID } });
}

export async function getWebRfqConfig(): Promise<WebRfqConfigView> {
  const row = await readConfig();
  return {
    feedUrl: row?.feedUrl ?? "",
    tokenHint: mask(row?.token),
    active: row?.active ?? false,
    ownerUserId: row?.ownerUserId ?? null,
    startAfterId: row?.startAfterId ?? null,
    refusal: feedConfigRefusal(row?.feedUrl, row?.token),
  };
}

export interface WebRfqConfigInput {
  feedUrl?: string;
  /** Blank means «unchanged» — the rule every stored secret here follows. */
  token?: string;
  active?: boolean;
  ownerUserId?: string | null;
  /**
   * Absent means «not edited», and null means «draw the line again on the next
   * poll». A number — zero included — is a decision, and is stored as one.
   */
  startAfterId?: number | null;
}

/**
 * Saves the configuration, refusing a pair that cannot safely be used.
 *
 * The refusal is checked against the pair **as it will stand**, not against
 * what was sent: the form posts a blank token when nothing was retyped, so
 * asking the question of the request alone would refuse a perfectly good
 * stored token every time somebody corrected the address.
 */
export async function saveWebRfqConfig(input: WebRfqConfigInput): Promise<string | null> {
  const db = getDb();
  const existing = await readConfig();

  const feedUrl = input.feedUrl !== undefined
    ? String(input.feedUrl).trim().slice(0, 500)
    : (existing?.feedUrl ?? "");
  const token = String(input.token ?? "").trim()
    ? String(input.token).trim().slice(0, 200)
    : (existing?.token ?? "");

  const refusal = feedConfigRefusal(feedUrl, token);
  if (refusal) return refusal;

  const data = {
    feedUrl: feedUrl || null,
    token: token || null,
    active: input.active ?? existing?.active ?? false,
    ownerUserId: input.ownerUserId !== undefined
      ? (input.ownerUserId || null)
      : (existing?.ownerUserId ?? null),
    startAfterId: input.startAfterId !== undefined
      ? (input.startAfterId === null ? null : Math.max(0, Math.trunc(input.startAfterId)))
      : (existing?.startAfterId ?? null),
    updatedAt: new Date(),
  };

  await db.webRfqConfig.upsert({
    where: { id: CONFIG_ID },
    create: { id: CONFIG_ID, ...data },
    update: data,
  });
  return null;
}

/* --------------------------------- reading -------------------------------- */

/** What arrived from the site, or a reason it did not. */
async function fetchFeed(url: string, token: string, sinceId: number, limit: number): Promise<WebRfqFeed> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(feedRequestUrl(url, sinceId, limit), {
      method: "GET",
      // The token is a header and never a query string: a URL is written to
      // logs, proxies and error rows, and one of those is read on a screen.
      headers: { "X-ATA-Token": token, Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(res.status === 401 || res.status === 403
        ? "سایت توکن را نپذیرفت؛ توکن ERP و افزونه یکی نیست."
        : `سایت با کد ${res.status} پاسخ داد.`);
    }
    return parseFeed(await res.json());
  } finally {
    clearTimeout(timer);
  }
}

/* -------------------------------- importing ------------------------------- */

/**
 * The account an imported record belongs to.
 *
 * `createCustomer` and `createProject` both stamp `ownerUserId` from whoever is
 * acting, and a project owned by nobody is one `visibilityClause` shows to
 * nobody — so a poll with no configured owner imports nothing rather than
 * writing records that disappear. The panel says so; it is a question only a
 * person can answer.
 */
async function importingUser(ownerUserId: string): Promise<AuthUser | null> {
  const row = await getDb().user.findUnique({
    where: { id: ownerUserId },
    select: { id: true, username: true, fullName: true, isActive: true, isSystemAdmin: true },
  });
  if (!row || !row.isActive) return null;
  return {
    id: row.id,
    username: row.username ?? undefined,
    fullName: row.fullName ?? undefined,
    // The importer writes on this person's behalf and must not be narrowed by
    // their module permissions: the records are theirs by construction.
    isSystemAdmin: true,
  };
}

/**
 * The customer this request belongs to, found or created.
 *
 * Matched on the **normalised** mobile first and the email second, which is
 * the pair `customerDuplicates` already treats as identifying. Both comparisons
 * go through the same folds the customers screen uses, or a number typed on the
 * website with a `+98` and one typed here with a leading zero would be two
 * customers for one person.
 */
async function findOrCreateCustomer(rfq: WebRfq, user: AuthUser): Promise<string> {
  const db = getDb();

  const mobile = normalizeMobile(rfq.mobile);
  if (mobile) {
    const hit = await db.customer.findFirst({
      where: { mobileNormalized: mobile }, select: { id: true },
    });
    if (hit) return hit.id;
  }

  const email = rfq.email.trim().toLowerCase();
  if (email) {
    const hit = await db.customer.findFirst({
      where: { email: { equals: email } }, select: { id: true },
    });
    if (hit) return hit.id;
  }

  const created = await createCustomer(
    customerFor(rfq) as CustomerInput, user, getTodayShamsi(),
  );
  return created.id;
}

/** Whether the company's own list has this channel, so a `<select>` can show it. */
async function marketingChannelIfOffered(): Promise<string | undefined> {
  const channels = (await loadSettings())?.dropdownItems?.marketingChannels;
  if (Array.isArray(channels) && channels.includes(WEB_RFQ_MARKETING_CHANNEL)) {
    return WEB_RFQ_MARKETING_CHANNEL;
  }
  /*
   * Deliberately absent rather than written anyway. The project form's channel
   * is a `<select>` over the company's own list, and a `<select>` whose value
   * matches no option renders the **first** — so a channel this installation
   * has renamed would be silently rewritten to whatever heads their list the
   * first time somebody opened the project and pressed save.
   */
  return undefined;
}

/** Turns one request into a customer and a project. Returns the project's code. */
async function importOne(rfq: WebRfq, user: AuthUser): Promise<{ customerId: string; projectId: string; code: string }> {
  const customerId = await findOrCreateCustomer(rfq, user);
  const item = projectItemFor(rfq);
  const code = await nextProjectCode(customerId);

  const input: ProjectInput = {
    code,
    name: projectNameFor(rfq),
    customerId,
    description: projectDescriptionFor(rfq),
    customerInquiryNumber: inquiryKeyFor(rfq),
    marketingChannel: await marketingChannelIfOffered(),
    creationDate: getTodayShamsi(),
    ownerUserId: user.id,
    salesExpert: user.fullName,
    items: item ? [item] : [],
  };
  const project = await createProject(input, user, getTodayShamsi());

  return { customerId, projectId: project.id, code: project.code };
}

/* --------------------------------- the pass ------------------------------- */

/**
 * One synchronisation: read the feed, import what is new, retry what failed.
 *
 * The claim is the `web_rfq_imports` row and it is written **before** the
 * records are created, because the unique index can only decide at the moment
 * of insert — the rule `workflow_message_sends` follows. A claim that bought
 * nothing is not released, though: it is left as FAILED with its reason, so the
 * request is visible on the screen instead of being silently re-attempted for
 * ever, and it is picked up again on the next pass while it has attempts left.
 */
/** How many previously-failed requests one pass replays from stored payloads. */
const RETRY_PER_PASS = 10;

function safeJson(raw: string): unknown {
  try { return JSON.parse(raw); } catch { return null; }
}

/**
 * One attempt at an already-claimed row. Never throws: a request that cannot be
 * imported must not stop the ones behind it in the same pass.
 */
async function attempt(rowId: string, rfq: WebRfq, user: AuthUser): Promise<boolean> {
  const db = getDb();
  const payload = JSON.stringify(rfq);
  try {
    const result = await importOne(rfq, user);
    await db.webRfqImport.update({
      where: { id: rowId },
      data: {
        status: "IMPORTED", attempts: { increment: 1 }, error: null,
        customerId: result.customerId, projectId: result.projectId,
        projectCode: result.code, importedAt: new Date(), payload,
      },
    });
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.webRfqImport.update({
      where: { id: rowId },
      data: { status: "FAILED", attempts: { increment: 1 }, error: message.slice(0, 2000), payload },
    }).catch(() => { /* the row is gone; nothing to record against */ });
    return false;
  }
}

async function runSync(): Promise<number> {
  const db = getDb();
  const config = await readConfig();
  if (!config?.active) throw new Error("انتقال استعلام‌های سایت فعال نیست.");

  const refusal = feedConfigRefusal(config.feedUrl, config.token);
  if (refusal) throw new Error(refusal);
  if (!config.ownerUserId) {
    throw new Error("مسئول پروژه‌های واردشده انتخاب نشده است؛ پروژه‌ای که به کسی تعلق نداشته باشد در هیچ تخته‌ای دیده نمی‌شود.");
  }

  const user = await importingUser(config.ownerUserId);
  if (!user) throw new Error("حساب مسئول پروژه‌های واردشده یافت نشد یا غیرفعال است.");

  /*
   * The first poll draws the line and imports nothing.
   *
   * Everything already on the site was answered — or entered here by hand —
   * before this existed, so importing it would put a duplicate project beside
   * every one of those. So the first pass reads how far the site's numbering
   * has got, stores it, and stops; only what is raised from then on comes
   * across. The line is written **before** anything else can run, so a poll
   * interrupted halfway cannot leave it undrawn and import the history on the
   * next tick.
   *
   * It is `max_id` from the site and never the highest row in the list: the
   * feed hands over only *submitted* requests, so one typed and not yet sent
   * carries a higher number than anything in it and would later read as new.
   */
  if (config.startAfterId === null) {
    const probe = await fetchFeed(config.feedUrl!, config.token!, 0, BASELINE_PROBE_LIMIT);
    await db.webRfqConfig.update({
      where: { id: CONFIG_ID },
      data: { startAfterId: probe.maxId },
    });
    baselineDrawnAt = probe.maxId;
    return 0;
  }
  const line = config.startAfterId;

  const highest = await db.webRfqImport.aggregate({ _max: { rfqId: true } });
  const { sinceId, limit } = syncWindow(highest._max.rfqId ?? 0, line);
  const feed = await fetchFeed(config.feedUrl!, config.token!, sinceId, limit);
  /*
   * Filtered here as well as in the query. `since_id` is a request to a
   * machine on the internet — an older plugin, a proxy that dropped the
   * parameter, a site answering more than it was asked — and the line is a
   * decision made here, so the one that matters is applied where it cannot be
   * answered wrongly.
   */
  const rows = feed.items.filter((r) => !isBeforeLine(r, line));

  const seen = rows.length
    ? await db.webRfqImport.findMany({
      where: { rfqId: { in: rows.map((r) => r.id) } },
      select: { rfqId: true, id: true, status: true, attempts: true },
    })
    : [];
  const byId = new Map(seen.map((r) => [r.rfqId, r]));

  let imported = 0;
  // Oldest first, so the codes a run issues follow the order the enquiries
  // were raised rather than the order the site happened to list them in.
  for (const rfq of [...rows].sort((a, b) => a.id - b.id)) {
    const prior = byId.get(rfq.id);
    if (prior?.status === "IMPORTED") continue;
    if (prior && prior.attempts >= MAX_IMPORT_ATTEMPTS) continue;

    let rowId = prior?.id;
    if (!rowId) {
      rowId = randomUUID();
      try {
        await db.webRfqImport.create({
          data: {
            id: rowId, rfqId: rfq.id, status: "FAILED", attempts: 0,
            payload: JSON.stringify(rfq),
            productName: rfq.productName || null, fullName: rfq.fullName || null,
          },
        });
      } catch {
        // Another pass claimed it in the same instant. The index decided; leave it.
        continue;
      }
    }
    if (await attempt(rowId, rfq, user)) imported += 1;
  }

  /*
   * And the ones that failed and have since fallen out of the window.
   *
   * The poll asks the site for a band around the highest number seen, so a
   * request that failed a week and thirty enquiries ago is never offered
   * again — which would make «تلاش دوباره» on the screen a button that does
   * nothing, and would quietly strand exactly the requests that needed a
   * person. They are replayed from the stored payload instead, which is what
   * it is kept for: a retry needs nothing from the site.
   */
  const offered = new Set(rows.map((r) => r.id));
  const stranded = await db.webRfqImport.findMany({
    where: { status: "FAILED", attempts: { lt: MAX_IMPORT_ATTEMPTS } },
    orderBy: { rfqId: "asc" }, take: RETRY_PER_PASS,
    select: { id: true, rfqId: true, payload: true },
  });
  for (const row of stranded) {
    if (offered.has(row.rfqId)) continue; // already tried above, this pass
    if (row.rfqId <= line) continue;      // the line moved under it since
    const rfq = parseFeedRow(safeJson(row.payload));
    if (!rfq) continue;
    if (await attempt(row.id, rfq, user)) imported += 1;
  }

  return imported;
}

/**
 * Brings the imports up to date, at most one pass at a time.
 *
 * Never throws: it is called from a timer and from a button, and a feed that is
 * not answering is an ordinary outcome that belongs in the report rather than
 * in a stack trace nobody reads.
 */
export function syncWebRfqs(): Promise<number> {
  if (inFlight) return inFlight;
  lastRunAt = Date.now();
  baselineDrawnAt = null;
  inFlight = runSync()
    .then((count) => {
      lastOkAt = Date.now();
      lastError = null;
      lastImported = count;
      return count;
    })
    .catch((err) => {
      lastError = err instanceof Error ? err.message : String(err);
      return 0;
    })
    .finally(() => { inFlight = null; });
  return inFlight;
}

/** The timer's entry point: does nothing at all while the feature is off. */
export async function tickWebRfqs(): Promise<void> {
  const config = await readConfig().catch(() => null);
  if (!config?.active) return;
  await afterCommit("web rfq sync", () => syncWebRfqs());
}

/* -------------------------------- the screen ------------------------------ */

export interface WebRfqImportRow {
  id: string;
  rfqId: number;
  status: string;
  attempts: number;
  projectId: string | null;
  projectCode: string | null;
  customerId: string | null;
  productName: string | null;
  fullName: string | null;
  error: string | null;
  createdAt: Date;
  importedAt: Date | null;
}

/** The most recent imports, newest first — the durable record of what arrived. */
export async function listWebRfqImports(limit = 50): Promise<WebRfqImportRow[]> {
  return getDb().webRfqImport.findMany({
    orderBy: { rfqId: "desc" },
    take: Math.max(1, Math.min(200, limit)),
    select: {
      id: true, rfqId: true, status: true, attempts: true,
      projectId: true, projectCode: true, customerId: true,
      productName: true, fullName: true, error: true,
      createdAt: true, importedAt: true,
    },
  });
}

/**
 * Lets a failed request be tried once more from the screen.
 *
 * It resets the attempts rather than importing here and now: the next pass
 * reads the stored payload, so a retry needs nothing from the site — by now the
 * request may have fallen outside the window a poll asks for.
 */
export async function retryWebRfqImport(id: string): Promise<boolean> {
  const done = await getDb().webRfqImport.updateMany({
    where: { id, status: "FAILED" },
    data: { attempts: 0, error: null },
  });
  return done.count > 0;
}
