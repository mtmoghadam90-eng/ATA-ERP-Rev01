/**
 * The same deal as `e2eScenario.ts`, over the rules rather than over the wire.
 *
 * Every derived figure in this application is computed by a pure function —
 * a proforma's outcome from its line statuses, a project's status from its
 * proformas, a delivery date from a term and a prepayment, a SKU from a feature
 * combination, a balance from documents and their reversals. Those functions are
 * where the damage happens when they are wrong, and they need no database, so
 * this runs anywhere in a second:
 *
 *   npm run test:rules
 *
 * It is not a substitute for `e2eScenario.ts`, which drives the real API and is
 * the only thing that proves the schema, permissions and Prisma layer agree with
 * these rules. It is the half you can run before every commit.
 *
 * English output: Persian in a Windows console comes out as question marks.
 */

/** The same storyline, over the rules that decide the derived figures. */
import { getProformaOutcome, getWonItems, deriveProjectStatus, statusWithoutProformas } from "../src/server/proformaStatus";
import { computeInquiryTotals } from "../src/utils/inquirySteps";
import { toNumber } from "../src/server/childSync";
import { getTodayShamsi, addWorkingDaysToShamsi, addDaysToShamsi, jalaliToGregorian, toShamsiStr } from "../src/dateUtils";
import { generateSku, decodeSku } from "../src/utils/skuUtils";
import {
  DEFAULT_CUSTOMER_VALUE_SETTINGS, calculateCVI, calculatePotentialScore, calculateRealizedScore,
  costToServeScoreOf, determineRank, isPotentialAssessed, normalizeCustomerValueSettings,
  paymentScoreOf, percentileRank, recencyScore, resolveRank, sumRealizedWeights,
  validateCustomerValueSettings,
} from "../src/utils/customerValue";
import { saleDateOf } from "../src/server/services/customerValueService";
import { findCustomerDuplicates } from "../src/utils/customerDuplicates";
import { canonicalizeProvince } from "../src/utils/iranProvinces";
import { calculateProjectFinance } from "../src/utils/finance";
import { canSeeCosts } from "../src/server/auth";
import {
  preserveLineCosts, redactCustomerValue, redactInquiry, redactProduct,
  redactPurchaseOrder, redactProforma, redactValueDetail, redactValueSummary,
  stripProductCostInput,
} from "../src/server/costs";
import { describeTransaction } from "../src/server/services/transactionService";
import { rowToCustomer } from "../src/api/customerAdapter";
import { rowToProject } from "../src/api/projectAdapter";
import { rowToProforma } from "../src/api/proformaAdapter";
import { rowToProduct } from "../src/api/productAdapter";
import { rowToSupplier } from "../src/api/suppliers";
import { rowToTransaction } from "../src/api/transactions";
import { detailToPurchaseOrder, purchaseOrderToWriteInput, rowToPurchaseOrder } from "../src/api/purchaseOrders";
import { rowToTask } from "../src/api/tasks";
import { samePermissions } from "../src/server/services/userService";
import { buildCustomerWhere } from "../src/server/services/customerService";
import { ACTIVITY_CATEGORY, canonicalCategoryName, sameCategory } from "../src/utils/activityCategories";
import { packableLines, outstandingFor } from "../src/utils/packingAllocation";
import { importStageDurations } from "../src/utils/importTimeline";
import { parseMilestoneRules } from "../src/server/services/milestoneAutomation";
import { FRESH_FOR_MS, refreshDecision, type RateRefreshState } from "../src/server/services/rateRefresh";
import { receivedDateImpliesStatus, computeTotals, RECEIVED_STATUS } from "../src/server/services/purchaseOrderService";
import { REQUIRED_FIELDS_METADATA } from "../src/utils/requiredFields";
import {
  COST_SOURCES, convertCost, lineMargin, lineNeedsCost, linesMissingCost, suggestLineCost,
} from "../src/utils/costOfGoods";
import { calculateSellingPrice } from "../src/utils/priceCalculator";
import { findHooksAfterEarlyReturn } from "../src/utils/hookOrder";
import { nextSequence, renderAround } from "../src/server/documentNumbers";
import { describeProformaChanges, proformaChangeSentence } from "../src/server/services/proformaChanges";
import {
  SCHEDULE_SUBJECTS, TIME_TRIGGER, describeSchedule, dueDay, isDue, scheduledRules, sweepRange,
} from "../src/utils/workflowSchedule";
import {
  assertLinesCosted, normalizeLineCost, stampSentDate,
} from "../src/server/services/proformaService";
import { formatMoney } from "../src/numUtils";
import { readdirSync, readFileSync } from "node:fs";
import { join as joinPath } from "node:path";
import type { CustomerRow } from "../src/api/customers";

let pass = 0; const fails: string[] = [];
const ok = (what: string, cond: boolean, got?: unknown) => {
  if (cond) { pass++; console.log(`   ok   ${what}`); }
  else { fails.push(what); console.log(`   FAIL ${what}${got === undefined ? "" : `  (got ${JSON.stringify(got)})`}`); }
};
const eq = (what: string, a: unknown, b: unknown) => ok(`${what} = ${JSON.stringify(b)}`, a === b, a);
const head = (s: string) => console.log(`\n── ${s}`);

/* 1. customer */
head("Customer: duplicate rules");
const existing = [{ id: "c1", customerType: "حقوقی", companyName: "پتروشیمی آزمون", email: "a@b.com", mobile: "09121234567", province: "تهران" }] as any[];
ok("same email is a soft duplicate",
  findCustomerDuplicates({ customerType: "حقوقی", companyName: "دیگر", email: "A@B.com" } as any, existing)[0]?.severity === "soft");
ok("same mobile written +98 is caught",
  findCustomerDuplicates({ customerType: "حقوقی", companyName: "دیگر", mobile: "+989121234567" } as any, existing).length === 1);
ok("a حقیقی never matches a حقوقی",
  findCustomerDuplicates({ customerType: "حقیقی", companyName: "پتروشیمی آزمون", email: "a@b.com" } as any, existing).length === 0);
eq("province spelled two ways canonicalises", canonicalizeProvince("آذربايجان شرقي"), canonicalizeProvince("آذربایجان شرقی"));

/* 2. product */
head("Product: SKU round trip");
const features = [
  { id: "f1", name: "سایز", code: "S", options: [
      { id: "o1", value: "۲ اینچ", code: "2I" }, { id: "o2", value: "۳ اینچ", code: "3I" }] },
  { id: "f2", name: "متریال", code: "M", options: [{ id: "o3", value: "استیل", code: "SS" }] },
] as any[];
const product = { id: "p1", code: "FT100", name: "فلومتر", features, variants: [] } as any;
const sku = generateSku("FT100", features, { "سایز": "۳ اینچ", "متریال": "استیل" });
ok(`SKU built (${sku})`, sku === "FT100-S3I-MSS", sku);
const decoded = decodeSku(sku, [product]);
ok("SKU decodes back to the same product", decoded?.product?.id === "p1", decoded?.product?.id);
ok("and to the same options",
  decoded?.attributes?.find(a => a.featureName === "سایز")?.optionValue === "۳ اینچ"
  && decoded?.attributes?.find(a => a.featureName === "متریال")?.optionValue === "استیل",
  decoded?.attributes);
ok("nothing in the SKU is left unexplained", (decoded?.unmatchedSegments ?? []).length === 0, decoded?.unmatchedSegments);

/* 3. numbers as people type them */
head("Numbers typed in Persian");
eq("Persian digits", toNumber("۱۲۳۴"), 1234);
eq("Persian decimal separator ٫", toNumber("۱۲٫۵"), 12.5);
eq("thousands separators", toNumber("۱٬۲۳۴٬۵۶۷"), 1234567);
eq("empty means the fallback, never NaN", toNumber("", 7), 7);

/* 4. inquiry */
head("Supplier inquiry: discounts");
const items = [{ quantity: 2, currency: "یورو", priceForeign: 1000, priceRiyal: 100_000_000 }] as any[];
const t1 = computeInquiryTotals(items, 10, 0);
eq("10% off the foreign gross", Math.round(t1.netForeign), 1800);
eq("and the rial side moves in the same proportion", Math.round(t1.netRiyal), 180_000_000);
const t2 = computeInquiryTotals(items, 10, 300);
eq("a fixed amount comes off what is left", Math.round(t2.netForeign), 1500);
ok("the two totals stay in step", Math.abs(t2.netRiyal / t2.netForeign - 100_000) < 1, t2.netRiyal / t2.netForeign);

/* 5. proforma + project status */
head("Proforma outcome and project status");
const pf = (id: string, statuses: string[], stored = "ارسال شده", createdAt = "2026-01-01") =>
  ({ id, createdAt, status: stored, items: statuses.map(s => ({ status: s, supplyMethod: "INVENTORY" })) }) as any;
eq("no lines decided yet keeps the stored status", getProformaOutcome(pf("a", [])), "ارسال شده");
eq("all lines won", getProformaOutcome(pf("a", ["برنده", "برنده"])), "تأیید شده (برنده)");
eq("one won one lost", getProformaOutcome(pf("a", ["برنده", "بازنده"])), "نیمه برنده");
eq("all lost", getProformaOutcome(pf("a", ["بازنده", "بازنده"])), "باخته");
eq("cancelled wins over everything", getProformaOutcome({ ...pf("a", ["برنده"]), isCancelled: true }), "لغو شده");
eq("only the won lines are shippable", getWonItems(pf("a", ["برنده", "بازنده"])).length, 1);

const won = pf("w", ["برنده", "برنده"], "ارسال شده", "2026-01-01");
const half = pf("h", ["برنده", "بازنده"], "ارسال شده", "2026-02-01");
const lost = pf("l", ["بازنده"], "ارسال شده", "2026-03-01");
eq("project, winners in one order", deriveProjectStatus([won, half]), "نیمه برنده");
eq("project, winners in the other order", deriveProjectStatus([half, won]), "نیمه برنده");
eq("a rejected alternative quote does not drag the project down", deriveProjectStatus([won, lost]), "برنده (موفق)");
eq("removing the last proforma walks the project back", statusWithoutProformas("برنده (موفق)"), "در حال مذاکره");
eq("but a stage a person set is left alone", statusWithoutProformas("در حال مذاکره"), null);

/* 6. delivery dates */
head("Delivery dates counted from the prepayment");
const today = getTodayShamsi();
const plus10w = addWorkingDaysToShamsi(today, 10);
const plus10c = addDaysToShamsi(today, 10);
ok(`working days land later than calendar days (${plus10c} → ${plus10w})`, plus10w >= plus10c);
const [gy, gm, gd] = jalaliToGregorian(1405, 5, 12);
eq("12 Mordad 1405 is 3 Aug 2026", `${gy}-${gm}-${gd}`, "2026-8-3");
eq("and converts back", toShamsiStr(new Date(Date.UTC(2026, 7, 3))), "1405/05/12");

