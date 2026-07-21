import { parsePersianDate } from '../dateUtils';
export function roundCurrency(val: number): number {
  return Math.round(val * 100) / 100;
}

export function roundRiyal(val: number): number {
  return Math.round(val);
}

export function isAlmostZero(val: number): boolean {
  return Math.abs(val) < 0.001;
}

export function safeDivide(num: number, denom: number): number {
  if (isAlmostZero(denom)) return 0;
  return num / denom;
}
import { Proforma, Transaction, ExchangeRate, Project } from '../types';

// Helper to map Persian currency names to English codes
export const mapCurrencyToEnglish = (persian: string | undefined): 'USD' | 'EUR' | 'AED' | 'CNY' | 'IRR' => {
  if (persian === 'دلار') return 'USD';
  if (persian === 'یورو') return 'EUR';
  if (persian === 'درهم') return 'AED';
  if (persian === 'یوان') return 'CNY';
  return 'IRR';
};

// Helper to determine proforma literal status self-contained
export const getProformaLiteralStatus = (pf: Proforma): 'پیش‌نویس' | 'ارسال شده' | 'تأیید شده (برنده)' | 'لغو شده' | 'باخته' | 'نیمه برنده' | 'جاری' => {
  if (pf.isCancelled) return "لغو شده";

  const items = pf.items || [];
  if (items.length === 0) {
    if (pf.status === "پیش‌نویس") return "پیش‌نویس";
    return pf.status === "ارسال شده" ? "ارسال شده" : "جاری";
  }

  const wonCount = items.filter((i) => i.status === "برنده").length;
  const lostCount = items.filter((i) => i.status === "بازنده").length;
  const cancelledCount = items.filter((i) => i.status === "لغو شده").length;
  const totalCount = items.length;

  if (wonCount === totalCount) return "تأیید شده (برنده)";
  if (cancelledCount === totalCount) return "لغو شده";
  if (lostCount === totalCount) return "باخته";
  if (lostCount + cancelledCount === totalCount) {
    return cancelledCount > 0 ? "لغو شده" : "باخته";
  }

  if (wonCount > 0) return "نیمه برنده";

  if (pf.status === "پیش‌نویس") return "پیش‌نویس";
  if (pf.status === "ارسال شده") return "ارسال شده";
  return "جاری";
};

// Helper to check if a proforma counts as a won/sales proforma
export const isSalesProforma = (pf: Proforma): boolean => {
  const status = getProformaLiteralStatus(pf);
  return status === 'تأیید شده (برنده)' || status === 'نیمه برنده';
};

