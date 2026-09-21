/**
 * Price requests raised on the public website, as records in the ERP.
 *
 * Two plugins on the site record one, and they are genuinely two things. The
 * **advisor** takes a visitor through a conversation and stores the one
 * specification they settled on; the **form** hands them a technical datasheet
 * per item and lets them attach their own drawings, so one request there is
 * several pieces of equipment with their own quantities. Both email the result,
 * and an email is a copy for a person to read — not a record anybody can quote
 * from, so the request was retyped here by hand or answered out of the inbox.
 *
 * **The direction is the whole design decision.** The website is public and
 * this server is on a private LAN that must never be exposed, so nothing on the
 * site can push anything here: a webhook is not available in principle, not
 * merely unconfigured. So the ERP *pulls*, on a timer, exactly as it already
 * pulls the exchange rates — and each plugin's endpoint is a plain read with no
 * state of its own, which is what keeps a failed import from being a request
 * the site believes it has already handed over.
 *
 * Everything in this file is pure so `test:rules` can hold it: what arrives is
 * JSON from a machine on the internet, and the mapping from it to a customer
 * and a project is the half that decides what ends up on somebody's board.
 */

import { CUSTOMER_TYPE_COMPANY, CUSTOMER_TYPE_INDIVIDUAL } from "./moduleStatuses";
import { categoryKey } from "./productCategories";

/* ------------------------------- the sources ------------------------------ */

/**
 * The prefix under which an advisor request's own number is recorded.
 *
 * It goes in `customerInquiryNumber` — «شماره درخواست», the customer's own
 * reference for the enquiry, which is exactly what a number raised on their
 * side of the conversation is, and which the printed quotation already shows
 * them. That it is also *searchable* is what makes a second import findable
 * from the screen rather than only from the log.
 *
 * Kept as its own name rather than read out of the catalogue below by index:
 * a list may be reordered, and this spelling is on every project imported
 * before the second source existed.
 */
export const WEB_RFQ_INQUIRY_PREFIX = "WEB-RFQ-";

/** One plugin the site records price requests with. */
export interface WebRfqSourceSpec {
  id: string;
  /** What the panel calls it — two cards, and neither may be a guess. */
  label: string;
  /** Which plugin this is, in one line, because the labels alone could be either. */
  hint: string;
  /** The address its feed answers on, as a placeholder in the panel. */
  samplePath: string;
  /**
   * What a request is filed under when the plugin issues no reference of its
   * own. The two prefixes must differ: both plugins number their requests from
   * one, and one prefix would file two different enquiries under one key.
   */
  inquiryPrefix: string;
}

/**
 * The catalogue, and the single list of sources.
 *
 * The union below is **derived from it**, so a source cannot exist in one and
 * not the other — the drift `APP_MODULES` and `WORKFLOW_ACTION_TYPES` are each
 * the answer to, on a much smaller list.
 */
export const WEB_RFQ_SOURCES = [
  {
    id: "ADVISOR",
    label: "مشاور هوشمند سایت",
    hint: "افزونهٔ «ata-advisor» — گفتگوی مشاور با بازدیدکننده؛ یک تجهیز در هر درخواست.",
    samplePath: "https://example.com/wp-json/ata/v1/rfq/erp-feed",
    inquiryPrefix: WEB_RFQ_INQUIRY_PREFIX,
  },
  {
    id: "FORM",
    label: "فرم استعلام قیمت",
    hint: "افزونهٔ «ata-smart-rfq» — فرم فنی و پیوست؛ چند قلم در هر درخواست.",
    samplePath: "https://example.com/wp-json/ata-rfq/v1/erp-feed",
    inquiryPrefix: "WEB-FORM-",
  },
] as const satisfies readonly WebRfqSourceSpec[];

export type WebRfqSourceId = typeof WEB_RFQ_SOURCES[number]["id"];

/**
 * The source a request belongs to when nobody said.
 *
 * Every row and every configuration written before the second plugin existed
 * is the advisor's, which is what it is — the `DEFAULT 'CUSTOMER'` rule on
 * `messages.audience`, and the reason the column's database default says the
 * same thing.
 */
