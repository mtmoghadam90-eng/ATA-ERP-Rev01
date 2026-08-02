import { useMemo, useState } from "react";
import { useList } from "./useList";
import { TaskRow } from "./tasks";

/**
 * The tasks board's query state.
 *
 * `overdue` is a flag the server resolves against today's Shamsi date, not a
 * predicate applied to the page after it arrives — otherwise the count would
 * describe the page rather than the result.
 */

export interface TaskListFilters {
  status: string;
  priority: string;
  assignedToUserId: string;
  relatedToType: string;
  overdue: boolean;
  dateFrom: string;
  dateTo: string;
}

const EMPTY_FILTERS: TaskListFilters = {
  status: "all",
  priority: "all",
  assignedToUserId: "all",
  relatedToType: "all",
  overdue: false,
  dateFrom: "",
  dateTo: "",
};

export function useTaskList(initialSearch = "") {
  const [filters, setFilters] = useState<TaskListFilters>(EMPTY_FILTERS);

  const params = useMemo(() => ({
    status: filters.status,
    priority: filters.priority,
    assignedToUserId: filters.assignedToUserId,
    relatedToType: filters.relatedToType,
    overdue: filters.overdue ? "true" : undefined,
    dateFrom: filters.dateFrom || undefined,
    dateTo: filters.dateTo || undefined,
  }), [filters]);

  const list = useList<TaskRow>({
    path: "/api/tasks",
    pageSize: 50,
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
    filters.status !== "all" || filters.priority !== "all"
    || filters.assignedToUserId !== "all" || filters.relatedToType !== "all"
    || filters.overdue || !!filters.dateFrom || !!filters.dateTo;

  return { ...list, filters, setFilter, clearFilters, hasActiveFilters };
}
