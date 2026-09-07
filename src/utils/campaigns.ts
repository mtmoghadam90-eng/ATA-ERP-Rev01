/**
 * Segments and campaigns: sending one message to a group of customers.
 *
 * Two ideas, and the first one decides the shape of everything else.
 *
 * **A segment is a saved query, never a stored list of customers.** Keeping the
 * ids would be a photograph taken the day somebody pressed save: a customer who
 * qualifies tomorrow is not in it, one who has since asked not to be contacted
 * still is, and the list quietly rots while looking exactly as it did. So a
 * segment stores the *customers grid's own query parameters* and is resolved
 * against the database every time it is used — which also means there is one
 * filter dialect in this application rather than two, and a segment cannot ask
 * a question the screen has no way to ask.
 *
 * **A campaign is a segment plus a message, and it enqueues into the outbox
 * every other message already goes through.** `queueForCustomer` is the one
 * sending path: quiet hours, the dry-run switch, the retry policy, a customer's
 * `doNotContact` and the opt-out on a project's named contact all apply here
 * with nothing re-implemented. A second sender would be a second copy of all
 * five, and the first one anybody forgot would be the one that texts somebody
 * who asked us not to.
 *
 * Everything in this file is pure. The reading is `campaignService.ts`.
 */

/* -------------------------------- segments -------------------------------- */

/**
 * What a message can be measured by, and what it cannot.
 *
 * An SMS panel here reports that it accepted a message and nothing after that:
 * there is no delivery receipt, no read receipt, and a customer's reply arrives
 * on somebody's phone rather than in this system. So a campaign reports what it
 * queued, what the provider accepted and what it refused — and says so plainly,
 * because an "open rate" card sitting permanently at zero is worse than no card
 * at all.
 */
export const CAMPAIGN_MEASUREMENT_NOTE =
  "برای پیامک، امکان اندازه‌گیری «باز شدن» یا «پاسخ» وجود ندارد؛ آنچه گزارش می‌شود وضعیت ارسال است.";

/** How many customers one campaign may reach. A cap, not a page. */
export const CAMPAIGN_RECIPIENT_LIMIT = 2_000;

export const CAMPAIGN_STATUS = {
  DRAFT: "DRAFT",
  SENDING: "SENDING",
  SENT: "SENT",
  CANCELLED: "CANCELLED",
} as const;

export type CampaignStatus = typeof CAMPAIGN_STATUS[keyof typeof CAMPAIGN_STATUS];

export const CAMPAIGN_STATUS_LABELS: Record<CampaignStatus, string> = {
  DRAFT: "پیش‌نویس",
  SENDING: "در حال ارسال",
  SENT: "ارسال شده",
  CANCELLED: "لغو شده",
};

export const isCampaignStatus = (value: unknown): value is CampaignStatus =>
  typeof value === "string" && value in CAMPAIGN_STATUS_LABELS;

/**
 * A stored segment query.
 *
 * Every value is a string because that is what a query string carries and what
 * `parseListQuery` reads — storing numbers here would mean two spellings of the
 * same filter depending on whether it came from the grid or from a segment.
 */
export type SegmentQuery = Record<string, string>;

/**
 * Keeps the keys the customers endpoint actually reads, and drops the rest.
 *
 * The allowlist is handed in rather than written out here, because it belongs
 * to the customers module: a filter added there and not here would be one a
 * segment silently ignores, which is the worst way for this to fail — the
 * segment saves, its card prints the filter, and it matches a different set of
 * people from the grid the person built it on.
 *
 * A blank value and the literal «all» are both dropped, because that is what
 * `parseListQuery` does with them: keeping them would make two segments that
 * ask the same question compare as different.
 */
export function sanitizeSegmentQuery(raw: unknown, allowed: readonly string[]): SegmentQuery {
  const src = (raw ?? {}) as Record<string, unknown>;
  const out: SegmentQuery = {};

  for (const key of allowed) {
    const value = src[key];
    // A repeated query parameter arrives as an array; the first is what
    // `parseListQuery` would read, so it is what is stored.
    const first = Array.isArray(value) ? value[0] : value;
    if (typeof first !== "string") continue;
    const text = first.trim();
    if (!text || text === "all") continue;
    out[key] = text;
  }

  return out;
}

export function parseSegmentQuery(raw: unknown, allowed: readonly string[]): SegmentQuery {
  if (typeof raw !== "string" || !raw) return {};
  try {
    return sanitizeSegmentQuery(JSON.parse(raw), allowed);
  } catch {
    return {};
  }
}

/**
 * A segment with no filters at all is «every customer», and that is refused.
 *
 * Not because it is meaningless — it is perfectly meaningful — but because it
 * is what an empty form produces, and the cost of the mistake is a message to
 * the entire customer list. Somebody who genuinely wants everybody says so with
 * a filter that says everybody.
 */
