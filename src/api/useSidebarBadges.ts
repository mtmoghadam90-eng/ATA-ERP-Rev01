import { useCallback, useEffect, useState } from "react";
import { ListResponse, api } from "./client";

/**
 * The counts on the sidebar and in the header.
 *
 * These are always on screen, so they were the last reason the store loaded
 * whole collections: open tasks came from every task, low stock from every
 * product, and the two referral figures from every category group in the
 * company. Each is a count the server already knows.
 *
 * No new endpoints — three existing ones, asked for a single page so only the
 * totals come back. Refreshed on a timer because these are ambient figures
 * that other people change.
 */

export interface SidebarBadges {
  /** Tasks not finished or cancelled. */
  openTasks: number;
  /** Products at or below their own minimum. */
  lowStock: number;
  /** Referrals assigned to this user and still awaiting action. */
  pendingReferrals: number;
  /** Unread notices addressed to this user. */
  unreadNotifications: number;
}

const EMPTY: SidebarBadges = { openTasks: 0, lowStock: 0, pendingReferrals: 0, unreadNotifications: 0 };

/** How often to re-read them. Long enough not to chatter, short enough to feel live. */
const REFRESH_MS = 60_000;

export function useSidebarBadges(enabled: boolean): SidebarBadges {
  const [badges, setBadges] = useState<SidebarBadges>(EMPTY);

  const load = useCallback(async (signal?: AbortSignal) => {
    // `pageSize: 1` throughout: the rows are irrelevant, only the totals matter.
    const [tasks, dashboard, referrals, notifications] = await Promise.all([
      api.get<{ summary: { byStatus: { status: string; count: number }[] } }>(
        "/api/tasks/summary", undefined, signal),
      api.get<{ summary: { counts: { lowStock: number } } }>("/api/dashboard", undefined, signal),
      api.get<ListResponse<unknown>>("/api/referrals",
        { scope: "toMe", status: "در انتظار اقدام", pageSize: 1 }, signal),
      api.get<ListResponse<unknown> & { unread: number }>("/api/notifications",
        { pageSize: 1 }, signal),
    ]);

    const closed = new Set(["انجام شده", "کنسل شده"]);
    setBadges({
      openTasks: tasks.summary.byStatus
        .filter((s) => !closed.has(s.status))
        .reduce((sum, s) => sum + s.count, 0),
      lowStock: dashboard.summary.counts.lowStock,
      pendingReferrals: referrals.total,
      unreadNotifications: notifications.unread,
    });
  }, []);

  useEffect(() => {
    if (!enabled) {
      setBadges(EMPTY);
      return;
    }

    const controller = new AbortController();

    const run = () => {
      load(controller.signal).catch(() => {
        // A badge is decoration; a failure leaves the last figures showing
        // rather than interrupting whatever the user is doing.
      });
    };

    run();
    const timer = setInterval(run, REFRESH_MS);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [enabled, load]);

  return badges;
}
