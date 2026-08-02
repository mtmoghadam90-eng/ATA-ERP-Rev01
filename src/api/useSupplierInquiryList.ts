import { useMemo, useState } from "react";
import { useList } from "./useList";
import { InquiryRow } from "./supplierInquiries";

/**
 * The inquiries screen's query state.
 *
 * The page size is small because a row here is a card carrying every line and
 * the whole timeline, and they are laid out in a horizontal scroller — a
 * hundred of them is neither readable nor cheap to send.
 */

export interface InquiryListFilters {
  /** A project id, or "all". */
  projectId: string;
  /** "all" | "true" | "false" */
  isWinner: string;
}

const EMPTY_FILTERS: InquiryListFilters = { projectId: "all", isWinner: "all" };

export function useSupplierInquiryList() {
  const [filters, setFilters] = useState<InquiryListFilters>(EMPTY_FILTERS);

  const params = useMemo(
    () => ({
      projectId: filters.projectId === "all" ? undefined : filters.projectId,
      isWinner: filters.isWinner === "all" ? undefined : filters.isWinner,
    }),
    [filters],
  );

  const list = useList<InquiryRow>({
    path: "/api/supplier-inquiries",
    pageSize: 24,
    sort: "creationDate",
    order: "desc",
    params,
  });

  const setFilter = <K extends keyof InquiryListFilters>(key: K, value: InquiryListFilters[K]) =>
    setFilters((current) => ({ ...current, [key]: value }));

  const hasActiveFilters = filters.isWinner !== "all" || !!list.search;

  return { ...list, filters, setFilter, hasActiveFilters };
}
