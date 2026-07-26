import { Product, ProductFeature, ProductFeatureOption, ProductVariant, ProductConfigRule } from '../types';

/**
 * The token that encodes one selected option inside a SKU segment.
 * Uses the option's own code when the user provided one; otherwise falls back to
 * the option's serial position (1-based) so a SKU can always be produced.
 */
export function getOptionToken(option: ProductFeatureOption, optionIndex: number): string {
  const code = (option.code || '').trim();
  return code || String(optionIndex + 1);
}

export function generateSku(
  productCode: string,
  features: ProductFeature[],
  attributes: Record<string, string>,
): string {
  const pCode = (productCode || 'SKU').trim() || 'SKU';
  const parts: string[] = [pCode];
  features.forEach((feat) => {
    const val = attributes[feat.name];
    if (!val) return;
    const optIndex = feat.options.findIndex((o) => o.value === val);
    if (optIndex === -1) return;
    const prefix = feat.code || '';
    parts.push(`${prefix}${getOptionToken(feat.options[optIndex], optIndex)}`);
  });
  return parts.join('-');
}

export function getCombinedFeaturePrice(
  features: ProductFeature[],
  attributes: Record<string, string>,
): number {
  let sum = 0;
  for (const [fName, fVal] of Object.entries(attributes)) {
    const feat = features.find((f) => f.name === fName);
    if (!feat) continue;
    const opt = feat.options.find((o) => o.value === fVal);
    if (opt && opt.price) sum += opt.price;
  }
  return Math.round(sum * 100) / 100;
}

export function isOptionExcludedByRules(
  configRules: ProductConfigRule[] | undefined,
  currentSelections: Record<string, string>,
  featureName: string,
  optionValue: string,
): boolean {
  if (!configRules || configRules.length === 0) return false;
  for (const rule of configRules) {
    if (!rule.active) continue;

    const allConditionsMet = rule.conditions.every((cond) => {
      const val = currentSelections[cond.featureName];
      if (!val) return false;
      return cond.values.includes(val);
    });
    if (!allConditionsMet) continue;

    const hasExclusion = rule.actions.some(
      (act) => act.featureName === featureName && act.values.includes(optionValue),
    );
    if (hasExclusion) return true;
  }
  return false;
}

/** One decoded feature/option pair extracted from a SKU. */
export interface DecodedSkuAttribute {
  featureName: string;
  featureCode?: string;
  optionValue: string;
  optionCode?: string;
  optionIndex: number; // 1-based, as encoded in the SKU
  price?: number;
  currency?: string;
  segment: string; // the raw SKU segment this came from
}

export interface DecodedSkuResult {
  product: Product;
  /** Set when the SKU exactly matches a stored variant. */
  variant?: ProductVariant;
  attributes: DecodedSkuAttribute[];
  /** Segments that could not be mapped to any feature/option. */
  unmatchedSegments: string[];
  /** True when matched against a stored variant SKU (authoritative). */
  exact: boolean;
}

