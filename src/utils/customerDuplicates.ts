import { Customer } from '../types';
import { normalizeDigits, normalizePersianName, getCustomerName } from './customerLabel';
import { canonicalizeProvince } from './iranProvinces';

/**
 * Duplicate detection for customers.
 *
 * National/economic codes are not obtainable early, so detection leans on the
 * fields we actually have: mobile, landline, email, name+province. Most matches
 * are "soft" (a warning the user can override), because a shared office line or a
 * genuine namesake must not hard-block data entry. Only a colliding economic code
 * — which is legally unique — is treated as a hard duplicate.
 *
 * Matching is confined to the same customerType (a حقیقی and a حقوقی are never the
 * same entity), and a record never matches itself (by id) when editing.
 */

export type DuplicateField =
  | 'economicCode'
  | 'mobile'
  | 'email'
  | 'name_phone'
  | 'name_province';

export interface DuplicateMatch {
  customer: Customer;
  severity: 'hard' | 'soft';
  primaryField: DuplicateField;
  reason: string; // Persian, may combine several matched fields
}

const FIELD_META: Record<DuplicateField, { severity: 'hard' | 'soft'; label: string; rank: number }> = {
  economicCode: { severity: 'hard', label: 'کد اقتصادی یکسان', rank: 0 },
  mobile:       { severity: 'soft', label: 'شماره موبایل یکسان', rank: 1 },
  email:        { severity: 'soft', label: 'ایمیل یکسان', rank: 2 },
  name_phone:   { severity: 'soft', label: 'نام و تلفن ثابت یکسان', rank: 3 },
  name_province:{ severity: 'soft', label: 'نام و استان یکسان', rank: 4 },
};

/** Candidate is a partial customer as assembled by the various creation forms. */
export type CustomerCandidate = Partial<Customer>;

/** Canonical mobile: fa digits -> ascii, then drop +98/0098/leading-0 so all
 *  common spellings of the same number compare equal. */
export function canonicalMobile(value: string | undefined): string {
  let d = normalizeDigits(value);
  if (d.startsWith('0098')) d = d.slice(4);
  else if (d.startsWith('98') && d.length === 12) d = d.slice(2);
  if (d.startsWith('0')) d = d.replace(/^0+/, '');
  return d;
}

function normalizeEmail(value: string | undefined): string {
  return String(value ?? '').trim().toLowerCase();
}

function detectFields(candidate: CustomerCandidate, existing: Customer): DuplicateField[] {
  const fields: DuplicateField[] = [];

  const ec = normalizeDigits(candidate.economicCode);
  if (ec.length >= 6 && ec === normalizeDigits(existing.economicCode)) {
    fields.push('economicCode');
  }

  const mob = canonicalMobile(candidate.mobile);
  if (mob.length >= 7 && mob === canonicalMobile(existing.mobile)) {
    fields.push('mobile');
  }

  const em = normalizeEmail(candidate.email);
  if (em && em.includes('@') && em === normalizeEmail(existing.email)) {
    fields.push('email');
  }

  const name = normalizePersianName(getCustomerName(candidate as Customer));
  if (name && name === normalizePersianName(getCustomerName(existing))) {
    const ph = normalizeDigits(candidate.phone);
    if (ph.length >= 6 && ph === normalizeDigits(existing.phone)) {
      fields.push('name_phone');
    }
    const prov = canonicalizeProvince(candidate.province);
    if (prov && prov === canonicalizeProvince(existing.province)) {
      fields.push('name_province');
    }
  }

  return fields;
}

/**
 * Returns every existing customer that looks like a duplicate of `candidate`,
 * strongest signal first (hard before soft).
 */
export function findCustomerDuplicates(
  candidate: CustomerCandidate,
  existing: Customer[],
): DuplicateMatch[] {
  const results: DuplicateMatch[] = [];

  for (const ex of existing) {
    if (candidate.id && ex.id === candidate.id) continue;
    if (candidate.customerType && ex.customerType && ex.customerType !== candidate.customerType) continue;

    const fields = detectFields(candidate, ex);
    if (fields.length === 0) continue;

    fields.sort((a, b) => FIELD_META[a].rank - FIELD_META[b].rank);
    const primary = fields[0];
    results.push({
      customer: ex,
      severity: FIELD_META[primary].severity,
      primaryField: primary,
      reason: fields.map((f) => FIELD_META[f].label).join('، '),
    });
  }

  results.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'hard' ? -1 : 1;
    return FIELD_META[a.primaryField].rank - FIELD_META[b.primaryField].rank;
  });
  return results;
}

export function hasHardDuplicate(matches: DuplicateMatch[]): boolean {
  return matches.some((m) => m.severity === 'hard');
}
