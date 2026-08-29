/**
 * Naming a colleague in a message, which is what raises a referral.
 *
 * The activity form used to carry a «ارجاع» checkbox with a colleague picker
 * and a separate "what should they do" box — three controls saying what one
 * sentence already says. Writing «@علی رضایی لطفاً دیتاشیت را چک کن» is the
 * request, so that is what creates the referral, and the message *is* the
 * action required.
 *
 * Matched against the **known names**, not against a pattern.
 *
 * `@` followed by a word does not work here: Persian names are two or three
 * words with spaces in them, and «@علی رضایی» would name a colleague called
 * «علی». So the text is searched for `@` plus each real name, longest first —
 * which is also what settles «علی» against «علی رضایی» when both exist.
 *
 * Pure, and covered by `test:rules`.
 */

export interface MentionableUser {
  id: string;
  fullName: string;
}

/**
 * The two spellings of the Arabic letters, the zero-width marks and every kind
 * of space, flattened — **without changing the length**.
 *
 * Length-preserving on purpose: `mentionSpans` reports positions in the
 * original string so the feed can mark the names it finds, and a normalisation
 * that collapsed runs of spaces would report positions into a string nobody
 * has. The cost is that a name typed with two spaces in the middle does not
 * match; the composer inserts the canonical name, so that is the rare case.
 */
function normalize(text: string): string {
  return text
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[\s\u200c\u200e\u200f]/g, " ");
}

/**
 * The colleagues a message names, in the order they first appear.
 *
 * A name matched inside a longer one is not a second mention: «@علی رضایی»
 * names one person, not «علی» as well. Matching longest-first and blanking
 * what has been consumed is what enforces that.
 */
export interface MentionSpan {
  /** Index of the `@` in the **original** text. */
  start: number;
  /** One past the last character of the name. */
  end: number;
  user: MentionableUser;
}

/**
 * Where each name appears, so the feed can mark them and the server can act on
 * them from one rule.
 *
 * Every occurrence of a name is found, not only the first: «@علی صبح و @علی
 * بعدازظهر» is one person mentioned twice, and marking only the first would
 * leave the second reading as punctuation.
 */
export function mentionSpans(
  text: string,
  users: MentionableUser[],
): MentionSpan[] {
  const haystack = normalize(text ?? "");
  if (!haystack.includes("@")) return [];

  const candidates = [...users]
    .filter((u) => u.fullName && u.fullName.trim())
    .sort((a, b) => b.fullName.length - a.fullName.length);

  const spans: MentionSpan[] = [];
  // Consumed characters are blanked rather than removed, so every later index
  // still refers to the same place in the original string — and so a shorter
  // name inside a longer one is not found a second time.
  let remaining = haystack;

  for (const user of candidates) {
    const needle = `@${normalize(user.fullName).trim()}`;
    if (needle.length <= 1) continue;
    let from = 0;
    for (;;) {
      const at = remaining.indexOf(needle, from);
      if (at === -1) break;
      spans.push({ start: at, end: at + needle.length, user });
      remaining = remaining.slice(0, at) + "\u0000".repeat(needle.length)
        + remaining.slice(at + needle.length);
      from = at + needle.length;
    }
  }

  return spans.sort((a, b) => a.start - b.start);
}

/** The colleagues a message names, once each, in the order they first appear. */
export function parseMentions(
  text: string,
  users: MentionableUser[],
): MentionableUser[] {
  const seen = new Set<string>();
  const out: MentionableUser[] = [];
  for (const span of mentionSpans(text, users)) {
    if (seen.has(span.user.id)) continue;
    seen.add(span.user.id);
    out.push(span.user);
  }
  return out;
}

/**
 * The text with the `@` markers taken off, for anything that reads the message
 * as prose — a notification, a task's description, the printed history.
 */
export function stripMentionMarkers(text: string, users: MentionableUser[]): string {
  let out = text ?? "";
  for (const user of [...users].sort((a, b) => b.fullName.length - a.fullName.length)) {
    out = out.split(`@${user.fullName}`).join(user.fullName);
  }
  return out;
}

/**
 * What the composer should insert when a name is picked from the list.
 *
 * The trailing space matters: without it the next word runs into the name and
 * the mention stops matching the moment somebody keeps typing.
 */
export function insertMention(
  text: string,
  caret: number,
  user: MentionableUser,
): { text: string; caret: number } {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf("@");
  // No `@` to complete: append rather than corrupting what is there.
  if (at === -1) {
    const joined = `${text.slice(0, caret)}@${user.fullName} ${text.slice(caret)}`;
    return { text: joined, caret: caret + user.fullName.length + 2 };
  }
  const replacement = `@${user.fullName} `;
  const joined = text.slice(0, at) + replacement + text.slice(caret);
  return { text: joined, caret: at + replacement.length };
}

/**
 * The partial name being typed after an `@`, or null when the caret is not in
 * one — which is what decides whether the suggestion list is open.
 *
 * A newline or a second `@` closes it: the term never runs across a line, so a
 * message that merely contains an `@` somewhere above does not leave the list
 * open for the rest of the paragraph.
 */
export function mentionQuery(text: string, caret: number): string | null {
  const before = (text ?? "").slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at === -1) return null;
  const term = before.slice(at + 1);
  if (term.includes("\n") || term.includes("@")) return null;
  // A name is at most a few words; past that the `@` was punctuation.
  if (term.split(" ").length > 4) return null;
  return term;
}

/** The colleagues whose name matches what is being typed after the `@`. */
export function mentionSuggestions(
  query: string,
  users: MentionableUser[],
  limit = 6,
): MentionableUser[] {
  const term = normalize(query).trim();
  const pool = users.filter((u) => u.fullName?.trim());
  if (!term) return pool.slice(0, limit);
  return pool
    .filter((u) => normalize(u.fullName).includes(term))
    .slice(0, limit);
}

/**
 * A one-line title for a task raised from a message.
 *
 * The first line, because that is what somebody writes the instruction on;
 * trimmed to what a task title column holds, with the tail marked rather than
 * cut off mid-word without a sign.
 */
export function taskTitleFromMessage(text: string, max = 120): string {
  const firstLine = (text ?? "").split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  if (firstLine.length <= max) return firstLine;
  return `${firstLine.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Whether the caret sits just after a name that is already complete.
 *
 * This is what closes the suggestion list once somebody has picked a name.
 * Without it the list stays open over the finished mention — the term is still
 * a name, so it still matches — and Enter would pick the same person again
 * instead of starting a new line.
 *
 * Asked of `mentionSpans` rather than of a second string comparison, so
 * «@علی » closes even when «علی رضایی» also exists: the matcher takes the
 * longest name that is actually there, and this agrees with it by construction.
 * The `caret - 1` case is the trailing space `insertMention` writes.
 */
export function mentionIsComplete(
  text: string,
  caret: number,
  users: MentionableUser[],
): boolean {
  return mentionSpans(text, users).some((s) => s.end === caret || s.end === caret - 1);
}
