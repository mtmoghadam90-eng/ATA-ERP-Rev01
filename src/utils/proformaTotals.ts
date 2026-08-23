/**
 * A proforma's money, computed once and the same way everywhere.
 *
 * There were two implementations of this arithmetic. The form rounded the
 * discount and the tax to whole units — «۹۷۸ دلار، تخفیف ۹۸، مالیات ۸۸، جمع
 * ۹۶۸» — and the server did not, so what the server stored and every document
 * printed was 968.22 against the 968 the user had read and approved. Nothing
 * was wrong with either calculation; they were simply two calculations.
 *
 * The rounding is the form's, because the form is what a person looks at and
 * agrees to before pressing save. Rounding to the whole unit is right for rial
 * by definition, and for the foreign currencies this company quotes in — a few
 * hundred to a few thousand dollars or euros — it is the difference the invoice
 * is written to, not a distortion.
 *
 * What is deliberately **not** rounded is the line totals and therefore the
 * subtotal: a line has to read quantity × unit price, and the lines have to add
 * up to the subtotal printed under them. Only the figures the document derives
 * — discount, tax, extras — are rounded, which is exactly where a percentage
 * produces a fraction nobody typed.
 */

export interface ProformaTotalsInput {
  /** Each line's own total, in the document's currency. */
  lineTotals: readonly number[];
  discountPercent?: unknown;
  /** Used only when no percentage is given — the manual override. */
  discountAmount?: unknown;
  taxPercent?: unknown;
  taxAmount?: unknown;
  extraCosts?: unknown;
}

export interface ProformaTotals {
  totalAmount: number;
  discountPercent: number;
  discountAmount: number;
  taxPercent: number;
  taxAmount: number;
  extraCosts: number;
  finalAmount: number;
}

const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/** A money figure as it goes on the document: whole units. */
export function roundMoney(value: number): number {
  return Math.round(num(value));
}

export function computeProformaTotals(input: ProformaTotalsInput): ProformaTotals {
  const totalAmount = input.lineTotals.reduce((sum, line) => sum + num(line), 0);

  const discountPercent = num(input.discountPercent);
  // A percentage takes precedence; an explicit amount is the manual override.
  const discountAmount = roundMoney(
    discountPercent > 0 ? (totalAmount * discountPercent) / 100 : num(input.discountAmount),
  );

  const afterDiscount = totalAmount - discountAmount;

  const taxPercent = num(input.taxPercent);
  const taxAmount = roundMoney(
    taxPercent > 0 ? (afterDiscount * taxPercent) / 100 : num(input.taxAmount),
  );

  const extraCosts = roundMoney(num(input.extraCosts));

  return {
    totalAmount,
    discountPercent,
    discountAmount,
    taxPercent,
    taxAmount,
    extraCosts,
    // Built from the rounded parts, so the document adds up as printed.
    finalAmount: afterDiscount + taxAmount + extraCosts,
  };
}
