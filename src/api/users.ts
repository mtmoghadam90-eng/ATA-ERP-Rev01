import { ListResponse, api } from "./client";
import type { User } from "../types";

/**
 * User accounts.
 *
 * Passwords are write-only: nothing here ever returns one, so the edit form
 * cannot pre-fill the field the way it used to — it leaves it blank and only
 * calls `setPassword` when something is typed. Setting a password invalidates
 * that account's existing sessions, and so does changing its permissions or
 * deactivating it.
 */

export interface UserRow {
  id: string;
  username: string;
  fullName: string;
  role: string;
  isSystemAdmin: boolean;
  position: string | null;
  signatureImage: string | null;
  isActive: boolean;
  /** Serialized `Record<string, boolean>`; absent means unrestricted. */
  permissions: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UserReferences {
  projects: number;
  customers: number;
  proformas: number;
  activities: number;
  total: number;
}

export interface UserWriteInput {
  username?: string;
  fullName?: string;
  role?: string;
  isSystemAdmin?: boolean;
  position?: string | null;
  signatureImage?: string | null;
  isActive?: boolean;
  permissions?: unknown;
}

export interface RemoveUserResult {
  /** True when the account owned records and was disabled rather than deleted. */
  deactivated: boolean;
  message: string;
}

export const usersApi = {
  list: (query: Record<string, string | number | undefined>, signal?: AbortSignal) =>
    api.get<ListResponse<UserRow>>("/api/users", query, signal),

  get: (id: string) => api.get<{ user: UserRow }>(`/api/users/${id}`).then((r) => r.user),

  references: (id: string) =>
    api.get<{ references: UserReferences }>(`/api/users/${id}/references`).then((r) => r.references),

  create: (input: UserWriteInput & { password: string }) =>
    api.post<{ user: UserRow }>("/api/users", input).then((r) => r.user),

  update: (id: string, input: UserWriteInput) =>
    api.put<{ user: UserRow }>(`/api/users/${id}`, input).then((r) => r.user),

  /**
   * An administrator resets anyone's password; a user changes their own by
   * proving the current one. Either way the account's sessions are cut.
   */
  setPassword: (id: string, newPassword: string, currentPassword?: string) =>
    api.post<Record<string, never>>(`/api/users/${id}/password`, { newPassword, currentPassword }),

  remove: (id: string) =>
    api.delete<RemoveUserResult>(`/api/users/${id}`),
};

/* ------------------------------- adapter ------------------------------- */

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}

/** A row, in the shape the existing table markup expects. */
export function rowToUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    fullName: row.fullName,
    role: row.role as User["role"],
    isSystemAdmin: row.isSystemAdmin,
    position: row.position ?? "",
    signatureImage: row.signatureImage ?? "",
    isActive: row.isActive,
    permissions: parseJson<Record<string, boolean>>(row.permissions, {}),
    // Never sent by the server, and the form no longer reads it.
    password: "",
  } as unknown as User;
}

export function userToWriteInput(user: Partial<User>): UserWriteInput {
  return {
    username: user.username,
    fullName: user.fullName,
    role: user.role,
    isSystemAdmin: user.isSystemAdmin,
    position: user.position ?? null,
    signatureImage: user.signatureImage ?? null,
    isActive: user.isActive,
    permissions: user.permissions,
  };
}
