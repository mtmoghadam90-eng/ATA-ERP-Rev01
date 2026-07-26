export interface PriceCalcInputs {
  priceForeign: number;
  exchangeRate: number;
  remittanceFee: number;
  remittancePct: number;
  shippingCost: number;
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

export function calculateSellingPrice(i: PriceCalcInputs): PriceCalcOutputs {
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
  const totalForeignCost = baseOrig + remittanceForeign + shipCost + otherCostForeign;
  const rawRialCost = totalForeignCost * rate;
  const landedRial = rawRialCost + customsDuty + otherCostRial;
  const landedForeign = totalForeignCost + (rate > 0 ? (customsDuty + otherCostRial) / rate : 0);

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
