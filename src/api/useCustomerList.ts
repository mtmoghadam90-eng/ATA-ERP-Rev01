import { useMemo, useState } from "react";
import { useList } from "./useList";
import { CustomerRow } from "./customers";

/**
 * The customers grid's query state.
 *
 * Wraps `useList` with the filters this screen actually offers, so the view
 * holds filter values rather than assembling query parameters. Custom-field
 * filters are passed through as repeated `customField=<id>:<value>` entries,
 * which the endpoint understands.
 */

export interface CustomerListFilters {
  customerType: string;
  industry: string;
  province: string;
  status: string;
  /* Customer value. Ranges and a relation rather than plain equality, so they
     travel as their own query parameters. */
  rank: string;
  minRealized: string;
  maxRealized: string;
  minPotential: string;
  maxPotential: string;
  minGrossProfit: string;
  maxGrossProfit: string;
  lastPurchaseWithinMonths: string;
  paymentBehaviour: string;
  costToServe: string;
  /** "true" to show only customers whose potential has never been assessed. */
  notAssessed: string;
  /** fieldId -> value, from the user-defined custom fields. */
  customFields: Record<string, string>;
  /** The grid's per-column header inputs, applied on the server. */
  columns: Record<string, string>;
}

const EMPTY_FILTERS: CustomerListFilters = {
  customerType: "all",
  industry: "all",
  province: "all",
  status: "all",
  rank: "all",
  minRealized: "",
  maxRealized: "",
  minPotential: "",
  maxPotential: "",
  minGrossProfit: "",
  maxGrossProfit: "",
  lastPurchaseWithinMonths: "",
  paymentBehaviour: "all",
  costToServe: "all",
  notAssessed: "",
  customFields: {},
  columns: {},
};

export function useCustomerList(initialSearch = "") {
  const [filters, setFilters] = useState<CustomerListFilters>(EMPTY_FILTERS);

  const params = useMemo(() => {
    const out: Record<string, string | undefined> = {
      customerType: filters.customerType,
      industry: filters.industry,
      province: filters.province,
      status: filters.status,
      rank: filters.rank,
      minRealized: filters.minRealized,
      maxRealized: filters.maxRealized,
      minPotential: filters.minPotential,
      maxPotential: filters.maxPotential,
      minGrossProfit: filters.minGrossProfit,
      maxGrossProfit: filters.maxGrossProfit,
      lastPurchaseWithinMonths: filters.lastPurchaseWithinMonths,
      paymentBehaviour: filters.paymentBehaviour,
      costToServe: filters.costToServe,
      notAssessed: filters.notAssessed,
    };

    // URLSearchParams cannot express a repeated key through a plain object, so
    // the pairs are joined and the endpoint splits them. One filter is by far
    // the common case; several are supported because the UI allows it.
    const custom = Object.entries(filters.customFields)
      .filter(([, value]) => value)
      .map(([fieldId, value]) => `${fieldId}:${value}`);
    if (custom.length > 0) out.customField = custom.join("|");

    // One parameter per column, named so the endpoint's allowlist can match
    // them. Empty inputs are dropped by buildQuery.
    for (const [column, value] of Object.entries(filters.columns)) {
      if (!value) continue;
      out[`col${column.charAt(0).toUpperCase()}${column.slice(1)}`] = value;
    }

    return out;
  }, [filters]);

  const list = useList<CustomerRow>({
    path: "/api/customers",
    pageSize: 50,
    sort: "companyName",
    order: "asc",
    params,
  });

  // The caller may want the grid pre-filtered, e.g. after clicking a customer
  // name elsewhere in the app.
  const [seeded, setSeeded] = useState(false);
  if (!seeded && initialSearch) {
    setSeeded(true);
    list.setSearch(initialSearch);
  }

  const setFilter = <K extends keyof CustomerListFilters>(key: K, value: CustomerListFilters[K]) =>
    setFilters((current) => ({ ...current, [key]: value }));

  /** One header input. Debounced by useList like the main search box. */
  const setColumnFilter = (column: string, value: string) =>
    setFilters((current) => ({
      ...current,
      columns: { ...current.columns, [column]: value },
    }));

  const setCustomFieldFilter = (fieldId: string, value: string) =>
    setFilters((current) => ({
      ...current,
      customFields: { ...current.customFields, [fieldId]: value },
    }));

  const clearFilters = () => setFilters(EMPTY_FILTERS);

  const hasActiveFilters =
    filters.customerType !== "all" || filters.industry !== "all" ||
    filters.province !== "all" || filters.status !== "all" ||
    filters.rank !== "all" || filters.paymentBehaviour !== "all" ||
    filters.costToServe !== "all" ||
    !!filters.minRealized || !!filters.maxRealized ||
    !!filters.minPotential || !!filters.maxPotential ||
    !!filters.minGrossProfit || !!filters.maxGrossProfit ||
    !!filters.lastPurchaseWithinMonths || !!filters.notAssessed ||
    Object.values(filters.customFields).some(Boolean) ||
    Object.values(filters.columns).some(Boolean);

  /** The same parameters, for an export that must cover every match. */
  const exportParams = useMemo(
    () => ({ ...params, search: list.search || undefined, sort: list.sort, order: list.order }),
    [params, list.search, list.sort, list.order],
  );

  return {
    ...list, filters, setFilter, setColumnFilter, setCustomFieldFilter,
    clearFilters, hasActiveFilters, exportParams,
  };
}
