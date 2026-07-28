import { Prisma } from "@prisma/client";
import { getDb } from "../db";
import { ListQuery, ListResult, buildResult, paginationArgs, searchClause } from "../listing";
import { AuthUser, hasPermission } from "../auth";
import { expandDateFields, jalaliRangeFilter } from "../dates";
import { syncChildren, toJsonColumn, toNullableString, toNumber } from "../childSync";

/**
 * Packaging and delivery (packing lists) plus after-sales service.
 *
 * Both are project-scoped documents with one line-item grid each, so they follow
 * the standard shape. They share a module permission in the existing model
 * (`packagingDelivery`), so they share this file rather than duplicating it.
 */

function allowed(user: AuthUser): boolean {
  return hasPermission(user, "packagingDelivery");
}

/* =============================== deliveries =============================== */

export const DELIVERY_SORTABLE = [
  "packingListNumber", "deliveryDate", "actualDeliveryDate", "createdAt", "updatedAt",
] as const;
export const DELIVERY_FILTERABLE = ["projectId", "proformaId", "shippingMethod"] as const;

const DELIVERY_SEARCH = ["packingListNumber", "shippingMethod", "preDeliveryTestNotes"] as const;
export const DELIVERY_DATE_FIELDS = ["deliveryDate", "actualDeliveryDate"] as const;

export function buildDeliveryWhere(
  q: ListQuery,
  extra: { dateFrom?: unknown; dateTo?: unknown } = {},
): Record<string, unknown> {
  const and: Record<string, unknown>[] = [];

  const search = searchClause(q.search, DELIVERY_SEARCH);
  if (search) and.push(search);

  for (const [field, value] of Object.entries(q.filters)) {
    and.push({ [field]: value });
  }

  const range = jalaliRangeFilter(extra.dateFrom, extra.dateTo);
  if (range) and.push({ deliveryDate: range });

  return and.length === 0 ? {} : { AND: and };
}

const DELIVERY_LIST_SELECT = {
  id: true, packingListNumber: true, projectId: true, proformaId: true,
  deliveryDate: true, deliveryDateJalali: true,
  actualDeliveryDate: true, actualDeliveryDateJalali: true,
  shippingMethod: true, createdAt: true,
  project: { select: { id: true, code: true, name: true } },
  proforma: { select: { id: true, proformaNumber: true } },
  _count: { select: { items: true } },
} satisfies Prisma.PackagingDeliverySelect;

export async function listDeliveries(
  q: ListQuery,
  user: AuthUser,
  extra: { dateFrom?: unknown; dateTo?: unknown } = {},
): Promise<ListResult<Record<string, unknown>> | null> {
  if (!allowed(user)) return null;

  const db = getDb();
  const where = buildDeliveryWhere(q, extra);
  const orderBy = q.sort ? { [q.sort]: q.order } : { createdAt: "desc" as const };

  const [rows, total] = await Promise.all([
    db.packagingDelivery.findMany({ where, orderBy, select: DELIVERY_LIST_SELECT, ...paginationArgs(q) }),
    db.packagingDelivery.count({ where }),
  ]);

  return buildResult(rows as unknown as Record<string, unknown>[], total, q);
}

export async function getDelivery(id: string, user: AuthUser) {
  if (!allowed(user)) return null;
  return getDb().packagingDelivery.findUnique({
    where: { id },
    include: {
      project: { select: { id: true, code: true, name: true } },
      proforma: { select: { id: true, proformaNumber: true } },
      items: { orderBy: { lineNo: "asc" } },
    },
  });
}

export interface PackingItemInput {
  itemOrDocName?: string;
  productId?: string | null;
  tagNumber?: string | null;
  quantity?: unknown;
  packageType?: string | null;
  dimensions?: string | null;
  weight?: unknown;
  boxNumber?: string | null;
  actualDeliveryDate?: string | null;
}

export interface DeliveryInput {
  packingListNumber?: string;
  projectId?: string;
  proformaId?: string | null;
  deliveryDate?: string | null;
  actualDeliveryDate?: string | null;
  shippingMethod?: string | null;
  preDeliveryTestNotes?: string | null;
  checklist?: unknown;
  photos?: unknown;
  items?: PackingItemInput[];
}

function mapPackingItem(row: PackingItemInput): Record<string, unknown> | null {
  const name = toNullableString(row?.itemOrDocName, 400);
  if (!name) return null;
  return {
    itemOrDocName: name,
    productId: toNullableString(row.productId, 36),
    tagNumber: toNullableString(row.tagNumber, 100),
    quantity: toNumber(row.quantity, 1),
    packageType: toNullableString(row.packageType, 100),
    dimensions: toNullableString(row.dimensions, 100),
    weight: toNumber(row.weight, 0),
    boxNumber: toNullableString(row.boxNumber, 50),
    ...expandDateFields(row as Record<string, unknown>, ["actualDeliveryDate"]),
  };
}

