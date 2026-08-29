import { REQUIRED_FIELDS_METADATA } from "./requiredFields";

/**
 * Serious gaps in a project's own record.
 *
 * Not the same question as `settings.requiredFields`, and deliberately a
 * separate list. A required field is enforced when the form is submitted, so
 * turning one on says nothing about the hundreds of projects already on the
 * system and — worse — makes them unsavable the next time somebody opens one
 * to correct a typo. This is the other half: which blanks are worth a warning
 * on a record that already exists, so the gap can be reported without anybody
 * being locked out of the form.
 *
 * The catalogue of fields is `REQUIRED_FIELDS_METADATA.projects`, because there
 * is no reason for a second spelled-out list of a project's fields and every
 * reason for the two screens to offer the same names.
 *
 * Pure, and covered by `test:rules`.
 */

export interface DataGapField {
  key: string;
  label: string;
}

/** Every project field a gap can be declared on, in the order settings shows. */
export function projectGapCatalogue(): DataGapField[] {
  return REQUIRED_FIELDS_METADATA.find((m) => m.key === "projects")?.fields ?? [];
}

/**
 * What a fresh installation warns about.
 *
 * The four the sales desk cannot work without: who is selling it, who to talk
 * to, when a decision is expected and where the enquiry came from. Everything
 * else is a choice somebody makes in Settings.
 */
export const DEFAULT_PROJECT_GAP_FIELDS: readonly string[] = [
  "salesExpert", "customerId", "expectedCloseDate", "marketingChannel",
];

/** A value that counts as "not filled in". */
function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/**
 * The gaps in one project, as labels, in the order the catalogue lists them.
 *
 * Reads the record by the metadata's own key, so a field added to the
 * catalogue is warnable without touching this. A key naming nothing on the
 * record is skipped rather than reported as an eternal gap — the alternative
 * is a badge nobody can ever clear.
 *
 * **Zero is not a gap.** A figure genuinely entered as zero is an answer, and
 * treating it as a blank is how a badge comes to sit on a record that is
 * perfectly complete.
 */
export function projectDataGaps(
  project: Record<string, unknown> | null | undefined,
  keys: readonly string[],
): DataGapField[] {
  if (!project) return [];
  const catalogue = projectGapCatalogue();
  const out: DataGapField[] = [];

  for (const field of catalogue) {
    if (!keys.includes(field.key)) continue;
    if (!(field.key in project)) continue;
    if (isBlank(project[field.key])) out.push(field);
  }
  return out;
}

/** The list a screen should warn on, falling back to the default. */
export function projectGapFields(configured: unknown): readonly string[] {
  if (!Array.isArray(configured)) return DEFAULT_PROJECT_GAP_FIELDS;
  const known = new Set(projectGapCatalogue().map((f) => f.key));
  // A key left over from a field that has since been renamed would otherwise
  // sit in the settings forever, warnable by nothing.
  const clean = configured.filter((k): k is string => typeof k === "string" && known.has(k));
  // An empty list is a real answer — "warn about nothing" — and must not fall
  // back to the default, or the feature cannot be turned off.
  return clean;
}
