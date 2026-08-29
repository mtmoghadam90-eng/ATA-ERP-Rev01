/**
 * Official holidays, and the working-day arithmetic that reads them.
 *
 * The delivery date on a proforma, a follow-up's next action and a task's due
 * date are all counted in **working days**, so what counts as a working day is
 * a business rule and not a detail. It used to be a hardcoded set in
 * `dateUtils.ts`: the ten fixed solar days, plus a hand-typed list of the lunar
 * ones for 1405 and 1406 and nothing at all after that.
 *
 * Two things were wrong with that. Beyond 1406 every lunar holiday silently
 * disappeared, so a date promised in 1407 was counted across Ashura as though
 * it were an ordinary Tuesday. And the hand-typed lists themselves were **a
 * lunar month late** — the app had Ashura 1405 on 5 Mordad (25 July 2026) when
 * it falls on 4 Tir (25 June 2026), which `test:rules` now pins against the
 * independently checkable Gregorian date.
 *
 * So holidays are data. They are stored, edited by hand, and imported a year at
 * a time; this module is the pure half and is covered by `test:rules`.
 */

/**
 * The solar holidays, which are the same date every year.
 *
 * Kept in code on purpose: they do not move, and they are the floor under a
 * database that has never been imported into — a fresh installation must count
 * Nowruz as a holiday before anybody presses anything.
 */
export const FIXED_SOLAR_HOLIDAYS: readonly string[] = [
  "01/01", "01/02", "01/03", "01/04", // نوروز
  "01/12",                            // روز جمهوری اسلامی
  "01/13",                            // روز طبیعت
  "03/14",                            // رحلت امام خمینی
  "03/15",                            // قیام ۱۵ خرداد
  "11/22",                            // پیروزی انقلاب
  "12/29",                            // ملی شدن صنعت نفت
];

/**
 * What the calendar says about a specific date, when anything does.
 *
 * `true` is a holiday; `false` is the other direction and is why this is a map
 * rather than a set — a company works some announced holidays, and Iran
 * occasionally moves a working day. Without the second answer there would be no
 * way to say «this Friday we are open» at all.
 */
export type HolidayMap = Record<string, boolean>;

/** Weekend days, as JS `getDay()` numbers. Friday is 5. */
export const DEFAULT_WEEKEND_DAYS: readonly number[] = [5];

export interface WorkingDayRules {
  /** Explicit answers, keyed by `YYYY/MM/DD`. Wins over everything below. */
  holidays?: HolidayMap;
  /** `getDay()` numbers that are not worked. Thursday is 4, Friday 5. */
  weekendDays?: readonly number[];
}

