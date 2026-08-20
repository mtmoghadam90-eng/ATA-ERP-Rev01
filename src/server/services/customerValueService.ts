import { Prisma } from "@prisma/client";
import { getDb } from "../db";
import { loadSettings } from "../settings";
import { dateToJalali } from "../dates";
import { getProformaOutcome } from "../proformaStatus";
import { getWonItemsCurrencyAmount } from "../../utils/finance";
import { calculateSellingPrice, PriceCalcInputs } from "../../utils/priceCalculator";
import {
  CustomerRank, CustomerValueSettings, PotentialInputs,
  calculateCVI, calculatePotentialScore, calculateRealizedScore,
  costToServeScoreOf, determineRank, normalizeCustomerValueSettings,
  paymentScoreOf, percentileRank, recencyScore, resolveRank,
} from "../../utils/customerValue";

/**
 * Customer value: what each customer has been worth, and what they might be.
 *
 * The arithmetic itself lives in `src/utils/customerValue.ts` and is pure. This
 * module is the part that has to know where the numbers come from — which is
 * where all the judgement is, because this ERP has no invoice table and no cost
 * column on a sale. See `grossProfitOf` for how cost of goods is recovered.
 *
 * **Why everything is recalculated together.** Gross profit and frequency are
 * scored by *percentile* — a customer's score is their standing among the
 * others, so one customer's new sale moves everybody else's score. There is no
 * such thing as recalculating one customer correctly in isolation, and a
 * function that pretended otherwise would drift a little further from the truth
 * with every write. `recalculateCustomer` therefore refreshes that customer's
 * raw figures and then re-scores the whole population; the work is bounded by
 * the number of customers, not by how often it is called.
 */

/* ------------------------------ what is a sale --------------------------- */

/**
 * A sale is a proforma that ended with at least one won line.
 *
 * This ERP quotes rather than invoices: the proforma *is* the order once its
 * lines are marked won. Drafts, sent quotations still being negotiated, lost
 * and cancelled documents are all excluded — `getProformaOutcome` is the
 * authority, so a cancelled document whose lines still read «برنده» is not a
 * sale here any more than it is anywhere else in the system.
 *
 * A sale's date is the day it was **approved**, not the day it was quoted —
 * see `saleDateOf`.
 */
const SALE_SELECT = {
  id: true, customerId: true, status: true, isCancelled: true, currency: true,
  finalAmount: true, totalAmount: true,
  discountPercent: true, discountAmount: true, taxPercent: true, taxAmount: true,
  extraCosts: true, historicalExchangeRate: true,
  issueDate: true, issueDateJalali: true,
  // The approval date lives on the project, not the quotation — see saleDateOf.
  project: { select: { winningDate: true } },
  items: {
    select: {
      id: true, productId: true, variantId: true, productName: true,
      quantity: true, unitPriceRial: true, totalPriceRial: true,
      // The cost recorded on the line at the time of sale — the authority, and
      // the only one of the three sources that cannot be rewritten later by
      // re-pricing a product or editing a purchase order.
      unitCost: true, costCurrency: true, costSource: true,
      status: true, supplyMethod: true,
    },
  },
} satisfies Prisma.ProformaSelect;

type SaleRow = Prisma.ProformaGetPayload<{ select: typeof SALE_SELECT }>;

const money = (value: unknown): number => Number(value ?? 0);

/** The proforma in the shape `src/utils/finance.ts` expects. */
function toFinanceShape(row: SaleRow): never {
  return {
    id: row.id,
    status: row.status,
    isCancelled: row.isCancelled,
    currency: row.currency,
    totalAmount: money(row.totalAmount),
    finalAmount: money(row.finalAmount),
    discountPercent: money(row.discountPercent),
    discountAmount: money(row.discountAmount),
    taxPercent: money(row.taxPercent),
    taxAmount: money(row.taxAmount),
    extraCosts: money(row.extraCosts),
    historicalExchangeRate: row.historicalExchangeRate ? money(row.historicalExchangeRate) : undefined,
    items: row.items.map((item) => ({
      id: item.id,
      productName: item.productName,
      quantity: Number(item.quantity),
      unitPriceRIYAL: money(item.unitPriceRial),
      totalPriceRIYAL: money(item.totalPriceRial),
      status: item.status ?? undefined,
      supplyMethod: item.supplyMethod ?? undefined,
    })),
  } as never;
}

