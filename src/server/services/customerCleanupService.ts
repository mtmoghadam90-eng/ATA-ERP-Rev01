/**
 * «اصلاح شرکت‌های تکراری» — the write behind `src/utils/customerCleanup.ts`.
 *
 * The plan is recomputed from the database on every apply, never taken from
 * the browser: the screen sends only which groups were ticked (their keys),
 * so a record that moved since the preview is planned again as it is now.
 * Each group is repaired on its own, and a group that fails is reported and
 * leaves the others done; running the repair again picks up whatever is left,
 * because a converted record is a person and no longer in any group.
 *
 * Every customer write goes through the customers module (`createCustomer`,
 * `updateCustomer`, `deleteCustomerWithMigration`), so the audit entries, the
 * `mobileNormalized` fold and the reference moves are theirs.
 */
import { getDb } from "../db";
import { AuthUser } from "../auth";
import {
  CustomerInput, createCustomer, deleteCustomerWithMigration, updateCustomer, visibilityClause,
} from "./customerService";
import { linkCustomers } from "./customerImportService";
import {
  CleanupGroup, CleanupRecord, CompanyCleanupGroup, CompanyCleanupResult,
  describeCleanupGroup, personNameParts, planCompanyCleanup,
} from "../../utils/customerCleanup";
import { getContactInfoError } from "../../utils/customerValidation";

const RECORD_SELECT = {
  id: true, companyName: true, customerType: true, keyPerson: true, notes: true, entrySource: true, createdAt: true,
  mobile: true, email: true, phone: true, position: true, province: true, city: true, industry: true,
  address: true, tags: true, economicCode: true, gender: true, ownerUserId: true,
  _count: { select: { projects: true, proformas: true, transactions: true } },
} as const;

async function loadRecords(user: AuthUser) {
  const visibility = visibilityClause(user);
  const where = visibility ? { AND: [{ customerType: "حقوقی" }, visibility] } : { customerType: "حقوقی" };
  return getDb().customer.findMany({ where, select: RECORD_SELECT, orderBy: { createdAt: "asc" } });
}

type Row = Awaited<ReturnType<typeof loadRecords>>[number];

function toPlanRecord(r: Row): CleanupRecord {
  return {
    id: r.id, companyName: r.companyName, customerType: r.customerType, keyPerson: r.keyPerson,
    notes: r.notes, entrySource: r.entrySource, createdAt: r.createdAt.toISOString(),
    references: r._count.projects + r._count.proformas + r._count.transactions,
  };
}

export async function previewCompanyCleanup(user: AuthUser): Promise<CompanyCleanupGroup[]> {
  const rows = await loadRecords(user);
  const byId = new Map(rows.map((r) => [r.id, r]));
  return planCompanyCleanup(rows.map(toPlanRecord)).map((g) => ({
    key: g.key,
    name: g.name,
    size: g.size,
    summary: describeCleanupGroup(g),
    people: [...(g.extract ? [g.extract] : []), ...g.convert].map((p) => p.fullName),
    defaultSelected: g.defaultSelected,
    createdAt: byId.get(g.anchorId)?.createdAt.toISOString() ?? "",
  }));
}

/** Fields a company takes from one of its records, only where it has none. */
const COMPANY_FILL = ["phone", "province", "city", "industry", "address", "tags", "economicCode"] as const;

export async function applyCompanyCleanup(keys: string[], user: AuthUser, todayJalali: string): Promise<CompanyCleanupResult> {
  const wanted = new Set(keys.filter((k) => typeof k === "string" && k));
  const rows = await loadRecords(user);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const plan = planCompanyCleanup(rows.map(toPlanRecord)).filter((g) => wanted.has(g.key));

  const result: CompanyCleanupResult = { groups: 0, people: 0, merged: 0, failed: [] };
  for (const group of plan) {
    try {
      const { people, merged } = await applyGroup(group, byId, user, todayJalali);
      result.groups++;
      result.people += people;
      result.merged += merged;
    } catch (err) {
      console.error("company cleanup group", group.name, err);
      result.failed.push({ name: group.name, message: err instanceof Error ? err.message : "اصلاح این شرکت با خطا مواجه شد." });
    }
  }
  return result;
}

