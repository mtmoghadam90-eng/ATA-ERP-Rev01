import { useMemo, useState } from "react";
import { useList } from "./useList";
import { ProductRow } from "./products";

/** The product catalogue's query state. */

export interface ProductListFilters {
  category: string;
  brand: string;
  supplyType: string;
  hasVariants: string;
}

const EMPTY_FILTERS: ProductListFilters = {
  category: "all",
  brand: "all",
  supplyType: "all",
  hasVariants: "all",
};

export function useProductList(initialSearch = "") {
  const [filters, setFilters] = useState<ProductListFilters>(EMPTY_FILTERS);

  const params = useMemo(() => ({
    category: filters.category,
    brand: filters.brand,
    supplyType: filters.supplyType,
    hasVariants: filters.hasVariants === "all" ? undefined : filters.hasVariants,
  }), [filters]);

  const list = useList<ProductRow>({
    path: "/api/products",
    pageSize: 50,
    sort: "displayName",
    order: "asc",
    params,
  });

  const [seeded, setSeeded] = useState(false);
  if (!seeded && initialSearch) {
    setSeeded(true);
    list.setSearch(initialSearch);
  }

  const setFilter = <K extends keyof ProductListFilters>(key: K, value: ProductListFilters[K]) =>
    setFilters((current) => ({ ...current, [key]: value }));

  const clearFilters = () => setFilters(EMPTY_FILTERS);

  const hasActiveFilters =
    filters.category !== "all" || filters.brand !== "all"
    || filters.supplyType !== "all" || filters.hasVariants !== "all";

  const exportParams = useMemo(
    () => ({ ...params, search: list.search || undefined, sort: list.sort, order: list.order }),
    [params, list.search, list.sort, list.order],
  );

  return { ...list, filters, setFilter, clearFilters, hasActiveFilters, exportParams };
}
