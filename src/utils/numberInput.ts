/**
 * Reading a number out of a box somebody is still typing in.
 *
 * `<input type="number">` looks like the obvious control and quietly is not:
 * the HTML value-sanitisation rules say a value that is not a *complete*
 * floating-point number is reported as the empty string, so the moment a user
 * types the decimal point in «0.7» the browser hands the code `""`, `Number("")`
 * is 0, the controlled value re-renders as "0" and the point is wiped out of
 * the box. The field cannot be typed into at all — the only way to reach 0.7 is
 * the spinner arrows — and where the figure is a discount percentage rather
 * than a temperature the same keystrokes turn «2.5%» into «25%» without
 * anything looking wrong.
 *
 * So a decimal field is a text field, and these are the rules for reading one.
 * Pure, and covered by `test:rules`.
 */

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";

/**
 * Persian and Arabic digits and separators, in Latin.
 *
 * `٫` (U+066B) is the Persian decimal separator and `٬` (U+066C) the thousands
 * one — the same pair `toNumber` handles on the server, and for the same
 * reason: a figure typed on a Persian keyboard is not a different figure.
 */
export function toLatinDigits(text: string): string {
  return String(text ?? "")
    .replace(/[۰-۹]/g, (d) => String(FA_DIGITS.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)))
    .replace(/٫/g, ".")
    .replace(/[٬،]/g, "");
}

/**
 * The number in this text, or null when there is not one *yet*.
 *
 * Null is the important half. It means "keep what the user is typing and write
 * nothing", which is what lets «0.», «-» and «» exist on the way to a figure
 * instead of each being read as a decision.
 */
export function parseDecimalInput(text: string): number | null {
  const clean = toLatinDigits(text).trim().replace(/,/g, "");
  if (clean === "") return null;
  // A complete number and nothing else: `Number` accepts "0x10", " 12 " and
  // "Infinity", none of which anybody typed on purpose.
  if (!/^-?\d*\.?\d+$/.test(clean)) return null;
  const value = Number(clean);
  return Number.isFinite(value) ? value : null;
}

/**
 * Whether this text is a plausible start rather than nonsense.
 *
 * Used to decide what to do when the box loses focus: half a number is put back
 * to the last good value, while «abc» is too.
 */
export function isPartialNumber(text: string): boolean {
  const clean = toLatinDigits(text).trim().replace(/,/g, "");
  return clean === "" || /^-?\d*\.?\d*$/.test(clean);
}

/** Keeps a figure inside the bounds the field declares. */
export function clampNumber(value: number, min?: number, max?: number): number {
  let out = value;
  if (typeof min === "number" && out < min) out = min;
  if (typeof max === "number" && out > max) out = max;
  return out;
}
