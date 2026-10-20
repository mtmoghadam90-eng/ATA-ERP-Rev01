/**
 * «بررسی درخواست» — the category every new project opens with.
 *
 * People opened it by hand on almost every job and copied the customer's
 * request into it as the first message, so the job's conversation started from
 * what was asked. That is the same act every time, so project creation does it:
 * the category is opened and the request — the project's «شرح» and the files
 * uploaded on the form — becomes its first message.
 *
 * The files are **referenced, not moved**: the message points at the same
 * `/uploads/...` URLs the project's `attachments` already hold, so the
 * «درخواست مشتری و استعلام اولیه» documents folder lists them exactly as before.
 *
 * The category is the company's own list entry, found by name. A company that
 * already made it by hand keeps that entry and every project already filed
 * under it, because a project's group is keyed by the category's id and a
 * second entry with the same name would split the feed in two.
 */
import { categoryKey } from "./productCategories";
import { normalizeAttachments, type ActivityAttachment } from "./attachments";

export const REQUEST_REVIEW_CATEGORY = "بررسی درخواست";

/** The id the settings patch gives the entry where a company had none. */
export const REQUEST_REVIEW_CATEGORY_ID = "act-request-review";

/** The first message when the form carried files and no words. */
export const REQUEST_REVIEW_FILES_ONLY = "فایل‌های پیوست درخواست مشتری";

export interface CategoryEntry { id: string; name: string }

/**
 * The company's «بررسی درخواست» entry, or null.
 *
 * Folded by `categoryKey`, so «بررسي درخواست» typed with the Arabic ي, or with
 * a half-space, is the same entry rather than a reason to make a second one.
 */
export function findRequestReviewCategory(
  categories: readonly CategoryEntry[] | undefined,
): CategoryEntry | null {
  const key = categoryKey(REQUEST_REVIEW_CATEGORY);
  return (categories ?? []).find((c) => c?.id && categoryKey(c.name) === key) ?? null;
}

/**
 * The first message: the request text and the form's files, or null.
 *
 * A file whose «url» is an inline data URI is left out: it is not a stored
 * file, and the activity's URL column would cut it short into a link that opens
 * nothing. A project with neither words nor files gets the category opened and
 * no message, since an empty first message says nothing.
 */
export function requestReviewEntry(
  description: string | null | undefined,
  attachments: unknown,
): { text: string; attachments: ActivityAttachment[] } | null {
  const files = normalizeAttachments(
    (Array.isArray(attachments) ? attachments : [])
      .filter((a) => {
        const url = String((a as { url?: unknown })?.url ?? "");
        return url !== "" && !url.startsWith("data:");
      }),
  );
  const words = String(description ?? "").trim();
  if (!words && files.length === 0) return null;
  return { text: words || REQUEST_REVIEW_FILES_ONLY, attachments: files };
}
