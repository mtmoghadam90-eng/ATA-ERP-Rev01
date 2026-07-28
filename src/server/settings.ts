import type { ERPSettings } from "../types";
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
