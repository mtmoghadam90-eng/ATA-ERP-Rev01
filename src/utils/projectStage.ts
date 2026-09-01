/**
 * «الان این پروژه در چه مرحله‌ای است؟»
 *
 * `Project.status` cannot answer that, and must not be made to. It is the
 * **sales outcome** — «برنده (موفق)», «باخته», «نیمه برنده» — and everything
 * that reads it reads it that way: `isWonStatus`, the dashboard's conversion
 * rate and won-contract value, the workflow triggers, the grid filter and the
 * Excel export. Putting «در حال ترخیص» into that column would take a won
 * project out of the won set the moment its goods left the factory, and the
 * company's win rate would collapse for a reason nobody could see.
 *
 * So the stage is a second, derived column. It answers where the *work* has
 * got to, across the whole chain: quoting, chasing, ordering, shipping,
 * clearing customs, packing, delivering, servicing.
 *
 * Two rules decide it, and both matter more than the list itself.
 *
 * **The least-advanced open thing wins.** A project with three purchase orders
 * — one cleared, two still in transit — is at «حمل و ترانزیت», because that is
 * what it is waiting on. Reading the furthest-along record instead would put
 * «تحویل شده» on a job with two containers still at sea, and somebody would
 * close it. Only when nothing is open does the furthest reached stand.
 *
 * **A person can override it, and there are two different things that means.**
 * Locking pins the stage whatever the records do — «توقف پروژه توسط کارفرما» is
 * not derivable from anything. Resuming shows it now and hands control back at
 * the next event, clearing the manual value; leaving it would show a stage the
 * records beside it no longer agree with. Same rule, and the same reasoning, as
 * the customer rank override in `customerValue.ts`.
 */

import { PURCHASE_ORDER_STATUSES } from "./moduleStatuses";

/**
 * Every stage, **in order**. The order is the rule: `stageRank` is the index,
 * and "least advanced" is the lowest one.
 *
 * The middle of the chain is the purchase order's own vocabulary rather than a
 * second set of words — see `STAGE_FOR_PO_STATUS` below, which the type-checker
 * holds against `PURCHASE_ORDER_STATUSES`.
 */
export const PROJECT_STAGES = [
  "جدید",
  "در حال مذاکره",
  "تهیه پیش‌فاکتور",
  "پیگیری پیش‌فاکتور",
  "باخته",
  "لغو شده",
  "برنده — در انتظار تأمین",
  "حواله و پرداخت به سازنده",
  "در حال آماده‌سازی سازنده",
  "حمل و ترانزیت",
  "ترخیص گمرک",
  "حمل به انبار",
  "بسته‌بندی و تحویل",
  "تحویل شده",
  "خدمات پس از فروش",
  "خاتمه‌یافته",
] as const;

export type ProjectStage = (typeof PROJECT_STAGES)[number];

/**
 * The two stages that end a project without any of the work happening.
 *
 * They are inside the ordered list rather than beside it so a single index can
 * order everything, but they are never compared as "less advanced than": a lost
 * project is not waiting on anything.
 */
export const TERMINAL_STAGES: readonly ProjectStage[] = ["باخته", "لغو شده"];

export const isTerminalStage = (stage: string | null | undefined): boolean =>
  TERMINAL_STAGES.includes(String(stage ?? "") as ProjectStage);

/** Position in the chain. -1 for a stage this build does not know. */
export function stageRank(stage: string | null | undefined): number {
  return (PROJECT_STAGES as readonly string[]).indexOf(String(stage ?? ""));
}

/**
 * A purchase order's own status, as a stage.
 *
 * The words are the module's, not a second typing of them — `satisfies` fails
 * to compile if a status is added to `PURCHASE_ORDER_STATUSES` and not mapped,
 * which is what stops this drifting the way the workflow trigger lists did.
 */
export const STAGE_FOR_PO_STATUS = {
  "پیش‌نویس": "برنده — در انتظار تأمین",
  "پرداخت و سفارش به سازنده": "حواله و پرداخت به سازنده",
  "در حال آماده‌سازی سازنده": "در حال آماده‌سازی سازنده",
  "حمل و ترانزیت": "حمل و ترانزیت",
  "ترخیص گمرک": "ترخیص گمرک",
  "در حال حمل به انبار": "حمل به انبار",
  "تحویل شده (رسید انبار)": "بسته‌بندی و تحویل",
} as const satisfies Record<(typeof PURCHASE_ORDER_STATUSES)[number], ProjectStage>;

/** What a project's records say about it, as the derivation needs them. */
export interface StageFacts {
  /** The project's own sales status — the outcome, not the stage. */
  projectStatus?: string | null;
  proformas?: { status?: string | null; isCancelled?: boolean | null }[];
  /** True once the sales outcome is won or part-won. */
  isWon?: boolean;
  /** True when every quotation is lost. */
  isLost?: boolean;
  /** True when every quotation is cancelled. */
  isCancelled?: boolean;
  purchaseOrders?: { status?: string | null }[];
  /** One entry per packing list; `delivered` is «تاریخ تحویل قطعی خورده». */
  deliveries?: { delivered?: boolean | null }[];
  /** One entry per after-sales record; `open` is «هنوز تحویل داده نشده». */
  afterSales?: { open?: boolean | null }[];
}

