/**
 * How many things on the notices panel are unread — each piece of news once.
 *
 * A reply to a referral is announced twice: as an item on its referral's card
 * (read through a read receipt on the message id) and as a module notice
 * («پاسخ جدید به ارجاع») that names the same message through `itemId`. Adding
 * the two counts counted that reply twice, and reading it through either door
 * left the other standing — «خواندن همه (۱)» over an inbox with nothing unread.
 *
 * So a notice whose reply is drawn on the panel is counted through the reply
 * alone, and is never counted separately. `serverUnread` is the server's total
 * of unread notices (it spans every notice, not the page), which is why the
 * linked ones are subtracted rather than the visible ones counted.
 */
export function unreadNoticeCount(
  replyIds: string[],
  readItems: ReadonlySet<string>,
  notices: { isRead: boolean; itemId?: string | null }[],
  serverUnread: number,
): number {
  const visible = new Set(replyIds);
  const unreadReplies = [...visible].filter((id) => !readItems.has(id)).length;
  const linkedUnread = notices.filter((n) => !n.isRead && !!n.itemId && visible.has(n.itemId)).length;
  return unreadReplies + Math.max(0, serverUnread - linkedUnread);
}
