/**
 * Column widths a person sets for themselves, and the arithmetic that keeps a
 * grid a whole table while they drag.
 *
 * The projects grid is `table-fixed` with a `colgroup`, so its widths are a
 * list of percentages that must sum to 100 — anything else leaves the browser
 * distributing the remainder on its own, which is the very negotiation
 * `table-fixed` exists to end. A person dragging a divider is therefore not
 * *setting* a width: they are **moving a boundary**, and every rule here
 * follows from that.
 *
 * Pure and free of the DOM, so `test:rules` can hold it.
 */

/**
 * How narrow one column may be dragged.
 *
 * Not a nicety: the handle lives on the column's own edge, so a column dragged
 * to nothing is a column whose handle cannot be grabbed again — the person
 * would have to reset the whole row to undo one slip. Wide enough to stay
 * catchable at any table width.
 */
export const MIN_COLUMN_PERCENT = 4;

/** The list is a whole table, allowing for the rounding of a percentage. */
const TOTAL = 100;
const TOLERANCE = 0.5;

/**
 * The boundary between column `index` and the one after it, moved by `delta`.
 *
 * **The pair moves, never one column.** Widening one and leaving the rest is
 * what a naïve implementation does, and it makes the total drift away from 100
 * on every drag — after a dozen the table is no longer `table-fixed` in any
 * meaningful sense. Taking exactly what is given from the neighbour keeps the
 * sum an invariant of the operation rather than something to check afterwards.
 *
 * The delta is **clamped by both columns**, so a drag past either minimum stops
 * at it rather than being refused: a person pulling a divider expects it to
 * stop against something, not to snap back.
 */
export function resizeColumns(
  widths: readonly number[],
  index: number,
  deltaPercent: number,
  min: number = MIN_COLUMN_PERCENT,
): number[] {
  const next = [...widths];
  if (index < 0 || index >= next.length - 1) return next;

  const a = next[index];
  const b = next[index + 1];
  if (!Number.isFinite(a) || !Number.isFinite(b)) return next;

  // What the pair can give in each direction, whichever runs out first.
  const room = Math.max(0, Math.min(b - min, deltaPercent));
  const take = Math.min(0, Math.max(min - a, deltaPercent));
  const move = deltaPercent >= 0 ? room : take;

  next[index] = a + move;
  next[index + 1] = b - move;
  return next;
}

/**
 * A stored list, or the defaults.
 *
 * `readViewPreferences` merges only keys whose `typeof` matches the default —
 * and `typeof []` is `"object"`, so an array is exactly the shape that check
 * cannot vet. This is where it is vetted: a list from a build with a different
 * number of columns, one carrying a string, or one whose total has drifted is
 * **discarded whole** rather than repaired. A grid drawn from a half-understood
 * list is worse than one drawn from the defaults, and the person can drag it
 * back in a second.
 */
export function normalizeColumnWidths(
  stored: unknown,
  defaults: readonly number[],
): number[] {
  if (!Array.isArray(stored) || stored.length !== defaults.length) return [...defaults];
  if (!stored.every((w) => typeof w === "number" && Number.isFinite(w) && w >= 1)) {
    return [...defaults];
  }
  const total = (stored as number[]).reduce((a, b) => a + b, 0);
  if (Math.abs(total - TOTAL) > TOLERANCE) return [...defaults];
  return [...(stored as number[])];
}

/** Whether the person has moved anything, so the reset is offered only when it does something. */
export function columnsAreDefault(
  widths: readonly number[],
  defaults: readonly number[],
): boolean {
  return widths.length === defaults.length
    && widths.every((w, i) => Math.abs(w - defaults[i]) < 0.01);
}
