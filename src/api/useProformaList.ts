import { useMemo, useState } from "react";
import { useList } from "./useList";
import { ProformaRow } from "./proformas";

/**
 * The proformas grid's query state.
 *
 * The screen groups a page by project, so it asks for a larger page than the
 * flat grids do: a project's proformas splitting across a page boundary would
 * show the same project as two separate groups.
 */

export interface ProformaListFilters {
  status: string;
  customerId: string;
  projectId: string;
  currency: string;
  /** "true" hides all but cancelled, "false" hides cancelled. */
  isCancelled: string;
  dateFrom: string;
  dateTo: string;
}

const EMPTY_FILTERS: ProformaListFilters = {
  status: "all",
  customerId: "all",
  projectId: "all",
  currency: "all",
  isCancelled: "all",
  dateFrom: "",
  dateTo: "",
};

export function useProformaList(initialSearch = "") {
  const [filters, setFilters] = useState<ProformaListFilters>(EMPTY_FILTERS);

  const params = useMemo(() => ({
    status: filters.status,
    customerId: filters.customerId,
    projectId: filters.projectId,
    currency: filters.currency,
    isCancelled: filters.isCancelled === "all" ? undefined : filters.isCancelled,
    dateFrom: filters.dateFrom || undefined,
    dateTo: filters.dateTo || undefined,
  }), [filters]);

  const list = useList<ProformaRow>({
    path: "/api/proformas",
    // Larger than the flat grids because of the grouping — see above.
    pageSize: 100,
    sort: "issueDate",
    order: "desc",
    params,
  });

  const [seeded, setSeeded] = useState(false);
  if (!seeded && initialSearch) {
    setSeeded(true);
    list.setSearch(initialSearch);
  }

  const setFilter = <K extends keyof ProformaListFilters>(key: K, value: ProformaListFilters[K]) =>
    setFilters((current) => ({ ...current, [key]: value }));

  const clearFilters = () => setFilters(EMPTY_FILTERS);

  const hasActiveFilters =
    filters.status !== "all" || filters.customerId !== "all" || filters.projectId !== "all"
    || filters.currency !== "all" || filters.isCancelled !== "all"
    || !!filters.dateFrom || !!filters.dateTo;

  const exportParams = useMemo(
    () => ({ ...params, search: list.search || undefined, sort: list.sort, order: list.order }),
    [params, list.search, list.sort, list.order],
  );

  return { ...list, filters, setFilter, clearFilters, hasActiveFilters, exportParams };
}
