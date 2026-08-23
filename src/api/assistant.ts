import { api } from "./client";

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
}

export const assistantApi = {
  status: () => api.get<AssistantStatus>("/api/assistant/status"),

  ask: (messages: { role: "user" | "assistant"; content: string }[]) =>
    api.post<AssistantAnswer>("/api/assistant/chat", { messages }),

  /* settings */
  config: () => api.get<AssistantConfigResponse>("/api/assistant/config"),

  saveKey: (apiKey: string) =>
    api.put<{ apiKeyHint: string | null }>("/api/assistant/key", { apiKey }),

  clearKey: () =>
    api.put<{ apiKeyHint: string | null }>("/api/assistant/key", { clear: true }),

  test: () => api.post<{ ok: boolean; error?: string; reply?: string }>("/api/assistant/test", {}),
};
