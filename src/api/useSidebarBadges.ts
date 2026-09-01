import { useCallback, useEffect, useState } from "react";
import { ListResponse, api } from "./client";
import { useRevalidate } from "./liveData";

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
        // «still open», not the exact «در انتظار اقدام» this used to ask for:
        // a referral picked up now carries a middle status, and an exact filter
        // would have made it vanish from the count of what is on your plate.
        { scope: "toMe", open: "true", pageSize: 1 }, signal),
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

  const run = useCallback(() => {
    load().catch(() => {
      // A badge is decoration; a failure leaves the last figures showing
      // rather than interrupting whatever the user is doing.
    });
  }, [load]);

  useEffect(() => {
    if (!enabled) {
      setBadges(EMPTY);
      return;
    }
    const controller = new AbortController();
    load(controller.signal).catch(() => {});
    return () => controller.abort();
  }, [enabled, load]);

  /*
   * These are the figures the staleness was noticed on: the referral count sat
   * at whatever it was when the page loaded, because nothing here had any
   * reason to look again. Now anything that writes one of these resources —
   * filing a referral, finishing a task, receiving stock — makes them re-read
   * immediately, a return to the tab does too, and the timer remains for what
   * other people change while this tab sits open.
   */
  useRevalidate(
    ["referrals", "tasks", "products", "notifications", "activities", "inventory"],
    run,
    { enabled, intervalMs: REFRESH_MS },
  );

  return badges;
}
