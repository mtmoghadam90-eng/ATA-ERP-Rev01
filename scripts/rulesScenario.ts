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

// A confirmed receipt is corrected by a reversing entry; both halves stay in
// the totals so the pair cancels.
const withReversal = calculateProjectFinance(
  { id: "pr1" } as any,
  [{ id: "pf1", projectId: "pr1", status: "ارسال شده", currency: "ریال", finalAmount: 200_000_000,
     items: [{ id: "i1", status: "برنده", totalPriceRIYAL: 200_000_000, quantity: 1, unitPriceRIYAL: 200_000_000 }] }] as any,
  [
    { id: "t1", projectId: "pr1", proformaId: "pf1", type: "دریافت", status: "تأیید شده", amountRIYAL: 60_000_000 },
    { id: "t2", projectId: "pr1", proformaId: "pf1", type: "دریافت", status: "تأیید شده", amountRIYAL: 60_000_000, reversalOfTransactionId: "t1" },
  ] as any,
  [] as any,
);
eq("a reversal cancels the receipt it corrects", withReversal.totalReceivedRiyal, 0);
eq("and the outstanding balance returns", withReversal.totalRemainingHistoricalRiyal, 200_000_000);

console.log(`\n${"─".repeat(56)}\n${pass} checks passed, ${fails.length} failed`);
if (fails.length) { console.log("Failures:"); fails.forEach(f => console.log("  • " + f)); }
