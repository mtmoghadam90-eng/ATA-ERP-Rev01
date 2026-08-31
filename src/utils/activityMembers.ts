/**
 * Who follows a category's conversation, and who a message notifies.
 *
 * The activity feed is a messenger, so it needed the thing every messenger has
 * and this one did not: **membership**. Until now the only way to reach a
 * colleague through it was to name them — which raises a referral, an explicit
 * request with an action and an inbox of its own. That is the right instrument
 * for «please check this datasheet» and completely wrong for «the shipment
 * cleared customs», which the three people working the job want to *know*
 * without being asked to do anything.
 *
 * So membership is the quieter half: a notice, no referral, no action required.
 * Naming somebody keeps working exactly as before.
 *
 * Membership is per project **and** per category. The people involved in «خرید»
 * on one job are not the ones involved in it on the next, which is why this is
 * not `settings.activityCategories[].responsibleUserId` — that answers «who owns
 * this kind of work in the company», a different question, and is untouched.
 */

/** Someone the member list may name. */
export interface DirectoryUser {
  id: string;
  fullName?: string | null;
}

/**
 * Reads the stored list.
 *
 * Defensive: the column is JSON written by this application, but a hand-edited
 * row or a half-written value must produce «nobody follows this» rather than an
 * exception on a screen whose job is to show a conversation.
 */
export function parseMemberIds(raw: unknown): string[] {
  if (Array.isArray(raw)) return dedupe(raw);
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? dedupe(parsed) : [];
  } catch {
    return [];
  }
}

function dedupe(values: unknown[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const id = typeof value === "string" ? value.trim() : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * The list as it should be stored.
 *
 * Only real, active accounts survive. An id that names nobody would produce a
 * notice addressed into a void on every message for ever, and there is no
 * screen on which that would ever become visible.
 *
 * An empty list stores `null`, not `"[]"`: «nobody has set members» and
 * «somebody set members and then removed them all» are the same state as far as
 * this feature is concerned, and one representation is one thing to reason
 * about.
 */
export function serializeMemberIds(ids: unknown, directory: DirectoryUser[]): string | null {
  const known = new Set(directory.map((u) => u.id));
  const kept = parseMemberIds(ids).filter((id) => known.has(id));
  return kept.length ? JSON.stringify(kept) : null;
}

export interface RecipientInput {
  /** The stored member list, as read from the row. */
  memberUserIds: unknown;
  /** Who wrote the message. */
  authorUserId: string | null | undefined;
  /** Who the message named — they are getting a referral instead. */
  mentionedUserIds: string[];
  /** Accounts that may be written to at all. */
  directory: DirectoryUser[];
}

/**
 * Who gets a «new message in this category» notice.
 *
 * Three exclusions, and each one is the difference between a feature people
 * keep switched on and one they learn to ignore.
 *
 * **Never the author.** Being told about your own message is noise; the same
 * exception `notifyUser` already makes.
 *
 * **Never somebody the message named.** They are getting a referral notice,
 * which says they have been asked to do something — strictly more than this
 * one. Sending both is the same event twice, and two notices for one message is
 * how a person learns to dismiss the pair without reading either.
 *
 * **Never an account that is gone or deactivated.** The list is filtered on
 * save, but an account can be deactivated afterwards, and a stored list is not
 * rewritten when that happens — so the check has to be here too, at the moment
 * of sending, and not only at the moment of writing.
 */
export function activityRecipients(input: RecipientInput): string[] {
  const reachable = new Set(input.directory.map((u) => u.id));
  const mentioned = new Set(input.mentionedUserIds);

  return parseMemberIds(input.memberUserIds).filter((id) => (
    reachable.has(id) && id !== input.authorUserId && !mentioned.has(id)
  ));
}

/** How much of a message a notice carries before it is cut. */
export const NOTICE_EXCERPT_LENGTH = 140;

/**
 * The message, short enough to read in a list.
 *
 * Cut on a whole character count rather than a word boundary: the text is
 * Persian, often with figures and part numbers in it, and a "clever" trim that
 * dropped the tail of a code would be worse than an obvious ellipsis.
 */
export function noticeExcerpt(text: string): string {
  const flat = String(text ?? "").replace(/\s+/g, " ").trim();
  return flat.length > NOTICE_EXCERPT_LENGTH
    ? `${flat.slice(0, NOTICE_EXCERPT_LENGTH)}…`
    : flat;
}