export const DEFAULT_WEB_RFQ_SOURCE: WebRfqSourceId = "ADVISOR";

export function isWebRfqSource(value: unknown): value is WebRfqSourceId {
  return WEB_RFQ_SOURCES.some((source) => source.id === value);
}

/** The catalogue entry for a source, falling back to the advisor's. */
export function webRfqSourceSpec(id: unknown): WebRfqSourceSpec {
  return WEB_RFQ_SOURCES.find((source) => source.id === id) ?? WEB_RFQ_SOURCES[0];
}

/* ------------------------- «this came from the site» ---------------------- */

/**
 * The two columns that say a request arrived through the website.
 *
 * Both are `<select>`s over the company's **own** editable lists, so neither may
 * be written with a value the list does not carry: a `<select>` whose value
 * matches no option renders the **first**, and the value would be silently
 * rewritten to whatever heads that list the first time somebody opened the
 * project and pressed save.
 *
 * These are the spellings a fresh installation is seeded with and the ones
 * `settingsPatches` adds to a live document — but they are the *canonical*
 * answers rather than the only ones, because a company may have renamed theirs.
 * Both plugins are the same website, so neither source changes these.
 */
export const WEB_RFQ_MARKETING_CHANNEL = "وب‌سایت / آنلاین";
export const WEB_RFQ_COMMUNICATION_METHOD = "وب‌سایت";

/**
 * Every spelling of «the website» this build recognises in one of those lists.
 *
 * Read rather than written: the point is to find the entry a company already
 * has, so that appending a canonical one never puts a second name for the same
 * thing beside it — two spellings of one channel split every report that groups
 * by it, which is `categoryKey`'s own lesson arriving on another column.
 */
export const WEB_CHANNEL_ALIASES = [
  WEB_RFQ_MARKETING_CHANNEL, WEB_RFQ_COMMUNICATION_METHOD,
  "وب سایت", "وبسایت", "سایت", "آنلاین", "اینترنت",
];

/**
 * The fold, **derived from `categoryKey` rather than written a second time**.
 *
 * It folds what that one already does — ی/ي, ک/ك, the zero-width joiner, case —
 * and then drops the spaces and slashes too, because «وب‌سایت / آنلاین» and
 * «وب سایت/آنلاین» are one entry written two ways and only the separators
 * differ. It is deliberately not a change to `categoryKey`, whose own callers
 * need «فرا سو» and «فراسو» kept apart.
 */
const webKey = (value: unknown): string => categoryKey(value).replace(/[\s/]+/g, "");

const WEB_KEYS = new Set(WEB_CHANNEL_ALIASES.map(webKey));

/**
 * The entry in this list that already means «the website», or null.
 *
 * Null is what makes the column stay blank rather than being written with
 * something the dropdown cannot offer — the same direction every other rule
 * here takes when the answer is not knowable.
 */
export function webEntryIn(list: unknown): string | null {
  if (!Array.isArray(list)) return null;
  for (const entry of list) {
    if (typeof entry === "string" && WEB_KEYS.has(webKey(entry))) return entry;
  }
  return null;
}

/**
 * How many rows the baseline pass asks for.
 *
 * The first poll after a source is switched on **imports nothing**: it reads
 * where that plugin's numbering has got to and records it as the line, so only
 * what is raised from then on comes across. Anything already on the site was
 * answered — or entered here by hand — before this existed, and importing it
 * would put a second, duplicate project beside every one of those.
 *
 * A handful rather than one, so the panel can say what it found rather than
 * only that it found something.
 */
export const BASELINE_PROBE_LIMIT = 5;

/**
 * How far behind the highest request already seen the next poll asks from.
 *
 * The site numbers requests in the order they are *created* and hands over the
 * ones that have been *submitted*, and those two orders genuinely differ: a
 * visitor who opens two product cards and sends the second one first submits a
 * higher number before a lower one. Asking strictly above the highest number
 * seen would then skip the earlier request for ever. Overlapping by a score of
 * rows costs a few kilobytes on a poll and closes that door; anything already
 * imported is recognised locally and costs nothing.
 */
