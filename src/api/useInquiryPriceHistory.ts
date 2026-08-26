import { useMemo, useState } from "react";
import { useList } from "./useList";
import { PriceHistoryRow, PriceHistorySummary } from "./supplierInquiries";

/**
 * "What did I last pay for this?" — the query state behind the history tab.
 *
 * The rows are inquiry *lines*, so this is a different endpoint from the cards
 * above it rather than a filter on them. It stays disabled until the tab is
 * opened: the screen's other two tabs have no use for it, and a list hook fetches
 * on mount.
 */

export interface PriceHistoryFilters {
  /** A catalogue product id, or "all". */
  productId: string;
  /** A SKU id under that product, or "all". */
  variantId: string;
  /** "all" | "confirmed" | "winner" */
  outcome: string;
}

const EMPTY_FILTERS: PriceHistoryFilters = { productId: "all", variantId: "all", outcome: "all" };

export function useInquiryPriceHistory(enabled: boolean) {
  const [filters, setFilters] = useState<PriceHistoryFilters>(EMPTY_FILTERS);

  const params = useMemo(
    () => ({
      productId: filters.productId === "all" ? undefined : filters.productId,
      variantId: filters.variantId === "all" ? undefined : filters.variantId,
      outcome: filters.outcome === "all" ? undefined : filters.outcome,
    }),
    [filters],
  );

  const list = useList<PriceHistoryRow>({
    path: "/api/supplier-inquiries/price-history",
    pageSize: 25,
    sort: "creationDate",
    order: "desc",
    params,
    enabled,
  });

  const setFilter = <K extends keyof PriceHistoryFilters>(key: K, value: PriceHistoryFilters[K]) =>
    setFilters((current) => {
      // A SKU belongs to a product, so changing the product cannot leave the
      // previous product's SKU in the query — that pair matches nothing and
      // reads as "no prices ever obtained".
      if (key === "productId") return { ...current, productId: value as string, variantId: "all" };
      return { ...current, [key]: value };
    });

  const reset = () => setFilters(EMPTY_FILTERS);

  const summary = (list.meta.summary ?? null) as PriceHistorySummary | null;

  const hasActiveFilters =
    filters.productId !== "all" || filters.outcome !== "all" || !!list.search;

  return { ...list, filters, setFilter, reset, summary, hasActiveFilters };
}
