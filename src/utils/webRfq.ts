/**
 * Price requests raised on the public website, as records in the ERP.
 *
 * The site's advisor plugin already stores every «استعلام قیمت» as a structured
 * row — the contact details, the equipment, and the technical specification the
 * assistant extracted and the customer confirmed — and emails it. An email is
 * a copy for a person to read; it is not a record anybody can quote from, so
 * the request was retyped into the ERP by hand or answered out of the inbox.
 *
 * **The direction is the whole design decision.** The website is public and
 * this server is on a private LAN that must never be exposed, so nothing on the
 * site can push anything here: a webhook is not available in principle, not
 * merely unconfigured. So the ERP *pulls*, on a timer, exactly as it already
 * pulls the exchange rates — and the site's endpoint is a plain read with no
 * state of its own, which is what keeps a failed import from being a request
 * the site believes it has already handed over.
 *
 * Everything in this file is pure so `test:rules` can hold it: what arrives is
 * JSON from a machine on the internet, and the mapping from it to a customer
 * and a project is the half that decides what ends up on somebody's board.
 */

import { CUSTOMER_TYPE_COMPANY, CUSTOMER_TYPE_INDIVIDUAL } from "./moduleStatuses";

/**
 * The prefix under which a request's own number is recorded on the project.
 *
 * It goes in `customerInquiryNumber` — «شماره درخواست», the customer's own
 * reference for the enquiry, which is exactly what a number raised on their
 * side of the conversation is, and which the printed quotation already shows
 * them. That it is also *searchable* is what makes a second import findable
 * from the screen rather than only from the log.
 */
export const WEB_RFQ_INQUIRY_PREFIX = "WEB-RFQ-";

/** The marketing channel a website request came through, when the list has it. */
export const WEB_RFQ_MARKETING_CHANNEL = "وب‌سایت / آنلاین";

/** How many requests the very first synchronisation reaches back for. */
export const FIRST_SYNC_LIMIT = 20;

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

/** One price request, as the website's feed describes it. */
export interface WebRfq {
  /** The site's own number for it — `#12` on the email and in its panel. */
  id: number;
  fullName: string;
  company: string;
  mobile: string;
  email: string;
  /** Whatever the customer typed in the «توضیحات تکمیلی» box. */
  notes: string;
  productId: number;
  productName: string;
  productUrl: string;
  /** The confirmed technical specification, one «مشخصه: مقدار» per line. */
  specs: string;
  /** A link back to the conversation in the site's own panel. */
  panelUrl: string;
  /** When the customer pressed the button, as the site wrote it. */
  submittedAt: string;
}

const text = (value: unknown, max: number): string =>
  String(value ?? "").replace(/\r\n/g, "\n").trim().slice(0, max);

const whole = (value: unknown): number => {
  const n = Number(String(value ?? "").trim());
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
};

/**
 * One feed row, or null.
 *
 * This is data from a machine on the internet, so every field is read
 * defensively and nothing is asserted. A row with no number cannot be
 * recognised as one already imported, and a row naming nobody cannot become a
 * customer — both are dropped rather than imported as something plausible and
 * wrong, which on this path would be a project nobody can chase attached to a
 * customer nobody can ring.
 */
export function parseFeedRow(raw: unknown): WebRfq | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const id = whole(r.id);
  if (!id) return null;

  const fullName = text(r.full_name ?? r.fullName, 191);
  const company = text(r.company, 191);
  if (!fullName && !company) return null;

  return {
    id,
    fullName,
    company,
    mobile: text(r.mobile, 50),
    email: text(r.email, 191),
    notes: text(r.customer_notes ?? r.notes, 1500),
    productId: whole(r.product_id ?? r.productId),
    productName: text(r.product_name ?? r.productName, 400),
    productUrl: text(r.product_url ?? r.productUrl, 500),
    specs: text(r.specs, 8000),
    panelUrl: text(r.panel_url ?? r.panelUrl, 500),
    submittedAt: text(r.submitted_at ?? r.submittedAt, 40),
  };
}

