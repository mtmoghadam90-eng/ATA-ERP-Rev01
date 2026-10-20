/**
 * Who may correct or remove an entry on a project's activity feed.
 *
 * Two kinds of entry, two answers, and neither is «the author or an admin».
 *
 * - **What a person typed** belongs to them: its author edits or deletes it,
 *   and no other colleague may.
 * - **What the application wrote** (`isSystem`) — «پیش‌فاکتور … صادر شد»,
 *   «وجه … حواله شد» — is a record of the business, not anybody's message. Its
 *   `authorUserId` is only whoever pressed the button that caused it, and
 *   letting that person reword the record of their own action would make the
 *   history say whatever its subject preferred. Only a system administrator
 *   corrects one.
 *
 * A **system administrator** may correct or remove either kind, including a
 * note somebody else wrote — asked for explicitly, since they are the one who
 * tidies up a feed after a mistake.
 *
 * Pure, so the server (which enforces it) and the feed (which draws the two
 * buttons only where they will be accepted) read the same rule.
 */
export function canModifyActivity(
  activity: { isSystem?: boolean | null; authorUserId?: string | null },
  user: { id?: string | null; isSystemAdmin?: boolean | null } | null | undefined,
): boolean {
  if (!user?.id) return false;
  // A system administrator corrects anything on the feed, typed or written by
  // the application — they are who cleans up after a mistake.
  if (user.isSystemAdmin === true) return true;
  if (activity.isSystem) return false;
  return !!activity.authorUserId && activity.authorUserId === user.id;
}

/**
 * The id prefix of a category group the application opened by itself, when it
 * recorded a fact on a project that had no group of that category yet.
 */
export const SYSTEM_GROUP_PREFIX = "cat-fact-";

/**
 * Who may delete a project's activity category — the same rule as an entry.
 *
 * A category somebody opened is theirs to delete; one the application opened
 * (`SYSTEM_GROUP_PREFIX`) is nobody's but a system administrator's; and a
 * system administrator may delete any. A group with **no recorded creator** —
 * every one written before the column existed — is treated as nobody's, since
 * guessing an owner would hand the delete of a whole conversation to whoever
 * happened to be guessed. Deleting a category deletes every message in it,
 * which is the whole reason this is asked at all.
 */
export function canDeleteCategoryGroup(
  group: { categoryId?: string | null; createdByUserId?: string | null },
  user: { id?: string | null; isSystemAdmin?: boolean | null } | null | undefined,
): boolean {
  if (!user?.id) return false;
  if (user.isSystemAdmin === true) return true;
  if (String(group.categoryId ?? "").startsWith(SYSTEM_GROUP_PREFIX)) return false;
  return !!group.createdByUserId && group.createdByUserId === user.id;
}

/**
 * Which side of the conversation an entry is drawn on.
 *
 * The feed reads like a messenger: what **you** wrote sits on the right (the
 * sender's side on a Persian screen), what a colleague wrote on the left, and
 * what the application wrote in the middle — it is nobody's message, so giving
 * it a side would say somebody said it. Decided by **account id**, never by the
 * display name, for the reason `ReferralThread` sides its messages by id: a
 * renamed account would otherwise put its whole history on the other side.
 * Without a signed-in id nothing is «mine» — the safe direction, since claiming
 * somebody else's words as the reader's own is the wrong way to be mistaken.
 */
export type ActivitySide = "mine" | "theirs" | "system";

export function activitySide(
  activity: { isSystem?: boolean | null; authorUserId?: string | null },
  userId: string | null | undefined,
): ActivitySide {
  if (activity.isSystem) return "system";
  return !!userId && activity.authorUserId === userId ? "mine" : "theirs";
}
