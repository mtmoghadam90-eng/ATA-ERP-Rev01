/**
 * A supplier's files — the catalogue, the agency letter, the price list, the
 * company registration — each with a line saying what it is.
 *
 * The description is the point of it, not a nicety: a supplier's folder fills
 * with files named «scan0012.pdf» and «IMG_4431.jpg», and the person reading it
 * a year later cannot tell the agency certificate from last year's price list
 * without opening every one. So each file carries the sentence its uploader
 * typed, and the form asks for it beside the file.
 *
 * One JSON column rather than a table, for the reason a product's documents
 * are one: a short list, never queried across suppliers, read with the record.
 * The bytes are never here — `/api/upload` writes the file and the record keeps
 * the `/uploads/...` path it answered with.
 */

export interface SupplierDocument {
  name: string;
  /** Human-readable, as `formatFileSize` wrote it. */
  size: string;
  /** A hosted `/uploads/...` path. */
  url: string;
  /** What this file is, in the uploader's words. Optional, but asked for. */
  description: string;
}

/** More than this on one supplier is a file share, not a record. */
export const MAX_SUPPLIER_DOCUMENTS = 30;

const text = (value: unknown, max: number): string =>
  String(value ?? "").trim().slice(0, max);

/**
 * Whatever arrived, as the list this application stores.
 *
 * An entry with no URL is dropped — the name alone points at nothing. The same
 * URL twice is one entry, keeping the first description. Everything is
 * trimmed to the column's sense of size so a pasted essay cannot become a
 * description.
 */
export function normalizeSupplierDocuments(input: unknown): SupplierDocument[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: SupplierDocument[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const url = text(r.url, 500);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({
      name: text(r.name, 300) || url.split("/").pop() || "فایل",
      size: text(r.size, 40),
      url,
      description: text(r.description, 500),
    });
    if (out.length >= MAX_SUPPLIER_DOCUMENTS) break;
  }
  return out;
}

/** The stored column, read back. Anything unreadable is an empty list. */
export function parseSupplierDocuments(raw: unknown): SupplierDocument[] {
  if (Array.isArray(raw)) return normalizeSupplierDocuments(raw);
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    return normalizeSupplierDocuments(JSON.parse(raw));
  } catch {
    return [];
  }
}
