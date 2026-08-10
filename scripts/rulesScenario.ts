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
import { rowToPurchaseOrder } from "../src/api/purchaseOrders";
import { rowToTask } from "../src/api/tasks";
import { samePermissions } from "../src/server/services/userService";
import { buildCustomerWhere } from "../src/server/services/customerService";
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

console.log(`\n${"─".repeat(56)}\n${pass} checks passed, ${fails.length} failed`);
if (fails.length) { console.log("Failures:"); fails.forEach(f => console.log("  • " + f)); }
