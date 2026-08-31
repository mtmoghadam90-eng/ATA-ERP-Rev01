/**
 * Typed client for the relational API.
 *
 * Every endpoint answers with `{ success: true, ... }` or
 * `{ success: false, error, code }`, where `error` is a sentence already written
 * in Persian for the user. This unwraps that envelope so callers deal in data
 * and exceptions rather than checking a flag at every call site, and it turns a
 * failure into an `ApiError` carrying the server's own message — never a
 * generic "request failed" that hides what the server actually said.
 */

import { dataChanged, resourceOf } from "./liveData";

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  /** Extra fields the endpoint attached, e.g. `references` on a 409. */
  readonly details?: Record<string, unknown>;

  constructor(message: string, status: number, code?: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** True when the session is gone and the user has to sign in again. */
  get isUnauthenticated(): boolean {
    return this.status === 401;
  }

  /** True when the record is referenced elsewhere and cannot be removed. */
  get isInUse(): boolean {
    return this.status === 409 && (this.code === "IN_USE" || this.code === "HAS_HISTORY");
  }
}

/**
 * Called when a request comes back 401.
 *
 * The session cookie can expire mid-session, and every screen would otherwise
 * fail on its own with an unexplained error. The app registers a handler once,
 * at the top, and returns the user to the login screen.
 */
let onUnauthenticated: (() => void) | null = null;

export function setUnauthenticatedHandler(handler: () => void): void {
  onUnauthenticated = handler;
}

type Query = Record<string, string | number | boolean | null | undefined>;

/** Builds a query string, dropping empty values so the URL stays readable. */
export function buildQuery(params: Query = {}): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === "") continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  query?: Query;
  /** Lets a caller cancel an in-flight request — used by search-as-you-type. */
  signal?: AbortSignal;
  /**
   * Whether this write is worth telling every screen about. Default true.
   *
   * The one thing that is not is a **read receipt**: the activity feed posts
   * one for the messages it has just put on screen, and announcing it would
   * make the feed re-read itself — which puts the messages on screen, which
   * posts the receipts. A receipt changes nothing anybody is looking at, so it
   * is written and not announced.
   */
  announce?: boolean;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, query, signal, announce = true } = options;

  const response = await fetch(`${path}${buildQuery(query)}`, {
    method,
    // The session is an httpOnly cookie on the same origin.
    credentials: "same-origin",
    headers: body ? { "Content-Type": "application/json; charset=utf-8" } : undefined,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });

  let payload: Record<string, unknown> | null = null;
  try {
    payload = (await response.json()) as Record<string, unknown>;
  } catch {
    // A non-JSON body means something upstream failed (a proxy, a crash).
    payload = null;
  }

  if (!response.ok || payload?.success === false) {
    if (response.status === 401) onUnauthenticated?.();

    const { success: _s, error, code, ...details } = (payload ?? {}) as Record<string, unknown>;
    throw new ApiError(
      typeof error === "string" && error ? error : "ارتباط با سرور برقرار نشد.",
      response.status,
      typeof code === "string" ? code : undefined,
      details,
    );
  }

  // Anything that changed the server's state is announced here, once, rather
  // than at each of the hundreds of call sites that perform one. Readers of the
  // same resource re-read it — see liveData.ts.
  if (method !== "GET" && announce) dataChanged(resourceOf(path));

  // `success` is protocol, not data; callers want what came with it.
  const { success: _ok, ...data } = (payload ?? {}) as Record<string, unknown>;
  return data as T;
}

export const api = {
  get: <T>(path: string, query?: Query, signal?: AbortSignal) =>
    request<T>(path, { query, signal }),
  post: <T>(path: string, body?: unknown, query?: Query) =>
    request<T>(path, { method: "POST", body, query }),
  /** A write nothing needs to re-read — see `RequestOptions.announce`. */
  postQuietly: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body, announce: false }),
  put: <T>(path: string, body?: unknown, query?: Query) =>
    request<T>(path, { method: "PUT", body, query }),
  delete: <T>(path: string, query?: Query) =>
    request<T>(path, { method: "DELETE", query }),
};

/** The envelope every list endpoint returns. */
export interface ListResponse<T> {
  rows: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** Server-side page size ceiling, mirrored so callers cannot ask for more. */
export const MAX_PAGE_SIZE = 200;