export const SYNC_BACKTRACK = 20;

/** The most a single poll will take in, however many are waiting. */
export const SYNC_PAGE_LIMIT = 50;

/**
 * How many times a request that failed to import is tried again.
 *
 * A failure is usually transient (the database was busy, a rule refused a name
 * that has since been corrected), so retrying is right — but retrying for ever
 * would mean a genuinely unimportable request is attempted every five minutes
 * until somebody notices, which is nobody. After the third attempt it stays
 * failed, on the screen, with its reason, and a person decides.
 */
export const MAX_IMPORT_ATTEMPTS = 3;

/* ------------------------------ what arrives ------------------------------ */

/**
 * One piece of equipment on a request.
 *
 * The advisor's requests carry exactly one and the form's carry up to fifty,
 * each with its own quantity and its own datasheet — which is the whole reason
 * this is a list rather than three columns: folding several items into one
 * «اقلام مورد نیاز» row would lose the quantities, and the scope of the job is
 * what those rows are for.
 */
export interface WebRfqLine {
  /**
   * The site's own product id — a WordPress post id, recorded for the reader
   * and **never** written onto a project line, where the column is a real
   * foreign key into this database.
   */
  productId: number;
  productName: string;
  quantity: number;
  /** The confirmed specification, one «مشخصه: مقدار» per line. */
  specs: string;
}

/** One price request, as a plugin's feed describes it. */
export interface WebRfq {
  /** Which plugin it came from. Supplied by the reader, never read off the row. */
  source: WebRfqSourceId;
  /** The plugin's own number for it — `#12` on the email and in its panel. */
  id: number;
  /**
   * The plugin's own human reference, when it issues one.
   *
   * The form plugin emails the customer «درخواست شما با کد ATA-RFQ-… ثبت شد»,
   * so that string is literally the customer's own reference for the enquiry —
   * which is what `customerInquiryNumber` means, and what makes the number they
   * quote on the phone findable from the screen. The advisor issues none.
   */
  reference: string;
  fullName: string;
  company: string;
  mobile: string;
  email: string;
  /** Where they are, when the form asked. Free text; the province is not guessed. */
  city: string;
  /** «تا چه زمانی لازم دارید» — free text, so it is prose and not a date column. */
  deadline: string;
  /** Whatever the customer typed in the «توضیحات تکمیلی» box. */
  notes: string;
  productUrl: string;
  /** A link back to the request in the site's own panel. */
  panelUrl: string;
  /**
   * How many files the customer attached.
   *
   * A count and not the files: the form plugin stores them outside the web root
   * behind a deny-all rule and serves them only to a signed-in administrator,
   * so this server cannot fetch them. Naming the count beside the panel link is
   * the honest answer — a project that claimed to hold files it does not would
   * be worse than one that says where they are.
   */
  attachmentCount: number;
  /** The equipment asked for. Empty when the request was a bare file upload. */
  lines: WebRfqLine[];
  /** When the customer pressed the button, as the site wrote it. */
  submittedAt: string;
}

const text = (value: unknown, max: number): string =>
  String(value ?? "").replace(/\r\n/g, "\n").trim().slice(0, max);

const whole = (value: unknown): number => {
  const n = Number(String(value ?? "").trim());
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
};

const amount = (value: unknown): number => {
  const n = Number(String(value ?? "").trim());
  return Number.isFinite(n) && n > 0 ? n : 1;
};

/**
 * The equipment on a row, from either wire shape.
 *
 * The form plugin sends a `lines` array; the advisor sends the single product
 * flat on the row, and so does every payload stored before this existed — so
 * one reader reconciles both and **never reads both**, exactly as
 * `parseAttachments` reconciles a JSON column against the older single columns.
 * Reading the flat keys as well would put the first item on the project twice.
 */