function deliveryScalarData(input: DeliveryInput): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const set = (key: string, value: unknown) => { if (value !== undefined) out[key] = value; };

  if ("packingListNumber" in input) set("packingListNumber", toNullableString(input.packingListNumber, 60));
  if ("projectId" in input) set("projectId", input.projectId);
  if ("proformaId" in input) set("proformaId", toNullableString(input.proformaId, 36));
  if ("shippingMethod" in input) set("shippingMethod", toNullableString(input.shippingMethod, 100));
  if ("preDeliveryTestNotes" in input) set("preDeliveryTestNotes", toNullableString(input.preDeliveryTestNotes));
  // The checklist is a snapshot of how it was ticked for this shipment, so it
  // travels with the record rather than referring to the current template.
  if ("checklist" in input) set("checklist", toJsonColumn(input.checklist));
  if ("photos" in input) set("photos", toJsonColumn(input.photos));

  return { ...out, ...expandDateFields(input as Record<string, unknown>, DELIVERY_DATE_FIELDS) };
}

export async function createDelivery(input: DeliveryInput, user: AuthUser) {
  if (!allowed(user)) return null;
  const db = getDb();

  return db.$transaction(async (tx) => {
    const delivery = await tx.packagingDelivery.create({
      data: deliveryScalarData(input) as Prisma.PackagingDeliveryUncheckedCreateInput,
    });
    await syncChildren({
      delegate: tx.packingItem, parentWhere: { deliveryId: delivery.id },
      rows: input.items ?? [], map: mapPackingItem,
    });
    return tx.packagingDelivery.findUnique({
      where: { id: delivery.id },
      include: { items: { orderBy: { lineNo: "asc" } } },
    });
  });
}

export async function updateDelivery(id: string, input: DeliveryInput, user: AuthUser) {
  if (!allowed(user)) return null;
  const db = getDb();

  return db.$transaction(async (tx) => {
    const existing = await tx.packagingDelivery.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return null;

    await tx.packagingDelivery.update({
      where: { id },
      data: deliveryScalarData(input) as Prisma.PackagingDeliveryUncheckedUpdateInput,
    });

    if (input.items !== undefined) {
      await syncChildren({
        delegate: tx.packingItem, parentWhere: { deliveryId: id },
        rows: input.items, map: mapPackingItem,
      });
    }

    return tx.packagingDelivery.findUnique({
      where: { id },
      include: { items: { orderBy: { lineNo: "asc" } } },
    });
  });
}

export async function deleteDelivery(
  id: string,
  user: AuthUser,
): Promise<"ok" | "forbidden" | "not-found"> {
  if (!allowed(user)) return "forbidden";
  const db = getDb();
  const existing = await db.packagingDelivery.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return "not-found";
  await db.packagingDelivery.delete({ where: { id } });
  return "ok";
}

/* ============================== after sales ============================== */

export const SERVICE_SORTABLE = ["itemName", "status", "startDate", "endDate", "createdAt"] as const;
export const SERVICE_FILTERABLE = ["projectId", "status"] as const;

const SERVICE_SEARCH = ["itemName", "proformaNumber", "proformaItemName", "issueDescription", "actionsTaken"] as const;
export const SERVICE_DATE_FIELDS = ["startDate", "endDate", "returnDate"] as const;

export function buildServiceWhere(
  q: ListQuery,
  extra: { dateFrom?: unknown; dateTo?: unknown } = {},
): Record<string, unknown> {
  const and: Record<string, unknown>[] = [];

  const search = searchClause(q.search, SERVICE_SEARCH);
  if (search) and.push(search);

  for (const [field, value] of Object.entries(q.filters)) {
    and.push({ [field]: value });
  }

  const range = jalaliRangeFilter(extra.dateFrom, extra.dateTo);
  if (range) and.push({ startDate: range });

  return and.length === 0 ? {} : { AND: and };
}

const SERVICE_LIST_SELECT = {
  id: true, projectId: true, itemName: true, status: true,
  proformaNumber: true, proformaItemName: true,
  startDate: true, startDateJalali: true, endDateJalali: true, returnDateJalali: true,
  createdBy: true, createdAt: true,
  project: { select: { id: true, code: true, name: true } },
  _count: { select: { items: true } },
} satisfies Prisma.AfterSalesServiceSelect;

