/**
 * What a proforma line cost us, and where that figure came from.
 *
 * The rule this module exists to enforce: **every line on a proforma must have
 * a known cost**, because gross profit — and through it every customer's rank —
 * is only as honest as its worst-documented line. A line with no cost used to
 * be silently dropped from the margin, which flattered exactly the sales nobody
 * had bothered to cost.
 *
 * Cost is snapshotted onto the sale line rather than looked up from the product
 * when it is needed. Three reasons, in order of how much trouble each one
 * caused:
 *
 *  1. A product's cost changes. Re-pricing an item next year would otherwise
 *     rewrite last year's profit and re-rank every customer who bought it.
 *  2. A free-text line has no product to look anything up from, and those lines
 *     are real — one-off items bought in for a single job.
 *  3. The purchase order that fulfilled a line may be edited, deleted, or never
 *     raised at all.
 *
 * The figure is kept in the **proforma's own currency**, matching the price
 * beside it. That is what makes the margin *percentage* independent of the
 * exchange rate, and computable even for a document whose rate was never
 * recorded — only the absolute rial figure needs a rate.
 */

/** How a line's cost was arrived at. Ordered best-evidence first. */
export const COST_SOURCES = {
  /** Apportioned from the purchase order that actually fulfilled this line. */
  PURCHASE_ORDER: "PURCHASE_ORDER",
  /** The landed cost from the product's or SKU's price calculator. */
  PRICE_CALCULATOR: "PRICE_CALCULATOR",
  /** Typed in by a person, either directly or through the calculator. */
  MANUAL: "MANUAL",
  /** Deliberately none — a service line, or goods the customer supplies. */
  NONE: "NONE",
  /** Filled in by the migration from the best evidence available at the time. */
  BACKFILL: "BACKFILL",
} as const;

export type CostSource = typeof COST_SOURCES[keyof typeof COST_SOURCES];

export const COST_SOURCE_LABELS: Record<CostSource, string> = {
  PURCHASE_ORDER: "از سفارش خرید",
  PRICE_CALCULATOR: "از ماشین‌حساب قیمت",
  MANUAL: "ورود دستی",
  NONE: "بدون بهای تمام‌شده",
  BACKFILL: "تخمین سیستم (بازیابی سوابق)",
};

/**
 * Whether a source is evidence or merely an assertion.
 *
 * Used for the coverage figure on the customer value card: a company whose
 * lines are all `MANUAL` is fully costed and barely evidenced, and a screen
 * that reported both as "100%" would be lying by omission.
 */
export const EVIDENCED_SOURCES: CostSource[] = [
  COST_SOURCES.PURCHASE_ORDER,
  COST_SOURCES.PRICE_CALCULATOR,
];

export interface LineCost {
  /** Per unit, in the proforma's currency. Null when nobody has said. */
  unitCost: number | null;
  costCurrency: string | null;
  costSource: CostSource | null;
}

/**
 * True when a line still needs somebody to say what it cost.
 *
 * A deliberate zero (`costSource: NONE`) is an answer and passes; a blank is
 * not. That distinction is the whole reason `NONE` exists — without it, "this
 * is a service line" and "nobody has got to this yet" would both be an empty
 * box, and the enforcement would have to either block the first or let through
 * the second.
 */
export function lineNeedsCost(line: Partial<LineCost> | null | undefined): boolean {
  if (!line) return true;
  if (line.costSource === COST_SOURCES.NONE) return false;
  return line.unitCost === null || line.unitCost === undefined || !Number.isFinite(Number(line.unitCost));
}

/** The lines of a proforma that cannot be saved yet, with their positions. */
export function linesMissingCost<T extends Partial<LineCost> & { productName?: string }>(
  items: T[] | null | undefined,
): { index: number; name: string }[] {
  return (items ?? [])
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => lineNeedsCost(line))
    .map(({ line, index }) => ({
      index,
      name: line.productName?.trim() || `ردیف ${index + 1}`,
    }));
}

/* ------------------------------ currency ---------------------------------- */

/**
 * Converts a cost between currencies through rial.
 *
 * `null` when the conversion cannot be made honestly — an unknown rate gives an
 * unknown cost, never a zero one. A zero here would travel all the way into a
 * customer's gross profit as pure margin.
 */
export function convertCost(
  amount: number | null | undefined,
  fromRate: number | null | undefined,
  toRate: number | null | undefined,
): number | null {
  const value = Number(amount);
  if (!Number.isFinite(value)) return null;
  if (value === 0) return 0;

  const from = Number(fromRate ?? 0);
  const to = Number(toRate ?? 0);
  if (from <= 0 || to <= 0) return null;

  // Both rates are "how many rial one unit is worth", so this is a round trip
  // through rial rather than a direct pair.
  return (value * from) / to;
}

/* --------------------------- picking a default ---------------------------- */

export interface CostCandidates {
  /** Landed unit cost from the purchase order fulfilling this line, in rial. */
  purchaseOrderRial?: number | null;
  /** Landed unit cost from the product's or SKU's calculator, in rial. */
  priceCalculatorRial?: number | null;
}

/**
 * The cost to offer for a line, before anybody types anything.
 *
 * Best evidence wins: what we actually paid beats what we assume an item costs.
 * Returns null when neither is known, which is the case the user has to answer.
 *
 * `documentRate` is the proforma's own exchange rate — how many rial one unit
 * of its currency is worth — because the answer is expressed in that currency.
 * A rial document passes 1.
 */
export function suggestLineCost(
  candidates: CostCandidates,
  documentRate: number | null | undefined,
  documentCurrency: string,
): LineCost | null {
  const rate = Number(documentRate ?? 0) || (documentCurrency === "ریال" ? 1 : 0);

  const fromOrder = Number(candidates.purchaseOrderRial ?? NaN);
  if (Number.isFinite(fromOrder) && fromOrder > 0) {
    const converted = convertCost(fromOrder, 1, rate);
    if (converted !== null) {
      return {
        unitCost: converted,
        costCurrency: documentCurrency,
        costSource: COST_SOURCES.PURCHASE_ORDER,
      };
    }
  }

  const fromCalc = Number(candidates.priceCalculatorRial ?? NaN);
  if (Number.isFinite(fromCalc) && fromCalc > 0) {
    const converted = convertCost(fromCalc, 1, rate);
    if (converted !== null) {
      return {
        unitCost: converted,
        costCurrency: documentCurrency,
        costSource: COST_SOURCES.PRICE_CALCULATOR,
      };
    }
  }

  return null;
}

/* ------------------------------- margin ----------------------------------- */

export interface LineMargin {
  /** In the document's currency — always computable when a cost is known. */
  revenue: number;
  cost: number;
  profit: number;
  /** Null only when the line has no revenue to take a percentage of. */
  marginPercent: number | null;
}

/**
 * One line's margin, in the document's own currency.
 *
 * No exchange rate anywhere: cost and revenue are in the same currency by
 * construction, which is the point of storing cost that way. A document with no
 * recorded rate still has a perfectly good margin percentage — only its rial
 * value is unknown.
 */
export function lineMargin(
  unitPrice: number,
  unitCost: number,
  quantity: number,
): LineMargin {
  const qty = Number(quantity) || 0;
  const revenue = (Number(unitPrice) || 0) * qty;
  const cost = (Number(unitCost) || 0) * qty;
  const profit = revenue - cost;

  return {
    revenue,
    cost,
    profit,
    marginPercent: revenue !== 0 ? Math.round((profit / revenue) * 1000) / 10 : null,
  };
}
