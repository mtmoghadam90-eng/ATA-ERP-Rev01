/**
 * The catalogue, the datasheet and the certificates of one product.
 *
 * A product already carried `images`, which answers «what does it look like»
 * and nothing else. What a sales engineer actually reaches for when quoting is
 * the manufacturer's catalogue and the item's datasheet — and those had nowhere
 * to live, so they were kept on somebody's desktop, attached to whichever
 * project happened to need them first, or not kept at all.
 *
 * Stored as one JSON column rather than a table, for the same reason an
 * activity's attachments are: it is a short list, it is never queried across
 * products, and a table would be a join on every read of the catalogue.
 *
 * The bytes are never here — `/api/upload` writes the file and the record keeps
 * the `/uploads/...` path it answered with.
 */

/**
 * What a file *is*, which is not the same question as what it is called.
 *
 * A person renames a file and moves it between products; the kind is what the
 * screen groups by and what tells a reader whether they are looking at a
 * four-page datasheet or a 60-page catalogue. Same rule as a project's
 * `manualDocuments[].kind`.
 */
export const PRODUCT_DOCUMENT_KINDS = ["CATALOGUE", "DATASHEET", "CERTIFICATE", "OTHER"] as const;
export type ProductDocumentKind = (typeof PRODUCT_DOCUMENT_KINDS)[number];

export const PRODUCT_DOCUMENT_KIND_LABELS: Record<ProductDocumentKind, string> = {
  CATALOGUE: "کاتالوگ",
  DATASHEET: "دیتاشیت",
  CERTIFICATE: "گواهینامه",
  OTHER: "سایر مدارک",
};

export interface ProductDocument {
  name: string;
  /** Human-readable, as the uploader computed it («۱٫۲ MB»). */
  size: string;
  /** A hosted `/uploads/...` path. */
  url: string;
  kind: ProductDocumentKind;
}

/**
 * More than this on one product is somebody using the catalogue as a file
 * share. Not a technical limit — the same judgement `MAX_ACTIVITY_ATTACHMENTS`
 * makes.
 */
export const MAX_PRODUCT_DOCUMENTS = 20;

const text = (value: unknown, max: number): string =>
  String(value ?? "").trim().slice(0, max);

/**
 * An unknown kind becomes `OTHER` rather than being dropped.
 *
 * The list above may gain an entry and lose one; a file filed under a kind that
 * no longer exists is still the file somebody uploaded, and hiding it would be
 * the worse answer by a distance.
 */
export function documentKindOf(value: unknown): ProductDocumentKind {
  const raw = String(value ?? "").trim().toUpperCase();
  return (PRODUCT_DOCUMENT_KINDS as readonly string[]).includes(raw)
    ? (raw as ProductDocumentKind)
    : "OTHER";
}

/**
 * Whatever arrived, as the list this application will store.
 *
 * An entry with no URL is dropped — the name alone points at nothing, and
 * keeping it would put a dead link on the product. Duplicates of the same URL
 * are collapsed, because picking the same file twice in the browser's dialog is
 * easier than not.
 */
export function normalizeProductDocuments(input: unknown): ProductDocument[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: ProductDocument[] = [];

  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;
    const url = text(entry.url ?? entry.content, 500);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({
      name: text(entry.name, 300) || url.split("/").pop() || "سند",
      size: text(entry.size, 50),
      url,
      kind: documentKindOf(entry.kind),
    });
    if (out.length >= MAX_PRODUCT_DOCUMENTS) break;
  }
  return out;
}

/** The stored column, as a list. A malformed one reads as empty, never throws. */
export function parseProductDocuments(json: unknown): ProductDocument[] {
  if (Array.isArray(json)) return normalizeProductDocuments(json);
  if (typeof json !== "string" || !json.trim()) return [];
  try {
    return normalizeProductDocuments(JSON.parse(json));
  } catch {
    return [];
  }
}

/** Grouped for the screen, in the order the kinds are declared. */
export function documentsByKind(
  documents: ProductDocument[],
): { kind: ProductDocumentKind; label: string; files: ProductDocument[] }[] {
  return PRODUCT_DOCUMENT_KINDS
    .map((kind) => ({
      kind,
      label: PRODUCT_DOCUMENT_KIND_LABELS[kind],
      files: documents.filter((d) => d.kind === kind),
    }))
    .filter((group) => group.files.length > 0);
}
