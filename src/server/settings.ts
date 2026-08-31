import type { ERPSettings } from "../types";
import { applySettingsPatches } from "../utils/settingsPatches";
import { getDb } from "./db";

/**
 * Reads the application settings document.
 *
 * Settings live as one JSON row (`app_settings`, id "singleton") because they
 * are read whole and never queried across rows. Several services need them for
 * user-configurable labels, so this caches the parsed object for a short window
 * rather than re-reading and re-parsing on every request — the document is a few
 * kilobytes and changes rarely, but a busy list endpoint would otherwise fetch it
 * once per call.
 */

const CACHE_TTL_MS = 30_000;

let cached: { value: ERPSettings | undefined; at: number } | null = null;

export async function loadSettings(): Promise<ERPSettings | undefined> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

  try {
    const row = await getDb().appSetting.findUnique({ where: { id: "singleton" } });
    const value = row?.data ? (JSON.parse(row.data) as ERPSettings) : undefined;
    cached = { value, at: Date.now() };
    return value;
  } catch {
    // Settings are decoration for the callers that use them (labels, defaults);
    // failing to read them must not fail the request that needed the data.
    return cached?.value;
  }
}

/** Drops the cache after a settings write, so the change is visible at once. */
export function invalidateSettingsCache(): void {
  cached = null;
}

/**
 * Gives the stored settings document the named additions it has not yet had.
 *
 * A default added to `seedData.ts` reaches a fresh installation and nothing
 * else, so an entry a *rule* refers to by name — the three follow-up results
 * `impliedSettlement` keys on — simply was not in the dropdown on any database
 * seeded before it existed, and the feature read as broken rather than
 * unconfigured. `src/utils/settingsPatches.ts` holds the rule and the record of
 * what has been applied.
 *
 * Run at startup, and again on every settings save so a document written by a
 * browser holding an older copy is patched on the way in rather than only after
 * the next restart. It writes only when something changed, and never throws:
 * this is not worth failing a boot or a save over.
 */
export async function ensureSettingsPatches(): Promise<string[]> {
  try {
    const settings = await loadSettings();
    // Nothing seeded yet. `seedDb` writes the current defaults, so there is
    // nothing to patch and writing a document here would race with it.
    if (!settings) return [];

    const patched = applySettingsPatches(settings);
    if (!patched) return [];

    await getDb().appSetting.update({
      where: { id: "singleton" },
      data: { data: JSON.stringify(patched.next) },
    });
    invalidateSettingsCache();
    return patched.applied;
  } catch {
    return [];
  }
}
