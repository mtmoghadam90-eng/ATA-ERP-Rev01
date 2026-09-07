import { getDb } from "../../db";
import { AuthUser, hasPermission } from "../../auth";
import { ListQuery, ListResult, buildResult, paginationArgs, parseListQuery } from "../../listing";
import { toShamsiStr } from "../../../dateUtils";
import { renderTemplate, isChannel, Channel, MESSAGE_STATUS } from "../../../utils/messaging";
import {
  CAMPAIGN_RECIPIENT_LIMIT, CAMPAIGN_STATUS, CampaignCounts, CampaignStatus,
  SKIP_REASONS, SegmentQuery, SkipReason,
  parseSegmentQuery, sanitizeSegmentQuery, segmentRefusal, skipReasonFor,
} from "../../../utils/campaigns";
import {
  CUSTOMER_FILTERABLE, CUSTOMER_METRIC_SORTABLE, CUSTOMER_QUERY_KEYS, CUSTOMER_SORTABLE,
  buildCustomerWhere, customerListExtras,
} from "../customerService";
import { messageVariables, parseSchedule, queueForCustomer } from "./messageService";

/**
 * Segments and campaigns.
 *
 * The pure rules are `src/utils/campaigns.ts`; this is the reading and the
 * writing. Two things here are worth not re-deciding.
 *
 * **A segment is resolved through the customers module, never queried here.**
 * `buildCustomerWhere` is called with the stored parameters put through the
 * customers endpoint's own `parseListQuery` and `customerListExtras`, so a
 * segment matches exactly what the grid it was built on matched — including
 * `visibilityClause`, which means somebody who may see only their own customers
 * addresses only their own customers, with nothing extra written to enforce it.
 *
 * **Sending enqueues and never sends.** Every recipient goes through
 * `queueForCustomer`, which is what applies quiet hours, the dry-run switch,
 * the retry policy, `doNotContact` and the opt-out on a project's named
 * contact. There is one sending path in this application.
 */

/* -------------------------------- segments -------------------------------- */

export interface SegmentInput {
  name?: unknown;
  description?: unknown;
  query?: unknown;
}

export interface SegmentRow {
  id: string;
  name: string;
  description: string | null;
  query: SegmentQuery;
  campaignCount: number;
  createdByName: string | null;
  createdAt: Date;
}

const toRow = (row: {
  id: string; name: string; description: string | null; query: string;
  createdByName: string | null; createdAt: Date; _count?: { campaigns: number };
}): SegmentRow => ({
  id: row.id,
  name: row.name,
  description: row.description,
  query: parseSegmentQuery(row.query, CUSTOMER_QUERY_KEYS),
  campaignCount: row._count?.campaigns ?? 0,
  createdByName: row.createdByName,
  createdAt: row.createdAt,
});

export async function listSegments(user: AuthUser): Promise<SegmentRow[]> {
  if (!hasPermission(user, "messaging")) return [];
  const rows = await getDb().customerSegment.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { campaigns: true } } },
  });
  return rows.map(toRow);
}

export async function createSegment(
  input: SegmentInput,
  user: AuthUser,
): Promise<{ segment?: SegmentRow; refusal?: string }> {
  const db = getDb();
  const query = sanitizeSegmentQuery(input.query, CUSTOMER_QUERY_KEYS);
  const existing = await db.customerSegment.findMany({ select: { name: true } });

  const refusal = segmentRefusal(input.name, query, existing.map((r) => r.name));
  if (refusal) return { refusal };

  const row = await db.customerSegment.create({
    data: {
      name: String(input.name).trim(),
      description: typeof input.description === "string" ? input.description.trim() || null : null,
      query: JSON.stringify(query),
      createdByUserId: user.id,
      createdByName: user.fullName ?? null,
    },
    include: { _count: { select: { campaigns: true } } },
  });
  return { segment: toRow(row) };
}

export async function updateSegment(
  id: string,
  input: SegmentInput,
  _user: AuthUser,
): Promise<{ segment?: SegmentRow; refusal?: string }> {
  const db = getDb();
  const current = await db.customerSegment.findUnique({ where: { id } });
  if (!current) return { refusal: "سگمنت یافت نشد." };

  /*
   * An absent `query` means «not edited» and keeps what is stored — the same
   * distinction `syncChildren` draws. Reading it as an empty query would turn
   * renaming a segment into silently widening it to every customer, which is
   * the one thing `segmentRefusal` exists to stop.
   */
  const query = "query" in input && input.query !== undefined
    ? sanitizeSegmentQuery(input.query, CUSTOMER_QUERY_KEYS)
    : parseSegmentQuery(current.query, CUSTOMER_QUERY_KEYS);

  const name = "name" in input ? input.name : current.name;
  const others = await db.customerSegment.findMany({
    where: { id: { not: id } }, select: { name: true },
  });
  const refusal = segmentRefusal(name, query, others.map((r) => r.name));
  if (refusal) return { refusal };

  const row = await db.customerSegment.update({
    where: { id },
    data: {
      name: String(name).trim(),
      description: "description" in input
        ? (typeof input.description === "string" ? input.description.trim() || null : null)
        : current.description,
      query: JSON.stringify(query),
    },
    include: { _count: { select: { campaigns: true } } },
  });
  return { segment: toRow(row) };
}

