import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "./client";
import type { ModuleNote } from "../types";

/**
 * Notes attached to a document.
 *
 * These are their own table keyed by entity type and id — never a column on the
 * document — so they are never part of a document's write body. A view that
 * folds a new note into the record and saves the record is silently discarding
 * it, which is exactly what happened when these screens moved onto the API.
 */

export interface ModuleNoteRow {
  id: string;
  entityType: string;
  entityId: string;
  text: string;
  authorName: string | null;
  createdAt: string;
}

export const moduleNotesApi = {
  list: (entityType: string, entityId: string, signal?: AbortSignal) =>
    api.get<{ notes: ModuleNoteRow[] }>(`/api/notes/${entityType}/${entityId}`, undefined, signal)
      .then((r) => r.notes),

  add: (entityType: string, entityId: string, text: string) =>
    api.post<{ note: ModuleNoteRow }>(`/api/notes/${entityType}/${entityId}`, { text })
      .then((r) => r.note),

  /** Refused for a note written by someone else, unless you administer the system. */
  remove: (id: string) => api.delete<Record<string, never>>(`/api/notes/${id}`),
};

/** A row in the shape `ModuleNotesSection` renders. */
export function rowToModuleNote(row: ModuleNoteRow): ModuleNote {
  return {
    id: row.id,
    text: row.text,
    author: row.authorName ?? "",
    // The component shows this as written; the column is a real timestamp.
    createdAt: row.createdAt,
  } as ModuleNote;
}

export interface UseModuleNotesResult {
  notes: ModuleNote[];
  addNote: (text: string) => Promise<void>;
  deleteNote: (id: string) => Promise<void>;
}

/**
 * Loads and edits one document's notes.
 *
 * Pass a null id while nothing is open — a closed detail panel should not be
 * fetching. `onError` receives the server's own Persian sentence.
 */
export function useModuleNotes(
  entityType: string,
  entityId: string | null | undefined,
  onError?: (message: string) => void,
): UseModuleNotesResult {
  const [notes, setNotes] = useState<ModuleNote[]>([]);

  const load = useCallback(
    (signal?: AbortSignal) => {
      if (!entityId) {
        setNotes([]);
        return Promise.resolve();
      }
      return moduleNotesApi.list(entityType, entityId, signal)
        .then((rows) => setNotes(rows.map(rowToModuleNote)))
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          setNotes([]);
        });
    },
    [entityType, entityId],
  );

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const report = (err: unknown, fallback: string) =>
    onError?.(err instanceof ApiError ? err.message : fallback);

  const addNote = useCallback(async (text: string) => {
    if (!entityId) return;
    try {
      await moduleNotesApi.add(entityType, entityId, text);
      await load();
    } catch (err) {
      report(err, "ثبت یادداشت با خطا مواجه شد.");
    }
    // `report` closes over onError, which callers commonly pass inline.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType, entityId, load]);

  const deleteNote = useCallback(async (id: string) => {
    try {
      await moduleNotesApi.remove(id);
      await load();
    } catch (err) {
      report(err, "حذف یادداشت با خطا مواجه شد.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  return { notes, addNote, deleteNote };
}