function parseLines(r: Record<string, unknown>): WebRfqLine[] {
  const raw = r.lines ?? r.items;
  if (Array.isArray(raw)) {
    const lines: WebRfqLine[] = [];
    for (const entry of raw) {
      if (!entry || typeof entry !== "object") continue;
      const line = entry as Record<string, unknown>;
      const productName = text(line.product_name ?? line.productName, 400);
      const specs = text(line.specs, 8000);
      // A line naming nothing and saying nothing is not a line.
      if (!productName && !specs) continue;
      lines.push({
        productId: whole(line.product_id ?? line.productId),
        productName,
        quantity: amount(line.quantity),
        specs,
      });
    }
    return lines;
  }

  const productName = text(r.product_name ?? r.productName, 400);
  const specs = text(r.specs, 8000);
  if (!productName && !specs) return [];
  return [{
    productId: whole(r.product_id ?? r.productId),
    productName,
    quantity: amount(r.quantity ?? 1),
    specs,
  }];
}

/**
 * One feed row, or null.
 *
 * This is data from a machine on the internet, so every field is read
 * defensively and nothing is asserted. A row with no number cannot be
 * recognised as one already imported, and a row naming nobody cannot become a
 * customer — both are dropped rather than imported as something plausible and
 * wrong, which on this path would be a project nobody can chase attached to a
 * customer nobody can ring.
 *
 * The **source is an argument**, never read off the row: which plugin answered
 * is a fact about the configuration that was polled, and a feed that could name
 * its own source could file its requests under the other one's numbering.
 */
export function parseFeedRow(raw: unknown, source: WebRfqSourceId): WebRfq | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const id = whole(r.id);
  if (!id) return null;

  const fullName = text(r.full_name ?? r.fullName ?? r.customer_name, 191);
  const company = text(r.company, 191);
  if (!fullName && !company) return null;

  return {
    source,
    id,
    reference: text(r.reference, 60),
    fullName,
    company,
    mobile: text(r.mobile, 50),
    email: text(r.email, 191),
    city: text(r.city, 100),
    deadline: text(r.deadline, 200),
    notes: text(r.customer_notes ?? r.notes ?? r.note, 1500),
    productUrl: text(r.product_url ?? r.productUrl, 500),
    panelUrl: text(r.panel_url ?? r.panelUrl, 500),
    attachmentCount: whole(r.attachment_count ?? r.attachmentCount),
    lines: parseLines(r),
    submittedAt: text(r.submitted_at ?? r.submittedAt ?? r.created_at, 40),
  };
}

/** A feed response: the usable rows, and where the plugin's numbering has got to. */
export interface WebRfqFeed {
  items: WebRfq[];
  /**
   * The highest request number on the site, **whatever its status**.
   *
   * Not the highest among `items`, and the difference is the whole point of
   * the column: the feed hands over only *submitted* requests, so a request
   * typed but not yet sent carries a higher number than anything in the list.
   * Taking the line from the list would let that one across the moment it was
   * sent, as though it were new — and it is not, it was already on the site
   * when this was switched on. Zero when the site did not say, which is an
   * older copy of the plugin file.
   */
  maxId: number;
}

export function parseFeed(body: unknown, source: WebRfqSourceId): WebRfqFeed {
  const raw = (body && typeof body === "object") ? body as Record<string, unknown> : {};
  const items: WebRfq[] = [];
  if (Array.isArray(raw.items)) {
    for (const item of raw.items) {
      const row = parseFeedRow(item, source);
      if (row) items.push(row);
    }
  }
  /*
   * A site that does not report it falls back to the highest row it did send.
   * That is weaker — an unsent request numbered above it would later read as
   * new — but it is the safe direction of weaker: it still excludes every
   * request the site has already answered, which is what was asked for.
   */
  const stated = whole(raw.max_id ?? raw.maxId);
  const seen = items.reduce((top, row) => Math.max(top, row.id), 0);
  return { items, maxId: Math.max(stated, seen) };
}

/* ------------------------------ configuration ----------------------------- */