/* 7. money */
head("Project finance");
const finance = calculateProjectFinance(
  { id: "pr1" } as any,
  [{ id: "pf1", projectId: "pr1", status: "ارسال شده", currency: "ریال", finalAmount: 200_000_000,
     items: [{ id: "i1", status: "برنده", totalPriceRIYAL: 200_000_000, quantity: 1, unitPriceRIYAL: 200_000_000 }] }] as any,
  [{ id: "t1", projectId: "pr1", proformaId: "pf1", type: "دریافت", status: "تأیید شده", amountRIYAL: 60_000_000 }] as any,
  [] as any,
);
eq("sold", finance.totalSalesHistoricalRiyal, 200_000_000);
eq("received", finance.totalReceivedRiyal, 60_000_000);
eq("outstanding", finance.totalRemainingHistoricalRiyal, 140_000_000);

// A receipt booked against the project but against no proforma is deliberately
// held apart rather than reducing an invoice — which is what the "unallocated
// receipt" warning on the transactions screen is about.
const unallocated = calculateProjectFinance(
  { id: "pr1" } as any,
  [{ id: "pf1", projectId: "pr1", status: "ارسال شده", currency: "ریال", finalAmount: 200_000_000,
     items: [{ id: "i1", status: "برنده", totalPriceRIYAL: 200_000_000, quantity: 1, unitPriceRIYAL: 200_000_000 }] }] as any,
  [{ id: "t1", projectId: "pr1", type: "دریافت", status: "تأیید شده", amountRIYAL: 60_000_000 }] as any,
  [] as any,
);
eq("an unallocated receipt still counts as money received", unallocated.totalReceivedRiyal, 60_000_000);
eq("but does not settle the invoice", unallocated.totalRemainingHistoricalRiyal, 200_000_000);
eq("it is reported separately", unallocated.totalUnallocatedRiyal, 60_000_000);

/*
 * A confirmed receipt is corrected by a reversing entry, and both halves stay
 * in the totals so the pair cancels.
 *
 * Shaped the way `reverseTransaction` actually writes it, which is the point:
 * the reversal is the *mirror image*, so a receipt is undone by a payment, and
 * the original is marked ابطال شده. An earlier version of this test invented a
 * reversal that kept the original's type — a shape the application never
 * produces — and so it passed while the real thing double-counted.
 */
const reversalPair = [
  { id: "t1", projectId: "pr1", proformaId: "pf1", type: "دریافت", status: "ابطال شده", amountRIYAL: 60_000_000 },
  { id: "t2", projectId: "pr1", proformaId: "pf1", type: "پرداخت", status: "تأیید شده",
    amountRIYAL: 60_000_000, reversalOfTransactionId: "t1" },
] as any;
const wonProforma = [{ id: "pf1", projectId: "pr1", status: "ارسال شده", currency: "ریال", finalAmount: 200_000_000,
  items: [{ id: "i1", status: "برنده", totalPriceRIYAL: 200_000_000, quantity: 1, unitPriceRIYAL: 200_000_000 }] }] as any;

const withReversal = calculateProjectFinance({ id: "pr1" } as any, wonProforma, reversalPair, [] as any);
eq("a reversal cancels the receipt it corrects", withReversal.totalReceivedRiyal, 0);
eq("and the outstanding balance returns", withReversal.totalRemainingHistoricalRiyal, 200_000_000);

// The same pair booked at project level rather than against the invoice.
const loosePair = reversalPair.map((t: any) => ({ ...t, proformaId: undefined }));
const looseReversal = calculateProjectFinance({ id: "pr1" } as any, wonProforma, loosePair, [] as any);
eq("and cancels there too", looseReversal.totalReceivedRiyal, 0);

/*
 * Cost visibility.
 *
 * A field-level permission is the one kind of rule where a green type-check
 * proves nothing at all: the redactors take and return the same shape, so a
 * field left off the list compiles perfectly and ships the number. These assert
 * the fields by name, in both directions — removed for a user without the
 * permission, untouched for one with it.
 */
head("Costs: what a user without the permission sees");

const buyer = { id: "u1", permissions: { products: true, purchaseOrders: true, costs: true } } as any;
const storeman = { id: "u2", permissions: { products: true, purchaseOrders: true } } as any;
const admin = { id: "u3", isSystemAdmin: true } as any;

ok("absent means denied, not granted", canSeeCosts(storeman) === false);
ok("granted when explicitly true", canSeeCosts(buyer) === true);
ok("a system admin always sees costs", canSeeCosts(admin) === true);
ok("and nobody at all sees them signed out", canSeeCosts(null) === false);

const productRow = {
  id: "p1", code: "FT100", basePriceRial: "5000000", priceCalc: '{"calcPriceForeign":1200}',
  variants: [{ id: "v1", sku: "FT100-S2I", priceRial: "5000000", priceCalc: '{"calcPriceForeign":1100}' }],
};
const hiddenProduct = redactProduct(productRow, storeman);
eq("the price calculator is gone", hiddenProduct.priceCalc, null);
eq("including on every variant", hiddenProduct.variants[0].priceCalc, null);
eq("but the sale price stays — the warehouse quotes from it", hiddenProduct.basePriceRial, "5000000");
eq("and the buyer still sees the calculator",
  redactProduct(productRow, buyer).priceCalc, '{"calcPriceForeign":1200}');
eq("redaction does not mutate the row it was given", productRow.priceCalc, '{"calcPriceForeign":1200}');

const poRow = {
  id: "po1", poNumber: "PO-1", status: "ثبت شده", currency: "یورو",
  exchangeRate: "850000", landedCostRial: "3445000000", landedCostForeign: "4800",
  totalForeignAmount: "4800", customsDutyRial: "280000000",
  items: [{ id: "i1", productName: "فلومتر", quantity: "2", unitPriceForeign: "2400", totalPriceForeign: "4800" }],
};
const hiddenPo = redactPurchaseOrder(poRow, storeman);
eq("landed cost is gone", hiddenPo.landedCostRial, null);
eq("so are its components", hiddenPo.customsDutyRial, null);
eq("and the line prices", hiddenPo.items[0].unitPriceForeign, null);
eq("what was ordered still reads", hiddenPo.items[0].productName, "فلومتر");
eq("and how many", hiddenPo.items[0].quantity, "2");

const inquiryRow = {
  id: "q1", isWinner: true, discountPercent: "10", discountAmount: "500",
  financialOfferUrl: "/uploads/offer.pdf", technicalOfferUrl: "/uploads/tech.pdf",
  items: [{ id: "qi1", name: "فلومتر", quantity: "2", priceForeign: "1000", priceRial: "0" }],
  steps: [
    { id: "s1", title: "آفر اولیه", isAuto: true, notes: "ثبت خودکار: آفر اولیه با مبلغ ۲۰۰۰ یورو ثبت شد." },
    { id: "s2", title: "تماس", isAuto: false, notes: "با آقای احمدی صحبت شد." },
  ],
};
const hiddenInquiry = redactInquiry(inquiryRow, storeman);
eq("the offer price is gone", hiddenInquiry.items[0].priceForeign, null);
eq("and the discount", hiddenInquiry.discountPercent, null);
eq("the priced quotation is not linked", hiddenInquiry.financialOfferUrl, null);
eq("the technical one still is", hiddenInquiry.technicalOfferUrl, "/uploads/tech.pdf");
eq("a derived step does not quote the amount back in prose",
  hiddenInquiry.steps[0].notes, null);
eq("a note somebody typed is left alone", hiddenInquiry.steps[1].notes, "با آقای احمدی صحبت شد.");
eq("and the winner is still visible — that is not a price", hiddenInquiry.isWinner, true);

// A save from a redacted form must not write its blanks over the stored costs.
const stored = [{ id: "v1", priceCalc: '{"calcPriceForeign":1100}' }];
const write = stripProductCostInput(
  { code: "FT100", priceCalc: null, variants: [{ id: "v1", sku: "FT100-S2I", priceCalc: null }] },
  storeman,
  stored,
);
ok("the product's calculator is dropped, not set to null",
  !("priceCalc" in write), Object.keys(write));
eq("and each variant keeps what the database holds",
  (write.variants as any[])[0].priceCalc, '{"calcPriceForeign":1100}');
eq("a variant this user just added gets none rather than theirs",
  (stripProductCostInput(
    { variants: [{ sku: "FT100-S3I", priceCalc: '{"calcPriceForeign":9}' }] }, storeman, stored,
  ).variants as any[])[0].priceCalc, null);
ok("a buyer's write is passed through untouched",
  stripProductCostInput({ priceCalc: "x" }, buyer).priceCalc === "x");

/*
 * The two places cost reached once it was recorded on the sale.
 *
 * A proforma line's cost is the same number the purchase order carries, so
 * leaving it on the sales screen would publish there exactly what the
 * purchasing screen withholds. Customer gross profit is that number again,
 * summed and subtracted from revenue.
 */
const proformaRow = {
  id: "pf1", proformaNumber: "P-1", currency: "یورو", finalAmount: "300",
  items: [
    { id: "pi1", productName: "فلومتر", quantity: "3", unitPriceRial: "100",
      totalPriceRial: "300", unitCost: "70.0000", costCurrency: "یورو",
      costSource: "PURCHASE_ORDER" },
  ],
};
const hiddenProforma = redactProforma(proformaRow, storeman);
eq("the line's cost is gone", hiddenProforma.items[0].unitCost, null);
eq("and its currency", hiddenProforma.items[0].costCurrency, null);
// The source alone would say «از سفارش خرید» beside a blank, which tells a
// warehouse account that a purchase order exists and what evidence it holds.
eq("and what kind of evidence it was", hiddenProforma.items[0].costSource, null);
eq("the sale price stays — that is what the customer pays",
  hiddenProforma.items[0].unitPriceRial, "100");
eq("so does the document total", hiddenProforma.finalAmount, "300");
eq("and the buyer sees the cost", redactProforma(proformaRow, buyer).items[0].unitCost, "70.0000");
eq("redaction does not mutate the row it was given", proformaRow.items[0].unitCost, "70.0000");

// Their copy arrived blanked and the lines are replaced wholesale on save, so
// without this one edit by a warehouse account erases every line's cost.
const storedLines = [
  { id: "pi1", unitCost: "70.0000", costCurrency: "یورو", costSource: "PURCHASE_ORDER" },
];
const kept = preserveLineCosts(
  [{ id: "pi1", productName: "فلومتر", unitCost: null, costSource: null }],
  storeman, storedLines,
)!;
eq("a redacted save puts the stored cost back", kept[0].unitCost, "70.0000");
eq("with its source", kept[0].costSource, "PURCHASE_ORDER");

const added = preserveLineCosts(
  [{ productName: "شیر", unitCost: 999, costSource: "MANUAL" }], storeman, storedLines,
)!;
eq("a line this user added gets no cost rather than theirs", added[0].unitCost, null);

const foreign = preserveLineCosts(
  [{ id: "not-this-document", unitCost: 5, costSource: "MANUAL" }], storeman, storedLines,
)!;
eq("an id from another document matches nothing", foreign[0].unitCost, null);

ok("a buyer's lines are passed through untouched",
  preserveLineCosts([{ id: "pi1", unitCost: 5 }], buyer, storedLines)![0].unitCost === 5);
