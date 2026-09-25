import type { Product, ProductConfigRule, ProductFeature } from "../types";
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

/* ------------------- a line's specification, when the product changes ------ */

/** What a product owns in a line's specification text. */
export interface SpecOwner {
  /** Its stored description block, which is appended whole. */
  description?: string | null;
  /** Its feature names: a line «name: value» belongs to the product. */
  featureNames?: string[];
}

const ownedLines = (owner: SpecOwner | undefined): {
  stored: Set<string>;
  names: string[];
} => ({
  stored: new Set(
    String(owner?.description ?? "").split("\n").map((l) => l.trim()).filter(Boolean),
  ),
  names: owner?.featureNames ?? [],
});

/**
 * A line's specification text after its product or SKU changed.
 *
 * Three things go into it: whatever the user typed, the chosen SKU's
 * attributes, and the product's own stored description. The first has to
 * survive and the other two have to be replaced.
 *
 * **The outgoing product is an argument, and that is the whole point.** The
 * "what did the user type" half used to be worked out by subtracting the
 * *incoming* product's description and feature names from the existing text —
 * so switching from product A to product B kept every line of A's description,
 * because none of it looks like B's. A new line is seeded from the first
 * product the picker happens to hold, which made this happen on almost every
 * line: the default product's specification was appended above the one the
 * user actually chose, every time.
 *
 * Lines are matched with the formatting markers stripped, for the same reason
 * `mergeSpecText` does it: «**جنس بدنه**: …» is still the product's line.
 */
export function describeProductSpec(
  next: SpecOwner,
  attributes: Record<string, string>,
  previousText?: string,
  previous?: SpecOwner,
): string {
  const owners = [ownedLines(next), ownedLines(previous)];
  const configLines = Object.entries(attributes).map(([k, v]) => `${k}: ${v}`);

  const kept = String(previousText ?? "")
    .split("\n")
    .filter((line) => {
      const trimmed = stripRichMarks(line).trim();
      if (!trimmed) return false;
      if (trimmed.startsWith("مشخصات:")) return false;
      return !owners.some(
        (owner) => owner.stored.has(trimmed)
          || owner.names.some((name) => trimmed.startsWith(`${name}:`)),
      );
    });

  const stored = String(next.description ?? "").trim();
  return [...kept, ...configLines, ...(stored ? [stored] : [])]
    .filter(Boolean)
    .join("\n");
}

/* ------------- adding a feature or an option from the configurator -------- */

/**
 * Why the catalogue cannot take this new feature or option, or null.
 *
 * A name is the key everything else matches on — `mergeSpecText` finds a
 * feature's line by it, `attributesFromSelections` keys the SKU attributes by
 * it, and `decodeSku` reads a SKU back through it — so two features called the
 * same thing, or two options with the same value, make a SKU that decodes to
 * the wrong product. Compared with the formatting and the surrounding space
 * removed, because «رنج » and «رنج» are the same feature to everybody but a
 * string comparison.
 */
export function catalogueNameRefusal(
  value: string,
  existing: string[],
): string | null {
  const name = stripRichMarks(value).trim();
  if (!name) return "نام را وارد کنید.";
  if (name.length > 100) return "نام طولانی‌تر از حد مجاز است.";
  if (existing.some((other) => stripRichMarks(other).trim() === name)) {
    return "این نام قبلاً تعریف شده است.";
  }
  return null;
}

/**
 * A code is optional, but when it is given it has to be a SKU token.
 *
 * `generateSku` puts it straight into the code, and `decodeSku` splits on `-`,
 * so a code containing a separator produces a SKU that cannot be read back.
 * The same alphabet `productFeatureSpec.ts` accepts when importing a sheet.
 */
export function catalogueCodeRefusal(code: string): string | null {
  const trimmed = code.trim();
  if (!trimmed) return null;
  return /^[A-Za-z0-9._]{1,16}$/.test(trimmed)
    ? null
    : "کد باید حروف و ارقام لاتین باشد (حداکثر ۱۶ نویسه، بدون خط تیره).";
}

/** A fresh id for a feature or an option, in the shape the catalogue uses. */
export function newConfigId(prefix: "feat" | "opt"): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/*
 * Correcting and removing a feature or an option.
 *
 * A name is not a label here, it is a key: a SKU's `attributes` are keyed by
 * the feature's name and hold the option's value, and a `configRules` entry
 * names both. So a rename has to carry every one of those with it, or the SKU
 * the configurator created last week stops being found (`findVariantByAttributes`
 * compares names) and a rule quietly stops applying to the value it was written
 * for. A code is different — it is baked into the SKU string when the SKU is
 * made — so changing one leaves existing SKUs as they are (`decodeSku` matches
 * a stored SKU exactly first) and only shapes the ones made from now on.
 *
 * Removal is **refused** while a SKU uses the thing: a SKU is referenced by
 * quotation lines, purchase orders and the stock ledger, and a SKU whose
 * attribute names a feature that no longer exists is one nobody can select
 * again. The SKU is deleted on the products screen first, where its stock is
 * visible, and then the value goes.
 */

