import { getDb } from "../db";
import { getTodayShamsi } from "../../dateUtils";
import { loadSettings } from "../settings";
import { announcedYears, calendarYearToAnnounce } from "../../utils/holidays";
import { notifyUser } from "./notificationService";
import { markCalendarYearAnnounced } from "./holidayService";

/**
 * «تقویم سال جدید را بارگذاری کنید» — once a year, to every system administrator.
 *
 * The lunar holidays move every year and have to be imported (or typed in) for
 * each one; a year nobody loaded draws exactly like a year with no religious
 * holidays in it, and every delivery date and task is then counted straight
 * across Ashura. So from Esfand on the administrators are told the coming year
 * is empty, and again if a year has started with nothing in it
 * (`calendarYearToAnnounce`). Each year is announced **once**, recorded in
 * `settings.holidayNoticeSentFor`, and the record is written before the notices
 * so two overlapping passes cannot both send.
 *
 * Started at sign-in and never awaited, like the other daily passes; its own
 * once-per-Shamsi-day guard keeps it to one read a day.
 */

let ranFor: string | null = null;
let running: Promise<number | null> | null = null;

export async function ensureHolidayYearNoticeRanToday(
  todayJalali = getTodayShamsi(),
): Promise<number | null> {
  if (ranFor === todayJalali) return null;
  if (running) return running;
  running = announceMissingCalendarYear(todayJalali)
    .then((year) => { ranFor = todayJalali; return year; })
    .catch((err) => {
      console.error("[holidays] new-year notice failed:", (err as Error)?.message || err);
      return null;
    })
    .finally(() => { running = null; });
  return running;
}

/** The year announced, or null when there was nothing to say. */
export async function announceMissingCalendarYear(todayJalali: string): Promise<number | null> {
  const db = getDb();
  const settings = await loadSettings() as { holidayNoticeSentFor?: unknown } | undefined;
  if (!settings) return null;
  const sentFor = announcedYears(settings.holidayNoticeSentFor);

  const thisYear = parseInt(todayJalali.slice(0, 4), 10);
  const rows = await db.holiday.findMany({
    where: { yearJalali: { in: [thisYear, thisYear + 1] } },
    select: { yearJalali: true, source: true, isHoliday: true },
  });
  const year = calendarYearToAnnounce(todayJalali, rows, sentFor);
  if (year === null) return null;

  // Claimed first: a notice lost is a smaller fault than the same one twice.
  await markCalendarYearAnnounced(year, sentFor);

  const admins = await db.user.findMany({
    where: { isSystemAdmin: true, isActive: true },
    select: { id: true },
  });
  for (const admin of admins) {
    await notifyUser({
      userId: admin.id,
      actorUserId: null,
      module: "تنظیمات",
      title: `تقویم تعطیلات سال ${year} بارگذاری نشده است`,
      description: `برای سال ${year} هنوز تعطیلات رسمی (به‌ویژه مناسبت‌های قمری) در تقویم ثبت نشده`
        + ` است و روز کاری وظایف، اقدام‌های بعدی و زمان تحویل پیش‌فاکتورها بدون آن‌ها شمرده می‌شود.`
        + ` از «تنظیمات ← تقویم تعطیلات» سال ${year} را دریافت کنید و در صورت نیاز تعطیلات قمری`
        + ` را با اعلام رسمی تطبیق دهید.`,
    }).catch((err) => console.warn("[holidays] notice failed:", (err as Error)?.message ?? err));
  }
  return year;
}
