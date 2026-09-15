/**
 * The status words each module actually uses, as runtime lists.
 *
 * They existed only as type unions, which the workflow rule editor could not
 * read — so its dropdowns were hand-typed beside them and drifted. The purchase
 * order's list there was «در انتظار تأیید / تأیید شده / ارسال شده», three words
 * this application has never stored; the project's was four words none of which
 * exist; the delivery's was seven where the engine emits two. A condition on
 * any of them matched nothing, silently, and the rule simply never ran.
 *
 * So each list lives here once and both sides read it: the module that stores
 * the status, and `src/utils/workflowTriggers.ts` that offers it. Each is
 * pinned to its own type union at **compile time**, in both directions — a
 * status added to the union and not to the list fails `npm run lint`, which is
 * what stops this drifting again the next time a status is added.
 */

import type {
  Project, Proforma, PurchaseOrder, AfterSalesService, Transaction, Customer, Task,
} from "../types";

/** Fails to compile when `list` is missing any member of `Union`. */
type Covers<Union extends string, List extends readonly string[]> =
  [Exclude<Union, List[number]>] extends [never] ? true : never;

/* ------------------------------- projects -------------------------------- */

/**
 * «یک پیشنهاد فنی برایش فرستاده‌ایم و هنوز قیمتی نداده‌ایم.»
 *
 * The status column is the *commercial* outcome, and a technical specification
 * quotes no prices — so it can never be «ارائه پیش‌فاکتور», which means a priced
 * offer the customer can accept and which every report keying on «did we quote»
 * would count as one. But the other answer, «leave the column alone», was just
 * as wrong: a job with a technical offer sitting with the customer for three
 * weeks read «در حال مذاکره», exactly like one nobody had written anything for,
 * which is how a customer comes to be left waiting with nobody noticing.
 *
 * So it is a value of its own rather than a reuse of either — not won, not lost
 * and not quoted, but one state a project genuinely is in. It lives here rather
 * than beside the rule that writes it because the *list* is what must contain
 * it: the project form's status control is a `<select>` over
 * `settings.dropdownItems.projectStatuses`, and a `<select>` whose value matches
 * no option renders the first one. `settingsPatches` appends it to a live
 * document for exactly that reason.
 */
export const PROJECT_TECHNICAL_OFFERED = "ارائه پیش‌فاکتور فنی" as const;

export const PROJECT_STATUSES = [
  "جدید", "در حال مذاکره", "ارائه پیش‌فاکتور",
  PROJECT_TECHNICAL_OFFERED,
  "برنده (موفق)", "باخته", "لغو شده", "نیمه برنده",
] as const satisfies readonly Project["status"][];
const _projectStatusesCover: Covers<Project["status"], typeof PROJECT_STATUSES> = true;

/* ------------------------------- proformas ------------------------------- */

/**
 * The **derived** outcome, which is what `proforma_outcome_change` reports.
 *
 * Not the same list as the stored `status` column — see
 * `PROFORMA_STORED_STATUSES` below.
 */
export const PROFORMA_OUTCOMES = [
  "پیش‌نویس", "ارسال شده", "تأیید شده (برنده)",
  "لغو شده", "باخته", "نیمه برنده", "جاری",
] as const satisfies readonly Proforma["status"][];
const _proformaOutcomesCover: Covers<Proforma["status"], typeof PROFORMA_OUTCOMES> = true;

/**
 * The **stored** `proformas.status` column, which holds these two and nothing
 * else — «has this quotation gone out yet», not how the sale went.
 *
 * It is a two-value column this application writes, not a vocabulary a company
 * chooses, and treating it as one is what put «تأیید شده (برنده)», «لغو شده»
 * and «باخته» into the rule editor's `newStatus` dropdown: those three are
 * *outcomes*, derived from the line statuses, and the column never holds any of
 * them — so a rule built on one saved cleanly, read correctly on its card, and
 * never fired. `settings.dropdownItems.proformaStatuses` was that list; it is
 * gone, and nothing reads a settings list for this any more.
 *
 * The subset check is deliberate rather than `Covers`: the outcome union is a
 * superset, so this pins the **spelling** of the two against it and nothing
 * more.
 */
