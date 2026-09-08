import { addDaysToShamsi, getShamsiDaysDifference, getTodayShamsi } from "../dateUtils";
import { toPersianDigits } from "../numUtils";
import { normalizeJalali } from "../server/dates";

/**
 * Time-based workflow triggers: "N days after X, do Y".
 *
 * Every rule until now fired on something a person did — a proforma was
 * issued, a status changed. The cases that matter most in sales are the
 * opposite: nothing happened. A quotation sent ten days ago that nobody has
 * followed up, an order whose expected arrival has come and gone. No event
 * marks those, so nothing could ever trigger on them.
 *
 * Shared by both sides: the settings screen builds a rule from these
 * definitions and the server's sweep reads the same ones, so a subject cannot
 * be offered in the editor and be unknown to the engine.
 *
 * A scheduled rule names a **date already on the record** and a number of days
 * after it. Once that day arrives, the rule fires for that record exactly once
 * — the firing is written down (`workflow_firings`), because a sweep runs
 * daily and a task raised again every morning is worse than no task at all.
 *
 * The rule's ordinary conditions still apply, so «۵ روز پس از تاریخ صدور
 * پیش‌فاکتورهایی که وضعیتشان ارسال شده است» is a status condition plus a
 * schedule, not a separate concept.
 */

export interface WorkflowSchedule {
  /** Which date, on which record — a key of SCHEDULE_SUBJECTS. */
  subject: string;
  /** How many days from it. Zero means "on the day itself". Never negative. */
  days: number;
  /**
   * Which side of the date.
   *
   * "before" is the reminder half of the feature — three days *before* a
   * quotation expires, two days before an order is due in — and it is a
   * direction rather than a negative number of days on purpose: a rule reading
   * «−۳ روز پس از تاریخ اعتبار» is a puzzle, and a form that accepts a minus
   * sign invites one to be typed by accident. Absent means "after", which is
   * what every rule written before this existed meant.
   */
  direction?: "after" | "before";
  /**
   * Fire again every N days while the record still matches. Absent or 0 means
   * once and never again, which is what every rule written before this meant.
   *
   * One reminder is the right shape for «۳ روز پس از ارسال، پیگیری کن» and the
   * wrong one for the case this whole line of work started from: the supplier
   * has not answered for a week, somebody is reminded once, nobody acts, and
   * nothing ever asks again. A repeat is only safe now that `closeWhenResolved`
   * exists — without it the loop had no way to end except a counter, and a
   * counter is a guess about how long the problem will last.
   */
  repeatEveryDays?: number;
  /**
   * Stop after this many firings. Absent or 0 is no ceiling.
   *
   * The ceiling is deliberately **not** how a repeat is meant to end — the
   * record moving on is, which is what `closeWhenResolved` retires the reminder
   * for. It is a stop for the case nobody planned: a record that stays stuck
   * for a year should not still be raising its 120th card.
   */
  maxOccurrences?: number;
}

export type ScheduleDirection = "after" | "before";

export interface ScheduleSubject {
  /** The date's own name — the sentence around it is built by describeSchedule. */
  label: string;
  /** The Prisma model to sweep. */
  model:
    | "proforma" | "project" | "purchaseOrder" | "packagingDelivery"
    | "supplierInquiry" | "afterSalesService";
  /** The Jalali column the count starts from. */
  dateField: string;
  /** The trigger name the rule's payload is built for. */
  entityType: string;
  /**
   * The payload key that names **the record this fired on**.
   *
   * The sweep spreads the row it found, so the id arrived as plain `id` and
   * nothing downstream looks for that: `enrichPayload` reads `proformaId` to
   * resolve the document's project, and `create_task` reads it to decide what
   * the task is *about*. So every scheduled rule raised a task attached to the
   * wrong record or to none — and a `SALES_FOLLOW_UP` filed against a project
   * cannot be closed **at all**, because `completeFollowUp` refuses anything
   * whose `relatedToType` is not «proforma» and the ordinary tick refuses a
   * follow-up. The task simply sat on the board for ever.
   *
   * Spelled out per subject rather than derived as `${entityType}Id`, so the
   * key is visible beside the model it names and `test:rules` can hold it
   * against the keys the engine actually reads.
   */
  payloadIdKey: string;
}