/** Every usable row of a feed response, in the order the site sent them. */
export function parseFeed(body: unknown): WebRfq[] {
  const items = (body && typeof body === "object")
    ? (body as Record<string, unknown>).items
    : null;
  if (!Array.isArray(items)) return [];
  const out: WebRfq[] = [];
  for (const item of items) {
    const row = parseFeedRow(item);
    if (row) out.push(row);
  }
  return out;
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

/** The address a poll asks, with the window it wants. */
export function feedRequestUrl(base: string, sinceId: number, limit: number): string {
  const url = new URL(String(base).trim());
  url.searchParams.set("since_id", String(Math.max(0, Math.trunc(sinceId))));
  url.searchParams.set("limit", String(Math.max(1, Math.min(SYNC_PAGE_LIMIT, Math.trunc(limit)))));
  return url.toString();
}

/**
 * Which number to ask from, given the highest already seen.
 *
 * Nothing seen at all means the first synchronisation, which deliberately does
 * **not** reach back through the site's whole history: a company switching this
 * on wants the enquiries it is still working, not three years of answered ones
 * appearing as open projects on somebody's board this afternoon. `since_id` of
 * zero with a small limit is what asks for that, because the site answers
 * newest-first.
 */
export function syncWindow(highestSeen: number): { sinceId: number; limit: number } {
  if (highestSeen <= 0) return { sinceId: 0, limit: FIRST_SYNC_LIMIT };
  return { sinceId: Math.max(0, highestSeen - SYNC_BACKTRACK), limit: SYNC_PAGE_LIMIT };
}

/* -------------------------------- mapping --------------------------------- */

/** The key this request is recorded under on its project. */
export function inquiryKeyFor(rfq: Pick<WebRfq, "id">): string {
  return `${WEB_RFQ_INQUIRY_PREFIX}${rfq.id}`;
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
 */
export function customerFor(rfq: WebRfq): WebRfqCustomer {
  const { firstName, lastName } = splitFullName(rfq.fullName);
  const origin = `ثبت‌شده از استعلام سایت ${inquiryKeyFor(rfq)}`;

  if (rfq.company) {
    return {
      customerType: CUSTOMER_TYPE_COMPANY,
      companyName: rfq.company,
      keyPerson: rfq.fullName,
      mobile: rfq.mobile,
      email: rfq.email,
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
    notes: origin,
  };
}

/** The project's own name — the equipment, or the request when there is none. */
export function projectNameFor(rfq: WebRfq): string {
  const product = rfq.productName.trim();
  return (product || `استعلام سایت ${inquiryKeyFor(rfq)}`).slice(0, 400);
}

/**
 * Everything the request said, as the project's description.
 *
 * The specification is the point of it: it is what the visitor and the site's
 * assistant settled on, line by line, and it is what a quotation is written
 * from. The customer's own note comes under its own heading rather than being
 * run into it, and both links travel — the product page because the quotation
 * is for that equipment, and the conversation because the specification is a
 * summary and the thread is the evidence behind it.
 *
 * A heading with nothing under it is worse than no heading, so each block is
 * written only when it has something in it.
 */
export function projectDescriptionFor(rfq: WebRfq): string {
  const blocks: string[] = [`درخواست استعلام از وب‌سایت — شماره ${rfq.id}`];

  if (rfq.submittedAt) blocks.push(`تاریخ ثبت در سایت: ${rfq.submittedAt}`);
  if (rfq.fullName) blocks.push(`تماس‌گیرنده: ${rfq.fullName}`);

  const contact = [rfq.mobile, rfq.email].filter(Boolean).join(" — ");
  if (contact) blocks.push(`راه ارتباطی: ${contact}`);

  if (rfq.productName) {
    blocks.push(rfq.productUrl
      ? `تجهیز درخواستی: ${rfq.productName}\n${rfq.productUrl}`
      : `تجهیز درخواستی: ${rfq.productName}`);
  }
  if (rfq.specs) blocks.push(`مشخصات تأییدشده توسط مشتری:\n${rfq.specs}`);
  if (rfq.notes) blocks.push(`توضیحات تکمیلی مشتری:\n${rfq.notes}`);
  if (rfq.panelUrl) blocks.push(`متن کامل گفتگو در پنل سایت:\n${rfq.panelUrl}`);

  return blocks.join("\n\n");
}

/**
 * The «اقلام مورد نیاز» line this request implies, or null.
 *
 * One line naming the equipment, with **no `productId`** however confident the
 * site is about its own catalogue: that column is a real foreign key into
 * *this* database and the site's `product_id` is a WordPress post id, so
 * writing it would point at nothing — the trap `scrubProductRefs` exists for.
 * The name is what a person matches against the catalogue when they quote.
 */
export function projectItemFor(rfq: WebRfq): { name: string; quantity: number } | null {
  const name = rfq.productName.trim();
  if (!name) return null;
  return { name: name.slice(0, 400), quantity: 1 };
}
