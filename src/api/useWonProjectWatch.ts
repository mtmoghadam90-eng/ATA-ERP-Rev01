import { useCallback, useEffect, useRef, useState } from "react";
import { projectsApi } from "./projects";
import { onDataChanged } from "./liveData";

/**
 * Watches for a project *becoming* won, so the app can offer to file the
 * customer's confirmation document.
 *
 * This lived in the store, over `store.projects`. That array is loaded from
 * database.json, which the project screens stopped writing to when they moved
 * to the API — so the statuses never changed, no transition was ever seen, and
 * the prompt could not fire at all. The statuses now come from the server.
 *
 * What matters here is that it watches a *transition*, not a state. Prompting
 * on "is won" would ask about every project that was already won, every time
 * anyone logged in; that behaviour was reported as a bug once and fixed, and
 * it is preserved by two rules:
 *
 * - the first poll only records what it finds, and fires nothing
 * - a project seen for the first time later — created by someone else while
 *   this tab was open — is recorded, not fired on, because this user did not
 *   make that transition
 *
 * Only a move from not-won to won fires. Moving between the two won statuses
 * does not.
 */

const WON_STATUSES = new Set(["برنده (موفق)", "نیمه برنده"]);

const isWon = (status: string): boolean => WON_STATUSES.has(status);

/**
 * Folds one poll into what we already knew, and reports the first project that
 * has just become won.
 *
 * Separated from the hook and exported because these rules are the whole point
 * and getting them wrong is loud: firing on state rather than transition
 * prompts every user about every won project at every login. `previous` is
 * updated in place — it is the caller's running record.
 */
export function applyStatuses(
  previous: Record<string, string>,
  rows: { id: string; status: string }[],
  seeded: boolean,
): string | null {
  if (!seeded) {
    for (const row of rows) previous[row.id] = row.status;
    return null;
  }

  let firstWon: string | null = null;
  for (const row of rows) {
    const before = previous[row.id];
    previous[row.id] = row.status;

    // Not seen before: recorded, but this user did not move it.
    if (before === undefined) continue;
    if (before === row.status) continue;

    if (firstWon === null && isWon(row.status) && !isWon(before)) {
      firstWon = row.id;
    }
  }
  return firstWon;
}

/** How often to look. These change when someone finishes a sale, not by the second. */
const REFRESH_MS = 30_000;

export interface WonProjectWatch {
  /** The project that just became won, if one has, and has not been dismissed. */
  wonProjectId: string | null;
  /** Forget the current one, so the next transition can be reported. */
  clear: () => void;
}

export function useWonProjectWatch(enabled: boolean): WonProjectWatch {
  const [wonProjectId, setWonProjectId] = useState<string | null>(null);

  // What each project's status was last time we looked. A ref, not state:
  // updating it must not itself cause a render.
  const previous = useRef<Record<string, string>>({});
  const seeded = useRef(false);

  const clear = useCallback(() => setWonProjectId(null), []);

  useEffect(() => {
    if (!enabled) {
      // A logout resets the watch, or the next login would compare against
      // the previous user's view of the world.
      previous.current = {};
      seeded.current = false;
      setWonProjectId(null);
      return;
    }

    let cancelled = false;

    const look = async () => {
      let rows: { id: string; status: string }[];
      try {
        rows = await projectsApi.statuses();
      } catch {
        // Ambient background poll: a failed read just means we look again.
        return;
      }
      if (cancelled) return;

      const justWon = applyStatuses(previous.current, rows, seeded.current);
      seeded.current = true;
      // Keep whichever is already being shown; the next poll reports the rest.
      if (justWon) setWonProjectId((current) => current ?? justWon);
    };

    void look();
    const timer = setInterval(() => void look(), REFRESH_MS);

    /*
     * And immediately after anything that could have won a project.
     *
     * The poll alone made the prompt arrive up to half a minute after the user
     * marked the last line won — long enough that it looked as though it had
     * been triggered by whatever they happened to click next. A project's
     * status is re-derived server-side when a proforma is written, so the
     * proforma write is the signal.
     */
    const stop = onDataChanged(["projects", "proformas"], () => void look());

    return () => {
      cancelled = true;
      clearInterval(timer);
      stop();
    };
  }, [enabled]);

  return { wonProjectId, clear };
}
