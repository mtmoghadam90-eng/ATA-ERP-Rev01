/**
 * A reminder that comes back — and the rule for when it is owed.
 *
 * A reminder used to be one moment: `reminderEnabled` plus a Shamsi date and a
 * time, matched by the browser's ten-second poll against **exactly** the
 * current minute. That has two consequences, and the second is what makes
 * repeating impossible rather than merely missing.
 *
 * **It fires only inside its own minute.** A reminder set for 09:00 on a
 * machine whose browser is opened at 09:05 is never seen — not late, never.
 * For a one-off that is a bad afternoon; for «هر دوشنبه ساعت ۹» it is the whole
 * feature, missed every week for ever, and the honest report would be «تکرار
 * کار نمی‌کند». So a reminder is owed from its own time **until the end of its
 * own day**, and is acknowledged rather than merely closed.
 *
 * **The catch-up is bounded to that day, deliberately.** Reading every past
 * reminder as still owed would empty months of history onto the first person to
 * sign in after this ships — the same fault the dwell migration avoided by
 * backfilling nothing. Yesterday's reminder has gone; the *task* is still on
 * the board with its due date, which is the durable record. A reminder is a
 * nudge, not a ledger.
 *
 * Everything here is pure and clock-free — the day and the time are arguments —
 * so `test:rules` can hold it, and the server and the browser read one rule.
 */

import { addDaysToShamsi, getShamsiDaysDifference, gregorianToJalali, jalaliToGregorian } from "../dateUtils";

/* ------------------------------- the periods ------------------------------ */

/**
 * The periods offered, named rather than a number of days.
 *
 * «هر ۳۰ روز» is not «ماهانه» in this calendar: the first six Shamsi months are
 * 31 days, the next five are 30 and Esfand is 29 or 30, so a rule counted in
 * days would drift a month at a time. Only the first three are day-counted; the
 * last two move by calendar field.
 */
export const REMINDER_REPEATS = ["DAILY", "WEEKLY", "BIWEEKLY", "MONTHLY", "YEARLY"] as const;
export type ReminderRepeat = (typeof REMINDER_REPEATS)[number];

export const REMINDER_REPEAT_LABELS: Record<ReminderRepeat, string> = {
  DAILY: "روزانه",
  WEEKLY: "هفتگی",
  BIWEEKLY: "هر دو هفته",
  MONTHLY: "ماهانه",
  YEARLY: "سالانه",
};

/** How many days each day-counted period steps; the other two are not days. */
const DAY_STEP: Partial<Record<ReminderRepeat, number>> = {
  DAILY: 1, WEEKLY: 7, BIWEEKLY: 14,
};

/**
 * A stored value, or null for «no repeat».
 *
 * **Absent is off**, so every reminder already on disk keeps behaving exactly as
 * it did, and a value this build does not know reads as off rather than as
 * something invented — a reminder that repeats on a rule nobody can name is
 * worse than one that does not repeat.
 */
export function normalizeRepeat(value: unknown): ReminderRepeat | null {
  const key = String(value ?? "").trim().toUpperCase();
  return (REMINDER_REPEATS as readonly string[]).includes(key) ? (key as ReminderRepeat) : null;
}

/* ------------------------------ Shamsi pieces ----------------------------- */

export interface JalaliParts { y: number; m: number; d: number }

/** `YYYY/MM/DD`, or null for anything that is not one. */
export function parseJalali(value: unknown): JalaliParts | null {
  const m = /^(\d{4})\/(\d{2})\/(\d{2})$/.exec(String(value ?? "").trim());
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { y, m: mo, d };
}

const pad = (n: number) => String(n).padStart(2, "0");
export const formatJalali = (p: JalaliParts) => `${p.y}/${pad(p.m)}/${pad(p.d)}`;

/**
 * How many days a Shamsi month has.
 *
 * The leap year is **derived by round-tripping 30 Esfand through the converter
 * this application already has**, never by a second leap-year algorithm. A
 * private copy of that arithmetic is one more thing to keep in step with
 * `jalaliToGregorian`, and the two disagreeing once every few years is exactly
 * the kind of fault nobody would find.
 */
