/** Explicit recipients, independent of @ referrals; never double-notify a colleague. */
export function activityNoticeRecipients(input: unknown, authorId: string, alreadyNotified: readonly string[] = []): string[] {
  if (!Array.isArray(input)) return [];
  const skip = new Set([authorId, ...alreadyNotified]);
  return [...new Set(input.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 36 && !skip.has(id)))].slice(0, 50);
}