// Helper to get won items currency amount
export const getWonItemsCurrencyAmount = (pf: Proforma): number => {
  const status = getProformaLiteralStatus(pf);
  if (status !== 'تأیید شده (برنده)' && status !== 'نیمه برنده') return 0;
  
  if (status === 'تأیید شده (برنده)') {
    return pf.finalAmount || 0;
  }
  
  // For semi-winner: only won items
  const items = pf.items || [];
  let wonItems = [];
  const hasExplicitWon = items.some(item => item.status === 'برنده');
  if (hasExplicitWon) {
    wonItems = items.filter(item => item.status === 'برنده');
  } else {
    wonItems = items.filter(item => item.status !== 'بازنده');
  }
  
  // The fields in ProformaItem are named 'unitPriceRIYAL' and 'totalPriceRIYAL'
  // but they actually store the value in the proforma's selected currency.
  const wonItemsCurrencySumRaw = wonItems.reduce((sum, item) => sum + (item.totalPriceRIYAL || (item.quantity * item.unitPriceRIYAL) || 0), 0);
  
  // Calculate proportionate discount and tax if they were applied as percentages
  // Note: if discountAmount is an absolute value in Proforma, we should apply it proportionally to the winning items.
  let discountAmount = 0;
  if (pf.discountPercent && pf.discountPercent > 0) {
    discountAmount = wonItemsCurrencySumRaw * (pf.discountPercent / 100);
  } else if (pf.discountAmount && pf.discountAmount > 0) {
    // If absolute discount, apply proportion of won items vs total items sum
    const totalItemsSum = items.reduce((sum, item) => sum + (item.totalPriceRIYAL || (item.quantity * item.unitPriceRIYAL) || 0), 0);
    if (totalItemsSum > 0) {
      discountAmount = pf.discountAmount * (wonItemsCurrencySumRaw / totalItemsSum);
    }
  }

  // Calculate tax on the discounted amount
  let taxAmount = 0;
  if (pf.taxPercent && pf.taxPercent > 0) {
    taxAmount = (wonItemsCurrencySumRaw - discountAmount) * (pf.taxPercent / 100);
  } else if (pf.taxAmount && pf.taxAmount > 0) {
    // Note: total tax amount proportionally
    const totalItemsSum = items.reduce((sum, item) => sum + (item.totalPriceRIYAL || (item.quantity * item.unitPriceRIYAL) || 0), 0);
    if (totalItemsSum > 0) {
      taxAmount = pf.taxAmount * (wonItemsCurrencySumRaw / totalItemsSum);
    }
  }
  
  // Extra costs proportion
  let extraCosts = 0;
  if (pf.extraCosts && pf.extraCosts > 0) {
    const totalItemsSum = items.reduce((sum, item) => sum + (item.totalPriceRIYAL || (item.quantity * item.unitPriceRIYAL) || 0), 0);
    if (totalItemsSum > 0) {
      extraCosts = pf.extraCosts * (wonItemsCurrencySumRaw / totalItemsSum);
    }
  }

  return wonItemsCurrencySumRaw - discountAmount + taxAmount + extraCosts;
};

export interface ProformaFinanceReport {
  proformaId: string;
  proformaNumber: string;
  status: string;
  currency: 'دلار' | 'یورو' | 'درهم' | 'ریال' | 'یوان';
  salesAmountForeign: number;
  historicalExchangeRate: number;
  salesAmountHistoricalRiyal: number | null;
  
  actualReceivedRiyal: number;
  settledAmountForeign: number;
  settledSalesHistoricalRiyal: number | null;
  
  remainingAmountForeign: number;
  remainingAmountHistoricalRiyal: number | null;
  remainingAmountCurrentRiyal: number | null;
  
  realizedGainLoss: number | null;
  unrealizedGainLoss: number | null;
  settlementPercent: number;
  
  unallocatedRiyal: number; // Excess amount over sales amount
  
  missingHistoricalRate: boolean;
  missingSettlementRate: boolean;
  missingCurrentRate: boolean;
}

