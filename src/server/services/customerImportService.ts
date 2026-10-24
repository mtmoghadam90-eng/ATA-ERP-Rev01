/**
 * «ورود مشتری از اکسل» — the write behind `src/utils/customerImport.ts`.
 *
 * Every row goes through the customers module's own `createCustomer` /
 * `updateCustomer`, never a write of its own: the audit entry, the owner, the
 * `mobileNormalized` fold, the module notice and the `customer_created` rule
 * are theirs, and a second path into the table is how the five creation forms
 * came to disagree.
 *
 * Four decisions:
 * - **A row is matched before it is created**, by economic code, then mobile,
 *   then email, over the *whole* table rather than the visible part — a
 *   customer somebody else owns is still a customer we already have, and
 *   creating a second one would be the duplicate the import exists to avoid.
 *   Such a row is reported as `hidden` and left alone.
 * - **An existing customer is only filled in** (`fillBlanks`): nothing it
 *   already says is overwritten, and a row that adds nothing touches nothing.
 * - **A company row naming a person is two customers, linked**: the company is
 *   found by its economic code or its folded name (`companyNameKey`) — on the
 *   system or earlier in the same sheet — and created only when neither has
 *   it; the person is matched by mobile and email like any other row. Rows of
 *   one company therefore make one company and one person each.
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
  CUSTOMER_TYPE_COMPANY, CUSTOMER_TYPE_PERSON, CustomerImportResult, CustomerImportRowResult,
  ImportField, ImportedCustomer, MAX_CUSTOMER_IMPORT_ROWS,
  companyNameKey, fillBlanks, importFieldLabel, matchKeys, parseImportSheet, summarizeImport,
} from "../../utils/customerImport";

const MATCH_SELECT = {
  id: true, companyName: true, customerType: true, ownerUserId: true, economicCode: true, mobileNormalized: true, email: true,
  position: true, mobile: true, phone: true, province: true, city: true, industry: true,
  keyPerson: true, address: true, tags: true, notes: true, firstName: true, lastName: true, gender: true,
} as const;

type Known = {
  id: string; companyName: string; customerType: string; ownerUserId: string | null;
  economicCode: string | null; mobileNormalized: string | null; email: string | null;
  [field: string]: unknown;
};

/** Links two customers both ways — added to whatever links they already have. */
export async function linkCustomers(a: string, b: string): Promise<void> {
  if (!a || !b || a === b) return;
  const db = getDb();
  for (const [fromId, toId] of [[a, b], [b, a]] as const) {
    await db.customerLink.upsert({
      where: { fromId_toId: { fromId, toId } },
      create: { fromId, toId },
      update: {},
    });
  }
}

