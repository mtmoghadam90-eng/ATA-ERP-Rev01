import { api } from "./client";
import type { ERPSettings } from "../types";

/**
 * System settings.
 *
 * One object rather than a collection, so there is no paging here — but it is
 * still a row in SQL rather than a blob in the document store, and it is the
 * server's copy that every screen reads on load.
 */
export const settingsApi = {
  load: (signal?: AbortSignal) =>
    api.get<{ settings: ERPSettings }>("/api/settings", undefined, signal).then((r) => r.settings),

  save: (settings: ERPSettings) =>
    api.put<Record<string, never>>("/api/settings", { settings }),
};
