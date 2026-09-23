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

import {
  INQUIRY_SENT, INQUIRY_WINNER, PROFORMA_SENT_STATUS, PROFORMA_TECHNICAL_TYPE,
  PURCHASE_ORDER_STATUSES,
} from "./moduleStatuses";

/**
 * Every stage, **in order**. The order is the rule: `stageRank` is the index,
 * and "least advanced" is the lowest one.
 *
 * The middle of the chain is the purchase order's own vocabulary rather than a
 * second set of words — see `STAGE_FOR_PO_STATUS` below, which the type-checker
 * holds against `PURCHASE_ORDER_STATUSES`.
 */
/**
 * «آفر با مشتری است و منتظر پاسخ او هستیم.»
 *
 * It was «پیگیری پیش‌فاکتور» — «chasing the quotation» — which names what the
 * sales desk is doing rather than where the *job* has got to, and the latter is
 * the one thing this column is for. The chasing already has a screen of its own
 * (the follow-up queue, with a health badge per document); the stage answers
 * «الان این پروژه در چه مرحله‌ای است؟».
 *
 * Both spellings are named because the *old* one is still a key in
 * `settings.stuckThresholds.projectStage` on every database that has one, and
 * `pruneStuckThresholds` drops a key no state answers to — so a company that had
 * changed «۳۰ روز» would lose the number silently on its next settings save.
 * `settingsPatches` carries it across, once, and reads both names from here.
 */
export const STAGE_OFFER_REVIEW = "بررسی آفر توسط مشتری" as const;

/** What `STAGE_OFFER_REVIEW` used to be called. Read only by the patch above. */
export const STAGE_OFFER_REVIEW_WAS = "پیگیری پیش‌فاکتور" as const;

