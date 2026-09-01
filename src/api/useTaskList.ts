import { useEffect, useMemo, useState } from "react";
import { readViewPreferences, writeViewPreferences } from "../utils/viewPreferences";
import { useList } from "./useList";
import { TaskRow } from "./tasks";

/**
 * The tasks board's query state.
 *
 * `overdue` is a flag the server resolves against today's Shamsi date, not a
 * predicate applied to the page after it arrives — otherwise the count would
 * describe the page rather than the result.
 */

/**
 * Which half of the board.
 *
 * A convenience on top of the server's own scope, never instead of it: what a
 * user may see at all is decided by `visibilityClause`, so «all» here means
 * «everything I am allowed to see», not «everything».
 */
export type TaskScope = "toMe" | "fromMe" | "all";

export interface TaskListFilters {
  scope: TaskScope;
  /**
   * Which **column**, never a raw status.
   *
   * It used to be the status word, matched exactly — and every automation
   * raises its task as «در انتظار», a fourth value no dropdown has ever
   * offered, so choosing «در حال انجام» asked for a string those tasks did not
   * carry and answered with nothing. `laneWhere` on the server turns a column
   * into the query that finds it, with the middle one written as an exclusion.
   */
  lane: string;
  priority: string;
  assignedToUserId: string;
  relatedToType: string;
  overdue: boolean;
  /**
   * «انجام‌شده‌ها را پنهان کن».
   *
   * Sent to the server rather than applied to the page: the board is paged, so
   * dropping the done rows after they arrive would leave a page of twenty
   * completed tasks looking empty with the unfiltered total printed beside it.
   */
  hideCompleted: boolean;
  dateFrom: string;
  dateTo: string;
}

const EMPTY_FILTERS: TaskListFilters = {
  // Opens on what was given to me, which is what somebody signing in wants to
  // know. «از طرف من» and «همه» are one click away.
  scope: "toMe",
  lane: "all",
  priority: "all",
  assignedToUserId: "all",
  relatedToType: "all",
  overdue: false,
  // Off by default: the board shows everything it always showed, and hiding is
  // the deliberate click.
  hideCompleted: false,
  dateFrom: "",
  dateTo: "",
};

/**
 * The board's query state, remembered for whoever is signed in.
 *
 * Which column, which priority, whether the finished work is hidden — one
 * person's way of looking at the screen, thrown away on every refresh until
 * now, so the first thing anybody did each morning was set the same three
 * controls again. Stored per account and per browser; see `viewPreferences`.
 *
 * `scope` is remembered too, and deliberately: «همه وظایف» is a deliberate
 * choice somebody with the permission makes, and being dropped back to «به من
 * ارجاع شده» on every reload is the same annoyance in the place it is felt
 * most.
 */
export function useTaskList(initialSearch = "", userId?: string | null) {
  const [filters, setFilters] = useState<TaskListFilters>(
    () => readViewPreferences("tasks.filters", userId, EMPTY_FILTERS));

  /*
   * Written on change rather than on unmount: the tab is closed, the browser is
   * killed, the machine sleeps — an unmount is not something to rely on for a
   * thing whose whole job is to survive.
   */
  useEffect(() => {
    writeViewPreferences("tasks.filters", userId, filters);
  }, [filters, userId]);

  const params = useMemo(() => ({
    scope: filters.scope === "all" ? undefined : filters.scope,
    lane: filters.lane,
    priority: filters.priority,
    assignedToUserId: filters.assignedToUserId,
    relatedToType: filters.relatedToType,
    overdue: filters.overdue ? "true" : undefined,
    hideCompleted: filters.hideCompleted ? "true" : undefined,
    dateFrom: filters.dateFrom || undefined,
    dateTo: filters.dateTo || undefined,
  }), [filters]);

  const list = useList<TaskRow>({
    path: "/api/tasks",
    /*
     * Two hundred, which is the server's own ceiling.
     *
     * The screen is three columns now, not one list: at fifty a page could be
     * spent entirely on finished work and leave «برای انجام» looking empty,
     * which is the opposite of what a board is for. The cap is what stops this
     * becoming a whole-table read; the pagination controls are still there for
     * a backlog that outgrows it.
     */
    pageSize: 200,
    // Soonest first: a board is read by what is due next, not by what was
    // entered last.
    sort: "dueDate",
    order: "asc",
    params,
  });

  const [seeded, setSeeded] = useState(false);
  if (!seeded && initialSearch) {
    setSeeded(true);
    list.setSearch(initialSearch);
  }

  const setFilter = <K extends keyof TaskListFilters>(key: K, value: TaskListFilters[K]) =>
    setFilters((current) => ({ ...current, [key]: value }));

  const clearFilters = () => setFilters(EMPTY_FILTERS);

  const hasActiveFilters =
    filters.scope !== "toMe" || filters.lane !== "all" || filters.priority !== "all"
    || filters.assignedToUserId !== "all" || filters.relatedToType !== "all"
    || filters.overdue || filters.hideCompleted || !!filters.dateFrom || !!filters.dateTo;

  return { ...list, filters, setFilter, clearFilters, hasActiveFilters };
}
