/**
 * The files hanging off a project activity.
 *
 * An activity carried exactly one, in three columns. A single meeting produces
 * a catalogue, a photograph of a nameplate and a scanned letter, and the form
 * accepted one of them — so the rest went in as three separate activities, or
 * nowhere.
 *
 * The list is stored as JSON in one column, with the original three columns
 * still carrying the first file so everything already reading them — the Power
 * BI export among them — is unaffected. Reading is therefore two sources with a
 * precedence, which is exactly the kind of thing that goes wrong silently, so
 * it lives here and `test:rules` holds it.
 */

export interface ActivityAttachment {
  name: string;
  /** Human-readable, as the uploader computed it («۳۴۰ KB»). */
  size: string;
  /** A hosted `/uploads/...` path. The bytes are never stored on the record. */
  url: string;
}

/**
 * More than this on one entry is somebody using the feed as a file share.
 *
 * Not a technical limit — the point is that an activity is a note about what
 * happened, and a note with thirty files attached is a folder.
 */
export const MAX_ACTIVITY_ATTACHMENTS = 10;

const text = (value: unknown, max: number): string =>
  String(value ?? "").trim().slice(0, max);

/**
 * Whatever arrived, as a list this application will store.
 *
 * An entry with no URL is dropped: the name alone points at nothing, and
 * keeping it would put a dead link in the feed. Duplicates of the same URL are
 * collapsed, because picking the same file twice in the browser's dialog is
 * easier than not.
 */
export function normalizeAttachments(input: unknown): ActivityAttachment[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: ActivityAttachment[] = [];

  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;
    const url = text(entry.url ?? entry.content, 500);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({
      name: text(entry.name, 300) || url.split("/").pop() || "پیوست",
      size: text(entry.size, 50),
      url,
    });
    if (out.length >= MAX_ACTIVITY_ATTACHMENTS) break;
  }
  return out;
}

/**
 * The attachments of a stored row.
 *
 * The JSON column wins when it has anything in it; a row written before that
 * column existed has only the three original ones. Never both — the first entry
 * of the list *is* what those columns hold, so reading both would show the
 * first file twice.
 */
export function parseAttachments(
  json: string | null | undefined,
  legacy: { name?: string | null; size?: string | null; url?: string | null },
): ActivityAttachment[] {
  if (json) {
    try {
      const parsed = normalizeAttachments(JSON.parse(json));
      if (parsed.length > 0) return parsed;
    } catch {
      // Unparseable JSON falls through to the columns rather than throwing:
      // a broken value must not make the whole feed unreadable.
    }
  }
  return normalizeAttachments([{ name: legacy.name, size: legacy.size, url: legacy.url }]);
}

/**
 * The columns a list is written to: the JSON, plus the first entry mirrored
 * into the three original ones.
 */
export function attachmentColumns(list: ActivityAttachment[]): {
  attachments: string | null;
  attachmentName: string | null;
  attachmentSize: string | null;
  attachmentUrl: string | null;
} {
  const clean = normalizeAttachments(list);
  const first = clean[0] ?? null;
  return {
    attachments: clean.length > 0 ? JSON.stringify(clean) : null,
    attachmentName: first?.name ?? null,
    attachmentSize: first?.size ?? null,
    attachmentUrl: first?.url ?? null,
  };
}
