/**
 * «ورود مشتری از اکسل» — the write behind `src/utils/customerImport.ts`.
 *
 * Every row goes through the customers module's own `createCustomer` /
 * `updateCustomer`, never a write of its own: the audit entry, the owner, the
 * `mobileNormalized` fold, the module notice and the `customer_created` rule
 * are theirs, and a second path into the table is how the five creation forms
 * came to disagree.
 *
 * Three decisions:
 * - **A row is matched before it is created**, by economic code, then mobile,
 *   then email, over the *whole* table rather than the visible part — a
 *   customer somebody else owns is still a customer we already have, and
 *   creating a second one would be the duplicate the import exists to avoid.
 *   Such a row is reported as `hidden` and left alone.
 * - **An existing customer is only filled in** (`fillBlanks`): nothing it
 *   already says is overwritten, and a row that adds nothing touches nothing.
 * - **One row's failure is that row's**: each is its own write with its own
 *   answer, so a sheet of two hundred with one bad economic code imports one
 *   hundred and ninety-nine and names the one.
 */
import { getDb } from "../db";
import { AuthUser } from "../auth";
import {
  CustomerInput, createCustomer, normalizeMobile, updateCustomer, visibilityClause,
} from "./customerService";
import {
  CustomerImportResult, CustomerImportRowResult, ImportField, MAX_CUSTOMER_IMPORT_ROWS,
  fillBlanks, importFieldLabel, matchKeys, parseImportSheet, summarizeImport,
} from "../../utils/customerImport";

const MATCH_SELECT = {
  id: true, companyName: true, ownerUserId: true, economicCode: true, mobileNormalized: true, email: true,
  position: true, mobile: true, phone: true, province: true, city: true, industry: true,
  keyPerson: true, address: true, tags: true, notes: true, firstName: true, lastName: true,
} as const;

