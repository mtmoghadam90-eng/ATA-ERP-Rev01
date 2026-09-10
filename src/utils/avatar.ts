/**
 * How a person is drawn beside their name.
 *
 * The ask was to tell at a glance who wrote each message in a project's feed —
 * and, in the same breath, that a screen already crowded with messages must not
 * get busier. Those pull in opposite directions unless the picture **replaces**
 * something: the author chip already carried a generic person glyph, identical
 * on every message and therefore worth nothing, so the avatar goes exactly
 * where that was. Same box, same row, one element; what changes is that the
 * pixels now say who.
 *
 * The fallback is the half that matters, because most accounts will have no
 * picture on the day this ships and some will never have one. Initials on a
 * colour derived from the name still separate two people at a glance, which a
 * repeated grey glyph never did — so an account with no photograph is not left
 * where it started.
 *
 * Pure and clock-free; covered by `test:rules`.
 */

import { nameKey } from "./assigneeName";

/**
 * The sizes, named once.
 *
 * `xs` is the feed's, and it is deliberately the smallest thing on the card —
 * the constraint was that the messages stay the thing being read. `sm` is the
 * sidebar's, beside the signed-in account's own name.
 */
export const AVATAR_SIZES = {
  /*
   * `initials` is part of the size and not a caller's choice, because how many
   * letters fit is a fact about the box. Two Persian letters inside 16px are
   * about seven pixels tall and read as a smudge, so the feed's disc carries
   * **one** — at that size the colour is doing most of the identifying anyway
   * and the letter only has to separate two people who share it.
   */
  /** A message in a project's feed — the smallest thing on the card. */
  xs: { px: 16, initials: 1 },
  /** A row in the users grid, and anywhere a list names people. */
  sm: { px: 32, initials: 2 },
  /** The sidebar's signed-in account. */
  md: { px: 40, initials: 2 },
  /** The users form's own preview of what was uploaded. */
  lg: { px: 64, initials: 2 },
} as const;
export type AvatarSize = keyof typeof AVATAR_SIZES;

/**
 * Up to two letters standing for a name.
 *
 * Two words give their first letters; one word gives its first letter alone
 * rather than its first two — «محمد» reads as a name abbreviated, «مح» reads as
 * a typo. Anything with no letters in it at all answers empty, and the caller
 * draws its neutral glyph.
 */
export function initialsOf(name: string | null | undefined, max = 2): string {
  const words = String(name ?? "")
    .replace(/‌/g, " ")     // a half-space joins words that are still two
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean);

  if (words.length === 0) return "";
  if (max <= 1 || words.length === 1) return words[0].slice(0, 1);
  return words[0].slice(0, 1) + words[words.length - 1].slice(0, 1);
}

/**
 * A hue for a name, the same one every time.
 *
 * Colour is what makes a 16px circle scannable — at that size two sets of
 * initials in the same grey are one grey smudge — so it has to be **stable**:
 * the same person must be the same colour on every message of every project,
 * or it is decoration that actively misleads. It is derived from `nameKey`,
 * the fold `resolveAssignee` already uses, so «رضایی» typed with a Persian ی
 * and with an Arabic ي are one person here exactly as they are there.
 *
 * The palette is the hue circle rather than a fixed list: a list of eight
 * repeats on the ninth colleague, which is precisely the collision this exists
 * to avoid.
 */
export function avatarHue(name: string | null | undefined): number {
  const key = nameKey(name ?? "");
  if (!key) return 215;                 // the app's own slate-blue, for nobody
  let hash = 0;
  for (const ch of key) {
    hash = (hash * 31 + ch.codePointAt(0)!) % 360360;
  }
  return hash % 360;
}

/**
 * The three colours of the fallback disc.
 *
 * Fixed lightness rather than a second hash: the ink is what has to stay
 * readable, and a randomly-lit ground is how one colleague in twenty ends up
 * with white-on-yellow.
 *
 * **The numbers were measured, not chosen.** 92% ground against 68%/32% ink was
 * the first attempt and it fails — 3.42:1 at hue 60, because yellow carries far
 * more luminance than the lightness figure suggests. At 24% the worst hue is
 * 5.50:1, which is margin rather than a value sitting on the line; `test:rules`
 * recomputes every hue with the same WCAG formula the palette layer uses, so it
 * cannot drift back.
 *
 * The `ring` exists because the ground is only a tint — 1.09:1 against a white
 * card at its worst hue, which is a disc that cannot be seen as a disc. It is
 * the ink at low alpha, so the edge is always the same colour family as the
 * letter inside it.
 */
export function avatarColors(
  name: string | null | undefined,
): { bg: string; fg: string; ring: string } {
  const hue = avatarHue(name);
  return {
    bg: `hsl(${hue} 62% 92%)`,
    fg: `hsl(${hue} 68% 24%)`,
    ring: `hsl(${hue} 68% 24% / 0.22)`,
  };
}
