import { api } from "./client";
import type { TokenScope } from "../utils/apiTokens";

/**
 * API tokens for third-party integrations.
 *
 * The token itself is carried exactly once, by `create`. Everything after that
 * works with the id and the visible prefix, because only a hash is stored.
 */

export interface ApiTokenSummary {
  id: string;
  name: string;
  prefix: string;
  userId: string;
  userName: string | null;
  scope: TokenScope;
  isActive: boolean;
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

export const apiTokensApi = {
  list: () => api.get<{ tokens: ApiTokenSummary[] }>("/api/api-tokens"),

  create: (input: { name: string; userId?: string; scope: TokenScope; expiresInDays?: number | null }) =>
    api.post<{ token: string; created: ApiTokenSummary }>("/api/api-tokens", input),

  revoke: (id: string) =>
    api.post<{ token: ApiTokenSummary }>(`/api/api-tokens/${id}/revoke`, {}),

  remove: (id: string) => api.delete<Record<string, never>>(`/api/api-tokens/${id}`),
};
