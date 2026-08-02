import { useMemo, useState } from "react";
import { useList } from "./useList";
import { SupplierRow } from "./suppliers";

/** The suppliers grid's query state. */

export interface SupplierListFilters {
  status: string;
  country: string;
}

const EMPTY_FILTERS: SupplierListFilters = { status: "all", country: "all" };

export function useSupplierList(initialSearch = "") {
  const [filters, setFilters] = useState<SupplierListFilters>(EMPTY_FILTERS);

  const params = useMemo(
    () => ({ status: filters.status, country: filters.country }),
    [filters],
  );

  const list = useList<SupplierRow>({
    path: "/api/suppliers",
    pageSize: 50,
    sort: "name",
    order: "asc",
    params,
  });

  const [seeded, setSeeded] = useState(false);
  if (!seeded && initialSearch) {
    setSeeded(true);
    list.setSearch(initialSearch);
  }

  const setFilter = <K extends keyof SupplierListFilters>(key: K, value: SupplierListFilters[K]) =>
    setFilters((current) => ({ ...current, [key]: value }));

  const clearFilters = () => setFilters(EMPTY_FILTERS);
  const hasActiveFilters = filters.status !== "all" || filters.country !== "all";

  const exportParams = useMemo(
    () => ({ ...params, search: list.search || undefined, sort: list.sort, order: list.order }),
    [params, list.search, list.sort, list.order],
  );

  return { ...list, filters, setFilter, clearFilters, hasActiveFilters, exportParams };
}