interface Written {
  outcome: "created" | "updated" | "unchanged" | "hidden";
  id: string | null;
  name: string;
  filled?: string[];
}

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
  const records = parsed.flatMap((r) => [r.customer, r.contact]).filter((c): c is ImportedCustomer => !!c);
  const keys = records.map((c) => matchKeys(c));
  const codes = [...new Set(keys.map((k) => k.economicCode).filter((v): v is string => !!v))];
  const mobiles = [...new Set(keys.map((k) => k.mobile).filter((v): v is string => !!v))];
  const emails = [...new Set(keys.map((k) => k.email).filter((v): v is string => !!v))];
  const or: Record<string, unknown>[] = [];
  if (codes.length) or.push({ economicCode: { in: codes } });
  if (mobiles.length) or.push({ mobileNormalized: { in: mobiles } });
  if (emails.length) or.push({ email: { in: emails } });
  const byKeys = or.length === 0 ? [] : await db.customer.findMany({ where: { OR: or }, select: MATCH_SELECT, orderBy: { createdAt: "asc" } });

  // Companies are also found by name, which cannot be folded in SQL: read
  // every company's name once, and the full row only for the ones named here.
  const wantedNames = new Set(parsed.map((r) => r.customer?.customerType === CUSTOMER_TYPE_COMPANY ? companyNameKey(r.customer.companyName) : "").filter(Boolean));
  const companyIds: string[] = [];
  if (wantedNames.size > 0) {
    const names = await db.customer.findMany({
      where: { customerType: CUSTOMER_TYPE_COMPANY }, select: { id: true, companyName: true }, orderBy: { createdAt: "asc" },
    });
    for (const n of names) if (wantedNames.has(companyNameKey(n.companyName))) companyIds.push(n.id);
  }
  const byName = companyIds.length === 0 ? [] : await db.customer.findMany({
    where: { id: { in: companyIds } }, select: MATCH_SELECT, orderBy: { createdAt: "asc" },
  });

  const byCode = new Map<string, Known>();
  const byMobile = new Map<string, Known>();
  const byEmail = new Map<string, Known>();
  const byCompanyName = new Map<string, Known>();
  const remember = (c: Known) => {
    if (c.economicCode && !byCode.has(c.economicCode.trim())) byCode.set(c.economicCode.trim(), c);
    // A person is found by their mobile; where an older record shares it, the
    // person record wins, since that is who the number belongs to.
    if (c.mobileNormalized) {
      const held = byMobile.get(c.mobileNormalized);
      if (!held || (held.customerType !== CUSTOMER_TYPE_PERSON && c.customerType === CUSTOMER_TYPE_PERSON)) byMobile.set(c.mobileNormalized, c);
    }
    if (c.email) {
      const e = c.email.trim().toLowerCase();
      const held = byEmail.get(e);
      if (!held || (held.customerType !== CUSTOMER_TYPE_PERSON && c.customerType === CUSTOMER_TYPE_PERSON)) byEmail.set(e, c);
    }
    if (c.customerType === CUSTOMER_TYPE_COMPANY) {
      const k = companyNameKey(c.companyName);
      if (k && !byCompanyName.has(k)) byCompanyName.set(k, c);
    }
  };
  for (const c of [...byKeys, ...byName] as Known[]) remember(c);

  // Which of the matches this person may change, asked once for all of them.
  const visibility = visibilityClause(user);
  const known = [...byKeys, ...byName];
  const visible = new Set<string>(known.map((c) => c.id));
  if (visibility && known.length > 0) {
    const allowed = await db.customer.findMany({
      where: { AND: [{ id: { in: known.map((c) => c.id) } }, visibility] }, select: { id: true },
    });
    visible.clear();
    for (const a of allowed) visible.add(a.id);
  }

  /**
   * The person already linked to a company under the same name — how somebody
   * with no mobile and no email (only the office line) is recognised the
   * second time a sheet names them.
   */
  const linkedPerson = async (companyId: string, fullName: string): Promise<Known | null> => {
    const key = companyNameKey(fullName);
    const links = await db.customerLink.findMany({ where: { toId: companyId }, select: { fromId: true } });
    if (links.length === 0) return null;
    const scope = { id: { in: links.map((l) => l.fromId) }, customerType: CUSTOMER_TYPE_PERSON };
    // Only a person this caller may see is a match; anybody else is left alone
    // rather than reported, since nothing on the row named them by a key.
    const people = await db.customer.findMany({ where: visibility ? { AND: [scope, visibility] } : scope, select: MATCH_SELECT });
    const found = (people.find((p) => companyNameKey(p.companyName) === key) as Known | undefined) ?? null;
    if (found) visible.add(found.id);
    return found;
  };

  /** Finds the customer a record already is, or creates it; fills blanks only. */
  const write = async (incoming: ImportedCustomer, companyId: string | null = null): Promise<Written> => {
    const k = matchKeys(incoming);
    // A company is found by its code, then by its name — one company per
    // name, whichever row of the sheet named it first — then by the mobile or
    // email a company-only row carries. A person by mobile or email, and
    // failing those by name among the people already linked to their company.
    const match = (k.economicCode && byCode.get(k.economicCode))
      || (incoming.customerType === CUSTOMER_TYPE_COMPANY && byCompanyName.get(companyNameKey(incoming.companyName)))
      || (k.mobile && byMobile.get(k.mobile))
      || (k.email && byEmail.get(k.email))
      || (incoming.customerType === CUSTOMER_TYPE_PERSON && companyId ? await linkedPerson(companyId, incoming.companyName) : null)
      || null;
    if (match) {
      if (!visible.has(match.id)) return { outcome: "hidden", id: null, name: incoming.companyName };
      const patch = fillBlanks(match as Partial<Record<ImportField, string | null>>, incoming);
      // An economic code another customer already holds would be refused by
      // the unique index; drop it rather than fail the whole row.
      if (patch.economicCode && byCode.get(patch.economicCode) && byCode.get(patch.economicCode)!.id !== match.id) {
        delete patch.economicCode;
      }
      if (patch.mobile && normalizeMobile(patch.mobile) === match.mobileNormalized) delete patch.mobile;
      const filled = Object.keys(patch);
      if (filled.length === 0) return { outcome: "unchanged", id: match.id, name: match.companyName };
      await updateCustomer(match.id, patch as Partial<CustomerInput>, user, todayJalali);
      Object.assign(match, patch);
      return { outcome: "updated", id: match.id, name: match.companyName, filled: filled.map(importFieldLabel) };
    }
    const created = await createCustomer({ ...incoming } as CustomerInput, user, todayJalali, "EXCEL");
    const id = (created as { id?: string } | null)?.id ?? null;
    if (id) {
      // A later row naming the same customer finds the one just written.
      const fresh: Known = {
        ...(incoming as Record<string, unknown>), id, companyName: incoming.companyName, customerType: incoming.customerType,
        ownerUserId: user.id, economicCode: incoming.economicCode ?? null, mobileNormalized: k.mobile, email: k.email,
      };
      visible.add(id);
      remember(fresh);
    }
    return { outcome: "created", id, name: incoming.companyName };
  };

  const results: CustomerImportRowResult[] = [];
  for (const row of parsed) {
    if (!row.customer) {
      results.push({ rowNumber: row.rowNumber, name: "", outcome: "error", customerId: null, message: row.error, warnings: row.warnings });
      continue;
    }
    try {
      if (!row.contact) {
        const w = await write(row.customer);
        results.push({
          rowNumber: row.rowNumber, name: w.name, outcome: w.outcome, customerId: w.id, filled: w.filled,
          message: w.outcome === "hidden" ? "این مشتری قبلاً در سیستم ثبت شده و در دسترس شما نیست." : null,
          warnings: row.warnings,
        });
        continue;
      }
      // Two customers: the company first, so the person can be linked to it.
      const company = await write(row.customer);
      const person = await write(row.contact, company.outcome === "hidden" ? null : company.id);
      if (company.id && person.id && company.outcome !== "hidden" && person.outcome !== "hidden") {
        await linkCustomers(person.id, company.id);
      }
      const notes: string[] = [];
      if (company.outcome === "created") notes.push(`شرکت «${company.name}» ساخته شد.`);
      else if (company.outcome === "hidden") notes.push(`شرکت «${company.name}» در سیستم هست و در دسترس شما نیست؛ پیوند داده نشد.`);
      else notes.push(`به شرکت «${company.name}» پیوند داده شد.`);
      if (person.outcome === "hidden") notes.push("این شخص قبلاً در سیستم ثبت شده و در دسترس شما نیست.");
      results.push({
        rowNumber: row.rowNumber, name: person.name, companyName: company.name, outcome: person.outcome,
        customerId: person.id, filled: person.filled, message: notes.join(" "), warnings: row.warnings,
      });
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code !== "P2002") console.error("customer import row", row.rowNumber, err);
      results.push({
        rowNumber: row.rowNumber, name: row.contact?.companyName ?? row.customer.companyName, outcome: "error", customerId: null,
        message: code === "P2002" ? "کد اقتصادی تکراری است." : "ثبت این ردیف با خطا مواجه شد.",
        warnings: row.warnings,
      });
    }
  }
  return summarizeImport(results);
}