export async function listServices(
  q: ListQuery,
  user: AuthUser,
  extra: { dateFrom?: unknown; dateTo?: unknown } = {},
): Promise<ListResult<Record<string, unknown>> | null> {
  if (!allowed(user)) return null;

  const db = getDb();
  const where = buildServiceWhere(q, extra);
  const orderBy = q.sort ? { [q.sort]: q.order } : { createdAt: "desc" as const };

  const [rows, total] = await Promise.all([
    db.afterSalesService.findMany({ where, orderBy, select: SERVICE_LIST_SELECT, ...paginationArgs(q) }),
    db.afterSalesService.count({ where }),
  ]);

  return buildResult(rows as unknown as Record<string, unknown>[], total, q);
}

export async function getService(id: string, user: AuthUser) {
  if (!allowed(user)) return null;
  return getDb().afterSalesService.findUnique({
    where: { id },
    include: {
      project: { select: { id: true, code: true, name: true } },
      items: { orderBy: { lineNo: "asc" } },
    },
  });
}

export interface ServiceItemInput {
  productId?: string | null;
  productName?: string;
  status?: string;
  issueDescription?: string | null;
  actionsTaken?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  returnDate?: string | null;
}

export interface ServiceInput {
  projectId?: string;
  proformaNumber?: string | null;
  proformaItemName?: string | null;
  itemName?: string;
  status?: string;
  issueDescription?: string | null;
  actionsTaken?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  returnDate?: string | null;
  createdBy?: string | null;
  items?: ServiceItemInput[];
}

function mapServiceItem(row: ServiceItemInput): Record<string, unknown> | null {
  const productName = toNullableString(row?.productName, 400);
  if (!productName) return null;
  return {
    productId: toNullableString(row.productId, 36),
    productName,
    status: toNullableString(row.status, 50) ?? "در حال بررسی",
    issueDescription: toNullableString(row.issueDescription),
    actionsTaken: toNullableString(row.actionsTaken),
    ...expandDateFields(row as Record<string, unknown>, SERVICE_DATE_FIELDS),
  };
}

function serviceScalarData(input: ServiceInput): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const set = (key: string, value: unknown) => { if (value !== undefined) out[key] = value; };

  if ("projectId" in input) set("projectId", input.projectId);
  if ("proformaNumber" in input) set("proformaNumber", toNullableString(input.proformaNumber, 60));
  if ("proformaItemName" in input) set("proformaItemName", toNullableString(input.proformaItemName, 400));
  if ("itemName" in input) set("itemName", toNullableString(input.itemName, 400));
  if ("status" in input) set("status", toNullableString(input.status, 50));
  if ("issueDescription" in input) set("issueDescription", toNullableString(input.issueDescription));
  if ("actionsTaken" in input) set("actionsTaken", toNullableString(input.actionsTaken));
  if ("createdBy" in input) set("createdBy", toNullableString(input.createdBy, 200));

  return { ...out, ...expandDateFields(input as Record<string, unknown>, SERVICE_DATE_FIELDS) };
}

export async function createService(input: ServiceInput, user: AuthUser) {
  if (!allowed(user)) return null;
  const db = getDb();

  return db.$transaction(async (tx) => {
    const service = await tx.afterSalesService.create({
      data: serviceScalarData(input) as Prisma.AfterSalesServiceUncheckedCreateInput,
    });
    await syncChildren({
      delegate: tx.afterSalesServiceItem, parentWhere: { serviceId: service.id },
      rows: input.items ?? [], map: mapServiceItem,
    });
    return tx.afterSalesService.findUnique({
      where: { id: service.id },
      include: { items: { orderBy: { lineNo: "asc" } } },
    });
  });
}

export async function updateService(id: string, input: ServiceInput, user: AuthUser) {
  if (!allowed(user)) return null;
  const db = getDb();

  return db.$transaction(async (tx) => {
    const existing = await tx.afterSalesService.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return null;

    await tx.afterSalesService.update({
      where: { id },
      data: serviceScalarData(input) as Prisma.AfterSalesServiceUncheckedUpdateInput,
    });

    if (input.items !== undefined) {
      await syncChildren({
        delegate: tx.afterSalesServiceItem, parentWhere: { serviceId: id },
        rows: input.items, map: mapServiceItem,
      });
    }

    return tx.afterSalesService.findUnique({
      where: { id },
      include: { items: { orderBy: { lineNo: "asc" } } },
    });
  });
}

export async function deleteService(
  id: string,
  user: AuthUser,
): Promise<"ok" | "forbidden" | "not-found"> {
  if (!allowed(user)) return "forbidden";
  const db = getDb();
  const existing = await db.afterSalesService.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return "not-found";
  await db.afterSalesService.delete({ where: { id } });
  return "ok";
}