/**
 * The day a sale happened: the project's approval date («تاریخ تایید (ابلاغ
 * قرارداد)»), which is what `winningDate` holds.
 *
 * Not the proforma's issue date. A quotation written in Farvardin and approved
 * in Mehr is a Mehr sale — using the issue date would count it in the wrong
 * evaluation period and, worse, make a customer look six months staler than
 * they are. The gap between quoting and winning is routine in this business,
 * which is exactly why the approval date is recorded separately.
 *
 * Falls back to the issue date in the two cases where there is no approval date
 * to use: a proforma with no project at all, and a project won before that date
 * was being stamped. The issue date is then the only evidence there is, and a
 * slightly early date is better than dropping the sale entirely.
 */
export function saleDateOf(row: { issueDate: Date; project?: { winningDate: Date | null } | null }): Date {
  return row.project?.winningDate ?? row.issueDate;
}

export function isSale(row: SaleRow): boolean {
  const outcome = getProformaOutcome(row);
  return outcome === "تأیید شده (برنده)" || outcome === "نیمه برنده";
}

/** Revenue of one sale in rial, at the rate stored on the document itself. */
export function saleRevenueRial(row: SaleRow): number | null {
  const inCurrency = getWonItemsCurrencyAmount(toFinanceShape(row));
  const isRial = !row.currency || row.currency === "ریال";
  if (isRial) return inCurrency;

  const rate = money(row.historicalExchangeRate);
  // A foreign sale with no stored rate has an unknown rial value, not a zero
  // one. Guessing at today's rate would restate a historical sale every time
  // the market moved.
  return rate > 0 ? inCurrency * rate : null;
}

/* ------------------------------ cost of goods ---------------------------- */

/**
 * What the goods on a sale cost us.
 *
 * Three sources are used, best first:
 *
 *  0. **The cost recorded on the line itself** (`unitCost`), in the proforma's
 *     own currency. Every line saved since the cost fields existed has one, and
 *     it is the only source that is a *fact about that sale*: the other two are
 *     read from records that go on changing after the sale is closed, so a
 *     re-priced product or an edited purchase order would otherwise rewrite
 *     last year's profit and re-rank customers who bought nothing since.
 *
 *  1. **The actual purchase.** `PurchaseOrderItem.proformaItemId` links a
 *     purchase line back to the sale line it was raised for, so where an order
 *     exists the real cost is known — the line's share of that order's landed
 *     cost, which already includes freight, customs and remittance.
 *
 *  2. **The product's standard landed cost**, from the price calculator stored
 *     on the product or SKU. This is what the company itself uses to price the
 *     item, so it is the right fallback for anything sold from stock.
 *
 * Anything else — a free-text line, or a product nobody has costed — has no
 * cost. Such a line's revenue is deliberately **excluded from both sides** of
 * the margin rather than being treated as pure profit, and the share of revenue
 * that could be costed is reported as `coverage` so a suspiciously good margin
 * can be recognised as missing data rather than a triumph.
 */
export interface CostLookup {
  /** proformaItemId -> cost in rial for the whole line. */
  byProformaItem: Map<string, number>;
  /** productId/variantId -> standard landed cost per unit, in rial. */
  standardUnitCost: Map<string, number>;
}

const variantKey = (productId: string | null, variantId: string | null) =>
  `${productId ?? ""}|${variantId ?? ""}`;

