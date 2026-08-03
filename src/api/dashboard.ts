import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "./client";

/**
 * The front page's figures.
 *
 * One request, everything counted in SQL. This screen used to be handed eight
 * whole collections so it could reduce them to about a dozen numbers, which is
 * the single clearest reason the app could not grow.
 */

export interface DashboardSummary {
  counts: {
    customers: number;
    products: number;
    projects: number;
    lowStock: number;
    activePurchaseOrders: number;
  };
  revenue: {
    wonRial: string;
    activeRial: string;
    activeCount: number;
    winRatePercent: number;
    wonCount: number;
    totalCount: number;
  };
  projectsByStatus: { status: string; count: number }[];
  revenueByCategory: { category: string; rial: string }[];
  conversionByCategory: { category: string; won: number; total: number; percent: number }[];
}

const EMPTY: DashboardSummary = {
  counts: { customers: 0, products: 0, projects: 0, lowStock: 0, activePurchaseOrders: 0 },
  revenue: { wonRial: "0", activeRial: "0", activeCount: 0, winRatePercent: 0, wonCount: 0, totalCount: 0 },
  projectsByStatus: [],
  revenueByCategory: [],
  conversionByCategory: [],
};

export const dashboardApi = {
  summary: (signal?: AbortSignal) =>
    api.get<{ summary: DashboardSummary }>("/api/dashboard", undefined, signal).then((r) => r.summary),
};

export interface UseDashboardResult {
  summary: DashboardSummary;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

export function useDashboard(): UseDashboardResult {
  const [summary, setSummary] = useState<DashboardSummary>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      setSummary(await dashboardApi.summary(signal));
      setError(null);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof ApiError ? err.message : "دریافت اطلاعات پیشخوان با خطا مواجه شد.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  return { summary, loading, error, reload: useCallback(() => load(), [load]) };
}
