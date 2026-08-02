import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, ListResponse, MAX_PAGE_SIZE, api } from "./client";

/**
 * Paginated, server-filtered list state.
 *
 * This replaces the old model where a view held every record and filtered it in
 * the browser. Search, sort, filters and paging are now parameters to a query,
 * so what arrives is one page regardless of how large the table has grown.
 *
 * Two things it has to get right that a naive fetch-on-change does not:
 *
 *  - **Out-of-order responses.** Typing quickly starts several requests, and a
 *    slower earlier one can land after a faster later one, leaving the grid
 *    showing results for a search the user has already moved past. Each request
 *    carries a sequence number and only the newest is allowed to write state.
 *  - **A page that no longer exists.** Deleting the last row of the last page,
 *    or narrowing a filter, can leave `page` past the end — which returns
 *    nothing and looks like data loss. The hook steps back when that happens.
 */

export interface UseListOptions {
  /** Endpoint path, e.g. "/api/customers". */
  path: string;
  pageSize?: number;
  /** Column to sort by. Must be one the endpoint allows. */
  sort?: string;
  order?: "asc" | "desc";
  /** Extra query parameters — column filters, date ranges, flags. */
  params?: Record<string, string | number | boolean | undefined>;
  /** Milliseconds to wait after typing stops before querying. */
  searchDebounceMs?: number;
  /** Set false to hold off until something is ready (a dependency, a tab). */
  enabled?: boolean;
}

export interface UseListResult<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  loading: boolean;
  /** Persian message from the server, or null. */
  error: string | null;
  search: string;
  setSearch: (value: string) => void;
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
  sort: string | undefined;
  order: "asc" | "desc";
  /** Sets the sort column, flipping direction when it is already selected. */
  toggleSort: (column: string) => void;
  /** Re-runs the current query — call after a create, edit or delete. */
  refresh: () => void;
  /** True before the first response, so a view can tell empty from not-yet-loaded. */
  initialLoading: boolean;
  /**
   * Anything the endpoint returned beyond the page itself.
   *
   * Some lists carry a figure that spans every match rather than the page —
   * a total the page cannot be summed to. It rides along with the response it
   * was computed for, so it can never disagree with the rows on screen.
   */
  meta: Record<string, unknown>;
}

export function useList<T>(options: UseListOptions): UseListResult<T> {
  const {
    path,
    pageSize: initialPageSize = 50,
    sort: initialSort,
    order: initialOrder = "desc",
    params,
    searchDebounceMs = 300,
    enabled = true,
  } = options;

  const [rows, setRows] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeState] = useState(Math.min(initialPageSize, MAX_PAGE_SIZE));
  const [search, setSearchState] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sort, setSort] = useState<string | undefined>(initialSort);
  const [order, setOrder] = useState<"asc" | "desc">(initialOrder);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [meta, setMeta] = useState<Record<string, unknown>>({});

  // Serialized so a caller passing a fresh object literal every render does not
  // re-trigger the effect on every render.
  const paramsKey = JSON.stringify(params ?? {});

  /* Debounce the search term. */
  useEffect(() => {
    if (search === debouncedSearch) return;
    const timer = setTimeout(() => setDebouncedSearch(search), searchDebounceMs);
    return () => clearTimeout(timer);
  }, [search, debouncedSearch, searchDebounceMs]);

  /* Any change to what is being asked for returns to the first page — staying on
     page 7 of a previous search shows an empty grid for no visible reason. */
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, paramsKey, pageSize, sort, order, path]);

  const requestSeq = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const seq = ++requestSeq.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);

    api
      .get<ListResponse<T>>(
        path,
        {
          page,
          pageSize,
          search: debouncedSearch || undefined,
          sort,
          order,
          ...(JSON.parse(paramsKey) as Record<string, string | number | boolean | undefined>),
        },
        controller.signal,
      )
      .then((data) => {
        // A stale response must not overwrite a newer one.
        if (seq !== requestSeq.current) return;

        setRows(data.rows);
        setTotal(data.total);
        setTotalPages(data.totalPages);
        setLoading(false);
        setInitialLoading(false);

        const { rows: _r, total: _t, totalPages: _tp, page: _p, pageSize: _ps, ...rest } =
          data as unknown as Record<string, unknown>;
        setMeta(rest);

        // Past the end — step back rather than showing an empty grid.
        if (data.rows.length === 0 && data.total > 0 && page > data.totalPages) {
          setPage(data.totalPages);
        }
      })
      .catch((err: unknown) => {
        if (seq !== requestSeq.current) return;
        // An aborted request was superseded on purpose, not a failure.
        if (err instanceof DOMException && err.name === "AbortError") return;

        setError(err instanceof ApiError ? err.message : "دریافت اطلاعات با خطا مواجه شد.");
        setRows([]);
        setTotal(0);
        setLoading(false);
        setInitialLoading(false);
      });

    return () => controller.abort();
  }, [path, page, pageSize, debouncedSearch, sort, order, paramsKey, reloadToken, enabled]);

  const setSearch = useCallback((value: string) => setSearchState(value), []);

  const setPageSize = useCallback((size: number) => {
    setPageSizeState(Math.min(Math.max(1, size), MAX_PAGE_SIZE));
  }, []);

  const toggleSort = useCallback((column: string) => {
    setSort((current) => {
      if (current === column) {
        setOrder((o) => (o === "asc" ? "desc" : "asc"));
        return current;
      }
      setOrder("asc");
      return column;
    });
  }, []);

  const refresh = useCallback(() => setReloadToken((n) => n + 1), []);

  return useMemo(
    () => ({
      rows, total, page, pageSize, totalPages,
      loading, initialLoading, error, meta,
      search, setSearch, setPage, setPageSize,
      sort, order, toggleSort, refresh,
    }),
    [rows, total, page, pageSize, totalPages, loading, initialLoading, error, meta,
      search, setSearch, setPage, setPageSize, sort, order, toggleSort, refresh],
  );
}