/** Reads the price-calculator blob and returns the landed cost per unit. */
export function landedUnitCostFrom(priceCalc: string | null): number | null {
  if (!priceCalc) return null;
  let parsed: Partial<PriceCalcInputs> & Record<string, unknown>;
  try {
    parsed = JSON.parse(priceCalc) as never;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  // The calculator's own inputs are stored under `calc*` names on the record.
  const inputs: PriceCalcInputs = {
    // A product priced by hand states its cost outright. Reading it through the
    // breakdown instead would answer with whatever the unused freight and
    // customs fields happened to hold — usually zero, which is the one wrong
    // answer that never looks wrong.
    mode: (parsed.calcMode ?? parsed.mode) === "MANUAL" ? "MANUAL" : "BREAKDOWN",
    manualLandedForeign: Number(parsed.calcManualLandedForeign ?? parsed.manualLandedForeign ?? 0),
    manualSellingForeign: Number(parsed.calcManualSellingForeign ?? parsed.manualSellingForeign ?? 0),
    priceForeign: Number(parsed.calcPriceForeign ?? parsed.priceForeign ?? 0),
    exchangeRate: Number(parsed.calcExchangeRate ?? parsed.exchangeRate ?? 0),
    remittanceFee: Number(parsed.calcRemittanceFee ?? parsed.remittanceFee ?? 0),
    remittancePct: Number(parsed.calcRemittancePct ?? parsed.remittancePct ?? 0),
    shippingCost: Number(parsed.calcShippingCost ?? parsed.shippingCost ?? 0),
    otherCostsForeign: Number(parsed.calcOtherCostsForeign ?? parsed.otherCostsForeign ?? 0),
    customsDutyRIYAL: Number(parsed.calcCustomsDutyRIYAL ?? parsed.customsDutyRIYAL ?? 0),
    otherCostsRIYAL: Number(parsed.calcOtherCostsRIYAL ?? parsed.otherCostsRIYAL ?? 0),
    profitPct: Number(parsed.calcProfitPct ?? parsed.profitPct ?? 0),
    profitRIYAL: Number(parsed.calcProfitRIYAL ?? parsed.profitRIYAL ?? 0),
    marginType: (parsed.calcMarginType ?? parsed.marginType ?? "PERCENT") as "PERCENT" | "FIXED",
  };

  // No rate means nothing can be turned into rial. Under the breakdown a
  // missing purchase price means the calculator was never filled in at all;
  // under manual entry there is no purchase price to have, so the stated cost
  // stands on its own.
  if (inputs.exchangeRate <= 0) return null;
  if (inputs.mode !== "MANUAL" && inputs.priceForeign <= 0) return null;
  const landed = calculateSellingPrice(inputs).landedRial;
  return landed > 0 ? landed : null;
}

/**
 * Builds the cost lookups for a set of sales, in two queries.
 *
 * Per-line purchase cost is the line's share of its order's landed cost,
 * apportioned by value — the order's freight and customs belong to every line
 * on it, not only to the one that happened to be linked.
 */
export async function buildCostLookup(
  db: Prisma.TransactionClient,
  sales: SaleRow[],
): Promise<CostLookup> {
  const byProformaItem = new Map<string, number>();
  const standardUnitCost = new Map<string, number>();

  const itemIds = sales.flatMap((s) => s.items.map((i) => i.id));
  const productIds = [...new Set(
    sales.flatMap((s) => s.items.map((i) => i.productId).filter((id): id is string => !!id)),
  )];

  if (itemIds.length > 0) {
    const poLines = await db.purchaseOrderItem.findMany({
      where: { proformaItemId: { in: itemIds } },
      select: {
        proformaItemId: true, totalPriceForeign: true,
        purchaseOrder: {
          select: { id: true, landedCostRial: true, totalForeignAmount: true },
        },
      },
    });

    for (const line of poLines) {
      if (!line.proformaItemId) continue;
      const order = line.purchaseOrder;
      const orderTotal = money(order?.totalForeignAmount);
      const landed = money(order?.landedCostRial);
      if (orderTotal <= 0 || landed <= 0) continue;

      // This line's share of everything the order cost to land.
      const share = money(line.totalPriceForeign) / orderTotal;
      const cost = landed * share;
      byProformaItem.set(
        line.proformaItemId,
        (byProformaItem.get(line.proformaItemId) ?? 0) + cost,
      );
    }
  }

  if (productIds.length > 0) {
    const products = await db.product.findMany({
      where: { id: { in: productIds } },
      select: {
        id: true, priceCalc: true,
        variants: { select: { id: true, priceCalc: true } },
      },
    });
    for (const product of products) {
      const base = landedUnitCostFrom(product.priceCalc);
      if (base !== null) standardUnitCost.set(variantKey(product.id, null), base);
      for (const variant of product.variants) {
        // A SKU's own calculator wins over the parent's when it has one.
        const own = landedUnitCostFrom(variant.priceCalc) ?? base;
        if (own !== null) standardUnitCost.set(variantKey(product.id, variant.id), own);
      }
    }
  }

  return { byProformaItem, standardUnitCost };
}

/**
 * The cost recorded on a line, in rial, or null if there is none to read.
 *
 * `unitCost` is held in the proforma's own currency — deliberately, so that the
 * margin *percentage* on the document needs no exchange rate at all. Turning it
 * into rial for the ranking does, and a foreign document with no stored rate
 * therefore has an unknown rial cost rather than a zero one: the line drops out
 * of both sides of the margin, exactly as its revenue already does.
 *
 * A `NONE` line is a real zero and must survive the null checks around this —
 * "this line costs nothing" is an answer, and treating it as missing would send
 * the line down to the purchase-order fallback and cost it twice over.
 */
function snapshotCostRial(sale: SaleRow, line: SaleRow["items"][number]): number | null {
  if (line.unitCost === null || line.unitCost === undefined) return null;

  const perUnit = money(line.unitCost);
  const quantity = Number(line.quantity ?? 0);
  const inCurrency = perUnit * quantity;
  if (inCurrency === 0) return 0;

  if (!sale.currency || sale.currency === "ریال") return inCurrency;

  const rate = money(sale.historicalExchangeRate);
  return rate > 0 ? inCurrency * rate : null;
}

export interface GrossProfitResult {
  revenueRial: number;
  /** Revenue of the lines whose cost is known — the base the margin is over. */
  costedRevenueRial: number;
  cogsRial: number;
  grossProfitRial: number;
  /** 0..100: how much of the revenue could be costed at all. */
  coveragePercent: number;
}

/**
 * Gross profit across a set of sales.
 *
 * Revenue is every won line; cost of goods and therefore profit are only over
 * the lines that have a cost. That asymmetry is on purpose and is the honest
 * reading — the alternative, treating an unknown cost as zero, reports the
 * whole of an uncosted sale as profit and would put the least-documented
 * customers at the top of the ranking.
 */
export function grossProfitOf(sales: SaleRow[], costs: CostLookup): GrossProfitResult {
  let revenueRial = 0;
  let costedRevenueRial = 0;
  let cogsRial = 0;

  for (const sale of sales) {
    if (!isSale(sale)) continue;

    const saleRevenue = saleRevenueRial(sale);
    if (saleRevenue === null) continue; // unknown rate: contributes nothing
    revenueRial += saleRevenue;

    const wonLines = sale.items.filter((i) => i.status === "برنده");
    // Line revenue is apportioned from the document total, so discounts, tax and
    // extras already priced into `finalAmount` are reflected per line.
    const lineGross = wonLines.reduce((sum, i) => sum + money(i.totalPriceRial), 0);
    if (lineGross <= 0) continue;

    for (const line of wonLines) {
      const linePortion = money(line.totalPriceRial) / lineGross;
      const lineRevenue = saleRevenue * linePortion;

      // The snapshot first. It is in the document's currency, so it converts
      // at the document's own stored rate — the same one its revenue used, which
      // is what keeps the margin internally consistent for that sale.
      let cost: number | null = snapshotCostRial(sale, line);

      if (cost === null) {
        const actual = costs.byProformaItem.get(line.id);
        if (actual !== undefined) cost = actual;
      }

      if (cost === null && line.productId) {
        const unit = costs.standardUnitCost.get(variantKey(line.productId, line.variantId))
          ?? costs.standardUnitCost.get(variantKey(line.productId, null));
        if (unit !== undefined) cost = unit * Number(line.quantity ?? 0);
      }

      if (cost === null) continue; // uncosted: out of both sides of the margin
      costedRevenueRial += lineRevenue;
      cogsRial += cost;
    }
  }

  return {
    revenueRial: Math.round(revenueRial),
    costedRevenueRial: Math.round(costedRevenueRial),
    cogsRial: Math.round(cogsRial),
    grossProfitRial: Math.round(costedRevenueRial - cogsRial),
    coveragePercent: revenueRial > 0
      ? Math.round((costedRevenueRial / revenueRial) * 1000) / 10
      : 0,
  };
}

/* ------------------------------- raw figures ----------------------------- */

export interface CustomerRawFigures {
  customerId: string;
  salesRevenueRial: number;
  grossProfitRial: number;
  grossMarginPercent: number | null;
  costCoveragePercent: number;
  purchaseFrequency: number;
  lastPurchaseDate: Date | null;
  daysSinceLastPurchase: number | null;
  monthsSinceLastPurchase: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days between two dates, in UTC, so a timezone cannot shift a day. */
function daysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const b = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.max(0, Math.round((b - a) / DAY_MS));
}

/**
 * The raw figures for every customer, from one pass over the period's sales.
 *
 * Recency deliberately looks at **all** sales, not only the evaluation period:
 * "last bought 3 years ago" is a fact about the customer, and clipping it to the
 * window would make every dormant customer look equally, recently dormant.
 */
export async function collectRawFigures(
  db: Prisma.TransactionClient,
  settings: CustomerValueSettings,
  now: Date,
): Promise<Map<string, CustomerRawFigures>> {
  const periodStart = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth() - settings.evaluationPeriodMonths,
    now.getUTCDate(),
  ));

  /*
   * The period cannot be a SQL `where` any more.
   *
   * A sale's date is its project's approval date, so filtering on the
   * proforma's own `issueDate` would take the wrong set — a quotation issued
   * before the window and approved inside it is a sale in this period, and one
   * issued inside it but approved later is not. So every candidate is scanned
   * cheaply first, the effective date decides which are in the period, and only
   * those are read in full.
   */
  const candidates = await db.proforma.findMany({
    select: {
      id: true, customerId: true, issueDate: true,
      status: true, isCancelled: true,
      project: { select: { winningDate: true } },
      items: { select: { status: true, supplyMethod: true } },
    },
  });

  const lastPurchase = new Map<string, Date>();
  const inPeriodIds: string[] = [];

  for (const row of candidates) {
    const outcome = getProformaOutcome(row);
    if (outcome !== "تأیید شده (برنده)" && outcome !== "نیمه برنده") continue;

    const soldOn = saleDateOf(row);
    if (soldOn >= periodStart) inPeriodIds.push(row.id);

    // Recency deliberately looks at every sale, not only the period's.
    const current = lastPurchase.get(row.customerId);
    if (!current || soldOn > current) lastPurchase.set(row.customerId, soldOn);
  }

  const sales = inPeriodIds.length === 0 ? [] : await db.proforma.findMany({
    where: { id: { in: inPeriodIds } },
    select: SALE_SELECT,
  });

  const costs = await buildCostLookup(db, sales);

  const byCustomer = new Map<string, SaleRow[]>();
  for (const sale of sales) {
    const list = byCustomer.get(sale.customerId) ?? [];
    list.push(sale);
    byCustomer.set(sale.customerId, list);
  }

  const result = new Map<string, CustomerRawFigures>();
  const customerIds = new Set([...byCustomer.keys(), ...lastPurchase.keys()]);

  for (const customerId of customerIds) {
    const mine = byCustomer.get(customerId) ?? [];
    const profit = grossProfitOf(mine, costs);
    const last = lastPurchase.get(customerId) ?? null;
    const days = last ? daysBetween(last, now) : null;

    result.set(customerId, {
      customerId,
      salesRevenueRial: profit.revenueRial,
      grossProfitRial: profit.grossProfitRial,
      grossMarginPercent: profit.costedRevenueRial > 0
        ? Math.round((profit.grossProfitRial / profit.costedRevenueRial) * 1000) / 10
        : null,
      costCoveragePercent: profit.coveragePercent,
      // One sale is one purchase, however many lines it carried.
      purchaseFrequency: mine.length,
      lastPurchaseDate: last,
      daysSinceLastPurchase: days,
      monthsSinceLastPurchase: days === null ? null : days / 30.44,
    });
  }

  return result;
}

