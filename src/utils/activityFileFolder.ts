import { categoryKey } from "./productCategories";
import { moduleForCategory, type ProjectLinkedModule } from "./projectLinks";
import { REQUEST_REVIEW_CATEGORY } from "./requestReview";
import { ACTIVITY_CATEGORY } from "./activityCategories";
import type { ActivityAttachment } from "./attachments";

/**
 * Filing a message's files in the project's documents.
 *
 * A file sent in an activity category lives on that message and nowhere else:
 * the documents tab lists the project's own records and what somebody filed by
 * hand, so a datasheet sent in «خرید» never reaches «سفارشات خرید». After a
 * message with files the screen asks whether to file them, and this is the
 * folder it offers first — the one the category's work belongs in.
 *
 * The folder names are the documents tab's own (`DOCUMENT_FOLDERS` on the
 * server); `test:rules` holds the two lists together.
 */
export const DOCUMENT_FOLDER_NAMES = [
  "درخواست مشتری و استعلام اولیه",
  "پیش‌فاکتورها و مهندسی فروش",
  "استعلام قیمت تأمین‌کنندگان",
  "سفارشات خرید تامین‌کنندگان",
  "بسته‌بندی و تحویل کالا",
  "تراکنش‌های مالی و پرداخت‌ها",
  "خدمات پس از فروش",
  "رضایت‌نامه‌ها",
  "صورتجلسات",
  "سایر مدارک و فایل‌های دستی",
] as const;

export const OTHER_DOCUMENTS_FOLDER = "سایر مدارک و فایل‌های دستی";

const FOLDER_FOR_MODULE: Record<Exclude<ProjectLinkedModule, "projects" | "tasks">, string> = {
  proformas: "پیش‌فاکتورها و مهندسی فروش",
  supplierInquiries: "استعلام قیمت تأمین‌کنندگان",
  purchaseOrders: "سفارشات خرید تامین‌کنندگان",
  packagingDelivery: "بسته‌بندی و تحویل کالا",
  afterSalesServices: "خدمات پس از فروش",
  transactions: "تراکنش‌های مالی و پرداخت‌ها",
};

/** The documents folder a category's files belong in; «سایر مدارک» when nothing fits. */
export function folderForCategory(categoryName: string | null | undefined): string {
  const key = categoryKey(categoryName);
  if (key && key === categoryKey(REQUEST_REVIEW_CATEGORY)) return "درخواست مشتری و استعلام اولیه";
  if (key && key === categoryKey(ACTIVITY_CATEGORY.MEETINGS)) return "صورتجلسات";
  const module = moduleForCategory(String(categoryName ?? ""));
  if (module && module in FOLDER_FOR_MODULE) return FOLDER_FOR_MODULE[module as keyof typeof FOLDER_FOR_MODULE];
  return OTHER_DOCUMENTS_FOLDER;
}

export interface ManualDocument {
  id: string;
  folderName: string;
  name: string;
  url: string;
  createdAt: string;
  size: string;
}

/**
 * The project's `manualDocuments` with the message's files added under
 * `folder`. A file already filed (by URL) is not filed twice, and an inline
 * `data:` entry is skipped — the documents list holds paths.
 */
export function fileAttachmentsInFolder(
  existing: readonly Record<string, unknown>[],
  files: readonly ActivityAttachment[],
  folder: string,
  todayJalali: string,
  newId: () => string,
): { documents: Record<string, unknown>[]; added: number } {
  const known = new Set(existing.map((d) => String(d.url ?? "")));
  const documents = [...existing];
  let added = 0;
  for (const f of files) {
    const url = String(f.url ?? "");
    if (!url || url.startsWith("data:") || known.has(url)) continue;
    known.add(url);
    documents.push({ id: newId(), folderName: folder, name: f.name || "سند", url, createdAt: todayJalali, size: f.size || "" } satisfies ManualDocument);
    added += 1;
  }
  return { documents, added };
}
