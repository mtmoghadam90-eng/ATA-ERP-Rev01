import type { CategoryContext } from "./nextActionReferral";

/**
 * The activity category a module was last opened from.
 *
 * The category link in a project's feed opens a module filtered to that job,
 * and the form somebody then fills in there is work *under* that category — so
 * when «ذخیره و ثبت اقدام بعدی» offers to refer it to a colleague, the
 * category should already be the one they came from.
 *
 * It is a hint for one dropdown's starting value and nothing else, which is why
 * it is a module-scoped value rather than a hand-off through `App.tsx` like the
 * project jump: the jump *filters a screen* and must be cleared the moment it
 * is applied, while this only pre-selects an option the person can see and
 * change. It is matched on the module **and** the project (`defaultReferralCategory`),
 * so it can never pre-select a category for some other job.
 */
let current: CategoryContext | null = null;

export function rememberCategoryContext(context: CategoryContext): void {
  current = { ...context };
}

export function categoryContext(): CategoryContext | null {
  return current;
}