/**
 * Has this customer ever actually bought anything?
 *
 * The one question that decides whether they get a rank at all. `lastPurchaseDate`
 * is set from every confirmed sale ever recorded — `getProformaOutcome` already
 * excludes quotations, open opportunities and cancelled documents — so null here
 * means "never".
 *
 * Deliberately **not** `purchaseFrequency`, which counts only the evaluation
 * period. A customer who last bought three years ago is *lapsed*, not a
 * prospect: they have a history, their recency score already says how stale it
 * is, and calling them a prospect would throw away everything they were worth.
 */
export function hasEverPurchased(
  figures: Pick<CustomerRawFigures, "lastPurchaseDate"> | null | undefined,
): boolean {
  return (figures?.lastPurchaseDate ?? null) !== null;
}

/* ----------------------------- the whole pass ---------------------------- */

export async function loadCustomerValueSettings(): Promise<CustomerValueSettings> {
  const settings = await loadSettings() as { customerValue?: Partial<CustomerValueSettings> } | null;
  return normalizeCustomerValueSettings(settings?.customerValue);
}

export interface RecalculationSummary {
  customers: number;
  ranked: number;
  pending: number;
  /** Customers with no confirmed purchase yet — scored on potential only. */
  prospects: number;
  /** How many kept a manually locked rank rather than the computed one. */
  lockedManual: number;
  calculatedAt: Date;
}

