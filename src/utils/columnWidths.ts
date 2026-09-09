/** Helpers for the user-adjustable project table widths. */

/** Keep a resized column wide enough for its handle and a useful sliver of content. */
export const MIN_COLUMN_PX = 64;

/** Set one column width without borrowing space from its neighbour. */
export function resizeColumns(
  widths: readonly number[],
  index: number,
  widthPx: number,
  min: number = MIN_COLUMN_PX,
): number[] {
  const next = [...widths];
  if (index < 0 || index >= next.length || !Number.isFinite(widthPx)) return next;
  next[index] = Math.max(min, Math.round(widthPx));
  return next;
}

/** Accept saved pixel widths from this version, otherwise use the defaults. */
export function normalizeColumnWidths(
  stored: unknown,
  defaults: readonly number[],
): number[] {
  if (!Array.isArray(stored) || stored.length !== defaults.length) return [...defaults];
  if (!stored.every((width) =>
    typeof width === "number" && Number.isFinite(width) && width >= MIN_COLUMN_PX)) {
    return [...defaults];
  }
  return [...stored];
}

/** Whether the person has moved anything, so reset is offered only when useful. */
export function columnsAreDefault(
  widths: readonly number[],
  defaults: readonly number[],
): boolean {
  return widths.length === defaults.length
    && widths.every((width, index) => Math.abs(width - defaults[index]) < 0.01);
}

/** The table overflows only while the sum of its chosen column widths needs it. */
export function tableMinWidthPx(widths: readonly number[]): number {
  return Math.ceil(widths.reduce(
    (total, width) => total + (Number.isFinite(width) && width > 0 ? width : 0), 0));
}