/**
 * The dates a rule may count from.
 *
 * Only dates the records already carry: a schedule that needed a new column
 * would be a schedule nobody could set up today.
 */
export const SCHEDULE_SUBJECTS: Record<string, ScheduleSubject> = {
  /*
   * The day the quotation went to the customer — the one people actually
   * schedule from. It is stamped when the status becomes «ارسال شده» (see
   * proformaService.stampSentDate); the issue date beneath it is the day the
   * document was written, which is a different day whenever a draft waits.
   */
  proforma_sent: {
    label: "ارسال پیش‌فاکتور به کارفرما",
    model: "proforma", dateField: "sentDateJalali", entityType: "proforma",
    payloadIdKey: "proformaId",
  },
  proforma_issue: {
    label: "تاریخ صدور پیش‌فاکتور",
    model: "proforma", dateField: "issueDateJalali", entityType: "proforma",
    payloadIdKey: "proformaId",
  },
  proforma_expiry: {
    label: "تاریخ اعتبار پیش‌فاکتور",
    model: "proforma", dateField: "expiryDateJalali", entityType: "proforma",
    payloadIdKey: "proformaId",
  },
  proforma_delivery: {
    label: "تاریخ تحویل توافق‌شده پیش‌فاکتور",
    model: "proforma", dateField: "deliveryDateJalali", entityType: "proforma",
    payloadIdKey: "proformaId",
  },
  project_creation: {
    label: "تاریخ ایجاد پروژه",
    model: "project", dateField: "creationDateJalali", entityType: "project",
    payloadIdKey: "projectId",
  },
  purchase_order_date: {
    label: "تاریخ سفارش خرید",
    model: "purchaseOrder", dateField: "orderDateJalali", entityType: "purchaseOrder",
    payloadIdKey: "purchaseOrderId",
  },
  purchase_order_arrival: {
    label: "تاریخ تحویل مورد انتظار سفارش خرید",
    model: "purchaseOrder", dateField: "expectedDeliveryDateJalali", entityType: "purchaseOrder",
    payloadIdKey: "purchaseOrderId",
  },
  delivery_date: {
    label: "تاریخ صدور پکینگ‌لیست",
    model: "packagingDelivery", dateField: "deliveryDateJalali", entityType: "packagingDelivery",
    payloadIdKey: "packagingDeliveryId",
  },
  inquiry_creation: {
    label: "تاریخ ثبت استعلام قیمت",
    model: "supplierInquiry", dateField: "creationDateJalali", entityType: "supplierInquiry",
    payloadIdKey: "supplierInquiryId",
  },

  /*
   * ------------------------ «چقدر در این وضعیت مانده» ------------------------
   *
   * The three subjects that answer «how long has this been stuck», which no
   * date the records already carried could answer.
   *
   * They are ordinary schedule subjects rather than a new kind of trigger, and
   * that is the whole design: «N days after this date» plus the rule's own
   * condition on the status *is* a dwell rule. «۱۰ روز پس از آخرین تغییر
   * وضعیت، در صورتی که وضعیت «حمل و ترانزیت» است» needs nothing the engine did
   * not already have — a second trigger type would have been a second copy of
   * the sweep, the firing guard and the condition evaluator.
   *
   * The date each counts from is written only on a real move
   * (`statusChangeColumns`, and `syncProjectStage` for the project), which is
   * what makes it mean «since when» rather than «last saved».
   */
  purchase_order_status_changed: {
    label: "آخرین تغییر وضعیت سفارش خرید",
    model: "purchaseOrder", dateField: "statusChangedAtJalali", entityType: "purchaseOrder",
    payloadIdKey: "purchaseOrderId",
  },
  after_sales_status_changed: {
    label: "آخرین تغییر وضعیت خدمات پس از فروش",
    model: "afterSalesService", dateField: "statusChangedAtJalali",
    entityType: "afterSalesService", payloadIdKey: "afterSalesServiceId",
  },
  /*
   * The project needed no new column: `stageChangedAt` has meant «since when»
   * since the stage existed. And because the stage now reaches back before any
   * quotation (20260916, PR #124), «۷ روز در انتظار پاسخ تأمین‌کننده مانده» is
   * a rule this subject can express — the original supplier-chase case, reached
   * through the project rather than through a column on the inquiry.
   */
  project_stage_changed: {
    label: "آخرین تغییر مرحله پروژه",
    model: "project", dateField: "stageChangedAtJalali", entityType: "project",
    payloadIdKey: "projectId",
  },
};