// Compute finance details for a single proforma
export const calculateProformaFinance = (
  pf: Proforma,
  transactions: Transaction[],
  currentExchangeRates: ExchangeRate[]
): ProformaFinanceReport => {
  const currency = pf.currency || 'ریال';
  const isRiyal = currency === 'ریال';
  
  // 1. Sales amount in original currency
  const salesAmountForeign = getWonItemsCurrencyAmount(pf);
  
  // 2. Historical exchange rate
  let historicalExchangeRate = 1;
  let missingHistoricalRate = false;
  if (!isRiyal) {
    historicalExchangeRate = pf.historicalExchangeRate || 0;
    if (historicalExchangeRate <= 0) {
      missingHistoricalRate = true;
    }
  }
  
  // 3. Sales amount historical Rial
  const salesAmountHistoricalRiyal = missingHistoricalRate && salesAmountForeign > 0
    ? null
    : salesAmountForeign * historicalExchangeRate;
  
  // 4. Find linked receipts
  const activeTransactions = transactions.filter(t => 
    t.status !== 'پیش‌نویس' && 
    t.status !== 'لغو شده' &&
    t.status !== 'برگشت شده' &&
    (t.type === 'دریافت' || (t.type === 'پرداخت' && (t.customerId || t.proformaId || t.reversalOfTransactionId)))
  );
  
  let actualReceivedRiyal = 0;
  let settledAmountForeign = 0;
  let missingSettlementRate = false;
  
  // For tracking unallocated excess
  let remainingForeignToSettle = salesAmountForeign;
  let unallocatedRiyal = 0;
  
  // Process transactions chronologically to allocate correctly
  const linkedTx = activeTransactions
    .filter(t => t.proformaId === pf.id)
    .sort((a, b) => parsePersianDate(a.date).getTime() - parsePersianDate(b.date).getTime());
    
  for (const t of linkedTx) {
    const isReversal = !!t.reversalOfTransactionId;
    const isPayment = t.type === 'پرداخت';
    const sign = (isReversal ? -1 : 1) * (isPayment ? -1 : 1);
    
    let txRiyal = (t.amountRIYAL || 0) * sign;
    let txRate = t.exchangeRate || 0;
    let txForeign = (t.amountForeign || 0) * sign;
    
    if (!isRiyal && txRate <= 0 && !isReversal) {
      missingSettlementRate = true;
    }
    
    let currentSettledForeign = 0;
    
    if (isRiyal) {
      currentSettledForeign = txRiyal;
      actualReceivedRiyal += txRiyal;
    } else {
      if (t.isDirectForeign) {
        // Direct foreign payment
        currentSettledForeign = txForeign;
        // Riyal equivalent is direct foreign * rate
        const calculatedRiyal = txForeign * (txRate || historicalExchangeRate || 1);
        actualReceivedRiyal += calculatedRiyal;
        txRiyal = calculatedRiyal;
      } else {
        // Rial payment for foreign currency
        actualReceivedRiyal += txRiyal;
        if (txRate > 0) {
          currentSettledForeign = txRiyal / txRate;
        } else {
          currentSettledForeign = 0;
        }
      }
    }
    
    if (isReversal) {
       // Just subtract from everything directly. 
       // Don't calculate 'excess' for reversals.
       settledAmountForeign += currentSettledForeign;
       remainingForeignToSettle -= currentSettledForeign;
    } else {
      // Check if we exceed remaining balance
      if (currentSettledForeign > remainingForeignToSettle + 0.0001) {
        const allowedForeign = remainingForeignToSettle;
        const excessForeign = currentSettledForeign - allowedForeign;
        
        settledAmountForeign += allowedForeign;
        remainingForeignToSettle = 0;
        
        // Part of the Rial amount goes to unallocated
        if (isRiyal) {
          unallocatedRiyal += excessForeign;
        } else {
          const rateToUse = txRate || historicalExchangeRate || 1;
          unallocatedRiyal += excessForeign * rateToUse;
        }
      } else {
        settledAmountForeign += currentSettledForeign;
        remainingForeignToSettle -= currentSettledForeign;
      }
    }
  }
  
  // 5. Remaining balances
  const remainingAmountForeign = Math.max(0, salesAmountForeign - settledAmountForeign);
  const remainingAmountHistoricalRiyal = missingHistoricalRate && remainingAmountForeign > 0
    ? null
    : remainingAmountForeign * historicalExchangeRate;
  
  // 6. Current rate reporting
  let currentRate = 1;
  let missingCurrentRate = false;
  if (!isRiyal) {
    const engCode = mapCurrencyToEnglish(currency);
    const rateObj = currentExchangeRates.find(r => r.currency === engCode);
    if (rateObj && rateObj.rateToRIYAL > 0) {
      currentRate = rateObj.rateToRIYAL;
    } else {
      currentRate = 0;
      missingCurrentRate = true;
    }
  }
  
  const remainingAmountCurrentRiyal = missingCurrentRate && remainingAmountForeign > 0 
    ? null 
    : remainingAmountForeign * currentRate;
  
  // 7. Realized and Unrealized Gains/Losses
  const settledSalesHistoricalRiyal = missingHistoricalRate && settledAmountForeign > 0
    ? null
    : settledAmountForeign * historicalExchangeRate;
  
  // Realized: Difference between actual received and historical cost of what was settled
  const realizedGainLoss = isRiyal ? 0 : (
    settledSalesHistoricalRiyal === null 
      ? null 
      : ((actualReceivedRiyal - unallocatedRiyal) - settledSalesHistoricalRiyal)
  );
  
  // Unrealized: Difference between current day value of remaining and its historical value
  const unrealizedGainLoss = isRiyal ? 0 : (
    (remainingAmountCurrentRiyal === null || remainingAmountHistoricalRiyal === null)
      ? null 
      : (remainingAmountCurrentRiyal - remainingAmountHistoricalRiyal)
  );
  
  // 8. Settlement percentage
  const settlementPercent = salesAmountForeign > 0 
    ? Math.min(100, Math.round((settledAmountForeign / salesAmountForeign) * 10000) / 100) 
    : 0;
    
  return {
    proformaId: pf.id,
    proformaNumber: pf.proformaNumber,
    status: pf.status,
    currency: currency as any,
    salesAmountForeign,
    historicalExchangeRate,
    salesAmountHistoricalRiyal,
    actualReceivedRiyal: actualReceivedRiyal - unallocatedRiyal, // Allocated received
    settledAmountForeign,
    settledSalesHistoricalRiyal,
    remainingAmountForeign,
    remainingAmountHistoricalRiyal,
    remainingAmountCurrentRiyal,
    realizedGainLoss,
    unrealizedGainLoss,
    settlementPercent,
    unallocatedRiyal,
    missingHistoricalRate,
    missingSettlementRate,
    missingCurrentRate
  };
};