export const PROFORMA_STORED_STATUSES = [
  "پیش‌نویس", "ارسال شده",
] as const satisfies readonly Proforma["status"][];

/**
 * The one of the two that means «this has gone to the customer».
 *
 * Named rather than read out of the list by index: the pair above is a list and
 * a list may be reordered, at which point `[1]` quietly starts meaning the
 * draft — and a clause asking «no quotation has been sent» would then answer
 * «no quotation is a draft», which is very nearly the opposite. It is pinned
 * into that list below, so the two spellings cannot part company.
 */
export const PROFORMA_SENT_STATUS = "ارسال شده" as const;

/**
 * `proformaType` for a document that states the specification and no prices.
 *
 * A *kind* of document rather than a status, and the distinction decides real
 * rules: the follow-up queue excludes it (there is no price with the customer,
 * so there is no sale to chase) and the cost check exempts it (there are no
 * prices to cost). The column's default is FINANCIAL, so **absent means
 * financial** — which is what every row written before the type existed is.
 *
 * It is deliberately **not** what «در حال بررسی فنی» means: that stage is the
 * review happening *before* any document exists, and is set by hand.
 */
export const PROFORMA_TECHNICAL_TYPE = "TECHNICAL" as const;

/** `proformaType` for a service quotation raised against an after-sales job. */
export const PROFORMA_AFTER_SALES_TYPE = "AFTER_SALES" as const;

/**
 * Which numbering template a kind of quotation is numbered from.
 *
 * The settings screen offers **three** — «پیش‌فاکتورهای مالی», «پیش‌فاکتورهای
 * فنی» and «پیش‌فاکتورهای خدمات پس از فروش» — and `nextProformaNumber` read
 * `proformaFormat` for all three, so two of those boxes were configured,
 * previewed on that very screen, and used by nothing: a technical offer came out
 * numbered as a financial one. A switch that does nothing, which is the fault
 * this codebase keeps repairing, and here it is on a number printed on a
 * document that goes to a customer.
 *
 * **Absent falls to the financial template**, which is what every row written
 * before the column existed is, and what the column's own default says.
 *
 * The three deliberately share **one** start sequence (`proformaStartSeq`): that
 * setting is a *floor* under the counter, and the series are already independent
 * because `nextSequence` counts the numbers issued under the same rendered
 * prefix — «QT-ATA-05-38-» and «QT-TECH-ATA-05-38-» are two prefixes. A second
 * floor would be a second thing to keep in step to say the same thing.
 */
export const PROFORMA_FORMAT_KEYS = {
  FINANCIAL: "proformaFormat",
  TECHNICAL: "proformaTechnicalFormat",
  AFTER_SALES: "proformaAfterSalesFormat",
} as const;

/** The default each of those templates falls back to when none is configured. */
export const PROFORMA_FORMAT_FALLBACKS = {
  FINANCIAL: "QT-{PROJECT}-{SEQ:2}",
  TECHNICAL: "QT-TECH-{PROJECT}-{SEQ:2}",
  AFTER_SALES: "QT-SERV-{PROJECT}-{SEQ:2}",
} as const;

export type ProformaKind = keyof typeof PROFORMA_FORMAT_KEYS;

/** The kind a stored `proformaType` names; anything unknown is financial. */
export function proformaKindOf(type: unknown): ProformaKind {
  const value = String(type ?? "").trim();
  if (value === PROFORMA_TECHNICAL_TYPE) return "TECHNICAL";
  if (value === PROFORMA_AFTER_SALES_TYPE) return "AFTER_SALES";
  return "FINANCIAL";
}
const _sentIsAStoredStatus: (typeof PROFORMA_STORED_STATUSES)[number] = PROFORMA_SENT_STATUS;
void _sentIsAStoredStatus;