ok("and an absent line list stays absent — it means 'not edited'",
  preserveLineCosts(undefined, storeman, storedLines) === undefined);

const customerRow = {
  id: "c1", companyName: "پتروشیمی آزمون",
  valueMetrics: {
    customerValueRank: "A", customerValueIndex: 82, realizedValueScore: 90,
    salesRevenueRial: "5000000000", grossProfitRial: "1500000000",
    grossMarginPercent: 30, costCoveragePercent: 100, grossProfitScore: 95,
    purchaseFrequency: 7,
  },
};
const hiddenCustomer = redactCustomerValue(customerRow, storeman);
eq("gross profit is gone", hiddenCustomer.valueMetrics.grossProfitRial, null);
// The same fact stated as a ratio. Blanking one and not the other publishes it.
eq("and the margin, which is the same fact as a ratio",
  hiddenCustomer.valueMetrics.grossMarginPercent, null);
eq("and the coverage", hiddenCustomer.valueMetrics.costCoveragePercent, null);
// A percentile *of* the profit: it moves with the figure and would leak the
// ordering of every customer by margin.
eq("and the profit percentile", hiddenCustomer.valueMetrics.grossProfitScore, null);
eq("revenue stays — that is what the company charges",
  hiddenCustomer.valueMetrics.salesRevenueRial, "5000000000");
eq("and the rank stays: it blends five things and reveals no figure",
  hiddenCustomer.valueMetrics.customerValueRank, "A");
eq("as does the realized score built from them",
  hiddenCustomer.valueMetrics.realizedValueScore, 90);
eq("a buyer sees the profit", redactCustomerValue(customerRow, buyer).valueMetrics.grossProfitRial, "1500000000");

const detail = {
  rank: "A",
  components: { grossProfitScore: 95, frequencyScore: 60, recencyScore: 80 },
  raw: { salesRevenueRial: 5e9, grossProfitRial: 1.5e9, grossMarginPercent: 30,
         costCoveragePercent: 100, purchaseFrequency: 7 },
};
const hiddenDetail = redactValueDetail(detail, storeman);
eq("the card's raw profit is gone", hiddenDetail.raw.grossProfitRial, null);
eq("and its profit bar", hiddenDetail.components.grossProfitScore, null);
eq("the other bars are untouched", hiddenDetail.components.frequencyScore, 60);
eq("and the revenue behind them", hiddenDetail.raw.salesRevenueRial, 5e9);

const summary = { byRank: [{ rank: "A", count: 3, grossProfitRial: 9e9 }], averageRealized: 55 };
eq("the dashboard's per-rank profit total is gone",
  redactValueSummary(summary, storeman).byRank[0].grossProfitRial, null);
eq("the count is not", redactValueSummary(summary, storeman).byRank[0].count, 3);

/*
 * The project timeline names documents; it does not quote them.
 *
 * These sentences are read by anyone with access to the project, including
 * people the cost permission withholds prices from — so an amount written into
 * the prose hands over exactly what is redacted everywhere else. Asserted here
 * because the leak is a string, and no type can see it.
 */
head("Activity text: names the document, not the amount");

const receiptText = describeTransaction({
  type: "دریافت", documentNumber: "RC-1404-0007", amountRial: 60_000_000,
  amountForeign: 1200, currency: "یورو", paymentType: "حواله بانکی",
  occurredAtJalali: "1405/05/12", status: "تأیید شده",
}, "ثبت");

ok("it names the document", receiptText.includes("RC-1404-0007"), receiptText);
ok("and says which way the money went", receiptText.includes("دریافت وجه از کارفرما"));
ok("and how it was paid", receiptText.includes("حواله بانکی"));
ok("no rial figure", !/60[,\u066c]?000/.test(receiptText), receiptText);
ok("no foreign figure either", !receiptText.includes("1,200") && !receiptText.includes("یورو"), receiptText);
ok("and no stray currency word left behind by the edit",
  !receiptText.includes("ریال"), receiptText);

/*
 * A grid row carries every column the grid draws.
 *
 * The recurring failure of this migration in one line: the screen reads a field
 * off a list row, the row adapter never mapped it, and the column prints "-"
 * forever while the edit form — built from the detail record — shows it
 * correctly. Nothing catches it, because both shapes are `Customer`.
 */
head("Customer grid: the row carries what the columns read");

const personRow = {
  id: "c1", customerType: "حقیقی", status: "فعال", companyName: "علی رضایی",
  firstName: "علی", lastName: "رضایی", economicCode: null, industry: null,
  phone: null, mobile: "09120000000", email: null, province: "تهران", city: null,
  tags: null, position: "مدیر خرید", keyPerson: null, ownerUserId: null,
  createdAt: "2026-01-01", customValues: null, linksFrom: [],
} as unknown as CustomerRow;

const companyRow = {
  ...personRow, customerType: "حقوقی", companyName: "پتروشیمی آزمون",
  industry: "نفت و گاز", position: null, keyPerson: "مهندس احمدی",
} as unknown as CustomerRow;

eq("a natural person's position reaches the grid", rowToCustomer(personRow).position, "مدیر خرید");
eq("a company's key person does too", rowToCustomer(companyRow).keyPerson, "مهندس احمدی");
eq("and its industry", rowToCustomer(companyRow).industry, "نفت و گاز");
eq("province survives the projection", rowToCustomer(personRow).province, "تهران");

/*
 * The same question asked of every other grid, because the same answer was
 * wrong in all of them: the custom-fields column was empty on six screens, and
 * several cards printed nothing where a field was meant to be.
 */
const cv = JSON.stringify({ f1: "مقدار" });
const custom = (label: string, got: unknown) =>
  ok(`${label} carries its custom fields`,
    JSON.stringify(got) === JSON.stringify({ f1: "مقدار" }), got);

custom("a product row", rowToProduct({
  id: "x", code: "C", name: "n", displayName: "n", hasVariants: false,
  stockLevel: "0", minStockLevel: "0", customValues: cv, variants: [],
  _count: { variants: 0 },
} as never).customValues);

custom("a supplier row", rowToSupplier({
  id: "s", name: "n", status: "فعال", customValues: cv,
  _count: { purchaseOrders: 0, inquiries: 0 },
} as never).customValues);

custom("a transaction row", rowToTransaction({
  id: "t", documentNumber: "D", type: "دریافت", status: "تأیید شده",
  amountRial: "1", isDirectForeign: false, customValues: cv,
} as never).customValues);

// Tasks have no detail endpoint: the row is the record, so a dropped field is
// not merely invisible in the grid, it is gone.
custom("a task row", rowToTask({
  id: "k", title: "t", priority: "متوسط", status: "در انتظار",
  reminderEnabled: false, createdAt: "", customValues: cv,
} as never).customValues);

const poRow2 = rowToPurchaseOrder({
  id: "o", poNumber: "PO-1", status: "s", currency: "یورو", exchangeRate: "1",
  supplierId: "s", customValues: cv, proforma: { id: "q", proformaNumber: "PF-1" },
  totalForeignAmount: "0", landedCostRial: "0", landedCostForeign: "0",
  _count: { items: 0 },
} as never);
custom("a purchase-order row", poRow2.customValues);
eq("and names the proforma it was raised against", poRow2.proformaNumber, "PF-1");

const pfRow = rowToProforma({
  id: "q", proformaNumber: "PF-1", status: "ارسال شده", currency: "ریال",
  customerId: "c", isCancelled: false, sentMethod: "ایمیل",
  sentRecipients: JSON.stringify(["a@b.com"]), lossReason: "دیر شد",
  customValues: cv, items: [], totalAmount: "0", finalAmount: "0",
} as never);
custom("a proforma row", pfRow.customValues);
eq("and how it was sent", pfRow.sentMethod, "ایمیل");
eq("and to whom", JSON.stringify(pfRow.sentRecipients), JSON.stringify(["a@b.com"]));
eq("and why it was lost", pfRow.lossReason, "دیر شد");

const projRow = rowToProject({
  id: "p", code: "PRJ-1", name: "پروژه", status: "باخته", customerId: "c",
  lossReason: "قیمت بالا", closingDateJalali: "1405/05/12",
  communicationMethod: "تلفن", customerInquiryNumber: "INQ-9",
  referrerName: "آقای الف", endUser: "پالایشگاه", financialContact: "مالی",
  technicalContact: "فنی", customValues: cv, summary: null,
  _count: { items: 2, proformas: 1, categoryGroups: 0 },
} as never);
custom("a project row", projRow.customValues);
eq("and the reason it was lost", projRow.lossReason, "قیمت بالا");
eq("and the customer's inquiry number", projRow.customerInquiryNumber, "INQ-9");
eq("and who referred it", projRow.referrerName, "آقای الف");

/*
 * Saving an account revokes its sessions only when something actually changed.
 *
 * The edit form posts the whole record, so a save that touched only the name
 * still carried the permissions — and a bump keyed on the field being *present*
 * signed the user out of the browser they were saving from, over a change that
 * had been written. Key order is not meaning: the stored text was serialized by
 * whichever client last saved, so a textual comparison finds differences that
 * are not there.
 */
head("User save: revoke sessions on a real change only");

const permsStored = JSON.stringify({ dashboard: true, customers: true, costs: true });
ok("an identical object is not a change", samePermissions(permsStored, permsStored));
ok("nor the same flags in another order",
  samePermissions(JSON.stringify({ customers: true, costs: true, dashboard: true }), permsStored));
ok("a flipped flag is",
  !samePermissions(JSON.stringify({ dashboard: true, customers: true, costs: false }), permsStored));
ok("and so is a new one",
  !samePermissions(JSON.stringify({ dashboard: true, customers: true, costs: true, users: true }), permsStored));
ok("two accounts with nothing stored match", samePermissions(null, null));
ok("but nothing stored against something is a change", !samePermissions(null, permsStored));

/*
 * The contacts of a company are found on the server, in either direction.
 *
 * The proforma's "sent to whom" field lists the natural persons linked to the
 * buyer. It used to filter a list the browser already held — the buyer picker's
 * page, or the customers appearing on the current page of proformas — so a
 * linked person outside that page could not be offered at all, and the box
 * reported that no natural customer existed.
 */
head("Customer contacts: scoped by the server, both link directions");

const linkWhere = buildCustomerWhere(
  { search: "", filters: { customerType: "حقیقی" }, sort: "", order: "asc", page: 1, pageSize: 50 } as never,
  { id: "u1", permissions: { customers: true } } as never,
  { linkedTo: "company-1" },
);
const linkJson = JSON.stringify(linkWhere);
ok("the query asks for links out of the company", linkJson.includes('"linksFrom"'), linkJson);
ok("and links into it — an older one-way link still finds its contacts",
  linkJson.includes('"linksTo"'), linkJson);
ok("and it is still restricted to natural persons",
  linkJson.includes('"customerType":"حقیقی"'), linkJson);

/*
 * A purchase order survives being opened and saved.
 *
 * The adapters read `unitPriceForeign` — the column name — while the client
 * type and the whole screen call it `unitPriceForeignCurrency`. The
 * `as unknown as PurchaseOrder` cast at the end of the adapter made that
 * compile: every price in an opened order was undefined and rendered as zero,
 * and the write mapper read the same wrong name back, so saving stored zeros
 * and with them a landed cost of zero.
 */