export function shamsiMonthLength(y: number, m: number): number {
  if (m >= 1 && m <= 6) return 31;
  if (m >= 7 && m <= 11) return 30;
  const [gy, gm, gd] = jalaliToGregorian(y, 12, 30);
  const [ry, rm, rd] = gregorianToJalali(gy, gm, gd);
  return ry === y && rm === 12 && rd === 30 ? 30 : 29;
}

/**
 * The anchor's day-of-month, brought into a month that may be shorter.
 *
 * A monthly reminder set on the 31st is **clamped to the last day**, not
 * skipped. Skipping is what a strict reading gives — and it would silently drop
 * the reminder for Mehr through Esfand, so «ماهانه» would fire six months a
 * year. Somebody who asked for a monthly reminder means every month.
 */
function clampDay(day: number, y: number, m: number): number {
  return Math.min(day, shamsiMonthLength(y, m));
}

/** `anchor` moved `k` whole months, the day clamped into the month it lands in. */
function addMonths(anchor: JalaliParts, k: number): JalaliParts {
  const total = (anchor.y * 12 + (anchor.m - 1)) + k;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  return { y, m, d: clampDay(anchor.d, y, m) };
}

/* ------------------------------- occurrences ------------------------------ */

/**
 * Does the series anchored at `anchorDate` fall on `day`?
 *
 * Arithmetic in every branch and no walk: an unbounded `while` advancing a date
 * until it reaches the target is what spun the working-day helper's main thread
 * before it was bounded, and there is no reason to repeat it here.
 */
export function repeatOccursOn(
  anchorDate: string,
  repeat: ReminderRepeat | null,
  day: string,
): boolean {
  const rule = normalizeRepeat(repeat);
  const anchor = parseJalali(anchorDate);
  const target = parseJalali(day);
  if (!rule || !anchor || !target) return false;
  // A series never reaches back before its own anchor.
  if (day < anchorDate) return false;

  const step = DAY_STEP[rule];
  if (step) {
    const diff = getShamsiDaysDifference(anchorDate, day);
    return diff >= 0 && diff % step === 0;
  }
  if (rule === "MONTHLY") {
    const months = (target.y - anchor.y) * 12 + (target.m - anchor.m);
    return months >= 0 && target.d === clampDay(anchor.d, target.y, target.m);
  }
  // YEARLY — the same month and day, clamped so 30 Esfand survives a common year.
  return target.y >= anchor.y
    && target.m === anchor.m
    && target.d === clampDay(anchor.d, target.y, target.m);
}

/**
 * The first occurrence on or after `from`, or null once the series has ended.
 *
 * Used to tell somebody when a repeating reminder will next speak, which is the
 * one thing a repeat rule cannot be read off a date and a period.
 */
export function nextOccurrenceOnOrAfter(
  anchorDate: string,
  repeat: ReminderRepeat | null,
  from: string,
  until?: string | null,
): string | null {
  const rule = normalizeRepeat(repeat);
  const anchor = parseJalali(anchorDate);
  const start = parseJalali(from);
  if (!rule || !anchor || !start) return null;

  let hit: string | null = null;
  if (from <= anchorDate) {
    hit = anchorDate;
  } else {
    const step = DAY_STEP[rule];
    if (step) {
      const diff = getShamsiDaysDifference(anchorDate, from);
      hit = addDaysToShamsi(anchorDate, Math.ceil(diff / step) * step);
    } else {
      const span = rule === "MONTHLY"
        ? (start.y - anchor.y) * 12 + (start.m - anchor.m)
        : (start.y - anchor.y) * 12;
      const stride = rule === "MONTHLY" ? 1 : 12;
      const candidate = addMonths(anchor, Math.max(0, span));
      hit = formatJalali(candidate) >= from
        ? formatJalali(candidate)
        : formatJalali(addMonths(anchor, Math.max(0, span) + stride));
    }
  }

  const stop = String(until ?? "").trim();
  if (hit && stop && hit > stop) return null;
  return hit;
}

