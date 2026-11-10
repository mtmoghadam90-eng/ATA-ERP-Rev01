import { Prisma } from "@prisma/client";
import { getDb } from "../../db";
import type { AuthUser } from "../../auth";
import { CHANNELS } from "../../../utils/messaging";
import { inboundSummary, parseBaleUpdate, type ParsedInbound } from "../../../utils/inbound";
import { baleUpdates, type BaleConfig } from "./drivers";
import { normalizeMobile } from "../customerService";
import { notifyModuleResponsible } from "../notificationService";
import { afterCommit } from "../../afterCommit";
import { ListQuery, ListResult, buildResult, paginationArgs } from "../../listing";

/**
 * «صندوق دریافتی» — what customers write to the Bale bot.
 *
 * The bot is the بازو Safir sends through, so a customer answering a Safir
 * message answers the bot. This server sits on a LAN nothing outside can
 * reach, so a webhook is unavailable in principle and the bot is **polled**
 * (`getUpdates`), once a minute, the way the exchange rates and the website's
 * requests are. Each update is stored once — the unique `(channel, updateId)`
 * key decides — and the offset handed back to Bale is what consumes it there.
 *
 * Who wrote is matched to a customer three ways, in order: a customer whose
 * `baleChatId` is this chat; a phone the sender shared («ارسال شماره») matched
 * on `mobileNormalized`, which also fills an empty `baleChatId` so the next
 * message matches by chat; and an earlier message from the same chat somebody
 * already linked. Anything else is «ناشناس» until a person links it.
 */

let inFlight: Promise<InboxPollReport> | null = null;
let nextOffset: number | null = null;

export interface InboxPollReport {
  at: string;
  ok: boolean;
  received: number;
  error: string | null;
  /** False when there is no bot token: nothing was asked. */
  configured: boolean;
}
let lastReport: InboxPollReport | null = null;
export const inboxPollReport = (): InboxPollReport | null => lastReport;

async function botConfig(): Promise<BaleConfig | null> {
  const row = await getDb().messageProvider.findUnique({ where: { channel: CHANNELS.BALE } });
  if (!row) return null;
  let config: BaleConfig = {};
  try { config = JSON.parse(row.config ?? "{}") as BaleConfig; } catch { config = {}; }
  return config.botToken ? config : null;
}

async function customerFor(parsed: ParsedInbound): Promise<string | null> {
  const db = getDb();
  const byChat = await db.customer.findFirst({ where: { baleChatId: parsed.chatId }, select: { id: true } });
  if (byChat) return byChat.id;
  const mobile = normalizeMobile(parsed.phone);
  if (mobile) {
    const byPhone = await db.customer.findFirst({
      where: { mobileNormalized: mobile }, select: { id: true, baleChatId: true },
    });
    if (byPhone) {
      if (!byPhone.baleChatId) {
        await db.customer.update({ where: { id: byPhone.id }, data: { baleChatId: parsed.chatId } });
      }
      return byPhone.id;
    }
  }
  const earlier = await db.inboundMessage.findFirst({
    where: { chatId: parsed.chatId, customerId: { not: null } },
    orderBy: { receivedAt: "desc" },
    select: { customerId: true },
  });
  return earlier?.customerId ?? null;
}

/** One poll; overlapping calls share it. */
export function pollInbox(): Promise<InboxPollReport> {
  if (inFlight) return inFlight;
  inFlight = runPoll().finally(() => { inFlight = null; });
  return inFlight;
}

async function runPoll(): Promise<InboxPollReport> {
  const at = new Date().toISOString();
  const config = await botConfig();
  if (!config) {
    lastReport = { at, ok: true, received: 0, error: null, configured: false };
    return lastReport;
  }
  const db = getDb();
  if (nextOffset === null) {
    const top = await db.inboundMessage.aggregate({ where: { channel: CHANNELS.BALE }, _max: { updateId: true } });
    nextOffset = top._max.updateId !== null ? Number(top._max.updateId) + 1 : null;
  }
  const answer = await baleUpdates(config, nextOffset);
  if (!answer.ok) {
    lastReport = { at, ok: false, received: 0, error: answer.error ?? "خواندن پیام‌های بله ممکن نشد.", configured: true };
    return lastReport;
  }

  let received = 0;
  for (const update of answer.updates) {
    const id = Number((update as { update_id?: unknown })?.update_id);
    if (Number.isFinite(id)) nextOffset = Math.max(nextOffset ?? 0, id + 1);
    const parsed = parseBaleUpdate(update);
    if (!parsed) continue;
    try {
      const customerId = await customerFor(parsed);
      const row = await db.inboundMessage.create({
        data: {
          channel: CHANNELS.BALE,
          updateId: BigInt(parsed.updateId),
          chatId: parsed.chatId,
          senderName: parsed.senderName,
          senderUsername: parsed.senderUsername,
          phone: parsed.phone,
          kind: parsed.kind,
          text: parsed.text,
          fileName: parsed.fileName,
          customerId,
          receivedAt: parsed.sentAt ?? new Date(),
        },
      });
      received += 1;
      const customer = customerId
        ? await db.customer.findUnique({ where: { id: customerId }, select: { companyName: true, firstName: true, lastName: true } })
        : null;
      const who = customer
        ? (customer.companyName || `${customer.firstName ?? ""} ${customer.lastName ?? ""}`.trim())
        : (parsed.senderName || parsed.senderUsername || "ناشناس");
      await afterCommit("inbound notice", () => notifyModuleResponsible(
        "messaging",
        `پیام جدید در بله از «${who}»`,
        inboundSummary(row),
        null,
        null,
      ));
    } catch (err) {
      // The same update twice is the unique key doing its job.
      if ((err as { code?: string })?.code !== "P2002") throw err;
    }
  }
  lastReport = { at, ok: true, received, error: null, configured: true };
  return lastReport;
}