/**
 * Recomputes every customer's value metrics.
 *
 * One pass, because the percentile scores are only meaningful against the whole
 * population. Written in batches so a few thousand customers do not become one
 * enormous transaction — each batch is internally consistent, and a scoreboard
 * does not need more than that.
 */
export async function recalculateAll(now: Date = new Date()): Promise<RecalculationSummary> {
  const db = getDb();
  const settings = await loadCustomerValueSettings();

  const customers = await db.customer.findMany({
    select: {
      id: true,
      paymentBehaviour: true, costToServe: true,
      potentialConsumption: true, potentialCompanySize: true, potentialProjects: true,
      potentialPortfolioFit: true, potentialRepeatPurchase: true,
      manualRank: true, manualRankLocked: true,
    },
  });

  const raw = await collectRawFigures(db, settings, now);

  /*
   * The population the percentiles are measured against: customers with
   * activity in the period. Including everyone would hand a top-decile gross
   * profit score to anybody who sold anything at all, simply because most of a
   * long customer list is dormant at any moment.
   */
  const activeProfits: number[] = [];
  const activeFrequencies: number[] = [];
  for (const figures of raw.values()) {
    if (figures.purchaseFrequency > 0) {
      activeProfits.push(figures.grossProfitRial);
      activeFrequencies.push(figures.purchaseFrequency);
    }
  }

  let ranked = 0;
  let pending = 0;
  let prospects = 0;
  let lockedManual = 0;
  /** Unlocked overrides, cleared once the evaluation has taken back over. */
  const resumed: string[] = [];
  const rows: Prisma.CustomerValueMetricsUncheckedCreateInput[] = [];

  for (const customer of customers) {
    const figures = raw.get(customer.id);
    const hasSales = (figures?.purchaseFrequency ?? 0) > 0;

    const grossProfitScore = hasSales
      ? percentileRank(figures!.grossProfitRial, activeProfits) : 0;
    const frequencyScore = hasSales
      ? percentileRank(figures!.purchaseFrequency, activeFrequencies) : 0;
    const recency = recencyScore(figures?.monthsSinceLastPurchase ?? null, settings);
    const payment = paymentScoreOf(customer.paymentBehaviour);
    const costToServe = costToServeScoreOf(customer.costToServe);

    const components = {
      grossProfitScore,
      frequencyScore,
      recencyScore: recency,
      paymentScore: payment,
      costToServeScore: costToServe,
    };

    const potentialInputs: PotentialInputs = {
      consumption: customer.potentialConsumption,
      companySize: customer.potentialCompanySize,
      projects: customer.potentialProjects,
      portfolioFit: customer.potentialPortfolioFit,
      repeatPurchase: customer.potentialRepeatPurchase,
    };

    const hasConfirmedPurchase = hasEverPurchased(figures);

    const potentialValueScore = calculatePotentialScore(potentialInputs, settings);
    const computedRank = determineRank(
      calculateRealizedScore(components, settings),
      potentialValueScore,
      hasConfirmedPurchase,
      settings,
    );
    // A prospect has realized nothing, and the stored figure says so rather
    // than carrying a score built out of payment and cost-to-serve opinions
    // about somebody who has never paid an invoice. See evaluateCustomerValue.
    const realizedValueScore = computedRank === "PROSPECT"
      ? 0
      : calculateRealizedScore(components, settings);

    /*
     * A locked manual rank outranks the formula; an unlocked one does not.
     *
     * Unlocked means "correct it for now and let the evaluation take back
     * over", so this pass is exactly the moment it takes back over — the
     * override is dropped below, in the same transaction that writes the
     * computed rank, or the customer would keep showing a rank the metrics no
     * longer agree with.
     */
    const resolved = resolveRank(computedRank, customer);
    const rank = resolved.rank;
    const useManual = resolved.rankIsManual;
    if (useManual) lockedManual++;
    if (rank === "PENDING") pending++;
    else if (rank === "PROSPECT") prospects++;
    else ranked++;
    if (resolved.clearsOverride) resumed.push(customer.id);

    rows.push({
      customerId: customer.id,
      salesRevenueRial: new Prisma.Decimal(figures?.salesRevenueRial ?? 0),
      grossProfitRial: new Prisma.Decimal(figures?.grossProfitRial ?? 0),
      grossMarginPercent: figures?.grossMarginPercent ?? null,
      costCoveragePercent: figures?.costCoveragePercent ?? 0,
      purchaseFrequency: figures?.purchaseFrequency ?? 0,
      lastPurchaseDate: figures?.lastPurchaseDate ?? null,
      lastPurchaseDateJalali: dateToJalali(figures?.lastPurchaseDate ?? null),
      daysSinceLastPurchase: figures?.daysSinceLastPurchase ?? null,
      ...components,
      realizedValueScore,
      potentialValueScore,
      // CVI orders customers within a rank, and a prospect is not in one.
      customerValueIndex: computedRank === "PROSPECT"
        ? null
        : calculateCVI(realizedValueScore, potentialValueScore),
      customerValueRank: rank,
      computedRank,
      rankIsManual: useManual,
      calculatedAt: now,
    });
  }

  const BATCH = 100;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    await db.$transaction(async (tx) => {
      for (const row of batch) {
        const { customerId, ...rest } = row;
        await tx.customerValueMetrics.upsert({
          where: { customerId },
          create: row,
          update: rest,
        });
      }
    });
  }

  // Only now that the computed ranks are written: an override that was never
  // meant to be permanent has served its purpose and must not linger.
  if (resumed.length > 0) {
    await db.customer.updateMany({
      where: { id: { in: resumed } },
      data: { manualRank: null, manualRankNote: null },
    });
  }

  return { customers: rows.length, ranked, pending, prospects, lockedManual, calculatedAt: now };
}

