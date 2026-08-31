/**
 * Reactions on an activity message.
 *
 * The feed is a messenger, so the cheapest possible answer — «دیدم», «موافقم»,
 * «ممنون» — should not cost a message of its own: a job's history is read from
 * top to bottom and a column of one-word replies buries the work in it.
 *
 * The set is deliberately **short and fixed**. A free-text emoji column is a
 * free-text column: whatever a client sends ends up rendered on everybody's
 * screen, and a hundred distinct reactions on one message is a chip row nobody
 * can read. Six covers what a work conversation actually needs — agreement,
 * completion, thanks, appreciation, amusement, and «this matters».
 *
 * Stored per person per emoji with a unique index on `(activityId, userId,
 * emoji)`, so pressing the same one twice is a removal and two people pressing
 * at once is the database's problem rather than a lost update.
 */

export interface ActivityReactionOption {
  emoji: string;
  /** What it means here, shown on hover and read by a screen reader. */
  label: string;
}

export const ACTIVITY_REACTIONS: readonly ActivityReactionOption[] = [
  { emoji: "👍", label: "موافقم" },
  { emoji: "✅", label: "انجام شد" },
  { emoji: "🙏", label: "ممنون" },
  { emoji: "❤️", label: "عالی بود" },
  { emoji: "😂", label: "خنده‌دار" },
  { emoji: "❗", label: "مهم است" },
];

/**
 * Whether a new reaction may be this one.
 *
 * Checked on the server: the emoji arrives from a browser and is rendered on
 * everybody else's. Deliberately only guards **creation** — a value stored
 * before the list changed still renders, because dropping it from the display
 * would make a reaction somebody left disappear without anybody removing it.
 */
export function isAllowedReaction(emoji: unknown): boolean {
  return ACTIVITY_REACTIONS.some((r) => r.emoji === emoji);
}

export interface ReactionRow {
  emoji: string;
  userId: string;
  userName?: string | null;
}

/** One chip: the emoji, how many pressed it, who, and whether you are among them. */
export interface ReactionSummary {
  emoji: string;
  count: number;
  /** In the order they arrived, so the chip's tooltip reads as a list. */
  names: string[];
  mine: boolean;
}

/**
 * The chips a message's reactions draw.
 *
 * Grouped by emoji in **first-seen order** rather than by count: a row that
 * reorders itself as colleagues react is a row whose buttons move under the
 * cursor, and the counts are right there to be read anyway.
 *
 * `nameOf` resolves the current display name for an id — the stored name is a
 * copy from the moment the reaction was left, and a renamed colleague should
 * read under the name they have now. It falls back to the stored one, which is
 * all there is for an account that has since been removed.
 */
export function summarizeReactions(
  rows: ReactionRow[],
  currentUserId: string | null | undefined,
  nameOf?: (userId: string) => string | undefined,
): ReactionSummary[] {
  const byEmoji = new Map<string, ReactionSummary>();

  for (const row of rows) {
    const emoji = String(row.emoji ?? "").trim();
    if (!emoji) continue;

    let chip = byEmoji.get(emoji);
    if (!chip) {
      chip = { emoji, count: 0, names: [], mine: false };
      byEmoji.set(emoji, chip);
    }
    chip.count += 1;
    chip.names.push(nameOf?.(row.userId) || row.userName || "همکار");
    if (currentUserId && row.userId === currentUserId) chip.mine = true;
  }

  return [...byEmoji.values()];
}
