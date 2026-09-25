/**
 * Who may correct or remove an entry on a project's activity feed.
 *
 * Two kinds of entry, two answers, and neither is «the author or an admin».
 *
 * - **What a person typed** belongs to them: only its author edits or deletes
 *   it. A system administrator rewriting somebody's words under their name is
 *   exactly what a feed that people sign must not allow.
 * - **What the application wrote** (`isSystem`) — «پیش‌فاکتور … صادر شد»,
 *   «وجه … حواله شد» — is a record of the business, not anybody's message. Its
 *   `authorUserId` is only whoever pressed the button that caused it, and
 *   letting that person reword the record of their own action would make the
 *   history say whatever its subject preferred. Only a system administrator
 *   corrects one.
 *
 * Pure, so the server (which enforces it) and the feed (which draws the two
 * buttons only where they will be accepted) read the same rule.
 */
export function canModifyActivity(
  activity: { isSystem?: boolean | null; authorUserId?: string | null },
  user: { id?: string | null; isSystemAdmin?: boolean | null } | null | undefined,
): boolean {
  if (!user?.id) return false;
  if (activity.isSystem) return user.isSystemAdmin === true;
  return !!activity.authorUserId && activity.authorUserId === user.id;
}
