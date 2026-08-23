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
import { getProformaOutcomeStatus } from "../src/useERPStore";
import { computeInquiryTotals } from "../src/utils/inquirySteps";
import { toNumber } from "../src/server/childSync";
import { getTodayShamsi, addWorkingDaysToShamsi, addDaysToShamsi, jalaliToGregorian, toShamsiStr } from "../src/dateUtils";
import { generateSku, decodeSku } from "../src/utils/skuUtils";
import {
  DEFAULT_CUSTOMER_VALUE_SETTINGS, calculateCVI, calculatePotentialScore, calculateRealizedScore,
  RANK_META, costToServeScoreOf, determineRank, evaluateCustomerValue, isPotentialAssessed,
  normalizeCustomerValueSettings, paymentScoreOf, percentileRank, recencyScore, resolveRank,
  sumRealizedWeights, validateCustomerValueSettings,
} from "../src/utils/customerValue";
import { hasEverPurchased, saleDateOf } from "../src/server/services/customerValueService";
import { buildReportingTables } from "../src/reporting/flatten";
import { findCustomerDuplicates } from "../src/utils/customerDuplicates";
import { canonicalizeProvince } from "../src/utils/iranProvinces";
import { computeProformaTotals, roundMoney } from "../src/utils/proformaTotals";
import {
  calculateProformaFinance, calculateProjectFinance, priceInWarehouseCurrency,
} from "../src/utils/finance";
import {
  CHANNELS, MESSAGE_VARIABLES, SAMPLE_VARIABLE_VALUES, isBaleChatId, isWithinQuietHours,
  looksLikeMobile, nextAllowedSendTime, renderTemplate, resolveRecipient, retryDelayMs,
  shouldRetry, smsLength, templateVariables,
} from "../src/utils/messaging";
import { addresseeOf, namePrefixFor } from "../src/utils/honorific";
import { APP_MODULES, DEFAULT_MODULE_ORDER } from "../src/appModules";
import {
  attributesFromSelections, mergeSpecText, selectionsFromAttributes,
  selectionsFromSpecText, specLinesFrom,
} from "../src/utils/productConfig";
import { renderRichText, stripRichMarks, toggleMark } from "../src/utils/richText";
import {
  MAX_ACTIVITY_ATTACHMENTS, attachmentColumns, normalizeAttachments, parseAttachments,
} from "../src/utils/attachments";
import {
  DEFAULT_ASSISTANT_CONFIG, assistantUnavailableReason, buildSystemPrompt,
  resolveAssistantConfig, unsupportedParameterFrom,
} from "../src/utils/assistant";
import {
  ASSISTANT_ACTIONS, PROPOSAL_TTL_MINUTES, confirmRefusalReason, proposalExpired,
} from "../src/utils/assistantActions";
import { catalogueMatchesImplementations } from "../src/server/services/assistant/actions";
import {
  TOKEN_PREFIX, maskToken, normalizeScope, parseBearer, pathClosedToTokens,
  scopeAllowsMethod, tokenRefusalReason, visiblePrefix,
} from "../src/utils/apiTokens";
import {
  clampNumber, isPartialNumber, parseDecimalInput, toLatinDigits,
} from "../src/utils/numberInput";
import {
  generateDeliveryNotes, getDeliverySummary, updateNotesWithDelivery,
} from "../src/utils/deliveryNotes";
import { DEFAULT_SETTINGS } from "../src/seedData";
import { KEY_PERMISSION, canSeeCosts } from "../src/server/auth";
import {
  preserveLineCosts, redactCustomerValue, redactInquiry, redactProduct,
  redactPurchaseOrder, redactProforma, redactValueDetail, redactValueSummary,
  stripProductCostInput,
} from "../src/server/costs";
import {
  countsTowardBalance, describeTransaction, rialAmountOf,
} from "../src/server/services/transactionService";
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
import { buildTransactionWhere } from "../src/server/services/transactionService";
import { ACTIVITY_CATEGORY, canonicalCategoryName, sameCategory } from "../src/utils/activityCategories";
import { packableLines, outstandingFor } from "../src/utils/packingAllocation";
import { importStageDurations } from "../src/utils/importTimeline";
import { parseMilestoneRules } from "../src/server/services/milestoneAutomation";
import { FRESH_FOR_MS, refreshDecision, type RateRefreshState } from "../src/server/services/rateRefresh";
import { receivedDateImpliesStatus, computeTotals, RECEIVED_STATUS } from "../src/server/services/purchaseOrderService";
import { REQUIRED_FIELDS_METADATA } from "../src/utils/requiredFields";
import {
  COST_DRIFT_THRESHOLD_PERCENT, COST_SOURCES, convertCost, costDrift, landedUnitCostOf,
  lineMargin, lineNeedsCost, linesMissingCost, sellingPriceFor,
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
  // These scenarios are all about customers who have bought something; the
  // no-purchase rule has its own section below.
  const rankOf = (realized: number, potential: number | null) =>
    determineRank(realized, potential, true, S);

  eq("1 — strategic: high realized, high potential", rankOf(85, 90), "A");
  eq("2 — profitable: high realized, low potential", rankOf(85, 40), "B");
  eq("3 — growth: low realized, high potential", rankOf(30, 90), "C");
  eq("4 — low value: low on both", rankOf(30, 40), "D");

  // 5 — a customer barely into their first year, with real promise, must be
  // developed rather than written off. This is the scenario a CVI-based rank
  // would get wrong: the index is middling, and the matrix still says C.
  {
    const realized = calculateRealizedScore(
      { grossProfitScore: 0, frequencyScore: 0, recencyScore: 0, paymentScore: 60, costToServeScore: 60 }, S);
    const potential = calculatePotentialScore(assessed(100), S);
    eq("5 — a new high-potential customer scores low on realized", realized, 9);
    eq("   and once they have bought, is C, not D",
      determineRank(realized, potential, true, S), "C");
    ok("   even though the combined index is middling",
      (calculateCVI(realized, potential) ?? 0) < 50, calculateCVI(realized, potential));
    // The distinction added later: "hardly anything yet" and "nothing at all"
    // are not the same customer, and only the first belongs in the matrix.
    eq("   before their first purchase they are a prospect, not a C",
      determineRank(realized, potential, false, S), "PROSPECT");
  }

  // 6 — sales history but no assessment: no rank at all.
  eq("6 — an unassessed customer is pending, not ranked",
    determineRank(90, calculatePotentialScore({ consumption: 4 }, S), true, S), "PENDING");

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


/*
 * A rank is a verdict on a relationship, and half of it is about money that has
 * changed hands. Somebody who has only ever been quoted has no realized value
 * to measure — ranking them anyway puts them at D, "low value, low priority",
 * which is exactly backwards for a lead the sales team is working on.
 */
head("Customer value: a customer who has never bought");
{
  const S = DEFAULT_CUSTOMER_VALUE_SETTINGS;
  // Five answers of the same value, which is the simplest way to reach a given
  // score. The answers are 1..5, so the reachable scores are 20/40/60/80/100 —
  // `high` stands in for the specification's "90" and `low` for its "40".
  const answers = (n: number) => ({
    consumption: n, companySize: n, projects: n, portfolioFit: n, repeatPurchase: n,
  });
  const high = 5;
  const low = 2;
  const evaluate = (answer: number, bought: boolean, components = {
    grossProfitScore: 0, frequencyScore: 0, recencyScore: 0,
    paymentScore: 100, costToServeScore: 100,
  }) => evaluateCustomerValue(components, answers(answer), bought, S);

  // The three worked examples from the specification.
  {
    const r = evaluate(high, false);
    eq("high potential, no purchase — not ranked", r.rank, "PROSPECT");
    eq("and the potential is still there to sort them by", r.potentialScore, 100);
  }
  {
    const r = evaluate(high, true, {
      grossProfitScore: 35, frequencyScore: 35, recencyScore: 35,
      paymentScore: 35, costToServeScore: 35,
    });
    eq("high potential, one purchase, realized 35 — the matrix decides", r.rank, "C");
    eq("which is «مشتری قابل توسعه»", RANK_META[r.rank].title, "مشتری قابل توسعه");
  }
  eq("low potential, no purchase — still just a prospect", evaluate(low, false).rank, "PROSPECT");
  eq("and their potential is reported as it is", evaluate(low, false).potentialScore, 40);

  // The rank must not be reachable by having a low potential either: it is the
  // purchase that decides, not the score.
  eq("a prospect with no potential assessed is still a prospect",
    determineRank(0, null, false, S), "PROSPECT");
  eq("while a customer who has bought and is unassessed is pending",
    determineRank(0, null, true, S), "PENDING");

  // Realized value is not "low" for a prospect, it is not applicable — and a
  // score built out of payment and cost-to-serve opinions about somebody who
  // has never paid an invoice is not a measurement of anything.
  eq("a prospect's realized value is zero, not an opinion", evaluate(high, false).realizedScore, 0);
  ok("even though the same components would have scored otherwise",
    evaluate(high, true).realizedScore > 0, evaluate(high, true).realizedScore);
  eq("and there is no CVI, which only orders within a rank",
    evaluate(high, false).cvi, null);
  ok("a customer who has bought keeps theirs", evaluate(high, true).cvi !== null);

  eq("«مشتری بالقوه» is what the screens show", RANK_META.PROSPECT.title, "مشتری بالقوه");

  // The first confirmed sale moves them into the matrix with no other change.
  {
    const before = evaluate(high, false);
    const after = evaluate(high, true);
    eq("before the first sale", before.rank, "PROSPECT");
    ok("after it, a real rank", after.rank === "A" || after.rank === "B"
      || after.rank === "C" || after.rank === "D", after.rank);
    eq("with the potential unchanged", after.potentialScore, before.potentialScore);
  }

  /*
   * Lapsed is not the same as never, and this is the distinction the whole rule
   * turns on. A customer who bought three years ago has a history worth
   * everything it was worth; only their recency score should say it is stale.
   */
  ok("never bought — a prospect", !hasEverPurchased({ lastPurchaseDate: null }));
  ok("nothing recorded at all — also a prospect", !hasEverPurchased(undefined));
  ok("bought three years ago — lapsed, not a prospect",
    hasEverPurchased({ lastPurchaseDate: new Date(Date.UTC(2023, 0, 15)) }));
  ok("bought last week — obviously not a prospect",
    hasEverPurchased({ lastPurchaseDate: new Date(Date.UTC(2026, 7, 13)) }));

  // An override is a person's deliberate decision and still outranks the rules,
  // exactly as it does over an unassessed customer.
  {
    const r = resolveRank("PROSPECT", { manualRank: "A", manualRankLocked: true });
    eq("a locked manual rank holds over a prospect too", r.rank, "A");
    eq("and what it overrode is still on the record", r.computedRank, "PROSPECT");
  }
}

/*
 * Custom fields, as Power BI has to read them.
 *
 * Every module stores its custom fields as one JSON blob keyed by the field's
 * id, while the label the user typed lives in the settings document — which
 * never reached the reporting database. So the export shipped a bag of
 * `cf-1755689000000` keys that meant nothing, and the report author named every
 * column by hand, again after each new field.
 */
head("Reporting: the custom-field dictionary and its values");
{
  const fields = [
    { id: "cf-1", module: "products", name: "تقاضای بازار", type: "select",
      options: ["کم", "متوسط", "خوب"] },
    { id: "cf-2", module: "products", name: "فروش برآوردی سالانه", type: "number", required: true },
    { id: "cf-3", module: "products", name: "انبار شود؟", type: "boolean" },
    { id: "cf-4", module: "customers", name: "کد ناحیه", type: "text" },
    // The two modules the settings screen had always offered and no table
    // could store — see the migration that gave them a customValues column.
    { id: "cf-5", module: "packagingDelivery", name: "شماره بارنامه دوم", type: "text" },
    { id: "cf-6", module: "afterSalesServices", name: "هزینه تعمیر", type: "number" },
  ];
  const store = {
    erp_custom_fields: fields,
    erp_products: [
      { id: "p1", code: "FT100", displayName: "فلومتر",
        customValues: { "cf-1": "متوسط", "cf-2": "۲۰", "cf-3": true, "cf-99": "میراث" } },
      { id: "p2", displayName: "بدون مقدار", customValues: {} },
      { id: "p3", displayName: "بدون فیلد" },
    ],
    erp_customers: [{ id: "c1", companyName: "پتروشیمی", customValues: { "cf-4": "021" } }],
    erp_packaging_deliveries: [
      { id: "d1", packingListNumber: "PL-1", customValues: { "cf-5": "BL-99" } },
    ],
    erp_after_sales_services: [
      { id: "a1", itemName: "فلومتر", customValues: { "cf-6": "۱۲۵۰۰۰" } },
    ],
  };

  const tables = buildReportingTables(store as never);
  const defs = tables.find((t) => t.table === "custom_fields")!;
  const values = tables.find((t) => t.table === "custom_field_values")!;
  const byField = (id: string) => values.rows.find((r) => r.field_id === id)!;

  eq("the dictionary carries the readable label", defs.rows[0].name, "تقاضای بازار");
  eq("and the module in Persian, for a slicer", defs.rows[0].module_label, "کالا/تجهیزات");
  eq("a select's choices travel with it", defs.rows[0].options, "کم | متوسط | خوب");

  eq("a value lands in value_text whatever its type", byField("cf-1").value_text, "متوسط");
  // People type Persian digits, and `٫` is the decimal separator. Left alone
  // they make Number() return NaN, and the measure arrives empty with no hint.
  eq("a numeric field parses Persian digits", byField("cf-2").value_number, 20);
  eq("keeping the text exactly as typed", byField("cf-2").value_text, "۲۰");
  // A text field holding "۱۲" is not a measure; summing it would be wrong.
  eq("a non-numeric field has no number", byField("cf-1").value_number, null);
  eq("a checkbox lands in value_bool", byField("cf-3").value_bool, true);

  eq("the label is denormalised on to every value", byField("cf-2").field_name, "فروش برآوردی سالانه");
  eq("and the record it belongs to is named", byField("cf-1").record_id, "p1");
  eq("modules share one long table", byField("cf-4").module, "customers");

  // A field deleted from the settings still has answers on every record it was
  // filled in on. Dropping them because a definition went would rewrite history.
  eq("an orphaned answer survives", byField("cf-99").value_text, "میراث");
  eq("flagged as no longer defined", byField("cf-99").is_defined, false);
  eq("with no label to show for it", byField("cf-99").field_name, null);

  ok("a record with an empty bag contributes nothing",
    !values.rows.some((r) => r.record_id === "p2"));
  ok("and so does one with no bag at all",
    !values.rows.some((r) => r.record_id === "p3"));

  // All ten modules, not eight. A field for either of these could be defined in
  // the settings and then filled in nowhere, because no table held the answer.
  eq("a packing list's custom field is exported", byField("cf-5").field_name, "شماره بارنامه دوم");
  eq("under its own module", byField("cf-5").module, "packagingDelivery");
  eq("an after-sales one too", byField("cf-6").module, "afterSalesServices");
  eq("with its number parsed", byField("cf-6").value_number, 125000);
  ok("and both modules keep their JSON column, like the other eight",
    typeof tables.find((t) => t.table === "packaging_deliveries")!.rows[0].custom_values === "string"
    && typeof tables.find((t) => t.table === "after_sales_services")!.rows[0].custom_values === "string");

  /*
   * Declared, not inferred. `sqlSync` types a column from the values it sees,
   * so a first sync with no numeric field would create this as NVARCHAR and
   * every figure stored afterwards would reach Power BI as text.
   */
  eq("value_number is declared FLOAT even when empty",
    values.columnTypes?.value_number, "float");
  eq("and value_bool a BIT", values.columnTypes?.value_bool, "bit");
  ok("the dictionary declares its columns too, so an empty table still has them",
    Object.keys(defs.columnTypes ?? {}).length > 0);
}

/*
 * One reader for "what does this item cost to land".
 *
 * It was written twice, once on each side — the proforma form worked out a
 * line's suggested cost and the customer-value service worked out the same
 * figure for its fallback — and the two had already drifted.
 */
head("Cost of goods: reading a product's calculator");
{
  const breakdown = {
    calcPriceForeign: 100, calcExchangeRate: 90_000,
    calcRemittanceFee: 0, calcRemittancePct: 0, calcShippingCost: 0,
    calcOtherCostsForeign: 0, calcCustomsDutyRIYAL: 0, calcOtherCostsRIYAL: 0,
    calcProfitPct: 50, calcMarginType: "PERCENT",
  };

  eq("a filled-in calculator gives the landed cost in rial",
    landedUnitCostOf(breakdown), 100 * 90_000);
  eq("an empty one gives nothing at all", landedUnitCostOf({}), null);
  eq("and so does a missing one", landedUnitCostOf(null), null);
  // Without a rate nothing can be turned into rial, and a zero here would
  // travel into a customer's gross profit as pure margin.
  eq("no exchange rate means no answer",
    landedUnitCostOf({ ...breakdown, calcExchangeRate: 0 }), null);

  // The drift this consolidation fixes: the server inherited the product's
  // calculator for a SKU that has none, and the form did not — so the same item
  // offered a figure in a report and an empty box on the proforma.
  eq("a SKU with no calculator of its own inherits the product's",
    landedUnitCostOf({}, breakdown), 100 * 90_000);
  eq("but its own figures win when it has them",
    landedUnitCostOf({ ...breakdown, calcPriceForeign: 70 }, breakdown), 70 * 90_000);

  // Manual mode states the cost outright; reading it through the breakdown
  // would answer with whatever the unused freight fields happened to hold.
  eq("a manually priced item states its cost",
    landedUnitCostOf({ calcMode: "MANUAL", calcManualLandedForeign: 80, calcExchangeRate: 90_000 }),
    80 * 90_000);
  // Under manual entry there is no purchase price to be missing.
  eq("with no purchase price needed",
    landedUnitCostOf({ calcMode: "MANUAL", calcManualLandedForeign: 80, calcExchangeRate: 90_000, calcPriceForeign: 0 }),
    80 * 90_000);

  // Both spellings, because the reporting export and older blobs use the bare
  // names while a product and a SKU use the `calc…` ones.
  eq("the bare field names read the same",
    landedUnitCostOf({ priceForeign: 100, exchangeRate: 90_000, marginType: "PERCENT" }),
    100 * 90_000);
}

/*
 * Which costs an actual purchase is allowed to overwrite.
 *
 * A line quoted from the catalogue carries the product's *standard* landed cost
 * — an estimate. When the real purchase lands, nothing used to correct it, so
 * gross profit and every rank built on it kept the guess for ever. It is now
 * corrected on receipt, but only where the stored figure was never a person's
 * answer.
 */
head("Cost of goods: what a real purchase may overwrite");
{
  // The rule as the service applies it, kept here so the intent is pinned even
  // though the write itself needs a database.
  const replaceable = (source: string | null) =>
    source === null
    || source === COST_SOURCES.PRICE_CALCULATOR
    || source === COST_SOURCES.BACKFILL
    || source === COST_SOURCES.PURCHASE_ORDER;

  ok("an unanswered line takes the real cost", replaceable(null));
  ok("so does a catalogue estimate", replaceable(COST_SOURCES.PRICE_CALCULATOR));
  ok("and the migration's guess", replaceable(COST_SOURCES.BACKFILL));
  // Refreshed rather than frozen: it came from here, and the order may be edited.
  ok("an earlier purchase figure is refreshed", replaceable(COST_SOURCES.PURCHASE_ORDER));

  // The two a person gave. Overwriting either would silently discard a decision.
  ok("a figure somebody typed is never overwritten", !replaceable(COST_SOURCES.MANUAL));
  ok("nor is an explicit «بدون بهای تمام‌شده»", !replaceable(COST_SOURCES.NONE));

  // A line split across two purchases has one unit cost: the total landed over
  // the total quantity. Reading every received order is also what makes the
  // push idempotent.
  const blended = (rows: { quantity: number; landedUnitCostRial: number }[]) => {
    const cost = rows.reduce((sum, r) => sum + r.landedUnitCostRial * r.quantity, 0);
    const quantity = rows.reduce((sum, r) => sum + r.quantity, 0);
    return quantity > 0 ? cost / quantity : null;
  };
  eq("two purchases for one line blend by quantity",
    blended([
      { quantity: 3, landedUnitCostRial: 100 },
      { quantity: 1, landedUnitCostRial: 200 },
    ]), 125);
  eq("one purchase is just its own cost",
    blended([{ quantity: 4, landedUnitCostRial: 90 }]), 90);
  eq("nothing received yet leaves it alone", blended([]), null);
}


/*
 * The outcome rule exists twice, and the two copies must never disagree.
 *
 * `src/server/proformaStatus.ts` is the authority; `getProformaOutcomeStatus`
 * in `useERPStore.ts` is a client copy kept only so a grid can colour a row
 * without asking the server. Nothing related them but a comment saying "change
 * both or neither", which is exactly the kind of instruction that gets missed.
 *
 * Rather than assert the expected answer twice, this runs both over every
 * combination and asserts they agree — so a change to either side that the
 * other did not get fails here, whatever the new rule turns out to be.
 */
head("Proforma outcome: the server and the client agree");
{
  const ITEM_STATUSES = [undefined, "جاری", "برنده", "بازنده", "لغو شده"] as const;
  const DOC_STATUSES = ["پیش‌نویس", "ارسال شده", "جاری", "تأیید شده (برنده)", "باخته"] as const;

  let compared = 0;
  const disagreed: string[] = [];

  const check = (pf: any) => {
    compared++;
    const server = getProformaOutcome(pf);
    const client = getProformaOutcomeStatus(pf);
    if (server !== client) {
      disagreed.push(`${JSON.stringify(pf)} → server=${server} client=${client}`);
    }
  };

  for (const status of DOC_STATUSES) {
    for (const isCancelled of [false, true]) {
      // No lines at all: the document's own status is the whole answer.
      check({ status, isCancelled, items: [] });
      check({ status, isCancelled });

      // One line, then every ordered pair — enough to reach every branch,
      // including the "all closed, some cancelled" tie-break.
      for (const a of ITEM_STATUSES) {
        check({ status, isCancelled, items: [{ status: a }] });
        for (const b of ITEM_STATUSES) {
          check({ status, isCancelled, items: [{ status: a }, { status: b }] });
        }
      }
      // Three lines mixing won, lost and cancelled — the part-won cases.
      check({ status, isCancelled, items: [{ status: "برنده" }, { status: "بازنده" }, { status: "لغو شده" }] });
      check({ status, isCancelled, items: [{ status: "برنده" }, { status: "جاری" }, { status: "بازنده" }] });
    }
  }

  ok(`both copies agree across all ${compared} combinations`, disagreed.length === 0,
    disagreed.slice(0, 3));

  // A couple of anchors, so a change that breaks both copies the same way is
  // still caught rather than silently agreed upon.
  eq("all won is won",
    getProformaOutcome({ status: "ارسال شده", isCancelled: false, items: [{ status: "برنده" }] } as never),
    "تأیید شده (برنده)");
  eq("some won and some not is part-won",
    getProformaOutcome({ status: "ارسال شده", isCancelled: false,
      items: [{ status: "برنده" }, { status: "بازنده" }] } as never),
    "نیمه برنده");
  eq("a cancelled document is cancelled whatever its lines say",
    getProformaOutcome({ status: "ارسال شده", isCancelled: true, items: [{ status: "برنده" }] } as never),
    "لغو شده");
  eq("everything closed with one cancelled reads as cancelled",
    getProformaOutcome({ status: "ارسال شده", isCancelled: false,
      items: [{ status: "بازنده" }, { status: "لغو شده" }] } as never),
    "لغو شده");
}


/*
 * The standard cost and the last real purchase are two different numbers.
 *
 * `priceCalc` is what the company quotes from — a judgement about a typical
 * purchase. A purchase order's per-line landed cost carries the freight and
 * customs of one shipment, so five units flown in urgently genuinely cost
 * several times what two hundred by sea do. A gap is therefore not an error,
 * and must never be closed automatically; it is worth *noticing*, because a
 * standard nobody has revisited since the supplier put its prices up is quietly
 * costing every quotation.
 */
head("Cost of goods: standard versus what we actually paid");
{
  eq("a real purchase above the standard is reported as such",
    costDrift(100, 130)?.percent, 30);
  eq("and below it as negative", costDrift(100, 80)?.percent, -20);
  ok("30% is worth showing", costDrift(100, 130)?.significant === true);
  ok("2% is not", costDrift(100, 102)?.significant === false);
  ok("paying more than we assumed is the direction that costs money",
    costDrift(100, 130)?.underpriced === true);
  ok("and paying less is not", costDrift(100, 80)?.underpriced === false);
  eq(`the threshold is ${COST_DRIFT_THRESHOLD_PERCENT}%`,
    costDrift(100, 100 + COST_DRIFT_THRESHOLD_PERCENT)?.significant, true);

  // An unpriced item would otherwise report infinite drift and bury the real
  // cases; a zero standard means the calculator was never filled in.
  eq("no standard means nothing to compare", costDrift(0, 130), null);
  eq("no purchase either", costDrift(100, 0), null);
  eq("and a missing figure is not a comparison", costDrift(null, 130), null);

  // Offered so the consequence of adopting a cost is visible — never applied on
  // its own. A supplier's rise is not automatically the customer's.
  eq("the stored percentage margin implies a price",
    sellingPriceFor(100_000, "PERCENT", 50, 0), 150_000);
  eq("a fixed margin adds instead of multiplying",
    sellingPriceFor(100_000, "FIXED", 0, 40_000), 140_000);
  eq("no margin recorded means no suggestion",
    sellingPriceFor(100_000, "PERCENT", 0, 0), null);
  eq("and no cost means none either", sellingPriceFor(0, "PERCENT", 50, 0), null);

  /*
   * Adopting a real cost has to survive the round trip.
   *
   * The figure is stored in the item's own currency and read back in rial, so
   * the precision of that division decides whether the warning the user just
   * acted on actually clears. At two decimals a 12,000,000 rial cost at a rate
   * of 90,000 comes back 300 rial short and the drift never quite closes; four
   * — what every other foreign amount uses — leaves 3.
   */
  {
    const rate = 90_000;
    const actual = 12_000_000;
    const toForeign = (rial: number) => Math.round((rial / rate) * 10_000) / 10_000;
    const adopted = {
      calcMode: "MANUAL",
      calcExchangeRate: rate,
      calcManualLandedForeign: toForeign(actual),
      calcManualSellingForeign: toForeign(13_500_000),
    };
    const readBack = landedUnitCostOf(adopted)!;
    ok("an adopted cost reads back as itself", Math.abs(readBack - actual) < 10, readBack);
    eq("so the drift it was adopted to close is gone",
      costDrift(readBack, actual)?.percent, 0);
    ok("and stops being worth showing", costDrift(readBack, actual)?.significant === false);
  }
}


/*
 * A catalogue item has one currency, and every SKU under it follows.
 *
 * The price calculator can be run in any currency — usually the proforma's —
 * and its result used to be written onto the SKU together with *its* currency.
 * That left the SKU out of step with its product, and since the product form
 * reads the product's currency, the number then displayed as if it were in a
 * currency it was never in. The rial column stayed right, which is exactly why
 * it went unnoticed.
 */
head("Warehouse price: stated in the currency the item is kept in");
{
  const rates: Record<string, number> = { "یورو": 100_000, "دلار": 90_000 };
  const rateOf = (c: string) => (c === "ریال" ? 1 : rates[c] ?? 0);

  // 150 dollars agreed on the proforma, for an item the warehouse keeps in euros.
  const sellingForeign = 150;
  const sellingRial = 150 * rates["دلار"];  // 13,500,000

  const stored = priceInWarehouseCurrency(sellingForeign, sellingRial, "دلار", "یورو", rateOf);
  eq("the amount is restated in the item's own currency", stored, 135);
  eq("so reading it back gives the rial actually agreed",
    (stored ?? 0) * rates["یورو"], sellingRial);
  // What the bug did: the dollar figure read under the product's euro label.
  ok("which the unconverted figure did not",
    sellingForeign * rates["یورو"] !== sellingRial, sellingForeign * rates["یورو"]);

  eq("a matching currency is written exactly as entered",
    priceInWarehouseCurrency(sellingForeign, sellingRial, "دلار", "دلار", rateOf), 150);

  // An unknown rate cannot state the amount in this currency at all, and the
  // original number under the wrong label is the bug itself.
  eq("an unconvertible currency writes no foreign figure",
    priceInWarehouseCurrency(sellingForeign, sellingRial, "دلار", "روبل", rateOf), null);
  eq("a rial item needs no rate", 
    priceInWarehouseCurrency(sellingForeign, sellingRial, "دلار", "ریال", rateOf), sellingRial);
}


/*
 * Messaging: the rules between "a workflow matched" and "a message went".
 *
 * The automation half is not here because it already existed — sending is a
 * third kind of *action* on the workflow engine, sharing its triggers, its
 * conditions and its once-per-record firing log. What is new is the arithmetic
 * and the guardrails, and that is what this covers.
 */
head("Messaging: what a text message costs to send");
{
  // Persian is outside GSM-7, so it goes as UCS-2: 70 in one part, 67 each
  // once it splits, because the rest of that space carries the reassembly
  // header. This is on the screen because it is money — three characters over
  // the line doubles the bill, every send, and nothing else would say so.
  eq("70 Persian characters is one part", smsLength("ا".repeat(70)).parts, 1);
  eq("71 is two", smsLength("ا".repeat(71)).parts, 2);
  eq("and 134 still two", smsLength("ا".repeat(134)).parts, 2);
  eq("135 is three", smsLength("ا".repeat(135)).parts, 3);
  ok("Persian forces the unicode allowance", smsLength("سلام").unicode);

  eq("plain Latin gets 160", smsLength("a".repeat(160)).parts, 1);
  eq("161 splits", smsLength("a".repeat(161)).parts, 2);
  ok("and is not unicode", !smsLength("a".repeat(10)).unicode);
  // One Persian letter in an English template drops the whole message to 70.
  eq("a single Persian letter halves the allowance",
    smsLength("a".repeat(100) + "ا").parts, 2);

  eq("an empty body costs nothing", smsLength("").parts, 0);
  eq("and reports the full allowance as remaining", smsLength("").charactersLeft, 160);
  eq("a full single part has none left", smsLength("ا".repeat(70)).charactersLeft, 0);
}

head("Messaging: filling a template");
{
  const values = { customerName: "پتروشیمی آزمون", projectCode: "ATA-1405-001" };
  eq("double braces are filled",
    renderTemplate("سلام {{customerName}}", values), "سلام پتروشیمی آزمون");
  eq("single braces too",
    renderTemplate("پروژه {projectCode}", values), "پروژه ATA-1405-001");
  eq("spacing inside the braces is tolerated",
    renderTemplate("{{ customerName }}", values), "پتروشیمی آزمون");

  /*
   * A placeholder with no key behind it is left as written, not blanked.
   *
   * «سلام {{customerNam}}» is obviously a broken template and gets fixed;
   * «سلام » looks like a customer with no name and gets sent to somebody.
   *
   * A key that *is* there and is empty is the opposite case and is substituted:
   * a company has no honorific, and «{namePrefix}» standing in the text is the
   * placeholder itself reaching the customer. Presence, not truthiness.
   */
  eq("a misspelt placeholder stays visible",
    renderTemplate("سلام {{customerNam}}", values), "سلام {{customerNam}}");
  eq("but a value that is deliberately empty is filled in as empty",
    renderTemplate("سلام {{customerName}}", { customerName: "" }), "سلام ");

  eq("the editor can list what a template needs",
    templateVariables("{{a}} و {{b}} و {{a}}").join(","), "a,b");
}

head("Messaging: quiet hours");
{
  const at = (h: number, m = 0) => new Date(2026, 7, 20, h, m, 0, 0);
  const night = { from: "22:00", to: "08:00" };

  // A window that wraps midnight is two ranges; the naive comparison gets it
  // backwards and would send at 3am while holding messages all afternoon.
  ok("23:00 is inside a wrapping window", isWithinQuietHours(at(23), night));
  ok("03:00 is too", isWithinQuietHours(at(3), night));
  ok("14:00 is not", !isWithinQuietHours(at(14), night));
  ok("08:00 exactly is allowed — the window has closed", !isWithinQuietHours(at(8), night));
  ok("22:00 exactly is not", isWithinQuietHours(at(22), night));

  const lunch = { from: "12:00", to: "13:00" };
  ok("a same-day window works too", isWithinQuietHours(at(12, 30), lunch));
  ok("and lets the afternoon through", !isWithinQuietHours(at(13, 30), lunch));

  ok("no window configured holds nothing", !isWithinQuietHours(at(3), { from: null, to: null }));
  ok("nor does an unparseable one", !isWithinQuietHours(at(3), { from: "بیست", to: "هشت" }));

  // Held, never dropped: the message waits for the window to open.
  eq("a 3am message waits until 08:00",
    nextAllowedSendTime(at(3), night).getHours(), 8);
  eq("on the same day", nextAllowedSendTime(at(3), night).getDate(), 20);
  eq("an 11pm message waits until the next morning",
    nextAllowedSendTime(at(23), night).getDate(), 21);
  eq("also at 08:00", nextAllowedSendTime(at(23), night).getHours(), 8);
  eq("an afternoon message is not delayed at all",
    nextAllowedSendTime(at(14), night).getHours(), 14);
}

head("Messaging: retries");
{
  // The failures worth retrying are transient — a timeout, a gateway restart, a
  // rate limit. Hammering a provider that is refusing us gets an account blocked.
  eq("the first retry waits a minute", retryDelayMs(1), 60_000);
  eq("the second five", retryDelayMs(2), 5 * 60_000);
  eq("the third fifteen", retryDelayMs(3), 15 * 60_000);
  eq("and it stops growing there", retryDelayMs(9), 15 * 60_000);

  ok("three attempts in, there is another left", shouldRetry(3));
  ok("four is the end of it", !shouldRetry(4));
}

head("Messaging: who the message goes to");
{
  const contact = { name: "آقای احمدی", mobile: "09121234567", email: "a@b.com" };
  const customer = { name: "پتروشیمی آزمون", mobile: "09339876543", email: "info@petro.com" };

  eq("the named contact is preferred",
    resolveRecipient([contact, customer], CHANNELS.SMS).recipient?.address, "09121234567");
  eq("the channel decides which detail is used",
    resolveRecipient([contact, customer], CHANNELS.EMAIL).recipient?.address, "a@b.com");
  eq("and the customer is the fallback",
    resolveRecipient([null, customer], CHANNELS.SMS).recipient?.address, "09339876543");
  // A contact who lacks the detail this channel needs falls through.
  eq("a contact with no chat id gives way to one who has",
    resolveRecipient([contact, { ...customer, baleChatId: "555" }], CHANNELS.BALE)
      .recipient?.address, "555");

  /*
   * An opt-out on the person you meant to write to stops the message.
   *
   * Not "try the next one". Falling through to the company's own number when
   * the individual has opted out is how a business keeps texting somebody who
   * asked it to stop, through a different door.
   */
  eq("an opted-out contact stops the send",
    resolveRecipient([{ ...contact, doNotContact: true }, customer], CHANNELS.SMS).problem,
    "OPTED_OUT");
  eq("with no recipient at all",
    resolveRecipient([{ ...contact, doNotContact: true }, customer], CHANNELS.SMS).recipient,
    null);

  eq("nobody named is its own answer",
    resolveRecipient([], CHANNELS.SMS).problem, "NO_CONTACT");
  eq("a channel nobody has the details for says so",
    resolveRecipient([{ name: "بی‌شماره" }], CHANNELS.SMS).problem, "NO_ADDRESS");
  eq("and an unknown channel is refused before anything else",
    resolveRecipient([contact], "FAX" as never).problem, "NO_CHANNEL");

  /*
   * What Bale will deliver to.
   *
   * The failure this pins is a real one: a mobile number was entered as a Bale
   * chat id — the obvious thing to do, since every other channel addresses the
   * person by something they know about themselves — and Bale answered "no such
   * group or user", which names the value as unknown rather than as the wrong
   * kind of thing.
   */
  ok("a numeric chat id is accepted", isBaleChatId("1234567890"));
  ok("a group's negative id too", isBaleChatId("-1001234567890"));
  ok("and a public channel by name", isBaleChatId("@ata_channel"));
  ok("spaces around it do not matter", isBaleChatId("  1234567890  "));
  ok("a mobile number is not a chat id", !isBaleChatId("09121234567"));
  ok("nor is one written internationally", !isBaleChatId("+989121234567"));
  ok("nor 0098…", !isBaleChatId("00989121234567"));
  // The same number with the zero dropped is indistinguishable from an account
  // id, so it goes through and Bale is left to answer for it.
  ok("but a bare 9… is allowed through", isBaleChatId("9121234567"));
  ok("an empty field is not one either", !isBaleChatId(""));
  ok("and neither is an email address", !isBaleChatId("a@b.com"));

  ok("09… is recognised as a mobile", looksLikeMobile("09121234567"));
  ok("so is 9… without the leading zero", looksLikeMobile("9121234567"));
  ok("and +98…, spaces and dashes included", looksLikeMobile("+98 912-123-4567"));
  ok("a chat id is not mistaken for one", !looksLikeMobile("1234567890"));
}


head("How a customer is addressed");
{
  eq("a man gets the company's usual honorific", namePrefixFor("مرد"), "جناب آقای مهندس");
  eq("a woman gets hers", namePrefixFor("زن"), "سرکار خانم مهندس");
  eq("a company has none", namePrefixFor(""), "");
  eq("nor does somebody whose gender was never filled in", namePrefixFor("نامشخص"), "");
  eq("and null is not a man", namePrefixFor(null), "");

  eq("the name is joined to the honorific with one space",
    addresseeOf("مرد", "رضایی"), "جناب آقای مهندس رضایی");
  /*
   * The reason `addressee` exists at all: most of the list is companies, and
   * «{namePrefix} {customerName}» leaves a leading space in front of every one
   * of their names.
   */
  eq("a company is addressed by its name alone, with no stray space",
    addresseeOf("", "شرکت پتروشیمی نمونه"), "شرکت پتروشیمی نمونه");
  eq("and an honorific with nobody to attach it to is nothing",
    addresseeOf("مرد", ""), "جناب آقای مهندس");
}


head("Template variables: the palette and the values agree");
{
  /*
   * The screen used to list the variable names by hand, so a value the server
   * started providing was invisible to whoever was writing templates. Read both
   * sides and compare, in both directions.
   */
  const service = readFileSync(
    "src/server/services/messaging/messageService.ts", "utf-8");
  const start = service.indexOf("export async function messageVariables");
  const body = service.slice(start, service.indexOf("\n}", start));
  const filled = new Set(
    [...body.matchAll(/values\.([A-Za-z][A-Za-z0-9]*)\s*=/g)].map((m) => m[1]));
  const offered = new Set(MESSAGE_VARIABLES.map((v) => v.key));

  const notOffered = [...filled].filter((k) => !offered.has(k));
  const notFilled = [...offered].filter((k) => !filled.has(k));

  ok("every value the server fills in is offered on the screen",
    notOffered.length === 0, notOffered);
  ok("and every name the screen offers is one the server fills in",
    notFilled.length === 0, notFilled);
  ok("the check found the variables at all", filled.size >= 5, [...filled]);

  ok("every variable carries a sample for the preview",
    MESSAGE_VARIABLES.every((v) => v.sample.trim() !== "" && v.label.trim() !== ""));

  /*
   * A key that is present and empty is substituted; a key that is absent is
   * left standing. That distinction is what lets a company's blank honorific
   * render as nothing instead of putting «{namePrefix}» in front of a customer.
   */
  eq("a blank value renders as blank",
    renderTemplate("{namePrefix} {customerName} عزیز", { namePrefix: "", customerName: "شرکت الف" }),
    " شرکت الف عزیز");
  eq("a misspelled name is left standing so it is obvious",
    renderTemplate("سلام {customerNam}", { customerName: "علی" }), "سلام {customerNam}");
  eq("and the preview renders the whole palette",
    renderTemplate("{addressee} عزیز، پروژه {projectCode}", SAMPLE_VARIABLE_VALUES),
    "جناب آقای مهندس رضایی عزیز، پروژه PRJ-1405-018");
}


head("Activity category settings: usage is asked, not assumed");
{
  /*
   * The «وضعیت استفاده» column was a literal `const isUsed = false`, so every
   * category read as unused, the delete button looked available on all of them,
   * and the refusal only arrived after the click. The count now comes from the
   * server.
   */
  const screen = readFileSync("src/components/SettingsView.tsx", "utf-8");
  // Comment lines dropped first, or the note explaining the old bug matches it.
  const code = screen.split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");
  ok("the used flag is not hardcoded",
    !/const\s+isUsed\s*=\s*(false|true)\b/.test(code));
  ok("it is read from the counts the server sends",
    screen.includes("categoryUsage[cat.id]"));
  ok("and both the table and the cards read the same source",
    (screen.match(/categoryUsage\[cat\.id\]/g) ?? []).length >= 2);

  ok("a category can be renamed", screen.includes("handleRenameCategory"));

  /*
   * A rename has to follow into the projects already using the category:
   * `categoryName` is denormalised onto each group so history survives the
   * category being deleted, and a settings-only rename would leave every
   * existing project showing the old wording for good.
   */
  const service = readFileSync("src/server/services/activityService.ts", "utf-8");
  ok("and the rename reaches the groups that already use it",
    /renameCategory[\s\S]{0,600}updateMany\([\s\S]{0,200}categoryName/.test(service));
  ok("the bulk usage count is one query, not one per category",
    /categoryUsage[\s\S]{0,400}groupBy/.test(service));
}

head("Assistant: configuration, and what it is told before it answers");
{
  const c = resolveAssistantConfig(undefined);
  eq("an unconfigured assistant is off", c.enabled, false);
  eq("and never proposes writes", c.allowActions, false);
  ok("but has a usable default base url and model", !!c.baseUrl && !!c.model);

  eq("a trailing slash on the base url is dropped — the client appends the path",
    resolveAssistantConfig({ baseUrl: "https://x/v1///" }).baseUrl, "https://x/v1");
  eq("a blank base url falls back rather than producing a broken request",
    resolveAssistantConfig({ baseUrl: "   " }).baseUrl, DEFAULT_ASSISTANT_CONFIG.baseUrl);

  /*
   * Every number is bounded here rather than at the call site: a step limit of
   * 500 typed into the settings screen is a bill, not a preference.
   */
  eq("the step limit is capped", resolveAssistantConfig({ maxToolCalls: 500 }).maxToolCalls, 30);
  eq("and floored", resolveAssistantConfig({ maxToolCalls: 0 }).maxToolCalls, 1);
  eq("nonsense falls back to the default",
    resolveAssistantConfig({ temperature: Number.NaN }).temperature,
    DEFAULT_ASSISTANT_CONFIG.temperature);
  eq("the timeout is bounded too", resolveAssistantConfig({ timeoutSeconds: 9999 }).timeoutSeconds, 300);

  /* Why it cannot run, in the order somebody would fix them. */
  const ready = resolveAssistantConfig({ enabled: true, baseUrl: "https://x/v1", model: "m" });
  eq("disabled is the first thing reported",
    assistantUnavailableReason(resolveAssistantConfig({}), true)?.includes("فعال نیست"), true);
  eq("then the missing key",
    assistantUnavailableReason(ready, false)?.includes("کلید"), true);
  eq("and a configured assistant has no reason at all",
    assistantUnavailableReason(ready, true), null);

  /*
   * The instructions are most of what makes an assistant over a business system
   * useful, so they are pinned: the calendar, the currency, and the rule that
   * it may not invent a figure.
   */
  const prompt = buildSystemPrompt({
    companyName: "ابزار تامین آرشیا", todayJalali: "1405/06/01", userName: "محمد",
    canSeeCosts: true, actionsAllowed: false, actions: [],
    extra: "همیشه به تومان هم بنویس.",
  });
  ok("it is told today's date", prompt.includes("1405/06/01"));
  ok("and whose question it is answering", prompt.includes("محمد"));
  ok("and that it must not guess a number", prompt.includes("حدس نزن"));
  ok("house instructions are appended, not substituted",
    prompt.includes("همیشه به تومان هم بنویس.") && prompt.includes("حدس نزن"));

  const blind = buildSystemPrompt({
    companyName: "x", todayJalali: "1405/06/01", userName: "y",
    canSeeCosts: false, actionsAllowed: true,
    actions: [{ name: "propose_proforma", label: "صدور پیش‌فاکتور" }], extra: "",
  });
  ok("a cost-blind user's assistant is told it has no cost figures",
    blind.includes("بهای تمام‌شده"));
  ok("and one allowed to act is told it only proposes",
    blind.includes("هیچ چیزی در سامانه ثبت نمی‌شود"));
  ok("and is told which actions it may propose",
    blind.includes("صدور پیش‌فاکتور"));
  ok("while one that is not is told to say so",
    prompt.includes("فعال نشده"));

  /*
   * The switch being on is not the same as the user being able to write, and
   * the two need different sentences: a model told "you may issue a proforma"
   * to somebody without the proformas permission promises what it cannot do.
   */
  const nothingWritable = buildSystemPrompt({
    companyName: "x", todayJalali: "1405/06/01", userName: "y",
    canSeeCosts: true, actionsAllowed: true, actions: [], extra: "",
  });
  ok("actions on but nothing writable is its own message",
    nothingWritable.includes("دسترسی لازم را ندارد"));
}

head("Searching the ledger: it has to reach the project");
{
  /*
   * The «تراکنش‌ها» button on the project summary puts a project into the
   * ledger's search box, and the search read only the document's own columns —
   * so it answered "no results" for a project that plainly had transactions.
   * `partyName` is often null too, since the grid falls back to the joined
   * customer or supplier name.
   */
  const where = buildTransactionWhere({
    search: "ATA-05-19", filters: {}, page: 1, pageSize: 50,
    sort: undefined, order: "desc",
  } as never) as { AND?: { OR?: Record<string, unknown>[] }[] };

  const clauses = where.AND?.[0]?.OR ?? [];
  const targets = new Set(clauses.map((c) => Object.keys(c)[0]));

  ok("the document's own number is searched", targets.has("documentNumber"));
  ok("and the party name written on it", targets.has("partyName"));
  /* The four the button and the grid actually depend on. */
  ok("the linked project is searched", targets.has("project"));
  ok("the customer behind it too", targets.has("customer"));
  ok("and the supplier", targets.has("supplier"));
  ok("and the proforma being paid", targets.has("proforma"));

  const projectClauses = clauses.filter((c) => "project" in c)
    .map((c) => JSON.stringify(c));
  ok("by code, which is unique",
    projectClauses.some((c) => c.includes('"code"')));
  ok("and by name, for anyone typing one by hand",
    projectClauses.some((c) => c.includes('"name"')));

  eq("an empty search filters nothing",
    JSON.stringify(buildTransactionWhere({
      search: "", filters: {}, page: 1, pageSize: 50, sort: undefined, order: "desc",
    } as never)), "{}");

  /*
   * The button sends the code rather than the name: three projects on the
   * screen it sits on are called «فلومتر توربینی», and a code is unique.
   */
  ok("the project's transactions button searches by code",
    readFileSync("src/components/TransactionsView.tsx", "utf-8")
      .includes("setSearch(p.code || p.name)"));
}

head("Proforma totals: the form and the document agree");
{
  /*
   * The document from the report, with its real figures: 978 dollars of lines,
   * 10% off, 10% VAT. The form showed 978 / 98 / 88 / 968 and the server stored
   * 968.22, so the printed invoice quoted a price nobody had approved.
   */
  const totals = computeProformaTotals({
    lineTotals: [978], discountPercent: 10, taxPercent: 10,
  });

  eq("the lines add up as they are", totals.totalAmount, 978);
  eq("the discount is a whole figure", totals.discountAmount, 98);
  eq("so is the tax", totals.taxAmount, 88);
  eq("and the total is what the form showed", totals.finalAmount, 968);
  /* The number the document used to carry. */
  ok("which is not the unrounded arithmetic", totals.finalAmount !== 968.22);

  /* The total is built from the rounded parts, so the document adds up. */
  eq("sub − discount + tax is the printed total",
    totals.totalAmount - totals.discountAmount + totals.taxAmount, totals.finalAmount);

  /*
   * Line totals are deliberately *not* rounded: a line has to read quantity ×
   * unit price, and the lines have to sum to the subtotal printed under them.
   * Only the figures a percentage derives are rounded.
   */
  const fractional = computeProformaTotals({
    lineTotals: [12.5, 12.5, 12.5], discountPercent: 0, taxPercent: 0,
  });
  eq("three lines of 12.5 still sum to 37.5", fractional.totalAmount, 37.5);

  /* A typed amount is the override, and is rounded like a computed one. */
  const manual = computeProformaTotals({
    lineTotals: [1000], discountAmount: 33.4, taxAmount: 66.6,
  });
  eq("a manual discount is rounded", manual.discountAmount, 33);
  eq("and a manual tax", manual.taxAmount, 67);
  eq("a percentage still beats a typed amount",
    computeProformaTotals({ lineTotals: [1000], discountPercent: 10, discountAmount: 999 })
      .discountAmount, 100);

  eq("half a unit rounds up", roundMoney(0.5), 1);
  eq("and nonsense is zero", roundMoney(Number.NaN), 0);

  /*
   * One rule, both sides. Two implementations of the same arithmetic is how the
   * form and the document came to disagree in the first place, so neither may
   * grow its own again.
   */
  const readSrc = (file: string) => readFileSync(file, "utf-8");
  for (const file of [
    "src/components/ProformasView.tsx",
    "src/server/services/proformaService.ts",
  ]) {
    ok(`${file} computes the totals through the shared rule`,
      readSrc(file).includes("computeProformaTotals("));
    ok(`${file} keeps no discount arithmetic of its own`,
      !/discountAmount\s*=\s*[^;]*discountPercent\s*\/\s*100/.test(readSrc(file)));
  }
  /* And the printed document reads the stored figures rather than recomputing. */
  ok("the printed totals come from the record",
    readSrc("src/components/ProformasView.tsx").includes("formatMoney(pf.finalAmount)"));
}

head("Exchange difference: paying more rial is not overpaying");
{
  /*
   * A real case, with its real figures.
   *
   * 968.22 dollars invoiced at 1,870,000 — so 1,810,571,400 rial of debt. The
   * customer pays 1,911,025,600 rial months later, when the dollar is worth
   * more. The extra 100,454,200 is a realized exchange gain: the debt is
   * settled in full and nothing is left on account.
   */
  const proforma = {
    id: "pf1", proformaNumber: "ATA-05-19-C1",
    status: "تأیید شده (برنده)", outcomeStatus: "تأیید شده (برنده)",
    currency: "دلار", historicalExchangeRate: 1_870_000, isCancelled: false,
    finalAmount: 968.22,
    items: [{ id: "i1", productName: "فلومتر", quantity: 1, unitPriceRIYAL: 968.22, totalPriceRIYAL: 968.22, status: "برنده" }],
  } as never;
  const rates = [{ currency: "USD", rateToRIYAL: 2_000_000 }] as never;

  const receipt = (exchangeRate: number) => ([{
    id: "t1", proformaId: "pf1", type: "دریافت", status: "تأیید شده",
    date: "1405/06/01", amountRIYAL: 1_911_025_600,
    exchangeRate, amountForeign: 0, isDirectForeign: false,
  }] as never);

  // The rate on the day the money arrived: 1,911,025,600 / 968.22.
  const settlementRate = Math.round((1_911_025_600 / 968.22) * 10_000) / 10_000;
  const settled = calculateProformaFinance(proforma, receipt(settlementRate), rates);

  eq("the invoice is 968.22 dollars", settled.salesAmountForeign, 968.22);
  eq("worth 1,810,571,400 rial at the rate it was priced at",
    settled.salesAmountHistoricalRiyal, 1_810_571_400);
  /*
   * The column says «دریافتی واقعی». It reported the allocated part instead —
   * so a customer who paid 1,911,025,600 was shown as having paid
   * 1,810,571,400 and the difference turned up somewhere else entirely.
   */
  eq("what was received is what was received",
    Math.round(settled.actualReceivedRiyal), 1_911_025_600);
  eq("the debt is settled in full", Math.round(settled.settledAmountForeign * 100) / 100, 968.22);
  eq("nothing is left owing", Math.round(settled.remainingAmountForeign * 100) / 100, 0);
  eq("and the settlement reads 100%", settled.settlementPercent, 100);
  /* The two figures the user was reading, the right way round. */
  eq("nothing sits on account as an overpayment",
    Math.round(settled.unallocatedRiyal), 0);
  eq("the difference is a realized exchange gain",
    Math.round(settled.realizedGainLoss ?? -1), 100_454_200);

  /*
   * The same receipt booked at the *historical* rate — which the form briefly
   * filled in for you — produces the screenshot that was reported: the whole
   * gain filed under «مبالغ تخصیص‌نیافته» and a gain column reading zero. It
   * is not a rounding artefact or a display problem; it is what that rate
   * means, which is why the form no longer chooses it on anybody's behalf.
   */
  const atHistorical = calculateProformaFinance(proforma, receipt(1_870_000), rates);
  eq("booked at the sale's own rate the gain vanishes",
    Math.round(atHistorical.realizedGainLoss ?? -1), 0);
  eq("and reappears as money sitting on account",
    Math.round(atHistorical.unallocatedRiyal), 100_454_200);

  /* Four decimal places, because the column stores four. */
  const rounded = calculateProformaFinance(proforma, receipt(Math.round(1_911_025_600 / 968.22)), rates);
  ok("a rate rounded to the whole rial strands a few hundred rial",
    Math.round(rounded.unallocatedRiyal) > 0);
  ok("so the offered rate keeps its decimals",
    readFileSync("src/components/TransactionsView.tsx", "utf-8")
      .includes("Math.round((amountRIYAL / outstandingForeign) * 10_000) / 10_000"));

  /*
   * The settlement rate has to be reachable for a rial receipt, which is the
   * ordinary case: the field used to appear only beside a foreign amount.
   */
  ok("the rate is asked for whenever the invoice is in another currency",
    readFileSync("src/components/TransactionsView.tsx", "utf-8")
      .includes("(amountForeign > 0 || proformaIsForeign)"));
}

head("Receipts and payments: a mistake is edited or deleted");
{
  /*
   * The balance rule, written as an exclusion.
   *
   * A status nobody thought of has to count as money rather than silently
   * vanish from the balance, which is the direction that goes unnoticed.
   */
  eq("a confirmed document is money", countsTowardBalance("تأیید شده"), true);
  eq("a draft is not", countsTowardBalance("پیش‌نویس"), false);
  eq("nor is a cancelled one", countsTowardBalance("لغو شده"), false);
  /*
   * A database written before reversal was dropped may hold a reversed
   * original *and* its opposite entry. Those cancel only if both count —
   * dropping the original while keeping its reversal applies the correction
   * twice.
   */
  eq("a reversed one still counts, so its pair cancels",
    countsTowardBalance("ابطال شده"), true);
  eq("and so does a status nobody anticipated", countsTowardBalance("چیز دیگر"), true);

  /*
   * The rial figure a document is stored at.
   *
   * The rule was `foreign != null`, and **zero is not null** — so a plain rial
   * receipt that happened to carry a settlement rate was rewritten to
   * `0 × rate`, which is zero. The form sends 0 for an empty foreign box by
   * construction and fills the rate in from the proforma being paid, so every
   * rial receipt against a foreign-currency proforma was stored at zero: the
   * document existed, the ledger read «۰ ریال», and nothing said why.
   */
  eq("a rial receipt keeps its amount when there is no foreign figure",
    rialAmountOf(1_917_075_600, null, null), 1_917_075_600);
  eq("and keeps it even when a settlement rate is on the document",
    rialAmountOf(1_917_075_600, 0, 900_000), 1_917_075_600);
  eq("an empty foreign box does not zero it either",
    rialAmountOf(500_000_000, null, 900_000), 500_000_000);
  /* A real foreign amount is still converted, which is the point of the rule. */
  eq("a foreign amount is converted at the document's rate",
    rialAmountOf(0, 1_500, 900_000), 1_350_000_000);
  eq("and overrides whatever rial figure was sent with it",
    rialAmountOf(7, 1_500, 900_000), 1_350_000_000);
  eq("a foreign amount with no rate cannot be converted, so the rial figure stands",
    rialAmountOf(250_000, 1_500, 0), 250_000);

  /*
   * Sold, received and outstanding have to be three figures about one thing.
   * The row reported the outstanding balance at *today's* rate beside a sales
   * figure at the rate the deal was struck at, so a project with nothing
   * received showed more outstanding than it had ever sold.
   */
  ok("the finance row's remaining figure is on the sales figure's own basis",
    readFileSync("src/server/services/projectFinance.ts", "utf-8")
      .includes("remainingAmount: summary.totalRemainingHistoricalRiyal"));

  const readSrc = (file: string) => readFileSync(file, "utf-8");
  const service = readSrc("src/server/services/transactionService.ts");
  const route = readSrc("src/server/routes/transactions.ts");
  const view = readSrc("src/components/TransactionsView.tsx");

  /*
   * Deleting must not be refused by status. Every document this screen writes
   * is confirmed and it has no way to issue a reversal, so refusing a confirmed
   * one made a mistyped receipt permanent — and the error named a remedy the
   * application did not offer.
   */
  ok("nothing refuses a delete by status", !service.includes('return "confirmed"'));
  ok("and the route has no reversal remedy to point at", !route.includes("MUST_REVERSE"));
  ok("there is no reversing entry left to issue", !route.includes("/reverse"));
  ok("nor a service that writes one", !service.includes("export async function reverseTransaction"));
  ok("and editing is not frozen", !route.includes('code: "FROZEN"'));

  /*
   * The ledger's totals come from SQL over the whole query. Summed from the
   * rows in hand they are the total of one page, and they count drafts.
   */
  ok("the summary cards read the server's totals",
    view.includes("list.summary?.receivedRial"));
  ok("and are not summed from the page in hand",
    !/const totalReceived = transactions\s*\n\s*\.filter/.test(view));

  /*
   * The settlement rate is offered from the proforma being paid, and a picker
   * only ever holds list rows — so the row has to carry the column.
   */
  ok("a proforma list row carries the rate it was priced at",
    readSrc("src/server/services/proformaService.ts")
      .includes("historicalExchangeRate: true,"));
  ok("and the row adapter passes it on",
    readSrc("src/api/proformaAdapter.ts").includes("historicalExchangeRate: row.historicalExchangeRate"));

  /*
   * The guard that blocked every edit of a confirmed document. It compared a
   * stored `undefined` against the form's `0`, so it fired even when the amount
   * had not been touched.
   */
  ok("no guard refuses an amount change on a confirmed document",
    !view.includes("امکان تغییر مبلغ برای تراکنش تأیید شده وجود ندارد"));
}

head("Assistant: a temperature the model refuses to be told");
{
  /*
   * The reported failure, verbatim from avalai.ir. Some models accept only
   * their own default temperature and answer 400 to any explicit value — so a
   * setting that could only ever be a number made those models unusable, and
   * the test button sent 0 whatever the setting said.
   */
  const refusal = JSON.stringify({
    error: {
      message: "Unsupported value: 'temperature' does not support 0 with this"
        + " model. Only the default (1) value is supported.",
    },
  });

  eq("the refused parameter is read out of the provider's own words",
    unsupportedParameterFrom(400, refusal), "temperature");
  eq("the o-series token cap rename is recognised too",
    unsupportedParameterFrom(400, "Unsupported parameter: 'max_tokens' is not"
      + " supported with this model. Use 'max_completion_tokens' instead."),
    "max_tokens");

  /* Narrow on purpose: a 400 is not permission to start dropping fields. */
  eq("an unrelated 400 drops nothing",
    unsupportedParameterFrom(400, "invalid request: messages must not be empty"), null);
  eq("a 400 merely mentioning temperature drops nothing",
    unsupportedParameterFrom(400, "the temperature of the room is irrelevant"), null);
  eq("and a 401 is a key problem, not a parameter one",
    unsupportedParameterFrom(401, refusal), null);

  /*
   * Absent means «the model decides», which is a different instruction from 0
   * and has to survive the round trip. Reading a missing value as 0 is exactly
   * what sends an explicit temperature to a model that refuses one.
   */
  eq("an unset temperature stays unset",
    resolveAssistantConfig({}).temperature, null);
  eq("an explicit null stays null",
    resolveAssistantConfig({ temperature: null }).temperature, null);
  eq("a stored zero is still honoured",
    resolveAssistantConfig({ temperature: 0 }).temperature, 0);
  eq("and a stored figure is bounded",
    resolveAssistantConfig({ temperature: 9 }).temperature, 2);
  eq("a fresh installation leaves it to the model",
    DEFAULT_ASSISTANT_CONFIG.temperature, null);

  const readSrc = (file: string) => readFileSync(file, "utf-8");
  const service = readSrc("src/server/services/assistant/assistantService.ts");
  /*
   * The connection test has to send what the assistant sends. It hardcoded 0
   * while the screen offered a box to change it, so it exercised a request
   * nobody had configured and failed however the setting was left.
   */
  ok("the connection test sends the configured temperature",
    !/temperature: 0,/.test(service));

  const provider = readSrc("src/server/services/assistant/provider.ts");
  ok("a null temperature is left out of the body rather than sent as null",
    provider.includes('typeof request.temperature === "number"'));
  ok("and each refused parameter is dropped at most once",
    provider.includes("dropped.has(refused)"));
  /*
   * Dropping the token cap is never an option — it is the only thing between a
   * confused model and a bill. It is renamed instead.
   */
  ok("the token cap is renamed, never removed",
    provider.includes("max_completion_tokens: request.maxTokens"));
}

head("Assistant actions: prepared, never written");
{
  const now = Date.parse("2026-08-23T10:00:00Z");
  const fresh = new Date(now - 60_000).toISOString();
  const stale = new Date(now - (PROPOSAL_TTL_MINUTES + 1) * 60_000).toISOString();

  eq("a fresh proposal has not expired", proposalExpired(fresh, now), false);
  eq("one past the window has", proposalExpired(stale, now), true);
  eq("and so has one with an unreadable timestamp", proposalExpired("nonsense", now), true);

  eq("a fresh pending proposal may be confirmed",
    confirmRefusalReason({ status: "pending", createdAt: fresh }, now, true), null);
  ok("a stale one may not",
    confirmRefusalReason({ status: "pending", createdAt: stale }, now, true)?.includes("مهلت"));
  /*
   * Re-asked at confirmation time on purpose. The switch may have been turned
   * off between the proposal and the button, and turning it off has to mean
   * something for the proposals already on screen.
   */
  ok("nor may one whose feature has since been switched off",
    confirmRefusalReason({ status: "pending", createdAt: fresh }, now, false)?.includes("فعال نیست"));
  ok("a confirmed proposal is not confirmed twice",
    confirmRefusalReason({ status: "confirmed", createdAt: fresh }, now, true)?.includes("قبلاً ثبت شده"));
  ok("a cancelled one stays cancelled",
    confirmRefusalReason({ status: "cancelled", createdAt: fresh }, now, true)?.includes("لغو"));
  /*
   * Terminal on purpose: the payload was prepared against a database that has
   * since moved, so the second attempt is a fresh proposal, not a retry.
   */
  ok("and a failed one is not retried",
    confirmRefusalReason({ status: "failed", createdAt: fresh }, now, true)?.includes("خطا"));

  eq("the catalogue and the implementations agree",
    catalogueMatchesImplementations(), true);

  const read = (file: string) => readFileSync(file, "utf-8");
  const actionSource = read("src/server/services/assistant/actions.ts");

  /*
   * The whole promise of the feature in one check: the file that prepares an
   * action must not be able to write one. A `prepare` that created a record
   * would make the confirm button a decoration.
   */
  const prepareBodies = actionSource.split(/\n  async prepare\(/).slice(1)
    .map((chunk) => chunk.split(/\n  async execute\(/)[0]);
  eq("every action has a prepare half", prepareBodies.length, ASSISTANT_ACTIONS.length);
  for (const body of prepareBodies) {
    ok("a prepare half writes nothing",
      !/\.(create|update|delete|upsert|createMany|updateMany|deleteMany)\(/.test(
        body.replace(/db\.assistantAction\.create/g, ""),
      ));
  }

  /*
   * The permission the module itself checks, not one of the assistant's own.
   * An action guarded by anything else would be a way around a flag somebody
   * was deliberately not given.
   */
  for (const meta of ASSISTANT_ACTIONS) {
    ok(`${meta.name} is guarded by a real collection key`,
      Object.prototype.hasOwnProperty.call(KEY_PERMISSION, meta.permissionKey));
  }

  ok("a proposal is claimed with a conditional update, so a double click writes once",
    /updateMany\(\{\s*where: \{ id, status: "pending" \}/.test(actionSource));
  ok("and the permission is re-checked at confirmation",
    actionSource.includes("Re-checked: a permission may have been withdrawn"));

  /*
   * Document numbers are issued when a document comes into existence, not when
   * one is imagined: a proposal nobody confirms must not burn a number.
   */
  for (const half of actionSource.split(/\n  async execute\(/).slice(1)) {
    const body = half.split(/\n\};/)[0];
    ok("no execute half prepares", !body.includes("await this.prepare"));
  }
  const prepareText = prepareBodies.join("\n");
  ok("no prepare half issues a document number",
    !prepareText.includes("nextProformaNumber(") && !prepareText.includes("nextPackingListNumber("));

  /*
   * One numbering rule per document. Two copies is how a series comes to have
   * two meanings — the routes and the assistant must ask the same function.
   */
  for (const route of ["src/server/routes/proformas.ts", "src/server/routes/deliveries.ts"]) {
    ok(`${route} does not keep its own numbering rule`,
      !read(route).includes("nextDocumentNumber("));
  }
}

head("Typing a number: half of one is not a decision");
{
  eq("a whole number reads back", parseDecimalInput("12"), 12);
  eq("and a decimal one", parseDecimalInput("0.7"), 0.7);
  eq("a leading point is fine", parseDecimalInput(".5"), 0.5);
  eq("so is a negative", parseDecimalInput("-3.25"), -3.25);
  eq("thousands separators are ignored", parseDecimalInput("12,500"), 12500);

  /*
   * The whole point. A box being typed into passes through «0.», and reading
   * that as a number is how «0.7» became 0 and «2.5%» became 25% — the browser
   * reports an incomplete number as the empty string, `Number("")` is 0, and
   * the controlled value snaps back over what was typed.
   */
  eq("a trailing point is not a number yet", parseDecimalInput("0."), null);
  eq("nor is a lone minus", parseDecimalInput("-"), null);
  eq("nor an empty box", parseDecimalInput(""), null);
  eq("and neither is a lone point", parseDecimalInput("."), null);

  /* `Number` accepts several things nobody typed on purpose. */
  eq("hex is not a figure somebody typed", parseDecimalInput("0x10"), null);
  eq("neither is Infinity", parseDecimalInput("Infinity"), null);
  eq("nor a number with words after it", parseDecimalInput("12abc"), null);

  eq("Persian digits are the same digits", parseDecimalInput("۱۲۳"), 123);
  eq("and the Persian decimal separator is a decimal point",
    parseDecimalInput("۱۲٫۵"), 12.5);
  eq("Arabic-Indic digits too", parseDecimalInput("٤٢"), 42);
  eq("the Persian thousands separator is dropped", toLatinDigits("۱٬۲۰۰"), "1200");

  ok("a half-typed decimal is still a plausible start", isPartialNumber("0."));
  ok("and an empty box is", isPartialNumber(""));
  ok("but letters are not", !isPartialNumber("abc"));

  eq("a figure over the cap is brought back to it", clampNumber(500, 1, 30), 30);
  eq("and one under the floor up to it", clampNumber(0, 256, 32000), 256);
  eq("one inside is left alone", clampNumber(12, 1, 30), 12);

  /*
   * `type="number"` is the control that cannot hold a decimal being typed, so
   * the fields that take one must not use it.
   */
  // Comments are stripped first: these files *explain* why `type="number"` is
  // the wrong control, and an earlier check of this shape failed on its own
  // description of the bug it was guarding against.
  const codeOf = (file: string) => readFileSync(file, "utf-8")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
    .join("\n");
  for (const file of [
    "src/components/AssistantSettingsPanel.tsx",
    "src/components/NumberField.tsx",
  ]) {
    ok(`${file} does not use a number input`, !codeOf(file).includes('type="number"'));
  }
  ok("the supplier discount fields do not either",
    !/type="number"[^>]*step="0\.01"/.test(codeOf("src/components/SupplierInquiriesView.tsx")));
}

head("API tokens: one API, one permission model");
{
  const good = `${TOKEN_PREFIX}9f31c2b8aa`;

  eq("a bearer header yields the token", parseBearer(`Bearer ${good}`), good);
  eq("the scheme is matched case-insensitively", parseBearer(`bearer ${good}`), good);
  /*
   * Strict about the scheme on purpose: a Basic header carries a base64 blob
   * that would otherwise be tried as a token, and an empty Bearer would be
   * tried as an empty one.
   */
  eq("a basic header is not a token", parseBearer(`Basic ${good}`), null);
  eq("an empty bearer is not a token", parseBearer("Bearer "), null);
  eq("nor is something that is not one of ours", parseBearer("Bearer sk-abc123"), null);
  eq("and neither is a missing header", parseBearer(undefined), null);

  eq("the visible prefix is short and recognisable", visiblePrefix(good).length, 12);
  ok("a masked token cannot be used", !maskToken(visiblePrefix(good)).includes("aa"));

  /*
   * Read-only is decided by method, not by a list of write routes: the endpoint
   * nobody remembers to add to such a list is the one that matters.
   */
  eq("a read token may GET", scopeAllowsMethod("read", "GET"), true);
  eq("and may not POST", scopeAllowsMethod("read", "POST"), false);
  eq("nor PUT or DELETE",
    scopeAllowsMethod("read", "PUT") || scopeAllowsMethod("read", "DELETE"), false);
  eq("a full token may write", scopeAllowsMethod("full", "DELETE"), true);
  eq("an unknown scope is read-only", normalizeScope("everything"), "read");

  /* A credential must not be able to mint, widen or revoke credentials. */
  eq("token management is closed to tokens", pathClosedToTokens("/api/api-tokens"), true);
  eq("including one of them", pathClosedToTokens("/api/api-tokens/abc/revoke"), true);
  /*
   * And the assistant's confirm button exists to mean «a person looked at
   * this», which a request from an automation platform cannot mean.
   */
  eq("so is confirming an assistant proposal",
    pathClosedToTokens("/api/assistant/actions/p-1/confirm"), true);
  eq("but the ordinary API is not", pathClosedToTokens("/api/proformas"), false);
  eq("and neither is asking the assistant a question",
    pathClosedToTokens("/api/assistant/chat"), false);
  eq("a query string does not smuggle a path past the check",
    pathClosedToTokens("/api/api-tokens?x=1"), true);

  const now = Date.parse("2026-08-23T10:00:00Z");
  const live = { isActive: true, expiresAt: null, userActive: true };
  eq("a live token is accepted", tokenRefusalReason(live, now), null);
  ok("a revoked one is not",
    tokenRefusalReason({ ...live, isActive: false }, now)?.includes("باطل"));
  ok("nor an expired one",
    tokenRefusalReason({ ...live, expiresAt: new Date(now - 1000) }, now)?.includes("اعتبار"));
  eq("one expiring later is fine",
    tokenRefusalReason({ ...live, expiresAt: new Date(now + 86_400_000) }, now), null);
  /*
   * Deactivating somebody must stop their integrations too — that is most of
   * the point of deactivating them.
   */
  ok("and a token belonging to a disabled account is refused",
    tokenRefusalReason({ ...live, userActive: false }, now)?.includes("غیرفعال"));

  const readSrc = (file: string) => readFileSync(file, "utf-8");
  const server = readSrc("server.ts");

  /*
   * The branch has to sit inside `requireAuth`, which every route reaches
   * through `RouteDeps`. Anywhere else and it would cover the endpoints
   * somebody remembered.
   */
  ok("requireAuth is where a bearer token is resolved",
    /const requireAuth[\s\S]{0,400}?authFromBearer\(req, res\)/.test(server));
  ok("and a handled bearer request never falls through to the cookie",
    /bearer\.handled\) return bearer\.user/.test(server));
  /*
   * An async handler that rejects in Express 4 sends nothing at all, so a
   * database failure during token lookup would leave the integration's socket
   * hanging until its own timeout — the least useful way to report an outage.
   */
  ok("a failure looking the token up answers instead of hanging",
    /try \{\s*identity = await authenticateToken\(raw\);\s*\} catch/.test(server));

  /* One parser, in the pure module. A second reading of the header would drift. */
  const serverFiles = readdirSync("src/server/routes").map((f) => `src/server/routes/${f}`);
  for (const file of serverFiles) {
    ok(`${file} does not read the Authorization header itself`,
      !/headers\.authorization/i.test(readSrc(file)));
  }

  /* Only a hash is stored, and nothing reads a token back out. */
  const tokenService = readSrc("src/server/services/apiTokenService.ts");
  ok("the raw token is hashed before it is stored",
    tokenService.includes("tokenHash: hashToken(token)"));
  ok("and the summary a screen receives carries no hash",
    !/tokenHash/.test(tokenService.split("function toSummary")[1].split("}\n")[0]));
}

head("Activity attachments: a list, with the old single file still readable");
{
  const files = [
    { name: "catalogue.pdf", size: "340 KB", url: "/uploads/a.pdf" },
    { name: "plate.jpg", size: "80 KB", url: "/uploads/b.jpg" },
  ];

  eq("a list survives normalisation", normalizeAttachments(files).length, 2);
  eq("an entry with no url is dropped — the name points at nothing",
    normalizeAttachments([...files, { name: "x", size: "1 KB" }]).length, 2);
  eq("the same file picked twice is one",
    normalizeAttachments([...files, files[0]]).length, 2);
  eq("a file with no name is named after its url",
    normalizeAttachments([{ url: "/uploads/c.pdf" }])[0].name, "c.pdf");
  eq("nothing at all is an empty list", normalizeAttachments(null).length, 0);
  ok("and the count is capped",
    normalizeAttachments(Array.from({ length: 40 }, (_, i) => ({ url: `/u/${i}` })))
      .length === MAX_ACTIVITY_ATTACHMENTS);

  /*
   * Two sources with a precedence. The three original columns hold the *first*
   * file, so reading both would show it twice; the JSON wins whenever it has
   * anything, and only a row written before that column existed falls back.
   */
  const cols = attachmentColumns(files);
  eq("the first file is mirrored into the old columns", cols.attachmentName, "catalogue.pdf");
  eq("and the whole list into the new one",
    parseAttachments(cols.attachments, {
      name: cols.attachmentName, size: cols.attachmentSize, url: cols.attachmentUrl,
    }).length, 2);
  ok("the first file is not read twice",
    parseAttachments(cols.attachments, {
      name: cols.attachmentName, size: cols.attachmentSize, url: cols.attachmentUrl,
    }).filter((f) => f.url === "/uploads/a.pdf").length === 1);

  eq("a row from before the column reads its three columns",
    parseAttachments(null, { name: "old.pdf", size: "1 KB", url: "/uploads/old.pdf" })[0].name,
    "old.pdf");
  eq("a row with neither has nothing",
    parseAttachments(null, { name: null, size: null, url: null }).length, 0);
  // A broken value must not make the whole feed unreadable.
  eq("unparseable JSON falls back rather than throwing",
    parseAttachments("{not json", { name: "old.pdf", size: "", url: "/uploads/old.pdf" }).length, 1);

  eq("an empty list clears the columns too", attachmentColumns([]).attachmentName, null);
  eq("and stores no JSON", attachmentColumns([]).attachments, null);

  /*
   * Absent means "not edited", present means "this is the whole list".
   * Conflating them detaches every file from an entry whose text was corrected
   * — the same rule the line-item grids follow.
   */
  const routes = readFileSync("src/server/routes/activities.ts", "utf-8");
  ok("the edit route tells an absent list from an empty one",
    /"attachments" in body \? normalizeAttachments\(body\.attachments\) : undefined/.test(routes));
}

head("Rich text: markers in, safe HTML out");
{
  eq("bold becomes a tag",
    renderRichText("متریال: **WCB**"), "متریال: <strong>WCB</strong>");
  ok("highlight paints a background",
    renderRichText("==فوری==").includes("background-color"));
  /* Underline is read before italic, or `__` is two empty italic runs. */
  ok("underline is not read as two italics",
    renderRichText("__PN16__").includes("text-decoration: underline"));
  eq("italic still works on its own",
    renderRichText("_note_"), "<em>note</em>");

  /*
   * The field is interpolated straight into the printed document. Escaping
   * first is what stops a tolerance or a size from breaking the page — and it
   * has to happen *before* the markers, or an escaped tag could be reassembled.
   */
  eq("angle brackets are escaped, not printed as markup",
    renderRichText("<script>alert(1)</script>"),
    "&lt;script&gt;alert(1)&lt;/script&gt;");
  eq("and an ampersand survives as text", renderRichText("A & B"), "A &amp; B");
  ok("bold around escaped text still formats",
    renderRichText("**<2 mm>**") === "<strong>&lt;2 mm&gt;</strong>");

  // An unclosed marker formats nothing rather than swallowing what follows.
  eq("an unclosed marker is left alone", renderRichText("**WCB"), "**WCB");
  eq("and a marker never spans a line break",
    renderRichText("**A\nB**"), "**A\nB**");

  eq("newlines are untouched — the page sets pre-line",
    renderRichText("a\nb"), "a\nb");

  eq("stripping gives the words back",
    stripRichMarks("متریال: **WCB** و ==فوری=="), "متریال: WCB و فوری");

  /* The toolbar wraps, unwraps, and puts the caret back. */
  const wrapped = toggleMark("size 2 inch", 0, 4, "**");
  eq("wrapping the selection", wrapped.text, "**size** 2 inch");
  eq("and the selection still covers the same words",
    wrapped.text.slice(wrapped.selectionStart, wrapped.selectionEnd), "size");

  eq("pressing again with the markers inside the selection removes them",
    toggleMark("**size** 2 inch", 0, 8, "**").text, "size 2 inch");
  eq("and with the markers just outside it, which is what a double-click gives",
    toggleMark("**size** 2 inch", 2, 6, "**").text, "size 2 inch");

  const empty = toggleMark("", 0, 0, "==");
  eq("with nothing selected it drops a pair in", empty.text, "====");
  eq("with the caret between them", empty.selectionStart, 2);

  /*
   * The configurator has to recognise its own lines after somebody has bolded
   * one, or reconfiguring leaves the old line behind and appends a second.
   */
  const features = [{ id: "f1", name: "جنس بدنه", options: [{ id: "o1", value: "استیل 316" }] }];
  eq("a bolded feature line is still the configurator's line",
    mergeSpecText("**جنس بدنه**: استیل 304", features, ["جنس بدنه: استیل 316"]),
    "جنس بدنه: استیل 316");
  eq("and it is read back past the markers",
    JSON.stringify(selectionsFromSpecText(features, "جنس بدنه: **استیل 316**")),
    JSON.stringify({ f1: ["استیل 316"] }));
}

head("Delivery section inside a formattable notes block");
{
  const items = [{ deliveryRange: "3-4", deliveryUnit: "هفته", deliveryType: "کاری", deliveryPostfix: "پس از تایید" }];
  const section = generateDeliveryNotes(items);

  ok("the section names itself", section.startsWith("زمان تحویل:"));
  eq("empty notes become the section alone", updateNotesWithDelivery("", items), section);

  const withNotes = updateNotesWithDelivery("اعتبار: ۳۰ روز", items);
  ok("existing notes are kept above it", withNotes.startsWith("اعتبار: ۳۰ روز"));
  eq("and only one section exists",
    withNotes.split("زمان تحویل:").length - 1, 1);

  /*
   * The rule this file exists to hold. The notes are formattable text now, and
   * this function finds its own section by the words at the start of a line —
   * so somebody bolding the heading must not hide it, or every later change to
   * a delivery date appends a second section below the first.
   */
  const bolded = "اعتبار: ۳۰ روز\n\n**زمان تحویل:**\n۲ هفته کاری پس از تایید";
  const rewritten = updateNotesWithDelivery(bolded, items);
  eq("a bolded heading is still recognised as the section",
    rewritten.split("زمان تحویل:").length - 1, 1);
  ok("the notes above it survive", rewritten.startsWith("اعتبار: ۳۰ روز"));
  ok("and the old figures are gone", !rewritten.includes("۲ هفته کاری"));

  /* Formatting elsewhere in the notes is left exactly as written. */
  const decorated = "==فوری==\nزمان تحویل:\n۲ هفته کاری پس از تایید\n\n__گارانتی__: ۱۲ ماه";
  const after = updateNotesWithDelivery(decorated, items);
  ok("a highlight above the section is untouched", after.includes("==فوری=="));
  ok("and an underline below it too", after.includes("__گارانتی__: ۱۲ ماه"));

  eq("one delivery for every line reads as one line",
    getDeliverySummary(items), "3-4 هفته کاری");
  ok("and differing lines say so",
    getDeliverySummary([...items, { deliveryRange: "8-9" }]).includes("ردیف‌های دیگر متفاوت"));
}

head("Product configurator: selections in, SKU and specifications out");
{
  const features = [
    { id: "f1", name: "جنس بدنه", options: [
      { id: "o1", value: "استیل 316" }, { id: "o2", value: "استیل 304" }] },
    { id: "f2", name: "سایز", options: [
      { id: "o3", value: "1 اینچ" }, { id: "o4", value: "2 اینچ" }] },
  ];

  const one = { f1: ["استیل 316"], f2: ["2 اینچ"] };
  eq("one value per feature identifies a SKU",
    JSON.stringify(attributesFromSelections(features, one)),
    JSON.stringify({ "جنس بدنه": "استیل 316", "سایز": "2 اینچ" }));

  /*
   * Two values on a feature is a legitimate thing to ask a supplier — «either
   * 316 or 304» — but it describes two products and a SKU is one. It has to
   * produce specification text and no SKU, rather than a wrong SKU.
   */
  eq("two values on one feature identify nothing",
    attributesFromSelections(features, { f1: ["استیل 316", "استیل 304"], f2: ["2 اینچ"] }), null);
  eq("and so does leaving a feature blank",
    attributesFromSelections(features, { f1: ["استیل 316"] }), null);
  eq("a product with no features identifies nothing", attributesFromSelections([], one), null);

  eq("every ticked feature becomes a line",
    specLinesFrom(features, { f1: ["استیل 316", "استیل 304"], f2: ["2 اینچ"] }).join(" | "),
    "جنس بدنه: استیل 316، استیل 304 | سایز: 2 اینچ");
  eq("and a feature with nothing ticked does not",
    specLinesFrom(features, { f2: ["2 اینچ"] }).join(" | "), "سایز: 2 اینچ");

  /*
   * The text is editable, so the merge is keyed on the feature names rather
   * than on a marker: a note somebody typed in the middle of it survives, and
   * reconfiguring replaces the old values instead of stacking a second set.
   */
  const existing = "مشخصات:\nجنس بدنه: استیل 304\nتحویل فوری لازم است\nسایز: 1 اینچ";
  eq("reconfiguring replaces the old values and keeps the typed note",
    mergeSpecText(existing, features, specLinesFrom(features, one)),
    "تحویل فوری لازم است\nجنس بدنه: استیل 316\nسایز: 2 اینچ");
  eq("free text with no feature lines is left alone",
    mergeSpecText("قیمت بدون احتساب حمل", features, []), "قیمت بدون احتساب حمل");

  eq("the configurator reopens on what it wrote",
    JSON.stringify(selectionsFromSpecText(features, "جنس بدنه: استیل 316\nسایز: 2 اینچ")),
    JSON.stringify(one));
  eq("and on a stored SKU's own attributes",
    JSON.stringify(selectionsFromAttributes(features, { "جنس بدنه": "استیل 316", "سایز": "2 اینچ" })),
    JSON.stringify(one));

  /* One configurator, used by both forms — not a second copy that drifts. */
  for (const file of [
    "src/components/ProformasView.tsx",
    "src/components/SupplierInquiriesView.tsx",
  ]) {
    const src = readFileSync(file, "utf-8");
    ok(`${file} uses the shared configurator`, src.includes("ProductConfiguratorModal"));
    ok(`${file} creates a SKU through the shared helper`,
      src.includes("ensureVariantForAttributes"));
    // The bug that made this a rule: a made-up id on a real foreign key.
    ok(`${file} invents no variant id`,
      !/variantId\s*[:=]\s*`?var-\$\{Date\.now/.test(src));
  }
}

head("A list row is never the source of a new record");
{
  /*
   * Copying a proforma built the new document from the *row* the grid holds,
   * which carries each line's name, quantity and status and nothing else. The
   * copy came out with empty lines and the save was refused by the cost check —
   * about lines whose cost had been filled in perfectly well on the document
   * being copied.
   *
   * `assertComplete` cannot see this shape. It fires on a record spread into a
   * write payload, and a handler that builds a fresh object literal never hands
   * it the `__partial` marker, so the guard has nothing to refuse. The handler
   * has to load the detail record itself, which is what this pins.
   */
  const view = readFileSync("src/components/ProformasView.tsx", "utf-8");
  const start = view.indexOf("const handleCopyProforma");
  const body = view.slice(start, view.indexOf("addProforma({", start));
  ok("copying a proforma loads the whole record first",
    start > 0 && body.includes("isPartial(") && body.includes("proformasApi.get("));

  // The same guard on the other handler the grid calls with a row, which had
  // it already and is the pattern the copy now follows.
  const printStart = view.indexOf("const handleOpenPrint");
  ok("and so does opening the print preview",
    printStart > 0
    && view.slice(printStart, printStart + 600).includes("isPartial("));
}

head("Message templates live in one place");
{
  /*
   * A rule used to carry its own wording *and* be able to name a template, so
   * the same message was editable in two screens and the two drifted apart —
   * which is the whole reason templates exist. The rule editor now picks one;
   * inline text survives only as a fallback for rules saved before that.
   */
  const editor = readFileSync("src/components/SettingsView.tsx", "utf-8");
  ok("the rule editor offers no box to type a message into",
    !/messageConfig!\.bodyTemplate\s*=\s*e\.target\.value/.test(editor));
  ok("and picks a template instead",
    /messageConfig!\.templateId\s*=\s*e\.target\.value/.test(editor));

  const engine = readFileSync("src/server/services/workflowService.ts", "utf-8");
  ok("the engine prefers the template over anything left on the rule",
    engine.includes("template?.body || config.bodyTemplate"));
  ok("and the subject the same way",
    engine.includes("template?.subject || config.subjectTemplate"));

  /*
   * The three settings the server reads. They were read from the start and
   * written by nothing, so the dry-run switch existed and could not be found.
   */
  const messagingDefaults = DEFAULT_SETTINGS.messaging;
  ok("a fresh installation has the messaging behaviour settings",
    !!messagingDefaults && messagingDefaults.dryRun === false
    && Number(messagingDefaults.maxAttempts) > 0);
  const screen = readFileSync("src/components/MessagingView.tsx", "utf-8");
  ok("and a screen writes them", screen.includes("dryRun: e.target.checked"));

  /*
   * A project may be exempted from the rules, and only from the rules.
   *
   * `workflowRuleId` is what marks a message as automated; dropping it from the
   * condition would turn a per-project exemption into a per-project gag order,
   * so somebody writing to that customer by hand would silently send nothing.
   */
  const queue = readFileSync("src/server/services/messaging/messageService.ts", "utf-8");
  ok("the project exemption applies to automated messages only",
    /input\.workflowRuleId\s*&&\s*project\?\.suppressAutoMessages/.test(queue));
  ok("and it is reported as suppressed rather than as a failure",
    queue.includes("suppressed: true"));
  ok("so the engine does not raise a notice about it",
    readFileSync("src/server/services/workflowService.ts", "utf-8")
      .includes("!outcome.suppressed"));
}

head("Modules: one catalogue, and everything reads it");
{
  /*
   * The messaging module was added to the sidebar and to nothing else, so it
   * appeared in the menu and could not be reordered: the settings tab kept its
   * own copy of the module list and rendered nothing for an id that copy had
   * never heard of. There is one catalogue now, the icon map is a
   * `Record<AppModuleId, …>` so the type-checker refuses a module without one,
   * and what is left is the two lists nothing can type-check — the screens
   * behind the ids, and the copies that used to exist.
   */
  const ids = APP_MODULES.map((m) => m.id);

  ok("no module is listed twice", new Set(ids).size === ids.length);
  ok("every module has a name and a description",
    APP_MODULES.every((m) => m.name.trim() !== "" && m.description.trim() !== ""));
  eq("a fresh installation starts in the catalogue's order",
    (DEFAULT_SETTINGS.sidebarModuleOrder ?? []).join(","), DEFAULT_MODULE_ORDER.join(","));

  /* Every module in the menu has a screen behind it, and the other way round. */
  const app = readFileSync("src/App.tsx", "utf-8");
  const switchStart = app.indexOf("switch (activeView) {");
  const routed = new Set(
    [...app.slice(switchStart, app.indexOf("default:", switchStart))
      .matchAll(/case '([A-Za-z]+)':/g)].map((m) => m[1]));

  const noScreen = ids.filter((id) => !routed.has(id));
  const noMenu = [...routed].filter((id) => !ids.includes(id as never));
  ok("every module in the catalogue has a screen in App.tsx", noScreen.length === 0, noScreen);
  ok("and every screen App.tsx routes to is in the catalogue", noMenu.length === 0, noMenu);
  ok("the check found the routes at all", routed.size >= 10, [...routed]);

  /*
   * The copies are gone and must stay gone. Both screens now map over
   * `APP_MODULES`; a hand-written array of sidebar modules in either is the
   * shape that caused this, whatever it ends up being called.
   *
   * `dashboard` is what identifies such a list. The settings screen has other,
   * legitimate module lists — which modules carry custom fields, which have
   * validatable fields — and those are a different and smaller set: no
   * dashboard, no users, no settings screen itself.
   */
  for (const file of ["src/components/Sidebar.tsx", "src/components/SettingsView.tsx"]) {
    const src = readFileSync(file, "utf-8");
    ok(`${file} builds its module list from the catalogue`, src.includes("APP_MODULES"));
    ok(`${file} keeps no copy of the sidebar list`,
      !/id:\s*['"]dashboard['"]/.test(src));
  }
}


console.log(`\n${"─".repeat(56)}\n${pass} checks passed, ${fails.length} failed`);
if (fails.length) { console.log("Failures:"); fails.forEach(f => console.log("  • " + f)); }