/** Rules with a feature (or one of its values) renamed. */
function renameInRules(
  rules: ProductConfigRule[],
  featureName: string,
  change: { name?: string; value?: { from: string; to: string } },
): ProductConfigRule[] {
  const fix = (entry: { featureName: string; values: string[] }) => {
    if (entry.featureName !== featureName) return entry;
    return {
      featureName: change.name ?? entry.featureName,
      values: change.value
        ? entry.values.map((v) => (v === change.value!.from ? change.value!.to : v))
        : entry.values,
    };
  };
  return rules.map((rule) => ({
    ...rule,
    conditions: rule.conditions.map(fix),
    actions: rule.actions.map(fix),
  }));
}

/**
 * Rules with a feature (or one of its values) taken out. A condition or an
 * action left with no values says nothing and is dropped, and a rule left with
 * no condition or no action is dropped with it — a rule whose condition is gone
 * would otherwise read as «always», which is not what anybody wrote.
 */
function removeFromRules(
  rules: ProductConfigRule[],
  featureName: string,
  value?: string,
): ProductConfigRule[] {
  const strip = (entries: { featureName: string; values: string[] }[]) => entries
    .map((entry) => (entry.featureName !== featureName ? entry
      : value === undefined ? null
        : { ...entry, values: entry.values.filter((v) => v !== value) }))
    .filter((entry): entry is { featureName: string; values: string[] } =>
      !!entry && entry.values.length > 0);
  return rules
    .map((rule) => ({ ...rule, conditions: strip(rule.conditions), actions: strip(rule.actions) }))
    .filter((rule) => rule.conditions.length > 0 && rule.actions.length > 0);
}

/** Why this feature (or option) cannot be removed, or null. */
export function catalogueRemovalRefusal(
  product: Pick<Product, "features" | "variants">,
  featureId: string,
  optionId?: string,
): string | null {
  const feature = (product.features ?? []).find((f) => f.id === featureId);
  if (!feature) return null;
  const option = optionId ? feature.options.find((o) => o.id === optionId) : undefined;
  if (optionId && !option) return null;
  const users = (product.variants ?? []).filter((v) => {
    const held = v.attributes?.[feature.name];
    if (held === undefined) return false;
    return option ? held === option.value : true;
  });
  if (users.length === 0) return null;
  const what = option ? `مقدار «${option.value}»` : `ویژگی «${feature.name}»`;
  return `${what} در ${users.length.toLocaleString("fa-IR")} SKU استفاده شده (${
    users.slice(0, 3).map((v) => v.sku).join("، ")}${users.length > 3 ? "، …" : ""}) و حذف نمی‌شود. `
    + "ابتدا آن SKUها را از صفحه کالاها حذف کنید.";
}

/** A feature renamed (and recoded), with its SKUs and rules following. */
export function renameFeature<P extends Pick<Product, "features" | "variants" | "configRules">>(
  product: P, featureId: string, name: string, code?: string,
): P {
  const feature = (product.features ?? []).find((f) => f.id === featureId);
  if (!feature) return product;
  const from = feature.name;
  const nameChanged = from !== name;
  return {
    ...product,
    features: (product.features ?? []).map((f) => (f.id === featureId ? { ...f, name, code } : f)),
    variants: nameChanged
      ? (product.variants ?? []).map((v) => {
        if (!v.attributes || !(from in v.attributes)) return v;
        const { [from]: held, ...rest } = v.attributes;
        return { ...v, attributes: { ...rest, [name]: held } };
      })
      : product.variants,
    configRules: nameChanged
      ? renameInRules(product.configRules ?? [], from, { name })
      : product.configRules,
  };
}

/** An option renamed (and recoded), with its SKUs and rules following. */
export function renameOption<P extends Pick<Product, "features" | "variants" | "configRules">>(
  product: P, featureId: string, optionId: string, value: string, code?: string,
): P {
  const feature = (product.features ?? []).find((f) => f.id === featureId);
  const option = feature?.options.find((o) => o.id === optionId);
  if (!feature || !option) return product;
  const from = option.value;
  return {
    ...product,
    features: (product.features ?? []).map((f) => (f.id !== featureId ? f : {
      ...f,
      options: f.options.map((o) => (o.id === optionId ? { ...o, value, code } : o)),
    })),
    variants: (product.variants ?? []).map((v) => (v.attributes?.[feature.name] === from
      ? { ...v, attributes: { ...v.attributes, [feature.name]: value } }
      : v)),
    configRules: renameInRules(product.configRules ?? [], feature.name, { value: { from, to: value } }),
  };
}

/** A feature (or one of its options) removed, with the rules that named it. */
export function removeFromCatalogue<P extends Pick<Product, "features" | "variants" | "configRules">>(
  product: P, featureId: string, optionId?: string,
): P {
  const feature = (product.features ?? []).find((f) => f.id === featureId);
  if (!feature) return product;
  const option = optionId ? feature.options.find((o) => o.id === optionId) : undefined;
  if (optionId && !option) return product;
  return {
    ...product,
    features: option
      ? (product.features ?? []).map((f) => (f.id !== featureId ? f
        : { ...f, options: f.options.filter((o) => o.id !== optionId) }))
      : (product.features ?? []).filter((f) => f.id !== featureId),
    configRules: removeFromRules(product.configRules ?? [], feature.name, option?.value),
  };
}