/**
 * Why this address and token cannot be used, or null.
 *
 * The same rule `relayConfigRefusal` states for the messaging relay, in its own
 * words because it names a different host and is read on a different screen:
 * the token travels on every poll, so **plain HTTP is refused** — loopback
 * excepted, which is what makes it testable on one box without weakening the
 * rule for the real site — and **an address with no token is refused loudly**
 * rather than polled open, since an open feed hands every customer's name, phone
 * number and enquiry to anybody who finds the URL.
 *
 * Both blank is not a refusal: that is every installation until somebody fills
 * the panel in, and the feature is simply off.
 */
export function feedConfigRefusal(
  url: string | null | undefined,
  token: string | null | undefined,
): string | null {
  const address = String(url ?? "").trim();
  const secret = String(token ?? "").trim();

  if (!address) {
    // Half a configuration, and the half that is missing says *where* to look.
    if (secret) return "آدرس فید استعلام سایت وارد نشده است.";
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(address);
  } catch {
    return "آدرس فید استعلام سایت معتبر نیست.";
  }

  const loopback = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1"
    || parsed.hostname === "[::1]" || parsed.hostname === "::1";
  if (parsed.protocol !== "https:" && !loopback) {
    return "آدرس فید باید https باشد؛ توکن نباید روی اتصال رمزنشده برود.";
  }
  if (!secret) {
    return "توکن فید وارد نشده است. بدون توکن، اطلاعات تماس مشتریان برای هر کسی که آدرس را بداند خوانا می‌شود.";
  }
  return null;
}

/**
 * Why these two feeds cannot both be used, or null.
 *
 * Two sources are two plugins, and pointing both cards at **one** address is
 * the mistake the second card invites: the requests would be read twice, once
 * under each source, and imported as two projects for one enquiry — the
 * duplicate this whole module exists to avoid, arriving through the control
 * added to widen it. It is refused where it is typed, because by the time a
 * poll could notice, the second project is already on somebody's board.
 */
export function duplicateFeedRefusal(
  url: string | null | undefined,
  otherUrl: string | null | undefined,
): string | null {
  const mine = String(url ?? "").trim();
  const theirs = String(otherUrl ?? "").trim();
  if (!mine || !theirs) return null;
  if (mine !== theirs) return null;
  return "این آدرس برای منبع دیگری هم ثبت شده است؛ یک فید نباید دو بار خوانده شود، وگرنه هر استعلام دو پروژه می‌سازد.";
}

/** The address a poll asks, with the window it wants. */
export function feedRequestUrl(base: string, sinceId: number, limit: number): string {
  const url = new URL(String(base).trim());
  url.searchParams.set("since_id", String(Math.max(0, Math.trunc(sinceId))));
  url.searchParams.set("limit", String(Math.max(1, Math.min(SYNC_PAGE_LIMIT, Math.trunc(limit)))));
  return url.toString();
}

/**
 * Which number to ask from, given the line and the highest already seen.
 *
 * `startAfterId` is the line: the plugin's numbering as it stood when this was
 * switched on, below which nothing is ever imported. **Absent and zero are two
 * different answers** — absent means no line has been drawn yet, which is what
 * the baseline pass is for, while a stored zero is somebody having decided the
 * line is «everything», and both must survive a save.
 *
 * The backtrack overlaps the last window because the site numbers requests in
 * *creation* order and hands over the ones *submitted*, and those orders
 * genuinely differ — but it may never reach below the line, or the very
 * requests the line was drawn to exclude would come back in through it.
 */
export function syncWindow(
  highestSeen: number,
  startAfterId: number,
): { sinceId: number; limit: number } {
  const floor = Math.max(0, startAfterId);
  const back = highestSeen > 0 ? highestSeen - SYNC_BACKTRACK : 0;
  return { sinceId: Math.max(floor, back, 0), limit: SYNC_PAGE_LIMIT };
}

/**
 * Whether this request is one the line excludes.
 *
 * Asked of every row rather than trusted to the query: `since_id` is a request
 * to a machine on the internet and the line is a decision made here, so the
 * one that matters is checked where it cannot be answered wrongly.
 */
