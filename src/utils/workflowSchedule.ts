import { addDaysToShamsi, getTodayShamsi } from "../dateUtils";
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
}

export type ScheduleDirection = "after" | "before";

export interface ScheduleSubject {
  /** The date's own name — the sentence around it is built by describeSchedule. */
  label: string;
  /** The Prisma model to sweep. */
  model: "proforma" | "project" | "purchaseOrder" | "packagingDelivery" | "supplierInquiry";
  /** The Jalali column the count starts from. */
  dateField: string;
  /** The trigger name the rule's payload is built for. */
  entityType: string;
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
  },
  proforma_issue: {
    label: "تاریخ صدور پیش‌فاکتور",
    model: "proforma", dateField: "issueDateJalali", entityType: "proforma",
  },
  proforma_expiry: {
    label: "تاریخ اعتبار پیش‌فاکتور",
    model: "proforma", dateField: "expiryDateJalali", entityType: "proforma",
  },
  proforma_delivery: {
    label: "تاریخ تحویل توافق‌شده پیش‌فاکتور",
    model: "proforma", dateField: "deliveryDateJalali", entityType: "proforma",
  },
  project_creation: {
    label: "تاریخ ایجاد پروژه",
    model: "project", dateField: "creationDateJalali", entityType: "project",
  },
  purchase_order_date: {
    label: "تاریخ سفارش خرید",
    model: "purchaseOrder", dateField: "orderDateJalali", entityType: "purchaseOrder",
  },
  purchase_order_arrival: {
    label: "تاریخ تحویل مورد انتظار سفارش خرید",
    model: "purchaseOrder", dateField: "expectedDeliveryDateJalali", entityType: "purchaseOrder",
  },
  delivery_date: {
    label: "تاریخ صدور پکینگ‌لیست",
    model: "packagingDelivery", dateField: "deliveryDateJalali", entityType: "packagingDelivery",
  },
  inquiry_creation: {
    label: "تاریخ ثبت استعلام قیمت",
    model: "supplierInquiry", dateField: "creationDateJalali", entityType: "supplierInquiry",
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
 * How far back a sweep needs to look.
 *
 * A rule that fires 5 days after issue does not need to consider a proforma
 * from two years ago: it was due long before the feature existed, and raising
 * a task for it today would be noise, not automation. The window is generous
 * enough to survive a server that was off for a fortnight.
 */
export const SWEEP_WINDOW_DAYS = 45;

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
): { from: string; to: string } {
  const today = normalizeJalali(todayJalali) ?? todayJalali;
  const offset = Math.max(0, Math.trunc(Number(days) || 0));
  return direction === "before"
    ? { from: addDaysToShamsi(today, -SWEEP_WINDOW_DAYS), to: addDaysToShamsi(today, offset) }
    : { from: addDaysToShamsi(today, -(offset + SWEEP_WINDOW_DAYS)), to: today };
}

/** The sentence a rule reads as: «۳ روز قبل از تاریخ اعتبار پیش‌فاکتور». */
export function describeSchedule(schedule: WorkflowSchedule | undefined): string {
  if (!schedule) return "";
  const subject = SCHEDULE_SUBJECTS[schedule.subject];
  if (!subject) return "";
  const days = Math.max(0, Math.trunc(Number(schedule.days) || 0));
  const side = schedule.direction === "before" ? "قبل از" : "پس از";
  return days === 0
    ? `در روز ${subject.label}`
    : `${toPersianDigits(days)} روز ${side} ${subject.label}`;
}
