import { useMemo, useState } from "react";
import { useList } from "./useList";
import { UserRow } from "./users";

/** The user-management grid's query state. */

export interface UserListFilters {
  role: string;
  /** "all" | "true" | "false" */
  isActive: string;
}

const EMPTY_FILTERS: UserListFilters = { role: "all", isActive: "all" };

export function useUserList() {
  const [filters, setFilters] = useState<UserListFilters>(EMPTY_FILTERS);

  const params = useMemo(
    () => ({
      role: filters.role === "all" ? undefined : filters.role,
      isActive: filters.isActive === "all" ? undefined : filters.isActive,
    }),
    [filters],
  );

  const list = useList<UserRow>({
    path: "/api/users",
    pageSize: 50,
    sort: "fullName",
    order: "asc",
    params,
  });

  const setFilter = <K extends keyof UserListFilters>(key: K, value: UserListFilters[K]) =>
    setFilters((current) => ({ ...current, [key]: value }));

  const clearFilters = () => setFilters(EMPTY_FILTERS);
  const hasActiveFilters = filters.role !== "all" || filters.isActive !== "all";

  return { ...list, filters, setFilter, clearFilters, hasActiveFilters };
}