/**
 * A segment a campaign has used is not deleted.
 *
 * The campaign keeps `segmentName` so its history survives, but the id is a
 * real foreign key and deleting the row would break it — and the segment is
 * still the answer to «who did that campaign go to».
 */
export async function deleteSegment(id: string): Promise<{ ok: boolean; refusal?: string }> {
  const db = getDb();
  const used = await db.campaign.count({ where: { segmentId: id } });
  if (used > 0) {
    return { ok: false, refusal: `این سگمنت در ${used} کمپین استفاده شده و قابل حذف نیست.` };
  }
  await db.customerSegment.delete({ where: { id } });
  return { ok: true };
}

/* ------------------------------- resolving -------------------------------- */

/**
 * Turns a stored query into the `where` the customers grid would have used.
 *
 * The whole point of the indirection: `parseListQuery` and `customerListExtras`
 * are the customers endpoint's own readers, so a filter that module adds is one
 * segments understand on the same commit, and one it removes stops being asked.
 */
function segmentWhere(query: SegmentQuery, user: AuthUser): Record<string, unknown> {
  const q: ListQuery = parseListQuery(
    query,
    [...CUSTOMER_SORTABLE, ...CUSTOMER_METRIC_SORTABLE],
    CUSTOMER_FILTERABLE,
  );
  return buildCustomerWhere(q, user, customerListExtras(query));
}

export interface SegmentPreview {
  /** How many customers match, for this user. */
  total: number;
  /** A handful of them, so the person can see the segment is the right one. */
  sample: { id: string; name: string; mobile: string | null; doNotContact: boolean }[];
  /** True when the match count is at or beyond what one campaign may reach. */
  overLimit: boolean;
  limit: number;
}

const SAMPLE_SIZE = 8;

export async function previewSegment(
  query: SegmentQuery,
  user: AuthUser,
): Promise<SegmentPreview> {
  const db = getDb();
  const where = segmentWhere(query, user);

  const [total, rows] = await Promise.all([
    db.customer.count({ where }),
    db.customer.findMany({
      where,
      take: SAMPLE_SIZE,
      orderBy: { companyName: "asc" },
      select: {
        id: true, companyName: true, firstName: true, lastName: true,
        mobile: true, doNotContact: true,
      },
    }),
  ]);

  return {
    total,
    limit: CAMPAIGN_RECIPIENT_LIMIT,
    overLimit: total > CAMPAIGN_RECIPIENT_LIMIT,
    sample: rows.map((r) => ({
      id: r.id,
      name: r.companyName || `${r.firstName ?? ""} ${r.lastName ?? ""}`.trim(),
      mobile: r.mobile,
      doNotContact: r.doNotContact,
    })),
  };
}

/** The stored query of one segment, or nothing when it is gone. */
export async function segmentQueryOf(id: string): Promise<SegmentQuery | null> {
  const row = await getDb().customerSegment.findUnique({ where: { id } });
  return row ? parseSegmentQuery(row.query, CUSTOMER_QUERY_KEYS) : null;
}

/* ------------------------------- campaigns -------------------------------- */

export const CAMPAIGN_SORTABLE = ["createdAt", "name", "status", "sentAt"] as const;
export const CAMPAIGN_FILTERABLE = ["status", "channel"] as const;

export interface CampaignInput {
  name?: unknown;
  segmentId?: unknown;
  channel?: unknown;
  templateId?: unknown;
  subject?: unknown;
  body?: unknown;
  scheduledDate?: unknown;
  scheduledTime?: unknown;
}

export interface CampaignRow {
  id: string;
  name: string;
  segmentId: string | null;
  segmentName: string | null;
  channel: string;
  templateId: string | null;
  subject: string | null;
  body: string;
  status: string;
  scheduledAtJalali: string | null;
  matchedCount: number | null;
  sentAt: Date | null;
  createdByName: string | null;
  createdAt: Date;
  /** Counted from the outbox rows, never from a stored tally. */
  counts: CampaignCounts;
}

