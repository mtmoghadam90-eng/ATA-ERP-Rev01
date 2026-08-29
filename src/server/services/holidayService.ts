import { getDb } from "../db";
import { AuthUser, hasPermission } from "../auth";
import { jalaliToDate } from "../dates";
import { logAction } from "./auditService";
import {
  HolidayMap, ImportedHoliday, importRefusalReason, normalizeJalali,
} from "../../utils/holidays";
import { DEFAULT_HOLIDAY_SOURCE_URL, fetchHolidayYear } from "../holidaySource";
import { loadSettings } from "../settings";
import { setHolidayCalendar } from "../../dateUtils";

/**
 * The official calendar: which days nobody works.
 *
 * Read by everything that counts a working day — a proforma's delivery date, a
 * follow-up's next action, a task's due date — so it is deliberately small,
 * cached in the browser, and never fetched from a website at the moment somebody
 * needs an answer. A calculation that changes because a site is down is worse
 * than one that is a little stale.
 */

export interface HolidayRow {
  id: string;
  dateJalali: string;
  yearJalali: number;
  title: string;
  isHoliday: boolean;
  source: string;
}

const SELECT = {
  id: true, dateJalali: true, yearJalali: true,
  title: true, isHoliday: true, source: true,
} as const;

/**
 * Every stored day, oldest first.
 *
 * Not paged, and not filtered by year: the browser holds this to answer «is
 * this date a holiday» synchronously while somebody types a delivery term, and
 * a page of it would answer that question wrongly for the dates it did not
 * happen to carry. Two dozen days a year over a decade is a few hundred rows.
 */
export async function listHolidays(): Promise<HolidayRow[]> {
  return getDb().holiday.findMany({
    orderBy: { dateJalali: "asc" },
    select: SELECT,
  });
}

/** The stored days as the map the pure rules take. */
export function holidayMapOf(rows: { dateJalali: string; isHoliday: boolean }[]): HolidayMap {
  const map: HolidayMap = {};
  for (const row of rows) map[row.dateJalali] = row.isHoliday;
  return map;
}

/**
 * Pushes the stored calendar into this process's date helpers.
 *
 * The server counts working days too — `projectSummary` proposes delivery dates
 * — so it needs the same answers the browser has. Called at startup and after
 * every write, and it never throws: a calendar that cannot be read leaves the
 * fixed solar days in place, which is what the helpers fall back to.
 */
export async function refreshHolidayCache(): Promise<number> {
  try {
    const rows = await listHolidays();
    setHolidayCalendar(holidayMapOf(rows));
    return rows.length;
  } catch (err) {
    console.warn("[holidays] calendar could not be loaded:", (err as Error)?.message ?? err);
    return 0;
  }
}

export interface HolidayInput {
  dateJalali?: string;
  title?: string;
  isHoliday?: boolean;
}

/**
 * Adds or corrects one day by hand.
 *
 * The primary path, not a fallback. Iran announces holidays for snow, pollution
 * and elections at two days' notice, and no yearly source has them; a calendar
 * that can only be imported is a calendar that is wrong several times a winter.
 *
 * Always stored as `MANUAL`, which is what protects it: an import never
 * overwrites a day a person typed.
 */
export async function upsertHoliday(
  input: HolidayInput,
  user: AuthUser,
  todayJalali: string,
): Promise<"forbidden" | "invalid" | { holiday: HolidayRow }> {
  if (!hasPermission(user, "settings")) return "forbidden";

  const dateJalali = normalizeJalali(input.dateJalali);
  const date = dateJalali ? jalaliToDate(dateJalali) : null;
  if (!dateJalali || !date) return "invalid";

  const title = String(input.title ?? "").trim().slice(0, 300) || "تعطیل";
  const isHoliday = input.isHoliday !== false;
  const yearJalali = parseInt(dateJalali.slice(0, dateJalali.indexOf("/")), 10);

  const holiday = await getDb().holiday.upsert({
    where: { dateJalali },
    create: { dateJalali, date, yearJalali, title, isHoliday, source: "MANUAL" },
    // The source becomes MANUAL on edit too: once somebody has corrected an
    // imported day, re-importing the year must leave their answer alone.
    update: { title, isHoliday, source: "MANUAL" },
    select: SELECT,
  });

  await refreshHolidayCache();

  await logAction(
    {
      action: "UPDATE",
      module: "تقویم",
      entityId: holiday.id,
      description: `${isHoliday ? "ثبت" : "لغو"} تعطیلی ${dateJalali}: ${title}`,
      afterState: holiday,
    },
    user,
    todayJalali,
  );

  return { holiday };
}