export function isBeforeLine(rfq: Pick<WebRfq, "id">, startAfterId: number): boolean {
  return rfq.id <= Math.max(0, startAfterId);
}

/* -------------------------------- mapping --------------------------------- */

/**
 * The key this request is recorded under on its project.
 *
 * **The plugin's own reference wins** where it issues one: the form plugin
 * emails the customer «درخواست شما با کد ATA-RFQ-… ثبت شد», so that is
 * literally their reference for the enquiry, which is what the column means
 * and what they will quote on the phone. Where there is none the prefix and
 * the number stand in — and the two sources' prefixes differ, because both
 * plugins number from one and a shared prefix would file two unrelated
 * enquiries under the same key.
 */
export function inquiryKeyFor(rfq: Pick<WebRfq, "id" | "source" | "reference">): string {
  const reference = String(rfq.reference ?? "").trim();
  if (reference) return reference.slice(0, 60);
  return `${webRfqSourceSpec(rfq.source).inquiryPrefix}${rfq.id}`;
}

/**
 * A person's name split into its two columns.
 *
 * The site asks for one box, «نام و نام خانوادگی», so the split is a guess —
 * and the guess is made in the direction that keeps the whole name visible: the
 * **last** word is the family name and everything before it is the given name,
 * so «سید محمد حسین رضایی» keeps all four words rather than losing two. A
 * single word becomes the given name with a blank family name, because
 * inventing a surname is worse than leaving the column empty.
 */
export function splitFullName(full: string): { firstName: string; lastName: string } {
  const parts = String(full ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1] };
}

/** As much of a customer as this module writes. */
export interface WebRfqCustomer {
  customerType: string;
  companyName: string;
  firstName?: string;
  lastName?: string;
  keyPerson?: string;
  mobile: string;
  email: string;
  city?: string;
  notes: string;
}

/**
 * The customer a request describes.
 *
 * **A company name is what decides the type**, and nothing else can: the site
 * asks for the company in its own box and leaves it blank for somebody buying
 * as themselves. Where there is one the record is «حقوقی» and the person who
 * wrote in becomes `keyPerson` — the alternative was to throw their name away,
 * which is the one detail needed to ring back. Where there is none it is
 * «حقیقی», and `companyName` is filled with the person's own name the way the
 * customers screen already does it, so every dropdown and every printed
 * document has something to show.
 *
 * The city is written where the form asked for one and is **spread**, because
 * `scalarData` writes a key that is present-but-undefined as null, which is the
 * same value while claiming the question was answered. The **province is left
 * alone**: there is no city-to-province table here, and a guessed province is
 * one `canonicalizeProvince` would happily store and nobody could tell from an
 * answer somebody gave.
 */
export function customerFor(rfq: WebRfq): WebRfqCustomer {
  const { firstName, lastName } = splitFullName(rfq.fullName);
  const origin = `ثبت‌شده از استعلام سایت ${inquiryKeyFor(rfq)}`;
  const city = rfq.city.trim();

  if (rfq.company) {
    return {
      customerType: CUSTOMER_TYPE_COMPANY,
      companyName: rfq.company,
      keyPerson: rfq.fullName,
      mobile: rfq.mobile,
      email: rfq.email,
      ...(city ? { city } : {}),
      notes: origin,
    };
  }
  return {
    customerType: CUSTOMER_TYPE_INDIVIDUAL,
    companyName: rfq.fullName,
    firstName,
    lastName,
    mobile: rfq.mobile,
    email: rfq.email,
    ...(city ? { city } : {}),
    notes: origin,
  };
}

/**
 * The project's own name.
 *
 * The first item's equipment, and where there are several the count comes with
 * it — a job asking for four instruments named after only the first reads, on
 * every grid it appears in, as a job for one. A request that named no equipment
 * at all (the form's «فقط فایل» mode) is named for the request itself.
 */
