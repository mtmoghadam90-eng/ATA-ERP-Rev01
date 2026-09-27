/**
 * How a price was arrived at.
 *
 * `BREAKDOWN` is the original: enter every cost component and the landed cost
 * falls out. `MANUAL` is for when the components are not known or not worth
 * typing — the landed cost and the selling price are stated outright.
 *
 * Both end at the same two numbers, which is the point: everything downstream
 * (margin, customer value) reads the landed cost and does not care how it was
 * reached, only that it is there.
 */
export type PriceCalcMode = 'BREAKDOWN' | 'MANUAL';

export interface PriceCalcInputs {
  /** Defaults to BREAKDOWN, so records written before this existed still work. */
  mode?: PriceCalcMode;
  /**
   * MANUAL only: the landed cost and selling price as stated, **in the
   * currency `priceForeign` is quoted in** — not forced to rial. Entering a
   * cost in the same currency as the sale is what keeps the margin percentage
   * independent of the exchange rate.
   */
  manualLandedForeign?: number;
  manualSellingForeign?: number;
  priceForeign: number;
  exchangeRate: number;
  remittanceFee: number;
  remittancePct: number;
  shippingCost: number;
  /**
   * The freight's own currency and rate, apart from the goods' and the
   * exchange house's (the purchase order's rule, `purchaseOrderCost.ts`).
   * Blank currency and no rate = freight in the goods' currency at their rate,
   * which is every calculator saved before these existed. «ریال» is ×1.
   */
  shippingCurrency?: string;
  shippingExchangeRate?: number;
  otherCostsForeign: number;
  customsDutyRIYAL: number;
  otherCostsRIYAL: number;
  profitPct: number;
  profitRIYAL: number;
  marginType: 'PERCENT' | 'FIXED';
}

export interface PriceCalcOutputs {
  remittanceForeign: number;
  totalForeignCost: number;
  landedForeign: number;
  landedRial: number;
  sellingRial: number;
  sellingForeign: number;
  profitAmountRial: number;
}

/** Why the freight cannot be costed (a foreign currency with no rate), or null. */
export function calcFreightRefusal(i: Pick<PriceCalcInputs, 'shippingCost' | 'shippingCurrency' | 'shippingExchangeRate'>): string | null {
  const cur = String(i.shippingCurrency ?? "").trim();
  if (!cur || cur === "ریال" || !(Number(i.shippingCost) > 0)) return null;
  return Number(i.shippingExchangeRate) > 0 ? null : `نرخ تسعیر حمل (${cur}) را وارد کنید؛ بدون آن هزینهٔ حمل حساب نمی‌شود.`;
}

export function calculateSellingPrice(i: PriceCalcInputs): PriceCalcOutputs {
  /*
   * Stated outright rather than built up.
   *
   * The rate still converts to rial for the figures that must be rial, but it
   * is not required: with no rate the foreign numbers stand on their own and
   * the rial ones come out zero, which is honest — an unknown rial value, not
   * a wrong one.
   */
  if (i.mode === 'MANUAL') {
    const rateManual = Number(i.exchangeRate) || 0;
    const landedForeignManual = Number(i.manualLandedForeign) || 0;
    const sellingForeignManual = Number(i.manualSellingForeign) || 0;
    const landedRialManual = landedForeignManual * rateManual;
    const sellingRialManual = sellingForeignManual * rateManual;

    return {
      remittanceForeign: 0,
      totalForeignCost: landedForeignManual,
      landedForeign: landedForeignManual,
      landedRial: landedRialManual,
      sellingRial: sellingRialManual,
      sellingForeign: sellingForeignManual,
      profitAmountRial: sellingRialManual - landedRialManual,
    };
  }

  const baseOrig = Number(i.priceForeign) || 0;
  const remitPct = Number(i.remittancePct) || 0;
  const remitFee = Number(i.remittanceFee) || 0;
  const shipCost = Number(i.shippingCost) || 0;
  const otherCostForeign = Number(i.otherCostsForeign) || 0;
  const rate = Number(i.exchangeRate) || 0;
  const customsDuty = Number(i.customsDutyRIYAL) || 0;
  const otherCostRial = Number(i.otherCostsRIYAL) || 0;
  const profitPct = Number(i.profitPct) || 0;
  const profitRial = Number(i.profitRIYAL) || 0;

  const remittanceForeign = remitFee + (baseOrig * remitPct) / 100;
  /*
   * Freight at its own rate when one is set — the forwarder is paid apart from
   * the exchange house. Otherwise it is part of the goods' foreign sum, exactly
   * as before.
   */
  const freightCurrency = String(i.shippingCurrency ?? "").trim();
  const freightRate = freightCurrency === "ریال" ? 1 : Number(i.shippingExchangeRate) || 0;
  const freightSeparate = freightCurrency !== "" || freightRate > 0;
  const freightRial = freightSeparate ? shipCost * freightRate : 0;
  const totalForeignCost = baseOrig + remittanceForeign + otherCostForeign + (freightSeparate ? 0 : shipCost);
  const rawRialCost = totalForeignCost * rate;
  const landedRial = rawRialCost + freightRial + customsDuty + otherCostRial;
  const landedForeign = totalForeignCost + (rate > 0 ? (freightRial + customsDuty + otherCostRial) / rate : 0);

  let sellingRial = 0;
  let profitAmountRial = 0;

  if (i.marginType === 'PERCENT') {
    sellingRial = landedRial * (1 + profitPct / 100);
    profitAmountRial = sellingRial - landedRial;
  } else {
    sellingRial = landedRial + profitRial;
    profitAmountRial = profitRial;
  }

  const sellingForeign = rate > 0 ? sellingRial / rate : 0;

  return {
    remittanceForeign,
    totalForeignCost,
    landedForeign,
    landedRial,
    sellingRial,
    sellingForeign,
    profitAmountRial,
  };
}