/**
 * Recalculates after one customer's data changed.
 *
 * Deliberately the same whole-population pass: see the note at the top of this
 * file. Kept as its own name because the call sites read better for it, and so
 * there is one obvious place to make it incremental if the customer list ever
 * grows past what a single pass can carry.
 */
export async function recalculateCustomer(_customerId: string): Promise<RecalculationSummary> {
  return recalculateAll();
}

/* ------------------------- one customer's own card ----------------------- */

export interface CustomerValueDetail {
  rank: CustomerRank;
  /** What the formula said, even when a manual rank is in effect. */
  computedRank: CustomerRank;
  rankIsManual: boolean;
  manualRankLocked: boolean;
  manualRankNote: string | null;
  realizedValueScore: number;
  potentialValueScore: number | null;
  customerValueIndex: number | null;
  calculatedAt: Date | null;
  components: {
    grossProfitScore: number;
    frequencyScore: number;
    recencyScore: number;
    paymentScore: number;
    costToServeScore: number;
  };
  raw: {
    salesRevenueRial: number;
    grossProfitRial: number;
    grossMarginPercent: number | null;
    costCoveragePercent: number;
    purchaseFrequency: number;
    lastPurchaseDateJalali: string | null;
    daysSinceLastPurchase: number | null;
  };
  potentialInputs: PotentialInputs;
}

