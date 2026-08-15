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
import { findCustomerDuplicates } from "../src/utils/customerDuplicates";
import { canonicalizeProvince } from "../src/utils/iranProvinces";
import { calculateProjectFinance } from "../src/utils/finance";
import { canSeeCosts } from "../src/server/auth";
import {
  redactInquiry, redactProduct, redactPurchaseOrder, stripProductCostInput,
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
import { refreshDecision, type RateRefreshState } from "../src/server/services/rateRefresh";
import { receivedDateImpliesStatus, computeTotals, RECEIVED_STATUS } from "../src/server/services/purchaseOrderService";
import { REQUIRED_FIELDS_METADATA } from "../src/utils/requiredFields";
import { findHooksAfterEarlyReturn } from "../src/utils/hookOrder";
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
 * Refreshing the currency rates once a day, on first use.
 *
 * Every foreign-priced document is valued at the stored rate, so the rate that
 * is a week old prices the day's work wrongly and says nothing. The scheduling
 * is the whole of the feature, and the alternative to testing it here is a test
 * that can only be run by waiting until tomorrow.
 */
head("Exchange rates: the once-a-day refresh");

const HOUR = 60 * 60 * 1000;
const decide = (state: Partial<RateRefreshState>, now = 10 * HOUR) =>
  refreshDecision(
    { freshFor: null, lastFailureAt: 0, running: false, ...state }, "1405/05/20", now, 30 * 60 * 1000);

eq("the first caller of the day starts the fetch", decide({}), "start");
eq("everyone after it does nothing", decide({ freshFor: "1405/05/20" }), "skip");
eq("a caller arriving mid-fetch waits on the same one", decide({ running: true }), "wait");
eq("a run in progress outranks a recent failure, rather than being skipped past",
  decide({ running: true, lastFailureAt: 10 * HOUR - 60_000 }), "wait");

// Yesterday's success does not count for today: rates are quoted per trading
// day, so a refresh at 09:00 must not stop tomorrow's 08:00 opening.
eq("yesterday's refresh does not satisfy today", decide({ freshFor: "1405/05/19" }), "start");

// A failure holds callers off for a while — but never for the rest of the day,
// or one bad minute at 08:00 would freeze the rates until tomorrow.
eq("right after a failure, callers are held off",
  decide({ lastFailureAt: 10 * HOUR - 60_000 }), "skip");
eq("an hour later, someone tries again",
  decide({ lastFailureAt: 10 * HOUR - HOUR }), "start");
eq("but a day already marked fresh still wins over a stale failure",
  decide({ freshFor: "1405/05/20", lastFailureAt: 10 * HOUR - HOUR }), "skip");

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

console.log(`\n${"─".repeat(56)}\n${pass} checks passed, ${fails.length} failed`);
if (fails.length) { console.log("Failures:"); fails.forEach(f => console.log("  • " + f)); }
