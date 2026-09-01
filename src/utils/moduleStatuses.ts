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

import type { Project, Proforma, PurchaseOrder, AfterSalesService, Transaction, Customer } from "../types";

/** Fails to compile when `list` is missing any member of `Union`. */
type Covers<Union extends string, List extends readonly string[]> =
  [Exclude<Union, List[number]>] extends [never] ? true : never;

/* ------------------------------- projects -------------------------------- */

export const PROJECT_STATUSES = [
  "جدید", "در حال مذاکره", "ارائه پیش‌فاکتور",
  "برنده (موفق)", "باخته", "لغو شده", "نیمه برنده",
] as const satisfies readonly Project["status"][];
const _projectStatusesCover: Covers<Project["status"], typeof PROJECT_STATUSES> = true;

/* ------------------------------- proformas ------------------------------- */

/**
 * The **derived** outcome, which is what `proforma_outcome_change` reports.
 *
 * Not the same list as the stored `status` column, which only ever holds
 * «پیش‌نویس» and «ارسال شده» — that is `settings.dropdownItems.proformaStatuses`
 * and it is the user's own.
 */
export const PROFORMA_OUTCOMES = [
  "پیش‌نویس", "ارسال شده", "تأیید شده (برنده)",
  "لغو شده", "باخته", "نیمه برنده", "جاری",
] as const satisfies readonly Proforma["status"][];
const _proformaOutcomesCover: Covers<Proforma["status"], typeof PROFORMA_OUTCOMES> = true;

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
