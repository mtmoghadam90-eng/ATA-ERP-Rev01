import type { ProductFeature } from "../types";
import { stripRichMarks } from "./richText";

/**
 * Turning a set of ticked feature options into the two things a line needs: the
 * attributes that identify one SKU, and the specification text a human reads.
 *
 * Pure, and covered by `test:rules`. It was written out inline inside the
 * proforma form's configurator, which is where the supplier-inquiry form now
 * needs the same thing — and «مشخصات» lines that agree between a quotation and
 * the inquiry that priced it are not optional.
 */

export type ConfigSelections = Record<string, string[]>;

/**
 * The attributes identifying exactly one SKU, or null when the selection does
 * not identify one.
 *
 * Every feature must have exactly one value ticked. Two values on a feature is
 * a legitimate thing to ask a supplier — «either 316 or 304 stainless» — but it
 * describes two products, and a SKU is one; so it produces specification text
 * and no SKU rather than a wrong SKU.
 */
export function attributesFromSelections(
  features: ProductFeature[] | undefined,
  selections: ConfigSelections,
): Record<string, string> | null {
  const list = features ?? [];
  if (list.length === 0) return null;
  if (!list.every((f) => (selections[f.id] || []).length === 1)) return null;

  const attributes: Record<string, string> = {};
  for (const feature of list) attributes[feature.name] = selections[feature.id][0];
  return attributes;
}

/** «نام ویژگی: مقدار» for each feature that has anything ticked. */
export function specLinesFrom(
  features: ProductFeature[] | undefined,
  selections: ConfigSelections,
): string[] {
  const lines: string[] = [];
  for (const feature of features ?? []) {
    const chosen = selections[feature.id] || [];
    if (chosen.length > 0) lines.push(`${feature.name}: ${chosen.join("، ")}`);
  }
  return lines;
}

/**
 * Puts the new specification lines into existing free text, replacing whatever
 * the configurator wrote there last time.
 *
 * Keyed on the feature names rather than on a marker, because the text is
 * editable: somebody may have typed a note in the middle of it. Anything that
 * is not a line for one of *this product's* features is kept exactly where it
 * was, and a stale «مشخصات:» header from the older format is dropped.
 */
export function mergeSpecText(
  existing: string | undefined,
  features: ProductFeature[] | undefined,
  lines: string[],
): string {
  const names = (features ?? []).map((f) => f.name);
  const kept = String(existing ?? "")
    .split("\n")
    .filter((line) => {
      // Compared without the formatting markers: somebody may have bolded a
      // feature name, and «**جنس بدنه**: …» would then not be recognised as the
      // configurator's own line — so reconfiguring would leave the old one
      // behind and append a second.
      const trimmed = stripRichMarks(line).trim();
      if (trimmed.startsWith("مشخصات:")) return false;
      return !names.some((name) => trimmed.startsWith(`${name}: `));
    });
  return [...kept, ...lines].filter(Boolean).join("\n");
}

/**
 * Reads the selections back out of specification text, so reopening the
 * configurator on a line shows what was chosen last time.
 */
export function selectionsFromSpecText(
  features: ProductFeature[] | undefined,
  text: string | undefined,
): ConfigSelections {
  const selections: ConfigSelections = {};
  // Read past any formatting the user applied, for the same reason the merge
  // above does: the value is «استیل 316», not «**استیل 316**».
  const lines = String(text ?? "").split("\n").map((l) => stripRichMarks(l));
  for (const feature of features ?? []) {
    const prefix = `${feature.name}: `;
    const line = lines.find((l) => l.trim().startsWith(prefix));
    if (line) {
      selections[feature.id] = line.trim().slice(prefix.length)
        .split("،").map((s) => s.trim()).filter(Boolean);
    }
  }
  return selections;
}

/** The selections a stored SKU's attributes stand for. */
export function selectionsFromAttributes(
  features: ProductFeature[] | undefined,
  attributes: Record<string, string> | undefined,
): ConfigSelections {
  const selections: ConfigSelections = {};
  for (const feature of features ?? []) {
    const value = attributes?.[feature.name];
    if (value) selections[feature.id] = [value];
  }
  return selections;
}
