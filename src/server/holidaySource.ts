import { ImportedHoliday, parseCalendarYear } from "../utils/holidays";

/**
 * Where a year's official holidays come from.
 *
 * `time.ir` is the obvious source and is deliberately **not** what this reads.
 * It could not be reached to write a parser against — the connection is reset
 * from outside Iran — and a scraper written blind against markup nobody has
 * seen is a parser that reports success while producing nonsense. What this
 * reads is a JSON calendar that was fetched, parsed and checked: its lunar
 * chain is internally consistent (Arbaeen exactly forty days after Ashura,
 * the demise of the Prophet eight days after that) and its Ashura for 1404
 * lands on 5 July 2025, within a day of 10 Muharram 1447.
 *
 * The URL is a setting, not a constant, for the obvious reason: it is one
 * person's endpoint and the company's own server may reach sources this one
 * cannot. Changing it needs no deployment.
 *
 * Nothing here is authoritative. The holidays are stored, the stored rows are
 * what every calculation reads, and a person can add or correct any day by
 * hand — which is the only workable answer for the days Iran announces at
 * two days' notice for snow or pollution, and which no yearly source has.
 */

export const DEFAULT_HOLIDAY_SOURCE_URL =
  "https://persian-calendar-api.sajjadth.workers.dev/?year={YEAR}";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
  + "Chrome/120.0.0.0 Safari/537.36";

export interface FetchedYear {
  holidays: ImportedHoliday[];
  /** The URL actually requested, so a failure can be diagnosed from the screen. */
  url: string;
}

/**
 * Fetches and parses one Jalali year.
 *
 * Throws with a Persian message rather than returning an empty list: «the
 * source did not answer» and «the year genuinely has no holidays» are different
 * facts, and a caller that cannot tell them apart writes the second when it
 * means the first.
 */
export async function fetchHolidayYear(
  year: number,
  template = DEFAULT_HOLIDAY_SOURCE_URL,
): Promise<FetchedYear> {
  const url = template.includes("{YEAR}")
    ? template.replace("{YEAR}", String(year))
    // A template with no placeholder is still usable — some sources take the
    // year as a path segment somebody has already written in.
    : template;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "User-Agent": BROWSER_UA, Accept: "application/json" },
      signal: AbortSignal.timeout(20000),
    });
  } catch (err) {
    throw new Error(
      `دسترسی به منبع تقویم ممکن نشد: ${(err as Error)?.message ?? "خطای شبکه"}`,
    );
  }

  if (!response.ok) {
    throw new Error(`منبع تقویم با کد ${response.status} پاسخ داد.`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("پاسخ منبع تقویم JSON معتبر نبود؛ احتمالاً صفحه خطا برگردانده است.");
  }

  return { holidays: parseCalendarYear(payload, year), url };
}
