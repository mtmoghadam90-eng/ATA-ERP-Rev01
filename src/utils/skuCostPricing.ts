/**
 * A SKU's price in the warehouse is its **cost**, and a proforma line priced
 * from it starts at that cost plus the calculator's default margin.
 *
 * The SKU table already read like a cost — a generated SKU's figure is the sum
 * of its options' FOB prices — while its column said «قیمت فروش», so choosing a
 * configuration on a quotation copied the cost into the selling price and the
 * line went out at a 0% margin. Now the figure lands in «بهای تمام‌شده», the
 * selling price is that cost marked up, and the calculator opens on the same
 * cost so a person can change the margin from where the line already stands.
 *
 * Pure: the screen supplies the rates and the stored margin.
 */

/** The margin the price calculator opens with when nothing is stored. */
export const DEFAULT_PROFIT_PCT = 55;

/** The margin for a line priced from a SKU: its stored percent, else the default. */
export function skuProfitPct(calc?: { calcMarginType?: string; calcProfitPct?: number } | null): number {
  const pct = Number(calc?.calcProfitPct);
  if (calc && (calc.calcMarginType ?? "PERCENT") === "PERCENT" && Number.isFinite(pct) && pct >= 0 && calc.calcProfitPct !== undefined) {
    return pct;
  }
  return DEFAULT_PROFIT_PCT;
}

/** A figure in a document's currency: whole rial, otherwise two decimals. */
export function roundInCurrency(amount: number, isRial: boolean): number {
  return isRial ? Math.round(amount) : Math.round(amount * 100) / 100;
}

/** The selling price a cost implies at a percent margin, in the same currency. */
export function sellingFromCost(cost: number, profitPct: number, isRial: boolean): number {
  return roundInCurrency(cost * (1 + profitPct / 100), isRial);
}

export interface SkuCostSeed {
  /** The cost in the SKU's own currency. */
  costForeign: number;
  /** The SKU's (its product's) currency. */
  currency: string;
  /** That currency's rate to rial. */
  rate: number;
  profitPct: number;
}

/**
 * The calculator working that reproduces the line: the SKU's cost as the
 * purchase price, no other costs, the margin as a percent. Opening it shows the
 * same cost and the same selling price the line was given.
 */
export function skuCostCalcSeed(seed: SkuCostSeed) {
  return {
    calcMode: "BREAKDOWN" as const,
    calcCurrency: seed.currency,
    calcPriceForeign: seed.costForeign,
    calcExchangeRate: seed.rate,
    calcRemittanceFee: 0,
    calcRemittancePct: 0,
    calcShippingCost: 0,
    calcCustomsDutyRIYAL: 0,
    calcOtherCostsForeign: 0,
    calcOtherCostsRIYAL: 0,
    calcProfitPct: seed.profitPct,
    calcProfitRIYAL: 0,
    calcMarginType: "PERCENT" as const,
  };
}
