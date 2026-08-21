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
