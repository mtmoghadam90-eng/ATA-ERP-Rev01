import { useMemo, useState } from "react";
import { useList } from "./useList";
import { AuditLogRow } from "./auditLogs";

/** The audit-log panel's query state. */

export interface AuditLogFilters {
  module: string;
  action: string;
}

const EMPTY_FILTERS: AuditLogFilters = { module: "all", action: "all" };

export function useAuditLogList() {
  const [filters, setFilters] = useState<AuditLogFilters>(EMPTY_FILTERS);

  const params = useMemo(
    () => ({
      module: filters.module === "all" ? undefined : filters.module,
      action: filters.action === "all" ? undefined : filters.action,
    }),
    [filters],
  );

  const list = useList<AuditLogRow>({
    path: "/api/audit-logs",
    pageSize: 50,
    sort: "occurredAt",
    order: "desc",
    params,
  });

  const setFilter = <K extends keyof AuditLogFilters>(key: K, value: AuditLogFilters[K]) =>
    setFilters((current) => ({ ...current, [key]: value }));

  const clearFilters = () => setFilters(EMPTY_FILTERS);
  const hasActiveFilters =
    filters.module !== "all" || filters.action !== "all" || !!list.search;

  return { ...list, filters, setFilter, clearFilters, hasActiveFilters };
}
