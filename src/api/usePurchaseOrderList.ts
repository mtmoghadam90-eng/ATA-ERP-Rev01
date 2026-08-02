import { useMemo, useState } from "react";
import { useList } from "./useList";
import { PurchaseOrderRow } from "./purchaseOrders";

/** The purchase orders grid's query state. */

export interface PurchaseOrderListFilters {
  status: string;
  supplierId: string;
  projectId: string;
  currency: string;
  dateFrom: string;
  dateTo: string;
}

const EMPTY_FILTERS: PurchaseOrderListFilters = {
  status: "all",
  supplierId: "all",
  projectId: "all",
  currency: "all",
  dateFrom: "",
  dateTo: "",
};

export function usePurchaseOrderList(initialSearch = "") {
  const [filters, setFilters] = useState<PurchaseOrderListFilters>(EMPTY_FILTERS);

  const params = useMemo(() => ({
    status: filters.status,
    supplierId: filters.supplierId,
    projectId: filters.projectId,
    currency: filters.currency,
    dateFrom: filters.dateFrom || undefined,
    dateTo: filters.dateTo || undefined,
  }), [filters]);

  const list = useList<PurchaseOrderRow>({
    path: "/api/purchase-orders",
    pageSize: 50,
    sort: "orderDate",
    order: "desc",
    params,
  });

  const [seeded, setSeeded] = useState(false);
  if (!seeded && initialSearch) {
    setSeeded(true);
    list.setSearch(initialSearch);
  }

  const setFilter = <K extends keyof PurchaseOrderListFilters>(
    key: K,
    value: PurchaseOrderListFilters[K],
  ) => setFilters((current) => ({ ...current, [key]: value }));

  const clearFilters = () => setFilters(EMPTY_FILTERS);

  const hasActiveFilters =
    filters.status !== "all" || filters.supplierId !== "all" || filters.projectId !== "all"
    || filters.currency !== "all" || !!filters.dateFrom || !!filters.dateTo;

  const exportParams = useMemo(
    () => ({ ...params, search: list.search || undefined, sort: list.sort, order: list.order }),
    [params, list.search, list.sort, list.order],
  );

  return { ...list, filters, setFilter, clearFilters, hasActiveFilters, exportParams };
}
