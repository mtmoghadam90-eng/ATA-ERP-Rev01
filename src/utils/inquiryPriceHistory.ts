import { computeInquiryTotals } from "./inquirySteps";
import type { SupplierInquiryItem } from "../types";

/**
 * "What did I last pay for this?" — the pure part.
 *
 * Every price this company has ever been quoted is already recorded: a supplier
 * inquiry's lines carry `productId`, `variantId`, a quantity, a currency and a
 * price. What was missing was a way to ask the question the buyer actually has,
 * which is never "show me inquiry 4718" but "what did the last 6-inch turbine
 * flow meter cost me, and from whom". That is a query across lines rather than a
 * list of inquiries, so it gets its own reader — and this file is the
 * arithmetic that reader needs, kept out of the service so it can be tested
 * without a database.
 *
 * ## The line's price is not what was paid
 *
 * A discount belongs to the whole offer, not to a line: `discountPercent` comes
 * off first and `discountAmount` off what is left, both on the offer's total.
 * So a line's stored `priceForeign` / `priceRial` is a **pre-discount** figure,
 * and quoting it as "the price I got" overstates every discounted offer.
 *
 * `discountKeepFraction` is the proportion of the gross the supplier is actually
 * being paid, and a line's share is its own price times that proportion. This is
 * the same apportionment `inquiryTotalsByCurrency` already makes for the offer
 * card, and deliberately so: the history and the card must not disagree about
 * one offer. Deriving it from `computeInquiryTotals` rather than re-implementing
 * the percent-then-amount order is what keeps them together.
 */

/** A line's own figures, as the history needs them. */
export interface PricedLine {
  quantity: number;
  currency: string;
  /** Unit price in `currency`. */
  priceForeign: number;
  /** Unit price converted to Rial at the rate of the day it was entered. */
  priceRial: number;
}

export interface NetUnitPrice {
  /** Unit price in the line's own currency, after the offer's discount. */
  unitForeign: number;
  /** The same unit, in Rial, after the offer's discount. */
  unitRial: number;
  /** True when the offer carried a discount, so the screen can say so. */
  discounted: boolean;
}

/**
 * The proportion of an offer's gross value that is actually payable.
 *
 * 1 when there is no discount. 0 when the discount swallows the offer whole —
 * `computeInquiryTotals` already clamps that, and this must not turn it into a
 * negative price.
 */
export function discountKeepFraction(
  items: PricedLine[] | undefined,
  discountPercent?: number,
  discountAmount?: number,
): number {
  // The totals rule reads the *client* spelling of the Rial column
  // (`priceRiyal`), while the column itself is `priceRial`. Translating here
  // rather than at each call site is deliberate: a caller handing it rows
  // straight from the database would get a zero Rial gross and fall through to
  // the foreign fraction, which is usually the same number and silently is not.
  const forTotals = (items ?? []).map((line) => ({
    quantity: Number(line.quantity) || 0,
    currency: line.currency,
    priceForeign: Number(line.priceForeign) || 0,
    priceRiyal: Number(line.priceRial) || 0,
  })) as unknown as SupplierInquiryItem[];

  const totals = computeInquiryTotals(forTotals, discountPercent, discountAmount);

  // Measured on whichever total is non-zero: a Rial-only offer has no foreign
  // gross, and an offer whose lines are all foreign may have no Rial equivalent
  // stored. Both give the same fraction when both are present, because
  // `computeInquiryTotals` reduces them by one shared proportion.
  if (totals.grossRiyal > 0) return totals.netRiyal / totals.grossRiyal;
  if (totals.grossForeign > 0) return totals.netForeign / totals.grossForeign;
  return 1;
}

/** One line's unit price, with the offer's discount applied to it. */
export function netUnitPrice(line: PricedLine, keep: number): NetUnitPrice {
  const factor = Number.isFinite(keep) ? Math.min(Math.max(keep, 0), 1) : 1;
  return {
    unitForeign: (Number(line.priceForeign) || 0) * factor,
    unitRial: (Number(line.priceRial) || 0) * factor,
    discounted: factor < 1,
  };
}

/* ------------------------------- the summary ------------------------------- */

/** One row of the history, reduced to what the summary is computed from. */
export interface HistoryPoint {
  unitRial: number;
  supplierId: string;
}

export interface HistorySummary {
  /** Rows carrying a Rial figure — the ones the range below is measured over. */
  pricedCount: number;
  /** Distinct suppliers among those rows. */
  supplierCount: number;
  minUnitRial: number | null;
  maxUnitRial: number | null;
  avgUnitRial: number | null;
}

/**
 * The range of unit prices across the matched history.
 *
 * Measured in Rial because that is the only figure every line shares — an
 * answer mixing dollars and euros into one minimum would be nonsense. A line
 * with no Rial equivalent is left out of **both** the range and the count
 * rather than counted as zero, which would report a free quotation as the best
 * price ever obtained.
 *
 * The rows must be the whole matched set, not one page: a "cheapest price" that
 * changes when you turn the page is worse than none.
 */
export function summarizeHistory(points: HistoryPoint[]): HistorySummary {
  const priced = points.filter((p) => Number(p.unitRial) > 0);
  if (priced.length === 0) {
    return { pricedCount: 0, supplierCount: 0, minUnitRial: null, maxUnitRial: null, avgUnitRial: null };
  }

  let min = Infinity;
  let max = 0;
  let sum = 0;
  const suppliers = new Set<string>();
  for (const p of priced) {
    const value = Number(p.unitRial);
    if (value < min) min = value;
    if (value > max) max = value;
    sum += value;
    if (p.supplierId) suppliers.add(p.supplierId);
  }

  return {
    pricedCount: priced.length,
    supplierCount: suppliers.size,
    minUnitRial: min,
    maxUnitRial: max,
    avgUnitRial: sum / priced.length,
  };
}
