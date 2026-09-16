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

/* ------------------- the same shape, with no legacy column ---------------- */

/**
 * A list stored in one JSON column and nowhere else.
 *
 * `parseAttachments` above has to reconcile the JSON against three older
 * columns, because an activity carried one file before it carried a list. A
 * record whose attachments were a list from the first day has no such second
 * source, so it needs the parse and not the precedence — written out at the
 * call site that would be a bare `try`/`catch` per reader, and the one nobody
 * wrapped is the one that makes a whole screen unreadable on a malformed value.
 */
export function parseAttachmentList(json: string | null | undefined): ActivityAttachment[] {
  if (!json) return [];
  try {
    return normalizeAttachments(JSON.parse(json));
  } catch {
    // A broken value is no attachments rather than a thrown request: the note's
    // own words are the part somebody is reading.
    return [];
  }
}

/** The single column such a list is written to. */
export const attachmentListColumn = (list: ActivityAttachment[]): string | null => {
  const clean = normalizeAttachments(list);
  return clean.length > 0 ? JSON.stringify(clean) : null;
};

/**
 * How large a file is, in the words `ActivityAttachment.size` holds.
 *
 * The figure is *stored* on the row rather than computed when it is drawn,
 * because the bytes live under `/uploads` and asking their size back would be a
 * request per attachment per render. That makes this a one-line expression at
 * the moment of upload — and it was written out eight times across the screens
 * that upload, each rounding differently, so the same file reads «۳۴۰.۳ KB» on
 * one screen and «۳۴۰ KB» on the next. One rule, in the module that owns the
 * shape; the eight older copies are left where they are rather than swept in
 * with an unrelated change.
 */
export function formatFileSize(bytes: number): string {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  // Never «0.4 KB» for a small file: a rounded-down zero reads as a failed
  // upload, so anything short of a kilobyte is reported as one.
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

/* ---------------------- the same shape, for an offer --------------------- */

/**
 * A supplier's technical or financial offer, which is rarely one file.
 *
 * A quotation arrives as a covering letter, a datasheet and a price list, and
 * the form accepted one of each — so the other two went in as a second inquiry
 * or nowhere. Stored exactly like an activity's attachments: a JSON list, with
 * the original `technicalOfferUrl` / `financialOfferUrl` column still carrying
 * the **first** entry so the grid's link, the download button and the Power BI
 * export are unaffected.
 */
export function parseOfferFiles(
  json: string | null | undefined,
  legacyUrl: string | null | undefined,
): ActivityAttachment[] {
  if (json) {
    try {
      const parsed = normalizeAttachments(JSON.parse(json));
      if (parsed.length > 0) return parsed;
    } catch {
      // A broken value falls through to the column rather than throwing.
    }
  }
  return normalizeAttachments([{ url: legacyUrl }]);
}

/** The two columns a list of offer files is written to. */
export function offerFileColumns(list: ActivityAttachment[]): {
  files: string | null;
  url: string | null;
} {
  const clean = normalizeAttachments(list);
  return {
    files: clean.length > 0 ? JSON.stringify(clean) : null,
    url: clean[0]?.url ?? null,
  };
}
