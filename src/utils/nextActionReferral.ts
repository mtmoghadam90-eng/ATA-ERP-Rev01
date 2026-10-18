/**
 * «ارجاع به همکار» beside «اقدام بعدی» — the second half of the form that opens
 * after «ذخیره و ثبت اقدام بعدی».
 *
 * The next action is work for *yourself*; this is work for a colleague, about
 * the same record and under the activity category of the project it belongs to.
 * A referral here is **not a new kind of thing and has no new write path**: it
 * is posted as an ordinary message in that category's feed naming the
 * colleagues with `@`, exactly as somebody would type it into the feed, so the
 * referral, its thread, its deadline, the board card and the notice are all
 * raised by `addActivity` — the one writer they already have. A second way to
 * create a referral would be a second copy of every one of those rules.
 *
 * Pure and clock-free, so `test:rules` can hold it.
 */

import { moduleForCategory } from "./projectLinks";

/** One category the referral can be filed under. */
export interface ReferralCategoryChoice {
  /** `settings.activityCategories[].id` — the group's natural key on a project. */
  categoryId: string;
  categoryName: string;
  /**
   * The project's existing group for it, or null when the category has not
   * been opened on this project yet — which is answered by opening it on
   * submit, rather than by refusing a category the person can see in the list.
   */
  groupId: string | null;
}

/** How the referral's deadline is answered — the feed composer's three states. */
export type ReferralDueMode = "none" | "date" | "assignee";

export interface NextActionReferralDraft {
  userIds: string[];
  categoryId: string;
  text: string;
  dueMode: ReferralDueMode;
  dueDate: string;
}

export const EMPTY_REFERRAL_DRAFT: NextActionReferralDraft = {
  userIds: [],
  categoryId: "",
  text: "",
  dueMode: "none",
  dueDate: "",
};

/**
 * The categories on offer: the project's own groups first, then every category
 * the company has defined and this project has not opened yet.
 *
 * The groups lead because that is where the job's conversation already is; a
 * category is matched to its group by **id**, the pair `upsertCategoryGroup`
 * itself keys on, never by name — the group's name is a denormalised copy that
 * a rename rewrites, and matching on it would offer one category twice.
 */
export function referralCategoryChoices(
  groups: readonly { id: string; categoryId: string; categoryName: string }[],
  categories: readonly { id: string; name: string }[],
): ReferralCategoryChoice[] {
  const out: ReferralCategoryChoice[] = groups.map((g) => ({
    categoryId: g.categoryId,
    categoryName: g.categoryName,
    groupId: g.id,
  }));
  const opened = new Set(groups.map((g) => g.categoryId));
  for (const c of categories) {
    if (!c?.id || opened.has(c.id)) continue;
    opened.add(c.id);
    out.push({ categoryId: c.id, categoryName: c.name, groupId: null });
  }
  return out;
}

/** The category the form was opened from — see `categoryContext.ts`. */
export interface CategoryContext {
  module: string;
  projectId: string;
  categoryId: string;
}

/**
 * Which category the dropdown starts on.
 *
 * Three answers, in order of how sure they are:
 *
 * 1. the category the form was **opened from** — its link in the project's
 *    activity feed — when it is the same project and the same module, because
 *    that is literally where the person was standing;
 * 2. else the project's own category whose words name this module
 *    (`moduleForCategory`, the rule that draws those links), an opened group
 *    before an unopened category, since that is where the job already talks;
 * 3. else nothing, and the person picks — a guess at a category is a message
 *    filed where nobody working that strand will read it.
 */
export function defaultReferralCategory(
  choices: readonly ReferralCategoryChoice[],
  module: string | undefined,
  projectId: string | undefined,
  context: CategoryContext | null,
): string {
  if (context && module && projectId
      && context.module === module && context.projectId === projectId
      && choices.some((c) => c.categoryId === context.categoryId)) {
    return context.categoryId;
  }
  if (!module) return "";
  const matching = choices.filter((c) => moduleForCategory(c.categoryName) === module);
  const opened = matching.find((c) => c.groupId);
  return (opened ?? matching[0])?.categoryId ?? "";
}

/**
 * The message posted into the feed.
 *
 * The colleagues are named with `@` **at the start** and the request follows,
 * which is the shape `parseMentions` reads and the shape a person types; the
 * last line says which record it is about, because a message in the feed is
 * read alongside every other strand of the job and «این را بررسی کن» on its own
 * names nothing.
 */
export function referralMessageText(
  names: readonly string[],
  text: string,
  about: { relatedToType: string; relatedToName: string },
): string {
  const mentions = names.map((n) => `@${n}`).join(" ");
  const body = text.trim();
  const name = String(about.relatedToName ?? "").trim();
  const ref = name ? `\n(درباره‌ی ${about.relatedToType}: ${name})` : "";
  return `${mentions} ${body}${ref}`;
}

/** Why the referral cannot be sent, or null. */
export function referralDraftRefusal(draft: NextActionReferralDraft): string | null {
  if (draft.userIds.length === 0) return "همکاری را برای ارجاع انتخاب کنید.";
  if (!draft.categoryId) return "دسته‌بندی فعالیت ارجاع را انتخاب کنید.";
  if (!draft.text.trim()) return "متن ارجاع را بنویسید.";
  if (draft.dueMode === "date" && !draft.dueDate.trim()) return "مهلت ارجاع را وارد کنید.";
  return null;
}

/**
 * The deadline keys for `POST /api/activities`, in the composer's own shape.
 *
 * «بدون مهلت» sends **nothing**, not an empty date: the route spreads the keys
 * only when present, and an absent key is what an ordinary undated request has
 * always been.
 */
export function referralDueFields(
  draft: NextActionReferralDraft,
): { dueDate?: string; dueDateByAssignee?: boolean } {
  if (draft.dueMode === "date") return { dueDate: draft.dueDate, dueDateByAssignee: false };
  if (draft.dueMode === "assignee") return { dueDate: "", dueDateByAssignee: true };
  return {};
}
