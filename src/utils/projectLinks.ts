/**
 * Following a project from wherever its code is printed.
 *
 * A project code appears on almost every screen — a quotation, a purchase
 * order, a receipt, a packing list, a task — and until now it was ink. Reading
 * one meant remembering it, opening «پروژه‌ها», and typing it into the search
 * box; going the other way, from a project to the documents raised on it, meant
 * the same in reverse.
 *
 * One rule, in one place: **a project code is a link, and it takes you to a
 * module already filtered to that project.** The code is what travels, not the
 * id — every one of those screens searches by text, every code is unique, and
 * several projects here are genuinely called the same thing.
 */

import type { AppModuleId } from "../appModules";

/**
 * The modules a project can be followed into.
 *
 * Each one holds documents raised against a job and searches by the project's
 * code, which is what makes «open this module, filtered to this project» a
 * single mechanism rather than six. `dashboard`, `settings` and the rest are
 * absent because there is nothing there to filter.
 */
export const PROJECT_LINKED_MODULES = [
  "projects",
  "proformas",
  "supplierInquiries",
  "purchaseOrders",
  "packagingDelivery",
  "afterSalesServices",
  "transactions",
  "tasks",
] as const;

export type ProjectLinkedModule = (typeof PROJECT_LINKED_MODULES)[number];

export function isProjectLinkedModule(view: string): view is ProjectLinkedModule {
  return (PROJECT_LINKED_MODULES as readonly string[]).includes(view);
}

/**
 * Which module an activity category opens.
 *
 * The category names the kind of work — «استعلام», «خرید», «ارسال» — and each
 * kind has a module where that work is actually recorded. Matched on the words
 * a category name contains rather than on an id, because the categories are
 * `settings.activityCategories`: a company's own list, renamed and added to at
 * will, with no fixed id to key on. A category nothing matches simply gets no
 * link, which is the right way for this to degrade — a wrong link is worse than
 * none.
 */
const CATEGORY_KEYWORDS: { module: ProjectLinkedModule; words: string[] }[] = [
  { module: "proformas", words: ["پیش‌فاکتور", "پیش فاکتور", "پیشنهاد", "قیمت‌دهی"] },
  { module: "supplierInquiries", words: ["استعلام", "تأمین", "تامین", "وندور"] },
  { module: "purchaseOrders", words: ["خرید", "سفارش", "ترخیص", "گمرک", "حمل"] },
  { module: "packagingDelivery", words: ["بسته‌بندی", "بسته بندی", "ارسال", "تحویل", "پکینگ"] },
  { module: "afterSalesServices", words: ["پس از فروش", "گارانتی", "خدمات"] },
  { module: "transactions", words: ["مالی", "دریافت", "پرداخت", "صورتحساب", "وصول"] },
];

export function moduleForCategory(categoryName: string): ProjectLinkedModule | null {
  const name = String(categoryName ?? "").trim();
  if (!name) return null;
  /*
   * First match wins, in the order above — «استعلام خرید» is an inquiry, and
   * putting purchase orders first would send it to the wrong module. The order
   * is the specificity, so it is data and not an accident.
   */
  for (const entry of CATEGORY_KEYWORDS) {
    if (entry.words.some((word) => name.includes(word))) return entry.module;
  }
  return null;
}

/** What the sidebar calls a module, for the link's own label. */
export type ProjectJump = { view: AppModuleId; term: string };