/** The trigger name a scheduled rule carries. */
export const TIME_TRIGGER = "time_elapsed";

export interface SchedulableRule {
  id?: string;
  active?: boolean;
  triggerType?: string;
  schedule?: WorkflowSchedule;
}

/**
 * The rules a daily sweep has to consider: active, scheduled, and pointing at a
 * date this application knows about.
 */
export function scheduledRules<T extends SchedulableRule>(rules: T[] | undefined): T[] {
  return (rules ?? []).filter(
    (r) => r?.active !== false
      && r?.triggerType === TIME_TRIGGER
      && !!r.schedule
      && !!SCHEDULE_SUBJECTS[r.schedule.subject],
  );
}

/**
 * The day a rule becomes due for a record whose base date is `baseJalali`.
 *
 * Returns null for a record with no such date — an order with no expected
 * arrival is not overdue, it is unscheduled.
 */
export function dueDay(
  baseJalali: string | null | undefined,
  days: number,
  direction: ScheduleDirection = "after",
): string | null {
  const base = normalizeJalali(baseJalali);
  if (!base) return null;
  const offset = Math.max(0, Math.trunc(Number(days) || 0));
  return addDaysToShamsi(base, direction === "before" ? -offset : offset);
}

/**
 * Whether that day has arrived.
 *
 * Compared as text: both sides are `YYYY/MM/DD` with the parts zero-padded by
 * `normalizeJalali`, and in that shape the calendar order and the alphabetical
 * order are the same one.
 */
export function isDue(
  baseJalali: string | null | undefined,
  days: number,
  todayJalali = getTodayShamsi(),
  direction: ScheduleDirection = "after",
): boolean {
  const due = dueDay(baseJalali, days, direction);
  const today = normalizeJalali(todayJalali);
  if (!due || !today) return false;
  return normalizeJalali(due)! <= today;
}

/**
 * Which firing of a repeating rule has come due for this record, 1-based.
 *
 * Zero means «not due yet». One means the first and only firing of an ordinary
 * rule — a schedule with no repeat answers 1 for ever, which is exactly what it
 * used to do with no number at all.
 *
 * It is **derived from the dates, never counted from the rows already written**,
 * the same rule `planHijriShift` follows: asking the same question twice gives
 * the same answer, and a firing the sweep never got to leaves no gap behind it.
 * That is also what decides the catch-up behaviour, which is the half worth
 * being deliberate about — a server that was off for a fortnight comes back and
 * fires **one** reminder, the occurrence that is due *now*, rather than the five
 * it missed. Five cards on one order the morning the server returns is the board
 * noise this feature exists to avoid, in its purest form.
 *
 * A `maxOccurrences` ceiling stops it: past the ceiling it answers 0, so the
 * record simply stops being reminded about rather than being reminded for ever.
 */
export function occurrenceDue(
  baseJalali: string | null | undefined,
  days: number,
  todayJalali = getTodayShamsi(),
  direction: ScheduleDirection = "after",
  repeatEveryDays?: number | null,
  maxOccurrences?: number | null,
): number {
  const first = dueDay(baseJalali, days, direction);
  const today = normalizeJalali(todayJalali);
  if (!first || !today) return 0;
  const firstDue = normalizeJalali(first)!;
  if (firstDue > today) return 0;

  const every = Math.max(0, Math.trunc(Number(repeatEveryDays) || 0));
  const ceiling = Math.max(0, Math.trunc(Number(maxOccurrences) || 0));

  // No repeat: the first firing is the only one there will ever be, and no
  // ceiling of one or more can forbid it.
  if (every === 0) return 1;

  const elapsed = Math.max(0, getShamsiDaysDifference(firstDue, today));
  const n = 1 + Math.floor(elapsed / every);
  return ceiling > 0 && n > ceiling ? 0 : n;
}

