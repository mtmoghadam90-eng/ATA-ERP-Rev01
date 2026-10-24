/**
 * «اصلاح شرکت‌های تکراری» — the pure half.
 *
 * The first Excel import folded every row's person into the company record
 * (`keyPerson`), so a sheet listing four people at «زلال ایران» made four
 * companies of that name, each carrying one person's mobile and email. The
 * import no longer does that (`customerImport.ts`); this plans the repair of
 * what it already wrote.
 *
 * For each group of «حقوقی» customers whose names fold to one
 * (`companyNameKey`), one record stays the company — the **anchor** — and:
 * - every other record that names a person becomes **that person**: its type
 *   turns «حقیقی», its name is the person's, and it is linked to the anchor.
 *   Converting rather than re-creating keeps every task, message and campaign
 *   row already pointing at it — a call task raised on «زلال ایران (دشتی)»
 *   was a call to دشتی all along;
 * - every other record that names nobody is a **duplicate** of the company
 *   and is merged into the anchor;
 * - the anchor's own person, when it has one, is **extracted** into a new
 *   «حقیقی» customer, taking the mobile and email with them.
 *
 * The anchor is the record the business hangs on (most projects, proformas
 * and transactions), then one that names no person, then the oldest: a
 * record with a project must stay a company, or the project's customer would
 * become a person.
 */
import { companyNameKey, genderFromNotes } from "./customerImport";

export interface CleanupRecord {
  id: string;
  companyName: string;
  customerType: string;
  keyPerson: string | null;
  notes: string | null;
  entrySource: string | null;
  /** ISO timestamp. */
  createdAt: string;
  /** Projects, proformas and transactions that have this record as their customer. */
  references: number;
}

export interface CleanupPerson {
  /** The record that becomes the person (convert), or the anchor it is taken from (extract). */
  id: string;
  fullName: string;
  gender: string | null;
}

export interface CleanupGroup {
  key: string;
  name: string;
  anchorId: string;
  /** Other records naming a person: each becomes that person, linked to the anchor. */
  convert: CleanupPerson[];
  /** The anchor's own person, written out as a new customer. */
  extract: CleanupPerson | null;
  /** Other records naming nobody: merged into the anchor. */
  merge: string[];
  /** How many records the group holds now. */
  size: number;
  /** Ticked when the screen opens: a real duplicate, or a record the import wrote. */
  defaultSelected: boolean;
}

const COMPANY = "حقوقی";

function personOf(r: CleanupRecord): CleanupPerson {
  return { id: r.id, fullName: String(r.keyPerson ?? "").replace(/\s+/g, " ").trim(), gender: genderFromNotes(r.notes) };
}

/**
 * The groups worth repairing: two or more companies sharing a name, or one
 * company still carrying a person in `keyPerson`. Ordered by name.
 */
export function planCompanyCleanup(records: CleanupRecord[]): CleanupGroup[] {
  const groups = new Map<string, CleanupRecord[]>();
  for (const r of records) {
    if (r.customerType !== COMPANY) continue;
    const key = companyNameKey(r.companyName);
    if (!key) continue;
    const list = groups.get(key) ?? [];
    list.push(r);
    groups.set(key, list);
  }

  const out: CleanupGroup[] = [];
  for (const [key, list] of groups) {
    const hasPerson = (r: CleanupRecord) => !!String(r.keyPerson ?? "").trim();
    if (list.length < 2 && !list.some(hasPerson)) continue;
    const ranked = [...list].sort((a, b) =>
      (b.references - a.references)
      || (Number(hasPerson(a)) - Number(hasPerson(b)))
      || a.createdAt.localeCompare(b.createdAt)
      || a.id.localeCompare(b.id));
    const anchor = ranked[0];
    const others = ranked.slice(1);
    out.push({
      key,
      name: anchor.companyName,
      anchorId: anchor.id,
      convert: others.filter(hasPerson).map(personOf),
      extract: hasPerson(anchor) ? personOf(anchor) : null,
      merge: others.filter((r) => !hasPerson(r)).map((r) => r.id),
      size: list.length,
      defaultSelected: list.length > 1 || list.every((r) => r.entrySource === "EXCEL"),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, "fa"));
}

/** A person's stored name parts: the whole name is the family name, since a
 * typed «شیخ الاسلامی» cannot be told from a first and a last name. */
export function personNameParts(fullName: string): { firstName: string | null; lastName: string } {
  return { firstName: null, lastName: fullName };
}

/** What the screen says a group will become. */
export function describeCleanupGroup(g: CleanupGroup): string {
  const people = g.convert.length + (g.extract ? 1 : 0);
  const parts = [`۱ شرکت`];
  if (people > 0) parts.push(`${people.toLocaleString("fa-IR")} شخص متصل`);
  if (g.merge.length > 0) parts.push(`${g.merge.length.toLocaleString("fa-IR")} رکورد تکراری ادغام می‌شود`);
  return parts.join(" + ");
}

/** One group as the screen draws it. */
export interface CompanyCleanupGroup {
  key: string;
  name: string;
  size: number;
  summary: string;
  people: string[];
  defaultSelected: boolean;
  createdAt: string;
}

export interface CompanyCleanupResult {
  groups: number;
  people: number;
  merged: number;
  failed: { name: string; message: string }[];
}
