/**
 * Canonical list of Iran's 31 provinces, plus normalization so the same province
 * can never be stored under two different spellings.
 */

export const IRAN_PROVINCES: string[] = [
  'آذربایجان شرقی',
  'آذربایجان غربی',
  'اردبیل',
  'اصفهان',
  'البرز',
  'ایلام',
  'بوشهر',
  'تهران',
  'چهارمحال و بختیاری',
  'خراسان جنوبی',
  'خراسان رضوی',
  'خراسان شمالی',
  'خوزستان',
  'زنجان',
  'سمنان',
  'سیستان و بلوچستان',
  'فارس',
  'قزوین',
  'قم',
  'کردستان',
  'کرمان',
  'کرمانشاه',
  'کهگیلویه و بویراحمد',
  'گلستان',
  'گیلان',
  'لرستان',
  'مازندران',
  'مرکزی',
  'هرمزگان',
  'همدان',
  'یزد',
];

/**
 * Aggressive normalization used only for matching (never for display):
 * unifies Arabic/Persian letters, alef variants, ZWNJ, and removes all spaces
 * so "چهار محال و بختیاری" matches "چهارمحال و بختیاری".
 */
function matchKey(value: string | undefined): string {
  return String(value ?? '')
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[أإآا]/g, 'ا')
    .replace(/ۀ|ه‌/g, 'ه')
    .replace(/‌/g, '')
    .replace(/^استان\s*/, '')
    .replace(/\s+/g, '')
    .trim()
    .toLowerCase();
}

const CANONICAL_BY_KEY: Map<string, string> = new Map(
  IRAN_PROVINCES.map((p) => [matchKey(p), p]),
);

/** Extra spellings seen in real data that should map to a canonical province. */
const ALIASES: Record<string, string> = {
  'اذربایجانشرقی': 'آذربایجان شرقی',
  'اذربایجانغربی': 'آذربایجان غربی',
  'تبریز': 'آذربایجان شرقی',
  'ارومیه': 'آذربایجان غربی',
  'کهکیلویهوبویراحمد': 'کهگیلویه و بویراحمد',
  'کهگیلویهوبویراحمد': 'کهگیلویه و بویراحمد',
  'خراسان': 'خراسان رضوی',
  'مشهد': 'خراسان رضوی',
  'چهارمحالوبختیاری': 'چهارمحال و بختیاری',
  'سیستانوبلوچستان': 'سیستان و بلوچستان',
  'کردستان': 'کردستان',
  'طهران': 'تهران',
};

/**
 * Maps free-text input to a canonical province name.
 * Returns '' when the input does not correspond to a known province.
 */
export function canonicalizeProvince(input: string | undefined): string {
  const key = matchKey(input);
  if (!key) return '';
  const direct = CANONICAL_BY_KEY.get(key);
  if (direct) return direct;
  const alias = ALIASES[key];
  if (alias) return alias;
  return '';
}

/** True when the value is (or normalizes to) a known Iranian province. */
export function isValidProvince(input: string | undefined): boolean {
  return canonicalizeProvince(input) !== '';
}
