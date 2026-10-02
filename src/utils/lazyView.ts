/**
 * Loading a screen's code the first time somebody opens it, and surviving a
 * deploy that happened while their tab was open.
 *
 * Each module is its own chunk now, named by a content hash. A deploy rebuilds
 * `dist/` and the old hashes are gone, so a tab opened yesterday that presses
 * «پیش‌فاکتورها» asks for a file that no longer exists — the import rejects,
 * and with nothing catching it React unmounts the whole application: a white
 * page, for a reason nobody at the screen can see. The answer is to load the
 * page again (which fetches the new `index.html` and the new names), **once**:
 * a chunk that is genuinely broken would otherwise reload for ever.
 *
 * The guard is a timestamp rather than a flag, so the next deploy — a week
 * later, in the same tab — is answered the same way instead of being refused
 * because a reload once happened.
 */
import { lazy, type ComponentType } from "react";

export const RELOAD_KEY = "ata:chunk-reload-at";
/** Inside this window a second failure is a real fault, not a stale tab. */
export const RELOAD_GUARD_MS = 30_000;

/** Pure: should a failed chunk load reload the page now? */
export function shouldReloadForChunk(lastReloadAt: number | null, now: number): boolean {
  if (lastReloadAt == null || !Number.isFinite(lastReloadAt)) return true;
  return now - lastReloadAt > RELOAD_GUARD_MS;
}

function readLast(): number | null {
  try {
    const raw = window.sessionStorage.getItem(RELOAD_KEY);
    return raw == null ? null : Number(raw);
  } catch {
    return null;
  }
}

function writeNow(now: number): boolean {
  try {
    window.sessionStorage.setItem(RELOAD_KEY, String(now));
    return true;
  } catch {
    // Storage blocked: without the guard a reload could loop, so do not reload.
    return false;
  }
}

export function lazyView<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  return lazy(() =>
    load().catch((error: unknown) => {
      const now = Date.now();
      if (typeof window !== "undefined" && shouldReloadForChunk(readLast(), now) && writeNow(now)) {
        window.location.reload();
        // Never settles: the page is going away, and rendering the error first
        // would flash it on the screen for the moment before the reload.
        return new Promise<{ default: T }>(() => {});
      }
      throw error;
    }),
  );
}
