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
  /**
   * «هنوز پیش‌فاکتور صادر نشده» — "all", "none" or "unsent".
   *
   * A third axis beside the status and the stage, and not a second spelling of
   * either: the stage reports the least-advanced *open* thing, so a job nobody
   * has quoted but somebody has sent supplier inquiries for reads as an inquiry
   * stage, which is exactly the job this answers.
   */
  quotation: string;
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
  quotation: "all",
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
      // Omitted rather than sent as "all", because the server reads anything
      // that is not one of its two values as «no clause» either way and an
      // absent parameter says so at the one place a person can read it.
      quotation: filters.quotation === "all" ? undefined : filters.quotation,
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

  // Every filter this hook holds, so «پاک کردن فیلترها» is offered exactly when
  // something is narrowing the list. The stage was missing from it, so a grid
  // filtered to one stage read as unfiltered.
  const hasActiveFilters =
    filters.status !== "all" || filters.stage !== "all" || filters.quotation !== "all"
    || filters.customerId !== "all" || filters.ownerUserId !== "all"
    || filters.marketingChannel !== "all" || filters.leadQuality !== "all"
    || !!filters.dateFrom || !!filters.dateTo
    || Object.values(filters.customFields).some(Boolean);

  const exportParams = useMemo(
    () => ({ ...params, search: list.search || undefined, sort: list.sort, order: list.order }),
    [params, list.search, list.sort, list.order],
  );

  return { ...list, filters, setFilter, setCustomFieldFilter, clearFilters, hasActiveFilters, exportParams };
}