const SKU_FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const SKU_AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/** Normalizes a SKU for comparison: Persian/Arabic digits -> ASCII, strip whitespace. */
export function normalizeSku(raw: string): string {
  return String(raw ?? '')
    .replace(/[۰-۹]/g, (d) => String(SKU_FA_DIGITS.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(SKU_AR_DIGITS.indexOf(d)))
    .replace(/\s+/g, '')
    .trim();
}

function enrichAttribute(
  feat: ProductFeature,
  optionValue: string,
  segment: string,
): DecodedSkuAttribute {
  const optIndex = feat.options.findIndex((o) => o.value === optionValue);
  const opt = optIndex >= 0 ? feat.options[optIndex] : undefined;
  return {
    featureName: feat.name,
    featureCode: feat.code,
    optionValue,
    optionCode: opt?.code,
    optionIndex: optIndex + 1,
    price: opt?.price,
    currency: opt?.currency,
    segment,
  };
}

/** Expands a stored variant's attribute map into ordered, enriched attributes. */
function attributesFromVariant(prod: Product, variant: ProductVariant): DecodedSkuAttribute[] {
  const features = prod.features || [];
  const result: DecodedSkuAttribute[] = [];
  const seen = new Set<string>();

  // Follow the product's feature order first so the output matches the form.
  features.forEach((feat) => {
    const val = variant.attributes?.[feat.name];
    if (val === undefined || val === '') return;
    seen.add(feat.name);
    result.push(enrichAttribute(feat, val, ''));
  });

  // Include any attribute that no longer maps to a defined feature.
  Object.entries(variant.attributes || {}).forEach(([name, val]) => {
    if (seen.has(name) || val === undefined || val === '') return;
    result.push({ featureName: name, optionValue: String(val), optionIndex: 0, segment: '' });
  });

  return result;
}

/**
 * Decodes a SKU back into its product and the feature/option combination it encodes.
 * This is the inverse of `generateSku`.
 *
 * Two strategies, in order:
 *  1. Exact match against a stored variant SKU (authoritative — also yields stock/prices).
 *  2. Structural parse: match the product by code prefix, then decode each remaining
 *     `{featureCode}{optionIndex}` segment. This resolves valid combinations that have
 *     not been registered as variants yet.
 */
export function decodeSku(rawSku: string, products: Product[]): DecodedSkuResult | null {
  const sku = normalizeSku(rawSku);
  if (!sku) return null;
  const upper = sku.toUpperCase();

  // --- 1) Exact stored-variant match ---
  for (const prod of products) {
    for (const variant of prod.variants || []) {
      if (variant.sku && normalizeSku(variant.sku).toUpperCase() === upper) {
        return {
          product: prod,
          variant,
          attributes: attributesFromVariant(prod, variant),
          unmatchedSegments: [],
          exact: true,
        };
      }
    }
  }

  // --- 2) Structural decode, longest product code first (most specific wins) ---
  const candidates = products
    .filter((p) => {
      const code = normalizeSku(p.code || '').toUpperCase();
      if (!code) return false;
      return upper === code || upper.startsWith(`${code}-`);
    })
    .sort(
      (a, b) =>
        normalizeSku(b.code || '').length - normalizeSku(a.code || '').length,
    );

  let fallback: DecodedSkuResult | null = null;

  for (const prod of candidates) {
    const code = normalizeSku(prod.code || '').toUpperCase();
    const remainder = upper === code ? '' : sku.slice(code.length + 1);
    const segments = remainder ? remainder.split('-').filter(Boolean) : [];
    const features = prod.features || [];

    const attributes: DecodedSkuAttribute[] = [];
    const unmatchedSegments: string[] = [];
    let pointer = 0;

    for (const segment of segments) {
      let matched = false;
      // Scan forward only: generateSku emits segments in feature order,
      // skipping features that have no selected value.
      for (let fi = pointer; fi < features.length; fi++) {
        const feat = features[fi];
        const featCode = (feat.code || '').toUpperCase();
        if (featCode && !segment.toUpperCase().startsWith(featCode)) continue;
        const token = segment.slice(featCode.length);
        if (!token) continue;
        // The token is the option's own code, or its 1-based serial as a fallback.
        const optIdx = feat.options.findIndex(
          (o, i) => getOptionToken(o, i).toUpperCase() === token.toUpperCase(),
        );
        if (optIdx === -1) continue;

        attributes.push(enrichAttribute(feat, feat.options[optIdx].value, segment));
        pointer = fi + 1;
        matched = true;
        break;
      }
      if (!matched) unmatchedSegments.push(segment);
    }

    const attrMap: Record<string, string> = {};
    attributes.forEach((a) => {
      attrMap[a.featureName] = a.optionValue;
    });
    const variant = findVariantByAttributes(prod.variants, attrMap);

    const result: DecodedSkuResult = {
      product: prod,
      variant,
      attributes,
      unmatchedSegments,
      exact: false,
    };

    // A fully decoded SKU wins immediately; otherwise remember the best guess.
    if (unmatchedSegments.length === 0) return result;
    if (!fallback) fallback = result;
  }

  return fallback;
}

export function findVariantByAttributes(
  variants: ProductVariant[] | undefined,
  attributes: Record<string, string>,
): ProductVariant | undefined {
  if (!variants || variants.length === 0) return undefined;
  const keys = Object.keys(attributes);
  return variants.find((v) => {
    const vKeys = Object.keys(v.attributes);
    if (vKeys.length !== keys.length) return false;
    return keys.every((k) => v.attributes[k] === attributes[k]);
  });
}