/**
 * Whether a schedule repeats at all — one reading, so the sweep, the editor and
 * the sentence beneath it cannot disagree about what «۰ روز» means.
 */
export function scheduleRepeats(schedule: WorkflowSchedule | undefined): boolean {
  return Math.max(0, Math.trunc(Number(schedule?.repeatEveryDays) || 0)) > 0;
}

/**
 * How far back a sweep needs to look.
 *
 * A rule that fires 5 days after issue does not need to consider a proforma
 * from two years ago: it was due long before the feature existed, and raising
 * a task for it today would be noise, not automation. The window is generous
 * enough to survive a server that was off for a fortnight.
 */
export const SWEEP_WINDOW_DAYS = 45;

/**
 * The same window for a rule that repeats, and it has to be far larger.
 *
 * A one-shot rule that was due two months ago is history: it fired then, or the
 * feature did not exist, and raising it today would be noise. A **repeating**
 * rule is the opposite — the record is still stuck, which is the entire thing
 * being reported — so a 45-day lookback would silently stop chasing exactly the
 * orders that have been ignored longest, which is the worst possible place for
 * it to give up. A year back, and `take` still bounds what is read.
 */
export const REPEAT_SWEEP_WINDOW_DAYS = 365;

/**
 * The band of base dates a sweep has to look at.
 *
 * Counting **after** a date, a record is due once its date is far enough in the
 * past, so the band runs backwards from today. Counting **before** one, the
 * record is due while its date is still ahead — up to `days` ahead — so the
 * band has to reach into the future as well, or a rule reminding somebody three
 * days before an expiry would never see the document it is about.
 */
export function sweepRange(
  days: number,
  todayJalali = getTodayShamsi(),
  direction: ScheduleDirection = "after",
  lookbackDays: number = SWEEP_WINDOW_DAYS,
): { from: string; to: string } {
  const today = normalizeJalali(todayJalali) ?? todayJalali;
  const offset = Math.max(0, Math.trunc(Number(days) || 0));
  const back = Math.max(0, Math.trunc(Number(lookbackDays) || 0));
  return direction === "before"
    ? { from: addDaysToShamsi(today, -back), to: addDaysToShamsi(today, offset) }
    : { from: addDaysToShamsi(today, -(offset + back)), to: today };
}

/** The sentence a rule reads as: «۳ روز قبل از تاریخ اعتبار پیش‌فاکتور». */
export function describeSchedule(schedule: WorkflowSchedule | undefined): string {
  if (!schedule) return "";
  const subject = SCHEDULE_SUBJECTS[schedule.subject];
  if (!subject) return "";
  const days = Math.max(0, Math.trunc(Number(schedule.days) || 0));
  const side = schedule.direction === "before" ? "قبل از" : "پس از";
  const base = days === 0
    ? `در روز ${subject.label}`
    : `${toPersianDigits(days)} روز ${side} ${subject.label}`;

  // The repeat is part of the sentence, not a second line: a rule that fires
  // every three days for ever and one that fires once read identically without
  // it, and the difference is the whole point of setting it.
  if (!scheduleRepeats(schedule)) return base;
  const every = Math.max(0, Math.trunc(Number(schedule.repeatEveryDays) || 0));
  const ceiling = Math.max(0, Math.trunc(Number(schedule.maxOccurrences) || 0));
  const tail = ceiling > 0
    ? `و سپس هر ${toPersianDigits(every)} روز، حداکثر ${toPersianDigits(ceiling)} بار`
    : `و سپس هر ${toPersianDigits(every)} روز تا زمانی که شرط برقرار است`;
  return `${base} ${tail}`;
}
