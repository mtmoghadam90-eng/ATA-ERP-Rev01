/**
 * «چه چیزی روی زمین مانده، و چند روز؟»
 *
 * The workflow engine can now *act* on a record that has sat still — the three
 * dwell schedule subjects, the repeat, the escalation and the auto-close. All of
 * it needs somebody to have set a rule up first, and a rule fires on records one
 * at a time: nothing anywhere answered the plain question a manager opens the
 * week with, which is what is stuck **across the whole chain** and how badly.
 *
 * The evidence has been on disk since the dwell columns shipped
 * (`20260917000000_status_dwell` and `Project.stageChangedAt` before it). This
 * is the reading of it, and it deliberately writes nothing and needs no rule: a
 * report that has to be configured before it says anything is a report that
 * reads as broken on the day it ships, which is exactly how the settle-the-sale
 * feature was reported.
 *
 * Everything here is pure and clock-free — the day is an argument — so
 * `test:rules` can hold it.
 */

import { PURCHASE_ORDER_STATUSES, AFTER_SALES_STATUSES } from "./moduleStatuses";
import { PROJECT_STAGES, STAGE_FOR_PO_STATUS } from "./projectStage";
import { getShamsiDaysDifference } from "../dateUtils";
import { normalizeJalali } from "../server/dates";

/** The three clocks this reads, each on its own record. */
export const STUCK_SECTIONS = ["purchaseOrder", "afterSales", "projectStage"] as const;
export type StuckSection = (typeof STUCK_SECTIONS)[number];

export const STUCK_SECTION_LABELS: Record<StuckSection, string> = {
  purchaseOrder: "سفارش‌های خرید",
  afterSales: "خدمات پس از فروش",
  projectStage: "پروژه‌ها",
};

/**
 * How many days in a state before it counts as stuck, per state.
 *
 * A **single** number across the chain would have made this noise on day one:
 * «در حال آماده‌سازی سازنده» is months of ordinary manufacturing lead time and
 * «ترخیص گمرک» is days, so one threshold either screams about every order in
 * production or never notices one stranded at customs.
 *
 * These are **defaults, not policy** — the company's own rhythms are not
 * knowable from here, and `settings.stuckThresholds` overrides any of them. But
 * shipping *no* defaults would mean a screen that says nothing until somebody
 * fills in a form they have not been told about, which is the same failure as a
 * dropdown missing the entry the feature keys on.
 */
export const DEFAULT_STUCK_THRESHOLDS: Record<StuckSection, Record<string, number>> = {
  /*
   * The imported-goods chain. The long legs are long on purpose: an order that
   * has been at the manufacturer for six weeks is not late, it is being made.
   */
  purchaseOrder: {
    /*
     * A draft order is watched on the **project**, not here.
     *
     * `STAGE_FOR_PO_STATUS` maps «پیش‌نویس» to «برنده — در انتظار تأمین», and a
     * won job with no order raised at all lands on that same stage — so the
     * project is the only record that can report both halves of «فروختیم و
     * هنوز سفارش نداده‌ایم», while an order that does not exist yet obviously
     * cannot report itself. Watching both would report one stall twice, and of
     * the two the project is the record that names the job and the customer.
     */
    "پیش‌نویس": 0,
    "پرداخت و سفارش به سازنده": 21,
    "در حال آماده‌سازی سازنده": 60,
    "حمل و ترانزیت": 45,
    "ترخیص گمرک": 21,
    "در حال حمل به انبار": 7,
    // Received. Zero is «never stuck here», and it is a real answer rather than
    // an omission: counting days since an order arrived would report every
    // completed purchase in the company as the worst problem on the list.
    "تحویل شده (رسید انبار)": 0,
  },
  afterSales: {
    "در حال بررسی": 5,
    "در حال تعمیر/خدمات": 14,
    // Finished and not handed back *is* a stall, and the one nobody sees.
    "تکمیل شده": 7,
    "تحویل داده شده": 0,
  },
  /*
   * The project's own clock covers the legs no other section can see: before a
   * purchase order is moving, and after the goods have landed.
   *
   * The middle of the chain is **deliberately zero**. A project in «حمل و
   * ترانزیت» and its purchase order in «حمل و ترانزیت» are one fact, and
   * reporting it twice would make the list read as double the problem it is —
   * so it is reported on the purchase order, which is the record somebody can
   * actually act on.
   *
   * `STAGE_FOR_PO_STATUS` is what says which stages those are, and the rule is
   * an exact **complement** rather than a blanket exclusion: a project stage is
   * watched here **exactly when** the purchase-order status that maps onto it
   * is not. That is what makes «counted once» a property this table can be
   * checked against instead of a claim in a comment, and it settles both ends
   * of the chain by construction — a *draft* order is watched on the project
   * (the same stage is reached with no order at all) and a *received* one hands
   * over to the packing list, which is the project's again. `test:rules` holds
   * the complement in both directions, so a status added to either module
   * cannot start being counted twice or stop being counted at all.
   */
  projectStage: {
    "جدید": 5,
    "در حال مذاکره": 14,
    // The case this whole line of work started from: an inquiry sent to a
    // supplier who never answered, with nobody chasing it.
    "در انتظار پاسخ تأمین‌کننده": 7,
    "بررسی پیشنهاد تأمین‌کننده": 5,
    "تهیه پیش‌فاکتور": 5,
    /*
     * Long on purpose. The sales follow-up queue already answers «what should
     * the sales desk do next» per quotation, with its own health badge, so a
     * short threshold here would repeat that whole screen in another vocabulary.
     * Thirty days is far past any chase interval, so what surfaces is a job the
     * queue has genuinely lost rather than one being worked.
     */
    "پیگیری پیش‌فاکتور": 30,
    "باخته": 0,
    "لغو شده": 0,
    /*
     * Won, and nobody has raised a purchase order. Covered by **nothing** else —
     * the order does not exist yet, so the order's own clock cannot report it —
     * and it is the most expensive stall in the chain, because the customer is
     * already waiting.
     */
    /*
     * Won, and no order is moving — either none has been raised at all or one
     * is still a draft. Covered by nothing else, and the most expensive stall
     * in the chain, because the customer is already waiting.
     */
    "برنده — در انتظار تأمین": 10,
    "حواله و پرداخت به سازنده": 0,
    "در حال آماده‌سازی سازنده": 0,
    "حمل و ترانزیت": 0,
    "ترخیص گمرک": 0,
    "حمل به انبار": 0,
    "بسته‌بندی و تحویل": 10,
    "تحویل شده": 0,
    // The after-sales record has its own clock and its own section.
    "خدمات پس از فروش": 0,
    "خاتمه‌یافته": 0,
  },
};

