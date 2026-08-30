import { api } from "./client";
import { setHolidayCalendar } from "../dateUtils";
import type { HolidayMap } from "../utils/holidays";

/**
 * The official calendar, loaded once and handed to the date helpers.
 *
 * `isOfficialHoliday` is called synchronously all over the forms — while
 * somebody types a delivery term, while a follow-up date is proposed — so the
 * days cannot be fetched at the moment they are needed. They are loaded after
 * sign-in and pushed into `dateUtils`, which falls back to the fixed solar days
 * until they arrive: a delivery date computed in the first second of a session
 * is right about Nowruz and may be wrong about Ashura, which is strictly better
 * than the hardcoded list it replaces being wrong about Ashura for ever.
 *
 * Cached at module scope like the user directory. It changes when somebody
 * edits the calendar, and that screen refreshes it itself.
 */

export interface HolidayRow {
  id: string;
  dateJalali: string;
  yearJalali: number;
  title: string;
  isHoliday: boolean;
  source: string;
  /** HIJRI | SOLAR — only the lunar days move with the calendar correction. */
  calendarKind: string;
  /** Where the source put it, before any correction. */
  sourceDateJalali: string | null;
}

/**
 * What an import did.
 *
 * There is no `error` here on purpose. The route answers a failed import as
 * `{ success: false, error }`, which is the same shape every other endpoint
 * uses to refuse, so `api.post` raises it as an `ApiError` carrying the Persian
 * sentence — one path for the caller to handle rather than two, and no branch
 * that can never be taken.
 */
export interface HolidayImportResult {
  year: number;
  added: number;
  updated: number;
  keptManual: number;
  found: number;
  url: string;
  /** The lunar correction applied on the way in. */
  hijriShift: number;
}

export interface HolidayShiftResult {
  year: number;
  offset: number;
  moved: number;
  /** Days that could not move because a hand-entered day is already there. */
  blocked: string[];
}

let cache: HolidayRow[] | null = null;
let inFlight: Promise<HolidayRow[]> | null = null;

/*
 * Who to tell when the calendar lands.
 *
 * `isOfficialHoliday` reads a module-level copy, so a screen that rendered
 * before the fetch resolved has no way to know it should paint again — it
 * would sit there showing a month of unbroken working days until something
 * else happened to re-render it. A calendar that draws the wrong answer until
 * you poke it is the same fault as one that draws it for ever.
 */
const listeners = new Set<() => void>();

export function onHolidayCalendarChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/**
 * What this browser knows, so a screen can say «not loaded» rather than
 * silently drawing a year with no holidays in it as a year with none.
 */
export interface HolidayCalendarState {
  /** False until the first successful read; an empty database is `true`. */
  loaded: boolean;
  days: number;
  /** Shamsi years that have at least one day stored. */
  years: number[];
}

export function holidayCalendarState(): HolidayCalendarState {
  return {
    loaded: cache !== null,
    days: cache?.length ?? 0,
    years: [...new Set((cache ?? []).map((r) => r.yearJalali))].sort((a, b) => a - b),
  };
}

function applyToDateUtils(rows: HolidayRow[]): void {
  const map: HolidayMap = {};
  const titles: Record<string, string> = {};
  for (const row of rows) {
    map[row.dateJalali] = row.isHoliday;
    // Only a day that is off has a reason worth showing; a working exception
    // is named on the settings screen and nowhere else.
    if (row.isHoliday && row.title) titles[row.dateJalali] = row.title;
  }
  setHolidayCalendar(map, undefined, titles);
  for (const listener of [...listeners]) listener();
}

/**
 * Loads the calendar if it has not been loaded, and never throws.
 *
 * A calendar that cannot be fetched must not stop anybody working: the date
 * helpers keep their fixed-solar fallback and every screen carries on.
 */
export async function ensureHolidayCalendar(): Promise<HolidayRow[]> {
  if (cache) return cache;
  if (inFlight) return inFlight;

  inFlight = api.get<{ holidays: HolidayRow[] }>("/api/holidays")
    .then((r) => {
      cache = r.holidays ?? [];
      applyToDateUtils(cache);
      return cache;
    })
    .catch(() => {
      // Left uncached, so the next screen that needs it tries again.
      return [];
    })
    .finally(() => { inFlight = null; });

  return inFlight;
}

/** Re-reads it, for the screen that has just changed a day. */
export async function refreshHolidayCalendar(): Promise<HolidayRow[]> {
  cache = null;
  inFlight = null;
  return ensureHolidayCalendar();
}

export const holidaysApi = {
  list: (signal?: AbortSignal) =>
    api.get<{ holidays: HolidayRow[] }>("/api/holidays", undefined, signal)
      .then((r) => r.holidays),

  /** Adds or corrects one day. Always stored as a hand-entered answer. */
  save: (dateJalali: string, title: string, isHoliday: boolean) =>
    api.put<{ holiday: HolidayRow }>("/api/holidays", { dateJalali, title, isHoliday })
      .then((r) => r.holiday),

  remove: (dateJalali: string) =>
    api.delete<Record<string, never>>(`/api/holidays/${encodeURIComponent(dateJalali)}`),

  /**
   * Imports a year.
   *
   * Raises an `ApiError` whose message is why, when the source could not be
   * read or answered with something that is not a year. Nothing is written in
   * that case — the screen shows the reason and the stored calendar is as it
   * was.
   */
  importYear: (year: number) =>
    api.post<HolidayImportResult>("/api/holidays/import", { year }),

  /**
   * Moves a year's lunar holidays by a whole number of days.
   *
   * The offset is absolute, not a nudge: sending 1 twice leaves the days one
   * day forward, and sending 0 puts them back exactly where the source had
   * them. It is remembered for the year, so a later re-import keeps it.
   */
  shiftHijri: (year: number, offset: number) =>
    api.post<HolidayShiftResult>("/api/holidays/shift", { year, offset }),
};
