/**
 * A screen's own settings, remembered for the person using it.
 *
 * Which column somebody filtered to, how they ordered it, whether they hide the
 * finished work — none of that is data, and none of it belongs to the record.
 * It is how one person likes to look at a screen, and it was thrown away on
 * every refresh, so the first thing anybody did each morning was set the same
 * three controls again.
 *
 * **Per user, and per browser.** The key carries the account id because a
 * shared machine is normal here — a warehouse terminal, the sales desk — and
 * one person's filters appearing under another's sign-in reads as the screen
 * having lost their work. It is `localStorage` rather than a column on the
 * account precisely because it is a convenience of *this* browser: it is not
 * worth a write to a database shared with Report Server, and losing it costs
 * three clicks.
 *
 * Every read and write is guarded. `localStorage` throws outright in a private
 * window and in a browser set to block site data, and a screen that cannot draw
 * because it could not remember a dropdown is worse than one that forgets.
 */

const PREFIX = "ata.view.";

/** The stored key for one screen and one account. */
function keyFor(screen: string, userId: string | null | undefined): string {
  return `${PREFIX}${screen}.${userId || "anon"}`;
}

/**
 * What was stored, merged over the defaults.
 *
 * Merged, never returned whole: a stored document written by an older build has
 * keys the screen no longer knows and lacks ones it has since gained, and
 * handing it back as-is would leave a control with `undefined` where it expects
 * a string. Only keys the defaults name survive, so a value that has been
 * removed from the screen cannot come back through the door.
 */
export function readViewPreferences<T extends object>(
  screen: string,
  userId: string | null | undefined,
  defaults: T,
): T {
  try {
    const raw = window.localStorage.getItem(keyFor(screen, userId));
    if (!raw) return defaults;

    const stored = JSON.parse(raw) as Record<string, unknown>;
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) return defaults;

    const merged = { ...defaults } as Record<string, unknown>;
    const base = defaults as Record<string, unknown>;
    for (const key of Object.keys(base)) {
      const value = stored[key];
      // Same shape or nothing: a boolean where a string belongs would put a
      // control into a state it has no way to render.
      if (value !== undefined && typeof value === typeof base[key]) {
        merged[key] = value;
      }
    }
    return merged as T;
  } catch {
    return defaults;
  }
}

/** Stores one screen's settings. Never throws; failing to remember is not an error. */
export function writeViewPreferences(
  screen: string,
  userId: string | null | undefined,
  value: object,
): void {
  try {
    window.localStorage.setItem(keyFor(screen, userId), JSON.stringify(value));
  } catch {
    /* a private window, or site data blocked — the screen works either way */
  }
}
