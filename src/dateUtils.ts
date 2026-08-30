import {
  DEFAULT_WEEKEND_DAYS, HolidayMap, countForwardDays, isNonWorkingDay, normalizeJalali,
} from './utils/holidays';
export function gregorianToJalali(gy: number, gm: number, gd: number): [number, number, number] {
  const g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  let jy = (gy <= 1600) ? 0 : 979;
  gy -= (gy <= 1600) ? 621 : 1600;
  const gy2 = (gm > 2) ? (gy + 1) : gy;
  let days = (365 * gy) + Math.floor((gy2 + 3) / 4) - Math.floor((gy2 + 99) / 100) + Math.floor((gy2 + 399) / 400) - 80 + gd + g_d_m[gm - 1];
  jy += 33 * Math.floor(days / 12053);
  days %= 12053;
  jy += 4 * Math.floor(days / 1461);
  days %= 1461;
  jy += Math.floor((days - 1) / 365);
  if (days > 365) days = (days - 1) % 365;
  const jm = (days < 186) ? (1 + Math.floor(days / 31)) : (7 + Math.floor((days - 186) / 30));
  const jd = 1 + ((days < 186) ? (days % 31) : ((days - 186) % 30));
  return [jy, jm, jd];
}

export function jalaliToGregorian(jy: number, jm: number, jd: number): [number, number, number] {
  let gy = (jy <= 979) ? 0 : 1600;
  jy -= (jy <= 979) ? 0 : 979;
  const days = (365 * jy) + (Math.floor(jy / 33) * 8) + Math.floor(((jy % 33) + 3) / 4) + 78 + jd + ((jm < 7) ? ((jm - 1) * 31) : (((jm - 7) * 30) + 186));
  gy += 400 * Math.floor(days / 146097);
  let daysLeft = days % 146097;
  if (daysLeft > 36524) {
    daysLeft--;
    gy += 100 * Math.floor(daysLeft / 36524);
    daysLeft %= 36524;
    if (daysLeft >= 365) daysLeft++;
  }
  gy += 4 * Math.floor(daysLeft / 1461);
  daysLeft %= 1461;
  gy += Math.floor((daysLeft - 1) / 365);
  if (daysLeft > 365) daysLeft = (daysLeft - 1) % 365;
  let gd = daysLeft + 1;
  const sal_a = [0, 31, ((gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let gm = 0;
  for (let i = 1; i <= 12; i++) {
    if (gd <= sal_a[i]) {
      gm = i;
      break;
    }
    gd -= sal_a[i];
  }
  return [gy, gm, gd];
}

export function parseGregorianDate(dateStr: any): { y: number; m: number; d: number } | null {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const m = dateStr.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) {
    return { y: parseInt(m[1]), m: parseInt(m[2]), d: parseInt(m[3]) };
  }
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) {
    return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() };
  }
  return null;
}

export function toShamsiStr(dateInput: any): string {
  if (!dateInput) return '';
  if (dateInput instanceof Date) {
    if (isNaN(dateInput.getTime())) return '';
    const [jy, jm, jd] = gregorianToJalali(dateInput.getFullYear(), dateInput.getMonth() + 1, dateInput.getDate());
    return `${jy}/${String(jm).padStart(2, '0')}/${String(jd).padStart(2, '0')}`;
  }
  
  let dateStr = dateInput;
  if (typeof dateStr !== 'string') {
    dateStr = String(dateStr);
  }
  
  const trimmed = dateStr.trim();
  // If it already looks like a Shamsi date (e.g., starting with 13 or 14)
  if (/^(13|14)\d{2}[-/]\d{1,2}[-/]\d{1,2}/.test(trimmed)) {
    return trimmed.replace(/-/g, '/');
  }

  const parsed = parseGregorianDate(trimmed);
  if (parsed) {
    const [jy, jm, jd] = gregorianToJalali(parsed.y, parsed.m, parsed.d);
    return `${jy}/${String(jm).padStart(2, '0')}/${String(jd).padStart(2, '0')}`;
  }
  return trimmed;
}

export function getTodayShamsi(): string {
  return toShamsiStr(new Date());
}

export function toGregorianStr(shamsiStr: any): string {
  if (!shamsiStr || typeof shamsiStr !== 'string') return '';
  const m = shamsiStr.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) {
    const jy = parseInt(m[1]);
    const jm = parseInt(m[2]);
    const jd = parseInt(m[3]);
    const [gy, gm, gd] = jalaliToGregorian(jy, jm, jd);
    return `${gy}-${String(gm).padStart(2, '0')}-${String(gd).padStart(2, '0')}`;
  }
  return shamsiStr;
}

export function addDaysToShamsi(shamsiStr: string, days: number): string {
  if (!shamsiStr) return '';
  const gStr = toGregorianStr(shamsiStr);
  const d = new Date(gStr);
  d.setDate(d.getDate() + days);
  return toShamsiStr(d);
}

export function getShamsiDaysDifference(dateA: string, dateB: string): number {
  if (!dateA || !dateB) return 0;
  const gStrA = toGregorianStr(dateA);
  const gStrB = toGregorianStr(dateB);
  const dA = new Date(gStrA);
  const dB = new Date(gStrB);
  if (isNaN(dA.getTime()) || isNaN(dB.getTime())) return 0;
  const diffTime = dB.getTime() - dA.getTime();
  return Math.round(diffTime / (1000 * 60 * 60 * 24));
}

