/**
 * API tokens: the rules, with nothing that touches a database.
 *
 * A token lets a third party — n8n is the one this was built for — drive the
 * same REST API the browser drives, as a named user, under exactly that user's
 * permissions. There is no second API and no second permission model: an
 * integration can do what the account it was issued for can do, and nothing
 * else. That is the whole design, and it is why this file is short.
 *
 * Everything here is pure so `test:rules` can hold it.
 */

/** Marks a token in a log or a paste. Long enough to be unmistakable. */
export const TOKEN_PREFIX = "ata_";

/** Bytes of randomness behind each token. */
export const TOKEN_BYTES = 32;

/** How much of the token is stored in the clear, to recognise it in the list. */
export const VISIBLE_PREFIX_LENGTH = 12;

/**
 * What a token may do.
 *
 * `read` is not a courtesy. Most integrations only ever read — a dashboard, a
 * nightly export, a Telegram bot that answers «موجودی چقدر است» — and a
 * credential sitting in somebody else's automation platform should be able to
 * do only what that automation needs.
 */
export const TOKEN_SCOPES = ["read", "full"] as const;
export type TokenScope = typeof TOKEN_SCOPES[number];

export const SCOPE_LABELS: Record<TokenScope, string> = {
  read: "فقط خواندن",
  full: "خواندن و نوشتن",
};

export function normalizeScope(value: unknown): TokenScope {
  return value === "full" ? "full" : "read";
}

/**
 * The token out of an `Authorization` header, or null.
 *
 * Deliberately strict about the scheme: a `Basic` header carrying a
 * base64 blob must not be read as a token, and neither must an empty `Bearer`.
 */
export function parseBearer(header: string | undefined | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(String(header).trim());
  const token = match?.[1];
  return token && token.startsWith(TOKEN_PREFIX) ? token : null;
}

/** The part of a token kept in the clear, for the list on the settings screen. */
export function visiblePrefix(token: string): string {
  return token.slice(0, VISIBLE_PREFIX_LENGTH);
}

/** `ata_9f31c2b8…` — enough to tell two tokens apart, not enough to use one. */
export function maskToken(prefix: string): string {
  return `${prefix}${"•".repeat(8)}`;
}

/** A stored token, as much of it as the rules below need. */
export interface TokenState {
  isActive: boolean;
  expiresAt: Date | string | null;
  /** Whether the account the token belongs to is still usable. */
  userActive: boolean;
}

/**
 * Why this token may not be used, or null when it may.
 *
 * Asked on every request. The account check is here rather than only at
 * issuance because deactivating somebody must stop their integrations too —
 * that is most of the point of deactivating them.
 */
export function tokenRefusalReason(state: TokenState, now: number): string | null {
  if (!state.userActive) return "حساب کاربری این توکن غیرفعال است.";
  if (!state.isActive) return "این توکن باطل شده است.";
  if (state.expiresAt) {
    const at = state.expiresAt instanceof Date
      ? state.expiresAt.getTime()
      : Date.parse(String(state.expiresAt));
    if (Number.isFinite(at) && at <= now) return "اعتبار این توکن به پایان رسیده است.";
  }
  return null;
}

/**
 * Whether a read-only token may make this request.
 *
 * By method, not by route. Enumerating the write routes would be a list to keep
 * in step with every new endpoint, and the one nobody remembers to add is the
 * one that matters.
 */
export function scopeAllowsMethod(scope: TokenScope, method: string): boolean {
  if (scope === "full") return true;
  const verb = String(method || "").toUpperCase();
  return verb === "GET" || verb === "HEAD" || verb === "OPTIONS";
}

/**
 * Endpoints a token may never reach, however wide its scope.
 *
 * Two kinds, and both are about a credential not being able to outgrow itself:
 * a token must not be able to mint, widen or revoke tokens, and it must not be
 * able to press the assistant's confirm button — that button exists precisely
 * to mean "a person looked at this", and a request from an automation platform
 * is the one thing it cannot mean.
 */
const CLOSED_TO_TOKENS: RegExp[] = [
  /^\/api\/api-tokens(\/|$)/,
  /^\/api\/assistant\/actions\/[^/]+\/confirm$/,
];

export function pathClosedToTokens(path: string): boolean {
  const clean = String(path || "").split("?")[0];
  return CLOSED_TO_TOKENS.some((pattern) => pattern.test(clean));
}
