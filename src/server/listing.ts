/**
 * Shared contract for paginated, filtered list endpoints.
 *
 * The client used to load whole collections into memory and filter them in the
 * browser, which does not survive thousands of records. Every list endpoint now
 * takes page/pageSize/search/sort and returns only that slice plus a total.
 */

export interface ListQuery {
  /** 1-based. */
  page: number;
  pageSize: number;
  search: string;
  sort?: string;
  order: "asc" | "desc";
  /** Column filters, already restricted to the endpoint's allowlist. */
  filters: Record<string, string>;
}

export interface ListResult<T> {
  rows: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export const DEFAULT_PAGE_SIZE = 50;
/** Hard ceiling: a caller must not be able to ask for the entire table. */
export const MAX_PAGE_SIZE = 200;

const toInt = (v: unknown, fallback: number): number => {
  const n = Number(Array.isArray(v) ? v[0] : v);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
};

const toStr = (v: unknown): string => {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" ? s.trim() : "";
};

/**
 * Parses Express query params into a safe ListQuery.
 *
 * @param sortable field names the endpoint permits sorting by. Anything else is
 *   ignored — an unchecked value would be passed straight into `orderBy`.
 * @param filterable field names the endpoint permits filtering by.
 */
export function parseListQuery(
  query: Record<string, unknown>,
  sortable: readonly string[],
  filterable: readonly string[] = [],
): ListQuery {
  const page = Math.max(1, toInt(query.page, 1));
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, toInt(query.pageSize, DEFAULT_PAGE_SIZE)));

  const requestedSort = toStr(query.sort);
  const sort = sortable.includes(requestedSort) ? requestedSort : undefined;

  const order = toStr(query.order).toLowerCase() === "asc" ? "asc" : "desc";

  const filters: Record<string, string> = {};
  for (const key of filterable) {
    const value = toStr(query[key]);
    if (value && value !== "all") filters[key] = value;
  }

  return { page, pageSize, search: toStr(query.search), sort, order, filters };
}

/** Prisma `skip`/`take` for a parsed query. */
export function paginationArgs(q: ListQuery): { skip: number; take: number } {
  return { skip: (q.page - 1) * q.pageSize, take: q.pageSize };
}

export function buildResult<T>(rows: T[], total: number, q: ListQuery): ListResult<T> {
  return {
    rows,
    page: q.page,
    pageSize: q.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / q.pageSize)),
  };
}

/* ---------------------------- Persian search ---------------------------- */

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";

/**
 * Variants of a search term that should all match, because Persian text is
 * routinely typed with Arabic letters. SQL Server's default collation treats
 * "ی" and "ي" as different characters, so searching for one would silently miss
 * rows stored with the other; we search for both.
 *
 * Returns a de-duplicated list, longest-first, always containing the input.
 */
export function searchVariants(term: string): string[] {
  const base = String(term ?? "").trim();
  if (!base) return [];

  const digitsAscii = base
    .replace(/[۰-۹]/g, (d) => String(FA_DIGITS.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)));

  const persian = digitsAscii.replace(/ي/g, "ی").replace(/ك/g, "ک");
  const arabic = digitsAscii.replace(/ی/g, "ي").replace(/ک/g, "ك");

  return [...new Set([base, digitsAscii, persian, arabic])].filter(Boolean);
}

/**
 * Prisma OR clause matching `term` (in any of its Persian variants) against any
 * of `fields`. Returns undefined when there is nothing to search for, so callers
 * can spread it into a `where` without an empty-OR bug.
 */
export function searchClause(
  term: string,
  fields: readonly string[],
): { OR: Record<string, { contains: string }>[] } | undefined {
  const variants = searchVariants(term);
  if (variants.length === 0 || fields.length === 0) return undefined;

  const OR: Record<string, { contains: string }>[] = [];
  for (const field of fields) {
    for (const v of variants) {
      OR.push({ [field]: { contains: v } });
    }
  }
  return { OR };
}
