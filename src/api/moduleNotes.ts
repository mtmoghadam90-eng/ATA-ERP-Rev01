import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "./client";
import type { ModuleNote } from "../types";
import type { ActivityAttachment } from "../utils/attachments";

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
  /** Null on every row written before the column existed. */
  authorUserId: string | null;
  attachments: ActivityAttachment[];
  createdAt: string;
  /** When it was last corrected; null if never. */
  editedAt?: string | null;
  /** Whether this reader may correct it — the same rule as `canDelete`. */
  canEdit?: boolean;
  /**
   * Whether **this** reader may remove it.
   *
   * Answered by the server, because the rule falls back to comparing the
   * author's name for rows written before `authorUserId` and a browser does not
   * have the directory. Absent — an older server — reads as *true*, which keeps
   * the button where it has always been and lets the refusal explain itself,
   * rather than hiding a control somebody used yesterday.
   */
  canDelete?: boolean;
}

export const moduleNotesApi = {
  list: (entityType: string, entityId: string, signal?: AbortSignal) =>
    api.get<{ notes: ModuleNoteRow[] }>(`/api/notes/${entityType}/${entityId}`, undefined, signal)
      .then((r) => r.notes),

  add: (entityType: string, entityId: string, text: string, attachments?: ActivityAttachment[]) =>
    api.post<{ note: ModuleNoteRow }>(`/api/notes/${entityType}/${entityId}`, {
      text, attachments: attachments ?? [],
    }).then((r) => r.note),

  /** The whole new text and file list; refused like `remove` for anybody else's note. */
  update: (id: string, text: string, attachments: ActivityAttachment[]) =>
    api.put<{ note: ModuleNoteRow }>(`/api/notes/${id}`, { text, attachments }).then((r) => r.note),

  /** Refused for a note written by someone else, unless you administer the system. */
  remove: (id: string) => api.delete<Record<string, never>>(`/api/notes/${id}`),
};

/** A row in the shape `ModuleNotesSection` renders. */
export function rowToModuleNote(row: ModuleNoteRow): ModuleNote {
  return {
    id: row.id,
    text: row.text,
    author: row.authorName ?? "",
    /*
     * **A real instant, formatted where it is drawn.** The column is a
     * `DateTime`, so it arrives as an ISO string — and the card printed it
     * exactly as it came, which is how «2026-09-16T10:23:45.000Z» came to be
     * the timestamp on a Persian screen. It is folded to Shamsi in the
     * component with `formatDateTimeToShamsi`, which reads the *local* clock:
     * both this server and the people reading it are on Tehran time, and
     * `toShamsiStr` on the raw string would take the date out of the UTC
     * prefix and put a note written after 20:30 on the previous day.
     */
    createdAt: row.createdAt,
    attachments: row.attachments ?? [],
    canDelete: row.canDelete !== false,
    // Absent (an older server) follows the delete answer, the same rule.
    canEdit: row.canEdit ?? row.canDelete !== false,
    editedAt: row.editedAt ?? null,
  } as ModuleNote;
}

export interface UseModuleNotesResult {
  notes: ModuleNote[];
  /** Resolves true when the note was stored, false when it was refused (already reported). */
  addNote: (text: string, attachments?: ActivityAttachment[]) => Promise<boolean>;
  /** Resolves true when the correction was stored, false when refused (already reported). */
  updateNote: (id: string, text: string, attachments: ActivityAttachment[]) => Promise<boolean>;
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

  const addNote = useCallback(async (text: string, attachments?: ActivityAttachment[]) => {
    if (!entityId) return false;
    try {
      await moduleNotesApi.add(entityType, entityId, text, attachments);
      await load();
      return true;
    } catch (err) {
      report(err, "ثبت یادداشت با خطا مواجه شد.");
      return false;
    }
    // `report` closes over onError, which callers commonly pass inline.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType, entityId, load]);

  const updateNote = useCallback(async (id: string, text: string, attachments: ActivityAttachment[]) => {
    try {
      await moduleNotesApi.update(id, text, attachments);
      await load();
      return true;
    } catch (err) {
      report(err, "ویرایش یادداشت با خطا مواجه شد.");
      return false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  const deleteNote = useCallback(async (id: string) => {
    try {
      await moduleNotesApi.remove(id);
      await load();
    } catch (err) {
      report(err, "حذف یادداشت با خطا مواجه شد.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  return { notes, addNote, updateNote, deleteNote };
}
