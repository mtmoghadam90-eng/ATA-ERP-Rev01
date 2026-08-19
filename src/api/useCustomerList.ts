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
  /** طلایی | نقره‌ای | برنزی | بدون خرید — the derived level, or "all". */
  customerLevel: string;
  /** fieldId -> value, from the user-defined custom fields. */
  customFields: Record<string, string>;
}

const EMPTY_FILTERS: CustomerListFilters = {
  customerType: "all",
  industry: "all",
  province: "all",
  status: "all",
  customerLevel: "all",
  customFields: {},
};

export function useCustomerList(initialSearch = "") {
  const [filters, setFilters] = useState<CustomerListFilters>(EMPTY_FILTERS);

  const params = useMemo(() => {
    const out: Record<string, string | undefined> = {
      customerType: filters.customerType,
      industry: filters.industry,
      province: filters.province,
      status: filters.status,
      customerLevel: filters.customerLevel,
    };

    // URLSearchParams cannot express a repeated key through a plain object, so
    // the pairs are joined and the endpoint splits them. One filter is by far
    // the common case; several are supported because the UI allows it.
    const custom = Object.entries(filters.customFields)
      .filter(([, value]) => value)
      .map(([fieldId, value]) => `${fieldId}:${value}`);
    if (custom.length > 0) out.customField = custom.join("|");

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

  const setCustomFieldFilter = (fieldId: string, value: string) =>
    setFilters((current) => ({
      ...current,
      customFields: { ...current.customFields, [fieldId]: value },
    }));

  const clearFilters = () => setFilters(EMPTY_FILTERS);

  const hasActiveFilters =
    filters.customerType !== "all" || filters.industry !== "all" ||
    filters.province !== "all" || filters.status !== "all" ||
    filters.customerLevel !== "all" ||
    Object.values(filters.customFields).some(Boolean);

  /** The same parameters, for an export that must cover every match. */
  const exportParams = useMemo(
    () => ({ ...params, search: list.search || undefined, sort: list.sort, order: list.order }),
    [params, list.search, list.sort, list.order],
  );

  return { ...list, filters, setFilter, setCustomFieldFilter, clearFilters, hasActiveFilters, exportParams };
}