/** `1404/7/3` and `1404-07-03` both become `1404/07/03`. */
export function normalizeJalali(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parts = value.replace(/-/g, "/").trim().split("/");
  if (parts.length !== 3) return null;
  const [y, m, d] = parts.map((p) => parseInt(p, 10));
  if (!y || !m || !d || m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}/${String(m).padStart(2, "0")}/${String(d).padStart(2, "0")}`;
}

/** The `MM/DD` half, for the fixed solar list. */
export function monthDayOf(jalali: string): string | null {
  const norm = normalizeJalali(jalali);
  return norm ? norm.slice(norm.indexOf("/") + 1) : null;
}

/**
 * Is this date one nobody works?
 *
 * The order is the whole rule. An explicit answer for the date wins — that is
 * what makes both «this announced holiday we are working» and «this Friday we
 * are open» expressible. Then the weekend, then the fixed solar days.
 *
 * `dayOfWeek` is passed in rather than computed, because converting a Jalali
 * date needs the calendar helpers and this module is deliberately free of them
 * — the two callers already hold a converter each.
 */
export function isNonWorkingDay(
  jalali: string,
  dayOfWeek: number | null,
  rules: WorkingDayRules = {},
): boolean {
  const norm = normalizeJalali(jalali);
  if (!norm) return false;

  const explicit = rules.holidays?.[norm];
  if (explicit !== undefined) return explicit;

  const weekend = rules.weekendDays ?? DEFAULT_WEEKEND_DAYS;
  if (dayOfWeek !== null && weekend.includes(dayOfWeek)) return true;

  const md = monthDayOf(norm);
  return md !== null && FIXED_SOLAR_HOLIDAYS.includes(md);
}

/**
 * How many days forward `n` working days is.
 *
 * **Bounded.** The old implementation was `while (count < workingDays)` with
 * nothing stopping it: a holiday map that marked every day — one bad import, or
 * a weekend list containing all seven — would spin the browser's main thread
 * for ever with no error and no way out. The cap is generous enough that no
 * real answer reaches it and returns the best it has rather than hanging.
 */
export const MAX_WORKING_DAY_SPAN = 2000;

export function countForwardDays(
  workingDays: number,
  isHoliday: (offset: number) => boolean,
): number {
  if (!(workingDays > 0)) return 0;
  let counted = 0;
  let offset = 0;
  while (counted < workingDays && offset < MAX_WORKING_DAY_SPAN) {
    offset++;
    if (!isHoliday(offset)) counted++;
  }
  return offset;
}

/* ------------------------- importing a whole year ------------------------- */

/** One day the calendar source reports as a holiday. */
export interface ImportedHoliday {
  /** `YYYY/MM/DD`. */
  dateJalali: string;
  title: string;
}

const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

/** Persian and Arabic digits to Latin, for a source that prints its own. */
export function toLatinDigits(text: string): string {
  return String(text ?? "").replace(/[۰-۹٠-٩]/g, (c) => {
    const p = PERSIAN_DIGITS.indexOf(c);
    return String(p >= 0 ? p : ARABIC_DIGITS.indexOf(c));
  });
}

export const JALALI_MONTHS: readonly string[] = [
  "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
  "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند",
];

/**
 * The holidays in one year of the calendar source's JSON.
 *
 * The shape is a month per entry, each with a `header.jalali` naming the month
 * and a `days` array. Written defensively throughout: this is somebody else's
 * document and a change to it must produce *fewer* holidays and a visible
 * count, never an exception that takes a screen down.
 *
 * Days marked `disabled` are the neighbouring months bleeding into the grid —
 * they belong to another month and would be imported under the wrong one.
 */
export function parseCalendarYear(payload: unknown, year: number): ImportedHoliday[] {
  if (!Array.isArray(payload)) return [];
  const out: ImportedHoliday[] = [];
  const seen = new Set<string>();

  for (const block of payload) {
    if (!block || typeof block !== "object") continue;
    const header = (block as { header?: { jalali?: unknown } }).header;
    const monthName = String(header?.jalali ?? "").trim().split(/\s+/).pop() ?? "";
    const monthIndex = JALALI_MONTHS.indexOf(monthName);
    if (monthIndex === -1) continue;

    const days = (block as { days?: unknown }).days;
    if (!Array.isArray(days)) continue;

    for (const entry of days) {
      if (!entry || typeof entry !== "object") continue;
      const row = entry as {
        disabled?: unknown;
        day?: { jalali?: unknown };
        events?: { isHoliday?: unknown; list?: unknown };
      };
      // The grid pads with the previous and next month's days.
      if (row.disabled) continue;
      if (row.events?.isHoliday !== true) continue;

      const day = parseInt(toLatinDigits(String(row.day?.jalali ?? "")), 10);
      if (!day || day < 1 || day > 31) continue;

      const titles = Array.isArray(row.events?.list)
        ? (row.events.list as { isHoliday?: unknown; event?: unknown }[])
          .filter((e) => e?.isHoliday === true)
          .map((e) => String(e?.event ?? "").trim())
          .filter(Boolean)
        : [];

      const dateJalali = `${year}/${String(monthIndex + 1).padStart(2, "0")}/${String(day).padStart(2, "0")}`;
      if (seen.has(dateJalali)) continue;
      seen.add(dateJalali);
      out.push({ dateJalali, title: titles.join(" — ") || "تعطیل رسمی" });
    }
  }

  return out.sort((a, b) => (a.dateJalali < b.dateJalali ? -1 : 1));
}

/**
 * A year that looks nothing like one is not an import.
 *
 * An empty answer, or a handful of days, means the source changed shape or
 * served an error page — and writing that over a year somebody is quoting
 * against is worse than not importing at all. Iran has roughly two dozen
 * official days a year; a real year never has five.
 */
export const MIN_PLAUSIBLE_HOLIDAYS = 12;

export function importRefusalReason(found: ImportedHoliday[]): string | null {
  if (found.length === 0) return "منبع تقویم هیچ تعطیلی برای این سال برنگرداند.";
  if (found.length < MIN_PLAUSIBLE_HOLIDAYS) {
    return `تنها ${found.length} روز تعطیل خوانده شد که برای یک سال کامل کم است؛`
      + " احتمالاً ساختار منبع تغییر کرده است. برای جلوگیری از خراب شدن تقویم،"
      + " چیزی ذخیره نشد.";
  }
  return null;
}
