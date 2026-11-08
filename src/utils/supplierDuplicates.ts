import { companyNameKey } from "./customerImport";

/**
 * Two supplier records for one company, and the rule that stops a third.
 *
 * A supplier named twice splits its history: the inquiries and orders are
 * filed half under one record and half under the other, so «آخرین قیمتی که از
 * این تأمین‌کننده گرفتیم» answers for half of them, and the duplicate cannot
 * simply be deleted because something already points at it. The name is the
 * only identity a supplier here has, so it is what is compared, folded:
 * ی/ي, ک/ك, hamza forms, the half-space, spaces, case, and the punctuation a
 * company name is written with or without («Co.», «Ltd.», «-»).
 */
export function supplierNameKey(value: string | null | undefined): string {
  return companyNameKey(value).replace(/[.,،\-_()'"\/\\]/g, "");
}

/** The existing supplier this name would duplicate, or null. */
export function duplicateSupplier<T extends { id: string; name: string | null }>(
  name: string | null | undefined,
  existing: readonly T[],
  excludeId?: string | null,
): T | null {
  const key = supplierNameKey(name);
  if (!key) return null;
  return existing.find((s) => s.id !== excludeId && supplierNameKey(s.name) === key) ?? null;
}

/** The sentence a refused save shows, naming the record that already exists. */
export function duplicateSupplierRefusal(existingName: string): string {
  return `تأمین‌کننده «${existingName}» قبلاً ثبت شده است. همان را انتخاب کنید یا اگر دو رکورد تکراری دارید، آن‌ها را «ادغام» کنید.`;
}

const FILLABLE = ["country", "city", "contactName", "phone", "email", "website", "paymentTerms", "description"] as const;
export type SupplierFillable = typeof FILLABLE[number];

/**
 * What the merged record keeps: the target's own values, with only its
 * **blank** fields filled from the duplicate. A filled field is never
 * overwritten — the target is the record somebody chose to keep.
 */
export function mergedSupplierFields(
  target: Partial<Record<SupplierFillable, string | null>>,
  source: Partial<Record<SupplierFillable, string | null>>,
): Partial<Record<SupplierFillable, string>> {
  const out: Partial<Record<SupplierFillable, string>> = {};
  for (const key of FILLABLE) {
    const mine = String(target[key] ?? "").trim();
    const theirs = String(source[key] ?? "").trim();
    if (!mine && theirs) out[key] = theirs;
  }
  return out;
}

/** Two lists folded into one, first occurrence kept. */
export function unionBy<T>(a: readonly T[], b: readonly T[], key: (x: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const x of [...a, ...b]) {
    const k = key(x);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out;
}
