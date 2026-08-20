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

import { PriceCalcInputs, PriceCalcMode, calculateSellingPrice } from "./priceCalculator";

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

/* ------------------------ reading the calculator -------------------------- */

/**
 * The calculator's stored inputs, under either spelling.
 *
 * A product and a SKU keep them as `calc…` fields; the reporting export and a
 * few older blobs use the bare names. Both are read so neither shape has to be
 * normalized before this can answer.
 */
export type CalcFields = Record<string, unknown>;

const pick = (calc: CalcFields, name: string): unknown =>
  calc[`calc${name[0].toUpperCase()}${name.slice(1)}`] ?? calc[name];

const num = (calc: CalcFields, name: string): number => Number(pick(calc, name) ?? 0);

/**
 * What a product or SKU costs to land, per unit, in rial — or null if nobody
 * has filled its calculator in.
 *
 * **The single reader.** This was written twice, once on each side: the proforma
 * form worked out a line's suggested cost, and the customer-value service
 * worked out the same figure for its fallback. They had already drifted — the
 * server fell back to the parent product's calculator for a SKU that has none
 * of its own and the client did not, so the same item offered a cost in a report
 * and a blank box on the form.
 *
 * `own` is the SKU's calculator and `parent` the product's. A SKU with its own
 * figures wins; one with none inherits, because that is what a SKU without its
 * own pricing means.
 */
export function landedUnitCostOf(
  own: CalcFields | null | undefined,
  parent?: CalcFields | null,
): number | null {
  return landedFromOne(own) ?? landedFromOne(parent);
}

function landedFromOne(calc: CalcFields | null | undefined): number | null {
  if (!calc || typeof calc !== "object") return null;

  const mode = (pick(calc, "mode") === "MANUAL" ? "MANUAL" : "BREAKDOWN") as PriceCalcMode;
  const inputs: PriceCalcInputs = {
    // An item priced by hand states its cost outright. Reading it through the
    // breakdown instead would answer with whatever the unused freight and
    // customs fields happened to hold — usually zero, which is the one wrong
    // answer that never looks wrong.
    mode,
    manualLandedForeign: num(calc, "manualLandedForeign"),
    manualSellingForeign: num(calc, "manualSellingForeign"),
    priceForeign: num(calc, "priceForeign"),
    exchangeRate: num(calc, "exchangeRate"),
    remittanceFee: num(calc, "remittanceFee"),
    remittancePct: num(calc, "remittancePct"),
    shippingCost: num(calc, "shippingCost"),
    otherCostsForeign: num(calc, "otherCostsForeign"),
    customsDutyRIYAL: num(calc, "customsDutyRIYAL"),
    otherCostsRIYAL: num(calc, "otherCostsRIYAL"),
    profitPct: num(calc, "profitPct"),
    profitRIYAL: num(calc, "profitRIYAL"),
    marginType: (pick(calc, "marginType") ?? "PERCENT") as "PERCENT" | "FIXED",
  };

  // No rate means nothing can be turned into rial. Under the breakdown a
  // missing purchase price means the calculator was never filled in at all;
  // under manual entry there is no purchase price to have, so the stated cost
  // stands on its own.
  if (inputs.exchangeRate <= 0) return null;
  if (mode !== "MANUAL" && inputs.priceForeign <= 0) return null;

  const landed = calculateSellingPrice(inputs).landedRial;
  return landed > 0 ? landed : null;
}

/** Parses a stored `priceCalc` JSON column. Null for anything unreadable. */
export function parseCalcFields(priceCalc: unknown): CalcFields | null {
  if (!priceCalc) return null;
  if (typeof priceCalc === "object") return priceCalc as CalcFields;
  if (typeof priceCalc !== "string") return null;
  try {
    const parsed = JSON.parse(priceCalc);
    return parsed && typeof parsed === "object" ? (parsed as CalcFields) : null;
  } catch {
    return null;
  }
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