export const PROJECT_STAGES = [
  "جدید",
  "در حال مذاکره",
  /*
   * «داریم بررسی فنی می‌کنیم تا آفر مناسب بدهیم» — and there is usually **no
   * document at all** yet.
   *
   * A customer sends a datasheet and an enquiry, and before anybody asks a
   * supplier for a price or writes a quotation somebody here has to work out
   * *what* to offer: which instrument, which range, which connection. Nothing
   * in this application records that. There is no technical-review row, and the
   * project's own records are all still empty — which is precisely the state
   * this names.
   *
   * So it is **set by hand and derived from nothing**, the one stage in this
   * list that is, and `deriveProjectStage` never answers it. It was first built
   * to derive from a *technical* proforma and that was wrong twice over: it
   * claimed the review needs a document, when the point is that it has none
   * yet, and it would have said «بررسی فنی» about a specification already sent
   * to the customer, which is the review finished rather than in progress.
   *
   * It sits here, before the supplier stages, because asking a supplier for a
   * price is what happens once the review has decided what to ask about — which
   * is also what hands the column back: an unlocked override is consumed by the
   * first record that moves, so the inquiry or the quotation takes over on its
   * own. Locked pins it, exactly as for «توقف پروژه توسط کارفرما».
   */
  "در حال بررسی فنی",
  /*
   * The technical offer has gone out and the customer is reading it.
   *
   * A specification quotes **no prices**, so it can never be «پیگیری
   * پیش‌فاکتور» — that stage means a priced offer is with the customer, and
   * reading a specification as one dragged the project past the unanswered
   * supplier inquiry that was the real answer. But leaving it out of the chain
   * entirely was worse in the ordinary case: a job whose technical offer had
   * been with the customer for three weeks reported «جدید», exactly like one
   * nobody had touched, because the derivation was handed no such document at
   * all.
   *
   * It sits **here**, between the review that produced it and the supplier
   * stages, because asking a supplier for a price is what happens once the
   * customer has agreed what is being offered. The order is the rule, so that
   * placement is also what decides the contest: the least-advanced open thing
   * wins, so a project with a technical offer out *and* an unanswered inquiry
   * reports this rather than the inquiry — holding the project earlier in the
   * chain, never later, which is the safe direction for a column somebody reads
   * to decide what to chase.
   */
  "بررسی پیشنهاد فنی توسط مشتری",
  // The two stages before a quotation exists. Until they were added, a job with
  // three unanswered supplier inquiries sitting twenty days old read exactly
  // like one created this morning and touched by nobody — the derivation looked
  // at no inquiry at all, and «جدید» was as much as the column could say.
  "در انتظار پاسخ تأمین‌کننده",
  "بررسی پیشنهاد تأمین‌کننده",
  "تهیه پیش‌فاکتور",
  // The priced offer is with the customer; see the constant's own note.
  STAGE_OFFER_REVIEW,
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
  /**
   * Every document on the project, its kind included.
   *
   * The kind matters because a technical offer and a priced quotation reaching
   * the customer are two different stages — see «بررسی پیشنهاد فنی توسط مشتری»
   * in `PROJECT_STAGES`. Absent reads as financial, as the NOT NULL column's own
   * default does.
   */
  proformas?: {
    proformaType?: string | null;
    status?: string | null;
    isCancelled?: boolean | null;
    /**
     * The day the customer approved the technical proposal, or null. An
     * approved document is no longer «with the customer»: what happens next is
     * the priced quotation, which is «تهیه پیش‌فاکتور».
     */
    technicalApprovedDate?: Date | string | null;
  }[];
  /** True once the sales outcome is won or part-won. */
  isWon?: boolean;
  /** True when every quotation is lost. */
  isLost?: boolean;
  /** True when every quotation is cancelled. */
  isCancelled?: boolean;
  /**
   * The project's supplier inquiries, as the module's own derived status.
   *
   * The **status**, not the row: `inquiryWorkflowStatus` is already the single
   * rule for «where has this inquiry got to», read by that service and by the
   * workflow rule editor, and a second reading of «has the supplier answered»
   * here is exactly how two screens come to disagree.
   */
  supplierInquiries?: { status?: string | null }[];
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
    /*
     * A document that has gone out is being chased; one that has not is still
     * being written. A cancelled one counts as neither.
     *
     * A **sent** quotation is checked before anything else here, and that is
     * the dividing line: once it has gone out the customer has an answer, and
     * what the job is waiting on is the customer. Before that it is waiting on
     * us, and the supplier inquiries below say what for. Reading them first
     * would take a project that has already quoted *backwards* into «در انتظار
     * پاسخ تأمین‌کننده» the moment somebody asked a supplier about extra scope.
     */
    const live = proformas.filter((pf) => !pf.isCancelled);
    const priced = live.filter((pf) => pf.proformaType !== PROFORMA_TECHNICAL_TYPE);
    /*
     * An approved technical proposal is not with the customer any more — they
     * have answered it — so it takes no part in the two «sent» checks below.
     * Another offer that has gone out and *not* been answered still does: a
     * revised price sent after the approval is exactly what the job is then
     * waiting on.
     */
    const approved = live.filter((pf) => !!pf.technicalApprovedDate);
    const awaiting = (pf: (typeof live)[number]) =>
      pf.status === PROFORMA_SENT_STATUS && !pf.technicalApprovedDate;
    if (priced.some(awaiting)) return STAGE_OFFER_REVIEW;

    /*
     * A technical offer with the customer, checked next — and its place in the
     * chain is the whole of the rule.
     *
     * Below the priced document, because a price that has gone out is further
     * along than a specification that has: checking it first would report «the
     * customer is reading our spec» about a job already quoted.
     *
     * Above the supplier inquiries, because it sits **before** them in
     * `PROJECT_STAGES` and the least-advanced open thing wins: asking a
     * supplier for a price is what happens once the customer has agreed what is
     * being offered, so the approval is the deeper block and the price does not
     * matter until it comes.
     *
     * That placement is also what keeps the fault this used to have from coming
     * back. It was a specification reported as «بررسی آفر توسط مشتری» — *past* the
     * supplier stages, hiding the unanswered inquiry that was the real answer.
     * The fix is where the stage sits, not whether it exists: this holds the
     * project earlier in the chain and never later.
     */
    const technicalSent = live.some(
      (pf) => pf.proformaType === PROFORMA_TECHNICAL_TYPE && awaiting(pf),
    );
    if (technicalSent) return "بررسی پیشنهاد فنی توسط مشتری";

    /*
     * Nothing has reached the customer yet, so the least-advanced open thing
     * wins here exactly as it does in the operational chain below.
     *
     * An inquiry nobody has answered outranks a half-written quotation: the
     * draft cannot be finished until the price arrives, so the supplier is
     * what the job is actually waiting on. An inquiry already chosen as the
     * winner is decided and holds nothing back.
     */
    const inquiries = facts.supplierInquiries ?? [];
    const undecided = inquiries.filter((i) => i.status !== INQUIRY_WINNER);
    if (undecided.some((i) => i.status === INQUIRY_SENT)) {
      return "در انتظار پاسخ تأمین‌کننده";
    }

    // A *priced* draft is what «تهیه پیش‌فاکتور» names. An unsent technical
    // specification says nothing about a quotation being written, so it falls
    // through to whatever the inquiries and the form say, exactly as before.
    //
    // And an approved technical proposal is the other way in: «what» is agreed,
    // so the priced quotation is what somebody here is now writing. Below the
    // inquiry check on purpose — that draft cannot be finished until the
    // supplier's price arrives either.
    if (priced.length > 0 || approved.length > 0) return "تهیه پیش‌فاکتور";
    if (undecided.length > 0) return "بررسی پیشنهاد تأمین‌کننده";

    /*
     * A winning inquiry with no quotation yet is the same answer as an offer
     * still being compared: somebody has to write the document. It is not
     * «جدید», which would say no work had been done at all.
     */
    if (inquiries.length > 0) return "بررسی پیشنهاد تأمین‌کننده";

    /*
     * And never «در حال بررسی فنی»: that one is set by hand, because nothing
     * here records a review. See the note beside it in `PROJECT_STAGES`.
     */
    // Whatever the person put on the form, which is «جدید» or «در حال مذاکره».
    return facts.projectStatus === "در حال مذاکره" ? "در حال مذاکره" : "جدید";
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