export interface ProjectFinanceSummary {
  projectId: string;
  projectCode: string;
  projectName: string;
  customerId: string;
  customerName: string;
  status: string;
  
  proformas: ProformaFinanceReport[];
  
  totalSalesHistoricalRiyal: number | null;
  totalReceivedRiyal: number; // Sum of all actual received Rial (including unallocated)
  totalAllocatedReceivedRiyal: number;
  totalSettledSalesHistoricalRiyal: number | null;
  
  totalRemainingHistoricalRiyal: number | null;
  totalRemainingCurrentRiyal: number | null;
  
  totalRealizedGainLoss: number | null;
  totalUnrealizedGainLoss: number | null;
  
  totalUnallocatedRiyal: number; // Sum of excess payments + unallocated project-level receipts
  
  settlementPercent: number;
  
  // Currency-wise balances breakdown
  currencyBalances: { [key: string]: number };
  
  hasIncompleteData: boolean;
  hasMissingCurrentRate: boolean;
}

// Compute complete finance details for a project
export const calculateProjectFinance = (
  project: Project,
  allProformas: Proforma[],
  allTransactions: Transaction[],
  currentExchangeRates: ExchangeRate[]
): ProjectFinanceSummary => {
  // 1. Get won/semi-won proformas for this project
  const projectProformas = allProformas.filter(pf => pf.projectId === project.id && isSalesProforma(pf));
  
  // 2. Compute reports for each proforma
  const proformaReports = projectProformas.map(pf => 
    calculateProformaFinance(pf, allTransactions, currentExchangeRates)
  );
  
  // 3. Find unallocated transactions at the project level
  // These are receipts/payments linked to this project but NOT assigned to any proforma
  // Exclude supplier payments from project sales receipts
  const projectReceipts = allTransactions.filter(t => 
    t.projectId === project.id && 
    t.status !== 'پیش‌نویس' && 
    t.status !== 'لغو شده' &&
    t.status !== 'برگشت شده' &&
    (t.type === 'دریافت' || (t.type === 'پرداخت' && (t.customerId || t.proformaId || t.reversalOfTransactionId)))
  );
  
  const unallocatedTx = projectReceipts.filter(t => !t.proformaId);
  const directUnallocatedRiyal = unallocatedTx.reduce((sum, t) => {
    const isReversal = !!t.reversalOfTransactionId;
    const isPayment = t.type === 'پرداخت';
    const sign = (isReversal ? -1 : 1) * (isPayment ? -1 : 1);
    return sum + ((t.amountRIYAL || 0) * sign);
  }, 0);
  
  // 4. Sum up
  let totalSalesHistoricalRiyal: number | null = 0;
  let totalAllocatedReceivedRiyal = 0;
  let totalSettledSalesHistoricalRiyal: number | null = 0;
  let totalRemainingHistoricalRiyal: number | null = 0;
  let totalRemainingCurrentRiyal: number | null = 0;
  let totalRealizedGainLoss: number | null = 0;
  let totalUnrealizedGainLoss: number | null = 0;
  let totalProformaUnallocatedRiyal = 0;
  
  const currencyBalances: { [key: string]: number } = {};
  let hasIncompleteData = false;
  let hasMissingCurrentRate = false;
  
  for (const rep of proformaReports) {
    if (rep.salesAmountHistoricalRiyal === null) {
      totalSalesHistoricalRiyal = null;
    } else if (totalSalesHistoricalRiyal !== null) {
      totalSalesHistoricalRiyal += rep.salesAmountHistoricalRiyal;
    }
    
    totalAllocatedReceivedRiyal += rep.actualReceivedRiyal;
    
    if (rep.settledSalesHistoricalRiyal === null) {
      totalSettledSalesHistoricalRiyal = null;
    } else if (totalSettledSalesHistoricalRiyal !== null) {
      totalSettledSalesHistoricalRiyal += rep.settledSalesHistoricalRiyal;
    }
    
    if (rep.remainingAmountHistoricalRiyal === null) {
      totalRemainingHistoricalRiyal = null;
    } else if (totalRemainingHistoricalRiyal !== null) {
      totalRemainingHistoricalRiyal += rep.remainingAmountHistoricalRiyal;
    }
    
    if (rep.remainingAmountCurrentRiyal === null) {
      totalRemainingCurrentRiyal = null;
    } else if (totalRemainingCurrentRiyal !== null) {
      totalRemainingCurrentRiyal += rep.remainingAmountCurrentRiyal;
    }
    
    if (rep.realizedGainLoss === null) {
      totalRealizedGainLoss = null;
    } else if (totalRealizedGainLoss !== null) {
      totalRealizedGainLoss += rep.realizedGainLoss;
    }
    
    if (rep.unrealizedGainLoss === null) {
      totalUnrealizedGainLoss = null;
    } else if (totalUnrealizedGainLoss !== null) {
      totalUnrealizedGainLoss += rep.unrealizedGainLoss;
    }
    
    totalProformaUnallocatedRiyal += rep.unallocatedRiyal;
    
    if (rep.missingHistoricalRate || rep.missingSettlementRate) {
      hasIncompleteData = true;
    }
    if (rep.missingCurrentRate) {
      hasMissingCurrentRate = true;
    }
    
    if (rep.remainingAmountForeign > 0) {
      currencyBalances[rep.currency] = (currencyBalances[rep.currency] || 0) + rep.remainingAmountForeign;
    }
  }
  
  const totalUnallocatedRiyal = directUnallocatedRiyal + totalProformaUnallocatedRiyal;
  const totalReceivedRiyal = totalAllocatedReceivedRiyal + totalUnallocatedRiyal;
  
  // Overall settlement percent
  const settlementPercent = totalSalesHistoricalRiyal !== null && totalSalesHistoricalRiyal > 0 && totalSettledSalesHistoricalRiyal !== null
    ? Math.min(100, Math.round((totalSettledSalesHistoricalRiyal / totalSalesHistoricalRiyal) * 10000) / 100)
    : 0;
    
  return {
    projectId: project.id,
    projectCode: project.code,
    projectName: project.name,
    customerId: project.customerId,
    customerName: project.customerName,
    status: project.status,
    proformas: proformaReports,
    totalSalesHistoricalRiyal,
    totalReceivedRiyal,
    totalAllocatedReceivedRiyal,
    totalSettledSalesHistoricalRiyal,
    totalRemainingHistoricalRiyal,
    totalRemainingCurrentRiyal,
    totalRealizedGainLoss,
    totalUnrealizedGainLoss,
    totalUnallocatedRiyal,
    settlementPercent,
    currencyBalances,
    hasIncompleteData,
    hasMissingCurrentRate
  };
};