export function projectNameFor(rfq: WebRfq): string {
  const first = rfq.lines[0]?.productName.trim() ?? "";
  if (!first) return `استعلام سایت ${inquiryKeyFor(rfq)}`.slice(0, 400);
  if (rfq.lines.length > 1) {
    return `${first} و ${rfq.lines.length - 1} قلم دیگر`.slice(0, 400);
  }
  return first.slice(0, 400);
}

/**
 * Everything the request said, as the project's description.
 *
 * The specification is the point of it: it is what the customer filled in or
 * settled on, line by line, and it is what a quotation is written from. The
 * customer's own note comes under its own heading rather than being run into
 * it, and both links travel — the product page because the quotation is for
 * that equipment, and the panel because the specification is a summary, the
 * thread and the attachments are the evidence behind it, and those files are
 * reachable from nowhere else.
 *
 * A heading with nothing under it is worse than no heading, so each block is
 * written only when it has something in it.
 */
export function projectDescriptionFor(rfq: WebRfq): string {
  const spec = webRfqSourceSpec(rfq.source);
  const blocks: string[] = [
    `درخواست استعلام از وب‌سایت (${spec.label}) — شماره ${rfq.id}`,
  ];

  if (rfq.reference) blocks.push(`کد پیگیری سایت: ${rfq.reference}`);
  if (rfq.submittedAt) blocks.push(`تاریخ ثبت در سایت: ${rfq.submittedAt}`);
  if (rfq.fullName) blocks.push(`تماس‌گیرنده: ${rfq.fullName}`);

  const contact = [rfq.mobile, rfq.email].filter(Boolean).join(" — ");
  if (contact) blocks.push(`راه ارتباطی: ${contact}`);
  if (rfq.city) blocks.push(`شهر: ${rfq.city}`);
  if (rfq.deadline) blocks.push(`زمان مورد نیاز مشتری: ${rfq.deadline}`);

  rfq.lines.forEach((line, index) => {
    const heading = rfq.lines.length > 1
      ? `قلم ${index + 1}: ${line.productName || "بدون نام"} — تعداد ${line.quantity}`
      : `تجهیز درخواستی: ${line.productName || "بدون نام"} — تعداد ${line.quantity}`;
    const parts = [heading];
    if (index === 0 && rfq.productUrl) parts.push(rfq.productUrl);
    if (line.specs) parts.push(line.specs);
    blocks.push(parts.join("\n"));
  });

  if (rfq.notes) blocks.push(`توضیحات تکمیلی مشتری:\n${rfq.notes}`);
  /*
   * The files stay on the site: the form plugin keeps them outside the web root
   * behind a deny-all rule and serves them only to a signed-in administrator,
   * so this server cannot fetch them. Saying how many there are beside the link
   * is the honest answer — a project silently missing the drawing the whole
   * enquiry was about is the failure that matters.
   */
  if (rfq.attachmentCount > 0) {
    blocks.push(`${rfq.attachmentCount} فایل پیوست در پنل سایت ثبت شده است (اینجا منتقل نمی‌شود).`);
  }
  if (rfq.panelUrl) blocks.push(`اصل درخواست در پنل سایت:\n${rfq.panelUrl}`);

  return blocks.join("\n\n");
}

/**
 * The «اقلام مورد نیاز» lines this request implies.
 *
 * One line per item, with **no `productId`** however confident the site is
 * about its own catalogue: that column is a real foreign key into *this*
 * database and the site's `product_id` is a WordPress post id, so writing it
 * would point at nothing — the trap `scrubProductRefs` exists for. The name is
 * what a person matches against the catalogue when they quote, and the quantity
 * is what the customer asked for, which is the scope of the job.
 *
 * A line with no name gets none: an unnamed row on that grid is one nobody can
 * quote from, and whatever it said is already in the description.
 */
export function projectItemsFor(rfq: WebRfq): { name: string; quantity: number }[] {
  return rfq.lines
    .filter((line) => line.productName.trim())
    .map((line) => ({ name: line.productName.trim().slice(0, 400), quantity: line.quantity }));
}