export function segmentRefusal(
  name: unknown,
  query: SegmentQuery,
  existingNames: readonly string[],
): string | null {
  const text = String(name ?? "").trim();
  if (!text) return "نام سگمنت الزامی است.";
  if (text.length > 200) return "نام سگمنت طولانی‌تر از حد مجاز است.";

  const key = segmentKey(text);
  if (existingNames.some((n) => segmentKey(n) === key)) {
    return "سگمنتی با همین نام وجود دارد.";
  }

  if (Object.keys(query).length === 0) {
    return "سگمنت باید حداقل یک شرط داشته باشد؛ «همه مشتریان» با فرم خالی ثبت نمی‌شود.";
  }

  return null;
}

/**
 * Folds what is only spelling, so one segment cannot be entered twice.
 *
 * The same rule as `categoryKey` and `competitorKey`: case, the ی/ي and ک/ك
 * pairs, the zero-width joiner and runs of whitespace. It does **not** translate
 * or join words, so «مشتریان طلایی» and «مشتریان  طلایی» are one name while
 * «طلایی‌ها» beside it stays two.
 */
export function segmentKey(value: unknown): string {
  return String(value ?? "")
    .replace(/‌/g, "")
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/* -------------------------------- campaigns ------------------------------- */

export function campaignRefusal(input: {
  name: unknown;
  segmentId: unknown;
  channel: unknown;
  body: unknown;
}): string | null {
  const name = String(input.name ?? "").trim();
  if (!name) return "نام کمپین الزامی است.";
  if (name.length > 200) return "نام کمپین طولانی‌تر از حد مجاز است.";
  if (!String(input.segmentId ?? "").trim()) return "انتخاب سگمنت الزامی است.";
  if (!String(input.channel ?? "").trim()) return "انتخاب کانال ارسال الزامی است.";
  if (!String(input.body ?? "").trim()) return "متن پیام خالی است.";
  return null;
}

/**
 * Why a customer in the segment got no message.
 *
 * A campaign that reaches 83 of 120 people and says nothing else reads as
 * broken. Each of these is a different thing to do about it — an opt-out is a
 * decision to respect, a missing mobile is a gap somebody fills in on the
 * customers screen, and «already sent» is the campaign being re-run and is not
 * a fault at all — so they are counted apart and named.
 */
export const SKIP_REASONS = {
  ALREADY_SENT: "ALREADY_SENT",
  OPTED_OUT: "OPTED_OUT",
  NO_ADDRESS: "NO_ADDRESS",
  OTHER: "OTHER",
} as const;

export type SkipReason = typeof SKIP_REASONS[keyof typeof SKIP_REASONS];

export const SKIP_REASON_LABELS: Record<SkipReason, string> = {
  ALREADY_SENT: "قبلاً در همین کمپین پیام گرفته‌اند",
  OPTED_OUT: "درخواست عدم تماس دارند",
  NO_ADDRESS: "نشانی ارسال (موبایل/ایمیل/شناسه بله) ندارند",
  OTHER: "به دلیل دیگری قابل ارسال نبودند",
};

/**
 * Reads the recipient resolver's Persian refusal back into one of the reasons
 * above, so the report groups by *what to do about it* rather than by sentence.
 *
 * Anything unrecognised is `OTHER` and keeps its own sentence beside the count,
 * rather than being folded into the nearest neighbour: a reason nobody
 * anticipated is exactly the one worth reading in full.
 */
export function skipReasonFor(reason: string | null | undefined): SkipReason {
  const text = String(reason ?? "");
  if (!text) return SKIP_REASONS.OTHER;
  if (text.includes("عدم تماس") || text.includes("انصراف")) return SKIP_REASONS.OPTED_OUT;
  if (text.includes("شماره") || text.includes("ایمیل") || text.includes("شناسه")
    || text.includes("نشانی")) return SKIP_REASONS.NO_ADDRESS;
  return SKIP_REASONS.OTHER;
}

export interface CampaignCounts {
  /** Customers the segment resolved to, before anything was tried. */
  matched: number;
  queued: number;
  sent: number;
  failed: number;
  cancelled: number;
  skipped: number;
}

/**
 * How far a campaign has got, as a percentage of what it queued.
 *
 * Measured against **queued**, not against `matched`: the people the segment
 * found but who could not be written to are never going to move, so counting
 * them in the denominator would leave every campaign stuck short of 100% with
 * nothing wrong. `matched` is reported beside it as its own figure.
 */
export function campaignProgressPercent(counts: CampaignCounts): number {
  const total = counts.queued + counts.sent + counts.failed + counts.cancelled;
  if (total <= 0) return 0;
  return Math.round(((counts.sent + counts.failed + counts.cancelled) / total) * 100);
}

/**
 * The sentence under a campaign's figures.
 *
 * Written here rather than in the component for the reason every `measured`
 * sentence in this codebase is: a number without its definition is how a queue
 * count comes to be read as a delivery count.
 */
export function describeCampaignResult(counts: CampaignCounts): string {
  const parts = [`${counts.matched} مشتری در سگمنت`];
  const attempted = counts.queued + counts.sent + counts.failed + counts.cancelled;
  parts.push(`${attempted} پیام ساخته شد`);
  if (counts.sent > 0) parts.push(`${counts.sent} ارسال شد`);
  if (counts.failed > 0) parts.push(`${counts.failed} ناموفق`);
  if (counts.skipped > 0) parts.push(`${counts.skipped} ارسال نشد`);
  return `${parts.join(" · ")}.`;
}
