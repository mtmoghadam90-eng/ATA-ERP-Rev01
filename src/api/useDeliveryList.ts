import { useMemo, useState } from "react";
import { useList } from "./useList";
import { DeliveryRow } from "./deliveries";

/** The packing-lists grid's query state. */

export interface DeliveryListFilters {
  projectId: string;
  shippingMethod: string;
  dateFrom: string;
  dateTo: string;
}

const EMPTY_FILTERS: DeliveryListFilters = {
  projectId: "all", shippingMethod: "all", dateFrom: "", dateTo: "",
};

export function useDeliveryList() {
  const [filters, setFilters] = useState<DeliveryListFilters>(EMPTY_FILTERS);

  const params = useMemo(
    () => ({
      projectId: filters.projectId === "all" ? undefined : filters.projectId,
      shippingMethod: filters.shippingMethod === "all" ? undefined : filters.shippingMethod,
      dateFrom: filters.dateFrom || undefined,
      dateTo: filters.dateTo || undefined,
    }),
    [filters],
  );

  const list = useList<DeliveryRow>({
    path: "/api/deliveries",
    pageSize: 50,
    sort: "deliveryDate",
    order: "desc",
    params,
  });

  const setFilter = <K extends keyof DeliveryListFilters>(key: K, value: DeliveryListFilters[K]) =>
    setFilters((current) => ({ ...current, [key]: value }));

  const clearFilters = () => setFilters(EMPTY_FILTERS);
  const hasActiveFilters =
    filters.projectId !== "all" || filters.shippingMethod !== "all" ||
    !!filters.dateFrom || !!filters.dateTo;

  const exportParams = useMemo(
    () => ({ ...params, search: list.search || undefined, sort: list.sort, order: list.order }),
    [params, list.search, list.sort, list.order],
  );

  /** Packing rows across every matching list — counted in SQL, not summed here. */
  const totalItems = typeof list.meta.totalItems === "number" ? list.meta.totalItems : 0;

  return { ...list, filters, setFilter, clearFilters, hasActiveFilters, exportParams, totalItems };
}
