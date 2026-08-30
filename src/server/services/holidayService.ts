import { getDb } from "../db";
import { AuthUser, hasPermission } from "../auth";
import { jalaliToDate } from "../dates";
import { logAction } from "./auditService";
import {
  HolidayMap, ImportedHoliday, importRefusalReason, normalizeJalali, planHijriShift,
  shiftForYear, shiftRefusalReason,
} from "../../utils/holidays";
import { DEFAULT_HOLIDAY_SOURCE_URL, fetchHolidayYear } from "../holidaySource";
import { invalidateSettingsCache, loadSettings } from "../settings";
import { addDaysToShamsi, setHolidayCalendar } from "../../dateUtils";

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
  calendarKind: string;
  sourceDateJalali: string | null;
}

const SELECT = {
  id: true, dateJalali: true, yearJalali: true, title: true, isHoliday: true,
  source: true, calendarKind: true, sourceDateJalali: true,
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
    create: {
      dateJalali, date, yearJalali, title, isHoliday, source: "MANUAL",
      // Never HIJRI. A hand-entered day is an answer about *this* date, so the
      // lunar correction must not drag it somewhere else — the person typed it
      // precisely because the computed calendar was wrong.
      calendarKind: "SOLAR", sourceDateJalali: dateJalali,
    },
    // The source becomes MANUAL on edit too: once somebody has corrected an
    // imported day, re-importing the year must leave their answer alone.
    update: {
      title, isHoliday, source: "MANUAL",
      calendarKind: "SOLAR", sourceDateJalali: dateJalali,
    },
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
  /** The lunar correction that was applied on the way in. */
  hijriShift: number;
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

  const settings = await loadSettings() as {
    holidaySourceUrl?: unknown; hijriHolidayShift?: unknown;
  };
  const template = typeof settings?.holidaySourceUrl === "string" && settings.holidaySourceUrl
    ? settings.holidaySourceUrl
    : DEFAULT_HOLIDAY_SOURCE_URL;
  /*
   * The lunar correction this year already carries.
   *
   * Applied on the way in, so re-importing a year does not undo a correction
   * somebody made — which would be the whole feature quietly cancelling itself
   * the next time the button was pressed.
   */
  const offset = shiftForYear(settings?.hijriHolidayShift, year);

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
    // Only the lunar days move; a solar holiday is a fixed date and is right.
    const placed = day.calendarKind === "HIJRI" && offset !== 0
      ? normalizeJalali(addDaysToShamsi(day.dateJalali, offset)) ?? day.dateJalali
      : day.dateJalali;

    const known = bySource.get(placed);
    if (known === "MANUAL") { keptManual++; continue; }

    const date = jalaliToDate(placed);
    if (!date) continue;

    await db.holiday.upsert({
      where: { dateJalali: placed },
      create: {
        dateJalali: placed, date, yearJalali: year,
        title: day.title, isHoliday: true, source: "IMPORT",
        // What the source said, so a later correction is re-derived from it
        // rather than applied on top of a date already corrected once.
        calendarKind: day.calendarKind, sourceDateJalali: day.dateJalali,
      },
      update: {
        title: day.title, isHoliday: true, source: "IMPORT",
        calendarKind: day.calendarKind, sourceDateJalali: day.dateJalali,
      },
      select: { id: true },
    });
    if (known === undefined) added++; else updated++;
  }

  await refreshHolidayCache();

  const outcome: ImportOutcome = {
    year, added, updated, keptManual,
    found: fetched.holidays.length,
    url: fetched.url,
    hijriShift: offset,
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


/* -------------------- correcting the lunar calendar ---------------------- */

export interface ShiftOutcome {
  year: number;
  /** The offset now in force for the year, in days. */
  offset: number;
  /** Days actually moved. */
  moved: number;
  /** Days that could not move because a day somebody entered is already there. */
  blocked: string[];
}

/**
 * Moves a year's lunar holidays by a whole number of days.
 *
 * The reason this exists rather than a better source: Iran announces the start
 * of each hijri month by **sighting the moon**, and every calendar that can be
 * reached from a server computes it instead. They all agree with each other and
 * can all be a day away from what was announced — usually a day early. The
 * solar holidays are fixed dates and are simply right, which is exactly the
 * pattern reported: Nowruz correct, Ashura a day out.
 *
 * So the correction is one offset for the whole lunar set of a year. It is
 * **stored** as well as applied, because otherwise re-importing the year would
 * silently undo it.
 *
 * The re-placement is a delete-then-insert inside one transaction rather than a
 * row-by-row update: `dateJalali` is unique, and shifting a set of dates by one
 * day means every target but the last is occupied by the day in front of it —
 * updating in place fails on the first collision, and updating in a lucky order
 * is not something to rely on.
 */
export async function shiftHijriHolidays(
  year: number,
  offset: number,
  user: AuthUser,
  todayJalali: string,
): Promise<"forbidden" | { error: string } | ShiftOutcome> {
  if (!hasPermission(user, "settings")) return "forbidden";
  if (!(year >= 1300 && year <= 1600)) return { error: "سال شمسی معتبر نیست." };

  const refusal = shiftRefusalReason(offset);
  if (refusal) return { error: refusal };

  const db = getDb();
  const rows = await db.holiday.findMany({ where: { yearJalali: year }, select: SELECT });
  const plan = planHijriShift(rows, offset, addDaysToShamsi);

  if (plan.moves.length) {
    await db.$transaction(async (tx) => {
      // Both halves together, or a day exists twice / not at all.
      await tx.holiday.deleteMany({ where: { id: { in: plan.moves.map((m) => m.id) } } });
      const byId = new Map(rows.map((r) => [r.id, r]));
      for (const move of plan.moves) {
        const row = byId.get(move.id);
        const date = jalaliToDate(move.to);
        if (!row || !date) continue;
        await tx.holiday.create({
          data: {
            id: row.id,
            dateJalali: move.to,
            date,
            yearJalali: year,
            title: row.title,
            isHoliday: row.isHoliday,
            source: row.source,
            calendarKind: row.calendarKind,
            // Untouched: the correction is re-derived from it every time, so
            // going back to zero restores exactly what the source said.
            sourceDateJalali: row.sourceDateJalali ?? move.from,
          },
        });
      }
    });
  }

  /*
   * The offset is remembered, keyed by year.
   *
   * Not one number for the whole application: the gap between the computed
   * calendar and the announced one is decided by a sighting, so it is a fact
   * about a particular year and next year's may well be different.
   */
  const settings = (await loadSettings()) ?? null;
  if (settings) {
    const stored = { ...settings } as Record<string, unknown>;
    const map = { ...(stored.hijriHolidayShift as Record<string, number> | undefined ?? {}) };
    if (offset === 0) delete map[String(year)];
    else map[String(year)] = offset;
    stored.hijriHolidayShift = map;
    const serialized = JSON.stringify(stored);
    await db.appSetting.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", data: serialized },
      update: { data: serialized },
    });
    invalidateSettingsCache();
  }

  await refreshHolidayCache();

  const outcome: ShiftOutcome = {
    year,
    offset,
    moved: plan.moves.length,
    blocked: plan.blocked.map((b) => b.from),
  };

  await logAction(
    {
      action: "UPDATE",
      module: "تقویم",
      entityId: `holidays-${year}-hijri-shift`,
      description: `جابه‌جایی تعطیلات قمری سال ${year} به اندازه ${offset} روز`
        + ` (${plan.moves.length} روز جابه‌جا شد)`,
      afterState: outcome,
    },
    user,
    todayJalali,
  );

  return outcome;
}
