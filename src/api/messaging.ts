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