export async function importCustomers(
  sheetRows: Record<string, unknown>[],
  user: AuthUser,
  todayJalali: string,
): Promise<CustomerImportResult> {
  if (!Array.isArray(sheetRows) || sheetRows.length === 0) throw new Error("فایل هیچ ردیفی ندارد.");
  if (sheetRows.length > MAX_CUSTOMER_IMPORT_ROWS) {
    throw new Error(`در هر بار حداکثر ${MAX_CUSTOMER_IMPORT_ROWS} ردیف را می‌توان وارد کرد.`);
  }
  const parsed = parseImportSheet(sheetRows);
  if (parsed.length === 0) throw new Error("هیچ ردیفی با ستون‌های شناخته‌شده پیدا نشد. از فایل نمونه استفاده کنید.");

  const db = getDb();
  const keys = parsed.filter((r) => r.customer).map((r) => matchKeys(r.customer!));
  const codes = [...new Set(keys.map((k) => k.economicCode).filter((v): v is string => !!v))];
  const mobiles = [...new Set(keys.map((k) => k.mobile).filter((v): v is string => !!v))];
  const emails = [...new Set(keys.map((k) => k.email).filter((v): v is string => !!v))];
  const or: Record<string, unknown>[] = [];
  if (codes.length) or.push({ economicCode: { in: codes } });
  if (mobiles.length) or.push({ mobileNormalized: { in: mobiles } });
  if (emails.length) or.push({ email: { in: emails } });
  const existing = or.length === 0 ? [] : await db.customer.findMany({ where: { OR: or }, select: MATCH_SELECT });

  const byCode = new Map<string, (typeof existing)[number]>();
  const byMobile = new Map<string, (typeof existing)[number]>();
  const byEmail = new Map<string, (typeof existing)[number]>();
  for (const c of existing) {
    if (c.economicCode) byCode.set(c.economicCode.trim(), c);
    if (c.mobileNormalized) byMobile.set(c.mobileNormalized, c);
    if (c.email) byEmail.set(c.email.trim().toLowerCase(), c);
  }

  // Which of the matches this person may change, asked once for all of them.
  const visibility = visibilityClause(user);
  const visible = new Set<string>(existing.map((c) => c.id));
  if (visibility && existing.length > 0) {
    const allowed = await db.customer.findMany({
      where: { AND: [{ id: { in: existing.map((c) => c.id) } }, visibility] }, select: { id: true },
    });
    visible.clear();
    for (const a of allowed) visible.add(a.id);
  }

  const results: CustomerImportRowResult[] = [];
  for (const row of parsed) {
    if (!row.customer) {
      results.push({ rowNumber: row.rowNumber, name: "", outcome: "error", customerId: null, message: row.error, warnings: row.warnings });
      continue;
    }
    const incoming = row.customer;
    const k = matchKeys(incoming);
    const match = (k.economicCode && byCode.get(k.economicCode))
      || (k.mobile && byMobile.get(k.mobile))
      || (k.email && byEmail.get(k.email))
      || null;

    try {
      if (match) {
        if (!visible.has(match.id)) {
          results.push({
            rowNumber: row.rowNumber, name: incoming.companyName, outcome: "hidden", customerId: null,
            message: "این مشتری قبلاً در سیستم ثبت شده و در دسترس شما نیست.", warnings: row.warnings,
          });
          continue;
        }
        const patch = fillBlanks(match as Partial<Record<ImportField, string | null>>, incoming);
        // An economic code another customer already holds would be refused by
        // the unique index; drop it rather than fail the whole row.
        if (patch.economicCode && byCode.get(patch.economicCode) && byCode.get(patch.economicCode)!.id !== match.id) {
          delete patch.economicCode;
        }
        if (patch.mobile && normalizeMobile(patch.mobile) === match.mobileNormalized) delete patch.mobile;
        const filled = Object.keys(patch);
        if (filled.length === 0) {
          results.push({ rowNumber: row.rowNumber, name: match.companyName, outcome: "unchanged", customerId: match.id, warnings: row.warnings });
          continue;
        }
        await updateCustomer(match.id, patch as Partial<CustomerInput>, user, todayJalali);
        results.push({
          rowNumber: row.rowNumber, name: match.companyName, outcome: "updated", customerId: match.id,
          filled: filled.map(importFieldLabel), warnings: row.warnings,
        });
        continue;
      }

      const created = await createCustomer({ ...incoming } as CustomerInput, user, todayJalali, "EXCEL");
      const id = (created as { id?: string } | null)?.id ?? null;
      results.push({ rowNumber: row.rowNumber, name: incoming.companyName, outcome: "created", customerId: id, warnings: row.warnings });
      // A later row naming the same customer finds the one just written.
      if (id) {
        const fresh = {
          id, companyName: incoming.companyName, ownerUserId: user.id,
          economicCode: incoming.economicCode ?? null, mobileNormalized: k.mobile, email: k.email,
          position: incoming.position ?? null, mobile: incoming.mobile ?? null, phone: incoming.phone ?? null,
          province: incoming.province ?? null, city: incoming.city ?? null, industry: incoming.industry ?? null,
          keyPerson: incoming.keyPerson ?? null, address: incoming.address ?? null, tags: incoming.tags ?? null,
          notes: incoming.notes ?? null, firstName: incoming.firstName ?? null, lastName: incoming.lastName ?? null,
        } as (typeof existing)[number];
        visible.add(id);
        if (k.economicCode) byCode.set(k.economicCode, fresh);
        if (k.mobile) byMobile.set(k.mobile, fresh);
        if (k.email) byEmail.set(k.email, fresh);
      }
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code !== "P2002") console.error("customer import row", row.rowNumber, err);
      results.push({
        rowNumber: row.rowNumber, name: incoming.companyName, outcome: "error", customerId: null,
        message: code === "P2002" ? "کد اقتصادی تکراری است." : "ثبت این ردیف با خطا مواجه شد.",
        warnings: row.warnings,
      });
    }
  }
  return summarizeImport(results);
}