/**
 * The message counts of a set of campaigns, in one grouped query.
 *
 * Read from `messages` rather than kept as columns on the campaign, so a
 * message somebody cancelled from the outbox shows as cancelled here too — two
 * places recording the same total is how they come to disagree, which is the
 * fault this codebase keeps repairing.
 */
async function countsFor(ids: string[]): Promise<Map<string, CampaignCounts>> {
  const out = new Map<string, CampaignCounts>();
  if (ids.length === 0) return out;

  const groups = await getDb().message.groupBy({
    by: ["campaignId", "status"],
    where: { campaignId: { in: ids } },
    _count: { _all: true },
  });

  for (const group of groups) {
    const id = group.campaignId;
    if (!id) continue;
    const entry = out.get(id) ?? {
      matched: 0, queued: 0, sent: 0, failed: 0, cancelled: 0, skipped: 0,
    };
    if (group.status === MESSAGE_STATUS.QUEUED) entry.queued += group._count._all;
    else if (group.status === MESSAGE_STATUS.SENT) entry.sent += group._count._all;
    else if (group.status === MESSAGE_STATUS.FAILED) entry.failed += group._count._all;
    else if (group.status === MESSAGE_STATUS.CANCELLED) entry.cancelled += group._count._all;
    out.set(id, entry);
  }
  return out;
}

const campaignRow = (
  row: {
    id: string; name: string; segmentId: string | null; segmentName: string | null;
    channel: string; templateId: string | null; subject: string | null; body: string;
    status: string; scheduledAtJalali: string | null; matchedCount: number | null;
    sentAt: Date | null; createdByName: string | null; createdAt: Date;
  },
  counts: Map<string, CampaignCounts>,
): CampaignRow => {
  const own = counts.get(row.id) ?? {
    matched: 0, queued: 0, sent: 0, failed: 0, cancelled: 0, skipped: 0,
  };
  const attempted = own.queued + own.sent + own.failed + own.cancelled;
  return {
    ...row,
    counts: {
      ...own,
      matched: row.matchedCount ?? attempted,
      /*
       * The people the segment found and the outbox never got a row for.
       *
       * Only for a campaign that has finished: while it is still SENDING the
       * same subtraction counts everybody the current press has not reached
       * yet, and «۲۵۰ ارسال نشد» about people who are simply next in the queue
       * is the figure reading as a failure. Never negative either — a segment
       * that has grown since the send would otherwise report a negative skip
       * count, which reads as broken arithmetic rather than as the segment
       * being a live query.
       */
      skipped: row.status === CAMPAIGN_STATUS.SENT
        ? Math.max(0, (row.matchedCount ?? attempted) - attempted)
        : 0,
    },
  };
};

export async function listCampaigns(q: ListQuery): Promise<ListResult<CampaignRow>> {
  const db = getDb();
  const where: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(q.filters)) where[field] = value;
  if (q.search) where.name = { contains: q.search };

  const [rows, total] = await Promise.all([
    db.campaign.findMany({
      where,
      orderBy: { [q.sort ?? "createdAt"]: q.order },
      ...paginationArgs(q),
    }),
    db.campaign.count({ where }),
  ]);

  const counts = await countsFor(rows.map((r) => r.id));
  return buildResult(rows.map((r) => campaignRow(r, counts)), total, q);
}

export async function getCampaign(id: string): Promise<CampaignRow | null> {
  const row = await getDb().campaign.findUnique({ where: { id } });
  if (!row) return null;
  return campaignRow(row, await countsFor([id]));
}

