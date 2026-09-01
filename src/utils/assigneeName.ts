/**
 * Matching a colleague's name to their account.
 *
 * Every automation here is handed a **name** — `project.salesExpert`, a
 * workflow rule's assignee box, a milestone's — and has to find the account
 * behind it, because a task belongs to a person by id: `assignedToUserId` is
 * what «به من ارجاع شده» filters on and half of what `visibilityClause` lets a
 * person see at all.
 *
 * The lookup was an exact string comparison, and that is not the same question.
 * SQL Server's collation treats ی/ي, ک/ك and the two digit sets as different
 * characters — the whole reason `searchClause` exists — and a name typed into a
 * project and a name typed into an account are two different typings. One
 * Arabic ی, one half-space, one doubled space between them and the match
 * failed: the task was created with the name on it and **no id**, so it read as
 * assigned on the card and belonged to nobody. It vanished from its own
 * assignee's «به من ارجاع شده», and from anybody without «همه وظایف» entirely.
 *
 * These are the pure rules; the query that uses them is `resolveAssignee`.
 */

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";

/**
 * A name reduced to what is actually being compared.
 *
 * Folds away everything that is only spelling: the two Persian letter pairs,
 * both digit sets, the zero-width joiner and non-breaking space (a name written
 * with a half-space is the same name), and runs of whitespace. It does **not**
 * change case — Persian has none, and lowering a Latin username would be a
 * different decision made silently.
 */
export function nameKey(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/[۰-۹]/g, (d) => String(FA_DIGITS.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)))
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    // The half-space and the non-breaking space are spelling, not content.
    .replace(/[‌‏‎ ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface DirectoryEntry {
  id: string;
  fullName?: string | null;
  username?: string | null;
}

/**
 * The account a name refers to, or null.
 *
 * Compared on `nameKey`, so «محمد توکل مقدم» matches however either side spelled
 * it. An exact match on the full name wins over the username, and over another
 * account whose name merely reduces to the same key — the first exact hit is
 * taken so the answer does not depend on the order the directory came back in.
 */
export function matchAssignee<T extends DirectoryEntry>(
  name: string | null | undefined,
  directory: T[],
): T | null {
  const key = nameKey(name);
  if (!key) return null;

  return directory.find((u) => nameKey(u.fullName) === key)
    ?? directory.find((u) => nameKey(u.username) === key)
    ?? null;
}
