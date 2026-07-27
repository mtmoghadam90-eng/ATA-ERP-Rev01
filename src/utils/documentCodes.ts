/**
 * Manual overrides for auto-generated document codes.
 *
 * Project codes, proforma numbers, PO numbers and packing-list numbers are
 * generated from the templates in `settings.documentFormats`. Users still need to
 * correct them — to match a customer's own numbering, to fix a wrong sequence, or
 * to re-enter a number from a paper document. These helpers let a form accept an
 * override while keeping the generated value as the default, and guard the one
 * thing that must hold: the code stays unique within its collection.
 */

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/**
 * Normalizes a code for *comparison only* (never for storage): Persian/Arabic
 * digits to ASCII, unified dashes, collapsed whitespace, case-folded. So
 * "ATA-۱۴۰۵-۰۰۱" and "ata-1405-001" are recognized as the same code.
 */
export function normalizeCode(value: string | undefined): string {
  return String(value ?? '')
    .replace(/[۰-۹]/g, (d) => String(FA_DIGITS.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)))
    .replace(/[‐-―−]/g, '-') // various dashes -> hyphen
    .replace(/\s+/g, '')
    .trim()
    .toLowerCase();
}

/** Trims a user-entered code for storage, preserving the characters they typed. */
export function cleanCode(value: string | undefined): string {
  return String(value ?? '').trim();
}

export interface CodeConflict {
  /** The existing record that already uses this code. */
  id: string;
  code: string;
}

/**
 * Finds a record (other than `selfId`) already using `code`.
 *
 * @param records   the collection to check
 * @param field     which property holds the code
 * @param code      the candidate code
 * @param selfId    the record being edited, excluded from the check
 */
export function findCodeConflict<T extends { id: string }>(
  records: T[] | undefined,
  field: keyof T,
  code: string,
  selfId?: string,
): CodeConflict | null {
  const target = normalizeCode(code);
  if (!target) return null;
  for (const rec of records || []) {
    if (!rec) continue;
    if (selfId && rec.id === selfId) continue;
    const existing = normalizeCode(rec[field] as unknown as string);
    if (existing && existing === target) {
      return { id: rec.id, code: String(rec[field]) };
    }
  }
  return null;
}

/** Human-readable labels used in the duplicate-code messages. */
export const CODE_LABELS = {
  project: 'کد پروژه',
  proforma: 'شماره پیش‌فاکتور',
  purchaseOrder: 'شماره سفارش خرید',
  packingList: 'شماره پکینگ لیست',
  product: 'کد کالا',
  transaction: 'شماره سند',
} as const;

export type CodeKind = keyof typeof CODE_LABELS;

/**
 * Validation message for a candidate code, or null when it is acceptable.
 * An empty code is allowed — the caller falls back to the generated value.
 */
export function getCodeError<T extends { id: string }>(
  kind: CodeKind,
  code: string,
  records: T[] | undefined,
  field: keyof T,
  selfId?: string,
): string | null {
  const cleaned = cleanCode(code);
  if (!cleaned) return null; // blank -> auto-generate

  if (cleaned.length > 60) {
    return `${CODE_LABELS[kind]} نمی‌تواند بیش از ۶۰ کاراکتر باشد.`;
  }

  const conflict = findCodeConflict(records, field, cleaned, selfId);
  if (conflict) {
    return `${CODE_LABELS[kind]} «${cleaned}» قبلاً استفاده شده است. لطفاً کد دیگری وارد کنید.`;
  }
  return null;
}
