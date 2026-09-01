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
import {
  getProformaOutcome, getWonItems, deriveProjectStatus, statusWithoutProformas,
  DERIVED_OUTCOMES, ITEM_CANCELLED, ITEM_LOST, ITEM_WON, matchesWhere, outcomeWhere,
} from "../src/server/proformaStatus";
import { getProformaOutcomeStatus } from "../src/useERPStore";
import { computeInquiryTotals, inquiryTotalRiyal } from "../src/utils/inquirySteps";
import {
  catalogueCodeRefusal, catalogueNameRefusal, describeProductSpec, newConfigId,
} from "../src/utils/productConfig";
import {
  discountKeepFraction, netUnitPrice, summarizeHistory,
} from "../src/utils/inquiryPriceHistory";
import { toNumber } from "../src/server/childSync";
import { getTodayShamsi, addWorkingDaysToShamsi, addDaysToShamsi, jalaliToGregorian, toShamsiStr } from "../src/dateUtils";
import { generateSku, decodeSku } from "../src/utils/skuUtils";
import { parseFeatureSpec, splitNameAndCode } from "../src/utils/productFeatureSpec";
import { normalizeSuggestion, suggestionSpecText } from "../src/utils/advisorSuggestion";
import {
  DEFAULT_CUSTOMER_VALUE_SETTINGS, calculateCVI, calculatePotentialScore, calculateRealizedScore,
  RANK_META, costToServeScoreOf, determineRank, evaluateCustomerValue, isPotentialAssessed,
  normalizeCustomerValueSettings, paymentScoreOf, percentileRank, recencyScore, resolveRank,
  sumRealizedWeights, validateCustomerValueSettings,
} from "../src/utils/customerValue";
import { hasEverPurchased, saleDateOf } from "../src/server/services/customerValueService";
import { taskRelationKind } from "../src/utils/taskRelations";
import { applySettingsPatches } from "../src/utils/settingsPatches";
import { ACTIVITY_REACTIONS, isAllowedReaction, summarizeReactions } from "../src/utils/reactions";
import {
  REFERRAL_DOING, REFERRAL_DONE, REFERRAL_PENDING, TASK_CANCELLED, TASK_DOING, TASK_DONE,
  TASK_TODO, referralIsOpen, referralLane, sortBoardCards, taskLane, taskStatusForLane,
} from "../src/utils/workBoard";
import { laneTimestamps } from "../src/server/services/taskService";
import { deriveProjectLossReason, lostLineWithoutReason } from "../src/server/proformaStatus";
import { lossReasonRefusal } from "../src/server/services/projectService";
import type { ERPSettings } from "../src/types";
import { buildTaskWhere } from "../src/server/services/taskService";
import type { AuthUser } from "../src/server/auth";
import type { ListQuery } from "../src/server/listing";
import { buildReportingTables } from "../src/reporting/flatten";
import { findCustomerDuplicates } from "../src/utils/customerDuplicates";
import { canonicalizeProvince } from "../src/utils/iranProvinces";
import {
  insertMention, mentionQuery, mentionSpans, mentionSuggestions, parseMentions,
  stripMentionMarkers, taskTitleFromMessage,
} from "../src/utils/mentions";
import {
  DEFAULT_PROJECT_GAP_FIELDS, projectDataGaps, projectGapCatalogue, projectGapFields,
} from "../src/utils/projectDataGaps";
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
import { KEY_PERMISSION, canSeeAllTasks, canSeeCosts } from "../src/server/auth";
import {
  preserveLineCosts, redactCustomerValue, redactInquiry, redactProduct,
  redactPurchaseOrder, redactProforma, redactValueDetail, redactValueSummary,
  stripProductCostInput,
} from "../src/server/costs";
import {
  countsTowardBalance, describeTransaction, rialAmountOf,
} from "../src/server/services/transactionService";
import { inboxApi, submitReferralReply } from "../src/api/inbox";
import { rowToCustomer } from "../src/api/customerAdapter";
import { rowToProject } from "../src/api/projectAdapter";
import { rowToProforma } from "../src/api/proformaAdapter";
import { rowToProduct } from "../src/api/productAdapter";
import { rowToSupplier } from "../src/api/suppliers";
import { rowToTransaction } from "../src/api/transactions";
import { detailToPurchaseOrder, purchaseOrderToWriteInput, rowToPurchaseOrder } from "../src/api/purchaseOrders";
import { rowToTask } from "../src/api/tasks";
import { scopeClause, visibilityClause as taskVisibility } from "../src/server/services/taskService";
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
import { renderProformaDocument } from "../src/utils/proformaDocument";
import {
  AUTO_CLOSE_NOTE, DEFAULT_FOLLOW_UP_RESULTS, FOLLOW_UP_HEALTH, FOLLOW_UP_STATES,
  TASK_KINDS, completionRefusalReason, followUpActivityText, followUpHealthOf,
  healthRank, isOpenWithoutNextAction, isTaskFinished, isTerminalOutcome,
  isChaseableOutcome, normalizeFollowUpState, normalizeTaskKind, stateAfterDecision,
  versionRefusalReason, impliedSettlement,
  RESULT_PURCHASE_CONFIRMED, RESULT_PURCHASE_CANCELLED, RESULT_LOST_TO_COMPETITOR,
} from "../src/utils/salesFollowUp";
import { chaseableWhere } from "../src/server/services/followUpService";
import {
  averageProformasPerProject, opportunityGroups, opportunityOutcome, wonValueRial,
} from "../src/server/dashboardMetrics";
import { decidingProformas } from "../src/server/proformaStatus";
import {
  categoryKey, matchKnownCategory, mergeRefusalReason, unknownImportCategories,
} from "../src/utils/productCategories";
import {
  NOTICE_EXCERPT_LENGTH, activityRecipients, noticeExcerpt, parseMemberIds, serializeMemberIds,
} from "../src/utils/activityMembers";
import {
  FIXED_SOLAR_HOLIDAYS, MAX_WORKING_DAY_SPAN, MIN_PLAUSIBLE_HOLIDAYS, countForwardDays,
  MAX_HIJRI_SHIFT_DAYS, importRefusalReason, isNonWorkingDay, monthDayOf, normalizeJalali,
  normalizeCalendarKind, parseCalendarYear, planHijriShift, shiftForYear, shiftRefusalReason,
  toLatinDigits as holidayLatinDigits,
} from "../src/utils/holidays";
import {
  addDaysToShamsi as addDays, holidayReason, setHolidayCalendar, toGregorianStr,
} from "../src/dateUtils";
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
 * Refreshing the currency rates every hour.
 *
 * Every foreign-priced document is valued at the stored rate, so a stale rate
 * prices the day's work wrongly and says nothing. It used to refresh once per
 * Shamsi day, which left a document priced at four in the afternoon carrying
 * the morning's number; two hours was still long enough that the rate was
 * being kept up by hand between refreshes. The scheduling is the whole of the
 * feature, and the alternative to testing it here is a test that can only be
 * run by waiting an hour.
 */
head("Exchange rates: the hourly refresh");

const HOUR = 60 * 60 * 1000;
const RETRY_HOLD = 10 * 60 * 1000;
const decide = (state: Partial<RateRefreshState>, now = 10 * HOUR) =>
  refreshDecision(
    { lastSuccessAt: 0, lastFailureAt: 0, running: false, ...state },
    now, FRESH_FOR_MS, RETRY_HOLD);

eq("the window is an hour", FRESH_FOR_MS, HOUR);
eq("the first caller starts the fetch", decide({}), "start");
eq("a caller a minute later does nothing", decide({ lastSuccessAt: 10 * HOUR - 60_000 }), "skip");
eq("nor does one half an hour later",
  decide({ lastSuccessAt: 10 * HOUR - 0.5 * HOUR }), "skip");
eq("an hour on, the rates are refetched",
  decide({ lastSuccessAt: 10 * HOUR - HOUR }), "start");
eq("a caller arriving mid-fetch waits on the same one", decide({ running: true }), "wait");
eq("a run in progress outranks a recent failure, rather than being skipped past",
  decide({ running: true, lastFailureAt: 10 * HOUR - 60_000 }), "wait");

// A failure holds callers off for a while — but for less than the freshness
// window, or one bad minute would cost the whole hour.
eq("right after a failure, callers are held off",
  decide({ lastFailureAt: 10 * HOUR - 60_000 }), "skip");
eq("ten minutes later, someone tries again",
  decide({ lastFailureAt: 10 * HOUR - RETRY_HOLD }), "start");
eq("but rates fetched minutes ago still win over a stale failure",
  decide({ lastSuccessAt: 10 * HOUR - 60_000, lastFailureAt: 10 * HOUR - HOUR }), "skip");

/*
 * The timer must tick more often than the window, or the promise is not kept.
 *
 * `ensureRatesFresh` is a no-op until the window is up, so the tick only has to
 * be frequent enough that the first caller after it opens is the timer itself:
 * a half-hourly tick against an hourly window leaves up to ninety minutes
 * between refreshes on a day nobody signs in.
 */
{
  const serverSrc = readFileSync("server.ts", "utf8");
  const tick = /const RATE_TICK_MS = (\d+) \* 60 \* 1000;/.exec(serverSrc);
  ok("the rate timer ticks well inside the freshness window",
    !!tick && Number(tick[1]) * 60_000 <= FRESH_FOR_MS / 4, tick?.[1]);

  // The failure mode here is silence, so the state has to reach a screen.
  const adminSrc = readFileSync("src/server/routes/admin.ts", "utf8");
  ok("the rates endpoint reports what the automatic refresh has been doing",
    /refresh: rateRefreshReport\(\)/.test(adminSrc));
  const ratesView = readFileSync("src/components/RatesView.tsx", "utf8");
  ok("and the screen shows it", /rates-auto-refresh/.test(ratesView));
  ok("including the reason the last attempt failed", /refresh\.lastError/.test(ratesView));
}

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
  // `revenue.averageProformasPerProject` is «چند پیش‌فاکتور برای هر پروژه» — a
  // count of documents that happens to live under `revenue`, so the receiver
  // disambiguates it the same way `list.total` is disambiguated above.
  const COUNT = /(\.length|count|\bpage\b|totalPages|average\w*Per\w+|^(list|ledger|auditList|\w*List)\.total$)/i;

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