/* --------------------------- what is owed, and when ----------------------- */

/** What a reminder is, to the rule — the server row and the client row alike. */
export interface ReminderFacts {
  reminderEnabled?: boolean | null;
  /** This occurrence: where a one-off lives, and where a snooze writes. */
  reminderDateJalali?: string | null;
  reminderTime?: string | null;
  reminderRepeat?: string | null;
  /** The series' own date and time, `YYYY/MM/DD HH:MM`. */
  reminderAnchor?: string | null;
  reminderRepeatUntilJalali?: string | null;
  /** The occurrence already answered, in the same `YYYY/MM/DD HH:MM` spelling. */
  reminderAckedFor?: string | null;
}

/** How one occurrence is named, so an acknowledgement can only match that one. */
export const occurrenceKey = (day: string, time: string) => `${day} ${time}`;

/** Splits an anchor back into its day and its time. */
export function splitAnchor(anchor: unknown): { date: string; time: string } | null {
  const m = /^(\d{4}\/\d{2}\/\d{2})[ T](\d{2}:\d{2})$/.exec(String(anchor ?? "").trim());
  return m ? { date: m[1], time: m[2] } : null;
}

/**
 * The occurrence this reminder owes right now, or null.
 *
 * The order of the three branches is the whole rule, and each is a decision.
 *
 * **A date in the future silences today.** That is what a snooze into tomorrow
 * means, and without this branch a daily series would speak anyway on the very
 * day somebody had just pushed it away.
 *
 * **Today's stored date wins over the series.** A snooze moves *this*
 * occurrence and must not move the series, so the anchor is left alone and the
 * moved time is read from here — the same shape as `planHijriShift` keeping the
 * date the source gave beside the date in force.
 *
 * **Otherwise the series decides.** A repeating reminder's stored date is
 * whatever its last occurrence or snooze left behind and drifts into the past;
 * the anchor is what the series is actually made of.
 */
export function dueReminderAt(
  facts: ReminderFacts,
  todayJalali: string,
  nowTime: string,
): string | null {
  if (!facts.reminderEnabled) return null;

  const stored = String(facts.reminderDateJalali ?? "").trim();
  const storedTime = String(facts.reminderTime ?? "").trim();
  let time: string | null = null;

  if (stored && stored > todayJalali) return null;
  if (stored === todayJalali && storedTime) {
    time = storedTime;
  } else {
    const anchor = splitAnchor(facts.reminderAnchor);
    const rule = normalizeRepeat(facts.reminderRepeat);
    const until = String(facts.reminderRepeatUntilJalali ?? "").trim();
    if (!anchor || !rule) return null;
    if (until && todayJalali > until) return null;
    if (!repeatOccursOn(anchor.date, rule, todayJalali)) return null;
    time = anchor.time;
  }

  if (!time) return null;
  // Its own minute has to have come; the rest of the day is the catch-up.
  if (time > nowTime) return null;

  const key = occurrenceKey(todayJalali, time);
  return String(facts.reminderAckedFor ?? "").trim() === key ? null : key;
}

/**
 * A sentence for the reminder, for a card that has one line to spend on it.
 *
 * Clock-free like the rest: the day it is read against is an argument, so the
 * same facts always produce the same words.
 */
export function describeReminder(facts: ReminderFacts, todayJalali: string): string {
  const rule = normalizeRepeat(facts.reminderRepeat);
  const anchor = splitAnchor(facts.reminderAnchor);
  const time = String(facts.reminderTime ?? "").trim();
  if (!rule || !anchor) return time;

  const next = nextOccurrenceOnOrAfter(
    anchor.date, rule, todayJalali, facts.reminderRepeatUntilJalali,
  );
  const period = REMINDER_REPEAT_LABELS[rule];
  if (!next) return `${anchor.time} · ${period} (پایان‌یافته)`;
  return next === todayJalali
    ? `${anchor.time} · ${period} · امروز`
    : `${anchor.time} · ${period} · بعدی: ${next}`;
}