/* ------------------------------ the calendar ----------------------------- */

/**
 * The official calendar, as this process currently knows it.
 *
 * It used to be three hardcoded sets right here: the fixed solar days, plus
 * hand-typed lunar dates for 1405 and 1406 and nothing after. Beyond 1406 every
 * lunar holiday silently vanished from the working-day arithmetic — and the two
 * years that were there were **a lunar month late**, so a delivery date counted
 * across Ashura 1405 was counted across an ordinary Tuesday instead.
 *
 * The days are data now, in the `holidays` table. This module keeps a copy
 * because `isOfficialHoliday` is called synchronously all over the forms while
 * somebody types, and the alternative — making every caller await — is a
 * refactor of every screen for no gain. It is loaded once after sign-in
 * (`src/api/holidays.ts` on the client, `refreshHolidayCache` on the server)
 * and falls back to the fixed solar days until it is, so a fresh installation
 * still counts Nowruz correctly before anybody presses anything.
 */
let holidayOverrides: HolidayMap = {};
let weekendDays: readonly number[] = DEFAULT_WEEKEND_DAYS;
/** What each stored day is called, for a calendar that wants to say why. */
let holidayTitles: Record<string, string> = {};

/** Replaces what this process knows. Called with the whole set, never a page. */
export function setHolidayCalendar(
  holidays: HolidayMap,
  weekend: readonly number[] = DEFAULT_WEEKEND_DAYS,
  titles: Record<string, string> = {},
): void {
  holidayOverrides = holidays ?? {};
  weekendDays = weekend?.length ? weekend : DEFAULT_WEEKEND_DAYS;
  holidayTitles = titles ?? {};
}

/** What is loaded, for a screen that wants to say how many days it knows. */
export function holidayCalendarSize(): number {
  return Object.keys(holidayOverrides).length;
}

/** The day of the week, or null when the date cannot be read. */
function jalaliDayOfWeek(normalized: string): number | null {
  const gStr = toGregorianStr(normalized);
  if (!gStr) return null;
  const d = new Date(gStr);
  return isNaN(d.getTime()) ? null : d.getDay();
}

/**
 * Is this a day nobody works?
 *
 * The rule itself is `isNonWorkingDay` in `src/utils/holidays.ts`, which is
 * pure and covered by `test:rules`; this only supplies the two things it
 * deliberately does not compute — what the calendar says, and which day of the
 * week the date falls on.
 */
export function isOfficialHoliday(shamsiStr: any): boolean {
  const normalized = normalizeJalali(shamsiStr);
  if (!normalized) return false;
  return isNonWorkingDay(normalized, jalaliDayOfWeek(normalized), {
    holidays: holidayOverrides,
    weekendDays,
  });
}

/**
 * Why this day is off, or null when it is worked.
 *
 * A calendar that paints a day red without saying why invites the question it
 * cannot answer — «چرا این روز قرمز است؟» — so the day's own title travels with
 * the colour. It is derived from the same rule as the colour rather than from a
 * second reading of the calendar, which is how the two come to disagree: a
 * Friday somebody has marked as worked returns null here exactly as it returns
 * false there.
 */
export function holidayReason(shamsiStr: any): string | null {
  const normalized = normalizeJalali(shamsiStr);
  if (!normalized || !isOfficialHoliday(normalized)) return null;

  const stored = holidayTitles[normalized];
  if (stored) return stored;

  const dayOfWeek = jalaliDayOfWeek(normalized);
  if (dayOfWeek !== null && weekendDays.includes(dayOfWeek)) return 'تعطیل آخر هفته';
  // A fixed solar day on a database nobody has imported a year into yet.
  return 'تعطیل رسمی';
}

/**
 * The date `workingDays` working days from here.
 *
 * Bounded — see `countForwardDays`. The old loop had nothing stopping it, so a
 * calendar that marked every day (one bad import, or a weekend list of all
 * seven) would spin the browser's main thread for ever with no error.
 */
export function addWorkingDaysToShamsi(shamsiStr: string, workingDays: number): string {
  if (!shamsiStr) return '';
  if (workingDays <= 0) return shamsiStr;

  // Memoised across the walk: `addDaysToShamsi` is the expensive part and the
  // predicate is asked for the same offsets in order.
  const seen: string[] = [shamsiStr];
  const at = (offset: number): string => {
    while (seen.length <= offset) {
      seen.push(addDaysToShamsi(seen[seen.length - 1], 1));
    }
    return seen[offset];
  };

  const offset = countForwardDays(workingDays, (i) => isOfficialHoliday(at(i)));
  return at(offset);
}

export function parsePersianDate(shamsiStr: string): Date {
  const gStr = toGregorianStr(shamsiStr);
  return new Date(gStr);
}

export function formatDateTimeToShamsi(dateInput: any): string {
  if (!dateInput) return '';
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) {
    if (typeof dateInput === 'string' && /^(13|14)\d{2}/.test(dateInput)) {
      return dateInput;
    }
    return String(dateInput);
  }
  const shamsiDate = toShamsiStr(d);
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');
  return `${shamsiDate} ساعت ${hours}:${minutes}:${seconds}`;
}
