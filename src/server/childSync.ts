/**
 * Replacing a parent's line-item collection.
 *
 * Project items, proforma lines, purchase-order lines and product variants all
 * arrive from the client as a whole array: the user adds, edits, reorders and
 * removes rows in a form and saves once. There is no per-row identity the client
 * reliably preserves, so these are treated as an ordered value list owned by the
 * parent — delete the old rows, insert the new ones, inside the parent's
 * transaction.
 *
 * That is safe here precisely because these rows are *not* referenced from
 * elsewhere. Collections that are referenced, or that behave as an append-only
 * event stream (activities, referrals, inquiry steps, inventory transactions),
 * must NOT go through this helper — rebuilding them would break foreign keys and
 * destroy history. Those get their own endpoints.
 */

/**
 * The subset of a Prisma delegate this helper needs.
 *
 * The argument types are deliberately loose. Prisma's real delegates are deeply
 * generic (`<T extends XCreateManyArgs>(args?: SelectSubset<T, …>)`), and no
 * hand-written signature is assignable from every table's version of that. Rows
 * here are assembled from user input at runtime in any case, so the guarantees
 * that matter come from Prisma's own validation and the column definitions — not
 * from a structural type on this seam.
 */
export interface ChildDelegate {
  deleteMany(args: any): Promise<{ count: number }>;
  createMany(args: any): Promise<{ count: number }>;
}

export interface SyncChildrenOptions<T> {
  /** Prisma delegate for the child table, taken from the transaction client. */
  delegate: ChildDelegate;
  /** Foreign-key column and value, e.g. `{ projectId: id }`. */
  parentWhere: Record<string, unknown>;
  /** Rows as the client sent them. */
  rows: T[];
  /**
   * Maps one incoming row to a database row. Receives the 1-based position so
   * `lineNo` reflects the order the user arranged, which is the only ordering
   * the client conveys.
   */
  map: (row: T, lineNo: number) => Record<string, unknown> | null;
}

/**
 * Rebuilds a child collection. Returns how many rows were written.
 *
 * `map` returning null drops the row — used for the blank trailing line most of
 * these forms carry, which would otherwise be stored as an empty item.
 */
export async function syncChildren<T>(opts: SyncChildrenOptions<T>): Promise<number> {
  const { delegate, parentWhere, rows, map } = opts;

  await delegate.deleteMany({ where: parentWhere });

  const data: Record<string, unknown>[] = [];
  let lineNo = 0;
  for (const row of rows || []) {
    const mapped = map(row, lineNo + 1);
    if (!mapped) continue;
    lineNo++;
    data.push({ ...parentWhere, ...mapped, lineNo });
  }

  if (data.length === 0) return 0;
  await delegate.createMany({ data });
  return data.length;
}

/* ------------------------------ value coercion ------------------------------ */

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";

/**
 * A number from whatever the form produced: a real number, a string with
 * thousands separators, or Persian/Arabic digits. Returns `fallback` when there
 * is no number there at all — never NaN, which SQL Server would reject with an
 * unhelpful conversion error far from the cause.
 *
 * Persian punctuation has to be translated, not just stripped. `٫` (U+066B) is
 * the decimal separator, and leaving it in place turned "۱۲٫۵" into NaN and then
 * into the fallback — a weight of 12.5 stored as 0, silently. `٬` (U+066C) and
 * `،` (U+060C) are grouping marks and do go away.
 */
export function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof value !== "string") return fallback;
  const cleaned = value
    .replace(/[۰-۹]/g, (c) => String(FA_DIGITS.indexOf(c)))
    .replace(/[٠-٩]/g, (c) => String(AR_DIGITS.indexOf(c)))
    .replace(/٫/g, ".")
    .replace(/[,٬،\s]/g, "");
  if (!cleaned) return fallback;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : fallback;
}

/** Trimmed string, or null — so an empty form field stores NULL, not "". */
export function toNullableString(value: unknown, maxLength?: number): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s) return null;
  return maxLength && s.length > maxLength ? s.slice(0, maxLength) : s;
}

/** Serializes a nested object/array to its JSON column, or null when empty. */
export function toJsonColumn(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value) && value.length === 0) return null;
  if (typeof value === "object" && Object.keys(value as object).length === 0) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

/** Parses a JSON column back for the client, tolerating bad data. */
export function fromJsonColumn<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}