/* -------------------------------- reading -------------------------------- */

export const INBOX_SORTABLE = ["receivedAt"] as const;

export interface InboxRow {
  id: string;
  chatId: string;
  senderName: string | null;
  senderUsername: string | null;
  phone: string | null;
  kind: string;
  text: string | null;
  fileName: string | null;
  customerId: string | null;
  customerName: string | null;
  receivedAt: Date;
  readAt: Date | null;
  readByName: string | null;
}

export async function listInbox(
  q: ListQuery,
  filters: { unread?: boolean; customerId?: string | null; chatId?: string | null },
): Promise<ListResult<InboxRow> & { unread: number }> {
  const db = getDb();
  const where: Prisma.InboundMessageWhereInput = {};
  if (filters.unread) where.readAt = null;
  if (filters.customerId) where.customerId = filters.customerId;
  if (filters.chatId) where.chatId = filters.chatId;
  const [rows, total, unread] = await Promise.all([
    db.inboundMessage.findMany({ where, orderBy: { receivedAt: "desc" }, ...paginationArgs(q) }),
    db.inboundMessage.count({ where }),
    db.inboundMessage.count({ where: { readAt: null } }),
  ]);
  const ids = [...new Set(rows.map((r) => r.customerId).filter((x): x is string => !!x))];
  const customers = ids.length
    ? await db.customer.findMany({ where: { id: { in: ids } }, select: { id: true, companyName: true, firstName: true, lastName: true } })
    : [];
  const names = new Map(customers.map((c) => [c.id, c.companyName || `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim()]));
  const out: InboxRow[] = rows.map((r) => ({
    id: r.id, chatId: r.chatId, senderName: r.senderName, senderUsername: r.senderUsername,
    phone: r.phone, kind: r.kind, text: r.text, fileName: r.fileName,
    customerId: r.customerId, customerName: r.customerId ? names.get(r.customerId) ?? null : null,
    receivedAt: r.receivedAt, readAt: r.readAt, readByName: r.readByName,
  }));
  return { ...buildResult(out, total, q), unread };
}

export async function unreadInboxCount(): Promise<number> {
  return getDb().inboundMessage.count({ where: { readAt: null } });
}

/** Marks messages read: the ids given, or every unread one when none are. */
export async function markInboxRead(ids: string[] | null, user: AuthUser): Promise<number> {
  const where: Prisma.InboundMessageWhereInput = { readAt: null };
  if (ids) where.id = { in: ids };
  const result = await getDb().inboundMessage.updateMany({
    where, data: { readAt: new Date(), readByName: user.fullName ?? null },
  });
  return result.count;
}

/**
 * Says which customer a chat is: every message from it is filed under them,
 * and the customer's empty `baleChatId` is filled so the next one matches on
 * its own. A chat id already on another customer is left alone.
 */
export async function linkInboxChat(chatId: string, customerId: string): Promise<{ ok: boolean; error: string | null; linked: number }> {
  const db = getDb();
  const customer = await db.customer.findUnique({ where: { id: customerId }, select: { id: true, baleChatId: true } });
  if (!customer) return { ok: false, error: "مشتری یافت نشد.", linked: 0 };
  const linked = await db.$transaction(async (tx) => {
    const n = (await tx.inboundMessage.updateMany({ where: { chatId }, data: { customerId } })).count;
    if (!customer.baleChatId) {
      const taken = await tx.customer.findFirst({ where: { baleChatId: chatId, id: { not: customerId } }, select: { id: true } });
      if (!taken) await tx.customer.update({ where: { id: customerId }, data: { baleChatId: chatId } });
    }
    return n;
  });
  return { ok: true, error: null, linked };
}
