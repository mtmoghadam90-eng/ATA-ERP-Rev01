/**
 * «معرف‌ها و پورسانت» — what the person who brought a job is owed for it.
 *
 * The decisions, agreed before this was built:
 *
 *  - **The base is chosen per referrer**, with a project able to override it:
 *    a percentage of the gross profit (the default — this application records
 *    the cost of every line, so profit is a fact here, not a guess), a
 *    percentage of the sale, or a fixed amount per won project.
 *  - **It becomes payable as the customer pays**: a commission on a job whose
 *    invoice is half collected is half payable. Commission paid on money that
 *    never arrives is the risk this removes.
 *  - **One referrer per project.**
 *  - **Payouts are recorded here**, cash or a gift with its value, and not in
 *    the ledger.
 *
 * Pure: the service supplies the figures, this decides the money.
 */

export const COMMISSION_BASES = ["PROFIT_PERCENT", "SALE_PERCENT", "FIXED"] as const;
export type CommissionBasis = typeof COMMISSION_BASES[number];

export const COMMISSION_BASIS_LABELS: Record<CommissionBasis, string> = {
  PROFIT_PERCENT: "درصد از سود ناخالص",
  SALE_PERCENT: "درصد از مبلغ فروش",
  FIXED: "مبلغ ثابت برای هر پروژهٔ برنده",
};

export const PAYOUT_KINDS = ["CASH", "GIFT"] as const;
export type PayoutKind = typeof PAYOUT_KINDS[number];
export const PAYOUT_KIND_LABELS: Record<PayoutKind, string> = { CASH: "پرداخت نقدی", GIFT: "هدیه" };

export function isCommissionBasis(value: unknown): value is CommissionBasis {
  return typeof value === "string" && (COMMISSION_BASES as readonly string[]).includes(value);
}

export interface CommissionTerms {
  basis: CommissionBasis;
  /** A percentage for the two percent bases, an amount in rial for FIXED. */
  rate: number;
  /** Where the terms came from, so the screen can say. */
  source: "PROJECT" | "REFERRER";
}

/**
 * The terms in force on one project: its own when it has a basis and a usable
 * rate, else the referrer's, else none — a project with no agreed terms owes
 * nothing rather than a guessed amount.
 */
export function resolveTerms(
  project: { commissionBasis?: string | null; commissionRate?: number | null },
  referrer: { commissionBasis?: string | null; commissionRate?: number | null } | null | undefined,
): CommissionTerms | null {
  const usable = (basis: unknown, rate: unknown) =>
    isCommissionBasis(basis) && Number.isFinite(Number(rate)) && Number(rate) >= 0 && rate !== null && rate !== undefined;
  if (usable(project.commissionBasis, project.commissionRate)) {
    return { basis: project.commissionBasis as CommissionBasis, rate: Number(project.commissionRate), source: "PROJECT" };
  }
  if (referrer && usable(referrer.commissionBasis, referrer.commissionRate)) {
    return { basis: referrer.commissionBasis as CommissionBasis, rate: Number(referrer.commissionRate), source: "REFERRER" };
  }
  return null;
}

/**
 * The whole commission a won project earns, before collection is applied.
 * A loss earns no profit commission (never negative), and a project that was
 * not won earns nothing on any basis.
 */
export function commissionEarned(
  terms: CommissionTerms | null,
  figures: { won: boolean; revenueRial: number; grossProfitRial: number },
): number {
  if (!terms || !figures.won) return 0;
  const round = (n: number) => Math.round(n);
  switch (terms.basis) {
    case "PROFIT_PERCENT": return round(Math.max(0, figures.grossProfitRial) * terms.rate / 100);
    case "SALE_PERCENT": return round(Math.max(0, figures.revenueRial) * terms.rate / 100);
    case "FIXED": return round(terms.rate);
    default: return 0;
  }
}

/** How much of it the customer's payments have unlocked so far. */
export function commissionPayable(earned: number, collectedPercent: number): number {
  const share = Math.min(100, Math.max(0, Number(collectedPercent) || 0)) / 100;
  return Math.round(earned * share);
}

export type CommissionState = "NO_TERMS" | "NOT_WON" | "AWAITING_PAYMENT" | "PAYABLE" | "PAID";

export const COMMISSION_STATE_LABELS: Record<CommissionState, string> = {
  NO_TERMS: "شرایط پورسانت تعیین نشده",
  NOT_WON: "هنوز برنده نشده",
  AWAITING_PAYMENT: "در انتظار وصول از مشتری",
  PAYABLE: "قابل پرداخت",
  PAID: "پرداخت شده",
};

/**
 * Where a project's commission stands. «پرداخت شده» once what was given covers
 * the whole earned amount; «قابل پرداخت» while some of what the customer has
 * paid for is still owed; «در انتظار وصول» when everything payable so far has
 * been given but the customer still owes us.
 */
export function commissionState(input: {
  terms: CommissionTerms | null;
  won: boolean;
  earned: number;
  payable: number;
  given: number;
}): CommissionState {
  if (!input.won) return "NOT_WON";
  if (!input.terms) return "NO_TERMS";
  if (input.earned > 0 && input.given >= input.earned) return "PAID";
  if (input.payable - input.given > 0) return "PAYABLE";
  if (input.earned === 0) return "PAID";
  return "AWAITING_PAYMENT";
}
