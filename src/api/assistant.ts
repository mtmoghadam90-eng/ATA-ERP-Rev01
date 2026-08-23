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

  /* settings */
  config: () => api.get<AssistantConfigResponse>("/api/assistant/config"),

  saveKey: (apiKey: string) =>
    api.put<{ apiKeyHint: string | null }>("/api/assistant/key", { apiKey }),

  clearKey: () =>
    api.put<{ apiKeyHint: string | null }>("/api/assistant/key", { clear: true }),

  test: () => api.post<{ ok: boolean; error?: string; reply?: string }>("/api/assistant/test", {}),
};