/* ---------------------------- purchase orders ---------------------------- */

export const PURCHASE_ORDER_STATUSES = [
  "پیش‌نویس", "پرداخت و سفارش به سازنده", "در حال آماده‌سازی سازنده",
  "حمل و ترانزیت", "ترخیص گمرک", "در حال حمل به انبار", "تحویل شده (رسید انبار)",
] as const satisfies readonly PurchaseOrder["status"][];
const _poStatusesCover: Covers<PurchaseOrder["status"], typeof PURCHASE_ORDER_STATUSES> = true;

/* ---------------------------- after-sales -------------------------------- */

export const AFTER_SALES_STATUSES = [
  "در حال بررسی", "در حال تعمیر/خدمات", "تکمیل شده", "تحویل داده شده",
] as const satisfies readonly AfterSalesService["status"][];
const _afterSalesCover: Covers<AfterSalesService["status"], typeof AFTER_SALES_STATUSES> = true;

/**
 * Is this after-sales case still open?
 *
 * Written as an **exclusion**, like `countsTowardBalance`, `chaseableWhere` and
 * `laneWhere`'s middle column, and the direction is the decision: a status this
 * build does not know counts as **open**. The reader that matters is «یک ماه پس
 * از تحویل، بپرس نصب چطور پیش رفت» — and getting it wrong in the other
 * direction sends «امیدواریم راضی باشید» to somebody whose complaint is open on
 * our own desk, which is the failure worth avoiding. An unknown status merely
 * withholds a friendly note.
 */
export const AFTER_SALES_CLOSED: readonly string[] = ["تکمیل شده", "تحویل داده شده"];

export function afterSalesIsOpen(status: unknown): boolean {
  return !AFTER_SALES_CLOSED.includes(String(status ?? ""));
}

/* ----------------------------- transactions ------------------------------ */

export const TRANSACTION_TYPES = [
  "دریافت", "پرداخت",
] as const satisfies readonly Transaction["type"][];
const _txTypesCover: Covers<Transaction["type"], typeof TRANSACTION_TYPES> = true;

/* ------------------------------- customers ------------------------------- */

export const CUSTOMER_TYPES = [
  "حقیقی", "حقوقی",
] as const satisfies readonly Customer["customerType"][];
const _customerTypesCover: Covers<Customer["customerType"], typeof CUSTOMER_TYPES> = true;

/* -------------------------------- tasks ---------------------------------- */

/**
 * A task's four priorities. The statuses live in `workBoard.ts` with the lanes
 * they map onto; these have no lane, so they live here with the other lists.
 *
 * The rule editor offered «کم / زیاد / بحرانی» — three words this application
 * has never stored — which is what made every priority condition match nothing.
 */
export const TASK_PRIORITIES = [
  "پایین", "متوسط", "بالا", "فوری",
] as const satisfies readonly Task["priority"][];
const _taskPrioritiesCover: Covers<Task["priority"], typeof TASK_PRIORITIES> = true;
void _taskPrioritiesCover;

/* --------------------- statuses that are *derived* ----------------------- */

/**
 * A packing list has no status column: the engine derives one from whether the
 * goods have actually gone out.
 *
 * The editor used to offer «پیش‌نویس / آماده بسته‌بندی / بسته‌بندی شده / آماده
 * ارسال / ارسال شده / تحویل شده / لغو شده» — seven values against a payload
 * that carries one of two. `deliveryWorkflowStatus` is the rule and both sides
 * read it, so the list cannot be longer than what can be emitted.
 */
export const DELIVERY_DELIVERED = "تحویل شده";
export const DELIVERY_PREPARING = "در حال آماده‌سازی";
export const DELIVERY_WORKFLOW_STATUSES = [DELIVERY_PREPARING, DELIVERY_DELIVERED] as const;

export function deliveryWorkflowStatus(
  delivery: { actualDeliveryDate?: unknown } | null | undefined,
): string {
  return delivery?.actualDeliveryDate ? DELIVERY_DELIVERED : DELIVERY_PREPARING;
}

