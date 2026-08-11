/**
 * The activity categories the system opens on a project, and their spellings.
 *
 * Shared by both sides on purpose. The server names a category when it records
 * a fact on the timeline; the browser names the same category when it offers to
 * close it. They must agree, and until this module existed they agreed only by
 * both containing the same string literal — which is how a rename becomes a
 * silent bug: the prompt looks for a group under the new name, the project's
 * group is stored under the old one, and closing it finds nothing.
 *
 * ## Renaming a category
 *
 * Change the canonical name here and add the previous spelling to `ALIASES`.
 * Groups already stored under the old name keep working: everything matches on
 * the canonical form, so the group a project opened last year is still the
 * group this year's fact belongs in.
 */

export const ACTIVITY_CATEGORY = {
  PROFORMAS: "پیش‌فاکتورها و مهندسی فروش",
  PURCHASE_ORDERS: "سفارش خرید و حمل",
  INQUIRIES: "استعلام قیمت تأمین‌کنندگان",
  TRANSACTIONS: "تراکنش‌های مالی و پرداخت‌ها",
  DELIVERIES: "بسته‌بندی و تحویل کالا",
  AFTER_SALES: "خدمات پس از فروش",
} as const;

/** Spaces and ZWNJ carry no meaning in these names, so they are not compared. */
export const normalizeCategoryName = (value: string): string =>
  value ? value.replace(/[\s‌]/g, "").trim().toLowerCase() : "";

/**
 * Every spelling each canonical category has been written as.
 *
 * Includes the names it used to have. «سفارشات خرید تامین‌کنندگان» is here
 * because that is what the purchase-order category was called before it became
 * «سفارش خرید و حمل», and projects still carry groups under it.
 */
const ALIASES: ReadonlyArray<readonly [string, readonly string[]]> = [
  [ACTIVITY_CATEGORY.PROFORMAS, ["پیش‌فاکتور", "پیش‌فاکتورها", ACTIVITY_CATEGORY.PROFORMAS]],
  [ACTIVITY_CATEGORY.PURCHASE_ORDERS, [
    "سفارش خرید",
    "سفارشات خرید تامین‌کنندگان",
    "سفارشات خرید تامین کنندگان",
    "سفارشات خرید تأمین‌کنندگان",
    // The milestone panel's trigger picker offered this spelling — a name no
    // group was ever filed under, so a smart trigger set to it matched nothing.
    "سفارشات خرید (PO)",
    ACTIVITY_CATEGORY.PURCHASE_ORDERS,
  ]],
  [ACTIVITY_CATEGORY.DELIVERIES, [
    "بسته‌بندی و ارسال",
    "بسته بندی و ارسال",
    ACTIVITY_CATEGORY.DELIVERIES,
  ]],
  [ACTIVITY_CATEGORY.INQUIRIES, [
    "استعلام قیمت از تامین‌کننده‌ها", "استعلام قیمت تأمین‌کنندگان", "استعلام قیمت تامین کنندگان",
  ]],
  [ACTIVITY_CATEGORY.TRANSACTIONS, [
    "مالی", "تراکنش‌های مالی و پرداخت‌ها", "تراکنش های مالی و پرداخت ها",
  ]],
];

/** The name a category is filed under, whatever spelling it arrived as. */
export function canonicalCategoryName(name: string): string {
  const n = normalizeCategoryName(name);
  for (const [canonical, spellings] of ALIASES) {
    if (spellings.some((s) => normalizeCategoryName(s) === n)) return canonical;
  }
  return name;
}

/**
 * Whether two category names mean the same category.
 *
 * Use this rather than comparing strings. A project's stored group may be named
 * with a spelling — or a previous name — that is not the one being asked about.
 */
export function sameCategory(a: string, b: string): boolean {
  return normalizeCategoryName(canonicalCategoryName(a))
    === normalizeCategoryName(canonicalCategoryName(b));
}
