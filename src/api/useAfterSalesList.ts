import { useMemo, useState } from "react";
import { useList } from "./useList";
import { ServiceRow } from "./afterSales";

/** The after-sales grid's query state. */

export interface ServiceListFilters {
  status: string;
  projectId: string;
}

const EMPTY_FILTERS: ServiceListFilters = { status: "all", projectId: "all" };

export function useAfterSalesList() {
  const [filters, setFilters] = useState<ServiceListFilters>(EMPTY_FILTERS);

  const params = useMemo(
    () => ({
      status: filters.status === "all" ? undefined : filters.status,
      projectId: filters.projectId === "all" ? undefined : filters.projectId,
    }),
    [filters],
  );

  const list = useList<ServiceRow>({
    path: "/api/after-sales",
    pageSize: 50,
    sort: "startDate",
    order: "desc",
    params,
  });

  const setFilter = <K extends keyof ServiceListFilters>(key: K, value: ServiceListFilters[K]) =>
    setFilters((current) => ({ ...current, [key]: value }));

  const clearFilters = () => setFilters(EMPTY_FILTERS);
  const hasActiveFilters = filters.status !== "all" || filters.projectId !== "all";

  return { ...list, filters, setFilter, clearFilters, hasActiveFilters };
}