async function applyGroup(
  group: CleanupGroup,
  byId: Map<string, Row>,
  user: AuthUser,
  todayJalali: string,
): Promise<{ people: number; merged: number }> {
  const db = getDb();
  const anchor = byId.get(group.anchorId);
  if (!anchor) throw new Error("رکورد شرکت پیدا نشد.");

  // What the company itself still lacks, gathered from every record of it.
  const anchorFill: Record<string, string> = {};
  const offer = (r: Row) => {
    for (const f of COMPANY_FILL) {
      const value = r[f];
      if (!value || anchor[f] || anchorFill[f]) continue;
      // The economic code is unique; it moves rather than being copied.
      anchorFill[f] = value;
    }
  };

  let people = 0;
  let merged = 0;

  // Records naming a person become that person.
  for (const person of group.convert) {
    const r = byId.get(person.id);
    if (!r) continue;
    offer(r);
    // The business hangs on the company: a project or a document that named
    // this record as its customer moves to the anchor before it becomes a person.
    await db.project.updateMany({ where: { customerId: r.id }, data: { customerId: anchor.id } });
    await db.proforma.updateMany({ where: { customerId: r.id }, data: { customerId: anchor.id } });
    await db.transaction.updateMany({ where: { customerId: r.id }, data: { customerId: anchor.id } });
    const names = personNameParts(person.fullName);
    await updateCustomer(r.id, {
      customerType: "حقیقی",
      companyName: person.fullName,
      firstName: names.firstName,
      lastName: names.lastName,
      keyPerson: null,
      ...(r.economicCode ? { economicCode: null } : {}),
      ...(!r.gender && person.gender ? { gender: person.gender } : {}),
    } as Partial<CustomerInput>, user, todayJalali);
    await linkCustomers(r.id, anchor.id);
    people++;
  }

  // Records naming nobody are the company again, under another id. Their
  // mobile and email are the company's too, and must not go with the record.
  const spareMobiles: string[] = [];
  const spareEmails: string[] = [];
  for (const id of group.merge) {
    const r = byId.get(id);
    if (!r) continue;
    offer(r);
    if (r.mobile) spareMobiles.push(r.mobile);
    if (r.email) spareEmails.push(r.email);
    if (r.economicCode) await db.customer.update({ where: { id }, data: { economicCode: null } });
    await deleteCustomerWithMigration(id, anchor.id);
    merged++;
  }

  // The anchor's own person, with the mobile and email that were theirs.
  const anchorPatch: Record<string, unknown> = { ...anchorFill };
  if (group.extract) {
    const names = personNameParts(group.extract.fullName);
    const created = await createCustomer({
      customerType: "حقیقی",
      companyName: group.extract.fullName,
      firstName: names.firstName,
      lastName: names.lastName,
      mobile: anchor.mobile, email: anchor.email, phone: anchor.phone, position: anchor.position,
      province: anchor.province, city: anchor.city, industry: anchor.industry, tags: anchor.tags,
      notes: anchor.notes, gender: group.extract.gender,
      ownerUserId: anchor.ownerUserId,
    } as unknown as CustomerInput, user, todayJalali, "EXCEL");
    const personId = (created as { id?: string } | null)?.id;
    if (personId) {
      await linkCustomers(personId, anchor.id);
      people++;
    }
    anchorPatch.keyPerson = null;
    anchorPatch.position = null;
    // The mobile and email were the person's; the company keeps them only
    // when it would otherwise have no way to be reached at all.
    const phone = (anchorPatch.phone as string | undefined) ?? anchor.phone;
    const province = (anchorPatch.province as string | undefined) ?? anchor.province;
    if (!getContactInfoError({ phone, province })) {
      anchorPatch.mobile = null;
      anchorPatch.email = null;
    }
  }
  // The merged records' numbers: into the company's own box where it is
  // empty, the rest written into its notes so nothing anybody typed is lost.
  const mobileNow = "mobile" in anchorPatch ? anchorPatch.mobile : anchor.mobile;
  const emailNow = "email" in anchorPatch ? anchorPatch.email : anchor.email;
  if (!mobileNow && spareMobiles.length > 0) anchorPatch.mobile = spareMobiles.shift();
  if (!emailNow && spareEmails.length > 0) anchorPatch.email = spareEmails.shift();
  const leftover = [
    ...spareMobiles.map((m) => `موبایل: ${m}`),
    ...spareEmails.map((e) => `ایمیل: ${e}`),
  ];
  if (leftover.length > 0) {
    const base = String(anchor.notes ?? "").trim();
    anchorPatch.notes = [base, `از رکوردهای تکراری ادغام‌شده — ${leftover.join("، ")}`].filter(Boolean).join("\n");
  }
  if (Object.keys(anchorPatch).length > 0) {
    await updateCustomer(anchor.id, anchorPatch as Partial<CustomerInput>, user, todayJalali);
  }
  return { people, merged };
}
