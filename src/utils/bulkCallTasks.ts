/**
 * «ساخت وظیفهٔ تماس گروهی» — one task per selected customer, spread over days.
 *
 * Asked for as calling a list of prospects: tick twenty customers, give ten to
 * yourself and ten to a colleague (two presses, one per person — the person
 * decides who gets whom), and do not land all twenty on one morning. Each row
 * becomes an ordinary NEXT_ACTION task related to the customer, so ticking it
 * asks «نتیجهٔ تماس» and the «نتایج تماس» report counts it with nothing new.
 *
 * The pure half: the dates and the titles. The calendar is **injected**, so
 * the rule can be held without one and the server and the form's preview run
 * the same walk.
 */

/** How many customers one press may turn into tasks. */
export const MAX_BULK_CALL_TASKS = 200;
/** The largest «روزی N تماس» the form accepts. */
export const MAX_CALLS_PER_DAY = 50;
/** How far the walk may go looking for a working day before giving up. */
const MAX_DAY_WALK = 3660;

export interface DayCalendar {
  /** The next calendar day, Shamsi «YYYY/MM/DD». */
  nextDay: (date: string) => string;
  /** True for a day nobody works (weekend, holiday). */
  isOff: (date: string) => boolean;
}

/**
 * The due date of each of `count` tasks, `perDay` to a working day.
 *
 * The first day is the start date itself when it is worked, else the first
 * working day after it. `perDay` of zero, negative or absent means «all on one
 * day» — the form's own default when nobody asks for spreading. The walk is
 * bounded: a calendar marking every day off would otherwise spin for ever, so
 * past the bound the remaining tasks share the last day considered (late and
 * visible rather than never).
 */
export function spreadDueDates(
  count: number,
  startDate: string,
  perDay: number | null | undefined,
  calendar: DayCalendar,
): string[] {
  const n = Math.max(0, Math.floor(count));
  if (n === 0 || !startDate) return [];
  const step = perDay && perDay > 0 ? Math.floor(perDay) : n;

  let walked = 0;
  const firstWorking = (from: string): string => {
    let day = from;
    while (calendar.isOff(day) && walked < MAX_DAY_WALK) {
      day = calendar.nextDay(day);
      walked += 1;
    }
    return day;
  };

  const out: string[] = [];
  let day = firstWorking(startDate);
  for (let i = 0; i < n; i += 1) {
    if (i > 0 && i % step === 0 && walked < MAX_DAY_WALK) {
      walked += 1;
      day = firstWorking(calendar.nextDay(day));
    }
    out.push(day);
  }
  return out;
}

/** «تماس تلفنی با پتروشیمی نمونه» — the kind, then the customer. */
export function bulkCallTitle(kind: string, customerName: string): string {
  const k = String(kind ?? "").trim() || "تماس تلفنی";
  const name = String(customerName ?? "").trim();
  return (name ? `${k} با ${name}` : k).slice(0, 400);
}

/**
 * Why a bulk request cannot be made, or null.
 *
 * The same sentences the form shows before it posts and the server answers
 * with, so an integration and a person are refused in the same words.
 */
export function bulkCallRefusal(input: {
  customerIds: readonly unknown[];
  startDate?: string | null;
  perDay?: number | null;
  kind?: string | null;
}): string | null {
  const ids = input.customerIds.filter((id) => typeof id === "string" && id.trim());
  if (ids.length === 0) return "هیچ مشتری‌ای انتخاب نشده است.";
  if (ids.length > MAX_BULK_CALL_TASKS) {
    return `در هر بار حداکثر ${MAX_BULK_CALL_TASKS} مشتری را می‌توان انتخاب کرد.`;
  }
  if (!String(input.kind ?? "").trim()) return "نوع اقدام را انتخاب کنید.";
  if (!/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(String(input.startDate ?? "").trim())) {
    return "تاریخ شروع را وارد کنید.";
  }
  const perDay = input.perDay;
  if (perDay != null && (perDay < 0 || perDay > MAX_CALLS_PER_DAY || !Number.isFinite(perDay))) {
    return `تعداد در روز باید بین ۱ و ${MAX_CALLS_PER_DAY} باشد.`;
  }
  return null;
}