export interface CompanyFinanceSummary {
  totalSalesHistoricalRiyal: number;
  totalReceivedRiyal: number;
  totalSettledSalesHistoricalRiyal: number;
  totalRemainingHistoricalRiyal: number;
  totalRemainingCurrentRiyal: number | null;
  totalRealizedGainLoss: number;
  totalUnrealizedGainLoss: number | null;
}

// Compute total summary for the whole company
export const calculateCompanyFinanceSummary = (
  projects: Project[],
  allProformas: Proforma[],
  allTransactions: Transaction[],
  currentExchangeRates: ExchangeRate[]
): CompanyFinanceSummary => {
  let totalSalesHistoricalRiyal: number | null = 0;
  let totalReceivedRiyal = 0;
  let totalSettledSalesHistoricalRiyal: number | null = 0;
  let totalRemainingHistoricalRiyal: number | null = 0;
  let totalRemainingCurrentRiyal: number | null = 0;
  let totalRealizedGainLoss: number | null = 0;
  let totalUnrealizedGainLoss: number | null = 0;
  
  // Sum up across all projects
  for (const proj of projects) {
    const summary = calculateProjectFinance(proj, allProformas, allTransactions, currentExchangeRates);
    
    if (summary.totalSalesHistoricalRiyal === null) {
      totalSalesHistoricalRiyal = null;
    } else if (totalSalesHistoricalRiyal !== null) {
      totalSalesHistoricalRiyal += summary.totalSalesHistoricalRiyal;
    }
    
    totalReceivedRiyal += summary.totalReceivedRiyal;
    
    if (summary.totalSettledSalesHistoricalRiyal === null) {
      totalSettledSalesHistoricalRiyal = null;
    } else if (totalSettledSalesHistoricalRiyal !== null) {
      totalSettledSalesHistoricalRiyal += summary.totalSettledSalesHistoricalRiyal;
    }
    
    if (summary.totalRemainingHistoricalRiyal === null) {
      totalRemainingHistoricalRiyal = null;
    } else if (totalRemainingHistoricalRiyal !== null) {
      totalRemainingHistoricalRiyal += summary.totalRemainingHistoricalRiyal;
    }
    
    if (summary.totalRemainingCurrentRiyal === null) {
      totalRemainingCurrentRiyal = null;
    } else if (totalRemainingCurrentRiyal !== null) {
      totalRemainingCurrentRiyal += summary.totalRemainingCurrentRiyal;
    }
    
    if (summary.totalRealizedGainLoss === null) {
      totalRealizedGainLoss = null;
    } else if (totalRealizedGainLoss !== null) {
      totalRealizedGainLoss += summary.totalRealizedGainLoss;
    }
    
    if (summary.totalUnrealizedGainLoss === null) {
      totalUnrealizedGainLoss = null;
    } else if (totalUnrealizedGainLoss !== null) {
      totalUnrealizedGainLoss += summary.totalUnrealizedGainLoss;
    }
  }
  
  // Also include general (project-less) receipts/payments in total received
  const generalReceipts = allTransactions.filter(t => 
    !t.projectId && 
    t.status !== 'پیش‌نویس' && 
    t.status !== 'لغو شده' &&
    t.status !== 'برگشت شده' &&
    (t.type === 'دریافت' || (t.type === 'پرداخت' && (t.customerId || t.proformaId || t.reversalOfTransactionId)))
  );
  const generalReceivedRiyal = generalReceipts.reduce((sum, t) => {
    const isReversal = !!t.reversalOfTransactionId;
    const isPayment = t.type === 'پرداخت';
    const sign = (isReversal ? -1 : 1) * (isPayment ? -1 : 1);
    return sum + ((t.amountRIYAL || 0) * sign);
  }, 0);
  totalReceivedRiyal += generalReceivedRiyal;
  
  return {
    totalSalesHistoricalRiyal,
    totalReceivedRiyal,
    totalSettledSalesHistoricalRiyal,
    totalRemainingHistoricalRiyal,
    totalRemainingCurrentRiyal,
    totalRealizedGainLoss,
    totalUnrealizedGainLoss
  };
};
