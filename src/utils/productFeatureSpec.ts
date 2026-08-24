import type { ProductFeature, ProductFeatureOption } from "../types";

/**
 * The configurable features of a product, as one cell of a spreadsheet.
 *
 * The bulk-import sheet documents this format in a note on its own header:
 *
 *   نام ویژگی(کد):مقدار(کد)،مقدار(کد)|نام ویژگی(کد):مقدار
 *
 * — features separated by `|`, options by the Persian comma `،`, and a code in
 * parentheses after either a feature name or an option value. The code is
 * optional; without one an option's position supplies its SKU token.
 *
 * The importer read this column and then dropped it on the floor: the value was
 * parsed out of the row, carried through the batch, and the create call sent
 * `features: null`. So a sheet with thirteen features per product imported
 * thirteen features fewer than it said.
 *
 * Pure, and covered by `test:rules` — including the real sheet that reported it.
 */

/** Features are separated by a pipe. */
const FEATURE_SEPARATOR = "|";
/** Options by the Persian comma, which is what the sheet's own note asks for. */
const OPTION_SEPARATOR = "،";

/**
 * What may sit in the parentheses and still be a code.
 *
 * A code becomes a token in a SKU, so it is letters, digits and the two
 * punctuation marks that survive being part of one. Anything else — a space, a
 * `#`, a symbol — means the parenthesis is part of the text and not a code at
 * all: «2.5Mpa(ANSI300#)» is a pressure rating written the way an instrument
 * catalogue writes it, not a value with a code attached, and reading it as one
 * would quietly delete half of what the user typed.
 */
const CODE_SHAPE = /^[A-Za-z0-9._-]{1,16}$/;

/** «سایز(sz)» → name «سایز», code «sz». «2.5Mpa(ANSI300#)» → all name. */
export function splitNameAndCode(text: string): { name: string; code?: string } {
  const trimmed = String(text ?? "").trim();
  const match = /^(.*)\(([^()]*)\)$/.exec(trimmed);
  if (!match) return { name: trimmed };

  const name = match[1].trim();
  const code = match[2].trim();
  if (!name || !CODE_SHAPE.test(code)) return { name: trimmed };
  return { name, code };
}

let counter = 0;
const nextId = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}`;

/**
 * One spreadsheet cell, as the features a product carries.
 *
 * A feature with no options is dropped: it configures nothing, and a product
 * form that offers a tick-list with nothing to tick is worse than not offering
 * it. Everything else is kept as written, including a value that happens to
 * contain a colon — only the *first* colon separates the name from the options.
 */
export function parseFeatureSpec(raw: unknown): ProductFeature[] {
  const text = String(raw ?? "").trim();
  if (!text) return [];

  const features: ProductFeature[] = [];

  for (const chunk of text.split(FEATURE_SEPARATOR)) {
    const piece = chunk.trim();
    if (!piece) continue;

    const at = piece.indexOf(":");
    if (at < 0) continue; // a name with no options configures nothing

    const { name, code } = splitNameAndCode(piece.slice(0, at));
    if (!name) continue;

    const options: ProductFeatureOption[] = [];
    for (const rawOption of piece.slice(at + 1).split(OPTION_SEPARATOR)) {
      const value = rawOption.trim();
      if (!value) continue;
      const parsed = splitNameAndCode(value);
      options.push({
        id: nextId("opt"),
        value: parsed.name,
        ...(parsed.code ? { code: parsed.code } : {}),
      });
    }
    if (options.length === 0) continue;

    features.push({
      id: nextId("feat"),
      name,
      ...(code ? { code } : {}),
      options,
    });
  }

  return features;
}
