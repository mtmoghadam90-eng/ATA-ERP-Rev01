import { Customer } from '../types';

/**
 * Customer display labels for selection lists.
 *
 * Two different real people can legitimately share a name, and every dropdown in
 * the app used to render only the name — leaving the user unable to tell them
 * apart. These helpers add a discriminator, but only for the names that are
 * actually ambiguous, so ordinary entries stay clean.
 */

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/** Normalizes Persian text for comparison: Arabic yeh/kaf, ZWNJ, spacing, case. */
export function normalizePersianName(value: string | undefined): string {
  return String(value ?? '')
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/‌/g, ' ') // ZWNJ -> space
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Converts Persian/Arabic digits to ASCII and strips non-digits. */
export function normalizeDigits(value: string | undefined): string {
  return String(value ?? '')
    .replace(/[۰-۹]/g, (d) => String(FA_DIGITS.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)))
    .replace(/\D/g, '');
}

/** The plain display name of a customer, with no discriminator. */
export function getCustomerName(customer: Customer | undefined): string {
  if (!customer) return '';
  const full = `${customer.firstName || ''} ${customer.lastName || ''}`.trim();
  return full || customer.companyName || '';
}

/** Names of the legal entities this (individual) customer is linked to. */
function linkedCompanyName(customer: Customer, all: Customer[]): string {
  // New format: linksFrom array with nested 'to' object
  const linksFrom = (customer as any).linksFrom;
  if (Array.isArray(linksFrom) && linksFrom.length > 0) {
    for (const link of linksFrom) {
      const linked = link.to;
      if (linked && linked.customerType === 'حقوقی' && linked.companyName) {
        return linked.companyName;
      }
    }
  }

  // Old format: linkedCustomerIds array
  const ids = customer.linkedCustomerIds || [];
  for (const id of ids) {
    const linked = all.find((c) => c.id === id);
    // Only a legal entity is a useful discriminator for a person.
    if (linked && linked.customerType === 'حقوقی' && linked.companyName) {
      return linked.companyName;
    }
  }
  return '';
}

/** Candidate discriminator fields, in order of how informative they are. */
const DISCRIMINATOR_CANDIDATES: ((c: Customer, all: Customer[]) => string)[] = [
  (c, all) => linkedCompanyName(c, all),
  (c) => c.position || '',
  (c) => (c.customerType === 'حقوقی' ? c.industry || '' : ''),
  (c) => c.city || '',
  (c) => c.province || '',
  (c) => {
    const tail = normalizeDigits(c.mobile);
    return tail.length >= 4 ? `موبایل …${tail.slice(-4)}` : '';
  },
  (c) => {
    const tail = normalizeDigits(c.phone);
    return tail.length >= 4 ? `تلفن …${tail.slice(-4)}` : '';
  },
  (c) => (c.email ? c.email : ''),
  (c) => (c.economicCode ? `کد اقتصادی ${c.economicCode}` : ''),
];

/**
 * Picks the most informative discriminator for a customer.
 *
 * When `peers` is supplied (the other customers sharing this name), a candidate is
 * only used if it actually tells them apart. This matters for contacts of the same
 * company: their linked company is identical, so it would leave the labels equal —
 * we fall through to position, then mobile, etc.
 */
export function getCustomerDiscriminator(
  customer: Customer,
  all: Customer[],
  peers?: Customer[],
): string {
  const others = (peers || []).filter((p) => p.id !== customer.id);

  for (const pick of DISCRIMINATOR_CANDIDATES) {
    const mine = pick(customer, all);
    if (!mine) continue;
    if (others.length === 0) return mine;
    // Useful only if at least one peer differs on this field.
    const distinguishes = others.some(
      (p) => normalizePersianName(pick(p, all)) !== normalizePersianName(mine),
    );
    if (distinguishes) return mine;
  }

  // Nothing distinguishes them; fall back to the first non-empty value so the
  // label still carries context, even if two entries end up alike.
  for (const pick of DISCRIMINATOR_CANDIDATES) {
    const mine = pick(customer, all);
    if (mine) return mine;
  }
  return '';
}

/**
 * Builds the set of normalized names that more than one customer shares.
 * Callers should memoize this per customer list.
 */
export function findAmbiguousNames(customers: Customer[]): Set<string> {
  const counts = new Map<string, number>();
  (customers || []).forEach((c) => {
    const key = normalizePersianName(getCustomerName(c));
    if (!key) return;
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  const ambiguous = new Set<string>();
  counts.forEach((count, key) => {
    if (count > 1) ambiguous.add(key);
  });
  return ambiguous;
}

/**
 * Display label for a customer in a selection list. Adds a discriminator only
 * when another customer shares the same (normalized) name.
 *
 * @param ambiguousNames pass the result of findAmbiguousNames(customers) to avoid
 *   recomputing per row; omit to have it derived (slower for long lists).
 */
export function getCustomerDisplayLabel(
  customer: Customer | undefined,
  allCustomers: Customer[],
  ambiguousNames?: Set<string>,
  /**
   * The list the user actually sees. Peers are taken from here so the chosen
   * discriminator is guaranteed to tell apart the entries on screen. Defaults to
   * `allCustomers`.
   */
  peerScope?: Customer[],
): string {
  if (!customer) return '';
  const name = getCustomerName(customer);
  if (!name) return '';

  const scope = peerScope ?? allCustomers;
  const ambiguous = ambiguousNames ?? findAmbiguousNames(scope);
  const key = normalizePersianName(name);
  if (!ambiguous.has(key)) return name;

  // Compare against the other visible customers who share this exact name.
  const peers = scope.filter((c) => normalizePersianName(getCustomerName(c)) === key);
  const discriminator = getCustomerDiscriminator(customer, allCustomers, peers);
  return discriminator ? `${name} — ${discriminator}` : name;
}

/**
 * Convenience builder for SearchableSelect options. The discriminator becomes
 * part of the label, so it is searchable too.
 */
export function buildCustomerOptions(
  customers: Customer[],
  filter?: (c: Customer) => boolean,
): { value: string; label: string }[] {
  const list = filter ? customers.filter(filter) : customers;
  const ambiguous = findAmbiguousNames(customers);
  return list.map((c) => ({
    value: c.id,
    label: getCustomerDisplayLabel(c, customers, ambiguous),
  }));
}

/**
 * Options for an already-narrowed subset (e.g. the contacts of one company),
 * preserving the subset's own order. Ambiguity is judged within the subset, since
 * that is what the user actually sees in the list.
 */
export function buildCustomerOptionsFromSubset(
  subset: Customer[],
  allCustomers: Customer[],
): { value: string; label: string }[] {
  const ambiguous = findAmbiguousNames(subset);
  return subset.map((c) => ({
    value: c.id,
    label: getCustomerDisplayLabel(c, allCustomers, ambiguous, subset),
  }));
}
