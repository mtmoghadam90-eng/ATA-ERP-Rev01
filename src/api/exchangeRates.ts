import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "./client";
import type { ExchangeRate } from "../types";

/**
 * Currency rates.
 *
 * A short, bounded list that half the app prices documents against, so it is
 * fetched once and shared rather than paged. Refreshing is a single server call
 * that scrapes and stores together — the client used to scrape through one
 * endpoint and write the answer back through another, so every browser wrote
 * its own copy of the same numbers.
 */

export interface ExchangeRateRow {
  id: string;
  currency: string;
  name: string;
  rateToRial: string;
  lastUpdated: string;
}

/** What the server's own hourly refresh has been doing. */
export interface RateRefreshReport {
  lastSuccessAt: number;
  lastFailureAt: number;
  lastError: string | null;
  failedCurrencies: string[];
  running: boolean;
  freshForMs: number;
}

export interface RefreshResult {
  updated: number;
  /** Currencies that could not be read, and were therefore left untouched. */
  failedCurrencies: string[];
  rates: ExchangeRateRow[];
}

export const exchangeRatesApi = {
  list: (signal?: AbortSignal) =>
    api.get<{ rates: ExchangeRateRow[]; refresh?: RateRefreshReport }>(
      "/api/exchange-rates", undefined, signal),

  /** Keyed on the currency code, not the row id. */
  update: (currency: string, rateToRial: number, name?: string) =>
    api.put<{ rate: ExchangeRateRow }>(`/api/exchange-rates/${currency}`, { rateToRial, name })
      .then((r) => r.rate),

  refresh: () => api.post<RefreshResult>("/api/exchange-rates/refresh", {}),
};

/** A row, in the shape the views expect. */
export function rowToExchangeRate(row: ExchangeRateRow): ExchangeRate {
  return {
    id: row.id,
    currency: row.currency,
    name: row.name,
    // The column is rateToRial; the client type has always spelled it RIYAL.
    rateToRIYAL: Number(row.rateToRial),
    lastUpdated: row.lastUpdated,
  } as ExchangeRate;
}

export interface UseExchangeRatesResult {
  rates: ExchangeRate[];
  /** Undefined until the first answer, and from an older server. */
  refresh: RateRefreshReport | undefined;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

/**
 * The rates, loaded once per screen that needs them.
 *
 * Not cached at module scope like the user directory: these change during a
 * session, and a stale rate prices a document wrongly.
 */
export function useExchangeRates(): UseExchangeRatesResult {
  const [rates, setRates] = useState<ExchangeRate[]>([]);
  const [refresh, setRefresh] = useState<RateRefreshReport | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const answer = await exchangeRatesApi.list(signal);
      setRates(answer.rates.map(rowToExchangeRate));
      setRefresh(answer.refresh);
      setError(null);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof ApiError ? err.message : "دریافت نرخ ارز با خطا مواجه شد.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const reload = useCallback(() => load(), [load]);

  return { rates, refresh, loading, error, reload };
}
