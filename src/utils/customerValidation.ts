import { Customer } from '../types';
import { normalizeDigits } from './customerLabel';
import { canonicalizeProvince } from './iranProvinces';

/**
 * Beyond the name, a customer must carry at least one piece of identifying
 * contact information. This keeps records findable and gives duplicate detection
 * something to work with, without demanding data customers won't hand over early
 * (national/economic codes).
 */

export const CUSTOMER_CONTACT_FIELDS = ['mobile', 'phone', 'email', 'province'] as const;
export type CustomerContactField = (typeof CUSTOMER_CONTACT_FIELDS)[number];

export const CUSTOMER_CONTACT_FIELD_LABELS: Record<CustomerContactField, string> = {
  mobile: 'شماره موبایل',
  phone: 'شماره تلفن ثابت',
  email: 'ایمیل',
  province: 'استان',
};

export interface ContactInfoInput {
  mobile?: string;
  phone?: string;
  email?: string;
  province?: string;
}

/** Returns which of the identifying contact fields are actually filled in. */
export function getFilledContactFields(input: ContactInfoInput): CustomerContactField[] {
  const filled: CustomerContactField[] = [];
  if (normalizeDigits(input.mobile).length > 0) filled.push('mobile');
  if (normalizeDigits(input.phone).length > 0) filled.push('phone');
  if (String(input.email ?? '').trim().length > 0) filled.push('email');
  if (canonicalizeProvince(input.province)) filled.push('province');
  return filled;
}

/** True when at least one identifying contact field is present. */
export function hasRequiredContactInfo(input: ContactInfoInput): boolean {
  return getFilledContactFields(input).length > 0;
}

/**
 * Validation message for the "at least one of" rule, or null when satisfied.
 * Suitable for passing straight to alert().
 */
export function getContactInfoError(input: ContactInfoInput): string | null {
  if (hasRequiredContactInfo(input)) return null;
  const names = CUSTOMER_CONTACT_FIELDS.map((f) => CUSTOMER_CONTACT_FIELD_LABELS[f]).join('، ');
  return `علاوه بر نام، وارد کردن حداقل یکی از این اطلاعات الزامی است: ${names}.`;
}

/** Convenience overload for a whole (partial) customer record. */
export function getCustomerContactInfoError(customer: Partial<Customer>): string | null {
  return getContactInfoError({
    mobile: customer.mobile,
    phone: customer.phone,
    email: customer.email,
    province: customer.province,
  });
}
