import { api } from "./client";
import type { AssistantProposal } from "../utils/assistantActions";

export type { AssistantProposal } from "../utils/assistantActions";

/**
 * The dashboard assistant.
 *
 * The provider's API key is never carried by any of these: the config endpoint
 * answers with a masked hint, and saving one is a separate call that only ever
 * goes in the other direction.
 */

export interface AssistantStatus {
  /** Whether this user's account has the assistant permission. */
  allowed: boolean;
  /** Whether it is switched on in the settings. */
  enabled: boolean;
  /** Whether a provider key has been stored. */
  configured: boolean;
  actionsAllowed: boolean;
}

export interface AssistantStep {
  tool: string;
  arguments: string;
  ok: boolean;
}

export interface AssistantAnswer {
  ok: boolean;
  reply?: string;
  error?: string;
  steps?: AssistantStep[];
  /** Writes the assistant has prepared. Nothing is stored until confirmed. */
  proposals?: AssistantProposal[];
  usage?: { promptTokens: number; completionTokens: number };
}

export interface AssistantConfigResponse {
  config: {
    enabled: boolean;
    baseUrl: string;
    model: string;
    systemPrompt: string;
    temperature: number;
    maxTokens: number;
    maxToolCalls: number;
    timeoutSeconds: number;
    allowActions: boolean;
  };
  apiKeyHint: string | null;
  tools: { name: string; description: string }[];
  actions: { name: string; label: string; permissionKey: string; resource: string }[];
}

export type { SuggestedSpec } from "../utils/advisorSuggestion";
import type { NormalizedSuggestion } from "../utils/advisorSuggestion";

/**
 * A product the adviser proposes, in the shape a proforma line takes.
 *
 * Every id on it was resolved against the catalogue on the server — the model
 * is not trusted with a foreign key — so `productId`/`variantId` either name a
 * real record or are absent.
 */
export interface SuggestedItem extends NormalizedSuggestion {
  productCode?: string;
  brand?: string;
  unit?: string;
  imageUrl?: string;
  stockLevel?: number;
  priceRial?: number;
  unitCost?: number | null;
}

export interface AdvisorAnswer {
  ok: boolean;
  reply?: string;
  error?: string;
  items?: SuggestedItem[];
  attachments?: { name: string; read: boolean; problem?: string }[];
}

export const assistantApi = {
  status: () => api.get<AssistantStatus>("/api/assistant/status"),

  ask: (messages: { role: "user" | "assistant"; content: string }[]) =>
    api.post<AssistantAnswer>("/api/assistant/chat", { messages }),

  /*
   * Confirming sends an id and nothing else.
   *
   * The prepared payload stayed on the server precisely so the record written
   * is the one summarised on screen, and not whatever the browser last held.
   */
  confirmAction: (id: string) =>
    api.post<{ proposal: AssistantProposal }>(`/api/assistant/actions/${id}/confirm`, {}),

  cancelAction: (id: string) =>
    api.post<{ proposal: AssistantProposal }>(`/api/assistant/actions/${id}/cancel`, {}),

  /**
   * Reads a customer's enquiry and proposes items for the proforma.
   *
   * `attachments` are `/uploads/...` URLs from the ordinary upload endpoint;
   * the server reads the files itself rather than taking their contents from
   * the browser.
   */
  advise: (
    messages: { role: "user" | "assistant"; content: string }[],
    attachments: string[],
  ) => api.post<AdvisorAnswer>("/api/assistant/product-advisor", { messages, attachments }),

  /* settings */
  config: () => api.get<AssistantConfigResponse>("/api/assistant/config"),

  saveKey: (apiKey: string) =>
    api.put<{ apiKeyHint: string | null }>("/api/assistant/key", { apiKey }),

  clearKey: () =>
    api.put<{ apiKeyHint: string | null }>("/api/assistant/key", { clear: true }),

  test: () => api.post<{ ok: boolean; error?: string; reply?: string }>("/api/assistant/test", {}),
};
