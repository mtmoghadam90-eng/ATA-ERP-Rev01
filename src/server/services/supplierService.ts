import { Prisma } from "@prisma/client";
import { getDb } from "../db";
import { ListQuery, ListResult, buildResult, paginationArgs, searchClause } from "../listing";
import { AuthUser, hasPermission } from "../auth";
import { toJsonColumn, toNullableString } from "../childSync";
import { notifyModuleResponsible } from "./notificationService";
import { logAction } from "./auditService";
import { processWorkflowRules } from "./workflowService";

/**
 * Supplier data access.
 *
 * Suppliers are shared reference data like products — anyone who can run a
 * purchase or an inquiry needs to read them — so the module permission is the
 * whole gate and there is no per-record scope.
 */

export const SUPPLIER_SORTABLE = ["name", "country", "status", "createdAt", "updatedAt"] as const;
export const SUPPLIER_FILTERABLE = ["status", "country"] as const;

const SEARCH_FIELDS = [
  // `country` is searchable as well as filterable: the grid's one search box has
  // always matched it, and leaving it out made a search for a country return
  // nothing at all.
  "name", "country", "contactName", "phone", "email", "website",
  "description", "providedCategories", "paymentTerms",
] as const;

function allowed(user: AuthUser): boolean {
  return hasPermission(user, "suppliers");
}

export function buildSupplierWhere(q: ListQuery): Record<string, unknown> {
  const and: Record<string, unknown>[] = [];

  const search = searchClause(q.search, SEARCH_FIELDS);
  if (search) and.push(search);

  for (const [field, value] of Object.entries(q.filters)) {
    and.push({ [field]: value });
  }

  return and.length === 0 ? {} : { AND: and };
}

const LIST_SELECT = {
  id: true, name: true, country: true, contactName: true, phone: true, email: true,
  website: true, paymentTerms: true, status: true, providedCategories: true, createdAt: true,
  _count: { select: { purchaseOrders: true, inquiries: true } },
} satisfies Prisma.SupplierSelect;

export async function listSuppliers(
  q: ListQuery,
  user: AuthUser,
): Promise<ListResult<Record<string, unknown>> | null> {
  if (!allowed(user)) return null;

  const db = getDb();
  const where = buildSupplierWhere(q);
  const orderBy = q.sort ? { [q.sort]: q.order } : { name: "asc" as const };

  const [rows, total] = await Promise.all([
    db.supplier.findMany({ where, orderBy, select: LIST_SELECT, ...paginationArgs(q) }),
    db.supplier.count({ where }),
  ]);

  return buildResult(rows as unknown as Record<string, unknown>[], total, q);
}

export async function getSupplier(id: string, user: AuthUser) {
  if (!allowed(user)) return null;
  return getDb().supplier.findUnique({ where: { id } });
}

export interface SupplierInput {
  name?: string;
  country?: string | null;
  contactName?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  paymentTerms?: string | null;
  status?: string;
  description?: string | null;
  providedCategories?: unknown;
  customValues?: unknown;
}

function scalarData(input: SupplierInput): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const set = (key: string, value: unknown) => { if (value !== undefined) out[key] = value; };

  if ("name" in input) set("name", toNullableString(input.name, 300));
  if ("country" in input) set("country", toNullableString(input.country, 100));
  if ("contactName" in input) set("contactName", toNullableString(input.contactName, 200));
  if ("phone" in input) set("phone", toNullableString(input.phone, 50));
  if ("email" in input) set("email", toNullableString(input.email, 200));
  if ("website" in input) set("website", toNullableString(input.website, 300));
  if ("paymentTerms" in input) set("paymentTerms", toNullableString(input.paymentTerms, 300));
  if ("status" in input) set("status", toNullableString(input.status, 20) ?? "فعال");
  if ("description" in input) set("description", toNullableString(input.description));
  if ("providedCategories" in input) set("providedCategories", toJsonColumn(input.providedCategories));
  if ("customValues" in input) set("customValues", toJsonColumn(input.customValues));

  return out;
}

export async function createSupplier(input: SupplierInput, user: AuthUser, todayJalali: string) {
  if (!allowed(user)) return null;
  const supplier = await getDb().supplier.create({
    data: scalarData(input) as Prisma.SupplierUncheckedCreateInput,
  });

  // Audit log
  await logAction(
    {
      action: "CREATE",
      module: "تامین‌کنندگان",
      entityId: supplier.id,
      description: `ایجاد تامین‌کننده جدید: ${supplier.name || supplier.id}`,
      afterState: supplier,
    },
    user,
    todayJalali,
  );

  // Notification
  await notifyModuleResponsible(
    "suppliers",
    "ثبت تامین‌کننده جدید",
    `تامین‌کننده جدید ثبت شد: ${supplier.name || supplier.id}`,
    user,
    null,
  );

  // Workflow trigger
  await processWorkflowRules(
    "supplier_created",
    {
      supplierId: supplier.id,
      supplierName: supplier.name,
      companyName: supplier.name,
      country: supplier.country,
    },
    user,
  );

  return supplier;
}

export async function updateSupplier(id: string, input: SupplierInput, user: AuthUser, todayJalali: string) {
  if (!allowed(user)) return null;
  const db = getDb();

  // Get before state for audit log
  const before = await db.supplier.findUnique({ where: { id } });
  if (!before) return null;

  const supplier = await db.supplier.update({
    where: { id },
    data: scalarData(input) as Prisma.SupplierUncheckedUpdateInput,
  });

  // Audit log
  await logAction(
    {
      action: "UPDATE",
      module: "تامین‌کنندگان",
      entityId: id,
      description: `ویرایش تامین‌کننده: ${supplier.name || id}`,
      beforeState: before,
      afterState: supplier,
    },
    user,
    todayJalali,
  );

  return supplier;
}

export async function countSupplierReferences(id: string) {
  const db = getDb();
  const [purchaseOrders, inquiries, transactions] = await Promise.all([
    db.purchaseOrder.count({ where: { supplierId: id } }),
    db.supplierInquiry.count({ where: { supplierId: id } }),
    db.transaction.count({ where: { supplierId: id } }),
  ]);
  return { purchaseOrders, inquiries, transactions, total: purchaseOrders + inquiries + transactions };
}

export async function deleteSupplier(
  id: string,
  user: AuthUser,
  todayJalali: string,
): Promise<"ok" | "forbidden" | "in-use" | "not-found"> {
  if (!allowed(user)) return "forbidden";
  const db = getDb();

  const existing = await db.supplier.findUnique({ where: { id } });
  if (!existing) return "not-found";

  const refs = await countSupplierReferences(id);
  if (refs.total > 0) return "in-use";

  await db.supplier.delete({ where: { id } });

  // Audit log
  await logAction(
    {
      action: "DELETE",
      module: "تامین‌کنندگان",
      entityId: id,
      description: `حذف تامین‌کننده: ${existing.name || id}`,
      beforeState: existing,
    },
    user,
    todayJalali,
  );

  return "ok";
}