/**
 * The day a consignment was delivered, when its lines were delivered one by one.
 *
 * `PackingItem.actualDeliveryDate` exists because a shipment genuinely arrives in
 * pieces — two boxes on Tuesday and the instrument the following week — and the
 * *header* date was then left empty. Everything that asks «has this been
 * delivered» reads the header: `deliveryWorkflowStatus`, the project stage, and
 * the `delivery_actual` schedule subject, which can only count from a stored
 * column. So «یک ماه پس از تحویل کالا، بپرس نصب چطور پیش رفت» **silently never
 * fired** for such a consignment, and the grid reported «در حال آماده‌سازی»
 * about goods the customer had had for a month.
 *
 * Two decisions, and both are about which record is the more trustworthy.
 *
 * **The last line, not the first.** The customer has the consignment only once
 * the final piece arrives, and asking about installation before that is asking
 * about something they cannot have done — so this answers the *latest* date, and
 * only when **every** line carries one. A part-delivered consignment is not
 * delivered, and reading «any line has a date» would start the month from the
 * first box.
 *
 * **A date somebody typed on the header always wins.** It may be the official
 * handover date while the lines record when each box physically turned up, and
 * overwriting that would change a date the company has told the customer. So the
 * lines only ever *fill in* an empty header — which is precisely the case that
 * was broken — and never correct or clear one. A line's date removed afterwards
 * therefore leaves the header as it was: the consignment *was* delivered, and
 * somebody editing that history is not a reason to report it as undelivered.
 *
 * Answers null when there is nothing to say, which the caller reads as «leave the
 * column alone».
 */
export function consignmentDeliveredOn(
  header: { actualDeliveryDateJalali?: unknown } | null | undefined,
  items: readonly { actualDeliveryDateJalali?: unknown }[] | null | undefined,
): string | null {
  const typed = String(header?.actualDeliveryDateJalali ?? "").trim();
  if (typed) return null; // Already answered, and by a person.

  const lines = items ?? [];
  if (lines.length === 0) return null;

  const dates = lines.map((i) => String(i.actualDeliveryDateJalali ?? "").trim());
  if (dates.some((d) => !d)) return null; // Not every line has arrived.

  /*
   * Compared as text, which is the calendar order: both sides are `YYYY/MM/DD`
   * with the parts zero-padded, exactly as `isDue` compares a due day.
   */
  return dates.reduce((latest, d) => (d > latest ? d : latest), dates[0]);
}

/**
 * A supplier inquiry has no status column either — its state is where the offer
 * has got to. Four values, derived in one place so the editor offers those and
 * not the seven invented ones it used to.
 */
export const INQUIRY_SENT = "ارسال شده";
export const INQUIRY_INITIAL_OFFER = "پیشنهاد اولیه";
export const INQUIRY_FINAL_OFFER = "پیشنهاد نهایی";
export const INQUIRY_WINNER = "برنده";
export const INQUIRY_WORKFLOW_STATUSES = [
  INQUIRY_SENT, INQUIRY_INITIAL_OFFER, INQUIRY_FINAL_OFFER, INQUIRY_WINNER,
] as const;

export function inquiryWorkflowStatus(inquiry: {
  isWinner?: unknown;
  offerConfirmed?: unknown;
  items?: { priceForeign?: unknown; priceRial?: unknown }[] | null;
} | null | undefined): string {
  if (inquiry?.isWinner) return INQUIRY_WINNER;
  if (inquiry?.offerConfirmed) return INQUIRY_FINAL_OFFER;
  const hasPrice = (inquiry?.items ?? []).some((item) => item.priceForeign || item.priceRial);
  return hasPrice ? INQUIRY_INITIAL_OFFER : INQUIRY_SENT;
}

/* The compile-time pins above are the point of this file; nothing reads them. */
void _projectStatusesCover; void _proformaOutcomesCover; void _poStatusesCover;
void _afterSalesCover; void _txTypesCover; void _customerTypesCover;
