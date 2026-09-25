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