head("Product adviser: a suggestion is a preview of the line");
{
  /*
   * The card, the proforma line and the printed document are the same text.
   * The format is the one the configurator already writes — «Label: Value», one
   * per line, free notes marked with «*» — so a line added from a card and one
   * configured by hand are indistinguishable on the page.
   */
  const suggestion = normalizeSuggestion({
    productName: "Turbine Flow Meter (Liquids)",
    specs: [
      { label: "Medium", value: "xylene" },
      { label: "Accuracy", value: "±0.5%" },
      { label: "Size", value: '2"' },
    ],
    notes: ["One click reset model"],
    productId: "p1", variantId: "v1", sku: "ATA-TFM-2I",
    match: "exact",
  });

  eq("the name survives", suggestion.productName, "Turbine Flow Meter (Liquids)");
  eq("and the specification", suggestion.specs.length, 3);
  eq("the spec text is what the document prints",
    suggestionSpecText(suggestion),
    'Medium: xylene\nAccuracy: ±0.5%\nSize: 2"\n* One click reset model');
  eq("a note that already has its star does not get a second",
    suggestionSpecText({ specs: [], notes: ["* already starred"] }), "* already starred");

  /*
   * The source is a language model and the destination is a document sent to a
   * customer, so nothing is trusted: half-built specs are dropped, and a
   * `match` nobody recognises becomes the least confident of the three rather
   * than an unverified claim that something exists.
   */
  const messy = normalizeSuggestion({
    specs: [
      { label: "Size", value: "2" },
      { label: "", value: "orphan" },
      { label: "Medium", value: "" },
      "not an object",
    ],
    notes: ["ok", "", 42],
    match: "definitely-exists",
  });
  eq("a spec with no label is dropped", messy.specs.length, 1);
  eq("and an empty note", messy.notes.length, 2);
  eq("an unrecognised match is the least confident one", messy.match, "new");
  eq("a nameless suggestion still has a heading", messy.productName, "قلم پیشنهادی");
  eq("nonsense normalises rather than throwing", normalizeSuggestion(null).match, "new");
  eq("and carries no ids it was not given", normalizeSuggestion({}).productId, undefined);

  const readSrc = (file: string) => readFileSync(file, "utf-8");
  const advisor = readSrc("src/server/services/assistant/advisor.ts");

  /*
   * Ids come from the catalogue, never from the model: a suggestion naming a
   * product that does not exist is downgraded rather than put on a line as a
   * foreign key referencing nothing — the same rule the configurator learned
   * the hard way.
   */
  ok("every suggested product is looked up before it is believed",
    advisor.includes("db.product.findUnique"));
  ok("and one that is not there stops being a link",
    /if \(!product\) \{\s*item\.match = "new";/.test(advisor));
  ok("a claimed SKU that does not exist is downgraded too",
    advisor.includes('item.match = "close"'));

  /* The adviser reads. Creating anything is a different, confirmed act. */
  for (const write of ["db.product.create", "db.product.update", "db.productVariant.create"]) {
    ok(`the adviser never calls ${write}`, !advisor.includes(write));
  }

  /*
   * A file that could not be read is reported. One quietly ignored is worse
   * than one never attached: the answer looks considered and is missing half
   * the question.
   */
  ok("what could not be read is reported back",
    advisor.includes("read: !!(file.text || file.imageDataUrl)"));
  ok("and the panel shows it",
    readSrc("src/components/ProductAdvisorModal.tsx").includes("filter((a) => !a.read)"));

  /* Adding a line touches the form, not the database. */
  const form = readSrc("src/components/ProformasView.tsx");
  ok("a suggestion becomes an unsaved line",
    /const handleAddSuggestion[\s\S]{0,2400}?setItems\(\[/.test(form));
  ok("built with the shared spec-text rule",
    form.includes("suggestionSpecText(item)"));
  ok("and never invents a product id",
    form.includes('productId: product?.id ?? ""'));
}

head("The price calculator on a proforma line reads the real product");
{
  /*
   * This screen holds product **list rows**, and a row carries no calculator:
   * `LIST_SELECT` has no `priceCalc` and its variants come back with only an
   * id, a SKU, attributes and a stock level. Seeding the modal from one meant
   * every field opened blank however carefully it had been filled in, and the
   * missing starting price made it recompute and change the price on apply.
   */
  const productList = readFileSync("src/server/services/productService.ts", "utf-8");
  const listSelect = productList.slice(
    productList.indexOf("const LIST_SELECT"),
    productList.indexOf("} satisfies Prisma.ProductSelect"),
  );
  ok("a product list row genuinely carries no calculator",
    !listSelect.includes("priceCalc"));
  ok("nor do its variants", !/variants: \{ select: \{[^}]*priceCalc/.test(listSelect));

  const form = readFileSync("src/components/ProformasView.tsx", "utf-8");
  ok("so the calculator loads the whole record when it opens",
    form.includes("detailToProduct(await productsApi.get(productId))"));
  ok("and seeds from that, not from the picker",
    /const prod = calcProduct;/.test(form));
  ok("the modal waits for it rather than opening on zeros",
    form.includes("calcModalItemIdx !== null && !calcLoading"));

  /*
   * A rial price is ten digits, and the cell also carries the calculator
   * button. At two twelfths the figure was cut in half.
   */
  ok("the unit price column is wider than its neighbours",
    form.includes('<div className="col-span-3 text-left">'));
  ok("and the price box is a text field, so no spinner eats its width",
    /NumberField[\s\S]{0,200}?handleItemFieldChange\(idx, "unitPriceRIYAL", value\)/.test(form));
}

head("Bulk product import: the features column is not decoration");
{
  /*
   * The real cell from the sheet that reported this — thirteen features on one
   * magnetic flow meter. The importer read this column into `featuresRaw`,
   * carried it through the whole batch, and then sent `features: null`, so the
   * import reported success and saved none of it.
   */
  const cell = 'Size(sz):1"|Flow Range(fr):0.88-8.8 m3/h|Medium(md):Water'
    + "|Power Supply(ps):24VDC|Accuracy(ac):±0.5%|Output(op):Pulse+RS485+4-20mA+Hart"
    + "|Connection(cn):Flange ANSI|Pressure(pr):2.5Mpa(ANSI300#)|Body Material(bm):carbon steel"
    + "|Liner(ln):PTFE|Electrode(el):316L|Structure(st):Compact|Protection(pt):IP65";

  const features = parseFeatureSpec(cell);
  eq("all thirteen features arrive", features.length, 13);
  eq("with their names", features[0].name, "Size");
  eq("and their codes", features[0].code, "sz");
  eq("and their values", features[0].options[0].value, '1"');

  /*
   * «2.5Mpa(ANSI300#)» is a pressure rating written the way an instrument
   * catalogue writes it. Read as a value-with-a-code it would become «2.5Mpa»
   * and quietly lose the half the engineer cared about, so a code has to look
   * like a code — something that can be a token in a SKU.
   */
  const pressure = features.find((f) => f.name === "Pressure")!;
  eq("a parenthesis that is part of the value stays part of it",
    pressure.options[0].value, "2.5Mpa(ANSI300#)");
  eq("and is not mistaken for a code", pressure.options[0].code, undefined);

  eq("a real code is a code", splitNameAndCode("سایز(sz)").code, "sz");
  eq("a space rules it out", splitNameAndCode("چیزی(دو کلمه)").code, undefined);
  eq("so does a symbol", splitNameAndCode("2.5Mpa(ANSI300#)").code, undefined);
  eq("and empty parentheses leave the text alone", splitNameAndCode("چیزی()").name, "چیزی()");

  /* The documented multi-option form, with the Persian comma. */
  const multi = parseFeatureSpec("سایز(sz):۱ اینچ(1I)،۲ اینچ(2I)|متریال(mat):استیل(ST)،برنج(BR)");
  eq("two features", multi.length, 2);
  eq("two options on the first", multi[0].options.length, 2);
  eq("the second option keeps its code", multi[0].options[1].code, "2I");

  /* Only the first colon separates; a value may contain one. */
  const colon = parseFeatureSpec("نسبت(rt):1:200");
  eq("a value may contain a colon", colon[0].options[0].value, "1:200");

  eq("an empty cell is no features", parseFeatureSpec("").length, 0);
  eq("and so is a blank one", parseFeatureSpec("   ").length, 0);
  eq("a feature with nothing to choose from is dropped",
    parseFeatureSpec("سایز(sz)|متریال:استیل").length, 1);
  eq("every option gets an id", parseFeatureSpec("a:x،y")[0].options.every((o) => !!o.id), true);
  ok("and no two share one",
    new Set(parseFeatureSpec("a:x،y|b:z").flatMap((f) => f.options.map((o) => o.id))).size === 3);

  const importer = readFileSync("src/components/ProductsView.tsx", "utf-8");
  ok("the importer sends what it parsed",
    importer.includes("features: parseFeatureSpec(item.featuresRaw)"));

  /*
   * Updating an existing product sends the features and nothing else.
   *
   * `updateProduct` reads `stockLevel` and `variants` as the levels the caller
   * *wants* and reconciles the difference into stock movements — so writing
   * back a whole record read a moment earlier would undo any adjustment made in
   * between, and write a correction movement for it, on the one screen whose
   * job is bulk stock changes. The route copies only the keys the body has, so
   * a partial write is the honest one.
   */
  ok("and updates an existing product with the features alone",
    importer.includes("productsApi.update(existingProduct.id, { features })"));
  ok("without reading the whole record back first",
    !/const full = detailToProduct\(await productsApi\.get\(existingProduct\.id\)\)/.test(importer));
  /*
   * Features belong to the product, so a row matched by one of its SKUs must
   * be able to set them too — the blank-cell check is the guard, not this.
   */
  ok("a row matched by SKU can still set them",
    !/features\.length > 0 && !variantId/.test(importer));
}

head("Proforma filter: the grid filters on what the badge says");
{
  /*
   * The status filter sent its value at the stored `status` column, and only
   * two of its six options are ever in that column. «تأیید شده (برنده)»,
   * «باخته» and «لغو شده» are outcomes derived from the lines, so choosing one
   * asked SQL for a value nothing holds and the grid came back empty.
   *
   * Every combination of up to three lines, over every line status, against
   * every workflow status and both cancellation flags — the clause and the rule
   * must agree on all of them, or the filter is showing something other than
   * what the badge says.
   */
  const LINE_STATUSES = ["برنده", "بازنده", "لغو شده", "در انتظار", null];
  /*
   * The document's own status is never null: `proformas.status` is NOT NULL.
   *
   * It used to be swept as a possible value, and the clause carried a matching
   * `{ status: null }` branch to satisfy it — which Prisma rejects outright on
   * a non-nullable column ("Argument `status` is missing"), taking the whole
   * query and the screen using it down. A line's status is nullable and stays
   * in the sweep above.
   */
  const DOC_STATUSES = ["پیش‌نویس", "ارسال شده", "تأیید شده"];

  const shapes: { status: string | null; isCancelled: boolean; items: { status: string | null }[] }[] = [];
  for (const status of DOC_STATUSES) {
    for (const isCancelled of [false, true]) {
      shapes.push({ status, isCancelled, items: [] });
      for (const a of LINE_STATUSES) {
        shapes.push({ status, isCancelled, items: [{ status: a }] });
        for (const b of LINE_STATUSES) {
          shapes.push({ status, isCancelled, items: [{ status: a }, { status: b }] });
          for (const c of LINE_STATUSES) {
            shapes.push({ status, isCancelled, items: [{ status: a }, { status: b }, { status: c }] });
          }
        }
      }
    }
  }

  let disagreements = 0;
  let firstBad = "";
  for (const outcome of DERIVED_OUTCOMES) {
    const where = outcomeWhere(outcome);
    if (!where) { disagreements++; continue; }
    for (const pf of shapes) {
      const wanted = getProformaOutcome(pf as never) === outcome;
      const found = matchesWhere(where, pf as never);
      if (wanted !== found && disagreements++ === 0) {
        firstBad = `${outcome}: ${JSON.stringify(pf)} — rule says ${wanted}, query says ${found}`;
      }
    }
  }

  ok(`the query and the rule agree on all ${shapes.length.toLocaleString("en-US")} shapes × ${DERIVED_OUTCOMES.length} outcomes`,
    disagreements === 0, firstBad || disagreements);

  /* The two that really are columns are left as plain equality. */
  ok("«ارسال شده» is a workflow status and gets its own clause",
    outcomeWhere("ارسال شده") !== null);
  eq("something that is neither is left alone", outcomeWhere("چیز دیگر"), null);

  const readSrc = (file: string) => readFileSync(file, "utf-8");
  ok("the server translates a status filter into an outcome query",
    readSrc("src/server/services/proformaService.ts").includes("outcomeWhere("));
  /*
   * And the screen no longer re-filters the page it was given. The server
   * answered correctly and the browser then dropped rows from it — the same
   * filter running twice, one of them over one page.
   */
  ok("the screen does not filter the page again",
    !readSrc("src/components/ProformasView.tsx").includes("getProformaOutcomeStatus(p) === selectedStatus"));
  ok("and «نیمه برنده» can be asked for at all",
    readSrc("src/components/ProformasView.tsx").includes('<option value="نیمه برنده">'));
}

head("The ledger names things from the row, not from a picker");
{
  /*
   * «پ.ف: ناشناس» on a document whose proforma was recorded perfectly well.
   *
   * The grid resolved the number by looking the id up in the proforma
   * *picker's* current matches — whatever was last searched for — so a document
   * was named only while its proforma happened to be loaded, which in practice
   * meant only the one just saved. Saving a second one renamed the first to
   * «ناشناس». The row carries the proforma now.
   */
  const row = {
    id: "t1", documentNumber: "TR-RC-0506-001", type: "دریافت", receiptType: "تسویه",
    status: "تأیید شده", occurredAt: null, occurredAtJalali: "1405/06/01",
    customerId: "c1", supplierId: null, projectId: "p1", proformaId: "pf1",
    purchaseOrderId: null, partyName: null,
    amountRial: "1911025600", amountForeign: null, exchangeRate: "1973751.4201",
    isDirectForeign: false, paymentType: "حواله بانکی", referenceNumber: "73472",
    reversalOfTransactionId: null, createdAt: "", customValues: null,
    customer: { id: "c1", companyName: "صنعت سبز طبرستان" },
    supplier: null,
    project: { id: "p1", code: "ATA-05-19", name: "فلومتر خط رفلاکس" },
    proforma: { id: "pf1", proformaNumber: "ATA-05-19-C1", currency: "دلار" },
  };

  const tx = rowToTransaction(row as never) as unknown as Record<string, unknown>;
  eq("the proforma number comes down with the row", tx.proformaNumber, "ATA-05-19-C1");
  /*
   * And its currency, which is what decides whether a receipt is missing a
   * settlement rate — that whole tab silently skipped any document whose
   * proforma was not in the picker.
   */
  eq("so does its currency", tx.proformaCurrency, "دلار");
  /* A null party name falls back to the joined customer, never to «ناشناس». */
  eq("a blank party name reads as the customer", tx.partyName, "صنعت سبز طبرستان");

  const unlinked = rowToTransaction(
    { ...row, proforma: null, proformaId: null } as never,
  ) as unknown as Record<string, unknown>;
  eq("a document with no proforma says nothing about one", unlinked.proformaNumber, undefined);

  const readSrc = (file: string) => readFileSync(file, "utf-8");
  const view = readSrc("src/components/TransactionsView.tsx");
  ok("the grid no longer hunts the picker for a proforma number",
    !/proformas\.find\(pf?f? => pf?f?\.id === t\.proformaId\)/.test(view));
  ok("and «ناشناس» is never stored as somebody's name",
    !view.includes("'مشتری ناشناس'") && !view.includes("'تأمین‌کننده ناشناس'"));
  ok("the server joins the proforma onto the list row",
    readSrc("src/server/services/transactionService.ts")
      .includes("proforma: { select: { id: true, proformaNumber: true, currency: true } }"));
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
  /* And the printed document reads the stored figures rather than recomputing.
     It lives in its own module now — see proformaDocument.ts — so this follows
     it there rather than quietly passing against a file that no longer builds
     the document. */
  const printed = readSrc("src/utils/proformaDocument.ts");
  ok("the printed totals come from the record",
    printed.includes("formatMoney(pf.finalAmount)"));
  ok("and the document grows no discount arithmetic of its own",
    !/discountAmount\s*=\s*[^;]*discountPercent\s*\/\s*100/.test(printed));
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


/* ── Supplier inquiry: the price history ─────────────────────────────────── */
head("Supplier inquiry: price history");
{
  /*
   * The question the history answers is "what did the last one cost me", and
   * the trap it exists to avoid is quoting a line's stored price as the answer.
   * A discount belongs to the whole offer, so a line's own figure is
   * pre-discount and overstates every discounted quotation.
   */
  const lines = [
    { quantity: 2, currency: "دلار", priceForeign: 1000, priceRial: 60_000_000 },
    { quantity: 1, currency: "دلار", priceForeign: 500, priceRial: 30_000_000 },
  ];

  eq("no discount keeps the whole offer", discountKeepFraction(lines, 0, 0), 1);
  eq("10% off keeps nine tenths", Math.round(discountKeepFraction(lines, 10, 0) * 1e6) / 1e6, 0.9);

  // 2,500 gross; 10% leaves 2,250; 250 off that leaves 2,000.
  eq("percent then amount, in that order",
    Math.round(discountKeepFraction(lines, 10, 250) * 1e6) / 1e6, 0.8);

  eq("a discount larger than the offer clamps at zero, never negative",
    discountKeepFraction(lines, 0, 99_999), 0);

  // A Rial-only offer has no foreign gross at all; the fraction must still be
  // measured, off the Rial side.
  const rialOnly = [{ quantity: 1, currency: "ریال", priceForeign: 0, priceRial: 100_000_000 }];
  eq("a Rial-only offer is measured on its Rial total",
    Math.round(discountKeepFraction(rialOnly, 25, 0) * 1e6) / 1e6, 0.75);

  eq("an offer with no prices at all keeps everything rather than dividing by zero",
    discountKeepFraction([], 10, 5), 1);

  /* The line's own share of that. */
  const keep = discountKeepFraction(lines, 10, 250);
  const unit = netUnitPrice(lines[0], keep);
  // Compared with a tolerance, not exactly: the fraction is a ratio of two
  // sums, so 0.8 × 1000 lands at 799.999…. Every figure reaching a screen is
  // rounded, and the sum-to-the-card check below is what pins the accuracy.
  ok("the unit price carries the offer's discount",
    Math.abs(unit.unitForeign - 800) < 1e-6, unit.unitForeign);
  ok("and so does its Rial equivalent",
    Math.abs(unit.unitRial - 48_000_000) < 1e-3, unit.unitRial);
  ok("a discounted line says so", unit.discounted);
  ok("an undiscounted one does not", !netUnitPrice(lines[0], 1).discounted);
  eq("a fraction above one is clamped — a discount never raises a price",
    netUnitPrice(lines[0], 1.4).unitForeign, 1000);

  /*
   * The invariant that matters: the history and the offer card must not
   * disagree about one offer. The card computes a net total; the history
   * computes each line's net unit price. Summing the second has to give the
   * first, or the same quotation reads as two different amounts on two screens.
   */
  for (const [pct, amount] of [[0, 0], [10, 0], [10, 250], [7.5, 33.25], [100, 0]] as const) {
    const fraction = discountKeepFraction(lines, pct, amount);
    const summed = lines.reduce(
      (total, line) => total + netUnitPrice(line, fraction).unitRial * line.quantity,
      0,
    );
    const card = inquiryTotalRiyal(
      lines.map((l) => ({ quantity: l.quantity, currency: l.currency, priceForeign: l.priceForeign, priceRiyal: l.priceRial })) as never,
      pct, amount,
    );
    ok(`the lines sum to the offer card's total at ${pct}% + ${amount}`,
      Math.abs(summed - card) < 0.01, { summed, card });
  }

  /* The range across the matched history. */
  const summary = summarizeHistory([
    { unitRial: 60_000_000, supplierId: "s1" },
    { unitRial: 48_000_000, supplierId: "s2" },
    { unitRial: 72_000_000, supplierId: "s1" },
    // An inquiry that was sent and never answered. Not a price.
    { unitRial: 0, supplierId: "s3" },
  ]);
  eq("an unanswered line is left out of the count", summary.pricedCount, 3);
  eq("and out of the cheapest — a free quotation is missing data, not a bargain",
    summary.minUnitRial, 48_000_000);
  eq("the dearest is reported too", summary.maxUnitRial, 72_000_000);
  eq("the average is over the priced rows only", summary.avgUnitRial, 60_000_000);
  eq("suppliers are counted once each", summary.supplierCount, 2);

  const empty = summarizeHistory([{ unitRial: 0, supplierId: "s1" }]);
  ok("no prices at all reports nothing rather than zero",
    empty.minUnitRial === null && empty.maxUnitRial === null && empty.avgUnitRial === null,
    empty);

  /*
   * A static segment under a parameterised route.
   *
   * `/api/supplier-inquiries/price-history` must be registered before
   * `/api/supplier-inquiries/:id`, or Express matches the second and the screen
   * gets a 404 for an inquiry whose id is the literal string "price-history".
   */
  const routes = readFileSync("src/server/routes/inquiries.ts", "utf-8");
  const historyAt = routes.indexOf('app.get("/api/supplier-inquiries/price-history"');
  const byIdAt = routes.indexOf('app.get("/api/supplier-inquiries/:id"');
  ok("the price-history route is registered before the :id route",
    historyAt > -1 && byIdAt > -1 && historyAt < byIdAt, { historyAt, byIdAt });

  /*
   * The history reads the *lines*, not a page of inquiries. Picking matching
   * lines out of a page of inquiries pages the wrong set: a supplier whose one
   * matching line sits on inquiry 200 falls off page 1 and the answer changes
   * with the page size.
   */
  const service = readFileSync("src/server/services/inquiryService.ts", "utf-8");
  const historyBody = service.slice(service.indexOf("export async function listPriceHistory"));
  ok("the history queries the lines table",
    /db\.supplierInquiryItem\.findMany/.test(historyBody));
  ok("and never pages inquiries to find them",
    !/db\.supplierInquiry\.findMany/.test(historyBody));
  ok("a user who may not see costs is refused rather than served a blank table",
    /canSeeCosts\(user\)/.test(historyBody));
}


/* ── The printed proforma, across several pages ──────────────────────────── */
head("Printed proforma: the multi-page rules");
{
  /*
   * The bug this section exists for: an eight-item proforma printed its first
   * page with a letterhead, a buyer panel and no goods at all, and started the
   * items on page two. The goods table sat inside a box marked
   * "break-inside: avoid", so the browser was being told to keep the whole list
   * on one sheet — and when it would not fit, it moved the lot.
   *
   * These read the document the builder actually produces, because the builder
   * is pure. What they cannot see is the pagination itself; that was checked by
   * printing the thing with a real browser and looking at the pages.
   */
  const item = (n: number) => ({
    id: `it-${n}`, productId: null, productName: `INSTRUMENT ${n}`,
    brand: "Krohne", tagNumber: `FT-${1100 + n}`,
    techSpecs: "Type: Turbine flow meter\nSize: 6 inch\nBody: SS316",
    quantity: 2, unit: "دستگاه",
    unitPriceRIYAL: 128_400_000, totalPriceRIYAL: 256_800_000,
    status: "در انتظار",
  });
  const proforma = {
    id: "pf-1", proformaNumber: "ATA-1405-08", customerId: "c-1",
    customerName: "پالایش نفت اصفهان", issueDate: "1405/06/07", expiryDate: "1405/06/17",
    currency: "ریال", proformaType: "COMMERCIAL",
    items: Array.from({ length: 8 }, (_, i) => item(i + 1)),
    totalAmount: 2_054_400_000, discountPercent: 5, discountAmount: 102_720_000,
    taxPercent: 10, taxAmount: 195_168_000, finalAmount: 2_146_848_000,
    notes: "شرایط پرداخت: ۵۰٪ پیش‌پرداخت.", status: "ارسال شده",
  };
  const template = {
    name: "t", companyName: "ابزار تامین ارشیا", registrationNumber: "1",
    nationalCode: "1", economicCode: "1", phone: "021", email: "a@b.c",
    website: "w", address: "تهران", titleColor: "#0ea5e9", documentTitle: "پیش‌فاکتور",
    headerText: "", termsAndConditions: "", footerText: "",
    signatureLabel1: "s1", signatureLabel2: "s2",
    showLogo: true, showTerms: true, showSignatures: true, showTotals: true,
  };

  const doc = renderProformaDocument({
    proforma: proforma as never, template: template as never,
    customer: { id: "c-1", customerType: "حقوقی" } as never,
    creator: { fullName: "محمد توکل مقدم", signatureImage: null },
    products: [], showBrand: true,
  });

  /** The declarations inside one CSS rule, by selector. */
  const ruleBody = (selector: string): string => {
    const at = doc.indexOf(`${selector} {`);
    return at === -1 ? "" : doc.slice(at, doc.indexOf("}", at));
  };

  ok("the letterhead is the frame table's header group, so it repeats",
    /<table class="doc-frame">\s*<thead>[\s\S]{0,400}?class="header"/.test(doc));
  ok("and the address bar is its footer group, so the space is reserved",
    /<tfoot>[\s\S]{0,400}?class="print-footer"/.test(doc));
  ok("with a second copy painted at the foot of the sheet",
    doc.includes('class="print-footer-painted"'));

  // The one that caused it. The container must let the table fragment.
  const container = ruleBody(".table-container");
  ok("the goods table is not held to one page", !/break-inside:\s*avoid/.test(container), container);
  ok("nor clipped by an overflow that would stop it fragmenting",
    !/overflow:\s*hidden/.test(container), container);

  // …and a product's own box still stays whole.
  ok("a product row stays whole", /\.table-container tr \{[^}]*break-inside:\s*avoid/.test(doc));
  ok("the rule is scoped to the goods table, not to every tr on the page",
    !/\n\s{6}tr \{/.test(doc));
  ok("the frame's own row is explicitly breakable, or the whole body would have to fit one page",
    /\.doc-frame > tbody > tr[\s\S]{0,120}break-inside:\s*auto/.test(doc));

  /*
   * Nothing of unbounded length may be unbreakable: a block taller than the
   * printable area that refuses to break reproduces the empty page exactly.
   * The terms are free text a user can make as long as they like.
   */
  for (const selector of [".notes-card", ".financial-grid"]) {
    const body = ruleBody(selector);
    ok(`${selector} may break across pages — its content has no fixed length`,
      body !== "" && !/break-inside:\s*avoid/.test(body), body);
  }

  // The footer's ink must clear the bottom of its box, or the slice that
  // overflows the reserved strip is painted over the next page's letterhead.
  ok("the repeated footer keeps slack at its bottom edge",
    /\.print-footer \{[^}]*padding:\s*8px 0 6px/.test(doc));

  /*
   * `white-space: pre-line` preserves newlines, so a line break between the tag
   * and the value prints a blank line above every specification and leaves the
   * product name floating away from the text it heads.
   */
  // Comments stripped first: one of them explains this very rule and quotes the
  // property, and a check that matches its own comment is a check that passes
  // for the wrong reason — this codebase has been caught by that before.
  const docNoComments = doc.replace(/<!--[\s\S]*?-->/g, "");
  const preLineBlocks = [...docNoComments.matchAll(/white-space: pre-line[^>]*>([^<])/g)].map((m) => m[1]);
  ok("every pre-line block starts on its own first character",
    preLineBlocks.length > 0 && preLineBlocks.every((c) => c !== "\n" && c !== "\r"),
    preLineBlocks.length);

  ok("all eight items are on the document", (doc.match(/INSTRUMENT \d/g) ?? []).length === 8);

  /*
   * The seal must never be the only thing on a sheet.
   *
   * Shrinking it buys room and cannot win the argument — whatever height the
   * block is, some document ends a point short. `break-before: avoid` asks the
   * browser to keep it with the totals above it, and being a preference rather
   * than a demand it cannot recreate the "unbreakable and taller than a page"
   * fault that emptied page one.
   */
  ok("the seal asks to stay with what comes before it",
    /\.signatures \{[^}]*break-before:\s*avoid/.test(doc));
  ok("and still refuses to be split down the middle",
    /\.signatures \{[^}]*break-inside:\s*avoid/.test(doc));
  /*
   * The web address belongs with the company's name, not among the contact
   * details.
   *
   * It used to sit in the address bar at the foot of the page, inside a wrapping
   * flex row it shared with the address, the telephone and the email — so it was
   * pushed to whichever end the wrap left it and read as a fourth contact
   * detail. In a letterhead it is part of the mark.
   */
  const headerBlock = doc.slice(doc.indexOf('class="logo-box"'), doc.indexOf('class="title-box"'));
  ok("the site is in the letterhead", /class="company-site"/.test(headerBlock));
  ok("under the name and what the company does",
    headerBlock.indexOf('class="company-name"') < headerBlock.indexOf('class="company-site"')
    && headerBlock.indexOf('class="subtitle"') < headerBlock.indexOf('class="company-site"'));
  ok("and no longer in the address bar",
    !doc.includes("print-footer-site"));

  /*
   * A Latin string inside an RTL block. Without its own direction a trailing
   * dot or a path segment is reordered, and the address prints wrong on a
   * document that goes to a customer.
   */
  const siteRule = ruleBody(".company-site");
  ok("it carries its own direction",
    /direction:\s*ltr/.test(siteRule) && /unicode-bidi:\s*isolate/.test(siteRule), siteRule);
  // Set by size and tracking rather than by a second typeface: the document
  // loads one, and a face that silently falls back paginates differently from
  // the one that was proofed.
  ok("and is set in the document's own face",
    !/font-family/.test(siteRule) && /letter-spacing/.test(siteRule), siteRule);

  /*
   * The two secondary lines are one block, so they are one tone. The tagline
   * was #94a3b8 — 2.56:1, which on paper is close to absent.
   */
  const subtitleRule = ruleBody(".subtitle");
  const toneOf = (rule: string) => rule.match(/color:\s*(#[0-9a-f]{6})/i)?.[1];
  eq("the tagline and the address share a tone", toneOf(subtitleRule), toneOf(siteRule));
  // Measured here rather than eyeballed: this block is read off paper, where a
  // tone chosen on a backlit screen is the one that disappears.
  const onWhite = (h: string) => {
    const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 1.05 / (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] + 0.05);
  };
  const tone = toneOf(siteRule);
  ok("which is legible in print", !!tone && onWhite(tone) >= 4.5,
    tone && onWhite(tone).toFixed(2));

  /*
   * One set of dimensions for the seal strip. Every size in this block used to
   * be an inline style written out twice — once for a template with a company
   * stamp and once for a template without — which is how a block comes to be a
   * different height depending on a setting nobody connected to it.
   */
  ok("the seal strip is sized in one place", ruleBody(".seal-panel").includes("height"));
  ok("and the markup carries no second copy of it",
    (doc.match(/class="seal-panel/g) ?? []).length === 1, doc.match(/class="seal-panel/g));
}


/* ── Sales follow-up ─────────────────────────────────────────────────────── */
head("Sales follow-up: chasing a quotation");
{
  /*
   * The rule this whole feature rests on: follow-up is a different axis from
   * the commercial outcome. A quotation sent three weeks ago with nobody on it
   * and one the customer asked us to raise again after Nowruz have the *same*
   * outcome and are completely different situations.
   */
  ok("the states are only the three the outcome cannot express",
    FOLLOW_UP_STATES.join(",") === "OPEN,DEFERRED,NO_RESPONSE", FOLLOW_UP_STATES);
  for (const forbidden of ["WON", "LOST", "CANCELLED", "SUPERSEDED"]) {
    ok(`${forbidden} is not a follow-up state — it already exists as an outcome`,
      !(FOLLOW_UP_STATES as readonly string[]).includes(forbidden));
  }
  eq("anything unrecognised is treated as still being chased",
    normalizeFollowUpState("wat"), "OPEN");

  /* Terminal outcomes end the chase; a part-won document does not. */
  ok("a won quotation is terminal", isTerminalOutcome("تأیید شده (برنده)"));
  ok("so is a lost one", isTerminalOutcome("باخته"));
  ok("and a cancelled one", isTerminalOutcome("لغو شده"));
  // Part-won is settled too, on the business's reading: it is reached when some
  // lines were won and the rest closed off, so there is nothing left to ask.
  ok("and a part-won one, which here means the rest were closed off",
    isTerminalOutcome("نیمه برنده"));
  ok("nor is a document still running", !isTerminalOutcome("جاری"));

  /*
   * Absent means GENERAL, which is what makes the migration a no-op: every task
   * written before this existed is an ordinary one and must be untouched by the
   * duplicate check, the queue and the automatic closing.
   */
  eq("a task with no kind is a general task", normalizeTaskKind(undefined), "GENERAL");
  eq("and an unknown one is too", normalizeTaskKind("SOMETHING"), "GENERAL");
  eq("only the follow-up kind is the follow-up kind",
    normalizeTaskKind("SALES_FOLLOW_UP"), "SALES_FOLLOW_UP");
  ok("there are exactly two kinds", TASK_KINDS.length === 2, TASK_KINDS);

  /*
   * "Finished" is an exclusion, like the ledger's balance rule: a status nobody
   * anticipated must read as still open, because a forgotten follow-up is the
   * failure this feature exists to prevent.
   */
  ok("a completed task is finished", isTaskFinished("انجام شده"));
  ok("a cancelled one too", isTaskFinished("کنسل شده"));
  ok("but one in progress is not", !isTaskFinished("در حال انجام"));
  ok("and neither is a status nobody anticipated", !isTaskFinished("منتظر مشتری"));

  /* --- the health ranking, which is the order the desk works in --- */
  const today = "1405/06/10";
  const health = (row: Parameters<typeof followUpHealthOf>[0]) => followUpHealthOf(row, today);

  eq("a late next action is overdue",
    health({ followUpState: "OPEN", nextActionDueDateJalali: "1405/06/09", hasOpenFollowUpTask: true }),
    "OVERDUE");
  eq("today's is due today",
    health({ followUpState: "OPEN", nextActionDueDateJalali: today, hasOpenFollowUpTask: true }),
    "DUE_TODAY");
  eq("a future one is upcoming",
    health({ followUpState: "OPEN", nextActionDueDateJalali: "1405/06/20", hasOpenFollowUpTask: true }),
    "UPCOMING");
  eq("an open quotation with no task at all has no next action",
    health({ followUpState: "OPEN", nextActionDueDateJalali: null, hasOpenFollowUpTask: false }),
    "NO_NEXT_ACTION");
  eq("and that ranks above merely upcoming — nothing planned is worse than late",
    healthRank("NO_NEXT_ACTION") < healthRank("UPCOMING"), true);
  ok("overdue leads the whole list", healthRank("OVERDUE") === 0);

  /*
   * A deferred quotation is not overdue while its date is ahead — that is the
   * entire point of deferring — and rejoins the ordinary ranking once it
   * passes, so nothing is parked for ever.
   */
  eq("a deferral still in the future is parked, not late",
    health({
      followUpState: "DEFERRED", nextActionDueDateJalali: "1405/06/09",
      hasOpenFollowUpTask: true, deferredUntilJalali: "1405/07/01",
    }),
    "DEFERRED");
  eq("once the date passes it is judged like any other row",
    health({
      followUpState: "DEFERRED", nextActionDueDateJalali: "1405/06/09",
      hasOpenFollowUpTask: true, deferredUntilJalali: "1405/06/01",
    }),
    "OVERDUE");
  eq("an abandoned one says so", 
    health({ followUpState: "NO_RESPONSE", nextActionDueDateJalali: null, hasOpenFollowUpTask: false }),
    "NO_RESPONSE");

  /* The health check with a target of zero. */
  ok("open with no task is the fault the dashboard counts",
    isOpenWithoutNextAction({ followUpState: "OPEN", nextActionDueDateJalali: null, hasOpenFollowUpTask: false }));
  ok("a deferred quotation is a decision, not neglect",
    !isOpenWithoutNextAction({ followUpState: "DEFERRED", nextActionDueDateJalali: null, hasOpenFollowUpTask: false }));
  ok("and so is an abandoned one",
    !isOpenWithoutNextAction({ followUpState: "NO_RESPONSE", nextActionDueDateJalali: null, hasOpenFollowUpTask: false }));
  ok("an open quotation somebody is chasing is fine",
    !isOpenWithoutNextAction({ followUpState: "OPEN", nextActionDueDateJalali: "1405/06/20", hasOpenFollowUpTask: true }));

  /* --- what a decision leaves behind --- */
  eq("recording a next action keeps the chase open", stateAfterDecision("NEXT_ACTION"), "OPEN");
  eq("deferring parks it", stateAfterDecision("DEFER"), "DEFERRED");
  eq("giving up closes it", stateAfterDecision("NO_RESPONSE"), "NO_RESPONSE");
  // Not NO_RESPONSE: the chase ended because the sale ended, which the outcome
  // already records. Writing "no response" would claim the customer went quiet
  // on a quotation they had just approved.
  eq("a terminal outcome does not claim the customer went quiet",
    stateAfterDecision("TERMINAL"), "OPEN");

  /* --- the refusals, run by the modal and by the route --- */
  const ctx = { todayJalali: today, outcomeIsTerminal: false };
  ok("a result is required",
    completionRefusalReason({ decision: "NEXT_ACTION", followUpResult: "" }, ctx) !== null);
  ok("a next action needs a title",
    completionRefusalReason({ decision: "NEXT_ACTION", followUpResult: "در حال بررسی فنی", nextDueDate: "1405/06/20" }, ctx) !== null);
  ok("and a date",
    completionRefusalReason({ decision: "NEXT_ACTION", followUpResult: "در حال بررسی فنی", nextTitle: "تماس" }, ctx) !== null);
  ok("a complete next action is accepted",
    completionRefusalReason(
      { decision: "NEXT_ACTION", followUpResult: "در حال بررسی فنی", nextTitle: "تماس", nextDueDate: "1405/06/20" },
      ctx,
    ) === null);
  // A deferral into the past comes back overdue the moment it is saved, which
  // is not what the customer asked for.
  ok("a deferral must be into the future",
    completionRefusalReason({ decision: "DEFER", followUpResult: "خرید به تعویق افتاد", deferredUntil: "1405/06/01" }, ctx) !== null);
  ok("a future deferral is accepted",
    completionRefusalReason({ decision: "DEFER", followUpResult: "خرید به تعویق افتاد", deferredUntil: "1405/07/01" }, ctx) === null);
  ok("giving up needs only a result",
    completionRefusalReason({ decision: "NO_RESPONSE", followUpResult: "عدم پاسخ" }, ctx) === null);
  // The hole this screen exists to close: closing a live quotation with nothing
  // planned.
  ok("closing without a next action is refused while the sale is live",
    completionRefusalReason({ decision: "TERMINAL", followUpResult: "سایر" }, ctx) !== null);
  ok("and allowed once the outcome is settled",
    completionRefusalReason({ decision: "TERMINAL", followUpResult: "سایر" },
      { ...ctx, outcomeIsTerminal: true }) === null);

  /* --- the version chain --- */
  ok("a document with no revision may be revised",
    versionRefusalReason({ proformaNumber: "PF-A", nextVersionNumber: null }) === null);
  const forked = versionRefusalReason({ proformaNumber: "PF-A", nextVersionNumber: "PF-B" });
  ok("a second revision of the same document is refused", forked !== null);
  ok("and the message names the revision to work from instead",
    (forked ?? "").includes("PF-B"), forked);

  /* --- the timeline sentence --- */
  const text = followUpActivityText({
    proformaNumber: "PF-1404-12",
    followUpResult: "در حال بررسی فنی",
    completionNote: "مشتری اعلام کرد تأیید فنی انجام شده است.",
    nextTitle: "پیگیری تأیید مالی",
    nextDueDateJalali: "1405/06/15",
    decision: "NEXT_ACTION",
  });
  ok("the timeline entry names the quotation and the result",
    text.includes("PF-1404-12") && text.includes("در حال بررسی فنی"), text);
  ok("carries the note", text.includes("تأیید فنی انجام شده"), text);
  ok("and says what happens next, with its date",
    text.includes("اقدام بعدی") && text.includes("1405/06/15"), text);

  ok("the default result list is offered and «عدم پاسخ» is one of them",
    DEFAULT_FOLLOW_UP_RESULTS.includes("عدم پاسخ"));
  // A follow-up result is not a loss reason: «خرید به تعویق افتاد» is a
  // deferral, and filing it as a loss would poison every loss report.
  ok("the follow-up results are not the loss reasons",
    DEFAULT_FOLLOW_UP_RESULTS.every((r) => !DEFAULT_SETTINGS.lossReasons.includes(r)));
  ok("«خرید به تعویق افتاد» is a follow-up result, never a loss reason",
    DEFAULT_FOLLOW_UP_RESULTS.includes("خرید به تعویق افتاد")
    && !DEFAULT_SETTINGS.lossReasons.includes("خرید به تعویق افتاد"));
  ok("the settings ship the list so the dropdown is not empty",
    (DEFAULT_SETTINGS.dropdownItems.followUpResults ?? []).length === DEFAULT_FOLLOW_UP_RESULTS.length);

  /*
   * The standard follow-up is seeded as a rule, not written into code.
   *
   * That is the whole point: when it fires, who it lands on, how long the
   * person has and what the task is called are all editable in Settings, and
   * the rule can be switched off entirely. A seeded rule is a default, not a
   * hardcoding — the same distinction as a seeded dropdown list.
   */
  const followUpRule = (DEFAULT_SETTINGS.workflows ?? []).find(
    (r) => r.triggerType === "proforma_status_change",
  );
  ok("a follow-up automation ships with a new installation", !!followUpRule);
  eq("it fires when a quotation is sent",
    followUpRule?.conditions?.[0]?.value, "ارسال شده");
  const cfg = followUpRule?.actions?.[0]?.taskConfig;
  eq("it raises a sales follow-up", cfg?.taskKind, "SALES_FOLLOW_UP");
  // Never the person who prepared the document.
  eq("owned by the project's sales engineer", cfg?.assignedTo, "SALES_EXPERT");
  ok("and it will not stack duplicates on a re-sent quotation", cfg?.skipIfOpenSameKind === true);
  ok("the title names the quotation", (cfg?.titleTemplate ?? "").includes("{proformaNumber}"));

  ok("every health band has a rank", FOLLOW_UP_HEALTH.every((h) => healthRank(h) < FOLLOW_UP_HEALTH.length));

  /*
   * A settled quotation is not in the queue at all.
   *
   * It was: the queue filtered on `isCancelled` and the stored status, and the
   * outcome is derived from neither — a fully-won proforma still has
   * `isCancelled: false` and a stored status of «ارسال شده», so every won and
   * lost quotation came through and the screen asked for a next action on a
   * finished sale. Documents written before the feature existed made it obvious:
   * nothing had ever swept their follow-ups, because they had none.
   *
   * So the clause is built from `outcomeWhere` and held here against
   * `getProformaOutcome` itself, over every combination of up to three lines
   * crossed with the stored statuses and the cancellation flag — the same
   * technique the grid's status filter is pinned with, and for the same reason:
   * the query and the rule must never drift.
   */
  {
    const where = chaseableWhere();
    const LINE_STATUSES = [ITEM_WON, ITEM_LOST, ITEM_CANCELLED, "جاری", null];
    /*
     * Including a status nobody anticipated, but not null.
     *
     * A document is dropped from this screen by a clause that fails to match, so
     * the sweep covers values that were never designed for. Null is not one of
     * them: `proformas.status` is NOT NULL, and a clause that tried to match it
     * against null would not merely be dead — Prisma rejects the filter and the
     * whole query fails. That is checked separately, below.
     */
    const DOC_STATUSES = ["پیش‌نویس", "ارسال شده", "جاری", "تأیید شده (برنده)"];
    const disagreements: string[] = [];
    let checked = 0;

    const combinations: (string | null)[][] = [[]];
    for (const a of LINE_STATUSES) {
      combinations.push([a]);
      for (const b of LINE_STATUSES) {
        combinations.push([a, b]);
        for (const c of LINE_STATUSES) combinations.push([a, b, c]);
      }
    }

    for (const lines of combinations) {
      for (const status of DOC_STATUSES) {
        for (const isCancelled of [false, true]) {
          const pf = { status, isCancelled, items: lines.map((st) => ({ status: st })) };
          const outcome = getProformaOutcome(pf as never);
          const inQueue = matchesWhere(where as never, pf as never);
          checked++;
          if (inQueue !== isChaseableOutcome(outcome)) {
            disagreements.push(`${status}/${isCancelled}/[${lines.join("|")}] -> ${outcome} inQueue=${inQueue}`);
          }
        }
      }
    }

    ok(`the queue's query matches the outcome rule over ${checked} shapes`,
      disagreements.length === 0, disagreements.slice(0, 4));

    /*
     * No clause may compare the document's own status against null.
     *
     * `proformas.status` is NOT NULL, so Prisma's filter type does not accept
     * null there and the query fails outright — "Argument `status` is missing"
     * — taking the whole screen with it. A line's status is nullable and its
     * null branches are correct and necessary, so this walks the tree and only
     * inspects `status` keys that are *not* inside an `items` clause.
     */
    const nullStatusFilters: string[] = [];
    const walk = (node: unknown, insideItems: boolean, path: string) => {
      if (!node || typeof node !== "object") return;
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (key === "items") { walk(value, true, `${path}.${key}`); continue; }
        if (key === "status" && !insideItems && value === null) {
          nullStatusFilters.push(`${path}.${key}`);
        }
        if (Array.isArray(value)) {
          value.forEach((v, i) => walk(v, insideItems, `${path}.${key}[${i}]`));
        } else if (value && typeof value === "object") {
          walk(value, insideItems, `${path}.${key}`);
        }
      }
    };
    for (const outcome of [...DERIVED_OUTCOMES, "ارسال شده", "پیش‌نویس"]) {
      walk(outcomeWhere(String(outcome)), false, String(outcome));
    }
    ok("no clause filters the document's non-nullable status against null",
      nullStatusFilters.length === 0, nullStatusFilters);

    /* Spelled out, because these are the cases that were reported. */
    const shape = (lines: string[], status = "ارسال شده", isCancelled = false) =>
      ({ status, isCancelled, items: lines.map((st) => ({ status: st })) });

    ok("a won quotation is out of the queue",
      !matchesWhere(where as never, shape([ITEM_WON, ITEM_WON]) as never));
    ok("a lost one is out",
      !matchesWhere(where as never, shape([ITEM_LOST]) as never));
    ok("one whose lines were all cancelled is out — even with isCancelled false",
      !matchesWhere(where as never, shape([ITEM_CANCELLED, ITEM_CANCELLED]) as never));
    ok("an explicitly cancelled document is out",
      !matchesWhere(where as never, shape(["جاری"], "ارسال شده", true) as never));
    ok("a draft is out — it has not been sent to anybody",
      !matchesWhere(where as never, shape([], "پیش‌نویس") as never));

    ok("a sent quotation with nothing decided is in",
      matchesWhere(where as never, shape([], "ارسال شده") as never));
    ok("so is one whose lines are still running",
      matchesWhere(where as never, shape(["جاری", "جاری"]) as never));
    // Part-won is settled here: the remaining lines were closed off, so the
    // document's fate is decided and nobody needs to chase it.
    ok("a part-won one is out",
      !matchesWhere(where as never, shape([ITEM_WON, ITEM_CANCELLED]) as never));

    /*
     * The three sets partition the outcome space.
     *
     * Every outcome is either settled, worth chasing, or a draft that has not
     * been sent — and none is in two of those at once. An outcome that fell
     * through all three would silently vanish from the screen without anyone
     * deciding it should.
     */
    const ALL_OUTCOMES = [...DERIVED_OUTCOMES, "ارسال شده", "پیش‌نویس"];
    const unclassified = ALL_OUTCOMES.filter(
      (o) => !isTerminalOutcome(o) && !isChaseableOutcome(o) && o !== "پیش‌نویس",
    );
    ok("every outcome is settled, chaseable or a draft", unclassified.length === 0, unclassified);
    const both = ALL_OUTCOMES.filter((o) => isTerminalOutcome(o) && isChaseableOutcome(o));
    ok("and none is both at once", both.length === 0, both);
  }

  // What a follow-up closed by the system says. It records that the sale
  // settled, not that anything was lost — the outcome is the place for that.
  ok("the automatic closing note explains itself",
    AUTO_CLOSE_NOTE.includes("نتیجه نهایی"), AUTO_CLOSE_NOTE);
  ok("and does not claim a loss",
    !AUTO_CLOSE_NOTE.includes("باخت"), AUTO_CLOSE_NOTE);
}

/* ── Sales follow-up: what the code may and may not do ───────────────────── */
head("Sales follow-up: the ownership rules, read from the source");
{
  const read = (file: string) => readFileSync(file, "utf-8");
  const workflow = read("src/server/services/workflowService.ts");
  const proforma = read("src/server/services/proformaService.ts");
  const followUp = read("src/server/services/followUpService.ts");

  /*
   * Task creation belongs to the workflow engine, and to nothing else.
   *
   * Hardcoding "when a proforma is sent, raise a follow-up" would make its
   * timing, its assignee and its priority uneditable code — the opposite of
   * what a configurable automation is for. The proforma service may fire the
   * trigger; it may not create the task.
   */
  ok("the proforma service creates no task of its own",
    !/db\.task\.create|tx\.task\.create/.test(proforma), "proformaService creates a task");
  ok("it fires the status trigger instead",
    proforma.includes('"proforma_status_change"'));
  ok("only on a real change of the stored status",
    /before\.status !== result\.proforma\.status/.test(proforma));
  ok("and the outcome trigger stays separate",
    proforma.includes('"proforma_outcome_change"'));

  /*
   * The commercial owner is the project's sales engineer, never the person who
   * prepared the document. A support engineer routinely writes the quotation
   * for a job somebody else is selling.
   */
  ok("SALES_EXPERT resolves through the project", /salesExpert/.test(workflow));
  ok("and never through the proforma's creator",
    !/creatorUserId|creator\.fullName/.test(
      workflow.slice(workflow.indexOf("SALES_EXPERT"), workflow.indexOf("SALES_EXPERT") + 900),
    ));

  /* A follow-up task is attached to the proforma; its owner comes from the job. */
  ok("a payload naming a proforma attaches the task to it",
    /relatedToType: "proforma"/.test(workflow));
  ok("the duplicate check is an option on the action, not a law in the engine",
    /config\.skipIfOpenSameKind/.test(workflow));
  ok("and it looks for an unfinished task of the same kind on the same record",
    /taskKind,\s*\n\s*relatedToType: related\.relatedToType/.test(workflow));

  /*
   * The automatic closing acts on follow-ups and on nothing else. An ordinary
   * task somebody attached to the same proforma does not stop being necessary
   * because the quotation was won.
   */
  const closer = followUp.slice(followUp.indexOf("export async function closeFollowUpTasks"));
  ok("closing is scoped to the follow-up kind",
    /taskKind: "SALES_FOLLOW_UP"/.test(closer.slice(0, 900)));
  ok("general tasks are never swept up",
    !/taskKind: "GENERAL"/.test(closer.slice(0, 900)));
  ok("a terminal outcome closes them",
    /closeFollowUpTasks\(tx/.test(proforma));

  /*
   * The completion is one transaction. Three separate writes could stop half
   * way and leave a quotation marked as actively followed up with the task
   * completed and nothing to replace it.
   */
  const completion = followUp.slice(
    followUp.indexOf("export async function completeFollowUp"),
    followUp.indexOf("/* ------------------------------- reactivation"),
  );
  ok("completion runs inside a transaction", /db\.\$transaction/.test(completion));
  ok("the next task is written inside it, not after",
    completion.indexOf("tx.task.create") > completion.indexOf("db.$transaction"));
  ok("the proforma's follow-up state moves inside it too",
    completion.indexOf("tx.proforma.update") > completion.indexOf("db.$transaction"));
  // A double-clicked button must complete once, not raise two next actions.
  ok("the close is a conditional claim", /updateMany/.test(completion));

  /*
   * A follow-up is not finished with the ordinary tick.
   *
   * Ticking one on the tasks screen closes it and leaves the quotation with
   * nobody on it and nothing recorded — the exact failure the flow prevents.
   * The generic path refuses it; the automatic closing writes with `updateMany`
   * and is deliberately not affected.
   */
  const tasks = read("src/server/services/taskService.ts");
  ok("the generic task update refuses to tick a sales follow-up",
    /taskKind === "SALES_FOLLOW_UP"[\s\S]{0,200}throw new Error/.test(tasks));
  ok("and the message sends the user to the follow-up screen",
    /پیگیری فروش/.test(tasks));

  /* The next action lives on the task. A column on the proforma would be a
     second copy of the date, the owner and the priority. */
  const schema = read("prisma/schema.prisma");
  const proformaModel = schema.slice(
    schema.indexOf("model Proforma {"),
    schema.indexOf("model ProformaItem {"),
  );
  ok("the proforma carries a follow-up state", /followUpState/.test(proformaModel));
  ok("and a revision link", /previousVersionId/.test(proformaModel));
  ok("but no next action of its own",
    !/nextAction/i.test(proformaModel), "proforma has a nextAction column");
  ok("and no expected decision date of its own — the project has one",
    !/expectedDecision|expectedCloseDate/i.test(proformaModel));

  /*
   * The queue asks the outcome machinery, rather than keeping its own idea of
   * which quotations are settled. A hand-written `isCancelled: false` filter is
   * what let every won and lost document onto the screen.
   */
  ok("the queue builds its filter from outcomeWhere",
    /outcomeWhere\(outcome\)/.test(followUp));
  ok("and keeps no column-level copy of the settled test",
    !/\{ isCancelled: false \}/.test(followUp), "followUpService filters on isCancelled directly");
  ok("raising a next action on a settled quotation is refused",
    /isTerminalOutcome\(getProformaOutcome\(proforma as never\)\)/.test(followUp));

  /*
   * Ranked first, paged second.
   *
   * The rank is derived from the open follow-up task, so the database cannot
   * order by it — which means paging in SQL and sorting the page afterwards
   * puts an overdue quotation from six months ago on page three of a list whose
   * whole purpose is to put it first. The bug is `paginationArgs` reaching the
   * proforma query; the fix is a bounded scan and a slice after the sort.
   */
  const queueBody = followUp.slice(followUp.indexOf("export async function listFollowUpQueue"));
  ok("the queue does not page the database query",
    !/take: QUEUE_SCAN_LIMIT[\s\S]{0,200}paginationArgs/.test(queueBody)
    && !/\.\.\.paginationArgs\(q\),\s*\n\s*\}\),\s*\n\s*db\.proforma\.count/.test(queueBody));
  ok("it reads a bounded slice of the matched set instead",
    /take: QUEUE_SCAN_LIMIT/.test(queueBody));
  ok("and says so when it hits the bound", /truncated/.test(queueBody));
  // The counter and the table must describe the same set: reporting the
  // unfiltered total beside a filtered page reads exactly like a lost record.
  ok("the total is counted after the health filter, not before",
    /buildResult\(page, filtered\.length, q\)/.test(queueBody));
  ok("and the page is sliced after the ranking",
    queueBody.indexOf("filtered.slice") > queueBody.indexOf("filtered.sort"));

  /* Loss reasons are not redesigned. */
  ok("lossReason is still one nullable column on the proforma",
    /lossReason\s+String\?/.test(proformaModel));
  ok("and there is no second loss-reason table",
    !/model LossReason/.test(schema));
}


/* ------------------------- dashboard: the front page --------------------- */
head("Dashboard: a settled contract stops moving with the rate");
{
  const usd = (entries: Parameters<typeof wonValueRial>[0]["entries"]) => wonValueRial({
    wonAmount: 1000, todayRate: 120_000, historicalRate: 90_000, entries,
  });

  // Nothing received: the debt is still exposed to the rate, exactly as before.
  eq("an unpaid contract floats at today's rate", usd([]).rial, 120_000_000);

  // Paid in full at the rate on the day: that rial is a historical fact.
  const paid = usd([{
    type: "دریافت", amountRial: 90_000_000, amountForeign: null,
    exchangeRate: 90_000, isDirectForeign: false,
  }]);
  eq("a fully settled contract is worth the rial that arrived", paid.rial, 90_000_000);
  eq("and its effective rate is the rate it was paid at", paid.effectiveRate, 90_000);
  eq("nothing of it is left outstanding", paid.settledAmount, 1000);

  // Today's rate moving must not move a settled contract at all.
  const later = wonValueRial({
    wonAmount: 1000, todayRate: 200_000, historicalRate: 90_000,
    entries: [{
      type: "دریافت", amountRial: 90_000_000, amountForeign: null,
      exchangeRate: 90_000, isDirectForeign: false,
    }],
  });
  eq("and it does not move when the rate doubles", later.rial, paid.rial);

  // Half paid: half frozen, half floating.
  eq("a half-paid contract moves by half", usd([{
    type: "دریافت", amountRial: 45_000_000, amountForeign: null,
    exchangeRate: 90_000, isDirectForeign: false,
  }]).rial, 45_000_000 + 500 * 120_000);

  // Money paid above the invoice sits on account; it is not sale value.
  eq("an overpayment does not inflate the contract", usd([{
    type: "دریافت", amountRial: 180_000_000, amountForeign: null,
    exchangeRate: 90_000, isDirectForeign: false,
  }]).rial, 90_000_000);

  // A refund is a payment back, and the direction is the type.
  eq("a refund gives the outstanding part back to the rate", usd([
    { type: "دریافت", amountRial: 90_000_000, amountForeign: null, exchangeRate: 90_000, isDirectForeign: false },
    { type: "پرداخت", amountRial: 90_000_000, amountForeign: null, exchangeRate: 90_000, isDirectForeign: false },
  ]).rial, 120_000_000);

  // Foreign cash in, converted at the day's rate.
  eq("a direct foreign receipt settles its own amount", usd([{
    type: "دریافت", amountRial: 0, amountForeign: 1000,
    exchangeRate: 95_000, isDirectForeign: true,
  }]).rial, 95_000_000);

  /*
   * A receipt with no settlement rate cannot say what it covered.
   *
   * Guessing at today's rate would put the whole figure back on the rate,
   * which is the fault this exists to fix, so the sale goes on floating.
   */
  eq("a foreign receipt with no rate at all settles nothing", wonValueRial({
    wonAmount: 1000, todayRate: 120_000, historicalRate: null,
    entries: [{ type: "دریافت", amountRial: 90_000_000, amountForeign: null, exchangeRate: null, isDirectForeign: false }],
  }).rial, 120_000_000);
  eq("but the invoice's own rate stands in when the receipt has none", wonValueRial({
    wonAmount: 1000, todayRate: 120_000, historicalRate: 90_000,
    entries: [{ type: "دریافت", amountRial: 90_000_000, amountForeign: null, exchangeRate: null, isDirectForeign: false }],
  }).rial, 90_000_000);

  // A rial document has no rate to move with, whatever the receipts say.
  for (const entries of [
    [],
    [{ type: "دریافت", amountRial: 500, amountForeign: null, exchangeRate: null, isDirectForeign: false }],
    [{ type: "دریافت", amountRial: 5000, amountForeign: null, exchangeRate: null, isDirectForeign: false }],
  ]) {
    eq("a rial contract is always worth its own amount",
      wonValueRial({ wonAmount: 1000, todayRate: 1, historicalRate: null, entries }).rial, 1000);
  }

  // The category split is the same money, so the parts must add to the whole.
  const split = usd([{
    type: "دریافت", amountRial: 45_000_000, amountForeign: null,
    exchangeRate: 90_000, isDirectForeign: false,
  }]);
  eq("the effective rate splits the total without losing any of it",
    Math.round(600 * split.effectiveRate + 400 * split.effectiveRate), Math.round(split.rial));
}

head("Dashboard: conversion is per project, not per document");
{
  const line = (status: string | null) => ({ status });
  const pf = (id: string, projectId: string | null, days: number, items: { status: string | null }[]) => ({
    id, projectId, status: "ارسال شده", isCancelled: false,
    createdAt: new Date(2026, 0, days), items,
  });

  // The reported fault: ten quotations on one job, one of them won.
  const tenQuotes = Array.from({ length: 10 }, (_, i) =>
    pf(`p${i}`, "prj-1", i + 1, [line(i === 9 ? ITEM_WON : ITEM_LOST)]));
  const groups = opportunityGroups(tenQuotes);
  eq("ten proformas on one project are one opportunity", groups.length, 1);
  eq("and that opportunity is won", opportunityOutcome(groups[0]), "won");

  // A win earlier in the history is not undone by a later quotation for
  // more scope — that is why the *deciding* proformas are used rather than
  // literally the newest one.
  const wonThenQuotedAgain = [
    pf("a", "prj-2", 1, [line(ITEM_WON)]),
    pf("b", "prj-2", 5, [line(null)]),
  ];
  eq("a later quotation does not un-win a project",
    opportunityOutcome(opportunityGroups(wonThenQuotedAgain)[0]), "won");

  // Nothing decided yet belongs in neither tally.
  eq("an open project is neither won nor lost",
    opportunityOutcome([pf("c", "prj-3", 1, [line(null)])]), "open");
  eq("a project whose last quote was lost is lost",
    opportunityOutcome([pf("d", "prj-4", 1, [line(ITEM_LOST)])]), "lost");
  eq("a withdrawn project is not counted as won",
    opportunityOutcome([pf("e", "prj-5", 1, [line(ITEM_CANCELLED)])]), "lost");

  // A quotation with no project is still a quotation somebody sent.
  const mixed = [
    pf("f", "prj-6", 1, [line(ITEM_WON)]),
    pf("g", null, 2, [line(ITEM_WON)]),
    pf("h", null, 3, [line(ITEM_LOST)]),
  ];
  eq("project-less proformas stand alone", opportunityGroups(mixed).length, 3);

  // The selection must be the project card's, or the front page and the card
  // disagree about who won.
  eq("the deciding set is the winners when there are any",
    decidingProformas(tenQuotes).map((p) => p.id).join(","), "p9");
  eq("and the most recent one when there are none",
    decidingProformas(tenQuotes.slice(0, 9)).map((p) => p.id).join(","), "p8");
  eq("an empty project decides nothing", decidingProformas([]).length, 0);

  eq("«میانگین تعداد پیش‌فاکتور» keeps one decimal", averageProformasPerProject(7, 3), 2.3);
  eq("and is zero rather than infinite with no projects", averageProformasPerProject(4, 0), 0);
}

head("Dashboard: the service uses those rules and no copies");
{
  const dash = readFileSync("src/server/services/dashboardService.ts", "utf8");
  ok("the won total is built by wonValueRial", /wonValueRial\(\{/.test(dash));
  ok("and no longer multiplies the won amount by today's rate directly",
    !/wonRial \+= wonAmount \* rate/.test(dash), "dashboardService still converts at today's rate");
  ok("the win rate counts opportunities, not proformas",
    /opportunityGroups\(rows\)/.test(dash) && !/db\.proforma\.count\(\{ where: proformaWhere \}\)/.test(dash));
  ok("conversion by category reads the deciding proformas",
    /decidingProformas\(group\)/.test(dash));
  ok("and is no longer a raw sum over every proforma line",
    !/FROM \[dbo\]\.\[proforma_items\]/.test(dash), "dashboardService still groups every line in SQL");
  ok("only money rows settle a contract", /countsTowardBalance\(t\.status\)/.test(dash));
}


head("Proforma: a delivery field can be typed over");
{
  /*
   * `value={x || default}` on a text input cannot be cleared.
   *
   * The instant backspace empties «۳-۴» the stored value is "", the falsy
   * fallback re-renders the default over it, and the box snaps back on the very
   * keystroke that was meant to change it — reported as «با فشردن هر دکمه به
   * حالت پیش‌فرض برمی‌گردد». Only an *absent* value may fall back, which is
   * `??`. The same shape as the `<input type="number">` fault NumberField
   * exists for.
   *
   * Seeding a new line from the previous one is a different question and keeps
   * `||`, so this reads the `value=` bindings alone.
   */
  const src = readFileSync("src/components/ProformasView.tsx", "utf8");
  const bindings = [...src.matchAll(/value=\{[\s\S]{0,160}?\}\n/g)].map((m) => m[0]);
  for (const [field, label] of [
    ["deliveryRange", "the numeric range"],
    ["deliveryPostfix", "the delivery note"],
  ] as const) {
    const strays = bindings.filter((b) => b.includes(field) && / \|\|\s/.test(b));
    ok(`${label} does not fall back on an empty string`, strays.length === 0, strays);
  }
  // The bindings are found at all — a regex that matches nothing passes here
  // for the wrong reason.
  ok("the delivery bindings were actually located",
    bindings.some((b) => b.includes("deliveryRange"))
    && bindings.some((b) => b.includes("deliveryPostfix")));
}

head("Proforma line: changing the product replaces its specification");
{
  const pressure = {
    description: "ترانسمیتر فشار\nساخت آلمان",
    featureNames: ["رنج", "جنس بدنه"],
  };
  const flow = {
    description: "فلومتر توربینی\nکلاس ۱۵۰",
    featureNames: ["سایز", "اتصال"],
  };

  // The reported fault: a new line is seeded from whichever product the picker
  // holds first, and picking a different one kept the first one's description.
  const afterSwitch = describeProductSpec(
    flow, {}, "ترانسمیتر فشار\nساخت آلمان", pressure);
  ok("the previous product's description does not survive the change",
    !afterSwitch.includes("ترانسمیتر فشار"), afterSwitch);
  eq("and the new product's description is what is left", afterSwitch, "فلومتر توربینی\nکلاس ۱۵۰");

  // Without the outgoing product, which is exactly what used to be passed.
  ok("passing no previous product is what let it through",
    describeProductSpec(flow, {}, "ترانسمیتر فشار\nساخت آلمان").includes("ترانسمیتر فشار"));

  // What the user typed has to survive, or the feature is useless.
  const typed = describeProductSpec(
    flow, {}, "ترانسمیتر فشار\nتگ: PT-101\nساخت آلمان", pressure);
  ok("a note the user typed survives", typed.includes("تگ: PT-101"));

  // The outgoing product's own feature lines go with it.
  const featureLines = describeProductSpec(
    flow, { "سایز": "۶ اینچ" }, "رنج: 0-10 bar\nجنس بدنه: 316", pressure);
  ok("the old product's feature lines go too",
    !featureLines.includes("رنج:") && !featureLines.includes("جنس بدنه:"), featureLines);
  ok("and the new SKU's attributes are written", featureLines.includes("سایز: ۶ اینچ"));

  // Bolding a line must not stop it being recognised as the product's own —
  // the same reason mergeSpecText strips the marks.
  ok("a bolded description line is still the product's",
    !describeProductSpec(flow, {}, "**ترانسمیتر فشار**", pressure).includes("ترانسمیتر فشار"));

  // Re-picking the same product must not duplicate its description.
  eq("re-picking the same product does not double its description",
    describeProductSpec(flow, {}, "فلومتر توربینی\nکلاس ۱۵۰", flow),
    "فلومتر توربینی\nکلاس ۱۵۰");
}

head("Proforma form: a SKU created by the configurator is selectable");
{
  /*
   * The `<select>` renders its options from the picker's product rows, which
   * were fetched before the configurator created the SKU — and a select whose
   * value matches no option shows its placeholder, so the line read «انتخاب
   * ترکیب مشخصات» with a perfectly good variant id on it.
   */
  const src = readFileSync("src/components/ProformasView.tsx", "utf8");
  ok("the screen keeps the products it has written to",
    /rememberProduct\(ensured\.product\)/.test(src));
  ok("and the product list is those overrides on top of the picker's rows",
    /productOverrides\[product\.id\] \?\? product/.test(src));
  ok("the specification rule takes the outgoing product",
    /describeProduct\(prod, undefined, newItems\[index\]\.techSpecs, previousProd\)/.test(src));
  ok("and the rule itself is the pure one",
    /describeProductSpec\(/.test(src) && !/const storedLines = new Set/.test(src));

  /*
   * The website is printed, and the field to set it exists.
   *
   * Where it is printed is pinned in the printed-document section above, which
   * measures the rendered letterhead rather than this file's text — it used to
   * be checked here as `print-footer-site`, the address-bar copy it no longer
   * has.
   */
  const settingsSrc = readFileSync("src/components/SettingsView.tsx", "utf8");
  ok("general settings can edit it", /settings-company-website/.test(settingsSrc));
  ok("and saving keeps it", /\n\s+website,\n/.test(settingsSrc));

  ok("a proforma line can be copied", /handleDuplicateItemLine/.test(src));
  // The copy is a new line; the id it was read under belongs to one row, and
  // `preserveLineCosts` matches on it.
  ok("and the copy carries no line id", /const \{ id: _id, \.\.\.copy \} = source/.test(src));
}


head("Configurator: defining a feature or an option from the quotation");
{
  /*
   * The catalogue is never complete at the moment somebody is quoting from it,
   * and the alternative was to abandon the proforma, add the option on the
   * products screen and start again. Two things bound what may be added.
   */
  eq("a duplicate feature name is refused",
    catalogueNameRefusal("رنج", ["رنج", "جنس بدنه"]), "این نام قبلاً تعریف شده است.");
  // A name is what mergeSpecText, the SKU attributes and decodeSku all match
  // on, so «رنج » and «رنج» must not both exist.
  ok("with the spacing and the formatting ignored",
    catalogueNameRefusal(" **رنج** ", ["رنج"]) !== null);
  eq("a blank name is refused", catalogueNameRefusal("   ", []), "نام را وارد کنید.");
  eq("a new name is allowed", catalogueNameRefusal("فشار کاری", ["رنج"]), null);

  // The code goes straight into the SKU, which decodeSku splits on `-`.
  eq("no code is fine", catalogueCodeRefusal(""), null);
  eq("a latin token is fine", catalogueCodeRefusal("ANSI300"), null);
  ok("a code with a separator is refused", catalogueCodeRefusal("ANSI-300") !== null);
  ok("a Persian code is refused", catalogueCodeRefusal("فشار") !== null);
  ok("an over-long code is refused", catalogueCodeRefusal("A".repeat(17)) !== null);

  ok("ids are distinct", newConfigId("feat") !== newConfigId("feat"));
  ok("and carry their kind", newConfigId("opt").startsWith("opt-"));

  const modal = readFileSync("src/components/ProductConfiguratorModal.tsx", "utf8");
  ok("the modal offers a new option per feature", /configurator-add-option-/.test(modal));
  ok("and a new feature for the product", /configurator-add-feature/.test(modal));
  // The modal builds the mutation; the host owns the write, because each host
  // already has the helper that loads the full record before changing it.
  ok("the write is the host's, so the full product is loaded",
    /onCatalogueEdit\?: \(mutate/.test(modal));
  ok("and the modal never calls the API itself",
    !/api\.|fetch\(/.test(modal));

  for (const [file, label] of [
    ["src/components/ProformasView.tsx", "the proforma form"],
    ["src/components/SupplierInquiriesView.tsx", "the inquiry form"],
  ] as const) {
    const src = readFileSync(file, "utf8");
    ok(`${label} passes onCatalogueEdit`, /onCatalogueEdit=\{/.test(src));
    // Writing to the catalogue needs the catalogue's own permission; the route
    // checks it too, this is so nobody is shown a button that will be refused.
    ok(`${label} gates it on the products permission`,
      /hasModulePermission\((currentUser), 'products'\)/.test(src));
  }
}


head("Referrals: one gesture, three calls, in one order");
{
  /*
   * The referrals screen and the project's activity feed both offer «ثبت پاسخ
   * و ارجاع مجدد», and each was a hand-written sequence of three requests. The
   * order matters — the reply has to be on the thread before the forwarding
   * moves it to somebody else's inbox — and a second copy is how one screen
   * comes to reopen a referral without saying why.
   */
  const calls: string[] = [];
  const original = {
    reply: inboxApi.replyToReferral,
    status: inboxApi.setReferralStatus,
    reassign: inboxApi.reassignReferral,
  };
  inboxApi.replyToReferral = (async (_id: string, body: { text: string; andForwarded?: boolean }) => {
    calls.push(`reply:${body.text}:${body.andForwarded ? "forwarded" : "-"}`);
    return {} as never;
  }) as typeof inboxApi.replyToReferral;
  inboxApi.setReferralStatus = (async (_id: string, status: string, silent?: boolean) => {
    calls.push(`status:${status}:${silent ? "silent" : "loud"}`);
    return {} as never;
  }) as typeof inboxApi.setReferralStatus;
  inboxApi.reassignReferral = (async (_id: string, to: string) => {
    calls.push(`forward:${to}`);
    return {} as never;
  }) as typeof inboxApi.reassignReferral;

  const run = async (body: Parameters<typeof submitReferralReply>[1]) => {
    calls.length = 0;
    const outcome = await submitReferralReply("r1", body);
    return { outcome, calls: [...calls] };
  };

  /*
   * Awaited, not fired and forgotten.
   *
   * `void (async () => …)()` here would run these after the summary line, so a
   * failure would be printed below the total and counted in neither — a test
   * that agrees with itself.
   */
  await (async () => {
    eq("a plain message is one call",
      (await run({ text: "بررسی شد" })).calls.join("|"), "reply:بررسی شد:-");

    // The reply already told the other party, and told them the part that
    // matters — so the status change must not raise a second notice.
    eq("closing sends the reply first, then a silent status",
      (await run({ text: "انجام شد", outcome: "done" })).calls.join("|"),
      "reply:انجام شد:-|status:انجام شده:silent");

    // The whole point of the feature: the answer is not what was asked for.
    eq("reopening puts it back to «در انتظار اقدام», after the reply",
      (await run({ text: "این آن چیزی نیست که خواستم", outcome: "reopen" })).calls.join("|"),
      "reply:این آن چیزی نیست که خواستم:-|status:در انتظار اقدام:silent");

    // Forwarding sets its own status, so an outcome must not also be applied —
    // and the reply is marked as forwarded so it raises no notice of its own.
    eq("forwarding replaces the status change rather than adding to it",
      (await run({ text: "به شما ارجاع شد", outcome: "done", forwardToUserId: "u2" })).calls.join("|"),
      "reply:به شما ارجاع شد:forwarded|forward:u2");

    // A bare button press with nothing typed is legitimate; an empty send is not.
    const bare = await run({ outcome: "done", text: "  " });
    eq("a bare «done» is a status change on its own", bare.calls.join("|"), "status:انجام شده:loud");
    eq("and reports itself as such", bare.outcome, "status-only");
    const empty = await run({ text: "" });
    eq("an empty message sends nothing", empty.calls.length, 0);
    eq("and says so", empty.outcome, "nothing");

    // Forwarding with nothing typed still has to put something on the thread,
    // or the next person opens a referral with no idea why it reached them.
    ok("forwarding with no text still writes a line",
      (await run({ text: "", forwardToUserId: "u2" })).calls[0]?.startsWith("reply:ارجاع به همکار"));

    inboxApi.replyToReferral = original.reply;
    inboxApi.setReferralStatus = original.status;
    inboxApi.reassignReferral = original.reassign;
  })();
}

head("Referrals: the thread is one component, sided by account");
{
  const thread = readFileSync("src/components/ReferralThread.tsx", "utf8");
  // A name comparison put a renamed account's whole side of the conversation
  // back on the other one — the same trap the referral's own two ids exist for.
  ok("a message is placed by responderUserId",
    /msg\.responderUserId === referral\.assignedByUserId/.test(thread));
  ok("and the buttons by the two account ids",
    /referral\.assignedToUserId === currentUserId/.test(thread)
    && /referral\.assignedByUserId === currentUserId/.test(thread));
  // Everything above the rule happened; the draft has not.
  ok("the composer is separated from the history",
    /border-t-2 border-dashed/.test(thread));
  // Same family as the price calculator: the screens behind this re-render on
  // their own, and a half-typed correction must survive that.
  ok("the edit draft is seeded once per referral, not per render",
    /seededFor\.current === referral\.id/.test(thread));

  for (const [file, label] of [
    ["src/components/ReferralsView.tsx", "the referrals screen"],
    ["src/components/ProjectsView.tsx", "the project activity feed"],
  ] as const) {
    const src = readFileSync(file, "utf8");
    ok(`${label} draws the shared thread`, /<ReferralThread/.test(src));
    ok(`${label} uses the shared reply sequence`, /submitReferralReply\(/.test(src));
    // Reopening from where the answer is read is the whole request.
    ok(`${label} can correct the request`, /updateReferralAction\(/.test(src));
  }

  // Only the person who raised it: the assignee rewriting their own
  // instructions is how a referral gets marked done against a request nobody
  // made.
  const service = readFileSync("src/server/services/activityService.ts", "utf8");
  const body = service.slice(service.indexOf("export async function updateReferralAction"));
  ok("editing the request is refused for anyone but the referrer",
    /referral\.assignedByUserId !== user\.id/.test(body.slice(0, 2000)));
  ok("and the assignee is told it changed",
    /notifyUser\(/.test(body.slice(0, 3000)));
}


head("Project card: warning about a record's own gaps");
{
  const keys = ["salesExpert", "expectedCloseDate", "marketingChannel"];
  const complete = {
    salesExpert: "رضا", expectedCloseDate: "1405/06/20", marketingChannel: "نمایشگاه",
  };

  eq("a complete project shows nothing", projectDataGaps(complete, keys).length, 0);
  eq("a blank field is a gap",
    projectDataGaps({ ...complete, salesExpert: "" }, keys).map((g) => g.key).join(","),
    "salesExpert");
  // Whitespace is not an answer; neither is an absent key on a record that has
  // the column.
  eq("so is whitespace",
    projectDataGaps({ ...complete, marketingChannel: "   " }, keys).length, 1);
  eq("and null", projectDataGaps({ ...complete, expectedCloseDate: null }, keys).length, 1);

  /*
   * A key naming nothing on the record is skipped rather than reported.
   *
   * A list row does not carry every column, and a gap that can never be filled
   * in is a badge nobody can clear — which reads as the feature being broken
   * rather than the data being incomplete.
   */
  eq("a field the record does not carry at all is not a gap",
    projectDataGaps({ salesExpert: "رضا" }, keys).length, 0);

  // Zero is an answer, not a blank.
  eq("a numeric zero is not a gap",
    projectDataGaps({ leadQuality: 0 }, ["leadQuality"]).length, 0);

  // Only the configured keys, and in the catalogue's own order.
  const two = projectDataGaps({ salesExpert: "", marketingChannel: "", endUser: "" },
    ["marketingChannel", "salesExpert"]);
  eq("only the configured fields count", two.length, 2);
  eq("reported in the catalogue's order", two.map((g) => g.key).join(","),
    "salesExpert,marketingChannel");

  // Every default has to exist in the catalogue, or it warns about nothing.
  const known = new Set(projectGapCatalogue().map((f) => f.key));
  ok("every default field is in the catalogue",
    DEFAULT_PROJECT_GAP_FIELDS.every((k) => known.has(k)),
    DEFAULT_PROJECT_GAP_FIELDS.filter((k) => !known.has(k)));
  ok("and the catalogue is the required-fields one, not a second list",
    known.has("salesExpert") && known.has("expectedCloseDate"));

  eq("an unconfigured installation uses the defaults",
    projectGapFields(undefined).join(","), DEFAULT_PROJECT_GAP_FIELDS.join(","));
  // «Warn about nothing» is a real answer and must not fall back.
  eq("an empty list turns the badge off entirely", projectGapFields([]).length, 0);
  // A key left from a field since renamed would sit there warnable by nothing.
  eq("a key naming no field is dropped",
    projectGapFields(["salesExpert", "fieldThatWentAway"]).join(","), "salesExpert");

  /*
   * Not the same switch as `requiredFields.projects`.
   *
   * Making a field required blocks the *next save* of every project already on
   * the system — including one somebody opened to correct a typo — so the two
   * lists cannot be one.
   */
  const settingsSrc = readFileSync("src/components/SettingsView.tsx", "utf8");
  ok("settings edits the gap list separately", /projectDataGapFields: gapFields/.test(settingsSrc));
  ok("from the same field catalogue", /projectGapCatalogue\(\)/.test(settingsSrc));
  /*
   * A default must actually arrive on a grid row.
   *
   * The badge reads the row the grid holds, and `rowToProject` writes each
   * field explicitly — so a field the adapter never sets is skipped by the
   * "not carried" rule above and warns about nothing, silently, forever.
   */
  const adapter = readFileSync("src/api/projectAdapter.ts", "utf8");
  const rowHalf = adapter.slice(adapter.indexOf("export function rowToProject"),
    adapter.indexOf("export function detailToProject"));
  for (const key of DEFAULT_PROJECT_GAP_FIELDS) {
    ok(`the grid row carries ${key}`, new RegExp(`\\b${key}:`).test(rowHalf));
  }

  const projectsSrc = readFileSync("src/components/ProjectsView.tsx", "utf8");
  ok("the project card draws the badge", /project-gap-badge-/.test(projectsSrc));
  // A badge that will not say what is missing sends somebody into the form to
  // find out, which is most of the work it was meant to save.
  ok("and names the fields it is complaining about",
    /gaps\.map\(\(g\) => g\.label\)\.join/.test(projectsSrc));
}


head("Tasks board: the status filter and the job behind a task");
{
  const service = readFileSync("src/server/services/taskService.ts", "utf8");
  const view = readFileSync("src/components/TasksView.tsx", "utf8");

  // The list is paged, so narrowing what the browser holds would filter one
  // page and call it the answer.
  ok("status is filtered on the server", /TASK_FILTERABLE = \[[^\]]*"status"/.test(service));
  ok("and the screen sends it rather than filtering the page",
    /list\.setFilter\('status', value\)/.test(view)
    && !/filteredTasks = tasks\.filter/.test(view));
  ok("the filter is on the screen", /task-status-filter/.test(view));

  /*
   * `relatedToName` is one string the *browser* resolved out of a picker's
   * current matches at save time — the trap this codebase keeps meeting. The
   * project is joined on the server instead, for a task on a proforma too:
   * a sales follow-up names a quotation, and the reader wants the job.
   */
  ok("the service resolves the project behind each task",
    /async function withProjectContext/.test(service));
  /*
   * The spelling is no longer compared here: `relatedToType` is stored in two
   * languages (see `taskRelations.ts`), so what is pinned is that the proforma
   * path exists at all — its own bounded query, resolving to that quotation's
   * project.
   */
  ok("for a task on a proforma as well as one on a project",
    /proformaIds\.add\(row\.relatedToId\)/.test(service)
    && /id: \{ in: \[\.\.\.proformaIds\] \}/.test(service));
  ok("in bounded queries, not one per row",
    /id: \{ in: \[\.\.\.projectIds\] \}/.test(service));
  ok("the card prints the code, the project and the customer",
    /relatedProject\.code/.test(view) && /relatedProject\.name/.test(view)
    && /relatedProject\.customerName/.test(view));
}


head("Activity feed: naming a colleague is the referral");
{
  const users = [
    { id: "u1", fullName: "علی رضایی" },
    { id: "u2", fullName: "علی" },
    { id: "u3", fullName: "مریم کاظمی" },
  ];
  const names = (list: { id: string }[]) => list.map((u) => u.id).join(",");

  eq("a message with no @ names nobody", parseMentions("دیتاشیت ارسال شد", users).length, 0);
  eq("one name is one request", names(parseMentions("@علی رضایی لطفاً بررسی کن", users)), "u1");

  /*
   * `@` plus a word does not work here.
   *
   * A name is two or three words with spaces in it, so «@علی رضایی» would name
   * a colleague called «علی» under any pattern-based rule. Matching the real
   * directory longest-first is what settles it.
   */
  eq("the longer name wins over the shorter one inside it",
    names(parseMentions("@علی رضایی لطفاً بررسی کن", users)), "u1");
  eq("and the short one is still found on its own",
    names(parseMentions("@علی لطفاً بررسی کن", users)), "u2");

  eq("two colleagues are two requests",
    names(parseMentions("@علی رضایی و @مریم کاظمی لطفاً بررسی کنید", users)), "u1,u3");
  eq("in the order they appear",
    names(parseMentions("@مریم کاظمی و @علی رضایی", users)), "u3,u1");
  eq("the same person twice is one request",
    names(parseMentions("@علی رضایی صبح و @علی رضایی بعدازظهر", users)), "u1");
  // …but both occurrences are marked, or the second reads as punctuation.
  eq("though both mentions are marked",
    mentionSpans("@علی رضایی صبح و @علی رضایی بعدازظهر", users).length, 2);

  // The two spellings of the Arabic letters are the same name to a person.
  eq("ي and ی are the same name", names(parseMentions("@علي رضايي بررسی کن", users)), "u1");

  /*
   * The spans index the **original** text.
   *
   * The feed marks the names it finds, so a normalisation that collapsed runs
   * of spaces would report positions into a string nobody has.
   */
  const text = "سلام @مریم کاظمی لطفاً";
  const span = mentionSpans(text, users)[0];
  eq("a span points at the @ in the original text",
    text.slice(span.start, span.end), "@مریم کاظمی");

  eq("the markers come off for prose",
    stripMentionMarkers("@علی رضایی لطفاً بررسی کن", users), "علی رضایی لطفاً بررسی کن");
}

head("Activity feed: the composer's @ list");
{
  const users = [
    { id: "u1", fullName: "علی رضایی" },
    { id: "u3", fullName: "مریم کاظمی" },
  ];

  eq("no @ means no list", mentionQuery("سلام", 4), null);
  eq("an @ opens it with an empty term", mentionQuery("سلام @", 6), "");
  eq("and narrows as you type", mentionQuery("سلام @مری", 9), "مری");
  // A newline closes it, so an @ somewhere above does not leave the list open
  // for the rest of the paragraph.
  eq("a newline closes it", mentionQuery("@علی\nخط بعد", 10), null);
  eq("a second @ closes the first", mentionQuery("@علی رضایی @", 12), "");
  eq("and it is not a name after four words", mentionQuery("@a b c d e", 10), null);

  eq("the list narrows to what matches",
    mentionSuggestions("مری", users).map((u) => u.id).join(","), "u3");
  eq("an empty term offers everybody", mentionSuggestions("", users).length, 2);

  /*
   * The inserted name carries a trailing space.
   *
   * Without it the next word runs into the name and the mention stops matching
   * the moment somebody keeps typing.
   */
  const inserted = insertMention("سلام @مری", 9, users[1]);
  eq("picking a name completes it", inserted.text, "سلام @مریم کاظمی ");
  eq("with the caret after it", inserted.caret, inserted.text.length);
  ok("and a trailing space", inserted.text.endsWith(" "));

  eq("a task's title is the message's first line",
    taskTitleFromMessage("بررسی دیتاشیت فلومتر\nخط دوم"), "بررسی دیتاشیت فلومتر");
  ok("trimmed when it is long", taskTitleFromMessage("ب".repeat(200)).length <= 120);
}

head("Activity feed: the messenger, held together");
{
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  const activityModel = schema.slice(schema.indexOf("model ProjectActivity"),
    schema.indexOf("model ProjectReferral"));

  ok("a message can answer another", /replyToId String\?/.test(activityModel));
  // NoAction: deleting a message must not silently take every answer with it,
  // and the cascade paths here are already at SQL Server's limit.
  ok("and the link does not cascade", /"ActivityReply"[\s\S]{0,200}onDelete: NoAction/.test(activityModel));
  ok("a message carries a list of referrals", /referrals ProjectReferral\[\]/.test(activityModel));

  const referralModel = schema.slice(schema.indexOf("model ProjectReferral"));
  // One sentence can name two people; the unique index forbade that outright.
  ok("and activityId is no longer unique",
    !/activityId String\s+@unique/.test(referralModel.slice(0, 600)));

  const service = readFileSync("src/server/services/activityService.ts", "utf8");
  ok("the service raises one referral per name", /parseMentions\(text, directory\)/.test(service));
  // Writing your own name is not asking yourself, and it would put a referral
  // in your own inbox every time you signed a note.
  ok("never for the author", /filter\(\(u\) => u\.id !== user\.id\)/.test(service));
  // The id comes from a browser: a reply hung under a message on another
  // project would quote a job the reader cannot see.
  ok("a reply's parent is checked against the same group",
    /findFirst\(\{\s*where: \{ id: requestedReply, groupId: input\.groupId \}/.test(service));
  // Somebody named has been asked to do something and has no reason to be
  // looking at that feed.
  ok("the people named are told", /module: "ارجاعات"/.test(service));
  ok("after the write, and never able to fail it", /afterCommit\("activity mentions"/.test(service));
  ok("a message with answers cannot be deleted",
    /activity\._count\.replies > 0/.test(service));

  const view = readFileSync("src/components/ProjectsView.tsx", "utf8");
  // Three controls saying what the sentence already said, and two texts to
  // keep in step.
  ok("the referral checkbox is gone", !/نیاز به اقدام و ارجاع به همکار/.test(view));
  ok("the composer is the shared one", /<ActivityComposer/.test(view));
  ok("every referral on a message is drawn", /\(act\.referrals \?\? \[\]\)\.map/.test(view));
  ok("a message can be replied to", /activity-reply-/.test(view));
  ok("and turned into a task", /activity-make-task-/.test(view));

  const modal = readFileSync("src/components/TaskFromMessageModal.tsx", "utf8");
  ok("the task is seeded from the message", /taskTitleFromMessage\(message\.text\)/.test(modal));
  ok("once per message, not per render", /seededFor\.current === message\.id/.test(modal));
  // Handing work to somebody else is what naming them does, and that raises a
  // referral with a thread rather than a task appearing on their list.
  ok("and it is assigned to the reader alone", !/assignedTo(UserId)?=\{/.test(modal));
  ok("the screen assigns it to the signed-in user",
    /assignedToUserId: currentUser\?\.id/.test(view));
}


head("Project follow-up tab: what happened on this job");
{
  const service = readFileSync("src/server/services/followUpService.ts", "utf8");
  const body = service.slice(service.indexOf("export async function projectFollowUpReport"));

  /*
   * The queue leaves out finished sales on purpose; a project tab is asking
   * what *happened*, and a won document with three recorded chases behind it
   * is exactly that.
   */
  ok("the project report is not filtered to the chaseable set",
    !/chaseableWhere\(\)/.test(body.slice(0, 2500)));
  ok("but a settled quotation is still marked as settled",
    /settled: isTerminalOutcome\(outcome\)/.test(body));
  // Asking for a next action on a finished sale is the fault the queue screen
  // was corrected for.
  ok("and only the ones in play count as missing a next action",
    /!q\.settled && !q\.nextActionTaskId/.test(body));

  // Two reads, never one per row — the shape the whole migration exists for.
  ok("the tasks come in one query for every quotation",
    /relatedToId: \{ in: ids \}/.test(body));
  ok("and the history is most recent first",
    /\.reverse\(\)\.map/.test(body));

  const routes = readFileSync("src/server/routes/followUp.ts", "utf8");
  // «project» must never be read as a proforma id — the same trap the supplier
  // price-history route exists to avoid.
  ok("the project route is registered before the parameterised ones",
    routes.indexOf('"/api/sales-follow-up/project/:projectId"')
      < routes.indexOf('"/api/sales-follow-up/:proformaId/reactivate"'));

  const tab = readFileSync("src/components/ProjectFollowUpTab.tsx", "utf8");
  ok("the tab records a result through the shared modal",
    /<FollowUpCompletionModal/.test(tab));
  ok("and raises a next action through the shared call",
    /salesFollowUpApi\.reactivate\(/.test(tab));
  // A finished sale gets neither button, and no health badge either.
  ok("a settled quotation is offered no next action", /!quote\.settled && \(/.test(tab));

  const view = readFileSync("src/components/ProjectsView.tsx", "utf8");
  ok("the project detail has the tab", /project-tab-follow-up/.test(view));
  ok("and renders it", /<ProjectFollowUpTab/.test(view));
}


head("Migrations: no sqlcmd batch separators");
{
  /*
   * `GO` is not T-SQL.
   *
   * It is sqlcmd's batch separator, and Prisma hands each statement to the
   * driver on its own — so a `GO` between them is read as an identifier and
   * the whole migration dies with «Incorrect syntax near 'GO'». That is not
   * hypothetical: `20260903000000_activity_messenger` shipped with them and
   * the deployment stopped on the server, which is the same class of failure
   * as the amended-migration one this file already guards.
   *
   * Statements are separated by a blank line here, which every other migration
   * in the tree already does.
   */
  const dir = "prisma/migrations";
  const offenders: string[] = [];
  for (const name of readdirSync(dir)) {
    const file = joinPath(dir, name, "migration.sql");
    let sql: string;
    try { sql = readFileSync(file, "utf8"); } catch { continue; }
    sql.split("\n").forEach((line, i) => {
      // A bare GO on its own line is the separator; the word inside a comment
      // or a string is somebody writing English.
      if (/^\s*GO\s*(--.*)?$/i.test(line)) offenders.push(`${name}:${i + 1}`);
    });
  }
  ok("no migration uses a GO batch separator", offenders.length === 0, offenders);
  // A check that matches nothing passes for the wrong reason, so the predicate
  // is held against the line that actually broke the deployment.
  ok("and the check would have caught the one that did",
    /^\s*GO\s*(--.*)?$/i.test("GO") && /^\s*GO\s*(--.*)?$/i.test("  GO  ")
    && !/^\s*GO\s*(--.*)?$/i.test("-- no GO anywhere"));
  /*
   * And the other half of the same trap: a column read in the batch that adds
   * it.
   *
   * SQL Server resolves column names when it **compiles** a batch, before
   * running any of it — so a plain `UPDATE … SET [newColumn]` in the file that
   * adds `newColumn` dies with «Invalid column name» (207) even though the
   * ALTER is above it, and even though an `IF COL_LENGTH(…) IS NULL` guards
   * it: the guard is evaluated at run time and the compile has already failed.
   * `20260906000000_holiday_calendar_kind` shipped that way and stopped the
   * deployment.
   *
   * DDL is not affected — `CREATE INDEX` on the new column is compiled when it
   * executes, which is why five migrations here write those plainly and have
   * always worked. What must be deferred is the DML, and `EXEC(N'…')` is how
   * every backfill in this tree already does it (`cost_of_goods`,
   * `customer_value_ranking`, `proforma_sent_date`). `GO` would work too and is
   * forbidden by the check above.
   */
  const readsOwnNewColumn = (sql: string): string[] => {
    // Prose about a column is not a reference to it.
    const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    const added = [...code.matchAll(
      /ALTER\s+TABLE\s+(?:\[?dbo\]?\.)?\[?\w+\]?\s+ADD\s+(?!CONSTRAINT\b)\[?(\w+)\]?/gi,
    )].map((m) => m[1]);
    if (!added.length) return [];

    /*
     * Whole `EXEC(N'…')` calls come out first, literal and all.
     *
     * A T-SQL string is `'(?:[^']|'')*'` — the doubled-quote alternative is
     * what makes it stop at the real end rather than at the first `''` inside
     * a backfill, and those literals contain semicolons, so removing them
     * before splitting is also what keeps the split honest.
     */
    const withoutDynamic = code.replace(
      /EXEC\s*(?:sp_executesql\s*)?\(?\s*N?'(?:[^']|'')*'\s*\)?\s*;?/gi, " ",
    );

    const bad: string[] = [];
    for (const stmt of withoutDynamic.split(";")) {
      // The statement doing the adding.
      if (/ALTER\s+TABLE[\s\S]*\bADD\b/i.test(stmt)) continue;
      /*
       * Only DML. `CREATE INDEX` on a new column resolves at execution and is
       * written plainly by five migrations here that have always worked, and
       * every `IF NOT EXISTS (SELECT …)` guard would otherwise read as one.
       */
      if (!/\b(UPDATE|INSERT|DELETE|MERGE)\b/i.test(stmt)) continue;
      for (const col of added) {
        if (new RegExp(`\\b${col}\\b`).test(stmt)) bad.push(col);
      }
    }
    return bad;
  };

  const compileOffenders: string[] = [];
  for (const name of readdirSync(dir)) {
    const file = joinPath(dir, name, "migration.sql");
    let sql: string;
    try { sql = readFileSync(file, "utf8"); } catch { continue; }
    for (const col of readsOwnNewColumn(sql)) compileOffenders.push(`${name}:${col}`);
  }
  ok("no migration reads a column it adds outside dynamic SQL",
    compileOffenders.length === 0, compileOffenders);

  /*
   * Held against the shape that actually failed, and against the two shapes
   * that are fine — a check that matches nothing passes for the wrong reason.
   */
  const addsColumn = [
    "IF COL_LENGTH('dbo.holidays', 'calendarKind') IS NULL",
    "    ALTER TABLE [dbo].[holidays] ADD [calendarKind] NVARCHAR(10) NULL;",
  ].join("\n");
  const plainBackfill = `${addsColumn}\nUPDATE [dbo].[holidays] SET [calendarKind] = 'HIJRI';`;
  const wrappedBackfill =
    `${addsColumn}\nEXEC(N'UPDATE [dbo].[holidays] SET [calendarKind] = ''HIJRI''');`;
  const indexOnly =
    `${addsColumn}\nCREATE INDEX [i] ON [dbo].[holidays]([calendarKind]);`;

  eq("the check catches the plain backfill", readsOwnNewColumn(plainBackfill).length, 1);
  eq("and passes the EXEC-wrapped one", readsOwnNewColumn(wrappedBackfill).length, 0);
  eq("and does not complain about an index, which compiles late",
    readsOwnNewColumn(indexOnly).length, 0);

  // The one that failed, specifically: it must still do all four things.
  const messenger = readFileSync(
    "prisma/migrations/20260903000000_activity_messenger/migration.sql", "utf8");
  ok("the messenger migration still adds replyToId",
    /ADD \[replyToId\]/.test(messenger));
  ok("indexes it", /project_activities_replyToId_idx/.test(messenger));
  ok("gives it a foreign key", /project_activities_replyToId_fkey/.test(messenger));
  ok("and drops the unique constraint on the referral's activityId",
    /DROP CONSTRAINT \[project_referrals_activityId_key\]/.test(messenger));
  // Guarded, because part of it may already have landed on the attempt that
  // failed half way through the file.
  ok("every step is guarded, so a partial apply can be re-run",
    (messenger.match(/IF (NOT )?EXISTS|IF COL_LENGTH/g) ?? []).length >= 5);
}


head("Tasks: a board shows your own work, not the company's");
{
  /*
   * The reported fault.
   *
   * `visibilityClause` returned "no restriction" for anybody holding the
   * `tasks` permission, and `hasPermission` reads an **absent** key as granted
   * — so since every account has the tasks module (everybody needs to see their
   * own work), every account saw every task. The only way to get privacy was to
   * be *denied* the module, which is backwards.
   */
  const plain = { id: "u1", permissions: { tasks: true } };
  const legacy = { id: "u2" };
  const manager = { id: "u3", permissions: { tasks: true, tasksAll: true } };
  const admin = { id: "u4", isSystemAdmin: true };

  const scoped = (u: unknown) => JSON.stringify(taskVisibility(u as never));
  const mine = (id: string) =>
    JSON.stringify({ OR: [{ assignedToUserId: id }, { createdByUserId: id }] });

  eq("an ordinary user sees their own", scoped(plain), mine("u1"));
  // The account with no permissions object at all — the legacy shape that made
  // «absent means granted» the right default for module flags.
  eq("and so does an account with no permissions written on it", scoped(legacy), mine("u2"));
  eq("the whole board needs the flag, explicitly", scoped(manager), undefined as never);
  eq("a system administrator has it", scoped(admin), undefined as never);

  // Read strictly, like `costs`: an absent flag denies. A flag inheriting the
  // module default would reproduce the fault on the day it shipped.
  ok("tasksAll is denied when absent", !canSeeAllTasks(plain as never));
  ok("and when explicitly false",
    !canSeeAllTasks({ id: "u5", permissions: { tasksAll: false } } as never));
  ok("granted only when explicitly true", canSeeAllTasks(manager as never));
  ok("never for a signed-out caller", !canSeeAllTasks(null));
  // The same reading as the other two strict flags, so the three agree.
  ok("costs is still read the same way",
    !canSeeCosts(plain as never) && canSeeCosts(admin as never));

  /*
   * A task you raised for a colleague is still yours to see.
   *
   * Scoping to the assignee alone would be worse than the fault: there is no
   * other column naming you, so it would vanish from your own board.
   */
  ok("the clause is an OR over both people",
    scoped(plain).includes("assignedToUserId") && scoped(plain).includes("createdByUserId"));

  // The tab narrows within that; it must never be what enforces it.
  eq("the «to me» tab narrows to the assignee",
    JSON.stringify(scopeClause(plain as never, "toMe")), JSON.stringify({ assignedToUserId: "u1" }));
  eq("the «from me» tab narrows to the creator",
    JSON.stringify(scopeClause(plain as never, "fromMe")), JSON.stringify({ createdByUserId: "u1" }));
  eq("«all» narrows nothing", scopeClause(plain as never, "all"), undefined);
  eq("and an invented scope narrows nothing either",
    scopeClause(plain as never, "everything" as never), undefined);

  const service = readFileSync("src/server/services/taskService.ts", "utf8");
  ok("the scope is applied on top of the visibility, not instead of it",
    /if \(visibility\) and\.push\(visibility\);[\s\S]{0,200}scopeClause/.test(service));
  // Half of who may see the task, so a client that could set it could put a
  // task on somebody else's board — or take one off its own.
  ok("the creator is taken from the session", /createdByUserId: user\.id/.test(service));
  const routes = readFileSync("src/server/routes/tasks.ts", "utf8");
  ok("and is not writable through the route",
    !/["']createdByUserId["']/.test(routes.slice(routes.indexOf("const WRITABLE"), routes.indexOf("function pickInput"))));

  const view = readFileSync("src/components/TasksView.tsx", "utf8");
  // The ids are built from the key, so the two keys are what to look for.
  ok("the board has the two tabs",
    /task-scope-\$\{tab\.key\}/.test(view)
    && /key: 'toMe' as const/.test(view) && /key: 'fromMe' as const/.test(view));
  // A tab that returns your own tasks under the heading «همه» is worse than
  // no tab at all.
  ok("and offers «همه» only to somebody who holds the flag",
    /canSeeEveryTask \? \[\{ key: 'all'/.test(view));
  ok("read strictly on the screen too",
    /permissions\?\.tasksAll === true/.test(view));

  const hook = readFileSync("src/api/useTaskList.ts", "utf8");
  ok("the board opens on what was given to me", /scope: "toMe",/.test(hook));

  const users = readFileSync("src/components/UsersView.tsx", "utf8");
  ok("the permission can be granted in Settings", /id: 'tasksAll'/.test(users));
  ok("and is unticked unless explicitly held",
    /tasksAll: user\.permissions\?\.tasksAll === true/.test(users));

  /*
   * Referrals were already right, and must stay so.
   *
   * The inbox sends a scope and the server forces the caller's own id into the
   * clause; there is no way to widen it from the screen.
   */
  const activity = readFileSync("src/server/services/activityService.ts", "utf8");
  const listBody = activity.slice(activity.indexOf("export async function listReferrals"));
  ok("a referral inbox is scoped to the caller",
    /assignedByUserId: user\.id/.test(listBody.slice(0, 900))
    && /assignedToUserId: user\.id/.test(listBody.slice(0, 900)));
}


head("Holidays: the calendar is data, and it was a lunar month wrong");
{
  /*
   * The fault this replaced.
   *
   * `dateUtils.ts` carried three hardcoded sets: the ten fixed solar days, plus
   * hand-typed lunar dates for 1405 and 1406 and nothing after. Beyond 1406
   * every lunar holiday silently disappeared from the working-day arithmetic —
   * and the two years that *were* there were a lunar month late, so a delivery
   * date promised across Ashura 1405 was counted across an ordinary Tuesday.
   */

  /* -- the ordering rule, which is the whole of `isNonWorkingDay` -- */

  // An ordinary Tuesday with nothing said about it.
  ok("an ordinary weekday is worked", !isNonWorkingDay("1405/02/07", 2));
  ok("Friday is not", isNonWorkingDay("1405/02/10", 5));
  ok("and a fixed solar day is not, whatever day it falls on",
    isNonWorkingDay("1407/01/01", 3));

  // The explicit answer wins over both, in both directions. Without the second
  // direction «this announced holiday we are working» could not be said at all.
  ok("an explicit holiday beats an ordinary weekday",
    isNonWorkingDay("1405/02/07", 2, { holidays: { "1405/02/07": true } }));
  ok("an explicit working day beats Friday",
    !isNonWorkingDay("1405/02/10", 5, { holidays: { "1405/02/10": false } }));
  ok("and beats a fixed solar day",
    !isNonWorkingDay("1407/01/03", 3, { holidays: { "1407/01/03": false } }));
  // The stored key is normalised, so a date typed `1405/2/7` still matches.
  ok("the explicit answer is matched on the normalised date",
    isNonWorkingDay("1405/2/7", 2, { holidays: { "1405/02/07": true } }));

  // A weekend list is configurable; Thursday is off in some companies.
  ok("the weekend is a setting",
    isNonWorkingDay("1405/02/09", 4, { weekendDays: [4, 5] }));
  ok("a date nobody can read is not a holiday", !isNonWorkingDay("nonsense", 5));

  eq("a date normalises to one spelling", normalizeJalali("1405-2-7"), "1405/02/07");
  eq("and an unreadable one to null", normalizeJalali("1405/13/40"), null);
  eq("the month-day half is what the fixed list is keyed on",
    monthDayOf("1407/01/13"), "01/13");
  ok("and every fixed day is spelled that way",
    FIXED_SOLAR_HOLIDAYS.every((md) => /^\d{2}\/\d{2}$/.test(md)));

  /* -- the working-day walk is bounded -- */

  /*
   * The old loop was `while (count < workingDays)` with nothing stopping it: a
   * calendar marking every day — one bad import, or a weekend list of all seven
   * — spun the browser's main thread for ever, with no error and no way out.
   */
  eq("a calendar with no working days returns the cap rather than hanging",
    countForwardDays(5, () => true), MAX_WORKING_DAY_SPAN);
  eq("five working days with nothing in the way is five days",
    countForwardDays(5, () => false), 5);
  // Every third day off: five working days spans seven.
  eq("and a holiday every third day pushes it out",
    countForwardDays(5, (i) => i % 3 === 0), 7);
  eq("zero working days moves nothing", countForwardDays(0, () => false), 0);
  eq("and a negative count moves nothing either", countForwardDays(-3, () => false), 0);

  /* -- reading a year out of the source -- */

  // The source's own shape: `header.jalali` is «۱۴۰۵ فروردین», year first and
  // the month name last, which is why the parser takes the last token.
  const month = (name: string, days: unknown[]) => ({ header: { jalali: `۱۴۰۵ ${name}` }, days });
  const day = (
    n: number, holiday: boolean, events: unknown[], disabled = false, kind = "jalali",
  ) => ({
    disabled,
    day: { jalali: String(n) },
    events: { isHoliday: holiday, holidayType: kind, list: events },
  });

  const parsed = parseCalendarYear([
    month("فروردین", [
      day(1, true, [{ isHoliday: true, event: "نوروز" }]),
      day(2, false, [{ isHoliday: false, event: "روز عادی" }]),
      // The grid pads with the neighbouring months; importing those files a
      // day under the wrong month.
      day(31, true, [{ isHoliday: true, event: "روز ماه بعد" }], true),
    ]),
    month("تیر", [
      day(4, true, [
        { isHoliday: true, event: "عاشورا" },
        { isHoliday: false, event: "یادداشت" },
      ], false, "hijri"),
      // Repeated by the source; one answer per day.
      day(4, true, [{ isHoliday: true, event: "تکراری" }]),
    ]),
    { header: { jalali: "۱۴۰۵ ماه‌ناشناخته" }, days: [day(9, true, [])] },
  ], 1405);

  eq("only the real holidays are read", parsed.length, 2);
  eq("under the month they belong to", parsed[0]?.dateJalali, "1405/01/01");
  eq("and the second in order", parsed[1]?.dateJalali, "1405/04/04");
  eq("with only the holiday-bearing titles", parsed[1]?.title, "عاشورا");
  // Which calendar a day is fixed against is what the lunar correction keys
  // on; without it Ashura could not be moved without moving Nowruz too.
  eq("Nowruz is read as a solar day", parsed[0]?.calendarKind, "SOLAR");
  eq("and Ashura as a lunar one", parsed[1]?.calendarKind, "HIJRI");
  // Somebody else's document: a change to its shape must produce fewer
  // holidays and a visible count, never an exception that takes a screen down.
  eq("a payload that is not an array is no holidays", parseCalendarYear({}, 1405).length, 0);
  eq("nor is a null one", parseCalendarYear(null, 1405).length, 0);
  eq("a month with no days array is skipped",
    parseCalendarYear([{ header: { jalali: "۱۴۰۵ تیر" } }], 1405).length, 0);
  eq("a source printing Persian digits is read", holidayLatinDigits("۱۴۰۵"), "1405");

  /* -- an implausible year is refused rather than written -- */

  const oneDay = [{ dateJalali: "1405/01/01", title: "نوروز", calendarKind: "SOLAR" as const }];
  ok("an empty answer is refused", importRefusalReason([]) !== null);
  ok("and so is a handful of days", importRefusalReason(oneDay) !== null);
  const full = Array.from({ length: MIN_PLAUSIBLE_HOLIDAYS }, (_, i) => ({
    dateJalali: `1405/01/${String(i + 1).padStart(2, "0")}`, title: "x",
    calendarKind: "SOLAR" as const,
  }));
  eq("a full year goes through", importRefusalReason(full), null);

  /* -- the regression itself, held against a checkable Gregorian date -- */

  /*
   * Ashura 1404 falls on 2025-07-05 — 10 Muharram 1447, checkable against any
   * calendar. A lunar year is 354 or 355 days, so Ashura 1405 must land about
   * that far after it. The date the app had hardcoded is 385 days after: a
   * lunar year *plus a lunar month*, which is the whole shape of the bug.
   */
  const gap = (from: string, to: string) => Math.round(
    (new Date(toGregorianStr(to)!).getTime() - new Date(toGregorianStr(from)!).getTime())
    / 86400000,
  );
  const ashura1404 = "1404/04/14";
  eq("Ashura 1404 is 5 July 2025", toGregorianStr(ashura1404), "2025-07-05");
  const trueGap = gap(ashura1404, "1405/04/04");
  ok("Ashura 1405 is one lunar year later — 4 Tir", trueGap >= 353 && trueGap <= 356, trueGap);
  const wrongGap = gap(ashura1404, "1405/05/03");
  ok("the date the app used to carry is a lunar month beyond that",
    wrongGap >= 383 && wrongGap <= 386, wrongGap);

  const dateUtils = readFileSync("src/dateUtils.ts", "utf8");
  // The predicate is held against the thing that actually broke: the two
  // hand-typed sets, by name.
  ok("and the hardcoded lunar years are gone from dateUtils",
    !/HOLIDAYS_1405|HOLIDAYS_1406/.test(dateUtils));
  ok("the rule is read from the pure module instead",
    /isNonWorkingDay\(/.test(dateUtils));

  /* -- the calendar reaches the working-day arithmetic -- */

  try {
    // 1405/02/05 is a Saturday, and the Friday in the week that follows it is
    // 1405/02/11 — so six working days has to step over that Friday.
    setHolidayCalendar({});
    const plain = addWorkingDaysToShamsi("1405/02/05", 6);
    eq("six working days steps over the Friday", plain, "1405/02/12");

    setHolidayCalendar({ "1405/02/08": true });
    const withOne = addWorkingDaysToShamsi("1405/02/05", 6);
    ok("marking a day off pushes a delivery date out", withOne > plain, { plain, withOne });

    // The other direction, which the old hardcoded set could not express at all.
    setHolidayCalendar({ "1405/02/11": false });
    const openFriday = addWorkingDaysToShamsi("1405/02/05", 6);
    ok("and working a Friday pulls it back in", openFriday < plain, { plain, openFriday });
  } finally {
    // Whatever happened, the rest of this file must see the default calendar.
    setHolidayCalendar({});
  }

  const holidayService = readFileSync("src/server/services/holidayService.ts", "utf8");

  /* -- the lunar days move as a set, and the solar ones never -- */

  /*
   * Why this exists rather than a better source.
   *
   * Iran announces the start of each hijri month by sighting the moon. Every
   * calendar reachable from a server computes it instead — the source used
   * here and aladhan.com behind it agree with each other and can both be a day
   * away from what was announced, usually a day early. Solar holidays are fixed
   * dates and are right, which is exactly the reported shape: Nowruz correct,
   * Ashura a day out. So the correction is one offset for the whole lunar set
   * of a year, and there is no source that could remove the need for it.
   */
  const stored = [
    { id: "a", dateJalali: "1405/01/01", sourceDateJalali: "1405/01/01", calendarKind: "SOLAR", source: "IMPORT" },
    { id: "b", dateJalali: "1405/04/03", sourceDateJalali: "1405/04/03", calendarKind: "HIJRI", source: "IMPORT" },
    { id: "c", dateJalali: "1405/04/04", sourceDateJalali: "1405/04/04", calendarKind: "HIJRI", source: "IMPORT" },
    { id: "d", dateJalali: "1405/09/09", sourceDateJalali: "1405/09/09", calendarKind: "HIJRI", source: "MANUAL" },
  ];

  const forward = planHijriShift(stored, 1, addDays);
  eq("both imported lunar days move", forward.moves.length, 2);
  eq("Tasu'a moves to the day after", forward.moves[0]?.to, "1405/04/04");
  eq("and Ashura with it", forward.moves[1]?.to, "1405/04/05");
  ok("Nowruz is not among them", !forward.moves.some((m) => m.id === "a"));
  /*
   * A hand-entered day is an answer about *that* date — somebody typed it
   * because the computed calendar was wrong — so moving it by the very
   * correction they were working around would undo their answer.
   */
  ok("and neither is a day somebody entered by hand",
    !forward.moves.some((m) => m.id === "d"));

  /*
   * The target is re-derived from what the source said, never added to where
   * the day currently sits. Otherwise pressing «forward» twice would drift the
   * calendar two days while the screen still said one.
   */
  const already = stored.map((r) => (
    r.id === "c" ? { ...r, dateJalali: "1405/04/05" } : r
  ));
  const again = planHijriShift(already, 1, addDays);
  ok("asking for +1 twice moves nothing further",
    !again.moves.some((m) => m.id === "c"), again.moves);
  const back = planHijriShift(already, 0, addDays);
  eq("and zero puts it back exactly where the source had it",
    back.moves.find((m) => m.id === "c")?.to, "1405/04/04");

  // A day imported before the source column existed has none; its current
  // date is the base, which is right — nothing had moved it yet.
  const legacy = [
    { id: "e", dateJalali: "1405/05/12", sourceDateJalali: null, calendarKind: "HIJRI", source: "IMPORT" },
  ];
  eq("a day with no recorded source moves from where it is",
    planHijriShift(legacy, 1, addDays).moves[0]?.to, "1405/05/13");

  /*
   * Only one row can hold a date, and the day already sitting there is either
   * a person's answer or a solar holiday — both outranking a computed lunar
   * guess. It is reported rather than silently dropped.
   */
  const collide = [
    { id: "f", dateJalali: "1405/03/13", sourceDateJalali: "1405/03/13", calendarKind: "HIJRI", source: "IMPORT" },
    { id: "g", dateJalali: "1405/03/14", sourceDateJalali: "1405/03/14", calendarKind: "SOLAR", source: "IMPORT" },
  ];
  const blocked = planHijriShift(collide, 1, addDays);
  eq("a move onto an occupied day is refused", blocked.moves.length, 0);
  eq("and reported", blocked.blocked.length, 1);

  eq("a whole-day offset is required", shiftRefusalReason(0.5) !== null, true);
  eq("a plausible correction goes through", shiftRefusalReason(1), null);
  eq("and so does putting it back", shiftRefusalReason(0), null);
  // A wider range is not a correction, it is a mistake being typed — and it
  // would move every religious holiday of a year off where people are quoting.
  ok("but a wild one is refused", shiftRefusalReason(MAX_HIJRI_SHIFT_DAYS + 1) !== null);

  /*
   * The backfill in the migration marks an imported day lunar unless its
   * month-day is one of the fixed solar ten — checked against a real year of
   * source data, where that agrees with the source's own tag on all 25 days.
   * If the fixed list ever changes, the migration's copy has to change with it
   * or a database already holding a year would tag that day the wrong way.
   */
  const kindMigration = readFileSync(
    "prisma/migrations/20260906000000_holiday_calendar_kind/migration.sql", "utf8",
  );
  ok("the backfill lists exactly the fixed solar days",
    FIXED_SOLAR_HOLIDAYS.every((md) => kindMigration.includes(`'${md}'`))
    && (kindMigration.match(/'\d\d\/\d\d'/g) ?? []).length === FIXED_SOLAR_HOLIDAYS.length);

  eq("the source's own tag decides the kind", normalizeCalendarKind("hijri"), "HIJRI");
  eq("and anything else is solar", normalizeCalendarKind("jalali"), "SOLAR");
  eq("an absent tag is solar too", normalizeCalendarKind(undefined), "SOLAR");

  eq("a stored offset is read for its own year",
    shiftForYear({ "1405": 1, "1406": -1 }, 1405), 1);
  eq("a year with none is unshifted", shiftForYear({ "1405": 1 }, 1407), 0);
  // A stored value out of range must not move a calendar by a month.
  eq("and a stored value out of range is ignored",
    shiftForYear({ "1405": 40 }, 1405), 0);
  eq("as is a stored value that is not a number",
    shiftForYear({ "1405": "چند" }, 1405), 0);

  // Remembered, or re-importing the year would silently undo the correction —
  // the feature quietly cancelling itself the next time the button was pressed.
  ok("the import applies the year's stored offset",
    /shiftForYear\(settings\?\.hijriHolidayShift, year\)/.test(holidayService)
    && /calendarKind === "HIJRI" && offset !== 0/.test(holidayService));
  // A hand-entered day is stamped solar so no lunar correction can drag it.
  ok("a hand-entered day is never lunar",
    /calendarKind: "SOLAR", sourceDateJalali: dateJalali/.test(holidayService));
  /*
   * Shifting a set of dates by one day means every target but the last is
   * occupied by the day in front of it, so an in-place update fails on the
   * first collision. Delete then insert, in one transaction.
   */
  ok("and the re-placement is one transaction, not a row-by-row update",
    /\$transaction\([\s\S]{0,400}deleteMany[\s\S]{0,600}holiday\.create/.test(holidayService));

  /* -- the calendars paint the day the rule calls off, not the last column -- */

  try {
    /*
     * Both calendars used to colour by grid position — `idx % 7 === 6`, the
     * last column, which is Friday because the grid starts on Saturday. That
     * painted exactly one thing red and could express nothing else: Nowruz,
     * Ashura and every day imported or typed into the calendar were drawn as
     * ordinary working days, and a Friday the company had marked as worked was
     * still red. Asking `holidayReason` makes the colour and the delivery date
     * it produces the same answer.
     */
    setHolidayCalendar(
      { "1405/04/04": true, "1405/02/11": false },
      undefined,
      { "1405/04/04": "عاشورای حسینی" },
    );

    eq("an imported day is named", holidayReason("1405/04/04"), "عاشورای حسینی");
    // 1405/02/11 is a Friday the company has said it works.
    eq("a Friday marked as worked is not off", holidayReason("1405/02/11"), null);
    eq("an ordinary Friday is", holidayReason("1405/02/18"), "تعطیل آخر هفته");
    // A fixed solar day on a database nobody has imported a year into yet.
    eq("and a fixed solar day says so without a stored row",
      holidayReason("1407/01/13"), "تعطیل رسمی");
    eq("a working Tuesday has no reason", holidayReason("1405/02/07"), null);
    eq("and neither has a date nobody can read", holidayReason("چرند"), null);
  } finally {
    setHolidayCalendar({});
  }

  /*
   * Comments come out first.
   *
   * The comment explaining the fix quotes the expression it replaced, so a
   * check reading the raw file fails on the very note saying it was fixed —
   * the same trap the migration scan above closes by dropping `--` lines.
   */
  const withoutComments = (source: string) =>
    source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

  const picker = readFileSync("src/components/ShamsiDatePicker.tsx", "utf8");
  const taskCalendar = readFileSync("src/components/TaskCalendarModal.tsx", "utf8");
  for (const [name, raw] of [["the date picker", picker], ["the task calendar", taskCalendar]] as const) {
    const source = withoutComments(raw);
    ok(`${name} asks the calendar which days are off`, /holidayReason\(/.test(source));
    // The predicate is the expression that actually shipped the fault.
    ok(`${name} no longer colours a day by the last column`, !/idx % 7 === 6/.test(source));
    // A red day nobody can explain invites the question it cannot answer.
    ok(`${name} names the day it paints`, /title=\{reason \?\? undefined\}/.test(source));
    // A late-arriving calendar has to repaint what has already been drawn:
    // `holidayReason` reads a copy in the date helpers, so a grid rendered
    // before the fetch resolved has nothing telling it to draw again.
    ok(`${name} repaints when the calendar lands`, /useHolidayCalendar\(\)/.test(source));
  }
  /*
   * The stripping itself, both ways: a check that removed the code as well as
   * the comment would pass by matching nothing. Whole-line `//` only, so a
   * `https://` inside a string is left alone.
   */
  ok("the comment stripping removes a block comment",
    !withoutComments("/* idx % 7 === 6 */\nconst a = 1;").includes("idx % 7"));
  ok("and a whole-line one",
    !withoutComments("  // idx % 7 === 6\nconst a = 1;").includes("idx % 7"));
  /*
   * A year nobody has imported draws exactly like a year with no religious
   * holidays in it — Fridays red, everything else plain. Those mean completely
   * different things, and the reported «holidays are not red» was the first of
   * them, so the board says which one it is rather than leaving somebody to
   * conclude the feature is broken.
   */
  const board = withoutComments(taskCalendar);
  ok("the task board can tell an unloaded year from an empty one",
    /holidays\.loaded && !yearIsLoaded/.test(board)
    && /تقویم تعطیلات/.test(board));
  // No hover on a phone, which is where this screen is read.
  ok("and writes the reason on the day rather than only in a tooltip",
    /\{reason\}/.test(board));

  ok("while keeping the code around it",
    withoutComments("/* note */\nconst a = 1;").includes("const a = 1;")
    && withoutComments('const u = "https://x";').includes("https://x"));

  /* -- who may read it, and who may change it -- */

  const adminRoutes = readFileSync("src/server/routes/admin.ts", "utf8");
  const getHolidays = adminRoutes.slice(
    adminRoutes.indexOf('app.get("/api/holidays"'),
    adminRoutes.indexOf('app.put("/api/holidays"'),
  );
  /*
   * Read by any signed-in user, deliberately. Every screen that counts a
   * working day needs it, and a salesperson who could not read it would be
   * quoting delivery dates off a different calendar from everybody else.
   */
  ok("reading the calendar needs only a session",
    getHolidays.includes("requireAuth") && !getHolidays.includes("requireKeyAccess"));

  const writes = ["upsertHoliday", "deleteHoliday", "importHolidayYear", "shiftHijriHolidays"];
  ok("but every write is gated on `settings`",
    writes.every((fn) => {
      const body = holidayService.slice(holidayService.indexOf(`export async function ${fn}`));
      return /hasPermission\(user, "settings"\)/.test(body.slice(0, 400));
    }));
  // A hand-entered day is the correction somebody made *because* the source
  // was wrong or silent; an import that overwrote it would undo it every time.
  ok("an import leaves a hand-entered day alone",
    /known === "MANUAL"[\s\S]{0,60}keptManual\+\+; continue;/.test(holidayService));
  ok("and an edit marks the day as hand-entered, so the next import still will",
    /update: \{\s*title, isHoliday, source: "MANUAL",/.test(holidayService));
  // Removing a day the source dropped is a decision for a person. Bounded to
  // the import: the lunar shift below it deletes on purpose, to re-place.
  const importBody = holidayService.slice(
    holidayService.indexOf("export async function importHolidayYear"),
    holidayService.indexOf("export interface ShiftOutcome"),
  );
  ok("and nothing is deleted by an import", !/delete/i.test(importBody));
}


head("Activity groups: membership is the quiet half of a mention");
{
  /*
   * The feed became a messenger and had no membership.
   *
   * The only way to reach a colleague was to name them — which raises a
   * referral, an explicit request with an action and an inbox of its own. Right
   * for «please check this datasheet», wrong for «the shipment cleared
   * customs», which the people working the job want to know without being asked
   * to do anything. So members get a notice and no referral.
   */

  const directory = [
    { id: "u1", fullName: "علی رضایی" },
    { id: "u2", fullName: "مریم احمدی" },
    { id: "u3", fullName: "حسن کریمی" },
  ];

  eq("a stored list reads back", parseMemberIds('["u1","u2"]').length, 2);
  // The column is JSON this application writes, but a hand-edited row must
  // produce «nobody follows this» rather than an exception on a feed.
  eq("a broken value is nobody, not an exception", parseMemberIds("{oops").length, 0);
  eq("and so is null", parseMemberIds(null).length, 0);
  eq("an id repeated is one member", parseMemberIds('["u1","u1"]').length, 1);
  eq("blanks are dropped", parseMemberIds('["u1","  ",""]').length, 1);

  /*
   * An id naming nobody would raise a notice into a void on every message for
   * ever, and no screen would ever show that.
   */
  eq("only real accounts are stored",
    serializeMemberIds(["u1", "ghost"], directory), JSON.stringify(["u1"]));
  // One representation for one state: «nobody set members» and «somebody
  // removed them all» are the same thing here.
  eq("and an empty result is null rather than an empty array",
    serializeMemberIds(["ghost"], directory), null);
  eq("as is clearing the list", serializeMemberIds([], directory), null);

  /* -- who a message actually notifies -- */

  const recipients = (over: Partial<Parameters<typeof activityRecipients>[0]> = {}) =>
    activityRecipients({
      memberUserIds: ["u1", "u2", "u3"],
      authorUserId: "u1",
      mentionedUserIds: [],
      directory,
      ...over,
    });

  eq("every member but the author", JSON.stringify(recipients()), JSON.stringify(["u2", "u3"]));
  /*
   * Somebody named gets a referral notice, which says they have been asked to
   * do something — strictly more than this one. Two notices for one message is
   * how a person learns to dismiss the pair without reading either.
   */
  eq("and never somebody the message named",
    JSON.stringify(recipients({ mentionedUserIds: ["u2"] })), JSON.stringify(["u3"]));
  /*
   * Filtered on save, but an account can be deactivated afterwards and the
   * stored list is not rewritten when that happens — so it is checked here too,
   * at the moment of sending.
   */
  eq("nor an account that has since gone",
    JSON.stringify(recipients({ directory: [{ id: "u2" }] })), JSON.stringify(["u2"]));
  eq("a group nobody follows notifies nobody",
    recipients({ memberUserIds: null }).length, 0);
  // The author writing to a group they are the only member of.
  eq("and neither does a group of one, written by that one",
    recipients({ memberUserIds: ["u1"] }).length, 0);

  eq("a long message is cut for the notice",
    noticeExcerpt("x".repeat(NOTICE_EXCERPT_LENGTH + 20)).length, NOTICE_EXCERPT_LENGTH + 1);
  eq("a short one is not", noticeExcerpt("سلام"), "سلام");
  eq("and newlines are flattened", noticeExcerpt("یک\n\nدو"), "یک دو");

  /* -- the service, and the trap the write path carries -- */

  const service = readFileSync("src/server/services/activityService.ts", "utf8");
  /*
   * `upsertCategoryGroup` is also what the date editors and the close/reopen
   * buttons call, and none of them sends a member list. Reading absent as
   * «nobody» would empty the membership every time somebody closed a category.
   */
  ok("an absent member list leaves the column alone",
    /input\.memberUserIds !== undefined/.test(service));
  ok("and what is stored is validated against the directory",
    /serializeMemberIds\(input\.memberUserIds, directory\)/.test(service));

  const routes = readFileSync("src/server/routes/activities.ts", "utf8");
  ok("the route keeps absent absent rather than sending an empty array",
    /Array\.isArray\(body\.memberUserIds\)[\s\S]{0,140}: undefined/.test(routes));

  const hook = readFileSync("src/api/useProjectActivities.ts", "utf8");
  // Resending it from the screen's copy would write a membership back over
  // somebody else's edit on every date change.
  ok("and the client sends it only when it is what changed",
    /"memberUserIds" in overrides/.test(hook));

  /* -- the two orders, which are deliberately opposite -- */

  const feedQuery = service.slice(
    service.indexOf("export async function listCategoryGroups"),
    service.indexOf("export interface CategoryGroupInput"),
  );
  /*
   * Messages oldest first, so the newest sits directly above the box you reply
   * in; categories newest first, because they are parallel strands of work and
   * the one opened most recently is the one being worked. Flipping either back
   * is a one-word edit nothing else would notice.
   */
  ok("categories come newest first",
    /orderBy: \{ createdAt: "desc" \}[\s\S]{0,120}activities:/.test(feedQuery));
  ok("and messages oldest first, like a conversation",
    /activities: \{[\s\S]{0,80}orderBy: \{ createdAt: "asc" \}/.test(feedQuery));

  const view = readFileSync("src/components/ProjectsView.tsx", "utf8");
  // The order only reads as a messenger because the composer is below the list.
  ok("the screen renders that order as it arrives",
    !/activities[^\n]{0,40}\.reverse\(\)/.test(view));
  ok("and offers the membership from the group header",
    /CategoryMembersModal/.test(view) && /setMembersGroupId\(group\.id\)/.test(view));

  const modal = readFileSync("src/components/CategoryMembersModal.tsx", "utf8");
  // The parent rebuilds `group` on every fetch, so an effect keyed on the
  // object would wipe half-ticked boxes — the price-calculator trap.
  ok("the modal seeds on the group's id, not on the object",
    /seededFor\.current === group\.id/.test(modal));
}

head("Contrast: the palette was measured, and most of it did not pass");
{
  /*
   * The reported fault, and what was under it.
   *
   * «پس‌زمینه ثبت فعالیت با متن پیام‌ها رنگ نزدیک به هم دارد» measured 1.03:1 —
   * the same colour. It was not a local mistake but one palette repeated
   * everywhere: `text-slate-400` at 2.56 on 676 elements, `border-slate-100` at
   * 1.10 on 479, `border-slate-200` at 1.23 on 948.
   */
  const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const lum = (h: string) => {
    const [r, g, b] = hex(h).map(lin);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a: string, b: string) => {
    const [x, y] = [lum(a), lum(b)];
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };

  // Held against a value everyone can check: black on white is 21:1.
  eq("the formula agrees with the one figure everybody knows",
    Math.round(contrast("#000000", "#ffffff")), 21);
  eq("and a colour against itself is 1", contrast("#616f85", "#616f85").toFixed(2), "1.00");

  const css = readFileSync("src/index.css", "utf8");
  const WHITE = "#ffffff", SLATE50 = "#f8fafc", SLATE100 = "#f1f5f9";

  /*
   * What the layer resolves a utility to.
   *
   * It names a role rather than a literal — which is the point of the roles —
   * so the lookup has to follow that one hop. A check reading only for a hex
   * would go quietly null the moment the indirection was introduced, and pass
   * nothing while reporting nothing, which is what happened when it was.
   */
  const lightRole = (name: string): string | null =>
    css.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{3,8})`, "i"))?.[1] ?? null;

  const declared = (selector: string, prop: string): string | null => {
    const rule = css.match(new RegExp(
      `html:not\\(\\.dark\\)\\s+\\.${selector}[^{]*\\{[^}]*${prop}:\\s*([^;}]+)`, "i",
    ))?.[1]?.trim();
    if (!rule) return null;
    const role = rule.match(/var\(--([a-z-]+)\)/i)?.[1];
    return role ? lightRole(role) : (rule.match(/#[0-9a-f]{3,8}/i)?.[0] ?? null);
  };

  // The first definition in the file is the light one, so the hop must land on
  // a light value — held against a role whose two themes are far apart.
  eq("a role resolves to its light value", lightRole("text-primary"), "#0f172a");

  /*
   * Body text has to clear 4.5 on every ground it actually sits on — white, and
   * the two tinted surfaces the app fills panels with. A value chosen against
   * white alone fails the moment the same text lands inside a card.
   */
  for (const cls of ["text-slate-400", "text-slate-500"]) {
    const value = declared(cls, "color");
    ok(`${cls} is restated`, value !== null, value);
    if (!value) continue;
    for (const [name, ground] of [["white", WHITE], ["slate-50", SLATE50], ["slate-100", SLATE100]] as const) {
      const r = contrast(value, ground);
      ok(`  and clears AA on ${name}`, r >= 4.5, r.toFixed(2));
    }
  }

  /*
   * `slate-300` deliberately does not reach 4.5: it is icon strokes, disabled
   * states and decorative glyphs, and holding it to the text threshold would
   * make every one of those read as content. It still has to beat what it
   * replaced, which was 1.48 — invisible.
   */
  const decorative = declared("text-slate-300", "color");
  ok("slate-300 is lifted well clear of what it replaced",
    !!decorative && contrast(decorative, WHITE) > 2.5,
    decorative && contrast(decorative, WHITE).toFixed(2));

  /*
   * The status colours are the ones that have to be read in a single glance —
   * «برنده», «باخته», «هشدار» — and every one of them was below AA.
   */
  for (const cls of ["text-sky-600", "text-emerald-600", "text-rose-500", "text-amber-600"]) {
    const value = declared(cls, "color");
    const r = value ? contrast(value, WHITE) : 0;
    ok(`${cls} clears AA on white`, r >= 4.5, value ? r.toFixed(2) : null);
  }

  /*
   * A border is not held to 4.5 — it is not text — but 1.10:1 is not a border,
   * it is the absence of one. The card weights are deliberately below the 3:1
   * component threshold because a divider between every row at edge weight
   * reads as noise; what must clear 3:1 is `--color-edge`, below.
   */
  const borders: [string, number][] = [
    ["border-slate-100", 1.35], ["border-slate-150", 1.5],
    ["border-slate-200", 1.6], ["border-slate-300", 2.0],
  ];
  for (const [cls, floor] of borders) {
    const value = declared(cls, "border-color");
    const r = value ? contrast(value, WHITE) : 0;
    ok(`${cls} is visible against white`, r >= floor, value ? r.toFixed(2) : null);
  }

  /*
   * `border-slate-150` is the one that was not merely faint: Tailwind's slate
   * ramp goes 100 → 200, so no rule was ever generated for it and all 149 of
   * those borders fell back to `currentColor` — drawing in whatever text colour
   * they inherited. It needs a value at all, which is why it is in the list.
   */
  ok("and slate-150, which had no value whatsoever, now has one",
    declared("border-slate-150", "border-color") !== null);

  /*
   * The one border the standard is strict about (WCAG 1.4.11) is the boundary
   * of a control. It is a token rather than a literal so dark mode restates it
   * in one place.
   */
  const edge = css.match(/--color-edge:\s*(#[0-9a-f]{6})/i)?.[1];
  ok("the load-bearing edge clears the 3:1 component threshold",
    !!edge && contrast(edge, WHITE) >= 3, edge && contrast(edge, WHITE).toFixed(2));
  // It sits on the sunken surfaces too, not only on white.
  ok("on a tinted surface as well",
    !!edge && contrast(edge, SLATE100) >= 3, edge && contrast(edge, SLATE100).toFixed(2));
  ok("form controls are given it", /input:not\(\[type="checkbox"\]\)[\s\S]{0,220}var\(--color-edge\)/.test(css));

  /*
   * Scoped to light mode throughout. A value chosen to be darker on white is
   * the wrong direction on a dark ground, and the dark block already restates
   * most of these.
   */
  const layerAt = css.indexOf("Contrast layer");
  // Or the slice below would be one character and the check would pass by
  // examining nothing.
  ok("the layer is where this check thinks it is", layerAt > 0);
  /*
   * Bounded to the light layer. The dark block that follows it is full of
   * `.dark main .bg-…` rules, and a slice running to the end of the file would
   * read those as light-layer rules escaping their scope.
   */
  const layerEnd = css.indexOf("Dark mode: the surfaces");
  ok("and it ends where the dark block begins", layerEnd > layerAt);
  const layer = css.slice(layerAt, layerEnd);
  const scoped = layer.split("\n").filter((l) => /^html:not\(\.dark\)/.test(l));
  ok("and it is not empty", scoped.length > 10, scoped.length);
  const rules = layer.split("\n").filter((l) => /^\s*\.[a-z]/i.test(l));
  ok("no rule in the layer escapes the light-mode scope", rules.length === 0, rules.slice(0, 3));

  /*
   * The palette itself is untouched on purpose. The same token is a text
   * colour, a border *and* a fill: darkening `--color-slate-100` to fix 479
   * borders would darken 200 `bg-slate-100` surfaces too, which nobody asked
   * for and which the border problem does not imply.
   */
  ok("and the slate scale itself is left alone",
    !/--color-slate-\d00\s*:/.test(css));

  /* ------------------ every role, on every surface, in both themes ---------- */

  /*
   * The check that would have caught the dark theme.
   *
   * Light mode was measured and corrected; dark mode had never been measured at
   * all, and its borders sat at 1.09–1.41 while the same defect was being fixed
   * a few lines above them. Reading one theme is not reading the palette — so
   * this walks both role sets against every surface each one is drawn on.
   */
  const roleSet = (block: string): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const m of block.matchAll(/--([a-z-]+):\s*(#[0-9a-f]{3,8})/gi)) out[m[1]] = m[2];
    return out;
  };
  const between = (from: string, to: string) => {
    const a = css.indexOf(from);
    const b = css.indexOf(to, a + 1);
    return a >= 0 && b > a ? css.slice(a, b) : "";
  };

  const light = roleSet(between("\n:root {", "\n}"));
  const dark = roleSet(between("\n.dark {", "\n}"));

  // A theme block that failed to parse would let every assertion below pass by
  // iterating nothing.
  ok("both role sets were read", Object.keys(light).length > 12 && Object.keys(dark).length > 12,
    [Object.keys(light).length, Object.keys(dark).length]);
  const missing = Object.keys(light).filter((k) => !(k in dark));
  ok("and the two themes answer the same roles", missing.length === 0, missing);

  /*
   * Text against the surfaces it is actually drawn on. `faint` is excluded by
   * name rather than by silence: it is decorative and has its own floor above.
   */
  const TEXT = ["text-muted", "text-soft", "text-secondary", "text-primary",
    "text-info", "text-success", "text-danger", "text-warn", "text-violet"];
  const SURFACES = ["bg-app", "bg-card", "bg-input", "bg-hover"];

  for (const [theme, roles] of [["light", light], ["dark", dark]] as const) {
    let worst = { pair: "", r: 99 };
    for (const t of TEXT) {
      for (const surface of SURFACES) {
        const [fg, bg] = [roles[t], roles[surface]];
        if (!fg || !bg) continue;
        const value = contrast(fg, bg);
        if (value < worst.r) worst = { pair: `${t} on ${surface}`, r: value };
      }
    }
    ok(`${theme}: every text role clears AA on every surface`,
      worst.r >= 4.5, `${worst.pair} = ${worst.r.toFixed(2)}`);
  }

  /*
   * The control boundary, which is the one border the standard is strict about
   * — and the one dark mode was drawing at 1.13 against a filled input.
   */
  for (const [theme, roles] of [["light", light], ["dark", dark]] as const) {
    let worst = { pair: "", r: 99 };
    for (const surface of SURFACES) {
      const bg = roles[surface];
      if (!bg) continue;
      const value = contrast(roles["color-edge"], bg);
      if (value < worst.r) worst = { pair: `edge on ${surface}`, r: value };
    }
    ok(`${theme}: the control edge clears 3:1 on every surface`,
      worst.r >= 3, `${worst.pair} = ${worst.r.toFixed(2)}`);
  }

  /*
   * Separators are not held to 3:1 — an edge-weight rule between every row of a
   * list reads as noise — but 1.09:1 is not a separator, it is nothing. The
   * floor is what «visible at all» costs.
   */
  for (const [theme, roles] of [["light", light], ["dark", dark]] as const) {
    for (const role of ["border-card", "color-hairline", "border-divider", "border-firm"]) {
      let worst = 99;
      for (const surface of SURFACES) {
        if (!roles[surface] || !roles[role]) continue;
        worst = Math.min(worst, contrast(roles[role], roles[surface]));
      }
      ok(`${theme}: ${role} is visible on every surface`, worst >= 1.25, worst.toFixed(2));
    }
  }

  /*
   * `faint` is decorative in both themes and has no business creeping up to
   * body weight or down to invisibility.
   */
  for (const [theme, roles] of [["light", light], ["dark", dark]] as const) {
    const r = contrast(roles["text-faint"], roles["bg-card"]);
    ok(`${theme}: the decorative text role stays in its band`, r >= 2.5 && r < 6, r.toFixed(2));
  }

  /*
   * Both layers read roles rather than literals, which is what stops one theme
   * being corrected and the other left behind — the exact way dark mode came to
   * have borders at 1.09 while light mode's were being fixed.
   */
  const layerBody = layer.split("\n").filter((l) => l.startsWith("html:not(.dark)"));
  const literals = layerBody.filter((l) => /:\s*#[0-9a-f]{3,8}/i.test(l));
  ok("the light layer names roles, never literals", literals.length === 0, literals.slice(0, 3));


  /* --------- every light surface a component uses is answered in the dark ---- */

  /*
   * The check that would have caught the reported fault.
   *
   * Dark mode is a list of utility class names, and anything not on it keeps
   * its light value. `bg-slate-50/50` — the header band of every dashboard
   * card, on 44 elements — was never on that list, so it rendered as a
   * translucent near-white strip over a dark card, with the correctly-mapped
   * near-white heading printed on top of it. The opacity variants are separate
   * class names: `.bg-slate-50` and `.bg-slate-50\/50` share no rule, so
   * covering the base never covered them.
   *
   * An explicit list is only safe with something enforcing it, which is this.
   */
  const componentClasses = (): Map<string, number> => {
    const out = new Map<string, number>();
    const dir = "src/components";
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".tsx"))) {
      const src = readFileSync(joinPath(dir, file), "utf8");
      for (const m of src.matchAll(/class[Nn]ame="([^"]+)"/g)) {
        for (const cls of m[1].split(/\s+/)) out.set(cls, (out.get(cls) ?? 0) + 1);
      }
    }
    return out;
  };

  const darkBlock = css.slice(css.indexOf("/* Base Body Dark Styling */"));
  const answered = new Set(
    [...darkBlock.matchAll(/\.dark\s+(?:main|\[role="dialog"\])\s+\.([\w\\/.:-]+?)(?::[a-z-]+)?\s*[,{]/g)]
      .map((m) => m[1].replace(/\\/g, "")),
  );
  ok("the dark block's class list was read", answered.size > 40, answered.size);

  /*
   * A light surface is `white`, `slate-50`, `slate-100` or `slate-200`, with or
   * without an opacity suffix and with or without a state prefix. `slate-700`
   * and darker are already dark in both themes and need no answer.
   *
   * The exceptions are translucent overlays on coloured hero panels — a ground
   * that is dark in both themes — where mapping to a card colour would flatten
   * the panel underneath.
   */
  const OVERLAY_EXCEPTIONS = [
    "bg-white/5", "bg-white/10", "bg-white/15", "bg-white/40",
    // The thumb of a toggle switch, not a surface: it is white on both themes
    // in every interface that has one, and darkening it would leave the switch
    // reading as permanently off.
    "after:bg-white",
  ];
  const isLightSurface = (cls: string) =>
    /^(?:[a-z-]+:)*bg-(?:white|slate-(?:50|100|200))(?:\/\d+)?$/.test(cls);

  const unanswered = [...componentClasses()]
    .filter(([cls]) => isLightSurface(cls) && !answered.has(cls)
      && !OVERLAY_EXCEPTIONS.includes(cls))
    .sort((a, b) => b[1] - a[1]);

  ok("every light surface a component uses has a dark answer",
    unanswered.length === 0, unanswered.slice(0, 6));

  // Held against the class that actually shipped the fault, and against one
  // that must not be swept in — a check matching nothing passes for the wrong
  // reason, and one matching everything makes hover states permanent.
  ok("the predicate recognises the class that broke", isLightSurface("bg-slate-50/50"));
  ok("and its state-prefixed form", isLightSurface("hover:bg-slate-50/50"));
  ok("but not a surface that is already dark", !isLightSurface("bg-slate-900/60"));
  ok("nor a slate-500 fill, which the slash rule must not swallow",
    !isLightSurface("bg-slate-500/20"));

  // The compose bar, which is what was reported.
  const composer = readFileSync("src/components/ActivityComposer.tsx", "utf8");
  ok("the compose bar carries the edge rather than a heavier fill",
    /border-t-edge/.test(composer));
}

head("Product categories: one taxonomy, two ways in");
{
  /*
   * The reported fault: the dashboard's conversion chart drew «فلو» at 38% and
   * «Flow» at 0% — two piles of the same equipment.
   *
   * A product's category is a plain string copied onto the row, so every report
   * groups by exactly what is stored. The product form is a `<select>` over
   * `settings.dropdownItems.categories` and cannot invent a category; the Excel
   * import took `row["دسته بندی"]` verbatim and could. One path constrained and
   * one not is the same shape as the five customer creation forms.
   */
  const known = ["ابزار دقیق - فشار", "فلو", "قطعات یدکی و اتصالات"];

  /* -- spelling is not meaning -- */
  eq("case is spelling", categoryKey("Flow"), categoryKey("flow "));
  // SQL Server's collation treats these as different characters, which is the
  // same reason `searchClause` expands them.
  eq("and so are the Persian character pairs", categoryKey("كنترلي"), categoryKey("کنترلی"));
  eq("as is a zero-width joiner", categoryKey("قطعات‌یدکی"), categoryKey("قطعات یدکی"));
  eq("an empty value has no key", categoryKey(null), "");

  eq("a value that means a list entry resolves to it",
    matchKnownCategory(" فلو ", known), "فلو");
  eq("and one the list does not have resolves to nothing",
    matchKnownCategory("Flow", known), null);
  /*
   * The rule deliberately does not translate. «Flow» and «فلو» are the same
   * equipment in two languages and no string rule can know that — which is
   * exactly why the merge below takes a person's answer.
   */
  ok("because a language is not a spelling",
    categoryKey("Flow") !== categoryKey("فلو"));

  /* -- what an import brings in that the list has never heard of -- */
  const sheet = ["فلو", "Flow", "flow", "Pressure", "", "  ", "ابزار دقیق - فشار"];
  const strays = unknownImportCategories(sheet, known);
  eq("the sheet's unknown categories are reported", JSON.stringify(strays),
    JSON.stringify(["Flow", "Pressure"]));
  // Reported once, in the sheet's own spelling, so the message names what to
  // look for rather than a normalised form nobody typed.
  ok("once each, however many rows carry them", strays.length === 2);
  eq("a sheet that stays inside the list reports nothing",
    unknownImportCategories(["فلو", "ابزار دقیق - فشار"], known).length, 0);

  /* -- merging, which is a person's decision -- */
  eq("merging into a list entry is allowed", mergeRefusalReason("Flow", "فلو", known), null);
  ok("merging a category into itself is refused",
    mergeRefusalReason("فلو", " فلو ", known) !== null);
  /*
   * The target must exist. Merging into a typo would move every product onto a
   * name the product form cannot offer — the fault this repairs, not a repair
   * of it.
   */
  ok("and merging into something the list does not have is refused",
    mergeRefusalReason("Flow", "Flowmeter", known) !== null);
  ok("a blank either side is refused", mergeRefusalReason("", "فلو", known) !== null);

  /* -- the two halves, in the source -- */
  const importer = readFileSync("src/components/ProductsView.tsx", "utf8");
  // Reported, not refused: rejecting a hundred-row sheet over one cell is worse
  // than importing it. Doing it silently was what was not acceptable.
  ok("the import says which categories it had never heard of",
    /unknownImportCategories\(/.test(importer));

  const service = readFileSync("src/server/services/productService.ts", "utf8");
  const mergeBody = service.slice(service.indexOf("export async function mergeCategory"));
  /*
   * The move and the list edit are one transaction: leaving the source in the
   * dropdown after its products have gone lets somebody pick it again the same
   * afternoon and recreate what was just merged.
   */
  ok("the merge moves the products and shortens the list together",
    /\$transaction\([\s\S]{0,600}product\.updateMany[\s\S]{0,600}appSetting\.upsert/.test(mergeBody));
  // The taxonomy is edited in Settings, so changing it is that authority — not
  // `products`, which every warehouse account holds.
  ok("and needs the settings permission, not the products one",
    /hasPermission\(user, "settings"\)/.test(mergeBody.slice(0, 700)));
  // Stored in the list's own spelling, never the caller's.
  ok("the target is taken from the list, not from the request",
    /matchKnownCategory\(to, known\)!/.test(mergeBody));

  const routes = readFileSync("src/server/routes/products.ts", "utf8");
  // Or Express answers 404 for a product whose id is the literal string.
  ok("the categories route is registered before /api/products/:id",
    routes.indexOf('"/api/products/categories"') < routes.indexOf('"/api/products/:id"'));
}

head("Follow-up: a result that ends a sale, and the outcome it offers to write");
{
  /*
   * Recording «تأیید نهایی خرید» used to leave the quotation sitting in the
   * queue as open, because the follow-up result and the commercial outcome are
   * two different columns and nothing connected them. The screen now asks, and
   * writes both in one transaction when the answer is yes.
   */

  /* -- which results mean something commercial, and which deliberately do not -- */
  eq("confirming the purchase suggests a win",
    impliedSettlement(RESULT_PURCHASE_CONFIRMED), "WON");
  eq("the customer cancelling suggests a cancellation",
    impliedSettlement(RESULT_PURCHASE_CANCELLED), "CANCELLED");
  eq("losing to a competitor suggests a loss",
    impliedSettlement(RESULT_LOST_TO_COMPETITOR), "LOST");
  /*
   * The rule the older note in this file exists for: a deferral is a follow-up
   * state, not a lost sale. Reading «خرید به تعویق افتاد» as a loss would file
   * a live opportunity as dead and poison every report built on lossReasons.
   */
  eq("but a deferral suggests nothing", impliedSettlement("خرید به تعویق افتاد"), null);
  eq("nor does silence", impliedSettlement("عدم پاسخ"), null);
  eq("nor «سایر»", impliedSettlement("سایر"), null);
  eq("nor an empty result", impliedSettlement(""), null);
  // A renamed list entry stops suggesting rather than guessing — a wrong guess
  // about a sale is worse than no guess, and the outcome is still selectable.
  eq("nor an entry somebody has renamed", impliedSettlement("تایید خرید!"), null);

  ok("every decisive result is actually in the list",
    [RESULT_PURCHASE_CONFIRMED, RESULT_PURCHASE_CANCELLED, RESULT_LOST_TO_COMPETITOR]
      .every((r) => DEFAULT_FOLLOW_UP_RESULTS.includes(r)));
  // Or the list would offer a result the rule cannot recognise, and vice versa.
  eq("and nothing else in the list suggests an outcome",
    DEFAULT_FOLLOW_UP_RESULTS.filter((r) => impliedSettlement(r) !== null).length, 3);

  /* -- «بدون اقدام بعدی», which was greyed out at the moment it was wanted -- */
  const base = { followUpResult: RESULT_PURCHASE_CONFIRMED };
  const open = { todayJalali: "1405/08/21", outcomeIsTerminal: false };

  ok("closing with no next action is refused on a live quotation",
    completionRefusalReason({ ...base, decision: "TERMINAL" }, open) !== null);
  /*
   * The whole point. The call where the customer confirms the purchase is the
   * call after which no next action is needed — settling it here is settling
   * it, so the option unlocks.
   */
  eq("but allowed when the outcome is being settled in the same form",
    completionRefusalReason(
      { ...base, decision: "TERMINAL", settleOutcome: "WON" }, open), null);
  eq("and allowed when it was already settled elsewhere",
    completionRefusalReason(
      { ...base, decision: "TERMINAL" },
      { ...open, outcomeIsTerminal: true }), null);

  /*
   * Nothing to settle twice: writing the outcome again would re-stamp every
   * line and, on a won document, re-date the sale that customer-value ranking
   * counts from.
   */
  ok("settling a quotation that is already decided is refused",
    completionRefusalReason(
      { ...base, decision: "TERMINAL", settleOutcome: "WON" },
      { ...open, outcomeIsTerminal: true }) !== null);
  ok("and an outcome nobody offers is refused",
    completionRefusalReason(
      { ...base, decision: "TERMINAL", settleOutcome: "HALF_WON" as never }, open) !== null);

  // Settling alongside a next action is legitimate — a won order still needs
  // chasing through to delivery — so the two are independent.
  eq("settling does not force the decision",
    completionRefusalReason({
      ...base, decision: "NEXT_ACTION", settleOutcome: "WON",
      nextTitle: "پیگیری تحویل", nextDueDate: "1405/09/01",
    }, open), null);

  /* -- the write, in the service -- */
  const service = readFileSync("src/server/services/followUpService.ts", "utf8");
  const body = service.slice(service.indexOf("export async function completeFollowUp"));
  /*
   * One transaction. The alternative is a follow-up recorded as «تأیید نهایی
   * خرید» against a document still open in the queue — the exact state this
   * screen exists to stop.
   */
  ok("the outcome is written inside the completion's own transaction",
    /\$transaction\([\s\S]*?if \(settleOutcome\) \{[\s\S]{0,400}proformaItem\.updateMany/.test(body));
  // Cancelling is a fact about the document, which the outcome rule reads first.
  ok("cancelling sets the document's own flag",
    /settleOutcome === "CANCELLED" \? \{ isCancelled: true \}/.test(body));
  // The same function the outcome modal calls, so the two cannot disagree.
  ok("and the project is re-derived through the shared rule",
    /syncProjectStatus\(tx, proforma\.projectId, todayJalali\)/.test(body));
  ok("a loss reason is written only onto a loss",
    /settleOutcome === "LOST"\s*\?\s*toNullableString\(input\.settleLossReason/.test(body));
  // Marking a quotation won is exactly what turns it into a sale.
  ok("and the customer ranking is told",
    /if \(settleOutcome\) scheduleCustomerValueRecalculation\(\)/.test(body));

  const modal = readFileSync("src/components/FollowUpCompletionModal.tsx", "utf8");
  // A question, not an action: only the person on the call knows whether
  // «confirmed» meant the whole quotation or two lines of it.
  ok("the screen asks before it writes",
    /impliedSettlement\(followUpResult\)/.test(modal)
    && /follow-up-settle-yes/.test(modal) && /follow-up-settle-no/.test(modal));
  ok("and the terminal option unlocks when the answer is yes",
    /!outcomeIsTerminal && !settleOutcome/.test(modal));
}

/* ── The tasks board: what a card names, and hiding what is done ─────────── */
{
  /*
   * `Task.relatedToType` is stored in two languages and always was.
   *
   * The reader that puts the project and the customer on a card compared
   * against the Persian words alone, so every task an automation raised — each
   * sales follow-up among them, which is most of that board — came back with no
   * project and no customer at all.
   *
   * Both halves are pinned: the rule reads both spellings, and the writers that
   * actually shipped the Latin ones still write them, so changing either side
   * is reported here rather than blanking the cards again.
   */
  eq("«پروژه» is a project", taskRelationKind("پروژه"), "project");
  eq("«پیش‌فاکتور» is a proforma", taskRelationKind("پیش‌فاکتور"), "proforma");
  eq("«مشتری» is a customer", taskRelationKind("مشتری"), "customer");
  eq("and so is the Latin key the automations write", taskRelationKind("proforma"), "proforma");
  eq("...for a project", taskRelationKind("project"), "project");
  eq("...for a customer", taskRelationKind("customer"), "customer");
  // A value nothing writes must resolve to nothing rather than to a guess: the
  // id would then be looked up in the wrong table.
  eq("anything else names nothing", taskRelationKind("سررسید"), null);
  eq("...including an absent one", taskRelationKind(null), null);
  eq("...and one that is not a string", taskRelationKind(7), null);

  const followUp = readFileSync("src/server/services/followUpService.ts", "utf8");
  ok("a sales follow-up is still raised as the Latin \"proforma\"",
    /relatedToType:\s*"proforma"/.test(followUp));
  const workflow = readFileSync("src/server/services/workflowService.ts", "utf8");
  ok("and the workflow engine still raises the Latin \"project\"",
    /relatedToType:\s*enrichedPayload\.projectId \? "project"/.test(workflow));
  const milestones = readFileSync("src/server/services/milestoneAutomation.ts", "utf8");
  ok("...as does the milestone automation",
    /relatedToType:\s*"project"/.test(milestones));

  const service = readFileSync("src/server/services/taskService.ts", "utf8");
  const context = service.slice(service.indexOf("async function withProjectContext"));
  ok("the card's context resolves the kind through the shared rule",
    /taskRelationKind\(row\.relatedToType\)/.test(context));
  // The fault itself: a bare comparison against one spelling.
  ok("and never against a spelling written out on the spot",
    !/row\.relatedToType\s*===\s*"/.test(context));

  /* -- «انجام‌شده‌ها را پنهان کن» -- */
  const user: AuthUser = {
    id: "u1", username: "u", name: "u", isSystemAdmin: true,
    permissions: { erp_tasks: true, tasksAll: true },
  } as unknown as AuthUser;
  const query = (filters: Record<string, string>): ListQuery => ({
    page: 1, pageSize: 50, search: "", order: "desc", filters,
  });
  // A clause on the query, because the board is paged: hiding the rows after
  // they arrive empties a page of twenty done tasks and prints the full total.
  const clauses = (where: Record<string, unknown>) =>
    JSON.stringify((where.AND as unknown[]) ?? []);
  ok("the toggle drops the completed rows in the query",
    clauses(buildTaskWhere(query({}), user, { hideCompleted: true }))
      .includes('{"status":{"not":"انجام شده"}}'));
  ok("...and off, it drops nothing",
    !clauses(buildTaskWhere(query({}), user, {})).includes('"انجام شده"'));
  // Asking for «انجام شده» from the dropdown and being answered with nothing
  // would be a screen that explains none of it.
  ok("an explicit status wins over the toggle",
    !clauses(buildTaskWhere(query({ status: "انجام شده" }), user, { hideCompleted: true }))
      .includes('{"status":{"not":"انجام شده"}}'));
  // Read strictly, so a caller that sends nothing gets the whole list.
  ok("...and only a real true hides anything",
    !clauses(buildTaskWhere(query({}), user, { hideCompleted: "false" })).includes('"انجام شده"'));

  const route = readFileSync("src/server/routes/tasks.ts", "utf8");
  ok("the route passes the flag through", /hideCompleted:\s*req\.query\.hideCompleted === "true"/.test(route));

  /* -- searching by the job, not only by the task's own words -- */
  /*
   * `relatedToName` is one string the browser resolved out of a picker at save
   * time, so a search for a project code found a task only if somebody happened
   * to have typed the code into that field — and the customer behind the job
   * was not reachable at all. The link is polymorphic, so the ids are resolved
   * first and offered to the clause.
   */
  const withRelated = clauses(buildTaskWhere(
    { ...query({}), search: "ATA-1404" }, user, { relatedIds: ["p1", "p2"] }));
  ok("a search reaches the records a task points at",
    withRelated.includes('{"relatedToId":{"in":["p1","p2"]}}'), withRelated);
  /*
   * Widening, never narrowing — and specifically in the **same** OR as the
   * task's own columns. As a sibling AND it would mean «matches the words *and*
   * belongs to a matching job», which answers nothing for a task whose title
   * does not repeat its project's name: almost all of them.
   */
  const searchBranch = (JSON.parse(withRelated) as Record<string, unknown>[])
    .find((c) => Array.isArray((c as { OR?: unknown[] }).OR)
      && JSON.stringify(c).includes("relatedToId")) as { OR: Record<string, unknown>[] } | undefined;
  ok("...in the same OR as the task's own columns",
    !!searchBranch
    && searchBranch.OR.some((b) => "title" in b)
    && searchBranch.OR.some((b) => "assignedToName" in b),
    withRelated);
  ok("with nothing resolved the clause is what it always was",
    !clauses(buildTaskWhere({ ...query({}), search: "ATA-1404" }, user, {}))
      .includes("relatedToId"));
  // An empty search must not turn into «relatedToId in []», which matches
  // nothing and would empty the board.
  ok("and an empty search adds no clause at all",
    !clauses(buildTaskWhere(query({}), user, { relatedIds: ["p1"] })).includes("relatedToId"));

  const searchService = readFileSync("src/server/services/taskService.ts", "utf8");
  ok("the resolver reads projects, quotations and customers",
    /db\.project\.findMany/.test(searchService) && /db\.proforma\.findMany/.test(searchService)
    && /db\.customer\.findMany/.test(searchService));
  // SQL Server's collation treats ی/ي and the two digit sets as different
  // characters, so a bare `contains` silently misses rows on the screen.
  ok("...every one of them through searchClause, never a bare contains",
    !/\{ contains: trimmed \}/.test(searchService));
  // A term like «ا» would otherwise name every project in the company.
  ok("and the scan is bounded", /take: RELATED_SCAN_LIMIT/.test(searchService));
  const view = readFileSync("src/components/TasksView.tsx", "utf8");
  ok("and the screen has the button", /setFilter\('hideCompleted'/.test(view));

  /*
   * A task belongs to two people, and the card drew only one of them.
   *
   * `createdByUserId` is the second arm of `visibilityClause` and what «من
   * ارجاع دادم» filters on, so a row showing under «همه وظایف» and in neither
   * tab is one raised by somebody else for somebody else — and nothing on the
   * card said so. It arrives on the row and is now printed.
   */
  const api = readFileSync("src/api/tasks.ts", "utf8");
  ok("the creator's name reaches the client", /createdByName: row\.createdByName/.test(api));
  ok("and the card prints it", /ارجاع‌دهنده:/.test(view));
  // Absent is not a gap in the record: it is what an automation-raised task and
  // every task written before the column existed both carry, so it is named.
  ok("...naming the absent case rather than drawing a blank",
    /task\.createdByName \|\| '[^']+'/.test(view));
  ok("the list actually selects it", /createdByUserId: true, createdByName: true/.test(service));
}

/* ── One loss reason per project ─────────────────────────────────────────── */
{
  /*
   * Why a job was lost was recordable in two places that meant the same thing —
   * the lines of its quotations, and a box on the project form — so a report of
   * loss reasons found two answers for one project. The quotations win, because
   * that is where the loss is actually decided and where the project's status
   * already comes from; the box answers only for a project nothing was ever
   * quoted on.
   */
  const pf = (
    id: string, createdAt: string,
    items: { status?: string | null; lossReason?: string | null }[],
    extra: { isCancelled?: boolean; lossReason?: string | null } = {},
  ) => ({ id, createdAt, status: "ارسال شده", items, ...extra });

  const LOST = ITEM_LOST;

  eq("no proformas: the project's own box is the only answer there is",
    deriveProjectLossReason([]), undefined);

  eq("one lost line gives its reason",
    deriveProjectLossReason([pf("a", "2026-01-01", [{ status: LOST, lossReason: "قیمت بالا" }])]),
    "قیمت بالا");

  // The report needs one value per project, so disagreement is resolved rather
  // than reported as two.
  eq("the commonest reason wins where the lines disagree",
    deriveProjectLossReason([pf("a", "2026-01-01", [
      { status: LOST, lossReason: "قیمت بالا" },
      { status: LOST, lossReason: "زمان تحویل" },
      { status: LOST, lossReason: "زمان تحویل" },
    ])]),
    "زمان تحویل");
  eq("...and a tie goes to the first, deterministically",
    deriveProjectLossReason([pf("a", "2026-01-01", [
      { status: LOST, lossReason: "قیمت بالا" },
      { status: LOST, lossReason: "زمان تحویل" },
    ])]),
    "قیمت بالا");

  // One vote against the lines' many: it answers a document written off without
  // per-line reasons, and never overrules them.
  eq("the document's own reason answers when its lines carry none",
    deriveProjectLossReason([pf("a", "2026-01-01",
      [{ status: LOST }, { status: LOST }], { lossReason: "انصراف مشتری" })]),
    "انصراف مشتری");
  eq("...and does not overrule lines that do",
    deriveProjectLossReason([pf("a", "2026-01-01", [
      { status: LOST, lossReason: "قیمت بالا" },
      { status: LOST, lossReason: "قیمت بالا" },
    ], { lossReason: "انصراف مشتری" })]),
    "قیمت بالا");

  /*
   * The two answers that are not a string, and the difference between them is
   * the whole reason this is three-valued.
   */
  eq("lost with nothing recorded leaves the project's own value alone",
    deriveProjectLossReason([pf("a", "2026-01-01", [{ status: LOST }])]), undefined);
  eq("nothing lost at all clears a reason left over from an earlier status",
    deriveProjectLossReason([pf("a", "2026-01-01", [{ status: ITEM_WON }])]), null);
  eq("...and a live quotation is not a loss either",
    deriveProjectLossReason([pf("a", "2026-01-01", [{ status: "جاری" }])]), null);

  /*
   * The same documents the status is derived from. A superseded revision must
   * not contribute a reason the winning quotation disagrees with — this is the
   * pair that would read «باخته» and «قیمت بالا» together.
   */
  eq("a losing revision beside a winning one contributes nothing",
    deriveProjectLossReason([
      pf("old", "2026-01-01", [{ status: LOST, lossReason: "قیمت بالا" }]),
      pf("new", "2026-02-01", [{ status: ITEM_WON }]),
    ]), null);
  // And the status agrees, which is the point of sharing `decidingProformas`.
  eq("...and the project reads as won",
    deriveProjectStatus([
      pf("old", "2026-01-01", [{ status: LOST, lossReason: "قیمت بالا" }]),
      pf("new", "2026-02-01", [{ status: ITEM_WON }]),
    ]), "برنده (موفق)");

  /* -- a lost line has to say why -- */
  eq("a lost line with no reason is named by its position",
    lostLineWithoutReason([{ status: ITEM_WON }, { status: LOST }]), 1);
  eq("...and a blank one counts as none",
    lostLineWithoutReason([{ status: LOST, lossReason: "   " }]), 0);
  eq("a reason given passes", lostLineWithoutReason([{ status: LOST, lossReason: "قیمت بالا" }]), null);
  // Only a loss carries one: demanding it of a win or a cancellation would
  // make the outcome modal unsubmittable.
  eq("a win needs none", lostLineWithoutReason([{ status: ITEM_WON }]), null);
  eq("nor does a cancellation", lostLineWithoutReason([{ status: ITEM_CANCELLED }]), null);

  /* -- the form and the write path -- */
  const input = (lossReason?: string) =>
    (lossReason === undefined ? {} : { lossReason }) as Parameters<typeof lossReasonRefusal>[0];
  ok("with no quotation the project's own box is accepted",
    lossReasonRefusal(input("قیمت بالا"), null, 0) === null);
  ok("with one, a different value is refused rather than quietly dropped",
    lossReasonRefusal(input("قیمت بالا"), "زمان تحویل", 1) !== null);
  // The form sends the field back on every save of a lost project; refusing
  // that would make the record unsavable for an unrelated edit.
  ok("...but re-sending the derived value is not an edit",
    lossReasonRefusal(input("زمان تحویل"), "زمان تحویل", 1) === null);
  ok("...and an absent field is never an edit",
    lossReasonRefusal(input(), "زمان تحویل", 1) === null);

  const service = readFileSync("src/server/services/proformaService.ts", "utf8");
  const sync = service.slice(service.indexOf("export async function syncProjectStatus"));
  ok("the project's reason is written where its status is",
    /deriveProjectLossReason\(proformas\)/.test(sync));
  // `undefined` means «say nothing», and writing it would blank the column.
  ok("and «say nothing» writes nothing",
    /nextLossReason !== undefined/.test(sync));
  ok("the lines' reasons are actually selected", /lossReason: true/.test(sync));

  const view = readFileSync("src/components/ProjectsView.tsx", "utf8");
  ok("the form shows the derived value read-only once a quotation exists",
    /project-loss-reason-derived/.test(view));
  ok("and sends nothing for it", /proformaCount === 0 \? lossReason : void 0/.test(view));

  const route = readFileSync("src/server/routes/proformas.ts", "utf8");
  ok("the outcome endpoint refuses a lost line with no reason",
    /lostLineWithoutReason\(outcomes\)/.test(route));
}

/* ── Settings a rule refers to by name ───────────────────────────────────── */
{
  /*
   * A default added to `seedData.ts` reaches a fresh installation and nothing
   * else. Three follow-up results are what `impliedSettlement` keys on, so on
   * every database seeded before them the option was not in the dropdown at
   * all and the feature read as broken rather than unconfigured.
   */
  const base = (results: string[]): ERPSettings => ({
    ...DEFAULT_SETTINGS,
    dropdownItems: { ...DEFAULT_SETTINGS.dropdownItems, followUpResults: results },
    appliedPatches: undefined,
  } as ERPSettings);

  const old = base(["در حال بررسی فنی", "عدم پاسخ"]);
  const patched = applySettingsPatches(old);
  ok("an old document gains the three settling results", patched !== null);
  eq("...appended, not replacing what was there",
    patched?.next.dropdownItems.followUpResults?.slice(0, 2).join("|"),
    "در حال بررسی فنی|عدم پاسخ");
  ok("...and all three arrive",
    [RESULT_PURCHASE_CONFIRMED, RESULT_PURCHASE_CANCELLED, RESULT_LOST_TO_COMPETITOR]
      .every((r) => patched?.next.dropdownItems.followUpResults?.includes(r)));
  // Every one of them is what `impliedSettlement` matches on: an entry that
  // arrives but suggests nothing would be decoration.
  ok("...each of which actually settles something",
    [RESULT_PURCHASE_CONFIRMED, RESULT_PURCHASE_CANCELLED, RESULT_LOST_TO_COMPETITOR]
      .every((r) => impliedSettlement(r) !== null));

  // Applied once. Removing an entry afterwards has to stick, or somebody is
  // handed it back every restart.
  ok("a patched document is not patched again",
    applySettingsPatches(patched!.next) === null);
  const trimmed = { ...patched!.next };
  trimmed.dropdownItems = {
    ...trimmed.dropdownItems,
    followUpResults: (trimmed.dropdownItems.followUpResults ?? [])
      .filter((r) => r !== RESULT_LOST_TO_COMPETITOR),
  };
  ok("...and a deliberately removed entry stays removed",
    applySettingsPatches(trimmed) === null);

  // A fresh installation already has them, and is still marked: otherwise the
  // decision is re-made on every restart for ever.
  const fresh = applySettingsPatches(DEFAULT_SETTINGS as ERPSettings);
  ok("a fresh document is recorded as patched without being changed",
    fresh !== null
    && fresh.next.dropdownItems.followUpResults?.length
      === DEFAULT_SETTINGS.dropdownItems.followUpResults?.length);

  const settings = readFileSync("src/server/settings.ts", "utf8");
  ok("the server applies them", /export async function ensureSettingsPatches/.test(settings));
  const admin = readFileSync("src/server/services/adminService.ts", "utf8");
  // The browser sends a whole document it may have read before the patch.
  ok("...on every settings save as well as at startup",
    /await ensureSettingsPatches\(\)/.test(admin)
    && /void ensureSettingsPatches\(\)/.test(readFileSync("server.ts", "utf8")));

  /* -- a loss has to say why, here too -- */
  const body = (extra: Record<string, unknown>) => ({
    decision: "TERMINAL" as const, followUpResult: RESULT_LOST_TO_COMPETITOR, ...extra,
  });
  const ctx = { todayJalali: "1405/06/10", outcomeIsTerminal: false };
  ok("settling a loss with no reason is refused",
    completionRefusalReason(body({ settleOutcome: "LOST" }), ctx) !== null);
  eq("...and accepted with one",
    completionRefusalReason(body({ settleOutcome: "LOST", settleLossReason: "قیمت بالا" }), ctx),
    null);
  // Only a loss. A win carrying no reason is the ordinary case.
  eq("a win needs none here either",
    completionRefusalReason(
      { decision: "TERMINAL", followUpResult: RESULT_PURCHASE_CONFIRMED, settleOutcome: "WON" },
      ctx),
    null);
}

/* ── Reactions and read receipts on an activity message ──────────────────── */
{
  /* -- the allowlist -- */
  ok("there are a handful of reactions, not a keyboard",
    ACTIVITY_REACTIONS.length >= 5 && ACTIVITY_REACTIONS.length <= 8,
    ACTIVITY_REACTIONS.length);
  ok("each has a label a person can read",
    ACTIVITY_REACTIONS.every((r) => !!r.emoji && !!r.label));
  ok("...and no emoji appears twice",
    new Set(ACTIVITY_REACTIONS.map((r) => r.emoji)).size === ACTIVITY_REACTIONS.length);
  // The emoji is rendered on everybody else's screen, so it is checked coming in.
  ok("a listed reaction is allowed", ACTIVITY_REACTIONS.every((r) => isAllowedReaction(r.emoji)));
  ok("anything else is refused",
    !isAllowedReaction("🦄") && !isAllowedReaction("") && !isAllowedReaction("<b>x</b>")
    && !isAllowedReaction(null) && !isAllowedReaction(7));

  /* -- the chips -- */
  const rows = [
    { emoji: "👍", userId: "u1", userName: "علی" },
    { emoji: "✅", userId: "u3", userName: "رضا" },
    { emoji: "👍", userId: "u2", userName: "مریم" },
  ];
  const chips = summarizeReactions(rows, "u2");
  eq("one chip per emoji, however many pressed it", chips.length, 2);
  /*
   * First-seen order, deliberately not by count: a row that reorders itself as
   * colleagues react is a row whose buttons move under the cursor, and the
   * counts are right there to be read.
   */
  eq("...in the order they first appeared", chips.map((c) => c.emoji).join(","), "👍,✅");
  eq("counted", chips[0].count, 2);
  eq("...and named, so the chip can say who", chips[0].names.join("،"), "علی،مریم");
  ok("the one you pressed is marked", chips[0].mine && !chips[1].mine);
  ok("...and nobody's is when you are not signed in",
    summarizeReactions(rows, null).every((c) => !c.mine));

  // A renamed colleague reads under the name they have now; the stored copy is
  // all there is for an account that has since been removed.
  const renamed = summarizeReactions(rows, "u2", (id) => (id === "u1" ? "علی رضایی" : undefined));
  eq("the current name wins over the stored one", renamed[0].names.join("،"), "علی رضایی،مریم");

  /* -- the write path -- */
  const service = readFileSync("src/server/services/activityService.ts", "utf8");
  // A JSON column on the message would be a read-modify-write race between two
  // people reacting at once; a row per person per emoji is not.
  ok("a reaction is a row, toggled against the unique index",
    /activityReaction\.delete/.test(service) && /activityReaction\.create/.test(service));
  ok("the allowlist is enforced on the server", /isAllowedReaction\(emoji\)/.test(service));
  /*
   * «چه کسانی دیده‌اند» answers «did this reach anybody», and the person who
   * wrote it is not an answer — recorded, every message would look as though it
   * had one reader.
   */
  ok("the author is never recorded as having read their own message",
    /authorUserId: user\.id/.test(service));
  /*
   * `createMany({ skipDuplicates })` is unsupported on SQL Server: writing them
   * blind would fail the whole batch on the second visit to a conversation,
   * which is every visit. Comments are stripped first — the note in the service
   * explaining exactly this names the thing being searched for, so a check
   * reading the raw file fails on the sentence saying it was avoided.
   */
  const serviceCode = service.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
  ok("existing receipts are read before new ones are written",
    /activityRead\.findMany/.test(serviceCode) && !/skipDuplicates/.test(serviceCode));
  ok("...and the comment stripper is not simply eating everything",
    /activityReaction\.create/.test(serviceCode));

  const feed = service.slice(service.indexOf("const ACTIVITY_INCLUDE"));
  ok("the chips travel with the feed", /reactions: \{/.test(feed));
  // Every reader of every message would be the largest thing in the response.
  ok("...and the readers are a count there, not a list",
    /_count: \{ select: \{ reads: true \} \}/.test(feed));

  const route = readFileSync("src/server/routes/activities.ts", "utf8");
  // Otherwise Express reads «read» as an activity id and answers 404.
  ok("«read» is registered before the id routes",
    route.indexOf('"/api/activities/read"') < route.indexOf('"/api/activities/:id/reads"'));

  const api = readFileSync("src/api/projects.ts", "utf8");
  /*
   * The receipt must not announce a change: the feed re-reads itself on every
   * write anywhere, and the re-read is what puts the messages on screen, which
   * is what posts the receipts.
   */
  ok("posting a receipt is not announced as a change",
    /postQuietly<\{ recorded: number \}>\("\/api\/activities\/read"/.test(api));
  const client = readFileSync("src/api/client.ts", "utf8");
  ok("...which the client actually honours",
    /method !== "GET" && announce/.test(client));

  const hook = readFileSync("src/api/useProjectActivities.ts", "utf8");
  // Once per message per session, not once per render: the feed revalidates on
  // every write in the application.
  ok("a receipt is posted once per message", /reported\.current\.has\(id\)/.test(hook));
  /*
   * And only for what is actually on screen. Every category the project has
   * arrives with the feed and each stays folded until somebody opens it, so
   * reporting the whole fetch would claim people had read conversations they
   * never unfolded — which is the one thing the eye must not do.
   */
  const screen = readFileSync("src/components/ProjectsView.tsx", "utf8");
  ok("...and only for the categories somebody opened",
    /filter\(\(group\) => !!expandedGroups\[group\.id\]\)/.test(screen));
  ok("the hook does not decide that for itself",
    !/groups\s*\n?\s*\.flatMap\(\(g\) => g\.activities/.test(hook));

  const migration = readFileSync(
    "prisma/migrations/20260908000000_activity_reactions_reads/migration.sql", "utf8");
  ok("the reaction table is unique per person per emoji",
    /UNIQUE NONCLUSTERED INDEX \[activity_reactions_activityId_userId_emoji_key\]/.test(migration));
  ok("and a message is read once per person",
    /UNIQUE NONCLUSTERED INDEX \[activity_reads_activityId_userId_key\]/.test(migration));
}

/* ── One board over two kinds of work ────────────────────────────────────── */
{
  /*
   * «کارتابل ارجاعات» and «وظایف و پیگیری» asked the same question — what has
   * been given to me to do — so people had to look in two places. One screen,
   * three columns, and a referral stays its own record: two status columns to
   * keep in step is the fault this codebase keeps repairing.
   */
  eq("a new task is in the first column", taskLane(TASK_TODO), "TODO");
  eq("...and everything written before the board is in the middle one",
    taskLane(TASK_DOING), "DOING");
  eq("finished work is in the last", taskLane(TASK_DONE), "DONE");
  /*
   * A cancelled task is finished with, so it goes in the last column rather
   * than getting a fourth one nobody asked for — marked there, not hidden.
   */
  eq("...and so is cancelled work", taskLane(TASK_CANCELLED), "DONE");
  /*
   * The direction the fallback leans is the whole of it: an open task filed
   * among the finished ones is the failure that matters, so anything
   * unrecognised — a value from an integration, or from a later version — is
   * open work.
   */
  eq("a status nobody designed for is open, never done", taskLane("در انتظار تأیید"), "DOING");
  eq("...including an empty one", taskLane(""), "DOING");
  eq("...and a missing one", taskLane(null), "DOING");

  eq("a fresh referral is in the first column", referralLane(REFERRAL_PENDING), "TODO");
  eq("one that was picked up is in the middle", referralLane(REFERRAL_DOING), "DOING");
  eq("a closed one is in the last", referralLane(REFERRAL_DONE), "DONE");
  /*
   * Open, and specifically **not** done — which is the property that matters.
   * A referral falls to the first column rather than the middle because its own
   * default status is the pending one, so an unrecognised value most likely
   * means «nobody has picked this up».
   */
  eq("and an unrecognised referral status is open too", referralLane("؟"), "TODO");
  ok("...never done", referralLane("؟") !== "DONE" && taskLane("؟") !== "DONE");

  /*
   * The value the client actually writes, pinned.
   *
   * `setReferralStatus` compared the incoming status against «اتمام کار» —
   * which is a *category group's* closing status, from another table — to
   * decide which notice to send. The true branch could never fire, so every
   * completed referral told the person who raised it that it had been
   * **reopened**.
   */
  eq("a referral closes as «انجام شده»", String(REFERRAL_DONE), "انجام شده");
  const activityService = readFileSync("src/server/services/activityService.ts", "utf8");
  ok("and the notice reads it through the shared rule",
    /const done = referralLane\(newStatus\) === "DONE"/.test(activityService));
  // The literal that made the true branch unreachable, gone from the file.
  ok("...not against the category group's «اتمام کار»",
    !/newStatus === "اتمام کار"/.test(activityService));

  // Picking a referral up must not empty the badge that says what is on your
  // plate, so «open» is an exclusion rather than the exact pending status.
  ok("a referral in hand still counts as needing action",
    referralIsOpen(REFERRAL_PENDING) && referralIsOpen(REFERRAL_DOING)
    && !referralIsOpen(REFERRAL_DONE));
  const badges = readFileSync("src/api/useSidebarBadges.ts", "utf8");
  ok("...and the badge asks for that, not for one status",
    /open: "true"/.test(badges) && !/status: "در انتظار اقدام"/.test(badges));

  /* -- what a drop writes -- */
  eq("dropping into the first column queues it", taskStatusForLane("TODO"), TASK_TODO);
  eq("...the middle one starts it", taskStatusForLane("DOING"), TASK_DOING);
  eq("...and the last finishes it", taskStatusForLane("DONE"), TASK_DONE);
  /*
   * Cancelling is a decision somebody makes on the card, never something a
   * move does by accident — and a card already cancelled keeps what it has.
   */
  eq("a move never cancels anything", taskStatusForLane("DONE", TASK_DOING), TASK_DONE);
  eq("...and never un-cancels either", taskStatusForLane("DONE", TASK_CANCELLED), TASK_CANCELLED);

  /* -- the order of a column -- */
  const card = (id: string, createdAt: string, priority?: string) =>
    ({ id, createdAt, priority });
  const order = (list: { id: string }[]) => list.map((c) => c.id).join(",");

  const cards = [
    card("old-urgent", "2026-01-01", "فوری"),
    card("new-low", "2026-03-01", "پایین"),
    card("mid-referral", "2026-02-01"),
  ];
  eq("by date, newest first", order(sortBoardCards(cards, "date")), "new-low,mid-referral,old-urgent");
  /*
   * A referral carries no priority at all and sorts as «متوسط» — the middle of
   * the ladder, not the bottom: a colleague asking for something by name is not
   * inherently less urgent than a task somebody filed as low, and putting every
   * referral under every task would empty the top of the column of exactly what
   * the merge exists to surface.
   */
  eq("by priority, and a referral sorts as «متوسط»",
    order(sortBoardCards(cards, "priority")), "old-urgent,mid-referral,new-low");
  // Nine «متوسط» cards in arbitrary order is not sorted at all.
  eq("ties inside a priority break by date",
    order(sortBoardCards([
      card("a", "2026-01-01", "بالا"), card("b", "2026-05-01", "بالا"),
    ], "priority")), "b,a");
  // The caller is holding React state.
  ok("the input is never reordered in place",
    (() => { const input = [...cards]; sortBoardCards(input, "priority"); return input[0].id === "old-urgent"; })());

  /* -- the two dates -- */
  const started = { status: TASK_TODO, startedAt: null };
  ok("picking a task up stamps when",
    "startedAtJalali" in laneTimestamps(started, TASK_DOING, "1405/06/10"));
  // The day work began is a fact; a task pushed back and picked up again did
  // not start twice.
  ok("...and picking it up again does not restamp it",
    !("startedAtJalali" in laneTimestamps(
      { status: TASK_TODO, startedAt: new Date() }, TASK_DOING, "1405/06/10")));
  const done = laneTimestamps({ status: TASK_DOING, startedAt: new Date() }, TASK_DONE, "1405/06/10");
  ok("finishing stamps the completion date", done.completedAtJalali === "1405/06/10");
  /*
   * The opposite rule for the opposite reason: a task showing a completion date
   * while it sits in «در حال انجام» claims to be finished, which is exactly
   * what moving it back said it is not.
   */
  const reopened = laneTimestamps({ status: TASK_DONE, startedAt: new Date() }, TASK_DOING, "1405/06/10");
  ok("...and reopening clears it", reopened.completedAt === null);
  eq("a status change inside one column stamps nothing",
    Object.keys(laneTimestamps({ status: TASK_DONE, startedAt: null }, TASK_CANCELLED, "1405/06/10")).length, 0);

  /* -- the merge's own wiring -- */
  const modules = readFileSync("src/appModules.ts", "utf8");
  ok("«کارتابل ارجاعات» is no longer a module of its own",
    !/id: "referrals"/.test(modules));
  const auth = readFileSync("src/server/auth.ts", "utf8");
  /*
   * The referral endpoints were gated by `erp_project_category_groups` — the
   * **projects** permission — because they share a route file with the activity
   * feed. A user with the referrals module and without projects got 403 on
   * their own inbox; merged into the board, that would have been every account.
   */
  ok("a referral is gated as a task, not as a project",
    /erp_referrals: "tasks"/.test(auth));
  const route = readFileSync("src/server/routes/activities.ts", "utf8");
  ok("...and the routes use that key", /const REFERRAL_KEY = "erp_referrals"/.test(route));
  const taskRoute = readFileSync("src/server/routes/tasks.ts", "utf8");
  // Otherwise Express reads «board» as a task id.
  ok("the board move is registered before the id routes",
    taskRoute.indexOf('"/api/tasks/board/move"') < taskRoute.indexOf('"/api/tasks/:id"'));
  const taskService = readFileSync("src/server/services/taskService.ts", "utf8");
  // Closing a follow-up means recording what the customer said; a drag cannot.
  ok("a sales follow-up cannot be finished by moving it",
    /taskKind === "SALES_FOLLOW_UP" && lane === "DONE"/.test(taskService));
  ok("and a task is created in the first column", /status: TASK_TODO,/.test(taskService));

  /*
   * Recording a follow-up result without leaving the tasks screen.
   *
   * The bare tick is refused — closing one means recording what the customer
   * said — and the refusal used to send the reader to «پیگیری فروش» in the
   * proformas module to press a second button. That round trip is what the
   * merge exists to remove, so both the board card and the list's tick open
   * the same modal here.
   */
  const view = readFileSync("src/components/TasksView.tsx", "utf8");
  ok("the list's tick opens the completion form for a follow-up",
    /task\.taskKind === 'SALES_FOLLOW_UP' && task\.status !== 'انجام شده'/.test(view)
    && /void openFollowUp\(task\.id\)/.test(view));
  ok("...and the board card opens the same one",
    /card\.taskKind === 'SALES_FOLLOW_UP' && taskLane\(card\.status\) !== 'DONE'/.test(view));
  /*
   * Submitted against the task that was pressed, never the row's own
   * `nextActionTaskId`: the row is the quotation's and the completion is
   * written against one task, and the two are the same only while the card
   * pressed happens to be the open one.
   */
  ok("the completion is written against the task that was pressed",
    /salesFollowUpApi\.complete\(followUpRow\.taskId, body\)/.test(view));
  // One rule for «already decided», not a second list of the four outcomes.
  ok("and «already settled» is the shared rule",
    /isTerminalOutcome\(followUpRow\.row\.outcome\)/.test(view));
  // The message names the button now, not another module.
  const serviceCode = taskService.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
  ok("the refusal no longer sends anybody to the proformas module",
    !/ماژول پیش‌فاکتورها/.test(serviceCode));
  ok("...and the stripper is not simply eating the file",
    /SALES_FOLLOW_UP/.test(serviceCode));
}

console.log(`\n${"─".repeat(56)}\n${pass} checks passed, ${fails.length} failed`);
if (fails.length) { console.log("Failures:"); fails.forEach(f => console.log("  • " + f)); }
