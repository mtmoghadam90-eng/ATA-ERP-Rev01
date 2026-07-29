import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, ListResponse, api } from "./client";

/**
 * Type-ahead search for a "choose a record" field.
 *
 * The old dropdowns rendered every customer, product or project the store had
 * loaded. That is the same problem as the grids, just less visible: at a few
 * thousand records the list is both enormous and useless to scroll. Here the
 * server does the searching and only a handful of matches come back.
 *
 * Separate from `useList` on purpose — a picker has no paging, no sorting and no
 * URL state, and it needs to resolve the value it already holds even when that
 * record is not in the current matches.
 */

export interface EntitySearchOptions<T> {
  /** Endpoint path, e.g. "/api/customers". */
  path: string;
  /** How many suggestions to show. */
  limit?: number;
  /** Extra filters, e.g. `{ status: "فعال" }`. */
  params?: Record<string, string | number | undefined>;
  /** Currently selected id, resolved so the field can show its label. */
  selectedId?: string | null;
  /** Pulls the display text out of a row. */
  getLabel: (row: T) => string;
}

export interface EntitySearchResult<T> {
  term: string;
  setTerm: (value: string) => void;
  matches: T[];
  loading: boolean;
  error: string | null;
  /** The selected record, once resolved. Null while loading or if it is gone. */
  selected: T | null;
  selectedLabel: string;
}

export function useEntitySearch<T extends { id: string }>(
  options: EntitySearchOptions<T>,
): EntitySearchResult<T> {
  const { path, limit = 20, params, selectedId, getLabel } = options;

  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");
  const [matches, setMatches] = useState<T[]>([]);
  const [selected, setSelected] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const paramsKey = JSON.stringify(params ?? {});
  const seq = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(term), 250);
    return () => clearTimeout(timer);
  }, [term]);

  /* Suggestions for what is being typed. */
  useEffect(() => {
    const mine = ++seq.current;
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    api
      .get<ListResponse<T>>(
        path,
        { pageSize: limit, search: debounced || undefined, ...(JSON.parse(paramsKey) as object) },
        controller.signal,
      )
      .then((data) => {
        if (mine !== seq.current) return;
        setMatches(data.rows);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (mine !== seq.current) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof ApiError ? err.message : "جست‌وجو با خطا مواجه شد.");
        setMatches([]);
        setLoading(false);
      });

    return () => controller.abort();
  }, [path, limit, debounced, paramsKey]);

  /* Resolve the current value.
     A stored id has to render as a name even when the record is not among the
     current matches — which is the normal case when a form first opens. */
  useEffect(() => {
    if (!selectedId) {
      setSelected(null);
      return;
    }
    const local = matches.find((row) => row.id === selectedId);
    if (local) {
      setSelected(local);
      return;
    }
    if (selected?.id === selectedId) return;

    let cancelled = false;
    api
      .get<Record<string, T>>(`${path}/${selectedId}`)
      .then((data) => {
        if (cancelled) return;
        // Endpoints wrap the record under its own name (customer, project…).
        const record = Object.values(data).find((v) => v && typeof v === "object" && "id" in v);
        setSelected((record as T) ?? null);
      })
      .catch(() => {
        // A record that was deleted should leave the field blank, not break it.
        if (!cancelled) setSelected(null);
      });

    return () => { cancelled = true; };
  }, [selectedId, matches, path, selected]);

  const setTermStable = useCallback((value: string) => setTerm(value), []);

  return {
    term,
    setTerm: setTermStable,
    matches,
    loading,
    error,
    selected,
    selectedLabel: selected ? getLabel(selected) : "",
  };
}
