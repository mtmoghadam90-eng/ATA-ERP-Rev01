import { ListResponse, api } from "./client";
import type { Channel } from "../utils/messaging";

/**
 * Messaging endpoints.
 *
 * A provider's credentials are never carried by any of these. The list answers
 * with a masked hint per secret field, and a save that omits a secret keeps the
 * stored one — so there is no request and no response on this seam that could
 * put an API key in a browser.
 */

export interface ProviderSummary {
  channel: Channel;
  active: boolean;
  /** Everything about the channel that is not a secret. */
  config: Record<string, unknown>;
  /** Secret field name -> a masked hint, or null when nothing is stored. */
  secrets: Record<string, string | null>;
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastTestError: string | null;
}

export interface BaleChatRow {
  id: string;
  name: string;
  type: string;
}

/**
 * Where the company's own WhatsApp line stands.
 *
 * `qrImage` is a data URI the **server** drew, not the raw code: a QR library in
 * the client bundle would be carried by every page load for a panel somebody
 * opens once. It is null whenever no code is waiting, which is most of the time.
 */
export interface WhatsappStatus {
  state: string;
  /** Whether credentials for a device are stored at all. */
  linked: boolean;
  qr: string | null;
  qrImage: string | null;
  linkedNumber: string | null;
  lastError: string | null;
  since: string;
}

export interface MessageTemplateRow {
  id: string;
  name: string;
  channel: string;
  subject: string | null;
  body: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MessageRow {
  id: string;
  channel: string;
  recipient: string;
  recipientName: string | null;
  subject: string | null;
  body: string;
  status: string;
  scheduledAt: string;
  scheduledAtJalali: string | null;
  sentAtJalali: string | null;
  attempts: number;
  lastError: string | null;
  dryRun: boolean;
  workflowRuleName: string | null;
  createdByName: string | null;
  createdAt: string;
  customer: { id: string; companyName: string } | null;
  project: { id: string; code: string; name: string } | null;
}

export interface SendInput {
  customerId?: string | null;
  projectId?: string | null;
  channel?: string | null;
  templateId?: string | null;
  subject?: string | null;
  body?: string | null;
  /** Jalali date and "HH:MM". Both absent means as soon as the queue runs. */
  scheduledDate?: string | null;
  scheduledTime?: string | null;
}

export const messagingApi = {
  /* providers — `settings` permission */
  providers: () =>
    api.get<{ providers: ProviderSummary[] }>("/api/messaging/providers")
      .then((r) => r.providers),

  saveProvider: (channel: string, input: { active?: boolean; config?: Record<string, unknown> }) =>
    api.put<{ providers: ProviderSummary[] }>(`/api/messaging/providers/${channel}`, input)
      .then((r) => r.providers),

  /**
   * Sends one message straight out, past the queue.
   *
   * The person is standing there waiting to hear whether their credentials
   * work; a result that arrives a minute later through the queue answers a
   * question they have stopped asking.
   */
  testProvider: (channel: string, recipient: string, body?: string) =>
    api.post<{ ok: boolean; error?: string }>(
      `/api/messaging/providers/${channel}/test`, { recipient, body },
    ),

  /**
   * The chats a bot has recently heard from, with their numeric ids.
   *
   * Bale only. Its `chat_id` is a number the customer cannot read off their own
   * screen, so this is the only way the field on the customer form gets filled.
   */
  providerChats: (channel: string) =>
    api.get<{ ok: boolean; chats: BaleChatRow[]; error?: string }>(
      `/api/messaging/providers/${channel}/chats`,
    ),

  /* WhatsApp — the company's own line, as a linked device */

  /**
   * Polled by the panel while it is open, and **opens no socket**.
   *
   * That is the whole reason it is a separate call from `whatsappLink` below:
   * connecting as a side effect of being looked at would raise a pairing code
   * every few seconds for anybody who left the screen open, which is itself
   * traffic WhatsApp counts against the number.
   */
  whatsappStatus: () =>
    api.get<{ success: boolean } & WhatsappStatus>("/api/messaging/whatsapp/status"),

  /** Opens the link, raising a code to scan when no device is linked yet. */
  whatsappLink: () =>
    api.post<{ success: boolean } & WhatsappStatus>("/api/messaging/whatsapp/link", {}),

  /** Removes the device from the account and forgets its credentials. */
  whatsappUnlink: () =>
    api.post<{ success: boolean } & WhatsappStatus>("/api/messaging/whatsapp/unlink", {}),

  /* templates */
  templates: () =>
    api.get<{ templates: MessageTemplateRow[] }>("/api/messaging/templates")
      .then((r) => r.templates),

  createTemplate: (input: Partial<MessageTemplateRow>) =>
    api.post<{ template: MessageTemplateRow }>("/api/messaging/templates", input)
      .then((r) => r.template),

  updateTemplate: (id: string, input: Partial<MessageTemplateRow>) =>
    api.put<{ template: MessageTemplateRow }>(`/api/messaging/templates/${id}`, input)
      .then((r) => r.template),

  deleteTemplate: (id: string) =>
    api.delete<Record<string, never>>(`/api/messaging/templates/${id}`),

  /**
   * What a template can say about this customer and project.
   *
   * Resolved on the server so the preview uses the same substitution the send
   * will — a preview built from a different source previews nothing.
   */
  variables: (query: { customerId?: string; projectId?: string }) =>
    api.get<{ variables: Record<string, unknown> }>("/api/messaging/variables", query)
      .then((r) => r.variables),

  /* outbox */
  list: (query: Record<string, string | number | undefined>, signal?: AbortSignal) =>
    api.get<ListResponse<MessageRow>>("/api/messaging/messages", query, signal),

  summary: () =>
    api.get<{ summary: Record<string, number> }>("/api/messaging/summary")
      .then((r) => r.summary),

  send: (input: SendInput) =>
    api.post<{ messageId: string }>("/api/messaging/send", input),

  cancel: (id: string) =>
    api.post<Record<string, never>>(`/api/messaging/messages/${id}/cancel`, {}),

  retry: (id: string) =>
    api.post<Record<string, never>>(`/api/messaging/messages/${id}/retry`, {}),

  /** The manual equivalent of the worker's tick, for when somebody is waiting. */
  runQueue: () =>
    api.post<{ sent: number; failed: number }>("/api/messaging/run-queue", {}),
};
