import { Prisma } from "@prisma/client";
import { getDb } from "../../db";
import { AuthUser } from "../../auth";
import { ListQuery, ListResult, buildResult, paginationArgs } from "../../listing";
import { expandDateFields } from "../../dates";
import { getTodayShamsi, toShamsiStr } from "../../../dateUtils";
import { loadSettings } from "../../settings";
import {
  CHANNELS, Channel, MAX_SEND_ATTEMPTS, MESSAGE_STATUS, QuietHours, isChannel,
  nextAllowedSendTime, renderTemplate, resolveRecipient, retryDelayMs, shouldRetry,
} from "../../../utils/messaging";
import { BaleChatsResult, BaleConfig, baleRecentChats, sendThrough } from "./drivers";
import { addresseeOf, namePrefixFor } from "../../../utils/honorific";

/**
 * Sending a customer a message: the queue, and everything around it.
 *
 * Manual sends and automated ones go through `queueMessage` alike, so the
 * outbox is one table that answers "what have we sent this customer" — the
 * question people actually ask, and one that two separate paths could never
 * answer between them.
 *
 * Nothing is ever sent inline. A message is written to the queue and a worker
 * picks it up, which is what makes scheduling, quiet hours and retries possible
 * at all: all three are just a `scheduledAt` in the future.
 */

/* ------------------------------- providers ------------------------------- */

/**
 * Which fields of each channel's configuration are secret.
 *
 * They are never returned to a client, and a save that leaves one blank keeps
 * what is stored rather than erasing it — the same rule a password field
 * follows, for the same reason: the form cannot show the user what is there, so
 * an empty box means "unchanged", not "delete it".
 */
const SECRET_FIELDS: Record<Channel, string[]> = {
  SMS: ["password"],
  BALE: ["botToken"],
  EMAIL: ["password"],
};

/** Everything a channel's configuration may hold, secrets included. */
const CONFIG_FIELDS: Record<Channel, string[]> = {
  SMS: ["username", "password", "senderNumber", "apiUrl"],
  BALE: ["botToken"],
  EMAIL: [
    "host", "port", "secure", "user", "password",
    "fromAddress", "fromName", "allowSelfSigned",
  ],
};