/** Everything behind one customer's rank, so the card can show its working. */
export async function getCustomerValueDetail(
  customerId: string,
): Promise<CustomerValueDetail | null> {
  const db = getDb();
  const customer = await db.customer.findUnique({
    where: { id: customerId },
    select: {
      potentialConsumption: true, potentialCompanySize: true, potentialProjects: true,
      potentialPortfolioFit: true, potentialRepeatPurchase: true,
      manualRank: true, manualRankLocked: true, manualRankNote: true,
      valueMetrics: true,
    },
  });
  if (!customer) return null;

  const m = customer.valueMetrics;
  return {
    rank: (m?.customerValueRank ?? "PENDING") as CustomerRank,
    computedRank: (m?.computedRank ?? "PENDING") as CustomerRank,
    rankIsManual: m?.rankIsManual ?? !!customer.manualRank,
    manualRankLocked: customer.manualRankLocked,
    manualRankNote: customer.manualRankNote,
    realizedValueScore: m?.realizedValueScore ?? 0,
    potentialValueScore: m?.potentialValueScore ?? null,
    customerValueIndex: m?.customerValueIndex ?? null,
    calculatedAt: m?.calculatedAt ?? null,
    components: {
      grossProfitScore: m?.grossProfitScore ?? 0,
      frequencyScore: m?.frequencyScore ?? 0,
      recencyScore: m?.recencyScore ?? 0,
      paymentScore: m?.paymentScore ?? 0,
      costToServeScore: m?.costToServeScore ?? 0,
    },
    raw: {
      salesRevenueRial: Number(m?.salesRevenueRial ?? 0),
      grossProfitRial: Number(m?.grossProfitRial ?? 0),
      grossMarginPercent: m?.grossMarginPercent ?? null,
      costCoveragePercent: m?.costCoveragePercent ?? 0,
      purchaseFrequency: m?.purchaseFrequency ?? 0,
      lastPurchaseDateJalali: m?.lastPurchaseDateJalali ?? null,
      daysSinceLastPurchase: m?.daysSinceLastPurchase ?? null,
    },
    potentialInputs: {
      consumption: customer.potentialConsumption,
      companySize: customer.potentialCompanySize,
      projects: customer.potentialProjects,
      portfolioFit: customer.potentialPortfolioFit,
      repeatPurchase: customer.potentialRepeatPurchase,
    },
  };
}