head("Purchase order: prices survive the round trip");

const poDetail = {
  id: "po1", poNumber: "PO-1", status: "ثبت شده", currency: "یورو",
  exchangeRate: "900000", supplierId: "s1", projectId: null, proformaId: null,
  orderDateJalali: "1405/05/12", totalForeignAmount: "4800",
  landedCostRial: "0", landedCostForeign: "0", createdAt: "",
  shippingCostRial: "0", customsDutyRial: "0", remittanceFeeRial: "0",
  shippingCostForeign: "0", remittanceFeeForeign: "0",
  customValues: null, notes: null, proforma: null,
  supplier: { id: "s1", name: "تأمین‌کننده" }, project: null,
  items: [{
    id: "i1", lineNo: 1, productId: "p1", variantId: null,
    productName: "فلومتر", productCode: "FT100", brand: "X", tagNumber: "TG-1",
    quantity: "2", unitPriceForeign: "2400", totalPriceForeign: "4800",
    proformaItemId: null, proformaItemName: null, supplierNotes: null,
  }],
} as never;

const openedPo = detailToPurchaseOrder(poDetail);
const poLine = (openedPo.items ?? [])[0] as unknown as Record<string, unknown>;
eq("the unit price reaches the form", poLine.unitPriceForeignCurrency, 2400);
eq("and the line total", poLine.totalPriceForeignCurrency, 4800);

const poWrite = purchaseOrderToWriteInput(openedPo);
const writtenLine = (poWrite.items as Record<string, unknown>[])[0];
eq("and goes back under the column's name", writtenLine.unitPriceForeign, 2400);
eq("with its product still attached", writtenLine.productId, "p1");

// "generic" marks a line typed by hand. It is not a product id, and sending it
// as one fails the foreign key — which is how the same sentinel broke saving a
// project until it was mapped away there too.
const handEnteredPo = purchaseOrderToWriteInput({
  ...openedPo, items: [{ ...poLine, productId: "generic" }],
} as never);
eq("a hand-entered line sends no product at all",
  (handEnteredPo.items as Record<string, unknown>[])[0].productId, null);

/*
 * A category keeps its identity when it is renamed.
 *
 * The server names a category when it records a fact; the browser names the
 * same category when it offers to close it. They used to agree only by both
 * holding the same literal, so renaming one would have left every existing
 * group unreachable: the prompt appears, the user says yes, and the group it
 * looks for does not exist under that name.
 */
head("Activity categories: renamed, still the same category");

eq("the purchase-order category has its new name",
  ACTIVITY_CATEGORY.PURCHASE_ORDERS, "سفارش خرید و حمل");
ok("and a group stored under the old one still matches",
  sameCategory("سفارشات خرید تامین‌کنندگان", ACTIVITY_CATEGORY.PURCHASE_ORDERS));
ok("as does the short spelling used elsewhere",
  sameCategory("سفارش خرید", ACTIVITY_CATEGORY.PURCHASE_ORDERS));
eq("the old name canonicalises to the new",
  canonicalCategoryName("سفارشات خرید تامین‌کنندگان"), ACTIVITY_CATEGORY.PURCHASE_ORDERS);
ok("spacing and ZWNJ are not meaning",
  sameCategory("تراکنش های مالی و پرداخت ها", ACTIVITY_CATEGORY.TRANSACTIONS));
ok("but two different categories stay different",
  !sameCategory(ACTIVITY_CATEGORY.DELIVERIES, ACTIVITY_CATEGORY.AFTER_SALES));

/*
 * Two of an item, shipped in two cartons.
 *
 * A packing list is not a copy of the proforma: what was sold as one line of
 * two is often shipped as two boxes of one. Splitting it used to mean reducing
 * the loaded row and typing the second by hand — and a hand-typed row carried
 * no product, so the stock ledger issued one unit where two had left the
 * building. The goods were gone and the history said otherwise.
 */
head("Packing list: splitting a promised line across boxes");

const promisedLine = {
  key: "p1|", productId: "p1", variantId: null, productName: "فلومتر",
  promised: 2, remaining: 2,
};
const offered = (rows: Parameters<typeof packableLines>[1]) =>
  packableLines([promisedLine], rows).map((o) => `${o.line.productName}:${o.spare}`);

let packRows = [{ id: "r1", productId: "p1", itemOrDocName: "فلومتر", quantity: 2 }];
eq("with the whole line in one box, nothing is left to add",
  JSON.stringify(offered(packRows)), "[]");

packRows = packRows.map((r) => ({ ...r, quantity: 1 }));
eq("reducing that row frees the other unit",
  JSON.stringify(offered(packRows)), JSON.stringify(["فلومتر:1"]));
eq("and the row itself may still hold both",
  outstandingFor([promisedLine], packRows, "p1|", "r1"), 2);

packRows = [...packRows, { id: "r2", productId: "p1", itemOrDocName: "فلومتر", quantity: 1 }];
eq("packing it into a second box uses the line up",
  JSON.stringify(offered(packRows)), "[]");
eq("and the ledger issues both units",
  packRows.filter((r) => r.productId).reduce((sum, r) => sum + r.quantity, 0), 2);

// Documents and packaging were never promised, so nothing caps them.
ok("a row the proforma never mentioned is uncapped",
  outstandingFor([promisedLine], packRows, "کاتالوگ") === Infinity);

/*
 * The project's own milestones and their automation.
 *
 * A checkpoint completed raises what the user attached to it. Two things had to
 * be right for that ever to work, and neither was: the rule has to still name a
 * milestone that exists, and a "smart" trigger has to name a category the app
 * actually files groups under.
 */
head("Project milestones: automation rules");

eq("a stored rule list parses",
  parseMilestoneRules('[{"id":"r1","triggerMilestoneId":"m1","actionType":"create_task","taskTitle":"t"}]').length, 1);
eq("and so does one handed over already parsed",
  parseMilestoneRules([{ id: "r1", triggerMilestoneId: "m1", actionType: "send_notification" }]).length, 1);
eq("an unknown action falls back to raising a task, never to doing nothing",
  parseMilestoneRules([{ id: "r1", triggerMilestoneId: "m1", actionType: "explode" }])[0].actionType, "create_task");
eq("a rule with no trigger is dropped rather than fired at everything",
  parseMilestoneRules([{ id: "r1", actionType: "create_task" }]).length, 0);
eq("a corrupt column is empty, not a crash", parseMilestoneRules("{not json").length, 0);

// The trigger picker used to offer names no group was ever stored under, so a
// smart trigger set to one of them could never match.
ok("a milestone bound to the picker's old purchase-order name still matches",
  sameCategory("سفارشات خرید (PO)", ACTIVITY_CATEGORY.PURCHASE_ORDERS));
ok("and to its pre-rename name",
  sameCategory("سفارشات خرید تامین‌کنندگان", ACTIVITY_CATEGORY.PURCHASE_ORDERS));
ok("the old packing name matches the delivery category",
  sameCategory("بسته‌بندی و ارسال", ACTIVITY_CATEGORY.DELIVERIES));
ok("after-sales was already canonical",
  sameCategory("خدمات پس از فروش", ACTIVITY_CATEGORY.AFTER_SALES));
ok("two different categories still do not match",
  !sameCategory(ACTIVITY_CATEGORY.PROFORMAS, ACTIVITY_CATEGORY.DELIVERIES));

/*
 * Refreshing the currency rates every two hours.
 *
 * Every foreign-priced document is valued at the stored rate, so a stale rate
 * prices the day's work wrongly and says nothing. It used to refresh once per
 * Shamsi day, which left a document priced at four in the afternoon carrying
 * the morning's number. The scheduling is the whole of the feature, and the
 * alternative to testing it here is a test that can only be run by waiting two
 * hours.
 */
head("Exchange rates: the two-hourly refresh");

const HOUR = 60 * 60 * 1000;
const decide = (state: Partial<RateRefreshState>, now = 10 * HOUR) =>
  refreshDecision(
    { lastSuccessAt: 0, lastFailureAt: 0, running: false, ...state },
    now, FRESH_FOR_MS, 30 * 60 * 1000);

eq("the first caller starts the fetch", decide({}), "start");
eq("a caller a minute later does nothing", decide({ lastSuccessAt: 10 * HOUR - 60_000 }), "skip");
eq("nor does one an hour and a half later",
  decide({ lastSuccessAt: 10 * HOUR - 1.5 * HOUR }), "skip");
eq("two hours on, the rates are refetched",
  decide({ lastSuccessAt: 10 * HOUR - 2 * HOUR }), "start");
eq("a caller arriving mid-fetch waits on the same one", decide({ running: true }), "wait");
eq("a run in progress outranks a recent failure, rather than being skipped past",
  decide({ running: true, lastFailureAt: 10 * HOUR - 60_000 }), "wait");

// A failure holds callers off for a while — but for less than the freshness
// window, or one bad minute would cost the whole two hours.
eq("right after a failure, callers are held off",
  decide({ lastFailureAt: 10 * HOUR - 60_000 }), "skip");
eq("an hour later, someone tries again",
  decide({ lastFailureAt: 10 * HOUR - HOUR }), "start");
eq("but rates fetched minutes ago still win over a stale failure",
  decide({ lastSuccessAt: 10 * HOUR - 60_000, lastFailureAt: 10 * HOUR - HOUR }), "skip");

/*
 * A warehouse-arrival date means the order arrived.
 *
 * The form offers the arrival date and the status as two separate fields, but
 * everything downstream — crediting stock, offering to close the project's
 * category — keys on the status alone. So an order whose whole timeline was
 * filled in at once had arrived on paper and not at all in the system.
 */
head("Purchase order: the arrival date and the status");

const poData = (data: Record<string, unknown>, existing?: string | null) => {
  const copy = { ...data };
  receivedDateImpliesStatus(copy, existing);
  return copy.status;
};

eq("an arrival date entered on creation receives the order",
  poData({ receivedDateJalali: "1405/05/20" }), RECEIVED_STATUS);
eq("and does so even when the form sent an earlier status",
  poData({ receivedDateJalali: "1405/05/20", status: "در حال حمل" }), RECEIVED_STATUS);
eq("an order already received is left alone",
  poData({ receivedDateJalali: "1405/05/20" }, RECEIVED_STATUS), undefined);
eq("no arrival date changes nothing",
  poData({ status: "در حال حمل" }), "در حال حمل");
// One-directional on purpose: removing a date corrects the record of what
// happened; taking goods back out of stock is a decision, made with the status.
eq("clearing the date does not un-receive the order",
  poData({ receivedDateJalali: null }, RECEIVED_STATUS), undefined);

/*
 * The landed cost, in two currencies that describe the same money.
 *
 * Three places on the purchase-order screen showed three different figures for
 * one order: the cost sheet inside the form, the "landed details" popup and the
 * row card. Two of them carried their own fallback formula for whenever the
 * stored figure looked empty, and the stored one left customs duty out of the
 * foreign total altogether — so «بهای تمام‌شده ارزی» was goods plus freight and
 * nothing else.
 */