const PO_RECEIVED = "تحویل شده (رسید انبار)";

/**
 * The stage the records say the project is at.
 *
 * Reads in three bands — before a decision, decided against, and the
 * operational chain after a win — and inside the last band takes the
 * least-advanced open thing.
 */
export function deriveProjectStage(facts: StageFacts): ProjectStage {
  /* -- decided against: nothing is in progress -- */
  if (facts.isCancelled) return "لغو شده";
  if (facts.isLost) return "باخته";

  const proformas = facts.proformas ?? [];

  /* -- before the sale is won -- */
  if (!facts.isWon) {
    if (proformas.length === 0) {
      // Whatever the person put on the form, which is «جدید» or «در حال مذاکره».
      return facts.projectStatus === "در حال مذاکره" ? "در حال مذاکره" : "جدید";
    }
    /*
     * A document that has gone out is being chased; one that has not is still
     * being written. A cancelled one counts as neither.
     */
    const live = proformas.filter((pf) => !pf.isCancelled);
    if (live.some((pf) => pf.status === "ارسال شده")) return "پیگیری پیش‌فاکتور";
    return "تهیه پیش‌فاکتور";
  }

  /* -- won: the operational chain -- */
  const orders = facts.purchaseOrders ?? [];
  const deliveries = facts.deliveries ?? [];
  const afterSales = facts.afterSales ?? [];

  /*
   * Everything still open, as stages. The lowest one is the answer: a project
   * is at the stage of the thing it is waiting on, not of the thing that
   * happened to finish first.
   */
  const open: ProjectStage[] = [];

  for (const po of orders) {
    if (po.status === PO_RECEIVED) continue; // arrived; the packing list takes over
    const stage = STAGE_FOR_PO_STATUS[po.status as keyof typeof STAGE_FOR_PO_STATUS];
    // A status this build does not know must not be silently skipped: the order
    // is open, and the safest thing to say about it is that supply is pending.
    open.push(stage ?? "برنده — در انتظار تأمین");
  }

  for (const d of deliveries) if (!d.delivered) open.push("بسته‌بندی و تحویل");
  for (const s of afterSales) if (s.open) open.push("خدمات پس از فروش");

  if (open.length > 0) {
    return open.reduce((lowest, s) => (stageRank(s) < stageRank(lowest) ? s : lowest));
  }

  /* -- nothing open: the furthest thing that actually happened -- */
  if (afterSales.length > 0) return "خاتمه‌یافته";
  if (deliveries.length > 0) return "تحویل شده";
  if (orders.length > 0) {
    // Every order received, and nothing packed yet: the goods are in.
    return orders.every((po) => po.status === PO_RECEIVED)
      ? "بسته‌بندی و تحویل"
      : "برنده — در انتظار تأمین";
  }
  // Won, and nothing bought yet.
  return "برنده — در انتظار تأمین";
}

/* ------------------------------- overriding ------------------------------- */

export interface StageOverride {
  manualStage?: string | null;
  /**
   * True pins the manual stage for good; false means «show it now, and let the
   * derivation take back over at the next event», which also clears it.
   */
  manualStageLocked?: boolean | null;
}

export interface ResolvedStage {
  /** What the project should display and be filtered by. */
  stage: ProjectStage | string;
  /** What the records say, kept so an override never hides what it overrode. */
  derivedStage: ProjectStage;
  /** True when a person's answer is what is showing. */
  isManual: boolean;
  /**
   * True when this write should clear the manual value.
   *
   * An unlocked override is a one-off: it is shown until something moves, and
   * then the records are right again. Leaving it in place would show a stage
   * the columns beside it no longer agree with — the same reason the customer
   * rank override clears itself.
   */
  clearManual: boolean;
}

/**
 * The stage in effect, and whether the override has been used up.
 *
 * `recalculating` is the difference between drawing the project and writing it:
 * drawing must not clear anything, while the recalculation that runs when a
 * record moves is exactly the moment an unlocked override hands control back.
 */
export function resolveStage(
  derived: ProjectStage,
  override: StageOverride,
  recalculating: boolean,
): ResolvedStage {
  const manual = String(override.manualStage ?? "").trim();
  /*
   * A `manualStageLocked` with no stage is not an override.
   *
   * It is a flag somebody left on with the value cleared, and honouring it
   * would blank the column. Same trap `resolveRank` exists to avoid.
   */
  if (!manual) {
    return { stage: derived, derivedStage: derived, isManual: false, clearManual: false };
  }

  if (override.manualStageLocked) {
    return { stage: manual, derivedStage: derived, isManual: true, clearManual: false };
  }

  if (recalculating) {
    return { stage: derived, derivedStage: derived, isManual: false, clearManual: true };
  }
  return { stage: manual, derivedStage: derived, isManual: true, clearManual: false };
}