/** Rank counts and totals for the dashboard's summary cards. */
export async function customerValueSummary() {
  const db = getDb();
  const [groups, averages] = await Promise.all([
    db.customerValueMetrics.groupBy({
      by: ["customerValueRank"],
      _count: { _all: true },
      _sum: { grossProfitRial: true },
    }),
    db.customerValueMetrics.aggregate({
      // Customers who have never bought are excluded from the averages: their
      // realized score is a stored zero standing for "not applicable", and
      // counting it would drag the population average down by however many
      // leads happen to be on file.
      where: { customerValueRank: { not: "PROSPECT" } },
      _avg: { realizedValueScore: true, potentialValueScore: true },
    }),
  ]);

  return {
    byRank: groups.map((g) => ({
      rank: g.customerValueRank,
      count: g._count._all,
      grossProfitRial: Number(g._sum.grossProfitRial ?? 0),
    })),
    /** Leads with no confirmed purchase — outside the matrix, counted here. */
    prospects: groups.find((g) => g.customerValueRank === "PROSPECT")?._count._all ?? 0,
    averageRealized: Math.round((averages._avg.realizedValueScore ?? 0) * 10) / 10,
    averagePotential: Math.round((averages._avg.potentialValueScore ?? 0) * 10) / 10,
  };
}

/** One customer's potential-assessment log, newest first. */
export async function listPotentialHistory(customerId: string) {
  return getDb().customerPotentialHistory.findMany({
    where: { customerId },
    orderBy: { changedAt: "desc" },
    take: 100,
  });
}

/* ---------------------------- manual rank ------------------------------- */

export type ManualRankMode = "locked" | "resume";

/**
 * Sets, or clears, a customer's rank by hand.
 *
 * `mode` is the whole point of the feature. Overriding a rank means one of two
 * different things and the system cannot tell which:
 *
 *  * `locked` — this customer is this rank whatever the figures say. No
 *    recalculation will move them. For the strategic account whose worth is not
 *    in this year's numbers.
 *  * `resume` — the figures are wrong *today*. Show this rank now, and let the
 *    automatic evaluation take back over at the next recalculation, which
 *    clears the override.
 *
 * Passing a null rank clears the override outright and hands the customer back
 * to the formula immediately.
 *
 * The effective rank is written straight away rather than waiting for the next
 * pass — someone who has just set a rank by hand expects to see it.
 */
export async function setManualRank(
  customerId: string,
  rank: CustomerRank | null,
  mode: ManualRankMode,
  note: string | null,
  userId: string,
): Promise<{ rank: string; locked: boolean } | null> {
  const db = getDb();
  const customer = await db.customer.findUnique({
    where: { id: customerId },
    select: { id: true, valueMetrics: { select: { computedRank: true } } },
  });
  if (!customer) return null;

  const computed = customer.valueMetrics?.computedRank ?? "PENDING";
  const locked = rank !== null && mode === "locked";

  await db.$transaction(async (tx) => {
    await tx.customer.update({
      where: { id: customerId },
      data: {
        manualRank: rank,
        manualRankLocked: locked,
        manualRankNote: rank === null ? null : note,
        manualRankSetAt: rank === null ? null : new Date(),
        manualRankSetBy: rank === null ? null : userId,
      },
    });

    // Clearing hands the customer straight back to the formula.
    const effective = rank ?? computed;
    await tx.customerValueMetrics.updateMany({
      where: { customerId },
      data: { customerValueRank: effective, rankIsManual: rank !== null },
    });
  });

  return { rank: rank ?? computed, locked };
}