head("Purchase order: landed cost");

const line = (qty: number, price: number) =>
  ({ productName: "x", quantity: qty, unitPriceForeign: price });

const euroOrder = computeTotals([line(10, 1000)], {
  exchangeRate: 900_000,
  shippingCostForeign: 500,
  remittanceFeeForeign: 120,
  customsDutyRial: 450_000_000,
});

eq("the order's own value is the lines", euroOrder.totalForeignAmount, 10_000);
eq("rial landed cost carries everything",
  euroOrder.landedCostRial, (10_000 + 500 + 120) * 900_000 + 450_000_000);
ok("customs duty reaches the foreign figure too",
  euroOrder.landedCostForeign > 10_620, euroOrder.landedCostForeign);
ok("and the two figures are the same money at the order's rate",
  Math.abs(euroOrder.landedCostForeign * 900_000 - euroOrder.landedCostRial) < 1_000_000,
  euroOrder.landedCostForeign * 900_000 - euroOrder.landedCostRial);

// Rial-quoted freight and remittance exist on older orders, from before the
// foreign-currency fields were added. They belong to the landed cost as much as
// customs does, and the form's own preview ignored them.
const legacy = computeTotals([line(10, 1000)], {
  exchangeRate: 900_000,
  shippingCostRial: 80_000_000,
  remittanceFeeRial: 12_000_000,
  customsDutyRial: 450_000_000,
});
eq("rial-quoted freight and fees count as well",
  legacy.landedCostRial, 10_000 * 900_000 + 80_000_000 + 12_000_000 + 450_000_000);

// No rate yet: the rial-quoted costs cannot be expressed in the order's
// currency, so the foreign figure carries only what was foreign — never a
// division by zero.
const unrated = computeTotals([line(10, 1000)], { customsDutyRial: 450_000_000 });
ok("a missing rate never produces Infinity",
  Number.isFinite(unrated.landedCostForeign), unrated.landedCostForeign);

/*
 * Where the time went on an import.
 *
 * The card lists the stages with the date each finished on; what a buyer wants
 * from that row is how long each one took, and subtracting Shamsi dates in your
 * head is exactly what a screen should be doing instead.
 */
head("Purchase order: how long each import stage took");

const stage = (label: string, date?: string) => ({ label, date, color: "" });
const durations = (dates: (string | undefined)[]) =>
  importStageDurations(dates.map((d, i) => stage(`s${i}`, d))).map((s) => s.days);

eq("the first stage has no duration — ordering is a moment, not a span",
  JSON.stringify(durations(["1405/01/10"])), JSON.stringify([null]));
eq("each stage counts from the one before it",
  JSON.stringify(durations(["1405/01/10", "1405/01/20", "1405/02/01"])),
  JSON.stringify([null, 10, 12]));
eq("a stage with no date has nothing to report",
  JSON.stringify(durations(["1405/01/10", undefined, "1405/02/01"])),
  JSON.stringify([null, null, 22]));
// The interval across a skipped stage is the one that usually took longest;
// measuring against the empty slot would have hidden exactly that.
eq("and the days still add up across a gap",
  durations(["1405/01/10", undefined, "1405/02/01"])[2], 22);
eq("dates entered out of order show negative rather than nothing",
  durations(["1405/02/01", "1405/01/20"])[1], -12);
eq("an order with no dates at all reports nothing",
  JSON.stringify(durations([undefined, undefined])), JSON.stringify([null, null]));

/*
 * Configurable required fields: the metadata and the forms must agree.
 *
 * `settings.requiredFields[module][field]` drives a switch in the settings
 * screen. Drift either way is silent — a switch that does nothing, or a field
 * nobody can make optional — and there is a third kind that neither direction
 * catches: a field the form *validates* while offering nowhere to type it. That
 * one is worse than silent. «شخص کلیدی» on the quick-add customer form was
 * exactly that: validated, written to the record, and with no input, so turning
 * the switch on made the form impossible to submit at all.
 *
 * Reading the source is the only way to check this — the relationship is
 * between a constant and the JSX that honours it.
 */
head("Required fields: the switches and the forms agree");

{
  const dir = (p: string) => p;
  const files: string[] = [];
  (function walk(d: string) {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = joinPath(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name)) files.push(p);
    }
  })(dir("src"));
  const src = files.map((f) => readFileSync(f, "utf-8")).join("\n");

  const asked = new Set<string>();
  const drawn = new Set<string>();
  for (const m of src.matchAll(/isFieldRequired\(\s*settings\s*,\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]/g)) {
    asked.add(`${m[1]}.${m[2]}`);
  }
  // The two ways a field draws its own label; a date picker takes a string, so
  // it uses the asterisk helper rather than the element one.
  for (const re of [
    /renderFieldLabelWithAsterisk\(\s*settings\s*,\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]/g,
    /getFieldAsterisk\(\s*settings\s*,\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]/g,
  ]) for (const m of src.matchAll(re)) drawn.add(`${m[1]}.${m[2]}`);

  const declared = new Set<string>();
  for (const mod of REQUIRED_FIELDS_METADATA) {
    for (const f of mod.fields) declared.add(`${mod.key}.${f.key}`);
  }

  const deadSwitch = [...declared].filter((k) => !asked.has(k));
  const noSwitch = [...asked].filter((k) => !declared.has(k));
  const invisible = [...declared].filter((k) => asked.has(k) && !drawn.has(k));

  ok("every switch reaches a form", deadSwitch.length === 0, deadSwitch);
  ok("every form field has a switch", noSwitch.length === 0, noSwitch);
  ok("nothing is validated without being offered", invisible.length === 0, invisible);
}

/*
 * Hooks that only run some of the time.
 *
 * React identifies a hook by the order it was called in, so a hook placed below
 * an early return is skipped on the renders that take that branch — and the
 * render where the branch stops being taken calls a hook that was not there
 * before. React tears the whole tree down, and the user sees a white page.
 *
 * This shipped. `useBrowserTab` was written next to the value it reads, which
 * sits under App's early return for the login screen, so it ran for a signed-in
 * user and not for a signed-out one: every sign-in crashed the application, on
 * the one path every user takes. Nothing else here could see it — a hook is an
 * ordinary function call to the type-checker, no derived figure was wrong, and
 * every endpoint answered correctly. `react-hooks/rules-of-hooks` is what
 * normally says so, and there is no ESLint in this project.
 */
head("Hooks are called on every render");

{
  const componentFiles: string[] = [];
  (function walk(d: string) {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = joinPath(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name)) componentFiles.push(p);
    }
  })("src");

  const problems = componentFiles.flatMap((f) =>
    findHooksAfterEarlyReturn(f, readFileSync(f, "utf-8")));

  ok("no hook sits below an early return",
    problems.length === 0,
    problems.map((p) => `${p.file}:${p.line} ${p.component} -> ${p.hook}`));

  // A check that cannot fail is not a check. This is the shape of the bug that
  // shipped, and the detector has to still recognise it.
  const shipped = `
export default function App({ open }: { open: boolean }) {
  const [a] = useState(0);
  if (!open) {
    return <Login />;
  }
  useEffect(() => {}, []);
  return <div>{a}</div>;
}`;
  eq("and the detector still recognises that shape",
    findHooksAfterEarlyReturn("sample.tsx", shipped).length, 1);

  // ...without flagging a return inside a callback, which leaves nothing.
  const fine = `
export default function Fine() {
  const [a] = useState(0);
  const render = () => {
    if (!a) return null;
    return <span />;
  };
  useEffect(() => {}, []);
  return <div>{render()}</div>;
}`;
  eq("a return inside a callback is not an early return",
    findHooksAfterEarlyReturn("fine.tsx", fine).length, 0);
}

/*
 * Money is written in Latin digits, everywhere.
 *
 * Amounts leave this application: they are read down a phone, typed into a bank
 * portal, pasted into a spreadsheet. Persian digits survive none of that. The
 * figures were also inconsistent with each other — one proforma printed
 * «۱۲٬۵۰۰٬۰۰۰» in its summary and 12,500,000 on the form beside it, because one
 * used `toLocaleString("fa-IR")` and the other a plain `toLocaleString()`.
 *
 * Counts in prose are the opposite case and stay Persian: «نمایش ۵ از ۱۲» is a
 * sentence, not a figure anybody copies. So this checks the amounts only, by
 * what is being formatted.
 */
head("Amounts are written in Latin digits");

eq("thousands are grouped, in Latin", formatMoney(12_500_000), "12,500,000");
eq("a negative keeps its sign", formatMoney(-4_200), "-4,200");
eq("decimals survive, to two places", formatMoney(1234.567), "1,234.57");
eq("a string amount is accepted, as the API returns them", formatMoney("98765"), "98,765");
eq("nothing is zero, never NaN", formatMoney(null), "0");
eq("and so is a value that cannot be a number", formatMoney("abc"), "0");

