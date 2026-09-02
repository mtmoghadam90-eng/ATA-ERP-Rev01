import { useCallback, useEffect, useState } from "react";
import { ListResponse, api } from "./client";
import { useRevalidate } from "./liveData";
import { taskLane } from "../utils/workBoard";

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
  /** Open tasks **assigned to this user** — see `openWork`. */
  openTasks: number;
  /** Products at or below their own minimum. */
  lowStock: number;
  /** Open referrals **assigned to this user** — see `openWork`. */
  pendingReferrals: number;
  /** Unread notices addressed to this user. */
  unreadNotifications: number;
  /**
   * Everything on this user's plate: the open tasks plus the open referrals.
   *
   * **Assigned to them, and only that.** Both records belong to two people —
   * the one the work was given to and the one who gave it — and both halves
   * appear on this user's board, so it is a reasonable question which the badge
   * should count. It is the first: a badge on an inbox answers «چقدر کار روی
   * دستم مانده», and a request raised *for a colleague* is on that colleague's
   * plate rather than on this one's. Counting both put every request somebody
   * had handed out into their own figure, which is how the icon came to show a
   * number nothing on the board could account for.
   *
   * «من ارجاع دادم» is still there to be looked at — a tab on the board and a
   * scope on both endpoints — it is simply not what this number is.
   *
   * One figure rather than a sum recomputed wherever it is drawn. The sidebar's
   * «وظایف و پیگیری» badge and the header's inbox icon are the same question,
   * and two additions of the same two numbers is how they come to disagree the
   * day one of them changes.
   */
  openWork: number;
}

const EMPTY: SidebarBadges = {
  openTasks: 0, lowStock: 0, pendingReferrals: 0, unreadNotifications: 0, openWork: 0,
};

/** How often to re-read them. Long enough not to chatter, short enough to feel live. */
const REFRESH_MS = 60_000;

export function useSidebarBadges(enabled: boolean): SidebarBadges {
  const [badges, setBadges] = useState<SidebarBadges>(EMPTY);

  const load = useCallback(async (signal?: AbortSignal) => {
    // `pageSize: 1` throughout: the rows are irrelevant, only the totals matter.
    const [tasks, dashboard, referrals, notifications] = await Promise.all([
      api.get<{ summary: { byStatus: { status: string; count: number }[] } }>(
        // «به من ارجاع شده», not everything this user can see: a task belongs
        // to its assignee *and* to whoever raised it, and the unscoped count
        // put every request handed to a colleague into this user's own badge.
        "/api/tasks/summary", { scope: "toMe" }, signal),
      api.get<{ summary: { counts: { lowStock: number } } }>("/api/dashboard", undefined, signal),
      api.get<ListResponse<unknown>>("/api/referrals",
        /*
         * «still open», not the exact «در انتظار اقدام» this used to ask for:
         * a referral picked up now carries a middle status, and an exact filter
         * would have made it vanish from the count of what is on your plate.
         *
         * «toMe» and not «mine», for the same reason the tasks half is scoped —
         * see `openWork`. `mine` is both directions and is what the board's
         * «همه» view and the assistant ask for; a badge is not that question.
         */
        { scope: "toMe", open: "true", pageSize: 1 }, signal),
      api.get<ListResponse<unknown> & { unread: number }>("/api/notifications",
        { pageSize: 1 }, signal),
    ]);

    /*
     * Everything the board's open columns hold **for this user**: an ordinary
     * task, one an automation raised, a sales follow-up, one they logged for
     * themselves. `taskLane` is the same rule the board draws by, and it is an
     * exclusion — every automation writes «در انتظار», a fourth value no
     * dropdown ever offered, and a hardcoded list of the two closing words
     * counted it only by luck.
     */
    const openTasks = tasks.summary.byStatus
      .filter((s) => taskLane(s.status) !== "DONE")
      .reduce((sum, s) => sum + s.count, 0);
    const pendingReferrals = referrals.total;

    setBadges({
      openTasks,
      lowStock: dashboard.summary.counts.lowStock,
      pendingReferrals,
      unreadNotifications: notifications.unread,
      openWork: openTasks + pendingReferrals,
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
