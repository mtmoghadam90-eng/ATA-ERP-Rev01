import { jalaliToGregorian, gregorianToJalali } from "../dateUtils";

/**
 * Jalali <-> DATE column conversion for the relational store.
 *
 * Every business date is stored twice (see prisma/schema.prisma): `xDate` as a
 * real SQL `DATE` so ranges, sorting and Power BI time intelligence work, and
 * `xDateJalali` as the Shamsi string exactly as the user typed it. This module
 * is the only place that maps between the two, so the pair can never drift.
 *
 * The critical detail is the timezone. A `DATE` column has no time and no zone,
 * but a JS `Date` always does — and Iran is UTC+03:30, so building a date from
 * local midnight would serialize as 20:30 the *previous* day and store the wrong
 * day. Every Date produced here is therefore UTC midnight (`Date.UTC`), and
 * every Date read back is decomposed with the UTC getters.
 */

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";

/** Persian/Arabic digits to ASCII. Users type all three. */
export function toAsciiDigits(value: string): string {
  return String(value ?? "")
    .replace(/[۰-۹]/g, (c) => String(FA_DIGITS.indexOf(c)))
    .replace(/[٠-٩]/g, (c) => String(AR_DIGITS.indexOf(c)));
}

/**
 * Plausible Shamsi years for this app: roughly 1821–2221 CE. A four-digit year
 * outside this band is a Gregorian date wearing the same shape, which is the
 * distinction `parseDateParts` turns on.
 */
const JALALI_YEAR_MIN = 1200;
const JALALI_YEAR_MAX = 1600;

/**
 * Splits a date string into `y/m/d` plus which calendar it is in.
 *
 * Both calendars are written `YYYY/MM/DD` here, so the year decides. This
 * matters: "2026-07-28" read as Shamsi becomes 2647 CE — a date 621 years out,
 * stored without complaint. ISO strings do reach this code (the legacy JSON
 * store holds some, and Excel imports produce them), so they are converted
 * rather than rejected.
 */
function parseDateParts(
  value: unknown,
): { y: number; m: number; d: number; calendar: "jalali" | "gregorian" } | null {
  if (typeof value !== "string") return null;
  const text = toAsciiDigits(value.trim());

  const m = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (!m) return null;

  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;

  const calendar = y >= JALALI_YEAR_MIN && y <= JALALI_YEAR_MAX ? "jalali" : "gregorian";
  // A Gregorian month never has 31 days in Feb/Apr/Jun/Sep/Nov; leave that to
  // Date.UTC, which normalizes, and only reject what is plainly impossible.
  return { y, m: mo, d, calendar };
}

/** Splits a Shamsi string into its parts, or null when it isn't Shamsi. */
function parseJalaliParts(value: unknown): [number, number, number] | null {
  const parts = parseDateParts(value);
  if (!parts) return null;
  if (parts.calendar === "jalali") return [parts.y, parts.m, parts.d];
  // Gregorian input: express it in Shamsi so the pair stays consistent.
  return gregorianToJalali(parts.y, parts.m, parts.d);
}

/**
 * Date string -> `DATE` value, as UTC midnight.
 *
 * Accepts Shamsi (the normal case) and Gregorian/ISO, distinguished by the year.
 * Returns null for anything unparseable, so a bad input stores NULL rather than
 * a plausible-looking wrong day.
 */
export function jalaliToDate(value: unknown): Date | null {
  const parts = parseDateParts(value);
  if (!parts) return null;

  const [gy, gm, gd] = parts.calendar === "jalali"
    ? jalaliToGregorian(parts.y, parts.m, parts.d)
    : [parts.y, parts.m, parts.d];

  const date = new Date(Date.UTC(gy, gm - 1, gd));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** `DATE` value -> zero-padded Shamsi string ("1405/05/06"). */
export function dateToJalali(value: Date | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  // UTC getters, to match how jalaliToDate wrote it.
  const [jy, jm, jd] = gregorianToJalali(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  return `${jy}/${String(jm).padStart(2, "0")}/${String(jd).padStart(2, "0")}`;
}

/**
 * Normalizes a Shamsi string to zero-padded form, preserving what the user
 * meant while making string comparisons and sorting reliable.
 */
export function normalizeJalali(value: unknown): string | null {
  const parts = parseJalaliParts(value);
  if (!parts) return null;
  return `${parts[0]}/${String(parts[1]).padStart(2, "0")}/${String(parts[2]).padStart(2, "0")}`;
}

/**
 * Expands `{ creationDate: "۱۴۰۵/۰۵/۰۶" }` into the column pair Prisma expects:
 * `{ creationDate: Date, creationDateJalali: "1405/05/06" }`.
 *
 * Only fields present in `body` are touched, so a partial update does not blank
 * the dates it didn't mention. An empty string clears both columns — that is how
 * the UI signals "no date" — while a malformed value is treated the same way
 * rather than silently storing a wrong day.
 */
export function expandDateFields(
  body: Record<string, unknown>,
  fields: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    if (!(field in body)) continue;
    const raw = body[field];
    if (raw === null || raw === undefined || raw === "") {
      out[field] = null;
      out[`${field}Jalali`] = null;
      continue;
    }
    out[field] = jalaliToDate(raw);
    out[`${field}Jalali`] = normalizeJalali(raw);
  }
  return out;
}

/**
 * Inclusive `DATE` range filter from Shamsi bounds, for "from … to …" pickers.
 * Returns undefined when neither bound is usable, so it can be dropped into a
 * `where` without producing an always-true clause.
 */
export function jalaliRangeFilter(
  from: unknown,
  to: unknown,
): { gte?: Date; lte?: Date } | undefined {
  const gte = jalaliToDate(from);
  const lte = jalaliToDate(to);
  if (!gte && !lte) return undefined;
  return { ...(gte ? { gte } : {}), ...(lte ? { lte } : {}) };
}
