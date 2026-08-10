import { useEffect, useRef } from "react";

/**
 * Keeping what is on screen current, without a page refresh.
 *
 * Every screen reads a page from the server and then holds it. Nothing told it
 * when that page stopped being true, so a figure computed elsewhere — the
 * referral badge is the one people notice — stayed at whatever it was when the
 * screen loaded, and only a browser refresh moved it. That is two separate
 * problems, and they need different answers:
 *
 *  - **Changes this browser made.** The app knows exactly when those happen: a
 *    write went through the API client. So the client announces the resource it
 *    wrote, and anything reading that resource re-reads it. Immediate, and no
 *    polling — this is the half that makes the app feel responsive, because it
 *    covers everything the user does themselves.
 *
 *  - **Changes someone else made.** Nothing here can know about those, so they
 *    are picked up when the tab is looked at again, and on a slow timer for the
 *    figures that sit on screen permanently. Coming back to a tab is precisely
 *    when a stale number is noticed, and it costs one request.
 *
 * Deliberately not a websocket or an SSE stream: the server is a single process
 * on a shared machine that also runs IIS, SQL Server and Report Server, and a
 * held-open connection per tab is a cost with an operational tail. This gets the
 * same felt result for what a few extra GETs cost.
 */

/** A resource, named as in its URL: `/api/purchase-orders` → `purchase-orders`. */
export type DataKey = string;

type Listener = (keys: Set<DataKey>) => void;

const listeners = new Set<Listener>();

/**
 * Resources whose contents move when another one is written.
 *
 * Only genuine derivations belong here — a receipt on a purchase order writes
 * stock, a proforma's outcome re-derives its project's status. Left out on
 * purpose: anything that merely *mentions* the other, which would refresh half
 * the app on every save.
 */
const DOWNSTREAM: Record<DataKey, readonly DataKey[]> = {
  "purchase-orders": ["products", "projects"],
  proformas: ["projects"],
  transactions: ["projects"],
  deliveries: ["products", "proformas", "projects"],
  inquiries: ["projects"],
  projects: ["activities"],
  activities: ["referrals"],
  referrals: ["activities", "notifications"],
  tasks: ["notifications"],
  products: ["inventory"],
};

/** Everything a write to `key` invalidates, including `key` itself. */
function expand(keys: Iterable<DataKey>): Set<DataKey> {
  const out = new Set<DataKey>();
  for (const key of keys) {
    if (out.has(key)) continue;
    out.add(key);
    for (const downstream of DOWNSTREAM[key] ?? []) out.add(downstream);
  }
  return out;
}

/**
 * The resource a path addresses.
 *
 * `/api/customers/abc/links` → `customers`; a nested collection with its own
 * endpoint keeps its own name (`/api/notes/...` → `notes`) because that is what
 * a reader of it subscribes to.
 */
export function resourceOf(path: string): DataKey | null {
  const match = /^\/api\/([^/?#]+)/.exec(path);
  return match ? match[1] : null;
}

/* Writes arrive one at a time but usually in bursts — a save, then its links,
   then its notes. Collected over a tick so three writes cause one re-read. */
let pending: Set<DataKey> | null = null;

/** Announces that these resources have changed. Called for you on every write. */
export function dataChanged(...keys: (DataKey | null | undefined)[]): void {
  const named = keys.filter((k): k is DataKey => !!k);
  if (named.length === 0) return;

  if (pending) {
    for (const key of named) pending.add(key);
    return;
  }

  pending = new Set(named);
  queueMicrotask(() => {
    const batch = expand(pending ?? []);
    pending = null;
    for (const listener of [...listeners]) listener(batch);
  });
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Calls `run` when one of `keys` is written. Returns an unsubscribe function.
 *
 * The same signal `useRevalidate` uses, for a caller that is not a React
 * component's data source — a background watcher, say, that has its own
 * lifecycle and only wants to be told sooner than its next poll.
 */
export function onDataChanged(
  keys: readonly DataKey[],
  run: () => void,
): () => void {
  const wanted = new Set(keys);
  return subscribe((changed) => {
    for (const key of changed) {
      if (wanted.has(key)) { run(); return; }
    }
  });
}

/* ------------------------------ the hook ------------------------------ */

export interface RevalidateOptions {
  /** Set false while the reader is not on screen. */
  enabled?: boolean;
  /**
   * Also re-read on a timer, for figures that stay on screen and are changed by
   * other people. Off by default: a grid the user is reading should not move
   * under them for no reason they can see.
   */
  intervalMs?: number;
}

/** At most one focus-triggered re-read per reader in this window. */
const FOCUS_THROTTLE_MS = 10_000;

/**
 * Re-runs `reload` when one of `keys` is written, and when the tab is looked at
 * again.
 *
 * `reload` is read through a ref, so a caller may pass a fresh closure every
 * render without resubscribing — which is the normal case, since the function
 * usually closes over current state.
 */
export function useRevalidate(
  keys: readonly DataKey[],
  reload: () => void,
  options: RevalidateOptions = {},
): void {
  const { enabled = true, intervalMs } = options;

  const reloadRef = useRef(reload);
  reloadRef.current = reload;

  const keysKey = keys.join(",");
  const lastFocusReload = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    const mine = new Set(keysKey ? keysKey.split(",") : []);

    const unsubscribe = subscribe((changed) => {
      for (const key of changed) {
        if (mine.has(key)) {
          reloadRef.current();
          return;
        }
      }
    });

    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastFocusReload.current < FOCUS_THROTTLE_MS) return;
      lastFocusReload.current = now;
      reloadRef.current();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);

    const timer = intervalMs ? setInterval(() => reloadRef.current(), intervalMs) : null;

    return () => {
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      if (timer) clearInterval(timer);
    };
  }, [enabled, keysKey, intervalMs]);
}