export async function saveCampaign(
  id: string | null,
  input: CampaignInput,
  user: AuthUser,
): Promise<{ campaign?: CampaignRow; refusal?: string }> {
  const db = getDb();

  if (id) {
    const current = await db.campaign.findUnique({ where: { id } });
    if (!current) return { refusal: "کمپین یافت نشد." };
    /*
     * A campaign that has been sent is a record of what went out, not a draft.
     * Editing its text afterwards would leave the screen describing a message
     * nobody received — the outbox holds what was actually sent.
     */
    if (current.status !== CAMPAIGN_STATUS.DRAFT) {
      return { refusal: "کمپین ارسال‌شده قابل ویرایش نیست." };
    }
  }

  const channel = isChannel(input.channel) ? input.channel : null;
  const segmentId = typeof input.segmentId === "string" ? input.segmentId.trim() : "";
  const segment = segmentId
    ? await db.customerSegment.findUnique({ where: { id: segmentId } })
    : null;
  if (segmentId && !segment) return { refusal: "سگمنت انتخاب‌شده یافت نشد." };

  const { campaignRefusal } = await import("../../../utils/campaigns");
  const refusal = campaignRefusal({
    name: input.name, segmentId, channel, body: input.body,
  });
  if (refusal) return { refusal };

  const scheduledAt = parseSchedule(
    typeof input.scheduledDate === "string" ? input.scheduledDate : null,
    typeof input.scheduledTime === "string" ? input.scheduledTime : null,
  );

  const data = {
    name: String(input.name).trim(),
    segmentId,
    segmentName: segment?.name ?? null,
    channel: channel as Channel,
    templateId: typeof input.templateId === "string" && input.templateId ? input.templateId : null,
    subject: typeof input.subject === "string" ? input.subject.trim() || null : null,
    body: String(input.body).trim(),
    scheduledAt,
    scheduledAtJalali: scheduledAt ? toShamsiStr(scheduledAt) : null,
  };

  const row = id
    ? await db.campaign.update({ where: { id }, data })
    : await db.campaign.create({
        data: {
          ...data,
          status: CAMPAIGN_STATUS.DRAFT,
          createdByUserId: user.id,
          createdByName: user.fullName ?? null,
        },
      });

  return { campaign: campaignRow(row, await countsFor([row.id])) };
}

export async function deleteCampaign(id: string): Promise<{ ok: boolean; refusal?: string }> {
  const db = getDb();
  const sent = await db.message.count({ where: { campaignId: id } });
  if (sent > 0) {
    return { ok: false, refusal: "این کمپین پیام ساخته است و قابل حذف نیست؛ می‌توانید آن را لغو کنید." };
  }
  await db.campaign.delete({ where: { id } });
  return { ok: true };
}

/**
 * Cancels a campaign, and the messages of it that have not gone yet.
 *
 * Only the queued ones: a message already sent cannot be unsent, and marking it
 * cancelled would make the outbox say something untrue about a text that is on
 * somebody's phone.
 */
export async function cancelCampaign(id: string): Promise<{ cancelled: number }> {
  const db = getDb();
  const result = await db.message.updateMany({
    where: { campaignId: id, status: MESSAGE_STATUS.QUEUED },
    data: { status: MESSAGE_STATUS.CANCELLED },
  });
  await db.campaign.update({
    where: { id },
    data: { status: CAMPAIGN_STATUS.CANCELLED as CampaignStatus },
  });
  return { cancelled: result.count };
}

/* --------------------------------- sending -------------------------------- */

export interface SendCampaignResult {
  queued: number;
  matched: number;
  skipped: Record<SkipReason, number>;
  /** The refusals nothing recognised, kept whole rather than folded. */
  otherReasons: string[];
  truncated: boolean;
  /**
   * Recipients this call did not get to, because one HTTP request is not the
   * right length of thing to spend on two thousand of them.
   */
  remaining: number;
  refusal?: string;
}

/**
 * How many recipients one press works through.
 *
 * Each one costs a customer read, the variable lookup and an insert, so a
 * two-thousand-person segment is minutes of work and a request that times out
 * half way — leaving the sender with no idea what went out. A bounded pass that
 * reports what is left is the honest shape, and it costs nothing extra: the
 * unique index already makes the next press continue rather than repeat.
 */
const SEND_BATCH_SIZE = 250;

/**
 * Queues one message per customer the segment resolves to.
 *
 * Three things decide its shape.
 *
 * **It is resumable, not transactional.** Hundreds of `queueForCustomer` calls
 * inside one transaction would hold a write transaction open for as long as the
 * slowest read takes, on a database shared with Report Server. Instead the
 * unique index on (campaignId, customerId) makes a re-run skip everybody who
 * already has a row, so a send that dies half way through is finished by
 * pressing the button again — which is also what makes a double-pressed button
 * harmless.
 *
 * **A skipped recipient is counted by reason.** «۱۲۰ نفر در سگمنت، ۸۳ پیام»
 * with nothing else said reads as broken; an opt-out is a decision to respect,
 * a missing mobile is a gap somebody fills in on the customers screen, and the
 * two need different things done about them.
 *
 * **The template is rendered per customer, here.** `{addressee}` has to be that
 * customer's, and rendering in the browser would store a body that is not what
 * was sent.
 */