/**
 * What a state this build does not know is worth.
 *
 * Watched rather than skipped, the same decision `deriveProjectStage` makes for
 * an unmapped purchase-order status: a record whose state nothing recognises is
 * the *last* one to report as fine.
 */
export const FALLBACK_STUCK_DAYS = 14;

/** The overridable half, as it is stored on the settings document. */
export interface StuckThresholdSettings {
  purchaseOrder?: Record<string, number>;
  afterSales?: Record<string, number>;
  projectStage?: Record<string, number>;
}

/**
 * The threshold in force for one state.
 *
 * A stored value wins over the default — including a stored **zero**, which is
 * how somebody says «we never chase this state»; reading zero as «not
 * configured» would make that setting impossible to express, which is the
 * `absent ≠ empty` rule in its numeric form.
 */
export function thresholdFor(
  section: StuckSection,
  state: string | null | undefined,
  settings?: StuckThresholdSettings | null,
): number {
  const key = String(state ?? "").trim();
  const stored = settings?.[section]?.[key];
  if (typeof stored === "number" && Number.isFinite(stored)) {
    return Math.max(0, Math.trunc(stored));
  }
  const fallback = DEFAULT_STUCK_THRESHOLDS[section]?.[key];
  return typeof fallback === "number" ? fallback : FALLBACK_STUCK_DAYS;
}

/**
 * How long the record has been where it is.
 *
 * **Null is not zero and it is not «for ever».** The dwell migration backfilled
 * nothing, deliberately — NULL means «this application has never seen this
 * record move» — so reading it as «stuck since the beginning of time» would put
 * every order that existed before the column at the top of the list on the day
 * this ships, which is the report being wrong in the loudest way available. It
 * is counted and named as unmeasured instead of being silently dropped, because
 * a record nobody can see is worse than one labelled «نامشخص».
 */
export function dwellDays(
  sinceJalali: string | null | undefined,
  todayJalali: string,
): number | null {
  const since = normalizeJalali(sinceJalali);
  const today = normalizeJalali(todayJalali);
  if (!since || !today) return null;
  return Math.max(0, getShamsiDaysDifference(since, today));
}

export type StuckSeverity = "OK" | "WARN" | "OVERDUE";

/**
 * Where in its allowance the record is.
 *
 * The band exists because a bare boolean makes the report a cliff — nothing,
 * nothing, nothing, crisis — and the whole use of the screen is seeing what is
 * *about to* go wrong while there is still time to make a call. `WARN_FRACTION`
 * is where the amber starts.
 */
export const WARN_FRACTION = 0.75;

export function severityFor(dwell: number | null, threshold: number): StuckSeverity {
  // Zero is «never stuck here», so nothing in that state is ever reported.
  if (threshold <= 0 || dwell === null) return "OK";
  if (dwell >= threshold) return "OVERDUE";
  return dwell >= threshold * WARN_FRACTION ? "WARN" : "OK";
}

/**
 * How far past its own allowance, as a proportion.
 *
 * The ranking, and the sharp part of the design. Sorting by **days** would put
 * every long-lead-time leg permanently at the top: an order 20 days into a
 * 60-day manufacturing window would outrank one 3 days past a 2-day handover,
 * when the second is the one going wrong. A proportion compares each record
 * against what it was allowed, which is the only comparison that means anything
 * across legs of wildly different lengths.
 */
export function overdueRatio(dwell: number | null, threshold: number): number {
  if (threshold <= 0 || dwell === null) return 0;
  return dwell / threshold;
}

/* -------------------------------------------------------------------------- */

/**
 * Which project stage each purchase-order status stands for, as pairs.
 *
 * The complement rule above needs both halves side by side, and the values are
 * numbers, so TypeScript cannot say «exactly one of these two must be zero» —
 * `test:rules` holds it instead, in both directions. Without that, one container
 * in transit reads as two problems, or a leg falls between the two tables and
 * is watched by neither.
 */
export const PO_STAGE_PAIRS: readonly { poStatus: string; stage: string }[] =
  Object.entries(STAGE_FOR_PO_STATUS).map(([poStatus, stage]) => ({ poStatus, stage }));

/*
 * And every state the modules can hold has an entry, in both directions: a
 * status with no threshold falls to `FALLBACK_STUCK_DAYS` silently, which for a
 * *finished* state means reporting every completed record as stuck.
 */
export const STUCK_STATE_LISTS: Record<StuckSection, readonly string[]> = {
  purchaseOrder: PURCHASE_ORDER_STATUSES,
  afterSales: AFTER_SALES_STATUSES,
  projectStage: PROJECT_STAGES,
};
