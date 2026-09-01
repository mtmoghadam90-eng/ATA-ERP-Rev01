import { useMemo, useState } from "react";
import { useList } from "./useList";
import { ProjectRow } from "./projects";

/**
 * The projects grid's query state.
 *
 * Same shape as `useCustomerList`: the view holds filter values, this turns them
 * into query parameters. Custom-field filters are joined into one repeated
 * parameter, which the endpoint splits.
 */

export interface ProjectListFilters {
  status: string;
  /** «مرحله جاری» — a separate axis from the status; see `projectStage.ts`. */
  stage: string;
  customerId: string;
  ownerUserId: string;
  marketingChannel: string;
  leadQuality: string;
  dateFrom: string;
  dateTo: string;
  customFields: Record<string, string>;
}

const EMPTY_FILTERS: ProjectListFilters = {
  status: "all",
  stage: "all",
  customerId: "all",
  ownerUserId: "all",
  marketingChannel: "all",
  leadQuality: "all",
  dateFrom: "",
  dateTo: "",
  customFields: {},
};

export function useProjectList(initialSearch = "") {
  const [filters, setFilters] = useState<ProjectListFilters>(EMPTY_FILTERS);

  const params = useMemo(() => {
    const out: Record<string, string | undefined> = {
      status: filters.status,
      stage: filters.stage,
      customerId: filters.customerId,
      ownerUserId: filters.ownerUserId,
      marketingChannel: filters.marketingChannel,
      leadQuality: filters.leadQuality,
      dateFrom: filters.dateFrom || undefined,
      dateTo: filters.dateTo || undefined,
    };

    const custom = Object.entries(filters.customFields)
      .filter(([, value]) => value)
      .map(([fieldId, value]) => `${fieldId}:${value}`);
    if (custom.length > 0) out.customField = custom.join("|");

    return out;
  }, [filters]);

  const list = useList<ProjectRow>({
    path: "/api/projects",
    pageSize: 50,
    sort: "createdAt",
    order: "desc",
    params,
  });

  const [seeded, setSeeded] = useState(false);
  if (!seeded && initialSearch) {
    setSeeded(true);
    list.setSearch(initialSearch);
  }

  const setFilter = <K extends keyof ProjectListFilters>(key: K, value: ProjectListFilters[K]) =>
    setFilters((current) => ({ ...current, [key]: value }));

  const setCustomFieldFilter = (fieldId: string, value: string) =>
    setFilters((current) => ({
      ...current,
      customFields: { ...current.customFields, [fieldId]: value },
    }));

  const clearFilters = () => setFilters(EMPTY_FILTERS);

  const hasActiveFilters =
    filters.status !== "all" || filters.customerId !== "all" || filters.ownerUserId !== "all"
    || filters.marketingChannel !== "all" || filters.leadQuality !== "all"
    || !!filters.dateFrom || !!filters.dateTo
    || Object.values(filters.customFields).some(Boolean);

  const exportParams = useMemo(
    () => ({ ...params, search: list.search || undefined, sort: list.sort, order: list.order }),
    [params, list.search, list.sort, list.order],
  );

  return { ...list, filters, setFilter, setCustomFieldFilter, clearFilters, hasActiveFilters, exportParams };
}
