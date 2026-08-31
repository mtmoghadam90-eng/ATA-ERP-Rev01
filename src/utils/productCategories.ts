/**
 * The product taxonomy, and the two ways it comes apart.
 *
 * A product's category is a plain string copied onto the row — there is no
 * category table — so the dashboard's «نرخ تبدیل به تفکیک دسته محصول» groups by
 * exactly what is stored. Two spellings of one thing are two categories, and
 * every report built on them splits in half.
 *
 * That happened. The product form is a `<select>` fed by
 * `settings.dropdownItems.categories` and cannot invent a category; the **Excel
 * import took `row["دسته بندی"]` verbatim** and could. So a sheet saying «Flow»
 * created a category beside the «فلو» somebody had picked from the list, and
 * the chart grew two flow bars — one at 38% and one at 0%.
 *
 * The same shape as the five customer creation forms: a rule enforced on one
 * path and not the others is not enforced.
 */

/**
 * The form a category is compared in.
 *
 * Whitespace, letter case and the Persian/Arabic character pairs are spelling,
 * not meaning: «Flow», «flow » and «FLOW» are one category. SQL Server's
 * collation treats ی/ي and ک/ك as different characters, which is the same
 * reason `searchClause` expands them.
 *
 * It deliberately does **not** translate. «Flow» and «فلو» are the same
 * equipment in two languages and no string rule can know that — a person has to
 * say so, which is what the merge below is for.
 */
export function categoryKey(value: unknown): string {
  return String(value ?? "")
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/‌/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** The list entry this value means, or null when the list has no such thing. */
export function matchKnownCategory(value: unknown, known: readonly string[]): string | null {
  const key = categoryKey(value);
  if (!key) return null;
  return known.find((entry) => categoryKey(entry) === key) ?? null;
}

/**
 * The categories in a sheet that the list does not have, in the sheet's own
 * spelling and without repeats.
 *
 * Reported rather than refused. A bulk import that rejects rows over a category
 * is worse than one that creates them — the person is loading a hundred
 * products and would have to guess which cell — but creating them *silently* is
 * how the taxonomy split without anybody noticing for weeks. So the import goes
 * through and says what it added.
 */
export function unknownImportCategories(
  values: readonly unknown[],
  known: readonly string[],
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const raw = String(value ?? "").trim();
    if (!raw || matchKnownCategory(raw, known)) continue;
    const key = categoryKey(raw);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(raw);
  }
  return out;
}

/**
 * Whether two categories can be merged, and why not when they cannot.
 *
 * The target must be a category that exists: merging into a typo would move
 * every product onto a name the form cannot offer, which is the fault this
 * repairs rather than a repair of it. The source need only exist *on products*
 * — «Flow» is precisely the case where it is not in the list at all.
 */
export function mergeRefusalReason(
  from: string, to: string, known: readonly string[],
): string | null {
  if (!from.trim() || !to.trim()) return "دسته‌بندی مبدأ و مقصد باید مشخص باشند.";
  if (categoryKey(from) === categoryKey(to)) return "مبدأ و مقصد یکی هستند.";
  if (!matchKnownCategory(to, known)) {
    return "دسته‌بندی مقصد باید یکی از دسته‌بندی‌های تعریف‌شده باشد؛"
      + " وگرنه محصولات روی نامی می‌روند که فرم محصول نمی‌تواند پیشنهادش کند.";
  }
  return null;
}