export async function sendCampaign(
  id: string,
  user: AuthUser,
): Promise<SendCampaignResult> {
  const db = getDb();
  const empty = (): Record<SkipReason, number> => ({
    ALREADY_SENT: 0, OPTED_OUT: 0, NO_ADDRESS: 0, OTHER: 0,
  });

  const campaign = await db.campaign.findUnique({ where: { id } });
  if (!campaign) {
    return { queued: 0, matched: 0, skipped: empty(), otherReasons: [], truncated: false, remaining: 0, refusal: "کمپین یافت نشد." };
  }
  if (campaign.status === CAMPAIGN_STATUS.CANCELLED) {
    return { queued: 0, matched: 0, skipped: empty(), otherReasons: [], truncated: false, remaining: 0, refusal: "این کمپین لغو شده است." };
  }
  if (!campaign.segmentId) {
    return { queued: 0, matched: 0, skipped: empty(), otherReasons: [], truncated: false, remaining: 0, refusal: "این کمپین سگمنت ندارد." };
  }

  const query = await segmentQueryOf(campaign.segmentId);
  if (!query) {
    return { queued: 0, matched: 0, skipped: empty(), otherReasons: [], truncated: false, remaining: 0, refusal: "سگمنت این کمپین یافت نشد." };
  }

  const where = segmentWhere(query, user);
  const matched = await db.customer.count({ where });
  if (matched === 0) {
    return { queued: 0, matched: 0, skipped: empty(), otherReasons: [], truncated: false, remaining: 0, refusal: "این سگمنت هیچ مشتری‌ای ندارد." };
  }

  /*
   * Bounded, and the bound is reported rather than silently obeyed: a segment
   * that has grown past the cap is a thing somebody needs to know about before
   * they conclude the other 400 people were unreachable.
   */
  const customers = await db.customer.findMany({
    where,
    take: CAMPAIGN_RECIPIENT_LIMIT,
    // Oldest first, and deliberately stable: a second press has to walk the
    // same order, or a segment that gained a customer between the two presses
    // would shift everybody along and the batch boundary would skip somebody.
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  const truncated = matched > customers.length;

  await db.campaign.update({
    where: { id },
    data: { status: CAMPAIGN_STATUS.SENDING as CampaignStatus, matchedCount: matched },
  });

  // Who already has a message from this campaign. One query, not one per row.
  const existing = await db.message.findMany({
    where: { campaignId: id },
    select: { customerId: true },
  });
  const already = new Set(existing.map((r) => r.customerId).filter(Boolean) as string[]);

  const skipped = empty();
  const otherReasons: string[] = [];
  let queued = 0;
  let remaining = 0;

  for (const customer of customers) {
    if (already.has(customer.id)) {
      skipped.ALREADY_SENT += 1;
      continue;
    }

    // Bounded per call. What is left is reported rather than dropped, and the
    // next press picks up exactly here because everybody behind is now in
    // `already`.
    if (queued >= SEND_BATCH_SIZE) {
      remaining += 1;
      continue;
    }

    // Rendered for this customer, so `{addressee}` is theirs.
    const variables = await messageVariables(customer.id, null);
    const body = renderTemplate(campaign.body, variables).trim();
    const subject = renderTemplate(campaign.subject ?? "", variables) || null;

    let outcome: { queued: boolean; reason?: string; messageId?: string };
    try {
      outcome = await queueForCustomer({
        customerId: customer.id,
        channel: isChannel(campaign.channel) ? campaign.channel : null,
        subject,
        body,
        scheduledAt: campaign.scheduledAt,
        templateId: campaign.templateId,
        // Written with the row, so the unique index refuses a duplicate at the
        // moment of insert rather than after one exists to be sent.
        campaignId: id,
        createdByUserId: user.id,
        createdByName: user.fullName ?? null,
      });
    } catch (err) {
      /*
       * The index caught what the `already` set did not — two sends running at
       * once, which is exactly what it is there for. No row was written, so
       * there is nothing to undo and the right answer is «this person already
       * has one».
       */
      if ((err as { code?: string }).code === "P2002") {
        skipped.ALREADY_SENT += 1;
        continue;
      }
      throw err;
    }

    if (outcome.queued && outcome.messageId) {
      queued += 1;
      already.add(customer.id);
      continue;
    }

    const reason = skipReasonFor(outcome.reason);
    skipped[reason] += 1;
    if (reason === SKIP_REASONS.OTHER && outcome.reason
      && !otherReasons.includes(outcome.reason)) {
      otherReasons.push(outcome.reason);
    }
  }

  /*
   * Still SENDING while anybody is left: a campaign marked sent with two
   * hundred people still to write to would be the screen saying the work is
   * finished when it is not, which is the fault this file exists to avoid.
   */
  await db.campaign.update({
    where: { id },
    data: remaining > 0
      ? { status: CAMPAIGN_STATUS.SENDING as CampaignStatus }
      : { status: CAMPAIGN_STATUS.SENT as CampaignStatus, sentAt: new Date() },
  });

  return { queued, matched, skipped, otherReasons, truncated, remaining };
}