export async function deleteHoliday(
  dateJalali: string,
  user: AuthUser,
  todayJalali: string,
): Promise<"forbidden" | "not-found" | "ok"> {
  if (!hasPermission(user, "settings")) return "forbidden";
  const norm = normalizeJalali(dateJalali);
  if (!norm) return "not-found";

  const existing = await getDb().holiday.findUnique({ where: { dateJalali: norm } });
  if (!existing) return "not-found";

  await getDb().holiday.delete({ where: { dateJalali: norm } });
  await refreshHolidayCache();
  await logAction(
    {
      action: "DELETE",
      module: "تقویم",
      entityId: existing.id,
      description: `حذف روز ${norm} از تقویم`,
      beforeState: existing,
    },
    user,
    todayJalali,
  );
  return "ok";
}

export interface ImportOutcome {
  year: number;
  /** Days written. */
  added: number;
  updated: number;
  /** Days left alone because somebody had entered them by hand. */
  keptManual: number;
  /** What the source returned, before any of that. */
  found: number;
  url: string;
}

/**
 * Imports one Jalali year.
 *
 * Three rules, each of which exists because the alternative corrupts a calendar
 * every delivery date is counted against.
 *
 * **A hand-entered day is never touched.** Somebody typed it because the source
 * was wrong or silent, and an import that overwrote it would undo the
 * correction every time the year was refreshed.
 *
 * **A year that looks nothing like a year is refused outright** — see
 * `importRefusalReason`. An error page parses to zero holidays, and writing
 * that over a year people are quoting against is worse than not importing.
 *
 * **Nothing is deleted.** A day the source dropped this time may be a day the
 * source is wrong about; removing it is a decision for a person, through the
 * delete button.
 */
export async function importHolidayYear(
  year: number,
  user: AuthUser,
  todayJalali: string,
): Promise<"forbidden" | { error: string } | ImportOutcome> {
  if (!hasPermission(user, "settings")) return "forbidden";
  if (!(year >= 1300 && year <= 1600)) return { error: "سال شمسی معتبر نیست." };

  const settings = await loadSettings() as { holidaySourceUrl?: unknown };
  const template = typeof settings?.holidaySourceUrl === "string" && settings.holidaySourceUrl
    ? settings.holidaySourceUrl
    : DEFAULT_HOLIDAY_SOURCE_URL;

  let fetched: { holidays: ImportedHoliday[]; url: string };
  try {
    fetched = await fetchHolidayYear(year, template);
  } catch (err) {
    return { error: (err as Error)?.message ?? "دریافت تقویم با خطا مواجه شد." };
  }

  const refusal = importRefusalReason(fetched.holidays);
  if (refusal) return { error: refusal };

  const db = getDb();
  const existing = await db.holiday.findMany({
    where: { yearJalali: year },
    select: { dateJalali: true, source: true },
  });
  const bySource = new Map(existing.map((r) => [r.dateJalali, r.source]));

  let added = 0;
  let updated = 0;
  let keptManual = 0;

  for (const day of fetched.holidays) {
    const known = bySource.get(day.dateJalali);
    if (known === "MANUAL") { keptManual++; continue; }

    const date = jalaliToDate(day.dateJalali);
    if (!date) continue;

    await db.holiday.upsert({
      where: { dateJalali: day.dateJalali },
      create: {
        dateJalali: day.dateJalali, date, yearJalali: year,
        title: day.title, isHoliday: true, source: "IMPORT",
      },
      update: { title: day.title, isHoliday: true, source: "IMPORT" },
      select: { id: true },
    });
    if (known === undefined) added++; else updated++;
  }

  await refreshHolidayCache();

  const outcome: ImportOutcome = {
    year, added, updated, keptManual,
    found: fetched.holidays.length,
    url: fetched.url,
  };

  await logAction(
    {
      action: "UPDATE",
      module: "تقویم",
      entityId: `holidays-${year}`,
      description: `دریافت تعطیلات سال ${year}: ${added} روز جدید، ${updated} به‌روزرسانی،`
        + ` ${keptManual} روز دستی دست‌نخورده`,
      afterState: outcome,
    },
    user,
    todayJalali,
  );

  return outcome;
}
