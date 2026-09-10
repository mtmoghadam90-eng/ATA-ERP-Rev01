/**
 * How a person is addressed before their name.
 *
 * The company writes «جناب آقای مهندس» to a man and «سرکار خانم مهندس» to a
 * woman, and has done since long before any of this was software — it is on
 * every proforma. The rule lived spelled out at four call sites inside
 * `ProformasView`, which is how the wording comes to differ between the
 * proforma header and a text message about that same proforma.
 *
 * Pure, and covered by `test:rules`.
 */

/** The honorifics themselves, so the wording is written down exactly once. */
export const HONORIFICS = {
  MALE: "جناب آقای مهندس",
  FEMALE: "سرکار خانم مهندس",
} as const;

/**
 * The honorific for a gender, or an empty string when there is nobody to
 * address by one.
 *
 * Blank rather than a guess for the two cases that are not a man or a woman: a
 * company (which has no gender and is addressed by its name) and a person whose
 * gender was never filled in. Guessing here writes «جناب آقای مهندس» to a woman
 * on the strength of a blank field, which is worse than writing nothing.
 */
export function namePrefixFor(gender: string | null | undefined): string {
  const value = String(gender ?? "").trim();
  if (value === "مرد" || value === "آقا") return HONORIFICS.MALE;
  if (value === "زن" || value === "خانم") return HONORIFICS.FEMALE;
  return "";
}

/**
 * The name with its honorific, spaced correctly.
 *
 * The reason this exists rather than leaving the two to be joined in a
 * template: a company and a person of unrecorded gender both have no
 * honorific, and «{namePrefix} {customerName} عزیز» then goes out with a
 * double space in it. That is most of the customer base, not an edge case.
 */
export function addresseeOf(
  gender: string | null | undefined,
  name: string | null | undefined,
): string {
  return [namePrefixFor(gender), String(name ?? "").trim()]
    .filter(Boolean)
    .join(" ");
}

/**
 * The name a colleague is greeted by on their own dashboard.
 *
 * «سلام، جناب آقای مهندس محمد مقدم عزیز» is how the company writes to a
 * *customer*, and it is the wrong register for the card somebody sees when
 * they sign in to their own workspace — that is «سلام، محمد عزیز». So this is
 * deliberately not `addresseeOf` with the honorific switched off: the two
 * answer different questions, and the greeting keeps only the first name while
 * every outgoing document keeps the whole formal form.
 *
 * **The zero-width joiner is not a space.** «علی‌رضا» is one name written with
 * a ZWNJ inside it, and splitting on it answers «علی» — a different person's
 * name, printed at somebody every morning. `initialsOf` folds the ZWNJ to a
 * space on purpose (two initials out of one compound name is right), which is
 * exactly why this cannot reuse that rule.
 *
 * An empty or unnamed account answers an empty string, and the caller decides
 * what to draw instead — greeting somebody by a blank is worse than not
 * greeting them.
 */
export function firstNameOf(name: string | null | undefined): string {
  const words = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  return words[0] ?? "";
}
