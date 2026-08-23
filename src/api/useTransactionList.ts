import { useEffect, useMemo, useState } from "react";
import { useList } from "./useList";
import { TransactionRow, TransactionSummary, transactionsApi } from "./transactions";

/**
 * The transactions ledger's query state, with its totals.
 *
 * The totals come from the server under the same filters as the rows, not from
 * summing the page — a balance computed over one page of a ledger is simply
 * wrong.
 */

export interface TransactionListFilters {
  type: string;
  status: string;
  paymentType: string;
  customerId: string;
  supplierId: string;
  projectId: string;
  dateFrom: string;
  dateTo: string;
}

const EMPTY_FILTERS: TransactionListFilters = {
  type: "all",
  status: "all",
  paymentType: "all",
  customerId: "all",
  supplierId: "all",
  projectId: "all",
  dateFrom: "",
  dateTo: "",
};

export function useTransactionList(initialSearch = "") {
  const [filters, setFilters] = useState<TransactionListFilters>(EMPTY_FILTERS);

  const params = useMemo(() => ({
    type: filters.type,
    status: filters.status,
    paymentType: filters.paymentType,
    customerId: filters.customerId,
    supplierId: filters.supplierId,
    projectId: filters.projectId,
    dateFrom: filters.dateFrom || undefined,
    dateTo: filters.dateTo || undefined,
  }), [filters]);

  const list = useList<TransactionRow>({
    path: "/api/transactions",
    pageSize: 50,
    sort: "occurredAt",
    order: "desc",
    params,
  });

  const [seeded, setSeeded] = useState(false);
  if (!seeded && initialSearch) {
    setSeeded(true);
    list.setSearch(initialSearch);
  }

  /* Totals, refetched whenever the query or the data changes. */
  const [summary, setSummary] = useState<TransactionSummary | null>(null);
  const paramsKey = JSON.stringify(params);

  /*
   * `list.rows` is the dependency, not `list.total`.
   *
   * The count is unchanged by the edit that matters most here — correcting an
   * amount — so totals keyed on it stayed at the old figures until something
   * else happened to move the row count. `rows` is a fresh array after every
   * fetch, so this re-asks whenever the ledger has actually been re-read.
   */
  useEffect(() => {
    let cancelled = false;
    transactionsApi
      .summary({ ...JSON.parse(paramsKey), search: list.search || undefined })
      .then((data) => { if (!cancelled) setSummary(data); })
      // A failed total should leave the figure blank, not break the ledger.
      .catch(() => { if (!cancelled) setSummary(null); });
    return () => { cancelled = true; };
  }, [paramsKey, list.search, list.rows]);

  const setFilter = <K extends keyof TransactionListFilters>(key: K, value: TransactionListFilters[K]) =>
    setFilters((current) => ({ ...current, [key]: value }));

  const clearFilters = () => setFilters(EMPTY_FILTERS);

  const hasActiveFilters =
    filters.type !== "all" || filters.status !== "all" || filters.paymentType !== "all"
    || filters.customerId !== "all" || filters.supplierId !== "all" || filters.projectId !== "all"
    || !!filters.dateFrom || !!filters.dateTo;

  const exportParams = useMemo(
    () => ({ ...params, search: list.search || undefined, sort: list.sort, order: list.order }),
    [params, list.search, list.sort, list.order],
  );

  return { ...list, filters, setFilter, clearFilters, hasActiveFilters, exportParams, summary };
}
