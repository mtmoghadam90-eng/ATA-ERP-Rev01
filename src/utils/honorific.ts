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
 * The same person, addressed by a colleague rather than by the company.
 *
 * «جناب آقای مهندس» is the register of a document that leaves the building —
 * it is on every proforma and every customer message, and it is absurd in a
 * text message telling somebody that a colleague has just handed them a job.
 * «آقای رضایی» is what a person actually writes to a person here, so the two
 * registers are two named lists rather than one list used in two places, and
 * neither can be softened into the other by a call site.
 *
 * They share the one thing that must not be written twice — deciding which of
 * the two a stored gender means — through `genderOf`.
 */
export const STAFF_HONORIFICS = {
  MALE: "آقای",
  FEMALE: "خانم",
} as const;

/**
 * Which honorific a stored gender calls for, or null when there is none.
 *
 * The single fold, so a spelling accepted by the customer-facing wording and
 * refused by the staff wording is impossible. Null rather than a guess for the
 * two cases that are neither a man nor a woman: a company (which has no gender
 * and is addressed by its name) and a person whose gender was never filled in.
 */
export function genderOf(
  gender: string | null | undefined,
): "MALE" | "FEMALE" | null {
  const value = String(gender ?? "").trim();
  if (value === "مرد" || value === "آقا") return "MALE";
  if (value === "زن" || value === "خانم") return "FEMALE";
  return null;
}

/**
 * The honorific for a gender, or an empty string when there is nobody to
 * address by one.
 *
 * Blank rather than a guess: guessing here writes «جناب آقای مهندس» to a woman
 * on the strength of a blank field, which is worse than writing nothing.
 */
export function namePrefixFor(gender: string | null | undefined): string {
  const which = genderOf(gender);
  return which ? HONORIFICS[which] : "";
}

/** The staff register of the same rule — «آقای», «خانم», or nothing. */
export function staffPrefixFor(gender: string | null | undefined): string {
  const which = genderOf(gender);
  return which ? STAFF_HONORIFICS[which] : "";
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
 * The staff register of the same join — «آقای علی رضایی», or the bare name.
 *
 * The whole name and not a surname: a surname would have to be guessed out of
 * `fullName` by taking the last word, and «سید محمد حسین رضایی» is exactly the
 * shape that guess gets wrong. «آقای علی رضایی» is a little formal and is never
 * *wrong*, which is the right trade for a message sent automatically.
 *
 * An account whose gender nobody filled in comes out as its plain name, with
 * no leading space — which is most accounts on the day this ships, so it is
 * the ordinary case rather than an edge one.
 */
export function staffAddresseeOf(
  gender: string | null | undefined,
  name: string | null | undefined,
): string {
  return [staffPrefixFor(gender), String(name ?? "").trim()]
    .filter(Boolean)
    .join(" ");
}

/**
 * Words that come before a name and are never a name.
 *
 * `fullName` is one free-text box, and a good many accounts are typed into it
 * the way a colleague is addressed out loud — «مهندس حسینی» is one of the seeded
 * ones. Taking the first word of that greets somebody «سلام، مهندس عزیز» every
 * morning, which is not their name at all.
 *
 * **«سید» is deliberately not here.** It reads like a title and is part of a
 * person's given name — «سید محمد» is one name, and dropping it would print a
 * different person's name at them, which is the exact fault this list exists to
 * prevent. What is on the list is only what nobody is ever called on its own.
 */
export const NAME_TITLES: readonly string[] = [
  "جناب",
  "سرکار",
  "آقای",
  "خانم",
  "مهندس",
  "دکتر",
  "استاد",
];

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
 * **A title is not a first name.** `fullName` is typed by hand and «مهندس
 * حسینی» is how a colleague is written down here, so the leading titles are
 * dropped (`NAME_TITLES`) before the first word is taken — otherwise that
 * account is greeted «سلام، مهندس عزیز» daily. A name that is *nothing but*
 * titles keeps its first word rather than answering blank: whatever was typed
 * is the only name there is.
 *
 * An empty or unnamed account answers an empty string, and the caller decides
 * what to draw instead — greeting somebody by a blank is worse than not
 * greeting them.
 */
export function firstNameOf(name: string | null | undefined): string {
  const words = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  const named = words.filter((word) => !NAME_TITLES.includes(word));
  return named[0] ?? words[0] ?? "";
}
