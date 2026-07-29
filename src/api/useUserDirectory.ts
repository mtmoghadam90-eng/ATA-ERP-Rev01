import { useEffect, useState } from "react";
import { ListResponse, api } from "./client";

/**
 * The colleague directory, for "assign to…" pickers.
 *
 * Unlike customers or products this genuinely is a small, bounded list — a
 * company has tens of staff, not thousands — so it is fetched once and shared
 * rather than searched. The endpoint returns names only unless the caller holds
 * the `users` permission, so this is safe for every screen to read.
 *
 * Cached at module scope: half a dozen screens render an assignee dropdown, and
 * each mounting one should not be another request for the same short list.
 */

export interface DirectoryUser {
  id: string;
  fullName: string;
  position?: string | null;
  isActive?: boolean;
}

let cache: DirectoryUser[] | null = null;
let inFlight: Promise<DirectoryUser[]> | null = null;

async function fetchDirectory(): Promise<DirectoryUser[]> {
  if (cache) return cache;
  if (inFlight) return inFlight;

  inFlight = api
    .get<ListResponse<DirectoryUser>>("/api/users", { pageSize: 200, sort: "fullName", order: "asc" })
    .then((data) => {
      cache = data.rows;
      return cache;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

/** Drops the cache — call after users are added, renamed or deactivated. */
export function invalidateUserDirectory(): void {
  cache = null;
}

export function useUserDirectory(): { users: DirectoryUser[]; loading: boolean; error: string | null } {
  const [users, setUsers] = useState<DirectoryUser[]>(cache ?? []);
  const [loading, setLoading] = useState(!cache);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (cache) {
      setUsers(cache);
      setLoading(false);
      return;
    }

    setLoading(true);
    fetchDirectory()
      .then((rows) => {
        if (cancelled) return;
        setUsers(rows);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        // A missing directory should leave a picker empty, not break the screen.
        setError("دریافت فهرست کاربران با خطا مواجه شد.");
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, []);

  return { users, loading, error };
}