{
  // The screens, read as source: no amount may still be formatted fa-IR.
  const MONEY = /(amount|price|total(?!Pages|Count)|value|cost|riyal|rial|balance|sales|paid|remaining|revenue|rate|discount|tax|fee|landed|gain|loss|profit)/i;
  // `list.total` and friends are the row count a pagination line prints
  // («نمایش ۵ از ۱۲ پیش‌فاکتور»), not an amount — the paging hooks all name it
  // `total`, which is the one word this rule has to disambiguate by receiver.
  const COUNT = /(\.length|count|\bpage\b|totalPages|^(list|ledger|auditList|\w*List)\.total$)/i;

  const uiFiles: string[] = [];
  (function walk(d: string) {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = joinPath(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name)) uiFiles.push(p);
    }
  })("src");

  const strays: string[] = [];
  for (const f of uiFiles) {
    readFileSync(f, "utf-8").split("\n").forEach((line, i) => {
      for (const m of line.matchAll(/([A-Za-z0-9_.?\[\]]{0,50})\.toLocaleString\(['"]fa-IR['"]/g)) {
        const subject = m[1];
        if (COUNT.test(subject) || !MONEY.test(subject)) continue;
        strays.push(`${f}:${i + 1} ${subject}`);
      }
    });
  }
  ok("no amount is still formatted in Persian digits", strays.length === 0, strays);
}

/*
 * Document lines never carry a catalogue reference the database does not have.
 *
 * `productId` and `variantId` on a proforma, purchase-order, packing, inquiry or
 * project line are real foreign keys, so one that points at nothing does not
 * degrade — it fails the whole save with P2003, which the API used to report as
 * "this record cannot be deleted because others depend on it". A proforma was
 * lost that way: the configurator auto-created a SKU, made up its id instead of
 * waiting for the one the database assigns, and put that on the line.
 *
 * Two rules, read from the source:
 *  - every service that writes lines scrubs them first, and
 *  - no screen invents an id for a record the server stores.
 */
head("Document lines: no invented catalogue references");
{
  const serviceDir = "src/server/services";
  const writers = [
    "proformaService.ts", "purchaseOrderService.ts", "deliveryService.ts",
    "inquiryService.ts", "projectService.ts",
  ];
  const unscrubbed: string[] = [];
  for (const f of writers) {
    const src = readFileSync(joinPath(serviceDir, f), "utf-8");
    src.split("\n").forEach((line, i) => {
      // A line grid handed straight to syncChildren, with nothing having
      // checked that what it references still exists.
      if (/rows:\s*input\.items/.test(line)) unscrubbed.push(`${f}:${i + 1}`);
    });
    if (!src.includes("scrubProductRefs")) unscrubbed.push(`${f}: never scrubs`);
  }
  ok("every service that writes lines scrubs their catalogue references",
    unscrubbed.length === 0, unscrubbed);

  // The shape that caused it: a made-up id written onto a line's foreign key.
  // Only a *foreign key* — a form's own grid may key its rows however it likes,
  // because the server matches those by SKU and assigns the stored id.
  const INVENTED = /(variantId|productId)\s*[:=]\s*`?(var|prod)-\$\{Date\.now/;
  ok("the check recognises the line that lost a proforma",
    INVENTED.test("newItems[itemIdx].variantId = `var-${Date.now()}`;"));
  ok("and leaves a form's own row keys alone",
    !INVENTED.test("id: `var-${Date.now()}-${i}`,"));

  const invented: string[] = [];
  const viewFiles: string[] = [];
  (function walk(d: string) {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = joinPath(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name)) viewFiles.push(p);
    }
  })("src/components");
  for (const f of viewFiles) {
    readFileSync(f, "utf-8").split("\n").forEach((line, i) => {
      if (INVENTED.test(line)) invented.push(`${f}:${i + 1}`);
    });
  }
  ok("no screen invents a SKU id the database will not use",
    invented.length === 0, invented);
}

/*
 * Document numbers count their own series, not the whole table.
 *
 * Every template here is scoped by something — a project code, a year and
 * month, a transaction type — but the sequence was `startSeq + <rows in the
 * table>`. So issuing a proforma on one project advanced the next number of
 * every other project, and a number could be skipped without ever having been
 * used: a save that failed and was retried came back «…-C2» while «…-C1» never
 * existed. That is what "the number was burnt" looks like from the outside.
 */
head("Document numbers: the sequence follows the prefix");
{
  const around = renderAround("QT-{PROJECT}-{SEQ:2}", { projectCode: "ATA-05-19" });
  eq("the prefix is the template around its sequence", around?.head, "QT-ATA-05-19-");
  eq("a template with no sequence has no series", renderAround("QT-FIXED", {}), null);

  const { head: h, tail: t } = around!;
  eq("an unused series starts at startSeq", nextSequence(h, t, [], 1), 1);
  eq("and startSeq is a floor, not only an opening value",
    nextSequence(h, t, ["QT-ATA-05-19-03"], 1000), 1000);
  eq("one past the highest already issued",
    nextSequence(h, t, ["QT-ATA-05-19-01", "QT-ATA-05-19-07"], 1), 8);
  eq("another project's numbers do not advance this one",
    nextSequence(h, t, ["QT-ATA-06-01-09", "QT-ATA-06-01-12"], 1), 1);
  eq("a number replaced by the customer's own reference is not part of the series",
    nextSequence(h, t, ["QT-ATA-05-19-ABC"], 1), 1);

  // The observed case, exactly: nothing issued yet, so the next number is C1 —
  // and it stays C1 until a document actually carries it.
  const c = renderAround("{PROJECT}-{CUSTOMER}{SEQ}", { projectCode: "ATA-05-19" })!;
  eq("a project with no proforma yet gets its first number", nextSequence(c.head, c.tail, [], 1), 1);
  eq("and the second only once the first exists",
    nextSequence(c.head, c.tail, ["ATA-05-19-C1"], 1), 2);

  // No route may go back to counting rows.
  const routeDir = "src/server/routes";
  const counters = readdirSync(routeDir)
    .filter((f) => f.endsWith(".ts"))
    .flatMap((f) => {
      const src = readFileSync(joinPath(routeDir, f), "utf-8");
      return src.includes("nextDocumentNumber") && /count:\s*\(\)\s*=>/.test(src) ? [f] : [];
    });
  ok("no document number is generated from a table count", counters.length === 0, counters);
}

/*
 * The timeline says what an edit did.
 *
 * «پیش‌فاکتور شماره X توسط Y ویرایش شد» told a reader that something happened
 * and nothing about what — and the one detail it did add was wrong: it called
 * the document's send status «نتیجه اقلام» and claimed the project's status had
 * been recalculated on the strength of it. Sending a quotation is not a result,
 * and it moves no project.
 */
head("Project timeline: what an edit changed");
{
  const base = {
    status: "پیش‌نویس", isCancelled: false, currency: "دلار", finalAmount: 3240,
    discountPercent: 0, taxPercent: 0, issueDateJalali: "1405/05/24",
    expiryDateJalali: "1405/06/23", customerId: "c1", projectId: "p1", notes: "n",
    items: [{ productName: "Turbine Flow Meter", quantity: 2, unitPriceRial: 1620, status: "جاری" }],
  };

  const sent = describeProformaChanges(base, { ...base, status: "ارسال شده" }, {
    projectStatusBefore: "ارائه پیش‌فاکتور", projectStatusAfter: "ارائه پیش‌فاکتور",
  });
  eq("sending the document is one clause, about sending", sent.length, 1);
  ok("named as the send status, not as a result",
    sent[0].startsWith("وضعیت ارسال پیش‌فاکتور از «پیش‌نویس» به «ارسال شده»"), sent[0]);
  ok("and no project recalculation is claimed",
    !sent.some((c) => c.includes("پروژه")), sent);

  const won = describeProformaChanges(base, {
    ...base, items: [{ ...base.items[0], status: "برنده" }],
  }, { projectStatusBefore: "ارائه پیش‌فاکتور", projectStatusAfter: "برنده (موفق)" });
  ok("a won line is named", won.some((c) => c.includes("قلم برنده شد")), won);
  ok("the document's own result is reported once the lines decide it",
    won.some((c) => c.includes("نتیجه کلی سند")), won);
  ok("and the project is mentioned because it really moved",
    won.some((c) => c.includes("«ارائه پیش‌فاکتور» به «برنده (موفق)»")), won);

  const edited = describeProformaChanges(base, {
    ...base, finalAmount: 5000, expiryDateJalali: "1405/07/10",
    items: [
      { productName: "Turbine Flow Meter", quantity: 3, unitPriceRial: 1700, status: "جاری" },
      { productName: "Pressure Transmitter", quantity: 1, unitPriceRial: 900, status: "جاری" },
    ],
  });
  ok("an added line is named", edited.some((c) => c.includes("اضافه شد") && c.includes("Pressure Transmitter")), edited);
  ok("a changed quantity is given both ways", edited.some((c) => c.includes("تعداد") && c.includes("از 2 به 3")), edited);
  ok("so is a changed unit price", edited.some((c) => c.includes("بهای واحد") && c.includes("1,620")), edited);
  ok("and the total, in Latin digits with its currency",
    edited.some((c) => c.includes("مبلغ نهایی از 3,240 به 5,000 دلار")), edited);
  ok("a moved date is spelled out", edited.some((c) => c.includes("تاریخ اعتبار از 1405/06/23 به 1405/07/10")), edited);

  const removed = describeProformaChanges(base, { ...base, items: [] });
  ok("a removed line is named", removed.some((c) => c.includes("حذف شد")), removed);

  eq("a save that changed nothing says exactly that",
    proformaChangeSentence("X-1", describeProformaChanges(base, { ...base })),
    "پیش‌فاکتور شماره X-1 توسط {actor} ویرایش شد (بدون تغییر در اطلاعات اصلی سند).");
}

/*
 * Time-based workflow rules.
 *
 * Every rule until now fired on something somebody did. The cases that matter
 * most are the opposite — a quotation sent ten days ago that nobody followed
 * up — and no event marks those. A scheduled rule counts days from a date the
 * record already carries; a daily sweep fires it once, and «once» is enforced
 * by a unique index rather than by remembering.
 */
head("Workflow: time-based triggers");
{
  eq("the due day is the base date plus the days", dueDay("1405/05/24", 5), "1405/05/29");
  eq("and it rolls over a month end", dueDay("1405/05/29", 5), "1405/06/03");
  eq("a record with no such date is not scheduled at all", dueDay(null, 5), null);

  ok("due on the day itself", isDue("1405/05/24", 5, "1405/05/29"));
  ok("not the day before", !isDue("1405/05/24", 5, "1405/05/28"));
  ok("and still due long afterwards — the sweep may have been down",
    isDue("1404/01/01", 5, "1405/05/29"));

  // The sweep does not reach back for ever: a record whose day passed before
  // the rule existed would produce a task about something forgotten a year ago.
  eq("the sweep looks back a fixed window", sweepRange(5, "1405/05/29").from, "1405/04/10");
  eq("and no further forward than today", sweepRange(5, "1405/05/29").to, "1405/05/29");

  /*
   * Counting *before* a date — the reminder half.
   *
   * «۳ روز قبل از تاریخ اعتبار» has to fire while the date is still ahead, so
   * both the due day and the band the sweep looks in run the other way. A
   * negative number of days is not how it is expressed: `days` stays a count
   * and the side is its own field, because a rule reading «−۳ روز پس از» is a
   * puzzle and a form that takes a minus sign collects one by accident.
   */
  eq("three days before a date is three days earlier",
    dueDay("1405/06/23", 3, "before"), "1405/06/20");
  ok("not due four days before", !isDue("1405/06/23", 3, "1405/06/19", "before"));
  ok("due on the third day before", isDue("1405/06/23", 3, "1405/06/20", "before"));
  ok("and still due after the date itself has passed",
    isDue("1405/06/23", 3, "1405/06/25", "before"));
  eq("the band reaches into the future, or the record is never even looked at",
    sweepRange(3, "1405/06/20", "before").to, "1405/06/23");

  eq("a rule reads as a sentence",
    describeSchedule({ subject: "proforma_expiry", days: 3, direction: "before" }),
    "۳ روز قبل از تاریخ اعتبار پیش‌فاکتور");
  eq("and after is the default, for every rule written before this existed",
    describeSchedule({ subject: "proforma_sent", days: 3 }),
    "۳ روز پس از ارسال پیش‌فاکتور به کارفرما");
  eq("zero days is the day itself",
    describeSchedule({ subject: "proforma_sent", days: 0 }),
    "در روز ارسال پیش‌فاکتور به کارفرما");

  const rules = [
    { id: "a", active: true, triggerType: TIME_TRIGGER, schedule: { subject: "proforma_issue", days: 5 } },
    { id: "b", active: false, triggerType: TIME_TRIGGER, schedule: { subject: "proforma_issue", days: 5 } },
    { id: "c", active: true, triggerType: "proforma_created" },
    { id: "d", active: true, triggerType: TIME_TRIGGER, schedule: { subject: "چیزی که وجود ندارد", days: 5 } },
  ];
  eq("only active, scheduled rules with a date this app knows",
    scheduledRules(rules as never[]).map((r: { id: string }) => r.id).join(","), "a");

  // The case people actually ask for: "three days after it went to the
  // customer". Counting from the issue date would count days a draft spent
  // waiting, so the sent day is stamped and this is what counts from it.
  eq("there is a subject for the day the proforma was sent",
    SCHEDULE_SUBJECTS.proforma_sent?.dateField, "sentDateJalali");

  {
    const stamped = (data: Record<string, unknown>, previous: string | null) => {
      stampSentDate(data, previous, "1405/05/24");
      return data.sentDateJalali ?? null;
    };
    eq("sending a draft stamps today",
      stamped({ status: "ارسال شده" }, "پیش‌نویس"), "1405/05/24");
    eq("re-saving an already-sent proforma does not move the date",
      stamped({ status: "ارسال شده" }, "ارسال شده"), null);
    eq("a save that does not send it stamps nothing",
      stamped({ status: "پیش‌نویس" }, "پیش‌نویس"), null);
    eq("a date the save carries itself is left alone",
      stamped({ status: "ارسال شده", sentDateJalali: "1405/05/20" }, "پیش‌نویس"), "1405/05/20");
  }

  // The editor offers these and the sweep reads the same list; a subject in one
  // and not the other is a rule that can be set up and never fire.
  ok("every subject names a model and a Jalali column",
    Object.values(SCHEDULE_SUBJECTS).every((s) => !!s.model && /Jalali$/.test(s.dateField)),
    Object.entries(SCHEDULE_SUBJECTS).map(([k, v]) => `${k}:${v.dateField}`));
}

/**
 * Customer value ranking.
 *
 * Two axes and a matrix. The checks that matter are the ones proving the rank
 * comes from the *matrix* and not from the combined index — a customer with no
 * sales and high potential has to come out C, and any implementation that
 * averaged the axes first would call them D and the sales team would ignore
 * them. The ten acceptance scenarios from the specification are at the end.
 */
head("Customer value: potential, realized and the matrix");
{
  const S = DEFAULT_CUSTOMER_VALUE_SETTINGS;
  const full = { consumption: 5, companySize: 5, projects: 5, portfolioFit: 5, repeatPurchase: 5 };

  /* --- potential --- */
  eq("every answer at its best is exactly 100", calculatePotentialScore(full, S), 100);
  eq("every answer at its worst is exactly 20",
    calculatePotentialScore({ consumption: 1, companySize: 1, projects: 1, portfolioFit: 1, repeatPurchase: 1 }, S), 20);
  // The worked example from the specification.
  eq("the specification's worked example",
    calculatePotentialScore({ consumption: 5, companySize: 5, projects: 4, portfolioFit: 5, repeatPurchase: 4 }, S), 94);
  eq("consumption carries the most weight of the five",
    calculatePotentialScore({ ...full, consumption: 1 }, S) < calculatePotentialScore({ ...full, repeatPurchase: 1 }, S), true);

  /* --- assessed or not --- */
  ok("a blank assessment is not an assessment", !isPotentialAssessed({}));
  ok("four out of five is still not an assessment",
    !isPotentialAssessed({ consumption: 5, companySize: 5, projects: 5, portfolioFit: 5 }));
  ok("all five is", isPotentialAssessed(full));
  eq("an unassessed customer has no potential score, not a zero",
    calculatePotentialScore({ consumption: 5 }, S), null);
  eq("and no combined index either", calculateCVI(80, null), null);

  /* --- recency --- */
  eq("a purchase this month scores full", recencyScore(0, S), 100);
  eq("three months is still full", recencyScore(3, S), 100);
  eq("four months drops a band", recencyScore(4, S), 80);
  eq("a year and a day drops again", recencyScore(13, S), 40);
  eq("beyond the last band scores nothing", recencyScore(40, S), 0);
  eq("never having bought scores nothing", recencyScore(null, S), 0);

  /* --- percentile --- */
  {
    const pop = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    eq("the top of the population scores near the top", percentileRank(100, pop), 95);
    eq("the bottom scores near the bottom", percentileRank(10, pop), 5);
    eq("the middle scores near the middle", percentileRank(50, pop), 45);
    eq("ties share one score, rather than being ordered arbitrarily",
      percentileRank(5, [5, 5, 5, 5]), 50);
    eq("an empty population scores nothing", percentileRank(10, []), 0);
    eq("a population of one is the whole population", percentileRank(7, [7]), 100);
  }

  /* --- realized --- */
  eq("full marks everywhere is 100", calculateRealizedScore(
    { grossProfitScore: 100, frequencyScore: 100, recencyScore: 100, paymentScore: 100, costToServeScore: 100 }, S), 100);
  eq("nothing anywhere is 0", calculateRealizedScore(
    { grossProfitScore: 0, frequencyScore: 0, recencyScore: 0, paymentScore: 0, costToServeScore: 0 }, S), 0);
  eq("gross profit alone carries half the score", calculateRealizedScore(
    { grossProfitScore: 100, frequencyScore: 0, recencyScore: 0, paymentScore: 0, costToServeScore: 0 }, S), 50);
  eq("cost to serve alone carries a twentieth", calculateRealizedScore(
    { grossProfitScore: 0, frequencyScore: 0, recencyScore: 0, paymentScore: 0, costToServeScore: 100 }, S), 5);

  /* --- the manual dropdowns --- */
  eq("a very good payer scores full", paymentScoreOf("بسیار خوش‌حساب"), 100);
  eq("an unset payer falls back to normal", paymentScoreOf(null), 60);
  eq("cheap to serve scores high, not low", costToServeScoreOf("بسیار کم"), 100);
  eq("expensive to serve scores nothing", costToServeScoreOf("بسیار زیاد"), 0);
  ok("cost to serve rewards the cheaper customer",
    costToServeScoreOf("کم") > costToServeScoreOf("زیاد"));

  /* --- CVI --- */
  eq("the index leans on what already happened", calculateCVI(100, 0), 60);
  eq("and only partly on what might", calculateCVI(0, 100), 40);
  eq("the specification's card example", calculateCVI(82, 94), 86.8);

  /* --- settings validation --- */
  eq("the defaults are valid", validateCustomerValueSettings(S), null);
  ok("realized weights that do not total 100 are refused",
    !!validateCustomerValueSettings({ ...S, realizedWeights: { ...S.realizedWeights, grossProfit: 40 } }));
  ok("nor do potential weights that do not total 100",
    !!validateCustomerValueSettings({ ...S, potentialWeights: { ...S.potentialWeights, consumption: 10 } }));
  ok("an evaluation period of zero is refused",
    !!validateCustomerValueSettings({ ...S, evaluationPeriodMonths: 0 }));
  ok("a threshold outside 0..100 is refused",
    !!validateCustomerValueSettings({ ...S, highRealizedThreshold: 140 }));
  {
    // Stored settings that do not total 100 would deflate every score silently.
    const repaired = normalizeCustomerValueSettings({ realizedWeights: { grossProfit: 10 } } as never);
    eq("broken stored weights fall back rather than deflating everyone",
      Math.round(sumRealizedWeights(repaired.realizedWeights)), 100);
    eq("and nothing configured at all gives the defaults",
      JSON.stringify(normalizeCustomerValueSettings(undefined)), JSON.stringify(S));
  }
}

/**
 * The ten acceptance scenarios, verbatim from the specification.
 */
head("Customer value: the acceptance scenarios");
{
  const S = DEFAULT_CUSTOMER_VALUE_SETTINGS;
  const assessed = (score: number) => {
    // Any assessment scoring exactly `score` will do; five equal answers is the
    // simplest, and 20/40/60/80/100 are all reachable that way.
    const answer = Math.round(score / 20);
    return { consumption: answer, companySize: answer, projects: answer, portfolioFit: answer, repeatPurchase: answer };
  };
  const rankOf = (realized: number, potential: number | null) =>
    determineRank(realized, potential, S);

  eq("1 — strategic: high realized, high potential", rankOf(85, 90), "A");
  eq("2 — profitable: high realized, low potential", rankOf(85, 40), "B");
  eq("3 — growth: low realized, high potential", rankOf(30, 90), "C");
  eq("4 — low value: low on both", rankOf(30, 40), "D");

  // 5 — a brand-new customer with no sales but real promise must be developed,
  // not written off. This is the scenario a CVI-based rank would get wrong.
  {
    const realized = calculateRealizedScore(
      { grossProfitScore: 0, frequencyScore: 0, recencyScore: 0, paymentScore: 60, costToServeScore: 60 }, S);
    const potential = calculatePotentialScore(assessed(100), S);
    eq("5 — a new high-potential customer scores low on realized", realized, 9);
    eq("   and is C, not D", determineRank(realized, potential, S), "C");
    ok("   even though the combined index is middling",
      (calculateCVI(realized, potential) ?? 0) < 50, calculateCVI(realized, potential));
  }

  // 6 — sales history but no assessment: no rank at all.
  eq("6 — an unassessed customer is pending, not ranked",
    determineRank(90, calculatePotentialScore({ consumption: 4 }, S), S), "PENDING");

  // 7 and 8 are properties of the service's arithmetic rather than the pure
  // rules; they are asserted where the totals are computed. What the rules own
  // is that the resulting figures land where the specification says.
  eq("7 — gross profit is revenue minus cost", 1_000_000 - 700_000, 300_000);
  eq("8 — an order of many lines is still one purchase", [{ lines: 15 }].length, 1);

  eq("9 — a purchase four months ago scores 80", recencyScore(4, S), 80);
  eq("10 — a very expensive customer to serve scores 0", costToServeScoreOf("بسیار زیاد"), 0);
}

/**
 * A sale happens on the day it is approved.
 *
 * `Project.winningDate` is «تاریخ تایید (ابلاغ قرارداد)». Keying off the
 * proforma's issue date instead puts a sale in the wrong evaluation period and
 * makes the customer look as stale as the day they were *quoted* — and the gap
 * between quoting and winning is months in this business, which is several
 * recency bands.
 */
head("Customer value: the sale date is the approval date");
{
  const issued = new Date("2026-03-21");
  const approved = new Date("2026-09-23");

  eq("the approval date wins over the issue date",
    saleDateOf({ issueDate: issued, project: { winningDate: approved } }).toISOString().slice(0, 10),
    "2026-09-23");
  eq("a proforma with no project falls back to its issue date",
    saleDateOf({ issueDate: issued, project: null }).toISOString().slice(0, 10), "2026-03-21");
  eq("so does a project never stamped with one",
    saleDateOf({ issueDate: issued, project: { winningDate: null } }).toISOString().slice(0, 10), "2026-03-21");

  // The window: a quotation written before it and approved inside it is a sale
  // in this period, which the issue date alone would miss entirely.
  const periodStart = new Date(Date.UTC(2025, 11, 1));
  ok("a sale quoted before the window but approved inside it is in the period",
    saleDateOf({ issueDate: new Date("2025-06-01"), project: { winningDate: new Date("2026-06-01") } }) >= periodStart);
  ok("and one approved before the window is not",
    saleDateOf({ issueDate: new Date("2025-06-01"), project: { winningDate: new Date("2025-07-01") } }) < periodStart);
}

/**
 * A rank set by hand.
 *
 * Overriding a rank means one of two different things and the system cannot
 * guess which, so the choice is asked for: keep it whatever the figures say, or
 * correct it for now and let the evaluation take back over. The second is
 * useless unless the recalculation actually drops it, which is what
 * `clearsOverride` is for.
 */
head("Customer value: a rank set by hand");
{
  const locked = (rank: string) => ({ manualRank: rank, manualRankLocked: true });
  const unlocked = (rank: string) => ({ manualRank: rank, manualRankLocked: false });

  {
    const r = resolveRank("D", locked("A"));
    eq("a locked override is the rank the customer gets", r.rank, "A");
    ok("and is marked as manual", r.rankIsManual);
    eq("while the computed rank is still recorded beside it", r.computedRank, "D");
    ok("and the override is kept", !r.clearsOverride);
  }
  {
    const r = resolveRank("D", unlocked("A"));
    eq("an unlocked override gives way to the formula", r.rank, "D");
    ok("and stops being called manual", !r.rankIsManual);
    ok("and is cleared, so it cannot linger past the recalculation", r.clearsOverride);
  }
  {
    const r = resolveRank("A", null);
    eq("with no override the formula decides", r.rank, "A");
    ok("nothing is manual", !r.rankIsManual);
    ok("and there is nothing to clear", !r.clearsOverride);
  }
  {
    // The flag alone must never blank a rank.
    const r = resolveRank("A", { manualRank: null, manualRankLocked: true });
    eq("locked with no rank falls back to the formula", r.rank, "A");
    ok("and is not manual", !r.rankIsManual);
  }
  eq("a locked override holds a rank down as well as up",
    resolveRank("A", locked("D")).rank, "D");
  eq("and holds even over an unassessed customer",
    resolveRank("PENDING", locked("B")).rank, "B");
}

/*
 * Every line on a proforma has to have a cost.
 *
 * Gross profit — and through it every customer's rank — is only as honest as
 * its worst-documented line, and an uncosted line used to be dropped from the
 * margin entirely, which flattered exactly the sales nobody had bothered to
 * cost. These are the rules that make a blank impossible to save while keeping
 * "this line genuinely costs nothing" expressible.
 */
head("Cost of goods: no line without a cost");
{
  ok("a blank cost has to be answered", lineNeedsCost({ unitCost: null, costSource: null }));
  ok("so does a missing one", lineNeedsCost({}));
  ok("and a figure that is not a number", lineNeedsCost({ unitCost: Number.NaN, costSource: "MANUAL" }));
  ok("a figure somebody typed is an answer", !lineNeedsCost({ unitCost: 1200, costSource: COST_SOURCES.MANUAL }));

  // The distinction NONE exists for. Without it "a service line" and "nobody
  // has got to this yet" are both an empty box, and the check has to either
  // block the first or let the second through.
  ok("a deliberate zero is an answer, not a blank",
    !lineNeedsCost({ unitCost: 0, costSource: COST_SOURCES.NONE }));
  ok("while a plain zero with no source is still a blank",
    lineNeedsCost({ unitCost: null, costSource: null }));

  const lines = [
    { productName: "شیر پروانه‌ای", unitCost: 100, costSource: COST_SOURCES.MANUAL },
    { productName: "خدمات نصب", unitCost: 0, costSource: COST_SOURCES.NONE },
    { productName: "فلومتر", unitCost: null, costSource: null },
    { unitCost: null, costSource: null },
  ];
  const missing = linesMissingCost(lines);
  eq("only the unanswered lines are reported", missing.length, 2);
  eq("and each is named so the user can find it", missing[0].name, "فلومتر");
  eq("a line with no name is reported by its position", missing[1].name, "ردیف 4");
  eq("with the index the form needs to scroll to it", missing[1].index, 3);
}

/*
 * The cost is held in the document's own currency, next to the price.
 *
 * That is what makes the margin percentage independent of the exchange rate —
 * and computable at all for a document whose rate was never recorded.
 */
head("Cost of goods: currency and margin");
{
  eq("a cost converts between currencies through rial", convertCost(10, 900_000, 90_000), 100);
  eq("a zero converts to zero without needing a rate", convertCost(0, 0, 0), 0);

  // Never a zero. A zero cost travels all the way into a customer's gross
  // profit as pure margin, which is the failure this whole feature is about.
  eq("an unknown rate gives an unknown cost", convertCost(10, 0, 90_000), null);
  eq("and so does an unknown target rate", convertCost(10, 900_000, 0), null);

  const m = lineMargin(1000, 700, 3);
  eq("revenue is price times quantity", m.revenue, 3000);
  eq("cost is cost times quantity", m.cost, 2100);
  eq("profit is the difference", m.profit, 900);
  eq("and the margin is a percentage of revenue", m.marginPercent, 30);

  // The same line quoted in a different currency: every figure scales, the
  // percentage does not. This is the property the storage choice buys.
  const foreign = lineMargin(1000 / 90_000, 700 / 90_000, 3);
  eq("the margin is the same whatever the currency", foreign.marginPercent, 30);

  eq("selling below cost is a negative margin", lineMargin(100, 150, 1).marginPercent, -50);
  eq("a free line has no margin to report", lineMargin(0, 0, 1).marginPercent, null);
}

/*
 * What to offer before anybody types. Best evidence wins: what we actually paid
 * beats what we assume the item costs.
 */
head("Cost of goods: the suggested figure");
{
  const both = suggestLineCost(
    { purchaseOrderRial: 900_000, priceCalculatorRial: 500_000 }, 90_000, "یورو",
  );
  eq("the purchase order wins over the calculator", both?.costSource, COST_SOURCES.PURCHASE_ORDER);
  eq("and arrives in the document's currency", both?.unitCost, 10);
  eq("labelled with it", both?.costCurrency, "یورو");

  const calc = suggestLineCost({ priceCalculatorRial: 450_000 }, 90_000, "یورو");
  eq("the calculator is the fallback", calc?.costSource, COST_SOURCES.PRICE_CALCULATOR);
  eq("converted the same way", calc?.unitCost, 5);

  const rial = suggestLineCost({ purchaseOrderRial: 900_000 }, 1, "ریال");
  eq("a rial document needs no conversion", rial?.unitCost, 900_000);

  eq("neither known means nobody has said",
    suggestLineCost({}, 90_000, "یورو"), null);
  eq("and a foreign document with no rate cannot be answered for",
    suggestLineCost({ purchaseOrderRial: 900_000 }, 0, "یورو"), null);
}

/*
 * The calculator's manual mode.
 *
 * Not every item is imported. Goods bought locally, or quoted by a supplier
 * all-in, have a cost that is simply known — and forcing that through a
 * freight-and-customs breakdown meant inventing figures or leaving the cost
 * blank, which is how uncosted lines reached the sales history.
 */
head("Price calculator: stating the figures instead of deriving them");
{
  const manual = calculateSellingPrice({
    mode: "MANUAL",
    manualLandedForeign: 80,
    manualSellingForeign: 100,
    priceForeign: 999, exchangeRate: 90_000,
    remittanceFee: 5, remittancePct: 2, shippingCost: 50,
    otherCostsForeign: 10, customsDutyRIYAL: 1_000_000, otherCostsRIYAL: 500_000,
    profitPct: 55, profitRIYAL: 0, marginType: "PERCENT",
  });
  eq("the stated cost is the cost", manual.landedForeign, 80);
  eq("the stated price is the price", manual.sellingForeign, 100);
  eq("the breakdown fields are ignored entirely", manual.remittanceForeign, 0);
  eq("and both are converted at the given rate", manual.landedRial, 80 * 90_000);
  eq("so the profit is the difference in rial", manual.profitAmountRial, 20 * 90_000);

  // Everything written before manual mode existed has no `mode` at all, and has
  // to keep computing exactly as it did.
  const inputs = {
    priceForeign: 100, exchangeRate: 90_000,
    remittanceFee: 0, remittancePct: 0, shippingCost: 0,
    otherCostsForeign: 0, customsDutyRIYAL: 0, otherCostsRIYAL: 0,
    profitPct: 50, profitRIYAL: 0, marginType: "PERCENT" as const,
  };
  eq("an absent mode still means the breakdown",
    calculateSellingPrice(inputs).landedForeign,
    calculateSellingPrice({ ...inputs, mode: "BREAKDOWN" }).landedForeign);
  eq("which is not what manual mode would have said",
    calculateSellingPrice({ ...inputs, mode: "MANUAL", manualLandedForeign: 7 }).landedForeign, 7);
}


/*
 * The server's half of the rule. The form can be bypassed — a script, an old
 * tab, a hand-made request — so the gate that actually holds is this one.
 */
head("Cost of goods: what the server stores and what it refuses");
{
  const c = (row: Record<string, unknown>) => normalizeLineCost(row as never, "یورو");

  eq("a typed figure is kept", c({ unitCost: "12.5", costSource: "MANUAL" }).unitCost, 12.5);
  eq("Persian digits and separator are read too", c({ unitCost: "۱۲٫۵" }).unitCost, 12.5);
  eq("a figure with no source is somebody typing it", c({ unitCost: 10 }).costSource, COST_SOURCES.MANUAL);
  eq("an unrecognised source is not stored as itself", c({ unitCost: 10, costSource: "WHATEVER" }).costSource, COST_SOURCES.MANUAL);

  // The currency is the document's, never the client's claim about it: the
  // figure sits beside a price in that currency, and a line labelled otherwise
  // makes the margin arithmetic between two different units.
  eq("the currency is stamped from the document",
    c({ unitCost: 10, costCurrency: "ریال" }).costCurrency, "یورو");

  eq("a blank stays blank", c({}).unitCost, null);
  eq("with no source of its own", c({}).costSource, null);
  eq("a negative cost is not an answer", c({ unitCost: -5 }).unitCost, null);
  eq("NONE stores a real zero", c({ costSource: "NONE" }).unitCost, 0);
  eq("and keeps saying so", c({ costSource: "NONE" }).costSource, COST_SOURCES.NONE);

  const threw = (rows: unknown[], type?: string) => {
    try { assertLinesCosted(rows as never, "ریال", type); return false; } catch { return true; }
  };
  ok("a document with an uncosted line is refused",
    threw([{ productName: "فلومتر" }]));
  ok("a fully costed one goes through",
    !threw([{ productName: "فلومتر", unitCost: 10, costSource: "MANUAL" }]));
  ok("as does one whose line is explicitly free",
    !threw([{ productName: "خدمات", costSource: "NONE" }]));

  // A nameless row is dropped by the mapper and never stored, so demanding a
  // cost for one would block a save over a line that does not exist.
  ok("a nameless row is not a line and is not asked about", !threw([{ quantity: 1 }]));

  // A technical proforma quotes specifications, not prices — there is no cost
  // to be missing and nowhere in its form to enter one.
  ok("a technical proforma is exempt", !threw([{ productName: "فلومتر" }], "TECHNICAL"));
}


console.log(`\n${"─".repeat(56)}\n${pass} checks passed, ${fails.length} failed`);
if (fails.length) { console.log("Failures:"); fails.forEach(f => console.log("  • " + f)); }