const parseConfig = (raw: unknown): Record<string, unknown> => {
  if (typeof raw !== "string" || !raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
};

/**
 * A secret, as much of it as is safe to show.
 *
 * Enough for somebody to recognise which key is stored without being enough to
 * use it. `null` when nothing is stored, so the screen can tell "not set" from
 * "set, and hidden".
 */
const mask = (value: unknown): string | null => {
  const text = String(value ?? "");
  if (!text) return null;
  return text.length <= 4 ? "••••" : `••••${text.slice(-4)}`;
};

export interface ProviderSummary {
  channel: Channel;
  active: boolean;
  /** Non-secret configuration, as stored. */
  config: Record<string, unknown>;
  /** Secret field name -> a masked hint, or null when nothing is stored. */
  secrets: Record<string, string | null>;
  lastTestAt: Date | null;
  lastTestOk: boolean | null;
  lastTestError: string | null;
}

export async function listProviders(): Promise<ProviderSummary[]> {
  const rows = await getDb().messageProvider.findMany();
  const byChannel = new Map(rows.map((r) => [r.channel, r]));

  return (Object.keys(CONFIG_FIELDS) as Channel[]).map((channel) => {
    const row = byChannel.get(channel);
    const stored = parseConfig(row?.config);
    const secretNames = SECRET_FIELDS[channel];

    const config: Record<string, unknown> = {};
    for (const field of CONFIG_FIELDS[channel]) {
      if (!secretNames.includes(field)) config[field] = stored[field] ?? null;
    }

    const secrets: Record<string, string | null> = {};
    for (const field of secretNames) secrets[field] = mask(stored[field]);

    return {
      channel,
      active: row?.active ?? false,
      config,
      secrets,
      lastTestAt: row?.lastTestAt ?? null,
      lastTestOk: row?.lastTestOk ?? null,
      lastTestError: row?.lastTestError ?? null,
    };
  });
}

export interface ProviderInput {
  active?: boolean;
  config?: Record<string, unknown>;
}

export async function saveProvider(channel: Channel, input: ProviderInput): Promise<void> {
  const db = getDb();
  const existing = await db.messageProvider.findUnique({ where: { channel } });
  const stored = parseConfig(existing?.config);

  const incoming = input.config ?? {};
  const merged: Record<string, unknown> = { ...stored };

  for (const field of CONFIG_FIELDS[channel]) {
    if (!(field in incoming)) continue;
    const value = incoming[field];
    // A blank secret means "leave it alone" — see SECRET_FIELDS.
    if (SECRET_FIELDS[channel].includes(field) && (value === "" || value === null || value === undefined)) {
      continue;
    }
    merged[field] = value;
  }

  const data = {
    active: input.active ?? existing?.active ?? false,
    config: JSON.stringify(merged),
  };

  await db.messageProvider.upsert({
    where: { channel },
    create: { channel, ...data },
    update: data,
  });
}

/** The stored configuration, secrets included. Server-side only. */
async function providerConfig(channel: Channel): Promise<{
  active: boolean;
  config: Record<string, unknown>;
} | null> {
  const row = await getDb().messageProvider.findUnique({ where: { channel } });
  if (!row) return null;
  return { active: row.active, config: parseConfig(row.config) };
}

/**
 * Sends one message straight out, and records the outcome against the channel.
 *
 * The settings screen's "try it" button. Deliberately not queued: the person is
 * standing there waiting to be told whether their credentials work, and a
 * result that arrives a minute later through a queue answers a question they
 * have stopped asking.
 */
export async function testProvider(
  channel: Channel,
  recipient: string,
  body: string,
): Promise<{ ok: boolean; error?: string }> {
  const provider = await providerConfig(channel);
  if (!provider) return { ok: false, error: "تنظیمات این روش ارسال هنوز ثبت نشده است." };

  const result = await sendThrough(channel, provider.config, {
    recipient,
    subject: "پیام آزمایشی",
    body,
  });

  await getDb().messageProvider.update({
    where: { channel },
    data: {
      lastTestAt: new Date(),
      lastTestOk: result.ok,
      lastTestError: result.ok ? null : (result.error ?? null),
    },
  });

  return { ok: result.ok, error: result.error };
}

/**
 * The chats a channel's bot has recently heard from.
 *
 * Only Bale has one: its `chat_id` is a number the customer cannot read off
 * their own screen and that we cannot derive from anything we already store, so
 * without this the field on the customer form is unfillable in practice. The
 * other channels address a person by something they already know about
 * themselves, and answer with an empty list.
 */
export async function providerChats(channel: Channel): Promise<BaleChatsResult> {
  if (channel !== CHANNELS.BALE) return { ok: true, chats: [] };

  const provider = await providerConfig(channel);
  if (!provider) return { ok: false, chats: [], error: "تنظیمات بله هنوز ثبت نشده است." };

  return baleRecentChats(provider.config as BaleConfig);
}

/* ------------------------------- templates ------------------------------- */

export interface TemplateInput {
  name?: string;
  channel?: string;
  subject?: string | null;
  body?: string;
  active?: boolean;
}

export async function listTemplates(): Promise<unknown[]> {
  return getDb().messageTemplate.findMany({ orderBy: { name: "asc" } });
}

export async function createTemplate(input: TemplateInput) {
  return getDb().messageTemplate.create({
    data: {
      name: String(input.name ?? "").trim() || "بدون نام",
      channel: isChannel(input.channel) ? input.channel : CHANNELS.SMS,
      subject: input.subject?.trim() || null,
      body: String(input.body ?? ""),
      active: input.active ?? true,
    },
  });
}

export async function updateTemplate(id: string, input: TemplateInput) {
  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = String(input.name).trim() || "بدون نام";
  if (input.channel !== undefined && isChannel(input.channel)) data.channel = input.channel;
  if (input.subject !== undefined) data.subject = input.subject?.trim() || null;
  if (input.body !== undefined) data.body = String(input.body);
  if (input.active !== undefined) data.active = !!input.active;

  return getDb().messageTemplate.update({ where: { id }, data });
}

export async function deleteTemplate(id: string): Promise<void> {
  await getDb().messageTemplate.delete({ where: { id } });
}

/* -------------------------------- settings ------------------------------- */

export interface MessagingSettings {
  quietHours: QuietHours;
  /** Write the queue rows but never call a provider. For trying rules out. */
  dryRun: boolean;
  maxAttempts: number;
}

export async function loadMessagingSettings(): Promise<MessagingSettings> {
  const settings = await loadSettings() as { messaging?: Partial<MessagingSettings> } | undefined;
  const stored = settings?.messaging ?? {};
  return {
    quietHours: {
      from: stored.quietHours?.from ?? null,
      to: stored.quietHours?.to ?? null,
    },
    dryRun: stored.dryRun === true,
    maxAttempts: Number(stored.maxAttempts) > 0 ? Number(stored.maxAttempts) : MAX_SEND_ATTEMPTS,
  };
}

/* --------------------------------- queue --------------------------------- */

export interface QueueMessageInput {
  channel: Channel;
  recipient: string;
  recipientName?: string | null;
  subject?: string | null;
  body: string;
  /** Absent means as soon as the worker next runs. */
  scheduledAt?: Date | null;
  customerId?: string | null;
  projectId?: string | null;
  templateId?: string | null;
  workflowRuleId?: string | null;
  workflowRuleName?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  createdByUserId?: string | null;
  createdByName?: string | null;
}

/**
 * Puts a message in the outbox. The only way anything gets sent.
 *
 * Quiet hours are applied here rather than in the worker, so the row itself
 * says when it will go out — a message due at 03:00 shows a scheduled time of
 * 08:00 on the screen, instead of sitting there looking overdue while the
 * worker silently skips it.
 */
export async function queueMessage(input: QueueMessageInput) {
  const settings = await loadMessagingSettings();
  const requested = input.scheduledAt ?? new Date();
  const scheduledAt = nextAllowedSendTime(requested, settings.quietHours);

  return getDb().message.create({
    data: {
      channel: input.channel,
      recipient: input.recipient,
      recipientName: input.recipientName ?? null,
      subject: input.subject ?? null,
      body: input.body,
      status: MESSAGE_STATUS.QUEUED,
      scheduledAt,
      scheduledAtJalali: toShamsiStr(scheduledAt),
      dryRun: settings.dryRun,
      customerId: input.customerId ?? null,
      projectId: input.projectId ?? null,
      templateId: input.templateId ?? null,
      workflowRuleId: input.workflowRuleId ?? null,
      workflowRuleName: input.workflowRuleName ?? null,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      createdByUserId: input.createdByUserId ?? null,
      createdByName: input.createdByName ?? null,
    },
  });
}

/**
 * Works out who a message about a project should go to, and queues it.
 *
 * The one place that reads the project's preferred contact and channel, so a
 * manual send and an automated one address a customer the same way. Returns the
 * reason rather than throwing when there is nobody to write to: "this customer
 * has opted out" is an answer, not a fault, and the caller decides whether to
 * show it or record it.
 */
export interface AddressedSendInput {
  customerId?: string | null;
  projectId?: string | null;
  /** Overrides the project's preference when set. */
  channel?: Channel | null;
  subject?: string | null;
  body: string;
  scheduledAt?: Date | null;
  templateId?: string | null;
  workflowRuleId?: string | null;
  workflowRuleName?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  createdByUserId?: string | null;
  createdByName?: string | null;
}

export async function queueForCustomer(
  input: AddressedSendInput,
): Promise<{ queued: boolean; reason?: string; messageId?: string }> {
  const db = getDb();

  const project = input.projectId
    ? await db.project.findUnique({
        where: { id: input.projectId },
        select: { id: true, customerId: true, messagingContactId: true, messagingChannel: true },
      })
    : null;

  const customerId = input.customerId ?? project?.customerId ?? null;
  if (!customerId) return { queued: false, reason: "مشتری این پیام مشخص نیست." };

  const select = {
    id: true, companyName: true, firstName: true, lastName: true,
    mobile: true, email: true, baleChatId: true, doNotContact: true,
  } as const;

  const customer = await db.customer.findUnique({ where: { id: customerId }, select });
  if (!customer) return { queued: false, reason: "مشتری یافت نشد." };

  const contact = project?.messagingContactId
    ? await db.customer.findUnique({ where: { id: project.messagingContactId }, select })
    : null;

  const nameOf = (c: typeof customer | null) => {
    if (!c) return null;
    const person = `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim();
    return person || c.companyName || null;
  };

  const asCandidate = (c: typeof customer | null) => (c ? {
    name: nameOf(c),
    mobile: c.mobile,
    email: c.email,
    baleChatId: c.baleChatId,
    doNotContact: c.doNotContact,
  } : null);

  const channel = input.channel
    ?? (isChannel(project?.messagingChannel) ? project.messagingChannel : null)
    ?? CHANNELS.SMS;

  // The named contact first, the customer's own details as the fallback.
  const { recipient, problem } = resolveRecipient(
    [asCandidate(contact), asCandidate(customer)],
    channel,
  );

  if (!recipient) {
    const { RECIPIENT_PROBLEM_LABELS } = await import("../../../utils/messaging");
    return { queued: false, reason: problem ? RECIPIENT_PROBLEM_LABELS[problem] : undefined };
  }

  const message = await queueMessage({
    channel: recipient.channel,
    recipient: recipient.address,
    recipientName: recipient.name,
    subject: input.subject ?? null,
    body: input.body,
    scheduledAt: input.scheduledAt ?? null,
    customerId,
    projectId: project?.id ?? input.projectId ?? null,
    templateId: input.templateId ?? null,
    workflowRuleId: input.workflowRuleId ?? null,
    workflowRuleName: input.workflowRuleName ?? null,
    entityType: input.entityType ?? null,
    entityId: input.entityId ?? null,
    createdByUserId: input.createdByUserId ?? null,
    createdByName: input.createdByName ?? null,
  });

  return { queued: true, messageId: message.id };
}

/* -------------------------------- sending -------------------------------- */

/**
 * How many messages one pass of the worker will send.
 *
 * A ceiling rather than "everything due": a rule accidentally written against
 * every customer should cost one batch and be noticed, not empty the SMS
 * account before anybody sees the screen.
 */
const BATCH_SIZE = 25;

let running = false;

/**
 * Sends everything that is due.
 *
 * Guarded against overlapping with itself, the same way the rate refresh is: a
 * slow provider must not let the next tick start a second pass over rows the
 * first one is still working through, or a message goes twice.
 */
export async function processQueue(now: Date = new Date()): Promise<{ sent: number; failed: number }> {
  if (running) return { sent: 0, failed: 0 };
  running = true;

  const db = getDb();
  const settings = await loadMessagingSettings();
  let sent = 0;
  let failed = 0;

  try {
    const due = await db.message.findMany({
      where: { status: MESSAGE_STATUS.QUEUED, scheduledAt: { lte: now } },
      orderBy: { scheduledAt: "asc" },
      take: BATCH_SIZE,
    });

    // The provider configurations, read once for the batch rather than per row.
    const configs = new Map<string, { active: boolean; config: Record<string, unknown> } | null>();

    for (const message of due) {
      const channel = message.channel as Channel;
      if (!configs.has(channel)) configs.set(channel, await providerConfig(channel));
      const provider = configs.get(channel) ?? null;

      const attempts = message.attempts + 1;

      /*
       * A channel that is switched off is a decision, not a failure to retry.
       *
       * Retrying it for three days would fill the outbox with red rows that say
       * nothing except that somebody turned the channel off on purpose.
       */
      if (!provider || !provider.active) {
        await db.message.update({
          where: { id: message.id },
          data: {
            status: MESSAGE_STATUS.FAILED,
            attempts,
            lastError: "این روش ارسال غیرفعال است یا تنظیماتش ثبت نشده.",
          },
        });
        failed++;
        continue;
      }

      const result = message.dryRun
        ? { ok: true, providerMessageId: "DRY-RUN" as string | null, error: undefined }
        : await sendThrough(channel, provider.config, {
            recipient: message.recipient,
            subject: message.subject,
            body: message.body,
          });

      if (result.ok) {
        await db.message.update({
          where: { id: message.id },
          data: {
            status: MESSAGE_STATUS.SENT,
            attempts,
            sentAt: now,
            sentAtJalali: toShamsiStr(now),
            providerMessageId: result.providerMessageId ?? null,
            lastError: null,
          },
        });
        sent++;
        continue;
      }

      // Still has attempts left: back off and leave it queued.
      if (shouldRetry(attempts, settings.maxAttempts)) {
        await db.message.update({
          where: { id: message.id },
          data: {
            attempts,
            lastError: result.error ?? null,
            scheduledAt: new Date(now.getTime() + retryDelayMs(attempts)),
          },
        });
        continue;
      }

      await db.message.update({
        where: { id: message.id },
        data: { status: MESSAGE_STATUS.FAILED, attempts, lastError: result.error ?? null },
      });
      failed++;
    }
  } finally {
    running = false;
  }

  return { sent, failed };
}

/* --------------------------------- reads --------------------------------- */

export const MESSAGE_SORTABLE = ["createdAt", "scheduledAt", "sentAt", "status", "channel"];
export const MESSAGE_FILTERABLE = ["status", "channel", "customerId", "projectId"];

export async function listMessages(
  q: ListQuery,
  extra: { status?: unknown; channel?: unknown; customerId?: unknown; projectId?: unknown } = {},
): Promise<ListResult<Record<string, unknown>>> {
  const db = getDb();
  const and: Record<string, unknown>[] = [];

  const text = (v: unknown) => (typeof v === "string" && v.trim() && v !== "all" ? v.trim() : undefined);
  const status = text(extra.status);
  const channel = text(extra.channel);
  const customerId = text(extra.customerId);
  const projectId = text(extra.projectId);

  if (status) and.push({ status });
  if (channel) and.push({ channel });
  if (customerId) and.push({ customerId });
  if (projectId) and.push({ projectId });
  if (q.search) {
    and.push({
      OR: [
        { recipient: { contains: q.search } },
        { recipientName: { contains: q.search } },
        { body: { contains: q.search } },
      ],
    });
  }

  const where = and.length > 0 ? { AND: and } : {};
  const orderBy = q.sort ? { [q.sort]: q.order } : { createdAt: "desc" as const };

  const [rows, total] = await Promise.all([
    db.message.findMany({
      where,
      orderBy,
      ...paginationArgs(q),
      include: {
        customer: { select: { id: true, companyName: true } },
        project: { select: { id: true, code: true, name: true } },
      },
    }),
    db.message.count({ where }),
  ]);

  return buildResult(rows as unknown as Record<string, unknown>[], total, q);
}

/** Stops a message that has not gone yet. A sent one cannot be unsent. */
export async function cancelMessage(id: string): Promise<boolean> {
  const result = await getDb().message.updateMany({
    where: { id, status: MESSAGE_STATUS.QUEUED },
    data: { status: MESSAGE_STATUS.CANCELLED },
  });
  return result.count > 0;
}

/** Puts a failed message back in the queue, with its attempts reset. */
export async function retryMessage(id: string): Promise<boolean> {
  const result = await getDb().message.updateMany({
    where: { id, status: MESSAGE_STATUS.FAILED },
    data: {
      status: MESSAGE_STATUS.QUEUED,
      attempts: 0,
      lastError: null,
      scheduledAt: new Date(),
    },
  });
  return result.count > 0;
}

/* ------------------------------ manual send ------------------------------ */

export interface ManualSendInput {
  customerId?: string | null;
  projectId?: string | null;
  channel?: string | null;
  templateId?: string | null;
  subject?: string | null;
  body?: string | null;
  /** Jalali date and "HH:MM", both optional — absent means now. */
  scheduledDate?: string | null;
  scheduledTime?: string | null;
}

/**
 * A person sending a message from the screen.
 *
 * The template is rendered here rather than in the browser so that what is
 * stored is what was sent: a body assembled client-side could be edited on the
 * way through, and the outbox would then be a record of something else.
 */
export async function sendManual(
  input: ManualSendInput,
  user: AuthUser,
): Promise<{ queued: boolean; reason?: string; messageId?: string }> {
  const db = getDb();

  const template = input.templateId
    ? await db.messageTemplate.findUnique({ where: { id: input.templateId } })
    : null;

  const channel = isChannel(input.channel)
    ? input.channel
    : (template && isChannel(template.channel) ? template.channel : null);

  const variables = await messageVariables(input.customerId, input.projectId);
  const body = renderTemplate(input.body || template?.body || "", variables).trim();
  if (!body) return { queued: false, reason: "متن پیام خالی است." };

  const subject = renderTemplate(input.subject || template?.subject || "", variables) || null;

  return queueForCustomer({
    customerId: input.customerId ?? null,
    projectId: input.projectId ?? null,
    channel,
    subject,
    body,
    scheduledAt: parseSchedule(input.scheduledDate, input.scheduledTime),
    templateId: template?.id ?? null,
    createdByUserId: user.id,
    createdByName: user.fullName ?? null,
  });
}

/**
 * A Jalali date and a time, as a moment.
 *
 * Null for anything missing or unparseable, which the queue reads as "now" —
 * refusing a send because a date box was left blank would be worse than sending
 * it immediately, which is what an empty schedule plainly means.
 */
export function parseSchedule(
  jalaliDate: string | null | undefined,
  time: string | null | undefined,
): Date | null {
  if (!jalaliDate) return null;

  const expanded = expandDateFields({ at: jalaliDate }, ["at"]) as { at?: Date | null };
  const day = expanded.at;
  if (!day) return null;

  const match = /^(\d{1,2}):(\d{2})$/.exec(String(time ?? "").trim());
  const hours = match ? Number(match[1]) : 9;
  const minutes = match ? Number(match[2]) : 0;

  // `expandDateFields` builds the day at UTC midnight; the time is local, so it
  // is applied with local setters — which is what a person typing 09:00 means.
  const when = new Date(day);
  when.setHours(hours, minutes, 0, 0);
  return when;
}

/**
 * The values a template can use, for one customer and project.
 *
 * Deliberately the same names the workflow engine already puts in its payload,
 * so a template written for a manual send works unchanged inside a rule.
 */
export async function messageVariables(
  customerId?: string | null,
  projectId?: string | null,
): Promise<Record<string, unknown>> {
  const db = getDb();
  const values: Record<string, unknown> = {};

  const settings = await loadSettings() as { companyInfo?: { name?: string } } | undefined;
  values.companyName = settings?.companyInfo?.name ?? "";
  values.today = getTodayShamsi();

  /*
   * Whoever the message is actually addressed to, which is not always the
   * customer: a project may name a contact, and `queueForCustomer` sends to
   * them. The text has to agree with the envelope — «جناب آقای مهندس رضایی»
   * arriving on somebody else's phone is worse than no honorific at all.
   */
  let addressee: { firstName?: string | null; lastName?: string | null; companyName?: string | null; gender?: string | null } | null = null;

  if (projectId) {
    const project = await db.project.findUnique({
      where: { id: projectId },
      select: {
        code: true, name: true, status: true, customerId: true,
        messagingContactId: true,
        customer: { select: { companyName: true } },
      },
    });
    if (project) {
      values.projectCode = project.code;
      values.projectName = project.name;
      values.projectStatus = project.status;
      values.customerName = project.customer?.companyName ?? "";
      if (!customerId) customerId = project.customerId;

      if (project.messagingContactId) {
        addressee = await db.customer.findUnique({
          where: { id: project.messagingContactId },
          select: { companyName: true, firstName: true, lastName: true, gender: true },
        });
      }
    }
  }

  if (customerId) {
    const customer = await db.customer.findUnique({
      where: { id: customerId },
      select: { companyName: true, firstName: true, lastName: true, gender: true },
    });
    if (customer) {
      const person = `${customer.firstName ?? ""} ${customer.lastName ?? ""}`.trim();
      values.customerName = customer.companyName || person;
      if (!addressee) addressee = customer;
    }
  }

  if (addressee) {
    const person = `${addressee.firstName ?? ""} ${addressee.lastName ?? ""}`.trim();
    const name = person || addressee.companyName || "";
    values.contactName = name;
    /*
     * Blank for a company and for a person whose gender was never recorded,
     * which is most of the list — hence `addressee`, where the two are joined
     * with the space in between only when there is something on both sides.
     */
    values.namePrefix = namePrefixFor(addressee.gender);
    values.addressee = addresseeOf(addressee.gender, name);
  }

  return values;
}

/* --------------------------------- stats --------------------------------- */

/** Counts for the module header. One grouped query, not four. */
export async function messageSummary(): Promise<Record<string, number>> {
  const groups = await getDb().message.groupBy({
    by: ["status"],
    _count: { _all: true },
  });

  const out: Record<string, number> = { QUEUED: 0, SENT: 0, FAILED: 0, CANCELLED: 0 };
  for (const group of groups) out[group.status] = group._count._all;
  return out;
}

export type { Prisma };
